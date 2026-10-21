import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException

from routers.teacher_access import (
    course_owner_for_creation,
    require_course_manager,
    require_lecture_manager,
    require_teacher,
)
from roles import can_manage_course
from routers.teacher_analytics import (
    _enrolled_student_ids,
    _student_scope_result,
    _teaching_recommendations,
)
from routers.questions import (
    delete_teacher_question,
    get_lecture_questions,
    validate_question_options,
)
from routers.course_management import (
    CourseUpdate,
    _managed_courses,
    _segments_from_edited_transcript,
    update_course,
)


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

    def test_edited_transcript_keeps_timestamp_segments(self):
        segments = _segments_from_edited_transcript(
            "(0:10) 第一段內容\n(0:45) 第二段內容"
        )
        self.assertEqual(len(segments), 2)
        self.assertEqual(segments[0]["start_time"], 10)
        self.assertEqual(segments[0]["end_time"], 45)
        self.assertEqual(segments[1]["text"], "第二段內容")

    def test_teaching_recommendations_require_evidence_and_sample_size(self):
        lectures = [{
            "id": 7,
            "title": "遞迴",
            "students_started": 10,
            "completion_rate": 35,
            "attempts": 20,
            "accuracy": 45,
            "pause_hotspots": [{"start": 120, "end": 150, "count": 8, "knowledge_points": ["遞迴終止條件"]}],
            "seek_hotspots": [{"start": 120, "end": 150, "count": 6, "knowledge_points": ["遞迴終止條件"]}],
        }]
        students = [
            {
                "id": index,
                "classes": [{"id": 1 if index < 5 else 2, "name": "資訊三甲" if index < 5 else "資訊三乙"}],
                "attempts": 10,
                "accuracy": 90 if index < 5 else 40,
                "completed_lectures": 1,
                "total_lectures": 2,
                "watched_minutes": 20,
                "last_active": "2026-01-01T00:00:00Z",
            }
            for index in range(10)
        ]
        questions = [{"id": 3, "lecture_id": 7, "text": "終止條件是什麼？", "attempts": 20, "students_answered": 3, "accuracy": 20}]

        recommendations = _teaching_recommendations(lectures, students, questions)
        categories = {item["category"] for item in recommendations}

        self.assertEqual(
            categories,
            {"engagement", "comprehension", "question", "class_gap"},
        )
        completion = next(item for item in recommendations if item["id"] == "course-completion")
        self.assertEqual(completion["title"], "整門課的完成率偏低")
        self.assertNotIn("lecture_id", completion)
        self.assertEqual(_teaching_recommendations([], students[:4], []), [])

    def test_question_quality_requires_more_than_one_quarter_of_the_class(self):
        students = [{"id": index} for index in range(20)]
        exactly_one_quarter = [{
            "id": 1,
            "lecture_id": 7,
            "text": "只有五人作答",
            "attempts": 20,
            "students_answered": 5,
            "accuracy": 10,
        }]
        more_than_one_quarter = [{
            **exactly_one_quarter[0],
            "students_answered": 6,
        }]

        self.assertFalse(any(
            item["category"] == "question"
            for item in _teaching_recommendations([], students, exactly_one_quarter)
        ))
        self.assertTrue(any(
            item["category"] == "question"
            for item in _teaching_recommendations([], students, more_than_one_quarter)
        ))


class TeacherAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.database = FakeSupabase(
            {
                "users": [
                    {"id": 1, "auth_id": "teacher-auth", "role": "teacher"},
                    {"id": 2, "auth_id": "student-auth", "role": "student"},
                ],
                "courses": [
                    {"id": 10, "teacher_id": 1, "created_by_user_id": 1},
                    {"id": 20, "teacher_id": 9, "created_by_user_id": 22},
                    {"id": 30, "teacher_id": None, "created_by_user_id": 22},
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

    def test_assigned_teacher_can_manage_course_uploaded_by_campus(self):
        with patch("routers.teacher_access.supabase_admin", self.database):
            course = require_course_manager(20, {"id": 9, "role": "teacher"})
        self.assertEqual(course["created_by_user_id"], 22)
        self.assertEqual(course["teacher_id"], 9)

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

    def test_campus_created_course_defaults_to_itself(self):
        self.assertEqual(
            course_owner_for_creation({"id": 99, "role": "campus"}, None),
            99,
        )

    def test_campus_can_manage_only_courses_it_uploaded(self):
        self.assertTrue(can_manage_course("campus", 22, 9, 22))
        self.assertFalse(can_manage_course("campus", 23, 9, 22))

    def test_campus_course_management_can_list_and_manage_teacher_courses(self):
        course_rows = [
            {"id": 10, "teacher_id": 1, "created_by_user_id": 1},
            {"id": 20, "teacher_id": 9, "created_by_user_id": 22},
        ]
        query = Mock()
        query.order.return_value = query
        query.execute.return_value.data = course_rows
        database = Mock()
        database.table.return_value.select.return_value = query

        with patch("routers.course_management.supabase_admin", database):
            courses = _managed_courses({"id": 99, "role": "campus"})

        self.assertEqual(courses, course_rows)
        query.eq.assert_not_called()
        with patch("routers.teacher_access.supabase_admin", self.database):
            managed_course = require_course_manager(
                10,
                {"id": 99, "role": "campus"},
                allow_campus_all=True,
            )
        self.assertEqual(managed_course["id"], 10)
        lecture_database = FakeSupabase(
            {
                "lectures": [{"id": 100, "course_id": 10}],
                "courses": [{"id": 10, "teacher_id": 1, "created_by_user_id": 1}],
            }
        )
        with patch("routers.teacher_access.supabase_admin", lecture_database):
            managed_lecture = require_lecture_manager(
                100,
                {"id": 99, "role": "campus"},
                allow_campus_all=True,
            )
        self.assertEqual(managed_lecture["id"], 100)

    def test_campus_cannot_manage_teacher_course_outside_course_management(self):
        with patch("routers.teacher_access.supabase_admin", self.database):
            with self.assertRaises(HTTPException) as context:
                require_course_manager(10, {"id": 99, "role": "campus"})
        self.assertEqual(context.exception.status_code, 403)

    def test_disabling_question_preserves_attempt_history(self):
        question = {"id": 5, "lecture_id": 7, "is_active": True}
        attempts = [{"id": 1, "question_id": 5, "is_correct": False}]
        database = FakeSupabase(
            {"questions": [question], "question_attempts": attempts}
        )
        with (
            patch("routers.questions.supabase_admin", database),
            patch(
                "routers.questions.require_teacher",
                return_value={"id": 1, "role": "teacher"},
            ),
            patch("routers.questions.get_lecture_for_teacher", return_value={"id": 7}),
        ):
            result = delete_teacher_question(5, SimpleNamespace(id="teacher-auth"))

        self.assertEqual(result["message"], "deleted")
        self.assertFalse(question["is_active"])
        self.assertEqual(len(attempts), 1)

    def test_students_receive_only_published_questions(self):
        query = Mock()
        query.select.return_value = query
        query.eq.return_value = query
        query.order.return_value = query
        query.execute.return_value.data = [
            {
                "id": 5,
                "lecture_id": 7,
                "question_text": "已審核題目",
                "options_json": ["A", "B"],
                "source_timestamp": 30,
                "question_type": "original",
            }
        ]
        database = Mock()
        database.table.return_value = query

        with (
            patch("routers.questions.supabase_admin", database),
            patch("routers.questions.require_lecture_viewer", return_value={"id": 7}),
        ):
            result = get_lecture_questions(
                7, SimpleNamespace(id="student-auth")
            )

        query.eq.assert_any_call("review_status", "published")
        query.eq.assert_any_call("is_active", True)
        self.assertEqual([row["id"] for row in result], [5])

    def test_correct_answer_must_match_the_number_of_options(self):
        validate_question_options(["選項一", "選項二", "選項三"], "C")
        with self.assertRaises(HTTPException) as context:
            validate_question_options(["選項一", "選項二"], "C")
        self.assertEqual(context.exception.status_code, 422)

    def test_only_campus_can_reassign_course_teacher(self):
        with (
            patch(
                "routers.course_management.require_teacher",
                return_value={"id": 1, "role": "teacher"},
            ),
            patch(
                "routers.course_management.require_course_manager",
                return_value={"id": 10, "teacher_id": 1},
            ),
        ):
            with self.assertRaises(HTTPException) as context:
                update_course(
                    10,
                    CourseUpdate(teacher_id=9),
                    SimpleNamespace(id="teacher-auth"),
                )
        self.assertEqual(context.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
