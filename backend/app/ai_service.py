import base64
import io
import json
import re
import time
import traceback
import uuid
from typing import Any

import httpx
from PIL import Image, ImageDraw

from app.ai_models import active_model, ai_chunk_size
from app.database import SessionLocal
from app.models import AIJob, AIModelConfig, AIUsageRecord, Demo, Hotspot, JobStatus, Step, now
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


def _request_summary(messages: list[dict]) -> dict:
    roles, characters, images = [], 0, 0
    for message in messages:
        roles.append(str(message.get("role", "")))
        content = message.get("content", "")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "image_url": images += 1
                elif isinstance(item, dict): characters += len(str(item.get("text", "")))
        else:
            characters += len(str(content))
    return {"message_count": len(messages), "roles": roles, "characters": characters, "images": images}


def _save_usage(job: AIJob, model: AIModelConfig, *, request_id: str, operation: str, status: str,
                started: float, first_token_ms: int | None = None, usage: dict | None = None,
                request_detail: dict | None = None, response_detail: dict | None = None, error: str = "") -> None:
    usage = usage or {}
    input_tokens = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    db = SessionLocal()
    try:
        demo = db.get(Demo, job.demo_id)
        db.add(AIUsageRecord(
            request_id=request_id, model_config_id=model.id, model_name=model.model, provider=model.provider,
            job_id=job.id, user_id=job.owner_id, organization_id=demo.organization_id if demo else None,
            demo_id=job.demo_id, operation=operation, status=status, input_tokens=input_tokens,
            output_tokens=output_tokens, total_tokens=int(usage.get("total_tokens") or input_tokens + output_tokens),
            first_token_ms=first_token_ms, latency_ms=max(0, round((time.perf_counter() - started) * 1000)),
            request_detail=request_detail or {}, response_detail=response_detail or {}, error=error[:4000],
        ))
        db.commit()
    finally:
        db.close()


def _stream_completion(client: httpx.Client, endpoint: str, headers: dict, payload: dict) -> tuple[str, dict, dict, int | None, str]:
    started = time.perf_counter()
    content_parts: list[str] = []
    usage: dict = {}
    response_detail: dict = {}
    first_token_ms: int | None = None
    request_id = ""
    with client.stream("POST", endpoint, headers=headers, json={**payload, "stream": True, "stream_options": {"include_usage": True}}) as response:
        request_id = response.headers.get("x-request-id", "")
        if response.status_code >= 400:
            body = response.read().decode(errors="replace")
            raise AIProviderError(f"AI provider returned {response.status_code}: {body[:500]}")
        for line in response.iter_lines():
            if not line.startswith("data:"): continue
            data = line[5:].strip()
            if not data or data == "[DONE]": continue
            try: event = json.loads(data)
            except ValueError: continue
            request_id = request_id or str(event.get("id", ""))
            if isinstance(event.get("usage"), dict): usage = event["usage"]
            choices = event.get("choices") or []
            if choices:
                choice = choices[0]
                delta = choice.get("delta") or {}
                piece = delta.get("content")
                if piece:
                    if first_token_ms is None: first_token_ms = round((time.perf_counter() - started) * 1000)
                    content_parts.append(str(piece))
                if choice.get("finish_reason"): response_detail["finish_reason"] = choice["finish_reason"]
    if not content_parts:
        raise AIProviderError("stream_options returned no completion content")
    return "".join(content_parts), usage, response_detail, first_token_ms, request_id


