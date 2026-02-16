import { NavLink, Navigate, Route, Routes } from "react-router-dom";

import HomePage from "./pages/HomePage";
import TaskDetailPage from "./pages/TaskDetailPage";
import TasksPage from "./pages/TasksPage";

export default function App() {
  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `rounded-md border px-3 py-2 text-sm font-medium transition ${
      isActive
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : "border-line bg-white text-slate-700 hover:border-blue-300 hover:text-blue-700"
    }`;

  return (
    <div className="mx-auto min-h-screen max-w-6xl px-4 py-8 lg:px-8">
      <header className="mb-8 rounded-2xl border border-line bg-white/85 p-5 shadow-card backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Mini LLM Task Orchestrator
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              gRPC-web task creation and status visibility
            </p>
          </div>

          <nav className="flex gap-2">
            <NavLink to="/" className={navLinkClass} end>
              Home
            </NavLink>
            <NavLink to="/tasks" className={navLinkClass}>
              Tasks
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="mt-6 text-center text-xs text-slate-500">
        Built with FastAPI, gRPC-web, Celery, Redis, and PostgreSQL.
      </footer>
    </div>
  );
}
