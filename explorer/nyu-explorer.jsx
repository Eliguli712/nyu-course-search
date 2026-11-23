import { useState, useCallback } from "react";

var C = {
  bg:"#0b0f1a", surface:"#111724", raised:"#16202e",
  border:"#1d2b42", amber:"#e8a830", chalk:"#ece8df",
  muted:"#7a8599", dim:"#3a4860", violet:"#6b7fff",
};

var BADGE = {
  HTML:   {bg:"rgba(244,114,182,.13)",fg:"#f472b6"},
  PARTIAL:{bg:"rgba(78,203,141,.12)", fg:"#4ecb8d"},
  PY:     {bg:"rgba(107,127,255,.13)",fg:"#6b7fff"},
  CONFIG: {bg:"rgba(232,168,48,.12)", fg:"#e8a830"},
  DEPS:   {bg:"rgba(56,189,248,.12)", fg:"#38bdf8"},
};

var TREE = [
  {section:"Root"},
  {name:"Dockerfile",        icon:"🐳",badge:"CONFIG",depth:0},
  {name:"railway.toml",      icon:"🚂",badge:"CONFIG",depth:0},
  {name:".env.example",      icon:"⚙️",badge:"CONFIG",depth:0},
  {section:"backend/"},
  {name:"requirements.txt",  icon:"📦",badge:"DEPS",  depth:1},
  {dir:"scripts/",depth:1},
  {name:"manage.py",         icon:"🔧",badge:"PY",    depth:2},
  {dir:"app/",depth:1},
  {name:"main.py",           icon:"🚀",badge:"PY",    depth:2},
  {name:"config.py",         icon:"⚙️",badge:"PY",    depth:2},
  {name:"models.py",         icon:"🗃️",badge:"PY",    depth:2},
  {name:"db.py",             icon:"🔌",badge:"PY",    depth:2},
  {name:"auth.py",           icon:"🔒",badge:"PY",    depth:2},
  {name:"scrape.py",         icon:"🕷️",badge:"PY",    depth:2},
  {name:"embeddings.py",     icon:"🧠",badge:"PY",    depth:2},
  {name:"similarity.py",     icon:"📐",badge:"PY",    depth:2},
  {name:"search.py",         icon:"🔍",badge:"PY",    depth:2},
  {name:"cache.py",          icon:"⚡",badge:"PY",    depth:2},
  {name:"details.py",        icon:"🔎",badge:"PY",    depth:2},
  {dir:"templates/",depth:2},
  {name:"base.html",         icon:"🎨",badge:"HTML",   depth:3,preview:true},
  {name:"index.html",        icon:"🏠",badge:"HTML",   depth:3,preview:true},
  {name:"login.html",        icon:"🔑",badge:"HTML",   depth:3,preview:true},
  {name:"register.html",     icon:"✍️",badge:"HTML",   depth:3,preview:true},
  {name:"saved.html",        icon:"🔖",badge:"HTML",   depth:3,preview:true},
  {dir:"partials/",depth:3},
  {name:"results.html",      icon:"📊",badge:"PARTIAL",depth:4,preview:true},
  {name:"details.html",      icon:"📋",badge:"PARTIAL",depth:4},
  {name:"save_button.html",  icon:"🔖",badge:"PARTIAL",depth:4},
  {name:"thumb_button.html", icon:"👍",badge:"PARTIAL",depth:4},
];

var SRC = {};

