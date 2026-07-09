"""测试环境准备。

必须在 import main 之前设好环境变量：main.py 在模块顶层就读取
DATA_DIR / EDIT_TOKEN 并建库，conftest 是 pytest 最先加载的文件，
所以在这里完成。数据库落在一次性临时目录，不碰真实数据。
"""
import os
import sys
import tempfile
from pathlib import Path

os.environ["EDIT_TOKEN"] = "test-edit-token"
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="travel-map-test-")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete

import main
import models

TOKEN = os.environ["EDIT_TOKEN"]


@pytest.fixture()
def client():
    return TestClient(main.app)


@pytest.fixture()
def auth():
    return {"X-Edit-Token": TOKEN}


@pytest.fixture(autouse=True)
def _isolate():
    """每个测试结束后清空所有表和导出任务，保证测试之间互不影响。"""
    yield
    with Session(main.engine) as session:
        for model in (models.Photo, models.LegPath, models.Stop, models.Route):
            session.exec(delete(model))
        session.commit()
    main.export_jobs.clear()


@pytest.fixture()
def make_route(client, auth):
    """建一条带 N 个站点的路线，返回 (route_id, [stop_id...])。"""
    def _make(stops=2):
        route = client.post(
            "/api/routes", json={"name": "测试路线", "color": "#4ECDC4"}, headers=auth,
        ).json()
        stop_ids = []
        for i in range(stops):
            stop = client.post(
                f"/api/routes/{route['id']}/stops",
                json={"city_name": f"城市{i}", "longitude": 117.0 + i, "latitude": 36.0 + i, "order": i},
                headers=auth,
            ).json()
            stop_ids.append(stop["id"])
        return route["id"], stop_ids
    return _make
