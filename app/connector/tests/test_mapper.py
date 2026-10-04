from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest

from connector.mapper import (
    map_activities,
    map_body_battery,
    map_day,
    map_heart_rate,
    map_hrv,
    map_sleep,
    map_steps,
    map_stress,
)
from connector.models import DayBundle, MetricSample, SleepStageKind, Stream

Loader = Callable[[str], Any]


def utc(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=UTC)


def values(samples: list[MetricSample]) -> list[int | float]:
    return [sample.value for sample in samples]


def test_heart_rate_maps_every_value_and_skips_nulls(garmin_json: Loader) -> None:
    samples = map_heart_rate(garmin_json("heart_rates"))

    assert values(samples) == [64, 66, 71, 69]
    assert {sample.stream for sample in samples} == {Stream.HEART_RATE}
    assert samples[0].start == utc("2026-09-29T08:00:00")
    assert all(sample.start == sample.end for sample in samples)


def test_stress_accepts_60_second_resolution_and_drops_negative_flags(garmin_json: Loader) -> None:
    samples = map_stress(garmin_json("stress_60s"))

    assert values(samples) == [22, 25, 31, 0, 38]
    assert {sample.stream for sample in samples} == {Stream.STRESS}
    assert samples[1].start - samples[0].start == timedelta(seconds=60)


def test_stress_accepts_3_minute_resolution_and_drops_nulls(garmin_json: Loader) -> None:
    samples = map_stress(garmin_json("stress_3min"))

    assert values(samples) == [18, 21, 27]
    assert samples[1].start - samples[0].start == timedelta(minutes=3)


def test_body_battery_is_read_from_the_stress_response_using_descriptors(garmin_json: Loader) -> None:
    samples = map_body_battery(garmin_json("stress_60s"), None)

    assert values(samples) == [41, 40, 40]
    assert {sample.stream for sample in samples} == {Stream.BODY_BATTERY}


def test_body_battery_falls_back_to_get_body_battery(garmin_json: Loader) -> None:
    samples = map_body_battery(garmin_json("stress_3min"), garmin_json("body_battery"))

    assert values(samples) == [41, 40, 39]


def test_body_battery_merges_both_sources_without_duplicate_timestamps(garmin_json: Loader) -> None:
    samples = map_body_battery(garmin_json("stress_60s"), garmin_json("body_battery"))

    assert [sample.start for sample in samples] == [
        utc("2026-09-29T08:00:00"),
        utc("2026-09-29T08:03:00"),
        utc("2026-09-29T08:06:00"),
        utc("2026-09-29T08:12:00"),
    ]
    assert values(samples) == [41, 40, 40, 39]


@pytest.mark.parametrize(
    "row",
    [[1790668800000, "MEASURED", 41, 2.0], [1790668800000, 41]],
    ids=["status-level-version", "timestamp-level"],
)
def test_body_battery_without_descriptors_uses_the_first_number_after_the_timestamp(row: list[Any]) -> None:
    samples = map_body_battery({"bodyBatteryValuesArray": [row]}, None)

    assert values(samples) == [41]


def test_steps_map_15_minute_buckets_including_zero_buckets(garmin_json: Loader) -> None:
    samples = map_steps(garmin_json("steps"))

    assert values(samples) == [0, 412, 37]
    assert {sample.stream for sample in samples} == {Stream.STEPS}
    assert samples[0].start == utc("2026-09-29T07:30:00")
    assert samples[0].end == utc("2026-09-29T07:45:00")


def test_hrv_maps_overnight_readings_and_skips_nulls(garmin_json: Loader) -> None:
    samples = map_hrv(garmin_json("hrv"))

    assert values(samples) == [49, 55, 61]
    assert {sample.stream for sample in samples} == {Stream.HRV}
    assert samples[0].start == utc("2026-09-28T20:52:00")


def test_sleep_levels_become_stages_whose_totals_match_the_daily_summary(garmin_json: Loader) -> None:
    raw = garmin_json("sleep")
    stages = map_sleep(raw)

    assert [stage.kind for stage in stages] == [
        SleepStageKind.LIGHT,
        SleepStageKind.DEEP,
        SleepStageKind.REM,
        SleepStageKind.AWAKE,
        SleepStageKind.LIGHT,
    ]
    seconds = {
        kind: sum((s.end - s.start).total_seconds() for s in stages if s.kind == kind)
        for kind in SleepStageKind
    }
    dto = raw["dailySleepDTO"]
    assert seconds[SleepStageKind.DEEP] == dto["deepSleepSeconds"]
    assert seconds[SleepStageKind.LIGHT] == dto["lightSleepSeconds"]
    assert seconds[SleepStageKind.REM] == dto["remSleepSeconds"]
    assert seconds[SleepStageKind.AWAKE] == dto["awakeSleepSeconds"]
    assert {stage.night for stage in stages} == {"2026-09-29"}
    assert {stage.sleep_score for stage in stages} == {81}


