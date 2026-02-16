# Mini LLM Task Orchestrator - Development Codex

## Project Overview

A lightweight internal prototype for scheduling and managing background LLM tasks. The system allows users to submit tasks, schedule execution, monitor progress, and chain tasks together.

**Tech Stack:**
- Backend: Python (FastAPI)
- Frontend: React
- Database: PostgreSQL
- Background Processing: Celery + Redis
- LLM: NVIDIA NIM API
- Migrations: Alembic
- API Protocol: gRPC-web

---

## Phase 0: Project Setup & Infrastructure

**Goal: Get your development environment running**

### Tasks

1. Initialize the monorepo structure
2. Set up PostgreSQL locally (Docker Compose)
3. Create FastAPI project with basic health check endpoint
4. Create React app with basic routing
5. Set up Alembic for migrations
6. Create full production schema (all enums/tables/indexes/triggers/views/functions from `SAMPLESQL.md`)
7. Run first migration
8. Verify database connection from FastAPI

### Deliverable
You can start both frontend and backend, hit a health endpoint, and verify the full schema objects exist in PostgreSQL.

---

## Phase 1: Core Task CRUD (gRPC-web)

**Goal: Users can create and view tasks (no execution yet)**

### Tasks

1. Define task service/messages in `.proto`:
   - `CreateTask`
   - `ListTasks`
   - `GetTask`
2. Generate Python stubs for backend and TypeScript/JavaScript stubs for frontend
3. Implement gRPC service handlers in FastAPI
4. Define internal schemas and mapping between gRPC messages and domain models
5. Implement database operations (SQLAlchemy models + CRUD functions)
6. Build React components:
   - Task creation form (name, prompt fields)
   - Task list view (show all tasks with their status)
   - Task detail view
7. Wire up frontend to backend (generated gRPC-web client)

### Deliverable
You can create tasks through the UI over gRPC-web and see them in a list. They just sit in "pending" status.

---

## Phase 2: Background Execution Infrastructure

**Goal: Get Celery working with your FastAPI app**

### Tasks

1. Install and configure Redis (Celery broker)
2. Set up Celery app in your FastAPI project
3. Create a simple test task that just sleeps and updates database
4. Configure Celery worker to run alongside FastAPI
5. Create a gRPC method to trigger the test task
6. Verify task execution and status updates

### Deliverable
You can trigger a background task via API and see it execute asynchronously.

---

## Phase 3: LLM Integration

**Goal: Connect to NVIDIA NIM and make a successful LLM call**

### Tasks

1. Get NVIDIA NIM API credentials
2. Create a utility function for LLM calls (handle retries, errors)
3. Test the LLM call outside of Celery first (simple script)
4. Create the main Celery task: `execute_llm_task(task_id)`
   - Fetch task from database
   - Update status to "running"
   - Call LLM with the prompt
   - Save result to database
   - Update status to "completed" or "failed"
5. Wire this up to your task creation flow

### Deliverable
When you create a task, it automatically runs in the background and the LLM result appears in the database.

---

## Phase 4: Task Lifecycle & Polling

**Goal: Frontend shows real-time task status updates**

### Tasks

1. Add status field visualization (pending/running/completed/failed)
2. Implement polling on the frontend:
   - When viewing task list or detail, poll every 2-3 seconds if any tasks are "pending" or "running"
   - Stop polling when all visible tasks are in terminal states
3. Display the LLM output when task completes
4. Add error display when task fails
5. Add timestamps (created, started, completed)

### Deliverable
You can watch tasks transition from pending to running to completed in real-time.

---

## Phase 5: gRPC-web Hardening & Contract Evolution

**Goal: Mature typed RPC workflow already in use**

### Tasks

1. Finalize/verify gRPC-web proxy setup (Envoy) for local and dev
2. Add proto evolution rules (backward compatibility, reserved field tags)
3. Standardize error mapping (gRPC status codes to frontend-visible errors)
4. Add deadlines/timeouts and metadata propagation (request IDs, user context)
5. Remove or isolate any leftover external REST task endpoints
6. Test end-to-end

