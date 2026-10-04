"""Garmin Connect access through `garminconnect`: token-store session and raw daily responses.

Credentials are only used by `login_interactively`; afterwards the session lives in the token
directory (`garmin_tokens.json`, written by the library with owner-only permissions).
"""

from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any, Protocol

from garminconnect import (
    Garmin,
    GarminConnectAuthenticationError,
    GarminConnectConnectionError,
    GarminConnectNotFoundError,
    GarminConnectTooManyRequestsError,
)

from connector.models import DayBundle

LOGIN_HINT = "run `uv run connector login`"


class GarminAuthError(Exception):
    """There is no usable Garmin Connect session."""


class GarminUnavailableError(Exception):
    """Garmin Connect is unreachable, failing or rate limiting; try again later."""


class GarminApi(Protocol):
    def login(self, /, tokenstore: str | None = None) -> tuple[str | None, str | None]: ...
    def get_heart_rates(self, cdate: str) -> Any: ...
    def get_stress_data(self, cdate: str) -> Any: ...
    def get_body_battery(self, startdate: str, enddate: str | None = None) -> Any: ...
    def get_steps_data(self, cdate: str) -> Any: ...
    def get_hrv_data(self, cdate: str) -> Any: ...
    def get_sleep_data(self, cdate: str) -> Any: ...
    def get_activities_by_date(self, startdate: str, enddate: str | None = None) -> Any: ...
    def get_device_last_used(self) -> Any: ...


class TokenStore(Protocol):
    def dump(self, path: str) -> None: ...


class GarminLoginApi(Protocol):
    client: TokenStore

    def login(self, /, tokenstore: str | None = None) -> tuple[str | None, str | None]: ...


def _unavailable(
    error: GarminConnectTooManyRequestsError | GarminConnectConnectionError,
) -> GarminUnavailableError:
    if isinstance(error, GarminConnectTooManyRequestsError):
        return GarminUnavailableError("Garmin Connect rate limit reached; backing off")
    return GarminUnavailableError(f"Garmin Connect request failed: {error}")


class GarminConnectSource:
    def __init__(self, token_dir: Path, factory: Callable[..., GarminApi] = Garmin) -> None:
        self._token_dir = token_dir
        self._factory = factory
        self._api: GarminApi | None = None

    def fetch_day(self, day: date) -> DayBundle:
        cdate = day.isoformat()
        return DayBundle(
            day=day,
            heart_rates=self._call(lambda api: api.get_heart_rates(cdate)),
            stress=self._call(lambda api: api.get_stress_data(cdate)),
            body_battery=self._call(lambda api: api.get_body_battery(cdate, cdate)),
            steps=self._call(lambda api: api.get_steps_data(cdate)),
            hrv=self._call(lambda api: api.get_hrv_data(cdate)),
            sleep=self._call(lambda api: api.get_sleep_data(cdate)),
            activities=self._call(lambda api: api.get_activities_by_date(cdate, cdate)),
        )

    def last_used_device(self) -> Any:
        return self._call(lambda api: api.get_device_last_used())

    def _session(self) -> GarminApi:
        if self._api is not None:
            return self._api
        api = self._factory()
        try:
            api.login(tokenstore=str(self._token_dir))
        except GarminConnectAuthenticationError as error:
            raise GarminAuthError(f"No valid Garmin session in {self._token_dir}; {LOGIN_HINT}") from error
        except (GarminConnectTooManyRequestsError, GarminConnectConnectionError) as error:
            raise _unavailable(error) from error
        self._api = api
        return api

    def _call[T](self, request: Callable[[GarminApi], T]) -> T | None:
        api = self._session()
        try:
            return request(api)
        except GarminConnectNotFoundError:
            return None
        except GarminConnectAuthenticationError as error:
            self._api = None
            raise GarminAuthError(f"Garmin rejected the stored session; {LOGIN_HINT}") from error
        except (GarminConnectTooManyRequestsError, GarminConnectConnectionError) as error:
            raise _unavailable(error) from error


def login_interactively(
    token_dir: Path,
    email: str,
    password: str,
    prompt_mfa: Callable[[], str],
    factory: Callable[..., GarminLoginApi] = Garmin,
) -> None:
    """Fresh credential login (MFA prompted by the library when required); stores tokens in `token_dir`."""
    api = factory(email=email, password=password, prompt_mfa=prompt_mfa)
    try:
        api.login()
    except GarminConnectAuthenticationError as error:
        raise GarminAuthError(f"Garmin rejected the email, password or MFA code: {error}") from error
    except (GarminConnectTooManyRequestsError, GarminConnectConnectionError) as error:
        raise _unavailable(error) from error
    api.client.dump(str(token_dir))
