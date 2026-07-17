from urllib.parse import parse_qs, urlparse

from app.database import SessionLocal
from app.models import GoogleAuthSettings, OAuthIdentity, User
from app.oauth.google import GoogleClaims
from app.routers import google_auth
from app.secrets import decrypt_secret, encrypt_secret


def configure_google(*, allow_registration: bool = True, domains: list[str] | None = None) -> None:
    with SessionLocal() as db:
        db.add(GoogleAuthSettings(
            id="default", enabled=True, client_id="google-client-id",
            client_secret_encrypted=encrypt_secret("google-client-secret"),
            allow_registration=allow_registration, allowed_domains=domains or [],
        ))
        db.commit()


def authorization_state(client, path: str = "/api/auth/google/start") -> str:
    response = client.get(path, params={"return_to": "/"}, follow_redirects=False)
    assert response.status_code == 307
    query = parse_qs(urlparse(response.headers["location"]).query)
    assert query["scope"] == ["openid email profile"]
    assert query["code_challenge_method"] == ["S256"]
    return query["state"][0]


def claims(email: str = "google@example.com", subject: str = "google-subject") -> GoogleClaims:
    return GoogleClaims(subject=subject, email=email, email_verified=True, name="Google User", picture="https://example.com/avatar.png")


def callback(client, monkeypatch, value: GoogleClaims, state: str):
    monkeypatch.setattr(google_auth, "exchange_code", lambda _config, _state, _code: value)
    return client.get("/api/auth/google/callback", params={"state": state, "code": "authorization-code"}, follow_redirects=False)


def test_google_registration_creates_identity_session_and_passwordless_user(client, monkeypatch):
    configure_google()
    response = callback(client, monkeypatch, claims(), authorization_state(client))
    assert response.status_code == 303
    assert "oauth=google_login" in response.headers["location"]
    current = client.get("/api/auth/me")
    assert current.status_code == 200
    assert current.json()["email"] == "google@example.com"
    assert current.json()["role"] == "admin"
    assert current.json()["password_configured"] is False
    identity = client.get("/api/auth/google/identity").json()
    assert identity["email"] == "google@example.com"
    assert identity["can_unlink"] is False

    client.post("/api/auth/logout")
    password_login = client.post("/api/auth/login", json={"email": "google@example.com", "password": "not-a-real-password"})
    assert password_login.status_code == 401


def test_registration_policy_and_domain_are_enforced(client, monkeypatch):
    configure_google(allow_registration=False)
    response = callback(client, monkeypatch, claims(), authorization_state(client))
    assert "oauth_error=google_registration_disabled" in response.headers["location"]

    with SessionLocal() as db:
        setting = db.get(GoogleAuthSettings, "default")
        setting.allow_registration = True
        setting.allowed_domains = ["oneprocloud.com"]
        db.commit()
    response = callback(client, monkeypatch, claims("person@example.com", "another-subject"), authorization_state(client))
    assert "oauth_error=google_domain_denied" in response.headers["location"]


def test_existing_password_account_requires_explicit_link(client, monkeypatch):
    assert client.post("/api/auth/register", json={"email": "owner@example.com", "password": "correct-horse"}).status_code == 201
    configure_google()
    client.post("/api/auth/logout")
    response = callback(client, monkeypatch, claims("owner@example.com"), authorization_state(client))
    assert "oauth_error=google_link_required" in response.headers["location"]
    with SessionLocal() as db:
        assert db.query(OAuthIdentity).count() == 0


def test_authenticated_user_can_link_login_and_unlink_google(client, monkeypatch):
    assert client.post("/api/auth/register", json={"email": "owner@example.com", "password": "correct-horse"}).status_code == 201
    configure_google()
    state = authorization_state(client, "/api/auth/google/link/start")
    response = callback(client, monkeypatch, claims("owner@example.com"), state)
    assert "oauth=google_linked" in response.headers["location"]
    assert client.get("/api/auth/google/identity").json()["can_unlink"] is True

    client.post("/api/auth/logout")
    response = callback(client, monkeypatch, claims("owner@example.com"), authorization_state(client))
    assert "oauth=google_login" in response.headers["location"]
    assert client.get("/api/auth/me").status_code == 200

    assert client.delete("/api/auth/google/identity").status_code == 204
    assert client.get("/api/auth/google/identity").json() is None


def test_google_only_user_cannot_unlink_last_sign_in_method(client, monkeypatch):
    configure_google()
    callback(client, monkeypatch, claims(), authorization_state(client))
    response = client.delete("/api/auth/google/identity")
    assert response.status_code == 409
    assert client.get("/api/auth/google/identity").json() is not None


def test_disabled_linked_user_is_blocked(client, monkeypatch):
    configure_google()
    callback(client, monkeypatch, claims(), authorization_state(client))
    client.post("/api/auth/logout")
    with SessionLocal() as db:
        user = db.query(User).filter(User.email == "google@example.com").one()
        user.is_active = False
        db.commit()
    response = callback(client, monkeypatch, claims(), authorization_state(client))
    assert "oauth_error=google_account_disabled" in response.headers["location"]
    assert client.get("/api/auth/me").status_code == 401


def test_oauth_state_is_one_time_and_safe_return_path_is_enforced(client, monkeypatch):
    configure_google()
    response = client.get("/api/auth/google/start", params={"return_to": "//evil.example/path"}, follow_redirects=False)
    state = parse_qs(urlparse(response.headers["location"]).query)["state"][0]
    first = callback(client, monkeypatch, claims(), state)
    assert first.headers["location"].startswith("http://localhost:5173/")
    second = callback(client, monkeypatch, claims(), state)
    assert "oauth_error=google_login_failed" in second.headers["location"]


def test_admin_google_settings_encrypt_secret_and_never_return_it(client):
    assert client.post("/api/auth/register", json={"email": "admin@example.com", "password": "correct-horse"}).status_code == 201
    response = client.patch("/api/admin/settings/google", json={
        "enabled": True, "client_id": "client-id", "client_secret": "plain-secret",
        "allow_registration": True, "allowed_domains": ["OneProCloud.com", "oneprocloud.com"],
    })
    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is True
    assert payload["client_secret_configured"] is True
    assert payload["allowed_domains"] == ["oneprocloud.com"]
    assert "client_secret" not in payload
    with SessionLocal() as db:
        value = db.get(GoogleAuthSettings, "default")
        assert value.client_secret_encrypted != "plain-secret"
        assert decrypt_secret(value.client_secret_encrypted) == "plain-secret"

    retained = client.patch("/api/admin/settings/google", json={
        "enabled": True, "client_id": "updated-client-id", "client_secret": "",
        "allow_registration": False, "allowed_domains": [],
    })
    assert retained.status_code == 200
    assert retained.json()["client_secret_configured"] is True
