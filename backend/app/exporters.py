import io
import subprocess
import tempfile
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app.config import settings
from app.storage import storage

FONT_PATHS = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def font(size: int):
    for path in FONT_PATHS:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def contain(source: Image.Image, width: int, height: int) -> tuple[Image.Image, int, int]:
    ratio = min(width / source.width, height / source.height)
    resized = source.resize((max(1, int(source.width * ratio)), max(1, int(source.height * ratio))), Image.Resampling.LANCZOS)
    return resized, (width - resized.width) // 2, (height - resized.height) // 2


def wrap_text(draw: ImageDraw.ImageDraw, text: str, text_font, max_width: int) -> list[str]:
    lines: list[str] = []
    for paragraph in (text or "").splitlines() or [""]:
        line = ""
        for character in paragraph:
            candidate = line + character
            if line and draw.textbbox((0, 0), candidate, font=text_font)[2] > max_width:
                lines.append(line)
                line = character
            else:
                line = candidate
        lines.append(line)
    return lines


def slide(step: dict, index: int, size=(1920, 1080), pointer: tuple[float, float] | None = None) -> Image.Image:
    canvas = Image.new("RGB", size, "#111827")
    draw = ImageDraw.Draw(canvas)
    source = Image.open(io.BytesIO(storage.read(step["asset_key"]))).convert("RGB")
    fitted, x, y = contain(source, size[0], size[1] - 170)
    canvas.paste(fitted, (x, y))
    hotspot = step.get("hotspot", {})
    px = x + float(hotspot.get("x", 0.5)) * fitted.width
    py = y + float(hotspot.get("y", 0.5)) * fitted.height
    if pointer:
        px, py = pointer
    draw.ellipse((px - 18, py - 18, px + 18, py + 18), fill="#ef4444", outline="white", width=5)
    draw.rectangle((0, size[1] - 170, size[0], size[1]), fill="#111827")
    draw.text((52, size[1] - 148), f"{index}. {step.get('title') or f'步骤 {index}'}", font=font(42), fill="white")
    lines = wrap_text(draw, step.get("body", ""), font(27), size[0] - 104)[:2]
    draw.multiline_text((52, size[1] - 88), "\n".join(lines), font=font(27), fill="#d1d5db", spacing=6)
    return canvas


def render_pdf(snapshot: dict) -> bytes:
    pages = [slide(step, index, size=(1600, 1131)) for index, step in enumerate(snapshot["steps"], 1)]
    output = io.BytesIO()
    pages[0].save(output, "PDF", save_all=True, append_images=pages[1:], resolution=144, quality=90)
    return output.getvalue()


def markdown_text(snapshot: dict, base_url: str, token: str | None = None, local: bool = False) -> str:
    lines = [f"# {snapshot['title']}", ""]
    if snapshot.get("description"):
        lines += [snapshot["description"], ""]
    for index, step in enumerate(snapshot["steps"], 1):
        image = f"images/{index:03d}.webp" if local else f"{base_url}/public/{token}/assets/{step['id']}.webp"
        title = step.get("title") or f"步骤 {index}"
        lines += [f"## {index}. {title}", "", step.get("body", ""), "", f"![{title}]({image})", ""]
    return "\n".join(lines)


def render_markdown_zip(snapshot: dict) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("README.md", markdown_text(snapshot, settings.public_base_url, local=True))
        for index, step in enumerate(snapshot["steps"], 1):
            archive.writestr(f"images/{index:03d}.webp", storage.read(step["asset_key"]))
    return output.getvalue()


def render_mp4(snapshot: dict) -> bytes:
    with tempfile.TemporaryDirectory(prefix="docflow-") as temp:
        directory = Path(temp)
        manifest_lines: list[str] = []
        previous = (960.0, 450.0)
        frame_number = 0
        for index, step in enumerate(snapshot["steps"], 1):
            target = (float(step.get("hotspot", {}).get("x", 0.5)) * 1920, float(step.get("hotspot", {}).get("y", 0.5)) * 910)
            for part in range(6):
                progress = (part + 1) / 6
                pointer = (previous[0] + (target[0] - previous[0]) * progress, previous[1] + (target[1] - previous[1]) * progress)
                path = directory / f"frame-{frame_number:05d}.jpg"
                slide(step, index, pointer=pointer).save(path, "JPEG", quality=92)
                manifest_lines += [f"file '{path.as_posix()}'", "duration 0.08"]
                frame_number += 1
            hold = directory / f"frame-{frame_number:05d}.jpg"
            slide(step, index).save(hold, "JPEG", quality=92)
            manifest_lines += [f"file '{hold.as_posix()}'", f"duration {max(1, min(15, float(step.get('duration', 3))))}"]
            frame_number += 1
            previous = target
        manifest_lines.append(manifest_lines[-2])
        manifest = directory / "frames.txt"
        manifest.write_text("\n".join(manifest_lines), encoding="utf-8")
        target_file = directory / "result.mp4"
        command = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(manifest), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-movflags", "+faststart", str(target_file)]
        result = subprocess.run(command, capture_output=True, timeout=900)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode(errors="replace")[-2000:])
        return target_file.read_bytes()
