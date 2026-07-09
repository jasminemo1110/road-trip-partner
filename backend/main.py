import os
import io
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import List, Optional
from urllib.request import urlopen
from urllib.parse import urlencode

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlmodel import Session, create_engine, select, SQLModel
from pydantic import BaseModel

from models import (
    Route, RouteRead, RouteCreate,
    Stop, StopRead, StopCreate, ReorderRequest,
    Photo, PhotoRead,
    LegPath, LegPathRead, LegPathCreate,
)
import json
from datetime import datetime

# ── DB setup ──────────────────────────────────────────────────────────────────
DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent))
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = Path(os.getenv("DATABASE_URL", DATA_DIR / "travel.db"))
engine = create_engine(f"sqlite:///{DB_PATH}", echo=False)
SQLModel.metadata.create_all(engine)

def ensure_schema() -> None:
    """Apply small SQLite schema additions for existing local databases."""
    with engine.connect() as conn:
        # WAL 模式：Litestream 复制的前提，同时改善读写并发。设置持久化在
        # DB 文件头里，重复执行是 no-op。
        conn.exec_driver_sql("PRAGMA journal_mode=WAL")
        columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(route)").fetchall()}
        if "qr_code_path" not in columns:
            conn.exec_driver_sql("ALTER TABLE route ADD COLUMN qr_code_path TEXT DEFAULT ''")
            conn.commit()


ensure_schema()

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", DATA_DIR / "uploads"))
UPLOAD_DIR.mkdir(exist_ok=True)
QR_UPLOAD_DIR = UPLOAD_DIR / "route_qr"
QR_UPLOAD_DIR.mkdir(exist_ok=True)
BRANDING_DIR = Path(os.getenv("BRANDING_DIR", DATA_DIR / "branding"))
BRANDING_DIR.mkdir(parents=True, exist_ok=True)
PROJECT_ROOT = Path(__file__).parent.parent
FRONTEND_DIR = PROJECT_ROOT / "frontend"
FRONTEND_DIST = FRONTEND_DIR / "dist"
EXPORT_OUT_DIR = Path(os.getenv("EXPORT_OUT_DIR", DATA_DIR / "exports"))
EXPORT_OUT_DIR.mkdir(parents=True, exist_ok=True)

AMAP_KEY = os.getenv("AMAP_KEY", "")  # 服务端 key（用于地理编码，与前端 JS key 不同）
AMAP_JS_KEY = os.getenv("AMAP_JS_KEY", os.getenv("VITE_AMAP_KEY", ""))
AMAP_SECURITY_CODE = os.getenv("AMAP_SECURITY_CODE", os.getenv("VITE_AMAP_SECURITY_CODE", ""))
EDIT_TOKEN = os.getenv("EDIT_TOKEN", "")
export_jobs: dict[str, dict] = {}

# 单个上传文件（照片/二维码）的大小上限；整个请求体再放宽一档兜底。
_MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
_MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", str(64 * 1024 * 1024)))

app = FastAPI(title="Travel Map API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def limit_request_size(request: Request, call_next):
    # Starlette 在 endpoint 拿到 UploadFile 之前就已经把 multipart 全量收下
    # （spool 到磁盘），endpoint 里的检查挡不住超大请求本身，只能在这里拦。
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > _MAX_REQUEST_BYTES:
        return JSONResponse(status_code=413, content={"detail": "Request body too large"})
    return await call_next(request)


def get_session():
    with Session(engine) as session:
        yield session


def require_edit(request: Request) -> None:
    if not EDIT_TOKEN:
        return
    token = request.headers.get("X-Edit-Token") or request.query_params.get("edit") or request.query_params.get("token")
    if not token or not secrets.compare_digest(token, EDIT_TOKEN):
        raise HTTPException(status_code=403, detail="Edit token required")


def route_to_read(route: Route, session: Session) -> RouteRead:
    stops = session.exec(select(Stop).where(Stop.route_id == route.id).order_by(Stop.order)).all()
    stop_reads = []
    for stop in stops:
        photos = session.exec(select(Photo).where(Photo.stop_id == stop.id)).all()
        stop_reads.append(StopRead(
            **stop.model_dump(),
            photos=[PhotoRead(**p.model_dump()) for p in photos],
        ))
    return RouteRead(**route.model_dump(), stops=stop_reads)


class ExportImagesRequest(BaseModel):
    include: List[str]
    wait: int = 1500
    scale: float = 2


def _parse_lines(env_value: str) -> List[str]:
    if not env_value:
        return []
    stripped = env_value.strip()
    if stripped.startswith("["):
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, list):
                return [str(item) for item in parsed]
        except json.JSONDecodeError:
            pass
    return [line for line in (l.strip() for l in env_value.splitlines()) if line]


