from __future__ import annotations

from datetime import UTC, datetime

from google.protobuf.timestamp_pb2 import Timestamp

from app.models.task import ExecutionPriority, Task, TaskExecution, TaskStatus
from app.services.task_templates import TaskTemplateDefinition
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


def _latest_execution(task: Task) -> TaskExecution | None:
    if hasattr(task, "_latest_execution"):
        latest_execution = getattr(task, "_latest_execution")
        if isinstance(latest_execution, TaskExecution) or latest_execution is None:
            return latest_execution
    if not task.executions:
        return None
    return max(task.executions, key=lambda execution: (execution.attempt_number, execution.created_at))


def _to_proto_execution_metadata(execution: TaskExecution | None) -> tasks_pb2.ExecutionMetadata | None:
    if execution is None:
        return None

    message = tasks_pb2.ExecutionMetadata(
        attempt_number=execution.attempt_number,
        model_name=execution.model_name or "",
        prompt_tokens=execution.prompt_tokens or 0,
        completion_tokens=execution.completion_tokens or 0,
        total_tokens=execution.total_tokens or 0,
        duration_ms=execution.duration_ms or 0,
        worker_id=execution.worker_id or "",
        celery_task_id=execution.celery_task_id or "",
    )

    queued_at = _to_timestamp(execution.queued_at)
    if queued_at is not None:
        message.queued_at.CopyFrom(queued_at)

    started_at = _to_timestamp(execution.started_at)
    if started_at is not None:
        message.started_at.CopyFrom(started_at)

    completed_at = _to_timestamp(execution.completed_at)
    if completed_at is not None:
        message.completed_at.CopyFrom(completed_at)

    return message


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

    latest_execution = _to_proto_execution_metadata(_latest_execution(task))
    if latest_execution is not None:
        message.latest_execution_metrics.CopyFrom(latest_execution)

    return message


def to_proto_task_list(tasks: list[Task]) -> list[tasks_pb2.Task]:
    return [to_proto_task(task) for task in tasks]


def to_proto_task_templates(
    templates: tuple[TaskTemplateDefinition, ...],
) -> list[tasks_pb2.TaskTemplate]:
    return [
        tasks_pb2.TaskTemplate(
            id=template.template_id,
            name=template.name,
            description=template.description,
            prompt_template=template.prompt_template,
        )
        for template in templates
    ]


def to_proto_lineage_nodes(
    lineage_nodes: list[tuple[Task, int]],
) -> list[tasks_pb2.TaskLineageNode]:
    return [
        tasks_pb2.TaskLineageNode(task=to_proto_task(task), depth=depth)
        for task, depth in lineage_nodes
    ]
