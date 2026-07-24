from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.errors import http_exception_response, validation_exception_response
from app.routers import admin, ai, auth, demos, exports, extension, extension_releases, google_auth, interactions, library, monitoring, notifications, organizations, platform_public, platform_settings, public, quotas, recordings, reorder, resource_governance, resource_transfers, workspace
from app.monitoring.request_metrics import RequestMetricsMiddleware


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="DocFlow API", version="0.1.0", lifespan=lifespan)
app.add_exception_handler(HTTPException, http_exception_response)
app.add_exception_handler(RequestValidationError, validation_exception_response)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestMetricsMiddleware)
app.include_router(auth.router)
app.include_router(google_auth.router)
app.include_router(admin.router)
app.include_router(resource_governance.router)
app.include_router(quotas.router)
app.include_router(monitoring.router)
app.include_router(notifications.router)
app.include_router(platform_settings.router)
app.include_router(platform_public.router)
app.include_router(organizations.router)
app.include_router(workspace.router)
app.include_router(extension.router)
app.include_router(extension_releases.public_router)
app.include_router(extension_releases.admin_router)
app.include_router(demos.router)
app.include_router(resource_transfers.router)
app.include_router(interactions.router)
app.include_router(ai.router)
app.include_router(reorder.router)
app.include_router(recordings.router)
app.include_router(exports.router)
app.include_router(library.router)
app.include_router(public.router)


@app.get("/health")
def health():
    return {"status": "ok"}
