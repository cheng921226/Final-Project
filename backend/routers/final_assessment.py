import random
from datetime import datetime, timedelta, timezone
from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from roles import CAMPUS_ROLE, can_manage_course, has_teacher_access
from services.ai_generation import gemini_client, normalize_answer, parse_json_response

from .security import get_current_user

router = APIRouter()


class FinalAssessmentAnswer(BaseModel):
    question_id: int
    selected_answer: str


class FinalAssessmentSubmit(BaseModel):
    answers: list[FinalAssessmentAnswer]


class FinalAssessmentGenerateRequest(BaseModel):
    question_count: int | None = Field(default=None, ge=1, le=50)


def number(value: Any, default: float = 0) -> float:
    try:
        if value in (None, "", "null"):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def parse_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def user_profile(user) -> dict[str, Any]:
    response = (
        supabase_admin.table("users")
        .select("*")
        .eq("auth_id", user.id)
        .maybe_single()
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="找不到使用者資料")
    return response.data


def require_student(user) -> dict[str, Any]:
    profile = user_profile(user)
    if profile.get("role") != "student":
        raise HTTPException(status_code=403, detail="只有學生帳號可以進行正式測驗")
    return profile


def require_teacher(user) -> dict[str, Any]:
    profile = user_profile(user)
    if not has_teacher_access(profile.get("role")):
        raise HTTPException(status_code=403, detail="這個帳號沒有教師端權限")
    return profile


def get_course(course_id: int) -> dict[str, Any]:
    response = (
        supabase_admin.table("courses")
        .select("*")
        .eq("id", course_id)
        .maybe_single()
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=404, detail="找不到課程")
    return response.data


def require_enrollment(student_id: int, course_id: int) -> None:
    response = (
        supabase_admin.table("student_courses")
        .select("student_id")
        .eq("student_id", student_id)
        .eq("course_id", course_id)
        .limit(1)
        .execute()
    )
    if not response.data:
        raise HTTPException(status_code=403, detail="你尚未選修這門課程")


def get_course_lectures(course_id: int) -> list[dict[str, Any]]:
    return (
        supabase_admin.table("lectures")
        .select("*")
        .eq("course_id", course_id)
        .order("id")
        .execute()
        .data
        or []
    )


def course_completion(
    student_id: int, course: dict[str, Any], lectures: list[dict[str, Any]]
) -> dict[str, Any]:
    lecture_ids = [row["id"] for row in lectures if row.get("id") is not None]
    progresses = []
    if lecture_ids:
        progresses = (
            supabase_admin.table("video_progresses")
            .select("*")
            .eq("student_id", student_id)
            .in_("lecture_id", lecture_ids)
            .execute()
            .data
            or []
        )
    progress_by_lecture = {row.get("lecture_id"): row for row in progresses}
    completed = sum(
        1 for lecture_id in lecture_ids if progress_by_lecture.get(lecture_id, {}).get("completed")
    )
    total = len(lecture_ids)
    percentage = round(completed / total * 100) if total else 0
    required = number(course.get("completion_threshold"), 100)
    watched_seconds = sum(number(row.get("watched_seconds")) for row in progresses)
    return {
        "lecture_count": total,
        "completed_lectures": completed,
        "completion_percentage": percentage,
        "completion_threshold": required,
        "completion_met": bool(total and percentage >= required),
        "watched_seconds": int(watched_seconds),
        "learning_hours": round(watched_seconds / 3600, 2),
    }


def active_questions(course_id: int) -> list[dict[str, Any]]:
    return (
        supabase_admin.table("final_assessment_questions")
        .select("*")
        .eq("course_id", course_id)
        .eq("is_active", True)
        .order("id")
        .execute()
        .data
        or []
    )


def student_attempts(student_id: int, course_id: int) -> list[dict[str, Any]]:
    return (
        supabase_admin.table("final_assessment_attempts")
        .select("*")
        .eq("student_id", student_id)
        .eq("course_id", course_id)
        .order("attempt_number")
        .execute()
        .data
        or []
    )


def public_questions(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "question_id": row.get("id"),
            "question_text": row.get("question_text"),
            "options_json": row.get("options_json") or [],
        }
        for row in rows
    ]


def questions_for_attempt(attempt: dict[str, Any]) -> list[dict[str, Any]]:
    ids = [int(value) for value in attempt.get("question_ids") or []]
    if not ids:
        return []
    rows = (
        supabase_admin.table("final_assessment_questions")
        .select("id, question_text, options_json")
        .in_("id", ids)
        .execute()
        .data
        or []
    )
    row_map = {row.get("id"): row for row in rows}
    return public_questions([row_map[qid] for qid in ids if qid in row_map])


