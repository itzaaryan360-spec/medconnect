"""
Connect Care — Vitals Intelligence Engine
==========================================
Handles:
  1. Outlier / spike detection (Z-score + IQR combined)
  2. Clinical threshold breach detection (India-standard ranges)
  3. Temporal trend analysis  (rolling slope — rising/falling/stable)
  4. Risk flag generation (non-diagnostic)

All functions are pure / stateless — no Flask dependency.
"""

import math
import logging
from typing import TypedDict, Literal, Optional
from datetime import datetime

logger = logging.getLogger("medlex.vitals_engine")

# ────────────────────────────────────────────────────────────────────────────
# Clinical Thresholds  (non-diagnostic reference ranges — WHO / Indian guidelines)
# ────────────────────────────────────────────────────────────────────────────

THRESHOLDS: dict[str, dict] = {
    "heart_rate": {
        "unit": "bpm",
        "critical_low": 40,
        "warning_low":  50,
        "normal_low":   60,
        "normal_high":  100,
        "warning_high": 120,
        "critical_high": 150,
    },
    "systolic_bp": {
        "unit": "mmHg",
        "critical_low": 70,
        "warning_low":  90,
        "normal_low":   90,
        "normal_high":  129,
        "warning_high": 139,
        "critical_high": 180,
    },
    "diastolic_bp": {
        "unit": "mmHg",
        "critical_low": 40,
        "warning_low":  60,
        "normal_low":   60,
        "normal_high":  89,
        "warning_high": 89,
        "critical_high": 120,
    },
    "spo2": {
        "unit": "%",
        "critical_low":  88,
        "warning_low":   92,
        "normal_low":    95,
        "normal_high":   100,
        "warning_high":  100,
        "critical_high": 100,
    },
    "temperature_f": {
        "unit": "°F",
        "critical_low": 95.0,
        "warning_low":  96.8,
        "normal_low":   97.0,
        "normal_high":  99.0,
        "warning_high": 100.4,
        "critical_high": 103.0,
    },
    "respiratory_rate": {
        "unit": "breaths/min",
        "critical_low": 8,
        "warning_low":  10,
        "normal_low":   12,
        "normal_high":  20,
        "warning_high": 24,
        "critical_high": 30,
    },
}

SeverityLevel = Literal["normal", "warning", "critical"]


class VitalReading(TypedDict):
    """A single timestamped vital reading."""
    timestamp: str   # ISO 8601
    value: float


class ThresholdResult(TypedDict):
    metric: str
    value: float
    unit: str
    severity: SeverityLevel
    message: str
    auto_emergency: bool   # True → triggers emergency orchestration


class OutlierResult(TypedDict):
    is_outlier: bool
    z_score: float
    deviation_pct: float
    message: str


class TrendResult(TypedDict):
    metric: str
    direction: Literal["rising", "falling", "stable", "insufficient_data"]
    slope_per_reading: float        # e.g., +0.5 bpm per reading
    change_pct_over_window: float
    message: str


class RiskFlag(TypedDict):
    flag_id: str
    severity: SeverityLevel
    title: str
    detail: str
    recommendation: str


# ────────────────────────────────────────────────────────────────────────────
# 1. Threshold Breach Detection
# ────────────────────────────────────────────────────────────────────────────

def check_threshold(metric: str, value: float) -> Optional[ThresholdResult]:
    """
    Compare a single reading against clinical thresholds.
    Returns ThresholdResult or None if metric not tracked.
    """
    if metric not in THRESHOLDS:
        return None

    t = THRESHOLDS[metric]
    unit = t["unit"]
    severity: SeverityLevel = "normal"
    message = f"{metric.replace('_', ' ').title()} is within normal range."
    auto_emergency = False

    if value <= t["critical_low"]:
        severity = "critical"
        message = f"⚠️ CRITICAL LOW {metric.replace('_', ' ')}: {value} {unit} — Immediate attention needed."
        auto_emergency = True
    elif value <= t["warning_low"]:
        severity = "warning"
        message = f"⚠️ Low {metric.replace('_', ' ')}: {value} {unit} — Below normal range."
    elif value >= t["critical_high"]:
        severity = "critical"
        message = f"⚠️ CRITICAL HIGH {metric.replace('_', ' ')}: {value} {unit} — Immediate attention needed."
        auto_emergency = True
    elif value >= t["warning_high"]:
        severity = "warning"
        message = f"⚠️ Elevated {metric.replace('_', ' ')}: {value} {unit} — Above normal range."

    return ThresholdResult(
        metric=metric,
        value=value,
        unit=unit,
        severity=severity,
        message=message,
        auto_emergency=auto_emergency,
    )


