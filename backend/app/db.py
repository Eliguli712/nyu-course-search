from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy import text

from .config import settings

engine = create_async_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def ensure_extensions() -> None:
    """Install pgvector. Safe to call multiple times."""
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))


async def ensure_tables() -> None:
    """Idempotent CREATE TABLE IF NOT EXISTS for all models."""
    from .models import Base  # local import avoids circular deps at module init

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # HNSW index — better than IVFFLAT for <100k rows; no minimum row count
        await conn.execute(
            text(
                "CREATE INDEX IF NOT EXISTS courses_embedding_hnsw "
                "ON courses USING hnsw (embedding vector_cosine_ops) "
                "WITH (m = 16, ef_construction = 64)"
            )
        )