def get_certificate_row(student_id: int, course_id: int) -> dict[str, Any] | None:
    response = (
        supabase_admin.table("course_certifications")
        .select("*")
        .eq("student_id", student_id)
        .eq("course_id", course_id)
        .limit(1)
        .execute()
    )
    rows = response.data or []
    return rows[0] if rows else None


def get_certificate(student_id: int, course_id: int) -> dict[str, Any] | None:
    certificate = get_certificate_row(student_id, course_id)
    if not certificate or not certificate.get("final_attempt_id"):
        return None
    return certificate


def issue_certificate(
    student: dict[str, Any],
    course: dict[str, Any],
    attempt: dict[str, Any],
    completion: dict[str, Any],
) -> dict[str, Any]:
    existing = get_certificate_row(student["id"], course["id"])
    if existing and existing.get("final_attempt_id"):
        return existing

    row = {
        "student_id": student["id"],
        "course_id": course["id"],
        "final_attempt_id": attempt.get("id"),
        "credits_awarded": number(course.get("credit_value")),
        "status": "earned",
        "learning_hours": completion.get("learning_hours", 0),
        "final_score": attempt.get("score"),
        "student_name": student.get("name") or student.get("email") or "Student",
        "course_name": course.get("title") or course.get("course_name") or f"課程 {course['id']}",
        "show_final_score": bool(course.get("certificate_show_score", True)),
    }
    if existing:
        response = (
            supabase_admin.table("course_certifications")
            .update(row)
            .eq("id", existing["id"])
            .execute()
        )
    else:
        response = supabase_admin.table("course_certifications").insert(row).execute()
    if not response.data:
        raise HTTPException(status_code=500, detail="建立課程認證失敗")
    return response.data[0]


def build_status(student: dict[str, Any], course_id: int) -> dict[str, Any]:
    require_enrollment(student["id"], course_id)
    course = get_course(course_id)
    lectures = get_course_lectures(course_id)
    completion = course_completion(student["id"], course, lectures)
    questions = active_questions(course_id)
    attempts = student_attempts(student["id"], course_id)
    latest = attempts[-1] if attempts else None
    passed_attempt = next((row for row in reversed(attempts) if row.get("passed")), None)
    certificate = get_certificate(student["id"], course_id)
    now = datetime.now(timezone.utc)

    retry_at = parse_datetime(latest.get("retry_available_at")) if latest else None
    retry_seconds = max(0, int((retry_at - now).total_seconds())) if retry_at else 0

    has_credit_settings = number(course.get("credit_value")) > 0
    if passed_attempt:
        state = "passed"
        if (
            completion["completion_met"]
            and course.get("certification_enabled", True)
            and not certificate
        ):
            certificate = issue_certificate(student, course, passed_attempt, completion)
    elif not has_credit_settings:
        state = "unconfigured"
    elif not completion["completion_met"]:
        state = "locked"
    elif not questions:
        state = "not_ready"
    elif latest and latest.get("status") == "in_progress":
        state = "in_progress"
    elif retry_seconds > 0:
        state = "cooldown"
    else:
        state = "ready"

    payload = {
        "course": {
            "id": course.get("id"),
            "title": course.get("title") or course.get("course_name") or f"課程 {course_id}",
        },
        "state": state,
        "completion": completion,
        "settings": {
            "passing_score": number(course.get("passing_score"), 70),
            "retest_cooldown_minutes": int(number(course.get("retest_cooldown_minutes"), 60)),
            "question_count": int(number(course.get("final_question_count"), 10)),
        },
        "question_bank_count": len(questions),
        "latest_attempt": latest,
        "attempt_count": len(attempts),
        "retry_available_at": latest.get("retry_available_at") if latest else None,
        "retry_seconds_remaining": retry_seconds,
        "certificate": certificate,
    }
    if state == "in_progress" and latest:
        payload["attempt"] = latest
        payload["questions"] = questions_for_attempt(latest)
    return payload


@router.get("/courses/{course_id}/final-assessment")
def get_final_assessment_status(course_id: int, user=Depends(get_current_user)):
    return build_status(require_student(user), course_id)