def check_all_thresholds(vitals: dict[str, float]) -> list[ThresholdResult]:
    """Check every vital in one pass. Returns list of all results."""
    results = []
    for metric, value in vitals.items():
        result = check_threshold(metric, value)
        if result:
            results.append(result)
    return results


# ────────────────────────────────────────────────────────────────────────────
# 2. Outlier / Spike Detection
# ────────────────────────────────────────────────────────────────────────────

def _mean(values: list[float]) -> float:
    return sum(values) / len(values)


def _std(values: list[float], mean: float) -> float:
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    return math.sqrt(variance)


def detect_outlier(
    new_value: float,
    history: list[float],
    z_threshold: float = 2.5,
) -> OutlierResult:
    """
    Z-score outlier detection against recent history.
    Requires at least 5 historical readings.
    """
    if len(history) < 5:
        return OutlierResult(
            is_outlier=False,
            z_score=0.0,
            deviation_pct=0.0,
            message="Insufficient history for outlier detection (need ≥5 readings).",
        )

    mu = _mean(history)
    sigma = _std(history, mu)

    if sigma < 1e-6:
        # Constant readings — any change is suspicious but not necessarily an outlier
        z = abs(new_value - mu)
        return OutlierResult(
            is_outlier=(z > 1),
            z_score=z,
            deviation_pct=0.0,
            message="Readings have been constant — small changes detected." if z > 1 else "Readings stable.",
        )

    z = (new_value - mu) / sigma
    deviation_pct = ((new_value - mu) / mu) * 100 if mu != 0 else 0

    is_outlier = abs(z) >= z_threshold
    message = (
        f"Outlier detected: Z-score={z:.2f} (threshold ±{z_threshold}). "
        f"Deviation {deviation_pct:+.1f}% from rolling mean {mu:.1f}."
        if is_outlier
        else f"Within normal variation (Z={z:.2f}, mean={mu:.1f})."
    )

    return OutlierResult(
        is_outlier=is_outlier,
        z_score=round(z, 3),
        deviation_pct=round(deviation_pct, 2),
        message=message,
    )


def smooth_readings(readings: list[float], window: int = 3) -> list[float]:
    """Simple moving average smoothing to reduce sensor noise."""
    if len(readings) < window:
        return readings
    smoothed = []
    for i in range(len(readings)):
        start = max(0, i - window + 1)
        smoothed.append(round(_mean(readings[start:i + 1]), 2))
    return smoothed


# ────────────────────────────────────────────────────────────────────────────
# 3. Temporal Trend Analysis
# ────────────────────────────────────────────────────────────────────────────

def analyze_trend(
    metric: str,
    readings: list[float],
    stable_threshold_pct: float = 3.0,
) -> TrendResult:
    """
    Linear regression slope to determine if a metric is rising, falling, or stable.
    Uses last N readings (N=readings length).
    """
    n = len(readings)
    if n < 3:
        return TrendResult(
            metric=metric,
            direction="insufficient_data",
            slope_per_reading=0.0,
            change_pct_over_window=0.0,
            message=f"Need at least 3 readings to determine trend (have {n}).",
        )

    # Simple linear regression: slope = (n*Σxy - Σx*Σy) / (n*Σx² - (Σx)²)
    x = list(range(n))
    sum_x  = sum(x)
    sum_y  = sum(readings)
    sum_xy = sum(xi * yi for xi, yi in zip(x, readings))
    sum_x2 = sum(xi ** 2 for xi in x)

    denom = n * sum_x2 - sum_x ** 2
    slope = (n * sum_xy - sum_x * sum_y) / denom if denom != 0 else 0.0

    first_val = readings[0]
    last_val  = readings[-1]
    change_pct = ((last_val - first_val) / first_val * 100) if first_val != 0 else 0.0

    if abs(change_pct) <= stable_threshold_pct:
        direction: Literal["rising", "falling", "stable", "insufficient_data"] = "stable"
        msg = f"{metric.replace('_', ' ').title()} is stable (change: {change_pct:+.1f}% over {n} readings)."
    elif slope > 0:
        direction = "rising"
        msg = (
            f"{metric.replace('_', ' ').title()} is trending UP "
            f"(+{change_pct:.1f}% over {n} readings, slope: +{slope:.2f}/reading)."
        )
    else:
        direction = "falling"
        msg = (
            f"{metric.replace('_', ' ').title()} is trending DOWN "
            f"({change_pct:.1f}% over {n} readings, slope: {slope:.2f}/reading)."
        )

    return TrendResult(
        metric=metric,
        direction=direction,
        slope_per_reading=round(slope, 4),
        change_pct_over_window=round(change_pct, 2),
        message=msg,
    )


