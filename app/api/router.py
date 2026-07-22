from fastapi import APIRouter

from app.api.routes import admin_workspace, assessment_provider, auth, exams, ops, proctoring, tools

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(assessment_provider.router)
api_router.include_router(exams.router)
api_router.include_router(proctoring.router)
api_router.include_router(admin_workspace.router)
api_router.include_router(ops.router)
api_router.include_router(tools.router)
