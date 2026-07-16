import time
from datetime import datetime, timedelta, timezone

import redis
import redis.asyncio as async_redis
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import settings


LATENCY_BUCKETS = (50, 100, 250, 500, 1000, 2500, 5000)


def _minute_key(timestamp: datetime) -> str:
    return f"docflow:metrics:http:{timestamp.strftime('%Y%m%d%H%M')}"


class RequestMetricsMiddleware(BaseHTTPMiddleware):
    """Records aggregate HTTP counters in Redis without storing request data."""

    async def dispatch(self, request, call_next):
        started = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            if request.url.path != "/health":
                elapsed = max(0, round((time.perf_counter() - started) * 1000))
                key = _minute_key(datetime.now(timezone.utc))
                client = async_redis.from_url(
                    settings.redis_url, decode_responses=True,
                    socket_connect_timeout=.1, socket_timeout=.1,
                )
                try:
                    bucket = next((value for value in LATENCY_BUCKETS if elapsed <= value), 999999)
                    pipe = client.pipeline(transaction=False)
                    pipe.hincrby(key, "requests", 1)
                    pipe.hincrby(key, "status_4xx" if 400 <= status_code < 500 else "status_5xx" if status_code >= 500 else "status_2xx", 1)
                    pipe.hincrby(key, "latency_sum_ms", elapsed)
                    pipe.hincrby(key, f"latency_le_{bucket}", 1)
                    pipe.expire(key, 7200)
                    await pipe.execute()
                except Exception:
                    pass
                finally:
                    await client.aclose()


def read_http_metrics(minutes: int = 5) -> dict[str, float]:
    client = redis.Redis.from_url(
        settings.redis_url, decode_responses=True,
        socket_connect_timeout=.3, socket_timeout=.3,
    )
    now = datetime.now(timezone.utc)
    keys = [_minute_key(now.replace(second=0, microsecond=0) - timedelta(minutes=offset)) for offset in range(minutes)]
    totals: dict[str, int] = {}
    try:
        pipe = client.pipeline(transaction=False)
        for key in keys:
            pipe.hgetall(key)
        for values in pipe.execute():
            for key, value in values.items():
                totals[key] = totals.get(key, 0) + int(value)
    except Exception:
        return {"available": 0, "requests": 0, "error_rate": 0, "avg_latency_ms": 0, "p95_latency_ms": 0}
    finally:
        client.close()
    requests = totals.get("requests", 0)
    target = max(1, round(requests * .95))
    cumulative = 0
    p95 = 0
    for bucket in (*LATENCY_BUCKETS, 999999):
        cumulative += totals.get(f"latency_le_{bucket}", 0)
        if cumulative >= target:
            p95 = bucket if bucket != 999999 else 5000
            break
    errors = totals.get("status_5xx", 0)
    return {
        "available": 1,
        "requests": requests,
        "status_2xx": totals.get("status_2xx", 0),
        "status_4xx": totals.get("status_4xx", 0),
        "status_5xx": errors,
        "error_rate": round(errors / requests * 100, 2) if requests else 0,
        "avg_latency_ms": round(totals.get("latency_sum_ms", 0) / requests, 1) if requests else 0,
        "p95_latency_ms": p95,
    }
