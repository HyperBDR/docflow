import math

from app.models import Demo
from app.storage import storage


def estimate_ai_tokens_for_steps(step_count: int) -> int:
    return max(1_200, 1_600 + step_count * 900)


def estimate_ai_tokens(demo: Demo, step_id: str | None = None) -> int:
    """Reserve a conservative allowance until actual provider usage arrives."""
    return estimate_ai_tokens_for_steps(1 if step_id else max(1, len(demo.steps)))


def estimate_video_minutes(demo: Demo) -> int:
    return max(1, math.ceil(sum(float(step.duration or 0) for step in demo.steps) / 60))


def estimate_snapshot_video_minutes(snapshot: dict) -> int:
    return max(1, math.ceil(sum(float(step.get("duration", 3) or 0) for step in (snapshot or {}).get("steps", [])) / 60))


def estimate_export_bytes(demo: Demo, kind: str, asset_sizes: dict[str, int] | None = None) -> int:
    keys = [step.asset_key for step in demo.steps]
    sizes = asset_sizes if asset_sizes is not None and all(key in asset_sizes for key in keys) else storage.sizes(keys)
    source_bytes = sum(sizes.get(key, 0) for key in keys)
    if kind == "mp4":
        return max(source_bytes, estimate_video_minutes(demo) * 5 * 1024 * 1024)
    return max(1024 * 1024, source_bytes)


def estimate_snapshot_export_bytes(snapshot: dict, kind: str) -> int:
    keys = [step.get("asset_key") for step in (snapshot or {}).get("steps", []) if step.get("asset_key")]
    sizes = storage.sizes(keys)
    source_bytes = sum(sizes.values())
    if kind == "mp4":
        return max(source_bytes, estimate_snapshot_video_minutes(snapshot) * 5 * 1024 * 1024)
    return max(1024 * 1024, source_bytes)


def estimate_publish_bytes(demo: Demo, asset_sizes: dict[str, int] | None = None) -> int:
    keys = [step.asset_key for step in demo.steps]
    sizes = asset_sizes if asset_sizes is not None and all(key in asset_sizes for key in keys) else storage.sizes(keys)
    return max(1, sum(sizes.get(key, 0) for key in keys))
