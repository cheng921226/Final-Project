import json
from collections import Counter
from typing import Any

from database.supabase import fetch_all_by_id, supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from postgrest.exceptions import APIError
from pydantic import BaseModel

from services.question_statistics import (
    ASSESSMENT_PASS_THRESHOLD,
    first_attempts_by_question,
    question_mastery,
)

from .final_assessment import require_enrollment
from .security import AuthContext, get_auth_context

router = APIRouter()

RETEST_MAX_QUESTIONS = 10


class RetestAnswer(BaseModel):
    question_id: int
    selected_answer: str


class RetestSubmitPayload(BaseModel):
    answers: list[RetestAnswer]


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
    attempts: list[dict[str, Any]],
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


def percent_ratio(correct: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round(correct / total, 4)


def is_original_question(question: dict[str, Any]) -> bool:
    return (question.get("question_type") or "original") == "original"


def select_questions(lecture_ids: list[int]) -> list[dict[str, Any]]:
    return fetch_all_by_id(
        lambda: supabase_admin.table("questions")
        .select(
            "id, lecture_id, knowledge_point_id, question_text, options_json, "
            "answer, explanation, source_timestamp, question_type, source_question_id, "
            "status"
        )
        .in_("lecture_id", lecture_ids)
        .eq("status", "published")
    )


def get_course_scope(
    course_id: int, student_id: int
) -> tuple[dict[str, Any], list[dict[str, Any]], list[int]]:
    course = require_review_course(course_id, student_id)
    lectures = [
        lecture for lecture in get_course_lectures(course_id)
        if lecture.get("is_visible", True)
    ]
    lecture_ids = [
        lecture["id"] for lecture in lectures if lecture.get("id") is not None
    ]
    return course, lectures, lecture_ids


def review_student_id(context: AuthContext) -> int:
    if context.profile.get("role") != "student":
        raise HTTPException(status_code=403, detail="請使用學生帳號開啟課程複習")
    return context.profile["id"]


def require_review_course(course_id: int, student_id: int) -> dict[str, Any]:
    course = get_course(course_id)
    if not course or course.get("status") != "published":
        raise HTTPException(status_code=404, detail="找不到已發布的課程")
    require_enrollment(student_id, course_id)
    return course


@router.get("/lectures/{lecture_id}/review")
def get_lecture_review(
    lecture_id: int, context: AuthContext = Depends(get_auth_context),
):
    student_id = review_student_id(context)
    lecture = get_lecture(lecture_id)
    if not lecture or not lecture.get("is_visible", True):
        raise HTTPException(status_code=404, detail="找不到小節")
    require_review_course(lecture["course_id"], student_id)

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
def get_course_review(
    course_id: int, context: AuthContext = Depends(get_auth_context),
):
    student_id = review_student_id(context)
    course, lectures, lecture_ids = get_course_scope(course_id, student_id)

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


@router.post("/courses/{course_id}/review/retest/start")
def start_course_retest(
    course_id: int, context: AuthContext = Depends(get_auth_context),
):
    student_id = review_student_id(context)
    _, _, lecture_ids = get_course_scope(course_id, student_id)
    if not lecture_ids:
        raise HTTPException(status_code=400, detail="這門課目前沒有小節資料")

    review = build_review_context(student_id, lecture_ids)
    assessment = build_assessment_status(
        student_id=student_id,
        course_id=course_id,
        questions=review["questions"],
        attempts=review["attempts"],
        mastery=review["mastery"],
    )
    original_accuracy = assessment.get("original_accuracy")
    pending_wrong = [
        question for question in review["historical_wrong_questions"]
        if question["id"] not in review["mastered_question_ids"]
    ]

    try:
        existing = (
            supabase_admin.table("retest_sessions")
            .select("*")
            .eq("student_id", student_id)
            .eq("course_id", course_id)
            .eq("status", "in_progress")
            .order("started_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
    except APIError as exc:
        raise HTTPException(
            status_code=500,
            detail="無法讀取補充練習，請稍後重試。",
        ) from exc
    session = existing[0] if existing else None
    if session:
        available_questions = questions_for_retest_session(session, review)
        if available_questions:
            return {
                "status": "in_progress",
                "session": session,
                "assessment": assessment,
                "questions": available_questions,
            }

    selected_questions = compose_retest_questions(
        pending_wrong, review["extensions_by_source"], review["retest_attempts"]
    )
    if not selected_questions:
        raise HTTPException(status_code=400, detail="目前沒有可補測的題目")

    completed_sessions = (
        supabase_admin.table("retest_sessions")
        .select("id")
        .eq("student_id", student_id)
        .eq("course_id", course_id)
        .execute()
        .data
        or []
    )
    attempt_number = len(completed_sessions) + 1
    question_ids = [question["id"] for question in selected_questions]
    session_row = {
        "student_id": student_id,
        "course_id": course_id,
        "original_accuracy": original_accuracy,
        "pass_threshold": ASSESSMENT_PASS_THRESHOLD,
        "total_questions": len(question_ids),
        "correct_questions": 0,
        "status": "in_progress",
        "attempt_number": attempt_number,
        "question_ids": question_ids,
    }
    try:
        query = supabase_admin.table("retest_sessions")
        if session:
            response = (
                query.update({"question_ids": question_ids, "total_questions": len(question_ids)})
                .eq("id", session["id"])
                .eq("status", "in_progress")
                .execute()
            )
        else:
            response = query.insert(session_row).execute()
    except APIError as exc:
        raise HTTPException(
            status_code=500,
            detail="無法建立補充練習，請稍後重試。",
        ) from exc

    if not response.data:
        raise HTTPException(status_code=409, detail="練習已更新，請重新開始")
    session = response.data[0]
    return {
        "status": "created",
        "session": session,
        "assessment": assessment,
        "questions": public_retest_questions(selected_questions),
    }


@router.post("/review/retest-sessions/{session_id}/submit")
def submit_retest_session(
    session_id: int,
    payload: RetestSubmitPayload,
    context: AuthContext = Depends(get_auth_context),
):
    student_id = review_student_id(context)
    session = (
        supabase_admin.table("retest_sessions")
        .select("course_id")
        .eq("id", session_id)
        .eq("student_id", student_id)
        .maybe_single()
        .execute()
    )
    if not session or not session.data:
        raise HTTPException(status_code=404, detail="找不到補充練習")
    require_review_course(session.data["course_id"], student_id)

    answers = {
        str(answer.question_id): answer.selected_answer.strip().upper()
        for answer in payload.answers
    }
    if not answers or len(answers) != len(payload.answers) or any(
        len(value) != 1 or not ("A" <= value <= "Z") for value in answers.values()
    ):
        raise HTTPException(status_code=422, detail="請為每道補練題目選擇一個答案")

    try:
        return supabase_admin.rpc(
            "submit_review_practice",
            {
                "target_session_id": session_id,
                "target_student_id": student_id,
                "submitted_answers": answers,
            },
        ).execute().data
    except APIError as exc:
        if exc.code in {"PT404", "PT409"}:
            raise HTTPException(status_code=int(exc.code[2:]), detail=exc.message) from exc
        raise


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
    return fetch_all_by_id(
        lambda: supabase_admin.table("lectures").select("*").eq("course_id", course_id)
    )


def build_review_context(student_id: int, lecture_ids: list[int]) -> dict[str, Any]:
    lectures = (
        supabase_admin.table("lectures")
        .select("*")
        .in_("id", lecture_ids)
        .execute()
        .data
        or []
    )
    lecture_map = rows_by_id(lectures)

    attempts = fetch_all_by_id(
        lambda: supabase_admin.table("question_attempts")
        .select("*")
        .in_("lecture_id", lecture_ids)
        .eq("student_id", student_id)
    )

    questions = select_questions(lecture_ids)
    question_map = rows_by_id(questions)
    original_questions = [
        question for question in questions if is_original_question(question)
    ]
    extension_questions = [
        question
        for question in questions
        if (question.get("question_type") or "") == "extension"
    ]
    extensions_by_source: dict[Any, list[dict[str, Any]]] = {}
    for question in extension_questions:
        source_id = question.get("source_question_id")
        if source_id is None:
            continue
        extensions_by_source.setdefault(source_id, []).append(question)

    initial_attempts = [
        attempt
        for attempt in attempts
        if (attempt.get("attempt_type") or "initial") == "initial"
    ]
    retest_attempts = [
        attempt for attempt in attempts if attempt.get("attempt_type") == "retest"
    ]
    first_initial_attempts = first_attempts_by_question(initial_attempts)

    historical_wrong_questions = []
    for attempt in first_initial_attempts.values():
        if attempt.get("is_correct"):
            continue
        question = question_map.get(attempt.get("question_id"))
        if not question or not is_original_question(question):
            continue
        historical_wrong_questions.append(question)

    mastery, mastered_question_ids = question_mastery(questions, attempts)

    return {
        "lectures": lectures,
        "lecture_map": lecture_map,
        "attempts": attempts,
        "initial_attempts": initial_attempts,
        "retest_attempts": retest_attempts,
        "first_initial_attempts": first_initial_attempts,
        "questions": questions,
        "question_map": question_map,
        "original_questions": original_questions,
        "extension_questions": extension_questions,
        "extensions_by_source": extensions_by_source,
        "historical_wrong_questions": historical_wrong_questions,
        "mastery": mastery,
        "mastered_question_ids": mastered_question_ids,
    }


def build_assessment_status(
    student_id: int,
    course_id: int | None,
    questions: list[dict[str, Any]],
    attempts: list[dict[str, Any]],
    mastery: dict[str, Any],
) -> dict[str, Any]:
    original_questions = [
        question for question in questions if is_original_question(question)
    ]
    original_question_ids = {question.get("id") for question in original_questions}
    initial_attempts = [
        attempt
        for attempt in attempts
        if (attempt.get("attempt_type") or "initial") == "initial"
        and attempt.get("question_id") in original_question_ids
    ]
    first_initial = first_attempts_by_question(initial_attempts)
    original_total = len(first_initial)
    original_correct = sum(
        1 for attempt in first_initial.values() if attempt.get("is_correct")
    )
    original_accuracy = percent_ratio(original_correct, original_total)

    latest_session = None
    if course_id is not None:
        try:
            sessions = (
                supabase_admin.table("retest_sessions")
                .select("*")
                .eq("student_id", student_id)
                .eq("course_id", course_id)
                .order("started_at", desc=True)
                .limit(1)
                .execute()
                .data
                or []
            )
            latest_session = sessions[0] if sessions else None
        except Exception:
            latest_session = None

    retest_accuracy = latest_session.get("retest_accuracy") if latest_session else None
    retest_status = latest_session.get("status") if latest_session else None
    return {
        **mastery,
        "pass_threshold": ASSESSMENT_PASS_THRESHOLD,
        "original_total": original_total,
        "original_correct": original_correct,
        "original_accuracy": original_accuracy,
        "retest_accuracy": retest_accuracy,
        "retest_status": retest_status,
        "latest_retest_session": latest_session,
        "passed": mastery["mastery_passed"],
        "needs_retest": mastery["has_unmastered_wrong_questions"],
    }


def public_retest_questions(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "question_id": question.get("id"),
            "lecture_id": question.get("lecture_id"),
            "question_text": question.get("question_text"),
            "options_json": question.get("options_json") or [],
            "source_timestamp": question.get("source_timestamp"),
            "knowledge_point_id": question.get("knowledge_point_id"),
            "question_type": question.get("question_type") or "original",
            "source_question_id": question.get("source_question_id"),
        }
        for question in questions
    ]


def compose_retest_questions(
    pending_wrong: list[dict[str, Any]],
    extensions_by_source: dict[int, list[dict[str, Any]]],
    retest_attempts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    attempt_count = Counter(attempt.get("question_id") for attempt in retest_attempts)
    candidates = [
        [*extensions_by_source.get(question["id"], []), question]
        for question in pending_wrong
    ]
    candidates.sort(key=lambda group: sum(attempt_count[question["id"]] for question in group))
    return [
        min(group, key=lambda question: attempt_count[question["id"]])
        for group in candidates[:RETEST_MAX_QUESTIONS]
    ]


def questions_for_retest_session(
    session: dict[str, Any],
    context: dict[str, Any],
) -> list[dict[str, Any]]:
    question_ids = [int(qid) for qid in session.get("question_ids") or []]
    question_map = context["question_map"]
    return public_retest_questions(
        [question_map[qid] for qid in question_ids if qid in question_map]
    )


def build_review_payload(
    student_id: int,
    lecture_ids: list[int],
    scope: dict[str, Any],
) -> dict[str, Any]:
    if not lecture_ids:
        return empty_review_payload(scope)

    context = build_review_context(student_id, lecture_ids)
    lecture_map = context["lecture_map"]
    attempts = context["attempts"]
    questions = context["questions"]
    original_questions = context["original_questions"]
    first_initial_attempts = context["first_initial_attempts"]
    historical_wrong_questions = context["historical_wrong_questions"]

    knowledge_points = (
        supabase_admin.table("knowledge_points")
        .select("id, lecture_id, title, description, start_time, end_time")
        .in_("lecture_id", lecture_ids)
        .eq("is_active", True)
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

    kp_map = rows_by_id(knowledge_points)
    assessment_status = build_assessment_status(
        student_id=student_id,
        course_id=scope.get("course_id"),
        questions=questions,
        attempts=attempts,
        mastery=context["mastery"],
    )

    wrong_questions = []
    weak_counter: Counter[Any] = Counter()
    latest_retest_attempts = latest_attempts_by_question(context["retest_attempts"])
    for question in historical_wrong_questions:
        attempt = first_initial_attempts.get(question.get("id"))
        selected_answer = normalize_answer(attempt.get("selected_answer"))
        correct_answer = normalize_answer(question.get("answer"))
        kp = kp_map.get(question.get("knowledge_point_id"))
        retest_mastered = question["id"] in context["mastered_question_ids"]
        if kp and not retest_mastered:
            weak_counter[kp.get("id")] += 1
        related_retest_attempts = [
            latest_retest_attempts.get(question.get("id")),
            *[
                latest_retest_attempts.get(extension.get("id"))
                for extension in context["extensions_by_source"].get(
                    question.get("id"), []
                )
            ],
        ]
        related_retest_attempts = [row for row in related_retest_attempts if row]
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
                "initial_result": "wrong",
                "retest_status": "mastered"
                if retest_mastered
                else (
                    "needs_reinforcement" if related_retest_attempts else "not_retested"
                ),
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
                "reason": f"這個知識點有 {count} 題待訂正。",
            }
        )

    if not recommended:
        for kp in knowledge_points[:5]:
            recommended.append(
                {
                    **kp,
                    "lecture": lecture_map.get(kp.get("lecture_id")),
                    "priority": 0,
                    "reason": "課程主要知識點，可搭配小節內容複習。",
                }
            )

    summary_text = "\n\n".join(
        text for summary in summaries
        if (text := parse_summary_text(summary.get("summary_text")))
    )
    pending_count = sum(item["retest_status"] != "mastered" for item in wrong_questions)
    unanswered = [
        question for question in original_questions
        if question["id"] not in first_initial_attempts
        and question["id"] not in context["mastered_question_ids"]
    ]
    review_summary = (
        "先複習待訂正錯題相關的知識點，再做補充練習。"
        if pending_count else "可以搭配課程摘要和知識點整理學過的內容。"
    )

    return {
        **scope,
        "stats": {
            "attempt_count": len(attempts),
            "initial_attempt_count": len(context["initial_attempts"]),
            "retest_attempt_count": len(context["retest_attempts"]),
            "wrong_count": len(wrong_questions),
            "pending_wrong_count": pending_count,
            "unanswered_count": len(unanswered),
            "recommended_count": len(recommended),
            "lecture_count": len(lecture_ids),
            "question_count": len(original_questions),
            "extension_question_count": len(context["extension_questions"]),
        },
        "assessment": assessment_status,
        "next_lecture_id": min((question["lecture_id"] for question in unanswered), default=None),
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
        "mock_questions": [],
    }


def empty_review_payload(scope: dict[str, Any]) -> dict[str, Any]:
    return {
        **scope,
        "stats": {
            "attempt_count": 0,
            "initial_attempt_count": 0,
            "retest_attempt_count": 0,
            "wrong_count": 0,
            "pending_wrong_count": 0,
            "unanswered_count": 0,
            "recommended_count": 0,
            "lecture_count": 0,
            "question_count": 0,
            "extension_question_count": 0,
        },
        "assessment": {
            **question_mastery([], [])[0],
            "pass_threshold": ASSESSMENT_PASS_THRESHOLD,
            "original_total": 0,
            "original_correct": 0,
            "original_accuracy": None,
            "retest_accuracy": None,
            "retest_status": None,
            "latest_retest_session": None,
            "passed": False,
            "needs_retest": False,
        },
        "next_lecture_id": None,
        "recommended_knowledge_points": [],
        "wrong_questions": [],
        "weaknesses": [],
        "summary_review": {
            "summary": "",
            "suggestion": "這門課目前還沒有小節資料，因此尚無法產生複習內容。",
        },
        "mock_questions": [],
    }
