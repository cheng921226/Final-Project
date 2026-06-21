import json
from typing import Any

from google import genai

from database.supabase import supabase_admin


gemini_client = genai.Client()


def format_transcript_for_prompt(segments: list[dict[str, Any]]) -> str:
    lines = []
    for segment in segments:
        text = str(segment.get("text", "")).strip()
        if not text:
            continue

        start = segment.get("start_time")
        end = segment.get("end_time")
        if start is None or end is None:
            lines.append(text)
        else:
            lines.append(f"[{start} - {end}] {text}")

    return "\n".join(lines)


def parse_json_response(text: str) -> dict[str, Any]:
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("AI response is not valid JSON") from exc


def as_json_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def format_time_value(value: Any) -> str | None:
    if value in (None, "", "null"):
        return None

    if isinstance(value, str):
        return value

    try:
        total_seconds = int(float(value))
    except (TypeError, ValueError):
        return str(value)

    minutes, seconds = divmod(total_seconds, 60)
    return f"{minutes}:{seconds:02d}"


def get_lecture_title(lecture_id: int) -> str:
    response = (
        supabase_admin.table("lectures")
        .select("title")
        .eq("id", lecture_id)
        .maybe_single()
        .execute()
    )
    if response.data and response.data.get("title"):
        return response.data["title"]
    return f"Lecture {lecture_id}"


def existing_rows(table_name: str, lecture_id: int) -> list[dict[str, Any]]:
    response = (
        supabase_admin.table(table_name)
        .select("*")
        .eq("lecture_id", lecture_id)
        .execute()
    )
    return response.data or []


def generate_summary(
    lecture_id: int, transcript_text: str, skip_existing: bool = True
) -> dict[str, Any]:
    existing = existing_rows("summaries", lecture_id)
    if skip_existing and existing:
        return {"status": "cached", "data": existing[0]}

    prompt = f"""
請根據以下課程逐字稿，產生 150 字內的繁體中文課程摘要。
請只輸出 JSON。

JSON 格式：
{{"summary":"摘要內容"}}

課程逐字稿：
{transcript_text}
"""

    ai_response = gemini_client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config={"response_mime_type": "application/json"},
    )
    result_json = parse_json_response(ai_response.text)

    response = (
        supabase_admin.table("summaries")
        .insert({"lecture_id": lecture_id, "summary_text": as_json_text(result_json)})
        .execute()
    )
    return {"status": "success", "data": result_json, "inserted": response.data or []}


def generate_knowledge_points(
    lecture_id: int, transcript_text: str, skip_existing: bool = True
) -> dict[str, Any]:
    existing = existing_rows("knowledge_points", lecture_id)
    if skip_existing and existing:
        return {"status": "cached", "data": existing}

    prompt = f"""
請根據以下課程逐字稿，產生 5 到 8 個適合學生複習用的知識點。
請依照逐字稿中的時間段推估每個知識點的 start_time / end_time。
start_time / end_time 請輸出秒數，可以是整數或小數；如果無法判斷請填 null。
請只輸出 JSON。

JSON 格式：
{{"knowledge_points":[{{"title":"知識點標題","description":"知識點說明","start_time":0,"end_time":30}}]}}

課程逐字稿：
{transcript_text}
"""

    ai_response = gemini_client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config={"response_mime_type": "application/json"},
    )
    result_json = parse_json_response(ai_response.text)
    knowledge_points = result_json.get("knowledge_points", [])

    rows = [
        {
            "lecture_id": lecture_id,
            "title": kp.get("title"),
            "description": kp.get("description"),
            "start_time": format_time_value(kp.get("start_time")),
            "end_time": format_time_value(kp.get("end_time")),
        }
        for kp in knowledge_points
        if kp.get("title") and kp.get("description")
    ]

    inserted = []
    if rows:
        response = supabase_admin.table("knowledge_points").insert(rows).execute()
        inserted = response.data or []

    return {
        "status": "success",
        "data": {"knowledge_points": knowledge_points},
        "inserted": inserted,
    }


