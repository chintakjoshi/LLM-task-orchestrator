# LLM-task-orchestrator

## Quick Start

### 1) Start all services in containers

```powershell
docker compose up --build -d
```

### 2) Verify services

- `GET http://localhost:8000/health`
- `GET http://localhost:8000/health/db`
- Open `http://localhost:5173`
- gRPC-web proxy is available at `http://localhost:8080`

### 3) Stop services

```powershell
docker compose down
```

## Regenerate gRPC Stubs

Backend Python stubs:

```powershell
cd backend
.\.venv\Scripts\python scripts/generate_grpc_stubs.py
```

Frontend TypeScript stubs:

```powershell
docker run --rm -v "${PWD}:/workspace" -w /workspace/frontend node:22-alpine sh -lc "npm ci && npm run generate:grpc"
```

## gRPC-web Contract Notes (Phase 5)

- External task APIs are gRPC-only (`CreateTask`, `ListTasks`, `GetTask`).
- REST endpoints are operational-only health checks (`/health`, `/health/db`).
- Frontend sends request metadata on every RPC:
  - `x-request-id`
  - `x-user-id`
  - `grpc-timeout`
- Backend propagates `x-request-id` back in gRPC trailers and includes it in error messages.
- Frontend maps gRPC status codes to user-facing errors with stable messaging.

### Frontend gRPC environment variables

- `VITE_GRPC_WEB_URL` (default: `http://localhost:8080`)
- `VITE_USER_ID` (default: `local-dev-user` in `.env.example`)
- `VITE_GRPC_TIMEOUT_SECONDS` (default: `10` in `.env.example`)
