from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.repositories.task_repository import TaskRepository
from app.schemas.task import (
    TaskCreateInput,
    TaskGetInput,
    TaskListInput,
)
from app.workers.celery_app import celery_app
from app.workers.task_names import EXECUTE_LLM_TASK_NAME


class TaskNotFoundError(Exception):
    pass


class ParentTaskNotFoundError(Exception):
    pass


class TaskEnqueueError(Exception):
    pass


class TaskService:
    def __init__(self, db: Session) -> None:
        self.repository = TaskRepository(db)

    def create_task(self, data: TaskCreateInput):
        parent_task_id = data.parent_task_id
        if parent_task_id is not None:
            parent_task = self.repository.get_by_id(parent_task_id)
            if parent_task is None:
                raise ParentTaskNotFoundError("Parent task does not exist")

        task = self.repository.create(
            name=data.name,
            prompt=data.prompt,
            parent_task_id=parent_task_id,
            created_by=data.created_by,
        )
        return self._enqueue_llm_task(task_id=task.id)

    def list_tasks(self, data: TaskListInput):
        return self.repository.list(limit=data.limit, offset=data.offset)

    def get_task(self, data: TaskGetInput):
        task = self.repository.get_by_id(data.id)
        if task is None:
            raise TaskNotFoundError("Task not found")
        return task

    def mark_task_running(
        self,
        *,
        task_id: UUID,
        celery_task_id: str,
        worker_id: str | None,
    ) -> None:
        task = self.repository.mark_running(
            task_id=task_id,
            celery_task_id=celery_task_id,
            worker_id=worker_id,
        )
        if task is None:
            raise TaskNotFoundError("Task not found")

    def mark_task_completed(
        self,
        *,
        task_id: UUID,
        celery_task_id: str,
        output: str,
        model_name: str | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        total_tokens: int | None = None,
    ) -> None:
        task = self.repository.mark_completed(
            task_id=task_id,
            celery_task_id=celery_task_id,
            output=output,
            model_name=model_name,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
        )
        if task is None:
            raise TaskNotFoundError("Task not found")

    def mark_task_failed(
        self,
        *,
        task_id: UUID,
        celery_task_id: str,
        error_message: str,
        error_type: str,
    ) -> None:
        task = self.repository.mark_failed(
            task_id=task_id,
            celery_task_id=celery_task_id,
            error_message=error_message,
            error_type=error_type,
        )
        if task is None:
            raise TaskNotFoundError("Task not found")

    def _enqueue_llm_task(
        self,
        *,
        task_id: UUID,
    ):
        task = self.repository.get_by_id(task_id)
        if task is None:
            raise TaskNotFoundError("Task not found")

        try:
            async_result = celery_app.send_task(
                EXECUTE_LLM_TASK_NAME,
                kwargs={"task_id": str(task.id)},
            )
        except Exception as exc:  # pragma: no cover - network/system dependent
            raise TaskEnqueueError("Failed to submit task to Celery") from exc

        queued_task = self.repository.enqueue_execution(
            task_id=task.id,
            celery_task_id=async_result.id,
        )
        if queued_task is None:
            raise TaskNotFoundError("Task not found")
        return queued_task, async_result.id
