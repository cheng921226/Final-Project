import json
import logging
import os
from collections.abc import Collection
from uuid import uuid4
from typing import Any

from google import genai
from google.genai import errors, types

from database.supabase import supabase_admin
from services.lecture_processing import claim_generation, set_generation_status
from services.time_values import normalize_seconds, time_to_seconds


logger = logging.getLogger(__name__)

AI_QUESTION_DELAY_SECONDS = 5
AI_REQUEST_TIMEOUT_MS = int(os.getenv("AI_REQUEST_TIMEOUT_MS", "120000"))
gemini_client = genai.Client(
    http_options=types.HttpOptions(timeout=AI_REQUEST_TIMEOUT_MS)
)
DEFAULT_CONTENT_GENERATION_MODELS = (
    "gemini-3.8-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-3.5-flash-lite",
)

CONTENT_SYSTEM_INSTRUCTION = "你是課程內容助理。請根據使用者提供的課程資料完成任務，使用繁體中文；只輸出符合要求格式的內容，不要加入未要求的說明或 Markdown。"


def get_content_generation_models() -> tuple[str, ...]:
    configured_models = os.getenv("GEMINI_CONTENT_MODELS", "")
    if configured_models.strip():
        models = [model.strip() for model in configured_models.split(",")]
    else:
        # Keep the former single-model variables working for existing deployments.
        primary_model = os.getenv("GEMINI_CONTENT_MODEL", "").strip()
        fallback_model = os.getenv("GEMINI_CONTENT_FALLBACK_MODEL", "").strip()
        models = [model for model in (primary_model, fallback_model) if model]
        models.extend(DEFAULT_CONTENT_GENERATION_MODELS)

    return tuple(dict.fromkeys(model for model in models if model))


def generate_json_content(prompt: str):
    models = get_content_generation_models()
    last_error: Exception | None = None
    for index, model in enumerate(models):
        try:
            return gemini_client.models.generate_content(
                model=model,
                contents=prompt,
                config={
                    "response_mime_type": "application/json",
                    "system_instruction": CONTENT_SYSTEM_INSTRUCTION,
                },
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
    if table_name == "knowledge_points":
        query = query.eq("is_active", True)
    elif table_name == "questions":
        query = query.neq("status", "deleted")
    response = query.execute()
    return response.data or []


def generate_summary(
    lecture_id: int, transcript_text: str, skip_existing: bool = True
) -> dict[str, Any]:
    existing = existing_rows("summaries", lecture_id)
    if skip_existing and existing:
        return {"status": "cached", "data": existing[0]}

    prompt = f'''請根據以下課程逐字稿，產生 150 字內的課程摘要。
JSON 格式：{{"summary":"摘要內容"}}

課程逐字稿：
{transcript_text}'''

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
    lecture_id: int, segments: list[dict[str, Any]], skip_existing: bool = True
) -> dict[str, Any]:
    existing = existing_rows("knowledge_points", lecture_id)
    if skip_existing and existing:
        return {"status": "cached", "data": existing}

    lecture = (
        supabase_admin.table("lectures")
        .select("duration_seconds")
        .eq("id", lecture_id)
        .maybe_single()
        .execute()
    )
    duration = (lecture.data or {}).get("duration_seconds")
    timed_segments = []
    for segment in segments:
        text = str(segment.get("text") or "").strip()
        start = normalize_seconds(segment.get("start_time"))
        end = normalize_seconds(segment.get("end_time"))
        if not text or start is None or end is None or end <= start:
            continue
        if duration and end > duration:
            continue
        timed_segments.append({"start_time": start, "end_time": end, "text": text})

    if not timed_segments:
        raise ValueError("逐字稿沒有可定位的時間區間，請先補上逐字稿時間，再生成知識點。")

    timed_segments.sort(key=lambda segment: segment["start_time"])
    transcript_text = format_transcript_for_prompt(timed_segments)
    prompt = f'''請根據有時間標記的課程逐字稿，整理適合學生複習的核心知識點。
先辨識主題轉換，再找出學生看完後應該能獨立解釋、區分或應用的概念。依核心概念數量決定知識點數量。
每個知識點聚焦一項概念、方法、判斷原則或常見錯誤。需要不同解釋或應用步驟的概念應分開；同一概念的不同例子與重複說明應合併。
涵蓋影片前、中、後各個有教學內容的主題，略過開場、過場、行政說明和重複總結。
title 使用具體的概念名稱。description 用一到兩句說明重點，必要時補上適用條件或容易混淆的地方。
每個知識點都必須對應一段可定位的講解。start_time 必須照抄第一個相關逐字稿片段的開始秒數，end_time 必須照抄最後一個相關片段的結束秒數，兩者都填 JSON 整數且結束須晚於開始。
若同一概念在多處講解，選擇最完整的連續區間。找不到可定位的區間就省略該知識點，不猜測時間或填 null。
依影片出現順序排列，只輸出繁體中文 JSON。
JSON 格式：{{"knowledge_points":[{{"title":"知識點標題","description":"知識點說明","start_time":0,"end_time":30}}]}}

課程逐字稿：
{transcript_text}'''

    ai_response = generate_json_content(prompt)
    result = parse_json_response(ai_response.text)
    candidates = result.get("knowledge_points") if isinstance(result, dict) else None
    if not isinstance(candidates, list):
        raise RuntimeError("AI 回傳的知識點格式不正確，請重新生成。")

    starts = {segment["start_time"] for segment in timed_segments}
    ends = {segment["end_time"] for segment in timed_segments}
    knowledge_points = []
    for point in candidates:
        if not isinstance(point, dict):
            continue
        title = point.get("title")
        description = point.get("description")
        if not isinstance(title, str) or not isinstance(description, str):
            continue
        start, end = point.get("start_time"), point.get("end_time")
        if type(start) is not int or type(end) is not int:
            continue
        if start not in starts or end not in ends or end <= start:
            continue
        if title.strip() and description.strip():
            knowledge_points.append({
                "title": title.strip(),
                "description": description.strip(),
                "start_time": start,
                "end_time": end,
            })

    if not knowledge_points:
        raise RuntimeError("AI 沒有產生可對照逐字稿時間的知識點，請重新生成。")

    knowledge_points.sort(key=lambda point: point["start_time"])
    response = (
        supabase_admin.table("knowledge_points")
        .insert([{"lecture_id": lecture_id, **point} for point in knowledge_points])
        .execute()
    )
    return {
        "status": "success",
        "data": {"knowledge_points": knowledge_points},
        "inserted": response.data or [],
    }