@app.get("/api/config")
def get_public_config():
    return {
        "amapKey": AMAP_JS_KEY,
        "amapSecurityCode": AMAP_SECURITY_CODE,
        "editRequired": bool(EDIT_TOKEN),
        "siteTitle": os.getenv("SITE_TITLE", ""),
        "siteSocialDescription": os.getenv("SITE_SOCIAL_DESCRIPTION", ""),
        "homeBaseCity": os.getenv("HOME_BASE_CITY", ""),
        "ownerProfileLines": _parse_lines(os.getenv("OWNER_PROFILE_LINES", "")),
        "ownerGithub": os.getenv("OWNER_GITHUB", ""),
        "ownerEmail": os.getenv("OWNER_EMAIL", ""),
        "ownerWechat": os.getenv("OWNER_WECHAT", ""),
        "ownerPlatforms": os.getenv("OWNER_PLATFORMS", ""),
        "titleImageUrl": os.getenv("TITLE_IMAGE_URL", ""),
        "exportTitleImageUrl": os.getenv("EXPORT_TITLE_IMAGE_URL", ""),
        "overviewQrUrl": os.getenv("OVERVIEW_QR_URL", ""),
        "socialPreviewUrl": os.getenv("SOCIAL_PREVIEW_URL", ""),
    }


def _run_export_job(job_id: str, include: List[str], wait: int, scale: float) -> None:
    job = export_jobs[job_id]
    job["status"] = "running"
    job["started_at"] = datetime.utcnow().isoformat()
    include_arg = ",".join(include)
    job_out_dir = EXPORT_OUT_DIR / job_id
    job_out_dir.mkdir(parents=True, exist_ok=True)
    node_bin = (
        os.getenv("NODE_BIN")
        or shutil.which("node")
        or "/usr/local/bin/node"
    )
    cmd = [
        node_bin, "scripts/export-images.mjs",
        f"--base={job.get('base_url')}",
        f"--include={include_arg}",
        f"--out={job_out_dir}",
        f"--wait={wait}",
        f"--scale={scale:g}",
        "--reload=false",
    ]
    job["command"] = " ".join(cmd)
    job["output_dir"] = str(job_out_dir)
    job["progress_current"] = 0
    job["progress_total"] = len(include)
    job["current_label"] = ""
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=FRONTEND_DIR,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
        )
        stdout_lines: list[str] = []
        progress_re = re.compile(r"^\[(\d+)/(\d+)\]\s*(.+)$")
        assert proc.stdout is not None
        for line in proc.stdout:
            stdout_lines.append(line)
            if len(stdout_lines) > 200:
                stdout_lines = stdout_lines[-200:]
            match = progress_re.match(line.strip())
            if match:
                job["progress_current"] = int(match.group(1)) - 1
                job["progress_total"] = int(match.group(2))
                job["current_label"] = match.group(3)
            if "saved:" in line:
                job["progress_current"] = min(
                    int(job.get("progress_current", 0)) + 1,
                    int(job.get("progress_total", len(include))),
                )
            job["stdout"] = "".join(stdout_lines)[-12000:]
        return_code = proc.wait(timeout=60 * 60)
        job["return_code"] = return_code
        job["stdout"] = "".join(stdout_lines)[-12000:]
        job["stderr"] = ""
        job["finished_at"] = datetime.utcnow().isoformat()
        manifest = job_out_dir / "export-manifest.json"
        job["manifest_path"] = str(manifest) if manifest.exists() else ""
        if return_code == 0:
            try:
                job["zip_path"] = _create_export_zip(job_id, manifest)
            except Exception as exc:
                job["zip_error"] = str(exc)
        job["progress_current"] = job.get("progress_total", len(include)) if return_code == 0 else job.get("progress_current", 0)
        job["status"] = "completed" if return_code == 0 else "failed"
    except Exception as exc:
        job["status"] = "failed"
        job["stderr"] = str(exc)
        job["finished_at"] = datetime.utcnow().isoformat()


