import gzip
import hashlib
import io
import json
import math
import re
from copy import deepcopy
from urllib.parse import urlsplit, urlunsplit

from app.config import settings
from app.storage import storage

BLOCKED_TAGS = {"script", "iframe", "frame", "object", "embed", "applet", "base", "portal"}
INJECTED_TAGS = {"chatgpt-sidebar", "doubao-ai-csui"}
INJECTED_ID_PREFIXES = ("aix-", "doubao-ai-", "cici-", "sider-")
URL_ATTRIBUTES = {"src", "href", "xlink:href", "srcset", "poster", "action", "formaction"}
BLOCKED_ATTRIBUTES = {"srcdoc", "nonce", "integrity", "ping", "autofocus"}
CSS_IMPORT = re.compile(r"@import\s+[^;]+;?", re.I)
CSS_URL = re.compile(r"url\(\s*(['\"]?)(.*?)\1\s*\)", re.I)
CSS_EXPRESSION = re.compile(r"expression\s*\([^)]*\)", re.I)
SENSITIVE_TEXT = re.compile(
    r"(?i)(bearer\s+[a-z0-9._~+\-/]+=*|api[_-]?key\s*[:=]\s*\S+|"
    r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}|(?<!\d)1[3-9]\d{9}(?!\d))"
)


class SnapshotError(ValueError):
    pass


def injected_node(tag: str, attrs: dict) -> bool:
    element_id = str(attrs.get("id", "")).lower()
    classes = set(str(attrs.get("class", "")).split())
    return (
        tag in INJECTED_TAGS
        or tag.startswith("sider-")
        or "docflow-recorder-ui" in classes
        or "mamba-table-floating-scroll" in classes
        or element_id in {"host-style-container", "cici-inline-container"}
        or element_id.startswith(INJECTED_ID_PREFIXES)
    )


def safe_url(value: str, *, href: bool = False) -> str | None:
    clean = value.strip()
    lowered = clean.lower()
    if href and (clean.startswith("#") or lowered.startswith("mailto:")):
        return clean
    if lowered.startswith("data:image/") or lowered.startswith("data:font/") or lowered.startswith("data:application/font"):
        return clean
    return None


def sanitize_css(value: str) -> str:
    value = CSS_IMPORT.sub("", value)
    value = CSS_EXPRESSION.sub("", value)
    value = value.replace("javascript:", "")

    def replace_url(match: re.Match) -> str:
        target = match.group(2).strip()
        if target.startswith("data:image/") or target.startswith("data:font/") or target.startswith("data:application/font"):
            return f'url("{target}")'
        return "url(\"\")"

    return CSS_URL.sub(replace_url, value)


def sanitize_snapshot(payload: dict) -> tuple[dict, list[str]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("snapshot"), dict):
        raise SnapshotError("snapshot root is missing")
    result = deepcopy(payload)
    warnings: list[str] = []
    count = 0

    def visit(node: dict, parent_tag: str | None = None) -> dict | None:
        nonlocal count
        count += 1
        if count > 120_000:
            raise SnapshotError("snapshot contains too many DOM nodes")
        if not isinstance(node, dict):
            return None
        node_type = node.get("type")
        if node_type == 2:
            tag = str(node.get("tagName", "div")).lower()
            attrs = node.get("attributes") if isinstance(node.get("attributes"), dict) else {}
            # A valid document element contains only head/body elements. Browser
            # extensions often append their own hosts after body; rrweb rebuilds
            # those before body and a blocked full-screen host can push the real
            # application below the viewport.
            if parent_tag == "html" and tag not in {"head", "body"}:
                return None
            # Browser translation/assistant extensions sometimes inject an
            # invalid nested <body>. rrweb can move that node during rebuild
            # and displace the actual application, so only the document body
            # directly below <html> is retained.
            if tag == "body" and parent_tag != "html":
                return None
            if injected_node(tag, attrs):
                return None
            if tag in BLOCKED_TAGS or (tag == "meta" and str(attrs.get("http-equiv", "")).lower() == "refresh"):
                return None
            cleaned: dict[str, str] = {}
            for raw_name, raw_value in attrs.items():
                original_name = str(raw_name)
                name = original_name.lower()
                value = str(raw_value)
                if name.startswith("on") or name in BLOCKED_ATTRIBUTES:
                    continue
                if name in URL_ATTRIBUTES:
                    allowed = safe_url(value, href=name == "href")
                    if allowed is not None:
                        cleaned[original_name] = allowed
                    elif value:
                        has_inline_css = tag == "link" and bool(attrs.get("_cssText") or attrs.get("_csstext"))
                        has_inline_image = tag == "img" and bool(attrs.get("rr_dataURL") or attrs.get("rr_dataurl"))
                        relation = str(attrs.get("rel", "")).lower()
                        # Scripts, navigation links, icons/preloads, and the
                        # original URL of an already-inlined asset are expected
                        # to be removed in a static replay. Only report a real
                        # visual degradation that the recorder could not inline.
                        if tag == "link" and "stylesheet" in relation and not has_inline_css:
                            warnings.append("Stylesheet could not be embedded; preview may differ from the source page")
                        elif tag == "img" and name in {"src", "srcset"} and not has_inline_image:
                            warnings.append("Image could not be embedded; preview may differ from the source page")
                        elif tag == "use" and name == "xlink:href":
                            warnings.append("SVG icon resource could not be embedded; preview may omit some icons")
                    continue
                if name in {"style", "_csstext"}:
                    cleaned[original_name] = sanitize_css(value)
                elif name == "rr_dataurl":
                    allowed = safe_url(value)
                    if allowed is not None:
                        cleaned[original_name] = allowed
                elif name == "value" and tag == "input" and str(attrs.get("type", "")).lower() == "password":
                    cleaned[original_name] = ""
                else:
                    cleaned[original_name] = SENSITIVE_TEXT.sub("[REDACTED]", value)
            if tag == "form":
                cleaned.pop("action", None)
                cleaned["data-docflow-form"] = "disabled"
            node["attributes"] = cleaned
            parent_tag = tag
        elif node_type == 3:
            text = str(node.get("textContent", ""))
            node["textContent"] = sanitize_css(text) if node.get("isStyle") or parent_tag == "style" else SENSITIVE_TEXT.sub("[REDACTED]", text)

        children = node.get("childNodes")
        if isinstance(children, list):
            sanitized = []
            for child in children:
                safe = visit(child, parent_tag)
                if safe is not None:
                    sanitized.append(safe)
            node["childNodes"] = sanitized
        return node

    root = visit(result["snapshot"])
    if root is None:
        raise SnapshotError("snapshot root was removed")
    result["snapshot"] = root
    result["version"] = 1
    return result, list(dict.fromkeys(warnings))[:100]


