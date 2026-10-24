from dataclasses import dataclass
from collections.abc import Generator

from database.supabase import create_user_supabase_client, supabase_admin
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()


@dataclass(frozen=True)
class AuthContext:
    """Verified identity plus a Supabase client constrained by that JWT."""

    user: object
    profile: dict
    database: object


def _verify_access_token(token: str):
    try:
        response = supabase_admin.auth.get_user(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Unauthorized") from exc

    if not response or not response.user:
        raise HTTPException(status_code=401, detail="Invalid token")
    return response.user


# 從 token 解析當前使用者
def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    return _verify_access_token(credentials.credentials)


def get_auth_context(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Generator[AuthContext, None, None]:
    """Verify the JWT and build a per-request, RLS-aware database context."""
    token = credentials.credentials
    user = _verify_access_token(token)
    database = create_user_supabase_client(token)
    try:
        try:
            profile = (
                database.table("users")
                .select("id,name,email,role,student_number,class_id,auth_id")
                .eq("auth_id", user.id)
                .single()
                .execute()
                .data
            )
        except Exception as exc:
            raise HTTPException(
                status_code=403, detail="找不到可使用的帳號資料"
            ) from exc

        if not profile:
            raise HTTPException(status_code=403, detail="找不到可使用的帳號資料")
        yield AuthContext(
            user=user,
            profile=profile,
            database=database,
        )
    finally:
        # The user client is request-scoped; close its shared HTTP session to
        # avoid leaking connections under concurrent student traffic.
        database.postgrest.aclose()
