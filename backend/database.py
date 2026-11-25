"""Database setup.

Postgres when DATABASE_URL is set (Render), otherwise a local SQLite file
next to this module so tests and local dev run with no database server.
"""
import os

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SQLITE_PATH = os.path.join(BASE_DIR, "stayhazaribagh.db")


def _database_url() -> str:
    url = (settings.DATABASE_URL or "").strip()
    if not url:
        return f"sqlite:///{SQLITE_PATH}"
    # SQLAlchemy needs the postgresql:// scheme; some providers give postgres://
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    return url


DATABASE_URL = _database_url()
IS_SQLITE = DATABASE_URL.startswith("sqlite")

connect_args = {"check_same_thread": False} if IS_SQLITE else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
