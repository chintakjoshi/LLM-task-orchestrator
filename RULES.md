# RULES.md

## Project: Mini LLM Task Orchestrator

This file defines strict engineering, architecture, and implementation
rules for the LLM agent contributing to this project. The agent must
follow these rules exactly when generating or modifying code, schemas,
tests, or architecture decisions.

This is an interview evaluation project. Priorities are clarity,
correctness, architecture quality, and thoughtfulness over cleverness or
speed.

------------------------------------------------------------------------

# 1. Primary Objective

Deliver a clean, understandable, production-structured prototype of a
background LLM task scheduler that demonstrates strong system design,
not feature quantity.

The system must clearly show:

- Background execution architecture
- Proper separation of concerns
- Correct persistence modeling
- Reliable task lifecycle handling
- Thoughtful error handling
- Readable code

------------------------------------------------------------------------

# 2. Absolute Priorities Order

When tradeoffs occur, prioritize:

1. Correctness
2. Reliability
3. Readability
4. Architecture clarity
5. Extensibility
6. Performance
7. Visual polish

Never violate this ordering.

------------------------------------------------------------------------

# 3. Architectural Requirements

The backend must be separated into these modules:

`api/` `core/` `db/` `models/` `schemas/` `services/` `workers/` `repositories/`

Rules:

- `api/` -> route handlers and gRPC handlers only
- `schemas/` -> validation and schema mapping only
- `services/` -> orchestration and business logic only
- `repositories/` -> database access only
- `workers/` -> Celery task definitions/execution only
- Controlled Celery enqueue calls are allowed in handlers, but handlers must remain thin

Forbidden:

- SQL inside handlers
- Heavy business logic in handlers
- Heavy task execution logic in handlers
- Direct DB access outside repositories

------------------------------------------------------------------------

# 4. API Protocol Requirement

- gRPC-web is required from the start of implementation.
- External task APIs should be gRPC-based.
- REST is optional only for internal operational endpoints (for example, health checks).

------------------------------------------------------------------------

# 5. Database Requirement

- Use the full schema defined in `SAMPLESQL.md` from the beginning
  (enums, tables, indexes, triggers, views, functions).

------------------------------------------------------------------------

# 6. Task Lifecycle Contract

Status semantics are mandatory:

- `pending`: created but not yet submitted to Celery
- `queued`: submitted to Celery, waiting for worker pickup
- `running`: worker actively executing
- `completed` / `failed` / `cancelled`: terminal states

Create flow requirement:

- Submit to Celery, then update status to `queued` immediately after successful submission.

------------------------------------------------------------------------

# 7. Task Chaining Data Model Contract

Use both representations with clear separation of concerns:

- `tasks.parent_task_id`: denormalized fast access for simple parent/child reads
- `task_chains` + `task_chain_edges`: normalized canonical structure for
  lineage traversal, DAG operations, and chain-level logic

Consistency requirement:

- Keep denormalized and normalized representations in sync via service layer and/or triggers.
- Read pattern:
  - simple parent/child lookup -> `parent_task_id`
  - complex traversal/lineage logic -> `task_chain_edges` (and chain tables)

------------------------------------------------------------------------

# 8. Final Directive

Act like a senior backend engineer submitting infrastructure code for
production review.
