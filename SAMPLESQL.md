-- ============================================================================
-- Mini LLM Task Orchestrator - Production Database Schema
-- PostgreSQL 14+
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For text search if needed

-- ============================================================================
-- ENUMS
-- ============================================================================

-- Status lifecycle contract (application-level behavior):
-- pending: created but not yet submitted to Celery
-- queued: submitted to Celery and waiting for worker pickup
-- running: worker is actively executing
-- completed/failed/cancelled: terminal states
-- Create flow contract: insert as pending, submit to Celery, then immediately update to queued.

CREATE TYPE task_status AS ENUM (
    'pending',      -- Task created but not yet queued
    'queued',       -- In queue waiting for execution
    'running',      -- Currently executing
    'completed',    -- Successfully completed
    'failed',       -- Execution failed
    'cancelled'     -- User or system cancelled
);

CREATE TYPE execution_priority AS ENUM (
    'low',
    'normal',
    'high',
    'critical'
);

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Tasks: Core task definitions
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    prompt TEXT NOT NULL,
    
    -- Task metadata
    status task_status NOT NULL DEFAULT 'pending',
    priority execution_priority NOT NULL DEFAULT 'normal',
    
    -- Scheduling
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    execute_after TIMESTAMPTZ, -- For delayed execution
    
    -- Execution tracking
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    
    -- Results
    output TEXT, -- Denormalized for quick access
    error_message TEXT,
    
    -- Retry configuration
    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_count INTEGER NOT NULL DEFAULT 0,
    
    -- Chaining
    -- Denormalized fast access for simple parent/child queries.
    -- Canonical graph relationships live in task_chain_edges for complex traversal.
    parent_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    chain_position INTEGER, -- Position in chain (0 = root)
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255), -- User identifier (optional)
    
    -- Execution metadata (JSONB for flexibility)
    metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Constraints
    CONSTRAINT valid_retry_count CHECK (retry_count >= 0 AND retry_count <= max_retries),
    CONSTRAINT valid_chain_position CHECK (chain_position IS NULL OR chain_position >= 0),
    CONSTRAINT valid_execution_window CHECK (
        (started_at IS NULL OR completed_at IS NULL OR completed_at >= started_at)
        AND (execute_after IS NULL OR execute_after >= scheduled_at)
    )
);

-- Task Executions: Detailed execution attempts (for retry tracking and history)
CREATE TABLE task_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    -- Execution details
    attempt_number INTEGER NOT NULL,
    status task_status NOT NULL DEFAULT 'queued',
    
    -- Timing
    queued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER, -- Computed duration in milliseconds
    
    -- LLM interaction
    model_name VARCHAR(100),
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    total_tokens INTEGER,
    
    -- Results
    output TEXT,
    error_message TEXT,
    error_type VARCHAR(100), -- e.g., 'timeout', 'api_error', 'validation_error'
    
    -- Execution context
    worker_id VARCHAR(100), -- Celery worker that processed this
    celery_task_id VARCHAR(255), -- Celery task ID for tracking
    
    -- Detailed metadata (latency breakdown, request/response, etc.)
    execution_metadata JSONB DEFAULT '{}'::jsonb,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT valid_attempt CHECK (attempt_number > 0),
    CONSTRAINT valid_tokens CHECK (
        (prompt_tokens IS NULL AND completion_tokens IS NULL AND total_tokens IS NULL)
        OR (prompt_tokens >= 0 AND completion_tokens >= 0 AND total_tokens >= 0)
    ),
    CONSTRAINT valid_execution_time CHECK (
        (started_at IS NULL OR completed_at IS NULL OR completed_at >= started_at)
    ),
    CONSTRAINT unique_task_attempt UNIQUE (task_id, attempt_number)
);

-- Task Chains: Normalized chain metadata for lineage-aware workflows
CREATE TABLE task_chains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Chain metadata
    chain_name VARCHAR(255),
    description TEXT,
    
    -- Root task
    root_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    -- Chain status (derived from constituent tasks)
    status task_status,
    
    -- Audit
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT unique_root_task UNIQUE (root_task_id)
);

-- Task Chain Edges: Canonical parent-child graph for complex traversal/chain operations
CREATE TABLE task_chain_edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    chain_id UUID NOT NULL REFERENCES task_chains(id) ON DELETE CASCADE,
    
    parent_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    child_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    
    -- Edge metadata
    output_mapping JSONB, -- How parent output maps to child input
    condition JSONB, -- Conditional execution rules (future use)
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT no_self_reference CHECK (parent_task_id != child_task_id),
    CONSTRAINT unique_edge UNIQUE (parent_task_id, child_task_id)
);

