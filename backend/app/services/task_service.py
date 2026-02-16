from __future__ import annotations

from sqlalchemy.orm import Session

from app.repositories.task_repository import TaskRepository
from app.schemas.task import TaskCreateInput, TaskGetInput, TaskListInput


class TaskNotFoundError(Exception):
    pass


class ParentTaskNotFoundError(Exception):
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

        return self.repository.create(
            name=data.name,
            prompt=data.prompt,
            parent_task_id=parent_task_id,
            created_by=data.created_by,
        )

    def list_tasks(self, data: TaskListInput):
        return self.repository.list(limit=data.limit, offset=data.offset)

    def get_task(self, data: TaskGetInput):
        task = self.repository.get_by_id(data.id)
        if task is None:
            raise TaskNotFoundError("Task not found")
        return task
