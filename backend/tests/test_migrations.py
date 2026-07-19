import re
from pathlib import Path


def test_alembic_revision_ids_fit_version_column():
    """Alembic's default version_num column is VARCHAR(32) in production."""
    versions = Path(__file__).parents[1] / "alembic" / "versions"
    for path in versions.glob("*.py"):
        match = re.search(r'^revision\s*=\s*["\']([^"\']+)["\']', path.read_text(), re.MULTILINE)
        assert match, f"missing revision id in {path.name}"
        assert len(match.group(1)) <= 32, f"revision id exceeds Alembic VARCHAR(32): {path.name}"
