from collections import defaultdict
from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from roles import CAMPUS_ROLE, can_manage_course, has_teacher_access

from .security import get_current_user

router = APIRouter()


class CourseCreditSettingsPayload(BaseModel):
    credit_value: float = Field(ge=0)
    completion_threshold: float = Field(default=100, ge=0, le=100)
    passing_score: float | None = Field(default=None, ge=0, le=100)
    require_passing_score: bool = False
    certification_enabled: bool = True


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
    return course.get("title") or course.get("course_name") or f"課程 {course.get('id')}"


def evaluate_course(
    course: dict[str, Any],
    lectures: list[dict[str, Any]],
    progresses: list[dict[str, Any]],
    attempts: list[dict[str, Any]],
) -> dict[str, Any]:
    lecture_count = len(lectures)
    completed_lectures = sum(1 for row in progresses if row.get("completed"))
    completion_percentage = percent(completed_lectures, lecture_count)
    watched_seconds = sum(number(row.get("watched_seconds")) for row in progresses)

    attempt_count = len(attempts)
    correct_count = sum(1 for row in attempts if row.get("is_correct"))
    quiz_average = percent(correct_count, attempt_count) if attempt_count else None

    total_credits = number(course.get("credit_value"))
    has_credit_settings = total_credits > 0
    required_completion = number(course.get("completion_threshold"), 100)
    completion_requirement_met = completion_percentage >= required_completion
    score_is_required = bool(course.get("require_passing_score"))
    required_score = number(course.get("passing_score"), 70) if score_is_required else None
    score_requirement_met = (
        not score_is_required
        or (quiz_average is not None and quiz_average >= required_score)
    )
    course_passed = bool(
        has_credit_settings
        and completion_requirement_met
        and score_requirement_met
    )
    earned_credits = total_credits if course_passed else 0.0
    certification_earned = bool(
        course.get("certification_enabled", True)
        and course_passed
    )

    requirements = [
        {
            "key": "completion",
            "label": "課程完成度",
            "current": completion_percentage,
            "target": required_completion,
            "unit": "%",
            "met": completion_requirement_met,
        }
    ]
    if score_is_required:
        requirements.append(
            {
                "key": "score",
                "label": "測驗平均",
                "current": quiz_average,
                "target": required_score,
                "unit": "分",
                "met": score_requirement_met,
            }
        )

    next_requirements = [
        f"{item['label']}達到 {item['target']:g}{item['unit']}"
        for item in requirements
        if not item["met"]
    ]

    if certification_earned:
        status = "certified"
        status_label = "已取得認證"
    elif course_passed:
        status = "passed"
        status_label = "已通過"
    elif not has_credit_settings:
        status = "unconfigured"
        status_label = "尚未設定學分"
    elif completion_percentage > 0 or attempt_count > 0:
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
        "quiz_average": quiz_average,
        "attempt_count": attempt_count,
        "credits_earned": earned_credits,
        "credits_total": total_credits,
        "course_passed": course_passed,
        "certification_earned": certification_earned,
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
    courses = (
        supabase_admin.table("courses").select("*").order("id").execute().data or []
    )
    lectures = supabase_admin.table("lectures").select("*").order("id").execute().data or []
    lecture_ids = [row["id"] for row in lectures if row.get("id") is not None]

    progresses = []
    attempts = []
    questions = []
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
        attempts = (
            supabase_admin.table("question_attempts")
            .select("*")
            .eq("student_id", student_id)
            .in_("lecture_id", lecture_ids)
            .execute()
            .data
            or []
        )
        questions = (
            supabase_admin.table("questions")
            .select("id, lecture_id")
            .in_("lecture_id", lecture_ids)
            .execute()
            .data
            or []
        )

    lectures_by_course = grouped_by(lectures, "course_id")
    progresses_by_lecture = grouped_by(progresses, "lecture_id")
    attempts_by_lecture = grouped_by(attempts, "lecture_id")
    question_lecture_ids = {row.get("lecture_id") for row in questions}

    course_results = []
    for course in courses:
        course_lectures = lectures_by_course.get(course.get("id"), [])
        course_progresses = [
            progress
            for lecture in course_lectures
            for progress in progresses_by_lecture.get(lecture.get("id"), [])
        ]
        course_attempts = [
            attempt
            for lecture in course_lectures
            for attempt in attempts_by_lecture.get(lecture.get("id"), [])
        ]
        result = evaluate_course(
            course,
            course_lectures,
            course_progresses,
            course_attempts,
        )
        result["has_questions"] = any(
            lecture.get("id") in question_lecture_ids for lecture in course_lectures
        )
        course_results.append(result)

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
    if teacher.get("role") != CAMPUS_ROLE:
        course_query = course_query.eq("teacher_id", teacher["id"])
    courses = course_query.order("id").execute().data or []
    return {
        "teacher": teacher,
        "courses": [
            {
                **course,
                "title": course_title(course),
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
    if payload.require_passing_score and payload.passing_score is None:
        raise HTTPException(status_code=422, detail="啟用測驗門檻時必須設定及格分數")
    course_response = (
        supabase_admin.table("courses")
        .select("id, teacher_id")
        .eq("id", course_id)
        .maybe_single()
        .execute()
    )
    course = course_response.data
    if not course:
        raise HTTPException(status_code=404, detail="找不到課程")
    if not can_manage_course(
        teacher.get("role"), teacher.get("id"), course.get("teacher_id")
    ):
        raise HTTPException(status_code=403, detail="沒有權限修改這門課")

    course_update = {
        "credit_value": payload.credit_value,
        "partial_credit_enabled": False,
        "completion_threshold": payload.completion_threshold,
        "passing_score": payload.passing_score,
        "require_passing_score": payload.require_passing_score,
        "certification_enabled": payload.certification_enabled,
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
