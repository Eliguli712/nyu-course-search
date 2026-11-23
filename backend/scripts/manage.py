"""
Management CLI for NYU Course Search.

Usage (from the backend/ directory):
    python scripts/manage.py init-db
    python scripts/manage.py scrape-courses
    python scripts/manage.py embed-courses [--limit N]
    python scripts/manage.py stats
    python scripts/manage.py reset-db        # ⚠ destructive
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table
from sqlalchemy import select, text, func

# Make `app` importable when run as `python scripts/manage.py` from backend/
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import settings
from app.db import engine, ensure_extensions, ensure_tables, AsyncSessionLocal
from app.models import Base, Course, User, SavedCourse, SearchQuery, ResultFeedback
from app.scrape import scrape_all_courses
from app.embeddings import embed_documents

console = Console()
cli = typer.Typer(add_completion=False, help="NYU Course Search management commands.")


# ── init-db ──────────────────────────────────────────────────────────────────

@cli.command("init-db")
def init_db():
    """Create tables, extensions, and indexes. Safe to re-run."""

    async def _run():
        await ensure_extensions()
        await ensure_tables()
        console.print("[green]✓ Database initialised[/green]")

    asyncio.run(_run())


# ── scrape-courses ────────────────────────────────────────────────────────────

@cli.command("scrape-courses")
def scrape_courses():
    """Scrape courses from NYU Bulletin and upsert into DB."""

    async def _run():
        with console.status("[bold]Scraping NYU Bulletin…[/bold]"):
            courses = await scrape_all_courses()
        console.print(f"Scraped [cyan]{len(courses)}[/cyan] course records")

        async with AsyncSessionLocal() as db:
            upserts = 0
            for c in courses:
                res = await db.execute(
                    select(Course).where(Course.code == c.code, Course.name == c.name)
                )
                existing = res.scalar_one_or_none()
                if existing:
                    changed = False
                    if existing.description != c.description:
                        existing.description = c.description
                        changed = True
                    if existing.source_url != c.source_url:
                        existing.source_url = c.source_url
                        changed = True
                    if changed:
                        existing.embedding = None  # force re-embed on next run
                        upserts += 1
                else:
                    db.add(Course(
                        code=c.code,
                        name=c.name,
                        description=c.description,
                        source_url=c.source_url,
                    ))
                    upserts += 1

            await db.commit()

        console.print(f"[green]✓ Upserted {upserts} records[/green]")

    asyncio.run(_run())


# ── embed-courses ─────────────────────────────────────────────────────────────

@cli.command("embed-courses")
def embed_courses(
    limit: int = typer.Option(500, help="Max courses to embed per run. Use 0 for all."),
    batch: int = typer.Option(32, help="Embedding batch size."),
):
    """Compute and store embeddings for courses that don't have one yet."""

    async def _run():
        async with AsyncSessionLocal() as db:
            q = select(Course).where(Course.embedding.is_(None))
            if limit > 0:
                q = q.limit(limit)
            res = await db.execute(q)
            courses = list(res.scalars().all())

        if not courses:
            console.print("[yellow]No courses pending embeddings.[/yellow]")
            return

        console.print(f"Embedding [cyan]{len(courses)}[/cyan] courses…")

        # Process in batches with a progress bar
        all_vecs: list[list[float]] = []
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TextColumn("{task.completed}/{task.total}"),
            TimeElapsedColumn(),
            console=console,
        ) as progress:
            task = progress.add_task("Embedding", total=len(courses))
            for i in range(0, len(courses), batch):
                chunk = courses[i : i + batch]
                texts = [f"{c.code} {c.name}. {c.description}" for c in chunk]
                vecs = embed_documents(texts)
                all_vecs.extend(vecs)
                progress.advance(task, len(chunk))

        # Write back
        async with AsyncSessionLocal() as db:
            for c, v in zip(courses, all_vecs):
                res = await db.execute(select(Course).where(Course.id == c.id))
                row = res.scalar_one_or_none()
                if row:
                    row.embedding = v
            await db.commit()

        console.print(f"[green]✓ Embedded {len(courses)} courses[/green]")

    asyncio.run(_run())


# ── stats ─────────────────────────────────────────────────────────────────────

@cli.command("stats")
def stats():
    """Print database statistics."""

    async def _run():
        async with AsyncSessionLocal() as db:
            n_courses      = (await db.execute(select(func.count(Course.id)))).scalar_one()
            n_embedded     = (await db.execute(select(func.count(Course.id)).where(Course.embedding.isnot(None)))).scalar_one()
            n_users        = (await db.execute(select(func.count(User.id)))).scalar_one()
            n_saved        = (await db.execute(select(func.count(SavedCourse.id)))).scalar_one()
            n_searches     = (await db.execute(select(func.count(SearchQuery.id)))).scalar_one()
            n_feedback     = (await db.execute(select(func.count(ResultFeedback.id)))).scalar_one()

        t = Table(title="NYU Course Search — Database Stats", show_header=True)
        t.add_column("Metric", style="cyan")
        t.add_column("Count", justify="right", style="bold white")
        t.add_row("Total courses",          str(n_courses))
        t.add_row("Courses with embedding", str(n_embedded))
        t.add_row("Courses pending embed",  str(n_courses - n_embedded))
        t.add_row("Registered users",       str(n_users))
        t.add_row("Saved course entries",   str(n_saved))
        t.add_row("Search queries logged",  str(n_searches))
        t.add_row("Thumb-up feedback",      str(n_feedback))
        console.print(t)

    asyncio.run(_run())


# ── reset-db ──────────────────────────────────────────────────────────────────

@cli.command("reset-db")
def reset_db(
    yes: bool = typer.Option(False, "--yes", help="Skip confirmation prompt."),
):
    """⚠ DROP and recreate all tables. Destroys all data."""
    if not yes:
        typer.confirm("This will DELETE all data. Are you sure?", abort=True)

    async def _run():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        console.print("[yellow]Tables dropped.[/yellow]")
        await ensure_extensions()
        await ensure_tables()
        console.print("[green]✓ Database reset complete.[/green]")

    asyncio.run(_run())


if __name__ == "__main__":
    cli()
