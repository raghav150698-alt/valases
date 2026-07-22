from fastapi import APIRouter

from app.api.routes.admin import router as legacy_admin_router

# Mount only the Valases operations endpoints. The legacy learning-platform
# admin routes remain available to migration scripts but are not public API.
router = APIRouter()
router.routes.extend(
    route
    for route in legacy_admin_router.routes
    if route.path.startswith("/admin/workspace/") or route.path == "/admin/users/{user_id}/state"
)
