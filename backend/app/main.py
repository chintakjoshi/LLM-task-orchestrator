from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.grpc.server import start_grpc_server, stop_grpc_server
from app.api.router import router as api_router
from app.core.config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    start_grpc_server()
    try:
        yield
    finally:
        stop_grpc_server()


app = FastAPI(
    title=settings.app_name,
    debug=settings.debug,
    lifespan=lifespan,
)
app.include_router(api_router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": settings.app_name, "status": "ok"}
