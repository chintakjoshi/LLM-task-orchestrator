from __future__ import annotations

import grpc
from pydantic import ValidationError
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import SessionLocal
from app.schemas.task import TaskCreateInput, TaskGetInput, TaskListInput
from app.schemas.task_mapper import to_proto_task, to_proto_task_list
from app.services.task_service import ParentTaskNotFoundError, TaskNotFoundError, TaskService
from orchestrator.v1 import tasks_pb2, tasks_pb2_grpc


class TaskServiceGrpcHandler(tasks_pb2_grpc.TaskServiceServicer):
    def CreateTask(self, request, context):
        try:
            payload = TaskCreateInput(
                name=request.name,
                prompt=request.prompt,
                parent_task_id=request.parent_task_id or None,
                created_by=request.created_by or None,
            )
        except ValidationError as exc:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))

        with SessionLocal() as db:
            try:
                service = TaskService(db)
                task = service.create_task(payload)
                return tasks_pb2.CreateTaskResponse(task=to_proto_task(task))
            except ParentTaskNotFoundError as exc:
                context.abort(grpc.StatusCode.NOT_FOUND, str(exc))
            except SQLAlchemyError:
                db.rollback()
                context.abort(grpc.StatusCode.INTERNAL, "Failed to create task")

    def ListTasks(self, request, context):
        try:
            payload = TaskListInput(
                limit=request.limit or 50,
                offset=request.offset,
            )
        except ValidationError as exc:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))

        with SessionLocal() as db:
            try:
                service = TaskService(db)
                tasks = service.list_tasks(payload)
                return tasks_pb2.ListTasksResponse(tasks=to_proto_task_list(tasks))
            except SQLAlchemyError:
                db.rollback()
                context.abort(grpc.StatusCode.INTERNAL, "Failed to list tasks")

    def GetTask(self, request, context):
        try:
            payload = TaskGetInput(id=request.id)
        except ValidationError as exc:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(exc))

        with SessionLocal() as db:
            try:
                service = TaskService(db)
                task = service.get_task(payload)
                return tasks_pb2.GetTaskResponse(task=to_proto_task(task))
            except TaskNotFoundError as exc:
                context.abort(grpc.StatusCode.NOT_FOUND, str(exc))
            except SQLAlchemyError:
                db.rollback()
                context.abort(grpc.StatusCode.INTERNAL, "Failed to load task")