@router.post("/courses/{course_id}/final-assessment/start")
def start_final_assessment(course_id: int, user=Depends(get_current_user)):
    student = require_student(user)
    status = build_status(student, course_id)
    if status["state"] == "passed":
        return {**status, "status": "already_passed"}
    if status["state"] == "locked":
        raise HTTPException(status_code=400, detail="請先完成課程影片要求，再進行最終測驗")
    if status["state"] == "unconfigured":
        raise HTTPException(status_code=400, detail="教師尚未完成這門課的學分設定")
    if status["state"] == "not_ready":
        raise HTTPException(status_code=400, detail="這門課尚未建立正式測驗題目")
    if status["state"] == "cooldown":
        raise HTTPException(
            status_code=429,
            detail={
                "message": "重新測驗冷卻時間尚未結束",
                "retry_available_at": status["retry_available_at"],
                "retry_seconds_remaining": status["retry_seconds_remaining"],
            },
        )
    if status["state"] == "in_progress":
        return {**status, "status": "in_progress"}

    course = get_course(course_id)
    questions = active_questions(course_id)
    requested_count = max(1, int(number(course.get("final_question_count"), 10)))
    selected = random.sample(questions, min(requested_count, len(questions)))
    attempts = student_attempts(student["id"], course_id)
    row = {
        "student_id": student["id"],
        "course_id": course_id,
        "attempt_number": len(attempts) + 1,
        "passing_score": number(course.get("passing_score"), 70),
        "total_questions": len(selected),
        "question_ids": [question["id"] for question in selected],
        "status": "in_progress",
    }
    response = supabase_admin.table("final_assessment_attempts").insert(row).execute()
    if not response.data:
        raise HTTPException(status_code=500, detail="建立正式測驗失敗")
    attempt = response.data[0]
    return {
        **status,
        "status": "created",
        "state": "in_progress",
        "attempt": attempt,
        "questions": public_questions(selected),
    }


@router.post("/final-assessment/attempts/{attempt_id}/submit")
def submit_final_assessment(
    attempt_id: int,
    payload: FinalAssessmentSubmit,
    user=Depends(get_current_user),
):
    student = require_student(user)
    response = (
        supabase_admin.table("final_assessment_attempts")
        .select("*")
        .eq("id", attempt_id)
        .eq("student_id", student["id"])
        .maybe_single()
        .execute()
    )
    attempt = response.data
    if not attempt:
        raise HTTPException(status_code=404, detail="找不到正式測驗紀錄")
    if attempt.get("status") != "in_progress":
        raise HTTPException(status_code=400, detail="這次正式測驗已經送出")

    question_ids = [int(value) for value in attempt.get("question_ids") or []]
    answer_map = {
        answer.question_id: normalize_answer(answer.selected_answer)
        for answer in payload.answers
        if answer.question_id in question_ids
    }
    if len(answer_map) != len(question_ids):
        raise HTTPException(status_code=422, detail="請完成所有正式測驗題目後再送出")

    rows = (
        supabase_admin.table("final_assessment_questions")
        .select("id, answer, explanation")
        .in_("id", question_ids)
        .execute()
        .data
        or []
    )
    question_map = {row["id"]: row for row in rows}
    correct = 0
    results = []
    for question_id in question_ids:
        question = question_map.get(question_id)
        if not question:
            raise HTTPException(status_code=404, detail=f"找不到正式題目 {question_id}")
        selected = answer_map[question_id]
        correct_answer = normalize_answer(question.get("answer"))
        is_correct = bool(selected and selected == correct_answer)
        correct += int(is_correct)
        results.append(
            {
                "question_id": question_id,
                "selected_answer": selected,
                "correct_answer": correct_answer,
                "is_correct": is_correct,
                "explanation": question.get("explanation"),
            }
        )

    total = len(question_ids)
    score = round(correct / total * 100, 2) if total else 0
    passing_score = number(attempt.get("passing_score"), 70)
    passed = score >= passing_score
    now = datetime.now(timezone.utc)
    course = get_course(attempt["course_id"])
    cooldown = max(0, int(number(course.get("retest_cooldown_minutes"), 60)))
    retry_available_at = None if passed else (now + timedelta(minutes=cooldown)).isoformat()
    update = {
        "score": score,
        "correct_questions": correct,
        "passed": passed,
        "status": "passed" if passed else "failed",
        "answers_json": {str(key): value for key, value in answer_map.items()},
        "results_json": results,
        "submitted_at": now.isoformat(),
        "retry_available_at": retry_available_at,
    }
    updated = (
        supabase_admin.table("final_assessment_attempts")
        .update(update)
        .eq("id", attempt_id)
        .execute()
        .data
        or []
    )
    completed_attempt = updated[0] if updated else {**attempt, **update}
    certificate = None
    completion = course_completion(student["id"], course, get_course_lectures(course["id"]))
    if (
        passed
        and completion["completion_met"]
        and course.get("certification_enabled", True)
    ):
        certificate = issue_certificate(student, course, completed_attempt, completion)

    return {
        "status": completed_attempt["status"],
        "passed": passed,
        "score": score,
        "passing_score": passing_score,
        "correct_questions": correct,
        "total_questions": total,
        "retry_available_at": retry_available_at,
        "results": results,
        "certificate": certificate,
    }