-- Consistency contract:
-- Keep tasks.parent_task_id and task_chain_edges synchronized via service-layer orchestration
-- and/or triggers, while treating task_chain_edges as the canonical graph structure.

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Tasks indexes
CREATE INDEX idx_tasks_status ON tasks(status) WHERE status IN ('pending', 'queued', 'running');
CREATE INDEX idx_tasks_scheduled_at ON tasks(scheduled_at) WHERE status IN ('pending', 'queued');
CREATE INDEX idx_tasks_execute_after ON tasks(execute_after) WHERE execute_after IS NOT NULL AND status = 'pending';
CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);
CREATE INDEX idx_tasks_priority_status ON tasks(priority DESC, scheduled_at ASC) WHERE status IN ('pending', 'queued');
CREATE INDEX idx_tasks_metadata ON tasks USING gin(metadata); -- For JSONB queries

-- Task Executions indexes
CREATE INDEX idx_task_executions_task_id ON task_executions(task_id);
CREATE INDEX idx_task_executions_status ON task_executions(status);
CREATE INDEX idx_task_executions_created_at ON task_executions(created_at DESC);
CREATE INDEX idx_task_executions_celery_task_id ON task_executions(celery_task_id) WHERE celery_task_id IS NOT NULL;

-- Task Chains indexes
CREATE INDEX idx_task_chains_root_task_id ON task_chains(root_task_id);
CREATE INDEX idx_task_chains_status ON task_chains(status);

-- Task Chain Edges indexes
CREATE INDEX idx_task_chain_edges_chain_id ON task_chain_edges(chain_id);
CREATE INDEX idx_task_chain_edges_parent_task_id ON task_chain_edges(parent_task_id);
CREATE INDEX idx_task_chain_edges_child_task_id ON task_chain_edges(child_task_id);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at trigger to tasks
CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Apply updated_at trigger to task_chains
CREATE TRIGGER update_task_chains_updated_at
    BEFORE UPDATE ON task_chains
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Auto-compute duration on task_executions completion
CREATE OR REPLACE FUNCTION compute_execution_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.completed_at IS NOT NULL AND NEW.started_at IS NOT NULL THEN
        NEW.duration_ms = EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER compute_task_execution_duration
    BEFORE INSERT OR UPDATE ON task_executions
    FOR EACH ROW
    EXECUTE FUNCTION compute_execution_duration();

-- ============================================================================
-- VIEWS
-- ============================================================================

-- Task Summary View: Convenient view for UI/API
CREATE OR REPLACE VIEW task_summary AS
SELECT 
    t.id,
    t.name,
    t.prompt,
    t.status,
    t.priority,
    t.scheduled_at,
    t.execute_after,
    t.started_at,
    t.completed_at,
    t.output,
    t.error_message,
    t.retry_count,
    t.max_retries,
    t.parent_task_id,
    t.chain_position,
    t.created_at,
    t.created_by,
    -- Computed fields
    CASE 
        WHEN t.completed_at IS NOT NULL AND t.started_at IS NOT NULL 
        THEN EXTRACT(EPOCH FROM (t.completed_at - t.started_at)) * 1000
        ELSE NULL 
    END as duration_ms,
    -- Latest execution info
    (
        SELECT model_name 
        FROM task_executions te 
        WHERE te.task_id = t.id 
        ORDER BY te.attempt_number DESC 
        LIMIT 1
    ) as latest_model_name,
    (
        SELECT total_tokens 
        FROM task_executions te 
        WHERE te.task_id = t.id 
        ORDER BY te.attempt_number DESC 
        LIMIT 1
    ) as total_tokens
FROM tasks t;

-- Task Chain Hierarchy View: Recursive view for chain visualization
CREATE OR REPLACE VIEW task_chain_hierarchy AS
WITH RECURSIVE chain_tree AS (
    -- Base case: root tasks
    SELECT 
        t.id,
        t.name,
        t.status,
        t.parent_task_id,
        t.chain_position,
        0 as depth,
        ARRAY[t.id] as path,
        t.id::text as hierarchy_path
    FROM tasks t
    WHERE t.parent_task_id IS NULL
    
    UNION ALL
    
    -- Recursive case: child tasks
    SELECT 
        t.id,
        t.name,
        t.status,
        t.parent_task_id,
        t.chain_position,
        ct.depth + 1,
        ct.path || t.id,
        ct.hierarchy_path || ' > ' || t.id::text
    FROM tasks t
    INNER JOIN chain_tree ct ON t.parent_task_id = ct.id
)
SELECT * FROM chain_tree;

-- Execution Statistics View: Aggregated metrics
CREATE OR REPLACE VIEW execution_statistics AS
SELECT 
    DATE_TRUNC('hour', te.created_at) as hour,
    te.status,
    te.model_name,
    COUNT(*) as execution_count,
    AVG(te.duration_ms) as avg_duration_ms,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY te.duration_ms) as median_duration_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY te.duration_ms) as p95_duration_ms,
    AVG(te.total_tokens) as avg_tokens,
    SUM(te.total_tokens) as total_tokens
