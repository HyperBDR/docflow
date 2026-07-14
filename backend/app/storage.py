import io
import os
from pathlib import Path
from PIL import Image, ImageDraw

from app.config import settings


class Storage:
    def __init__(self, root: str):
        self.root = Path(root).resolve()
        (self.root / "assets").mkdir(parents=True, exist_ok=True)
        (self.root / "exports").mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if self.root not in path.parents:
            raise ValueError("invalid storage key")
        return path

    def write(self, key: str, data: bytes) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def read(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).exists()

    def absolute(self, key: str) -> str:
        return os.fspath(self._path(key))

    def save_screenshot(self, key: str, content: bytes) -> tuple[str, int, int]:
        image = Image.open(io.BytesIO(content)).convert("RGB")
        if image.width * image.height > 40_000_000:
            raise ValueError("image dimensions are too large")
        output = io.BytesIO()
        image.save(output, "WEBP", quality=90, method=4)
        final_key = f"{key}.webp"
        self.write(final_key, output.getvalue())
        return final_key, image.width, image.height

    def rendered_asset(self, source_key: str, redactions: list[dict], target_key: str) -> str:
        image = Image.open(io.BytesIO(self.read(source_key))).convert("RGB")
        draw = ImageDraw.Draw(image)
        for rect in redactions:
            x = int(float(rect.get("x", 0)) * image.width)
            y = int(float(rect.get("y", 0)) * image.height)
            w = int(float(rect.get("w", 0)) * image.width)
            h = int(float(rect.get("h", 0)) * image.height)
            draw.rectangle((x, y, x + w, y + h), fill=(35, 39, 47))
        out = io.BytesIO()
        image.save(out, "WEBP", quality=90, method=4)
        return self.write(target_key, out.getvalue())


storage = Storage(settings.storage_dir)

