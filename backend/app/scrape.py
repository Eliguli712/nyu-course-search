"""
Scraper for the NYU Bulletin course catalogue.

Shallow crawl: the root index at bulletins.nyu.edu/courses/ links to one page
per subject; each subject page lists its courses as div.courseblock elements.

Reconstructed from the project's viewer excerpt (same selectors, concurrency
limit and User-Agent).
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from .config import settings

_MAX_CONCURRENCY = 8
_HEADERS = {"User-Agent": "nyu-course-search/2.0"}


@dataclass(frozen=True)
class ScrapedCourse:
    code: str
    name: str
    description: str
    source_url: str


def _clean(text: str) -> str:
    return " ".join(text.replace("\xa0", " ").split())


def _subject_links(root_url: str, html: str) -> list[str]:
    """All links one level below /courses/ on the same host."""
    soup = BeautifulSoup(html, "lxml")
    root = urlparse(root_url)
    links: set[str] = set()
    for a in soup.select("a[href]"):
        url = urljoin(root_url, a["href"]).split("#")[0]
        p = urlparse(url)
        if p.netloc != root.netloc:
            continue
        if p.path.startswith("/courses/") and p.path.rstrip("/") != "/courses":
            links.add(url)
    return sorted(links)


def _parse_course_blocks(url: str, html: str) -> list[ScrapedCourse]:
    soup = BeautifulSoup(html, "lxml")
    out: list[ScrapedCourse] = []
    for block in soup.select("div.courseblock"):
        title_el = block.select_one(".courseblocktitle")
        desc_el = block.select_one(".courseblockdesc")
        if title_el is None:
            continue
        code_el = title_el.select_one("strong") or title_el
        title = _clean(code_el.get_text(" "))
        if not title:
            continue

        # Titles look like "CSCI-UA 101  Intro to Computer Science  (4 Credits)".
        # Keep the code as the first two tokens when the second is a number.
        parts = title.split()
        if len(parts) >= 2 and any(ch.isdigit() for ch in parts[1]):
            code, rest = " ".join(parts[:2]), parts[2:]
        else:
            code, rest = parts[0], parts[1:]
        name = " ".join(rest).split(" (")[0].strip() or code

        description = _clean(desc_el.get_text(" ")) if desc_el else ""
        out.append(ScrapedCourse(code=code, name=name, description=description, source_url=url))
    return out


async def scrape_all_courses() -> list[ScrapedCourse]:
    root_url = settings.bulletins_courses_root
    sem = asyncio.Semaphore(_MAX_CONCURRENCY)

    async with httpx.AsyncClient(headers=_HEADERS, timeout=30.0, follow_redirects=True) as client:
        root = await client.get(root_url)
        root.raise_for_status()
        links = _subject_links(root_url, root.text)

        async def fetch(url: str) -> tuple[str, str]:
            async with sem:
                try:
                    r = await client.get(url)
                    r.raise_for_status()
                    return url, r.text
                except httpx.HTTPError:
                    return url, ""

        pages = await asyncio.gather(*(fetch(u) for u in links))

    courses: list[ScrapedCourse] = []
    seen: set[tuple[str, str]] = set()
    for url, html in pages:
        if not html:
            continue
        for c in _parse_course_blocks(url, html):
            key = (c.code, c.name)
            if key not in seen:
                seen.add(key)
                courses.append(c)
    return courses