def _cleanup_export_jobs() -> None:
    now = time.time()
    for job_id, job in list(export_jobs.items()):
        if now - job.get("created_ts", now) > 60 * 60 * 6:
            export_jobs.pop(job_id, None)


# 导出跑的是 Playwright + Chromium，1GB 的 Fly 机器同时跑两个必然互相拖死，
# 同一时间只允许一个任务。超过 2 小时的 running 视为僵尸（正常任务 1 小时
# proc.wait 超时就会转 failed），不再阻塞新任务。
_EXPORT_JOB_STALE_SECONDS = 2 * 60 * 60
_EXPORT_FILES_MAX_AGE_SECONDS = int(os.getenv("EXPORT_FILES_MAX_AGE_SECONDS", str(24 * 60 * 60)))
_export_start_lock = threading.Lock()


def _cleanup_stale_export_dirs() -> None:
    """清掉超过一天的旧导出目录。文件清理接口只在用户成功保存 zip 后被
    前端调用，失败或没下载的任务会把 PNG/zip 留在卷上慢慢吃空间，所以
    每次启动新任务时顺手清一遍。活跃任务不会受影响：任务最长 1 小时，
    远小于 1 天的门槛。"""
    now = time.time()
    if not EXPORT_OUT_DIR.exists():
        return
    for entry in EXPORT_OUT_DIR.iterdir():
        if not entry.is_dir():
            continue
        try:
            if now - entry.stat().st_mtime > _EXPORT_FILES_MAX_AGE_SECONDS:
                shutil.rmtree(entry, ignore_errors=True)
        except OSError:
            continue


@app.post("/api/export-images/start")
def start_export_images(data: ExportImagesRequest, request: Request):
    require_edit(request)
    if not data.include:
        raise HTTPException(400, "No export items selected")
    with _export_start_lock:
        _cleanup_export_jobs()
        _cleanup_stale_export_dirs()
        now = time.time()
        for job in export_jobs.values():
            if (
                job.get("status") in ("queued", "running")
                and now - job.get("created_ts", 0) < _EXPORT_JOB_STALE_SECONDS
            ):
                raise HTTPException(409, "已有导出任务在进行中，请等它完成后再试")
        job_id = uuid.uuid4().hex
        export_jobs[job_id] = {
            "id": job_id,
            "status": "queued",
            "created_ts": time.time(),
            "created_at": datetime.utcnow().isoformat(),
            "include": data.include,
            "wait": data.wait,
            "scale": data.scale,
            "base_url": str(request.base_url).rstrip("/"),
            "output_dir": str(EXPORT_OUT_DIR / job_id),
            "progress_current": 0,
            "progress_total": len(data.include),
            "current_label": "",
        }
    thread = threading.Thread(
        target=_run_export_job,
        args=(job_id, data.include, data.wait, data.scale),
        daemon=True,
    )
    thread.start()
    return export_jobs[job_id]


@app.get("/api/export-images/{job_id}")
def get_export_images_job(job_id: str, request: Request):
    require_edit(request)
    job = export_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Export job not found")
    return job


@app.get("/api/export-images/{job_id}/zip")
def download_export_images_zip(job_id: str, request: Request):
    require_edit(request)
    job = export_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Export job not found")
    if job.get("status") != "completed":
        raise HTTPException(400, "Export job is not completed")
    zip_path = Path(job.get("zip_path") or "")
    if not zip_path.exists():
        manifest = Path(job.get("manifest_path") or "")
        zip_path = Path(_create_export_zip(job_id, manifest))
        job["zip_path"] = str(zip_path)
    return FileResponse(
        zip_path,
        media_type="application/zip",
        filename=f"自驾足迹导出-{job_id[:8]}.zip",
    )


@app.delete("/api/export-images/{job_id}/files")
def cleanup_export_images_files(job_id: str, request: Request):
    require_edit(request)
    job = export_jobs.get(job_id)
    if not job:
        raise HTTPException(404, "Export job not found")
    output_dir = Path(job.get("output_dir") or "")
    base = EXPORT_OUT_DIR.resolve()
    if output_dir.exists() and str(output_dir.resolve()).startswith(str(base)) and output_dir.resolve() != base:
        shutil.rmtree(output_dir, ignore_errors=True)
    job["files_cleaned"] = True
    return {"ok": True}


