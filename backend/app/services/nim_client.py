from __future__ import annotations

import time
from dataclasses import dataclass

import httpx

from app.core.config import get_settings


class NIMCallError(Exception):
    pass


@dataclass(slots=True)
class NIMChatResult:
    output_text: str
    model_name: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None


class NIMClient:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._base_url = self.settings.nim_base_url.rstrip("/")

    def generate(self, *, prompt: str) -> NIMChatResult:
        api_key = self.settings.nim_api_key.strip()
        if not api_key:
            raise NIMCallError("NIM_API_KEY is not configured")

        endpoint = f"{self._base_url}/chat/completions"
        payload = {
            "model": self.settings.nim_model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                },
            ],
            "temperature": self.settings.nim_temperature,
            "max_tokens": self.settings.nim_max_tokens,
        }
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }

        max_attempts = max(1, int(self.settings.nim_retry_attempts))
        backoff = max(0.0, float(self.settings.nim_retry_backoff_seconds))
        timeout = max(1, int(self.settings.nim_timeout_seconds))

        last_error: Exception | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                with httpx.Client(timeout=timeout) as client:
                    response = client.post(endpoint, json=payload, headers=headers)
                if response.status_code in {429, 500, 502, 503, 504}:
                    raise NIMCallError(
                        f"NIM request failed with retryable status {response.status_code}: {response.text}",
                    )
                response.raise_for_status()
                return self._parse_response(response.json())
            except (httpx.HTTPError, NIMCallError, ValueError) as exc:
                last_error = exc
                if attempt >= max_attempts:
                    break
                sleep_seconds = backoff * (2 ** (attempt - 1))
                if sleep_seconds > 0:
                    time.sleep(sleep_seconds)

        raise NIMCallError(f"NIM request failed after {max_attempts} attempts: {last_error}")

    def _parse_response(self, payload: dict) -> NIMChatResult:
        choices = payload.get("choices")
        if not isinstance(choices, list) or len(choices) == 0:
            raise NIMCallError("NIM response is missing choices")

        first_choice = choices[0] or {}
        message = first_choice.get("message") or {}
        content = message.get("content")
        if not isinstance(content, str) or not content.strip():
            raise NIMCallError("NIM response is missing generated content")

        usage = payload.get("usage") or {}

        return NIMChatResult(
            output_text=content,
            model_name=payload.get("model"),
            prompt_tokens=self._to_non_negative_int(usage.get("prompt_tokens")),
            completion_tokens=self._to_non_negative_int(usage.get("completion_tokens")),
            total_tokens=self._to_non_negative_int(usage.get("total_tokens")),
        )

    @staticmethod
    def _to_non_negative_int(value: object) -> int | None:
        if value is None:
            return None
        if not isinstance(value, int):
            return None
        if value < 0:
            return None
        return value
