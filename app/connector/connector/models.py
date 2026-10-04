from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum
from typing import Any


class Stream(StrEnum):
    """One cursor per stream; metric streams use the open-wearables SDK metric identifiers."""

    HEART_RATE = "HEART_RATE"
    STRESS = "GARMIN_STRESS_LEVEL"
    BODY_BATTERY = "GARMIN_BODY_BATTERY"
    STEPS = "STEP_COUNT"
    HRV = "HEART_RATE_VARIABILITY"
    SLEEP = "sleep"
    WORKOUTS = "workouts"


class SleepStageKind(StrEnum):
    """Values accepted by the open-wearables `SleepPhase` enum."""

    DEEP = "deep"
    LIGHT = "light"
    REM = "rem"
    AWAKE = "awake"
    SLEEPING = "sleeping"


@dataclass(frozen=True, slots=True)
class MetricSample:
    stream: Stream
    start: datetime
    end: datetime
    value: int | float


@dataclass(frozen=True, slots=True)
class SleepStage:
    night: str
    kind: SleepStageKind
    start: datetime
    end: datetime
    sleep_score: int | None

    @property
    def stream(self) -> Stream:
        return Stream.SLEEP


@dataclass(frozen=True, slots=True)
class WorkoutStat:
    type: str
    unit: str
    value: int | float


@dataclass(frozen=True, slots=True)
class Workout:
    activity_id: str
    sdk_type: str
    title: str | None
    start: datetime
    end: datetime
    stats: tuple[WorkoutStat, ...]

    @property
    def stream(self) -> Stream:
        return Stream.WORKOUTS


type Item = MetricSample | SleepStage | Workout


@dataclass(frozen=True, slots=True)
class DayBundle:
    """Raw Garmin Connect responses for one calendar day, exactly as the library returned them."""

    day: date
    heart_rates: Any = None
    stress: Any = None
    body_battery: Any = None
    steps: Any = None
    hrv: Any = None
    sleep: Any = None
    activities: Any = None