def generate_mindmap(
    lecture_id: int, transcript_text: str, skip_existing: bool = True
) -> dict[str, Any]:
    existing = existing_rows("mindmaps", lecture_id)
    if skip_existing and existing:
        return {"status": "cached", "data": existing[0]}

    prompt = f'''請根據以下課程逐字稿，產生最多 3 層的課程心智圖，只呈現知識架構，不需要影片時間點。
每個節點都必須包含 title、description、children；沒有子節點時 children 填 []。
JSON 格式：{{"mind_map":{{"title":"主題名稱","description":"整體說明","children":[{{"title":"概念一","description":"概念說明","children":[]}}]}}}}

課程逐字稿：
{transcript_text}'''

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
    except (TypeError, ValueError, OverflowError):
        return None


def delayed_question_timestamp(
    estimate: int | None, duration_seconds: int | None
) -> int | None:
    if estimate is None:
        return None

    delayed = max(0, estimate) + AI_QUESTION_DELAY_SECONDS
    if duration_seconds is not None and duration_seconds > 0:
        return min(delayed, duration_seconds - 1)
    return delayed


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
    prompt = f'''請根據以下課程逐字稿和知識點列表，產生 5 到 10 題正式選擇題。
每題固定 4 個選項，answer 只能是 A、B、C 或 D。related_knowledge_point 使用知識點 id，無法對應時填 null。
每題的 source_timestamp 請以逐字稿推估該題相關內容講解完畢的時間，填純整數秒數，不可為 null。緩衝時間由系統加上。
每題另外產生 1 到 2 題 retry_questions，測試相同知識概念，不可只是改寫原題；延伸題不需要 source_timestamp，也不能直接透露原題答案。所有題目都要有答案與 explanation。
題目、選項與解析直接呈現課程知識，不提及逐字稿或描述資訊來源。
JSON 格式：{{"questions":[{{"question_text":"題目文字內容","options":["A. 選項A內容","B. 選項B內容","C. 選項C內容","D. 選項D內容"],"answer":"A","explanation":"解析","related_knowledge_point":null,"source_timestamp":125,"retry_questions":[{{"question_text":"延伸題文字內容","options":["A. 選項A內容","B. 選項B內容","C. 選項C內容","D. 選項D內容"],"answer":"B","explanation":"延伸題解析"}}]}}]}}

課程逐字稿：
{transcript_text}

知識點列表：
{kp_text}'''

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
    duration_seconds = None
    if source_questions:
        lecture = (
            supabase_admin.table("lectures")
            .select("duration_seconds")
            .eq("id", lecture_id)
            .maybe_single()
            .execute()
        )
        duration_seconds = (getattr(lecture, "data", None) or {}).get("duration_seconds")

    for q in source_questions:
        estimate = normalize_source_timestamp(q.get("source_timestamp"))
        source_timestamp = delayed_question_timestamp(estimate, duration_seconds)
        q["source_timestamp"] = source_timestamp
        rows.append(
            {
                "lecture_id": lecture_id,
                "knowledge_point_id": normalize_knowledge_point_id(
                    q.get("related_knowledge_point")
                )
                or infer_knowledge_point_id(estimate, knowledge_points),
                "question_text": q.get("question_text"),
                "options_json": q.get("options"),
                "answer": normalize_answer(q.get("answer")),
                "explanation": q.get("explanation"),
                "source_timestamp": source_timestamp,
                "question_type": "original",
                "source_question_id": None,
                "status": "pending",
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
                        "status": "pending",
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
    lecture_id: int,
    segments: list[dict[str, Any]],
    skip_existing: bool = True,
    components: Collection[str] | None = None,
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

    generators = {
        "summary": generate_summary,
        "knowledge_points": generate_knowledge_points,
        "mindmap": generate_mindmap,
    }
    for component, generate in generators.items():
        if components is None or component in components:
            steps[component] = run_step(
                component,
                lambda: generate(
                    lecture_id,
                    segments if component == "knowledge_points" else transcript_text,
                    skip_existing=skip_existing,
                ),
            )

    if components is None or "questions" in components:
        knowledge_points = steps.get("knowledge_points", {}).get("inserted") or existing_rows(
            "knowledge_points", lecture_id
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
