import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from routers.lectures import (
    NoteUpdate,
    get_courses,
    get_lecture_notes,
    get_lectures_by_course,
    get_selected_lecture,
    update_lecture_note,
)
from routers.questions import get_lecture_question_attempts
from routers.security import AuthContext


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

    def in_(self, column, values):
        self.filters.append((column, set(values)))
        return self

    def order(self, *_args, **_kwargs):
        return self

    def update(self, values):
        self.update_values = values
        return self

    def execute(self):
        matches = [
            row
            for row in self.rows
            if all(
                (
                    row.get(column) in value
                    if isinstance(value, set)
                    else row.get(column) == value
                )
                for column, value in self.filters
            )
        ]
        if self.update_values is not None:
            for row in matches:
                row.update(self.update_values)
        return FakeResponse(matches)


class FakeDatabase:
    def __init__(self, tables):
        self.tables = tables

    def table(self, name):
        return FakeQuery(self.tables.get(name, []))


def student_context(student_id, tables):
    return AuthContext(
        user=SimpleNamespace(id=f"auth-{student_id}"),
        profile={"id": student_id, "role": "student"},
        database=FakeDatabase(tables),
    )


class StudentDataBoundaryTests(unittest.TestCase):
    def test_course_list_contains_only_courses_enrolled_by_current_student(self):
        context = student_context(
            10,
            {"student_courses": [{"student_id": 10, "course_id": 7}]},
        )
        database = FakeDatabase(
            {
                "courses": [
                    {"id": 7, "title": "我的課程", "status": "published", "teacher_id": 3},
                    {"id": 8, "title": "其他課程", "status": "published", "teacher_id": 4},
                ],
                "users": [{"id": 3, "name": "王老師"}, {"id": 4, "name": "陳老師"}],
            }
        )

        with patch("routers.lectures.supabase_admin", database):
            courses = get_courses(context=context)

        self.assertEqual([course["id"] for course in courses], [7])

    def test_public_course_list_remains_available_without_student_context(self):
        database = FakeDatabase(
            {
                "courses": [
                    {"id": 7, "title": "課程一", "status": "published", "teacher_id": 3},
                    {"id": 8, "title": "課程二", "status": "published", "teacher_id": 4},
                ],
                "users": [{"id": 3, "name": "王老師"}, {"id": 4, "name": "陳老師"}],
            }
        )

        with patch("routers.lectures.supabase_admin", database):
            courses = get_courses(context=None)

        self.assertEqual([course["id"] for course in courses], [7, 8])

    def test_student_cannot_read_lectures_from_unenrolled_course(self):
        context = student_context(10, {"student_courses": []})

        with self.assertRaises(HTTPException) as raised:
            get_lectures_by_course(8, context)

        self.assertEqual(raised.exception.status_code, 404)

    def test_student_cannot_read_a_lecture_from_unenrolled_course(self):
        context = student_context(10, {"student_courses": []})
        database = FakeDatabase(
            {"lectures": [{"id": 15, "course_id": 8, "title": "其他課程小節"}]}
        )

        with (
            patch("routers.lectures.supabase_admin", database),
            self.assertRaises(HTTPException) as raised,
        ):
            get_selected_lecture(15, context)

        self.assertEqual(raised.exception.status_code, 404)

    def test_notes_endpoint_returns_only_current_students_rows(self):
        context = student_context(
            10,
            {
                "notes": [
                    {"id": 1, "student_id": 10, "lecture_id": 7, "content": "mine"},
                    {"id": 2, "student_id": 99, "lecture_id": 7, "content": "other"},
                ]
            },
        )

        rows = get_lecture_notes(7, context)

        self.assertEqual([row["id"] for row in rows], [1])

    def test_student_cannot_update_another_students_note(self):
        context = student_context(
            10,
            {
                "notes": [
                    {"id": 2, "student_id": 99, "lecture_id": 7, "content": "other"}
                ]
            },
        )

        with self.assertRaises(HTTPException) as raised:
            update_lecture_note(2, NoteUpdate(content="tampered"), context)

        self.assertEqual(raised.exception.status_code, 404)

    def test_attempt_history_returns_only_current_students_rows(self):
        context = student_context(
            10,
            {
                "question_attempts": [
                    {"id": 1, "student_id": 10, "lecture_id": 7},
                    {"id": 2, "student_id": 99, "lecture_id": 7},
                ]
            },
        )

        rows = get_lecture_question_attempts(7, context)

        self.assertEqual([row["id"] for row in rows], [1])

    def test_rls_migration_does_not_expose_question_answers(self):
        migration = (
            Path(__file__).parents[1] / "sql" / "secure_student_data_rls.sql"
        ).read_text()

        self.assertIn("revoke all privileges on all tables", migration.lower())
        self.assertIn("question_attempts_select_own", migration)
        self.assertNotIn(
            "grant select on public.questions to authenticated", migration.lower()
        )
        self.assertNotIn(
            "grant select on public.final_assessment_questions to authenticated",
            migration.lower(),
        )


if __name__ == "__main__":
    unittest.main()
