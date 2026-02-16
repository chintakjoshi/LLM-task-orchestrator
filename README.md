# LLM Task Orchestrator

Mini orchestration system for asynchronous LLM task execution with:
- FastAPI + gRPC backend
- React + gRPC-web frontend
- PostgreSQL persistence
- Celery + Redis background execution
- Envoy gRPC-web proxy
- NVIDIA NIM LLM

## Architecture

Request and execution flow:
1. Frontend calls Envoy at `http://localhost:8080` using gRPC-web.
2. Envoy forwards to backend gRPC server (`TaskService`).
3. Backend validates input, persists task, and enqueues Celery work.
4. Celery worker fetches task prompt, calls NVIDIA NIM, and updates task/execution rows.
5. Frontend polls task list/detail and renders status transitions.

Key backend boundaries:
- `api/`: REST health handlers + gRPC handlers
- `schemas/`: validation + protocol mapping
- `services/`: orchestration/business logic
- `repositories/`: DB access
- `workers/`: Celery execution

## Repository Layout

- `backend/`: FastAPI, gRPC handlers, Celery, SQLAlchemy, Alembic
- `frontend/`: React + Vite + Tailwind + generated gRPC-web client
- `proto/`: source `.proto` contracts
- `envoy/`: gRPC-web proxy config
- `docker-compose.yml`: local multi-service environment

## Prerequisites

- Docker + Docker Compose
- Optional local tooling:
  - Python 3.11+
  - Node 20+
  - npm

## Environment Setup

Backend env (`backend/.env`):
1. Copy from `backend/.env.example`.
2. Set at minimum:
   - `NIM_API_KEY`
3. Optional tuning:
   - `NIM_MODEL`
   - `NIM_TIMEOUT_SECONDS`
   - `NIM_RETRY_ATTEMPTS`
   - `NIM_RETRY_BACKOFF_SECONDS`

Frontend env (`frontend/.env`):
1. Copy from `frontend/.env.example`.
2. Optional overrides:
   - `VITE_GRPC_WEB_URL` (default `http://localhost:8080`)
   - `VITE_USER_ID`
   - `VITE_GRPC_TIMEOUT_SECONDS`

## gRPC Stub Generation

Preferred (containerized, deterministic across hosts):

```powershell
docker compose run --rm grpc_stubgen
```

Equivalent helper:

```powershell
./scripts/generate_grpc_stubs.ps1
```

Local fallback (host tooling dependent):

```powershell
cd frontend
npm run generate:grpc:local
```

## Run With Docker

Start:

```powershell
docker compose up --build -d
```

Verify:
- `http://localhost:5173` (frontend)
- `GET http://localhost:8000/health`
- `GET http://localhost:8000/health/db`
- Envoy gRPC-web endpoint: `http://localhost:8080`

Stop:

```powershell
docker compose down
```

## Usage Guide

Create and execute a task:
1. Open `/tasks`.
2. Enter `name` and `prompt`.
3. Submit.
4. Observe status transitions: `queued -> running -> completed|failed`.

Monitor:
- Task list auto-polls while active tasks exist.
- Task detail auto-polls while selected task is active.
- Detail view shows prompt/output/error/timestamps and latest execution metadata (latency/model/token usage).
- Task list includes search and status filtering for faster triage.

Chain:
1. Open a completed task with output.
2. Click `Use as New Task`.
3. Review prefilled prompt and submit follow-up task.
4. Parent-child relationship appears in list/detail views with lineage visualization.

Retry failed task:
1. Open a failed task.
2. Click `Retry Task` if retries remain.
3. Task is re-queued and execution history records a new attempt.

Cancel active task:
1. Open a pending/queued/running task.
2. Click `Cancel Task`.
3. Task transitions to `cancelled` and worker completion is ignored if cancellation wins the race.

Create from templates:
1. Open the `Task Templates` section.
2. Select a template and provide input text.
3. Submit to generate a queued task from the rendered prompt.

Batch create:
1. Open the `Batch Create` section.
2. Enter one task per line (`Name | Prompt` or prompt-only lines).
3. Submit to enqueue up to 50 tasks in one request.

## API Surface

External task APIs are gRPC-only:
- `TaskService.CreateTask`
- `TaskService.ListTasks`
- `TaskService.GetTask`
- `TaskService.CancelTask`
- `TaskService.RetryTask`
- `TaskService.BatchCreateTasks`
- `TaskService.ListTaskTemplates`
- `TaskService.CreateTaskFromTemplate`
- `TaskService.GetTaskLineage`

REST endpoints are operational:
- `GET /health`
- `GET /health/db`

## gRPC-web Contract Notes

- Frontend attaches:
  - `x-request-id`
  - `x-user-id`
  - `grpc-timeout`
- Backend returns `x-request-id` in trailers and includes request IDs in error text.
- Frontend maps gRPC status codes to stable user-facing messages.
- Proto evolution guards (`reserved` tags/names) are defined in `tasks.proto`.

## Architecture Decisions

Why Celery:
- clear async execution model
- resilient queueing with Redis broker
- simple operational model for prototype scale

Why PostgreSQL:
- reliable relational persistence for task lifecycle + execution history
- supports advanced schema objects needed by `SAMPLESQL.md` (views/functions/triggers)
- good fit for audit/history-oriented workloads

Why gRPC-web from day one:
- typed client/server contract
- generated clients reduce API drift
- clear evolution path with proto versioning and reserved fields

How orchestration works:
- service layer owns create/enqueue coordination
- repository layer owns persistence updates
- worker layer owns long-running external call and terminal status updates

## Error Handling

Implemented handling includes:
- pydantic validation -> `INVALID_ARGUMENT`
- missing task/parent -> `NOT_FOUND`
- enqueue failures -> `UNAVAILABLE`
- DB failures -> `INTERNAL`
- client-side mapping for gRPC status code families

Frontend behavior:
- separate create and list/detail error banners
- retry actions for list/detail fetch failures
- non-blocking lineage warning in task detail when lineage enrichment fails

## Validation Performed

Build and static checks run:
- `python -m compileall backend/app`
- `frontend/node_modules/.bin/tsc --noEmit`
- `npm run build` (frontend production build)

## Future Improvements

- Add authn/authz and tenant-aware access controls.
- Add richer graph-style lineage UI (DAG visualization with edge metadata).
- Add observability stack (OpenTelemetry traces, metrics dashboards).
- Add automated end-to-end integration tests with ephemeral infra.
- Add server-side filtering/search/sorting and pagination RPCs for large datasets.
- Add idempotency keys for create flow.
