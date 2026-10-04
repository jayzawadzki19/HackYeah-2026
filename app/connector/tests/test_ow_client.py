import json
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest

from connector.ow_client import OpenWearablesClient, OpenWearablesError, RetryPolicy

API_KEY = "sk-test-not-a-real-key"
USER_ID = "8d1f5c2e-0000-4000-8000-000000000001"
PAYLOAD: dict[str, Any] = {"provider": "health_connect", "data": {"records": [{"id": "garmin-hr-1"}]}}

Handler = Callable[[httpx.Request], httpx.Response]


def replies(*steps: httpx.Response | Exception) -> tuple[Handler, list[httpx.Request]]:
    seen: list[httpx.Request] = []
    pending: Iterator[httpx.Response | Exception] = iter(steps)

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        step = next(pending)
        if isinstance(step, Exception):
            raise step
        return step

    return handler, seen


def client(handler: Handler, sleeps: list[float], base_url: str = "http://ow.test") -> OpenWearablesClient:
    return OpenWearablesClient(
        base_url=base_url,
        api_key=API_KEY,
        user_id=USER_ID,
        retry=RetryPolicy(attempts=4, base_delay_s=0.5, max_delay_s=8.0),
        sleep=sleeps.append,
        transport=httpx.MockTransport(handler),
    )


def accepted() -> httpx.Response:
    return httpx.Response(202, json={"status_code": 202, "response": "Import task queued successfully"})


def test_push_posts_each_payload_to_the_sdk_sync_endpoint_with_the_api_key() -> None:
    handler, seen = replies(accepted())

    client(handler, []).push([PAYLOAD])

    [request] = seen
    assert request.method == "POST"
    assert str(request.url) == f"http://ow.test/api/v1/sdk/users/{USER_ID}/sync"
    assert request.headers["X-Open-Wearables-API-Key"] == API_KEY
    assert request.headers["Content-Type"] == "application/json"
    assert json.loads(request.content) == PAYLOAD


def test_trailing_slash_in_base_url_is_tolerated() -> None:
    handler, seen = replies(accepted())

    client(handler, [], base_url="http://ow.test/").push([PAYLOAD])

    assert seen[0].url.path == f"/api/v1/sdk/users/{USER_ID}/sync"


def test_requests_use_a_30_second_timeout() -> None:
    handler, seen = replies(accepted())

    client(handler, []).push([PAYLOAD])

    assert seen[0].extensions["timeout"] == {"connect": 30.0, "read": 30.0, "write": 30.0, "pool": 30.0}


def test_payloads_are_sent_sequentially() -> None:
    handler, seen = replies(accepted(), accepted(), accepted())

    client(handler, []).push([PAYLOAD, {"n": 2}, {"n": 3}])

    assert [json.loads(r.content).get("n") for r in seen] == [None, 2, 3]


@pytest.mark.parametrize("status", [500, 502, 503, 429])
def test_server_errors_are_retried_with_exponential_backoff(status: int) -> None:
    handler, seen = replies(httpx.Response(status), httpx.Response(status), accepted())
    sleeps: list[float] = []

    client(handler, sleeps).push([PAYLOAD])

    assert len(seen) == 3
    assert sleeps == [0.5, 1.0]


@pytest.mark.parametrize(
    "error",
    [httpx.ReadTimeout("slow"), httpx.ConnectTimeout("slow"), httpx.ConnectError("refused")],
    ids=["read-timeout", "connect-timeout", "connect-error"],
)
def test_timeouts_and_connection_errors_are_retried(error: Exception) -> None:
    handler, seen = replies(error, accepted())
    sleeps: list[float] = []

    client(handler, sleeps).push([PAYLOAD])

    assert len(seen) == 2
    assert sleeps == [0.5]


def test_retries_give_up_after_the_configured_attempts() -> None:
    handler, seen = replies(*[httpx.Response(503, text="down")] * 4)
    sleeps: list[float] = []

    with pytest.raises(OpenWearablesError, match="4 attempts") as raised:
        client(handler, sleeps).push([PAYLOAD])

    assert len(seen) == 4
    assert sleeps == [0.5, 1.0, 2.0]
    assert API_KEY not in str(raised.value)


def test_backoff_is_capped() -> None:
    handler, _ = replies(*[httpx.Response(500)] * 6, accepted())
    sleeps: list[float] = []
    ow = OpenWearablesClient(
        base_url="http://ow.test",
        api_key=API_KEY,
        user_id=USER_ID,
        retry=RetryPolicy(attempts=7, base_delay_s=1.0, max_delay_s=5.0),
        sleep=sleeps.append,
        transport=httpx.MockTransport(handler),
    )

    ow.push([PAYLOAD])

    assert sleeps == [1.0, 2.0, 4.0, 5.0, 5.0, 5.0]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_client_errors_fail_fast_with_the_status_and_detail(status: int) -> None:
    handler, seen = replies(httpx.Response(status, json={"detail": "Unsupported provider: nope"}))
    sleeps: list[float] = []

    with pytest.raises(OpenWearablesError, match=str(status)) as raised:
        client(handler, sleeps).push([PAYLOAD])

    assert len(seen) == 1
    assert sleeps == []
    assert "Unsupported provider" in str(raised.value)
    assert API_KEY not in str(raised.value)


def test_the_client_cannot_be_used_after_its_context_exits() -> None:
    handler, _ = replies(accepted(), accepted())

    with client(handler, []) as ow:
        ow.push([PAYLOAD])

    with pytest.raises(RuntimeError):
        ow.push([PAYLOAD])


def test_a_failed_payload_stops_the_remaining_ones() -> None:
    handler, seen = replies(accepted(), httpx.Response(400, text="bad"))

    with pytest.raises(OpenWearablesError):
        client(handler, []).push([PAYLOAD, PAYLOAD, PAYLOAD])

    assert len(seen) == 2
