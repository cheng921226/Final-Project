import base64
import json
import logging
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from google import genai
from google.genai import errors, types
from pydantic import BaseModel, Field, ValidationError

from database.supabase import supabase_admin
from routers.lectures import get_lecture_knowledge_points, get_lecture_transcript
from services.chat_context import build_chat_material
from .security import AuthContext, get_auth_context
from .users import get_chat_context

router = APIRouter()
logger = logging.getLogger(__name__)

gemini_client = genai.Client()

def generate_json_content(
    prompt: str | list[str | types.Part],
    *,
    model: str,
    response_schema: type[BaseModel],
):
    return gemini_client.models.generate_content(
        model=model,
        contents=prompt,
        config={
            "response_mime_type": "application/json",
            "response_schema": response_schema,
        },
    )


def parse_transcript_rows(rows):
    """Return timestamped segments and plain text from transcript table rows."""
    if not rows:
        return [], ""

    segments = []
    stored_content = ""
    for row in rows:
        if not isinstance(row, dict):
            continue
        if not stored_content and isinstance(row.get("content"), str):
            stored_content = row["content"].strip()

        raw_segments = row.get("segments_json")
        if isinstance(raw_segments, str):
            try:
                raw_segments = json.loads(raw_segments)
            except json.JSONDecodeError:
                raw_segments = []
        if isinstance(raw_segments, list):
            segments.extend(seg for seg in raw_segments if isinstance(seg, dict))
        elif "text" in row:
            segments.append(row)

    segment_text = "\n".join(
        str(seg.get("text") or "").strip()
        for seg in segments
        if str(seg.get("text") or "").strip()
    )
    return segments, stored_content or segment_text


# =====================================================================
# 🤖 AI 助教對話
# =====================================================================


MAX_CHAT_IMAGE_BYTES = 4 * 1024 * 1024


class ChatImage(BaseModel):
    mime_type: Literal["image/jpeg", "image/png", "image/webp"]
    data: str = Field(min_length=1, max_length=((MAX_CHAT_IMAGE_BYTES + 2) // 3) * 4)

    def to_part(self) -> types.Part:
        try:
            content = base64.b64decode(self.data, validate=True)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="無法讀取圖片") from exc
        if len(content) > MAX_CHAT_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail="圖片大小不可超過 4 MB")
        matches_format = {
            "image/jpeg": content.startswith(b"\xff\xd8\xff"),
            "image/png": content.startswith(b"\x89PNG\r\n\x1a\n"),
            "image/webp": content.startswith(b"RIFF") and content[8:12] == b"WEBP",
        }
        if not matches_format[self.mime_type]:
            raise HTTPException(status_code=422, detail="圖片內容與檔案格式不符")
        return types.Part.from_bytes(data=content, mime_type=self.mime_type)


class ChatRequest(BaseModel):
    lecture_id: int
    question: str
    video_timestamp: int = 0  # 學生提問時的影片秒數
    image: ChatImage | None = None


class ChatAnswer(BaseModel):
    answer: str


