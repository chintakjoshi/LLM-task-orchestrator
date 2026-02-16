import { ExecutionPriority, TaskStatus } from "./generated/orchestrator/v1/tasks";

const STATUS_LABELS: Record<number, string> = {
  [TaskStatus.TASK_STATUS_PENDING]: "pending",
  [TaskStatus.TASK_STATUS_QUEUED]: "queued",
  [TaskStatus.TASK_STATUS_RUNNING]: "running",
  [TaskStatus.TASK_STATUS_COMPLETED]: "completed",
  [TaskStatus.TASK_STATUS_FAILED]: "failed",
  [TaskStatus.TASK_STATUS_CANCELLED]: "cancelled",
};

const PRIORITY_LABELS: Record<number, string> = {
  [ExecutionPriority.EXECUTION_PRIORITY_LOW]: "low",
  [ExecutionPriority.EXECUTION_PRIORITY_NORMAL]: "normal",
  [ExecutionPriority.EXECUTION_PRIORITY_HIGH]: "high",
  [ExecutionPriority.EXECUTION_PRIORITY_CRITICAL]: "critical",
};

export function taskStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? "unknown";
}

export function taskPriorityLabel(priority: ExecutionPriority): string {
  return PRIORITY_LABELS[priority] ?? "unknown";
}

export function formatTimestamp(value: Date | string | undefined): string {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}
