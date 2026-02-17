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
import { listTasksPage } from "../grpc/tasksApi";

const POLL_INTERVAL_MS = 2500;
const PAGE_SIZE_OPTIONS = [20, 50, 100];

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

export default function TasksPage() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [hasNextPage, setHasNextPage] = useState<boolean>(false);
  const [totalCount, setTotalCount] = useState<number>(0);

  const [loading, setLoading] = useState<boolean>(true);
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

  const normalizedQuery = debouncedSearchQuery.trim();
  const isFiltering = statusFilter !== "all" || normalizedQuery.length > 0;

  const filterKey = useMemo(
    () => `${statusFilter}|${normalizedQuery.toLowerCase()}`,
    [normalizedQuery, statusFilter],
  );

  useEffect(() => {
    setPage(1);
  }, [filterKey, pageSize]);

  const loadTasks = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setLoading(true);
    }

    try {
      const offset = (page - 1) * pageSize;
      const response = await listTasksPage({
        limit: pageSize,
        offset,
        statusFilter: statusFilter === "all" ? undefined : statusFilter,
        query: normalizedQuery || undefined,
      });
      setTasks(response.tasks);
      setHasNextPage(response.hasMore);
      setTotalCount(response.totalCount);
      setListError("");
      setLastRefreshedAt(new Date());
    } catch (err: unknown) {
      setListError(extractErrorMessage(err, "Failed to load tasks."));
      setTasks([]);
      setHasNextPage(false);
      setTotalCount(0);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [normalizedQuery, page, pageSize, statusFilter]);

  useEffect(() => {
    void loadTasks(true);
  }, [loadTasks]);

  const autoRefreshEnabled = useMemo(
    () => !isFiltering && tasks.some((task) => isTaskActive(task.status)),
    [isFiltering, tasks],
  );

  useEffect(() => {
    if (!autoRefreshEnabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void loadTasks(false);
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [autoRefreshEnabled, loadTasks]);

  const canGoPrevious = page > 1;
  const canGoNext = hasNextPage;

  const resultSummary = isFiltering
    ? `Showing ${tasks.length} of ${totalCount} matching tasks`
    : `Page ${page} (${tasks.length} shown of ${totalCount})`;

  const handleRefresh = () => {
    void loadTasks(true);
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
            disabled={loading}
            className="ui-button-secondary"
          >
            <RefreshIcon className="h-4 w-4" />
            {loading ? "Refreshing..." : "Refresh"}
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
          <p>Using server-side filters for efficient search results.</p>
        ) : autoRefreshEnabled ? (
          <p>Auto-refreshing every 2.5 seconds while this page has active tasks.</p>
        ) : null}
      </div>

      {listError ? (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">
          {listError}
        </div>
      ) : null}

      {loading && tasks.length === 0 ? (
        <ul className="space-y-2">
          {[1, 2, 3].map((row) => (
            <li key={row} className="ui-panel animate-pulse px-4 py-3">
              <div className="h-4 w-56 rounded bg-slate-800" />
              <div className="mt-2 h-3 w-80 rounded bg-slate-900" />
            </li>
          ))}
        </ul>
      ) : null}

      {!loading && tasks.length === 0 ? (
        <p className="ui-panel border-dashed px-4 py-6 text-sm text-slate-400">
          {isFiltering ? "No tasks match the current filters." : "No tasks found on this page."}
        </p>
      ) : null}

      {tasks.length > 0 ? (
        <ul className="overflow-hidden rounded-2xl border border-slate-800">
          {tasks.map((task) => (
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
