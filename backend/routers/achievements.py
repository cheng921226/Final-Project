from collections import defaultdict
from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel, Field

from roles import CAMPUS_ROLE, can_manage_course, has_teacher_access

from .security import get_current_user

router = APIRouter()


class CourseCreditSettingsPayload(BaseModel):
    credit_value: float = Field(ge=0)
    completion_threshold: float = Field(default=100, ge=0, le=100)
    passing_score: float = Field(default=70, ge=0, le=100)
    retest_cooldown_minutes: int = Field(default=60, ge=0, le=43200)
    final_question_count: int = Field(default=10, ge=1, le=50)
    certification_enabled: bool = True
    certificate_show_score: bool = True


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


def require_teacher(user) -> dict[str, Any]:
    profile = user_profile(user)
    if not has_teacher_access(profile.get("role")):
        raise HTTPException(status_code=403, detail="這個帳號沒有教師端權限")
    return profile


def grouped_by(rows: list[dict[str, Any]], key: str) -> dict[Any, list[dict[str, Any]]]:
    grouped: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[row.get(key)].append(row)
    return grouped


def number(value: Any, default: float = 0) -> float:
    try:
        if value in (None, "", "null"):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def percent(part: float, total: float) -> int:
    if not total:
        return 0
    return round(min(max(part / total * 100, 0), 100))


def course_title(course: dict[str, Any]) -> str:
    return (
        course.get("title") or course.get("course_name") or f"課程 {course.get('id')}"
    )


def evaluate_course(
    course: dict[str, Any],
    lectures: list[dict[str, Any]],
    progresses: list[dict[str, Any]],
    final_attempts: list[dict[str, Any]],
    certificate: dict[str, Any] | None,
    final_question_count: int,
) -> dict[str, Any]:
    lecture_count = len(lectures)
    progress_by_lecture = {row.get("lecture_id"): row for row in progresses}
    completed_lectures = sum(
        1
        for lecture in lectures
        if progress_by_lecture.get(lecture.get("id"), {}).get("completed")
    )
    completion_percentage = percent(completed_lectures, lecture_count)
    watched_seconds = sum(number(row.get("watched_seconds")) for row in progresses)

    latest_attempt = final_attempts[-1] if final_attempts else None
    passed_attempt = next(
        (attempt for attempt in reversed(final_attempts) if attempt.get("passed")), None
    )
    final_score = (
        passed_attempt.get("score")
        if passed_attempt
        else (latest_attempt.get("score") if latest_attempt else None)
    )

    total_credits = number(course.get("credit_value"))
    has_credit_settings = total_credits > 0
    required_completion = number(course.get("completion_threshold"), 100)
    required_score = number(course.get("passing_score"), 70)
    completion_requirement_met = completion_percentage >= required_completion
    final_requirement_met = bool(passed_attempt)
    course_passed = bool(
        certificate
        or (
            has_credit_settings and completion_requirement_met and final_requirement_met
        )
    )
    earned_credits = (
        number(certificate.get("credits_awarded"))
        if certificate
        else (total_credits if course_passed else 0.0)
    )
    certification_earned = bool(certificate)

    requirements = [
        {
            "key": "completion",
            "label": "課程完成度",
            "current": completion_percentage,
            "target": required_completion,
            "unit": "%",
            "met": completion_requirement_met,
        },
        {
            "key": "final_assessment",
            "label": "最終測驗",
            "current": final_score,
            "target": required_score,
            "unit": "分",
            "met": final_requirement_met,
        },
    ]
    next_requirements = [
        f"{item['label']}達到 {item['target']:g}{item['unit']}"
        for item in requirements
        if not item["met"]
    ]

    if certification_earned:
        status = "certified"
        status_label = "已完成"
    elif course_passed:
        status = "passed"
        status_label = "已通過"
    elif not has_credit_settings:
        status = "unconfigured"
        status_label = "尚未設定學分"
    elif completion_percentage > 0 or final_attempts:
        status = "in_progress"
        status_label = "進行中"
    else:
        status = "not_started"
        status_label = "未開始"

    return {
        "course_id": course.get("id"),
        "title": course_title(course),
        "lecture_count": lecture_count,
        "completed_lectures": completed_lectures,
        "completion_percentage": completion_percentage,
        "watched_seconds": int(watched_seconds),
        "watched_hours": round(watched_seconds / 3600, 1),
        "final_score": final_score,
        "final_attempt_count": len(final_attempts),
        "final_assessment_passed": final_requirement_met,
        "has_final_assessment": final_question_count > 0,
        "retry_available_at": latest_attempt.get("retry_available_at")
        if latest_attempt
        else None,
        "credits_earned": earned_credits,
        "credits_total": total_credits,
        "course_passed": course_passed,
        "certification_earned": certification_earned,
        "certificate": certificate,
        "status": status,
        "status_label": status_label,
        "next_requirements": [] if course_passed else next_requirements,
        "requirements": requirements if has_credit_settings else [],
        "rules": [],
    }


