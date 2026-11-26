"""Database setup.

Postgres when DATABASE_URL is set (Render), otherwise a local SQLite file
next to this module so tests and local dev run with no database server.
"""
import logging
import os

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

logger = logging.getLogger(__name__)

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


def ensure_schema() -> None:
    """Add columns that create_all() cannot add to an existing database.

    Production (Neon/Postgres) already has tables from earlier deploys, so
    new model columns would otherwise never appear. Inspects the live
    schema, ALTERs only the missing columns, and backfills NULLs. Safe on
    both Postgres and SQLite. NEVER raises: a migration failure is logged
    and the app keeps running.
    """
    try:
        inspector = inspect(engine)
        existing_tables = set(inspector.get_table_names())
        columns = {
            table: {c["name"] for c in inspector.get_columns(table)}
            for table in existing_tables
        }
        # (table, column, DDL) — DDL must be valid on Postgres AND SQLite.
        missing = [
            ("listings", "status",
             "ALTER TABLE listings ADD COLUMN status VARCHAR(20) "
             "DEFAULT 'live'"),
            ("listings", "rejection_reason",
             "ALTER TABLE listings ADD COLUMN rejection_reason TEXT"),
            ("users", "verified_owner",
             "ALTER TABLE users ADD COLUMN verified_owner BOOLEAN "
             "DEFAULT FALSE"),
            ("rent_records", "method",
             "ALTER TABLE rent_records ADD COLUMN method VARCHAR(10)"),
        ]
        backfills = [
            ("listings",
             "UPDATE listings SET status='live' WHERE status IS NULL"),
            ("users",
             "UPDATE users SET verified_owner=FALSE "
             "WHERE verified_owner IS NULL"),
        ]
        with engine.begin() as conn:
            for table, column, ddl in missing:
                if table in columns and column not in columns[table]:
                    conn.execute(text(ddl))
                    logger.info("ensure_schema: added %s.%s", table, column)
            for table, sql in backfills:
                if table in columns:
                    conn.execute(text(sql))
    except Exception:
        logger.exception("ensure_schema: migration failed (continuing)")
