from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.task import Task, TaskExecution, TaskStatus


class TaskRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def create(
        self,
        *,
        name: str,
        prompt: str,
        parent_task_id: uuid.UUID | None,
        created_by: str | None,
    ) -> Task:
        task = Task(
            name=name,
            prompt=prompt,
            parent_task_id=parent_task_id,
            created_by=created_by,
        )
        self.db.add(task)
        self.db.commit()
        self.db.refresh(task)
        return task

    def list(self, *, limit: int, offset: int) -> list[Task]:
        stmt = (
            select(Task)
            .options(selectinload(Task.executions))
            .order_by(Task.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self.db.scalars(stmt))

    def get_by_id(self, task_id: uuid.UUID) -> Task | None:
        stmt = (
            select(Task)
            .options(selectinload(Task.executions))
            .where(Task.id == task_id)
        )
        return self.db.scalar(stmt)

    def enqueue_execution(
        self,
        *,
        task_id: uuid.UUID,
        celery_task_id: str,
        increment_retry_count: bool = False,
    ) -> Task | None:
        task = self.get_by_id(task_id)
        if task is None:
            return None

        attempt_number = self._next_attempt_number(task_id)
        if increment_retry_count:
            task.retry_count += 1
        task.status = TaskStatus.queued
        task.started_at = None
        task.completed_at = None
        task.output = None
        task.error_message = None

        execution = TaskExecution(
            task_id=task.id,
            attempt_number=attempt_number,
            status=TaskStatus.queued,
            celery_task_id=celery_task_id,
        )
        self.db.add(execution)
        self.db.commit()
        self.db.refresh(task)
        return task

    def mark_running(
        self,
        *,
        task_id: uuid.UUID,
        celery_task_id: str,
        worker_id: str | None,
    ) -> Task | None:
        task = self.get_by_id(task_id)
        if task is None:
            return None

        if task.status == TaskStatus.cancelled:
            return task

        now = datetime.now(tz=UTC)
        task.status = TaskStatus.running
        task.started_at = now
        task.completed_at = None
        task.error_message = None

        execution = self._get_execution_by_celery_task_id(celery_task_id)
        if execution is None:
            execution = TaskExecution(
                task_id=task.id,
                attempt_number=self._next_attempt_number(task.id),
                status=TaskStatus.running,
                started_at=now,
                worker_id=worker_id,
                celery_task_id=celery_task_id,
            )
            self.db.add(execution)
        else:
            execution.status = TaskStatus.running
            execution.started_at = now
            execution.completed_at = None
            execution.error_message = None
            execution.error_type = None
            execution.worker_id = worker_id

        self.db.commit()
        self.db.refresh(task)
        return task

    def mark_completed(
        self,
        *,
        task_id: uuid.UUID,
        celery_task_id: str,
        output: str,
        model_name: str | None = None,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        total_tokens: int | None = None,
    ) -> Task | None:
        task = self.get_by_id(task_id)
        if task is None:
            return None

        if task.status == TaskStatus.cancelled:
            execution = self._get_execution_by_celery_task_id(celery_task_id)
            if execution is not None:
                execution.status = TaskStatus.cancelled
            self.db.commit()
            self.db.refresh(task)
            return task

        now = datetime.now(tz=UTC)
        task.status = TaskStatus.completed
        task.output = output
        task.error_message = None
        task.completed_at = now

        execution = self._get_execution_by_celery_task_id(celery_task_id)
        if execution is not None:
            execution.status = TaskStatus.completed
            execution.output = output
            execution.error_message = None
            execution.error_type = None
            execution.model_name = model_name
            execution.prompt_tokens = prompt_tokens
            execution.completion_tokens = completion_tokens
            execution.total_tokens = total_tokens
            execution.completed_at = now

        self.db.commit()
        self.db.refresh(task)
        return task

    def mark_failed(
        self,
        *,
        task_id: uuid.UUID,
        celery_task_id: str,
        error_message: str,
        error_type: str,
    ) -> Task | None:
        task = self.get_by_id(task_id)
        if task is None:
            return None

        if task.status == TaskStatus.cancelled:
            execution = self._get_execution_by_celery_task_id(celery_task_id)
            if execution is not None:
                execution.status = TaskStatus.cancelled
            self.db.commit()
            self.db.refresh(task)
            return task

        now = datetime.now(tz=UTC)
        task.status = TaskStatus.failed
        task.error_message = error_message
        task.completed_at = now

        execution = self._get_execution_by_celery_task_id(celery_task_id)
        if execution is not None:
            execution.status = TaskStatus.failed
            execution.error_message = error_message
            execution.error_type = error_type
            execution.completed_at = now

        self.db.commit()
        self.db.refresh(task)
        return task

    def get_latest_execution_for_task(self, task_id: uuid.UUID) -> TaskExecution | None:
        stmt = (
            select(TaskExecution)
            .where(TaskExecution.task_id == task_id)
            .order_by(TaskExecution.attempt_number.desc(), TaskExecution.created_at.desc())
            .limit(1)
        )
        return self.db.scalar(stmt)

    def mark_cancelled(self, *, task_id: uuid.UUID, reason: str) -> Task | None:
        task = self.get_by_id(task_id)
        if task is None:
            return None

        now = datetime.now(tz=UTC)
        task.status = TaskStatus.cancelled
        task.error_message = reason
        task.completed_at = now

        execution = self.get_latest_execution_for_task(task_id)
        if execution is not None and execution.status in {
            TaskStatus.pending,
            TaskStatus.queued,
            TaskStatus.running,
        }:
            execution.status = TaskStatus.cancelled
            execution.error_message = reason
            execution.error_type = "TaskCancelled"
            execution.completed_at = now

        self.db.commit()
        self.db.refresh(task)
        return task

    def list_ancestors(self, *, task_id: uuid.UUID, max_depth: int) -> list[tuple[Task, int]]:
        ancestors: list[tuple[Task, int]] = []
        current = self.get_by_id(task_id)
        if current is None:
            return ancestors

        depth = 1
        parent_id = current.parent_task_id
        while parent_id is not None and depth <= max_depth:
            parent = self.get_by_id(parent_id)
            if parent is None:
                break
            ancestors.append((parent, depth))
            parent_id = parent.parent_task_id
            depth += 1

        return ancestors

    def list_descendants(self, *, task_id: uuid.UUID, max_depth: int) -> list[tuple[Task, int]]:
        descendants: list[tuple[Task, int]] = []
        frontier: list[uuid.UUID] = [task_id]
        depth = 1

        while frontier and depth <= max_depth:
            stmt = (
                select(Task)
                .options(selectinload(Task.executions))
                .where(Task.parent_task_id.in_(frontier))
                .order_by(Task.created_at.asc())
            )
            children = list(self.db.scalars(stmt))
            if not children:
                break

            descendants.extend((child, depth) for child in children)
            frontier = [child.id for child in children]
            depth += 1

        return descendants

    def _next_attempt_number(self, task_id: uuid.UUID) -> int:
        stmt = select(func.max(TaskExecution.attempt_number)).where(
            TaskExecution.task_id == task_id
        )
        max_attempt = self.db.scalar(stmt)
        return int(max_attempt or 0) + 1

    def _get_execution_by_celery_task_id(self, celery_task_id: str) -> TaskExecution | None:
        stmt = (
            select(TaskExecution)
            .where(TaskExecution.celery_task_id == celery_task_id)
            .order_by(TaskExecution.created_at.desc())
            .limit(1)
        )
        return self.db.scalar(stmt)
