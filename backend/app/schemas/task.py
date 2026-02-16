from __future__ import annotations

from typing import Annotated
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TaskCreateInput(BaseModel):
    name: Annotated[str, Field(min_length=1, max_length=255)]
    prompt: Annotated[str, Field(min_length=1)]
    parent_task_id: UUID | None = None
    created_by: Annotated[str | None, Field(max_length=255)] = None


class TaskListInput(BaseModel):
    limit: Annotated[int, Field(ge=1, le=200)] = 50
    offset: Annotated[int, Field(ge=0)] = 0


class TaskGetInput(BaseModel):
    id: UUID


class TaskTriggerTestInput(BaseModel):
    id: UUID
    sleep_seconds: Annotated[int, Field(ge=1, le=300)] = 5


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    prompt: str
