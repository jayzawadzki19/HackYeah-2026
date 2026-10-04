import threading
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from connector.garmin_client import GarminAuthError, GarminUnavailableError
from connector.models import Stream
from connector.ow_client import OpenWearablesError
from connector.server import (
    ConnectorServer,
    SyncBusyError,
    SyncService,
    make_server,
    next_delay,
    run_poll_loop,
)
from connector.sync import SyncResult

NOW = datetime(2026, 9, 29, 10, 0, tzinfo=UTC)
RESULT = SyncResult(
    pushed_records=25,
    latest_sample_at=datetime(2026, 9, 29, 8, 12, tzinfo=UTC),
    per_stream={Stream.HEART_RATE: 4},
)
EMPTY = SyncResult(pushed_records=0, latest_sample_at=None, per_stream={})


class Cycles:
    """A scripted sync cycle: returns results or raises errors in order, repeating the last step."""

    def __init__(self, *steps: SyncResult | Exception) -> None:
        self.steps = list(steps)
        self.calls = 0

    def __call__(self) -> SyncResult:
        step = self.steps[min(self.calls, len(self.steps) - 1)]
        self.calls += 1
        if isinstance(step, Exception):
            raise step
        return step


def service_of(cycle: Callable[[], SyncResult]) -> SyncService:
    return SyncService(cycle=cycle, clock=lambda: NOW)


@pytest.fixture
def serve() -> Iterator[Callable[[SyncService], httpx.Client]]:
    started: list[tuple[ConnectorServer, httpx.Client]] = []

    def start(service: SyncService) -> httpx.Client:
        server = make_server(service, host="127.0.0.1", port=0, user="jakub")
        threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True).start()
        client = httpx.Client(base_url=f"http://127.0.0.1:{server.server_address[1]}", timeout=5)
        started.append((server, client))
        return client

    yield start
    for server, client in started:
        client.close()
        server.shutdown()
        server.server_close()


def test_sync_runs_one_cycle_and_returns_the_counts(serve: Callable[[SyncService], httpx.Client]) -> None:
    cycle = Cycles(RESULT)
    http = serve(service_of(cycle))

    response = http.post("/sync", params={"user": "jakub"})

    assert response.status_code == 200
    assert response.json() == {"pushedRecords": 25, "latestSampleAt": "2026-09-29T08:12:00Z"}
    assert cycle.calls == 1


def test_sync_without_new_data_reports_null_latest_sample(
    serve: Callable[[SyncService], httpx.Client],
) -> None:
    http = serve(service_of(Cycles(EMPTY)))

    assert http.post("/sync?user=jakub").json() == {"pushedRecords": 0, "latestSampleAt": None}


def test_sync_without_a_user_defaults_to_the_configured_user(
    serve: Callable[[SyncService], httpx.Client],
) -> None:
    http = serve(service_of(Cycles(RESULT)))

    assert http.post("/sync").status_code == 200


def test_sync_for_another_user_is_not_found(serve: Callable[[SyncService], httpx.Client]) -> None:
    cycle = Cycles(RESULT)
    http = serve(service_of(cycle))

    response = http.post("/sync?user=marta")

    assert response.status_code == 404
    assert "jakub" in response.json()["error"]
    assert cycle.calls == 0


def test_a_second_sync_while_one_is_running_is_a_conflict(
    serve: Callable[[SyncService], httpx.Client],
) -> None:
    started, release = threading.Event(), threading.Event()

    def slow_cycle() -> SyncResult:
        started.set()
        release.wait(5)
        return RESULT

    http = serve(service_of(slow_cycle))
    first: dict[str, httpx.Response] = {}
    worker = threading.Thread(target=lambda: first.setdefault("response", http.post("/sync?user=jakub")))
    worker.start()
    assert started.wait(5)

    second = http.post("/sync?user=jakub")
    release.set()
    worker.join(5)

    assert second.status_code == 409
    assert first["response"].status_code == 200


@pytest.mark.parametrize(
    ("error", "status"),
    [
        (GarminAuthError("No valid Garmin session; run `uv run connector login`"), 503),
        (GarminUnavailableError("Garmin Connect rate limit reached; backing off"), 503),
        (OpenWearablesError("open-wearables sync failed after 4 attempts: HTTP 503"), 502),
        (KeyError("surprise"), 500),
    ],
)
def test_failed_syncs_return_a_status_and_a_message(
    serve: Callable[[SyncService], httpx.Client], error: Exception, status: int
) -> None:
    http = serve(service_of(Cycles(error)))

    response = http.post("/sync?user=jakub")

    assert response.status_code == status
    assert response.json()["error"]


def test_garmin_auth_failure_message_tells_how_to_fix_it(
    serve: Callable[[SyncService], httpx.Client],
) -> None:
    message = "No valid Garmin session; run `uv run connector login`"
    http = serve(service_of(Cycles(GarminAuthError(message))))

    assert "connector login" in http.post("/sync?user=jakub").json()["error"]


