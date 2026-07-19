from __future__ import annotations

from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.entities import LessonVideo


def pricing_recommendation_for_course(db: Session, *, course_id: int, entered_price: float, expected_views_per_month: int) -> dict:
    s = get_settings()
    rows = db.execute(
        select(LessonVideo.duration_seconds).where(
            and_(LessonVideo.course_id == int(course_id), LessonVideo.ready_status.is_(True)),
        ),
    ).all()
    total_duration_seconds = int(sum(int(r[0] or 0) for r in rows))
    total_duration_minutes = max(0.0, total_duration_seconds / 60.0)
    video_count = len(rows)

    storage_cost_per_min = float(s.pricing_stream_storage_cost_per_minute_month or 0)
    delivery_cost_per_min = float(s.pricing_stream_delivery_cost_per_minute or 0)
    fee_pct = max(0.0, min(0.95, float(s.pricing_platform_fee_pct or 0.1)))
    margin_floor = max(0.0, min(0.95, float(s.pricing_creator_margin_floor_pct or 0.35)))

    monthly_storage_cost = total_duration_minutes * storage_cost_per_min
    per_student_delivery_cost = total_duration_minutes * delivery_cost_per_min
    delivery_cost_proxy = per_student_delivery_cost * max(1, int(expected_views_per_month))

    denom = max(0.01, (1.0 - fee_pct - margin_floor))
    recommended_minimum_price = round(per_student_delivery_cost / denom, 2)
    low = round(recommended_minimum_price * 1.1, 2)
    high = round(recommended_minimum_price * 1.6, 2)

    warning = None
    if float(entered_price or 0) > 0 and entered_price < recommended_minimum_price:
        warning = "Warning: lower price may reduce your net earnings"

    return {
        "currency": s.pricing_currency,
        "total_course_duration_seconds": total_duration_seconds,
        "total_course_duration_minutes": round(total_duration_minutes, 2),
        "total_videos": int(video_count),
        "estimated_delivery_cost_proxy": round(delivery_cost_proxy, 2),
        "estimated_monthly_storage_cost": round(monthly_storage_cost, 2),
        "recommended_minimum_price": recommended_minimum_price,
        "recommended_price_range": {
            "min": low,
            "max": high,
        },
        "warning": warning,
        "inputs": {
            "entered_price": round(float(entered_price or 0), 2),
            "expected_views_per_month": int(expected_views_per_month),
            "platform_fee_pct": fee_pct,
            "creator_margin_floor_pct": margin_floor,
        },
    }


def analytics_total_uploaded_minutes(db: Session) -> float:
    total_seconds = db.scalar(select(func.coalesce(func.sum(LessonVideo.duration_seconds), 0))) or 0
    return round(float(total_seconds) / 60.0, 2)
