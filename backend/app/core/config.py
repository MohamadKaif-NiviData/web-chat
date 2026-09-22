# WHAT GOES IN THIS FILE, AND WHY
#
# This file is the single place that reads environment variables (the values
# sitting in the root .env: DATABASE_URL, REDIS_URL, JWT_SECRET,
# JWT_ALGORITHM, ACCESS_TOKEN_EXPIRE_MINUTES, REFRESH_TOKEN_EXPIRE_DAYS).
#
# Why centralize it: every other file in the backend (db session, security,
# routes) needs some of these values. If each of those files called
# os.environ directly, the same env var names would be scattered across the
# codebase, easy to typo, and hard to see at a glance what config the app
# even depends on. Instead, every other file imports one `settings` object
# from here and reads values off it — this file is the only one that ever
# touches raw environment variables.
#
# The library that makes this easy is `pydantic-settings` (already in
# requirements.txt). It gives you a base class where you declare fields like
# a normal Pydantic model, and it automatically fills each field from the
# environment variable of the same name — no manual os.environ.get() calls.


from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url : str
    redis_url : str
    jwt_secret : str
    jwt_algorithm : str
    access_token_expire_minutes : int
    refresh_token_expire_days : int

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

settings = Settings()    
