export default function HomePage() {
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-line bg-gradient-to-r from-sky-50 via-white to-emerald-50 p-6">
        <h2 className="text-2xl font-semibold text-slate-900">Mini LLM Task Orchestrator</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-700">
          Create tasks over gRPC-web, process them asynchronously with Celery, and track
          lifecycle transitions in real time.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <article className="rounded-xl border border-line bg-white p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Create</h3>
          <p className="mt-2 text-sm text-slate-700">
            Submit a prompt and immediately queue an execution attempt.
          </p>
        </article>
        <article className="rounded-xl border border-line bg-white p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Observe</h3>
          <p className="mt-2 text-sm text-slate-700">
            Watch statuses progress from queued to running to completed or failed.
          </p>
        </article>
        <article className="rounded-xl border border-line bg-white p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Chain</h3>
          <p className="mt-2 text-sm text-slate-700">
            Reuse completed output to bootstrap follow-up tasks with lineage tracking.
          </p>
        </article>
      </div>
    </section>
  );
}