SRC["Dockerfile"] = [
  "FROM python:3.11-slim",
  "ENV PYTHONDONTWRITEBYTECODE=1  PYTHONUNBUFFERED=1",
  "WORKDIR /app",
  "RUN apt-get update && apt-get install -y build-essential git",
  "COPY backend/requirements.txt /app/backend/requirements.txt",
  "RUN pip install --no-cache-dir -r /app/backend/requirements.txt",
  "COPY . /app",
  "ENV PORT=8000",
  "CMD [\"bash\",\"-lc\",\"uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT}\"]",
];
SRC["railway.toml"] = [
  "[build]",
  "builder = \"DOCKERFILE\"",
  "dockerfilePath = \"Dockerfile\"",
  "",
  "[deploy]",
  "startCommand = \"uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT\"",
  "healthcheckPath = \"/health\"",
  "healthcheckTimeout = 30",
  "restartPolicyType = \"ON_FAILURE\"",
  "restartPolicyMaxRetries = 3",
];
SRC[".env.example"] = [
  "SECRET_KEY=change-me-to-a-long-random-string",
  "ENVIRONMENT=prod",
  "DATABASE_URL=postgresql+asyncpg://user:pw@host:5432/nyu_courses",
  "REDIS_URL=redis://default:pw@host:6379",
  "SESSION_COOKIE_NAME=nyu_course_session",
  "SESSION_MAX_AGE_SECONDS=1209600   # 14 days",
  "NYU_EMAIL_DOMAIN=nyu.edu",
  "EMBEDDING_MODEL_ID=nomic-ai/nomic-embed-text-v1",
  "EMBEDDING_BATCH_SIZE=32",
];
SRC["requirements.txt"] = [
  "fastapi==0.115.8", "uvicorn[standard]==0.30.6", "jinja2==3.1.4",
  "python-multipart==0.0.9", "itsdangerous==2.2.0", "passlib[bcrypt]==1.7.4",
  "pydantic==2.10.6", "pydantic-settings==2.7.1", "SQLAlchemy[asyncio]==2.0.36",
  "asyncpg==0.30.0", "pgvector==0.3.6", "redis==5.0.8", "httpx==0.27.2",
  "beautifulsoup4==4.12.3", "typer==0.12.5", "rich==13.8.1",
  "transformers==4.46.3", "torch>=2.2.0", "numpy==2.1.3",
];
SRC["main.py"] = [
  "app = FastAPI(title='NYU Course Search')",
  "",
  "@app.on_event('startup')",
  "async def _startup():",
  "    await ensure_extensions()   # pgvector ext",
  "    await ensure_tables()       # CREATE TABLE IF NOT EXISTS + HNSW index",
  "",
  "@app.get('/health')",
  "async def health():",
  "    return JSONResponse({'status': 'ok'})   # Railway health check",
  "",
  "@app.get('/')",
  "async def home(request, user=Depends(require_user)):",
  "    return templates.TemplateResponse('index.html', ...)",
  "",
  "@app.post('/search', response_class=HTMLResponse)",
  "async def search(q: str = Form(''), ...):",
  "    qvec = await cached_embed(q, embed_texts)   # L1 -> L2 -> model",
  "    results, scores = await vector_search(db, qvec, limit=25)",
  "    # scores: dict[uuid -> float in [0,1]] for template score bars",
  "    return templates.TemplateResponse('partials/results.html', {",
  "        'results': results, 'scores': scores, ...",
  "    })",
  "",
  "@app.post('/save/{course_id}', response_class=HTMLResponse)",
  "async def toggle_save(course_id, ...):   # returns HTMX partial swap",
  "",
  "@app.post('/thumb/{course_id}', response_class=HTMLResponse)",
  "async def thumb_up(course_id, search_id, rank, ...):",
  "    db.add(ResultFeedback(rank=rank, thumb_up=True, ...))",
  "",
  "@app.get('/course/{course_id}/details', response_class=HTMLResponse)",
  "async def course_details(course_id, ...):",
  "    details = await resolve_course_details(course.code, rds)",
  "    return templates.TemplateResponse('partials/details.html', ...)",
];
SRC["config.py"] = [
  "class Settings(BaseSettings):",
  "    model_config = SettingsConfigDict(env_file='.env')",
  "    secret_key: str = 'change-me'",
  "    environment: str = 'dev'          # dev | prod",
  "    database_url: str = 'postgresql+asyncpg://...'",
  "    redis_url: str = 'redis://localhost:6379/0'",
  "    session_max_age_seconds: int = 60 * 60 * 24 * 14   # 14 days",
  "    nyu_email_domain: str = 'nyu.edu'",
  "    embedding_model_id: str = 'nomic-ai/nomic-embed-text-v1'",
  "    embedding_batch_size: int = 32",
];
SRC["models.py"] = [
  "def _now(): return datetime.now(timezone.utc)   # tz-aware timestamp",
  "",
  "class User(Base):",
  "    id, email, password_hash, is_active",
  "",
  "class Course(Base):",
  "    id, code, name, description, source_url",
  "    embedding: Vector(768) | None   # pgvector, null until backfilled",
  "",
  "class SavedCourse(Base):   # UniqueConstraint(user_id, course_id)",
  "    user_id -> User,  course_id -> Course",
  "",
  "class SearchQuery(Base):",
  "    user_id -> User,  query_text: str",
  "",
  "class ResultFeedback(Base):",
  "    user_id, search_id, course_id",
  "    rank: int        # position in results when upvote was clicked",
  "    thumb_up: bool",
];
SRC["db.py"] = [
  "engine = create_async_engine(",
  "    settings.database_url, pool_pre_ping=True,",
  "    pool_size=10, max_overflow=20,",
  ")",
  "",
  "async def ensure_extensions():",
  "    # CREATE EXTENSION IF NOT EXISTS vector",
  "",
  "async def ensure_tables():",
  "    # CREATE TABLE IF NOT EXISTS (all models)",
  "    # HNSW index -- no min row count, better than IVFFLAT for <100k rows",
  "    await conn.execute(",
  "        'CREATE INDEX IF NOT EXISTS courses_embedding_hnsw'",
  "        ' ON courses USING hnsw (embedding vector_cosine_ops)'",
  "        ' WITH (m = 16, ef_construction = 64)'",
  "    )",
];
SRC["auth.py"] = [
  "pwd_context = CryptContext(schemes=['bcrypt'])",
  "serializer  = URLSafeTimedSerializer(settings.secret_key, salt='session')",
  "",
  "def enforce_nyu_email(email):",
  "    if not email.endswith('@nyu.edu'):",
  "        raise HTTPException(400, 'Must be @nyu.edu')",
  "",
  "def set_session_cookie(response, token):",
  "    response.set_cookie(",
  "        key='nyu_course_session', value=token,",
  "        httponly=True,",
  "        secure=(settings.environment == 'prod'),",
  "        samesite='lax',",
  "    )",
  "",
  "async def require_user(request, db) -> AuthedUser:",
  "    token = request.cookies.get('nyu_course_session')",
  "    user_id = read_session_token(token)   # verifies signature + expiry",
  "    if not user_id: raise HTTPException(401)",
  "    return AuthedUser(id=user_id, email=user.email)",
];
SRC["embeddings.py"] = [
  "# nomic-embed-text-v1 requires task-specific prefixes for accuracy",
  "DOC_PREFIX   = 'search_document: '   # used when indexing courses",
  "QUERY_PREFIX = 'search_query: '      # used at search time",
  "",
  "def embed_documents(texts):",
  "    '''For manage.py embed-courses -- search_document: prefix.'''",
  "    return _embed_raw([DOC_PREFIX + t for t in texts])",
  "",
  "def embed_texts(texts):",
  "    '''For live query embedding -- search_query: prefix.'''",
  "    return _embed_raw([QUERY_PREFIX + t for t in texts])",
  "",
  "def _embed_raw(texts):",
  "    tokenizer, model = get_embedder()   # lru_cache(1)",
  "    enc    = tokenizer(texts, padding=True, truncation=True,",
  "                       max_length=512, return_tensors='pt')",
  "    out    = model(**enc)",
  "    pooled = mean_pool(out.last_hidden_state, enc['attention_mask'])",
  "    return F.normalize(pooled, p=2, dim=1).cpu().numpy().tolist()",
];
SRC["similarity.py"] = [
  "# Chebyshev T1-T4 polynomial + PCCA soft-cluster blend",
  "# T1(z)=z   T2(z)=2z^2-1   T3(z)=4z^3-3z   T4(z)=8z^4-8z^2+1",
  "# k~(z) = sum(a_i * Ti(z))   fit to RBF exp(-sigma*(1-z)), sigma=2",
  "",
  "_CHEB_COEFFS = _chebyshev_rbf_coeffs(sigma=2.0)  # pre-fit at import",
  "",
  "def chebyshev_similarity(q, cv):",
  "    z = cv @ q                        # cosine sims (L2-normed inputs)",
  "    a = _CHEB_COEFFS",
  "    k = a[0]+a[1]*T1(z)+a[2]*T2(z)+a[3]*T3(z)+a[4]*T4(z)",
  "    return np.clip(k / k.max(), 0, 1)",
  "",
  "def pcca_similarity(q, cv):",
  "    # soft-assign to k=16 centroids; score = membership dot product",
  "    mq = softmax(q  @ centroids.T)    # (k,)",
  "    mc = softmax(cv @ centroids.T)    # (N,k)",
  "    raw = mc @ mq                     # (N,)",
  "    return raw / raw.max()",
  "",
  "def combined_similarity(q, cv, alpha=0.75):",
  "    return (alpha       * chebyshev_similarity(q, cv)",
  "          + (1 - alpha) * pcca_similarity(q, cv))",
];
SRC["search.py"] = [
  "_OVERFETCH = 3   # fetch 3x, then rerank",
  "",
  "async def vector_search(db, query_vec, limit=20, alpha=0.75):",
  "    # Stage 1: pgvector cosine ANN",
  "    stmt = (select(Course)",
  "            .where(Course.embedding.isnot(None))",
  "            .order_by(text('courses.embedding <=> :qvec'))",
  "            .params(qvec=query_vec)",
  "            .limit(limit * _OVERFETCH))",
  "    candidates = list((await db.execute(stmt)).scalars())",
  "",
  "    # Stage 2: Chebyshev + PCCA rerank",
  "    ranked  = rerank(query_vec, embeddings, alpha=alpha)",
  "    courses = [candidates[i] for i, _ in ranked[:limit]]",
  "    scores  = {candidates[i].id: s for i, s in ranked[:limit]}",
  "    return courses, scores",
];
SRC["cache.py"] = [
  "# L1: in-process LRU ring buffer  ~0us,  512 slots x 768-dim = ~1.5 MB",
  "# L2: Redis 7-day TTL             ~0.2ms",
  "",
  "class _VectorRingBuffer:",
  "    def get(self, key):",
  "        self._store.move_to_end(key); return self._store[key][0]",
  "    def set(self, key, vec):",
  "        ...; evict LRU when over capacity",
  "",
  "async def cached_embed(query, embed_fn):",
  "    arr = buf.get(query)",
  "    if arr is not None: return arr.tolist()         # L1 hit",
  "    raw = await rds.get('vec:' + query)",
  "    if raw is not None:                             # L2 hit",
  "        arr = np.array(json.loads(raw)); buf.set(query, arr)",
  "        return arr.tolist()",
  "    vec = embed_fn([query])[0]                      # model compute",
  "    buf.set(query, np.array(vec))",
  "    await rds.set('vec:' + query, json.dumps(vec), ex=604800)",
  "    return vec",
];
SRC["details.py"] = [
  "# Semester backoff: Fall > Summer > Spring, newest year first",
  "_SEASONS = ['Fall', 'Summer', 'Spring']",
  "",
  "def _term_sequence(max_terms=20):",
  "    year = datetime.now(timezone.utc).year + 1   # look 1 year ahead",
  "    count = 0",
  "    while count < max_terms:",
  "        for season in _SEASONS:",
  "            yield season + ' ' + str(year)",
  "            count += 1",
  "        year -= 1",
  "",
  "async def resolve_course_details(course_code, rds):",
  "    cached = await rds.get('details2:' + course_code.upper())",
  "    if cached: return CourseDetails(**json.loads(cached))   # cache hit",
  "",
  "    for term in _term_sequence(max_terms=20):",
  "        url     = class_search_url(course_code, term)",
  "        snippet = _extract_snippet(await _fetch(url), course_code)",
  "        if snippet:",
  "            details = CourseDetails(found=True, url=url, term=term,",
  "                                    snippet_html=snippet)",
  "            await rds.set(key, json.dumps(asdict(details)), ex=604800)",
  "            return details",
  "",
  "    return CourseDetails(found=False, url=fallback_url)   # cache miss",
];
SRC["scrape.py"] = [
  "async def scrape_all_courses():",
  "    async with httpx.AsyncClient(",
  "        headers={'User-Agent': 'nyu-course-search/2.0'}",
  "    ) as client:",
  "        root  = await client.get('https://bulletins.nyu.edu/courses/')",
  "        links = {urljoin(root_url, a['href'])",
  "                 for a in soup.select('a[href]')",
  "                 if '/courses/' in a.get('href', '')}",
  "        # Concurrent fetch, max 8 parallel",
  "        pages = await asyncio.gather(*[fetch(u) for u in links])",
  "",
  "    for url, html in pages:",
  "        for block in BeautifulSoup(html).select('div.courseblock'):",
  "            code = block.select_one('.courseblocktitle')",
  "            desc = block.select_one('.courseblockdesc')",
  "            yield ScrapedCourse(code=code.text.split()[0],",
  "                                name=' '.join(code.text.split()[1:]),",
  "                                description=desc.text, source_url=url)",
];
SRC["manage.py"] = [
  "cli = typer.Typer()",
  "",
  "@cli.command('init-db')",
  "def init_db():     # ensure_extensions() + ensure_tables()",
  "",
  "@cli.command('scrape-courses')",
  "def scrape_courses():   # scrape + upsert by (code, name)",
  "",
  "@cli.command('embed-courses')",
  "def embed_courses(limit: int = Option(500)):",
  "    with Progress(SpinnerColumn(), BarColumn(), TimeElapsedColumn()) as p:",
  "        task = p.add_task('Embedding', total=len(courses))",
  "        for chunk in batches(courses, batch_size):",
  "            vecs = embed_documents([c.code+' '+c.name+'. '+c.desc",
  "                                    for c in chunk])",
  "            p.advance(task, len(chunk))",
  "",
  "@cli.command('stats')",
  "def stats():   # Rich table: courses / embedded / users / saved / feedback",
  "",
  "@cli.command('reset-db')",
  "def reset_db(yes: bool = Option(False, '--yes')):",
  "    # DROP all tables + recreate. Requires --yes safety flag.",
];
SRC["base.html"] = [
  "<!doctype html>",
  "<html lang=\"en\">",
  "<head>",
  "  <!-- Zero CDN frameworks. All CSS hand-written below (~575 lines). -->",
  "  <link href=\"Google Fonts: Playfair Display + IBM Plex Mono + Instrument Sans\">",
  "  <script src=\"htmx.org@1.9.12\" defer></script>",
  "  <style>",
  "    :root {",
  "      --bg:#0b0f1a; --surface:#111724; --border:#1d2b42;",
  "      --amber:#e8a830; --chalk:#ece8df; --muted:#7a8599; --violet:#6b7fff;",
  "      --font-serif:'Playfair Display',serif;",
  "      --font-mono:'IBM Plex Mono',monospace;",
  "    }",
  "    /* diagonal grid watermark */",
  "    body::before {",
  "      content:''; position:fixed; inset:0; pointer-events:none;",
  "      background: repeating-linear-gradient(",
  "        -52deg, transparent, transparent 44px,",
  "        rgba(29,43,66,0.28) 44px, rgba(29,43,66,0.28) 45px);",
  "    }",
  "    /* course-card fadeUp animation, score bars, htmx-indicator... */",
  "  </style>",
  "</head>",
  "<body>",
  "  <header class=\"site-header\">",
  "    <a href=\"/\" class=\"logo\">NYU . CourseSearch</a>",
  "    {% if user %}",
  "    <nav>",
  "      <a href=\"/saved\">Saved</a>",
  "      <span>{{ user.email }}</span>",
  "      <form method=\"post\" action=\"/logout\">",
  "        <button>Log out</button>",
  "      </form>",
  "    </nav>",
  "    {% endif %}",
  "  </header>",
  "  <main><div class=\"container\">",
  "    {% block content %}{% endblock %}",
  "  </div></main>",
  "  <footer>",
  "    DATA . BULLETINS.NYU.EDU . CHEBYSHEV T1-T4 + PCCA RERANKING",
  "  </footer>",
  "</body></html>",
];
SRC["index.html"] = [
  "{% extends \"base.html\" %}",
  "{% block content %}",
  "<div class=\"card\">",
  "  <h1 class=\"headline\">Find your next <em>NYU course.</em></h1>",
  "  <p>Semantic search reranked by Chebyshev T1-T4 + PCCA similarity.</p>",
  "",
  "  <form hx-post=\"/search\"",
  "        hx-target=\"#results\"",
  "        hx-swap=\"innerHTML\"",
  "        hx-indicator=\"#search-spin\">",
  "    <input name=\"q\" value=\"{{ query }}\"",
  "           placeholder=\"e.g. probabilistic graphical models...\">",
  "    <button class=\"btn-primary\">Search</button>",
  "    <div id=\"search-spin\" class=\"htmx-indicator\">",
  "      <div class=\"spinner\"></div>",
  "    </div>",
  "  </form>",
  "",
  "  <div id=\"results\">",
  "    {% if results %}",
  "      {% include \"partials/results.html\" %}",
  "    {% else %}",
  "      <p class=\"empty-state\">AWAITING QUERY</p>",
  "    {% endif %}",
  "  </div>",
  "</div>",
  "{% endblock %}",
];
SRC["results.html"] = [
  "{% if not results %}",
  "  <p class=\"empty-state\">NO RESULTS FOUND</p>",
  "{% else %}",
  "  <div class=\"results-meta\">",
  "    <span><strong>{{ results|length }}</strong> results for '{{ query }}'</span>",
  "  </div>",
  "",
  "  <!-- Score distribution bar chart -->",
  "  {% if scores %}",
  "  <div class=\"score-chart-wrap\">",
  "    {% for c in results %}",
  "      {% set pct = (scores.get(c.id, 0) * 100) | round(1) %}",
  "      <div class=\"score-bar-col\" id=\"bar-{{ loop.index0 }}\"",
  "           onclick=\"scrollToCard({{ loop.index0 }})\">",
  "        <div class=\"score-bar-fill\"",
  "          style=\"height:{{ pct }}%;",
  "            background: {% if pct >= 70 %}var(--amber)",
  "                        {% elif pct >= 45 %}var(--violet)",
  "                        {% else %}var(--muted){% endif %};\">",
  "        </div>",
  "      </div>",
  "    {% endfor %}",
  "  </div>",
  "  {% endif %}",
  "",
  "  <!-- Course cards -->",
  "  {% for c in results %}",
  "    {% set pct = (scores.get(c.id, 0) * 100) | round(1) %}",
  "    {% set thumb_rank = loop.index0 %}",
  "    <div class=\"course-card\" id=\"card-{{ loop.index0 }}\"",
  "         style=\"--i:{{ loop.index0 }}\">",
  "      <div class=\"course-code\">{{ c.code }}</div>",
  "      <div class=\"course-name\">{{ c.name }}</div>",
  "      <div class=\"score-row\">",
  "        <span class=\"score-badge\">RELEVANCE {{ pct }}%</span>",
  "        <div class=\"score-track\">",
  "          <div class=\"score-fill\" style=\"width:{{ pct }}%\"></div>",
  "        </div>",
  "      </div>",
  "      {% set course_id = c.id %}",
  "      {% include \"partials/save_button.html\" %}",
  "      {% include \"partials/thumb_button.html\" %}",
  "      <p class=\"course-desc\">{{ c.description[:320] }}...</p>",
  "      <div class=\"card-footer\">",
  "        <a href=\"{{ c.source_url }}\">Bulletin listing</a>",
  "        <button hx-get=\"/course/{{ c.id }}/details\"",
  "                hx-target=\"#details-{{ c.id }}\">Load schedule</button>",
  "      </div>",
  "      <div id=\"details-{{ c.id }}\"></div>",
  "    </div>",
  "  {% endfor %}",
  "",
  "  <!-- Keyword highlight + IntersectionObserver chart sync -->",
  "  <script>(function() {",
  "    var terms = /* {{ query|tojson }} */.toLowerCase().split(/\\s+/)",
  "      .filter(function(t) { return t.length > 2; });",
  "    document.querySelectorAll('.course-desc').forEach(function(el) {",
  "      terms.forEach(function(term) {",
  "        el.innerHTML = el.textContent.replace(",
  "          new RegExp(term, 'gi'), '<mark>$&</mark>');",
  "      });",
  "    });",
  "    var io = new IntersectionObserver(function(entries) {",
  "      entries.forEach(function(e) {",
  "        if (!e.isIntersecting) return;",
  "        var idx = e.target.id.split('-')[1];",
  "        document.querySelectorAll('.score-bar-col')",
  "          .forEach(function(b) { b.classList.remove('highlighted'); });",
  "        var bar = document.getElementById('bar-' + idx);",
  "        if (bar) bar.classList.add('highlighted');",
  "      });",
  "    }, { threshold: 0.5 });",
  "    document.querySelectorAll('.course-card')",
  "      .forEach(function(c) { io.observe(c); });",
  "  })();</script>",
  "{% endif %}",
];
SRC["details.html"] = [
  "<div class=\"details-panel\">",
  "  {% if details.found %}",
  "    <div class=\"panel-head\">",
  "      <span class=\"panel-label\">{{ details.term }}</span>",
  "      <a href=\"{{ details.url }}\" target=\"_blank\">Open in Bulletin</a>",
  "    </div>",
  "    {{ details.snippet_html | safe }}",
  "  {% else %}",
  "    <span>No recent offering found</span>",
  "    <a href=\"{{ details.url }}\" target=\"_blank\">Try in Bulletin</a>",
  "  {% endif %}",
  "</div>",
];
SRC["save_button.html"] = [
  "<button class=\"btn-ghost {% if saved %}saved{% endif %}\"",
  "  hx-post=\"/save/{{ course_id }}\"",
  "  hx-target=\"closest .btn-ghost\"",
  "  hx-swap=\"outerHTML\">",
  "  {% if saved %}Saved{% else %}Save{% endif %}",
  "</button>",
];
SRC["thumb_button.html"] = [
  "{% if done %}",
  "  <button class=\"btn-ghost thumbed\" disabled>Upvoted</button>",
  "{% else %}",
  "  <button class=\"btn-ghost\"",
  "    hx-post=\"/thumb/{{ course_id }}\"",
  "    hx-vals='{\"search_id\":\"{{ search_id }}\",\"rank\":\"{{ thumb_rank }}\"}'",
  "    hx-target=\"this\" hx-swap=\"outerHTML\">",
  "    Upvote",
  "  </button>",
  "{% endif %}",
];
SRC["login.html"] = [
  "{% extends \"base.html\" %}",
  "{% block content %}",
  "<div class=\"auth-wrap\"><div class=\"card\">",
  "  <h1 class=\"headline\">Sign <em>in</em></h1>",
  "  <p>NYU email addresses only.</p>",
  "  {% if error %}<div class=\"alert-error\">{{ error }}</div>{% endif %}",
  "  <form method=\"post\" action=\"/login\" class=\"form-stack\">",
  "    <label class=\"field-label\">Email</label>",
  "    <input name=\"email\" type=\"email\" placeholder=\"netid@nyu.edu\" required>",
  "    <label class=\"field-label\">Password</label>",
  "    <input name=\"password\" type=\"password\" placeholder=\"password\" required>",
  "    <button class=\"btn-primary\">Sign in</button>",
  "  </form>",
  "  <p>No account? <a href=\"/register\">Register</a></p>",
  "</div></div>",
  "{% endblock %}",
];
SRC["register.html"] = [
  "{% extends \"base.html\" %}",
  "{% block content %}",
  "<div class=\"auth-wrap\"><div class=\"card\">",
  "  <h1 class=\"headline\">Create <em>account</em></h1>",
  "  <p>Requires an @nyu.edu email address.</p>",
  "  {% if error %}<div class=\"alert-error\">{{ error }}</div>{% endif %}",
  "  <form method=\"post\" action=\"/register\" class=\"form-stack\">",
  "    <label class=\"field-label\">NYU Email</label>",
  "    <input name=\"email\" type=\"email\" placeholder=\"netid@nyu.edu\" required>",
  "    <label class=\"field-label\">Password</label>",
  "    <input name=\"password\" type=\"password\" placeholder=\"password\" required>",
  "    <button class=\"btn-primary\">Create account</button>",
  "  </form>",
  "  <p>Have an account? <a href=\"/login\">Sign in</a></p>",
  "</div></div>",
  "{% endblock %}",
];
SRC["saved.html"] = [
  "{% extends \"base.html\" %}",
  "{% block content %}",
  "<div class=\"card\">",
  "  <div class=\"page-head\">",
  "    <h1 class=\"headline\">Saved <em>courses</em></h1>",
  "    <a href=\"/\">Back to search</a>",
  "  </div>",
  "  {% if not courses %}",
  "    <p class=\"empty-state\">NO SAVED COURSES YET</p>",
  "  {% else %}",
  "    <p>{{ courses|length }} COURSES SAVED</p>",
  "    {% for c in courses %}",
  "      <div class=\"course-card\" style=\"--i:{{ loop.index0 }}\">",
  "        <div class=\"course-code\">{{ c.code }}</div>",
  "        <div class=\"course-name\">{{ c.name }}</div>",
  "        <p class=\"course-desc\">{{ c.description[:260] }}...</p>",
  "        <a href=\"{{ c.source_url }}\">Bulletin listing</a>",
  "      </div>",
  "    {% endfor %}",
  "  {% endif %}",
  "</div>",
  "{% endblock %}",
];

