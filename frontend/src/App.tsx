import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import { HomeIcon, ListIcon, RefreshIcon } from "./components/AppIcons";
import { TaskStatus, type Task as TaskRecord } from "./grpc/generated/orchestrator/v1/tasks";
import { formatTimestamp } from "./grpc/taskFormatters";
import { listTasks } from "./grpc/tasksApi";
import HomePage from "./pages/HomePage";
import TaskDetailPage from "./pages/TaskDetailPage";
import TasksPage from "./pages/TasksPage";

interface TaskSummaryCounts {
  total: number;
  pending: number;
  queued: number;
  running: number;
  completed: number;
  failed: number;
  cancelled: number;
}

const SUMMARY_PAGE_SIZE = 200;
const SUMMARY_MAX_PAGES = 200;
const ACTIVE_REFRESH_MS = 8000;
const IDLE_REFRESH_MS = 25000;

function emptyCounts(): TaskSummaryCounts {
  return {
    total: 0,
    pending: 0,
    queued: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
}

function addToCounts(counts: TaskSummaryCounts, task: TaskRecord): void {
  counts.total += 1;

  switch (task.status) {
    case TaskStatus.TASK_STATUS_PENDING:
      counts.pending += 1;
      break;
    case TaskStatus.TASK_STATUS_QUEUED:
      counts.queued += 1;
      break;
    case TaskStatus.TASK_STATUS_RUNNING:
      counts.running += 1;
      break;
    case TaskStatus.TASK_STATUS_COMPLETED:
      counts.completed += 1;
      break;
    case TaskStatus.TASK_STATUS_FAILED:
      counts.failed += 1;
      break;
    case TaskStatus.TASK_STATUS_CANCELLED:
      counts.cancelled += 1;
      break;
    default:
      break;
  }
}

async function fetchSummarySnapshot(): Promise<TaskSummaryCounts> {
  let offset = 0;
  let pageIndex = 0;
  const counts = emptyCounts();

  while (pageIndex < SUMMARY_MAX_PAGES) {
    const batch = await listTasks({ limit: SUMMARY_PAGE_SIZE, offset });
    if (batch.length === 0) {
      break;
    }

    for (const task of batch) {
      addToCounts(counts, task);
    }
    offset += batch.length;
    pageIndex += 1;

    if (batch.length < SUMMARY_PAGE_SIZE) {
      break;
    }
  }

  return counts;
}

export default function App() {
  const [summaryCounts, setSummaryCounts] = useState<TaskSummaryCounts>(() => emptyCounts());
  const [summaryLoading, setSummaryLoading] = useState<boolean>(true);
  const [summaryError, setSummaryError] = useState<string>("");
  const [summaryUpdatedAt, setSummaryUpdatedAt] = useState<Date | null>(null);

  const hasActiveTasks = useMemo(
    () => (summaryCounts.pending + summaryCounts.queued + summaryCounts.running) > 0,
    [summaryCounts],
  );

  const loadSummary = useCallback(async (showLoading: boolean) => {
    if (showLoading) {
      setSummaryLoading(true);
    }

    try {
      const nextSummary = await fetchSummarySnapshot();
      setSummaryCounts(nextSummary);
      setSummaryUpdatedAt(new Date());
      setSummaryError("");
    } catch (err: unknown) {
      if (err instanceof Error && err.message) {
        setSummaryError(err.message);
      } else {
        setSummaryError("Failed to refresh task summary.");
      }
    } finally {
      if (showLoading) {
        setSummaryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadSummary(true);
  }, [loadSummary]);

  useEffect(() => {
    const intervalMs = hasActiveTasks ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS;
    const timer = window.setInterval(() => {
      void loadSummary(false);
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [hasActiveTasks, loadSummary]);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
      isActive
        ? "border-cyan-400/80 bg-cyan-500/15 text-cyan-100"
        : "border-zinc-700 bg-zinc-950/85 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
    }`;

  const summaryChips = [
    { label: "Total", value: summaryCounts.total, tone: "text-zinc-100 border-zinc-700" },
    { label: "Pending", value: summaryCounts.pending, tone: "text-amber-200 border-amber-500/40" },
    { label: "Queued", value: summaryCounts.queued, tone: "text-sky-200 border-sky-500/40" },
    { label: "Running", value: summaryCounts.running, tone: "text-violet-200 border-violet-500/40" },
    { label: "Completed", value: summaryCounts.completed, tone: "text-emerald-200 border-emerald-500/40" },
    { label: "Failed", value: summaryCounts.failed, tone: "text-rose-200 border-rose-500/40" },
    { label: "Cancelled", value: summaryCounts.cancelled, tone: "text-zinc-300 border-zinc-600" },
  ];

  return (
    <div className="min-h-screen">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-800 bg-black/92 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-2 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <NavLink to="/" className={navLinkClass} end>
                <HomeIcon className="h-3.5 w-3.5" />
                Console
              </NavLink>
              <NavLink to="/tasks" className={navLinkClass}>
                <ListIcon className="h-3.5 w-3.5" />
                All Tasks
              </NavLink>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5">
              {summaryChips.map((chip) => (
                <span
                  key={chip.label}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${chip.tone}`}
                >
                  <span>{chip.label}</span>
                  <strong className="text-[11px] font-semibold">{chip.value}</strong>
                </span>
              ))}
              <button
                type="button"
                onClick={() => void loadSummary(true)}
                disabled={summaryLoading}
                className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 transition hover:border-zinc-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Refresh summary"
              >
                <RefreshIcon className="h-3.5 w-3.5" />
                {summaryLoading ? "Syncing" : "Sync"}
              </button>
            </div>
          </div>

          <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400">
            <p>Updated: {summaryUpdatedAt ? formatTimestamp(summaryUpdatedAt) : "Not yet"}</p>
            {summaryError ? (
              <p className="rounded-full border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-rose-200">
                {summaryError}
              </p>
            ) : null}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-2 pt-32 lg:px-8 lg:pt-28">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
