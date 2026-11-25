"""Configuration from environment variables.

Secrets (SECRET_KEY, DATABASE_URL) are read from the environment only.
Copy .env.example to .env for local development; never commit .env.
"""
import os

from dotenv import load_dotenv

load_dotenv()  # local dev only; on Render, env vars come from the dashboard


def _cors_origins() -> list[str]:
    raw = os.getenv(
        "CORS_ORIGINS",
        "https://stayhazaribagh.vercel.app,http://localhost:5173",
    )
    return [o.strip() for o in raw.split(",") if o.strip()]


class Settings:
    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-only-change-me")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")
    CORS_ORIGINS: list[str] = _cors_origins()
    JWT_ALGORITHM: str = "HS256"
    # 30 days, to match the frontend session length.
    JWT_EXPIRE_DAYS: int = 30
    # Login / PIN lockout policy: 5 wrong attempts -> 15-minute lock.
    MAX_LOGIN_ATTEMPTS: int = 5
    LOCKOUT_MINUTES: int = 15


settings = Settings()

if settings.SECRET_KEY == "dev-only-change-me":
    print(
        "WARNING: using insecure dev SECRET_KEY. "
        "Set SECRET_KEY in the environment for any real deployment."
    )
