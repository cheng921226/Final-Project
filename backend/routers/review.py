import json
from collections import Counter
from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException

from .security import get_current_user
from .users import get_student_id_from_auth

router = APIRouter()


def normalize_answer(value: Any) -> str:
    text = str(value or "").strip().upper()
    return text[0] if text else ""


def parse_summary_text(value: Any) -> str:
    if not value:
        return ""
    if isinstance(value, dict):
        return str(value.get("summary") or value)
    if not isinstance(value, str):
        return str(value)
    try:
        parsed = json.loads(value)
    except (TypeError, ValueError):
        return value
    if isinstance(parsed, dict):
        return str(parsed.get("summary") or parsed)
    return str(parsed)


def rows_by_id(rows: list[dict[str, Any]]) -> dict[Any, dict[str, Any]]:
    return {row.get("id"): row for row in rows}


def latest_attempts_by_question(
    attempts: list[dict[str, Any]]
) -> dict[Any, dict[str, Any]]:
    latest: dict[Any, dict[str, Any]] = {}
    for attempt in attempts:
        question_id = attempt.get("question_id")
        if question_id is None:
            continue
        previous = latest.get(question_id)
        if not previous or str(attempt.get("answered_at") or "") > str(
            previous.get("answered_at") or ""
        ):
            latest[question_id] = attempt
    return latest


@router.get("/lectures/{lecture_id}/review")
def get_lecture_review(lecture_id: int, user=Depends(get_current_user)):
    student_id = get_student_id_from_auth(user)
    lecture = get_lecture(lecture_id)
    if not lecture:
        raise HTTPException(status_code=404, detail="Lecture not found")

    return build_review_payload(
        student_id=student_id,
        lecture_ids=[lecture_id],
        scope={
            "type": "lecture",
            "lecture_id": lecture_id,
            "course_id": lecture.get("course_id"),
            "title": lecture.get("title") or lecture.get("course_name"),
        },
    )