function s(obj) {
  var parts = [];
  for (var k in obj) { if (Object.prototype.hasOwnProperty.call(obj,k)) parts.push(k+":"+obj[k]); }
  return parts.join(";");
}

function AppShell(props) {
  var url = props.url;
  var children = props.children;
  return (
    <div style={{background:C.surface,border:"1px solid "+C.border,borderRadius:12,overflow:"hidden",boxShadow:"0 4px 32px rgba(0,0,0,.5)"}}>
      <div style={{display:"flex",alignItems:"center",gap:6,padding:"9px 14px",background:C.raised,borderBottom:"1px solid "+C.border}}>
        <div style={{width:10,height:10,borderRadius:"50%",background:"#e05c5c"}}/>
        <div style={{width:10,height:10,borderRadius:"50%",background:"#e8a830"}}/>
        <div style={{width:10,height:10,borderRadius:"50%",background:"#4ecb8d"}}/>
        <div style={{flex:1,background:C.bg,border:"1px solid "+C.border,borderRadius:5,padding:"3px 10px",fontFamily:"monospace",fontSize:11,color:C.muted,marginLeft:8}}>{url}</div>
      </div>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"11px 18px",borderBottom:"1px solid "+C.border}}>
        <div style={{fontFamily:"Georgia,serif",fontWeight:700,fontSize:14}}>
          NYU<span style={{color:C.amber}}>·</span>Course<span style={{color:C.amber}}>Search</span>
        </div>
        <div style={{display:"flex",gap:12,alignItems:"center"}}>
          <span style={{fontSize:12,color:C.muted}}>Saved</span>
          <span style={{fontFamily:"monospace",fontSize:11,color:C.dim}}>user@nyu.edu</span>
          <button style={{background:"transparent",border:"1px solid "+C.border,color:C.muted,borderRadius:6,padding:"2px 8px",fontSize:11,cursor:"pointer"}}>Log out</button>
        </div>
      </div>
      <div style={{padding:"20px 18px"}}>{children}</div>
    </div>
  );
}

