"""StayHazaribagh API — FastAPI application entrypoint.

Run locally:
    uvicorn backend.main:app --reload --port 8000     # from pg-khoj/
On Render (see ../render.yaml):
    uvicorn backend.main:app --host 0.0.0.0 --port $PORT
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import Base, engine
from .routers import admin as admin_router
from .routers import auth as auth_router
from .routers import listings as listings_router
from .routers import owner as owner_router

Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="StayHazaribagh API",
    description="PG / hostel / flat finder and owner management for "
                "Hazaribagh and Ranchi.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(listings_router.router)
app.include_router(owner_router.router)
app.include_router(admin_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "stayhazaribagh-api"}


@app.get("/")
def root():
    return {"status": "ok", "service": "stayhazaribagh-api",
            "docs": "/docs"}
