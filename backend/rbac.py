"""
Connect Care — RBAC (Role-Based Access Control)
================================================
Provides JWT token generation and role-enforcement decorators.

Roles:
  PATIENT   — can view own data, upload reports, trigger emergencies
  CARETAKER — can view linked patients' data, receive alerts, cannot modify health data

Usage in Flask routes:
    from rbac import require_role, generate_token, decode_token

    @app.route('/api/patient/data')
    @require_role('PATIENT', 'CARETAKER')
    def get_patient_data():
        ...
"""

import os
import functools
import datetime
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# ── JWT secret (load from env in production) ─────────────────────────────────
JWT_SECRET = os.environ.get("JWT_SECRET", "medlex-dev-secret-change-in-prod")
JWT_ALGORITHM = "HS256"
TOKEN_TTL_HOURS = 24

VALID_ROLES = {"PATIENT", "CARETAKER", "ADMIN"}

# ── Try to import jwt; fall back to unsigned tokens for dev ──────────────────
try:
    import jwt as pyjwt
    JWT_AVAILABLE = True
except ImportError:
    JWT_AVAILABLE = False
    logger.warning("PyJWT not installed — running without JWT verification (dev mode only).")

# ── Role definitions ──────────────────────────────────────────────────────────

ROLE_PERMISSIONS = {
    "PATIENT": {
        "read_own_vitals",
        "write_vitals",
        "upload_report",
        "read_own_report",
        "trigger_emergency",
        "read_own_profile",
        "write_own_profile",
    },
    "CARETAKER": {
        "read_patient_vitals",
        "read_patient_report",
        "read_patient_profile",
        "acknowledge_emergency",
        "override_emergency",
        "read_analytics",
    },
    "ADMIN": {
        "read_own_vitals", "write_vitals", "upload_report",
        "read_own_report", "trigger_emergency", "read_own_profile",
        "write_own_profile", "read_patient_vitals", "read_patient_report",
        "read_patient_profile", "acknowledge_emergency", "override_emergency",
        "read_analytics", "read_audit_logs", "manage_users",
    },
}

# ── Token utilities ───────────────────────────────────────────────────────────

def generate_token(user_id: str, role: str, name: str = "") -> Optional[str]:
    """
    Generate a signed JWT token.
    Returns None if PyJWT is unavailable.
    """
    if role not in VALID_ROLES:
        raise ValueError(f"Invalid role: {role}. Must be one of {VALID_ROLES}")

    payload = {
        "sub": user_id,
        "role": role,
        "name": name,
        "iat": datetime.datetime.utcnow(),
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=TOKEN_TTL_HOURS),
    }

    if not JWT_AVAILABLE:
        import base64, json
        raw = json.dumps(payload, default=str)
        return base64.b64encode(raw.encode()).decode()

    return pyjwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """
    Decode and validate a JWT token.
    Returns payload dict or None if invalid.
    """
    try:
        if not JWT_AVAILABLE:
            import base64, json
            raw = base64.b64decode(token.encode()).decode()
            return json.loads(raw)

        return pyjwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except Exception as e:
        logger.warning(f"Token decode failed: {e}")
        return None


def get_token_from_request(request) -> Optional[str]:
    """Extract Bearer token from Authorization header."""
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:].strip()
    return None


def has_permission(role: str, permission: str) -> bool:
    """Check if a role has a specific permission."""
    return permission in ROLE_PERMISSIONS.get(role, set())


# ── Flask Decorator ───────────────────────────────────────────────────────────

def require_role(*allowed_roles: str):
    """
    Flask route decorator — enforces that the caller has an allowed role.

    Usage:
        @app.route('/api/upload')
        @require_role('PATIENT')
        def upload():
            ...
    """
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            from flask import request, jsonify, g

            token = get_token_from_request(request)
            if not token:
                return jsonify({"status": "error", "message": "Authentication required. Provide Bearer token."}), 401

            payload = decode_token(token)
            if not payload:
                return jsonify({"status": "error", "message": "Invalid or expired token."}), 401

            role = payload.get("role", "")
            if role not in allowed_roles:
                return jsonify({
                    "status": "error",
                    "message": f"Access denied. Required roles: {list(allowed_roles)}. Your role: {role}"
                }), 403

            # Make user info available to the route
            g.user_id = payload.get("sub")
            g.user_role = role
            g.user_name = payload.get("name", "")

            return fn(*args, **kwargs)
        return wrapper
    return decorator


def optional_auth(fn):
    """
    Decorator that tries to authenticate but does not fail if token is absent.
    Use for endpoints that work for both authenticated and anonymous users.
    """
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        from flask import request, g
        token = get_token_from_request(request)
        if token:
            payload = decode_token(token)
            if payload:
                g.user_id = payload.get("sub")
                g.user_role = payload.get("role", "")
                g.user_name = payload.get("name", "")
            else:
                g.user_id = g.user_role = g.user_name = None
        else:
            g.user_id = g.user_role = g.user_name = None
        return fn(*args, **kwargs)
    return wrapper
