from __future__ import annotations

import logging
from datetime import UTC, datetime
from uuid import uuid4

import grpc
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import SessionLocal
from app.schemas.task import (
    TaskBatchCreateInput,
    TaskBatchCreateItem,
    TaskCancelInput,
    TaskCreateInput,
    TaskGetInput,
    TaskLineageInput,
    TaskListInput,
    TaskRetryInput,
    TaskTemplateCreateInput,
)
from app.schemas.task_mapper import (
    to_proto_lineage_nodes,
    to_proto_task,
    to_proto_task_list,
    to_proto_task_templates,
)
from app.services.task_service import (
    ParentTaskNotFoundError,
    TaskCancelNotAllowedError,
    TaskEnqueueError,
    TaskNotFoundError,
    TaskRetryLimitError,
    TaskRetryNotAllowedError,
    TaskService,
    TaskTemplateNotFoundError,
)
from orchestrator.v1 import tasks_pb2, tasks_pb2_grpc

logger = logging.getLogger(__name__)


class TaskServiceGrpcHandler(tasks_pb2_grpc.TaskServiceServicer):
    @staticmethod
    def _get_execute_after(value: object) -> datetime | None:
        if not hasattr(value, "HasField"):
            return None
        if not value.HasField("execute_after"):
            return None
        execute_after = value.execute_after.ToDatetime()
        if execute_after.tzinfo is None:
            execute_after = execute_after.replace(tzinfo=UTC)
        return execute_after.astimezone(UTC)

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
                execute_after=self._get_execute_after(request),
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

    def RetryTask(self, request, context):
        request_id, _ = self._start_request(context=context, method_name="RetryTask")
        self._check_deadline(context=context, request_id=request_id)

        try:
            payload = TaskRetryInput(id=request.id)
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
                task = service.retry_task(payload)
                return tasks_pb2.RetryTaskResponse(task=to_proto_task(task))
            except TaskNotFoundError as exc:
                self._abort(
                    context,
                    code=grpc.StatusCode.NOT_FOUND,
                    message=str(exc),
                    request_id=request_id,
                )
            except (TaskRetryNotAllowedError, TaskRetryLimitError) as exc:
                self._abort(
                    context,
                    code=grpc.StatusCode.FAILED_PRECONDITION,
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
                logger.exception("RetryTask database failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Failed to retry task",
                    request_id=request_id,
                )
            except Exception:
                db.rollback()
                logger.exception("RetryTask unexpected failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Unexpected server error while retrying task",
                    request_id=request_id,
                )

    def CancelTask(self, request, context):
        request_id, _ = self._start_request(context=context, method_name="CancelTask")
        self._check_deadline(context=context, request_id=request_id)

        try:
            payload = TaskCancelInput(id=request.id)
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
                task = service.cancel_task(payload)
                return tasks_pb2.CancelTaskResponse(task=to_proto_task(task))
            except TaskNotFoundError as exc:
                self._abort(
                    context,
                    code=grpc.StatusCode.NOT_FOUND,
                    message=str(exc),
                    request_id=request_id,
                )
            except TaskCancelNotAllowedError as exc:
                self._abort(
                    context,
                    code=grpc.StatusCode.FAILED_PRECONDITION,
                    message=str(exc),
                    request_id=request_id,
                )
            except SQLAlchemyError:
                db.rollback()
                logger.exception("CancelTask database failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Failed to cancel task",
                    request_id=request_id,
                )
            except Exception:
                db.rollback()
                logger.exception("CancelTask unexpected failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Unexpected server error while cancelling task",
                    request_id=request_id,
                )

    def BatchCreateTasks(self, request, context):
        request_id, user_id = self._start_request(context=context, method_name="BatchCreateTasks")
        self._check_deadline(context=context, request_id=request_id)

        try:
            tasks = [
                TaskBatchCreateItem(
                    name=item.name,
                    prompt=item.prompt,
                    parent_task_id=item.parent_task_id or None,
                    created_by=item.created_by or user_id or None,
                )
                for item in request.tasks
            ]
            payload = TaskBatchCreateInput(tasks=tasks)
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
                created_tasks = service.create_tasks_batch(payload)
                return tasks_pb2.BatchCreateTasksResponse(tasks=to_proto_task_list(created_tasks))
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
                logger.exception("BatchCreateTasks database failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Failed to create tasks in batch",
                    request_id=request_id,
                )
            except Exception:
                db.rollback()
                logger.exception("BatchCreateTasks unexpected failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Unexpected server error while creating tasks in batch",
                    request_id=request_id,
                )

    def ListTaskTemplates(self, request, context):
        request_id, _ = self._start_request(context=context, method_name="ListTaskTemplates")
        self._check_deadline(context=context, request_id=request_id)

        with SessionLocal() as db:
            try:
                service = TaskService(db)
                templates = service.list_task_templates()
                return tasks_pb2.ListTaskTemplatesResponse(
                    templates=to_proto_task_templates(templates)
                )
            except SQLAlchemyError:
                db.rollback()
                logger.exception("ListTaskTemplates database failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Failed to list task templates",
                    request_id=request_id,
                )
            except Exception:
                db.rollback()
                logger.exception("ListTaskTemplates unexpected failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Unexpected server error while listing task templates",
                    request_id=request_id,
                )

    def CreateTaskFromTemplate(self, request, context):
        request_id, user_id = self._start_request(context=context, method_name="CreateTaskFromTemplate")
        self._check_deadline(context=context, request_id=request_id)

        try:
            payload = TaskTemplateCreateInput(
                template_id=request.template_id,
                input_text=request.input_text,
                name=request.name or None,
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
                task = service.create_task_from_template(payload)
                return tasks_pb2.CreateTaskFromTemplateResponse(task=to_proto_task(task))
            except TaskTemplateNotFoundError as exc:
                self._abort(
                    context,
                    code=grpc.StatusCode.NOT_FOUND,
                    message=str(exc),
                    request_id=request_id,
                )
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
                logger.exception("CreateTaskFromTemplate database failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Failed to create task from template",
                    request_id=request_id,
                )
            except Exception:
                db.rollback()
                logger.exception("CreateTaskFromTemplate unexpected failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Unexpected server error while creating task from template",
                    request_id=request_id,
                )

    def GetTaskLineage(self, request, context):
        request_id, _ = self._start_request(context=context, method_name="GetTaskLineage")
        self._check_deadline(context=context, request_id=request_id)

        try:
            payload = TaskLineageInput(
                id=request.id,
                max_depth=request.max_depth or 10,
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
                root_task, ancestors, descendants = service.get_task_lineage(payload)
                return tasks_pb2.GetTaskLineageResponse(
                    root_task=to_proto_task(root_task),
                    ancestors=to_proto_lineage_nodes(ancestors),
                    descendants=to_proto_lineage_nodes(descendants),
                )
            except TaskNotFoundError as exc:
                self._abort(
                    context,
                    code=grpc.StatusCode.NOT_FOUND,
                    message=str(exc),
                    request_id=request_id,
                )
            except SQLAlchemyError:
                db.rollback()
                logger.exception("GetTaskLineage database failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Failed to load task lineage",
                    request_id=request_id,
                )
            except Exception:
                db.rollback()
                logger.exception("GetTaskLineage unexpected failure request_id=%s", request_id)
                self._abort(
                    context,
                    code=grpc.StatusCode.INTERNAL,
                    message="Unexpected server error while loading task lineage",
                    request_id=request_id,
                )
