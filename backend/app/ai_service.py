import base64
import io
import json
import re
import traceback
from typing import Any

import httpx
from PIL import Image, ImageDraw

from app.config import settings
from app.database import SessionLocal
from app.models import AIJob, Demo, Hotspot, JobStatus, Step
from app.storage import storage


class AIProviderError(RuntimeError):
    pass


def _json_from_content(content: Any) -> dict:
    if isinstance(content, list):
        content = "".join(str(item.get("text", "")) if isinstance(item, dict) else str(item) for item in content)
    text = str(content).strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I)
    try:
        value = json.loads(text)
    except json.JSONDecodeError as exc:
        raise AIProviderError("AI returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise AIProviderError("AI response must be a JSON object")
    return value


def chat_json(messages: list[dict]) -> dict:
    endpoint = f"{settings.ai_base_url.rstrip('/')}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.ai_api_key}", "Content-Type": "application/json"}
    payload = {"model": settings.ai_model, "messages": messages, "temperature": 0.2, "response_format": {"type": "json_object"}}
    with httpx.Client(timeout=settings.ai_timeout_seconds) as client:
        response = client.post(endpoint, headers=headers, json=payload)
        if response.status_code >= 400 and "response_format" in response.text:
            payload.pop("response_format", None)
            response = client.post(endpoint, headers=headers, json=payload)
    if response.status_code >= 400:
        raise AIProviderError(f"AI provider returned {response.status_code}: {response.text[:500]}")
    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AIProviderError("AI provider response has an incompatible shape") from exc
    return _json_from_content(content)


def redacted_thumbnail(step: Step) -> str | None:
    if not settings.ai_vision_enabled or not storage.exists(step.asset_key):
        return None
    image = Image.open(io.BytesIO(storage.read(step.asset_key))).convert("RGB")
    draw = ImageDraw.Draw(image)
    for rect in step.redactions or []:
        x = int(float(rect.get("x", 0)) * image.width)
        y = int(float(rect.get("y", 0)) * image.height)
        w = int(float(rect.get("w", 0)) * image.width)
        h = int(float(rect.get("h", 0)) * image.height)
        draw.rectangle((x, y, x + w, y + h), fill="#222731")
    image.thumbnail((768, 768), Image.Resampling.LANCZOS)
    output = io.BytesIO()
    image.save(output, "JPEG", quality=78, optimize=True)
    return f"data:image/jpeg;base64,{base64.b64encode(output.getvalue()).decode()}"


def step_context(step: Step) -> dict:
    context = step.page_context or {}
    hotspot = step.hotspots[0] if step.hotspots else None
    return {
        "id": step.id,
        "position": step.position,
        "current_title": step.title,
        "current_description": step.body,
        "page_title": str(context.get("page_title", ""))[:500],
        "url": str(context.get("url", ""))[:1000],
        "target_text": str(context.get("target_text", ""))[:1000],
        "target_role": str(context.get("target_role", ""))[:100],
        "target_aria": str(context.get("target_aria", ""))[:500],
        "nearby_text": str(context.get("nearby_text", ""))[:1500],
        "visible_text": str(context.get("visible_text", ""))[:4000],
        "manual_capture": bool(context.get("manual_capture", False)),
        "terminal": hotspot is None and not context.get("manual_capture", False),
    }


def outline_prompt(steps: list[Step]) -> list[dict]:
    compact = [{k: v for k, v in step_context(step).items() if k not in {"visible_text", "nearby_text"}} for step in steps]
    return [
        {"role": "system", "content": "你是企业软件操作文档编辑。根据按顺序排列的点击流程生成简洁、准确的中文演示标题和摘要。只输出 JSON。"},
        {"role": "user", "content": json.dumps({
            "task": "输出 {title, description}。标题不超过30字，摘要不超过120字，不编造页面不存在的功能。",
            "steps": compact,
        }, ensure_ascii=False)},
    ]


def chunk_prompt(chunk: list[Step], outline: dict) -> list[dict]:
    content: list[dict] = [{"type": "text", "text": json.dumps({
        "task": (
            "为每一步输出 title、body、tooltip、placement、warnings、redundant。"
            "title 是动作标题且不超过30字；body 是用户可直接执行的一句话；tooltip 不超过45字；"
            "placement 只能是 auto/top/bottom/left/right；warnings 是潜在敏感信息数组；"
            "redundant 表示该步骤是否疑似冗余。禁止输出密码、Token 或猜测内容。"
        ),
        "demo": outline,
        "steps": [step_context(step) for step in chunk],
        "output_schema": {"steps": [{"id": "step id", "title": "", "body": "", "tooltip": "", "placement": "auto", "warnings": [], "redundant": False}]},
    }, ensure_ascii=False)}]
    if settings.ai_vision_enabled:
        for step in chunk:
            image = redacted_thumbnail(step)
            if image:
                content.append({"type": "text", "text": f"步骤截图 id={step.id}"})
                content.append({"type": "image_url", "image_url": {"url": image, "detail": "low"}})
    return [
        {"role": "system", "content": "你是企业软件交互演示编辑器。结合流程上下文、目标元素和脱敏截图生成准确中文文案。只输出 JSON。"},
        {"role": "user", "content": content},
    ]


