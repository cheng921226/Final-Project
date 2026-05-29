import json

from fastapi import APIRouter, HTTPException, Query
from google import genai
from pydantic import BaseModel

from database.supabase import supabase_admin
from routers.lectures import get_lecture_transcript, get_lecture_knowledge_points

router = APIRouter()

gemini_client = genai.Client()


# =====================================================================
# 🤖 AI 助教對話
# =====================================================================

class ChatRequest(BaseModel):
    lecture_id: int
    question: str
    video_timestamp: int = 0      # 學生提問時的影片秒數
    chat_history: list[dict] = [] # 前端傳來的對話歷史 [{"role": "user/assistant", "text": "..."}]

@router.post("/ai/chat")
def ai_chat(body: ChatRequest):
    try:
        # 撈逐字稿
        transcript_raw = get_lecture_transcript(body.lecture_id)
        if not transcript_raw:
            raise HTTPException(status_code=400, detail="找不到此小節的逐字稿")

        # 撈知識點
        knowledge_points_raw = get_lecture_knowledge_points(body.lecture_id)

        # 把逐字稿轉成純文字
        transcript_text = "\n".join(
            [seg.get("text", "") for seg in transcript_raw if isinstance(seg, dict)]
        ) if isinstance(transcript_raw[0], dict) else str(transcript_raw)

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
        transcript_context = "\n".join(context_segments) if context_segments else transcript_text[:500]

        # 格式化知識點
        kp_text = "\n".join(
            [f"- {kp.get('title', '')}: {kp.get('description', '')}" for kp in knowledge_points_raw]
        ) if knowledge_points_raw else "（本節無知識點資料）"

        # 格式化影片時間
        minutes = timestamp // 60
        seconds = timestamp % 60
        timestamp_str = f"{minutes}:{seconds:02d}"

        # 格式化對話歷史
        history_text = ""
        for msg in body.chat_history[-6:]:  # 只取最近 6 則，避免 prompt 太長
            role = "學生" if msg.get("role") == "user" else "助教"
            history_text += f"{role}：{msg.get('text', '')}\n"

        # Prompt
        prompt = f"""
你是一位親切、有耐心的專業課程 AI 助教。
請使用繁體中文，語氣要像資工系的學長姐或助教一樣，說話自然不要太正式。
回答字數控制在 100~200 字內。
回答時可以適時舉例或用比喻幫助理解。

【規則】
1. 只能根據課程逐字稿和知識點內容回答，不可自行編造。
2. 如果課程內容中沒有提到，請說：「這個問題在目前的課程內容中沒有明確提到，建議你查閱其他資料或問老師喔！」
3. 如果學生問了非課程相關的問題（例如天氣、娛樂八卦、情感問題），請禮貌拒絕並引導回課程，例如：「這個我幫不上忙，不過如果你有課程相關的問題，我很樂意幫你解答！」
4. 如果學生說「不懂」或「再解釋一次」，請換個方式或用更簡單的比喻重新說明。

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

# 生成摘要
@router.get("/lectures/{lecture_id}/test-summary")
def test_generate_summary(lecture_id: int):
    try:
        transcript = get_lecture_transcript(lecture_id)
        if not transcript:
            raise HTTPException(status_code=400, detail="Transcript not found for this lecture.")

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

        return {"status": "success", "lecture_id": lecture_id, "data": result_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"test fail: {str(e)}")


# 生成心智圖
@router.get("/lectures/{lecture_id}/test-mindmap")
def test_generate_mindmap(lecture_id: int):
    try:
        transcript = get_lecture_transcript(lecture_id)
        if not transcript:
            raise HTTPException(status_code=400, detail="Transcript not found for this lecture.")

        prompt = f"""
            請根據以下課程逐字稿，產生最多 3 層的課程心智圖。
            JSON格式：
            {{ "mind_map": {{ "title": "主題名稱", "description": "整體說明", "start_time": null, "end_time": null, "children": [ {{ "title": "概念一", "description": "概念說明", "start_time": null, "end_time": null, "children": [] }} ] }} }}
            所有節點都必須包含：title、description、start_time、end_time、children。
            沒有子節點時 children 填 []。使用繁體中文。沒有時間資訊請填 null。
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

        return {"status": "success", "lecture_id": lecture_id, "data": result_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"test fail: {str(e)}")


# 生成知識點
@router.get("/lectures/{lecture_id}/test-knowledge_points")
def test_generate_knowledge_points(lecture_id: int):
    try:
        transcript = get_lecture_transcript(lecture_id)
        if not transcript:
            raise HTTPException(status_code=400, detail="Transcript not found for this lecture.")

        prompt = f"""
            請根據以下課程逐字稿，產生 5 到 8 個適合學生複習用的知識點。
            JSON格式：
            {{ "knowledge_points": [ {{ "title": "知識點標題", "description": "知識點說明", "start_time": null, "end_time": null }} ] }}
            使用繁體中文。如果沒有時間資訊請填 null。
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

        return {"status": "success", "lecture_id": lecture_id, "data": result_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"test fail: {str(e)}")


# 生成題目
@router.get("/lectures/{lecture_id}/test-questions")
def test_generate_questions(lecture_id: int):
    try:
        transcript = get_lecture_transcript(lecture_id)
        knowledge_points = get_lecture_knowledge_points(lecture_id)
        if not transcript:
            raise HTTPException(status_code=400, detail="Transcript not found for this lecture.")

        prompt = f"""
            請根據以下課程逐字稿和知識點列表，產生 5 到 10 題選擇題。
            JSON格式：
            {{"questions": [{{"question_text": "題目文字", "options": ["A. ...", "B. ...", "C. ...", "D. ..."], "answer": "A", "explanation": "簡單清楚的解釋", "related_knowledge_point": "必須完全使用提供的知識點標題"}}]}}
            使用繁體中文。每題固定 4 個選項，且 answer 只能是 A、B、C 或 D。
            related_knowledge_point 必須嚴格等於「知識點列表」中的名稱，禁止自行修改或自創。
            課程逐字稿：{transcript}
            知識點列表：{knowledge_points}
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

        return {"status": "success", "lecture_id": lecture_id, "data": result_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"test fail: {str(e)}")