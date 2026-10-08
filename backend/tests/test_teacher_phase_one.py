import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from routers.teacher_access import (
    course_owner_for_creation,
    require_course_manager,
    require_teacher,
)
from routers.teacher_analytics import _enrolled_student_ids, _student_scope_result
from routers.questions import delete_teacher_question


class FakeResponse:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []
        self.update_values = None

    def select(self, *_args):
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def maybe_single(self):
        return self

    def update(self, values):
        self.update_values = values
        return self

    def execute(self):
        matches = [
            row
            for row in self.rows
            if all(row.get(column) == value for column, value in self.filters)
        ]
        if self.update_values is not None:
            for row in matches:
                row.update(self.update_values)
            return FakeResponse(matches)
        return FakeResponse(matches[0] if matches else None)


class FakeSupabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return FakeQuery(self.tables.get(name, []))


class TeacherAnalyticsTests(unittest.TestCase):
    def test_course_students_come_only_from_enrollments(self):
        enrollments = [
            {"student_id": 1, "course_id": 10},
            {"student_id": 2, "course_id": 20},
            {"student_id": 999, "course_id": 10},
        ]
        self.assertEqual(_enrolled_student_ids(enrollments, 10, {1, 2}), {1})

    def test_lecture_student_metrics_use_only_the_selected_scope(self):
        result = _student_scope_result(
            {"id": 1, "name": "學生甲", "email": "a@example.com"},
            [{"completed": True, "watched_seconds": 120, "updated_at": "2026-01-01"}],
            [],
            [
                {"is_correct": True, "answered_at": "2026-01-02"},
                {"is_correct": False, "answered_at": "2026-01-03"},
            ],
            1,
        )
        self.assertEqual(result["completed_lectures"], 1)
        self.assertEqual(result["watched_minutes"], 2)
        self.assertEqual(result["accuracy"], 50)
        self.assertEqual(result["last_active"], "2026-01-03")


class TeacherAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.database = FakeSupabase(
            {
                "users": [
                    {"id": 1, "auth_id": "teacher-auth", "role": "teacher"},
                    {"id": 2, "auth_id": "student-auth", "role": "student"},
                ],
                "courses": [
                    {"id": 10, "teacher_id": 1},
                    {"id": 20, "teacher_id": 9},
                    {"id": 30, "teacher_id": None},
                ],
            }
        )

    def test_student_cannot_use_teacher_endpoints(self):
        with patch("routers.teacher_access.supabase_admin", self.database):
            with self.assertRaises(HTTPException) as context:
                require_teacher(SimpleNamespace(id="student-auth"))
        self.assertEqual(context.exception.status_code, 403)

    def test_teacher_can_manage_only_owned_course(self):
        teacher = {"id": 1, "role": "teacher"}
        with patch("routers.teacher_access.supabase_admin", self.database):
            self.assertEqual(require_course_manager(10, teacher)["id"], 10)
            with self.assertRaises(HTTPException) as context:
                require_course_manager(20, teacher)
        self.assertEqual(context.exception.status_code, 403)

    def test_teacher_cannot_manage_unassigned_course(self):
        with patch("routers.teacher_access.supabase_admin", self.database):
            with self.assertRaises(HTTPException) as context:
                require_course_manager(30, {"id": 1, "role": "teacher"})
        self.assertEqual(context.exception.status_code, 403)

    def test_teacher_cannot_assign_new_course_to_another_teacher(self):
        self.assertEqual(
            course_owner_for_creation({"id": 1, "role": "teacher"}, 9),
            1,
        )

    def test_disabling_question_preserves_attempt_history(self):
        question = {"id": 5, "lecture_id": 7, "is_active": True}
        attempts = [{"id": 1, "question_id": 5, "is_correct": False}]
        database = FakeSupabase({"questions": [question], "question_attempts": attempts})
        with (
            patch("routers.questions.supabase_admin", database),
            patch("routers.questions.require_teacher", return_value={"id": 1, "role": "teacher"}),
            patch("routers.questions.get_lecture_for_teacher", return_value={"id": 7}),
        ):
            result = delete_teacher_question(5, SimpleNamespace(id="teacher-auth"))

        self.assertEqual(result["message"], "disabled")
        self.assertFalse(question["is_active"])
        self.assertEqual(len(attempts), 1)


if __name__ == "__main__":
    unittest.main()
