from collections import defaultdict
from typing import Any

ASSESSMENT_PASS_THRESHOLD = 0.7


def percentage(part: int | float, total: int | float) -> int:
    return round(part / total * 100) if total else 0


def question_attempt_statistics(
    attempts: list[dict[str, Any]],
) -> dict[int, dict[str, int]]:
    grouped: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for attempt in attempts:
        question_id = attempt.get("question_id")
        if question_id is not None:
            grouped[int(question_id)].append(attempt)

    return {
        question_id: {
            "attempt_count": len(rows),
            "correct_count": sum(bool(row.get("is_correct")) for row in rows),
            "accuracy": percentage(
                sum(bool(row.get("is_correct")) for row in rows), len(rows)
            ),
        }
        for question_id, rows in grouped.items()
    }


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


def question_mastery(
    questions: list[dict[str, Any]], attempts: list[dict[str, Any]]
) -> tuple[dict[str, Any], set[int]]:
    published = [
        question for question in questions if question.get("status") == "published"
    ]
    original_ids = {
        question["id"]
        for question in published
        if (question.get("question_type") or "original") == "original"
    }
    source_by_extension = {
        question["id"]: question["source_question_id"]
        for question in published
        if question.get("question_type") == "extension"
        and question.get("source_question_id") in original_ids
    }
    first_initial = first_attempts_by_question(
        [
            attempt
            for attempt in attempts
            if (attempt.get("attempt_type") or "initial") == "initial"
            and attempt.get("question_id") in original_ids
        ]
    )
    mastered_ids = {
        question_id
        for question_id, attempt in first_initial.items()
        if attempt.get("is_correct")
    }
    for attempt in attempts:
        if attempt.get("attempt_type") != "retest" or not attempt.get("is_correct"):
            continue
        question_id = attempt.get("question_id")
        original_id = source_by_extension.get(question_id, question_id)
        if original_id in original_ids:
            mastered_ids.add(original_id)

    total = len(original_ids)
    rate = len(mastered_ids) / total if total else None
    return {
        "mastered_questions": len(mastered_ids),
        "mastery_question_count": total,
        "mastery_rate": rate,
        "mastery_passed": rate is not None and rate >= ASSESSMENT_PASS_THRESHOLD,
        "has_unmastered_wrong_questions": bool(first_initial.keys() - mastered_ids),
    }, mastered_ids
