import os
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine, event

# Read Docker env vars, fallback to sqlite for local dev
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./gods_eye.db")

def _init_sqlite_engine(url: str):
    eng = create_engine(
        url,
        connect_args={"check_same_thread": False, "timeout": 10},
    )
    @event.listens_for(eng, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        # 啟用 SQLite 預寫日誌 (WAL) 模式與效能調校，支援高並發讀寫並防止 database is locked
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA cache_size=-64000")  # 64MB 快取
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.close()
    return eng

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    engine = _init_sqlite_engine(SQLALCHEMY_DATABASE_URL)
else:
    try:
        engine = create_engine(
            SQLALCHEMY_DATABASE_URL,
            pool_size=int(os.getenv("DB_POOL_SIZE", "20")),
            max_overflow=int(os.getenv("DB_MAX_OVERFLOW", "20")),
            pool_timeout=15,
            pool_pre_ping=True,
            pool_recycle=1800,
            connect_args={"connect_timeout": 5},
        )
    except Exception as e:
        print(f"⚠️ PostgreSQL engine initialization failed ({e}), falling back to SQLite for local development.")
        SQLALCHEMY_DATABASE_URL = "sqlite:///./gods_eye.db"
        engine = _init_sqlite_engine(SQLALCHEMY_DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# FastAPI Dependency Injection
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
