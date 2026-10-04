"""Typed items -> open-wearables SDK sync request bodies (`SyncRequest` in open-wearables).

Every item gets a stable external id, so pushing the same data twice is idempotent.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from itertools import batched
from typing import Any
from zoneinfo import ZoneInfo

from connector.models import Item, MetricSample, SleepStage, Stream, Workout

PROVIDER = "health_connect"
SDK_VERSION = "headroom-connector/0.1.0"
SOURCE_NAME = "Garmin Connect (Headroom connector)"
MAX_ITEMS_PER_PAYLOAD = 5000

_UNITS: Mapping[Stream, str] = {
    Stream.HEART_RATE: "bpm",
    Stream.STRESS: "score",
    Stream.BODY_BATTERY: "percent",
    Stream.STEPS: "count",
    Stream.HRV: "ms",
}

_ID_SLUGS: Mapping[Stream, str] = {
    Stream.HEART_RATE: "hr",
    Stream.STRESS: "stress",
    Stream.BODY_BATTERY: "body-battery",
    Stream.STEPS: "steps",
    Stream.HRV: "hrv",
}

_COLLECTIONS: Mapping[type, str] = {MetricSample: "records", SleepStage: "sleep", Workout: "workouts"}
_COLLECTION_NAMES: tuple[str, ...] = ("records", "sleep", "workouts")


@dataclass(frozen=True, slots=True)
class PayloadContext:
    time_zone: ZoneInfo
    device_model: str | None
    sync_timestamp: datetime


def iso_utc(at: datetime) -> str:
    return at.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _epoch_ms(at: datetime) -> int:
    return round(at.timestamp() * 1000)


def _zone_offset(at: datetime, time_zone: ZoneInfo) -> str:
    return at.astimezone(time_zone).strftime("%:z")


def _source(device_model: str | None) -> dict[str, str]:
    source = {
        "name": SOURCE_NAME,
        "deviceManufacturer": "Garmin",
        "deviceModel": device_model,
        "deviceType": "watch",
    }
    return {key: value for key, value in source.items() if value is not None}


def _window(start: datetime, end: datetime, context: PayloadContext) -> dict[str, Any]:
    return {
        "startDate": iso_utc(start),
        "endDate": iso_utc(end),
        "zoneOffset": _zone_offset(start, context.time_zone),
        "source": _source(context.device_model),
    }


def _record(sample: MetricSample, context: PayloadContext) -> dict[str, Any]:
    return {
        "id": f"garmin-{_ID_SLUGS[sample.stream]}-{_epoch_ms(sample.start)}",
        "type": sample.stream.value,
        **_window(sample.start, sample.end, context),
        "value": sample.value,
        "unit": _UNITS[sample.stream],
    }


def _sleep(stage: SleepStage, context: PayloadContext) -> dict[str, Any]:
    parent_id = f"garmin-sleep-{stage.night}"
    score = (
        {"values": [{"type": "sleepScore", "value": stage.sleep_score, "unit": "score"}]}
        if stage.sleep_score is not None
        else {}
    )
    return {
        "id": f"{parent_id}-{_epoch_ms(stage.start)}",
        "parentId": parent_id,
        "stage": stage.kind.value,
        **_window(stage.start, stage.end, context),
        **score,
    }


def _workout(workout: Workout, context: PayloadContext) -> dict[str, Any]:
    return {
        "id": f"garmin-activity-{workout.activity_id}",
        "type": workout.sdk_type,
        "title": workout.title,
        **_window(workout.start, workout.end, context),
        "values": [{"type": stat.type, "unit": stat.unit, "value": stat.value} for stat in workout.stats],
    }


def _serialise(item: Item, context: PayloadContext) -> dict[str, Any]:
    match item:
        case MetricSample():
            return _record(item, context)
        case SleepStage():
            return _sleep(item, context)
        case Workout():
            return _workout(item, context)


def _envelope(chunk: Sequence[Item], context: PayloadContext) -> dict[str, Any]:
    serialised = [(_COLLECTIONS[type(item)], _serialise(item, context)) for item in chunk]
    return {
        "provider": PROVIDER,
        "sdkVersion": SDK_VERSION,
        "syncTimestamp": iso_utc(context.sync_timestamp),
        "data": {
            name: [body for collection, body in serialised if collection == name]
            for name in _COLLECTION_NAMES
        },
    }


def build_payloads(
    items: Sequence[Item], context: PayloadContext, max_items: int = MAX_ITEMS_PER_PAYLOAD
) -> list[dict[str, Any]]:
    return [_envelope(chunk, context) for chunk in batched(items, max_items)]