def _create_export_zip(job_id: str, manifest_path: Path) -> str:
    if not manifest_path.exists():
        raise FileNotFoundError("export-manifest.json not found")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    output_dir = Path(export_jobs.get(job_id, {}).get("output_dir") or manifest_path.parent)
    zip_path = output_dir / f"export-{job_id}.zip"
    base = output_dir.resolve()
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for item in manifest.get("results", []):
            file_path = Path(item.get("filePath", ""))
            resolved = file_path.resolve()
            if not str(resolved).startswith(str(base)):
                continue
            if resolved.exists() and resolved.suffix.lower() == ".png":
                zf.write(resolved, arcname=resolved.name)
        zf.write(manifest_path, arcname="export-manifest.json")
    return str(zip_path)


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/api/routes", response_model=List[RouteRead])
def list_routes():
    with Session(engine) as session:
        routes = session.exec(select(Route)).all()
        return [route_to_read(r, session) for r in routes]


@app.get("/api/routes/{route_id}", response_model=RouteRead)
def get_route(route_id: int):
    with Session(engine) as session:
        route = session.get(Route, route_id)
        if not route:
            raise HTTPException(404, "Route not found")
        return route_to_read(route, session)


@app.post("/api/routes", response_model=RouteRead, dependencies=[Depends(require_edit)])
def create_route(data: RouteCreate):
    with Session(engine) as session:
        route = Route(**data.model_dump())
        session.add(route)
        session.commit()
        session.refresh(route)
        return route_to_read(route, session)


@app.put("/api/routes/{route_id}", response_model=RouteRead, dependencies=[Depends(require_edit)])
def update_route(route_id: int, data: RouteCreate):
    with Session(engine) as session:
        route = session.get(Route, route_id)
        if not route:
            raise HTTPException(404)
        for k, v in data.model_dump().items():
            setattr(route, k, v)
        session.add(route)
        session.commit()
        session.refresh(route)
        return route_to_read(route, session)


@app.post("/api/routes/{route_id}/favorite", response_model=RouteRead, dependencies=[Depends(require_edit)])
def toggle_favorite(route_id: int):
    with Session(engine) as session:
        route = session.get(Route, route_id)
        if not route:
            raise HTTPException(404)
        route.is_favorite = not route.is_favorite
        session.add(route)
        session.commit()
        session.refresh(route)
        return route_to_read(route, session)


@app.post("/api/routes/{route_id}/qr", response_model=RouteRead, dependencies=[Depends(require_edit)])
async def upload_route_qr(route_id: int, file: UploadFile = File(...)):
    contents = await file.read()
    if len(contents) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large: {len(contents):,} bytes (limit {_MAX_UPLOAD_BYTES:,})")
    ext = Path(file.filename or "qr.png").suffix.lower() or ".png"
    if ext not in {".png", ".jpg", ".jpeg", ".webp"}:
        raise HTTPException(400, "Unsupported QR image format")

    with Session(engine) as session:
        route = session.get(Route, route_id)
        if not route:
            raise HTTPException(404, "Route not found")
        _delete_route_qr_file(route.qr_code_path)
        filename = f"route_{route_id}_{os.urandom(6).hex()}{ext}"
        (QR_UPLOAD_DIR / filename).write_bytes(contents)
        route.qr_code_path = filename
        session.add(route)
        session.commit()
        session.refresh(route)
        return route_to_read(route, session)


@app.get("/api/routes/{route_id}/qr/file")
def serve_route_qr(route_id: int):
    with Session(engine) as session:
        route = session.get(Route, route_id)
        if not route or not route.qr_code_path:
            raise HTTPException(404)
        path = QR_UPLOAD_DIR / route.qr_code_path
        if not path.exists():
            raise HTTPException(404)
        return FileResponse(path)


@app.delete("/api/routes/{route_id}/qr", response_model=RouteRead, dependencies=[Depends(require_edit)])
def delete_route_qr(route_id: int):
    with Session(engine) as session:
        route = session.get(Route, route_id)
        if not route:
            raise HTTPException(404, "Route not found")
        _delete_route_qr_file(route.qr_code_path)
        route.qr_code_path = ""
        session.add(route)
        session.commit()
        session.refresh(route)
        return route_to_read(route, session)


