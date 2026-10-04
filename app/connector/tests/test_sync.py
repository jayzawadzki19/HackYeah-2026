from collections.abc import Callable, Sequence
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import pytest

from connector.models import DayBundle, Stream
from connector.state import load_cursors, save_cursors
from connector.sync import Syncer, local_days

WARSAW = ZoneInfo("Europe/Warsaw")
TODAY = date(2026, 9, 29)
YESTERDAY = date(2026, 9, 28)
NOW = datetime(2026, 9, 29, 10, 0, tzinfo=UTC)


def ms(at: datetime) -> int:
    return round(at.timestamp() * 1000)


def gmt(at: datetime) -> str:
    return at.strftime("%Y-%m-%dT%H:%M:%S.0")


def at(hour: int, minute: int = 0, day: date = TODAY) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=UTC)


def heart_rates(*times: datetime) -> dict[str, Any]:
    return {"heartRateValues": [[ms(t), 60] for t in times]}


def steps(*starts: datetime) -> list[dict[str, Any]]:
    return [{"startGMT": gmt(s), "endGMT": gmt(s + timedelta(minutes=15)), "steps": 10} for s in starts]


class FakeSource:
    def __init__(self, bundles: dict[date, DayBundle]) -> None:
        self.bundles = bundles
        self.fetched: list[date] = []

    def fetch_day(self, day: date) -> DayBundle:
        self.fetched.append(day)
        return self.bundles.get(day, DayBundle(day=day))


class FakePusher:
    def __init__(self, error: Exception | None = None) -> None:
        self.payloads: list[dict[str, Any]] = []
        self.error = error

    def push(self, payloads: Sequence[dict[str, Any]]) -> None:
        if self.error is not None:
            raise self.error
        self.payloads.extend(payloads)

    def records(self) -> list[dict[str, Any]]:
        return [r for p in self.payloads for r in p["data"]["records"]]

    def items(self) -> int:
        return sum(len(p["data"][key]) for p in self.payloads for key in ("records", "sleep", "workouts"))


def syncer(
    source: FakeSource, pusher: FakePusher, tmp_path: Path, now: datetime = NOW, max_items: int = 5000
) -> Syncer:
    return Syncer(
        source=source,
        pusher=pusher,
        cursor_path=tmp_path / "cursors.json",
        time_zone=WARSAW,
        device_model=None,
        clock=lambda: now,
        max_items=max_items,
    )


@pytest.fixture
def fixture_day(garmin_json: Callable[[str], Any]) -> DayBundle:
    return DayBundle(
        day=TODAY,
        heart_rates=garmin_json("heart_rates"),
        stress=garmin_json("stress_60s"),
        body_battery=garmin_json("body_battery"),
        steps=garmin_json("steps"),
        hrv=garmin_json("hrv"),
        sleep=garmin_json("sleep"),
        activities=garmin_json("activities"),
    )


def test_local_days_follow_the_users_time_zone_not_utc() -> None:
    late_evening_utc = datetime(2026, 9, 29, 23, 30, tzinfo=UTC)

    assert local_days(late_evening_utc, WARSAW, 2) == [date(2026, 9, 29), date(2026, 9, 30)]


def test_poll_fetches_yesterday_and_today(tmp_path: Path) -> None:
    source = FakeSource({})

    syncer(source, FakePusher(), tmp_path).poll()

    assert source.fetched == [YESTERDAY, TODAY]


def test_first_poll_pushes_everything_and_saves_cursors(tmp_path: Path, fixture_day: DayBundle) -> None:
    pusher = FakePusher()

    result = syncer(FakeSource({TODAY: fixture_day}), pusher, tmp_path).poll()

    assert result.pushed_records == pusher.items() == 25
    assert result.per_stream[Stream.HEART_RATE] == 4
    assert result.per_stream[Stream.STEPS] == 2
    assert result.latest_sample_at == at(8, 12)
    assert load_cursors(tmp_path / "cursors.json")[Stream.HEART_RATE] == at(8, 8)


def test_polling_the_same_data_twice_pushes_nothing_the_second_time(
    tmp_path: Path, fixture_day: DayBundle
) -> None:
    source = FakeSource({TODAY: fixture_day})
    syncer(source, FakePusher(), tmp_path).poll()
    second = FakePusher()

    result = syncer(source, second, tmp_path).poll()

    assert result.pushed_records == 0
    assert result.latest_sample_at is None
    assert second.payloads == []


