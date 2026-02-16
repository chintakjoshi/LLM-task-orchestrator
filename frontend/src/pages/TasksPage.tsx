import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import {
  batchCreateTasks,
  createTask,
  createTaskFromTemplate,
  listTaskTemplates,
  listTasks,
} from "../grpc/tasksApi";
import {
  formatDurationMs,
  formatTimestamp,
  isTaskActive,
  taskStatusBadgeClass,
  taskStatusLabel,
} from "../grpc/taskFormatters";
import {
  TaskStatus,
  type Task as TaskRecord,
  type TaskTemplate,
} from "../grpc/generated/orchestrator/v1/tasks";

interface TaskFormValues {
  name: string;
  prompt: string;
}

type TaskTimingMode = "immediate" | "scheduled";

const INITIAL_FORM: TaskFormValues = {
  name: "",
  prompt: "",
};
const POLL_INTERVAL_MS = 2500;
const SHORT_ID_LENGTH = 8;
type TaskStatusFilter = "all" | TaskStatus;

const STATUS_FILTER_OPTIONS: Array<{ label: string; value: TaskStatusFilter }> = [
  { label: "All statuses", value: "all" },
  { label: "Pending", value: TaskStatus.TASK_STATUS_PENDING },
  { label: "Queued", value: TaskStatus.TASK_STATUS_QUEUED },
  { label: "Running", value: TaskStatus.TASK_STATUS_RUNNING },
  { label: "Completed", value: TaskStatus.TASK_STATUS_COMPLETED },
  { label: "Failed", value: TaskStatus.TASK_STATUS_FAILED },
  { label: "Cancelled", value: TaskStatus.TASK_STATUS_CANCELLED },
];

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

