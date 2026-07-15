import io
import subprocess
import tempfile
import zipfile
from math import ceil
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
                if zoom.get("enabled") and zoom.get("rect"):
                    set_export_zoom_progress(page, 1)
                else:
                    page.wait_for_timeout(150)
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
        timeline, exact_duration = render_video_timeline(snapshot, token, directory)
        target_file = directory / "result.mp4"
        command = [
            "ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(timeline),
            "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
            "-tune", "stillimage",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-t", f"{exact_duration:.6f}", "-movflags", "+faststart", str(target_file),
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


def set_export_zoom_progress(page, progress: float) -> None:
    page.wait_for_function("() => typeof window.__DOCFLOW_SET_ZOOM_PROGRESS__ === 'function'", timeout=10_000)
    page.evaluate(
        "async progress => { await window.__DOCFLOW_SET_ZOOM_PROGRESS__(progress); }",
        max(0.0, min(1.0, progress)),
    )


def smootherstep(progress: float) -> float:
    """A gentle acceleration/deceleration curve for deterministic Zoom frames."""
    value = max(0.0, min(1.0, progress))
    return value * value * value * (value * (value * 6 - 15) + 10)


def save_video_frame(content: bytes, path: Path, size: tuple[int, int]) -> None:
    """Normalize browser stage screenshots without upscaling or recompression."""
    source = Image.open(io.BytesIO(content)).convert("RGB")
    width, height = size
    ratio = min(1.0, width / source.width, height / source.height)
    if ratio < 1:
        source = source.resize(
            (max(1, int(source.width * ratio)), max(1, int(source.height * ratio))),
            Image.Resampling.LANCZOS,
        )
    canvas = Image.new("RGB", size, "#111827")
    canvas.paste(source, ((width - source.width) // 2, (height - source.height) // 2))
    canvas.save(path, "PNG", compress_level=2)


def render_video_timeline(snapshot: dict, token: str, directory: Path) -> tuple[Path, float]:
    """Render exact high-resolution PNG frames and a duration-accurate timeline.

    Unlike Chromium's built-in WebM recorder, this keeps captured page pixels,
    fonts, hotspot and tooltip styling intact. Zoom is driven frame-by-frame so
    browser scheduling cannot shorten transitions or per-step dwell time.
    """
    try:
        from playwright.sync_api import sync_playwright

        viewport = export_viewport(snapshot["steps"][0], 1920, 1080)
        size = (viewport["width"], viewport["height"])
        playback = snapshot.get("playback") or {}
        step_delay_ms = max(0, min(30_000, int(playback.get("transition_delay_ms", 1000))))
        entries: list[tuple[Path, float]] = []
        frame_number = 0
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=settings.chromium_executable,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            page = browser.new_page(viewport=viewport, device_scale_factor=1)
            for index, step in enumerate(snapshot["steps"]):
                url = f"{settings.render_web_url.rstrip('/')}/p/{token}?api=/backend&export=1&step={index}"
                page.goto(url, wait_until="networkidle", timeout=60_000)
                page.wait_for_selector(
                    f'main[data-export-ready="true"][data-step-index="{index}"]', timeout=30_000
                )
                zoom = (step.get("animation") or {}).get("zoom") or {}
                zoom_enabled = bool(zoom.get("enabled") and zoom.get("rect"))
                transition_ms = max(0, min(5000, int(zoom.get("transition_duration_ms", 1200)))) if zoom_enabled else 0
                transition_frames = max(1, ceil(transition_ms / 1000 * 20) + 1) if transition_ms else 1
                transition_frame_duration = transition_ms / 1000 / max(1, transition_frames - 1)

                for transition_index in range(transition_frames):
                    progress = transition_index / max(1, transition_frames - 1) if zoom_enabled else 0
                    set_export_zoom_progress(page, smootherstep(progress))
                    content = page.locator("main.export-mode .slide-stage").screenshot(type="png")
                    frame_path = directory / f"frame-{frame_number:06d}.png"
                    save_video_frame(content, frame_path, size)
                    frame_number += 1
                    if transition_index < transition_frames - 1:
                        entries.append((frame_path, transition_frame_duration))
                    else:
                        step_hold_ms = int(max(1, min(15, float(step.get("duration", 3)))) * 1000)
                        zoom_hold_ms = max(500, min(10_000, int(zoom.get("duration_ms", 3000)))) if zoom_enabled else 0
                        hold_ms = max(step_hold_ms, zoom_hold_ms)
                        if index < len(snapshot["steps"]) - 1:
                            hold_ms += step_delay_ms
                        entries.append((frame_path, hold_ms / 1000))
            browser.close()

        if not entries:
            raise RuntimeError("video timeline contains no frames")
        timeline = directory / "timeline.txt"
        lines: list[str] = []
        for path, duration in entries:
            lines.extend([f"file '{path.as_posix()}'", f"duration {max(1 / 30, duration):.6f}"])
        # concat demuxer applies the final duration only when another file
        # follows it; repeat the last frame without adding extra duration.
        lines.append(f"file '{entries[-1][0].as_posix()}'")
        timeline.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return timeline, sum(duration for _, duration in entries)
    except Exception as exc:
        raise RuntimeError(f"high-resolution player frame rendering failed: {exc}") from exc