### Deliverable
All external client communication is stable, typed, and fully gRPC-web.

---

## Phase 6: Task Chaining

**Goal: Create new tasks from previous outputs**

### Tasks

1. Add "Use as New Task" button on completed task detail view
2. Pre-populate task creation form with previous task's output
3. Optionally add `parent_task_id` field to track lineage
4. Update UI to show parent-child relationships

### Deliverable
You can chain tasks together.

---

## Phase 7: Polish & Documentation

**Goal: Make it presentable**

### Tasks

1. Add basic styling (Tailwind or MUI)
2. Add loading states and error handling
3. Write comprehensive README:
   - Setup instructions
   - Architecture decisions
   - What you'd improve next
   - Known limitations
4. Test the entire flow multiple times
5. Record a short demo video (optional but impressive)

### Deliverable
A working, documented system.

---

## Bonus Features (Optional)

These are not required and should only be attempted if you finish the core phases:

- Basic lineage view for chained tasks
- Execution metadata (latency, model name, token count)
- Task cancellation capability
- A cleaner UI with search or filtering
- Batch task creation
- Task templates
- Retry failed tasks

---

## Key Implementation Details

### Task Execution Flow

1. User creates task via UI
2. Task stored in database with status="pending"
3. API/service submits task to Celery
4. API/service immediately updates status to "queued"
5. Celery worker picks up task from queue
6. Worker updates status to "running"
7. Worker calls NVIDIA NIM API
8. Worker saves result and updates status to "completed" or "failed"
9. Frontend polls and displays updated status

### Task Status Semantics

- `pending`: Task created but not yet submitted to Celery
- `queued`: Submitted to Celery, waiting for worker pickup
- `running`: Worker is actively executing
- `completed` / `failed` / `cancelled`: Terminal states
- Contract: update to `queued` immediately after successful submit to Celery in create flow

### Task Chaining Data Model

- `tasks.parent_task_id`: denormalized fast access for simple parent/child queries
- `task_chains` + `task_chain_edges`: normalized graph model for lineage traversal and chain-level operations
- Keep both representations consistent via service layer orchestration and/or database triggers
- Read pattern: use `parent_task_id` for simple lookups, edges for complex traversal

### Celery Configuration

- Use Redis as message broker
- Configure result backend to PostgreSQL or Redis
- Set task serialization to JSON
- Configure worker concurrency based on expected load
- Implement task retry logic with exponential backoff

### Error Handling

- Database connection failures
- LLM API failures (rate limits, timeouts, errors)
- Invalid task inputs
- Celery worker crashes
- Network issues

---

## Testing Checklist

- [ ] Can create a task via UI
- [ ] Task appears in database
- [ ] Task automatically starts executing
- [ ] Status updates from pending to running to completed
- [ ] LLM result is displayed correctly
- [ ] Failed tasks show error messages
- [ ] Can view task history
- [ ] Can chain tasks (if implemented)
- [ ] gRPC communication works end-to-end
- [ ] Multiple concurrent tasks execute correctly

---

## README Must Include

1. **Setup Instructions**
   - Prerequisites (Python, Node, PostgreSQL, Redis)
   - Installation steps
   - Environment variables needed
   - How to run migrations
   - How to start all services

2. **Architecture Decisions**
   - Why Celery for background processing
   - Why PostgreSQL for persistence
   - Why gRPC-web from day one
   - How task execution is orchestrated

3. **Future Improvements**
   - What you'd add with more time
   - Known limitations
   - Scalability considerations
   - Security enhancements needed

4. **Usage Guide**
   - How to create a task
   - How to monitor task execution
   - How to chain tasks

---

## What Evaluators Look For

1. **End-to-end feature delivery** - You can take something ambiguous and ship a working slice
2. **Code clarity & architecture** - Readable over clever, simple over fancy, extendable without hacks
3. **UX flow** - Does the tool feel like something a teammate could actually use?
4. **Thoughtfulness** - Your README explains your approach, why you chose it, and what you'd improve
