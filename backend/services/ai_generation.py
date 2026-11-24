import json
import logging
import os
from collections.abc import Collection
from uuid import uuid4
from typing import Any

from google import genai
from google.genai import errors, types

from database.supabase import supabase_admin
from services.lecture_processing import claim_generation, generation_heartbeat, set_generation_status
from services.time_values import normalize_seconds, time_to_seconds


logger = logging.getLogger(__name__)

AI_QUESTION_DELAY_SECONDS = 5
QUESTION_KNOWLEDGE_POINTS_PER_REQUEST = 8
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
依影片出現順序排列，只輸出 JSON。
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
        start, end = kp.get("start_time"), kp.get("end_time")
        timing = f"（{start} 至 {end} 秒）" if start is not None and end is not None else ""
        lines.append(f"id={kp_id}{timing}: {title} - {description}")
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


def question_transcript_excerpt(
    segments: list[dict[str, Any]], knowledge_points: list[dict[str, Any]]
) -> str:
    starts = [time_to_seconds(point.get("start_time")) for point in knowledge_points]
    ends = [time_to_seconds(point.get("end_time")) for point in knowledge_points]
    if None in starts or None in ends:
        return ""

    start, end = min(starts), max(ends)
    excerpt = []
    for segment in segments:
        segment_start = time_to_seconds(segment.get("start_time"))
        segment_end = time_to_seconds(segment.get("end_time"))
        if segment_start is None or segment_end is None:
            continue
        if segment_start <= end and segment_end >= start:
            excerpt.append(segment)
    return format_transcript_for_prompt(excerpt)


