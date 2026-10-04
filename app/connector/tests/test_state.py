import json
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest

from connector.mapper import map_day
from connector.models import DayBundle, MetricSample, Stream
from connector.state import CursorFileError, advance, load_cursors, save_cursors, select_new

T0 = datetime(2026, 9, 29, 8, 0, tzinfo=UTC)


def hr(minute: int) -> MetricSample:
    at = T0 + timedelta(minutes=minute)
    return MetricSample(Stream.HEART_RATE, at, at, 60)


def stress(minute: int) -> MetricSample:
    at = T0 + timedelta(minutes=minute)
    return MetricSample(Stream.STRESS, at, at, 20)


def test_missing_cursor_file_means_no_cursors(tmp_path: Path) -> None:
    assert load_cursors(tmp_path / "cursors.json") == {}


def test_cursors_round_trip_through_a_json_file(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "state" / "cursors.json"
    cursors = {Stream.HEART_RATE: T0, Stream.SLEEP: T0 - timedelta(hours=9)}

    save_cursors(path, cursors)

    assert load_cursors(path) == cursors
    assert json.loads(path.read_text(encoding="utf-8")) == {
        "HEART_RATE": "2026-09-29T08:00:00+00:00",
        "sleep": "2026-09-28T23:00:00+00:00",
    }


def test_saving_replaces_the_file_without_leaving_temporary_files(tmp_path: Path) -> None:
    path = tmp_path / "cursors.json"
    save_cursors(path, {Stream.HEART_RATE: T0})

    save_cursors(path, {Stream.HEART_RATE: T0 + timedelta(minutes=5)})

    assert load_cursors(path) == {Stream.HEART_RATE: T0 + timedelta(minutes=5)}
    assert [p.name for p in tmp_path.iterdir()] == ["cursors.json"]


@pytest.mark.parametrize("content", ["not json", "[]", '{"HEART_RATE": "yesterday"}', '{"HEART_RATE": 5}'])
def test_corrupt_cursor_file_raises_a_readable_error(tmp_path: Path, content: str) -> None:
    path = tmp_path / "cursors.json"
    path.write_text(content, encoding="utf-8")

    with pytest.raises(CursorFileError, match=r"cursors\.json"):
        load_cursors(path)


def test_unknown_streams_in_the_file_are_ignored(tmp_path: Path) -> None:
    path = tmp_path / "cursors.json"
    path.write_text('{"HEART_RATE": "2026-09-29T08:00:00+00:00", "LEGACY": "2026-01-01T00:00:00+00:00"}')

    assert load_cursors(path) == {Stream.HEART_RATE: T0}


def test_select_new_keeps_only_items_after_their_stream_cursor() -> None:
    items = [hr(0), hr(2), hr(4), stress(0), stress(1)]

    selected = select_new(items, {Stream.HEART_RATE: T0 + timedelta(minutes=2)})

    assert selected == [hr(4), stress(0), stress(1)]


def test_advance_moves_each_cursor_to_its_latest_item() -> None:
    cursors = advance({Stream.SLEEP: T0}, [hr(4), hr(2), stress(1)])

    assert cursors == {
        Stream.SLEEP: T0,
        Stream.HEART_RATE: T0 + timedelta(minutes=4),
        Stream.STRESS: T0 + timedelta(minutes=1),
    }


def test_advance_never_moves_a_cursor_backwards() -> None:
    later = T0 + timedelta(hours=1)

    assert advance({Stream.HEART_RATE: later}, [hr(4)]) == {Stream.HEART_RATE: later}


def test_running_the_same_day_twice_selects_nothing_the_second_time(
    garmin_json: Callable[[str], Any],
) -> None:
    bundle = DayBundle(
        day=date(2026, 9, 29),
        heart_rates=garmin_json("heart_rates"),
        stress=garmin_json("stress_60s"),
        body_battery=garmin_json("body_battery"),
        steps=garmin_json("steps"),
        hrv=garmin_json("hrv"),
        sleep=garmin_json("sleep"),
        activities=garmin_json("activities"),
    )
    items = map_day(bundle)

    first = select_new(items, {})
    cursors = advance({}, first)

    assert len(first) == len(items) > 0
    assert select_new(map_day(bundle), cursors) == []
