import io
import zipfile

from PIL import Image

from app import exporters


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
