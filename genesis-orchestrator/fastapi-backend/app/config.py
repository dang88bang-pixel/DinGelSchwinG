"""Centralised configuration via environment variables / .env file."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings for the Genesis Orchestrator backend.

    All values can be overridden through environment variables or a `.env`
    file placed next to the process (see `.env.example` in the repo root).
    """

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # --- Neo4j ------------------------------------------------------------
    neo4j_uri: str = "bolt://neo4j:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "password"
    neo4j_database: str = "neo4j"

    # --- Gemini AI --------------------------------------------------------
    gemini_api_key: str = ""
    gemini_model: str = "gemini-1.5-flash"
    # System prompt used when asking Gemini to explain a node.
    gemini_system_prompt: str = (
        "Du bist ein technischer Assistent für ein Industrie-Dashboard. "
        "Erkläre den beschriebenen Netzwerkknoten (Switch/Controller) präzise, "
        "strukturiert und in maximal fünf Sätzen."
    )

    # --- Dynamic driver / protocol loader (Mixture-of-Experts) ------------
    # Base URL for a GitHub Releases asset, e.g.
    #   https://github.com/you/genesis-drivers/releases/download/v1.0.0/vesc_ext.zip
    driver_github_release_url: str = ""
    # S3 bucket + key prefix used when drivers are fetched from object storage.
    driver_s3_bucket: str = ""
    driver_s3_prefix: str = "drivers/"

    # --- WebSocket / server ----------------------------------------------
    ws_path: str = "/ws/telemetry"
    cors_origins: list[str] = ["*"]


settings = Settings()