def test_health_is_ok_before_the_first_cycle(serve: Callable[[SyncService], httpx.Client]) -> None:
    http = serve(service_of(Cycles(RESULT)))

    assert http.get("/health").json() == {"status": "ok", "lastSuccessAt": None, "lastError": None}


def test_health_reports_the_last_success(serve: Callable[[SyncService], httpx.Client]) -> None:
    http = serve(service_of(Cycles(RESULT)))
    http.post("/sync?user=jakub")

    assert http.get("/health").json() == {
        "status": "ok",
        "lastSuccessAt": "2026-09-29T10:00:00Z",
        "lastError": None,
    }


def test_health_is_degraded_after_a_failure_and_keeps_the_last_success(
    serve: Callable[[SyncService], httpx.Client],
) -> None:
    http = serve(service_of(Cycles(RESULT, GarminUnavailableError("Garmin Connect rate limit reached"))))
    http.post("/sync?user=jakub")
    http.post("/sync?user=jakub")

    assert http.get("/health").json() == {
        "status": "degraded",
        "lastSuccessAt": "2026-09-29T10:00:00Z",
        "lastError": "Garmin Connect rate limit reached",
    }


def test_health_recovers_after_a_successful_cycle(serve: Callable[[SyncService], httpx.Client]) -> None:
    http = serve(service_of(Cycles(OpenWearablesError("down"), RESULT)))
    http.post("/sync?user=jakub")
    http.post("/sync?user=jakub")

    assert http.get("/health").json()["status"] == "ok"


def test_unknown_paths_and_methods_are_rejected(serve: Callable[[SyncService], httpx.Client]) -> None:
    http = serve(service_of(Cycles(RESULT)))

    assert http.get("/nope").status_code == 404
    assert http.get("/sync").status_code == 405
    assert http.post("/health").status_code == 405


def test_run_exclusive_raises_busy_while_another_cycle_runs() -> None:
    started, release = threading.Event(), threading.Event()

    def slow_cycle() -> SyncResult:
        started.set()
        release.wait(5)
        return RESULT

    service = service_of(slow_cycle)
    worker = threading.Thread(target=service.run_exclusive)
    worker.start()
    assert started.wait(5)

    with pytest.raises(SyncBusyError):
        service.run_exclusive()
    release.set()
    worker.join(5)


@pytest.mark.parametrize(
    ("failures", "delay"),
    [(0, 60.0), (1, 120.0), (2, 240.0), (3, 480.0), (4, 600.0), (12, 600.0), (5000, 600.0)],
)
def test_poll_delay_backs_off_exponentially_up_to_ten_minutes(failures: int, delay: float) -> None:
    assert next_delay(failures, interval_s=60.0, max_backoff_s=600.0) == delay


def test_poll_delay_never_drops_below_the_interval() -> None:
    assert next_delay(0, interval_s=900.0, max_backoff_s=600.0) == 900.0


def run_loop(service: SyncService, cycles: int) -> list[float]:
    """Runs the poll loop until it has waited `cycles` times; returns the waits."""
    stop = threading.Event()
    waits: list[float] = []

    def wait(seconds: float) -> bool:
        waits.append(seconds)
        if len(waits) >= cycles:
            stop.set()
        return stop.is_set()

    run_poll_loop(service, interval_s=60.0, stop=stop, wait=wait)
    return waits


def test_poll_loop_backs_off_on_failures_and_resets_after_success() -> None:
    cycle = Cycles(GarminUnavailableError("429"), OpenWearablesError("down"), RESULT, RESULT)

    waits = run_loop(service_of(cycle), cycles=4)

    assert waits == [120.0, 240.0, 60.0, 60.0]
    assert cycle.calls == 4


def test_poll_loop_survives_unexpected_errors() -> None:
    cycle = Cycles(ZeroDivisionError("bug"), RESULT)

    waits = run_loop(service_of(cycle), cycles=2)

    assert waits == [120.0, 60.0]


def test_poll_loop_skips_a_cycle_while_a_manual_sync_runs_without_backing_off() -> None:
    started, release = threading.Event(), threading.Event()

    def slow_cycle() -> SyncResult:
        started.set()
        release.wait(5)
        return RESULT

    service = service_of(slow_cycle)
    manual = threading.Thread(target=service.run_exclusive)
    manual.start()
    assert started.wait(5)

    waits = run_loop(service, cycles=1)
    release.set()
    manual.join(5)

    assert waits == [60.0]


def test_poll_loop_stops_when_asked() -> None:
    stop = threading.Event()
    stop.set()
    cycle = Cycles(RESULT)

    run_poll_loop(service_of(cycle), interval_s=60.0, stop=stop, wait=lambda _: True)

    assert cycle.calls == 0


def test_health_timestamps_use_the_service_clock() -> None:
    times = iter([NOW, NOW + timedelta(minutes=1)])
    service = SyncService(cycle=Cycles(RESULT), clock=lambda: next(times))

    service.run_exclusive()
    service.run_exclusive()

    assert service.health()["lastSuccessAt"] == "2026-09-29T10:01:00Z"
