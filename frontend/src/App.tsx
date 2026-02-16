import { Link, Navigate, Route, Routes } from "react-router-dom";

import HomePage from "./pages/HomePage";
import TaskDetailPage from "./pages/TaskDetailPage";
import TasksPage from "./pages/TasksPage";

export default function App() {
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
            <Link
              to="/"
              className="rounded-md border border-line bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-700"
            >
              Home
            </Link>
            <Link
              to="/tasks"
              className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
            >
              Tasks
            </Link>
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
    </div>
  );
}
