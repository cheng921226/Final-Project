from collections import defaultdict
from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .security import get_current_user

router = APIRouter()


class CreditRulePayload(BaseModel):
    label: str | None = None
    required_completion_percentage: float = Field(ge=0, le=100)
    required_score: float | None = Field(default=None, ge=0, le=100)
    credits_awarded: float = Field(ge=0)
    sort_order: int = 0


class CourseCreditSettingsPayload(BaseModel):
    credit_value: float = Field(ge=0)
    partial_credit_enabled: bool = False
    completion_threshold: float = Field(default=100, ge=0, le=100)
    passing_score: float | None = Field(default=None, ge=0, le=100)
    require_passing_score: bool = False
    certification_enabled: bool = True
    rules: list[CreditRulePayload] = Field(default_factory=list)


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
    if profile.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="這個帳號沒有老師權限")
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


def sorted_rules_for_course(
    course: dict[str, Any], rules: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    course_rules = sorted(
        rules,
        key=lambda row: (
            number(row.get("required_completion_percentage")),
            number(row.get("credits_awarded")),
            row.get("sort_order") or 0,
        ),
    )
    if course_rules:
        return course_rules

    credit_value = number(course.get("credit_value"))
    if credit_value <= 0:
        return []

    full_rule = {
        "label": "完整學分",
        "required_completion_percentage": number(
            course.get("completion_threshold"), 100
        ),
        "required_score": (
            number(course.get("passing_score"), 70)
            if course.get("require_passing_score")
            else None
        ),
        "credits_awarded": credit_value,
        "sort_order": 100,
    }
    if not course.get("partial_credit_enabled"):
        return [full_rule]

    return [
        {
            "label": "部分學分",
            "required_completion_percentage": 50,
            "required_score": None,
            "credits_awarded": round(credit_value / 2, 2),
            "sort_order": 50,
        },
        full_rule,
    ]


def evaluate_course(
    course: dict[str, Any],
    lectures: list[dict[str, Any]],
    progresses: list[dict[str, Any]],
    attempts: list[dict[str, Any]],
    rules: list[dict[str, Any]],
) -> dict[str, Any]:
    lecture_count = len(lectures)
    completed_lectures = sum(1 for row in progresses if row.get("completed"))
    completion_percentage = percent(completed_lectures, lecture_count)
    watched_seconds = sum(number(row.get("watched_seconds")) for row in progresses)

    attempt_count = len(attempts)
    correct_count = sum(1 for row in attempts if row.get("is_correct"))
    quiz_average = percent(correct_count, attempt_count) if attempt_count else None

    credit_rules = sorted_rules_for_course(course, rules)
    earned_credits = 0.0
    achieved_rule = None
    next_requirements: list[str] = []
    for rule in credit_rules:
        required_completion = number(rule.get("required_completion_percentage"))
        required_score = rule.get("required_score")
        score_requirement_met = (
            True
            if required_score in (None, "", "null")
            else quiz_average is not None and quiz_average >= number(required_score)
        )
        completion_requirement_met = completion_percentage >= required_completion

        if completion_requirement_met and score_requirement_met:
            if number(rule.get("credits_awarded")) >= earned_credits:
                earned_credits = number(rule.get("credits_awarded"))
                achieved_rule = rule
        elif not achieved_rule:
            if not completion_requirement_met:
                next_requirements.append(f"課程完成度達到 {required_completion:g}%")
            if not score_requirement_met and required_score not in (None, "", "null"):
                next_requirements.append(f"測驗平均達到 {number(required_score):g} 分")

    total_credits = number(course.get("credit_value"))
    certification_earned = bool(
        course.get("certification_enabled", True)
        and total_credits > 0
        and earned_credits >= total_credits
    )

    if certification_earned:
        status = "certified"
        status_label = "已取得認證"
    elif earned_credits > 0:
        status = "partial_credit"
        status_label = "符合部分學分"
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
        "certification_earned": certification_earned,
        "status": status,
        "status_label": status_label,
        "achieved_rule": achieved_rule,
        "next_requirements": [] if certification_earned else next_requirements,
        "rules": credit_rules,
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

    rules = (
        supabase_admin.table("course_credit_rules")
        .select("*")
        .order("sort_order")
        .execute()
        .data
        or []
    )

    lectures_by_course = grouped_by(lectures, "course_id")
    progresses_by_lecture = grouped_by(progresses, "lecture_id")
    attempts_by_lecture = grouped_by(attempts, "lecture_id")
    rules_by_course = grouped_by(rules, "course_id")
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
            rules_by_course.get(course.get("id"), []),
        )
        result["has_questions"] = any(
            lecture.get("id") in question_lecture_ids for lecture in course_lectures
        )
        course_results.append(result)

    return {
        "student_id": student_id,
        "summary": {
            "completed_courses": sum(
                1 for course in course_results if course["certification_earned"]
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
    courses = (
        supabase_admin.table("courses")
        .select("*")
        .eq("teacher_id", teacher["id"])
        .order("id")
        .execute()
        .data
        or []
    )
    course_ids = [course["id"] for course in courses if course.get("id") is not None]
    rules = []
    if course_ids:
        rules = (
            supabase_admin.table("course_credit_rules")
            .select("*")
            .in_("course_id", course_ids)
            .order("sort_order")
            .execute()
            .data
            or []
        )

    rules_by_course = grouped_by(rules, "course_id")
    return {
        "teacher": teacher,
        "courses": [
            {
                **course,
                "title": course_title(course),
                "rules": rules_by_course.get(course.get("id"), []),
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
        .select("id, teacher_id")
        .eq("id", course_id)
        .maybe_single()
        .execute()
    )
    course = course_response.data
    if not course:
        raise HTTPException(status_code=404, detail="找不到課程")
    if course.get("teacher_id") not in (None, teacher.get("id")):
        raise HTTPException(status_code=403, detail="沒有權限修改這門課")

    course_update = {
        "credit_value": payload.credit_value,
        "partial_credit_enabled": payload.partial_credit_enabled,
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
    rule_rows = [
        {
            "course_id": course_id,
            "label": rule.label,
            "required_completion_percentage": rule.required_completion_percentage,
            "required_score": rule.required_score,
            "credits_awarded": rule.credits_awarded,
            "sort_order": index,
        }
        for index, rule in enumerate(payload.rules)
    ]
    inserted_rules = []
    if rule_rows:
        inserted_rules = (
            supabase_admin.table("course_credit_rules").insert(rule_rows).execute().data
            or []
        )

    return {
        "course": updated_course[0] if updated_course else course_update,
        "rules": inserted_rules,
    }
