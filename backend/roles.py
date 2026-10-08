STUDENT_ROLE = "student"
TEACHER_ROLE = "teacher"
CAMPUS_ROLE = "campus"

# Campus accounts manage courses they uploaded. Teachers manage courses assigned
# to them, including courses originally uploaded by a campus account.
TEACHER_ACCESS_ROLES = frozenset({TEACHER_ROLE, CAMPUS_ROLE})


def has_teacher_access(role: str | None) -> bool:
    return role in TEACHER_ACCESS_ROLES


def can_manage_course(
    role: str | None,
    user_id: int | None,
    teacher_id: int | None,
    created_by_user_id: int | None = None,
) -> bool:
    if role == CAMPUS_ROLE:
        return created_by_user_id == user_id
    return role == TEACHER_ROLE and teacher_id == user_id
