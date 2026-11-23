"""
Course relevance scoring via two complementary similarity measures.

1) Chebyshev-polynomial (T₁–T₄) approximation of an RBF kernel
   ─────────────────────────────────────────────────────────────
   Maps cosine similarity z ∈ [-1,1] through a degree-4 Chebyshev expansion
   to get a smooth, fast, polynomial approximation of exp(-σ·(1-z)).

   T₁(z) =  z
   T₂(z) =  2z² − 1
   T₃(z) =  4z³ − 3z
   T₄(z) =  8z⁴ − 8z² + 1

   Approximation:  k̃(z) = a₀ + a₁T₁ + a₂T₂ + a₃T₃ + a₄T₄

   Coefficients are pre-fit for an RBF with σ=2 (tunable).

2) PCCA-style fuzzy cluster similarity
   ─────────────────────────────────────
   Soft-assigns each embedding to k prototype centroids (loaded from a small
   in-memory table), then uses inner-product of membership weight vectors:
       s_PCCA(x,y) = m(x)·m(y)   where m(x) ∈ Δ^k (probability simplex)

   Final score blends both:
       score = α · s_cheb(q, c) + (1-α) · s_pcca(q, c)
"""
from __future__ import annotations

import math
from typing import Sequence

import numpy as np


# ── Chebyshev polynomial helpers ─────────────────────────────────────────────

def T1(z: np.ndarray) -> np.ndarray: return z
def T2(z: np.ndarray) -> np.ndarray: return 2.0 * z**2 - 1.0
def T3(z: np.ndarray) -> np.ndarray: return 4.0 * z**3 - 3.0 * z
def T4(z: np.ndarray) -> np.ndarray: return 8.0 * z**4 - 8.0 * z**2 + 1.0


def _chebyshev_rbf_coeffs(sigma: float = 2.0, n_fit: int = 400) -> np.ndarray:
    """
    Numerically compute Chebyshev expansion coefficients a₀..a₄ for
        f(z) = exp(-sigma * (1 - z)),   z ∈ [-1, 1]
    using the discrete cosine projection formula.
    """
    z = np.cos(np.pi * (2 * np.arange(1, n_fit + 1) - 1) / (2 * n_fit))
    f = np.exp(-sigma * (1.0 - z))

    T = np.stack([np.ones_like(z), T1(z), T2(z), T3(z), T4(z)], axis=0)  # (5, n_fit)
    coeffs = (2.0 / n_fit) * (T @ f)
    coeffs[0] /= 2.0  # a₀ uses 1/n not 2/n
    return coeffs  # shape (5,)


# Pre-computed coefficients at module load (negligible cost)
_CHEB_COEFFS = _chebyshev_rbf_coeffs(sigma=2.0)


def chebyshev_similarity(
    query_vec: np.ndarray,      # shape (D,), L2-normalised
    course_vecs: np.ndarray,    # shape (N, D), L2-normalised
) -> np.ndarray:
    """
    Returns shape (N,) scores in [0, 1] via the T₁–T₄ polynomial approximation.

    z = cosine_similarity(query, course) ∈ [-1,1]  (exact for L2-normed inputs)
    k̃(z) = Σᵢ aᵢ Tᵢ(z)  clipped to [0, 1]
    """
    z = course_vecs @ query_vec  # (N,) cosine similarities

    a = _CHEB_COEFFS
    k = (a[0] * np.ones_like(z)
         + a[1] * T1(z)
         + a[2] * T2(z)
         + a[3] * T3(z)
         + a[4] * T4(z))

    return np.clip(k / k.max() if k.max() > 0 else k, 0.0, 1.0)


# ── PCCA-style soft-cluster similarity ──────────────────────────────────────

_N_CLUSTERS = 16   # prototype centroids; can be replaced with real k-means


def _init_random_centroids(dim: int = 768, k: int = _N_CLUSTERS, seed: int = 42) -> np.ndarray:
    """
    Placeholder centroids (unit-normalised random vectors).
    In production: replace with centroids fit on actual course embeddings via k-means.
    """
    rng = np.random.default_rng(seed)
    C = rng.standard_normal((k, dim)).astype(np.float32)
    norms = np.linalg.norm(C, axis=1, keepdims=True)
    return C / norms


_CENTROIDS: np.ndarray | None = None


def get_centroids(dim: int = 768) -> np.ndarray:
    global _CENTROIDS
    if _CENTROIDS is None:
        _CENTROIDS = _init_random_centroids(dim=dim)
    return _CENTROIDS


def _softmax(x: np.ndarray, temp: float = 4.0) -> np.ndarray:
    """Softmax with temperature along last axis."""
    e = np.exp((x - x.max(axis=-1, keepdims=True)) * temp)
    return e / e.sum(axis=-1, keepdims=True)


def membership_weights(
    vecs: np.ndarray,    # shape (N, D)
    centroids: np.ndarray,  # shape (k, D)
    temperature: float = 4.0,
) -> np.ndarray:
    """
    Soft cluster assignment m(x) ∈ Δ^k via softmax of cosine similarities to centroids.
    Returns shape (N, k).
    """
    sims = vecs @ centroids.T   # (N, k)
    return _softmax(sims, temp=temperature)


def pcca_similarity(
    query_vec: np.ndarray,      # shape (D,)
    course_vecs: np.ndarray,    # shape (N, D)
    temperature: float = 4.0,
) -> np.ndarray:
    """
    PCCA-style similarity: s(q,c) = m(q)·m(c).
    Returns shape (N,) scores in [0, 1].
    """
    centroids = get_centroids(dim=query_vec.shape[0])
    mq = membership_weights(query_vec[np.newaxis], centroids, temperature)[0]   # (k,)
    mc = membership_weights(course_vecs, centroids, temperature)                 # (N, k)
    raw = mc @ mq                                                                 # (N,)
    return raw / raw.max() if raw.max() > 0 else raw


# ── Combined scorer ──────────────────────────────────────────────────────────

def combined_similarity(
    query_vec: Sequence[float] | np.ndarray,
    course_vecs: Sequence[Sequence[float]] | np.ndarray,
    alpha: float = 0.75,    # weight on Chebyshev; (1-alpha) on PCCA
) -> np.ndarray:
    """
    Blend Chebyshev polynomial (α) + PCCA cluster (1-α) similarities.

    Returns shape (N,) relevance scores in [0, 1].
    Higher is more relevant.
    """
    qv = np.asarray(query_vec, dtype=np.float32)
    cv = np.asarray(course_vecs, dtype=np.float32)

    # Ensure L2-normalised (idempotent if already normed)
    qv = qv / (np.linalg.norm(qv) + 1e-9)
    norms = np.linalg.norm(cv, axis=1, keepdims=True)
    cv = cv / (norms + 1e-9)

    s_cheb = chebyshev_similarity(qv, cv)
    s_pcca = pcca_similarity(qv, cv)

    return alpha * s_cheb + (1.0 - alpha) * s_pcca


def rerank(
    query_vec: Sequence[float] | np.ndarray,
    course_embeddings: list[list[float]],
    original_indices: list[int] | None = None,
    alpha: float = 0.75,
) -> list[tuple[int, float]]:
    """
    Rerank a list of course embeddings by combined_similarity.

    Returns list of (original_index, score) sorted descending by score.
    """
    if not course_embeddings:
        return []

    scores = combined_similarity(query_vec, course_embeddings, alpha=alpha)
    idxs = original_indices if original_indices is not None else list(range(len(scores)))
    ranked = sorted(zip(idxs, scores.tolist()), key=lambda t: t[1], reverse=True)
    return ranked
