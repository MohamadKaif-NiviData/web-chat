'''
Why: password hashing and JWT creation/validation are security-sensitive and
used from multiple places (signup, login, the auth dependency, refresh).
Writing this logic once here — instead of re-implementing hashing or token
checks inline in each route — means there's only one place that can get the
crypto wrong, and it's easy to review.
Plain-English steps:
1. Import a password-hashing library (e.g. `passlib`'s `CryptContext` with
   bcrypt) and a JWT library (e.g. `python-jose` or `pyjwt`).
2. Write `hash_password(plain: str) -> str` and
   `verify_password(plain: str, hashed: str) -> bool`.
3. Write `create_access_token(user_id)` and `create_refresh_token(user_id)` —
   each builds a JWT payload (user id + expiry, using
   `settings.access_token_expire_minutes` / `refresh_token_expire_days`) and
   signs it with `settings.jwt_secret` / `settings.jwt_algorithm`.
4. Write `decode_token(token: str) -> user_id` that verifies the signature
   and expiry, returning the user id, and raises an error (e.g. a custom
   exception or lets the JWT library's exception propagate) if invalid —
   the caller (Step 4's `get_current_user`) turns that into a 401.
5. Import `settings` from `app/core/config.py` for all the secret/algorithm/
   expiry values — never hardcode them here.
'''

from datetime import datetime, timedelta, timezone

from passlib.context import CryptContext
from jose import jwt, JWTError

from app.core.config import settings

# Both functions below need a shared CryptContext instance to work off of —
# it's what actually knows how to run bcrypt. Create ONE at module level
# (not inside each function — building it is a bit expensive, and both
# functions need the exact same config to agree with each other):
#   pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    # How this works:
    # - pwd_context.hash(plain) runs the bcrypt algorithm on the plain-text
    #   password.
    # - Bcrypt generates a random "salt" (extra random bytes) internally and
    #   mixes it into the hashing process, so hashing the SAME password twice
    #   gives two different-looking outputs each time.
    # - The returned string bundles everything needed to check it later —
    #   algorithm id, a cost factor (how many rounds of hashing, i.e. how
    #   slow/expensive it is to compute), the salt, and the hash itself —
    #   all packed into one string like "$2b$12$<salt><hash>".
    # - It's a ONE-WAY function: there's no operation that turns the hash
    #   back into "plain". That's the entire point — if the database ever
    #   leaks, attackers get unusable hashes, not real passwords.
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    # How this works:
    # - pwd_context.verify(plain, hashed) takes the password the user just
    #   typed in (login attempt) and the hash string stored in the database
    #   from signup.
    # - It reads the salt and cost factor back out of the stored `hashed`
    #   string, then re-runs bcrypt on `plain` using that SAME salt/cost —
    #   producing a fresh hash.
    # - It compares the freshly computed hash to the stored one. Match =
    #   correct password, return True. No match = wrong password, return
    #   False.
    # - Notice this never decrypts anything — it redoes the one-way hashing
    #   process on the new input and compares the two outputs as strings.
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: str) -> str:
    # How this works:
    # - A JWT is really just 3 base64-encoded parts joined by dots:
    #   header.payload.signature — e.g. "eyJhbG...eyJzdWI...SflKxw...".
    #   The header says which algorithm was used, the payload is the actual
    #   data (a Python dict), and the signature is what makes it tamper-proof.
    # - Build the payload dict: put the user id under the "sub" (subject)
    #   claim — that's the JWT-standard field name for "who this token is
    #   about" — plus an "exp" (expiry) claim, computed as
    #   datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes).
    #   jwt.encode() understands a datetime in "exp" and converts it to the
    #   Unix timestamp format JWTs actually use on the wire.
    # - jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)
    #   serializes that payload to JSON, base64-encodes header+payload, then
    #   runs an HMAC (for HS256) over those two parts using jwt_secret as the
    #   key — that HMAC output IS the signature, the third part of the token.
    # - Anyone can base64-DEcode a JWT and read the payload (it's not
    #   encrypted, just encoded) — the secret's only job is making the
    #   signature impossible to forge without knowing it, not hiding the data.
    #   Never put passwords or other secrets inside the payload itself.
    payload_dict ={
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    }
    return jwt.encode(payload_dict, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str) -> str:
    # How this works:
    # - Identical mechanism to create_access_token — same "sub" + "exp"
    #   payload shape, same jwt.encode() call, same secret and algorithm.
    # - The only difference is the expiry length: use
    #   timedelta(days=settings.refresh_token_expire_days) instead of
    #   minutes, since this token is meant to live far longer and only gets
    #   used to mint new access tokens, not sent on every request.
    # - Worth adding a claim like {"type": "refresh"} into the payload (and
    #   {"type": "access"} in create_access_token) — that way decode_token /
    #   your /refresh endpoint can check "was this actually issued as a
    #   refresh token?" and reject someone who tries to use an access token
    #   where a refresh token is required, or vice versa.
    payload_dict = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days),
        "type": "refresh"
    }
    return jwt.encode(payload_dict, settings.jwt_secret, algorithm=settings.jwt_algorithm)

def decode_token(token: str) -> str:
    # How this works:
    # - jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    #   splits the token back into its 3 parts, recomputes the HMAC signature
    #   over header+payload using jwt_secret, and compares it to the
    #   signature that came with the token.
    # - If someone tampered with the payload (e.g. changed the user id) the
    #   recomputed signature won't match the original — jwt.decode() raises
    #   a JWTError/JWSError in that case instead of returning silently-wrong
    #   data. It also checks the "exp" claim automatically and raises
    #   ExpiredSignatureError (a JWTError subclass) if the token is expired.
    # - On success, jwt.decode() returns the original payload dict — pull the
    #   user id back out with payload["sub"] and return it.
    # - Let JWTError propagate (or catch it and re-raise your own exception
    #   type) — Step 4's get_current_user dependency is what will catch this
    #   and turn it into an HTTP 401, this function's job is just to say
    #   "valid" or "not valid", not to know about HTTP.
    payload = jwt.decode(token=token,key=settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    return payload["sub"]
