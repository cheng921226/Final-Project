from collections import defaultdict
from typing import Any


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
