# PROGRESS

## Implementation status against PLAN.md

| Requirement | Status | File(s) |
|---|---|---|
| Scrape all courses from `bulletins.nyu.edu/courses/` | ✅ Done | `scrape.py`, `manage.py scrape-courses` |
| Store courses in Postgres | ✅ Done | `models.py` (`Course`), `db.py` |
| Embed courses with Nomic (`nomic-embed-text-v1`) | ✅ Done | `embeddings.py`, `manage.py embed-courses` |
| Nomic task prefixes (`search_document:` / `search_query:`) | ✅ Fixed | `embeddings.py` |
| Vector similarity search via pgvector | ✅ Done | `search.py`, `models.py` |
| HNSW index for ANN search | ✅ Done | `db.py` (`ensure_tables`) |
| Web UI: semantic search | ✅ Done | `main.py`, `templates/index.html` |
| Web UI: relevance score bars per result | ✅ Done | `templates/partials/results.html` |
| Web UI: score distribution bar chart | ✅ Done | `templates/partials/results.html` |
| Web UI: keyword highlighting in descriptions | ✅ Done | `templates/partials/results.html` (JS) |
| Multi-user support | ✅ Done | `models.py` (`User`), `auth.py` |
| Restrict to `@nyu.edu` emails | ✅ Done | `auth.py` (`enforce_nyu_email`) |
| Session cookies (HttpOnly, Secure in prod) | ✅ Done | `auth.py` |
| Save courses to personal list | ✅ Done | `main.py`, `models.py` (`SavedCourse`) |
| Thumb-up relevance feedback | ✅ Done | `main.py`, `models.py` (`ResultFeedback`) |
| Thumb feedback rank context | ✅ Fixed | `templates/partials/results.html`, `thumb_button.html` |
| Course details via class-search with semester backoff | ✅ Done | `details.py` |
| Course details Redis cache | ✅ Done | `details.py`, `cache.py` |
| Two-level embedding cache (L1 LRU + L2 Redis) | ✅ Done | `cache.py` |
| Postgres + Redis for deployment | ✅ Done | `config.py`, `db.py`, `cache.py` |
| Railway Dockerfile | ✅ Done | `Dockerfile` |
| Railway config (`railway.toml`) | ✅ Added | `railway.toml` |
| Health check endpoint (`/health`) | ✅ Added | `main.py` |
| `.env.example` | ✅ Added | `.env.example` |
| Professional, modern UI (no CDN frameworks) | ✅ Done | `templates/base.html` (hand-crafted CSS) |
| Auto-create tables on startup | ✅ Added | `db.py` (`ensure_tables`), `main.py` startup event |
| Static dir safety (no crash if dir missing) | ✅ Fixed | `main.py` |
| Timezone-aware timestamps | ✅ Fixed | `models.py` (`_now()`) |

---

## File-by-file change log

### `backend/app/embeddings.py`
- Added `_DOC_PREFIX = "search_document: "` and `_QUERY_PREFIX = "search_query: "` —
  the Nomic model requires these for full accuracy (documented in model card).
- Split into `embed_documents()` (for indexing) and `embed_texts()` (for query-time, backward-compat).
- Added `trust_remote_code=True` which the Nomic model requires.

### `backend/app/models.py`
- Replaced all `datetime.utcnow` (deprecated Python 3.12+) with `datetime.now(timezone.utc)`.
- Added `onupdate=_now` to `Course.updated_at`.

### `backend/app/db.py`
- Added `ensure_tables()`: idempotent `CREATE TABLE IF NOT EXISTS` + HNSW index creation.
- Switched from IVFFLAT (`lists=100`, requires ≥3000 rows) to **HNSW** (`m=16`, works on any size).
- Added connection pool sizing (`pool_size=10, max_overflow=20`).

### `backend/app/details.py`
- Fixed term sequence: now tries Fall → Summer → Spring (newest first) per year.
- Improved `_extract_snippet`: scores candidates by richness, handles SPA preloaded state in `<script>` tags.
- Changed cache key prefix (`details2:`) to avoid stale data from old format.
- Uses `dataclasses.asdict()` for clean serialisation.

### `backend/app/main.py`
- Calls `ensure_tables()` on startup so the app self-initialises on first deploy.
- `STATIC_DIR.mkdir(exist_ok=True)` prevents `StaticFiles` crash when directory is absent.
- Added `/health` endpoint returning `{"status": "ok"}`.
- Search endpoint surfaces `error` to template instead of silently swallowing exceptions.
- Cleaner exception typing in register handler.

### `backend/scripts/manage.py`
- `embed-courses` now calls `embed_documents()` (uses `search_document:` prefix).
- Added **Rich progress bar** with ETA for embedding runs.
- Added `stats` command: prints a table of all DB row counts.
- Added `reset-db` command with safety confirmation.
- Fixed HNSW index creation (removed old IVFFLAT attempt).

### `backend/app/templates/partials/results.html`
- Set `{% set rank = loop.index0 %}` and `{% set thumb_rank = loop.index0 %}` so
  the thumb button partial receives them in template scope (was using hidden `<input>` values
  which are not Jinja variables).
- Added `error` display block.
- Improved keyword highlight: filters out common stop words.

### `backend/app/templates/partials/thumb_button.html`
- Fixed `hx-target="this"` (was `closest .btn-ghost`, fragile).
- Uses `thumb_rank` variable (set in loop scope).

### Added files
- `railway.toml`: `healthcheckPath = "/health"`, restart policy, start command.
- `.env.example`: template for all environment variables.
- `backend/app/static/` directory: empty directory so `StaticFiles` mount doesn't crash.

---

## Known limitations / next steps

- [ ] Password reset / email verification (needs SendGrid or similar).
- [ ] PCCA centroids are random initialisation; could be improved by k-means on actual corpus vectors (run once after full embed).
- [ ] Department/school filter using course code prefix.
- [ ] Admin dashboard to view feedback metrics and top queries.
- [ ] Rate limiting on scrape trigger (if exposed via UI) and details resolver.
- [ ] The class-search page is a React SPA; snippet extraction is best-effort. An iframe embed of the URL may be more reliable than scraping.
