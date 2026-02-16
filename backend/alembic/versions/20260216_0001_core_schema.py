"""core schema"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "20260216_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')
    op.execute('CREATE EXTENSION IF NOT EXISTS "pg_trgm";')

    task_status_enum = postgresql.ENUM(
        "pending",
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
        name="task_status",
        create_type=False,
    )
    execution_priority_enum = postgresql.ENUM(
        "low",
        "normal",
        "high",
        "critical",
        name="execution_priority",
        create_type=False,
    )

    task_status_enum.create(op.get_bind(), checkfirst=True)
    execution_priority_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "tasks",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column(
            "status",
            task_status_enum,
            nullable=False,
            server_default=sa.text("'pending'::task_status"),
        ),
        sa.Column(
            "priority",
            execution_priority_enum,
            nullable=False,
            server_default=sa.text("'normal'::execution_priority"),
        ),
        sa.Column(
            "scheduled_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("execute_after", sa.DateTime(timezone=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("output", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "max_retries",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("3"),
        ),
        sa.Column(
            "retry_count",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "parent_task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("chain_position", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("created_by", sa.String(length=255), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.CheckConstraint(
            "retry_count >= 0 AND retry_count <= max_retries",
            name="valid_retry_count",
        ),
        sa.CheckConstraint(
            "chain_position IS NULL OR chain_position >= 0",
            name="valid_chain_position",
        ),
        sa.CheckConstraint(
            "(started_at IS NULL OR completed_at IS NULL OR completed_at >= started_at) "
            "AND (execute_after IS NULL OR execute_after >= scheduled_at)",
            name="valid_execution_window",
        ),
    )

    op.create_table(
        "task_executions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            task_status_enum,
            nullable=False,
            server_default=sa.text("'queued'::task_status"),
        ),
        sa.Column(
            "queued_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("model_name", sa.String(length=100), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=True),
        sa.Column("completion_tokens", sa.Integer(), nullable=True),
        sa.Column("total_tokens", sa.Integer(), nullable=True),
        sa.Column("output", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("error_type", sa.String(length=100), nullable=True),
        sa.Column("worker_id", sa.String(length=100), nullable=True),
        sa.Column("celery_task_id", sa.String(length=255), nullable=True),
        sa.Column(
            "execution_metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.CheckConstraint("attempt_number > 0", name="valid_attempt"),
        sa.CheckConstraint(
            "(prompt_tokens IS NULL AND completion_tokens IS NULL AND total_tokens IS NULL) "
            "OR (prompt_tokens >= 0 AND completion_tokens >= 0 AND total_tokens >= 0)",
            name="valid_tokens",
        ),
        sa.CheckConstraint(
            "started_at IS NULL OR completed_at IS NULL OR completed_at >= started_at",
            name="valid_execution_time",
        ),
        sa.UniqueConstraint("task_id", "attempt_number", name="unique_task_attempt"),
    )

    op.create_table(
        "task_chains",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column("chain_name", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "root_task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", task_status_enum, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.UniqueConstraint("root_task_id", name="unique_root_task"),
    )

    op.create_table(
        "task_chain_edges",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
            server_default=sa.text("uuid_generate_v4()"),
        ),
        sa.Column(
            "chain_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("task_chains.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "parent_task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "child_task_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tasks.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("output_mapping", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("condition", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("NOW()"),
        ),
        sa.CheckConstraint("parent_task_id != child_task_id", name="no_self_reference"),
        sa.UniqueConstraint("parent_task_id", "child_task_id", name="unique_edge"),
    )

    op.execute(
        "CREATE INDEX idx_tasks_status ON tasks(status) "
        "WHERE status IN ('pending', 'queued', 'running');"
    )
    op.execute(
        "CREATE INDEX idx_tasks_scheduled_at ON tasks(scheduled_at) "
        "WHERE status IN ('pending', 'queued');"
    )
    op.execute(
        "CREATE INDEX idx_tasks_execute_after ON tasks(execute_after) "
        "WHERE execute_after IS NOT NULL AND status = 'pending';"
    )
    op.execute(
        "CREATE INDEX idx_tasks_parent_task_id ON tasks(parent_task_id) "
        "WHERE parent_task_id IS NOT NULL;"
    )
    op.execute("CREATE INDEX idx_tasks_created_at ON tasks(created_at DESC);")
    op.execute(
        "CREATE INDEX idx_tasks_priority_status ON tasks(priority DESC, scheduled_at ASC) "
        "WHERE status IN ('pending', 'queued');"
    )
    op.execute("CREATE INDEX idx_tasks_metadata ON tasks USING gin(metadata);")

    op.execute("CREATE INDEX idx_task_executions_task_id ON task_executions(task_id);")
    op.execute("CREATE INDEX idx_task_executions_status ON task_executions(status);")
    op.execute(
        "CREATE INDEX idx_task_executions_created_at ON task_executions(created_at DESC);"
    )
    op.execute(
        "CREATE INDEX idx_task_executions_celery_task_id ON task_executions(celery_task_id) "
        "WHERE celery_task_id IS NOT NULL;"
    )

    op.execute("CREATE INDEX idx_task_chains_root_task_id ON task_chains(root_task_id);")
    op.execute("CREATE INDEX idx_task_chains_status ON task_chains(status);")

    op.execute("CREATE INDEX idx_task_chain_edges_chain_id ON task_chain_edges(chain_id);")
    op.execute(
        "CREATE INDEX idx_task_chain_edges_parent_task_id ON task_chain_edges(parent_task_id);"
    )
    op.execute(
        "CREATE INDEX idx_task_chain_edges_child_task_id ON task_chain_edges(child_task_id);"
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION update_updated_at_column()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    op.execute(
        """
        CREATE TRIGGER update_tasks_updated_at
            BEFORE UPDATE ON tasks
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        """
    )

    op.execute(
        """
        CREATE TRIGGER update_task_chains_updated_at
            BEFORE UPDATE ON task_chains
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION compute_execution_duration()
        RETURNS TRIGGER AS $$
        BEGIN
            IF NEW.completed_at IS NOT NULL AND NEW.started_at IS NOT NULL THEN
                NEW.duration_ms = EXTRACT(EPOCH FROM (NEW.completed_at - NEW.started_at)) * 1000;
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    op.execute(
        """
        CREATE TRIGGER compute_task_execution_duration
            BEFORE INSERT OR UPDATE ON task_executions
            FOR EACH ROW
            EXECUTE FUNCTION compute_execution_duration();
        """
    )

    op.execute(
        """
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
            CASE
                WHEN t.completed_at IS NOT NULL AND t.started_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (t.completed_at - t.started_at)) * 1000
                ELSE NULL
            END as duration_ms,
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
        """
    )

    op.execute(
        """
        CREATE OR REPLACE VIEW task_chain_hierarchy AS
        WITH RECURSIVE chain_tree AS (
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
        """
    )

    op.execute(
        """
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
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION get_next_task()
        RETURNS UUID AS $$
        DECLARE
            next_task_id UUID;
        BEGIN
            SELECT id INTO next_task_id
            FROM tasks
            WHERE status IN ('pending', 'queued')
              AND (execute_after IS NULL OR execute_after <= NOW())
              AND retry_count < max_retries
            ORDER BY
                priority DESC,
                scheduled_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED;

            RETURN next_task_id;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    op.execute(
        """
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
            SELECT output, COALESCE(chain_position, 0) + 1
            INTO v_parent_output, v_chain_position
            FROM tasks
            WHERE id = p_parent_task_id;

            IF p_use_parent_output AND v_parent_output IS NOT NULL THEN
                p_prompt := 'Previous task output: ' || v_parent_output || E'\\n\\n' || p_prompt;
            END IF;

            INSERT INTO tasks (name, prompt, parent_task_id, chain_position)
            VALUES (p_name, p_prompt, p_parent_task_id, v_chain_position)
            RETURNING id INTO v_task_id;

            SELECT chain_id INTO v_chain_id
            FROM task_chain_edges
            WHERE parent_task_id = p_parent_task_id
            LIMIT 1;

            IF v_chain_id IS NULL THEN
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

            INSERT INTO task_chain_edges (chain_id, parent_task_id, child_task_id)
            VALUES (v_chain_id, p_parent_task_id, v_task_id);

            RETURN v_task_id;
        END;
        $$ LANGUAGE plpgsql;
        """
    )

    op.execute("COMMENT ON TABLE tasks IS 'Core task definitions and current state';")
    op.execute(
        "COMMENT ON TABLE task_executions IS "
        "'Detailed execution attempts for retry tracking and audit trail';"
    )
    op.execute(
        "COMMENT ON TABLE task_chains IS 'Chain metadata for grouped task workflows';"
    )
    op.execute(
        "COMMENT ON TABLE task_chain_edges IS 'Parent-child relationships between tasks in chains';"
    )
    op.execute(
        "COMMENT ON COLUMN tasks.execute_after IS "
        "'Delayed execution - task will not run before this time';"
    )
    op.execute(
        "COMMENT ON COLUMN tasks.metadata IS "
        "'Flexible JSONB field for custom metadata, tags, or configuration';"
    )
    op.execute(
        "COMMENT ON COLUMN task_executions.execution_metadata IS "
        "'Detailed execution metrics: latency breakdown, API response headers, etc.';"
    )
    op.execute(
        "COMMENT ON COLUMN task_executions.worker_id IS "
        "'Identifier of the Celery worker that processed this execution';"
    )


def downgrade() -> None:
    op.execute("DROP VIEW IF EXISTS execution_statistics;")
    op.execute("DROP VIEW IF EXISTS task_chain_hierarchy;")
    op.execute("DROP VIEW IF EXISTS task_summary;")

    op.execute("DROP TRIGGER IF EXISTS compute_task_execution_duration ON task_executions;")
    op.execute("DROP TRIGGER IF EXISTS update_task_chains_updated_at ON task_chains;")
    op.execute("DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;")

    op.execute(
        "DROP FUNCTION IF EXISTS create_chained_task(UUID, VARCHAR, TEXT, BOOLEAN);"
    )
    op.execute("DROP FUNCTION IF EXISTS get_next_task();")
    op.execute("DROP FUNCTION IF EXISTS compute_execution_duration();")
    op.execute("DROP FUNCTION IF EXISTS update_updated_at_column();")

    op.drop_table("task_chain_edges")
    op.drop_table("task_chains")
    op.drop_table("task_executions")
    op.drop_table("tasks")

    postgresql.ENUM(name="execution_priority").drop(op.get_bind(), checkfirst=True)
    postgresql.ENUM(name="task_status").drop(op.get_bind(), checkfirst=True)

    op.execute('DROP EXTENSION IF EXISTS "pg_trgm";')
    op.execute('DROP EXTENSION IF EXISTS "uuid-ossp";')
