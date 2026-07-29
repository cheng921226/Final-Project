import json

from fastapi import APIRouter, HTTPException, Query, Depends
from google import genai
from pydantic import BaseModel

from database.supabase import supabase_admin
from routers.lectures import get_lecture_transcript, get_lecture_knowledge_points
from routers.users import get_user_id, get_user_role
from .security import get_current_user
from .users import get_chat_context

router = APIRouter()

gemini_client = genai.Client()


def normalize_source_timestamp(value):
    if value in (None, "", "null"):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def normalize_knowledge_point_id(value):
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def time_to_seconds(value):
    if value in (None, "", "null"):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    parts = str(value).split(":")
    try:
        numbers = [float(part) for part in parts]
    except ValueError:
        return None
    if len(numbers) == 2:
        return numbers[0] * 60 + numbers[1]
    if len(numbers) == 3:
        return numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    return numbers[0] if numbers else None


def infer_knowledge_point_id(source_timestamp, knowledge_points):
    timestamp = normalize_source_timestamp(source_timestamp)
    if timestamp is None:
        return None
    for kp in knowledge_points or []:
        start = time_to_seconds(kp.get("start_time"))
        end = time_to_seconds(kp.get("end_time"))
        if start is None:
            continue
        if end is None:
            end = start
        if start <= timestamp <= end:
            return kp.get("id")
    return None


# =====================================================================
# 🤖 AI 助教對話
# =====================================================================


class ChatRequest(BaseModel):
    lecture_id: int
    question: str
    video_timestamp: int = 0  # 學生提問時的影片秒數


