import json
import threading
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from connector.garmin_client import GarminAuthError, GarminUnavailableError
from connector.main import main
from connector.models import DayBundle

USER_ID = "7f1d2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b"
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


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr("connector.main.ENV_FILE", tmp_path / "missing.env")
    for name in SETTING_NAMES:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("CONNECTOR_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.setenv("GARMIN_TOKEN_DIR", str(tmp_path / "tokens"))
    monkeypatch.setenv("CONNECTOR_TIMEZONE", "UTC")


def test_help_lists_the_four_commands(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit) as raised:
        main(["--help"])

    assert raised.value.code == 0
    help_text = capsys.readouterr().out
    assert all(command in help_text for command in ("login", "probe", "backfill", "serve"))


def test_a_missing_command_is_a_usage_error() -> None:
    with pytest.raises(SystemExit) as raised:
        main([])

    assert raised.value.code == 2


@pytest.mark.parametrize("argv", [["probe"], ["probe", "--date", "29-09-2026"], ["backfill", "--days", "0"]])
def test_bad_arguments_are_a_usage_error(argv: list[str]) -> None:
    with pytest.raises(SystemExit) as raised:
        main(argv)

    assert raised.value.code == 2


def test_login_stores_a_session_without_printing_secrets(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    prompts = iter(("me@example.com", "hunter2", "123456"))
    monkeypatch.setattr("connector.main._prompt_secret", lambda _label: next(prompts))
    captured: dict[str, Any] = {}

    def fake_login(token_dir: Path, email: str, password: str, prompt_mfa: Any, factory: Any = None) -> None:
        captured["dir"] = token_dir
        captured["email"] = email
        captured["password"] = password
        captured["mfa"] = prompt_mfa()

    monkeypatch.setattr("connector.main.login_interactively", fake_login)

    assert main(["login"]) == 0

    out, err = capsys.readouterr()
    assert captured == {
        "dir": tmp_path / "tokens",
        "email": "me@example.com",
        "password": "hunter2",
        "mfa": "123456",
    }
    assert "hunter2" not in out + err
    assert "123456" not in out + err
    assert str(tmp_path / "tokens") in out


def test_login_without_an_email_does_not_call_garmin(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr("connector.main._prompt_secret", lambda _label: "")
    monkeypatch.setattr(
        "connector.main.login_interactively",
        lambda *_args, **_kwargs: pytest.fail("login was called"),
    )

    assert main(["login"]) == 1
    assert "required" in capsys.readouterr().err


class _Source:
    def __init__(self, token_dir: Path) -> None:
        self.token_dir = token_dir
        self.days: list[date] = []
        self.device_error: Exception | None = None

    def fetch_day(self, day: date) -> DayBundle:
        self.days.append(day)
        return DayBundle(day=day, heart_rates={"heartRateValues": []})

    def last_used_device(self) -> dict[str, str]:
        if self.device_error is not None:
            raise self.device_error
        return {"lastUsedDeviceName": "Forerunner 965"}


def test_probe_writes_raw_json_and_prints_a_summary(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    monkeypatch.setattr("connector.main.GarminConnectSource", _Source)

    assert main(["probe", "--date", "2026-09-29"]) == 0

    target = tmp_path / "state" / "probe" / "2026-09-29"
    assert json.loads((target / "heart_rates.json").read_text()) == {"heartRateValues": []}
    device = json.loads((target / "device_last_used.json").read_text())
    assert device["lastUsedDeviceName"] == "Forerunner 965"
    output = capsys.readouterr().out
    assert "Forerunner 965" in output
    assert f"Raw JSON written to {target}" in output


def test_probe_still_saves_the_day_when_the_device_lookup_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    def factory(token_dir: Path) -> _Source:
        source = _Source(token_dir)
        source.device_error = GarminUnavailableError("Garmin Connect rate limit reached; backing off")
        return source

    monkeypatch.setattr("connector.main.GarminConnectSource", factory)

    assert main(["probe", "--date", "2026-09-29"]) == 0
    saved = tmp_path / "state" / "probe" / "2026-09-29" / "heart_rates.json"
    assert json.loads(saved.read_text()) == {"heartRateValues": []}


def _open_wearables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OW_BASE_URL", "http://127.0.0.1:8000")
    monkeypatch.setenv("OW_API_KEY", "sk-test-key-should-not-print")
    monkeypatch.setenv("OW_USER_ID", USER_ID)


def test_backfill_pushes_the_requested_days_without_printing_the_api_key(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    sources: list[_Source] = []

    def factory(token_dir: Path) -> _Source:
        source = _Source(token_dir)
        sources.append(source)
        return source

    monkeypatch.setattr("connector.main.GarminConnectSource", factory)
    _open_wearables(monkeypatch)

    assert main(["backfill", "--days", "3"]) == 0

    assert len(sources) == 1
    assert len(sources[0].days) == 3
    assert sources[0].days == sorted(sources[0].days)
    out, err = capsys.readouterr()
    assert "Pushed 0 records" in out
    assert "sk-test-key-should-not-print" not in out + err


def test_backfill_names_missing_open_wearables_settings(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["backfill", "--days", "1"]) == 1

    message = capsys.readouterr().err
    assert all(name in message for name in ("OW_BASE_URL", "OW_API_KEY", "OW_USER_ID"))


def test_serve_starts_the_poll_loop_and_the_http_server(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    seen: dict[str, Any] = {}

    def wrapped(service: Any, interval_s: float, stop: threading.Event, **_kwargs: Any) -> None:
        seen["interval"] = interval_s
        seen["service"] = service
        stop.set()

    def serve_forever(self: Any, poll_interval: float = 0.5) -> None:
        seen["address"] = self.server_address
        seen["user"] = self.user
        seen["poll_interval"] = poll_interval

    monkeypatch.setattr("connector.main.run_poll_loop", wrapped)
    monkeypatch.setattr("connector.server.ConnectorServer.serve_forever", serve_forever)
    monkeypatch.setenv("PORT", "0")
    monkeypatch.setenv("POLL_INTERVAL_S", "15")
    _open_wearables(monkeypatch)

    assert main(["serve"]) == 0

    assert seen["interval"] == 15
    assert seen["user"] == "jakub"
    assert seen["address"][0] == "127.0.0.1"
    assert isinstance(seen["service"].health(), dict)
    assert "sk-test-key-should-not-print" not in "".join(capsys.readouterr())


def test_a_garmin_auth_failure_during_probe_is_reported_not_a_traceback(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    class Rejected:
        def __init__(self, _token_dir: Path) -> None:
            pass

        def fetch_day(self, _day: date) -> DayBundle:
            raise GarminAuthError("No valid Garmin session; run `uv run connector login`")

    monkeypatch.setattr("connector.main.GarminConnectSource", Rejected)

    assert main(["probe", "--date", "2026-09-29"]) == 1
    assert "connector login" in capsys.readouterr().err
