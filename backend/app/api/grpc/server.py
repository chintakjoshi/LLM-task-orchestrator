from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

import grpc

from app.api.grpc.task_handler import TaskServiceGrpcHandler
from app.core.config import get_settings
from orchestrator.v1 import tasks_pb2_grpc

logger = logging.getLogger(__name__)

_grpc_server: grpc.Server | None = None


def start_grpc_server() -> None:
    global _grpc_server
    if _grpc_server is not None:
        return

    settings = get_settings()
    bind_address = f"{settings.grpc_host}:{settings.grpc_port}"

    server = grpc.server(ThreadPoolExecutor(max_workers=10))
    tasks_pb2_grpc.add_TaskServiceServicer_to_server(TaskServiceGrpcHandler(), server)
    server.add_insecure_port(bind_address)
    server.start()

    _grpc_server = server
    logger.info("gRPC server started on %s", bind_address)


def stop_grpc_server(grace_seconds: int = 5) -> None:
    global _grpc_server
    if _grpc_server is None:
        return

    _grpc_server.stop(grace=grace_seconds)
    _grpc_server = None
