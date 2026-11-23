"""
Two-level cache for high-dimensional embedding vectors.

L1 – in-process ring buffer (LRU, Python-side, zero-latency)
      Holds raw numpy float32 arrays keyed by query text.
L2 – Redis (shared, persistent across restarts, TTL-controlled)
      Stores JSON-serialized float lists for query→vector lookups.

Usage pattern:
    vec = await cached_embed(query_text, embed_texts)
"""
from __future__ import annotations

import json
import time
from collections import OrderedDict
from typing import Optional

import numpy as np
import redis.asyncio as redis

from .config import settings

# ── L1: in-process LRU ring buffer ──────────────────────────────────────────

class _VectorRingBuffer:
    """
    Fixed-capacity LRU cache of (str → np.ndarray[float32]).

    Each 768-dim float32 vector ≈ 3 KB; default 512 entries ≈ 1.5 MB total.
    """

    def __init__(self, capacity: int = 512) -> None:
        self._cap = capacity
        self._store: OrderedDict[str, tuple[np.ndarray, float]] = OrderedDict()

    def get(self, key: str) -> Optional[np.ndarray]:
        if key not in self._store:
            return None
        self._store.move_to_end(key)
        vec, _ = self._store[key]
        return vec

    def set(self, key: str, vec: np.ndarray) -> None:
        if key in self._store:
            self._store.move_to_end(key)
        self._store[key] = (vec.astype(np.float32, copy=False), time.monotonic())
        if len(self._store) > self._cap:
            self._store.popitem(last=False)  # evict LRU

    def __len__(self) -> int:
        return len(self._store)

    def stats(self) -> dict:
        return {"l1_entries": len(self._store), "l1_capacity": self._cap}


_GLOBAL_BUFFER: Optional[_VectorRingBuffer] = None


def get_vector_buffer(capacity: int = 512) -> _VectorRingBuffer:
    global _GLOBAL_BUFFER
    if _GLOBAL_BUFFER is None:
        _GLOBAL_BUFFER = _VectorRingBuffer(capacity=capacity)
    return _GLOBAL_BUFFER


# ── L2: Redis client ─────────────────────────────────────────────────────────

_REDIS_INSTANCE: Optional[redis.Redis] = None


def get_redis() -> redis.Redis:
    global _REDIS_INSTANCE
    if _REDIS_INSTANCE is None:
        _REDIS_INSTANCE = redis.from_url(settings.redis_url, decode_responses=True)
    return _REDIS_INSTANCE


# ── Two-level cache accessor ─────────────────────────────────────────────────

_VEC_PREFIX = "vec:"
_VEC_TTL = 60 * 60 * 24 * 7  # 7 days in Redis


async def cached_embed(query: str, embed_fn) -> list[float]:
    """
    Retrieve (or compute-and-store) an embedding vector with two-level caching.

    1. Check L1 ring buffer  (sync,  ~0 µs).
    2. Check L2 Redis        (async, ~0.2 ms local).
    3. Fall through to embed_fn (CPU/GPU, ~50-500 ms).

    Returns a Python list[float] for compatibility with existing vector_search().
    """
    buf = get_vector_buffer()
    rds = get_redis()

    # ── L1 hit ───────────────────────────────────────────────────────────────
    arr = buf.get(query)
    if arr is not None:
        return arr.tolist()

    # ── L2 hit ───────────────────────────────────────────────────────────────
    key = _VEC_PREFIX + query
    raw = await rds.get(key)
    if raw is not None:
        vec_list: list[float] = json.loads(raw)
        arr = np.array(vec_list, dtype=np.float32)
        buf.set(query, arr)   # warm L1
        return vec_list

    # ── Miss: compute → populate both levels ─────────────────────────────────
    vec_list = embed_fn([query])[0]
    arr = np.array(vec_list, dtype=np.float32)

    buf.set(query, arr)
    try:
        await rds.set(key, json.dumps(vec_list), ex=_VEC_TTL)
    except Exception:
        pass  # non-fatal; L1 still warm

    return vec_list
