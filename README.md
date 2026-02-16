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

### 3) Stop services

```powershell
docker compose down
```
