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

const ACTIVE_STATUSES = new Set<TaskStatus>([
  TaskStatus.TASK_STATUS_PENDING,
  TaskStatus.TASK_STATUS_QUEUED,
  TaskStatus.TASK_STATUS_RUNNING,
]);

const STATUS_BADGE_CLASSES: Partial<Record<TaskStatus, string>> = {
  [TaskStatus.TASK_STATUS_PENDING]:
    "border-amber-200 bg-amber-50 text-amber-700",
  [TaskStatus.TASK_STATUS_QUEUED]:
    "border-sky-200 bg-sky-50 text-sky-700",
  [TaskStatus.TASK_STATUS_RUNNING]:
    "border-indigo-200 bg-indigo-50 text-indigo-700",
  [TaskStatus.TASK_STATUS_COMPLETED]:
    "border-emerald-200 bg-emerald-50 text-emerald-700",
  [TaskStatus.TASK_STATUS_FAILED]:
    "border-rose-200 bg-rose-50 text-rose-700",
  [TaskStatus.TASK_STATUS_CANCELLED]:
    "border-slate-300 bg-slate-100 text-slate-700",
};

export function taskStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? "unknown";
}

export function taskPriorityLabel(priority: ExecutionPriority): string {
  return PRIORITY_LABELS[priority] ?? "unknown";
}

export function isTaskActive(status: TaskStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export function taskStatusBadgeClass(status: TaskStatus): string {
  return STATUS_BADGE_CLASSES[status] ?? "border-slate-300 bg-slate-100 text-slate-700";
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
