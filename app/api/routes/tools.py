import subprocess
import sys
import tempfile
import shutil
import time
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.api.deps import require_role
from app.core.config import get_settings
from app.models.entities import User, UserRole
from app.services.graph_excel import GraphExcelClient, GraphExcelError, graph_excel_status

router = APIRouter(prefix="/tools", tags=["tools"])


class ExcelSessionCreate(BaseModel):
    persist_changes: bool = False


class ExcelRangeRequest(BaseModel):
    worksheet_name: str = Field(default="Sheet1", min_length=1, max_length=120)
    address: str = Field(min_length=2, max_length=120)
    session_id: str | None = None


class ExcelRangeWriteRequest(ExcelRangeRequest):
    values: list[list[Any]]


class ExcelCalculateRequest(BaseModel):
    session_id: str | None = None


class CodingRunRequest(BaseModel):
    language: Literal["javascript", "python"]
    code: str = Field(min_length=1, max_length=50000)


class CodingPreviewFile(BaseModel):
    path: str = Field(min_length=1, max_length=240)
    content: str = Field(default="", max_length=200000)


class CodingPreviewSyncRequest(BaseModel):
    files: list[CodingPreviewFile] = Field(default_factory=list, min_length=1, max_length=200)
    entry_path: str = Field(default="index.html", min_length=1, max_length=240)


NODE_RUNNER = r"""
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const code = Buffer.concat(chunks).toString("utf8");
const logs = [];
const serialize = (value) => {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
};
const safeConsole = {
  log: (...args) => logs.push(args.map(serialize).join(" ")),
  info: (...args) => logs.push(args.map(serialize).join(" ")),
  warn: (...args) => logs.push("WARN: " + args.map(serialize).join(" ")),
  error: (...args) => logs.push("ERROR: " + args.map(serialize).join(" ")),
};
try {
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const result = await new AsyncFunction("console", code)(safeConsole);
  if (result !== undefined) logs.push("=> " + serialize(result));
} catch (error) {
  logs.push("Runtime error: " + (error && error.message ? error.message : String(error)));
}
process.stdout.write(logs.length ? logs.join("\n") : "Finished without output.");
"""


PYTHON_RUNNER = (
    "import sys\n"
    "code = sys.stdin.read()\n"
    "scope = {'__name__': '__main__'}\n"
    "exec(compile(code, '<candidate.py>', 'exec'), scope, scope)\n"
)

PREVIEW_ROOT = Path(tempfile.gettempdir()) / "valases_coding_preview"
PREVIEW_TTL_SECONDS = 30 * 60
PREVIEW_MAX_TOTAL_BYTES = 2_000_000


def _client_or_503() -> GraphExcelClient:
    settings = get_settings()
    if settings.is_production and not settings.enable_shared_graph_excel:
        raise HTTPException(
            status_code=503,
            detail="Shared Excel credentials are disabled. Configure a tenant-scoped workbook integration.",
        )
    try:
        return GraphExcelClient()
    except GraphExcelError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


def _normalize_preview_path(raw_path: str) -> str:
    normalized = str(raw_path or "").replace("\\", "/").strip().lstrip("/")
    if not normalized or normalized.startswith("../") or "/../" in normalized or normalized.endswith("/.."):
        raise HTTPException(status_code=400, detail="Invalid preview path.")
    return normalized


def _cleanup_expired_previews() -> None:
    if not PREVIEW_ROOT.exists():
        return
    cutoff = time.time() - PREVIEW_TTL_SECONDS
    for child in PREVIEW_ROOT.iterdir():
        try:
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child, ignore_errors=True)
        except OSError:
            continue


@router.get("/excel/graph/status")
def excel_graph_status(current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN))):
    status = graph_excel_status()
    return {
        "provider": "microsoft_graph_excel",
        "configured": status.configured,
        "missing": status.missing,
        "drive_id_configured": bool(status.drive_id),
        "item_id_configured": bool(status.item_id),
    }