@app.delete("/api/routes/{route_id}", dependencies=[Depends(require_edit)])
def delete_route(route_id: int):
    with Session(engine) as session:
        route = session.get(Route, route_id)
        if not route:
            raise HTTPException(404)
        stops = session.exec(select(Stop).where(Stop.route_id == route_id)).all()
        for stop in stops:
            photos = session.exec(select(Photo).where(Photo.stop_id == stop.id)).all()
            for photo in photos:
                _delete_photo_files(photo)
                session.delete(photo)
            _invalidate_leg_cache(session, stop.id)
            session.delete(stop)
        _delete_route_qr_file(route.qr_code_path)
        session.delete(route)
        session.commit()
        return {"ok": True}


def _delete_route_qr_file(file_path: str):
    if not file_path:
        return
    path = QR_UPLOAD_DIR / file_path
    if path.exists():
        try:
            path.unlink()
        except Exception:
            pass


# ── Stops ─────────────────────────────────────────────────────────────────────

@app.post("/api/routes/{route_id}/stops", response_model=StopRead, dependencies=[Depends(require_edit)])
def create_stop(route_id: int, data: StopCreate):
    with Session(engine) as session:
        stop = Stop(route_id=route_id, **data.model_dump())
        session.add(stop)
        session.commit()
        session.refresh(stop)
        return StopRead(**stop.model_dump(), photos=[])


def _invalidate_leg_cache(session: Session, stop_id: int) -> None:
    """Drop any cached leg paths whose endpoint is this stop — coords changed
    or stop removed, so the road-snapped path is no longer valid."""
    legs = session.exec(
        select(LegPath).where(
            (LegPath.stop_a_id == stop_id) | (LegPath.stop_b_id == stop_id)
        )
    ).all()
    for leg in legs:
        session.delete(leg)


@app.put("/api/stops/{stop_id}", response_model=StopRead, dependencies=[Depends(require_edit)])
def update_stop(stop_id: int, data: StopCreate):
    with Session(engine) as session:
        stop = session.get(Stop, stop_id)
        if not stop:
            raise HTTPException(404)
        coords_changed = (stop.longitude != data.longitude or stop.latitude != data.latitude)
        for k, v in data.model_dump().items():
            setattr(stop, k, v)
        session.add(stop)
        if coords_changed:
            _invalidate_leg_cache(session, stop_id)
        session.commit()
        session.refresh(stop)
        photos = session.exec(select(Photo).where(Photo.stop_id == stop.id)).all()
        return StopRead(**stop.model_dump(), photos=[PhotoRead(**p.model_dump()) for p in photos])


@app.delete("/api/stops/{stop_id}", dependencies=[Depends(require_edit)])
def delete_stop(stop_id: int):
    with Session(engine) as session:
        stop = session.get(Stop, stop_id)
        if not stop:
            raise HTTPException(404)
        photos = session.exec(select(Photo).where(Photo.stop_id == stop_id)).all()
        for photo in photos:
            _delete_photo_files(photo)
            session.delete(photo)
        _invalidate_leg_cache(session, stop_id)
        session.delete(stop)
        session.commit()
        return {"ok": True}


# ── Leg path cache ────────────────────────────────────────────────────────────
# Stored canonically with stop_a_id < stop_b_id. Frontend sends raw stop ids in
# travel direction; we normalize and reverse the path on write/read as needed.

@app.get("/api/routes/{route_id}/leg-paths", response_model=List[LegPathRead])
def get_route_leg_paths(route_id: int):
    with Session(engine) as session:
        stop_ids = [s.id for s in session.exec(select(Stop).where(Stop.route_id == route_id)).all()]
        if not stop_ids:
            return []
        legs = session.exec(
            select(LegPath).where(
                LegPath.stop_a_id.in_(stop_ids),
                LegPath.stop_b_id.in_(stop_ids),
            )
        ).all()
        return [LegPathRead(stop_a_id=l.stop_a_id, stop_b_id=l.stop_b_id, path=json.loads(l.path_json)) for l in legs]


