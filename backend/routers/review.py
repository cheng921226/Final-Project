import json
from collections import Counter
from datetime import datetime, timezone
from typing import Any

from database.supabase import supabase_admin
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .security import get_current_user
from .users import get_student_id_from_auth

router = APIRouter()

ASSESSMENT_PASS_THRESHOLD = 0.7
RETEST_MAX_QUESTIONS = 10
RETEST_ORIGINAL_RECHECK_LIMIT = 4


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


def first_attempts_by_question(
    attempts: list[dict[str, Any]],
) -> dict[Any, dict[str, Any]]:
    first: dict[Any, dict[str, Any]] = {}
    for attempt in attempts:
        question_id = attempt.get("question_id")
        if question_id is None:
            continue
        previous = first.get(question_id)
        if not previous or str(attempt.get("answered_at") or "") < str(
            previous.get("answered_at") or ""
        ):
            first[question_id] = attempt
    return first


def percent_ratio(correct: int, total: int) -> float | None:
    if total <= 0:
        return None
    return round(correct / total, 4)


def is_original_question(question: dict[str, Any]) -> bool:
    return (question.get("question_type") or "original") == "original"


def select_questions(lecture_ids: list[int]) -> list[dict[str, Any]]:
    try:
        return (
            supabase_admin.table("questions")
            .select(
                "id, lecture_id, knowledge_point_id, question_text, options_json, "
                "answer, explanation, source_timestamp, question_type, source_question_id"
            )
            .in_("lecture_id", lecture_ids)
            .execute()
            .data
            or []
        )
    except Exception:
        return (
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


def get_course_scope(course_id: int) -> tuple[dict[str, Any], list[dict[str, Any]], list[int]]:
    course = get_course(course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    lectures = get_course_lectures(course_id)
    lecture_ids = [
        lecture["id"] for lecture in lectures if lecture.get("id") is not None
    ]
    return course, lectures, lecture_ids


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
    course, lectures, lecture_ids = get_course_scope(course_id)

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
def start_course_retest(course_id: int, user=Depends(get_current_user)):
    student_id = get_student_id_from_auth(user)
    course, lectures, lecture_ids = get_course_scope(course_id)
    if not lecture_ids:
        raise HTTPException(status_code=400, detail="這門課目前沒有小節資料")

    context = build_review_context(student_id, lecture_ids)
    assessment = build_assessment_status(
        student_id=student_id,
        course_id=course_id,
        questions=context["questions"],
        attempts=context["attempts"],
    )
    original_accuracy = assessment.get("original_accuracy")
    historical_wrong = context["historical_wrong_questions"]
    if original_accuracy is not None and original_accuracy >= ASSESSMENT_PASS_THRESHOLD:
        return {
            "status": "already_passed",
            "assessment": assessment,
            "questions": [],
        }
    if not historical_wrong:
        raise HTTPException(status_code=400, detail="目前沒有可補測的歷史錯題")

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
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"讀取補測 session 失敗，請先執行 review retest SQL migration。原始錯誤：{exc}",
        ) from exc
    if existing:
        session = existing[0]
        return {
            "status": "in_progress",
            "session": session,
            "assessment": assessment,
            "questions": questions_for_retest_session(session, context),
        }

    selected_questions = compose_retest_questions(
        historical_wrong,
        context["extensions_by_source"],
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
        response = supabase_admin.table("retest_sessions").insert(session_row).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"建立補測 session 失敗，請先執行 review retest SQL migration。原始錯誤：{exc}",
        ) from exc

    session = (response.data or [session_row])[0]
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
    user=Depends(get_current_user),
):
    student_id = get_student_id_from_auth(user)
    session_response = (
        supabase_admin.table("retest_sessions")
        .select("*")
        .eq("id", session_id)
        .eq("student_id", student_id)
        .maybe_single()
        .execute()
    )
    session = session_response.data
    if not session:
        raise HTTPException(status_code=404, detail="找不到補測 session")
    if session.get("status") != "in_progress":
        raise HTTPException(status_code=400, detail="這次補測已經完成")

    question_ids = [int(qid) for qid in session.get("question_ids") or []]
    answer_map = {
        answer.question_id: normalize_answer(answer.selected_answer)
        for answer in payload.answers
        if answer.question_id in question_ids
    }
    if len(answer_map) != len(question_ids):
        raise HTTPException(status_code=422, detail="請完成所有補測題目後再送出")

    question_rows = (
        supabase_admin.table("questions")
        .select("id, lecture_id, answer, explanation")
        .in_("id", question_ids)
        .execute()
        .data
        or []
    )
    question_map = rows_by_id(question_rows)
    attempt_rows = []
    results = []
    correct_count = 0
    for question_id in question_ids:
        question = question_map.get(question_id)
        if not question:
            raise HTTPException(status_code=404, detail=f"找不到題目 {question_id}")
        selected_answer = answer_map.get(question_id)
        correct_answer = normalize_answer(question.get("answer"))
        is_correct = bool(selected_answer and selected_answer == correct_answer)
        if is_correct:
            correct_count += 1
        attempt_rows.append(
            {
                "student_id": student_id,
                "lecture_id": question.get("lecture_id"),
                "question_id": question_id,
                "selected_answer": selected_answer,
                "is_correct": is_correct,
                "attempt_type": "retest",
                "attempt_number": session.get("attempt_number") or 1,
                "retest_session_id": session_id,
            }
        )
        results.append(
            {
                "question_id": question_id,
                "selected_answer": selected_answer,
                "correct_answer": correct_answer,
                "is_correct": is_correct,
                "explanation": question.get("explanation"),
            }
        )

    try:
        supabase_admin.table("question_attempts").insert(attempt_rows).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"補測作答紀錄儲存失敗，補測尚未完成。原始錯誤：{exc}",
        ) from exc

    retest_accuracy = percent_ratio(correct_count, len(question_ids)) or 0
    status = "passed" if retest_accuracy >= ASSESSMENT_PASS_THRESHOLD else "failed"
    completed_at = datetime.now(timezone.utc).isoformat()
    update_row = {
        "correct_questions": correct_count,
        "retest_accuracy": retest_accuracy,
        "status": status,
        "completed_at": completed_at,
    }
    response = (
        supabase_admin.table("retest_sessions")
        .update(update_row)
        .eq("id", session_id)
        .execute()
    )
    updated_session = (response.data or [{**session, **update_row, "status": status}])[0]

    return {
        "status": status,
        "session": updated_session,
        "results": results,
        "retest_accuracy": retest_accuracy,
        "pass_threshold": ASSESSMENT_PASS_THRESHOLD,
        "passed": status == "passed",
    }


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

    attempts = (
        supabase_admin.table("question_attempts")
        .select("*")
        .in_("lecture_id", lecture_ids)
        .eq("student_id", student_id)
        .execute()
        .data
        or []
    )

    questions = select_questions(lecture_ids)
    question_map = rows_by_id(questions)
    original_questions = [question for question in questions if is_original_question(question)]
    extension_questions = [
        question for question in questions if (question.get("question_type") or "") == "extension"
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
    latest_initial_attempts = latest_attempts_by_question(initial_attempts)

    historical_wrong_questions = []
    for attempt in first_initial_attempts.values():
        if attempt.get("is_correct"):
            continue
        question = question_map.get(attempt.get("question_id"))
        if not question or not is_original_question(question):
            continue
        historical_wrong_questions.append(question)

    latest_retest_session = get_latest_retest_session(student_id, lecture_ids)

    return {
        "lectures": lectures,
        "lecture_map": lecture_map,
        "attempts": attempts,
        "initial_attempts": initial_attempts,
        "retest_attempts": retest_attempts,
        "first_initial_attempts": first_initial_attempts,
        "latest_initial_attempts": latest_initial_attempts,
        "questions": questions,
        "question_map": question_map,
        "original_questions": original_questions,
        "extension_questions": extension_questions,
        "extensions_by_source": extensions_by_source,
        "historical_wrong_questions": historical_wrong_questions,
        "latest_retest_session": latest_retest_session,
    }


def get_latest_retest_session(student_id: int, lecture_ids: list[int]) -> dict[str, Any] | None:
    if not lecture_ids:
        return None
    lectures = (
        supabase_admin.table("lectures")
        .select("course_id")
        .in_("id", lecture_ids)
        .limit(1)
        .execute()
        .data
        or []
    )
    course_id = (lectures[0] or {}).get("course_id") if lectures else None
    if course_id is None:
        return None
    try:
        response = (
            supabase_admin.table("retest_sessions")
            .select("*")
            .eq("student_id", student_id)
            .eq("course_id", course_id)
            .order("started_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception:
        return None
    rows = response.data or []
    return rows[0] if rows else None


def build_assessment_status(
    student_id: int,
    course_id: int | None,
    questions: list[dict[str, Any]],
    attempts: list[dict[str, Any]],
) -> dict[str, Any]:
    original_questions = [question for question in questions if is_original_question(question)]
    original_question_ids = {question.get("id") for question in original_questions}
    initial_attempts = [
        attempt
        for attempt in attempts
        if (attempt.get("attempt_type") or "initial") == "initial"
        and attempt.get("question_id") in original_question_ids
    ]
    first_initial = first_attempts_by_question(initial_attempts)
    original_total = len(first_initial)
    original_correct = sum(1 for attempt in first_initial.values() if attempt.get("is_correct"))
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
    passed = (
        original_accuracy is not None and original_accuracy >= ASSESSMENT_PASS_THRESHOLD
    ) or (
        retest_status == "passed"
        and retest_accuracy is not None
        and float(retest_accuracy) >= ASSESSMENT_PASS_THRESHOLD
    )

    return {
        "pass_threshold": ASSESSMENT_PASS_THRESHOLD,
        "original_total": original_total,
        "original_correct": original_correct,
        "original_accuracy": original_accuracy,
        "retest_accuracy": retest_accuracy,
        "retest_status": retest_status,
        "latest_retest_session": latest_session,
        "passed": passed,
        "needs_retest": bool(
            original_accuracy is not None
            and original_accuracy < ASSESSMENT_PASS_THRESHOLD
            and not passed
        ),
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
    historical_wrong: list[dict[str, Any]],
    extensions_by_source: dict[Any, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    seen_ids: set[Any] = set()

    for question in historical_wrong:
        source_id = question.get("id")
        for extension in extensions_by_source.get(source_id, [])[:1]:
            if extension.get("id") not in seen_ids:
                selected.append(extension)
                seen_ids.add(extension.get("id"))
                break
        if len(selected) >= RETEST_MAX_QUESTIONS:
            return selected

    for question in historical_wrong[:RETEST_ORIGINAL_RECHECK_LIMIT]:
        if question.get("id") not in seen_ids:
            selected.append(question)
            seen_ids.add(question.get("id"))
        if len(selected) >= RETEST_MAX_QUESTIONS:
            break

    if not selected:
        selected = historical_wrong[:RETEST_MAX_QUESTIONS]

    return selected


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
    assessment_status = build_assessment_status(
        student_id=student_id,
        course_id=scope.get("course_id"),
        questions=questions,
        attempts=attempts,
    )

    wrong_questions = []
    weak_counter: Counter[Any] = Counter()
    latest_retest_attempts = latest_attempts_by_question(context["retest_attempts"])
    for question in historical_wrong_questions:
        attempt = first_initial_attempts.get(question.get("id"))
        if not question:
            continue
        selected_answer = normalize_answer(attempt.get("selected_answer"))
        correct_answer = normalize_answer(question.get("answer"))
        kp = kp_map.get(question.get("knowledge_point_id"))
        if kp:
            weak_counter[kp.get("id")] += 1
        related_retest_attempts = [
            latest_retest_attempts.get(question.get("id")),
            *[
                latest_retest_attempts.get(extension.get("id"))
                for extension in context["extensions_by_source"].get(question.get("id"), [])
            ],
        ]
        related_retest_attempts = [row for row in related_retest_attempts if row]
        retest_mastered = bool(related_retest_attempts) and all(
            row.get("is_correct") for row in related_retest_attempts
        )
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
                "retest_status": "mastered" if retest_mastered else (
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
            "並依照課程測驗狀態確認是否已達通過標準。"
        )

    return {
        **scope,
        "stats": {
            "attempt_count": len(attempts),
            "initial_attempt_count": len(context["initial_attempts"]),
            "retest_attempt_count": len(context["retest_attempts"]),
            "wrong_count": len(wrong_questions),
            "recommended_count": len(recommended),
            "lecture_count": len(lecture_ids),
            "question_count": len(original_questions),
            "extension_question_count": len(context["extension_questions"]),
        },
        "assessment": assessment_status,
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
            "recommended_count": 0,
            "lecture_count": 0,
            "question_count": 0,
            "extension_question_count": 0,
        },
        "assessment": {
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
        "recommended_knowledge_points": [],
        "wrong_questions": [],
        "weaknesses": [],
        "summary_review": {
            "summary": "",
            "suggestion": "這門課目前還沒有小節資料，因此尚無法產生複習內容。",
        },
        "mock_questions": [],
    }
