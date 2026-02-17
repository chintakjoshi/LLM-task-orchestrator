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
    "border-amber-500/40 bg-amber-500/10 text-amber-200",
  [TaskStatus.TASK_STATUS_QUEUED]:
    "border-sky-500/40 bg-sky-500/10 text-sky-200",
  [TaskStatus.TASK_STATUS_RUNNING]:
    "border-violet-500/40 bg-violet-500/10 text-violet-200",
  [TaskStatus.TASK_STATUS_COMPLETED]:
    "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
  [TaskStatus.TASK_STATUS_FAILED]:
    "border-rose-500/40 bg-rose-500/10 text-rose-200",
  [TaskStatus.TASK_STATUS_CANCELLED]:
    "border-slate-600 bg-slate-800/70 text-slate-300",
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
  return STATUS_BADGE_CLASSES[status] ?? "border-slate-600 bg-slate-800/70 text-slate-300";
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

export function formatDurationMs(durationMs: string | number | undefined): string {
  if (durationMs === undefined) {
    return "-";
  }

  const value =
    typeof durationMs === "string"
      ? Number.parseInt(durationMs, 10)
      : durationMs;

  if (!Number.isFinite(value) || value <= 0) {
    return "-";
  }
  if (value < 1_000) {
    return `${value} ms`;
  }
  return `${(value / 1_000).toFixed(2)} s`;
}
