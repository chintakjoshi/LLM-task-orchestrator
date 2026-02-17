from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import String, cast, func, or_, select
from sqlalchemy.orm import Session

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
        execute_after: datetime | None,
        commit: bool = True,
    ) -> Task:
        task = Task(
            name=name,
            prompt=prompt,
            parent_task_id=parent_task_id,
            created_by=created_by,
            execute_after=execute_after,
        )
        self.db.add(task)
        self.db.flush()
        self.db.refresh(task)
        if commit:
            self.db.commit()
            self.db.refresh(task)
        return task

    def list(
        self,
        *,
        limit: int,
        offset: int,
        status_filter: TaskStatus | None = None,
        query: str | None = None,
    ) -> tuple[list[Task], int]:
        filters = self._task_filters(
            status_filter=status_filter,
            query=query,
        )

        stmt = (
            select(Task)
            .order_by(Task.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        count_stmt = select(func.count(Task.id))

        if filters:
            stmt = stmt.where(*filters)
            count_stmt = count_stmt.where(*filters)

        tasks = list(self.db.scalars(stmt))
        self._attach_latest_executions(tasks)
        total_count = int(self.db.scalar(count_stmt) or 0)
        return tasks, total_count

    def get_by_id(self, task_id: uuid.UUID) -> Task | None:
        stmt = select(Task).where(Task.id == task_id)
        task = self.db.scalar(stmt)
        if task is None:
            return None
        self._attach_latest_executions([task])
        return task

    def get_by_id_for_update(self, task_id: uuid.UUID) -> Task | None:
        stmt = select(Task).where(Task.id == task_id).with_for_update()
        task = self.db.scalar(stmt)
        if task is None:
            return None
        self._attach_latest_executions([task])
        return task

    def enqueue_execution(
        self,
        *,
        task_id: uuid.UUID,
        celery_task_id: str,
        increment_retry_count: bool = False,
        commit: bool = True,
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
        self.db.flush()
        if commit:
            self.db.commit()
            self.db.refresh(task)
            self._attach_latest_executions([task])
        return task

    def mark_running(
        self,
        *,
        task_id: uuid.UUID,
        celery_task_id: str,
        worker_id: str | None,
    ) -> Task | None:
        task = self.get_by_id_for_update(task_id)
        if task is None:
            return None

        if task.status in {
            TaskStatus.completed,
            TaskStatus.failed,
            TaskStatus.cancelled,
        }:
            return task

        if not self._is_latest_execution(task_id=task.id, celery_task_id=celery_task_id):
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
        self._attach_latest_executions([task])
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
        task = self.get_by_id_for_update(task_id)
        if task is None:
            return None

        if task.status == TaskStatus.cancelled:
            execution = self._get_execution_by_celery_task_id(celery_task_id)
            if execution is not None:
                execution.status = TaskStatus.cancelled
            self.db.commit()
            self.db.refresh(task)
            self._attach_latest_executions([task])
            return task

        if task.status in {TaskStatus.completed, TaskStatus.failed}:
            return task

        if not self._is_latest_execution(task_id=task.id, celery_task_id=celery_task_id):
            return task

        now = datetime.now(tz=UTC)
        task.status = TaskStatus.completed
        task.output = output
        task.error_message = None
        task.completed_at = self._resolve_completed_at(now=now, started_at=task.started_at)

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
            execution.completed_at = self._resolve_completed_at(
                now=now,
                started_at=execution.started_at,
            )

        self.db.commit()
        self.db.refresh(task)
        self._attach_latest_executions([task])
        return task

    def mark_failed(
        self,
        *,
        task_id: uuid.UUID,
        celery_task_id: str,
        error_message: str,
        error_type: str,
        commit: bool = True,
    ) -> Task | None:
        task = self.get_by_id_for_update(task_id)
        if task is None:
            return None

        if task.status == TaskStatus.cancelled:
            execution = self._get_execution_by_celery_task_id(celery_task_id)
            if execution is not None:
                execution.status = TaskStatus.cancelled
            if commit:
                self.db.commit()
                self.db.refresh(task)
                self._attach_latest_executions([task])
            else:
                self.db.flush()
            return task

        if task.status in {TaskStatus.completed, TaskStatus.failed}:
            return task

        if not self._is_latest_execution(task_id=task.id, celery_task_id=celery_task_id):
            return task

        now = datetime.now(tz=UTC)
        task.status = TaskStatus.failed
        task.error_message = error_message
        task.completed_at = self._resolve_completed_at(now=now, started_at=task.started_at)

        execution = self._get_execution_by_celery_task_id(celery_task_id)
        if execution is not None:
            execution.status = TaskStatus.failed
            execution.error_message = error_message
            execution.error_type = error_type
            execution.completed_at = self._resolve_completed_at(
                now=now,
                started_at=execution.started_at,
            )

        if commit:
            self.db.commit()
            self.db.refresh(task)
            self._attach_latest_executions([task])
        else:
            self.db.flush()
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
        task = self.get_by_id_for_update(task_id)
        if task is None:
            return None

        now = datetime.now(tz=UTC)
        task.status = TaskStatus.cancelled
        task.error_message = reason
        task.completed_at = self._resolve_completed_at(now=now, started_at=task.started_at)

        execution = self.get_latest_execution_for_task(task_id)
        if execution is not None and execution.status in {
            TaskStatus.pending,
            TaskStatus.queued,
            TaskStatus.running,
        }:
            execution.status = TaskStatus.cancelled
            execution.error_message = reason
            execution.error_type = "TaskCancelled"
            execution.completed_at = self._resolve_completed_at(
                now=now,
                started_at=execution.started_at,
            )

        self.db.commit()
        self.db.refresh(task)
        self._attach_latest_executions([task])
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
                .where(Task.parent_task_id.in_(frontier))
                .order_by(Task.created_at.asc())
            )
            children = list(self.db.scalars(stmt))
            if not children:
                break

            self._attach_latest_executions(children)
            descendants.extend((child, depth) for child in children)
            frontier = [child.id for child in children]
            depth += 1

        return descendants

    def list_existing_task_ids(self, task_ids: set[uuid.UUID]) -> set[uuid.UUID]:
        if not task_ids:
            return set()
        stmt = select(Task.id).where(Task.id.in_(task_ids))
        return set(self.db.scalars(stmt))

    def _task_filters(
        self,
        *,
        status_filter: TaskStatus | None,
        query: str | None,
    ) -> list[object]:
        filters: list[object] = []
        if status_filter is not None:
            filters.append(Task.status == status_filter)

        normalized_query = (query or "").strip()
        if normalized_query:
            like_query = f"%{normalized_query}%"
            filters.append(
                or_(
                    cast(Task.id, String).ilike(like_query),
                    Task.name.ilike(like_query),
                    Task.prompt.ilike(like_query),
                    Task.output.ilike(like_query),
                    Task.error_message.ilike(like_query),
                )
            )
        return filters

    def _attach_latest_executions(self, tasks: list[Task]) -> None:
        if not tasks:
            return

        task_ids = [task.id for task in tasks]
        ranked_executions = (
            select(
                TaskExecution.id.label("execution_id"),
                TaskExecution.task_id.label("task_id"),
                func.row_number()
                .over(
                    partition_by=TaskExecution.task_id,
                    order_by=(
                        TaskExecution.attempt_number.desc(),
                        TaskExecution.created_at.desc(),
                    ),
                )
                .label("rank"),
            )
            .where(TaskExecution.task_id.in_(task_ids))
            .subquery()
        )

        latest_stmt = (
            select(TaskExecution)
            .join(
                ranked_executions,
                TaskExecution.id == ranked_executions.c.execution_id,
            )
            .where(ranked_executions.c.rank == 1)
        )
        latest_executions = list(self.db.scalars(latest_stmt))
        latest_by_task_id = {
            execution.task_id: execution
            for execution in latest_executions
        }

        for task in tasks:
            setattr(task, "_latest_execution", latest_by_task_id.get(task.id))

    def _is_latest_execution(self, *, task_id: uuid.UUID, celery_task_id: str) -> bool:
        latest_execution = self.get_latest_execution_for_task(task_id)
        if latest_execution is None:
            return False
        return latest_execution.celery_task_id == celery_task_id

    @staticmethod
    def _resolve_completed_at(*, now: datetime, started_at: datetime | None) -> datetime:
        if started_at is None:
            return now
        if now >= started_at:
            return now
        return started_at

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
