"""GPX / KML 导入端点：格式兼容、轨迹抽样、坐标转换、错误响应。"""
import io

import main


def _upload(client, auth, route_id, content: str, filename="track.gpx"):
    return client.post(
        f"/api/routes/{route_id}/import-gpx",
        files={"file": (filename, io.BytesIO(content.encode("utf-8")), "application/xml")},
        headers=auth,
    )


GPX_WPT = """<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="36.65" lon="117.12"><name>济南</name></wpt>
  <wpt lat="39.90" lon="116.40"><name>北京</name></wpt>
</gpx>"""


def test_gpx_waypoints_with_gcj02_conversion(client, auth, make_route):
    route_id, _ = make_route(stops=0)
    resp = _upload(client, auth, route_id, GPX_WPT)
    assert resp.status_code == 200
    stops = resp.json()
    assert [s["city_name"] for s in stops] == ["济南", "北京"]
    # 中国坐标必须做过 GCJ-02 转换（与直接调用转换函数一致），不能原样入库
    expected = main.wgs84_to_gcj02(117.12, 36.65)
    assert abs(stops[0]["longitude"] - expected[0]) < 1e-9
    assert abs(stops[0]["latitude"] - expected[1]) < 1e-9
    assert stops[0]["longitude"] != 117.12


def test_gpx_10_without_namespace(client, auth, make_route):
    route_id, _ = make_route(stops=0)
    gpx = '<gpx version="1.0"><wpt lat="36.65" lon="117.12"><name>A</name></wpt></gpx>'
    resp = _upload(client, auth, route_id, gpx)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_gpx_trkpt_sampled_to_about_20(client, auth, make_route):
    route_id, _ = make_route(stops=0)
    pts = "".join(
        f'<trkpt lat="{30 + i * 0.01}" lon="{110 + i * 0.01}"></trkpt>' for i in range(45)
    )
    gpx = f'<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg>{pts}</trkseg></trk></gpx>'
    resp = _upload(client, auth, route_id, gpx)
    assert resp.status_code == 200
    # step = max(1, 45 // 20) = 2 → 23 个抽样点
    assert len(resp.json()) == 23


def test_kml_point_placemark(client, auth, make_route):
    route_id, _ = make_route(stops=0)
    kml = """<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>上海</name><Point><coordinates>121.47,31.23,0</coordinates></Point></Placemark>
</Document></kml>"""
    resp = _upload(client, auth, route_id, kml, filename="trip.kml")
    assert resp.status_code == 200
    stops = resp.json()
    assert len(stops) == 1
    assert stops[0]["city_name"] == "上海"


def test_kml_linestring_sampled_with_name_prefix(client, auth, make_route):
    route_id, _ = make_route(stops=0)
    coords = " ".join(f"{110 + i * 0.01},{30 + i * 0.01},0" for i in range(50))
    kml = f"""<kml xmlns="http://www.opengis.net/kml/2.2"><Document>
  <Placemark><name>路线</name><LineString><coordinates>{coords}</coordinates></LineString></Placemark>
</Document></kml>"""
    resp = _upload(client, auth, route_id, kml, filename="trip.kml")
    assert resp.status_code == 200
    stops = resp.json()
    assert len(stops) == 25  # step = 50 // 20 = 2
    assert stops[0]["city_name"] == "路线-1"


def test_overseas_coords_not_converted(client, auth, make_route):
    route_id, _ = make_route(stops=0)
    gpx = '<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="35.6895" lon="139.6917"><name>东京</name></wpt></gpx>'
    resp = _upload(client, auth, route_id, gpx)
    stop = resp.json()[0]
    assert stop["longitude"] == 139.6917
    assert stop["latitude"] == 35.6895


def test_invalid_xml_returns_400(client, auth, make_route):
    route_id, _ = make_route(stops=0)
    resp = _upload(client, auth, route_id, "this is not xml <<<")
    assert resp.status_code == 400
    assert "Invalid XML" in resp.json()["detail"]


def test_no_waypoints_returns_400(client, auth, make_route):
    route_id, _ = make_route(stops=0)
    kml = '<kml xmlns="http://www.opengis.net/kml/2.2"><Document></Document></kml>'
    resp = _upload(client, auth, route_id, kml, filename="empty.kml")
    assert resp.status_code == 400
    assert "No waypoints" in resp.json()["detail"]


def test_oversize_import_returns_413(client, auth, make_route, monkeypatch):
    route_id, _ = make_route(stops=0)
    monkeypatch.setattr(main, "_MAX_IMPORT_BYTES", 100)
    resp = _upload(client, auth, route_id, "x" * 200)
    assert resp.status_code == 413
