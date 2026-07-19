from pathlib import Path
import json
import logging
import time
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.ops_metrics import ops_metrics
from app.core.rate_limit import InMemoryRateLimiter, LimitRule
from app.db.init_db import init_db
from app.live_ws import register_live_websocket

settings = get_settings()
app = FastAPI(title=settings.app_name, version="0.1.0")
request_logger = logging.getLogger("certora.request")
database_startup_failed = False
WEB_DIR = Path(__file__).resolve().parent / "web"
ASSETS_DIR = WEB_DIR / "assets"
ASSESSMENT_WEB_DIST_DIR = Path(__file__).resolve().parent / "web_assessment_react" / "dist"
MEDIA_DIR = Path(settings.resolved_media_dir)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
rate_limiter = InMemoryRateLimiter()

if settings.cors_origins_list:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

if settings.trusted_hosts_list:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts_list)

if settings.enable_gzip:
    app.add_middleware(GZipMiddleware, minimum_size=max(256, int(settings.gzip_minimum_size)))


@app.middleware("http")
async def apply_security_headers(request: Request, call_next):
    started_at = time.perf_counter()
    request_id = request.headers.get("x-request-id") or uuid4().hex
    request.state.request_id = request_id
    method = request.method
    path = request.url.path or "/"
    status_code = 500
    try:
        response = await call_next(request)
        status_code = int(response.status_code)
    except Exception:
        elapsed_ms = (time.perf_counter() - started_at) * 1000.0
        ops_metrics.record(route=path, status_code=status_code, latency_ms=elapsed_ms)
        request_logger.exception(
            "request_error",
            extra={
                "request_log": {
                    "request_id": request_id,
                    "method": method,
                    "path": path,
                    "status_code": status_code,
                    "duration_ms": round(elapsed_ms, 2),
                },
            },
        )
        raise
    elapsed_ms = (time.perf_counter() - started_at) * 1000.0
    ops_metrics.record(route=path, status_code=status_code, latency_ms=elapsed_ms)
    if settings.ops_enable_request_logs:
        request_logger.info(
            json.dumps(
                {
                    "request_id": request_id,
                    "method": method,
                    "path": path,
                    "status_code": status_code,
                    "duration_ms": round(elapsed_ms, 2),
                },
                separators=(",", ":"),
            ),
        )
    if elapsed_ms >= float(settings.ops_slow_request_ms):
        request_logger.warning(
            json.dumps(
                {
                    "event": "slow_request",
                    "request_id": request_id,
                    "method": method,
                    "path": path,
                    "status_code": status_code,
                    "duration_ms": round(elapsed_ms, 2),
                    "threshold_ms": int(settings.ops_slow_request_ms),
                },
                separators=(",", ":"),
            ),
        )
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=()"
    if settings.security_enable_csp:
        csp = (
            "default-src 'self'; "
            "img-src 'self' data: blob: https:; "
            "media-src 'self' blob: data: https:; "
            "script-src 'self' https://www.gstatic.com https://www.googleapis.com https://cdn.jsdelivr.net https://storage.googleapis.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' data: https://fonts.gstatic.com; "
            "connect-src 'self' https://www.gstatic.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://cdn.jsdelivr.net https://storage.googleapis.com; "
            "frame-src 'self' http://127.0.0.1:* http://localhost:*; "
            f"frame-ancestors {settings.security_csp_frame_ancestors}; "
            "base-uri 'self'; form-action 'self';"
        )
        if settings.security_csp_extra:
            csp = f"{csp} {settings.security_csp_extra.strip()}"
        response.headers["Content-Security-Policy"] = csp
    if request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    return response


@app.middleware("http")
async def enforce_basic_rate_limits(request: Request, call_next):
    if not settings.rate_limit_enabled:
        return await call_next(request)
    path = request.url.path or "/"
    if (
        path.startswith("/assets/")
        or path.startswith("/media/")
        or path in {"/health", "/favicon.ico", "/manifest.json", "/site.webmanifest", "/apple-touch-icon.png"}
    ):
        return await call_next(request)
    xff = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    client_ip = xff or (request.client.host if request.client else "unknown")
    auth_route = path.startswith("/auth/") or path.startswith("/config/firebase")
    rule = LimitRule(
        max_requests=settings.rate_limit_auth_requests_per_minute if auth_route else settings.rate_limit_requests_per_minute,
        window_seconds=60,
    )
    key = f"{client_ip}:{'auth' if auth_route else 'api'}"
    allowed, retry_after = rate_limiter.allow(key, rule)
    if not allowed:
        req_id = request.headers.get("x-request-id") or uuid4().hex
        return Response(
            content='{"detail":"Too many requests"}',
            status_code=429,
            media_type="application/json",
            headers={"Retry-After": str(retry_after), "X-Request-ID": req_id},
        )
    return await call_next(request)


@app.on_event("startup")
def on_startup() -> None:
    global database_startup_failed
    try:
        init_db()
    except Exception:
        database_startup_failed = True
        request_logger.exception("database_initialization_failed")
        # Vercel should still be able to serve the assessment shell while a
        # database configuration problem is being diagnosed. Local startup
        # remains strict so development failures are visible immediately.
        if not settings.is_vercel:
            raise


@app.get("/health")
def health():
    return {
        "status": "degraded" if database_startup_failed else "ok",
        "database": "unavailable" if database_startup_failed else "ready",
    }


@app.get("/favicon.ico")
def favicon():
    return Response(status_code=204)


@app.get("/manifest.json")
def manifest_json():
    return Response(status_code=204)


@app.get("/site.webmanifest")
def site_webmanifest():
    return Response(status_code=204)


@app.get("/apple-touch-icon.png")
def apple_touch_icon():
    return Response(status_code=204)


@app.get("/config/firebase")
def firebase_config():
    return {
        "auth_mode": settings.auth_mode,
        "apiKey": settings.firebase_web_api_key,
        "authDomain": settings.firebase_auth_domain,
        "projectId": settings.firebase_project_id,
        "storageBucket": settings.firebase_storage_bucket,
        "messagingSenderId": settings.firebase_messaging_sender_id,
        "appId": settings.firebase_app_id,
        "measurementId": settings.firebase_measurement_id,
        "allowDevRoleOverride": bool(settings.allow_dev_role_override and not settings.is_production),
    }


app.include_router(api_router)
register_live_websocket(app)
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")


@app.get("/")
def frontend():
    return FileResponse(str(WEB_DIR / "index.html"))


@app.get("/stream-player")
def stream_player_frontend():
    return FileResponse(str(WEB_DIR / "stream_player.html"))


@app.get("/assessment")
def assessment_frontend():
    index_file = ASSESSMENT_WEB_DIST_DIR / "index.html"
    if index_file.exists():
        return FileResponse(str(index_file))
    return Response(
        content=(
            "Assessment React frontend is not built yet. "
            "Run: cd app/web_assessment_react && npm install && npm run build"
        ),
        media_type="text/plain",
        status_code=503,
    )


@app.get("/assessment/{path:path}")
def assessment_frontend_routes(path: str):
    index_file = ASSESSMENT_WEB_DIST_DIR / "index.html"
    if index_file.exists():
        direct_file = ASSESSMENT_WEB_DIST_DIR / path
        if direct_file.exists() and direct_file.is_file():
            return FileResponse(str(direct_file))
        return FileResponse(str(index_file))
    return Response(
        content=(
            "Assessment React frontend is not built yet. "
            "Run: cd app/web_assessment_react && npm install && npm run build"
        ),
        media_type="text/plain",
        status_code=503,
    )
