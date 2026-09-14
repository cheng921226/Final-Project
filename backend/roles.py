STUDENT_ROLE = "student"
TEACHER_ROLE = "teacher"
CAMPUS_ROLE = "campus"

# Campus accounts share the teacher feature permissions and course ownership rules.
TEACHER_ACCESS_ROLES = frozenset({TEACHER_ROLE, CAMPUS_ROLE})


def has_teacher_access(role: str | None) -> bool:
    return role in TEACHER_ACCESS_ROLES
