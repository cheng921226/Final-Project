from getpass import getpass
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database.supabase import supabase_admin


CLASS_RANGES = (
    ("資訊三甲班", 1, 30),
    ("資訊三乙班", 31, 60),
    ("資訊三丙班", 61, 90),
)


def campus_account() -> dict:
    rows = (
        supabase_admin.table("users")
        .select("id,name,email")
        .eq("role", "campus")
        .order("id")
        .execute()
        .data
        or []
    )
    if len(rows) != 1:
        raise RuntimeError(f"預期只有一個平台帳號，目前找到 {len(rows)} 個")
    return rows[0]


def ensure_class(name: str, campus_id: int) -> int:
    existing_rows = (
        supabase_admin.table("classes")
        .select("id")
        .eq("created_by_user_id", campus_id)
        .eq("name", name)
        .execute()
        .data
        or []
    )
    if existing_rows:
        return existing_rows[0]["id"]
    rows = (
        supabase_admin.table("classes")
        .insert({"name": name, "created_by_user_id": campus_id})
        .execute()
        .data
        or []
    )
    if not rows:
        raise RuntimeError(f"無法建立班級：{name}")
    return rows[0]["id"]


def ensure_student(number: int, password: str) -> int:
    email = f"stu{number}@example.com"
    student_number = f"STU{number}"
    name = f"學生{number}"
    existing_rows = (
        supabase_admin.table("users")
        .select("id,role,auth_id")
        .eq("email", email)
        .execute()
        .data
        or []
    )
    if existing_rows:
        existing = existing_rows[0]
        if existing.get("role") != "student" or not existing.get("auth_id"):
            raise RuntimeError(f"{email} 已存在，但不是完整的學生登入帳號")
        return existing["id"]

    response = supabase_admin.auth.admin.create_user(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"name": name, "student_number": student_number},
        }
    )
    if response.user is None:
        raise RuntimeError(f"無法建立登入帳號：{email}")
    created = (
        supabase_admin.table("users")
        .select("id")
        .eq("auth_id", str(response.user.id))
        .single()
        .execute()
        .data
    )
    return created["id"]


def main() -> None:
    password = getpass("所有學生的初始密碼：")
    if len(password) < 9:
        raise RuntimeError("初始密碼至少需要 9 個字元")

    campus = campus_account()
    completed = 0
    for class_name, first, last in CLASS_RANGES:
        class_id = ensure_class(class_name, campus["id"])
        for number in range(first, last + 1):
            student_id = ensure_student(number, password)
            supabase_admin.table("class_students").upsert(
                {"class_id": class_id, "student_id": student_id},
                on_conflict="student_id",
            ).execute()
            completed += 1
        print(f"{class_name}：{last - first + 1} 人")
    print(
        f"建立完成：{completed} 個學生帳號，平台：{campus.get('name') or campus.get('email')}"
    )


if __name__ == "__main__":
    main()
