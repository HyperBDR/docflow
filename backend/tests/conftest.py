import os
from pathlib import Path

os.environ["DOCFLOW_DATABASE_URL"] = "sqlite:////tmp/docflow-test.db"
os.environ["DOCFLOW_STORAGE_DIR"] = "/tmp/docflow-test-data"
os.environ["DOCFLOW_SECRET_KEY"] = "test-secret"

import pytest
from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


@pytest.fixture(autouse=True)
def reset_database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def client():
    with TestClient(app) as value:
        yield value


@pytest.fixture
def authenticated(client: TestClient):
    response = client.post("/api/auth/register", json={"email": "owner@example.com", "password": "correct-horse"})
    assert response.status_code == 201
    return client

