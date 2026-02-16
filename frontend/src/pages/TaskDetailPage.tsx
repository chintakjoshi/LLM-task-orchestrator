import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { getTask } from "../grpc/tasksApi";
import {
  formatTimestamp,
  taskPriorityLabel,
  taskStatusLabel,
} from "../grpc/taskFormatters";
import type { Task as TaskRecord } from "../grpc/generated/orchestrator/v1/tasks";

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

export default function TaskDetailPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const loadTask = async () => {
    if (!taskId) {
      setError("Task ID is missing.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const nextTask = await getTask(taskId);
      setTask(nextTask);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load task."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTask();
  }, [taskId]);

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
            onClick={() => void loadTask()}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
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
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Updated At</dt>
          <dd className="mt-1 text-sm text-slate-800">{formatTimestamp(task.updatedAt)}</dd>
        </div>
      </dl>

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
