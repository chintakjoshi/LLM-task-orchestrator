import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";

import { createTask, listTasks } from "../grpc/tasksApi";
import { formatTimestamp, taskStatusLabel } from "../grpc/taskFormatters";
import type { Task as TaskRecord } from "../grpc/generated/orchestrator/v1/tasks";

interface TaskFormValues {
  name: string;
  prompt: string;
}

const INITIAL_FORM: TaskFormValues = {
  name: "",
  prompt: "",
};

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

export default function TasksPage() {
  const [formValues, setFormValues] = useState<TaskFormValues>(INITIAL_FORM);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const loadTasks = async () => {
    setLoading(true);
    setError("");
    try {
      const nextTasks = await listTasks();
      setTasks(nextTasks);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load tasks."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTasks();
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      await createTask({
        name: formValues.name.trim(),
        prompt: formValues.prompt.trim(),
      });
      setFormValues(INITIAL_FORM);
      await loadTasks();
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
          onClick={() => void loadTasks()}
          disabled={loading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

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
                Created: {formatTimestamp(task.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
