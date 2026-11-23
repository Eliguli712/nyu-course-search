"""
Authentication: @nyu.edu-only accounts, bcrypt password hashes and signed,
expiring session cookies.

Reconstructed from the project's viewer excerpt; the public names match the
imports in main.py.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, HTTPException, Request
from fastapi.responses import Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from passlib.context import CryptContext
from sqlalchemy.ext.asyncio import AsyncSession

from .config import settings
from .db import get_db
from .models import User

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
serializer = URLSafeTimedSerializer(settings.secret_key, salt="session")


@dataclass(frozen=True)
class AuthedUser:
    id: uuid.UUID
    email: str


# ── Passwords ────────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return pwd_context.verify(password, password_hash)
    except ValueError:
        return False


# ── Email policy ─────────────────────────────────────────────────────────────

def enforce_nyu_email(email: str) -> None:
    domain = "@" + settings.nyu_email_domain.lower()
    if not email.strip().lower().endswith(domain):
        raise HTTPException(status_code=400, detail=f"Email must end with {domain}")


# ── Session cookies ──────────────────────────────────────────────────────────

def create_session_token(user_id: uuid.UUID) -> str:
    return serializer.dumps({"uid": str(user_id)})


def read_session_token(token: Optional[str]) -> Optional[uuid.UUID]:
    """Return the user id if the token's signature and age are valid."""
    if not token:
        return None
    try:
        data = serializer.loads(token, max_age=settings.session_max_age_seconds)
        return uuid.UUID(data["uid"])
    except (BadSignature, SignatureExpired, KeyError, ValueError, TypeError):
        return None


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=settings.session_max_age_seconds,
        httponly=True,
        secure=(settings.environment == "prod"),   # HTTPS only in prod
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=settings.session_cookie_name)


# ── Dependency ───────────────────────────────────────────────────────────────

async def require_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> AuthedUser:
    """FastAPI dependency: 401 (→ redirect to /login) unless a valid session exists."""
    user_id = read_session_token(request.cookies.get(settings.session_cookie_name))
    if user_id is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="Not signed in")
    return AuthedUser(id=user.id, email=user.email)
