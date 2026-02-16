from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, Field


class TaskCreateInput(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=255)]
    prompt: Annotated[str, Field(min_length=1)]
    parent_task_id: UUID | None = None
    created_by: Annotated[str | None, Field(max_length=255)] = None
    execute_after: datetime | None = None


class TaskListInput(BaseModel):
    limit: Annotated[int, Field(ge=1, le=200)] = 50
    offset: Annotated[int, Field(ge=0)] = 0


class TaskGetInput(BaseModel):
    id: UUID


class TaskRetryInput(BaseModel):
    id: UUID


class TaskCancelInput(BaseModel):
    id: UUID


class TaskBatchCreateItem(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=255)]
    prompt: Annotated[str, Field(min_length=1)]
    parent_task_id: UUID | None = None
    created_by: Annotated[str | None, Field(max_length=255)] = None


class TaskBatchCreateInput(BaseModel):
    tasks: Annotated[list[TaskBatchCreateItem], Field(min_length=1, max_length=50)]


class TaskTemplateCreateInput(BaseModel):
    template_id: Annotated[str, Field(min_length=1, max_length=64)]
    input_text: Annotated[str, Field(min_length=1)]
    name: Annotated[str | None, Field(min_length=1, max_length=255)] = None
    parent_task_id: UUID | None = None
    created_by: Annotated[str | None, Field(max_length=255)] = None


class TaskLineageInput(BaseModel):
    id: UUID
    max_depth: Annotated[int, Field(ge=1, le=20)] = 10
