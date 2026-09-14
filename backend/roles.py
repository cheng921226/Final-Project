STUDENT_ROLE = "student"
TEACHER_ROLE = "teacher"
CAMPUS_ROLE = "campus"

# Campus accounts share the teacher feature permissions and course ownership rules.
TEACHER_ACCESS_ROLES = frozenset({TEACHER_ROLE, CAMPUS_ROLE})


def has_teacher_access(role: str | None) -> bool:
    return role in TEACHER_ACCESS_ROLES


def can_manage_course(
    role: str | None, user_id: int | None, teacher_id: int | None
) -> bool:
    if role == CAMPUS_ROLE:
        return True
    return role == TEACHER_ROLE and teacher_id in (None, user_id)
