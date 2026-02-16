from functools import lru_cache

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Mini LLM Task Orchestrator"
    environment: str = "development"
    debug: bool = False

    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/llm_orchestrator"
    redis_url: str = "redis://localhost:6379/0"
    grpc_host: str = "0.0.0.0"
    grpc_port: int = 50051
    nim_base_url: str = "https://integrate.api.nvidia.com/v1"
    nim_api_key: str
    nim_model: str = "openai/gpt-oss-120b"
    nim_timeout_seconds: int = 60
    nim_max_tokens: int = 1024
    nim_temperature: float = 0.2
    nim_retry_attempts: int = 3
    nim_retry_backoff_seconds: float = 1.0

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("nim_api_key")
    @classmethod
    def validate_nim_api_key(cls, value: str) -> str:
        token = value.strip()
        if not token:
            raise ValueError("NIM_API_KEY must be set and non-empty")
        return token


@lru_cache
def get_settings() -> Settings:
    return Settings()
