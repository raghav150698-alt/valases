"""Explicit opt-in publication; internal requisitions are never listed by default."""
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.models.entities import Base


class JobMarketplacePublication(Base):
    __tablename__ = "job_marketplace_publications"

    job_id: Mapped[int] = mapped_column(ForeignKey("job_requisitions.id"), primary_key=True)
    published: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    minimum_experience_years: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
