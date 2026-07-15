from app.ai_service import chunk_prompt, outline_prompt


def test_account_locale_and_demo_content_locale(client):
    registered = client.post(
        "/api/auth/register",
        json={"email": "english@example.com", "password": "correct-horse", "ui_locale": "en"},
    )
    assert registered.status_code == 201
    assert registered.json()["ui_locale"] == "en"
    assert client.patch("/api/auth/me", json={"ui_locale": "zh-CN"}).json()["ui_locale"] == "zh-CN"

    demo = client.post("/api/demos", json={"title": "Product tour", "content_locale": "en"})
    assert demo.status_code == 201
    assert demo.json()["content_locale"] == "en"
    assert demo.json()["navigation"]["previous_label"] == "Previous"
    assert demo.json()["navigation"]["next_label"] == "Next"

    changed = client.patch(f"/api/demos/{demo.json()['id']}", json={"content_locale": "zh-CN"})
    assert changed.status_code == 200
    assert changed.json()["content_locale"] == "zh-CN"
    # Changing future AI language never rewrites existing visible navigation.
    assert changed.json()["navigation"]["previous_label"] == "Previous"


def test_error_responses_have_stable_codes(client):
    response = client.get("/api/demos")
    assert response.status_code == 401
    assert response.json()["code"] == "auth.not_authenticated"
    assert isinstance(response.json()["detail"], str)


def test_ai_prompts_follow_demo_content_language():
    assert "accurate English" in outline_prompt([], "en")[0]["content"]
    assert "准确的中文" in outline_prompt([], "zh-CN")[0]["content"]
    assert "natural English" in chunk_prompt([], {}, "en")[1]["content"][0]["text"]
    assert "为每一步输出" in chunk_prompt([], {}, "zh-CN")[1]["content"][0]["text"]
