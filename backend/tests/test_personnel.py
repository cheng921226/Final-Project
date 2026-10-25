import io
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException
from fastapi import UploadFile

from routers.personnel import (
    PersonnelStatusUpdate,
    auth_user_active,
    class_sort_key,
    import_personnel_csv,
    normalize_student_fields,
    require_campus,
    update_personnel_status,
)


class PersonnelTests(unittest.TestCase):
    def test_only_campus_can_manage_personnel(self):
        with self.assertRaises(HTTPException) as context:
            require_campus(SimpleNamespace(profile={"id": 10, "role": "teacher"}))
        self.assertEqual(context.exception.status_code, 403)

    def test_student_fields_are_normalized_and_required(self):
        self.assertEqual(normalize_student_fields("student", " stu001 ", 3), ("STU001", 3))
        self.assertEqual(normalize_student_fields("teacher", "STU001", 3), (None, None))
        with self.assertRaises(HTTPException) as context:
            normalize_student_fields("student", "", None)
        self.assertEqual(context.exception.status_code, 422)

    def test_banned_auth_user_is_reported_as_disabled(self):
        active = SimpleNamespace(banned_until=None)
        banned = SimpleNamespace(banned_until=datetime.now(timezone.utc) + timedelta(days=1))
        self.assertTrue(auth_user_active(active))
        self.assertFalse(auth_user_active(banned))

    def test_classes_sort_by_grade_then_section(self):
        rows = [
            {"name": "資訊四丁"},
            {"name": "資訊三甲"},
            {"name": "資訊一乙"},
            {"name": "資訊一甲"},
            {"name": "資訊二丙"},
        ]
        rows.sort(key=class_sort_key)
        self.assertEqual(
            [row["name"] for row in rows],
            ["資訊一甲", "資訊一乙", "資訊二丙", "資訊三甲", "資訊四丁"],
        )

    def test_campus_cannot_disable_own_account(self):
        context = SimpleNamespace(profile={"id": 22, "role": "campus"})
        with patch(
            "routers.personnel.get_personnel_or_404",
            return_value={"id": 22, "auth_id": "auth-22", "role": "campus"},
        ):
            with self.assertRaises(HTTPException) as error:
                update_personnel_status(
                    22,
                    PersonnelStatusUpdate(active=False),
                    context,
                )
        self.assertEqual(error.exception.status_code, 422)
        self.assertIn("自己", error.exception.detail)

    def test_csv_import_accepts_chinese_headers_and_reports_bad_rows(self):
        query = Mock()
        query.select.return_value = query
        query.execute.return_value = SimpleNamespace(
            data=[{"id": 1, "name": "資訊三甲"}]
        )
        database = Mock()
        database.table.return_value = query
        upload = UploadFile(
            filename="people.csv",
            file=io.BytesIO(
                "姓名,Email,初始密碼,角色,學號,班級\n"
                "學生一,stu1@example.com,123123123,學生,STU001,資訊三甲\n"
                "學生二,stu2@example.com,123123123,學生,STU002,不存在班級\n".encode("utf-8")
            ),
        )
        context = SimpleNamespace(profile={"id": 22, "role": "campus"})

        with (
            patch("routers.personnel.supabase_admin", database),
            patch("routers.personnel.create_personnel", return_value={"id": 1}) as create,
        ):
            result = import_personnel_csv(upload, context)

        self.assertEqual(result["succeeded"], 1)
        self.assertEqual(result["failed"], 1)
        self.assertEqual(result["errors"][0]["row"], 3)
        payload = create.call_args.args[0]
        self.assertEqual(payload.student_number, "STU001")
        self.assertEqual(payload.class_id, 1)


if __name__ == "__main__":
    unittest.main()
