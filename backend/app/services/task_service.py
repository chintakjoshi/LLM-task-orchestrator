from __future__ import annotations

import logging
from uuid import UUID
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models.task import Task
from app.models.task import TaskStatus
from app.repositories.task_repository import TaskRepository
from app.schemas.task import (
    TaskBatchCreateInput,
    TaskCreateInput,
    TaskCancelInput,
    TaskGetInput,
    TaskLineageInput,
    TaskListInput,
    TaskRetryInput,
    TaskTemplateCreateInput,
)
from app.services.task_templates import DEFAULT_TASK_TEMPLATES, TaskTemplateDefinition
from app.workers.celery_app import celery_app
from app.workers.task_names import EXECUTE_LLM_TASK_NAME

logger = logging.getLogger(__name__)


class TaskNotFoundError(Exception):
    pass


class ParentTaskNotFoundError(Exception):
    pass


class TaskEnqueueError(Exception):
    pass


class TaskRetryNotAllowedError(Exception):
    pass


class TaskRetryLimitError(Exception):
    pass


class TaskCancelNotAllowedError(Exception):
    pass


class TaskTemplateNotFoundError(Exception):
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
        queued_task = self._enqueue_llm_task(task_id=task.id)
        return queued_task

    def list_tasks(self, data: TaskListInput):
        return self.repository.list(limit=data.limit, offset=data.offset)

    def get_task(self, data: TaskGetInput):
        task = self.repository.get_by_id(data.id)
        if task is None:
            raise TaskNotFoundError("Task not found")
        return task

    def retry_task(self, data: TaskRetryInput):
        task = self.repository.get_by_id(data.id)
        if task is None:
            raise TaskNotFoundError("Task not found")
        if task.status != TaskStatus.failed:
            raise TaskRetryNotAllowedError("Only failed tasks can be retried")
        if task.retry_count >= task.max_retries:
            raise TaskRetryLimitError("Task has reached maximum retry limit")

        queued_task = self._enqueue_llm_task(
            task_id=task.id,
            increment_retry_count=True,
        )
        return queued_task

    def cancel_task(self, data: TaskCancelInput):
        task = self.repository.get_by_id(data.id)
        if task is None:
            raise TaskNotFoundError("Task not found")
        if task.status in {
            TaskStatus.completed,
            TaskStatus.failed,
            TaskStatus.cancelled,
        }:
            raise TaskCancelNotAllowedError("Only pending, queued, or running tasks can be cancelled")

        latest_execution = self.repository.get_latest_execution_for_task(task.id)
        celery_task_id = latest_execution.celery_task_id if latest_execution else None

        if celery_task_id:
            try:
                celery_app.control.revoke(celery_task_id, terminate=False)
            except Exception:  # pragma: no cover - depends on broker/worker state
                logger.warning(
                    "Failed to revoke celery task task_id=%s celery_task_id=%s",
                    task.id,
                    celery_task_id,
                    exc_info=True,
                )

        cancelled_task = self.repository.mark_cancelled(
            task_id=task.id,
            reason="Task cancelled by user request",
        )
        if cancelled_task is None:
            raise TaskNotFoundError("Task not found")
        return cancelled_task

    def create_tasks_batch(self, data: TaskBatchCreateInput):
        created_tasks: list[Task] = []
        for item in data.tasks:
            created_tasks.append(
                self.create_task(
                    TaskCreateInput(
                        name=item.name,
                        prompt=item.prompt,
                        parent_task_id=item.parent_task_id,
                        created_by=item.created_by,
                    )
                )
            )
        return created_tasks

    def list_task_templates(self) -> tuple[TaskTemplateDefinition, ...]:
        return DEFAULT_TASK_TEMPLATES

    def create_task_from_template(self, data: TaskTemplateCreateInput):
        template = self._get_template_by_id(data.template_id)
        rendered_prompt = template.render_prompt(input_text=data.input_text)
        task_name = data.name.strip() if data.name else f"{template.name} Task"

        return self.create_task(
            TaskCreateInput(
                name=task_name,
                prompt=rendered_prompt,
                parent_task_id=data.parent_task_id,
                created_by=data.created_by,
            )
        )

    def get_task_lineage(
        self,
        data: TaskLineageInput,
    ) -> tuple[Task, list[tuple[Task, int]], list[tuple[Task, int]]]:
        root_task = self.repository.get_by_id(data.id)
        if root_task is None:
            raise TaskNotFoundError("Task not found")

        ancestors = self.repository.list_ancestors(
            task_id=root_task.id,
            max_depth=data.max_depth,
        )
        descendants = self.repository.list_descendants(
            task_id=root_task.id,
            max_depth=data.max_depth,
        )
        return (
            root_task,
            ancestors,
            descendants,
        )

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
        increment_retry_count: bool = False,
    ):
        task = self.repository.get_by_id(task_id)
        if task is None:
            raise TaskNotFoundError("Task not found")

        celery_task_id = str(uuid4())
        queued_task = self.repository.enqueue_execution(
            task_id=task.id,
            celery_task_id=celery_task_id,
            increment_retry_count=increment_retry_count,
        )
        if queued_task is None:
            raise TaskNotFoundError("Task not found")

        try:
            celery_app.send_task(
                EXECUTE_LLM_TASK_NAME,
                kwargs={"task_id": str(task.id)},
                task_id=celery_task_id,
            )
        except Exception as exc:  # pragma: no cover - network/system dependent
            self.repository.mark_failed(
                task_id=task.id,
                celery_task_id=celery_task_id,
                error_message="Failed to submit task to Celery",
                error_type="TaskEnqueueError",
            )
            raise TaskEnqueueError("Failed to submit task to Celery") from exc

        return queued_task

    def _get_template_by_id(self, template_id: str) -> TaskTemplateDefinition:
        normalized_id = template_id.strip()
        for template in DEFAULT_TASK_TEMPLATES:
            if template.template_id == normalized_id:
                return template
        raise TaskTemplateNotFoundError("Task template not found")
