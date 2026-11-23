from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import FastAPI, Depends, Request, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete, func

from .config import settings
from .db import get_db, ensure_extensions, ensure_tables
from .models import User, Course, SavedCourse, SearchQuery, ResultFeedback
from .auth import (
    hash_password,
    verify_password,
    create_session_token,
    set_session_cookie,
    clear_session_cookie,
    enforce_nyu_email,
    require_user,
)
from .embeddings import embed_texts
from .search import vector_search, keyword_fallback
from .cache import get_redis, cached_embed
from .details import resolve_course_details


BASE_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

# Ensure static dir exists (prevents StaticFiles crash)
STATIC_DIR.mkdir(exist_ok=True)

app = FastAPI(title="NYU Course Search")


# ── Exception handler ────────────────────────────────────────────────────────

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    if exc.status_code == 401 and request.url.path not in ("/login", "/register"):
        return RedirectResponse(url="/login", status_code=303)
    return HTMLResponse(str(exc.detail), status_code=exc.status_code)


app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


# ── Startup ──────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def _startup() -> None:
    await ensure_extensions()
    await ensure_tables()   # idempotent CREATE TABLE IF NOT EXISTS


# ── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return JSONResponse({"status": "ok"})


# ── Home ─────────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def home(request: Request, user=Depends(require_user)):
    return templates.TemplateResponse(
        "index.html",
        {"request": request, "user": user, "results": None, "scores": {}, "query": ""},
    )


# ── Auth ─────────────────────────────────────────────────────────────────────

@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse(
        "login.html", {"request": request, "error": None, "user": None}
    )


@app.post("/login", response_class=HTMLResponse)
async def login(
    request: Request,
    db: AsyncSession = Depends(get_db),
    email: str = Form(...),
    password: str = Form(...),
):
    email_n = email.strip().lower()
    res = await db.execute(select(User).where(User.email == email_n))
    user = res.scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        return templates.TemplateResponse(
            "login.html",
            {"request": request, "error": "Invalid credentials.", "user": None},
        )
    resp = RedirectResponse(url="/", status_code=303)
    set_session_cookie(resp, create_session_token(user.id))
    return resp


@app.get("/register", response_class=HTMLResponse)
async def register_page(request: Request):
    return templates.TemplateResponse(
        "register.html", {"request": request, "error": None, "user": None}
    )


@app.post("/register", response_class=HTMLResponse)
async def register(
    request: Request,
    db: AsyncSession = Depends(get_db),
    email: str = Form(...),
    password: str = Form(...),
):
    email_n = email.strip().lower()
    try:
        enforce_nyu_email(email_n)
    except HTTPException as e:
        return templates.TemplateResponse(
            "register.html", {"request": request, "error": e.detail, "user": None}
        )

    exists = await db.execute(select(User).where(User.email == email_n))
    if exists.scalar_one_or_none():
        return templates.TemplateResponse(
            "register.html",
            {"request": request, "error": "Email already registered.", "user": None},
        )

    user = User(email=email_n, password_hash=hash_password(password))
    db.add(user)
    await db.commit()

    resp = RedirectResponse(url="/", status_code=303)
    set_session_cookie(resp, create_session_token(user.id))
    return resp


@app.post("/logout")
async def logout():
    resp = RedirectResponse(url="/login", status_code=303)
    clear_session_cookie(resp)
    return resp


# ── Search ───────────────────────────────────────────────────────────────────

@app.post("/search", response_class=HTMLResponse)
async def search(
    request: Request,
    q: str = Form(""),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_user),
):
    query = (q or "").strip()
    results: list[Course] = []
    scores: dict[uuid.UUID, float] = {}
    search_id: uuid.UUID | None = None
    error: str | None = None

    if query:
        sq = SearchQuery(user_id=user.id, query_text=query)
        db.add(sq)
        await db.commit()
        search_id = sq.id

        try:
            qvec = await cached_embed(query, embed_texts)
            results, scores = await vector_search(db, qvec, limit=25)
        except Exception as exc:
            error = f"Vector search unavailable: {exc}"
            results, scores = [], {}

        if not results:
            results = await keyword_fallback(db, query, limit=25)

    saved_ids: set[uuid.UUID] = set()
    if results:
        res = await db.execute(
            select(SavedCourse.course_id).where(
                SavedCourse.user_id == user.id,
                SavedCourse.course_id.in_([c.id for c in results]),
            )
        )
        saved_ids = set(res.scalars().all())

    return templates.TemplateResponse(
        "partials/results.html",
        {
            "request": request,
            "user": user,
            "results": results,
            "scores": scores,
            "query": query,
            "search_id": search_id,
            "saved_ids": saved_ids,
            "error": error,
        },
    )


# ── Saved courses ─────────────────────────────────────────────────────────────

@app.get("/saved", response_class=HTMLResponse)
async def saved_page(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_user),
):
    res = await db.execute(
        select(Course)
        .join(SavedCourse, SavedCourse.course_id == Course.id)
        .where(SavedCourse.user_id == user.id)
        .order_by(Course.code.asc())
    )
    courses = list(res.scalars().all())
    return templates.TemplateResponse(
        "saved.html", {"request": request, "user": user, "courses": courses}
    )


@app.post("/save/{course_id}", response_class=HTMLResponse)
async def toggle_save(
    course_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_user),
):
    res = await db.execute(
        select(SavedCourse).where(
            SavedCourse.user_id == user.id,
            SavedCourse.course_id == course_id,
        )
    )
    existing = res.scalar_one_or_none()
    if existing:
        await db.execute(delete(SavedCourse).where(SavedCourse.id == existing.id))
        saved = False
    else:
        db.add(SavedCourse(user_id=user.id, course_id=course_id))
        saved = True
    await db.commit()

    return templates.TemplateResponse(
        "partials/save_button.html",
        {"request": request, "course_id": course_id, "saved": saved},
    )


# ── Thumb-up feedback ─────────────────────────────────────────────────────────

@app.post("/thumb/{course_id}", response_class=HTMLResponse)
async def thumb_up(
    course_id: uuid.UUID,
    request: Request,
    search_id: uuid.UUID = Form(...),
    rank: int = Form(...),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_user),
):
    fb = ResultFeedback(
        user_id=user.id,
        search_id=search_id,
        course_id=course_id,
        rank=rank,
        thumb_up=True,
    )
    db.add(fb)
    try:
        await db.commit()
    except Exception:
        await db.rollback()

    return templates.TemplateResponse(
        "partials/thumb_button.html",
        {"request": request, "course_id": course_id, "done": True},
    )


# ── Course details ─────────────────────────────────────────────────────────────

@app.get("/course/{course_id}/details", response_class=HTMLResponse)
async def course_details(
    course_id: uuid.UUID,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user=Depends(require_user),
):
    res = await db.execute(select(Course).where(Course.id == course_id))
    course = res.scalar_one_or_none()
    if not course:
        return HTMLResponse("Course not found.", status_code=404)

    rds = get_redis()
    details = await resolve_course_details(course.code, rds)

    return templates.TemplateResponse(
        "partials/details.html",
        {"request": request, "course": course, "details": details, "user": user},
    )
