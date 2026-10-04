"""Garmin Connect JSON -> typed samples, sleep stages and workouts.

Pure functions. Field names follow the responses returned by `garminconnect` 0.3.x and are
confirmed against a real `connector probe`. Missing or malformed data yields empty lists,
never exceptions.
"""

from collections.abc import Callable, Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from connector.models import (
    DayBundle,
    Item,
    MetricSample,
    SleepStage,
    SleepStageKind,
    Stream,
    Workout,
    WorkoutStat,
)

type Number = int | float
type Point = tuple[datetime, Number]

# `sleepLevels[].activityLevel` in Garmin Connect sleep JSON (not the FIT sleep_level enum).
_SLEEP_LEVELS: Mapping[int, SleepStageKind] = {
    0: SleepStageKind.DEEP,
    1: SleepStageKind.LIGHT,
    2: SleepStageKind.REM,
    3: SleepStageKind.AWAKE,
}

# Garmin `activityType.typeKey` -> open-wearables `SDKWorkoutType` value.
_WORKOUT_TYPES: Mapping[str, str] = {
    "running": "running",
    "trail_running": "running",
    "track_running": "running",
    "street_running": "running",
    "treadmill_running": "running_treadmill",
    "indoor_running": "running_treadmill",
    "cycling": "cycling",
    "road_biking": "cycling",
    "mountain_biking": "cycling",
    "gravel_cycling": "cycling",
    "indoor_cycling": "cycling_stationary",
    "virtual_ride": "cycling_stationary",
    "walking": "walking",
    "casual_walking": "walking",
    "speed_walking": "walking",
    "hiking": "hiking",
    "swimming": "swimming",
    "lap_swimming": "swimming_pool",
    "open_water_swimming": "swimming_open_water",
    "strength_training": "strength_training",
    "hiit": "hiit",
    "cardio": "mixed_cardio",
    "indoor_cardio": "mixed_cardio",
    "yoga": "yoga",
    "pilates": "pilates",
    "elliptical": "elliptical",
    "indoor_rowing": "rowing_machine",
    "rowing": "rowing",
    "stair_climbing": "stair_climbing",
    "floor_climbing": "stair_climbing",
    "breathwork": "guided_breathing",
}

# (Garmin activity field, open-wearables workout statistic type, unit)
_WORKOUT_STATS: tuple[tuple[str, str, str], ...] = (
    ("duration", "duration", "s"),
    ("calories", "calories", "kcal"),
    ("distance", "distance", "m"),
    ("averageHR", "averageHeartRate", "bpm"),
    ("maxHR", "maxHeartRate", "bpm"),
)


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _mapping(raw: Any) -> Mapping[str, Any]:
    return raw if isinstance(raw, Mapping) else {}


def _list(raw: Any) -> list[Any]:
    return raw if isinstance(raw, list) else []


def _mappings(raw: Any) -> list[Mapping[str, Any]]:
    return [entry for entry in _list(raw) if isinstance(entry, Mapping)]


def _from_epoch_ms(value: Any) -> datetime | None:
    if not _is_number(value):
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=UTC)
    except (OverflowError, OSError, ValueError):
        return None


def _from_gmt_text(value: Any) -> datetime | None:
    """Garmin GMT strings: '2026-09-29T07:30:00.0' or '2026-09-29 16:30:12', without a zone."""
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def _at(row: Any, index: int | None) -> Any:
    if not isinstance(row, list) or index is None or not 0 <= index < len(row):
        return None
    return row[index]


def _first_number_after(row: Any, index: int) -> Any:
    return next((value for value in _list(row)[index + 1 :] if _is_number(value)), None)


def _descriptor_indexes(descriptors: Any, key_field: str, index_field: str) -> dict[str, int]:
    return {
        entry[key_field]: entry[index_field]
        for entry in _mappings(descriptors)
        if isinstance(entry.get(key_field), str) and isinstance(entry.get(index_field), int)
    }


def _points(rows: Any, timestamp_index: int, value_of: Callable[[Any], Any]) -> list[Point]:
    pairs = ((_from_epoch_ms(_at(row, timestamp_index)), value_of(row)) for row in _list(rows))
    return [(at, value) for at, value in pairs if at is not None and _is_number(value)]


def _instants(stream: Stream, points: list[Point], keep: Callable[[Number], bool]) -> list[MetricSample]:
    return [MetricSample(stream, at, at, value) for at, value in points if keep(value)]


def _indexed_points(
    data: Mapping[str, Any], descriptors_field: str, rows_field: str, value_key: str
) -> list[Point]:
    indexes = _descriptor_indexes(data.get(descriptors_field), "key", "index")
    value_index = indexes.get(value_key, 1)
    return _points(
        data.get(rows_field), indexes.get("timestamp", 0), lambda row: _at(row, value_index)
    )


def map_heart_rate(raw: Any) -> list[MetricSample]:
    """`get_heart_rates`: `heartRateValues` rows `[timestamp_ms, bpm | null]`."""
    points = _indexed_points(
        _mapping(raw), "heartRateValueDescriptors", "heartRateValues", "heartrate"
    )
    return _instants(Stream.HEART_RATE, points, lambda bpm: bpm > 0)


def map_stress(raw: Any) -> list[MetricSample]:
    """`get_stress_data`: `stressValuesArray` rows `[timestamp_ms, level]`; -1 / -2 mean not measurable."""
    points = _indexed_points(
        _mapping(raw), "stressValueDescriptorsDTOList", "stressValuesArray", "stressLevel"
    )
    return _instants(Stream.STRESS, points, lambda level: 0 <= level <= 100)


