"""
Course details resolver.

NYU Bulletin Class Search lives at https://bulletins.nyu.edu/class-search/
and accepts query parameters:  ?search=<code>&term=<term_string>

The page is a React SPA, so we cannot scrape rendered results easily.
Instead we:
  1. Build the correct URL for the user to click / view in an iframe.
  2. Try to fetch a raw API endpoint (/api/class-search or similar) that
     the SPA calls; if that works we extract structured data.
  3. If not, we fall back to a best-effort BeautifulSoup parse of the
     initial HTML (server-side prerendering sometimes includes results).

Term strings accepted by the form:  "Spring 2026", "Summer 2026", "Fall 2025"
We walk backwards from the current year trying all three seasons per year,
then continue back year-by-year as the PLAN requires.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from urllib.parse import urlencode, urljoin

import httpx
from bs4 import BeautifulSoup
import redis.asyncio as redis

from .config import settings

# ── Term helpers ─────────────────────────────────────────────────────────────

# Order matters: try newest-within-a-year first
_SEASONS = ["Fall", "Summer", "Spring"]


def _term_sequence(max_terms: int = 20) -> list[str]:
    """Generate term strings newest-first, e.g. ['Fall 2026', 'Summer 2026', ...]."""
    now = datetime.now(timezone.utc)
    year = now.year + 1      # look 1 year ahead first
    terms: list[str] = []
    while len(terms) < max_terms:
        for season in _SEASONS:
            terms.append(f"{season} {year}")
            if len(terms) >= max_terms:
                break
        year -= 1
    return terms


def class_search_url(course_code: str, term: str) -> str:
    qs = urlencode({"search": course_code, "term": term})
    return settings.bulletins_class_search_root + "?" + qs


# ── Data class ───────────────────────────────────────────────────────────────

@dataclass
class CourseDetails:
    found: bool
    url: str           # the class-search URL to show to the user
    term: str | None = None
    snippet_html: str | None = None


# ── HTTP helpers ─────────────────────────────────────────────────────────────

_HEADERS = {
    "User-Agent": "nyu-course-search/2.0",
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
}


async def _fetch(url: str, *, accept_json: bool = False) -> tuple[int, str]:
    hdrs = dict(_HEADERS)
    if accept_json:
        hdrs["Accept"] = "application/json"
    try:
        async with httpx.AsyncClient(
            timeout=20.0,
            follow_redirects=True,
            headers=hdrs,
        ) as client:
            r = await client.get(url)
            return r.status_code, r.text
    except Exception:
        return 0, ""


# ── Snippet extraction from HTML ─────────────────────────────────────────────

def _extract_snippet(html: str, course_code: str) -> str | None:
    """
    Try to find a relevant snippet in the page HTML.

    The class-search page is a React SPA; on first load the server may
    pre-render some content. We look for the course code in several
    common patterns.
    """
    if not html or len(html) < 200:
        return None

    soup = BeautifulSoup(html, "lxml")

    code_clean = course_code.strip().upper()
    # Variants the page might show: "CSCI-UA 102", "CSCI-UA.0102", etc.
    code_variants = {code_clean, code_clean.replace("-", " "), code_clean.replace(".", " ")}

    # Strategy 1: look for any element that contains the code and has reasonable length
    candidates: list[tuple[int, str]] = []
    for el in soup.find_all(["tr", "li", "div", "article", "section"]):
        txt = el.get_text(" ", strip=True)
        up = txt.upper()
        if any(v in up for v in code_variants) and 20 < len(txt) < 2000:
            # Score by length (prefer richer snippets, penalise huge containers)
            depth = len(list(el.parents))
            score = len(txt) - depth * 50
            candidates.append((score, str(el)[:1500]))

    if candidates:
        candidates.sort(key=lambda t: t[0], reverse=True)
        return candidates[0][1]

    # Strategy 2: look for JSON-like preloaded state in <script> tags
    for script in soup.find_all("script"):
        src = script.string or ""
        if code_clean in src.upper() and len(src) < 50_000:
            # Try to pull out a useful portion
            idx = src.upper().find(code_clean)
            fragment = src[max(0, idx - 100) : idx + 400]
            return f"<pre style='white-space:pre-wrap;font-size:0.75rem'>{fragment}</pre>"

    return None


# ── Main resolver ─────────────────────────────────────────────────────────────

_CACHE_HIT_TTL  = 60 * 60 * 24 * 7   # 7 days
_CACHE_MISS_TTL = 60 * 60 * 6         # 6 hours


async def resolve_course_details(
    course_code: str,
    rds: redis.Redis,
) -> CourseDetails:
    cache_key = f"details2:{course_code.strip().upper()}"

    # ── Redis cache hit ──────────────────────────────────────────────────────
    cached = await rds.get(cache_key)
    if cached:
        try:
            return CourseDetails(**json.loads(cached))
        except Exception:
            pass  # corrupted entry; re-fetch

    # ── Walk terms newest → oldest ───────────────────────────────────────────
    terms = _term_sequence(max_terms=20)

    for term in terms:
        url = class_search_url(course_code, term)
        status, html = await _fetch(url)

        if status not in (200, 0):
            continue
        if not html:
            continue

        snippet = _extract_snippet(html, course_code)
        if snippet:
            details = CourseDetails(found=True, url=url, term=term, snippet_html=snippet)
            await rds.set(cache_key, json.dumps(asdict(details)), ex=_CACHE_HIT_TTL)
            return details

    # ── Not found: cache the miss with the most recent URL ───────────────────
    fallback_url = class_search_url(course_code, terms[0])
    details = CourseDetails(found=False, url=fallback_url, term=None, snippet_html=None)
    await rds.set(cache_key, json.dumps(asdict(details)), ex=_CACHE_MISS_TTL)
    return details
