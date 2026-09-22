# Why: the SQLAlchemy `User` model (app/models/user.py) defines what's in
# the DATABASE. This file defines what's allowed over the WIRE (the API) —
# deliberately a different shape. A signup request should never be able to
# set `hashed_password` directly, and a user response should never leak
# `hashed_password` back out to a client. Two separate schema classes make
# each direction explicit instead of accidentally exposing a DB column
# through the API by reusing one shape for both.
#
# Plain-English steps:
# 1. Import `BaseModel`, `EmailStr`, `ConfigDict` from `pydantic`.
# 2. `class UserCreate(BaseModel):` — the shape of a signup REQUEST:
#    - `email: EmailStr` (validates it looks like an email, not just any str)
#    - `password: str` — plain-text, only exists in-memory for the length of
#      the signup request; never stored as-is, always run through
#      `hash_password()` from `app.core.security` before saving.
#    - `display_name: str`
# 3. `class UserResponse(BaseModel):` — the shape of a user sent back in a
#    RESPONSE:
#    - `id: int`
#    - `email: EmailStr`
#    - `display_name: str`
#    - deliberately NO password field of any kind.
#    - `model_config = ConfigDict(from_attributes=True)` — lets you return a
#      SQLAlchemy `User` object directly from a route (e.g. `return user`)
#      and have FastAPI read its attributes to build this schema, instead of
#      manually converting it to a dict yourself.
from pydantic import BaseModel, EmailStr, ConfigDict

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    display_name: str

class UserResponse(BaseModel):
    id:int
    email:EmailStr
    display_name: str
    model_config = ConfigDict(from_attributes=True)
