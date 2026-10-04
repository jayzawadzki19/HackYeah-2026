"""Local HTTP surface (POST /sync, GET /health) and the background poll loop."""

import json
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlsplit

from connector.garmin_client import GarminAuthError, GarminUnavailableError
from connector.ow_client import OpenWearablesError
from connector.payload import iso_utc
from connector.sync import SyncResult

MAX_BACKOFF_S = 600.0
_MAX_BACKOFF_EXPONENT = 32

log = logging.getLogger(__name__)


class SyncBusyError(Exception):
    """A sync cycle is already running."""


_ERROR_STATUS: tuple[tuple[type[Exception], HTTPStatus], ...] = (
    (SyncBusyError, HTTPStatus.CONFLICT),
    (GarminAuthError, HTTPStatus.SERVICE_UNAVAILABLE),
    (GarminUnavailableError, HTTPStatus.SERVICE_UNAVAILABLE),
    (OpenWearablesError, HTTPStatus.BAD_GATEWAY),
)
_EXPECTED_ERRORS = tuple(kind for kind, _ in _ERROR_STATUS)


def describe(error: Exception) -> str:
    if isinstance(error, _EXPECTED_ERRORS):
        return str(error)
    return f"Unexpected {type(error).__name__}: {error}"


def _status_of(error: Exception) -> HTTPStatus:
    return next(
        (status for kind, status in _ERROR_STATUS if isinstance(error, kind)),
        HTTPStatus.INTERNAL_SERVER_ERROR,
    )


@dataclass(frozen=True, slots=True)
class _Health:
    last_success_at: datetime | None = None
    last_error: str | None = None


class SyncService:
    """Runs at most one sync cycle at a time and remembers how the last one went."""

    def __init__(self, cycle: Callable[[], SyncResult], clock: Callable[[], datetime]) -> None:
        self._cycle = cycle
        self._clock = clock
        self._running = threading.Lock()
        self._health = _Health()

    def run_exclusive(self) -> SyncResult:
        if not self._running.acquire(blocking=False):
            raise SyncBusyError("A sync cycle is already running")
        try:
            result = self._cycle()
            self._health = _Health(last_success_at=self._clock())
            log.info("Sync cycle pushed %d records", result.pushed_records)
            return result
        except Exception as error:
            self._health = replace(self._health, last_error=describe(error))
            log.error(
                "Sync cycle failed: %s",
                describe(error),
                exc_info=not isinstance(error, _EXPECTED_ERRORS),
            )
            raise
        finally:
            self._running.release()

    def health(self) -> dict[str, str | None]:
        health = self._health
        return {
            "status": "degraded" if health.last_error else "ok",
            "lastSuccessAt": iso_utc(health.last_success_at) if health.last_success_at else None,
            "lastError": health.last_error,
        }


class ConnectorServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], service: SyncService, user: str) -> None:
        super().__init__(address, _Handler)
        self.service = service
        self.user = user


class _Handler(BaseHTTPRequestHandler):
    server: ConnectorServer

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def log_message(self, format: str, *args: Any) -> None:
        log.info("%s %s", self.address_string(), format % args)

    def _dispatch(self, method: str) -> None:
        url = urlsplit(self.path)
        match (method, url.path):
            case ("GET", "/health"):
                self._reply(HTTPStatus.OK, self.server.service.health())
            case ("POST", "/sync"):
                self._sync(parse_qs(url.query).get("user", [self.server.user])[-1])
            case (_, "/health" | "/sync"):
                self._reply(
                    HTTPStatus.METHOD_NOT_ALLOWED,
                    {"error": f"{method} is not supported on {url.path}"},
                )
            case _:
                self._reply(HTTPStatus.NOT_FOUND, {"error": f"No route for {url.path}"})

    def _sync(self, user: str) -> None:
        if user != self.server.user:
            self._reply(
                HTTPStatus.NOT_FOUND,
                {"error": f"Unknown user '{user}'; this connector syncs '{self.server.user}'"},
            )
            return
        try:
            result = self.server.service.run_exclusive()
        except Exception as error:
            self._reply(_status_of(error), {"error": describe(error)})
            return
        latest = iso_utc(result.latest_sample_at) if result.latest_sample_at else None
        self._reply(HTTPStatus.OK, {"pushedRecords": result.pushed_records, "latestSampleAt": latest})

    def _reply(self, status: HTTPStatus, body: dict[str, Any]) -> None:
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def make_server(service: SyncService, host: str, port: int, user: str) -> ConnectorServer:
    return ConnectorServer((host, port), service, user)


def next_delay(failures: int, interval_s: float, max_backoff_s: float = MAX_BACKOFF_S) -> float:
    backoff = interval_s * 2 ** min(failures, _MAX_BACKOFF_EXPONENT)
    return min(backoff, max(max_backoff_s, interval_s))


def _failures_after_cycle(service: SyncService, failures: int) -> int:
    try:
        service.run_exclusive()
    except SyncBusyError:
        return failures
    except Exception:
        return failures + 1
    return 0


def run_poll_loop(
    service: SyncService,
    interval_s: float,
    stop: threading.Event,
    wait: Callable[[float], bool] | None = None,
    max_backoff_s: float = MAX_BACKOFF_S,
) -> None:
    """Syncs every `interval_s` until `stop` is set; failures back off exponentially and never escape."""
    sleep = wait or stop.wait
    failures = 0
    while not stop.is_set():
        failures = _failures_after_cycle(service, failures)
        sleep(next_delay(failures, interval_s, max_backoff_s))
