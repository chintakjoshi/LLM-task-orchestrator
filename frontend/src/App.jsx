import { Link, Navigate, Route, Routes } from "react-router-dom";

import HomePage from "./pages/HomePage";
import TasksPage from "./pages/TasksPage";

export default function App() {
  return (
    <div className="app-shell">
      <header>
        <h1>Mini LLM Task Orchestrator</h1>
        <nav>
          <Link to="/">Home</Link>
          <Link to="/tasks">Tasks</Link>
        </nav>
      </header>

      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
