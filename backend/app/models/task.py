from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class TaskStatus(str, enum.Enum):
    pending = "pending"
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class ExecutionPriority(str, enum.Enum):
    low = "low"
    normal = "normal"
    high = "high"
    critical = "critical"


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (
        Index(
            "idx_tasks_status",
            "status",
            postgresql_where=text("status IN ('pending', 'queued', 'running')"),
        ),
        Index(
            "idx_tasks_scheduled_at",
            "scheduled_at",
            postgresql_where=text("status IN ('pending', 'queued')"),
        ),
        Index(
            "idx_tasks_execute_after",
            "execute_after",
            postgresql_where=text("execute_after IS NOT NULL AND status = 'pending'"),
        ),
        Index(
            "idx_tasks_parent_task_id",
            "parent_task_id",
            postgresql_where=text("parent_task_id IS NOT NULL"),
        ),
        Index("idx_tasks_created_at", text("created_at DESC")),
        Index(
            "idx_tasks_priority_status",
            text("priority DESC"),
            text("scheduled_at ASC"),
            postgresql_where=text("status IN ('pending', 'queued')"),
        ),
        Index("idx_tasks_metadata", "metadata", postgresql_using="gin"),
        CheckConstraint(
            "retry_count >= 0 AND retry_count <= max_retries",
            name="valid_retry_count",
        ),
        CheckConstraint(
            "chain_position IS NULL OR chain_position >= 0",
            name="valid_chain_position",
        ),
        CheckConstraint(
            "(started_at IS NULL OR completed_at IS NULL OR completed_at >= started_at) "
            "AND (execute_after IS NULL OR execute_after >= scheduled_at)",
            name="valid_execution_window",
        ),
        {"comment": "Core task definitions and current state"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status", create_type=False),
        nullable=False,
        server_default=text("'pending'::task_status"),
    )
    priority: Mapped[ExecutionPriority] = mapped_column(
        Enum(ExecutionPriority, name="execution_priority", create_type=False),
        nullable=False,
        server_default=text("'normal'::execution_priority"),
    )

    scheduled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
    execute_after: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        comment="Delayed execution - task will not run before this time",
    )

    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    output: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)

    max_retries: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("3"),
    )
    retry_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        server_default=text("0"),
    )

    parent_task_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="SET NULL"),
    )
    chain_position: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
    created_by: Mapped[str | None] = mapped_column(String(255))

    meta: Mapped[dict] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
        comment="Flexible JSONB field for custom metadata, tags, or configuration",
    )

    parent: Mapped[Task | None] = relationship(
        "Task",
        remote_side=[id],
        backref="children",
        foreign_keys=[parent_task_id],
    )
    executions: Mapped[list[TaskExecution]] = relationship(
        "TaskExecution",
        back_populates="task",
        cascade="all, delete-orphan",
    )


class TaskExecution(Base):
    __tablename__ = "task_executions"
    __table_args__ = (
        Index("idx_task_executions_task_id", "task_id"),
        Index("idx_task_executions_status", "status"),
        Index("idx_task_executions_created_at", text("created_at DESC")),
        Index(
            "idx_task_executions_celery_task_id",
            "celery_task_id",
            postgresql_where=text("celery_task_id IS NOT NULL"),
        ),
        CheckConstraint("attempt_number > 0", name="valid_attempt"),
        CheckConstraint(
            "(prompt_tokens IS NULL AND completion_tokens IS NULL AND total_tokens IS NULL) "
            "OR (prompt_tokens >= 0 AND completion_tokens >= 0 AND total_tokens >= 0)",
            name="valid_tokens",
        ),
        CheckConstraint(
            "started_at IS NULL OR completed_at IS NULL OR completed_at >= started_at",
            name="valid_execution_time",
        ),
        UniqueConstraint("task_id", "attempt_number", name="unique_task_attempt"),
        {"comment": "Detailed execution attempts for retry tracking and audit trail"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
    )

    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status", create_type=False),
        nullable=False,
        server_default=text("'queued'::task_status"),
    )

    queued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None] = mapped_column(Integer)

    model_name: Mapped[str | None] = mapped_column(String(100))
    prompt_tokens: Mapped[int | None] = mapped_column(Integer)
    completion_tokens: Mapped[int | None] = mapped_column(Integer)
    total_tokens: Mapped[int | None] = mapped_column(Integer)

    output: Mapped[str | None] = mapped_column(Text)
    error_message: Mapped[str | None] = mapped_column(Text)
    error_type: Mapped[str | None] = mapped_column(String(100))

    worker_id: Mapped[str | None] = mapped_column(
        String(100),
        comment="Identifier of the Celery worker that processed this execution",
    )
    celery_task_id: Mapped[str | None] = mapped_column(String(255))

    execution_metadata: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{}'::jsonb"),
        comment="Detailed execution metrics: latency breakdown, API response headers, etc.",
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )

    task: Mapped[Task] = relationship("Task", back_populates="executions")


class TaskChain(Base):
    __tablename__ = "task_chains"
    __table_args__ = (
        Index("idx_task_chains_root_task_id", "root_task_id"),
        Index("idx_task_chains_status", "status"),
        UniqueConstraint("root_task_id", name="unique_root_task"),
        {"comment": "Chain metadata for grouped task workflows"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    chain_name: Mapped[str | None] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)

    root_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
    )

    status: Mapped[TaskStatus | None] = mapped_column(
        Enum(TaskStatus, name="task_status", create_type=False),
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )


class TaskChainEdge(Base):
    __tablename__ = "task_chain_edges"
    __table_args__ = (
        Index("idx_task_chain_edges_chain_id", "chain_id"),
        Index("idx_task_chain_edges_parent_task_id", "parent_task_id"),
        Index("idx_task_chain_edges_child_task_id", "child_task_id"),
        CheckConstraint("parent_task_id != child_task_id", name="no_self_reference"),
        UniqueConstraint("parent_task_id", "child_task_id", name="unique_edge"),
        {"comment": "Parent-child relationships between tasks in chains"},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("uuid_generate_v4()"),
    )
    chain_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("task_chains.id", ondelete="CASCADE"),
        nullable=False,
    )

    parent_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    child_task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
    )

    output_mapping: Mapped[dict | None] = mapped_column(JSONB)
    condition: Mapped[dict | None] = mapped_column(JSONB)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("NOW()"),
    )
