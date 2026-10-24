import json
import logging
import os
from uuid import uuid4
from typing import Any

from google import genai
from google.genai import errors, types

from database.supabase import supabase_admin
from services.lecture_processing import claim_generation, set_generation_status
from services.time_values import normalize_time_range, time_to_seconds


logger = logging.getLogger(__name__)

AI_REQUEST_TIMEOUT_MS = int(os.getenv("AI_REQUEST_TIMEOUT_MS", "120000"))
gemini_client = genai.Client(
    http_options=types.HttpOptions(timeout=AI_REQUEST_TIMEOUT_MS)
)
CONTENT_GENERATION_MODEL = os.getenv(
    "GEMINI_CONTENT_MODEL", "gemini-3.8-flash"
)
CONTENT_FALLBACK_MODEL = os.getenv(
    "GEMINI_CONTENT_FALLBACK_MODEL", "gemini-2.5-flash"
)


def generate_json_content(prompt: str):
    models = list(dict.fromkeys([CONTENT_GENERATION_MODEL, CONTENT_FALLBACK_MODEL]))
    last_error: Exception | None = None
    for index, model in enumerate(models):
        try:
            return gemini_client.models.generate_content(
                model=model,
                contents=prompt,
                config={"response_mime_type": "application/json"},
            )
        except (errors.ClientError, errors.ServerError) as exc:
            last_error = exc
            if index + 1 >= len(models):
                raise
    raise RuntimeError("AI content generation failed") from last_error


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
    query = supabase_admin.table(table_name).select("*").eq("lecture_id", lecture_id)
    if table_name in {"knowledge_points", "questions"}:
        query = query.eq("is_active", True)
    response = query.execute()
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

    ai_response = generate_json_content(prompt)
    result_json = parse_json_response(ai_response.text)

    response = (
        supabase_admin.table("summaries")
        .upsert(
            {"lecture_id": lecture_id, "summary_text": as_json_text(result_json)},
            on_conflict="lecture_id",
        )
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

    ai_response = generate_json_content(prompt)
    result_json = parse_json_response(ai_response.text)
    knowledge_points = result_json.get("knowledge_points", [])

    rows = []
    for kp in knowledge_points:
        if not kp.get("title") or not kp.get("description"):
            continue
        start_time, end_time = normalize_time_range(
            kp.get("start_time"), kp.get("end_time")
        )
        rows.append(
            {
                "lecture_id": lecture_id,
                "title": kp.get("title"),
                "description": kp.get("description"),
                "start_time": start_time,
                "end_time": end_time,
            }
        )

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

    ai_response = generate_json_content(prompt)
    result_json = parse_json_response(ai_response.text)

    response = (
        supabase_admin.table("mindmaps")
        .upsert(
            {
                "lecture_id": lecture_id,
                "title": get_lecture_title(lecture_id),
                "mindmap_json": result_json,
            },
            on_conflict="lecture_id",
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


def normalize_source_timestamp(value: Any) -> int | None:
    if value in (None, "", "null"):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def normalize_answer(value: Any) -> str:
    text = str(value or "").strip().upper()
    return text[0] if text else ""


def infer_knowledge_point_id(
    source_timestamp: Any, knowledge_points: list[dict[str, Any]]
) -> int | None:
    timestamp = normalize_source_timestamp(source_timestamp)
    if timestamp is None:
        return None
    for kp in knowledge_points:
        start = time_to_seconds(kp.get("start_time"))
        end = time_to_seconds(kp.get("end_time"))
        if start is None:
            continue
        if end is None:
            end = start
        if start <= timestamp <= end:
            return normalize_knowledge_point_id(kp.get("id"))
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
請根據以下課程逐字稿和知識點列表，產生 5 到 10 題正式選擇題。
每題固定 4 個選項，answer 只能是 A、B、C 或 D。
related_knowledge_point 請使用知識點列表中的 id；如果無法對應請填 null。
每一題正式題目都必須對應影片中的一個出題時間點。
source_timestamp 必須是純整數秒數，代表影片播放到該秒數時要跳出題目。
請根據逐字稿段落時間與知識點內容推估 source_timestamp，不可以填 null。

每一題正式題目都必須另外產生 1 到 2 題 retry_questions。
retry_questions 是補測延伸題，只用於複習模式重新測驗，不會在影片播放時跳出。
retry_questions 必須測試相同知識概念，但不能只是把原題改幾個字。
retry_questions 可以使用不同情境、應用方式或例子，難度需與原題接近。
retry_questions 不需要 source_timestamp，也不可以直接透露原題答案。
每一題正式題目與 retry_questions 都必須有明確答案與 explanation。
請只輸出 JSON，且 JSON 格式必須穩定。

JSON 格式：
{{"questions":[{{"question_text":"題目文字內容","options":["A. 選項A內容","B. 選項B內容","C. 選項C內容","D. 選項D內容"],"answer":"A","explanation":"解析","related_knowledge_point":null,"source_timestamp":125,"retry_questions":[{{"question_text":"延伸題文字內容","options":["A. 選項A內容","B. 選項B內容","C. 選項C內容","D. 選項D內容"],"answer":"B","explanation":"延伸題解析"}}]}}]}}

課程逐字稿：
{transcript_text}

知識點列表：
{kp_text}
"""

    ai_response = generate_json_content(prompt)
    result_json = parse_json_response(ai_response.text)
    questions = result_json.get("questions", [])

    source_questions = [
        q
        for q in questions
        if q.get("question_text") and q.get("options") and q.get("answer")
    ]
    generation_batch_id = str(uuid4())
    rows = []
    for q in source_questions:
        source_timestamp = normalize_source_timestamp(q.get("source_timestamp"))
        rows.append(
            {
                "lecture_id": lecture_id,
                "knowledge_point_id": normalize_knowledge_point_id(
                    q.get("related_knowledge_point")
                )
                or infer_knowledge_point_id(source_timestamp, knowledge_points),
                "question_text": q.get("question_text"),
                "options_json": q.get("options"),
                "answer": normalize_answer(q.get("answer")),
                "explanation": q.get("explanation"),
                "source_timestamp": source_timestamp,
                "question_type": "original",
                "source_question_id": None,
                "review_status": "pending",
                "source_type": "ai",
                "generation_batch_id": generation_batch_id,
            }
        )

    inserted = []
    extension_status: dict[str, Any] = {"status": "skipped", "inserted": []}
    if rows:
        response = supabase_admin.table("questions").insert(rows).execute()
        inserted = response.data or []

    if inserted:
        extension_rows = []
        for original, original_row in zip(source_questions, inserted):
            source_question_id = original_row.get("id")
            if not source_question_id:
                continue
            retry_questions = original.get("retry_questions") or []
            for retry in retry_questions:
                if not (
                    retry.get("question_text")
                    and retry.get("options")
                    and retry.get("answer")
                ):
                    continue
                extension_rows.append(
                    {
                        "lecture_id": lecture_id,
                        "knowledge_point_id": original_row.get("knowledge_point_id"),
                        "question_text": retry.get("question_text"),
                        "options_json": retry.get("options"),
                        "answer": normalize_answer(retry.get("answer")),
                        "explanation": retry.get("explanation"),
                        "source_timestamp": None,
                        "question_type": "extension",
                        "source_question_id": source_question_id,
                        "review_status": "pending",
                        "source_type": "ai",
                        "generation_batch_id": generation_batch_id,
                    }
                )
        if extension_rows:
            try:
                extension_response = (
                    supabase_admin.table("questions").insert(extension_rows).execute()
                )
                extension_status = {
                    "status": "success",
                    "inserted": extension_response.data or [],
                }
            except Exception as exc:
                extension_status = {
                    "status": "failed",
                    "error": str(exc),
                    "inserted": [],
                }

    return {
        "status": "success",
        "data": {"questions": questions},
        "inserted": inserted,
        "extensions": extension_status,
        "generation_batch_id": generation_batch_id,
    }


def run_ai_generation_pipeline(
    lecture_id: int, segments: list[dict[str, Any]], skip_existing: bool = True
) -> dict[str, Any]:
    transcript_text = format_transcript_for_prompt(segments)
    if not transcript_text:
        raise RuntimeError("Transcript is empty; cannot run AI generation pipeline")

    steps: dict[str, Any] = {}

    def run_step(component: str, callback):
        if not claim_generation(lecture_id, component):
            return {"status": "failed", "error": "此項目目前正在處理中"}
        try:
            result = callback()
            set_generation_status(lecture_id, component, "completed")
            return result
        except Exception as exc:
            logger.exception(
                "AI generation failed for lecture_id=%s component=%s",
                lecture_id,
                component,
            )
            set_generation_status(lecture_id, component, "failed", error=str(exc))
            return {"status": "failed", "error": str(exc)}

    steps["summary"] = run_step(
        "summary",
        lambda: generate_summary(
            lecture_id, transcript_text, skip_existing=skip_existing
        ),
    )

    steps["knowledge_points"] = run_step(
        "knowledge_points",
        lambda: generate_knowledge_points(
            lecture_id, transcript_text, skip_existing=skip_existing
        ),
    )

    knowledge_points = steps["knowledge_points"].get("inserted") or existing_rows(
        "knowledge_points", lecture_id
    )

    steps["mindmap"] = run_step(
        "mindmap",
        lambda: generate_mindmap(
            lecture_id, transcript_text, skip_existing=skip_existing
        ),
    )

    steps["questions"] = run_step(
        "questions",
        lambda: generate_questions(
            lecture_id,
            transcript_text,
            knowledge_points,
            skip_existing=skip_existing,
        ),
    )

    return steps