def chat_json(messages: list[dict], model: AIModelConfig, job: AIJob, operation: str) -> dict:
    endpoint = f"{model.base_url.rstrip('/')}/chat/completions"
    headers = {"Content-Type": "application/json"}
    if model.api_key: headers["Authorization"] = f"Bearer {model.api_key}"
    payload = {"model": model.model, "messages": messages, "temperature": model.temperature,
               "response_format": {"type": "json_object"}, **(model.extra_options or {})}
    started = time.perf_counter()
    request_id = str(uuid.uuid4())
    detail = _request_summary(messages)
    try:
        with httpx.Client(timeout=model.timeout_seconds) as client:
            try:
                content, usage, response_detail, first_token_ms, upstream_id = _stream_completion(client, endpoint, headers, payload)
            except AIProviderError as exc:
                # Older compatible providers may reject JSON mode or streaming usage options.
                if "response_format" not in str(exc) and "stream_options" not in str(exc): raise
                fallback = {key: value for key, value in payload.items() if key != "response_format"}
                response = client.post(endpoint, headers=headers, json=fallback)
                if response.status_code >= 400:
                    raise AIProviderError(f"AI provider returned {response.status_code}: {response.text[:500]}")
                body = response.json()
                content = body["choices"][0]["message"]["content"]
                usage = body.get("usage") or {}
                response_detail = {"finish_reason": (body.get("choices") or [{}])[0].get("finish_reason")}
                first_token_ms = None  # A non-streaming provider cannot expose true first-token latency.
                upstream_id = str(body.get("id", ""))
        request_id = upstream_id or request_id
        value = _json_from_content(content)
        _save_usage(job, model, request_id=request_id, operation=operation, status="success", started=started,
                    first_token_ms=first_token_ms, usage=usage, request_detail=detail,
                    response_detail={**response_detail, "characters": len(str(content))})
        return value
    except Exception as exc:
        _save_usage(job, model, request_id=request_id, operation=operation, status="failed", started=started,
                    request_detail=detail, error=str(exc))
        raise


def redacted_thumbnail(step: Step, vision_enabled: bool = True) -> str | None:
    if not vision_enabled or not storage.exists(step.asset_key):
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
        "hotspots": [{
            "id": item.id, "position": item.position, "selector": item.selector or {},
            "trigger": item.trigger, "action": item.action or {}, "current_tooltip": item.tooltip or {},
        } for item in step.hotspots],
    }


def outline_prompt(steps: list[Step], locale: str = "zh-CN") -> list[dict]:
    compact = [{k: v for k, v in step_context(step).items() if k not in {"visible_text", "nearby_text"}} for step in steps]
    if locale == "en":
        system = "You are an enterprise software documentation editor. Generate a concise, accurate English demo title and summary from the ordered click flow. Return JSON only."
        task = "Return {title, description}. Keep the title under 60 characters and the summary under 240 characters. Do not invent functionality that is not present on the page."
    else:
        system = "你是企业软件操作文档编辑。根据按顺序排列的点击流程生成简洁、准确的中文演示标题和摘要。只输出 JSON。"
        task = "输出 {title, description}。标题不超过30字，摘要不超过120字，不编造页面不存在的功能。"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps({
            "task": task,
            "steps": compact,
        }, ensure_ascii=False)},
    ]


def chunk_prompt(chunk: list[Step], outline: dict, locale: str = "zh-CN", vision_enabled: bool = True) -> list[dict]:
    task = (
        "For every step return title, body, hotspots, warnings, and redundant. "
        "Use concise, natural English. title is an action heading under 60 characters; body is one directly actionable sentence; "
        "hotspots must contain one result for every supplied hotspot id, with tooltip under 90 characters and placement auto/top/bottom/left/right; warnings is an array of review messages about potential sensitive data; "
        "each warning must explain the risk and recommended review action without quoting raw IP addresses, account names, credentials, or page text; "
        "redundant indicates whether the step may be redundant. Never output passwords or tokens and never guess missing content."
    ) if locale == "en" else (
        "为每一步输出 title、body、hotspots、warnings、redundant。"
        "title 是动作标题且不超过30字；body 是用户可直接执行的一句话；tooltip 不超过45字；"
        "hotspots 必须为输入中的每个热点 id 返回 tooltip 和 placement，placement 只能是 auto/top/bottom/left/right；warnings 是潜在敏感信息审查提示数组；"
        "每条提示必须说明风险类型和建议检查动作，不能直接复制 IP 地址、账号名、凭据或页面原文；"
        "redundant 表示该步骤是否疑似冗余。禁止输出密码、Token 或猜测内容。"
    )
    content: list[dict] = [{"type": "text", "text": json.dumps({
        "task": task,
        "demo": outline,
        "steps": [step_context(step) for step in chunk],
        "output_schema": {"steps": [{"id": "step id", "title": "", "body": "", "hotspots": [{"id": "hotspot id", "tooltip": "", "placement": "auto"}], "warnings": [], "redundant": False}]},
    }, ensure_ascii=False)}]
    if vision_enabled:
        for step in chunk:
            image = redacted_thumbnail(step, vision_enabled)
            if image:
                content.append({"type": "text", "text": f"步骤截图 id={step.id}"})
                content.append({"type": "image_url", "image_url": {"url": image, "detail": "low"}})
    return [
        {"role": "system", "content": (
            "You are an enterprise software interactive-demo editor. Use the flow context, target element, and redacted screenshots to produce accurate English copy. Return JSON only."
            if locale == "en" else
            "你是企业软件交互演示编辑器。结合流程上下文、目标元素和脱敏截图生成准确中文文案。只输出 JSON。"
        )},
        {"role": "user", "content": content},
    ]