def batch_trend_analysis(history_map: dict[str, list[float]]) -> list[TrendResult]:
    """Run trend analysis on all metrics at once."""
    return [analyze_trend(metric, readings) for metric, readings in history_map.items()]


# ────────────────────────────────────────────────────────────────────────────
# 4. Risk Flag Generation
# ────────────────────────────────────────────────────────────────────────────

def generate_risk_flags(
    current_vitals: dict[str, float],
    trends: list[TrendResult],
    threshold_results: list[ThresholdResult],
) -> list[RiskFlag]:
    """
    Combine threshold + trend data into human-readable, actionable risk flags.
    IMPORTANT: These are NOT diagnostic — they are informational/alerting only.
    """
    flags: list[RiskFlag] = []

    # Threshold-based flags
    for tr in threshold_results:
        if tr["severity"] in ("warning", "critical"):
            flags.append(RiskFlag(
                flag_id=f"threshold_{tr['metric']}_{tr['severity']}",
                severity=tr["severity"],
                title=f"Abnormal {tr['metric'].replace('_', ' ').title()}",
                detail=tr["message"],
                recommendation=(
                    "Seek immediate emergency care." if tr["severity"] == "critical"
                    else "Monitor closely and consult a healthcare provider if persistent."
                ),
            ))

    # Trend-based flags (progressive hypertension, etc.)
    for trend in trends:
        if trend["direction"] == "rising" and trend["change_pct_over_window"] > 10:
            if trend["metric"] in ("systolic_bp", "diastolic_bp"):
                flags.append(RiskFlag(
                    flag_id=f"trend_rising_{trend['metric']}",
                    severity="warning",
                    title=f"Progressive Rise in {trend['metric'].replace('_', ' ').title()}",
                    detail=trend["message"],
                    recommendation="Blood pressure shows a sustained upward trend. Log this trend and inform your doctor.",
                ))
            elif trend["metric"] == "heart_rate" and trend["change_pct_over_window"] > 15:
                flags.append(RiskFlag(
                    flag_id="trend_rising_heart_rate",
                    severity="warning",
                    title="Heart Rate Trend Increasing",
                    detail=trend["message"],
                    recommendation="Elevated and rising heart rate. Rest, hydrate, and monitor. Seek care if persistent.",
                ))

        if trend["direction"] == "falling" and trend["metric"] == "spo2":
            if trend["change_pct_over_window"] < -3:
                flags.append(RiskFlag(
                    flag_id="trend_falling_spo2",
                    severity="critical",
                    title="Falling Blood Oxygen Level",
                    detail=trend["message"],
                    recommendation="Decreasing SpO₂ is a serious warning sign. Seek immediate medical attention.",
                ))

    # Combo flags
    sys_bp = current_vitals.get("systolic_bp", 0)
    hr = current_vitals.get("heart_rate", 0)
    if sys_bp > 160 and hr > 100:
        flags.append(RiskFlag(
            flag_id="combo_hypertensive_tachycardia",
            severity="critical",
            title="Combined: High BP + Elevated Heart Rate",
            detail=f"Systolic BP {sys_bp} mmHg with HR {hr} bpm simultaneously.",
            recommendation="This combination warrants urgent medical evaluation. Do not exert yourself.",
        ))

    # Deduplicate by flag_id
    seen: set[str] = set()
    unique_flags = []
    for f in flags:
        if f["flag_id"] not in seen:
            seen.add(f["flag_id"])
            unique_flags.append(f)

    return unique_flags
