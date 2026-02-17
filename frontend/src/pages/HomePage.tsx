import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { ArrowRightIcon, ClockIcon, LayersIcon, LinkIcon, SparkIcon, StackIcon } from "../components/AppIcons";
import {
  batchCreateTasks,
  createTask,
  createTaskFromTemplate,
  listTaskTemplates,
  listTasks,
} from "../grpc/tasksApi";
import { formatTimestamp, isTaskActive, taskStatusBadgeClass, taskStatusLabel } from "../grpc/taskFormatters";
import type { Task as TaskRecord, TaskTemplate } from "../grpc/generated/orchestrator/v1/tasks";

interface TaskFormValues {
  name: string;
  prompt: string;
}

interface ChainPrefill {
  parentTaskId: string;
  parentTaskName: string;
  parentOutput: string;
}

type ConsoleMode = "single" | "batch" | "template";
type TaskTimingMode = "immediate" | "scheduled";

const INITIAL_FORM: TaskFormValues = {
  name: "",
  prompt: "",
};

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

export default function HomePage() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPrefillRef = useRef<ChainPrefill | null>(null);
  if (initialPrefillRef.current === null) {
    initialPrefillRef.current = parseChainPrefill(location.state, searchParams);
  }
  const initialPrefill = initialPrefillRef.current;

  const [mode, setMode] = useState<ConsoleMode>("single");
  const [formValues, setFormValues] = useState<TaskFormValues>(() => ({
    name: initialPrefill.parentTaskName ? `${initialPrefill.parentTaskName} follow-up` : "",
    prompt: initialPrefill.parentOutput,
  }));
  const [parentTaskId, setParentTaskId] = useState<string>(initialPrefill.parentTaskId);
  const [parentTaskName, setParentTaskName] = useState<string>(initialPrefill.parentTaskName);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [templateInputText, setTemplateInputText] = useState<string>("");
  const [templateName, setTemplateName] = useState<string>("");
  const [batchInput, setBatchInput] = useState<string>("");
  const [recentTasks, setRecentTasks] = useState<TaskRecord[]>([]);

  const [loadingRecent, setLoadingRecent] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [templateSubmitting, setTemplateSubmitting] = useState<boolean>(false);
  const [batchSubmitting, setBatchSubmitting] = useState<boolean>(false);

  const [recentError, setRecentError] = useState<string>("");
  const [templateLoadError, setTemplateLoadError] = useState<string>("");
  const [templateError, setTemplateError] = useState<string>("");
  const [batchError, setBatchError] = useState<string>("");
  const [formError, setFormError] = useState<string>("");
  const [successMessage, setSuccessMessage] = useState<string>("");

  const [timingMode, setTimingMode] = useState<TaskTimingMode>("immediate");
  const [executeAfterInput, setExecuteAfterInput] = useState<string>("");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  const hasActiveRecentTasks = recentTasks.some((task) => isTaskActive(task.status));

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

  const loadRecentTasks = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setLoadingRecent(true);
    }

    try {
      const nextTasks = await listTasks({ limit: 2, offset: 0 });
      setRecentTasks(nextTasks);
      if (parentTaskId && !parentTaskName) {
        const parentTask = nextTasks.find((task) => task.id === parentTaskId);
        if (parentTask) {
          setParentTaskName(parentTask.name);
        }
      }
      setRecentError("");
      setLastRefreshedAt(new Date());
    } catch (err: unknown) {
      setRecentError(extractErrorMessage(err, "Failed to load recent tasks."));
    } finally {
      if (showLoading) {
        setLoadingRecent(false);
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
    void Promise.all([loadRecentTasks(true), loadTemplates()]);
  }, [loadRecentTasks, loadTemplates]);

  useEffect(() => {
    if (!hasActiveRecentTasks) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadRecentTasks(false);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [hasActiveRecentTasks, loadRecentTasks]);

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
      await loadRecentTasks(false);
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
      await loadRecentTasks(false);
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
      await loadRecentTasks(false);
    } catch (err: unknown) {
      setBatchError(extractErrorMessage(err, "Failed to create tasks in batch."));
    } finally {
      setBatchSubmitting(false);
    }
  };

  const modeOptions: Array<{
    id: ConsoleMode;
    title: string;
    description: string;
    icon: ReactNode;
  }> = [
    {
      id: "single",
      title: "Single Task",
      description: "One prompt, optional scheduling.",
      icon: <SparkIcon className="h-4 w-4" />,
    },
    {
      id: "batch",
      title: "Batch Tasks",
      description: "Paste many tasks at once.",
      icon: <StackIcon className="h-4 w-4" />,
    },
    {
      id: "template",
      title: "Templates",
      description: "Create from prebuilt prompts.",
      icon: <LayersIcon className="h-4 w-4" />,
    },
  ];

  return (
    <section className="space-y-5">
      <div className="ui-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">Task Console</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-badge-muted inline-flex items-center gap-1">
              <ClockIcon className="h-3.5 w-3.5" />
              {lastRefreshedAt ? `Updated ${formatTimestamp(lastRefreshedAt)}` : "Not yet synced"}
            </span>
            <Link to="/tasks" className="ui-button-secondary">
              View all tasks
              <ArrowRightIcon className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>

      {parentTaskId ? (
        <div className="ui-panel flex flex-wrap items-center justify-between gap-3 border-cyan-500/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          <p className="inline-flex items-center gap-2">
            <LinkIcon className="h-4 w-4" />
            Chaining from
            <Link to={`/tasks/${parentTaskId}`} className="font-semibold underline">
              {parentTaskName || `task ${abbreviateId(parentTaskId)}`}
            </Link>
          </p>
          <button
            type="button"
            onClick={clearChainContext}
            className="ui-button-secondary !rounded-lg !px-3 !py-1.5 !text-xs"
          >
            Remove Parent Link
          </button>
        </div>
      ) : null}

      <div className="grid gap-2 sm:grid-cols-3" role="tablist" aria-label="Task creation mode">
        {modeOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setMode(option.id)}
            className={`ui-panel px-4 py-3 text-left transition ${
              mode === option.id
                ? "border-cyan-400/70 bg-cyan-500/10"
                : "hover:border-slate-700 hover:bg-slate-900/70"
            }`}
            aria-pressed={mode === option.id}
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-100">
              {option.icon}
              {option.title}
            </span>
            <p className="mt-1 text-xs text-slate-400">{option.description}</p>
          </button>
        ))}
      </div>

      {mode === "single" ? (
        <form className="ui-panel space-y-4 p-5" onSubmit={onSubmit}>
          <div>
            <label htmlFor="task-name" className="mb-1 block text-sm font-medium text-slate-300">
              Name
            </label>
            <input
              id="task-name"
              value={formValues.name}
              onChange={(event) =>
                setFormValues((current) => ({ ...current, name: event.target.value }))
              }
              className="ui-input"
              required
              maxLength={255}
              placeholder={parentTaskId ? "Name this follow-up task" : "Summarize release notes"}
            />
          </div>

          <div>
            <label htmlFor="task-prompt" className="mb-1 block text-sm font-medium text-slate-300">
              Prompt
            </label>
            <textarea
              id="task-prompt"
              value={formValues.prompt}
              onChange={(event) =>
                setFormValues((current) => ({ ...current, prompt: event.target.value }))
              }
              className="ui-input min-h-32"
              required
              rows={5}
              placeholder={parentTaskId ? "Parent output is prefilled. Refine as needed." : "Describe what the task should do"}
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-300">Run Time</p>
            <div className="flex flex-wrap gap-2 text-sm">
              <button
                type="button"
                onClick={() => setTimingMode("immediate")}
                className={`rounded-full border px-3 py-1.5 transition ${
                  timingMode === "immediate"
                    ? "border-cyan-400/70 bg-cyan-500/10 text-cyan-100"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:text-white"
                }`}
              >
                Run immediately
              </button>
              <button
                type="button"
                onClick={() => setTimingMode("scheduled")}
                className={`rounded-full border px-3 py-1.5 transition ${
                  timingMode === "scheduled"
                    ? "border-cyan-400/70 bg-cyan-500/10 text-cyan-100"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:text-white"
                }`}
              >
                Schedule for later
              </button>
            </div>
            {timingMode === "scheduled" ? (
              <div>
                <label htmlFor="execute-after" className="mb-1 block text-sm font-medium text-slate-300">
                  Execute After
                </label>
                <input
                  id="execute-after"
                  type="datetime-local"
                  value={executeAfterInput}
                  min={minScheduleValue}
                  onChange={(event) => setExecuteAfterInput(event.target.value)}
                  className="ui-input"
                />
              </div>
            ) : null}
          </div>

          <button type="submit" disabled={submitting} className="ui-button-primary">
            {submitting ? "Creating..." : "Create Task"}
          </button>

          {formError ? (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
              {formError}
            </p>
          ) : null}
        </form>
      ) : null}

      {mode === "template" ? (
        <form className="ui-panel space-y-4 p-5" onSubmit={onTemplateSubmit}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Task Templates</h2>
            <button type="button" onClick={() => void loadTemplates()} className="ui-button-secondary !px-3 !py-1.5 !text-xs">
              Refresh Templates
            </button>
          </div>

          {templateLoadError ? (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
              {templateLoadError}
            </p>
          ) : null}

          <div>
            <label htmlFor="template-id" className="mb-1 block text-sm font-medium text-slate-300">
              Template
            </label>
            <select
              id="template-id"
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              className="ui-input"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
            {selectedTemplate ? (
              <p className="mt-1 text-xs text-slate-400">{selectedTemplate.description}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="template-name" className="mb-1 block text-sm font-medium text-slate-300">
              Name (Optional)
            </label>
            <input
              id="template-name"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              className="ui-input"
              maxLength={255}
              placeholder="Defaults to template-based name"
            />
          </div>

          <div>
            <label htmlFor="template-input" className="mb-1 block text-sm font-medium text-slate-300">
              Input Text
            </label>
            <textarea
              id="template-input"
              value={templateInputText}
              onChange={(event) => setTemplateInputText(event.target.value)}
              className="ui-input min-h-28"
              rows={5}
              placeholder="Provide text to inject into the template"
            />
          </div>

          <button type="submit" disabled={templateSubmitting} className="ui-button-primary">
            {templateSubmitting ? "Creating from template..." : "Create From Template"}
          </button>

          {templateError ? (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
              {templateError}
            </p>
          ) : null}
        </form>
      ) : null}

      {mode === "batch" ? (
        <form className="ui-panel space-y-4 p-5" onSubmit={onBatchSubmit}>
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Batch Create</h2>
            <p className="mt-1 text-xs text-slate-500">
              Add one task per line. Use <code>Name | Prompt</code> format or just prompt text.
            </p>
          </div>

          <textarea
            value={batchInput}
            onChange={(event) => setBatchInput(event.target.value)}
            className="ui-input min-h-40"
            rows={8}
            placeholder="Summarize notes | Summarize this transcript..."
          />

          <button type="submit" disabled={batchSubmitting} className="ui-button-primary">
            {batchSubmitting ? "Creating batch..." : "Create Batch Tasks"}
          </button>

          {batchError ? (
            <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
              {batchError}
            </p>
          ) : null}
        </form>
      ) : null}

      {successMessage ? (
        <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200">
          {successMessage}
        </p>
      ) : null}

      <div className="ui-panel p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-100">Recent Tasks</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void loadRecentTasks(true)}
              disabled={loadingRecent}
              className="ui-button-secondary !px-3 !py-1.5 !text-xs"
            >
              {loadingRecent ? "Refreshing..." : "Refresh"}
            </button>
            <Link to="/tasks" className="ui-button-secondary !px-3 !py-1.5 !text-xs">
              See all
            </Link>
          </div>
        </div>

        {recentError ? (
          <p className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
            {recentError}
          </p>
        ) : null}

        {recentTasks.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-700 px-4 py-5 text-sm text-slate-400">
            No tasks yet. Create your first task from the console above.
          </p>
        ) : (
          <ul className="space-y-2">
            {recentTasks.map((task) => (
              <li key={task.id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link to={`/tasks/${task.id}`} className="text-sm font-semibold text-cyan-200 hover:text-cyan-100">
                    {task.name}
                  </Link>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${taskStatusBadgeClass(task.status)}`}
                  >
                    {taskStatusLabel(task.status)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  Created: {formatTimestamp(task.createdAt)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