var BARS = [88,75,62,51,44,38,31,26,22,18,15,13,11,9,7];
var DEMO = [
  {code:"DS-GA.1003",name:"Machine Learning",pct:88,desc:"Theory and practice: SVMs, neural nets, probabilistic models, learning theory.",saved:true},
  {code:"DS-GA.1008",name:"Deep Learning",pct:75,desc:"Convolutional networks, attention mechanisms, and generative models.",saved:false},
  {code:"CSCI-UA.480",name:"Operating Systems",pct:38,desc:"Process management, memory systems, and file system design.",saved:false},
];

function CourseCard(props) {
  var c=props.c, i=props.i, showScore=props.showScore;
  return (
    <div style={{background:C.raised,border:"1px solid "+(i===0?"rgba(232,168,48,.3)":C.border),borderRadius:9,padding:"11px 13px 9px 15px",position:"relative",marginBottom:8,opacity:1-i*.08}}>
      <div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:i===0?C.amber:C.border,borderRadius:"9px 0 0 9px"}}/>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div>
          <div style={{fontFamily:"monospace",fontSize:10,color:C.amber,letterSpacing:".08em",textTransform:"uppercase"}}>{c.code}</div>
          <div style={{fontFamily:"Georgia,serif",fontWeight:700,fontSize:13,marginTop:1}}>{c.name}</div>
          {showScore && (
            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
              <span style={{fontFamily:"monospace",fontSize:9.5,color:C.muted}}>RELEVANCE <strong style={{color:C.chalk}}>{c.pct}%</strong></span>
              <div style={{width:90,height:3,background:C.border,borderRadius:2,overflow:"hidden"}}>
                <div style={{width:c.pct+"%",height:"100%",background:c.pct>=70?C.amber:C.violet,borderRadius:2}}/>
              </div>
            </div>
          )}
        </div>
        <div style={{display:"flex",gap:5}}>
          <button style={{background:"transparent",border:"1px solid "+(c.saved?C.amber:C.border),color:c.saved?C.amber:C.muted,borderRadius:6,padding:"2px 7px",fontSize:10,cursor:"pointer"}}>{c.saved?"★ Saved":"☆ Save"}</button>
          <button style={{background:"transparent",border:"1px solid "+C.border,color:C.muted,borderRadius:6,padding:"2px 7px",fontSize:10,cursor:"pointer"}}>↑ Upvote</button>
        </div>
      </div>
      <div style={{fontSize:11.5,color:C.muted,lineHeight:1.6,marginTop:5}}>{c.desc}</div>
    </div>
  );
}