@app.post("/api/leg-paths", response_model=LegPathRead, dependencies=[Depends(require_edit)])
def save_leg_path(data: LegPathCreate):
    a, b = sorted([data.stop_a_id, data.stop_b_id])
    path = data.path if data.stop_a_id == a else list(reversed(data.path))
    with Session(engine) as session:
        existing = session.exec(
            select(LegPath).where(LegPath.stop_a_id == a, LegPath.stop_b_id == b)
        ).first()
        now = datetime.utcnow().isoformat()
        if existing:
            existing.path_json = json.dumps(path)
            existing.computed_at = now
            session.add(existing)
        else:
            session.add(LegPath(stop_a_id=a, stop_b_id=b, path_json=json.dumps(path), computed_at=now))
        session.commit()
        return LegPathRead(stop_a_id=a, stop_b_id=b, path=path)


@app.post("/api/routes/{route_id}/stops/reorder", dependencies=[Depends(require_edit)])
def reorder_stops(route_id: int, data: ReorderRequest):
    with Session(engine) as session:
        for idx, stop_id in enumerate(data.stop_ids):
            stop = session.get(Stop, stop_id)
            if stop and stop.route_id == route_id:
                stop.order = idx
                session.add(stop)
        session.commit()
        return {"ok": True}


# ── Photos ────────────────────────────────────────────────────────────────────

@app.post("/api/stops/{stop_id}/photos", response_model=PhotoRead, dependencies=[Depends(require_edit)])
async def upload_photo(stop_id: int, file: UploadFile = File(...), caption: str = Form("")):
    contents = await file.read()
    if len(contents) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large: {len(contents):,} bytes (limit {_MAX_UPLOAD_BYTES:,})")
    ext = Path(file.filename or "photo.jpg").suffix.lower() or ".jpg"
    filename = f"{stop_id}_{os.urandom(6).hex()}{ext}"
    file_path = UPLOAD_DIR / filename
    file_path.write_bytes(contents)

    with Session(engine) as session:
        photo = Photo(stop_id=stop_id, file_path=str(filename), thumbnail_path=str(filename), caption=caption)
        session.add(photo)
        session.commit()
        session.refresh(photo)
        return PhotoRead(**photo.model_dump())


@app.get("/api/photos/{photo_id}/file")
def serve_photo(photo_id: int):
    with Session(engine) as session:
        photo = session.get(Photo, photo_id)
        if not photo:
            raise HTTPException(404)
        path = UPLOAD_DIR / photo.file_path
        if not path.exists():
            raise HTTPException(404)
        return FileResponse(path)


@app.delete("/api/photos/{photo_id}", dependencies=[Depends(require_edit)])
def delete_photo(photo_id: int):
    with Session(engine) as session:
        photo = session.get(Photo, photo_id)
        if not photo:
            raise HTTPException(404)
        _delete_photo_files(photo)
        session.delete(photo)
        session.commit()
        return {"ok": True}


def _delete_photo_files(photo: Photo):
    for p in [photo.file_path, photo.thumbnail_path]:
        if p:
            path = UPLOAD_DIR / p
            if path.exists():
                try:
                    path.unlink()
                except Exception:
                    pass


# ── Geocoding (高德地图 REST API) ─────────────────────────────────────────────

@app.get("/api/geocode")
def geocode(keyword: str):
    if not AMAP_KEY:
        # 返回一些常用城市的硬编码坐标作为 fallback
        fallback = {
            "济南": (117.12, 36.65), "北京": (116.40, 39.90), "上海": (121.47, 31.23),
            "西宁": (101.78, 36.62), "张掖": (100.45, 38.93), "敦煌": (94.68, 40.14),
            "兰州": (103.83, 36.06), "成都": (104.07, 30.67), "西藏": (91.11, 29.65),
            "拉萨": (91.11, 29.65), "青海湖": (100.19, 36.89), "嘉峪关": (98.29, 39.77),
            "银川": (106.27, 38.47), "郑州": (113.65, 34.76), "武汉": (114.30, 30.59),
            "广州": (113.26, 23.13), "深圳": (114.06, 22.54), "重庆": (106.55, 29.56),
            "昆明": (102.83, 24.88), "丽江": (100.23, 26.87), "大理": (100.19, 25.69),
        }
        results = [{"name": k, "lng": v[0], "lat": v[1]} for k, v in fallback.items() if keyword in k]
        return results[:5]

    params = urlencode({"keywords": keyword, "key": AMAP_KEY, "output": "JSON"})
    try:
        resp = urlopen(f"https://restapi.amap.com/v3/geocode/geo?{params}", timeout=5)
        import json
        data = json.loads(resp.read())
        results = []
        for geo in data.get("geocodes", []):
            loc = geo.get("location", "").split(",")
            if len(loc) == 2:
                results.append({"name": geo.get("formatted_address", keyword), "lng": float(loc[0]), "lat": float(loc[1])})
        return results[:5]
    except Exception:
        return []


