import unittest
from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException

from routers.lectures import NoteUpdate, get_lecture_notes, update_lecture_note
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

    def order(self, *_args, **_kwargs):
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
        self.assertNotIn("grant select on public.questions to authenticated", migration.lower())
        self.assertNotIn(
            "grant select on public.final_assessment_questions to authenticated",
            migration.lower(),
        )


if __name__ == "__main__":
    unittest.main()
