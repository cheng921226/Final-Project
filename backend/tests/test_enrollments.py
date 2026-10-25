import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException

from routers.enrollments import (
    EnrollmentBatch,
    enroll_students,
    unenroll_students,
    validate_student_ids,
)


class EnrollmentTests(unittest.TestCase):
    def test_rejects_ids_that_are_not_students(self):
        query = Mock()
        query.select.return_value = query
        query.in_.return_value = query
        query.eq.return_value = query
        query.execute.return_value = SimpleNamespace(data=[{"id": 1}])
        database = Mock()
        database.table.return_value = query

        with patch("routers.enrollments.supabase_admin", database):
            with self.assertRaises(HTTPException) as error:
                validate_student_ids([1, 99])

        self.assertEqual(error.exception.status_code, 422)
        self.assertIn("99", error.exception.detail)

    def test_batch_enrollment_uses_unique_student_course_pair(self):
        query = Mock()
        query.upsert.return_value = query
        query.execute.return_value = SimpleNamespace(data=[])
        database = Mock()
        database.table.return_value = query
        context = SimpleNamespace(profile={"id": 7, "role": "campus"})

        with (
            patch("routers.enrollments.supabase_admin", database),
            patch("routers.enrollments.get_course_or_404"),
            patch("routers.enrollments.validate_student_ids", return_value=[1, 2]),
        ):
            result = enroll_students(10, EnrollmentBatch(student_ids=[1, 2]), context)

        database.table.assert_called_once_with("student_courses")
        query.upsert.assert_called_once_with(
            [
                {"course_id": 10, "student_id": 1},
                {"course_id": 10, "student_id": 2},
            ],
            on_conflict="student_id,course_id",
        )
        self.assertEqual(result["count"], 2)

    def test_unenrollment_only_deletes_course_membership(self):
        query = Mock()
        query.delete.return_value = query
        query.eq.return_value = query
        query.in_.return_value = query
        query.execute.return_value = SimpleNamespace(data=[{"id": 31}, {"id": 32}])
        database = Mock()
        database.table.return_value = query
        context = SimpleNamespace(profile={"id": 7, "role": "campus"})

        with (
            patch("routers.enrollments.supabase_admin", database),
            patch("routers.enrollments.get_course_or_404"),
            patch("routers.enrollments.validate_student_ids", return_value=[1, 2]),
        ):
            result = unenroll_students(10, EnrollmentBatch(student_ids=[1, 2]), context)

        database.table.assert_called_once_with("student_courses")
        query.eq.assert_called_once_with("course_id", 10)
        query.in_.assert_called_once_with("student_id", [1, 2])
        self.assertIn("學習紀錄仍保留", result["message"])


if __name__ == "__main__":
    unittest.main()
