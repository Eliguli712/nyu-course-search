"""
Search layer: vector retrieval (pgvector) + two-level embedding cache +
Chebyshev T₁–T₄ / PCCA reranking.

vector_search now returns (courses, scores) so callers can surface
relevance scores in the UI.
"""
from __future__ import annotations

import uuid
from typing import Optional

import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text

from .models import Course
from .similarity import rerank

_OVERFETCH = 3


async def vector_search(
    db: AsyncSession,
    query_vec: list[float],
    limit: int = 20,
    alpha: float = 0.75,
) -> tuple[list[Course], dict[uuid.UUID, float]]:
    """
    1. Retrieve limit*OVERFETCH candidates by pgvector cosine distance.
    2. Rerank using Chebyshev T₁–T₄ + PCCA blend.
    3. Return (courses, scores) where scores maps course.id → float in [0,1].
    """
    fetch_limit = limit * _OVERFETCH

    stmt = (
        select(Course)
        .where(Course.embedding.isnot(None))
        .order_by(Course.embedding.cosine_distance(query_vec))
        .limit(fetch_limit)
    )
    res = await db.execute(stmt)
    candidates: list[Course] = list(res.scalars().all())

    if not candidates:
        return [], {}

    embeddings = [c.embedding for c in candidates if c.embedding is not None]
    if not embeddings:
        return candidates[:limit], {}

    ranked = rerank(query_vec, embeddings, alpha=alpha)  # [(orig_idx, score), ...]
    top = ranked[:limit]

    courses = [candidates[i] for i, _ in top]
    scores  = {candidates[i].id: float(score) for i, score in top}
    return courses, scores


async def keyword_fallback(
    db: AsyncSession,
    q: str,
    limit: int = 20,
) -> list[Course]:
    like = f"%{q}%"
    stmt = (
        select(Course)
        .where(
            (Course.name.ilike(like))
            | (Course.description.ilike(like))
            | (Course.code.ilike(like))
        )
        .limit(limit)
    )
    res = await db.execute(stmt)
    return list(res.scalars().all())