function IndexPreview() {
  return (
    <AppShell url="localhost:8000/">
      <div style={{fontFamily:"Georgia,serif",fontWeight:700,fontSize:20,letterSpacing:"-0.02em",lineHeight:1.2,marginBottom:6}}>
        Find your next <em style={{color:C.amber}}>NYU course.</em>
      </div>
      <p style={{fontSize:12,color:C.muted,lineHeight:1.6,marginBottom:14}}>Semantic search reranked by Chebyshev T1–T4 polynomial + PCCA cluster similarity.</p>
      <div style={{display:"flex",gap:8}}>
        <div style={{flex:1,background:C.bg,border:"1px solid "+C.border,borderRadius:7,padding:"8px 12px",fontSize:12,color:C.muted}}>e.g. probabilistic graphical models…</div>
        <div style={{background:C.amber,color:"#0b0f1a",fontWeight:600,fontSize:12,borderRadius:7,padding:"8px 16px",cursor:"pointer"}}>Search</div>
      </div>
      <div style={{fontFamily:"monospace",fontSize:11,color:C.dim,marginTop:16,letterSpacing:".06em"}}>AWAITING QUERY —</div>
    </AppShell>
  );
}

function ResultsPreview() {
  return (
    <AppShell url="localhost:8000/ — post search">
      <div style={{display:"flex",justifyContent:"space-between",fontFamily:"monospace",fontSize:11,color:C.muted,marginBottom:10}}>
        <span><strong style={{color:C.amber}}>15</strong> results for "machine learning"</span>
        <span style={{textDecoration:"underline",cursor:"pointer"}}>View saved →</span>
      </div>
      <div style={{background:C.bg,border:"1px solid "+C.border,borderRadius:7,padding:"10px 12px 8px",marginBottom:12}}>
        <div style={{fontFamily:"monospace",fontSize:9.5,color:C.dim,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>Relevance distribution — click bar to jump</div>
        <div style={{display:"flex",alignItems:"flex-end",gap:2,height:32}}>
          {BARS.map(function(h,i){
            return <div key={i} style={{flex:1,height:h+"%",borderRadius:"2px 2px 0 0",minHeight:2,background:h>=70?C.amber:h>=45?C.violet:C.muted,opacity:i===0?1:.6}}/>;
          })}
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:4,fontFamily:"monospace",fontSize:9,color:C.dim}}>
          <span>#1</span><span>#15</span>
        </div>
      </div>
      {DEMO.map(function(c,i){ return <CourseCard key={i} c={c} i={i} showScore={true}/>; })}
    </AppShell>
  );
}

