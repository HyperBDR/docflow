import io
import zipfile
from datetime import datetime, timezone

from PIL import Image

from app import exporters
from app.routers.exports import export_filename


def test_markdown_package_uses_interactive_player_frames(monkeypatch):
    frame = Image.new("RGB", (640, 360), "#635bff")
    monkeypatch.setattr(exporters, "render_player_images", lambda snapshot, token: [frame])
    snapshot = {
        "title": "交互演示",
        "description": "包含热点和引导样式",
        "steps": [{"id": "step-1", "title": "点击创建", "body": "点击创建按钮", "asset_key": "missing"}],
    }

    package = exporters.render_markdown_zip(snapshot, "share-token")
    with zipfile.ZipFile(io.BytesIO(package)) as archive:
        assert "![点击创建](images/001.webp)" in archive.read("README.md").decode()
        image = Image.open(io.BytesIO(archive.read("images/001.webp"))).convert("RGB")
        assert image.size == (640, 360)
        red, green, blue = image.getpixel((320, 180))
        assert blue > red and blue > green


def test_export_filename_contains_title_and_timestamp():
    fallback, encoded = export_filename("销售/数据 看板", datetime(2026, 7, 15, 9, 8, 7, tzinfo=timezone.utc), "mp4")
    assert fallback == "DocFlow-export-20260715-090807.mp4"
    assert encoded == "DocFlow-%E9%94%80%E5%94%AE-%E6%95%B0%E6%8D%AE%20%E7%9C%8B%E6%9D%BF-20260715-090807.mp4"


def test_smootherstep_is_soft_and_bounded():
    assert exporters.smootherstep(-1) == 0
    assert exporters.smootherstep(0) == 0
    assert exporters.smootherstep(1) == 1
    assert exporters.smootherstep(2) == 1
    assert exporters.smootherstep(.1) < .1
    assert exporters.smootherstep(.9) > .9
