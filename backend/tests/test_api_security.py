"""鉴权、大小限制、导出并发锁——2026-07-09 安全修复的回归测试。"""
import io
import os
import time

import main


def test_mutating_endpoints_require_token(client):
    assert client.post("/api/routes", json={"name": "x", "color": "#111111"}).status_code == 403
    assert client.post(
        "/api/leg-paths", json={"stop_a_id": 1, "stop_b_id": 2, "path": [[1, 2], [3, 4]]},
    ).status_code == 403
    assert client.post("/api/export-images/start", json={"include": ["overview-portrait"]}).status_code == 403


def test_wrong_token_rejected(client):
    resp = client.post(
        "/api/routes", json={"name": "x", "color": "#111111"},
        headers={"X-Edit-Token": "wrong-token"},
    )
    assert resp.status_code == 403


def test_read_endpoints_stay_public(client):
    assert client.get("/api/routes").status_code == 200
    assert client.get("/api/config").status_code == 200


def test_photo_upload_and_delete(client, auth, make_route, tmp_path):
    _, (s1, _) = make_route(stops=2)
    resp = client.post(
        f"/api/stops/{s1}/photos",
        files={"file": ("p.png", io.BytesIO(b"\x89PNG fake"), "image/png")},
        headers=auth,
    )
    assert resp.status_code == 200
    photo_id = resp.json()["id"]
    stored = main.UPLOAD_DIR / resp.json()["file_path"]
    assert stored.exists()
    client.delete(f"/api/photos/{photo_id}", headers=auth)
    assert not stored.exists()


def test_photo_over_file_cap_returns_413(client, auth, make_route, monkeypatch):
    _, (s1, _) = make_route(stops=2)
    monkeypatch.setattr(main, "_MAX_UPLOAD_BYTES", 10)
    resp = client.post(
        f"/api/stops/{s1}/photos",
        files={"file": ("p.png", io.BytesIO(b"x" * 100), "image/png")},
        headers=auth,
    )
    assert resp.status_code == 413


def test_request_body_cap_middleware(client, auth, monkeypatch):
    monkeypatch.setattr(main, "_MAX_REQUEST_BYTES", 50)
    resp = client.post(
        "/api/stops/1/photos",
        files={"file": ("p.png", io.BytesIO(b"x" * 5000), "image/png")},
        headers=auth,
    )
    assert resp.status_code == 413


def test_export_start_rejects_concurrent_job(client, auth, monkeypatch):
    # 不真跑 Playwright：把任务函数换成 no-op，任务停留在 queued
    monkeypatch.setattr(main, "_run_export_job", lambda *a, **k: None)
    first = client.post(
        "/api/export-images/start", json={"include": ["overview-portrait"]}, headers=auth,
    )
    assert first.status_code == 200
    second = client.post(
        "/api/export-images/start", json={"include": ["overview-portrait"]}, headers=auth,
    )
    assert second.status_code == 409
    assert "已有导出任务" in second.json()["detail"]


def test_export_stale_running_job_does_not_block(client, auth, monkeypatch):
    monkeypatch.setattr(main, "_run_export_job", lambda *a, **k: None)
    # 伪造一个卡了 3 小时的 running 任务，不应阻塞新任务
    main.export_jobs["stale"] = {
        "id": "stale", "status": "running",
        "created_ts": time.time() - 3 * 60 * 60,
    }
    resp = client.post(
        "/api/export-images/start", json={"include": ["overview-portrait"]}, headers=auth,
    )
    assert resp.status_code == 200


def test_export_completed_job_does_not_block(client, auth, monkeypatch):
    monkeypatch.setattr(main, "_run_export_job", lambda *a, **k: None)
    main.export_jobs["done"] = {
        "id": "done", "status": "completed", "created_ts": time.time(),
    }
    resp = client.post(
        "/api/export-images/start", json={"include": ["overview-portrait"]}, headers=auth,
    )
    assert resp.status_code == 200


def test_export_start_removes_stale_dirs_keeps_fresh(client, auth, monkeypatch):
    # 失败/未下载任务留下的旧目录应在下次启动时被清掉；新目录不动
    monkeypatch.setattr(main, "_run_export_job", lambda *a, **k: None)
    old_dir = main.EXPORT_OUT_DIR / "old-job"
    fresh_dir = main.EXPORT_OUT_DIR / "fresh-job"
    old_dir.mkdir(parents=True, exist_ok=True)
    fresh_dir.mkdir(parents=True, exist_ok=True)
    (old_dir / "a.png").write_bytes(b"x")
    stale = time.time() - 25 * 60 * 60
    os.utime(old_dir, (stale, stale))

    resp = client.post(
        "/api/export-images/start", json={"include": ["overview-portrait"]}, headers=auth,
    )
    assert resp.status_code == 200
    assert not old_dir.exists()
    assert fresh_dir.exists()
