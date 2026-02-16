import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { cancelTask, getTask, getTaskLineage, retryTask } from "../grpc/tasksApi";
import {
  formatDurationMs,
  formatTimestamp,
  isTaskActive,
  taskPriorityLabel,
  taskStatusBadgeClass,
  taskStatusLabel,
} from "../grpc/taskFormatters";
import {
  TaskStatus,
  type Task as TaskRecord,
  type TaskLineageNode,
} from "../grpc/generated/orchestrator/v1/tasks";

const POLL_INTERVAL_MS = 2500;
const SHORT_ID_LENGTH = 8;

interface ResolvedLineageNode {
  task: TaskRecord;
  depth: number;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

function abbreviateId(value: string): string {
  if (value.length <= SHORT_ID_LENGTH) {
    return value;
  }
  return `${value.slice(0, SHORT_ID_LENGTH)}...`;
}

function resolveLineageNodes(nodes: TaskLineageNode[] | undefined): ResolvedLineageNode[] {
  if (!nodes || nodes.length === 0) {
    return [];
  }

  const resolved: ResolvedLineageNode[] = [];
  for (const node of nodes) {
    if (!node.task) {
      continue;
    }
    resolved.push({ task: node.task, depth: node.depth });
  }
  return resolved;
}

export default function TaskDetailPage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [ancestors, setAncestors] = useState<ResolvedLineageNode[]>([]);
  const [descendants, setDescendants] = useState<ResolvedLineageNode[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>("");
  const [lineageWarning, setLineageWarning] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [actionSuccess, setActionSuccess] = useState<string>("");
  const [retrySubmitting, setRetrySubmitting] = useState<boolean>(false);
  const [cancelSubmitting, setCancelSubmitting] = useState<boolean>(false);
  const taskIsActive = task ? isTaskActive(task.status) : false;

  const ancestorPath = useMemo(
    () => [...ancestors].sort((left, right) => right.depth - left.depth),
    [ancestors],
  );

  const loadTask = useCallback(
    async (showLoading: boolean) => {
      if (!taskId) {
        setLoadError("Task ID is missing.");
        setLoading(false);
        return;
      }

      if (showLoading) {
        setLoading(true);
      }

      try {
        const nextTask = await getTask(taskId);
        setTask(nextTask);
        setLoadError("");

        try {
          const lineage = await getTaskLineage(taskId, 10);
          setAncestors(resolveLineageNodes(lineage.ancestors));
          setDescendants(resolveLineageNodes(lineage.descendants));
          setLineageWarning("");
        } catch (lineageErr: unknown) {
          setAncestors([]);
          setDescendants([]);
          setLineageWarning(
            extractErrorMessage(lineageErr, "Lineage links are temporarily unavailable."),
          );
        }
      } catch (err: unknown) {
        setLoadError(extractErrorMessage(err, "Failed to load task."));
        setTask(null);
        setAncestors([]);
        setDescendants([]);
        setLineageWarning("");
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [taskId],
  );

  const handleRetryTask = useCallback(async () => {
    if (!task) {
      return;
    }

    setRetrySubmitting(true);
    setActionError("");
    setActionSuccess("");

    try {
      const queuedTask = await retryTask(task.id);
      setTask(queuedTask);
      setActionSuccess(`Task "${queuedTask.name}" was re-queued for execution.`);
      await loadTask(false);
    } catch (err: unknown) {
      setActionError(extractErrorMessage(err, "Failed to retry task."));
    } finally {
      setRetrySubmitting(false);
    }
  }, [loadTask, task]);

  const handleCancelTask = useCallback(async () => {
    if (!task) {
      return;
    }

    setCancelSubmitting(true);
    setActionError("");
    setActionSuccess("");

    try {
      const cancelledTask = await cancelTask(task.id);
      setTask(cancelledTask);
      setActionSuccess(`Task "${cancelledTask.name}" was cancelled.`);
      await loadTask(false);
    } catch (err: unknown) {
      setActionError(extractErrorMessage(err, "Failed to cancel task."));
    } finally {
      setCancelSubmitting(false);
    }
  }, [loadTask, task]);

  useEffect(() => {
    void loadTask(true);
  }, [loadTask]);

  useEffect(() => {
    if (!taskIsActive) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadTask(false);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [loadTask, taskIsActive]);

  if (loading) {
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">Task Detail</h2>
        <div className="animate-pulse rounded-xl border border-line bg-slate-50/70 p-4">
          <div className="h-4 w-40 rounded bg-slate-200" />
          <div className="mt-3 h-3 w-72 rounded bg-slate-100" />
          <div className="mt-3 h-24 rounded bg-slate-100" />
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">Task Detail</h2>
        <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-3 text-sm font-medium text-rose-700">
          <p>{loadError}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadTask(true)}
              className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:border-rose-400"
            >
              Retry
            </button>
            <Link
              to="/tasks"
              className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 transition hover:border-rose-400"
            >
              Back to tasks
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (!task) {
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">Task Detail</h2>
        <p className="text-sm text-slate-600">Task not found.</p>
        <Link to="/tasks" className="text-sm font-medium text-blue-700 hover:underline">
          Back to tasks
        </Link>
      </section>
    );
  }

  const canChainFromTask =
    task.status === TaskStatus.TASK_STATUS_COMPLETED && Boolean(task.output.trim());
  const canRetryTask =
    task.status === TaskStatus.TASK_STATUS_FAILED && task.retryCount < task.maxRetries;
  const canCancelTask =
    task.status === TaskStatus.TASK_STATUS_PENDING
    || task.status === TaskStatus.TASK_STATUS_QUEUED
    || task.status === TaskStatus.TASK_STATUS_RUNNING;
  const latestMetrics = task.latestExecutionMetrics;

  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-slate-900">Task Detail</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/tasks" className="text-sm font-medium text-blue-700 hover:underline">
            Back to tasks
          </Link>
          <button
            type="button"
            onClick={() => void loadTask(true)}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          {canChainFromTask ? (
            <button
              type="button"
              onClick={() =>
                navigate(`/tasks?parentTaskId=${encodeURIComponent(task.id)}`, {
                  state: {
                    parentTaskId: task.id,
                    parentTaskName: task.name,
                    parentOutput: task.output,
                  },
                })
              }
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Use as New Task
            </button>
          ) : null}
          {canRetryTask ? (
            <button
              type="button"
              onClick={() => void handleRetryTask()}
              disabled={retrySubmitting}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 transition hover:border-amber-400 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {retrySubmitting ? "Re-queueing..." : "Retry Task"}
            </button>
          ) : null}
          {canCancelTask ? (
            <button
              type="button"
              onClick={() => void handleCancelTask()}
              disabled={cancelSubmitting}
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 transition hover:border-rose-400 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelSubmitting ? "Cancelling..." : "Cancel Task"}
            </button>
          ) : null}
        </div>
        {lineageWarning ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
            {lineageWarning}
          </p>
        ) : null}
        {actionSuccess ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
            {actionSuccess}
          </p>
        ) : null}
        {actionError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
            {actionError}
          </p>
        ) : null}
        {taskIsActive ? (
          <p className="text-xs text-slate-500">
            Auto-refreshing every 2.5 seconds while task is active.
          </p>
        ) : null}
      </div>

      <dl className="grid gap-3 rounded-xl border border-line bg-slate-50/70 p-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">ID</dt>
          <dd className="mt-1 break-all text-sm text-slate-800">{task.id}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Name</dt>
          <dd className="mt-1 text-sm text-slate-800">{task.name}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</dt>
          <dd className="mt-1">
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${taskStatusBadgeClass(task.status)}`}
            >
              {taskStatusLabel(task.status)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Priority</dt>
          <dd className="mt-1 text-sm text-slate-800">{taskPriorityLabel(task.priority)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Created At</dt>
          <dd className="mt-1 text-sm text-slate-800">{formatTimestamp(task.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Started At</dt>
          <dd className="mt-1 text-sm text-slate-800">{formatTimestamp(task.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Completed At</dt>
          <dd className="mt-1 text-sm text-slate-800">{formatTimestamp(task.completedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Updated At</dt>
          <dd className="mt-1 text-sm text-slate-800">{formatTimestamp(task.updatedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Retries Used</dt>
          <dd className="mt-1 text-sm text-slate-800">
            {task.retryCount} / {task.maxRetries}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ancestor Count</dt>
          <dd className="mt-1 text-sm text-slate-800">{ancestors.length}</dd>
        </div>
      </dl>

      {latestMetrics ? (
        <div className="space-y-2 rounded-xl border border-line bg-slate-50/70 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Latest Execution Metadata
          </h3>
          <dl className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-500">Attempt</dt>
              <dd>{latestMetrics.attemptNumber || "-"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Model</dt>
              <dd>{latestMetrics.modelName || "-"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Duration</dt>
              <dd>{formatDurationMs(latestMetrics.durationMs)}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Total Tokens</dt>
              <dd>{latestMetrics.totalTokens || "-"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Prompt Tokens</dt>
              <dd>{latestMetrics.promptTokens || "-"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Completion Tokens</dt>
              <dd>{latestMetrics.completionTokens || "-"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Worker</dt>
              <dd>{latestMetrics.workerId || "-"}</dd>
            </div>
            <div>
              <dt className="font-medium text-slate-500">Queued At</dt>
              <dd>{formatTimestamp(latestMetrics.queuedAt)}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="space-y-2 rounded-xl border border-line bg-slate-50/70 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Lineage View</h3>
        {ancestorPath.length > 0 ? (
          <p className="text-sm text-slate-700">
            Ancestor chain:{" "}
            {ancestorPath.map((node, index) => (
              <span key={node.task.id}>
                <Link to={`/tasks/${node.task.id}`} className="font-medium text-blue-700 hover:underline">
                  {node.task.name}
                </Link>
                {index < ancestorPath.length - 1 ? " -> " : ""}
              </span>
            ))}
          </p>
        ) : (
          <p className="text-sm text-slate-600">No ancestor tasks.</p>
        )}

        {descendants.length > 0 ? (
          <ul className="space-y-1 text-sm text-slate-700">
            {descendants.map((node) => (
              <li key={node.task.id} style={{ marginLeft: `${Math.max(0, node.depth - 1) * 16}px` }}>
                <span className="mr-2 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  depth {node.depth}
                </span>
                <Link to={`/tasks/${node.task.id}`} className="font-medium text-blue-700 hover:underline">
                  {node.task.name}
                </Link>
                <span className="ml-2 text-xs text-slate-500">
                  ({taskStatusLabel(node.task.status)})
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">No descendant tasks.</p>
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Prompt</h3>
        <pre className="overflow-x-auto rounded-xl border border-line bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
          {task.prompt}
        </pre>
      </div>

      {task.output ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Output</h3>
          <pre className="overflow-x-auto rounded-xl border border-line bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
            {task.output}
          </pre>
        </div>
      ) : task.status === TaskStatus.TASK_STATUS_COMPLETED ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Task completed with no output content.
        </p>
      ) : null}

      {task.errorMessage ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-rose-600">Error</h3>
          <pre className="overflow-x-auto rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-relaxed text-rose-700">
            {task.errorMessage}
          </pre>
        </div>
      ) : null}

      <div className="text-xs text-slate-500">
        <p>Task reference: {abbreviateId(task.id)}</p>
      </div>
    </section>
  );
}
