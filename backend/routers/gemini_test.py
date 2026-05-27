import json

from fastapi import APIRouter, HTTPException, Query
from google import genai

from database.supabase import supabase_admin
from routers.chat import get_chat_history
from routers.lectures import get_lecture_transcript, get_lecture_knowledge_points

from routers.security import get_current_user
from fastapi import Depends


router = APIRouter()

gemini_client = genai.Client()


# 生成摘要
@router.get("/lectures/{lecture_id}/test-summary")
def test_generate_summary(lecture_id: int):
    try:
        transcript = get_lecture_transcript(lecture_id)

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

        return {"status": "success", "lecture_id": lecture_id, "data": result_json}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"test fail: {str(e)}")


# 生成心智圖
@router.get("/lectures/{lecture_id}/test-mindmap")
def test_generate_mindmap(lecture_id: int):
    try:
        transcript = get_lecture_transcript(lecture_id)

        if not transcript:
            raise HTTPException(
                status_code=400, detail="Transcript not found for this lecture."
            )

        prompt = f"""
            請根據以下課程逐字稿，產生最多 3 層的課程心智圖。

            JSON格式：
            {{ 
                "mind_map": 
                {{ 
                    "title": "主題名稱", 
                    "description": "整體說明", 
                    "start_time": null, 
                    "end_time": null, 
                    "children": [ 
                        {{ 
                            "title": "概念一", 
                            "description": "概念說明", 
                            "start_time": null, 
                            "end_time": null, 
                            "children": [] 
                        }} 
                    ] 
                }} 
            }}

            所有節點都必須包含： title、description、start_time、end_time、children 。
            沒有子節點時 children 填 []。
            使用繁體中文。
            沒有時間資訊請填 null。

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


# ai 對話 (未完成)
@router.get("/lectures/{lecture_id}/test-chat")
def test_chat(
    lecture_id: int, question: str = Query(...), user=Depends(get_current_user)
):
    try:
        transcript = get_lecture_transcript(lecture_id)

        if not transcript:
            raise HTTPException(
                status_code=400, detail="Transcript not found for this lecture."
            )

        history_raw = get_chat_history(lecture_id, user.id)

        history_text = ""
        for h in history_raw:
            history_text += f"學生：{h['question']}\n助教：{h['answer']}\n"

        prompt = f"""
            你是一位課程 AI 助教。

            規則：
            只能根據課程逐字稿回答
            不可編造
            若沒有提到，回答：「這部分在目前課程內容中沒有明確提到。」
            用繁體中文，100~200字

            JSON格式：
            {{ "answer": "AI 助教回答內容" }}

            課程逐字稿：
            {transcript}

            先前對話：
            {history_raw}

            學生問題：
            {question}
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
            raise HTTPException(
                status_code=400, detail="Transcript not found for this lecture."
            )

        prompt = f"""
            請根據以下課程逐字稿，產生 5 到 8 個適合學生複習用的知識點。

            JSON格式：
            {{ 
                "knowledge_points": [ 
                    {{ 
                        "title": "知識點標題", 
                        "description": "知識點說明", 
                        "start_time": null, 
                        "end_time": null 
                    }} 
                ] 
            }}

            使用繁體中文。
            如果沒有時間資訊請填 null。

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
            raise HTTPException(
                status_code=400, detail="Transcript not found for this lecture."
            )

        prompt = f"""
            請根據以下課程逐字稿和知識點列表，產生 5 到 10 題選擇題。

            JSON格式：
            {{
                "questions": [
                    {{
                        "question_text": "題目文字",
                        "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
                        "answer": "A",
                        "explanation": "簡單清楚的解釋",
                        "related_knowledge_point": "必須完全使用提供的知識點標題"
                    }}
                ]
            }}

            使用繁體中文。
            每題固定 4 個選項，且 answer 只能是 A、B、C 或 D。
            related_knowledge_point 必須嚴格等於「知識點列表」中的名稱，禁止自行修改或自創。

            課程逐字稿：
            {transcript}

            知識點列表：
            {knowledge_points}
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
