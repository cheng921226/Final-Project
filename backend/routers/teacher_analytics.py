from collections import defaultdict
from datetime import datetime, timedelta, timezone
from math import ceil
from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from roles import CAMPUS_ROLE, has_teacher_access
from services.question_statistics import percentage, question_attempt_statistics

from .achievements import evaluate_course
from .security import get_current_user
from .teacher_access import require_course_manager, require_teacher

router = APIRouter(prefix="/teacher", tags=["teacher analytics"])


class RecommendationSnoozeRequest(BaseModel):
    recommendation_id: str
    days: int


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
    value = (
        data.get("to") if event.get("event_type") == "seek" else data.get("timestamp")
    )
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _timestamp_seconds(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        parts = [float(part) for part in str(value).strip().split(":")]
    except ValueError:
        return None
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    if len(parts) == 3:
        return parts[0] * 3600 + parts[1] * 60 + parts[2]
    return None


def _knowledge_titles_for_range(
    start: int,
    end: int,
    knowledge_points: list[dict[str, Any]],
) -> list[str]:
    titles = []
    for point in knowledge_points:
        point_start = _timestamp_seconds(point.get("start_time"))
        point_end = _timestamp_seconds(point.get("end_time"))
        if point_start is None:
            continue
        if point_end is None:
            point_end = point_start
        if point_start < end and point_end >= start:
            title = point.get("title") or "未命名知識點"
            if title not in titles:
                titles.append(title)
    return titles


def _hotspots(
    events: list[dict[str, Any]],
    event_type: str,
    knowledge_points: list[dict[str, Any]],
) -> list[dict[str, Any]]:
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
        {
            "start": start,
            "end": start + 30,
            "count": count,
            "knowledge_points": _knowledge_titles_for_range(
                start, start + 30, knowledge_points
            ),
        }
        for start, count in sorted(
            buckets.items(), key=lambda item: item[1], reverse=True
        )[:6]
    ]


def _percent(numerator: int | float, denominator: int | float) -> int:
    return percentage(numerator, denominator)


def _enrolled_student_ids(
    enrollments: list[dict[str, Any]],
    course_id: int,
    known_student_ids: set[int],
) -> set[int]:
    return {
        row["student_id"]
        for row in enrollments
        if row.get("course_id") == course_id
        and row.get("student_id") in known_student_ids
    }


def _last_student_activity(
    progresses: list[dict[str, Any]],
    events: list[dict[str, Any]],
    attempts: list[dict[str, Any]],
) -> str | None:
    last_active = None
    for row in progresses:
        last_active = _latest(last_active, row.get("updated_at"))
    for row in events:
        last_active = _latest(last_active, row.get("created_at"))
    for row in attempts:
        last_active = _latest(last_active, row.get("answered_at"))
    return last_active


def _student_scope_result(
    student: dict[str, Any],
    progresses: list[dict[str, Any]],
    events: list[dict[str, Any]],
    attempts: list[dict[str, Any]],
    total_lectures: int,
) -> dict[str, Any]:
    correct = sum(bool(row.get("is_correct")) for row in attempts)
    return {
        "id": student.get("id"),
        "student_number": student.get("student_number"),
        "name": student.get("name") or f"學生 {student.get('id')}",
        "email": student.get("email"),
        "classes": student.get("classes") or [],
        "completed_lectures": sum(bool(row.get("completed")) for row in progresses),
        "total_lectures": total_lectures,
        "watched_minutes": round(
            sum(row.get("watched_seconds") or 0 for row in progresses) / 60,
            1,
        ),
        "attempts": len(attempts),
        "accuracy": _percent(correct, len(attempts)),
        "last_active": _last_student_activity(progresses, events, attempts),
    }


