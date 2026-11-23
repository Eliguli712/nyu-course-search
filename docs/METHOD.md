# Method: semantic course search with Chebyshev/PCCA reranking

This note describes what the code in `backend/app/` does. It does not report
retrieval-quality or latency numbers: no evaluation has been run yet. The
thumb-up table (`result_feedback`) exists to collect the relevance labels such
an evaluation needs.

## 1. Pipeline

```
bulletins.nyu.edu/courses/ ──scrape.py──▶ Postgres (courses)
                                              │ embed-courses (search_document: prefix)
                                              ▼
user query ──cache.py (L1 LRU → L2 Redis → model, search_query: prefix)
           ──search.py: pgvector cosine ANN, 3× overfetch (HNSW index)
           ──similarity.py: rerank = α·Chebyshev + (1−α)·PCCA, α = 0.75
           ──FastAPI + Jinja2 + HTMX results page
```

## 2. Indexing

- **Scraping** (`scrape.py`): fetch the Bulletin root index, follow every
  subject page under `/courses/` (at most 8 requests in flight), and parse each
  `div.courseblock` into code, name, description and source URL.
- **Embedding** (`embeddings.py`): `nomic-ai/nomic-embed-text-v1`, 768
  dimensions. Courses are embedded as `"{code} {name}. {description}"` with the
  `search_document:` prefix; queries use `search_query:`. Token states are
  mean-pooled and L2-normalised.
- **Storage** (`db.py`, `models.py`): pgvector column with an HNSW index
  (`vector_cosine_ops`, m = 16, ef_construction = 64).

## 3. Retrieval and reranking

**Stage 1.** pgvector returns the `3 × limit` nearest courses by cosine distance.

**Stage 2a — Chebyshev score.** With z the cosine similarity, the kernel
f(z) = exp(−σ(1 − z)), σ = 2, is projected onto T₀…T₄ by the discrete cosine
formula at 400 Chebyshev nodes:

  k̃(z) = a₀ + a₁T₁(z) + a₂T₂(z) + a₃T₃(z) + a₄T₄(z),
  T₁ = z, T₂ = 2z² − 1, T₃ = 4z³ − 3z, T₄ = 8z⁴ − 8z² + 1.

Scores are divided by the batch maximum and clipped to [0, 1].

**Stage 2b — PCCA-style score.** Each vector gets a soft membership over
k = 16 prototype centroids, m(x) = softmax(4 · Cx), and the score is
m(course) · m(query), again divided by the batch maximum. The name borrows
the soft-membership idea of PCCA+ (Deuflhard & Weber 2005); there is no
transition matrix or Perron eigenproblem here.

**Blend.** score = 0.75 · Chebyshev + 0.25 · PCCA.

### Caveats to resolve before claiming gains

1. f(z) is increasing in z, so on its own the Chebyshev score reorders
   candidates (almost) exactly as cosine similarity does; it reshapes the
   score scale shown in the UI rather than the ranking.
2. The centroids are currently random unit vectors (seed 42), a placeholder.
   Fitting them by k-means on the course embeddings is the intended
   replacement (see `similarity.py`).
3. Both components are normalised by the batch maximum, so the top result
   always shows a Chebyshev component of 1.0 and scores are not comparable
   across queries.

## 4. Caching

Query vectors are cached in a 512-entry in-process LRU (L1) backed by Redis
with a 7-day TTL (L2). Course-detail lookups are cached in Redis for 7 days
(6 hours for misses).

## 5. Course details

`details.py` builds a Class Search URL (`?search=<code>&term=<term>`) and
walks terms newest-first (Fall, Summer, Spring; starting one year ahead), up
to 20 terms, until the course appears.

## 6. Evaluation plan

- Collect thumb-up labels with their rank and query (`result_feedback`).
- Compare cosine-only, Chebyshev-only, PCCA-only (random vs k-means
  centroids) and the blend on NDCG@10, MRR and P@5 over a fixed query set.
- Measure query latency separately for L1 hits, L2 hits and cold model calls.

## References

1. Malkov, Y. A., & Yashunin, D. A. (2020). Efficient and robust approximate
   nearest neighbor search using Hierarchical Navigable Small World graphs.
   *IEEE TPAMI*, 42(4), 824–836.
2. Nussbaum, Z., Morris, J. X., Duderstadt, B., & Mulyar, A. (2024). Nomic
   Embed: Training a Reproducible Long Context Text Embedder. arXiv:2402.01613.
3. Deuflhard, P., & Weber, M. (2005). Robust Perron cluster analysis in
   conformation dynamics. *Linear Algebra and its Applications*, 398, 161–184.
   doi:10.1016/j.laa.2004.10.026
4. Mason, J. C., & Handscomb, D. C. (2003). *Chebyshev Polynomials*. Chapman &
   Hall/CRC.
