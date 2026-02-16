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
