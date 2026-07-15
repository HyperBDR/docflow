import io
import json
import os
import shutil
import subprocess
import tempfile
import time
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
    pages = render_player_images(snapshot, None) or [slide(step, index, size=(1600, 1131)) for index, step in enumerate(snapshot["steps"], 1)]
    output = io.BytesIO()
    pages[0].save(output, "PDF", save_all=True, append_images=pages[1:], resolution=144, quality=90)
    return output.getvalue()


def render_player_images(snapshot: dict, token: str | None) -> list[Image.Image] | None:
    if not token:
        return None
    try:
        from playwright.sync_api import sync_playwright

        pages: list[Image.Image] = []
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=settings.chromium_executable,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            page = browser.new_page(viewport={"width": 1920, "height": 1080}, device_scale_factor=1)
            for index, step in enumerate(snapshot["steps"]):
                page.set_viewport_size(export_viewport(step, 3840, 2160))
                url = f"{settings.render_web_url.rstrip('/')}/p/{token}?api=/backend&export=1&step={index}"
                page.goto(url, wait_until="networkidle", timeout=60_000)
                page.wait_for_selector('main[data-export-ready="true"]', timeout=30_000)
                zoom = (step.get("animation") or {}).get("zoom") or {}
                page.wait_for_timeout(700 if zoom.get("enabled") and zoom.get("rect") else 150)
                # PNG preserves the captured page's exact text and UI colors.
                # Capturing the stage rather than the player shell excludes all
                # title, fullscreen and footer navigation chrome.
                content = page.locator("main.export-mode .slide-stage").screenshot(type="png")
                pages.append(Image.open(io.BytesIO(content)).convert("RGB"))
            browser.close()
        return pages
    except Exception as exc:
        raise RuntimeError(f"interactive player rendering failed: {exc}") from exc


def markdown_text(snapshot: dict, base_url: str, token: str | None = None, local: bool = False) -> str:
    lines = [f"# {snapshot['title']}", ""]
    if snapshot.get("description"):
        lines += [snapshot["description"], ""]
    for index, step in enumerate(snapshot["steps"], 1):
        image = f"images/{index:03d}.webp" if local else f"{base_url}/public/{token}/assets/{step['id']}.webp"
        title = step.get("title") or f"步骤 {index}"
        lines += [f"## {index}. {title}", "", step.get("body", ""), "", f"![{title}]({image})", ""]
    return "\n".join(lines)


def render_markdown_zip(snapshot: dict, token: str | None = None) -> bytes:
    rendered = render_player_images(snapshot, token)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("README.md", markdown_text(snapshot, settings.public_base_url, local=True))
        for index, step in enumerate(snapshot["steps"], 1):
            if rendered:
                image = io.BytesIO()
                rendered[index - 1].save(image, "WEBP", quality=92, method=6)
                content = image.getvalue()
            else:
                content = storage.read(step["asset_key"])
            archive.writestr(f"images/{index:03d}.webp", content)
    return output.getvalue()


def render_mp4(snapshot: dict, token: str | None = None) -> bytes:
    if not token:
        raise RuntimeError("interactive player rendering requires an active share token")
    if not snapshot.get("steps"):
        raise RuntimeError("cannot render an empty demo")
    with tempfile.TemporaryDirectory(prefix="docflow-") as temp:
        directory = Path(temp)
        source_video = record_player_video(snapshot, token, directory)
        target_file = directory / "result.mp4"
        source_path, trim_start, duration = source_video
        command = [
            "ffmpeg", "-y", "-i", str(source_path), "-ss", f"{trim_start:.3f}", "-t", f"{duration:.3f}",
            "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-movflags", "+faststart", str(target_file),
        ]
        result = subprocess.run(command, capture_output=True, timeout=900)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.decode(errors="replace")[-2000:])
        return target_file.read_bytes()


def export_viewport(step: dict, max_width: int, max_height: int) -> dict[str, int]:
    width = max(320, int(step.get("viewport_width") or 1920))
    height = max(240, int(step.get("viewport_height") or 1080))
    ratio = min(1.0, max_width / width, max_height / height)
    # Video codecs require even dimensions; using even values is harmless for
    # browser screenshots and keeps one sizing rule across all export formats.
    return {"width": max(2, int(width * ratio) // 2 * 2), "height": max(2, int(height * ratio) // 2 * 2)}


def record_player_video(snapshot: dict, token: str, directory: Path) -> tuple[Path, float, float]:
    try:
        ensure_playwright_ffmpeg()
        from playwright.sync_api import sync_playwright

        viewport = export_viewport(snapshot["steps"][0], 1920, 1080)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=settings.chromium_executable,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = browser.new_context(
                viewport=viewport,
                device_scale_factor=1,
                record_video_dir=str(directory),
                record_video_size=viewport,
            )
            started_at = time.monotonic()
            page = context.new_page()
            video = page.video
            url = f"{settings.render_web_url.rstrip('/')}/p/{token}?api=/backend&export=1&step=0"
            page.goto(url, wait_until="networkidle", timeout=60_000)
            page.wait_for_selector('main[data-export-ready="true"][data-step-index="0"]', timeout=30_000)
            ready_at = time.monotonic()
            page.wait_for_timeout(150)
            for index, step in enumerate(snapshot["steps"]):
                if index:
                    page.keyboard.press("ArrowRight")
                    page.wait_for_selector(
                        f'main[data-export-ready="true"][data-step-index="{index}"]', timeout=30_000
                    )
                hold_ms = int(max(1, min(15, float(step.get("duration", 3)))) * 1000)
                page.wait_for_timeout(hold_ms)
            ended_at = time.monotonic()
            context.close()
            if video is None:
                raise RuntimeError("Chromium did not create an export video")
            source_path = Path(video.path())
            browser.close()
        trim_start = max(0.0, ready_at - started_at)
        duration = max(0.1, ended_at - ready_at)
        return source_path, trim_start, duration
    except Exception as exc:
        raise RuntimeError(f"interactive player video recording failed: {exc}") from exc


def ensure_playwright_ffmpeg() -> None:
    """Let Playwright recording reuse the distro FFmpeg already in the worker.

    Playwright otherwise expects a second downloaded media binary in its cache.
    Reading its bundled revision keeps this compatible with package upgrades and
    avoids another large, slow external download during image builds.
    """
    import playwright

    package = Path(playwright.__file__).parent / "driver" / "package"
    registry = json.loads((package / "browsers.json").read_text(encoding="utf-8"))
    revision = next(item["revision"] for item in registry["browsers"] if item["name"] == "ffmpeg")
    configured = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    base = package / ".local-browsers" if configured == "0" else Path(configured).expanduser() if configured else Path.home() / ".cache" / "ms-playwright"
    target = base / f"ffmpeg-{revision}" / "ffmpeg-linux"
    if target.exists():
        return
    system_ffmpeg = shutil.which("ffmpeg")
    if not system_ffmpeg:
        raise RuntimeError("system ffmpeg is not installed")
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.symlink_to(system_ffmpeg)
    except FileExistsError:
        pass
    if not target.exists():
        raise RuntimeError(f"could not prepare Playwright ffmpeg at {target}")
