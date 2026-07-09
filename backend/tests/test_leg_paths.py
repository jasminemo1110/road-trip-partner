"""leg_path 缓存：无向归一化存储、失效时机。

存储约定：始终按 stop_a_id < stop_b_id 存，行进方向相反时路径反转。
这是地图画线正确性的根基，坏了不容易肉眼发现。
"""
from sqlmodel import Session, select

import main
from models import LegPath

P1, P2 = [117.0, 36.0], [118.0, 37.0]


def test_reverse_direction_normalized(client, auth, make_route):
    route_id, (s1, s2) = make_route(stops=2)
    assert s1 < s2
    # 按 s2 → s1（大 id 在前）提交，应归一化为 (s1, s2) 且路径反转
    resp = client.post(
        "/api/leg-paths",
        json={"stop_a_id": s2, "stop_b_id": s1, "path": [P2, P1]},
        headers=auth,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["stop_a_id"] == s1 and body["stop_b_id"] == s2
    assert body["path"] == [P1, P2]

    legs = client.get(f"/api/routes/{route_id}/leg-paths").json()
    assert len(legs) == 1
    assert legs[0]["stop_a_id"] == s1
    assert legs[0]["path"] == [P1, P2]


def test_forward_direction_kept(client, auth, make_route):
    route_id, (s1, s2) = make_route(stops=2)
    client.post(
        "/api/leg-paths",
        json={"stop_a_id": s1, "stop_b_id": s2, "path": [P1, P2]},
        headers=auth,
    )
    legs = client.get(f"/api/routes/{route_id}/leg-paths").json()
    assert legs[0]["path"] == [P1, P2]


def test_save_twice_overwrites_not_duplicates(client, auth, make_route):
    route_id, (s1, s2) = make_route(stops=2)
    client.post("/api/leg-paths", json={"stop_a_id": s1, "stop_b_id": s2, "path": [P1, P2]}, headers=auth)
    new_path = [P1, [117.5, 36.5], P2]
    client.post("/api/leg-paths", json={"stop_a_id": s1, "stop_b_id": s2, "path": new_path}, headers=auth)
    legs = client.get(f"/api/routes/{route_id}/leg-paths").json()
    assert len(legs) == 1
    assert legs[0]["path"] == new_path


def test_stop_coord_change_invalidates_cache(client, auth, make_route):
    route_id, (s1, s2) = make_route(stops=2)
    client.post("/api/leg-paths", json={"stop_a_id": s1, "stop_b_id": s2, "path": [P1, P2]}, headers=auth)
    client.put(
        f"/api/stops/{s1}",
        json={"city_name": "城市0", "longitude": 120.0, "latitude": 40.0, "order": 0},
        headers=auth,
    )
    assert client.get(f"/api/routes/{route_id}/leg-paths").json() == []


def test_stop_text_change_keeps_cache(client, auth, make_route):
    # 只改名不改坐标，路网路径仍然有效，不应重算
    route_id, (s1, s2) = make_route(stops=2)
    client.post("/api/leg-paths", json={"stop_a_id": s1, "stop_b_id": s2, "path": [P1, P2]}, headers=auth)
    client.put(
        f"/api/stops/{s1}",
        json={"city_name": "改名了", "longitude": 117.0, "latitude": 36.0, "order": 0},
        headers=auth,
    )
    assert len(client.get(f"/api/routes/{route_id}/leg-paths").json()) == 1


def test_delete_route_removes_leg_rows(client, auth, make_route):
    # 回归：delete_route 曾不清 leg 缓存，留孤儿行
    route_id, (s1, s2) = make_route(stops=2)
    client.post("/api/leg-paths", json={"stop_a_id": s1, "stop_b_id": s2, "path": [P1, P2]}, headers=auth)
    client.delete(f"/api/routes/{route_id}", headers=auth)
    with Session(main.engine) as session:
        assert session.exec(select(LegPath)).all() == []
