"""
Application settings, read from environment variables (or a local .env file).

Reconstructed from the project's viewer excerpt; field names match .env.example.
"""
from __future__ import annotations

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    secret_key: str = "change-me"
    environment: str = "dev"           # dev | prod

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/nyu_courses"
    redis_url: str = "redis://localhost:6379/0"

    session_cookie_name: str = "nyu_course_session"
    session_max_age_seconds: int = 60 * 60 * 24 * 14   # 14 days
    nyu_email_domain: str = "nyu.edu"

    bulletins_courses_root: str = "https://bulletins.nyu.edu/courses/"
    bulletins_class_search_root: str = "https://bulletins.nyu.edu/class-search/"

    embedding_model_id: str = "nomic-ai/nomic-embed-text-v1"
    embedding_max_length: int = 512
    embedding_batch_size: int = 32

    @field_validator("database_url")
    @classmethod
    def _use_asyncpg_driver(cls, v: str) -> str:
        # Railway (and Heroku-style hosts) hand out postgres:// or postgresql://
        # URLs; SQLAlchemy's async engine needs the asyncpg driver spelled out.
        if v.startswith("postgres://"):
            v = "postgresql://" + v[len("postgres://"):]
        if v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://"):]
        return v


settings = Settings()
