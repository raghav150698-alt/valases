from pathlib import Path
import json
import logging
import time
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.ops_metrics import ops_metrics
from app.core.rate_limit import InMemoryRateLimiter, LimitRule
from app.db.init_db import init_db, verify_database_schema

settings = get_settings()
app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None if settings.is_production else "/redoc",
    openapi_url=None if settings.is_production else "/openapi.json",
)
request_logger = logging.getLogger("valases.request")
database_startup_failed = False
WEB_DIR = Path(__file__).resolve().parent / "web"
ASSETS_DIR = WEB_DIR / "assets"
ASSESSMENT_WEB_DIST_DIR = Path(__file__).resolve().parent / "web_assessment_react" / "dist"
MEDIA_DIR = Path(settings.resolved_media_dir)
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
rate_limiter = InMemoryRateLimiter()

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
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=()"
    response.headers["X-Permitted-Cross-Domain-Policies"] = "none"
    if path.startswith(("/auth/", "/admin/", "/exams/", "/proctoring/", "/tools/", "/ops/", "/config/")):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
    if settings.security_enable_csp:
        supabase_origin = ""
        if str(settings.supabase_url or "").startswith("https://"):
            supabase_origin = f" {str(settings.supabase_url).rstrip('/')}"
        frame_sources = "'self'" if settings.is_production else "'self' http://127.0.0.1:* http://localhost:*"
        csp = (
            "default-src 'self'; "
            "img-src 'self' data: blob: https:; "
            "media-src 'self' blob: data: https:; "
            "script-src 'self' 'wasm-unsafe-eval' https://www.gstatic.com https://www.googleapis.com https://storage.googleapis.com; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' data: https://fonts.gstatic.com; "
            f"connect-src 'self'{supabase_origin} https://www.gstatic.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://storage.googleapis.com; "
            "worker-src 'self' blob:; "
            f"frame-src {frame_sources}; "
            f"frame-ancestors {settings.security_csp_frame_ancestors}; "
            "object-src 'none'; manifest-src 'self'; base-uri 'self'; form-action 'self';"
        )
        if settings.security_csp_extra:
            csp = f"{csp} {settings.security_csp_extra.strip()}"
        if "Content-Security-Policy" not in response.headers:
            response.headers["Content-Security-Policy"] = csp
    if settings.is_production or request.url.scheme == "https":
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains; preload"
    return response


@app.middleware("http")
async def enforce_basic_rate_limits(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > max(1024, int(settings.max_request_body_bytes)):
                return JSONResponse(status_code=413, content={"detail": "Request body is too large"})
        except ValueError:
            return JSONResponse(status_code=400, content={"detail": "Invalid Content-Length header"})
    if not settings.rate_limit_enabled:
        return await call_next(request)
    path = request.url.path or "/"
    if (
        path.startswith("/assets/")
        or path.startswith("/media/")
        or path in {"/health", "/favicon.ico", "/manifest.json", "/site.webmanifest", "/apple-touch-icon.png"}
    ):
        return await call_next(request)
    if settings.is_vercel:
        forwarded = request.headers.get("x-vercel-forwarded-for") or request.headers.get("x-real-ip") or ""
        client_ip = forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
    else:
        client_ip = request.client.host if request.client else "unknown"
    auth_route = (
        path.startswith("/auth/")
        or path.startswith("/config/firebase")
        or path == "/exams/issued/login"
        or (path.startswith("/exams/issued/key/") and path.endswith("/login"))
    )
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
    security_errors = settings.production_security_errors()
    if security_errors:
        raise RuntimeError("Unsafe production configuration: " + "; ".join(security_errors))
    try:
        if settings.is_production and not settings.enable_startup_database_management:
            verify_database_schema()
        else:
            init_db()
    except Exception as exc:
        if settings.enable_startup_database_management and settings.is_vercel and "already exists" in str(exc).lower():
            # Concurrent Vercel cold starts can race during the first schema
            # bootstrap. The winning instance creates the table; retry after
            # it commits so this instance can continue normally.
            time.sleep(0.25)
            try:
                init_db()
                return
            except Exception as retry_exc:
                exc = retry_exc
        database_startup_failed = True
        request_logger.exception("database_initialization_failed")
        # Vercel should still be able to serve the assessment shell while a
        # database configuration problem is being diagnosed. Local startup
        # remains strict so development failures are visible immediately.
        if not settings.is_vercel:
            raise


@app.get("/health")
def health():
    payload = {
        "status": "degraded" if database_startup_failed else "ok",
        "database": "unavailable" if database_startup_failed else "ready",
    }
    return JSONResponse(content=payload, status_code=503 if database_startup_failed else 200)


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
app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")


@app.get("/")
def frontend(request: Request):
    query = f"?{request.url.query}" if request.url.query else ""
    return RedirectResponse(url=f"/assessment/{query}", status_code=307)


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


# Keep CORS outside FastAPI's error middleware so server errors and rate-limit
# responses remain readable by the separate candidate portal.
if settings.cors_origins_list:
    app = CORSMiddleware(
        app=app,
        allow_origins=settings.cors_origins_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Accept", "X-Request-ID"],
    )
