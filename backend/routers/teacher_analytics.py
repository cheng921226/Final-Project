from collections import defaultdict
from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException

from .security import get_current_user

router = APIRouter(prefix="/teacher", tags=["teacher analytics"])


def _rows(table: str, **filters: Any) -> list[dict[str, Any]]:
    query = supabase_admin.table(table).select("*")
    for column, values in filters.items():
        if not values:
            return []
        query = query.in_(column, list(values))
    response = query.execute()
    return response.data or []


def _latest(*values: str | None) -> str | None:
    present = [value for value in values if value]
    return max(present) if present else None


def _event_time(event: dict[str, Any]) -> float | None:
    data = event.get("event_data") or {}
    value = data.get("to") if event.get("event_type") == "seek" else data.get("timestamp")
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _hotspots(events: list[dict[str, Any]], event_type: str) -> list[dict[str, Any]]:
    buckets: dict[int, int] = defaultdict(int)
    for event in events:
        if event.get("event_type") != event_type:
            continue
        seconds = _event_time(event)
        if seconds is None or seconds < 0:
            continue
        bucket = int(seconds // 30) * 30
        buckets[bucket] += 1
    return [
        {"start": start, "end": start + 30, "count": count}
        for start, count in sorted(buckets.items(), key=lambda item: item[1], reverse=True)[:6]
    ]


def _percent(numerator: int | float, denominator: int | float) -> int:
    return round(numerator / denominator * 100) if denominator else 0


@router.get("/analytics")
def get_teacher_analytics(user=Depends(get_current_user)):
    profile_response = (
        supabase_admin.table("users")
        .select("id,name,email,role")
        .eq("auth_id", user.id)
        .single()
        .execute()
    )
    profile = profile_response.data
    if not profile or profile.get("role") != "teacher":
        raise HTTPException(status_code=403, detail="Teacher access required")

    courses = (
        supabase_admin.table("courses")
        .select("*")
        .eq("teacher_id", profile["id"])
        .order("created_at")
        .execute()
    ).data or []
    course_ids = [course["id"] for course in courses]
    if not course_ids:
        return {"teacher": profile, "courses": []}

    lectures = _rows("lectures", course_id=course_ids)
    lecture_ids = [lecture["id"] for lecture in lectures]
    enrollments = _rows("student_courses", course_id=course_ids)
    student_ids = sorted({row["student_id"] for row in enrollments})
    students = _rows("users", id=student_ids)
    progresses = _rows("video_progresses", lecture_id=lecture_ids)
    events = _rows("learning_events", lecture_id=lecture_ids)
    attempts = _rows("question_attempts", lecture_id=lecture_ids)
    questions = _rows("questions", lecture_id=lecture_ids)

    student_map = {row["id"]: row for row in students}
    question_map = {row["id"]: row for row in questions}
    result_courses = []

    for course in courses:
        cid = course["id"]
        course_lectures = [row for row in lectures if row.get("course_id") == cid]
        course_lecture_ids = {row["id"] for row in course_lectures}
        course_student_ids = {
            row["student_id"] for row in enrollments if row.get("course_id") == cid
        }
        course_progresses = [
            row for row in progresses
            if row.get("lecture_id") in course_lecture_ids
            and row.get("student_id") in course_student_ids
        ]
        course_events = [
            row for row in events
            if row.get("lecture_id") in course_lecture_ids
            and row.get("student_id") in course_student_ids
        ]
        course_attempts = [
            row for row in attempts
            if row.get("lecture_id") in course_lecture_ids
            and row.get("student_id") in course_student_ids
        ]

        active_students = {
            row["student_id"]
            for row in course_progresses + course_events + course_attempts
            if row.get("student_id") is not None
        }
        expected_completions = len(course_student_ids) * len(course_lectures)
        completed_count = sum(bool(row.get("completed")) for row in course_progresses)
        correct_count = sum(bool(row.get("is_correct")) for row in course_attempts)

        lecture_results = []
        for lecture in sorted(course_lectures, key=lambda row: row["id"]):
            lid = lecture["id"]
            lecture_progresses = [row for row in course_progresses if row.get("lecture_id") == lid]
            lecture_events = [row for row in course_events if row.get("lecture_id") == lid]
            lecture_attempts = [row for row in course_attempts if row.get("lecture_id") == lid]
            lecture_correct = sum(bool(row.get("is_correct")) for row in lecture_attempts)
            event_counts: dict[str, int] = defaultdict(int)
            for event in lecture_events:
                event_counts[event.get("event_type") or "unknown"] += 1

            lecture_results.append({
                "id": lid,
                "title": lecture.get("title") or f"小節 {lid}",
                "students_started": len({row["student_id"] for row in lecture_progresses}),
                "students_completed": sum(bool(row.get("completed")) for row in lecture_progresses),
                "completion_rate": _percent(
                    sum(bool(row.get("completed")) for row in lecture_progresses),
                    len(course_student_ids),
                ),
                "watched_minutes": round(
                    sum(row.get("watched_seconds") or 0 for row in lecture_progresses) / 60,
                    1,
                ),
                "pause_count": event_counts["pause"],
                "seek_count": event_counts["seek"],
                "questions_asked": event_counts["question_asked"],
                "attempts": len(lecture_attempts),
                "accuracy": _percent(lecture_correct, len(lecture_attempts)),
                "pause_hotspots": _hotspots(lecture_events, "pause"),
                "seek_hotspots": _hotspots(lecture_events, "seek"),
            })

        student_results = []
        for student_id in sorted(course_student_ids):
            student = student_map.get(student_id, {})
            student_progress = [row for row in course_progresses if row.get("student_id") == student_id]
            student_events = [row for row in course_events if row.get("student_id") == student_id]
            student_attempts = [row for row in course_attempts if row.get("student_id") == student_id]
            student_correct = sum(bool(row.get("is_correct")) for row in student_attempts)
            last_active = None
            for row in student_progress:
                last_active = _latest(last_active, row.get("updated_at"))
            for row in student_events:
                last_active = _latest(last_active, row.get("created_at"))
            for row in student_attempts:
                last_active = _latest(last_active, row.get("answered_at"))

            student_results.append({
                "id": student_id,
                "name": student.get("name") or f"學生 {student_id}",
                "email": student.get("email"),
                "completed_lectures": sum(bool(row.get("completed")) for row in student_progress),
                "total_lectures": len(course_lectures),
                "watched_minutes": round(
                    sum(row.get("watched_seconds") or 0 for row in student_progress) / 60,
                    1,
                ),
                "attempts": len(student_attempts),
                "accuracy": _percent(student_correct, len(student_attempts)),
                "last_active": last_active,
            })

        question_results = []
        for question_id in {row.get("question_id") for row in course_attempts}:
            if question_id is None:
                continue
            question_attempts = [row for row in course_attempts if row.get("question_id") == question_id]
            correct = sum(bool(row.get("is_correct")) for row in question_attempts)
            question = question_map.get(question_id, {})
            question_results.append({
                "id": question_id,
                "text": question.get("question_text") or f"題目 {question_id}",
                "attempts": len(question_attempts),
                "accuracy": _percent(correct, len(question_attempts)),
            })

        result_courses.append({
            "id": cid,
            "title": course.get("title") or f"課程 {cid}",
            "summary": {
                "students": len(course_student_ids),
                "active_students": len(active_students),
                "lectures": len(course_lectures),
                "completion_rate": _percent(completed_count, expected_completions),
                "watched_hours": round(
                    sum(row.get("watched_seconds") or 0 for row in course_progresses) / 3600,
                    1,
                ),
                "question_accuracy": _percent(correct_count, len(course_attempts)),
            },
            "lectures": lecture_results,
            "students": student_results,
            "questions": sorted(question_results, key=lambda row: (row["accuracy"], -row["attempts"])),
        })

    return {"teacher": profile, "courses": result_courses}
