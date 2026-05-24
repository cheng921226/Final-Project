from database.supabase import supabase_admin
from fastapi import APIRouter,HTTPException
from pydantic import BaseModel, EmailStr

router = APIRouter()

class RegisterRequest(BaseModel):
    name:str
    email:EmailStr
    password:str

@router.post("/register")
def register(data : RegisterRequest):
    try:
        res = supabase_admin.auth.admin.create_user({
            "email":data.email,
            "password":data.password,
            "email_confirm":True
        })
        
        user=res.user
        
        if user is None:
            raise HTTPException(400, detail="Create user failed")
        
        supabase_admin.table("users").insert({
            "name":data.name,
            "email":data.email,
            "role":"student",
        }).execute()

        return {"message": "register success"}
    except Exception as e:
        raise HTTPException(400, detail=str(e))

class LoginRequest(BaseModel):
    email:EmailStr
    password:str

@router.post("/login")
def login(data : LoginRequest):
    try:
        res = supabase_admin.auth.sign_in_with_password({
            "email": data.email,
            "password": data.password
        })

        return {
            "access_token": res.session.access_token,
            "refresh_token": res.session.refresh_token,
            "user": {
                "id": res.user.id,
                "email": res.user.email
            }
        }

    except Exception as e:
        raise HTTPException(401, detail=str(e))

@router.post("/logout")
def logout():
    return {"message": "logout success"}