"""
MedLex Backend — Production Server
Uses waitress (Windows-compatible WSGI server) for a stable, multi-threaded deployment.
Run this file instead of `app.py` for production / always-on mode.
"""

import os
import sys
import logging

# ── Logging setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  [%(levelname)s]  %(name)s — %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(os.path.join(os.path.dirname(__file__), "server_latest.log"), encoding="utf-8"),
    ],
)
logger = logging.getLogger("medlex.server")

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", 5000))
THREADS = int(os.environ.get("THREADS", 4))

def main():
    try:
        from waitress import serve
        from app import app

        logger.info("=" * 55)
        logger.info("  MedLex Backend  —  Production Mode (Waitress)")
        logger.info(f"  Listening on  http://{HOST}:{PORT}")
        logger.info(f"  Threads       {THREADS}")
        logger.info("=" * 55)

        serve(app, host=HOST, port=PORT, threads=THREADS)

    except ImportError:
        logger.warning("waitress not installed — falling back to Flask dev server.")
        logger.warning("Install with: pip install waitress")
        from app import app
        app.run(host=HOST, port=PORT, debug=False)

    except Exception as e:
        logger.critical(f"Server startup failed: {e}", exc_info=True)
        sys.exit(1)

if __name__ == "__main__":
    main()