def _record_change(container: dict, inverse: dict, key: str, current: Any, new: Any) -> None:
    container[key] = new
    inverse[key] = current


def _normalized_warnings(values: Any, locale: str) -> list[str]:
    result: list[str] = []
    for value in values if isinstance(values, list) else []:
        text = str(value.get("message", "") if isinstance(value, dict) else value).strip()
        if not text:
            continue
        if re.search(r"\b(?:\d{1,3}\.){3}\d{1,3}\b", text):
            text = "Potential internal IP address detected. Confirm whether it should be redacted." if locale == "en" else "检测到可能的内部 IP 地址，请确认是否需要脱敏。"
        elif re.search(r"\b(?:admin|administrator|root)\b", text, re.I):
            text = "Potential account identifier detected. Confirm whether it should be redacted." if locale == "en" else "检测到可能的账号标识，请确认是否需要脱敏。"
        elif re.search(r"(?:password|passwd|token|secret|密码|口令|密钥)", text, re.I):
            text = "Potential credential information detected. Confirm that it is fully redacted." if locale == "en" else "检测到可能的凭据信息，请确认是否已完整脱敏。"
        result.append(text[:500])
    return list(dict.fromkeys(result))[:20]


def _comparison(before: Any, generated: Any, applied: bool) -> dict:
    return {"before": before if before is not None else "", "after": generated if generated is not None else "", "applied": applied}


def apply_results(db, job: AIJob, demo: Demo, outline: dict, generated: list[dict]) -> dict:
    applied: dict = {"demo": {}, "steps": {}, "hotspots": {}}
    inverse: dict = {"demo": {}, "steps": {}, "hotspots": {}}
    report: dict = {"demo": {"fields": {}}, "steps": []}
    if not job.step_id:
        for field in ["title", "description"]:
            generated_value = str(outline.get(field, ""))[:200 if field == "title" else 5000]
            can_apply = bool(generated_value) and field not in (demo.manual_fields or [])
            report["demo"]["fields"][field] = _comparison(getattr(demo, field), generated_value, can_apply)
        if report["demo"]["fields"]["title"]["applied"]:
            _record_change(applied["demo"], inverse["demo"], "title", demo.title, str(outline["title"])[:200])
            demo.title = applied["demo"]["title"]
        if report["demo"]["fields"]["description"]["applied"]:
            _record_change(applied["demo"], inverse["demo"], "description", demo.description, str(outline["description"])[:5000])
            demo.description = applied["demo"]["description"]

    step_map = {step.id: step for step in demo.steps}
    for item in generated:
        step = step_map.get(str(item.get("id", "")))
        if not step:
            continue
        report_item: dict = {"id": step.id, "position": step.position, "fields": {}, "warnings": [], "redundant": bool(item.get("redundant", False))}
        step_applied: dict = {}
        step_inverse: dict = {}
        for field, limit in [("title", 200), ("body", 5000)]:
            value = str(item.get(field, ""))[:limit]
            can_apply = bool(value) and field not in (step.manual_fields or [])
            report_item["fields"][field] = _comparison(getattr(step, field), value, can_apply)
            if can_apply:
                _record_change(step_applied, step_inverse, field, getattr(step, field), value)
                setattr(step, field, value)
        warnings = _normalized_warnings(item.get("warnings", []), demo.content_locale)
        item["warnings"] = warnings
        report_item["warnings"] = warnings
        step.ai_metadata = {
            **(step.ai_metadata or {}),
            "warnings": warnings,
            "redundant": bool(item.get("redundant", False)),
            "job_id": job.id,
        }
        if step_applied:
            applied["steps"][step.id] = step_applied
            inverse["steps"][step.id] = step_inverse
        hotspot_results = item.get("hotspots") if isinstance(item.get("hotspots"), list) else []
        if not hotspot_results and step.hotspots and (item.get("tooltip") or item.get("placement")):
            hotspot_results = [{"id": step.hotspots[0].id, "tooltip": item.get("tooltip"), "placement": item.get("placement")}]
        hotspot_map = {hotspot.id: hotspot for hotspot in step.hotspots}
        report_item["hotspots"] = []
        for hotspot_item in hotspot_results:
            if not isinstance(hotspot_item, dict):
                continue
            hotspot = hotspot_map.get(str(hotspot_item.get("id", "")))
            if not hotspot:
                continue
            current = dict(hotspot.tooltip or {})
            generated_tooltip = str(hotspot_item.get("tooltip", ""))[:5000]
            can_apply_tooltip = bool(generated_tooltip) and "tooltip" not in (hotspot.manual_fields or [])
            hotspot_report = {"id": hotspot.id, "tooltip": _comparison(current.get("content", ""), generated_tooltip, can_apply_tooltip)}
            report_item["hotspots"].append(hotspot_report)
            if len(report_item["hotspots"]) == 1:
                report_item["fields"]["tooltip"] = hotspot_report["tooltip"]
            if "tooltip" not in (hotspot.manual_fields or []):
                updated = {**current}
                if generated_tooltip:
                    updated["content"] = generated_tooltip
                if hotspot_item.get("placement") in {"auto", "top", "bottom", "left", "right"}:
                    updated["placement"] = hotspot_item["placement"]
                if updated != current:
                    applied["hotspots"][hotspot.id] = {"tooltip": updated}
                    inverse["hotspots"][hotspot.id] = {"tooltip": current}
                    hotspot.tooltip = updated
        report["steps"].append(report_item)
    job.applied_patch = applied
    job.inverse_patch = inverse
    return report