@router.post("/ai/chat")
def ai_chat(body: ChatRequest, context: AuthContext = Depends(get_auth_context)):
    image_part = body.image.to_part() if body.image else None
    try:
        student_id = context.profile["id"]
        user_role = context.profile["role"]

        history = get_chat_context(
            lecture_id=body.lecture_id,
            student_id=student_id,
            limit=6,
            database=context.database,
        )

        # 撈逐字稿
        transcript_rows = get_lecture_transcript(body.lecture_id)
        transcript_segments, transcript_text = parse_transcript_rows(transcript_rows)
        if not transcript_text:
            raise HTTPException(status_code=400, detail="找不到此小節的逐字稿")

        # 撈知識點
        knowledge_points_raw = get_lecture_knowledge_points(body.lecture_id)

        timestamp = body.video_timestamp
        transcript_context = build_chat_material(
            transcript_segments, transcript_text, knowledge_points_raw, timestamp
        )

        # 格式化知識點
        kp_text = (
            "\n".join(
                [
                    f"- {kp.get('title', '')}: {kp.get('description', '')}"
                    for kp in knowledge_points_raw
                ]
            )
            if knowledge_points_raw
            else "（本節無知識點資料）"
        )

        # 格式化影片時間
        minutes = timestamp // 60
        seconds = timestamp % 60
        timestamp_str = f"{minutes}:{seconds:02d}"

        # 格式化對話歷史
        history_text = ""
        for msg in history:
            role = "學生" if msg["role"] == "user" else "助教"
            history_text += f"{role}：{msg['content']}\n"

        prompt = f"""課程小節 ID：{body.lecture_id}
影片時間：{timestamp_str}

目前知識點與前後教材：
{transcript_context}

本節知識點：
{kp_text}

先前對話：
{history_text if history_text else "（本次對話剛開始）"}

學生問題：
{body.question}"""

        sources = "課程逐字稿、知識點與學生附上的圖片" if image_part else "課程逐字稿和知識點"
        chat_prompt = f'''你是一位親切、有耐心的專業課程 AI 助教，使用繁體中文，回答約 100 到 200 字，語氣自然。
只能根據{sources}回答，不可編造；非課程問題請禮貌拒絕並引導回課程。學生表示不懂時，換個方式或用簡單比喻說明。
優先說明目前播放位置對應的概念；前後知識點僅供補充，不要假設學生已看過後續內容。先前對話用於理解追問，回答仍以課程資料為依據。資料缺少或未定位時請明確說明，必要時請學生補充。
直接回答，不要寒暄、稱讚、自我介紹、重述問題或加「助教：」前綴。
請輸出 JSON：{{"answer":"助教回答內容"}}

{prompt}'''
        contents = [chat_prompt, image_part] if image_part else chat_prompt
        primary_model = "gemini-3.5-flash-lite"
        fallback_model = "gemini-3.1-flash-lite"
        try:
            for model in (primary_model, fallback_model):
                try:
                    ai_response = generate_json_content(
                        contents,
                        model=model,
                        response_schema=ChatAnswer,
                    )
                    break
                except errors.APIError as exc:
                    if exc.code != 503 or model == fallback_model:
                        raise
                    logger.warning("Gemini chat model unavailable: model=%s code=%s", model, exc.code)
        except errors.APIError as exc:
            logger.warning(
                "Gemini chat request failed: lecture_id=%s image=%s code=%s",
                body.lecture_id, bool(image_part), exc.code,
            )
            if exc.code == 429:
                raise HTTPException(status_code=429, detail="AI 助教目前已達用量限制，請稍後再試") from exc
            if exc.code == 400 and image_part:
                raise HTTPException(status_code=422, detail="Gemini 無法處理這次圖片請求，請換一張 JPG 或 PNG 再試") from exc
            raise HTTPException(status_code=502, detail="AI 服務暫時無法回應，請稍後再試") from exc

        try:
            answer = ChatAnswer.model_validate_json(ai_response.text or "").answer.strip()
        except ValidationError as exc:
            logger.warning("Invalid Gemini chat answer: lecture_id=%s", body.lecture_id)
            raise HTTPException(status_code=502, detail="AI 助教回應格式有誤，請再試一次") from exc
        if not answer:
            raise HTTPException(status_code=502, detail="AI 助教沒有回傳回答，請再試一次")

        # AI 回答是系統產物，必須由可信任後端寫入，避免學生直接偽造回答紀錄。
        supabase_admin.table("chat_messages").insert(
            {
                "student_id": student_id,
                "lecture_id": body.lecture_id,
                "role": user_role,
                "question": body.question,
                "answer": answer,
                "video_timestamp": body.video_timestamp,
            }
        ).execute()

        return {
            "status": "success",
            "lecture_id": body.lecture_id,
            "answer": answer,
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Chat failed: lecture_id=%s error=%s", body.lecture_id, type(exc).__name__)
        raise HTTPException(status_code=500, detail="AI 助教暫時無法完成請求，請稍後再試") from exc
