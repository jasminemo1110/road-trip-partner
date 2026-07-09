"""WGS-84 → GCJ-02 坐标转换的正确性。

参考值取自 eviltransform（各语言实现共用的标准测试向量），
容差 1e-4 度（约 11 米）——足以抓住符号错误、漏项、常数抄错。
"""
import main


def test_known_vector_shanghai():
    # eviltransform: wgs(31.1774276, 121.5272106) → gcj(31.1753039..., 121.5315418...)
    lng, lat = main.wgs84_to_gcj02(121.5272106, 31.1774276)
    assert abs(lng - 121.5315418) < 1e-4
    assert abs(lat - 31.1753039) < 1e-4


def test_offset_magnitude_reasonable_in_china():
    # 中国境内偏移通常 300-700 米（约 0.003-0.007 度），过大过小都说明公式坏了
    for wgs_lng, wgs_lat in [(116.40, 39.90), (104.07, 30.67), (91.11, 29.65)]:
        lng, lat = main.wgs84_to_gcj02(wgs_lng, wgs_lat)
        assert 0.001 < abs(lng - wgs_lng) < 0.02
        assert 0.0005 < abs(lat - wgs_lat) < 0.02


def test_out_of_china_passthrough():
    # 东京：境外坐标必须原样返回，否则海外行程全部错位
    assert main.wgs84_to_gcj02(139.6917, 35.6895) == (139.6917, 35.6895)
    # 边界外西侧
    assert main.wgs84_to_gcj02(70.0, 40.0) == (70.0, 40.0)


def test_deterministic():
    assert main.wgs84_to_gcj02(117.12, 36.65) == main.wgs84_to_gcj02(117.12, 36.65)


def test_disable_flag(monkeypatch):
    monkeypatch.setattr(main, "_DISABLE_GCJ02", True)
    assert main.wgs84_to_gcj02(116.40, 39.90) == (116.40, 39.90)
