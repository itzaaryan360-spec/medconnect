"""
backend/device_simulator.py
Simulates a smartwatch sending live vitals to MedConnect backend.
Use this for testing when you don't have real hardware.

Usage:
  python device_simulator.py --patient demo_patient --api-key mck_xxxx
  python device_simulator.py --register --patient demo_patient   (auto-registers first)
"""

import argparse
import json
import math
import random
import time
import sys
import urllib.request
import urllib.error

BACKEND_URL = "http://localhost:5000"

# ── Realistic vital sign simulation ──────────────────────────────────────────
def simulate_vitals(tick: int, scenario: str = "normal") -> dict:
    """Generate realistic vitals with natural variation and drift."""
    t = tick * 0.1  # time factor

    if scenario == "normal":
        hr  = 72  + 8  * math.sin(t) + random.gauss(0, 2)
        sys = 120 + 5  * math.sin(t * 0.3) + random.gauss(0, 3)
        dia = 80  + 3  * math.sin(t * 0.3) + random.gauss(0, 2)
        sp  = 97  + 1  * math.sin(t * 0.5) + random.gauss(0, 0.3)
        tmp = 98.6 + 0.2 * math.sin(t * 0.2) + random.gauss(0, 0.1)
        rr  = 16  + 2  * math.sin(t * 0.4) + random.gauss(0, 0.5)

    elif scenario == "exercise":
        progress = min(tick / 50, 1.0)  # ramp up
        hr  = 72  + 60  * progress + random.gauss(0, 5)
        sys = 120 + 30  * progress + random.gauss(0, 5)
        dia = 80  + 10  * progress + random.gauss(0, 3)
        sp  = 97  - 2   * progress + random.gauss(0, 0.5)
        tmp = 98.6 + 1.5 * progress + random.gauss(0, 0.1)
        rr  = 16  + 10  * progress + random.gauss(0, 1)

    elif scenario == "critical":
        hr  = 140 + random.gauss(0, 10)
        sys = 185 + random.gauss(0, 8)
        dia = 115 + random.gauss(0, 5)
        sp  = 86  + random.gauss(0, 1)
        tmp = 101.5 + random.gauss(0, 0.3)
        rr  = 24  + random.gauss(0, 2)

    elif scenario == "sleep":
        hr  = 55  + 5  * math.sin(t * 0.1) + random.gauss(0, 1)
        sys = 110 + 3  * math.sin(t * 0.1) + random.gauss(0, 2)
        dia = 70  + 2  * math.sin(t * 0.1) + random.gauss(0, 1)
        sp  = 96  + 0.5 * math.sin(t * 0.2) + random.gauss(0, 0.3)
        tmp = 97.8 + random.gauss(0, 0.1)
        rr  = 12  + random.gauss(0, 0.5)
    else:
        return simulate_vitals(tick, "normal")

    # Simulate GPS (slow movement)
    lat = 17.3850 + 0.0001 * tick * math.sin(t * 0.05)
    lon = 78.4867 + 0.0001 * tick * math.cos(t * 0.05)

    return {
        "heart_rate":       round(max(30, hr), 1),
        "systolic_bp":      round(max(60, sys), 1),
        "diastolic_bp":     round(max(40, dia), 1),
        "spo2":             round(min(100, max(70, sp)), 1),
        "temperature_f":    round(tmp, 1),
        "respiratory_rate": round(max(6, rr), 1),
        "latitude":         round(lat, 6),
        "longitude":        round(lon, 6),
        "battery_pct":      max(0, 100 - tick // 10),
    }


# ── HTTP helpers ──────────────────────────────────────────────────────────────
def post(path: str, body: dict, headers: dict = None) -> dict:
    url  = BACKEND_URL + path
    data = json.dumps(body).encode("utf-8")
    req  = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if headers:
        for k, v in headers.items():
            req.add_header(k, v)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        print(f"  HTTP {e.code}: {body[:200]}")
        return {}
    except Exception as e:
        print(f"  Request error: {e}")
        return {}


def register(patient_id: str) -> str:
    """Register device and return api_key."""
    print(f"? Registering smartwatch for patient '{patient_id}'...")
    resp = post("/api/iot/register", {
        "patient_id":  patient_id,
        "device_type": "smartwatch",
        "device_name": "Simulated Smart Watch v1",
    })
    if resp.get("status") == "ok":
        key = resp["device"]["api_key"]
        did = resp["device"]["id"]
        print(f"? Device registered!")
        print(f"  Device ID : {did}")
        print(f"  API Key   : {key}")
        print(f"  ⚠️  Save this API key — it won't be shown again.")
        return key
    else:
        print(f"? Registration failed: {resp}")
        sys.exit(1)


def run_simulator(patient_id: str, api_key: str, scenario: str, interval: float):
    print(f"\n? MedConnect Device Simulator")
    print(f"  Patient  : {patient_id}")
    print(f"  Scenario : {scenario}")
    print(f"  Interval : {interval}s")
    print(f"  Backend  : {BACKEND_URL}")
    print(f"  Press Ctrl+C to stop\n")
    print(f"{'Time':>8}  {'HR':>5}  {'Sys':>5}  {'Dia':>5}  {'SpO2':>6}  {'Temp':>6}  {'RR':>5}  {'Status'}")
    print("-" * 70)

    tick = 0
    while True:
        vitals = simulate_vitals(tick, scenario)
        resp   = post("/api/iot/data", vitals, headers={"X-Device-Key": api_key})

        status = resp.get("status", "error")
        flags  = resp.get("risk_flags", [])
        flag_str = " ⚠️ " + ", ".join(
            f.get("message", str(f)) if isinstance(f, dict) else str(f)
            for f in flags[:2]
        ) if flags else ""

        ts = time.strftime("%H:%M:%S")
        bat = vitals["battery_pct"]
        print(
            f"{ts}  "
            f"{vitals['heart_rate']:>5.1f}  "
            f"{vitals['systolic_bp']:>5.1f}  "
            f"{vitals['diastolic_bp']:>5.1f}  "
            f"{vitals['spo2']:>6.1f}  "
            f"{vitals['temperature_f']:>6.1f}  "
            f"{vitals['respiratory_rate']:>5.1f}  "
            f"{'✅' if status == 'ok' else '❌'} bat:{bat}%{flag_str}"
        )

        tick  += 1
        time.sleep(interval)


# ── CLI ───────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="MedConnect IoT Device Simulator")
    parser.add_argument("--patient",  default="demo_patient", help="Patient ID")
    parser.add_argument("--api-key",  default="",             help="Device API key (omit to auto-register)")
    parser.add_argument("--scenario", default="normal",
                        choices=["normal","exercise","critical","sleep"],
                        help="Vital signs scenario to simulate")
    parser.add_argument("--interval", type=float, default=5.0, help="Seconds between readings")
    parser.add_argument("--register", action="store_true",    help="Force re-registration")
    parser.add_argument("--backend",  default=BACKEND_URL,    help="Backend URL")
    args = parser.parse_args()

    BACKEND_URL = args.backend

    api_key = args.api_key
    if not api_key or args.register:
        api_key = register(args.patient)
        print()

    run_simulator(args.patient, api_key, args.scenario, args.interval)
