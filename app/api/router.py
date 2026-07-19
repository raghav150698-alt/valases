from fastapi import APIRouter

from app.api.routes import admin, auth, certificates, courses, exams, ops, proctoring, provider, stream_market, student, tools

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(provider.router)
api_router.include_router(courses.router)
api_router.include_router(exams.router)
api_router.include_router(student.router)
api_router.include_router(proctoring.router)
api_router.include_router(certificates.router)
api_router.include_router(admin.router)
api_router.include_router(ops.router)
api_router.include_router(stream_market.router)
api_router.include_router(tools.router)