function AuthPreview(props) {
  var isReg = props.isRegister;
  return (
    <AppShell url={"localhost:8000/"+(isReg?"register":"login")}>
      <div style={{maxWidth:280,margin:"0 auto"}}>
        <div style={{fontFamily:"Georgia,serif",fontWeight:700,fontSize:20,marginBottom:8}}>
          {isReg ? "Create " : "Sign "}
          <em style={{color:C.amber}}>{isReg ? "account" : "in"}</em>
        </div>
        <p style={{fontSize:12,color:C.muted,marginBottom:14}}>Requires an @nyu.edu email address.</p>
        <div style={{marginBottom:10}}>
          <div style={{fontFamily:"monospace",fontSize:10,letterSpacing:".07em",textTransform:"uppercase",color:C.muted,marginBottom:4}}>NYU Email</div>
          <div style={{background:C.bg,border:"1px solid "+C.border,borderRadius:6,padding:"7px 11px",fontSize:12,color:C.muted}}>netid@nyu.edu</div>
        </div>
        <div style={{marginBottom:10}}>
          <div style={{fontFamily:"monospace",fontSize:10,letterSpacing:".07em",textTransform:"uppercase",color:C.muted,marginBottom:4}}>Password</div>
          <div style={{background:C.bg,border:"1px solid "+C.border,borderRadius:6,padding:"7px 11px",fontSize:12,color:C.muted}}>••••••••</div>
        </div>
        <div style={{background:C.amber,color:"#0b0f1a",fontWeight:600,fontSize:13,borderRadius:6,padding:"8px",textAlign:"center",cursor:"pointer"}}>
          {isReg ? "Create account →" : "Sign in →"}
        </div>
        <div style={{fontSize:12,color:C.muted,marginTop:12}}>
          {isReg ? "Have an account? " : "No account? "}
          <span style={{color:C.amber,textDecoration:"underline",cursor:"pointer"}}>{isReg?"Sign in":"Register"}</span>
        </div>
      </div>
    </AppShell>
  );
}