def _record_change(container: dict, inverse: dict, key: str, current: Any, new: Any) -> None:
    container[key] = new
    inverse[key] = current


def apply_results(db, job: AIJob, demo: Demo, outline: dict, generated: list[dict]) -> None:
    applied: dict = {"demo": {}, "steps": {}, "hotspots": {}}
    inverse: dict = {"demo": {}, "steps": {}, "hotspots": {}}
    if not job.step_id:
        if "title" not in (demo.manual_fields or []) and outline.get("title"):
            _record_change(applied["demo"], inverse["demo"], "title", demo.title, str(outline["title"])[:200])
            demo.title = applied["demo"]["title"]
        if "description" not in (demo.manual_fields or []) and outline.get("description"):
            _record_change(applied["demo"], inverse["demo"], "description", demo.description, str(outline["description"])[:5000])
            demo.description = applied["demo"]["description"]

    step_map = {step.id: step for step in demo.steps}
    for item in generated:
        step = step_map.get(str(item.get("id", "")))
        if not step:
            continue
        step_applied: dict = {}
        step_inverse: dict = {}
        for field, limit in [("title", 200), ("body", 5000)]:
            if field not in (step.manual_fields or []) and item.get(field):
                value = str(item[field])[:limit]
                _record_change(step_applied, step_inverse, field, getattr(step, field), value)
                setattr(step, field, value)
        step.ai_metadata = {
            **(step.ai_metadata or {}),
            "warnings": [str(value)[:500] for value in item.get("warnings", [])][:20],
            "redundant": bool(item.get("redundant", False)),
            "job_id": job.id,
        }
        if step_applied:
            applied["steps"][step.id] = step_applied
            inverse["steps"][step.id] = step_inverse
        if step.hotspots:
            hotspot = step.hotspots[0]
            if "tooltip" not in (hotspot.manual_fields or []):
                current = dict(hotspot.tooltip or {})
                updated = {**current}
                if item.get("tooltip"):
                    updated["content"] = str(item["tooltip"])[:5000]
                if item.get("placement") in {"auto", "top", "bottom", "left", "right"}:
                    updated["placement"] = item["placement"]
                if updated != current:
                    applied["hotspots"][hotspot.id] = {"tooltip": updated}
                    inverse["hotspots"][hotspot.id] = {"tooltip": current}
                    hotspot.tooltip = updated
    job.applied_patch = applied
    job.inverse_patch = inverse


def run_ai_generation(job_id: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(AIJob, job_id)
        if not job:
            return
        job.status = JobStatus.running
        job.progress = 5
        db.commit()
        demo = db.get(Demo, job.demo_id)
        if not demo:
            raise AIProviderError("demo no longer exists")
        steps = [step for step in sorted(demo.steps, key=lambda value: value.position) if not job.step_id or step.id == job.step_id]
        if not steps:
            raise AIProviderError("no steps available for generation")

        if job.step_id:
            outline = {"title": demo.title, "description": demo.description}
        else:
            outline = chat_json(outline_prompt(steps))
        job.progress = 20
        db.commit()

        generated: list[dict] = []
        chunk_size = max(1, min(12, settings.ai_chunk_size))
        for start in range(0, len(steps), chunk_size):
            chunk = steps[start:start + chunk_size]
            response = chat_json(chunk_prompt(chunk, outline))
            if isinstance(response.get("steps"), list):
                generated.extend(item for item in response["steps"] if isinstance(item, dict))
            job.progress = 20 + int(65 * min(len(steps), start + len(chunk)) / len(steps))
            db.commit()

        apply_results(db, job, demo, outline, generated)
        job.result = {"outline": outline, "steps": generated}
        job.status = JobStatus.complete
        job.progress = 100
        db.commit()
    except Exception as exc:
        db.rollback()
        job = db.get(AIJob, job_id)
        if job:
            job.status = JobStatus.failed
            job.error = f"{exc}\n{traceback.format_exc()[-1500:]}"
            db.commit()
        raise
    finally:
        db.close()
