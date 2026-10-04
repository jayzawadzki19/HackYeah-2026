import json
from collections.abc import Callable
from datetime import date
from pathlib import Path
from typing import Any

import pytest

from connector.mapper import map_day
from connector.models import DayBundle
from connector.probe import describe_raw, device_line, probe_report, sleep_line, stream_lines, write_probe

DAY = date(2026, 9, 29)


@pytest.fixture
def bundle(garmin_json: Callable[[str], Any]) -> DayBundle:
    return DayBundle(
        day=DAY,
        heart_rates=garmin_json("heart_rates"),
        stress=garmin_json("stress_60s"),
        body_battery=garmin_json("body_battery"),
        steps=garmin_json("steps"),
        hrv=garmin_json("hrv"),
        sleep=garmin_json("sleep"),
        activities=garmin_json("activities"),
    )


@pytest.mark.parametrize(
    ("raw", "description"),
    [
        (None, "missing"),
        ([1, 2, 3], "list of 3"),
        ({"values": [1, 2], "descriptors": [1], "date": "2026-09-29"}, "values[2] descriptors[1]"),
        ({"b": 1, "a": None}, "object with keys a, b"),
        ("text", "str"),
    ],
)
def test_describe_raw_shows_the_shape(raw: Any, description: str) -> None:
    assert describe_raw(raw) == description


def test_stream_lines_show_counts_range_and_sampling_gap(bundle: DayBundle) -> None:
    lines = stream_lines(map_day(bundle))

    assert lines[0].split() == [
        "HEART_RATE",
        "4",
        "2026-09-29T08:00:00Z",
        "..",
        "2026-09-29T08:08:00Z",
        "median",
        "gap",
        "120s",
    ]
    assert len(lines) == 7


def test_stream_lines_reveal_60_second_stress_sampling(bundle: DayBundle) -> None:
    stress = next(line for line in stream_lines(map_day(bundle)) if line.startswith("GARMIN_STRESS_LEVEL"))

    assert stress.endswith("median gap 60s")


def test_stream_lines_reveal_3_minute_stress_sampling(
    bundle: DayBundle, garmin_json: Callable[[str], Any]
) -> None:
    three_minute = DayBundle(day=DAY, stress=garmin_json("stress_3min"))

    stress = next(
        line for line in stream_lines(map_day(three_minute)) if line.startswith("GARMIN_STRESS_LEVEL")
    )

    assert stress.endswith("median gap 180s")


def test_stream_lines_mark_empty_streams() -> None:
    assert stream_lines([])[0].split() == ["HEART_RATE", "0"]


def test_sleep_line_compares_mapped_stages_with_garmins_summary(bundle: DayBundle) -> None:
    assert sleep_line(map_day(bundle), bundle.sleep) == (
        "Sleep minutes mapped/Garmin: deep 75/75 light 319/319 rem 85/85 awake 6/6"
    )


def test_sleep_line_without_a_summary() -> None:
    assert sleep_line([], None) == "Sleep minutes mapped/Garmin: deep 0/? light 0/? rem 0/? awake 0/?"


def test_device_line_suggests_pinning_the_model() -> None:
    assert device_line({"lastUsedDeviceName": "Forerunner 965"}) == (
        'Last used device: Forerunner 965 (pin it with GARMIN_DEVICE_MODEL="Forerunner 965" in .env)'
    )


@pytest.mark.parametrize("device", [None, {}, [], {"lastUsedDeviceName": None}])
def test_device_line_when_unknown(device: Any) -> None:
    assert device_line(device) == "Last used device: unknown (see device_last_used.json)"


def test_probe_report_covers_every_call_and_stream(bundle: DayBundle) -> None:
    report = probe_report(bundle, {"lastUsedDeviceName": "Forerunner 965"})

    calls = ("heart_rates", "stress", "body_battery", "steps", "hrv", "sleep", "activities")
    assert all(any(line.strip().startswith(call) for line in report) for call in calls)
    assert any("GARMIN_BODY_BATTERY" in line for line in report)
    assert report[-1].startswith("Last used device: Forerunner 965")


def test_write_probe_saves_each_raw_response_as_json(bundle: DayBundle, tmp_path: Path) -> None:
    device = {"lastUsedDeviceName": "Forerunner 965"}

    target = write_probe(bundle, device, tmp_path / "probe")

    assert target == tmp_path / "probe" / "2026-09-29"
    assert sorted(path.name for path in target.iterdir()) == [
        "activities.json",
        "body_battery.json",
        "device_last_used.json",
        "heart_rates.json",
        "hrv.json",
        "sleep.json",
        "steps.json",
        "stress.json",
    ]
    assert json.loads((target / "stress.json").read_text()) == bundle.stress
    assert json.loads((target / "device_last_used.json").read_text()) == device


def test_write_probe_records_missing_responses_as_null(tmp_path: Path) -> None:
    target = write_probe(DayBundle(day=DAY), None, tmp_path)

    assert json.loads((target / "hrv.json").read_text()) is None
