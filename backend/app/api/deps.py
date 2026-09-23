from fastapi import HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from jose import JWTError
from app.core.security import decode_token
from app.db.session import get_db
from app.models.user import User

oauth2 = OAuth2PasswordBearer(tokenUrl="auth/login")
async def get_current_user(token: str= Depends(oauth2), db: AsyncSession= Depends(get_db))->User:
    try:
        user_id = decode_token(token=token)
        result = await db.execute(select(User).where(User.id == int(user_id)))
        user = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return user
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")    
    
