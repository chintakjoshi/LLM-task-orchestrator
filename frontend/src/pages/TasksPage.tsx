import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { createTask, listTasks } from "../grpc/tasksApi";
import { formatTimestamp, isTaskActive, taskStatusLabel } from "../grpc/taskFormatters";
import type { Task as TaskRecord } from "../grpc/generated/orchestrator/v1/tasks";

interface TaskFormValues {
  name: string;
  prompt: string;
}

const INITIAL_FORM: TaskFormValues = {
  name: "",
  prompt: "",
};
const POLL_INTERVAL_MS = 2500;
const SHORT_ID_LENGTH = 8;

interface ChainPrefill {
  parentTaskId: string;
  parentTaskName: string;
  parentOutput: string;
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

function truncateText(value: string, maxLength = 160): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function abbreviateId(value: string): string {
  if (value.length <= SHORT_ID_LENGTH) {
    return value;
  }
  return `${value.slice(0, SHORT_ID_LENGTH)}...`;
}

function parseChainPrefill(state: unknown, searchParams: URLSearchParams): ChainPrefill {
  const record = (state && typeof state === "object" ? state : null) as Record<string, unknown> | null;
  const stateParentId =
    typeof record?.parentTaskId === "string" ? record.parentTaskId.trim() : "";
  const queryParentId = searchParams.get("parentTaskId")?.trim() ?? "";
  const parentTaskId = stateParentId || queryParentId;

  const parentTaskName =
    typeof record?.parentTaskName === "string" ? record.parentTaskName.trim() : "";
  const parentOutput = typeof record?.parentOutput === "string" ? record.parentOutput : "";

  return {
    parentTaskId,
    parentTaskName,
    parentOutput,
  };
}

export default function TasksPage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPrefillRef = useRef<ChainPrefill | null>(null);
  if (initialPrefillRef.current === null) {
    initialPrefillRef.current = parseChainPrefill(location.state, searchParams);
  }
  const initialPrefill = initialPrefillRef.current;

  const [formValues, setFormValues] = useState<TaskFormValues>(() => ({
    name: initialPrefill.parentTaskName ? `${initialPrefill.parentTaskName} follow-up` : "",
    prompt: initialPrefill.parentOutput,
  }));
  const [parentTaskId, setParentTaskId] = useState<string>(initialPrefill.parentTaskId);
  const [parentTaskName, setParentTaskName] = useState<string>(initialPrefill.parentTaskName);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const hasActiveTasks = tasks.some((task) => isTaskActive(task.status));
  const childCountByParentId = useMemo(() => {
    const map = new Map<string, number>();
    for (const task of tasks) {
      const parentId = task.parentTaskId.trim();
      if (!parentId) {
        continue;
      }
      map.set(parentId, (map.get(parentId) ?? 0) + 1);
    }
    return map;
  }, [tasks]);

  const clearChainContext = useCallback(() => {
    setParentTaskId("");
    setParentTaskName("");
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("parentTaskId");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const loadTasks = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const nextTasks = await listTasks();
      setTasks(nextTasks);
      if (parentTaskId && !parentTaskName) {
        const parentTask = nextTasks.find((task) => task.id === parentTaskId);
        if (parentTask) {
          setParentTaskName(parentTask.name);
        }
      }
      setError("");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load tasks."));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [parentTaskId, parentTaskName]);

  useEffect(() => {
    void loadTasks(true);
  }, [loadTasks]);

  useEffect(() => {
    if (!hasActiveTasks) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadTasks(false);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasActiveTasks, loadTasks]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await createTask({
        name: formValues.name.trim(),
        prompt: formValues.prompt.trim(),
        parentTaskId: parentTaskId || undefined,
      });
      setFormValues(INITIAL_FORM);
      clearChainContext();
      await loadTasks(true);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to create task."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Tasks</h2>
        <p className="mt-1 text-sm text-slate-600">
          Create a task and it will run asynchronously via Celery + NVIDIA NIM.
        </p>
      </div>

      {parentTaskId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p>
            Chaining from{" "}
            <Link to={`/tasks/${parentTaskId}`} className="font-semibold underline">
              {parentTaskName || `task ${abbreviateId(parentTaskId)}`}
            </Link>
            . The new task will keep this parent link.
          </p>
          <button
            type="button"
            onClick={clearChainContext}
            className="rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:border-blue-300 hover:text-blue-900"
          >
            Remove Parent Link
          </button>
        </div>
      ) : null}

      <form
        className="space-y-3 rounded-xl border border-line bg-slate-50/70 p-4"
        onSubmit={onSubmit}
      >
        <div>
          <label
            htmlFor="task-name"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Name
          </label>
          <input
            id="task-name"
            value={formValues.name}
            onChange={(event) =>
              setFormValues((current) => ({ ...current, name: event.target.value }))
            }
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 transition focus:ring-2"
            required
            maxLength={255}
            placeholder={parentTaskId ? "Name this follow-up task" : ""}
          />
        </div>

        <div>
          <label
            htmlFor="task-prompt"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Prompt
          </label>
          <textarea
            id="task-prompt"
            value={formValues.prompt}
            onChange={(event) =>
              setFormValues((current) => ({ ...current, prompt: event.target.value }))
            }
            className="min-h-28 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 transition focus:ring-2"
            required
            rows={4}
            placeholder={parentTaskId ? "Parent output is prefilled. Refine as needed." : ""}
          />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating..." : "Create Task"}
        </button>
      </form>

      {error ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-slate-900">Task List</h3>
        <button
          type="button"
          onClick={() => void loadTasks(true)}
          disabled={loading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {hasActiveTasks ? (
        <p className="text-xs text-slate-500">
          Auto-refreshing every 2.5 seconds while tasks are pending, queued, or running.
        </p>
      ) : null}

      {loading && tasks.length === 0 ? (
        <p className="text-sm text-slate-600">Loading tasks...</p>
      ) : null}

      {tasks.length === 0 && !loading ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          No tasks created yet.
        </p>
      ) : null}

      {tasks.length > 0 ? (
        <ul className="divide-y divide-slate-200 rounded-xl border border-line">
          {tasks.map((task) => (
            <li key={task.id} className="bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  to={`/tasks/${task.id}`}
                  className="font-medium text-blue-700 transition hover:text-blue-900"
                >
                  {task.name}
                </Link>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700">
                  {taskStatusLabel(task.status)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Created: {formatTimestamp(task.createdAt)} | Started:{" "}
                {formatTimestamp(task.startedAt)} | Completed: {formatTimestamp(task.completedAt)}
              </p>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-500">
                {task.parentTaskId ? (
                  <p>
                    Parent:{" "}
                    <Link to={`/tasks/${task.parentTaskId}`} className="font-medium text-blue-700 hover:underline">
                      {abbreviateId(task.parentTaskId)}
                    </Link>
                  </p>
                ) : null}
                {(childCountByParentId.get(task.id) ?? 0) > 0 ? (
                  <p>Children: {childCountByParentId.get(task.id)}</p>
                ) : null}
              </div>
              {task.output ? (
                <p className="mt-1 text-xs text-slate-600">Output: {truncateText(task.output)}</p>
              ) : null}
              {task.errorMessage ? (
                <p className="mt-1 text-xs text-rose-600">
                  Error: {truncateText(task.errorMessage)}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
