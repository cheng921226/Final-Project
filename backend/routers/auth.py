from database.supabase import SUPABASE_KEY, SUPABASE_URL, supabase_admin
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from supabase import create_client

router = APIRouter()


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str


@router.post("/register")
def register(data: RegisterRequest):
    try:
        res = supabase_admin.auth.admin.create_user(
            {"email": data.email, "password": data.password, "email_confirm": True}
        )

        user = res.user

        if user is None:
            raise HTTPException(400, detail="Create user failed")

        db_res = (
            supabase_admin.table("users")
            .insert(
                {
                    "auth_id": user.id,
                    "name": data.name,
                    "email": data.email,
                    "role": "student",
                }
            )
            .execute()
        )

        if not db_res.data:
            supabase_admin.auth.admin.delete_user(user.id)
            raise HTTPException(status_code=400, detail="Insert user profile failed")

        return {"message": "register success"}
    except Exception as e:
        raise HTTPException(400, detail=str(e))


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/login")
def login(data: LoginRequest):
    try:
        res = supabase_admin.auth.sign_in_with_password(
            {"email": data.email, "password": data.password}
        )

        return {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
            "user": {"auth_id": res.user.id, "email": res.user.email},
        }

    except Exception as e:
        raise HTTPException(401, detail=str(e))


@router.post("/refresh")
def refresh_session(data: RefreshRequest):
    try:
        # Use a request-scoped client because refresh tokens rotate after use.
        # Sharing auth session state between concurrent FastAPI requests can
        # otherwise cause one student's session to affect another request.
        auth_client = create_client(SUPABASE_URL, SUPABASE_KEY)
        res = auth_client.auth.refresh_session(data.refresh_token)

        if not res.session:
            raise HTTPException(status_code=401, detail="Session refresh failed")

        return {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
        }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid refresh token")


@router.post("/logout")
def logout():
    return {"message": "logout success"}
