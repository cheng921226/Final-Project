import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from routers.personnel import (
    PersonnelStatusUpdate,
    auth_user_active,
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


if __name__ == "__main__":
    unittest.main()