def decode_snapshot(content: bytes) -> dict:
    compressed_limit = settings.snapshot_compressed_limit_mb * 1024 * 1024
    uncompressed_limit = settings.snapshot_uncompressed_limit_mb * 1024 * 1024
    if len(content) > compressed_limit:
        raise SnapshotError("compressed snapshot is too large")
    try:
        with gzip.GzipFile(fileobj=io.BytesIO(content)) as stream:
            raw = stream.read(uncompressed_limit + 1)
    except (OSError, EOFError) as exc:
        raise SnapshotError("snapshot is not valid gzip") from exc
    if len(raw) > uncompressed_limit:
        raise SnapshotError("snapshot expands beyond the size limit")
    try:
        parsed = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise SnapshotError("snapshot is not valid JSON") from exc
    return parsed


def store_snapshot(payload: dict) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
    digest = hashlib.sha256(encoded).hexdigest()
    key = f"assets/snapshots/{digest[:2]}/{digest}.json.gz"
    if not storage.exists(key):
        storage.write(key, gzip.compress(encoded, compresslevel=6))
    return key


def load_snapshot(key: str) -> dict:
    try:
        return json.loads(gzip.decompress(storage.read(key)))
    except (OSError, json.JSONDecodeError) as exc:
        raise SnapshotError("stored snapshot is corrupt") from exc


def sanitize_page_context(value: dict) -> dict:
    if not isinstance(value, dict):
        return {}
    result: dict = {}
    if value.get("manual_capture") is True:
        result["manual_capture"] = True
    if value.get("sensitive_form") is True:
        result["sensitive_form"] = True
    for key in ["page_title", "target_text", "target_role", "target_aria", "nearby_text", "visible_text"]:
        if key in value:
            limit = 6000 if key == "visible_text" else 1500
            result[key] = SENSITIVE_TEXT.sub("[REDACTED]", str(value[key]))[:limit]
    if value.get("url"):
        try:
            parts = urlsplit(str(value["url"]))
            result["url"] = urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))[:2000]
        except ValueError:
            pass
    regions = []
    for item in value.get("raster_regions", [])[:20] if isinstance(value.get("raster_regions"), list) else []:
        if not isinstance(item, dict):
            continue
        try:
            x, y, w, h = (float(item.get(key, 0)) for key in ("x", "y", "w", "h"))
        except (TypeError, ValueError):
            continue
        if not all(math.isfinite(number) for number in (x, y, w, h)) or w <= 0 or h <= 0:
            continue
        x, y = max(0.0, min(1.0, x)), max(0.0, min(1.0, y))
        w, h = min(1.0 - x, w), min(1.0 - y, h)
        if w > 0 and h > 0:
            regions.append({"x": x, "y": y, "w": w, "h": h, "kind": "iframe"})
    if regions:
        result["raster_regions"] = regions
    return result