def _teaching_recommendations(
    lectures: list[dict[str, Any]],
    students: list[dict[str, Any]],
    questions: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    enrolled_count = len(students)
    if enrolled_count < 5:
        return []

    recommendations: list[dict[str, Any]] = []
    minimum_interactions = max(5, ceil(enrolled_count * 0.15))

    class_completion_stats: dict[str, dict[str, int]] = defaultdict(
        lambda: {"students": 0, "completed": 0, "expected": 0}
    )
    for student in students:
        for class_row in student.get("classes") or []:
            class_name = class_row.get("name") or "未命名班級"
            class_completion_stats[class_name]["students"] += 1
            class_completion_stats[class_name]["completed"] += int(
                student.get("completed_lectures", 0)
            )
            class_completion_stats[class_name]["expected"] += int(
                student.get("total_lectures", 0)
            )

    low_completion_classes = []
    for class_name, stats in class_completion_stats.items():
        completion_rate = _percent(stats["completed"], stats["expected"])
        if stats["students"] >= 5 and stats["expected"] > 0 and completion_rate < 50:
            low_completion_classes.append(
                {
                    "name": class_name,
                    "students": stats["students"],
                    "completion_rate": completion_rate,
                }
            )
    low_completion_classes.sort(key=lambda item: (item["completion_rate"], item["name"]))
    if low_completion_classes:
        class_count = len(low_completion_classes)
        lowest_rate = low_completion_classes[0]["completion_rate"]
        recommendations.append(
            {
                "id": "class-completion",
                "category": "engagement",
                "priority": "high" if lowest_rate < 30 else "medium",
                "title": (
                    f"{low_completion_classes[0]['name']}的課程完成率偏低"
                    if class_count == 1
                    else f"{class_count} 個班級的課程完成率偏低"
                ),
                "evidence": "、".join(
                    f"{item['name']} {item['completion_rate']}%（{item['students']} 人）"
                    for item in low_completion_classes
                ) + "。",
                "action": "確認課程進度與截止時間，並針對完成率偏低的班級發送學習提醒。",
                "affected_classes": low_completion_classes,
            }
        )

    for lecture in lectures:
        combined_hotspots: dict[tuple[int, int], dict[str, Any]] = {}
        for hotspot_type, hotspots in (
            ("暫停", lecture.get("pause_hotspots") or []),
            ("跳轉", lecture.get("seek_hotspots") or []),
        ):
            for hotspot in hotspots:
                key = (int(hotspot.get("start") or 0), int(hotspot.get("end") or 0))
                item = combined_hotspots.setdefault(
                    key,
                    {"count": 0, "types": [], "knowledge_points": []},
                )
                item["count"] += int(hotspot.get("count") or 0)
                if hotspot_type not in item["types"]:
                    item["types"].append(hotspot_type)
                for title in hotspot.get("knowledge_points") or []:
                    if title not in item["knowledge_points"]:
                        item["knowledge_points"].append(title)

        if lecture.get("attempts", 0) >= 5 and lecture.get("accuracy", 0) < 65:
            ranked_hotspots = sorted(
                combined_hotspots.items(), key=lambda item: item[1]["count"], reverse=True
            )
            if ranked_hotspots and ranked_hotspots[0][1]["count"] >= minimum_interactions:
                (start, end), hotspot = ranked_hotspots[0]
                topic = "、".join(hotspot["knowledge_points"]) or "該段內容"
                recommendations.append(
                    {
                        "id": f"bottleneck-{lecture['id']}-{start}",
                        "category": "comprehension",
                        "priority": "high" if lecture.get("accuracy", 0) < 50 else "medium",
                        "title": f"{lecture['title']}可能有理解瓶頸",
                        "evidence": (
                            f"{start // 60}:{start % 60:02d}–{end // 60}:{end % 60:02d}"
                            f"累積 {hotspot['count']} 次{'／'.join(hotspot['types'])}，"
                            f"小節答題正確率為 {lecture.get('accuracy', 0)}%。"
                        ),
                        "action": f"建議在「{topic}」補充步驟說明、圖例或示範題。",
                        "lecture_id": lecture["id"],
                        "timestamp": start,
                    }
                )

    low_accuracy_questions = sorted(
        (
            question
            for question in questions
            if question.get("students_answered", 0) > enrolled_count / 4
            and question.get("accuracy", 0) < 50
        ),
        key=lambda question: (
            question.get("accuracy", 0),
            -question.get("students_answered", 0),
        ),
    )[:2]
    for question in low_accuracy_questions:
        recommendations.append(
            {
                "id": f"question-{question['id']}",
                "category": "question",
                "priority": "high" if question.get("accuracy", 0) < 25 else "medium",
                "title": "有題目需要檢查",
                "evidence": (
                    f"「{question.get('text')}」已有 {question.get('students_answered', 0)} 位學生作答，"
                    f"正確率只有 {question.get('accuracy', 0)}%。"
                ),
                "action": "檢查題目敘述、正確答案與影片內容是否一致，再決定是否補充講解。",
                "lecture_id": question.get("lecture_id"),
                "question_id": question["id"],
            }
        )

    class_stats: dict[str, dict[str, float]] = defaultdict(
        lambda: {"students": 0, "attempts": 0, "estimated_correct": 0}
    )
    for student in students:
        if student.get("attempts", 0) <= 0:
            continue
        for class_row in student.get("classes") or []:
            class_name = class_row.get("name") or "未命名班級"
            class_stats[class_name]["students"] += 1
            class_stats[class_name]["attempts"] += student.get("attempts", 0)
            class_stats[class_name]["estimated_correct"] += (
                student.get("attempts", 0) * student.get("accuracy", 0) / 100
            )
    comparable_classes = []
    for class_name, stats in class_stats.items():
        if stats["students"] >= 5 and stats["attempts"] >= 10:
            comparable_classes.append(
                {
                    "name": class_name,
                    "students": int(stats["students"]),
                    "accuracy": round(stats["estimated_correct"] / stats["attempts"] * 100),
                }
            )
    if len(comparable_classes) >= 2:
        comparable_classes.sort(key=lambda item: item["accuracy"])
        lowest = comparable_classes[0]
        highest = comparable_classes[-1]
        if highest["accuracy"] - lowest["accuracy"] >= 20:
            recommendations.append(
                {
                    "id": f"class-gap-{lowest['name']}-{highest['name']}",
                    "category": "class_gap",
                    "priority": "medium",
                    "title": "班級間的答題表現有明顯差距",
                    "evidence": (
                        f"{lowest['name']}正確率為 {lowest['accuracy']}%，"
                        f"{highest['name']}為 {highest['accuracy']}%，相差 "
                        f"{highest['accuracy'] - lowest['accuracy']} 個百分點。"
                    ),
                    "action": f"建議確認{lowest['name']}的先備知識，並安排針對性複習。",
                }
            )

    priority_order = {"high": 0, "medium": 1, "low": 2}
    return sorted(
        recommendations,
        key=lambda item: (priority_order.get(item["priority"], 9), item["id"]),
    )[:8]


def _parse_datetime(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


@router.post("/analytics/courses/{course_id}/recommendations/snooze")
def snooze_teaching_recommendation(
    course_id: int,
    payload: RecommendationSnoozeRequest,
    user=Depends(get_current_user),
):
    teacher = require_teacher(user)
    require_course_manager(course_id, teacher)
    recommendation_id = payload.recommendation_id.strip()
    if not recommendation_id or len(recommendation_id) > 160:
        raise HTTPException(status_code=400, detail="無效的教學建議")
    if payload.days not in {1, 3, 7, 14, 30}:
        raise HTTPException(status_code=400, detail="延後天數只能選擇 1、3、7、14 或 30 天")

    now = datetime.now(timezone.utc)
    snoozed_until = now + timedelta(days=payload.days)
    response = (
        supabase_admin.table("teaching_recommendation_snoozes")
        .upsert(
            {
                "user_id": teacher["id"],
                "course_id": course_id,
                "recommendation_key": recommendation_id,
                "snoozed_until": snoozed_until.isoformat(),
                "updated_at": now.isoformat(),
            },
            on_conflict="user_id,course_id,recommendation_key",
        )
        .execute()
    )
    row = (response.data or [{}])[0]
    return {
        "recommendation_id": recommendation_id,
        "snoozed_until": row.get("snoozed_until", snoozed_until.isoformat()),
    }


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
    if not profile or not has_teacher_access(profile.get("role")):
        raise HTTPException(status_code=403, detail="Teacher or campus access required")

    course_query = supabase_admin.table("courses").select("*")
    if profile.get("role") == CAMPUS_ROLE:
        course_query = course_query.eq("created_by_user_id", profile["id"])
    else:
        course_query = course_query.eq("teacher_id", profile["id"])
    courses = course_query.order("created_at").execute().data or []
    course_ids = [course["id"] for course in courses]
    if not course_ids:
        return {"teacher": profile, "courses": []}

    snooze_rows = (
        supabase_admin.table("teaching_recommendation_snoozes")
        .select("course_id,recommendation_key,snoozed_until")
        .eq("user_id", profile["id"])
        .in_("course_id", course_ids)
        .execute()
        .data
        or []
    )
    now = datetime.now(timezone.utc)
    active_snoozes = {
        (row.get("course_id"), row.get("recommendation_key"))
        for row in snooze_rows
        if (_parse_datetime(row.get("snoozed_until")) or datetime.min.replace(tzinfo=timezone.utc)) > now
    }

    lectures = _rows("lectures", course_id=course_ids)
    lecture_ids = [lecture["id"] for lecture in lectures]
    students = (
        supabase_admin.table("users")
        .select("id,student_number,name,email,role,class_id")
        .eq("role", "student")
        .order("id")
        .execute()
    ).data or []
    all_student_ids = {row["id"] for row in students}
    class_ids = {
        row["class_id"] for row in students if row.get("class_id") is not None
    }
    class_rows = _rows("classes", id=class_ids)
    class_map = {row["id"]: row for row in class_rows}
    enrollments = (
        supabase_admin.table("student_courses")
        .select("student_id,course_id")
        .in_("course_id", course_ids)
        .execute()
        .data
        or []
    )
    progresses = _rows("video_progresses", lecture_id=lecture_ids)
    events = _rows("learning_events", lecture_id=lecture_ids)
    attempts = _rows("question_attempts", lecture_id=lecture_ids)
    questions = _rows("questions", lecture_id=lecture_ids)
    knowledge_points = _rows("knowledge_points", lecture_id=lecture_ids)
    final_attempts = _rows("final_assessment_attempts", course_id=course_ids)
    certificates = _rows("course_certifications", course_id=course_ids)
    certificates = [row for row in certificates if row.get("final_attempt_id")]
    final_questions = _rows("final_assessment_questions", course_id=course_ids)

    student_map = {}
    for row in students:
        class_row = class_map.get(row.get("class_id"))
        student_map[row["id"]] = {
            **row,
            "classes": (
                [{"id": class_row["id"], "name": class_row.get("name") or "未命名班級"}]
                if class_row
                else []
            ),
        }
    result_courses = []

    for course in courses:
        cid = course["id"]
        course_student_ids = _enrolled_student_ids(enrollments, cid, all_student_ids)
        course_lectures = [row for row in lectures if row.get("course_id") == cid]
        course_lecture_ids = {row["id"] for row in course_lectures}
        course_progresses = [
            row
            for row in progresses
            if row.get("lecture_id") in course_lecture_ids
            and row.get("student_id") in course_student_ids
        ]
        course_events = [
            row
            for row in events
            if row.get("lecture_id") in course_lecture_ids
            and row.get("student_id") in course_student_ids
        ]
        course_attempts = [
            row
            for row in attempts
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
            lecture_progresses = [
                row for row in course_progresses if row.get("lecture_id") == lid
            ]
            lecture_events = [
                row for row in course_events if row.get("lecture_id") == lid
            ]
            lecture_attempts = [
                row for row in course_attempts if row.get("lecture_id") == lid
            ]
            lecture_knowledge_points = [
                row
                for row in knowledge_points
                if row.get("lecture_id") == lid and row.get("is_active", True)
            ]
            lecture_correct = sum(
                bool(row.get("is_correct")) for row in lecture_attempts
            )
            event_counts: dict[str, int] = defaultdict(int)
            for event in lecture_events:
                event_counts[event.get("event_type") or "unknown"] += 1

            lecture_students = []
            for student_id in sorted(course_student_ids):
                student = student_map.get(student_id, {"id": student_id})
                lecture_students.append(
                    _student_scope_result(
                        student,
                        [
                            row
                            for row in lecture_progresses
                            if row.get("student_id") == student_id
                        ],
                        [
                            row
                            for row in lecture_events
                            if row.get("student_id") == student_id
                        ],
                        [
                            row
                            for row in lecture_attempts
                            if row.get("student_id") == student_id
                        ],
                        1,
                    )
                )

            lecture_results.append(
                {
                    "id": lid,
                    "title": lecture.get("title") or f"小節 {lid}",
                    "students_started": len(
                        {row["student_id"] for row in lecture_progresses}
                    ),
                    "students_completed": sum(
                        bool(row.get("completed")) for row in lecture_progresses
                    ),
                    "completion_rate": _percent(
                        sum(bool(row.get("completed")) for row in lecture_progresses),
                        len(course_student_ids),
                    ),
                    "watched_minutes": round(
                        sum(
                            row.get("watched_seconds") or 0
                            for row in lecture_progresses
                        )
                        / 60,
                        1,
                    ),
                    "pause_count": event_counts["pause"],
                    "seek_count": event_counts["seek"],
                    "questions_asked": event_counts["question_asked"],
                    "attempts": len(lecture_attempts),
                    "accuracy": _percent(lecture_correct, len(lecture_attempts)),
                    "pause_hotspots": _hotspots(
                        lecture_events, "pause", lecture_knowledge_points
                    ),
                    "seek_hotspots": _hotspots(
                        lecture_events, "seek", lecture_knowledge_points
                    ),
                    "students": lecture_students,
                }
            )

        student_results = []
        for student_id in sorted(course_student_ids):
            student = student_map.get(student_id, {})
            student_progress = [
                row for row in course_progresses if row.get("student_id") == student_id
            ]
            student_events = [
                row for row in course_events if row.get("student_id") == student_id
            ]
            student_attempts = [
                row for row in course_attempts if row.get("student_id") == student_id
            ]
            scope_result = _student_scope_result(
                student,
                student_progress,
                student_events,
                student_attempts,
                len(course_lectures),
            )
            credit_result = evaluate_course(
                course,
                course_lectures,
                student_progress,
                [
                    row
                    for row in final_attempts
                    if row.get("course_id") == cid
                    and row.get("student_id") == student_id
                ],
                next(
                    (
                        row
                        for row in certificates
                        if row.get("course_id") == cid
                        and row.get("student_id") == student_id
                    ),
                    None,
                ),
                sum(
                    1
                    for row in final_questions
                    if row.get("course_id") == cid and row.get("is_active", True)
                ),
            )
            student_results.append(
                {
                    **scope_result,
                    "course_passed": credit_result["course_passed"],
                    "credits_earned": credit_result["credits_earned"],
                    "credits_total": credit_result["credits_total"],
                    "final_score": credit_result["final_score"],
                }
            )

        question_results = []
        question_stats = question_attempt_statistics(course_attempts)
        course_questions = [
            row
            for row in questions
            if row.get("lecture_id") in course_lecture_ids
            and row.get("is_active", True)
            and (row.get("question_type") or "original") == "original"
            and (row.get("review_status") or "published") == "published"
        ]
        for question in course_questions:
            question_id = question.get("id")
            question_attempts = [
                row for row in course_attempts if row.get("question_id") == question_id
            ]
            stats = question_stats.get(question_id, {})
            question_results.append(
                {
                    "id": question_id,
                    "lecture_id": question.get("lecture_id"),
                    "text": question.get("question_text") or f"題目 {question_id}",
                    "attempts": stats.get("attempt_count", len(question_attempts)),
                    "students_answered": len(
                        {
                            attempt.get("student_id")
                            for attempt in question_attempts
                            if attempt.get("student_id") is not None
                        }
                    ),
                    "accuracy": stats.get("accuracy", 0),
                    "has_attempts": bool(question_attempts),
                    "source_timestamp": question.get("source_timestamp"),
                }
            )

        recommendations = _teaching_recommendations(
            lecture_results,
            student_results,
            question_results,
        )
        recommendations = [
            item
            for item in recommendations
            if (cid, item["id"]) not in active_snoozes
        ]

        result_courses.append(
            {
                "id": cid,
                "title": course.get("title") or f"課程 {cid}",
                "summary": {
                    "students": len(course_student_ids),
                    "active_students": len(active_students),
                    "lectures": len(course_lectures),
                    "completion_rate": _percent(completed_count, expected_completions),
                    "watched_hours": round(
                        sum(
                            row.get("watched_seconds") or 0 for row in course_progresses
                        )
                        / 3600,
                        1,
                    ),
                    "question_accuracy": _percent(correct_count, len(course_attempts)),
                },
                "lectures": lecture_results,
                "students": student_results,
                "questions": sorted(
                    question_results,
                    key=lambda row: (row["accuracy"], -row["attempts"]),
                ),
                "recommendations": recommendations,
            }
        )

    return {"teacher": profile, "courses": result_courses}