@router.get("/courses/{course_id}/review")
def get_course_review(course_id: int, user=Depends(get_current_user)):
    student_id = get_student_id_from_auth(user)
    course = get_course(course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    lectures = get_course_lectures(course_id)
    lecture_ids = [lecture["id"] for lecture in lectures if lecture.get("id") is not None]

    return build_review_payload(
        student_id=student_id,
        lecture_ids=lecture_ids,
        scope={
            "type": "course",
            "course_id": course_id,
            "title": course.get("title") or course.get("course_name") or "未命名課程",
            "lecture_count": len(lectures),
        },
    )


def get_course(course_id: int) -> dict[str, Any] | None:
    response = (
        supabase_admin.table("courses")
        .select("*")
        .eq("id", course_id)
        .maybe_single()
        .execute()
    )
    return response.data


def get_lecture(lecture_id: int) -> dict[str, Any] | None:
    response = (
        supabase_admin.table("lectures")
        .select("*")
        .eq("id", lecture_id)
        .maybe_single()
        .execute()
    )
    return response.data


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


def build_review_payload(
    student_id: int,
    lecture_ids: list[int],
    scope: dict[str, Any],
) -> dict[str, Any]:
    if not lecture_ids:
        return empty_review_payload(scope)

    lectures = (
        supabase_admin.table("lectures")
        .select("*")
        .in_("id", lecture_ids)
        .execute()
        .data
        or []
    )
    lecture_map = rows_by_id(lectures)

    attempts = (
        supabase_admin.table("question_attempts")
        .select("*")
        .in_("lecture_id", lecture_ids)
        .eq("student_id", student_id)
        .execute()
        .data
        or []
    )

    questions = (
        supabase_admin.table("questions")
        .select(
            "id, lecture_id, knowledge_point_id, question_text, options_json, "
            "answer, explanation, source_timestamp"
        )
        .in_("lecture_id", lecture_ids)
        .execute()
        .data
        or []
    )

    knowledge_points = (
        supabase_admin.table("knowledge_points")
        .select("id, lecture_id, title, description, start_time, end_time")
        .in_("lecture_id", lecture_ids)
        .execute()
        .data
        or []
    )

    summaries = (
        supabase_admin.table("summaries")
        .select("lecture_id, summary_text")
        .in_("lecture_id", lecture_ids)
        .execute()
        .data
        or []
    )

    question_map = rows_by_id(questions)
    kp_map = rows_by_id(knowledge_points)
    latest_attempts = latest_attempts_by_question(attempts)
    wrong_attempts = [
        attempt for attempt in latest_attempts.values() if not attempt.get("is_correct")
    ]

    wrong_questions = []
    weak_counter: Counter[Any] = Counter()
    for attempt in wrong_attempts:
        question = question_map.get(attempt.get("question_id"))
        if not question:
            continue
        selected_answer = normalize_answer(attempt.get("selected_answer"))
        correct_answer = normalize_answer(question.get("answer"))
        kp = kp_map.get(question.get("knowledge_point_id"))
        if kp:
            weak_counter[kp.get("id")] += 1
        wrong_questions.append(
            {
                "question_id": question.get("id"),
                "lecture_id": question.get("lecture_id"),
                "lecture": lecture_map.get(question.get("lecture_id")),
                "question_text": question.get("question_text"),
                "options_json": question.get("options_json") or [],
                "selected_answer": selected_answer,
                "correct_answer": correct_answer,
                "explanation": question.get("explanation"),
                "source_timestamp": question.get("source_timestamp"),
                "knowledge_point": kp,
                "answered_at": attempt.get("answered_at"),
            }
        )

    recommended = []
    for kp_id, count in weak_counter.most_common():
        kp = kp_map.get(kp_id)
        if not kp:
            continue
        recommended.append(
            {
                    **kp,
                    "lecture": lecture_map.get(kp.get("lecture_id")),
                    "priority": count,
                    "reason": f"最近作答紀錄中，這個知識點相關題目答錯 {count} 次。",
                }
        )

    if not recommended:
        for kp in knowledge_points[:5]:
            recommended.append(
                {
                    **kp,
                    "lecture": lecture_map.get(kp.get("lecture_id")),
                    "priority": 0,
                    "reason": "目前沒有未訂正錯題，建議先複習課程主要知識點。",
                }
            )

    answered_question_ids = set(latest_attempts.keys())
    mock_questions = [
        {
            "question_id": question.get("id"),
            "lecture_id": question.get("lecture_id"),
            "lecture": lecture_map.get(question.get("lecture_id")),
            "question_text": question.get("question_text"),
            "options_json": question.get("options_json") or [],
            "source_timestamp": question.get("source_timestamp"),
            "knowledge_point_id": question.get("knowledge_point_id"),
        }
        for question in questions
        if question.get("id") not in answered_question_ids
    ][:5]

    if not mock_questions:
        mock_questions = [
            {
                "question_id": question.get("id"),
                "lecture_id": question.get("lecture_id"),
                "lecture": lecture_map.get(question.get("lecture_id")),
                "question_text": question.get("question_text"),
                "options_json": question.get("options_json") or [],
                "source_timestamp": question.get("source_timestamp"),
                "knowledge_point_id": question.get("knowledge_point_id"),
            }
            for question in questions[:5]
        ]

    summary_parts = [
        parse_summary_text(summary.get("summary_text"))
        for summary in summaries
        if parse_summary_text(summary.get("summary_text"))
    ]
    summary_text = "\n\n".join(summary_parts)
    if wrong_questions:
        review_summary = (
            "本次複習建議先從錯題相關知識點開始，重新閱讀推薦知識點後，"
            "再回到錯題解析確認自己是否理解。"
        )
    else:
        review_summary = (
            "目前沒有需要訂正的錯題，可以先快速瀏覽摘要與推薦知識點，"
            "再使用下方模擬題檢查理解程度。"
        )

    return {
        **scope,
        "stats": {
            "attempt_count": len(attempts),
            "latest_attempt_count": len(latest_attempts),
            "wrong_count": len(wrong_questions),
            "recommended_count": len(recommended),
            "lecture_count": len(lecture_ids),
            "question_count": len(questions),
        },
        "recommended_knowledge_points": recommended,
        "wrong_questions": wrong_questions,
        "weaknesses": [
            {
                "knowledge_point": kp_map.get(kp_id),
                "lecture": lecture_map.get(kp_map.get(kp_id, {}).get("lecture_id")),
                "wrong_count": count,
                "reason": "此知識點相關題目目前仍答錯，適合作為優先複習項目。",
            }
            for kp_id, count in weak_counter.most_common()
            if kp_map.get(kp_id)
        ],
        "summary_review": {
            "summary": summary_text,
            "suggestion": review_summary,
        },
        "mock_questions": mock_questions,
    }


def empty_review_payload(scope: dict[str, Any]) -> dict[str, Any]:
    return {
        **scope,
        "stats": {
            "attempt_count": 0,
            "latest_attempt_count": 0,
            "wrong_count": 0,
            "recommended_count": 0,
            "lecture_count": 0,
            "question_count": 0,
        },
        "recommended_knowledge_points": [],
        "wrong_questions": [],
        "weaknesses": [],
        "summary_review": {
            "summary": "",
            "suggestion": "這門課目前還沒有小節資料，因此尚無法產生複習內容。",
        },
        "mock_questions": [],
    }
