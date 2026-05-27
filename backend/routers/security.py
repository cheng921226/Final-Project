from database.supabase import supabase_admin
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer()


# 從 token 解析當前使用者
def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials

    try:
        user = supabase_admin.auth.get_user(token)

        if not user or not user.user:
            raise HTTPException(status_code=401, detail="Invalid token")

        return user.user

    except Exception:
        raise HTTPException(status_code=401, detail="Unauthorized")
