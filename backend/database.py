import os
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine

# Read Docker env vars, fallback to localhost for local dev
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://gods_eye_user:password@localhost:5432/gods_eye")

engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# FastAPI Dependency Injection
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
