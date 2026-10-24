import math
from typing import Any


def time_to_seconds(value: Any) -> float | None:
    """Convert seconds, mm:ss, or hh:mm:ss to a non-negative second value."""
    if value in (None, "", "null"):
        return None

    if isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        seconds = float(value)
    else:
        parts = str(value).strip().split(":")
        try:
            numbers = [float(part) for part in parts]
        except ValueError:
            return None

        if len(numbers) == 1:
            seconds = numbers[0]
        elif len(numbers) == 2:
            seconds = numbers[0] * 60 + numbers[1]
        elif len(numbers) == 3:
            seconds = numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
        else:
            return None

    if not math.isfinite(seconds) or seconds < 0:
        return None
    return seconds


def normalize_seconds(value: Any) -> int | None:
    """Normalize a supported time value to the nearest whole second."""
    seconds = time_to_seconds(value)
    if seconds is None:
        return None
    return math.floor(seconds + 0.5)


def normalize_time_range(start: Any, end: Any) -> tuple[int | None, int | None]:
    """Normalize a time range and correct an accidentally reversed range."""
    start_seconds = normalize_seconds(start)
    end_seconds = normalize_seconds(end)
    if (
        start_seconds is not None
        and end_seconds is not None
        and end_seconds < start_seconds
    ):
        start_seconds, end_seconds = end_seconds, start_seconds
    return start_seconds, end_seconds
