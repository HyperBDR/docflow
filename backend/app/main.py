from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.routers import auth, demos, exports, extension, public, recordings, reorder


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="DocFlow API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.web_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth.router)
app.include_router(extension.router)
app.include_router(demos.router)
app.include_router(reorder.router)
app.include_router(recordings.router)
app.include_router(exports.router)
app.include_router(public.router)


@app.get("/health")
def health():
    return {"status": "ok"}