# ── GPX/KML import ────────────────────────────────────────────────────────────
#
# GPS devices and consumer apps (iPhone, Garmin, Strava, Google Maps "My Maps")
# emit WGS-84 coordinates. AMap renders in GCJ-02 ("Mars coordinates"), so points
# imported as-is would be offset 50–500m. We convert WGS-84 → GCJ-02 for any
# coordinate inside China's rough bounding box; coordinates outside (overseas
# routes) pass through unchanged. Forks targeting non-AMap providers can set
# DISABLE_GCJ02_CONVERSION=1 to skip the transform entirely.

import math as _math

_GCJ02_PI = 3.1415926535897932384626
_GCJ02_A = 6378245.0
_GCJ02_EE = 0.00669342162296594323
_DISABLE_GCJ02 = os.getenv("DISABLE_GCJ02_CONVERSION", "").lower() in ("1", "true", "yes")
_MAX_IMPORT_BYTES = int(os.getenv("MAX_IMPORT_BYTES", str(5 * 1024 * 1024)))


def _gcj02_out_of_china(lng: float, lat: float) -> bool:
    return not (73.66 < lng < 135.05 and 3.86 < lat < 53.55)


def _gcj02_delta(lng: float, lat: float) -> tuple[float, float]:
    x = lng - 105.0
    y = lat - 35.0
    d_lat = (-100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y
             + 0.2 * _math.sqrt(abs(x)))
    d_lat += (20.0 * _math.sin(6.0 * x * _GCJ02_PI) + 20.0 * _math.sin(2.0 * x * _GCJ02_PI)) * 2.0 / 3.0
    d_lat += (20.0 * _math.sin(y * _GCJ02_PI) + 40.0 * _math.sin(y / 3.0 * _GCJ02_PI)) * 2.0 / 3.0
    d_lat += (160.0 * _math.sin(y / 12.0 * _GCJ02_PI) + 320.0 * _math.sin(y * _GCJ02_PI / 30.0)) * 2.0 / 3.0
    d_lng = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * _math.sqrt(abs(x))
    d_lng += (20.0 * _math.sin(6.0 * x * _GCJ02_PI) + 20.0 * _math.sin(2.0 * x * _GCJ02_PI)) * 2.0 / 3.0
    d_lng += (20.0 * _math.sin(x * _GCJ02_PI) + 40.0 * _math.sin(x / 3.0 * _GCJ02_PI)) * 2.0 / 3.0
    d_lng += (150.0 * _math.sin(x / 12.0 * _GCJ02_PI) + 300.0 * _math.sin(x / 30.0 * _GCJ02_PI)) * 2.0 / 3.0
    rad_lat = lat / 180.0 * _GCJ02_PI
    magic = 1 - _GCJ02_EE * _math.sin(rad_lat) ** 2
    sqrt_magic = _math.sqrt(magic)
    d_lat = (d_lat * 180.0) / ((_GCJ02_A * (1 - _GCJ02_EE)) / (magic * sqrt_magic) * _GCJ02_PI)
    d_lng = (d_lng * 180.0) / (_GCJ02_A / sqrt_magic * _math.cos(rad_lat) * _GCJ02_PI)
    return d_lng, d_lat


def wgs84_to_gcj02(lng: float, lat: float) -> tuple[float, float]:
    if _DISABLE_GCJ02 or _gcj02_out_of_china(lng, lat):
        return lng, lat
    d_lng, d_lat = _gcj02_delta(lng, lat)
    return lng + d_lng, lat + d_lat


