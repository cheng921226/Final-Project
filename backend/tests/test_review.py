import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException

from routers.review import (
    build_review_payload,
    class_review_recommendations,
    compose_retest_questions,
    get_class_review_recommendations,
    get_course_review,
)


class ReviewTests(unittest.TestCase):
    def test_practice_covers_unseen_concepts_before_repeating_and_rotates_questions(self):
        originals = [{"id": index} for index in range(1, 13)]
        extensions = {1: [{"id": 101}], 2: [{"id": 102}]}
        attempts = [{"question_id": 101}] * 3
        selected = compose_retest_questions(originals, extensions, attempts)
        self.assertEqual([question["id"] for question in selected], [102, *range(3, 12)])

        selected = compose_retest_questions(originals[:2], extensions, attempts)
        self.assertEqual([question["id"] for question in selected], [102, 1])

    def test_course_review_requires_enrollment_before_reading_content(self):
        student = SimpleNamespace(profile={"role": "student", "id": 5})
        with (
            patch("routers.review.get_course", return_value={"status": "published"}),
            patch(
                "routers.review.require_enrollment",
                side_effect=HTTPException(status_code=403),
            ) as require_enrollment,
            patch("routers.review.build_review_payload") as build_payload,
            self.assertRaises(HTTPException) as error,
        ):
            get_course_review(9, student)

        self.assertEqual(error.exception.status_code, 403)
        require_enrollment.assert_called_once_with(5, 9)
        build_payload.assert_not_called()


    def test_recommendations_prioritize_unmastered_and_deduplicate_recovered_concepts(self):
        points = [
            {"id": index, "lecture_id": 7, "title": f"概念 {index}"}
            for index in range(1, 6)
        ]
        questions = [
            {"id": 1, "lecture_id": 7, "knowledge_point_id": 1},
            {"id": 2, "lecture_id": 7, "knowledge_point_id": 2},
            {"id": 3, "lecture_id": 7, "knowledge_point_id": 2},
            {"id": 4, "lecture_id": 7, "knowledge_point_id": 3},
            {"id": 5, "lecture_id": 7, "knowledge_point_id": 4},
            {"id": 6, "lecture_id": 7, "knowledge_point_id": 5},
        ]
        # Concept 1 has been corrected, 2 has mixed results, 3 is still wrong,
        # 4 was right initially, and 5 has never been attempted.
        initial_attempts = {
            question["id"]: {"question_id": question["id"], "is_correct": question["id"] == 5}
            for question in questions[:5]
        }
        review = {
            "lecture_map": {7: {"id": 7, "title": "小節"}},
            "attempts": list(initial_attempts.values()),
            "questions": questions,
            "original_questions": questions,
            "first_initial_attempts": initial_attempts,
            "historical_wrong_questions": questions[:4],
            "mastery": {},
            "mastered_question_ids": {1, 3, 5},
            "initial_attempts": list(initial_attempts.values()),
            "retest_attempts": [],
            "extension_questions": [],
            "extensions_by_source": {},
        }
        point_query = Mock()
        point_query.select.return_value.in_.return_value.eq.return_value.execute.return_value.data = points
        summary_query = Mock()
        summary_query.select.return_value.in_.return_value.execute.return_value.data = []
        database = Mock()
        database.table.side_effect = {"knowledge_points": point_query, "summaries": summary_query}.__getitem__

        with (
            patch("routers.review.build_review_context", return_value=review),
            patch("routers.review.build_assessment_status", return_value={}),
            patch("routers.review.supabase_admin", database),
        ):
            for mastered, expected_ids, expected_states in [
                ({1, 3, 5}, [2, 3, 1], ["needs_reinforcement", "needs_reinforcement", "consolidate"]),
                ({1, 2, 3, 4, 5}, [2, 1, 3], ["consolidate"] * 3),
                ({5}, [2, 1, 3], ["needs_reinforcement"] * 3),
            ]:
                with self.subTest(mastered=mastered):
                    review["mastered_question_ids"] = mastered
                    payload = build_review_payload(5, [7], {"course_id": 9})
                    recommended = payload["recommended_knowledge_points"]
                    self.assertEqual([point["id"] for point in recommended], expected_ids)
                    self.assertEqual([point["review_status"] for point in recommended], expected_states)
                    self.assertEqual(payload["stats"]["recommended_count"], 3)

            review["historical_wrong_questions"] = []
            payload = build_review_payload(5, [7], {"course_id": 9})
            self.assertEqual(payload["recommended_knowledge_points"], [])
            self.assertEqual(payload["stats"]["recommended_count"], 0)


    def test_class_recommendations_count_only_first_original_answers_and_require_five_students(self):
        points = [{"id": index, "lecture_id": 7, "title": str(index)} for index in range(1, 7)]
        questions = [
            {"id": index, "knowledge_point_id": index, "status": "published", "question_type": "original"}
            for index in range(1, 7)
        ] + [
            {"id": 100, "knowledge_point_id": 2, "status": "published", "question_type": "extension"},
            {"id": 101, "knowledge_point_id": 2, "status": "deleted", "question_type": "original"},
        ]
        attempts = []
        for point_id, wrong_count in [(1, 4), (2, 2), (3, 4), (4, 0), (5, 5), (6, 3)]:
            for student_id in range(1, (4 if point_id == 3 else 5) + 1):
                attempts.append({
                    "id": len(attempts) + 1, "student_id": student_id,
                    "question_id": point_id, "attempt_type": "initial",
                    "is_correct": student_id > wrong_count, "answered_at": "2026-11-19",
                })
        # Later retries, extensions, deleted questions and unenrolled students cannot affect ranking.
        attempts += [
            {"student_id": 1, "question_id": 1, "attempt_type": "initial", "is_correct": True, "answered_at": "2026-11-20"},
            {"student_id": 2, "question_id": 1, "attempt_type": "retest", "is_correct": True},
            {"student_id": 99, "question_id": 2, "is_correct": False},
            {"student_id": 1, "question_id": 100, "is_correct": False},
            {"student_id": 1, "question_id": 101, "is_correct": False},
        ]
        result = class_review_recommendations(questions, list(reversed(attempts)), points, set(range(1, 6)))
        self.assertEqual([point["id"] for point in result], [5, 1, 6])
        self.assertEqual(result[1]["wrong_count"], 4)
        self.assertEqual(result[1]["answer_count"], 5)
        self.assertEqual(result[1]["student_count"], 5)
        self.assertEqual(result[1]["wrong_rate"], 0.8)
        self.assertNotIn("students", result[1])
        self.assertNotIn("student_id", result[1])

    def test_class_review_checks_enrollment_before_loading_class_statistics(self):
        student = SimpleNamespace(profile={"role": "student", "id": 5})
        with (
            patch("routers.review.get_course", return_value={"status": "published"}),
            patch("routers.review.require_enrollment", side_effect=HTTPException(status_code=403)),
            patch("routers.review.fetch_all_by_id") as fetch,
            self.assertRaises(HTTPException) as error,
        ):
            get_class_review_recommendations(9, student)
        self.assertEqual(error.exception.status_code, 403)
        fetch.assert_not_called()
