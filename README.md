# NYU Course Search

Semantic search over all NYU Bulletin course descriptions, with per-user saved lists and relevance feedback.

**Project explorer (web page):** https://eliguli712.github.io/nyu-course-search/ — a VS Code–style browser of the file tree with rendered previews of every UI template. Source: [`explorer/nyu-explorer.jsx`](explorer/nyu-explorer.jsx); the built page is [`docs/index.html`](docs/index.html). The explorer shows condensed excerpts of the Python modules; the full code is under [`backend/`](backend/).

Method write-up: [`docs/METHOD.md`](docs/METHOD.md) · Original spec: [`PLAN.md`](PLAN.md) · Implementation log: [`PROGRESS.md`](PROGRESS.md)

## Stack

| Layer | Technology |
|---|---|
| Web framework | FastAPI + Jinja2 + HTMX |
| Database | PostgreSQL + pgvector (HNSW index) |
| Cache | Redis (two-level: in-process LRU + Redis) |
| Embeddings | `nomic-ai/nomic-embed-text-v1` via HuggingFace |
| Reranking | Chebyshev T₁–T₄ polynomial + PCCA similarity blend |
| Deployment | Docker + Railway |

## Local development

### 1. Start Postgres + Redis

```bash
docker run --name nyu-pg \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=nyu_courses \
  -p 5432:5432 -d pgvector/pgvector:pg16

docker run --name nyu-redis -p 6379:6379 -d redis:7
```

### 2. Configure environment

```bash
cp .env.example backend/.env
# Edit backend/.env — change SECRET_KEY at minimum
```

### 3. Install and run

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# One-time setup
python scripts/manage.py init-db
python scripts/manage.py scrape-courses
python scripts/manage.py embed-courses --limit 2000

# Start server
uvicorn app.main:app --reload
```

Open http://127.0.0.1:8000

### Management commands

```bash
python scripts/manage.py init-db          # create tables + HNSW index
python scripts/manage.py scrape-courses   # scrape NYU Bulletin → DB
python scripts/manage.py embed-courses    # embed all un-embedded courses
python scripts/manage.py embed-courses --limit 0   # embed ALL courses
python scripts/manage.py stats            # show DB statistics
python scripts/manage.py reset-db --yes  # ⚠ drop and recreate all tables
```

## Course details

The detail panel is loaded lazily via HTMX. It tries `Fall`, `Summer`, and `Spring` of the current year, then walks back year-by-year until a result is found on the NYU Class Search page. Results are cached in Redis for 7 days (misses for 6 hours).

## Deployment on Railway

1. Create a new Railway project and add **Postgres** and **Redis** services.
2. Ensure Postgres has the `pgvector` extension available (`pgvector/pgvector` Docker image, or Railway's managed Postgres which supports it).
3. Add the following environment variables in Railway:
   - `SECRET_KEY` — a long random string
   - `ENVIRONMENT=prod`
   - `DATABASE_URL` — provided by Railway
   - `REDIS_URL` — provided by Railway
4. Deploy. On first deploy, run setup via Railway's shell or a one-off run:

```bash
python backend/scripts/manage.py init-db
python backend/scripts/manage.py scrape-courses
python backend/scripts/manage.py embed-courses --limit 0
```

The app will be reachable at your Railway public URL. `/health` is the health check endpoint.

## Architecture notes

### Embedding prefixes
The Nomic model requires task-specific prefixes for best performance:
- `search_document:` for courses being indexed
- `search_query:` for user queries at search time

These are applied automatically by `embeddings.py`.

### Two-level cache
Query vectors are cached in a 512-slot in-process LRU ring buffer (L1, ~0 µs) backed by Redis with a 7-day TTL (L2, ~0.2 ms). This avoids redundant model inference for repeated queries.

### Reranking
pgvector ANN retrieves 3× the requested number of candidates. These are then reranked by a blend of:
- **Chebyshev T₁–T₄** polynomial approximation of an RBF kernel applied to cosine similarity
- **PCCA-style** soft cluster similarity (inner product of softmax membership weights)

The final blend weight α=0.75 favours the polynomial scorer.

## Rebuilding the explorer page

```bash
# from the repo root, with react, react-dom and esbuild available
cat > entry.jsx <<'JS'
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./explorer/nyu-explorer.jsx";
createRoot(document.getElementById("root")).render(<App />);
JS
esbuild entry.jsx --bundle --minify --jsx=automatic \
  --define:process.env.NODE_ENV='"production"' --outfile=bundle.js
# then inline bundle.js into docs/index.html inside <script>…</script>
```

## Provenance

`config.py`, `auth.py` and `scrape.py` were rebuilt from the excerpts kept in the explorer, because their full text was not preserved with the rest of the project; their public names match what `main.py` and `scripts/manage.py` import. All other files are the last saved versions.
