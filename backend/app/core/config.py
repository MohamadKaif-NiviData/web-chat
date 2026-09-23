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
