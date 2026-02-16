import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { getTask, listTasks } from "../grpc/tasksApi";
import {
  formatTimestamp,
  isTaskActive,
  taskPriorityLabel,
  taskStatusLabel,
} from "../grpc/taskFormatters";
import { TaskStatus, type Task as TaskRecord } from "../grpc/generated/orchestrator/v1/tasks";

const POLL_INTERVAL_MS = 2500;
const SHORT_ID_LENGTH = 8;

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

export default function TaskDetailPage() {
  const navigate = useNavigate();
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [parentTask, setParentTask] = useState<TaskRecord | null>(null);
  const [childTasks, setChildTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const taskIsActive = task ? isTaskActive(task.status) : false;

  const loadTask = useCallback(
    async (showLoading: boolean) => {
      if (!taskId) {
        setError("Task ID is missing.");
        setLoading(false);
        return;
      }

      if (showLoading) {
        setLoading(true);
      }

      try {
        const [nextTask, allTasks] = await Promise.all([getTask(taskId), listTasks()]);
        const nextParentTask = nextTask.parentTaskId
          ? allTasks.find((candidate) => candidate.id === nextTask.parentTaskId) ?? null
          : null;
        const nextChildTasks = allTasks.filter((candidate) => candidate.parentTaskId === nextTask.id);

        setTask(nextTask);
        setParentTask(nextParentTask);
        setChildTasks(nextChildTasks);
        setError("");
      } catch (err: unknown) {
        setError(extractErrorMessage(err, "Failed to load task."));
        setParentTask(null);
        setChildTasks([]);
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [taskId],
  );

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
        <p className="text-sm text-slate-600">Loading task...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="space-y-3">
        <h2 className="text-xl font-semibold text-slate-900">Task Detail</h2>
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          {error}
        </p>
        <Link to="/tasks" className="text-sm font-medium text-blue-700 hover:underline">
          Back to tasks
        </Link>
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
        </div>
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
          <dd className="mt-1 text-sm text-slate-800">{taskStatusLabel(task.status)}</dd>
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
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Completed At
          </dt>
          <dd className="mt-1 text-sm text-slate-800">{formatTimestamp(task.completedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Updated At</dt>
          <dd className="mt-1 text-sm text-slate-800">{formatTimestamp(task.updatedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Parent Task</dt>
          <dd className="mt-1 text-sm text-slate-800">
            {task.parentTaskId ? (
              <Link to={`/tasks/${task.parentTaskId}`} className="text-blue-700 hover:underline">
                {parentTask?.name ?? abbreviateId(task.parentTaskId)}
              </Link>
            ) : (
              "-"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Child Tasks</dt>
          <dd className="mt-1 text-sm text-slate-800">{childTasks.length}</dd>
        </div>
      </dl>

      {childTasks.length > 0 ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Child Task Links
          </h3>
          <div className="flex flex-wrap gap-2">
            {childTasks.map((childTask) => (
              <Link
                key={childTask.id}
                to={`/tasks/${childTask.id}`}
                className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
              >
                {childTask.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Prompt
        </h3>
        <pre className="overflow-x-auto rounded-xl border border-line bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
          {task.prompt}
        </pre>
      </div>

      {task.output ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
            Output
          </h3>
          <pre className="overflow-x-auto rounded-xl border border-line bg-slate-50 p-4 text-sm leading-relaxed text-slate-800">
            {task.output}
          </pre>
        </div>
      ) : null}

      {task.errorMessage ? (
        <div>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-rose-600">
            Error
          </h3>
          <pre className="overflow-x-auto rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-relaxed text-rose-700">
            {task.errorMessage}
          </pre>
        </div>
      ) : null}
    </section>
  );
}
