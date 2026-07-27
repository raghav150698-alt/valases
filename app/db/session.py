from urllib.parse import urlparse

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

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


@event.listens_for(Session, "after_begin")
def _apply_tenant_context_after_begin(session: Session, transaction, connection) -> None:
    organization_id = session.info.get("organization_id")
    if not settings.database_tenant_rls_enabled or not organization_id or connection.dialect.name != "postgresql":
        return
    connection.execute(
        text("SELECT set_config('app.current_organization_id', :organization_id, true)"),
        {"organization_id": str(int(organization_id))},
    )


def set_database_organization_context(db: Session, organization_id: int) -> None:
    db.info["organization_id"] = int(organization_id)
    if settings.database_tenant_rls_enabled and db.bind is not None and db.bind.dialect.name == "postgresql":
        db.execute(
            text("SELECT set_config('app.current_organization_id', :organization_id, true)"),
            {"organization_id": str(int(organization_id))},
        )


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
