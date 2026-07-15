import io
import json

from PIL import Image


def add_step(client, demo_id: str, event_id: str):
    image = io.BytesIO()
    Image.new("RGB", (800, 500), "white").save(image, "PNG")
    return client.post(
        f"/api/recordings/{demo_id}/steps",
        data={"meta": json.dumps({
            "event_id": event_id, "title": event_id, "viewport_width": 800, "viewport_height": 500,
            "hotspot": {"x": .5, "y": .5, "w": .1, "h": .1}, "ai_enabled": False,
        })},
        files={"screenshot": ("screen.png", image.getvalue(), "image/png")},
    )


def test_two_level_categories_tags_and_merge(authenticated):
    root = authenticated.post("/api/categories", json={"name": "AGIOne", "color": "#635bff"})
    assert root.status_code == 201
    child = authenticated.post("/api/categories", json={"name": "控制台", "parent_id": root.json()["id"]})
    assert child.status_code == 201
    too_deep = authenticated.post("/api/categories", json={"name": "三级", "parent_id": child.json()["id"]})
    assert too_deep.status_code == 400

    tag = authenticated.post("/api/tags", json={"name": "销售", "color": "#22a660"})
    assert tag.status_code == 201
    first = authenticated.post("/api/demos", json={"title": "前半段", "category_id": child.json()["id"]}).json()
    second = authenticated.post("/api/demos", json={"title": "后半段"}).json()
    assert add_step(authenticated, first["id"], "first").status_code == 201
    assert add_step(authenticated, second["id"], "second").status_code == 201
    tagged = authenticated.patch(f"/api/demos/{first['id']}", json={"tag_ids": [tag.json()["id"]]}).json()
    assert tagged["tags"][0]["name"] == "销售"

    merged = authenticated.post("/api/demos/merge", json={
        "demo_ids": [second["id"], first["id"]], "title": "完整流程", "category_id": root.json()["id"],
    })
    assert merged.status_code == 201, merged.text
    value = merged.json()
    assert [item["title"] for item in value["steps"]] == ["second", "first"]
    assert value["category_id"] == root.json()["id"]
    assert value["status"] == "draft"
    assert authenticated.get(f"/api/demos/{first['id']}").status_code == 200


def test_public_analytics_and_step_comments(authenticated):
    demo = authenticated.post("/api/demos", json={"title": "分析演示"}).json()
    first = add_step(authenticated, demo["id"], "one").json()
    second = add_step(authenticated, demo["id"], "two").json()
    published = authenticated.post(f"/api/demos/{demo['id']}/publish").json()
    token = published["share_url"].rsplit("/", 1)[-1]
    base = {"visitor_id": "visitor-a", "session_id": "session-a"}
    headers = {"user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/125.0", "x-country": "CN", "x-city": "Beijing"}
    assert authenticated.post(f"/public/{token}/events", json={**base, "event_type": "view"}, headers=headers).status_code == 204
    # Duplicate view in one session must not inflate totals.
    assert authenticated.post(f"/public/{token}/events", json={**base, "event_type": "view"}, headers=headers).status_code == 204
    for event_type, step_id in (("step_view", first["id"]), ("interaction", first["id"]), ("step_view", second["id"]), ("complete", second["id"])):
        assert authenticated.post(f"/public/{token}/events", json={**base, "event_type": event_type, "step_id": step_id}, headers=headers).status_code == 204
    comment = authenticated.post(f"/public/{token}/comments", json={
        "step_id": second["id"], "visitor_id": "visitor-a", "author_name": "Alice",
        "author_email": "alice@example.com", "content": "这里可以再解释清楚一些。",
    })
    assert comment.status_code == 201
    public_comments = authenticated.get(f"/public/{token}/comments", params={"step_id": second["id"]}).json()
    assert public_comments[0]["author_name"] == "Alice"
    assert "author_email" not in public_comments[0]

    analytics = authenticated.get(f"/api/demos/{demo['id']}/analytics")
    assert analytics.status_code == 200, analytics.text
    value = analytics.json()
    assert value["summary"] == {"total_views": 1, "unique_viewers": 1, "engagement": 100.0, "completion": 100.0}
    assert [item["viewers"] for item in value["steps"]] == [1, 1]
    assert value["devices"]["operating_systems"][0]["name"] == "Windows"
    assert value["devices"]["locations"][0]["name"] == "Beijing, CN"
    assert value["leads"][0]["email"] == "alice@example.com"