function SavedPreview() {
  var items = [
    {code:"DS-GA.1003",name:"Machine Learning",pct:0,desc:"SVMs, neural networks, probabilistic models and learning theory.",saved:true},
    {code:"CSCI-UA.480",name:"Operating Systems",pct:0,desc:"Process management, memory, file systems, and concurrency.",saved:true},
    {code:"MATH-GA.2011",name:"Advanced Analysis",pct:0,desc:"Measure theory, Lp spaces, and Hilbert space methods.",saved:true},
  ];
  return (
    <AppShell url="localhost:8000/saved">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:12}}>
        <div style={{fontFamily:"Georgia,serif",fontWeight:700,fontSize:20}}>Saved <em style={{color:C.amber}}>courses</em></div>
        <span style={{fontSize:12,color:C.muted,textDecoration:"underline",cursor:"pointer"}}>← Back to search</span>
      </div>
      <div style={{fontFamily:"monospace",fontSize:11,color:C.muted,marginBottom:12,letterSpacing:".05em"}}>3 COURSES SAVED</div>
      {items.map(function(c,i){ return <CourseCard key={i} c={c} i={i} showScore={false}/>; })}
    </AppShell>
  );
}

function BasePreview() {
  return (
    <AppShell url="base.html — shared layout shell">
      <div style={{background:C.raised,border:"1px dashed "+C.border,borderRadius:8,padding:"20px 16px",textAlign:"center",color:C.dim,fontFamily:"monospace",fontSize:11,letterSpacing:".06em"}}>
        block content endblock
      </div>
      <div style={{marginTop:14,fontFamily:"monospace",fontSize:10,color:C.dim,letterSpacing:".06em",borderTop:"1px solid "+C.border,paddingTop:10}}>
        DATA · BULLETINS.NYU.EDU · CHEBYSHEV T1–T4 + PCCA RERANKING
      </div>
    </AppShell>
  );
}

function getPreview(name) {
  if (name === "base.html")     return <BasePreview/>;
  if (name === "index.html")    return <IndexPreview/>;
  if (name === "results.html")  return <ResultsPreview/>;
  if (name === "login.html")    return <AuthPreview isRegister={false}/>;
  if (name === "register.html") return <AuthPreview isRegister={true}/>;
  if (name === "saved.html")    return <SavedPreview/>;
  return null;
}

function SourceView(props) {
  var lines = props.lines;
  return (
    <div style={{overflow:"auto",flex:1,paddingBottom:24}}>
      <pre style={{margin:0,padding:"16px 0",fontFamily:"monospace",fontSize:12.5,lineHeight:1.75,color:C.chalk,whiteSpace:"pre"}}>
        {lines.map(function(line,i){
          return (
            <div key={i} style={{display:"flex",paddingLeft:16}}>
              <span style={{color:C.dim,userSelect:"none",minWidth:36,textAlign:"right",paddingRight:16,flexShrink:0}}>{i+1}</span>
              <span>{line}</span>
            </div>
          );
        })}
      </pre>
    </div>
  );
}

