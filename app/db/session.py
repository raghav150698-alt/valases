from urllib.parse import urlparse

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import get_settings

settings = get_settings()

database_url = settings.resolved_database_url
if database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False}
else:
    # Supabase's transaction pooler (port 6543) does not support prepared
    # statements across pooled connections.
    parsed_url = urlparse(database_url)
    connect_args = {"prepare_threshold": None} if parsed_url.port == 6543 else {}
engine = create_engine(database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