def _parse_kml_coords(text: str) -> List[tuple[float, float]]:
    """Parse KML <coordinates> body: whitespace-separated lon,lat[,alt] tuples."""
    out: List[tuple[float, float]] = []
    for token in text.split():
        parts = token.split(",")
        if len(parts) >= 2:
            try:
                out.append((float(parts[0]), float(parts[1])))
            except ValueError:
                pass
    return out


@app.post("/api/routes/{route_id}/import-gpx", response_model=List[StopRead], dependencies=[Depends(require_edit)])
async def import_gpx(route_id: int, file: UploadFile = File(...)):
    contents = await file.read()
    if len(contents) > _MAX_IMPORT_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large: {len(contents):,} bytes (limit {_MAX_IMPORT_BYTES:,}).",
        )
    try:
        root = ET.fromstring(contents.decode("utf-8", errors="ignore"))
    except ET.ParseError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid XML: {exc}")

    waypoints: List[tuple[str, float, float]] = []
    # Namespace-agnostic XPath ({*}localname) tolerates GPX 1.0, 1.1, KML 2.0–2.3
    # and any other minor variant rather than hardcoding a single namespace URI.
    tag = root.tag.lower()

    if "gpx" in tag:
        for wpt in root.findall(".//{*}wpt"):
            name_el = wpt.find("{*}name")
            name = (name_el.text or "").strip() if name_el is not None else ""
            try:
                lat = float(wpt.get("lat", "0"))
                lon = float(wpt.get("lon", "0"))
            except ValueError:
                continue
            if lat and lon:
                waypoints.append((name or f"路点{len(waypoints)+1}", lon, lat))
        if not waypoints:
            trkpts = root.findall(".//{*}trkpt")
            step = max(1, len(trkpts) // 20)
            for i, pt in enumerate(trkpts[::step]):
                try:
                    lat = float(pt.get("lat", "0"))
                    lon = float(pt.get("lon", "0"))
                except ValueError:
                    continue
                if lat and lon:
                    waypoints.append((f"路点{i+1}", lon, lat))
    elif "kml" in tag:
        for pm in root.findall(".//{*}Placemark"):
            name_el = pm.find("{*}name")
            name = (name_el.text or "").strip() if name_el is not None else ""
            # Each Placemark may contain Point, LineString, or MultiGeometry; all use <coordinates>.
            for coords_el in pm.findall(".//{*}coordinates"):
                if coords_el.text:
                    points = _parse_kml_coords(coords_el.text)
                    if len(points) == 1:
                        lon, lat = points[0]
                        waypoints.append((name or f"路点{len(waypoints)+1}", lon, lat))
                    elif len(points) > 1:
                        # LineString: sample down to ~20 points, preserve placemark name as prefix.
                        step = max(1, len(points) // 20)
                        sampled = points[::step]
                        for i, (lon, lat) in enumerate(sampled):
                            label = f"{name}-{i+1}" if name else f"路点{len(waypoints)+1}"
                            waypoints.append((label, lon, lat))

    if not waypoints:
        raise HTTPException(
            status_code=400,
            detail="No waypoints found. The file may be empty, use an unsupported format, "
                   "or contain only metadata without coordinates.",
        )

    # Apply WGS-84 → GCJ-02 conversion (skipped automatically for overseas coords).
    converted = [(name, *wgs84_to_gcj02(lon, lat)) for name, lon, lat in waypoints]

    created = []
    with Session(engine) as session:
        existing_count = len(session.exec(select(Stop).where(Stop.route_id == route_id)).all())
        for idx, (name, lon, lat) in enumerate(converted):
            stop = Stop(route_id=route_id, city_name=name, longitude=lon, latitude=lat, order=existing_count + idx)
            session.add(stop)
            session.flush()
            created.append(StopRead(**stop.model_dump(), photos=[]))
        session.commit()

    return created


# ── Branding assets (runtime-configurable images on volume) ──────────────────

app.mount("/branding", StaticFiles(directory=BRANDING_DIR), name="branding")


# ── Frontend static files (production) ────────────────────────────────────────

if FRONTEND_DIST.exists():
    assets_dir = FRONTEND_DIST / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        requested = (FRONTEND_DIST / full_path).resolve()
        dist_root = FRONTEND_DIST.resolve()
        if requested.exists() and requested.is_file() and str(requested).startswith(str(dist_root)):
            return FileResponse(requested)
        return FileResponse(FRONTEND_DIST / "index.html")