function TreeRow(props) {
  var item=props.item, active=props.active, onOpen=props.onOpen;
  if (item.section) {
    return <div style={{padding:"8px 16px 3px",fontFamily:"monospace",fontSize:10,letterSpacing:".09em",textTransform:"uppercase",color:C.dim}}>{item.section}</div>;
  }
  if (item.dir) {
    return (
      <div style={{display:"flex",alignItems:"center",gap:7,padding:"4px "+(10+item.depth*12)+"px"}}>
        <span style={{fontSize:12,width:16,textAlign:"center"}}>📁</span>
        <span style={{fontFamily:"monospace",fontSize:12,color:C.chalk,fontWeight:500}}>{item.dir}</span>
      </div>
    );
  }
  var isActive = active === item.name;
  var bc = BADGE[item.badge];
  return (
    <div
      onClick={function(){onOpen(item.name);}}
      style={{display:"flex",alignItems:"center",gap:7,padding:"5px "+(10+item.depth*12)+"px",cursor:"pointer",borderLeft:"2px solid "+(isActive?C.amber:"transparent"),background:isActive?"rgba(232,168,48,.07)":"transparent"}}
      onMouseEnter={function(e){if(!isActive)e.currentTarget.style.background="rgba(255,255,255,.025)";}}
      onMouseLeave={function(e){if(!isActive)e.currentTarget.style.background="transparent";}}
    >
      <span style={{fontSize:12,flexShrink:0,width:16,textAlign:"center"}}>{item.icon}</span>
      <span style={{fontFamily:"monospace",fontSize:11.5,color:isActive?C.amber:C.muted,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{item.name}</span>
      {bc && <span style={{fontSize:9,padding:"1px 5px",borderRadius:3,fontFamily:"monospace",background:bc.bg,color:bc.fg,flexShrink:0}}>{item.badge}</span>}
    </div>
  );
}

export default function App() {
  var state = useState([]);
  var tabs = state[0]; var setTabs = state[1];
  var state2 = useState(null);
  var active = state2[0]; var setActive = state2[1];
  var state3 = useState({});
  var modes = state3[0]; var setModes = state3[1];

  var openFile = useCallback(function(name) {
    if (!SRC[name]) return;
    setTabs(function(prev){ return prev.indexOf(name) >= 0 ? prev : prev.concat([name]); });
    setActive(name);
  }, []);

  var closeTab = useCallback(function(name, e) {
    e.stopPropagation();
    setTabs(function(prev){
      var next = prev.filter(function(t){ return t !== name; });
      setActive(function(cur){
        if (cur !== name) return cur;
        return next.length ? next[next.length-1] : null;
      });
      return next;
    });
  }, []);

  var mode = function(name){ return modes[name] || "source"; };
  var setMode = function(name, m){ setModes(function(v){ var n={}; for(var k in v)n[k]=v[k]; n[name]=m; return n; }); };

  var tItem = active ? TREE.find(function(t){ return t.name === active; }) : null;
  var lines = active ? SRC[active] : null;
  var hasPreview = tItem && tItem.preview;

  return (
    <div style={{display:"grid",gridTemplateColumns:"265px 1fr",height:"100vh",background:C.bg,color:C.chalk,fontFamily:"system-ui,sans-serif",overflow:"hidden"}}>
      <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:0,backgroundImage:"repeating-linear-gradient(-52deg,transparent,transparent 44px,rgba(29,43,66,.2) 44px,rgba(29,43,66,.2) 45px)"}}/>

      <aside style={{background:C.surface,borderRight:"1px solid "+C.border,overflow:"auto",zIndex:1,display:"flex",flexDirection:"column"}}>
        <div style={{padding:"18px 16px 14px",borderBottom:"1px solid "+C.border,flexShrink:0}}>
          <div style={{fontFamily:"Georgia,serif",fontWeight:700,fontSize:15,letterSpacing:"-0.02em"}}>
            NYU<span style={{color:C.amber}}>·</span>Course<span style={{color:C.amber}}>Search</span>
          </div>
          <div style={{fontFamily:"monospace",fontSize:10,letterSpacing:".08em",color:C.dim,marginTop:5,textTransform:"uppercase"}}>Project explorer</div>
        </div>
        <div style={{padding:"8px 0 20px",flex:1}}>
          {TREE.map(function(item,i){ return <TreeRow key={i} item={item} active={active} onOpen={openFile}/>; })}
        </div>
        <div style={{padding:"10px 14px 14px",borderTop:"1px solid "+C.border,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6}}>
          {[["30","files"],["14","templates"],["6","previews"]].map(function(pair){
            return (
              <div key={pair[1]} style={{textAlign:"center",background:C.raised,borderRadius:6,padding:"5px 0"}}>
                <div style={{fontFamily:"monospace",fontSize:13,color:C.amber,fontWeight:500}}>{pair[0]}</div>
                <div style={{fontFamily:"monospace",fontSize:9.5,color:C.dim,letterSpacing:".04em",textTransform:"uppercase"}}>{pair[1]}</div>
              </div>
            );
          })}
        </div>
      </aside>

      <div style={{display:"flex",flexDirection:"column",zIndex:1,overflow:"hidden"}}>
        <div style={{display:"flex",alignItems:"stretch",borderBottom:"1px solid "+C.border,background:C.surface,flexShrink:0,overflowX:"auto"}}>
          {tabs.length === 0 && <div style={{padding:"10px 16px",fontFamily:"monospace",fontSize:11,color:C.dim,alignSelf:"center"}}>← Click any file to open</div>}
          {tabs.map(function(name){
            var t = TREE.find(function(x){ return x.name === name; });
            var isA = active === name;
            return (
              <div key={name} onClick={function(){ setActive(name); }} style={{display:"flex",alignItems:"center",gap:5,padding:"9px 14px",fontFamily:"monospace",fontSize:11,color:isA?C.amber:C.muted,cursor:"pointer",borderBottom:"2px solid "+(isA?C.amber:"transparent"),whiteSpace:"nowrap",flexShrink:0}}>
                <span>{t && t.icon ? t.icon : "📄"}</span>
                <span>{name}</span>
                <span onClick={function(e){ closeTab(name,e); }} style={{opacity:.4,fontSize:13,marginLeft:2,lineHeight:1,cursor:"pointer"}} onMouseEnter={function(e){e.target.style.opacity="1";}} onMouseLeave={function(e){e.target.style.opacity=".4";}}>×</span>
              </div>
            );
          })}
        </div>

        <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          {!active ? (
            <div style={{padding:"40px 36px",overflow:"auto"}}>
              <div style={{fontFamily:"Georgia,serif",fontWeight:700,fontSize:26,letterSpacing:"-0.03em",lineHeight:1.2,marginBottom:8}}>
                File structure &amp; <em style={{color:C.amber}}>UI explorer</em>
              </div>
              <p style={{fontSize:13,color:C.muted,maxWidth:460,lineHeight:1.7,marginBottom:24}}>Click any file in the sidebar. HTML files include a <strong style={{color:C.amber}}>Preview</strong> tab with a rendered mock of the real UI.</p>
              <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,maxWidth:580}}>
                {[["index.html","🏠","Search page"],["results.html","📊","Score bars + chart"],["login.html","🔑","Auth gate"],["saved.html","🔖","Saved courses"],["main.py","🚀","FastAPI routes"],["similarity.py","📐","Chebyshev + PCCA"]].map(function(item){
                  return (
                    <div key={item[0]} onClick={function(){ openFile(item[0]); }} style={{background:C.raised,border:"1px solid "+C.border,borderRadius:10,padding:"13px 14px",cursor:"pointer"}} onMouseEnter={function(e){e.currentTarget.style.borderColor=C.borderHi;e.currentTarget.style.transform="translateY(-1px)";}} onMouseLeave={function(e){e.currentTarget.style.borderColor=C.border;e.currentTarget.style.transform="";}}>
                      <div style={{fontSize:18,marginBottom:6}}>{item[1]}</div>
                      <div style={{fontFamily:"monospace",fontSize:11,color:C.amber,letterSpacing:".05em",marginBottom:3}}>{item[0]}</div>
                      <div style={{fontSize:12,color:C.muted,lineHeight:1.4}}>{item[2]}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : lines ? (
            <div style={{display:"flex",flexDirection:"column",flex:1,overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"center",gap:8,padding:"10px 20px",borderBottom:"1px solid "+C.border,background:"rgba(17,23,36,.7)",flexShrink:0}}>
                <span>{tItem && tItem.icon ? tItem.icon : "📄"}</span>
                <span style={{fontFamily:"monospace",fontSize:12,color:C.chalk,fontWeight:500}}>{active}</span>
                <span style={{fontFamily:"monospace",fontSize:11,color:C.dim,marginLeft:"auto"}}>{lines.length} lines</span>
              </div>
              <div style={{display:"flex",borderBottom:"1px solid "+C.border,background:"rgba(22,32,46,.5)",flexShrink:0}}>
                {(hasPreview?["source","preview"]:["source"]).map(function(m){
                  return (
                    <div key={m} onClick={function(){ setMode(active,m); }} style={{display:"flex",alignItems:"center",gap:5,padding:"8px 14px",fontFamily:"monospace",fontSize:11,color:mode(active)===m?C.amber:C.muted,cursor:"pointer",borderBottom:"2px solid "+(mode(active)===m?C.amber:"transparent")}}>
                      {m==="source" ? "📄 Source" : "👁 Preview"}
                    </div>
                  );
                })}
              </div>
              <div style={{flex:1,overflow:"auto",background:C.bg}}>
                {mode(active) === "source" ? (
                  <SourceView lines={lines}/>
                ) : (
                  <div style={{padding:24}}>
                    <div style={{fontFamily:"monospace",fontSize:10,color:C.dim,textTransform:"uppercase",letterSpacing:".08em",marginBottom:14,display:"flex",alignItems:"center",gap:8}}>
                      Rendered preview
                      <div style={{flex:1,height:1,background:C.border}}/>
                    </div>
                    {getPreview(active)}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
