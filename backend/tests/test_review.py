import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from routers.review import compose_retest_questions, get_course_review


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
