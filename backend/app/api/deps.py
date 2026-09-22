# Why: every protected route needs to answer "who is making this request?"
# Writing that check once, here, as a dependency means a route just declares
# `current_user: User = Depends(get_current_user)` in its signature and gets
# a verified `User` object for free — instead of every route re-parsing
# headers and re-checking tokens itself.
#
# Plain-English steps:
# 1. Import `HTTPException`, `Depends` from `fastapi`; `OAuth2PasswordBearer`
#    from `fastapi.security`; `AsyncSession` from `sqlalchemy.ext.asyncio`;
#    `select` from `sqlalchemy`; `JWTError` from `jose`; `decode_token` from
#    `app.core.security`; `get_db` from `app.db.session`; `User` from
#    `app.models.user`.
# 2. `oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")` — this is
#    what tells FastAPI's auto-generated docs (Swagger UI) how to prompt for
#    a token; the actual header-parsing (`Authorization: Bearer <token>`) it
#    does for you when you use it as a dependency below.
# 3. Write:
#    ```
#    async def get_current_user(
#        token: str = Depends(oauth2_scheme),
#        db: AsyncSession = Depends(get_db),
#    ) -> User:
#    ```
#    - `token` arrives already extracted from the Authorization header by
#      `oauth2_scheme` — you never touch raw headers yourself.
#    - `db` arrives as a ready-to-use session via Step 3's `get_db`.
# 4. Inside the function:
#    - Call `decode_token(token)` wrapped in a try/except catching `JWTError`
#      — on failure, raise `HTTPException(status_code=401, detail="Invalid
#      or expired token")`. This is the ONE place a raw JWT error gets
#      translated into an HTTP-shaped error; nothing above this layer should
#      ever see a `JWTError` directly.
#    - Use the user id `decode_token()` returned to query the db:
#      `result = await db.execute(select(User).where(User.id == user_id))`
#      then `user = result.scalar_one_or_none()`.
#    - If `user` is `None` (e.g. the user was deleted after the token was
#      issued), also raise the same 401 — don't distinguish "bad token" from
#      "token valid but user gone" in the response, since both just mean
#      "you're not authenticated."
#    - Return `user`.
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
    