def test_only_samples_newer_than_the_cursor_are_pushed(tmp_path: Path) -> None:
    source = FakeSource({TODAY: DayBundle(day=TODAY, heart_rates=heart_rates(at(8), at(8, 2)))})
    syncer(source, FakePusher(), tmp_path).poll()
    source.bundles[TODAY] = DayBundle(day=TODAY, heart_rates=heart_rates(at(8), at(8, 2), at(8, 4)))
    pusher = FakePusher()

    result = syncer(source, pusher, tmp_path).poll()

    assert [r["startDate"] for r in pusher.records()] == ["2026-09-29T08:04:00Z"]
    assert result.latest_sample_at == at(8, 4)


def test_a_failed_push_leaves_the_cursors_untouched(tmp_path: Path, fixture_day: DayBundle) -> None:
    cursor_path = tmp_path / "cursors.json"
    save_cursors(cursor_path, {Stream.SLEEP: at(0)})

    with pytest.raises(RuntimeError, match="boom"):
        syncer(FakeSource({TODAY: fixture_day}), FakePusher(RuntimeError("boom")), tmp_path).poll()

    assert load_cursors(cursor_path) == {Stream.SLEEP: at(0)}


def test_step_buckets_after_the_last_synced_heart_rate_wait_for_the_next_poll(tmp_path: Path) -> None:
    source = FakeSource(
        {TODAY: DayBundle(day=TODAY, heart_rates=heart_rates(at(8, 8)), steps=steps(at(7, 45), at(8)))}
    )
    first = FakePusher()
    syncer(source, first, tmp_path).poll()
    source.bundles[TODAY] = replace(source.bundles[TODAY], heart_rates=heart_rates(at(8, 8), at(8, 20)))
    second = FakePusher()

    syncer(source, second, tmp_path).poll()

    step_starts = [
        [record["startDate"] for record in pushed.records() if record["type"] == "STEP_COUNT"]
        for pushed in (first, second)
    ]
    assert step_starts == [["2026-09-29T07:45:00Z"], ["2026-09-29T08:00:00Z"]]


def test_without_intraday_samples_step_buckets_wait_until_they_have_ended(tmp_path: Path) -> None:
    source = FakeSource({TODAY: DayBundle(day=TODAY, steps=steps(at(9, 30), at(9, 45), at(10)))})
    pusher = FakePusher()

    syncer(source, pusher, tmp_path, now=at(10, 5)).poll()

    assert [r["startDate"] for r in pusher.records()] == ["2026-09-29T09:30:00Z", "2026-09-29T09:45:00Z"]


def test_payloads_are_chunked(tmp_path: Path, fixture_day: DayBundle) -> None:
    pusher = FakePusher()

    syncer(FakeSource({TODAY: fixture_day}), pusher, tmp_path, max_items=10).poll()

    sizes = [
        sum(len(payload["data"][key]) for key in ("records", "sleep", "workouts"))
        for payload in pusher.payloads
    ]
    assert sizes == [10, 10, 5]


def test_backfill_fetches_the_last_n_days_oldest_first(tmp_path: Path) -> None:
    source = FakeSource({})

    syncer(source, FakePusher(), tmp_path).backfill(3)

    assert source.fetched == [date(2026, 9, 27), YESTERDAY, TODAY]


def test_backfill_re_pushes_history_even_when_cursors_are_ahead(tmp_path: Path) -> None:
    cursor_path = tmp_path / "cursors.json"
    later = at(12)
    save_cursors(cursor_path, {Stream.HEART_RATE: later})
    source = FakeSource(
        {
            YESTERDAY: DayBundle(day=YESTERDAY, heart_rates=heart_rates(at(9, day=YESTERDAY))),
            TODAY: DayBundle(day=TODAY, heart_rates=heart_rates(at(8))),
        }
    )
    pusher = FakePusher()

    result = syncer(source, pusher, tmp_path).backfill(2)

    assert result.pushed_records == 2
    assert load_cursors(cursor_path) == {Stream.HEART_RATE: later}


def test_backfill_advances_cursors_so_the_next_poll_pushes_nothing(
    tmp_path: Path, fixture_day: DayBundle
) -> None:
    source = FakeSource({TODAY: fixture_day})
    syncer(source, FakePusher(), tmp_path).backfill(5)
    pusher = FakePusher()

    result = syncer(source, pusher, tmp_path).poll()

    assert result.pushed_records == 0


@pytest.mark.parametrize("days", [0, -1])
def test_backfill_needs_at_least_one_day(tmp_path: Path, days: int) -> None:
    with pytest.raises(ValueError, match="at least 1"):
        syncer(FakeSource({}), FakePusher(), tmp_path).backfill(days)
