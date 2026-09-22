# Why: same reasoning as app/schemas/user.py — a dedicated shape for what
# goes over the wire during login/token exchange, separate from how a user
# is stored or represented elsewhere.
#
# Plain-English steps:
# 1. Import `BaseModel`, `EmailStr` from `pydantic`.
# 2. `class LoginRequest(BaseModel):` — `email: EmailStr`, `password: str`.
# 3. `class TokenResponse(BaseModel):` —
#    - `access_token: str`
#    - `refresh_token: str`
#    - `token_type: str = "bearer"` — "bearer" is the standard value clients
#      look for to know how to send the token back on later requests
#      (`Authorization: Bearer <token>`). Giving it a default means routes
#      don't need to set it explicitly every time.

from pydantic import BaseModel, EmailStr

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str="bearer"    

class RefreshRequest(BaseModel):
    refresh_token: str