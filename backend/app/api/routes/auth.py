# Why: this is where signup/login/refresh actually live — the one place
# that ties together the schemas (shape of requests/responses), security.py
# (hashing + tokens), and the User model (storage) into actual endpoints.
#
# Plain-English steps:
# 1. Import `APIRouter`, `HTTPException`, `Depends` from `fastapi`;
#    `AsyncSession` from `sqlalchemy.ext.asyncio`; `select` from
#    `sqlalchemy`; `get_db` from `app.db.session`; `User` from
#    `app.models.user`; `UserCreate`, `UserResponse` from
#    `app.schemas.user`; `LoginRequest`, `TokenResponse` from
#    `app.schemas.auth`; `hash_password`, `verify_password`,
#    `create_access_token`, `create_refresh_token`, `decode_token` from
#    `app.core.security`.
# 2. `router = APIRouter()` — main.py will register this with a prefix like
#    `/auth` (see Step 2's leftover comment in main.py about registering
#    routers).
#
# 3. Signup — `@router.post("/signup", response_model=UserResponse)`:
#    - Take `payload: UserCreate` and `db: AsyncSession = Depends(get_db)`.
#    - Query for an existing user with `payload.email` — if found, raise
#      `HTTPException(status_code=409, detail="Email already registered")`.
#    - `hashed = hash_password(payload.password)`, build a `User(...)` row
#      with it, `db.add(user)`, `await db.commit()`, `await db.refresh(user)`
#      (refresh pulls back the db-generated `id`/`created_at`), return `user`
#      — FastAPI converts it through `UserResponse` automatically.
#
# 4. Login — `@router.post("/login", response_model=TokenResponse)`:
#    - Take `payload: LoginRequest` and `db: AsyncSession = Depends(get_db)`.
#    - Look up the user by `payload.email` — if not found, raise
#      `HTTPException(status_code=401, detail="Invalid credentials")`.
#    - Call `verify_password(payload.password, user.hashed_password)` — if
#      it returns False, raise the SAME 401 as above (deliberately identical
#      wording/status for "no such email" and "wrong password", so a caller
#      can't use this endpoint to discover which emails are registered).
#    - On success: `create_access_token(str(user.id))` and
#      `create_refresh_token(str(user.id))`, return a `TokenResponse` with
#      both.
#
# 5. Refresh — `@router.post("/refresh", response_model=TokenResponse)`:
#    - Take the refresh token (e.g. a small inline Pydantic model or just a
#      `refresh_token: str` body field).
#    - Call `decode_token(refresh_token)` to get the user id back (wrap in
#      try/except JWTError -> 401, same as deps.py).
#    - NOTE: `decode_token()` as written only returns `payload["sub"]` (the
#      user id string), not the full payload — so it can't check the
#      `"type": "refresh"` claim you added in `create_refresh_token()`. For
#      MVP this is an accepted gap (an access token could technically be
#      used here too, since both are signed with the same secret and decode
#      the same way). If you want that extra check later, it means either
#      changing `decode_token()` to return the full payload dict (then
#      updating `deps.py`'s `get_current_user` to pull `payload["sub"]`
#      itself), or decoding the raw JWT separately just in this route.
#    - Issue a new `create_access_token(user_id)` and return it.

from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.session import get_db
from app.models.user import User
from app.schemas.user import UserCreate, UserResponse
from app.schemas.auth import LoginRequest, TokenResponse, RefreshRequest
from app.core.security import (hash_password, verify_password, create_access_token, create_refresh_token, decode_token)
from jose import JWTError

router =APIRouter()

@router.post("/signup", response_model=UserResponse)
async def signup(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        display_name=payload.display_name,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession= Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials"
        )
    if not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials"
        )
    access_token = create_access_token(str(user.id))
    refresh_token = create_refresh_token(str(user.id))
    return TokenResponse(
        access_token=access_token,
        refresh_token= refresh_token
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(payload: RefreshRequest):
    try:
        user_id = decode_token(payload.refresh_token)
        refresh_token = create_refresh_token(user_id=user_id)
        access_token = create_access_token(user_id=user_id)
        return TokenResponse(
            access_token=access_token,
            refresh_token= refresh_token
        )
    except JWTError:
            raise HTTPException(status_code=401, detail="Invalid or expired token")    