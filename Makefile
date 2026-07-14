.PHONY: dev test web-build extension-build

dev:
	docker compose up --build

test:
	cd backend && pytest

web-build:
	cd web && npm ci && npm run build

extension-build:
	cd extension && npm ci && npm run build