function parseBatchInput(input: string): Array<{ name: string; prompt: string }> {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const tasks: Array<{ name: string; prompt: string }> = [];
  for (const [index, line] of lines.entries()) {
    const separator = line.indexOf("|");
    if (separator > 0 && separator < line.length - 1) {
      const name = line.slice(0, separator).trim();
      const prompt = line.slice(separator + 1).trim();
      if (name && prompt) {
        tasks.push({ name, prompt });
        continue;
      }
    }

    tasks.push({
      name: `Batch Task ${index + 1}`,
      prompt: line,
    });
  }

  return tasks;
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
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateInputText, setTemplateInputText] = useState<string>("");
  const [templateName, setTemplateName] = useState<string>("");
  const [batchInput, setBatchInput] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [templateSubmitting, setTemplateSubmitting] = useState<boolean>(false);
  const [batchSubmitting, setBatchSubmitting] = useState<boolean>(false);
  const [listError, setListError] = useState<string>("");
  const [templateError, setTemplateError] = useState<string>("");
  const [templateLoadError, setTemplateLoadError] = useState<string>("");
  const [batchError, setBatchError] = useState<string>("");
  const [formError, setFormError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");
  const [timingMode, setTimingMode] = useState<TaskTimingMode>("immediate");
  const [executeAfterInput, setExecuteAfterInput] = useState<string>("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("all");
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

  const filteredTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return tasks.filter((task) => {
      if (statusFilter !== "all" && task.status !== statusFilter) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }

      return (
        task.name.toLowerCase().includes(normalizedQuery)
        || task.id.toLowerCase().includes(normalizedQuery)
        || task.prompt.toLowerCase().includes(normalizedQuery)
        || task.output.toLowerCase().includes(normalizedQuery)
        || task.errorMessage.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [searchQuery, statusFilter, tasks]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  );
  const minScheduleValue = useMemo(() => {
    const now = new Date();
    const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
    return localNow.toISOString().slice(0, 16);
  }, []);

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
      setListError("");
      setLastRefreshedAt(new Date());
    } catch (err: unknown) {
      setListError(extractErrorMessage(err, "Failed to load tasks."));
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [parentTaskId, parentTaskName]);

  const loadTemplates = useCallback(async () => {
    try {
      const nextTemplates = await listTaskTemplates();
      setTemplates(nextTemplates);
      setTemplateLoadError("");
      if (!selectedTemplateId && nextTemplates.length > 0) {
        setSelectedTemplateId(nextTemplates[0].id);
      }
    } catch (err: unknown) {
      setTemplateLoadError(extractErrorMessage(err, "Failed to load templates."));
    }
  }, [selectedTemplateId]);

  useEffect(() => {
    void Promise.all([loadTasks(true), loadTemplates()]);
  }, [loadTasks, loadTemplates]);

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
    const trimmedName = formValues.name.trim();
    const trimmedPrompt = formValues.prompt.trim();
    if (!trimmedName || !trimmedPrompt) {
      setFormError("Name and prompt are required.");
      return;
    }
    let executeAfter: Date | undefined;
    if (timingMode === "scheduled") {
      if (!executeAfterInput.trim()) {
        setFormError("Select a scheduled time.");
        return;
      }
      const parsedExecuteAfter = new Date(executeAfterInput);
      if (Number.isNaN(parsedExecuteAfter.getTime())) {
        setFormError("Scheduled time is invalid.");
        return;
      }
      if (parsedExecuteAfter.getTime() <= Date.now()) {
        setFormError("Scheduled time must be in the future.");
        return;
      }
      executeAfter = parsedExecuteAfter;
    }

    setSubmitting(true);
    setFormError("");
    setSuccessMessage("");

    try {
      await createTask({
        name: trimmedName,
        prompt: trimmedPrompt,
        parentTaskId: parentTaskId || undefined,
        executeAfter,
      });
      setFormValues(INITIAL_FORM);
      setTimingMode("immediate");
      setExecuteAfterInput("");
      clearChainContext();
      setSuccessMessage(`Task "${trimmedName}" created successfully.`);
      await loadTasks(false);
    } catch (err: unknown) {
      setFormError(extractErrorMessage(err, "Failed to create task."));
    } finally {
      setSubmitting(false);
    }
  };

  const onTemplateSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedInput = templateInputText.trim();
    const trimmedName = templateName.trim();
    if (!selectedTemplateId || !trimmedInput) {
      setTemplateError("Template and input text are required.");
      return;
    }

    setTemplateSubmitting(true);
    setTemplateError("");
    setSuccessMessage("");

    try {
      const created = await createTaskFromTemplate({
        templateId: selectedTemplateId,
        inputText: trimmedInput,
        name: trimmedName || undefined,
        parentTaskId: parentTaskId || undefined,
      });
      setTemplateInputText("");
      setTemplateName("");
      clearChainContext();
      setSuccessMessage(`Task "${created.name}" created from template.`);
      await loadTasks(false);
    } catch (err: unknown) {
      setTemplateError(extractErrorMessage(err, "Failed to create task from template."));
    } finally {
      setTemplateSubmitting(false);
    }
  };

  const onBatchSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsedTasks = parseBatchInput(batchInput);
    if (parsedTasks.length === 0) {
      setBatchError("Add at least one batch task line.");
      return;
    }
    if (parsedTasks.length > 50) {
      setBatchError("Batch creation supports up to 50 tasks per request.");
      return;
    }

    setBatchSubmitting(true);
    setBatchError("");
    setSuccessMessage("");

    try {
      const created = await batchCreateTasks(
        parsedTasks.map((task) => ({
          name: task.name,
          prompt: task.prompt,
          parentTaskId: parentTaskId || undefined,
        })),
      );
      setBatchInput("");
      clearChainContext();
      setSuccessMessage(`Created ${created.length} tasks in batch.`);
      await loadTasks(false);
    } catch (err: unknown) {
      setBatchError(extractErrorMessage(err, "Failed to create tasks in batch."));
    } finally {
      setBatchSubmitting(false);
    }
  };

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">Tasks</h2>
        <p className="mt-1 text-sm text-slate-600">
          Create tasks one-by-one, from templates, or in batch. Execution runs asynchronously via Celery + NVIDIA NIM.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Last refreshed: {lastRefreshedAt ? formatTimestamp(lastRefreshedAt) : "Not yet"}
        </p>
      </div>

      {parentTaskId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p>
            Chaining from{" "}
            <Link to={`/tasks/${parentTaskId}`} className="font-semibold underline">
              {parentTaskName || `task ${abbreviateId(parentTaskId)}`}
            </Link>
            . New tasks will keep this parent link.
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
        className="space-y-3 rounded-xl border border-line bg-slate-50/70 p-4 shadow-sm"
        onSubmit={onSubmit}
      >
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Single Task</h3>
        <div>
          <label htmlFor="task-name" className="mb-1 block text-sm font-medium text-slate-700">
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
          <label htmlFor="task-prompt" className="mb-1 block text-sm font-medium text-slate-700">
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

        <div className="space-y-2">
          <p className="text-sm font-medium text-slate-700">Run Time</p>
          <div className="flex flex-wrap gap-4 text-sm text-slate-700">
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="task-run-mode"
                checked={timingMode === "immediate"}
                onChange={() => setTimingMode("immediate")}
              />
              Run immediately
            </label>
            <label className="inline-flex items-center gap-2">
              <input
                type="radio"
                name="task-run-mode"
                checked={timingMode === "scheduled"}
                onChange={() => setTimingMode("scheduled")}
              />
              Run later
            </label>
          </div>
          {timingMode === "scheduled" ? (
            <div>
              <label htmlFor="execute-after" className="mb-1 block text-sm font-medium text-slate-700">
                Execute After
              </label>
              <input
                id="execute-after"
                type="datetime-local"
                value={executeAfterInput}
                min={minScheduleValue}
                onChange={(event) => setExecuteAfterInput(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 transition focus:ring-2"
              />
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "Creating..." : "Create Task"}
        </button>

        {formError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {formError}
          </p>
        ) : null}
      </form>

      <form
        className="space-y-3 rounded-xl border border-line bg-slate-50/70 p-4 shadow-sm"
        onSubmit={onTemplateSubmit}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Task Templates</h3>
          <button
            type="button"
            onClick={() => void loadTemplates()}
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
          >
            Refresh Templates
          </button>
        </div>

        {templateLoadError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {templateLoadError}
          </p>
        ) : null}

        <div>
          <label htmlFor="template-id" className="mb-1 block text-sm font-medium text-slate-700">
            Template
          </label>
          <select
            id="template-id"
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 transition focus:ring-2"
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
          {selectedTemplate ? (
            <p className="mt-1 text-xs text-slate-500">{selectedTemplate.description}</p>
          ) : null}
        </div>

        <div>
          <label htmlFor="template-name" className="mb-1 block text-sm font-medium text-slate-700">
            Name (Optional)
          </label>
          <input
            id="template-name"
            value={templateName}
            onChange={(event) => setTemplateName(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 transition focus:ring-2"
            maxLength={255}
            placeholder="Defaults to template-based name"
          />
        </div>

        <div>
          <label htmlFor="template-input" className="mb-1 block text-sm font-medium text-slate-700">
            Input Text
          </label>
          <textarea
            id="template-input"
            value={templateInputText}
            onChange={(event) => setTemplateInputText(event.target.value)}
            className="min-h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 transition focus:ring-2"
            rows={4}
            placeholder="Provide the text to inject into the template"
          />
        </div>

        <button
          type="submit"
          disabled={templateSubmitting}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {templateSubmitting ? "Creating from template..." : "Create From Template"}
        </button>

        {templateError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {templateError}
          </p>
        ) : null}
      </form>

      <form
        className="space-y-3 rounded-xl border border-line bg-slate-50/70 p-4 shadow-sm"
        onSubmit={onBatchSubmit}
      >
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Batch Create</h3>
        <p className="text-xs text-slate-500">
          Add one task per line. Use <code>Name | Prompt</code> format or just prompt text.
        </p>
        <textarea
          value={batchInput}
          onChange={(event) => setBatchInput(event.target.value)}
          className="min-h-32 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 transition focus:ring-2"
          rows={6}
          placeholder="Summarize meeting | Summarize this transcript..."
        />

        <button
          type="submit"
          disabled={batchSubmitting}
          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {batchSubmitting ? "Creating batch..." : "Create Batch Tasks"}
        </button>

        {batchError ? (
          <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
            {batchError}
          </p>
        ) : null}
      </form>

      {successMessage ? (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
          {successMessage}
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

      <div className="grid gap-3 rounded-xl border border-line bg-slate-50/70 p-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="task-search"
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Search
          </label>
          <input
            id="task-search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 transition focus:ring-2"
            placeholder="Name, ID, prompt, output, or error"
          />
        </div>
        <div>
          <label
            htmlFor="status-filter"
            className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500"
          >
            Status Filter
          </label>
          <select
            id="status-filter"
            value={String(statusFilter)}
            onChange={(event) => {
              const nextValue = event.target.value;
              if (nextValue === "all") {
                setStatusFilter("all");
                return;
              }
              setStatusFilter(Number(nextValue) as TaskStatus);
            }}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none ring-blue-500 transition focus:ring-2"
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.label} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {listError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          <p>{listError}</p>
          <button
            type="button"
            onClick={() => void loadTasks(true)}
            className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-semibold text-rose-700 transition hover:border-rose-400"
          >
            Retry
          </button>
        </div>
      ) : null}

      {hasActiveTasks ? (
        <p className="text-xs text-slate-500">
          Auto-refreshing every 2.5 seconds while tasks are pending, queued, or running.
        </p>
      ) : null}

      {loading && tasks.length === 0 ? (
        <ul className="space-y-2">
          {[1, 2, 3].map((row) => (
            <li
              key={row}
              className="animate-pulse rounded-xl border border-line bg-white px-4 py-3"
            >
              <div className="h-4 w-40 rounded bg-slate-200" />
              <div className="mt-2 h-3 w-64 rounded bg-slate-100" />
            </li>
          ))}
        </ul>
      ) : null}

      {tasks.length === 0 && !loading ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          No tasks created yet.
        </p>
      ) : null}

      {tasks.length > 0 && filteredTasks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600">
          No tasks match the current filters.
        </p>
      ) : null}

      {filteredTasks.length > 0 ? (
        <ul className="divide-y divide-slate-200 rounded-xl border border-line">
          {filteredTasks.map((task) => (
            <li key={task.id} className="bg-white px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  to={`/tasks/${task.id}`}
                  className="font-medium text-blue-700 transition hover:text-blue-900"
                >
                  {task.name}
                </Link>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${taskStatusBadgeClass(task.status)}`}
                >
                  {taskStatusLabel(task.status)}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Created: {formatTimestamp(task.createdAt)} | Scheduled: {" "}
                {formatTimestamp(task.executeAfter || task.scheduledAt)} | Started: {" "}
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
              {task.latestExecutionMetrics ? (
                <p className="mt-1 text-xs text-slate-500">
                  Model: {task.latestExecutionMetrics.modelName || "-"} | Tokens: {task.latestExecutionMetrics.totalTokens || 0} | Duration: {formatDurationMs(task.latestExecutionMetrics.durationMs)}
                </p>
              ) : null}
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
