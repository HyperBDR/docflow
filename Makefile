.PHONY: dev test audit-i18n web-build extension-build

dev:
	docker compose up --build

test: audit-i18n
	cd backend && pytest

audit-i18n:
	python3 scripts/check_audit_i18n.py

web-build:
	cd web && npm ci && npm run build

extension-build:
	cd extension && npm ci && npm run build
