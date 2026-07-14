import io
import zipfile
from PIL import Image

from app.exporters import markdown_text, render_markdown_zip, render_pdf
from app.storage import storage


def snapshot():
    output = io.BytesIO()
    Image.new("RGB", (800, 450), "white").save(output, "WEBP")
    storage.write("assets/tests/step.webp", output.getvalue())
    return {
        "title": "测试流程",
        "description": "操作说明",
        "steps": [{"id": "step-1", "title": "第一步", "body": "点击按钮", "asset_key": "assets/tests/step.webp", "hotspot": {"x": .5, "y": .5}, "duration": 1}],
    }


def test_markdown_variants():
    value = snapshot()
    assert "https://docs.test/public/token/assets/step-1.webp" in markdown_text(value, "https://docs.test", "token")
    archive = zipfile.ZipFile(io.BytesIO(render_markdown_zip(value)))
    assert set(archive.namelist()) == {"README.md", "images/001.webp"}
    assert "images/001.webp" in archive.read("README.md").decode()


def test_pdf_has_one_page():
    data = render_pdf(snapshot())
    assert data.startswith(b"%PDF")
    assert len(data) > 1000
