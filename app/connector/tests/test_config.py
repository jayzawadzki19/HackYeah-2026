from pathlib import Path
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest

from connector.config import ConfigError, ConnectorSettings, OpenWearablesSettings, load

SETTING_NAMES = (
    "POLL_INTERVAL_S",
    "CONNECTOR_HOST",
    "PORT",
    "CONNECTOR_USER",
    "GARMIN_TOKEN_DIR",
    "GARMIN_DEVICE_MODEL",
    "CONNECTOR_TIMEZONE",
    "CONNECTOR_STATE_DIR",
    "OW_BASE_URL",
    "OW_API_KEY",
    "OW_USER_ID",
)
USER_ID = "7f1d2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b"


@pytest.fixture(autouse=True)
def clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in SETTING_NAMES:
        monkeypatch.delenv(name, raising=False)


def test_connector_defaults() -> None:
    settings = load(ConnectorSettings, env_file=None)

    assert settings.poll_interval_s == 60
    assert settings.port == 8787
    assert settings.host == "127.0.0.1"
    assert settings.connector_user == "jakub"
    assert settings.garmin_token_dir == Path.home() / ".garminconnect"
    assert settings.garmin_device_model is None
    assert settings.timezone == ZoneInfo("Europe/Warsaw")
    assert settings.cursor_path == settings.state_dir / "cursors.json"
    assert settings.probe_dir == settings.state_dir / "probe"


def test_a_shell_host_variable_does_not_change_the_bind_address(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOST", "Jakubs-MacBook-Pro.local")

    assert load(ConnectorSettings, env_file=None).host == "127.0.0.1"


def test_environment_overrides_defaults(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("POLL_INTERVAL_S", "15")
    monkeypatch.setenv("PORT", "9000")
    monkeypatch.setenv("GARMIN_DEVICE_MODEL", "Forerunner 965")
    monkeypatch.setenv("CONNECTOR_TIMEZONE", "UTC")
    monkeypatch.setenv("CONNECTOR_STATE_DIR", str(tmp_path))

    settings = load(ConnectorSettings, env_file=None)

    assert (settings.poll_interval_s, settings.port) == (15, 9000)
    assert settings.garmin_device_model == "Forerunner 965"
    assert settings.timezone == ZoneInfo("UTC")
    assert settings.cursor_path == tmp_path / "cursors.json"


def test_token_dir_expands_the_home_directory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GARMIN_TOKEN_DIR", "~/elsewhere")

    assert load(ConnectorSettings, env_file=None).garmin_token_dir == Path.home() / "elsewhere"


def test_blank_device_model_means_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GARMIN_DEVICE_MODEL", "  ")

    assert load(ConnectorSettings, env_file=None).garmin_device_model is None


def test_env_file_is_read_and_the_environment_wins(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        f"OW_BASE_URL=http://localhost:8000\nOW_API_KEY=sk-from-file\nOW_USER_ID={USER_ID}\nPORT=9100\n"
    )
    monkeypatch.setenv("PORT", "9200")

    open_wearables = load(OpenWearablesSettings, env_file=env_file)

    assert str(open_wearables.ow_base_url) == "http://localhost:8000/"
    assert open_wearables.ow_api_key.get_secret_value() == "sk-from-file"
    assert open_wearables.ow_user_id == UUID(USER_ID)
    assert load(ConnectorSettings, env_file=env_file).port == 9200


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("CONNECTOR_TIMEZONE", "Mars/Olympus_Mons"),
        ("POLL_INTERVAL_S", "0"),
        ("PORT", "70000"),
        ("CONNECTOR_USER", ""),
    ],
)
def test_invalid_connector_settings_are_named(monkeypatch: pytest.MonkeyPatch, name: str, value: str) -> None:
    monkeypatch.setenv(name, value)

    with pytest.raises(ConfigError, match=name):
        load(ConnectorSettings, env_file=None)


def test_missing_open_wearables_settings_are_all_named() -> None:
    with pytest.raises(ConfigError) as raised:
        load(OpenWearablesSettings, env_file=None)

    assert all(name in str(raised.value) for name in ("OW_BASE_URL", "OW_API_KEY", "OW_USER_ID"))


@pytest.mark.parametrize(
    ("name", "value"),
    [("OW_BASE_URL", "localhost:8000"), ("OW_USER_ID", "jakub"), ("OW_API_KEY", "")],
)
def test_invalid_open_wearables_settings_are_named(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    valid = {"OW_BASE_URL": "http://localhost:8000", "OW_API_KEY": "sk-secret", "OW_USER_ID": USER_ID}
    for key, setting in (valid | {name: value}).items():
        monkeypatch.setenv(key, setting)

    with pytest.raises(ConfigError, match=name):
        load(OpenWearablesSettings, env_file=None)


def test_config_errors_never_echo_the_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OW_API_KEY", "sk-very-secret")
    monkeypatch.setenv("OW_USER_ID", "not-a-uuid")

    with pytest.raises(ConfigError) as raised:
        load(OpenWearablesSettings, env_file=None)

    assert "sk-very-secret" not in str(raised.value)
    assert raised.value.__cause__ is None
    assert raised.value.__suppress_context__


def test_api_key_is_hidden_in_repr(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OW_BASE_URL", "http://localhost:8000")
    monkeypatch.setenv("OW_API_KEY", "sk-very-secret")
    monkeypatch.setenv("OW_USER_ID", USER_ID)

    assert "sk-very-secret" not in repr(load(OpenWearablesSettings, env_file=None))
