"""Verify every backend audit event has English and Chinese display text."""

import ast
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend" / "app"
LOCALES = ROOT / "web" / "src" / "locales"
RECORDING_ACTIONS = {"recording.started", "recording.paused", "recording.resumed", "recording.completed"}


def call_name(node: ast.Call) -> str:
    if isinstance(node.func, ast.Name):
        return node.func.id
    if isinstance(node.func, ast.Attribute):
        return node.func.attr
    return ""


def audit_contract() -> tuple[set[str], set[str], list[str]]:
    actions: set[str] = set()
    target_types: set[str] = set()
    unsupported: list[str] = []
    for path in BACKEND.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or call_name(node) != "write_audit" or len(node.args) < 4:
                continue
            action, target_type = node.args[2], node.args[3]
            if isinstance(action, ast.Constant) and isinstance(action.value, str):
                actions.add(action.value)
            elif isinstance(action, ast.JoinedStr) and "recording." in ast.unparse(action):
                actions.update(RECORDING_ACTIONS)
            else:
                unsupported.append(f"{path.relative_to(ROOT)}:{node.lineno} action={ast.unparse(action)}")
            if isinstance(target_type, ast.Constant) and isinstance(target_type.value, str):
                target_types.add(target_type.value)
            else:
                unsupported.append(f"{path.relative_to(ROOT)}:{node.lineno} target_type={ast.unparse(target_type)}")
    return actions, target_types, unsupported


def main() -> None:
    actions, target_types, unsupported = audit_contract()
    failures = list(unsupported)
    for locale in ("en", "zh-CN"):
        data = json.loads((LOCALES / locale / "admin.json").read_text(encoding="utf-8"))["audit"]
        missing_actions = sorted(actions - set(data["actions"]))
        missing_types = sorted(target_types - set(data["types"]))
        if missing_actions:
            failures.append(f"{locale} missing audit actions: {', '.join(missing_actions)}")
        if missing_types:
            failures.append(f"{locale} missing audit target types: {', '.join(missing_types)}")
    if failures:
        raise SystemExit("\n".join(failures))
    print(f"audit i18n covers {len(actions)} actions and {len(target_types)} target types")


if __name__ == "__main__":
    main()