@router.get("/student/achievements")
def get_student_achievements(user=Depends(get_current_user)):
    profile = user_profile(user)
    if profile.get("role") != "student":
        raise HTTPException(status_code=403, detail="這個頁面只有學生帳號可以使用")
    student_id = profile["id"]
    enrollments = (
        supabase_admin.table("student_courses")
        .select("course_id")
        .eq("student_id", student_id)
        .execute()
        .data
        or []
    )
    enrolled_course_ids = [
        row["course_id"] for row in enrollments if row.get("course_id") is not None
    ]
    courses = []
    lectures = []
    if enrolled_course_ids:
        courses = (
            supabase_admin.table("courses")
            .select("*")
            .in_("id", enrolled_course_ids)
            .order("id")
            .execute()
            .data
            or []
        )
        lectures = (
            supabase_admin.table("lectures")
            .select("*")
            .in_("course_id", enrolled_course_ids)
            .order("id")
            .execute()
            .data
            or []
        )
    lecture_ids = [row["id"] for row in lectures if row.get("id") is not None]
    course_ids = [row["id"] for row in courses if row.get("id") is not None]

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

    final_attempts = []
    certificates = []
    final_questions = []
    if course_ids:
        try:
            final_attempts = (
                supabase_admin.table("final_assessment_attempts")
                .select("*")
                .eq("student_id", student_id)
                .in_("course_id", course_ids)
                .order("attempt_number")
                .execute()
                .data
                or []
            )
            certificates = (
                supabase_admin.table("course_certifications")
                .select("*")
                .eq("student_id", student_id)
                .in_("course_id", course_ids)
                .execute()
                .data
                or []
            )
            certificates = [row for row in certificates if row.get("final_attempt_id")]
            final_questions = (
                supabase_admin.table("final_assessment_questions")
                .select("id, course_id")
                .in_("course_id", course_ids)
                .eq("is_active", True)
                .execute()
                .data
                or []
            )
        except APIError as exc:
            if exc.code in {"PGRST204", "PGRST205"}:
                raise HTTPException(
                    status_code=503,
                    detail="資料庫尚未完成正式測驗 migration，請先執行 final_assessment_and_certificates.sql",
                ) from exc
            raise

    lectures_by_course = grouped_by(lectures, "course_id")
    progresses_by_lecture = grouped_by(progresses, "lecture_id")
    attempts_by_course = grouped_by(final_attempts, "course_id")
    certificates_by_course = {
        row.get("course_id"): row
        for row in certificates
        if row.get("course_id") is not None
    }
    question_counts: dict[Any, int] = defaultdict(int)
    for row in final_questions:
        question_counts[row.get("course_id")] += 1

    course_results = []
    for course in courses:
        course_lectures = lectures_by_course.get(course.get("id"), [])
        course_progresses = [
            progress
            for lecture in course_lectures
            for progress in progresses_by_lecture.get(lecture.get("id"), [])
        ]
        course_results.append(
            evaluate_course(
                course,
                course_lectures,
                course_progresses,
                attempts_by_course.get(course.get("id"), []),
                certificates_by_course.get(course.get("id")),
                question_counts.get(course.get("id"), 0),
            )
        )

    return {
        "student_id": student_id,
        "summary": {
            "completed_courses": sum(
                1 for course in course_results if course["course_passed"]
            ),
            "learning_hours": round(
                sum(course["watched_seconds"] for course in course_results) / 3600, 1
            ),
            "earned_credits": round(
                sum(course["credits_earned"] for course in course_results), 2
            ),
            "certifications": sum(
                1 for course in course_results if course["certification_earned"]
            ),
        },
        "courses": course_results,
    }


@router.get("/teacher/course-credit-settings")
def get_teacher_course_credit_settings(user=Depends(get_current_user)):
    teacher = require_teacher(user)
    course_query = supabase_admin.table("courses").select("*")
    if teacher.get("role") == CAMPUS_ROLE:
        course_query = course_query.eq("created_by_user_id", teacher["id"])
    else:
        course_query = course_query.eq("teacher_id", teacher["id"])
    courses = course_query.order("id").execute().data or []
    course_ids = [course["id"] for course in courses if course.get("id") is not None]
    question_counts: dict[Any, int] = defaultdict(int)
    if course_ids:
        try:
            rows = (
                supabase_admin.table("final_assessment_questions")
                .select("id, course_id")
                .in_("course_id", course_ids)
                .eq("is_active", True)
                .execute()
                .data
                or []
            )
            for row in rows:
                question_counts[row.get("course_id")] += 1
        except Exception:
            question_counts = defaultdict(int)
    return {
        "teacher": teacher,
        "courses": [
            {
                **course,
                "title": course_title(course),
                "final_assessment_question_count": question_counts.get(
                    course.get("id"), 0
                ),
            }
            for course in courses
        ],
    }


@router.put("/teacher/courses/{course_id}/credit-settings")
def update_course_credit_settings(
    course_id: int,
    payload: CourseCreditSettingsPayload,
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    course_response = (
        supabase_admin.table("courses")
        .select("id, teacher_id, created_by_user_id")
        .eq("id", course_id)
        .maybe_single()
        .execute()
    )
    course = course_response.data
    if not course:
        raise HTTPException(status_code=404, detail="找不到課程")
    if not can_manage_course(
        teacher.get("role"),
        teacher.get("id"),
        course.get("teacher_id"),
        course.get("created_by_user_id"),
    ):
        raise HTTPException(status_code=403, detail="沒有權限修改這門課")

    course_update = {
        "credit_value": payload.credit_value,
        "partial_credit_enabled": False,
        "completion_threshold": payload.completion_threshold,
        "passing_score": payload.passing_score,
        "require_passing_score": True,
        "retest_cooldown_minutes": payload.retest_cooldown_minutes,
        "final_question_count": payload.final_question_count,
        "certification_enabled": payload.certification_enabled,
        "certificate_show_score": payload.certificate_show_score,
    }
    updated_course = (
        supabase_admin.table("courses")
        .update(course_update)
        .eq("id", course_id)
        .execute()
        .data
        or []
    )
    supabase_admin.table("course_credit_rules").delete().eq(
        "course_id", course_id
    ).execute()
    return {
        "course": updated_course[0] if updated_course else course_update,
        "rules": [],
    }