FROM task_executions te
WHERE te.completed_at IS NOT NULL
GROUP BY DATE_TRUNC('hour', te.created_at), te.status, te.model_name;

-- ============================================================================
-- FUNCTIONS
-- ============================================================================

-- Function to get next task to execute (queue logic)
CREATE OR REPLACE FUNCTION get_next_task()
RETURNS UUID AS $$
DECLARE
    next_task_id UUID;
BEGIN
    -- Select the highest priority pending/queued task that's ready to execute
    SELECT id INTO next_task_id
    FROM tasks
    WHERE status IN ('pending', 'queued')
      AND (execute_after IS NULL OR execute_after <= NOW())
      AND retry_count < max_retries
    ORDER BY 
        priority DESC,
        scheduled_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED; -- Prevent race conditions with multiple workers
    
    RETURN next_task_id;
END;
$$ LANGUAGE plpgsql;

-- Function to create a chained task
CREATE OR REPLACE FUNCTION create_chained_task(
    p_parent_task_id UUID,
    p_name VARCHAR(255),
    p_prompt TEXT,
    p_use_parent_output BOOLEAN DEFAULT TRUE
)
RETURNS UUID AS $$
DECLARE
    v_task_id UUID;
    v_parent_output TEXT;
    v_chain_position INTEGER;
    v_chain_id UUID;
BEGIN
    -- Get parent task output and chain position
    SELECT output, COALESCE(chain_position, 0) + 1 
    INTO v_parent_output, v_chain_position
    FROM tasks 
    WHERE id = p_parent_task_id;
    
    -- If using parent output, prepend it to the prompt
    IF p_use_parent_output AND v_parent_output IS NOT NULL THEN
        p_prompt := 'Previous task output: ' || v_parent_output || E'\n\n' || p_prompt;
    END IF;
    
    -- Create the child task
    INSERT INTO tasks (name, prompt, parent_task_id, chain_position)
    VALUES (p_name, p_prompt, p_parent_task_id, v_chain_position)
    RETURNING id INTO v_task_id;
    
    -- Update or create chain
    SELECT chain_id INTO v_chain_id
    FROM task_chain_edges
    WHERE parent_task_id = p_parent_task_id
    LIMIT 1;
    
    IF v_chain_id IS NULL THEN
        -- Find or create chain with root task
        SELECT id INTO v_chain_id
        FROM task_chains
        WHERE root_task_id = (
            SELECT COALESCE(
                (SELECT root_task_id FROM task_chains tc2 
                 JOIN task_chain_edges tce2 ON tc2.id = tce2.chain_id 
                 WHERE tce2.child_task_id = p_parent_task_id OR tce2.parent_task_id = p_parent_task_id
                 LIMIT 1),
                p_parent_task_id
            )
        );
        
        IF v_chain_id IS NULL THEN
            INSERT INTO task_chains (root_task_id)
            VALUES (p_parent_task_id)
            RETURNING id INTO v_chain_id;
        END IF;
    END IF;
    
    -- Create chain edge
    INSERT INTO task_chain_edges (chain_id, parent_task_id, child_task_id)
    VALUES (v_chain_id, p_parent_task_id, v_task_id);
    
    RETURN v_task_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS (Documentation)
-- ============================================================================

COMMENT ON TABLE tasks IS 'Core task definitions and current state';
COMMENT ON TABLE task_executions IS 'Detailed execution attempts for retry tracking and audit trail';
COMMENT ON TABLE task_chains IS 'Chain metadata for grouped task workflows';
COMMENT ON TABLE task_chain_edges IS 'Parent-child relationships between tasks in chains';

COMMENT ON COLUMN tasks.execute_after IS 'Delayed execution - task will not run before this time';
COMMENT ON COLUMN tasks.metadata IS 'Flexible JSONB field for custom metadata, tags, or configuration';
COMMENT ON COLUMN task_executions.execution_metadata IS 'Detailed execution metrics: latency breakdown, API response headers, etc.';
COMMENT ON COLUMN task_executions.worker_id IS 'Identifier of the Celery worker that processed this execution';

-- ============================================================================
-- SAMPLE DATA (Optional - for development/testing)
-- ============================================================================

-- Uncomment to insert sample data:
/*
INSERT INTO tasks (name, prompt, priority) VALUES
    ('Summarize Article', 'Please summarize the following article about AI...', 'high'),
    ('Generate Code', 'Write a Python function to calculate fibonacci numbers', 'normal'),
    ('Translate Text', 'Translate this text to Spanish: Hello, world!', 'low');
*/
