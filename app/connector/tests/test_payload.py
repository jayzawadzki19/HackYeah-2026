import json
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from connector.models import MetricSample, SleepStage, SleepStageKind, Stream, Workout, WorkoutStat
from connector.payload import SOURCE_NAME, PayloadContext, build_payloads

WARSAW = ZoneInfo("Europe/Warsaw")
SYNCED_AT = datetime(2026, 9, 29, 9, 0, tzinfo=UTC)
AT = datetime(2026, 9, 29, 8, 0, tzinfo=UTC)


def context(device_model: str | None = "Forerunner 265") -> PayloadContext:
    return PayloadContext(time_zone=WARSAW, device_model=device_model, sync_timestamp=SYNCED_AT)


def sample(stream: Stream = Stream.HEART_RATE, at: datetime = AT, value: int | float = 64) -> MetricSample:
    return MetricSample(stream, at, at, value)


def test_metric_sample_becomes_a_health_connect_record() -> None:
    [payload] = build_payloads([sample()], context())

    assert payload["provider"] == "health_connect"
    assert payload["syncTimestamp"] == "2026-09-29T09:00:00Z"
    assert isinstance(payload["sdkVersion"], str)
    assert payload["data"]["sleep"] == []
    assert payload["data"]["workouts"] == []
    assert payload["data"]["records"] == [
        {
            "id": "garmin-hr-1790668800000",
            "type": "HEART_RATE",
            "startDate": "2026-09-29T08:00:00Z",
            "endDate": "2026-09-29T08:00:00Z",
            "zoneOffset": "+02:00",
            "source": {
                "name": SOURCE_NAME,
                "deviceManufacturer": "Garmin",
                "deviceModel": "Forerunner 265",
                "deviceType": "watch",
            },
            "value": 64,
            "unit": "bpm",
        }
    ]


def test_source_name_is_the_agreed_label() -> None:
    assert SOURCE_NAME == "Garmin Connect (Headroom connector)"


@pytest.mark.parametrize(
    ("stream", "unit"),
    [
        (Stream.STRESS, "score"),
        (Stream.BODY_BATTERY, "percent"),
        (Stream.STEPS, "count"),
        (Stream.HRV, "ms"),
    ],
)
def test_each_metric_stream_carries_its_open_wearables_type_and_unit(stream: Stream, unit: str) -> None:
    [payload] = build_payloads([sample(stream)], context())

    record = payload["data"]["records"][0]
    assert (record["type"], record["unit"]) == (stream.value, unit)


def test_record_ids_are_stable_and_unique_per_stream_and_time() -> None:
    first = build_payloads([sample(Stream.STRESS), sample(Stream.HEART_RATE)], context())
    second = build_payloads([sample(Stream.STRESS), sample(Stream.HEART_RATE)], context())

    ids = [record["id"] for record in first[0]["data"]["records"]]
    assert ids == [record["id"] for record in second[0]["data"]["records"]]
    assert len(set(ids)) == 2


def test_zone_offset_follows_the_time_zone_rules_of_the_sample_date() -> None:
    winter = datetime(2026, 1, 15, 8, 0, tzinfo=UTC)

    [payload] = build_payloads([sample(at=winter)], context())

    assert payload["data"]["records"][0]["zoneOffset"] == "+01:00"


def test_missing_device_model_is_omitted_from_the_source() -> None:
    [payload] = build_payloads([sample()], context(device_model=None))

    assert payload["data"]["records"][0]["source"] == {
        "name": SOURCE_NAME,
        "deviceManufacturer": "Garmin",
        "deviceType": "watch",
    }


def test_sleep_stage_becomes_a_sleep_record_grouped_by_night() -> None:
    stage = SleepStage("2026-09-29", SleepStageKind.DEEP, AT, AT + timedelta(minutes=30), 81)

    [payload] = build_payloads([stage], context())

    assert payload["data"]["records"] == []
    assert payload["data"]["sleep"] == [
        {
            "id": "garmin-sleep-2026-09-29-1790668800000",
            "parentId": "garmin-sleep-2026-09-29",
            "stage": "deep",
            "startDate": "2026-09-29T08:00:00Z",
            "endDate": "2026-09-29T08:30:00Z",
            "zoneOffset": "+02:00",
            "source": payload["data"]["sleep"][0]["source"],
            "values": [{"type": "sleepScore", "value": 81, "unit": "score"}],
        }
    ]


def test_sleep_stage_without_score_has_no_values() -> None:
    stage = SleepStage("2026-09-29", SleepStageKind.LIGHT, AT, AT + timedelta(minutes=30), None)

    [payload] = build_payloads([stage], context())

    assert "values" not in payload["data"]["sleep"][0]


def test_workout_becomes_a_workout_with_statistics() -> None:
    workout = Workout(
        activity_id="20512345678",
        sdk_type="running",
        title="Intervals",
        start=AT,
        end=AT + timedelta(hours=1),
        stats=(WorkoutStat("duration", "s", 3600.0), WorkoutStat("averageHeartRate", "bpm", 152.0)),
    )

    [payload] = build_payloads([workout], context())

    [record] = payload["data"]["workouts"]
    assert record == {
        "id": "garmin-activity-20512345678",
        "type": "running",
        "title": "Intervals",
        "startDate": "2026-09-29T08:00:00Z",
        "endDate": "2026-09-29T09:00:00Z",
        "zoneOffset": "+02:00",
        "source": record["source"],
        "values": [
            {"type": "duration", "unit": "s", "value": 3600.0},
            {"type": "averageHeartRate", "unit": "bpm", "value": 152.0},
        ],
    }


def test_payloads_are_chunked_to_at_most_max_items_in_order() -> None:
    samples = [sample(at=AT + timedelta(minutes=i), value=60 + i) for i in range(12)]

    payloads = build_payloads(samples, context(), max_items=5)

    assert [len(p["data"]["records"]) for p in payloads] == [5, 5, 2]
    assert [r["value"] for p in payloads for r in p["data"]["records"]] == [60 + i for i in range(12)]
    assert {p["syncTimestamp"] for p in payloads} == {"2026-09-29T09:00:00Z"}


def test_chunks_count_sleep_and_workouts_towards_the_limit() -> None:
    stages = [
        SleepStage(
            "2026-09-29",
            SleepStageKind.LIGHT,
            AT + timedelta(minutes=i),
            AT + timedelta(minutes=i + 1),
            80,
        )
        for i in range(3)
    ]

    payloads = build_payloads([*stages, sample(), sample(Stream.STRESS)], context(), max_items=4)

    sizes = [sum(len(p["data"][key]) for key in ("records", "sleep", "workouts")) for p in payloads]
    assert sizes == [4, 1]


def test_no_items_means_no_payloads() -> None:
    assert build_payloads([], context()) == []


def test_payloads_are_json_serialisable() -> None:
    payloads = build_payloads([sample()], context())

    assert json.loads(json.dumps(payloads)) == payloads
