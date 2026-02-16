from __future__ import annotations

from datetime import UTC, datetime

from google.protobuf.timestamp_pb2 import Timestamp

from app.models.task import ExecutionPriority, Task, TaskStatus
from orchestrator.v1 import tasks_pb2

_STATUS_TO_PROTO = {
    TaskStatus.pending: tasks_pb2.TASK_STATUS_PENDING,
    TaskStatus.queued: tasks_pb2.TASK_STATUS_QUEUED,
    TaskStatus.running: tasks_pb2.TASK_STATUS_RUNNING,
    TaskStatus.completed: tasks_pb2.TASK_STATUS_COMPLETED,
    TaskStatus.failed: tasks_pb2.TASK_STATUS_FAILED,
    TaskStatus.cancelled: tasks_pb2.TASK_STATUS_CANCELLED,
}

_PRIORITY_TO_PROTO = {
    ExecutionPriority.low: tasks_pb2.EXECUTION_PRIORITY_LOW,
    ExecutionPriority.normal: tasks_pb2.EXECUTION_PRIORITY_NORMAL,
    ExecutionPriority.high: tasks_pb2.EXECUTION_PRIORITY_HIGH,
    ExecutionPriority.critical: tasks_pb2.EXECUTION_PRIORITY_CRITICAL,
}


def _to_timestamp(value: datetime | None) -> Timestamp | None:
    if value is None:
        return None

    ts = Timestamp()
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    ts.FromDatetime(value.astimezone(UTC))
    return ts


def to_proto_task(task: Task) -> tasks_pb2.Task:
    message = tasks_pb2.Task(
        id=str(task.id),
        name=task.name,
        prompt=task.prompt,
        status=_STATUS_TO_PROTO.get(task.status, tasks_pb2.TASK_STATUS_UNSPECIFIED),
        priority=_PRIORITY_TO_PROTO.get(
            task.priority,
            tasks_pb2.EXECUTION_PRIORITY_UNSPECIFIED,
        ),
        output=task.output or "",
        error_message=task.error_message or "",
        retry_count=task.retry_count,
        max_retries=task.max_retries,
        parent_task_id=str(task.parent_task_id) if task.parent_task_id else "",
        chain_position=task.chain_position or 0,
        created_by=task.created_by or "",
    )

    scheduled_at = _to_timestamp(task.scheduled_at)
    if scheduled_at is not None:
        message.scheduled_at.CopyFrom(scheduled_at)

    execute_after = _to_timestamp(task.execute_after)
    if execute_after is not None:
        message.execute_after.CopyFrom(execute_after)

    started_at = _to_timestamp(task.started_at)
    if started_at is not None:
        message.started_at.CopyFrom(started_at)

    completed_at = _to_timestamp(task.completed_at)
    if completed_at is not None:
        message.completed_at.CopyFrom(completed_at)

    created_at = _to_timestamp(task.created_at)
    if created_at is not None:
        message.created_at.CopyFrom(created_at)

    updated_at = _to_timestamp(task.updated_at)
    if updated_at is not None:
        message.updated_at.CopyFrom(updated_at)

    return message


def to_proto_task_list(tasks: list[Task]) -> list[tasks_pb2.Task]:
    return [to_proto_task(task) for task in tasks]
