"""Pushes SDK sync payloads to open-wearables (`POST /api/v1/sdk/users/{user_id}/sync`)."""

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from types import TracebackType
from typing import Any, Self

import httpx

SYNC_PATH = "/api/v1/sdk/users/{user_id}/sync"
TIMEOUT_S = 30.0
_DETAIL_LIMIT = 300


class OpenWearablesError(Exception):
    """open-wearables rejected a payload or stayed unavailable after every retry."""


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    attempts: int = 4
    base_delay_s: float = 0.5
    max_delay_s: float = 8.0

    def delay(self, retry_index: int) -> float:
        return min(self.base_delay_s * 2**retry_index, self.max_delay_s)


_DEFAULT_RETRY = RetryPolicy()


class OpenWearablesClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        user_id: str,
        *,
        retry: RetryPolicy = _DEFAULT_RETRY,
        sleep: Callable[[float], None] = time.sleep,
        transport: httpx.BaseTransport | None = None,
        timeout_s: float = TIMEOUT_S,
    ) -> None:
        self._http = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"X-Open-Wearables-API-Key": api_key},
            timeout=timeout_s,
            transport=transport,
        )
        self._path = SYNC_PATH.format(user_id=user_id)
        self._retry = retry
        self._sleep = sleep

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None
    ) -> None:
        self.close()

    def close(self) -> None:
        self._http.close()

    def push(self, payloads: Sequence[dict[str, Any]]) -> None:
        """Sends payloads in order; the first payload that cannot be delivered raises."""
        for payload in payloads:
            self._push_one(payload)

    def _push_one(self, payload: dict[str, Any]) -> None:
        problem = ""
        for attempt in range(self._retry.attempts):
            if attempt:
                self._sleep(self._retry.delay(attempt - 1))
            problem = self._post(payload)
            if not problem:
                return
        attempts = self._retry.attempts
        raise OpenWearablesError(f"open-wearables sync failed after {attempts} attempts: {problem}")

    def _post(self, payload: dict[str, Any]) -> str:
        """Returns an empty string on success or a retryable problem; raises on a rejected payload."""
        try:
            response = self._http.post(self._path, json=payload)
        except httpx.TimeoutException as error:
            return f"timeout ({type(error).__name__})"
        except httpx.TransportError as error:
            return f"connection error ({type(error).__name__}: {error})"
        if response.is_success:
            return ""
        detail = f"HTTP {response.status_code}: {response.text[:_DETAIL_LIMIT]}"
        if response.status_code == httpx.codes.TOO_MANY_REQUESTS or response.is_server_error:
            return detail
        raise OpenWearablesError(f"open-wearables rejected the sync payload ({detail})")