def _body_battery_points(data: Mapping[str, Any]) -> list[Point]:
    descriptors = data.get("bodyBatteryValueDescriptorsDTOList") or data.get(
        "bodyBatteryValueDescriptorDTOList"
    )
    indexes = _descriptor_indexes(
        descriptors, "bodyBatteryValueDescriptorKey", "bodyBatteryValueDescriptorIndex"
    )
    timestamp_index = indexes.get("timestamp", 0)
    level_index = indexes.get("bodyBatteryLevel")
    value_of: Callable[[Any], Any] = (
        (lambda row: _at(row, level_index))
        if level_index is not None
        else (lambda row: _first_number_after(row, timestamp_index))
    )
    return _points(data.get("bodyBatteryValuesArray"), timestamp_index, value_of)


def map_body_battery(stress_raw: Any, body_battery_raw: Any) -> list[MetricSample]:
    """Body Battery from the stress response and/or `get_body_battery`; the stress response wins on ties."""
    reports = [body_battery_raw] if isinstance(body_battery_raw, Mapping) else _mappings(body_battery_raw)
    from_reports = [point for report in reports for point in _body_battery_points(report)]
    by_time = dict([*from_reports, *_body_battery_points(_mapping(stress_raw))])
    return _instants(Stream.BODY_BATTERY, sorted(by_time.items()), lambda level: 0 <= level <= 100)


def map_steps(raw: Any) -> list[MetricSample]:
    """`get_steps_data`: 15-minute buckets with `startGMT`, `endGMT`, `steps`."""
    buckets = (
        (_from_gmt_text(bucket.get("startGMT")), _from_gmt_text(bucket.get("endGMT")), bucket.get("steps"))
        for bucket in _mappings(raw)
    )
    return [
        MetricSample(Stream.STEPS, start, end, steps)
        for start, end, steps in buckets
        if start is not None and end is not None and end > start and _is_number(steps) and steps >= 0
    ]


def map_hrv(raw: Any) -> list[MetricSample]:
    """`get_hrv_data`: overnight `hrvReadings` with `readingTimeGMT` and `hrvValue` (RMSSD, ms)."""
    readings = (
        (_from_gmt_text(reading.get("readingTimeGMT")), reading.get("hrvValue"))
        for reading in _mappings(_mapping(raw).get("hrvReadings"))
    )
    return [
        MetricSample(Stream.HRV, at, at, value)
        for at, value in readings
        if at is not None and _is_number(value) and value > 0
    ]


def _sleep_score(dto: Mapping[str, Any]) -> int | None:
    score = _mapping(_mapping(dto.get("sleepScores")).get("overall")).get("value")
    return int(score) if _is_number(score) else None


def _sleep_kind(level: Any) -> SleepStageKind | None:
    return _SLEEP_LEVELS.get(int(level)) if _is_number(level) and float(level).is_integer() else None


def map_sleep(raw: Any) -> list[SleepStage]:
    """`get_sleep_data`: `sleepLevels` become stages; without levels the whole window is one stage."""
    data = _mapping(raw)
    dto = _mapping(data.get("dailySleepDTO"))
    night = dto.get("calendarDate")
    if not isinstance(night, str):
        return []
    score = _sleep_score(dto)
    levels = (
        (
            _from_gmt_text(level.get("startGMT")),
            _from_gmt_text(level.get("endGMT")),
            _sleep_kind(level.get("activityLevel")),
        )
        for level in _mappings(data.get("sleepLevels"))
    )
    stages = [
        SleepStage(night, kind, start, end, score)
        for start, end, kind in levels
        if start is not None and end is not None and kind is not None and end > start
    ]
    if stages:
        return stages
    start = _from_epoch_ms(dto.get("sleepStartTimestampGMT"))
    end = _from_epoch_ms(dto.get("sleepEndTimestampGMT"))
    if start is None or end is None or end <= start:
        return []
    return [SleepStage(night, SleepStageKind.SLEEPING, start, end, score)]


def _workout(activity: Mapping[str, Any]) -> Workout | None:
    start = _from_gmt_text(activity.get("startTimeGMT"))
    duration = activity.get("duration")
    activity_id = activity.get("activityId")
    if start is None or not _is_number(duration) or duration <= 0 or not _is_number(activity_id):
        return None
    type_key = _mapping(activity.get("activityType")).get("typeKey")
    title = activity.get("activityName")
    stats = tuple(
        WorkoutStat(stat_type, unit, activity[field])
        for field, stat_type, unit in _WORKOUT_STATS
        if _is_number(activity.get(field)) and activity[field] > 0
    )
    return Workout(
        activity_id=str(activity_id),
        sdk_type=_WORKOUT_TYPES.get(type_key, "other") if isinstance(type_key, str) else "other",
        title=title if isinstance(title, str) else None,
        start=start,
        end=start + timedelta(seconds=duration),
        stats=stats,
    )


def map_activities(raw: Any) -> list[Workout]:
    """`get_activities_by_date`: one workout per activity with a GMT start and a duration."""
    workouts = (_workout(activity) for activity in _mappings(raw))
    return [workout for workout in workouts if workout is not None]


def map_day(bundle: DayBundle) -> list[Item]:
    return [
        *map_heart_rate(bundle.heart_rates),
        *map_stress(bundle.stress),
        *map_body_battery(bundle.stress, bundle.body_battery),
        *map_steps(bundle.steps),
        *map_hrv(bundle.hrv),
        *map_sleep(bundle.sleep),
        *map_activities(bundle.activities),
    ]
