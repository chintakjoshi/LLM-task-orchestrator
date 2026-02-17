import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { RefreshIcon, SearchIcon } from "../components/AppIcons";
import {
  formatDurationMs,
  formatTimestamp,
  isTaskActive,
  taskStatusBadgeClass,
  taskStatusLabel,
} from "../grpc/taskFormatters";
import { TaskStatus, type Task as TaskRecord } from "../grpc/generated/orchestrator/v1/tasks";
import { listTasks } from "../grpc/tasksApi";

const POLL_INTERVAL_MS = 2500;
const PAGE_SIZE_OPTIONS = [20, 50, 100];
const FILTER_SCAN_BATCH_SIZE = 200;
const FILTER_SCAN_MAX_PAGES = 200;

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

function extractErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
}

function truncateText(value: string, maxLength = 180): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...`;
}

function matchesTask(task: TaskRecord, statusFilter: TaskStatusFilter, normalizedQuery: string): boolean {
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
}

async function loadAllTasksForFilter(): Promise<TaskRecord[]> {
  const tasks: TaskRecord[] = [];
  let offset = 0;
  let pageCount = 0;

  while (pageCount < FILTER_SCAN_MAX_PAGES) {
    const batch = await listTasks({ limit: FILTER_SCAN_BATCH_SIZE, offset });
    if (batch.length === 0) {
      break;
    }

    tasks.push(...batch);
    offset += batch.length;
    pageCount += 1;

    if (batch.length < FILTER_SCAN_BATCH_SIZE) {
      break;
    }
  }

  return tasks;
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [filteredTasks, setFilteredTasks] = useState<TaskRecord[]>([]);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [hasNextPage, setHasNextPage] = useState<boolean>(false);

  const [loading, setLoading] = useState<boolean>(true);
  const [searching, setSearching] = useState<boolean>(false);
  const [listError, setListError] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("all");
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [searchQuery]);

  const normalizedQuery = debouncedSearchQuery.trim().toLowerCase();
  const isFiltering = statusFilter !== "all" || normalizedQuery.length > 0;

  const filterKey = useMemo(
    () => `${statusFilter}|${normalizedQuery}`,
    [normalizedQuery, statusFilter],
  );

  useEffect(() => {
    setPage(1);
  }, [filterKey, pageSize]);

  const loadPage = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const offset = (page - 1) * pageSize;
      const batch = await listTasks({ limit: pageSize + 1, offset });
      setTasks(batch.slice(0, pageSize));
      setHasNextPage(batch.length > pageSize);
      setListError("");
      setLastRefreshedAt(new Date());
    } catch (err: unknown) {
      setListError(extractErrorMessage(err, "Failed to load tasks."));
      setTasks([]);
      setHasNextPage(false);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [page, pageSize]);

  const loadFilteredTasks = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setLoading(true);
    }
    setSearching(true);

    try {
      const allTasks = await loadAllTasksForFilter();
      const matchingTasks = allTasks.filter((task) => matchesTask(task, statusFilter, normalizedQuery));
      setFilteredTasks(matchingTasks);
      setListError("");
      setLastRefreshedAt(new Date());
    } catch (err: unknown) {
      setListError(extractErrorMessage(err, "Failed to search tasks."));
      setFilteredTasks([]);
    } finally {
      setSearching(false);
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [normalizedQuery, statusFilter]);

  useEffect(() => {
    if (isFiltering) {
      void loadFilteredTasks(true);
      return;
    }
    void loadPage(true);
  }, [isFiltering, loadFilteredTasks, loadPage]);

  const autoRefreshEnabled = useMemo(() => !isFiltering && tasks.some((task) => isTaskActive(task.status)), [isFiltering, tasks]);

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadPage(false);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoRefreshEnabled, loadPage]);

  const displayedTasks = useMemo(() => {
    if (!isFiltering) {
      return tasks;
    }

    const start = (page - 1) * pageSize;
    return filteredTasks.slice(start, start + pageSize);
  }, [filteredTasks, isFiltering, page, pageSize, tasks]);

  const canGoPrevious = page > 1;
  const canGoNext = isFiltering
    ? filteredTasks.length > page * pageSize
    : hasNextPage;

  const resultSummary = isFiltering
    ? `${filteredTasks.length} matching tasks`
    : `Page ${page} (${displayedTasks.length} shown)`;

  const handleRefresh = () => {
    if (isFiltering) {
      void loadFilteredTasks(true);
      return;
    }
    void loadPage(true);
  };

  return (
    <section className="space-y-5">
      <div className="ui-panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-100 sm:text-2xl">All Tasks</h1>
            <p className="mt-1 text-sm text-slate-400">
              Browse every task with paging controls for large task histories.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || searching}
            className="ui-button-secondary"
          >
            <RefreshIcon className="h-4 w-4" />
            {loading || searching ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Last refreshed: {lastRefreshedAt ? formatTimestamp(lastRefreshedAt) : "Not yet"}
        </p>
      </div>

      <div className="ui-panel grid gap-3 p-4 md:grid-cols-[1fr_200px_130px]">
        <div>
          <label htmlFor="task-search" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Search
          </label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              id="task-search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              className="ui-input pl-9"
              placeholder="Name, ID, prompt, output, or error"
            />
          </div>
        </div>

        <div>
          <label htmlFor="status-filter" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Status
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
            className="ui-input"
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.label} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="page-size" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Rows
          </label>
          <select
            id="page-size"
            value={String(pageSize)}
            onChange={(event) => setPageSize(Number(event.target.value))}
            className="ui-input"
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option} / page
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <p>{resultSummary}</p>
        {isFiltering ? (
          <p>Filter mode scans all tasks in pages for accurate search results.</p>
        ) : autoRefreshEnabled ? (
          <p>Auto-refreshing every 2.5 seconds while this page has active tasks.</p>
        ) : null}
      </div>

      {listError ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
          {listError}
        </div>
      ) : null}

      {(loading || searching) && displayedTasks.length === 0 ? (
        <ul className="space-y-2">
          {[1, 2, 3].map((row) => (
            <li key={row} className="ui-panel animate-pulse px-4 py-3">
              <div className="h-4 w-56 rounded bg-slate-800" />
              <div className="mt-2 h-3 w-80 rounded bg-slate-900" />
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && displayedTasks.length === 0 ? (
        <p className="ui-panel border-dashed px-4 py-6 text-sm text-slate-400">
          {isFiltering ? "No tasks match the current filters." : "No tasks found on this page."}
        </p>
      ) : null}

      {displayedTasks.length > 0 ? (
        <ul className="overflow-hidden rounded-2xl border border-slate-800">
          {displayedTasks.map((task) => (
            <li key={task.id} className="border-b border-slate-800 bg-slate-950/70 px-4 py-3 last:border-b-0">
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
                Created: {formatTimestamp(task.createdAt)} | Scheduled: {formatTimestamp(task.executeAfter || task.scheduledAt)} | Started: {formatTimestamp(task.startedAt)} | Completed: {formatTimestamp(task.completedAt)}
              </p>

              {task.latestExecutionMetrics ? (
                <p className="mt-1 text-xs text-slate-500">
                  Model: {task.latestExecutionMetrics.modelName || "-"} | Tokens: {task.latestExecutionMetrics.totalTokens || 0} | Duration: {formatDurationMs(task.latestExecutionMetrics.durationMs)}
                </p>
              ) : null}

              {task.output ? (
                <p className="mt-1 text-xs text-slate-300">Output: {truncateText(task.output)}</p>
              ) : null}

              {task.errorMessage ? (
                <p className="mt-1 text-xs text-rose-300">Error: {truncateText(task.errorMessage)}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="ui-panel flex flex-wrap items-center justify-between gap-2 p-3">
        <button
          type="button"
          onClick={() => setPage((current) => Math.max(1, current - 1))}
          disabled={!canGoPrevious}
          className="ui-button-secondary !px-3 !py-1.5"
        >
          Previous
        </button>

        <p className="text-sm text-slate-300">Page {page}</p>

        <button
          type="button"
          onClick={() => setPage((current) => current + 1)}
          disabled={!canGoNext}
          className="ui-button-secondary !px-3 !py-1.5"
        >
          Next
        </button>
      </div>
    </section>
  );
}
