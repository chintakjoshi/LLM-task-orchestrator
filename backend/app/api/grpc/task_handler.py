from __future__ import annotations

import logging
from uuid import uuid4

import grpc
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import SessionLocal
from app.schemas.task import TaskCreateInput, TaskGetInput, TaskListInput
from app.schemas.task_mapper import to_proto_task, to_proto_task_list
from app.services.task_service import (
    ParentTaskNotFoundError,
    TaskEnqueueError,
    TaskNotFoundError,
    TaskService,
)
from orchestrator.v1 import tasks_pb2, tasks_pb2_grpc

logger = logging.getLogger(__name__)


class TaskServiceGrpcHandler(tasks_pb2_grpc.TaskServiceServicer):
    @staticmethod
    def _metadata_map(context: grpc.ServicerContext) -> dict[str, str]:
        metadata: dict[str, str] = {}
        for entry in context.invocation_metadata():
            if hasattr(entry, "key") and hasattr(entry, "value"):
                key = str(entry.key).lower()
                value = str(entry.value)
            else:
                pair = tuple(entry)
                if len(pair) != 2:
                    continue
                key = str(pair[0]).lower()
                value = str(pair[1])
            metadata[key] = value
        return metadata

    @staticmethod
    def _abort(
        context: grpc.ServicerContext,
        *,
        code: grpc.StatusCode,
        message: str,
        request_id: str,
    ) -> None:
        context.set_trailing_metadata((("x-request-id", request_id),))
        context.abort(code, f"{message} (request_id={request_id})")

    def _start_request(
        self,
        *,
        context: grpc.ServicerContext,
        method_name: str,
    ) -> tuple[str, str | None]:
        metadata = self._metadata_map(context)
        request_id = metadata.get("x-request-id") or str(uuid4())
        user_id = metadata.get("x-user-id")
        context.set_trailing_metadata((("x-request-id", request_id),))
        logger.info(
            "gRPC request method=%s request_id=%s user_id=%s",
            method_name,
            request_id,
            user_id or "-",
        )
        return request_id, user_id

    def _check_deadline(self, *, context: grpc.ServicerContext, request_id: str) -> None:
        remaining = context.time_remaining()
        if remaining is not None and remaining <= 0:
            self._abort(
                context,
                code=grpc.StatusCode.DEADLINE_EXCEEDED,
                message="Request deadline exceeded",
                request_id=request_id,
            )

    def CreateTask(self, request, context):
        request_id, user_id = self._start_request(context=context, method_name="CreateTask")
        self._check_deadline(context=context, request_id=request_id)

        try:
            payload = TaskCreateInput(
                name=request.name,
                prompt=request.prompt,
                parent_task_id=request.parent_task_id or None,
                created_by=request.created_by or user_id or None,
            )
        except ValidationError as exc:
            self._abort(
                context,
                code=grpc.StatusCode.INVALID_ARGUMENT,
                message=str(exc),
                request_id=request_id,
            )

        with SessionLocal() as db:
            try:
                service = TaskService(db)
                task = service.create_task(payload)
                return tasks_pb2.CreateTaskResponse(task=to_proto_task(task))
            except ParentTaskNotFoundError as exc:
                self._abort(
                    context,
                    code=grpc.StatusCode.NOT_FOUND,
                    message=str(exc),
                    request_id=request_id,
                )
            except TaskEnqueueError as exc:
                self._abort(
                    context,
                    code=grpc.StatusCode.UNAVAILABLE,
                    message=str(exc),
                    request_id=request_id,
                )
            except SQLAlchemyError:
                db.rollback()
                logger.exception("CreateTask database failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Failed to create task",
                    request_id=request_id,
                )
            except Exception:
                db.rollback()
                logger.exception("CreateTask unexpected failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Unexpected server error while creating task",
                    request_id=request_id,
                )

    def ListTasks(self, request, context):
        request_id, _ = self._start_request(context=context, method_name="ListTasks")
        self._check_deadline(context=context, request_id=request_id)

        try:
            payload = TaskListInput(
                limit=request.limit or 50,
                offset=request.offset,
            )
        except ValidationError as exc:
            self._abort(
                context,
                code=grpc.StatusCode.INVALID_ARGUMENT,
                message=str(exc),
                request_id=request_id,
            )

        with SessionLocal() as db:
            try:
                service = TaskService(db)
                tasks = service.list_tasks(payload)
                return tasks_pb2.ListTasksResponse(tasks=to_proto_task_list(tasks))
            except SQLAlchemyError:
                db.rollback()
                logger.exception("ListTasks database failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Failed to list tasks",
                    request_id=request_id,
                )
            except Exception:
                db.rollback()
                logger.exception("ListTasks unexpected failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Unexpected server error while listing tasks",
                    request_id=request_id,
                )

    def GetTask(self, request, context):
        request_id, _ = self._start_request(context=context, method_name="GetTask")
        self._check_deadline(context=context, request_id=request_id)

        try:
            payload = TaskGetInput(id=request.id)
        except ValidationError as exc:
            self._abort(
                context,
                code=grpc.StatusCode.INVALID_ARGUMENT,
                message=str(exc),
                request_id=request_id,
            )

        with SessionLocal() as db:
            try:
                service = TaskService(db)
                task = service.get_task(payload)
                return tasks_pb2.GetTaskResponse(task=to_proto_task(task))
            except TaskNotFoundError as exc:
                self._abort(
                    context,
                    code=grpc.StatusCode.NOT_FOUND,
                    message=str(exc),
                    request_id=request_id,
                )
            except SQLAlchemyError:
                db.rollback()
                logger.exception("GetTask database failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Failed to load task",
                    request_id=request_id,
                )
            except Exception:
                db.rollback()
                logger.exception("GetTask unexpected failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Unexpected server error while loading task",
                    request_id=request_id,
                )