def transcript_text_for_course(course_id: int) -> str:
    lectures = get_course_lectures(course_id)
    lecture_ids = [row["id"] for row in lectures if row.get("id") is not None]
    if not lecture_ids:
        return ""
    transcripts = (
        supabase_admin.table("transcripts")
        .select("id, lecture_id, content, segments_json")
        .in_("lecture_id", lecture_ids)
        .order("id")
        .execute()
        .data
        or []
    )
    transcript_map = {row.get("lecture_id"): row for row in transcripts}
    blocks = []
    for lecture in lectures:
        transcript = transcript_map.get(lecture.get("id"), {})
        content = str(transcript.get("content") or "").strip()
        if not content:
            segments = transcript.get("segments_json") or []
            content = " ".join(
                str(segment.get("text") or "").strip()
                for segment in segments
                if isinstance(segment, dict)
            )
        if content:
            title = lecture.get("title") or lecture.get("course_name") or f"Lecture {lecture.get('id')}"
            blocks.append(f"## {title}\n{content}")
    return "\n\n".join(blocks)


@router.post("/teacher/courses/{course_id}/final-assessment/generate")
def generate_final_assessment(
    course_id: int,
    payload: FinalAssessmentGenerateRequest,
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    course = get_course(course_id)
    if not can_manage_course(
        teacher.get("role"), teacher.get("id"), course.get("teacher_id")
    ):
        raise HTTPException(status_code=403, detail="沒有權限管理這門課")

    transcript = transcript_text_for_course(course_id)
    if not transcript:
        raise HTTPException(status_code=400, detail="這門課目前沒有可用的逐字稿")
    count = payload.question_count or int(number(course.get("final_question_count"), 10))
    prompt = f"""
請根據以下整門課程的逐字稿，產生 {count} 題正式期末選擇題。
這些題目用於 Course 層級的 Final Assessment，不是影片播放中的練習題。
請平均涵蓋不同小節的重要概念，避免只集中在單一小節。
每題固定四個選項，answer 只能是 A、B、C 或 D。
題目不需要影片時間點，不要輸出 source_timestamp。
每題必須包含清楚的 explanation，並可提供 knowledge_point_titles 字串陣列。
請只輸出穩定 JSON。

JSON 格式：
{{"questions":[{{"question_text":"題目","options":["A. 選項A","B. 選項B","C. 選項C","D. 選項D"],"answer":"A","explanation":"解析","knowledge_point_titles":["知識點"]}}]}}

課程逐字稿：
{transcript}
"""
    try:
        ai_response = gemini_client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config={"response_mime_type": "application/json"},
        )
        result = parse_json_response(ai_response.text)
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="AI 正式測驗產題失敗，請稍後再試或檢查 Gemini API 設定",
        ) from exc
    if not isinstance(result, dict):
        raise HTTPException(status_code=500, detail="AI 回傳的正式測驗格式不正確")
    generated = [
        question
        for question in result.get("questions", [])
        if question.get("question_text")
        and isinstance(question.get("options"), list)
        and len(question["options"]) == 4
        and normalize_answer(question.get("answer")) in {"A", "B", "C", "D"}
    ]
    if not generated:
        raise HTTPException(status_code=500, detail="AI 沒有產生有效的正式測驗題目")

    existing = (
        supabase_admin.table("final_assessment_questions")
        .select("bank_version")
        .eq("course_id", course_id)
        .order("bank_version", desc=True)
        .limit(1)
        .execute()
        .data
        or []
    )
    next_version = int(existing[0].get("bank_version") or 0) + 1 if existing else 1
    rows = [
        {
            "course_id": course_id,
            "question_text": question["question_text"],
            "options_json": question["options"],
            "answer": normalize_answer(question["answer"]),
            "explanation": question.get("explanation"),
            "knowledge_point_titles": question.get("knowledge_point_titles") or [],
            "bank_version": next_version,
            "is_active": True,
        }
        for question in generated
    ]
    try:
        response = supabase_admin.table("final_assessment_questions").insert(rows).execute()
    except APIError as exc:
        if exc.code == "42501":
            raise HTTPException(
                status_code=500,
                detail="正式題庫寫入權限不足，請確認後端使用 Supabase secret key",
            ) from exc
        raise HTTPException(status_code=500, detail="正式測驗題目寫入失敗") from exc
    inserted = response.data or []
    if not inserted:
        raise HTTPException(status_code=500, detail="正式測驗題目寫入失敗")

    supabase_admin.table("final_assessment_questions").update({"is_active": False}).eq(
        "course_id", course_id
    ).neq("bank_version", next_version).execute()
    return {
        "status": "success",
        "course_id": course_id,
        "bank_version": next_version,
        "question_count": len(inserted),
    }


@router.get("/student/certificates/{course_id}")
def get_student_certificate(course_id: int, user=Depends(get_current_user)):
    student = require_student(user)
    require_enrollment(student["id"], course_id)
    certificate = get_certificate(student["id"], course_id)
    if not certificate:
        raise HTTPException(status_code=404, detail="尚未取得這門課的完成認證")
    return certificate
