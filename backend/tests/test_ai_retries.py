from types import SimpleNamespace

import httpx
import pytest

from app import ai_service


class StreamResponse:
    status_code = 200
    headers = {}

    def __init__(self, owner):
        self.owner = owner

    def __enter__(self):
        self.owner.attempts += 1
        if self.owner.attempts <= self.owner.failures:
            request = httpx.Request("POST", "https://models.example.test/v1/chat/completions")
            raise httpx.ReadTimeout("read timed out", request=request)
        return self

    def __exit__(self, *_args):
        return None

    def read(self):
        return b""

    def iter_lines(self):
        yield 'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"},"finish_reason":"stop"}],"usage":{"total_tokens":3}}'
        yield "data: [DONE]"


def fake_client_type(failures):
    class FakeClient:
        attempts = 0
        failures = 0

        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def stream(self, *_args, **_kwargs):
            return StreamResponse(type(self))

    FakeClient.failures = failures
    return FakeClient


def model():
    return SimpleNamespace(
        id="model-1", provider="openai_compatible", base_url="https://models.example.test/v1",
        api_key="secret", model="test-model", temperature=.2, extra_options={}, timeout_seconds=5,
    )


def test_chat_json_retries_transient_read_timeouts(monkeypatch):
    client = fake_client_type(2)
    sleeps = []
    monkeypatch.setattr(ai_service.httpx, "Client", client)
    monkeypatch.setattr(ai_service, "_save_usage", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(ai_service.time, "sleep", sleeps.append)

    result = ai_service.chat_json([{"role": "user", "content": "test"}], model(), SimpleNamespace(), "outline")

    assert result == {"ok": True}
    assert client.attempts == 3
    assert sleeps == [.4, .8]


def test_chat_json_reports_timeout_after_retry_budget(monkeypatch):
    client = fake_client_type(3)
    monkeypatch.setattr(ai_service.httpx, "Client", client)
    monkeypatch.setattr(ai_service, "_save_usage", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(ai_service.time, "sleep", lambda _seconds: None)

    with pytest.raises(ai_service.AIProviderTimeout, match="after 3 attempts"):
        ai_service.chat_json([{"role": "user", "content": "test"}], model(), SimpleNamespace(), "outline")
    assert client.attempts == 3