def test_sleep_without_levels_becomes_one_sleeping_stage(garmin_json: Loader) -> None:
    raw = garmin_json("sleep")
    raw.pop("sleepLevels")

    stages = map_sleep(raw)

    assert len(stages) == 1
    assert stages[0].kind == SleepStageKind.SLEEPING
    assert stages[0].start == utc("2026-09-28T20:47:00")
    assert stages[0].end == utc("2026-09-29T04:52:00")


def test_sleep_skips_levels_with_an_unknown_activity_level(garmin_json: Loader) -> None:
    raw = garmin_json("sleep")
    raw["sleepLevels"][0]["activityLevel"] = 7.0

    assert len(map_sleep(raw)) == 4


def test_activities_become_workouts_and_entries_without_start_are_skipped(garmin_json: Loader) -> None:
    workouts = map_activities(garmin_json("activities"))

    assert [w.activity_id for w in workouts] == ["20512345678", "20512345679"]
    run, strength = workouts
    assert run.sdk_type == "running"
    assert run.title == "Intervals"
    assert run.start == utc("2026-09-29T16:30:12")
    assert run.end == run.start + timedelta(seconds=3605.2)
    assert {(s.type, s.unit, s.value) for s in run.stats} == {
        ("duration", "s", 3605.2),
        ("calories", "kcal", 702.0),
        ("distance", "m", 9012.4),
        ("averageHeartRate", "bpm", 152.0),
        ("maxHeartRate", "bpm", 181.0),
    }
    assert strength.sdk_type == "strength_training"
    assert "distance" not in {s.type for s in strength.stats}


def test_unknown_activity_types_map_to_other(garmin_json: Loader) -> None:
    raw = garmin_json("activities")[:1]
    raw[0]["activityType"]["typeKey"] = "paragliding_with_a_cat"

    assert map_activities(raw)[0].sdk_type == "other"


GARBAGE: list[Any] = [
    None,
    {},
    [],
    "garbage",
    42,
    {"heartRateValues": None, "stressValuesArray": None, "bodyBatteryValuesArray": None},
    {
        "heartRateValues": [[None, 5], ["x"], 5, [1790668800000], [1790668800000, "x"], [True, 60]],
        "stressValuesArray": [[None, 5], ["x"], 5, [1790668800000]],
        "bodyBatteryValuesArray": [[None, 5], ["x"], 5, [1790668800000, "MEASURED"]],
        "hrvReadings": [None, {"hrvValue": 50}, {"readingTimeGMT": "nope", "hrvValue": 50}],
        "dailySleepDTO": {"sleepStartTimestampGMT": None},
        "sleepLevels": [None, {"startGMT": "bad", "endGMT": None, "activityLevel": 1}],
    },
    [None, {"startGMT": None, "steps": 4}, {"startTimeGMT": "bad", "duration": "x"}],
]


@pytest.mark.parametrize("raw", GARBAGE)
@pytest.mark.parametrize(
    "mapper",
    [map_heart_rate, map_stress, map_steps, map_hrv, map_sleep, map_activities],
)
def test_mappers_return_empty_lists_on_missing_or_malformed_data(
    mapper: Callable[[Any], list[Any]], raw: Any
) -> None:
    assert mapper(raw) == []


@pytest.mark.parametrize("raw", GARBAGE)
def test_body_battery_returns_empty_list_on_missing_or_malformed_data(raw: Any) -> None:
    assert map_body_battery(raw, raw) == []


def test_map_day_combines_every_call_of_the_bundle(garmin_json: Loader) -> None:
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

    counts = {stream: sum(1 for item in items if item.stream == stream) for stream in Stream}
    assert counts == {
        Stream.HEART_RATE: 4,
        Stream.STRESS: 5,
        Stream.BODY_BATTERY: 4,
        Stream.STEPS: 3,
        Stream.HRV: 3,
        Stream.SLEEP: 5,
        Stream.WORKOUTS: 2,
    }
