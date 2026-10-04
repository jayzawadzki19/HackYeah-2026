"""`connector probe`: saves one day of raw Garmin responses and summarises what the mapper makes of them."""

import json
from collections.abc import Sequence
from dataclasses import fields
from itertools import pairwise
from pathlib import Path
from statistics import median_low
from typing import Any

from connector.mapper import map_day
from connector.models import DayBundle, Item, SleepStage, SleepStageKind, Stream
from connector.payload import iso_utc

_INTERVAL_STREAMS = frozenset({Stream.SLEEP, Stream.WORKOUTS})
_SLEEP_SUMMARY_KEYS = {
    SleepStageKind.DEEP: "deepSleepSeconds",
    SleepStageKind.LIGHT: "lightSleepSeconds",
    SleepStageKind.REM: "remSleepSeconds",
    SleepStageKind.AWAKE: "awakeSleepSeconds",
}


def raw_responses(bundle: DayBundle) -> dict[str, Any]:
    return {field.name: getattr(bundle, field.name) for field in fields(bundle) if field.name != "day"}


def describe_raw(raw: Any) -> str:
    match raw:
        case None:
            return "missing"
        case list():
            return f"list of {len(raw)}"
        case dict():
            arrays = [f"{key}[{len(value)}]" for key, value in raw.items() if isinstance(value, list)]
            return " ".join(arrays) or f"object with keys {', '.join(sorted(raw))}"
        case _:
            return type(raw).__name__


def _median_gap_s(items: Sequence[Item]) -> int | None:
    starts = sorted(item.start for item in items)
    gaps = [round((later - earlier).total_seconds()) for earlier, later in pairwise(starts)]
    return median_low(gaps) if gaps else None


def _stream_line(stream: Stream, items: Sequence[Item]) -> str:
    line = f"{stream.value:<24}{len(items):>6}"
    if not items:
        return line
    line += f"  {iso_utc(min(item.start for item in items))} .. {iso_utc(max(item.start for item in items))}"
    gap = None if stream in _INTERVAL_STREAMS else _median_gap_s(items)
    return f"{line}  median gap {gap}s" if gap is not None else line


def stream_lines(items: Sequence[Item]) -> list[str]:
    return [_stream_line(stream, [item for item in items if item.stream == stream]) for stream in Stream]


def _mapped_minutes(stages: Sequence[SleepStage], kind: SleepStageKind) -> int:
    seconds = sum((stage.end - stage.start).total_seconds() for stage in stages if stage.kind == kind)
    return round(seconds / 60)


def _reported_minutes(sleep_raw: Any, key: str) -> str:
    summary = sleep_raw.get("dailySleepDTO") if isinstance(sleep_raw, dict) else None
    seconds = summary.get(key) if isinstance(summary, dict) else None
    is_number = isinstance(seconds, int | float) and not isinstance(seconds, bool)
    return str(round(seconds / 60)) if is_number else "?"


def sleep_line(items: Sequence[Item], sleep_raw: Any) -> str:
    stages = [item for item in items if isinstance(item, SleepStage)]
    parts = " ".join(
        f"{kind.value} {_mapped_minutes(stages, kind)}/{_reported_minutes(sleep_raw, key)}"
        for kind, key in _SLEEP_SUMMARY_KEYS.items()
    )
    return f"Sleep minutes mapped/Garmin: {parts}"


def device_line(device: Any) -> str:
    name = device.get("lastUsedDeviceName") if isinstance(device, dict) else None
    if not isinstance(name, str) or not name:
        return "Last used device: unknown (see device_last_used.json)"
    return f'Last used device: {name} (pin it with GARMIN_DEVICE_MODEL="{name}" in .env)'


def probe_report(bundle: DayBundle, device: Any) -> list[str]:
    items = map_day(bundle)
    return [
        "Raw responses:",
        *(f"  {name:<13} {describe_raw(raw)}" for name, raw in raw_responses(bundle).items()),
        "Mapped:",
        *(f"  {line}" for line in stream_lines(items)),
        sleep_line(items, bundle.sleep),
        device_line(device),
    ]


def write_probe(bundle: DayBundle, device: Any, directory: Path) -> Path:
    target = directory / bundle.day.isoformat()
    target.mkdir(parents=True, exist_ok=True)
    for name, raw in (raw_responses(bundle) | {"device_last_used": device}).items():
        (target / f"{name}.json").write_text(
            json.dumps(raw, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
    return target
