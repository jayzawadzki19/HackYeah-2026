from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from garminconnect import (
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectNotFoundError,
    GarminConnectTooManyRequestsError,
)

from connector.garmin_client import (
    GarminAuthError,
    GarminConnectSource,
    GarminUnavailableError,
    login_interactively,
)

DAY = date(2026, 9, 29)
DATA_CALLS = (
    "get_heart_rates",
    "get_stress_data",
    "get_body_battery",
    "get_steps_data",
    "get_hrv_data",
    "get_sleep_data",
    "get_activities_by_date",
)


class FakeTokenClient:
    def __init__(self) -> None:
        self.dumped_to: list[str] = []

    def dump(self, path: str) -> None:
        self.dumped_to.append(path)


class FakeGarmin:
    """Stands in for `garminconnect.Garmin`; records calls and answers from canned responses."""

    def __init__(
        self, responses: dict[str, Any] | None = None, errors: dict[str, Exception] | None = None
    ) -> None:
        self.responses = responses or {}
        self.errors = errors or {}
        self.constructor: dict[str, Any] = {}
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.client = FakeTokenClient()

    def _answer(self, name: str, *args: Any) -> Any:
        self.calls.append((name, args))
        if name in self.errors:
            raise self.errors[name]
        return self.responses.get(name, {"call": name})

    def login(self, /, tokenstore: str | None = None) -> tuple[str | None, str | None]:
        prompt_mfa = self.constructor.get("prompt_mfa")
        if prompt_mfa is not None and self.responses.get("needs_mfa"):
            self.calls.append(("mfa", (prompt_mfa(),)))
        self._answer("login", tokenstore)
        return None, None

    def get_heart_rates(self, cdate: str) -> Any:
        return self._answer("get_heart_rates", cdate)

    def get_stress_data(self, cdate: str) -> Any:
        return self._answer("get_stress_data", cdate)

    def get_body_battery(self, startdate: str, enddate: str | None = None) -> Any:
        return self._answer("get_body_battery", startdate, enddate)

    def get_steps_data(self, cdate: str) -> Any:
        return self._answer("get_steps_data", cdate)

    def get_hrv_data(self, cdate: str) -> Any:
        return self._answer("get_hrv_data", cdate)

    def get_sleep_data(self, cdate: str) -> Any:
        return self._answer("get_sleep_data", cdate)

    def get_activities_by_date(self, startdate: str, enddate: str | None = None) -> Any:
        return self._answer("get_activities_by_date", startdate, enddate)

    def get_device_last_used(self) -> Any:
        return self._answer("get_device_last_used")


def factory_of(*instances: FakeGarmin) -> tuple[Callable[..., FakeGarmin], list[dict[str, Any]]]:
    pending = list(instances)
    constructed: list[dict[str, Any]] = []

    def factory(**kwargs: Any) -> FakeGarmin:
        constructed.append(kwargs)
        instance = pending.pop(0)
        instance.constructor = kwargs
        return instance

    return factory, constructed


def call_names(fake: FakeGarmin) -> list[str]:
    return [name for name, _ in fake.calls]


def test_fetch_day_resumes_the_stored_session_and_collects_every_call(tmp_path: Path) -> None:
    fake = FakeGarmin()
    factory, constructed = factory_of(fake)

    bundle = GarminConnectSource(tmp_path, factory).fetch_day(DAY)

    assert constructed == [{}]
    assert fake.calls[0] == ("login", (str(tmp_path),))
    assert dict(fake.calls[1:]) == {
        "get_heart_rates": ("2026-09-29",),
        "get_stress_data": ("2026-09-29",),
        "get_body_battery": ("2026-09-29", "2026-09-29"),
        "get_steps_data": ("2026-09-29",),
        "get_hrv_data": ("2026-09-29",),
        "get_sleep_data": ("2026-09-29",),
        "get_activities_by_date": ("2026-09-29", "2026-09-29"),
    }
    assert bundle.day == DAY
    assert bundle.heart_rates == {"call": "get_heart_rates"}
    assert bundle.stress == {"call": "get_stress_data"}
    assert bundle.body_battery == {"call": "get_body_battery"}
    assert bundle.steps == {"call": "get_steps_data"}
    assert bundle.hrv == {"call": "get_hrv_data"}
    assert bundle.sleep == {"call": "get_sleep_data"}
    assert bundle.activities == {"call": "get_activities_by_date"}


