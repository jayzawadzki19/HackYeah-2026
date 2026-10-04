"""Poll cycle (yesterday and today, only items newer than the cursors) and backfill (last N days)."""

from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from connector.mapper import map_day
from connector.models import DayBundle, Item, MetricSample, Stream
from connector.payload import MAX_ITEMS_PER_PAYLOAD, PayloadContext, build_payloads
from connector.state import advance, load_cursors, save_cursors, select_new

POLL_DAYS = 2
_SYNC_WATERMARK_STREAMS = frozenset({Stream.HEART_RATE, Stream.STRESS})


class DaySource(Protocol):
    def fetch_day(self, day: date) -> DayBundle: ...


class Pusher(Protocol):
    def push(self, payloads: Sequence[dict[str, Any]]) -> None: ...


@dataclass(frozen=True, slots=True)
class SyncResult:
    pushed_records: int
    latest_sample_at: datetime | None
    per_stream: Mapping[Stream, int]


def local_days(now: datetime, time_zone: ZoneInfo, count: int) -> list[date]:
    """The last `count` calendar days in the user's time zone, oldest first, ending today."""
    today = now.astimezone(time_zone).date()
    return [today - timedelta(days=offset) for offset in reversed(range(count))]


def complete_items(items: Sequence[Item], now: datetime) -> list[Item]:
    """Holds back step buckets that end after the watch's last synced heart rate or stress sample.

    Garmin fills a 15-minute bucket as the watch syncs, so an open bucket pushed now would never be
    updated once its cursor has moved on.
    """
    synced_until = max((item.start for item in items if item.stream in _SYNC_WATERMARK_STREAMS), default=now)
    return [item for item in items if item.stream != Stream.STEPS or item.end <= synced_until]


class Syncer:
    def __init__(
        self,
        source: DaySource,
        pusher: Pusher,
        cursor_path: Path,
        time_zone: ZoneInfo,
        device_model: str | None,
        clock: Callable[[], datetime],
        max_items: int = MAX_ITEMS_PER_PAYLOAD,
    ) -> None:
        self._source = source
        self._pusher = pusher
        self._cursor_path = cursor_path
        self._time_zone = time_zone
        self._device_model = device_model
        self._clock = clock
        self._max_items = max_items

    def poll(self) -> SyncResult:
        now = self._clock()
        cursors = load_cursors(self._cursor_path)
        items = select_new(self._fetch(local_days(now, self._time_zone, POLL_DAYS), now), cursors)
        return self._push(items, now)

    def backfill(self, days: int) -> SyncResult:
        if days < 1:
            raise ValueError(f"backfill needs at least 1 day, got {days}")
        now = self._clock()
        return self._push(self._fetch(local_days(now, self._time_zone, days), now), now)

    def _fetch(self, days: Sequence[date], now: datetime) -> list[Item]:
        items = [item for day in days for item in map_day(self._source.fetch_day(day))]
        return complete_items(items, now)

    def _push(self, items: Sequence[Item], now: datetime) -> SyncResult:
        if items:
            context = PayloadContext(self._time_zone, self._device_model, now)
            self._pusher.push(build_payloads(items, context, self._max_items))
            save_cursors(self._cursor_path, advance(load_cursors(self._cursor_path), items))
        sample_times = [item.start for item in items if isinstance(item, MetricSample)]
        return SyncResult(
            pushed_records=len(items),
            latest_sample_at=max(sample_times, default=None),
            per_stream=Counter(item.stream for item in items),
        )
