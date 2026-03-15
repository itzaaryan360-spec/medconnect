"""
MedLex Keep-Alive Watchdog
---------------------------
Runs run_server.py in a subprocess and automatically restarts it if it exits.
Use this for persistent / always-online deployments on Windows.

Usage:
    python keep_alive.py
"""

import subprocess
import sys
import os
import time
import logging
import datetime

# ── Setup ─────────────────────────────────────────────────────────────────────
LOG_FILE = os.path.join(os.path.dirname(__file__), "watchdog.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [WATCHDOG]  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
    ],
)
logger = logging.getLogger("medlex.watchdog")

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PYTHON_EXE  = os.path.join(BACKEND_DIR, "venv", "Scripts", "python.exe")
SERVER_SCRIPT = os.path.join(BACKEND_DIR, "run_server.py")

# Restart settings
MAX_RESTARTS      = 999_999    # effectively unlimited
RESTART_DELAY_S   = 3          # seconds to wait before restart
BACKOFF_FACTOR    = 1.5        # exponential backoff multiplier on repeated crashes
MAX_DELAY_S       = 60         # max wait between restarts


def run():
    restart_count = 0
    delay = RESTART_DELAY_S

    logger.info("=" * 55)
    logger.info("  MedLex Keep-Alive Watchdog started")
    logger.info(f"  Python  : {PYTHON_EXE}")
    logger.info(f"  Script  : {SERVER_SCRIPT}")
    logger.info("  Press Ctrl+C to stop.")
    logger.info("=" * 55)

    while restart_count < MAX_RESTARTS:
        start_time = datetime.datetime.now()
        logger.info(f"[Restart #{restart_count}] Launching backend server...")

        try:
            proc = subprocess.Popen(
                [PYTHON_EXE, SERVER_SCRIPT],
                cwd=BACKEND_DIR,
            )
            proc.wait()
            exit_code = proc.returncode
        except KeyboardInterrupt:
            logger.info("Watchdog stopped by user (Ctrl+C).")
            break
        except FileNotFoundError:
            logger.error(
                f"Python executable not found at: {PYTHON_EXE}\n"
                "Ensure the backend venv is set up: cd backend && python -m venv venv && venv\\Scripts\\pip install -r requirements.txt"
            )
            break

        uptime = (datetime.datetime.now() - start_time).total_seconds()
        logger.warning(f"Backend exited with code {exit_code} after {uptime:.1f}s.")

        if uptime > 60:
            # Server ran stably — reset backoff
            delay = RESTART_DELAY_S

        restart_count += 1

        if restart_count >= MAX_RESTARTS:
            logger.error("Max restarts reached. Watchdog stopping.")
            break

        logger.info(f"Restarting in {delay:.0f}s...")
        try:
            time.sleep(delay)
        except KeyboardInterrupt:
            logger.info("Watchdog stopped by user during wait.")
            break

        delay = min(delay * BACKOFF_FACTOR, MAX_DELAY_S)

    logger.info("Watchdog exited.")


if __name__ == "__main__":
    run()