def run_ai_generation(job_id: str) -> None:
    from app.in_app_notifications import notify_job_result
    db = SessionLocal()
    try:
        job = db.get(AIJob, job_id)
        if not job or job.status == JobStatus.cancelled:
            return
        job.status = JobStatus.running
        job.progress = 5
        job.started_at = job.started_at or now()
        db.commit()
        model = active_model(db, job.model_config_id)
        if not model:
            raise AIProviderError("configured model is disabled or unavailable")
        job.model_config_id = model.id
        job.model = model.model
        demo = db.get(Demo, job.demo_id)
        if not demo:
            raise AIProviderError("demo no longer exists")
        steps = [step for step in sorted(demo.steps, key=lambda value: value.position) if not job.step_id or step.id == job.step_id]
        if not steps:
            raise AIProviderError("no steps available for generation")

        if job.step_id:
            outline = {"title": demo.title, "description": demo.description}
        else:
            outline = chat_json(outline_prompt(steps, demo.content_locale), model, job, "outline")
        db.refresh(job)
        if job.status == JobStatus.cancelled:
            return
        job.progress = 20
        db.commit()

        generated: list[dict] = []
        chunk_size = ai_chunk_size(db)
        for start in range(0, len(steps), chunk_size):
            chunk = steps[start:start + chunk_size]
            response = chat_json(chunk_prompt(chunk, outline, demo.content_locale, model.vision_enabled), model, job, "step_copy")
            if isinstance(response.get("steps"), list):
                generated.extend(item for item in response["steps"] if isinstance(item, dict))
            db.refresh(job)
            if job.status == JobStatus.cancelled:
                return
            job.progress = 20 + int(65 * min(len(steps), start + len(chunk)) / len(steps))
            db.commit()

        db.refresh(job)
        if job.status == JobStatus.cancelled:
            return
        changes = apply_results(db, job, demo, outline, generated)
        job.result = {"outline": outline, "steps": generated, "changes": changes, "content_locale": demo.content_locale}
        job.status = JobStatus.complete
        job.progress = 100
        job.completed_at = now()
        db.commit()
        notify_job_result(db, job, "ai", True)
        db.commit()
    except Exception as exc:
        db.rollback()
        job = db.get(AIJob, job_id)
        if job:
            db.refresh(job)
            if job.status == JobStatus.cancelled:
                return
            job.status = JobStatus.failed
            job.error = f"{exc}\n{traceback.format_exc()[-1500:]}"
            job.error_code = "ai.generation_failed"
            job.completed_at = now()
            db.commit()
            notify_job_result(db, job, "ai", False)
            db.commit()
        raise
    finally:
        db.close()