def test_the_session_is_reused_across_days(tmp_path: Path) -> None:
    fake = FakeGarmin()
    factory, constructed = factory_of(fake)
    source = GarminConnectSource(tmp_path, factory)

    source.fetch_day(DAY)
    source.fetch_day(date(2026, 9, 30))

    assert len(constructed) == 1
    assert call_names(fake).count("login") == 1


def test_missing_data_for_one_call_leaves_that_field_empty(tmp_path: Path) -> None:
    fake = FakeGarmin(errors={"get_hrv_data": GarminConnectNotFoundError("404")})
    factory, _ = factory_of(fake)

    bundle = GarminConnectSource(tmp_path, factory).fetch_day(DAY)

    assert bundle.hrv is None
    assert bundle.sleep == {"call": "get_sleep_data"}


def test_a_rejected_stored_session_asks_for_connector_login(tmp_path: Path) -> None:
    factory, _ = factory_of(
        FakeGarmin(errors={"login": GarminConnectAuthenticationError("Username and password are required")})
    )

    with pytest.raises(GarminAuthError, match="connector login"):
        GarminConnectSource(tmp_path, factory).fetch_day(DAY)


def test_an_auth_failure_during_a_call_drops_the_session_so_the_next_fetch_logs_in_again(
    tmp_path: Path,
) -> None:
    expired = FakeGarmin(errors={"get_stress_data": GarminConnectAuthenticationError("401")})
    fresh = FakeGarmin()
    factory, constructed = factory_of(expired, fresh)
    source = GarminConnectSource(tmp_path, factory)

    with pytest.raises(GarminAuthError):
        source.fetch_day(DAY)
    source.fetch_day(DAY)

    assert len(constructed) == 2
    assert call_names(fresh)[0] == "login"


@pytest.mark.parametrize(
    "error",
    [GarminConnectTooManyRequestsError("429"), GarminConnectConnectionError("API Error 503")],
    ids=["rate-limited", "connection-error"],
)
@pytest.mark.parametrize("failing_call", ["login", *DATA_CALLS])
def test_garmin_outages_surface_as_unavailable(tmp_path: Path, error: Exception, failing_call: str) -> None:
    factory, _ = factory_of(FakeGarmin(errors={failing_call: error}))

    with pytest.raises(GarminUnavailableError):
        GarminConnectSource(tmp_path, factory).fetch_day(DAY)


def test_real_library_without_stored_tokens_asks_for_connector_login(tmp_path: Path) -> None:
    with pytest.raises(GarminAuthError, match="connector login"):
        GarminConnectSource(tmp_path / "no-tokens-here").fetch_day(DAY)


def test_last_used_device_returns_the_raw_response(tmp_path: Path) -> None:
    fake = FakeGarmin(responses={"get_device_last_used": {"lastUsedDeviceName": "Forerunner 265"}})
    factory, _ = factory_of(fake)

    device = GarminConnectSource(tmp_path, factory).last_used_device()

    assert device == {"lastUsedDeviceName": "Forerunner 265"}


def test_interactive_login_uses_credentials_once_and_stores_tokens_in_the_token_dir(tmp_path: Path) -> None:
    fake = FakeGarmin(responses={"needs_mfa": True})
    factory, constructed = factory_of(fake)

    def mfa_code() -> str:
        return "123456"

    login_interactively(tmp_path, "me@example.com", "hunter2", mfa_code, factory)

    assert constructed == [{"email": "me@example.com", "password": "hunter2", "prompt_mfa": mfa_code}]
    assert fake.calls == [("mfa", ("123456",)), ("login", (None,))]
    assert fake.client.dumped_to == [str(tmp_path)]


def test_interactive_login_with_wrong_credentials_stores_nothing(tmp_path: Path) -> None:
    fake = FakeGarmin(errors={"login": GarminConnectAuthenticationError("401 Unauthorized")})
    factory, _ = factory_of(fake)

    with pytest.raises(GarminAuthError, match="email, password or MFA code"):
        login_interactively(tmp_path, "me@example.com", "wrong", lambda: "000000", factory)

    assert fake.client.dumped_to == []


def test_interactive_login_when_rate_limited_is_unavailable(tmp_path: Path) -> None:
    fake = FakeGarmin(errors={"login": GarminConnectTooManyRequestsError("429")})
    factory, _ = factory_of(fake)

    with pytest.raises(GarminUnavailableError):
        login_interactively(tmp_path, "me@example.com", "pw", lambda: "000000", factory)
