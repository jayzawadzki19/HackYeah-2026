"""Settings from the environment or `app/connector/.env`; the environment wins."""

from collections.abc import Sequence
from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo

from pydantic import AnyHttpUrl, Field, SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

CONNECTOR_DIR = Path(__file__).resolve().parents[1]
ENV_FILE = CONNECTOR_DIR / ".env"


class ConfigError(Exception):
    """Settings are missing or invalid."""


class _Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")


class ConnectorSettings(_Settings):
    poll_interval_s: float = Field(default=60.0, gt=0)
    host: str = Field(default="127.0.0.1", min_length=1, validation_alias="CONNECTOR_HOST")
    port: int = Field(default=8787, ge=0, le=65535)
    connector_user: str = Field(default="jakub", min_length=1)
    garmin_token_dir: Path = Field(default=Path("~/.garminconnect"), validate_default=True)
    garmin_device_model: str | None = None
    timezone: ZoneInfo = Field(default=ZoneInfo("Europe/Warsaw"), validation_alias="CONNECTOR_TIMEZONE")
    state_dir: Path = Field(default=CONNECTOR_DIR / "state", validation_alias="CONNECTOR_STATE_DIR")

    @field_validator("garmin_token_dir", "state_dir")
    @classmethod
    def _expand_home(cls, value: Path) -> Path:
        return value.expanduser()

    @field_validator("garmin_device_model")
    @classmethod
    def _blank_is_unknown(cls, value: str | None) -> str | None:
        return (value or "").strip() or None

    @property
    def cursor_path(self) -> Path:
        return self.state_dir / "cursors.json"

    @property
    def probe_dir(self) -> Path:
        return self.state_dir / "probe"


class OpenWearablesSettings(_Settings):
    ow_base_url: AnyHttpUrl
    ow_api_key: SecretStr = Field(min_length=1)
    ow_user_id: UUID


def _setting_name(location: Sequence[int | str]) -> str:
    return "_".join(map(str, location)).upper()


def load[T: BaseSettings](kind: type[T], env_file: Path | None = ENV_FILE) -> T:
    """Loads settings; problems are reported by setting name only, never with their values."""
    try:
        return kind(_env_file=env_file)
    except ValidationError as error:
        problems = "; ".join(
            f"{_setting_name(problem['loc'])}: {problem['msg']}"
            for problem in error.errors(include_input=False)
        )
        where = env_file or "no .env file"
        raise ConfigError(f"Invalid settings (environment or {where}): {problems}") from None