@router.post("/excel/graph/session")
def excel_graph_session(
    payload: ExcelSessionCreate,
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    client = _client_or_503()
    return {"session_id": client.create_session(payload.persist_changes)}


@router.post("/excel/graph/range/read")
def excel_graph_read_range(
    payload: ExcelRangeRequest,
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    client = _client_or_503()
    return client.read_range(payload.worksheet_name, payload.address, payload.session_id)


@router.post("/excel/graph/range/write")
def excel_graph_write_range(
    payload: ExcelRangeWriteRequest,
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    client = _client_or_503()
    return client.write_range(payload.worksheet_name, payload.address, payload.values, payload.session_id)


@router.post("/excel/graph/calculate")
def excel_graph_calculate(
    payload: ExcelCalculateRequest,
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    client = _client_or_503()
    return client.calculate(payload.session_id)


@router.post("/coding/run")
def coding_run(
    payload: CodingRunRequest,
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    settings = get_settings()
    if settings.is_production and not settings.enable_server_code_execution:
        raise HTTPException(
            status_code=503,
            detail="Server-side code execution is disabled. Use the isolated execution service.",
        )
    if payload.language == "python":
        try:
            with tempfile.TemporaryDirectory(prefix="valases-code-") as workdir:
                completed = subprocess.run(
                    [
                        sys.executable,
                        "-I",
                        "-S",
                        "-c",
                        PYTHON_RUNNER,
                    ],
                    input=payload.code,
                    capture_output=True,
                    text=True,
                    timeout=3,
                    check=False,
                    cwd=workdir,
                    env={"PYTHONIOENCODING": "utf-8"},
                )
        except subprocess.TimeoutExpired as exc:
            return {
                "language": payload.language,
                "exit_code": None,
                "timed_out": True,
                "stdout": exc.stdout or "",
                "stderr": "Execution timed out after 3 seconds.",
            }
        return {
            "language": payload.language,
            "exit_code": completed.returncode,
            "timed_out": False,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }

    try:
        completed = subprocess.run(
            [
                "node",
                "--permission",
                "--disable-proto=throw",
                "--no-warnings",
                "--input-type=module",
                "--eval",
                NODE_RUNNER,
            ],
            input=payload.code,
            capture_output=True,
            text=True,
            timeout=3,
            check=False,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Node.js is not installed or not available on PATH.") from exc
    except subprocess.TimeoutExpired as exc:
        return {
            "language": payload.language,
            "exit_code": None,
            "timed_out": True,
            "stdout": exc.stdout or "",
            "stderr": "Execution timed out after 3 seconds.",
        }

    return {
        "language": payload.language,
        "exit_code": completed.returncode,
        "timed_out": False,
        "stdout": completed.stdout,
        "stderr": completed.stderr,
    }


@router.post("/coding/preview/sync")
def coding_preview_sync(
    payload: CodingPreviewSyncRequest,
    current_user: User = Depends(require_role(UserRole.PROVIDER, UserRole.ADMIN)),
):
    total_bytes = sum(len(item.content.encode("utf-8")) for item in payload.files)
    if total_bytes > PREVIEW_MAX_TOTAL_BYTES:
        raise HTTPException(status_code=413, detail="Preview workspace is too large.")
    _cleanup_expired_previews()
    PREVIEW_ROOT.mkdir(parents=True, exist_ok=True)
    session_id = uuid4().hex
    session_dir = PREVIEW_ROOT / session_id
    session_dir.mkdir(parents=True, exist_ok=True)

    for item in payload.files:
        relative_path = _normalize_preview_path(item.path)
        destination = (session_dir / relative_path).resolve()
        if session_dir.resolve() not in destination.parents and destination != session_dir.resolve():
            raise HTTPException(status_code=400, detail="Preview path escapes workspace.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(item.content, encoding="utf-8")

    entry_path = _normalize_preview_path(payload.entry_path)
    entry_file = session_dir / entry_path
    if not entry_file.exists() or not entry_file.is_file():
        raise HTTPException(status_code=400, detail="Preview entry file was not found.")

    return {
        "session_id": session_id,
        "preview_url": f"/tools/coding/preview/{session_id}/{entry_path}",
    }


@router.get("/coding/preview/{session_id}/{path:path}")
def coding_preview_file(session_id: str, path: str):
    if len(session_id) != 32 or any(ch not in "0123456789abcdef" for ch in session_id.lower()):
        raise HTTPException(status_code=404, detail="Preview file not found.")
    session_dir = (PREVIEW_ROOT / session_id).resolve()
    try:
        if not session_dir.is_dir() or session_dir.stat().st_mtime < time.time() - PREVIEW_TTL_SECONDS:
            shutil.rmtree(session_dir, ignore_errors=True)
            raise HTTPException(status_code=404, detail="Preview session expired.")
    except OSError as exc:
        raise HTTPException(status_code=404, detail="Preview file not found.") from exc
    requested_path = _normalize_preview_path(path)
    file_path = (session_dir / requested_path).resolve()
    if session_dir not in file_path.parents and file_path != session_dir:
        raise HTTPException(status_code=404, detail="Preview file not found.")
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Preview file not found.")
    return FileResponse(
        str(file_path),
        headers={
            "Cache-Control": "no-store, max-age=0",
            "Content-Security-Policy": (
                "sandbox allow-scripts allow-forms allow-modals; default-src 'none'; "
                "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob:; "
                "connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
            ),
            "Referrer-Policy": "no-referrer",
            "X-Content-Type-Options": "nosniff",
        },
    )
