import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from groq import Groq

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ENV_FILE = os.path.join(BASE_DIR, ".env")

load_dotenv(ENV_FILE, override=True)

app = FastAPI(title="CaptionAI Backend")

DB_FILE = os.path.join(os.path.dirname(__file__), "captions.db")
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_PUBLISHABLE_KEY = (
    os.getenv("SUPABASE_PUBLISHABLE_KEY", "")
    or os.getenv("SUPABASE_ANON_KEY", "")
)

security = HTTPBearer()

# CORS configuration: support CORS_ORIGINS while preserving localhost development access
DEFAULT_CORS_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
raw_cors = os.getenv("CORS_ORIGINS", "")
configured_origins = [
    origin.strip() for origin in raw_cors.split(",") if origin.strip()
]
allowed_origins = list(dict.fromkeys(DEFAULT_CORS_ORIGINS + configured_origins))

# Support Vercel production and preview domains (*.vercel.app) by default or custom regex
cors_origin_regex = os.getenv(
    "CORS_ORIGIN_REGEX",
    r"^https:\/\/.*\.vercel\.app$"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CaptionRequest(BaseModel):
    topic: str = Field(min_length=2, max_length=500)
    platform: str = "Instagram"
    tone: str = "Engaging"
    language: str = "Hinglish"


def get_connection():
    connection = sqlite3.connect(DB_FILE, timeout=15.0)
    connection.row_factory = sqlite3.Row
    return connection


@contextmanager
def get_db_connection():
    connection = get_connection()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def init_db():
    with get_db_connection() as connection:
        connection.execute("PRAGMA journal_mode = WAL;")
        connection.execute("PRAGMA foreign_keys = ON;")
        connection.execute("PRAGMA busy_timeout = 15000;")
        connection.execute("""
            CREATE TABLE IF NOT EXISTS captions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic TEXT NOT NULL,
                platform TEXT NOT NULL,
                tone TEXT NOT NULL,
                language TEXT NOT NULL,
                caption_text TEXT NOT NULL,
                created_at TEXT NOT NULL,
                user_id TEXT
            )
        """)

        # Migrate an existing database without deleting old captions.
        columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(captions)"
            ).fetchall()
        }

        if "user_id" not in columns:
            connection.execute(
                "ALTER TABLE captions ADD COLUMN user_id TEXT"
            )

        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_captions_user_id ON captions(user_id)"
        )


init_db()


# Groq client singleton for safe client reuse across requests
_groq_client: Groq | None = None
_cached_api_key: str | None = None


def get_groq_client() -> Groq:
    global _groq_client, _cached_api_key
    api_key = os.getenv("GROQ_API_KEY")

    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="GROQ_API_KEY missing. Check backend .env file.",
        )

    if _groq_client is None or _cached_api_key != api_key:
        _groq_client = Groq(api_key=api_key)
        _cached_api_key = api_key

    return _groq_client


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
):
    if not SUPABASE_URL or not SUPABASE_PUBLISHABLE_KEY:
        raise HTTPException(
            status_code=500,
            detail="Supabase configuration is missing in backend .env.",
        )

    token = credentials.credentials

    try:
        response = httpx.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={
                "apikey": SUPABASE_PUBLISHABLE_KEY,
                "Authorization": f"Bearer {token}",
            },
            timeout=10.0,
        )

        if response.status_code != 200:
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired login session. Please log in again.",
            )

        user = response.json()

        if not user.get("id"):
            raise HTTPException(
                status_code=401,
                detail="Could not verify the logged-in user.",
            )

        return {"id": user["id"], "email": user.get("email")}

    except httpx.RequestError:
        raise HTTPException(
            status_code=503,
            detail="Could not contact Supabase to verify your session.",
        )


@app.get("/")
def home():
    return {
        "status": "success",
        "message": "CaptionAI backend is running!",
    }


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.post("/generate-caption")
def generate_caption(
    data: CaptionRequest,
    user: dict = Depends(get_current_user),
):
    try:
        client = get_groq_client()

        max_tokens_env = os.getenv("GROQ_MAX_TOKENS")
        max_tokens = (
            int(max_tokens_env)
            if max_tokens_env and max_tokens_env.isdigit()
            else 1024
        )

        response = client.chat.completions.create(
            model=os.getenv("GROQ_MODEL", "openai/gpt-oss-120b"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are CaptionAI, a professional social media "
                        "caption writer. Generate 3 distinct captions for "
                        "the requested topic. Match the platform, tone, "
                        "and language. Include relevant hashtags. "
                        "Use clear headings and useful formatting."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"Topic: {data.topic}\n"
                        f"Platform: {data.platform}\n"
                        f"Tone: {data.tone}\n"
                        f"Language: {data.language}\n"
                        "Create 3 unique captions and relevant hashtags."
                    ),
                },
            ],
            temperature=0.8,
            max_completion_tokens=max_tokens,
        )

        caption_text = response.choices[0].message.content

        if not caption_text:
            raise HTTPException(
                status_code=502,
                detail="AI returned an empty caption.",
            )

        created_at = datetime.now(timezone.utc).isoformat()

        with get_db_connection() as connection:
            cursor = connection.execute(
                """
                INSERT INTO captions
                (topic, platform, tone, language, caption_text,
                 created_at, user_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    data.topic,
                    data.platform,
                    data.tone,
                    data.language,
                    caption_text,
                    created_at,
                    user["id"],
                ),
            )

            caption_id = cursor.lastrowid

        return {
            "status": "success",
            "id": caption_id,
            "topic": data.topic,
            "platform": data.platform,
            "tone": data.tone,
            "language": data.language,
            "caption_text": caption_text,
            "captions": caption_text,
            "created_at": created_at,
        }

    except HTTPException:
        raise

    except Exception as error:
        print(f"Caption generation error: {error}")
        raise HTTPException(
            status_code=502,
            detail=(
                "AI caption generation failed. Check your API key, "
                "model availability, and Groq account limits."
            ),
        )


@app.get("/captions")
def get_captions(
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    try:
        with get_db_connection() as connection:
            total_count = connection.execute(
                "SELECT COUNT(*) FROM captions WHERE user_id = ?",
                (user["id"],),
            ).fetchone()[0]

            rows = connection.execute(
                """
                SELECT id, topic, platform, tone, language,
                       caption_text, created_at
                FROM captions
                WHERE user_id = ?
                ORDER BY id DESC
                LIMIT ? OFFSET ?
                """,
                (user["id"], limit, offset),
            ).fetchall()

        items = []
        for row in rows:
            item = dict(row)
            item["captions"] = item["caption_text"]
            items.append(item)

        return {
            "status": "success",
            "total": total_count,
            "limit": limit,
            "offset": offset,
            "captions": items,
        }

    except Exception as error:
        print(f"History retrieval error: {error}")
        raise HTTPException(
            status_code=500,
            detail="Could not retrieve caption history.",
        )


@app.delete("/captions/{caption_id}")
def delete_caption(
    caption_id: int,
    user: dict = Depends(get_current_user),
):
    try:
        with get_db_connection() as connection:
            cursor = connection.execute(
                """
                DELETE FROM captions
                WHERE id = ? AND user_id = ?
                """,
                (caption_id, user["id"]),
            )

            if cursor.rowcount == 0:
                raise HTTPException(
                    status_code=404,
                    detail="Caption not found.",
                )

        return {
            "status": "success",
            "message": "Caption deleted successfully.",
            "id": caption_id,
        }

    except HTTPException:
        raise

    except Exception as error:
        print(f"Caption deletion error: {error}")
        raise HTTPException(
            status_code=500,
            detail="Could not delete caption.",
        )
