from __future__ import annotations

from uuid import UUID

from app.db.session import SessionLocal
from app.schemas.task import TaskGetInput
from app.services.nim_client import NIMCallError, NIMClient
from app.services.task_service import TaskService
from app.workers.celery_app import celery_app
from app.workers.task_names import EXECUTE_LLM_TASK_NAME


@celery_app.task(name=EXECUTE_LLM_TASK_NAME, bind=True)
def execute_llm_task(self, *, task_id: str) -> dict[str, str]:
    parsed_task_id = UUID(task_id)
    celery_task_id = self.request.id
    worker_id = getattr(self.request, "hostname", None)

    if not celery_task_id:
        raise RuntimeError("Celery request ID is missing")

    with SessionLocal() as db:
        service = TaskService(db)
        service.mark_task_running(
            task_id=parsed_task_id,
            celery_task_id=celery_task_id,
            worker_id=worker_id,
        )
        task = service.get_task(TaskGetInput(id=parsed_task_id))
        prompt = task.prompt

    client = NIMClient()
    try:
        result = client.generate(prompt=prompt)
        with SessionLocal() as db:
            service = TaskService(db)
            service.mark_task_completed(
                task_id=parsed_task_id,
                celery_task_id=celery_task_id,
                output=result.output_text,
                model_name=result.model_name,
                prompt_tokens=result.prompt_tokens,
                completion_tokens=result.completion_tokens,
                total_tokens=result.total_tokens,
            )
        return {
            "task_id": task_id,
            "status": "completed",
        }
    except Exception as exc:
        error_type = type(exc).__name__
        message = str(exc)
        if isinstance(exc, NIMCallError):
            error_type = "NIMCallError"
        with SessionLocal() as db:
            service = TaskService(db)
            service.mark_task_failed(
                task_id=parsed_task_id,
                celery_task_id=celery_task_id,
                error_message=message,
                error_type=error_type,
            )
        raise
