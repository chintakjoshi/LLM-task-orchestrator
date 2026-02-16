from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.task import Task


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
            .order_by(Task.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        return list(self.db.scalars(stmt))

    def get_by_id(self, task_id: uuid.UUID) -> Task | None:
        stmt = select(Task).where(Task.id == task_id)
        return self.db.scalar(stmt)
