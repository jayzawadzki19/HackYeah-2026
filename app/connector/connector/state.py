"""Per-stream sync cursors: the start time of the latest item pushed to open-wearables."""

import json
import os
import tempfile
from collections.abc import Iterable, Mapping
from datetime import datetime
from pathlib import Path

from connector.models import Item, Stream

type Cursors = Mapping[Stream, datetime]

_STREAMS: Mapping[str, Stream] = {stream.value: stream for stream in Stream}


class CursorFileError(Exception):
    """The cursor file exists but is unreadable. Deleting it is safe: re-pushing is idempotent."""


def _parse_timestamp(value: object) -> datetime:
    if not isinstance(value, str):
        raise TypeError(f"expected an ISO timestamp, got {value!r}")
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError(f"timestamp without a time zone: {value!r}")
    return parsed


def load_cursors(path: Path) -> dict[Stream, datetime]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as error:
        raise CursorFileError(f"Cannot read cursor file {path}: {error}") from error
    if not isinstance(raw, dict):
        raise CursorFileError(f"Cursor file {path} must contain a JSON object")
    try:
        return {_STREAMS[key]: _parse_timestamp(value) for key, value in raw.items() if key in _STREAMS}
    except (TypeError, ValueError) as error:
        raise CursorFileError(f"Cursor file {path} has an invalid timestamp: {error}") from error


def save_cursors(path: Path, cursors: Cursors) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps({stream.value: at.isoformat() for stream, at in sorted(cursors.items())}, indent=2)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content)
        Path(temporary).replace(path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise


def select_new(items: Iterable[Item], cursors: Cursors) -> list[Item]:
    return [item for item in items if item.stream not in cursors or item.start > cursors[item.stream]]


def advance(cursors: Cursors, items: Iterable[Item]) -> dict[Stream, datetime]:
    starts = [(item.stream, item.start) for item in items]
    latest = {stream: max(at for s, at in starts if s == stream) for stream in {s for s, _ in starts}}
    return {**cursors, **{stream: max(at, cursors.get(stream, at)) for stream, at in latest.items()}}