def generate_question_group(
    transcript_text: str, knowledge_points: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    kp_text = format_knowledge_points_for_prompt(knowledge_points)
    prompt = f'''請依課程逐字稿和知識點產生影片中的課堂練習題。題數依可測驗的核心概念數量決定。
每個知識點至少出 1 道原題；若它容易混淆、需要多步推理，或適合另測應用，再出第 2 題。第二題須測不同能力，不能換句話重考同一件事。
related_knowledge_point 必須填這份知識點列表中的 ID。若逐字稿沒有足夠內容支撐某知識點出題，把該 ID 和具體原因放進 skipped_knowledge_points。每個 ID 都必須有題目或明確列為略過。
如果沒有知識點列表，先從逐字稿辨識教過的核心概念，依同樣規則決定題數，related_knowledge_point 填 null。略過開場、行政說明和重複內容。
每題固定 4 個選項，answer 只能是 A、B、C 或 D，並提供 explanation。
原題的 source_timestamp 以逐字稿推估該題相關內容講解完畢的影片時間，填非負整數秒數。緩衝由系統加上。若確實沒有足夠的時間資訊定位，填 null，該題會在影片播完後出現。不要猜測時間。若同一知識點出兩題，優先放在各自概念講解完成的時間。
每道原題在 retry_questions 中提供 1 題延伸題；若值得再用另一個情境驗證，可提供第 2 題。延伸題測相同概念，但需換例子或情境，省略時間欄位。
題目、選項與解析直接呈現課程知識。只輸出 JSON。
JSON 格式：{{"questions":[{{"question_text":"課堂題","options":["A. 選項","B. 選項","C. 選項","D. 選項"],"answer":"A","explanation":"解析","related_knowledge_point":3,"source_timestamp":125,"retry_questions":[{{"question_text":"延伸題","options":["A. 選項","B. 選項","C. 選項","D. 選項"],"answer":"B","explanation":"延伸題解析"}}]}}],"skipped_knowledge_points":[{{"id":4,"reason":"略過原因"}}]}}

課程逐字稿：
{transcript_text}

知識點列表：
{kp_text}'''

    result = parse_json_response(generate_json_content(prompt).text)
    if not isinstance(result, dict) or not isinstance(result.get("questions"), list):
        raise RuntimeError("AI 回傳的課堂題目格式不正確，請重新生成。")

    point_ids = {normalize_knowledge_point_id(point["id"]) for point in knowledge_points}
    question_counts: dict[int, int] = {}
    questions = []
    for question in result["questions"]:
        if not isinstance(question, dict):
            continue
        options = question.get("options")
        raw_timestamp = question.get("source_timestamp")
        estimate = normalize_source_timestamp(raw_timestamp)
        if (
            not question.get("question_text")
            or not isinstance(options, list)
            or len(options) != 4
            or normalize_answer(question.get("answer")) not in {"A", "B", "C", "D"}
            or (raw_timestamp is not None and (estimate is None or estimate < 0))
        ):
            continue
        point_id = (
            normalize_knowledge_point_id(question.get("related_knowledge_point"))
            or infer_knowledge_point_id(estimate, knowledge_points)
        )
        if point_ids and (point_id not in point_ids or question_counts.get(point_id, 0) >= 2):
            continue
        if point_id is not None:
            question_counts[point_id] = question_counts.get(point_id, 0) + 1
        retries = question.get("retry_questions")
        questions.append({
            **question,
            "related_knowledge_point": point_id if point_ids else None,
            "source_timestamp": estimate,
            "retry_questions": [retry for retry in retries if isinstance(retry, dict)]
            if isinstance(retries, list) else [],
        })

    skipped = {}
    reported_skips = result.get("skipped_knowledge_points")
    if isinstance(reported_skips, list):
        for item in reported_skips:
            if not isinstance(item, dict):
                continue
            point_id = normalize_knowledge_point_id(item.get("id"))
            reason = item.get("reason")
            if point_id in point_ids and point_id not in question_counts and isinstance(reason, str) and reason.strip():
                skipped[point_id] = {"id": point_id, "reason": reason.strip()}
    missing = point_ids.difference(question_counts, skipped)
    if missing:
        missing_ids = "、".join(str(point_id) for point_id in sorted(missing))
        raise RuntimeError(f"AI 未處理以下知識點：{missing_ids}。請重新生成。")
    return questions, list(skipped.values())


def generate_questions(
    lecture_id: int,
    transcript_text: str,
    knowledge_points: list[dict[str, Any]],
    skip_existing: bool = True,
    *,
    segments: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if skip_existing:
        existing = existing_rows("questions", lecture_id)
        if any(row.get("question_type", "original") == "original" for row in existing):
            return {"status": "cached", "data": existing}

    points_by_id = {
        point_id: point
        for point in knowledge_points
        if (point_id := normalize_knowledge_point_id(point.get("id"))) is not None
    }
    ordered_points = sorted(
        points_by_id.values(),
        key=lambda point: time_to_seconds(point.get("start_time")) or 0,
    )
    group_size = QUESTION_KNOWLEDGE_POINTS_PER_REQUEST
    groups = [
        ordered_points[index:index + group_size]
        for index in range(0, len(ordered_points), group_size)
    ] or [[]]
    source_questions = []
    skipped_points = []
    for group in groups:
        material = transcript_text
        if len(groups) > 1 and segments:
            material = question_transcript_excerpt(segments, group) or transcript_text
        questions, skipped = generate_question_group(material, group)
        source_questions.extend(questions)
        skipped_points.extend(skipped)
    if not source_questions:
        raise RuntimeError("AI 沒有產生可用的課堂題目，請確認逐字稿內容後重試。")
    questions = source_questions
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
                "knowledge_point_id": q["related_knowledge_point"],
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
            for retry in retry_questions[:2]:
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
        "data": {"questions": questions, "skipped_knowledge_points": skipped_points},
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
        with generation_heartbeat(lecture_id, component) as started_at:
            try:
                result = callback()
                set_generation_status(lecture_id, component, "completed", expected_started_at=started_at)
                return result
            except Exception as exc:
                logger.exception(
                    "AI generation failed for lecture_id=%s component=%s",
                    lecture_id,
                    component,
                )
                set_generation_status(lecture_id, component, "failed", error=str(exc), expected_started_at=started_at)
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
                segments=segments,
            ),
        )

    return steps