def generate_mindmap(
    lecture_id: int, transcript_text: str, skip_existing: bool = True
) -> dict[str, Any]:
    existing = existing_rows("mindmaps", lecture_id)
    if skip_existing and existing:
        return {"status": "cached", "data": existing[0]}

    prompt = f"""
請根據以下課程逐字稿，產生最多 3 層的課程心智圖。
心智圖只需要呈現知識架構，不需要影片時間點。
請只輸出 JSON。

JSON 格式：
{{"mind_map":{{"title":"主題名稱","description":"整體說明","children":[{{"title":"概念一","description":"概念說明","children":[]}}]}}}}

規則：
1. 所有節點都必須包含 title、description、children。
2. 沒有子節點時 children 填 []。
3. 使用繁體中文。

課程逐字稿：
{transcript_text}
"""

    ai_response = gemini_client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config={"response_mime_type": "application/json"},
    )
    result_json = parse_json_response(ai_response.text)

    response = (
        supabase_admin.table("mindmaps")
        .insert(
            {
                "lecture_id": lecture_id,
                "title": get_lecture_title(lecture_id),
                "mindmap_json": result_json,
            }
        )
        .execute()
    )
    return {"status": "success", "data": result_json, "inserted": response.data or []}


def format_knowledge_points_for_prompt(knowledge_points: list[dict[str, Any]]) -> str:
    if not knowledge_points:
        return "（目前沒有知識點資料）"

    lines = []
    for kp in knowledge_points:
        kp_id = kp.get("id")
        title = kp.get("title", "")
        description = kp.get("description", "")
        lines.append(f"id={kp_id}: {title} - {description}")
    return "\n".join(lines)


def normalize_knowledge_point_id(value: Any) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def generate_questions(
    lecture_id: int,
    transcript_text: str,
    knowledge_points: list[dict[str, Any]],
    skip_existing: bool = True,
) -> dict[str, Any]:
    existing = existing_rows("questions", lecture_id)
    if skip_existing and existing:
        return {"status": "cached", "data": existing}

    kp_text = format_knowledge_points_for_prompt(knowledge_points)
    prompt = f"""
請根據以下課程逐字稿和知識點列表，產生 5 到 10 題選擇題。
每題固定 4 個選項，answer 只能是 A、B、C 或 D。
related_knowledge_point 請使用知識點列表中的 id；如果無法對應請填 null。
請只輸出 JSON。

JSON 格式：
{{"questions":[{{"question_text":"題目文字內容","options":["A. 選項A內容","B. 選項B內容","C. 選項C內容","D. 選項D內容"],"answer":"A","explanation":"解析","related_knowledge_point":null}}]}}

課程逐字稿：
{transcript_text}

知識點列表：
{kp_text}
"""

    ai_response = gemini_client.models.generate_content(
        model="gemini-2.5-flash",
        contents=prompt,
        config={"response_mime_type": "application/json"},
    )
    result_json = parse_json_response(ai_response.text)
    questions = result_json.get("questions", [])

    rows = [
        {
            "lecture_id": lecture_id,
            "knowledge_point_id": normalize_knowledge_point_id(
                q.get("related_knowledge_point")
            ),
            "question_text": q.get("question_text"),
            "options_json": q.get("options"),
            "answer": q.get("answer"),
            "explanation": q.get("explanation"),
        }
        for q in questions
        if q.get("question_text") and q.get("options") and q.get("answer")
    ]

    inserted = []
    if rows:
        response = supabase_admin.table("questions").insert(rows).execute()
        inserted = response.data or []

    return {"status": "success", "data": {"questions": questions}, "inserted": inserted}


def run_ai_generation_pipeline(
    lecture_id: int, segments: list[dict[str, Any]], skip_existing: bool = True
) -> dict[str, Any]:
    transcript_text = format_transcript_for_prompt(segments)
    if not transcript_text:
        raise RuntimeError("Transcript is empty; cannot run AI generation pipeline")

    steps: dict[str, Any] = {}

    try:
        steps["summary"] = generate_summary(
            lecture_id, transcript_text, skip_existing=skip_existing
        )
    except Exception as exc:
        steps["summary"] = {"status": "failed", "error": str(exc)}

    try:
        steps["knowledge_points"] = generate_knowledge_points(
            lecture_id, transcript_text, skip_existing=skip_existing
        )
    except Exception as exc:
        steps["knowledge_points"] = {"status": "failed", "error": str(exc)}

    knowledge_points = steps["knowledge_points"].get("inserted") or existing_rows(
        "knowledge_points", lecture_id
    )

    try:
        steps["mindmap"] = generate_mindmap(
            lecture_id, transcript_text, skip_existing=skip_existing
        )
    except Exception as exc:
        steps["mindmap"] = {"status": "failed", "error": str(exc)}

    try:
        steps["questions"] = generate_questions(
            lecture_id,
            transcript_text,
            knowledge_points,
            skip_existing=skip_existing,
        )
    except Exception as exc:
        steps["questions"] = {"status": "failed", "error": str(exc)}

    return steps