@router.post("/ai/chat")
def ai_chat(body: ChatRequest, user=Depends(get_current_user)):
    try:
        res = (
            supabase_admin.table("users")
            .select("id, role")
            .eq("auth_id", user.id)
            .single()
            .execute()
        )

        if not res.data:
            raise HTTPException(status_code=404, detail="找不到使用者")

        student_id = res.data["id"]
        user_role = res.data["role"]

        history = get_chat_context(
            lecture_id=body.lecture_id, student_id=student_id, limit=6
        )

        # 撈逐字稿
        transcript_raw = get_lecture_transcript(body.lecture_id)
        if not transcript_raw:
            raise HTTPException(status_code=400, detail="找不到此小節的逐字稿")

        # 撈知識點
        knowledge_points_raw = get_lecture_knowledge_points(body.lecture_id)

        # 把逐字稿轉成純文字
        transcript_text = (
            "\n".join(
                [seg.get("text", "") for seg in transcript_raw if isinstance(seg, dict)]
            )
            if isinstance(transcript_raw[0], dict)
            else str(transcript_raw)
        )

        # 抓影片當前時間點前後 60 秒的逐字稿片段（上下文）
        timestamp = body.video_timestamp
        context_segments = []
        for seg in transcript_raw:
            if not isinstance(seg, dict):
                continue
            start = seg.get("start_time") or seg.get("start") or 0
            try:
                start_sec = float(start)
            except (ValueError, TypeError):
                start_sec = 0
            if abs(start_sec - timestamp) <= 60:
                context_segments.append(seg.get("text", ""))
        transcript_context = (
            "\n".join(context_segments) if context_segments else transcript_text[:500]
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

        # Prompt
        prompt = f"""
        你是一位親切、有耐心的專業課程 AI 助教。
        請使用繁體中文，語氣要像資工系的學長姐或助教一樣，說話自然不要太正式。
        回答字數控制在 100~200 字內。
        回答時可以適時舉例或用比喻幫助理解。

        【規則】
        1. 只能根據課程逐字稿和知識點內容回答，不可自行編造。
        2. 如果學生問了非課程相關的問題（例如天氣、娛樂八卦、情感問題），請禮貌拒絕並引導回課程，例如：「這個我幫不上忙，不過如果你有課程相關的問題，我很樂意幫你解答！」
        3. 如果學生說「不懂」或「再解釋一次」，請換個方式或用更簡單的比喻重新說明。

        【目前學習情況】
        學生正在觀看小節 ID：{body.lecture_id}
        學生提問時，影片正播放到：{timestamp_str}（分:秒）

        【當前時間點附近的逐字稿】
        {transcript_context}

        【本節課核心知識點】
        {kp_text}

        【完整逐字稿（備用參考）】
        {transcript_text[:2000]}

        【先前對話紀錄】
        {history_text if history_text else "（本次對話剛開始）"}

        【學生問題】
        {body.question}

        請直接回答，不需要加「助教：」前綴。
        JSON 格式：
        {{"answer": "助教回答內容"}}
        """

        ai_response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

        try:
            result_json = json.loads(ai_response.text)
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="AI 回應格式錯誤")

        supabase_admin.table("chat_messages").insert(
            {
                "student_id": student_id,
                "lecture_id": body.lecture_id,
                "role": user_role,
                "question": body.question,
                "answer": result_json.get("answer", ""),
                "video_timestamp": body.video_timestamp,
            }
        ).execute()

        return {
            "status": "success",
            "lecture_id": body.lecture_id,
            "answer": result_json.get("answer", ""),
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI 助教發生錯誤：{str(e)}")


# =====================================================================
# 以下為原本的測試 API
# =====================================================================


class SummaryRequest(BaseModel):
    lecture_id: int


# 生成摘要
@router.post("/lectures/test-summary")
def generate_summary(body: SummaryRequest):
    existing_response = (
        supabase_admin.table("summaries")
        .select("*")
        .eq("lecture_id", body.lecture_id)
        .maybe_single()
        .execute()
    )
    existing_data = getattr(existing_response, "data", None)

    if existing_data:
        return {"status": "cached", "data": existing_data}

    try:
        transcript = get_lecture_transcript(body.lecture_id)
        if not transcript:
            raise HTTPException(
                status_code=400, detail="Transcript not found for this lecture."
            )

        prompt = f"""
            請根據以下課程逐字稿，產生 150 字內的繁體中文課程摘要。
            JSON格式：
            {{"summary":"摘要內容"}}
            課程逐字稿：
            {transcript}
        """

        ai_response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

        try:
            result_json = json.loads(ai_response.text)
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Failed to parse AI response.")

        supabase_admin.table("summaries").insert(
            {"lecture_id": body.lecture_id, "summary_text": result_json}
        ).execute()

        return {"status": "success", "lecture_id": body.lecture_id, "data": result_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"test fail: {str(e)}")


class MindMapRequest(BaseModel):
    lecture_id: int


# 生成心智圖
@router.post("/lectures/test-mindmap")
def generate_mindmap(body: MindMapRequest):
    existing_response = (
        supabase_admin.table("mindmaps")
        .select("*")
        .eq("lecture_id", body.lecture_id)
        .maybe_single()
        .execute()
    )
    existing_data = getattr(existing_response, "data", None)

    if existing_data:
        return {"status": "cached", "data": existing_data}

    try:
        transcript = get_lecture_transcript(body.lecture_id)
        if not transcript:
            raise HTTPException(
                status_code=400, detail="Transcript not found for this lecture."
            )

        prompt = f"""
        請根據以下課程逐字稿，產生一份適合用 Markmap 渲染的「Markdown 格式課程心智圖」。
        心智圖只需要呈現知識架構，不需要影片時間點。
        請只輸出 JSON。

        JSON 格式：
        {{"markdown": "# 課程總主題\\n## 核心概念一\\n- 概念說明\\n## 核心概念二\\n- 概念說明"}}

        規則：
        1. 階層設計：
        - 第一層（根節點）：使用一個 `#` （例如：# 課程總主題）
        - 第二層（主觀念）：使用兩個 `##` （例如：## 主要概念一）
        - 第三層（子細節）：使用 `-` 無序清單（例如：- 觀念詳細說明）
        2. 不要使用任何 Markdown 程式碼區塊標記（如 ```markdown）。
        3. 內容必須簡潔，每個節點字數控制在 15 字以內。
        4. 使用繁體中文。

        課程逐字稿：
        {transcript}
        """

        ai_response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

        try:
            result_json = json.loads(ai_response.text)
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Failed to parse AI response.")

        lecture_title = (
            supabase_admin.table("lectures")
            .select("title")
            .eq("id", body.lecture_id)
            .single()
            .execute()
        )

        if not lecture_title.data:
            raise HTTPException(status_code=404, detail="Lecture not found")

        supabase_admin.table("mindmaps").insert(
            {
                "lecture_id": body.lecture_id,
                "title": lecture_title.data["title"],
                "mindmap_json": result_json,
            }
        ).execute()

        return {"status": "success", "lecture_id": body.lecture_id, "data": result_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"test fail: {str(e)}")


class KnowledgePointsRequest(BaseModel):
    lecture_id: int


# 生成知識點
@router.post("/lectures/test-knowledge_points")
def generate_knowledge_points(body: KnowledgePointsRequest):
    existing_response = (
        supabase_admin.table("knowledge_points")
        .select("*")
        .eq("lecture_id", body.lecture_id)
        .maybe_single()
        .execute()
    )
    existing_data = getattr(existing_response, "data", None)

    if existing_data:
        return {"status": "cached", "data": existing_data}

    try:
        transcript = get_lecture_transcript(body.lecture_id)
        if not transcript:
            raise HTTPException(
                status_code=400, detail="Transcript not found for this lecture."
            )

        prompt = f"""
            請根據以下課程逐字稿，產生 5 到 8 個適合學生複習用的知識點。
            JSON格式：
            {{ "knowledge_points": [ {{ "title": "知識點標題", "description": "知識點說明", "start_time": null, "end_time": null }} ] }}
            使用繁體中文。如果沒有時間資訊請填 null。
            start_time / end_time 請輸出 mm:ss
            課程逐字稿：
            {transcript}
        """

        ai_response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

        try:
            result_json = json.loads(ai_response.text)
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Failed to parse AI response.")

        for kp in result_json["knowledge_points"]:
            supabase_admin.table("knowledge_points").insert(
                {
                    "lecture_id": body.lecture_id,
                    "title": kp["title"],
                    "description": kp["description"],
                    "start_time": kp["start_time"],
                    "end_time": kp["end_time"],
                }
            ).execute()

        return {"status": "success", "lecture_id": body.lecture_id, "data": result_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"test fail: {str(e)}")


class QuestionsRequest(BaseModel):
    lecture_id: int


# 生成題目
@router.post("/lectures/test-questions")
def generate_questions(body: QuestionsRequest):
    existing_response = (
        supabase_admin.table("questions")
        .select("*")
        .eq("lecture_id", body.lecture_id)
        .maybe_single()
        .execute()
    )
    existing_data = getattr(existing_response, "data", None)

    if existing_data:
        return {"status": "cached", "data": existing_data}

    try:
        transcript = get_lecture_transcript(body.lecture_id)
        knowledge_points = get_lecture_knowledge_points(body.lecture_id)
        if not transcript:
            raise HTTPException(
                status_code=400, detail="Transcript not found for this lecture."
            )

        prompt = f"""
            1.請根據以下課程逐字稿和知識點列表，產生 5 到 10 題選擇題。
            2.每一題都必須對應影片中的一個出題時間點。
            3.source_timestamp 必須是純整數秒數，代表影片播放到該秒數時要跳出題目。
            4.請根據逐字稿段落時間與知識點 start_time / end_time 推估，不可以填 null。
              例如：如果教授在 12 分 25 秒講到這個觀念，請轉換為 745 存入 source_timestamp。
            JSON格式：
            {{"questions": [
                    {{
                        "question_text": "題目文字內容",
                        "options": ["A. 選項A內容", "B. 選項B內容", "C. 選項C內容", "D. 選項D內容"],
                        "answer": "A",
                        "explanation": "對四個選項進行對錯的精簡專業解釋",
                        "related_knowledge_point": "使用提供的知識點 id，若無則填 null",
                        "source_timestamp": 745
                    }}
                ]}}            
            使用繁體中文。每題固定 4 個選項，且 answer 只能是 A、B、C 或 D。
            課程逐字稿：{transcript}
            知識點列表：{knowledge_points}
        """

        ai_response = gemini_client.models.generate_content(
            model="gemini-3.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )

        try:
            result_json = json.loads(ai_response.text)
        except json.JSONDecodeError:
            raise HTTPException(status_code=500, detail="Failed to parse AI response.")

        for q in result_json["questions"]:
            source_timestamp = normalize_source_timestamp(q.get("source_timestamp"))
            knowledge_point_id = normalize_knowledge_point_id(
                q.get("related_knowledge_point")
            ) or infer_knowledge_point_id(source_timestamp, knowledge_points)
            supabase_admin.table("questions").insert(
                {
                    "lecture_id": body.lecture_id,
                    "knowledge_point_id": knowledge_point_id,
                    "question_text": q["question_text"],
                    "options_json": q["options"],
                    "answer": q["answer"],
                    "explanation": q["explanation"],
                    "source_timestamp": source_timestamp,
                }
            ).execute()

        return {"status": "success", "lecture_id": body.lecture_id, "data": result_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"test fail: {str(e)}")
