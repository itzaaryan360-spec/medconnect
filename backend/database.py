"""
backend/database.py
Supabase client wrapper — cloud database + file storage for MedConnect.
Falls back to local file storage if Supabase is not configured.
"""
import os
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

logger = logging.getLogger(__name__)

def _load_json(path: str, default):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default

def _save_json(path: str, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
    except Exception as e:
        logger.error(f"Save failed {path}: {e}")


# ── Supabase client (optional) ────────────────────────────────────────────────
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")  # Use service key for backend

_supabase = None

def get_client():
    global _supabase
    if _supabase:
        return _supabase
    if not SUPABASE_URL or not SUPABASE_KEY:
        return None
    try:
        from supabase import create_client
        _supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        logger.info("Supabase client initialized successfully.")
        return _supabase
    except Exception as e:
        logger.error(f"Supabase init failed: {e}")
        return None

SUPABASE_ENABLED = bool(SUPABASE_URL and SUPABASE_KEY)

# ── USERS & AUTH ──────────────────────────────────────────────────────────────

def register_user(name: str, email: str, password_hash: str, role: str, additional_info: Optional[dict] = None) -> Optional[dict]:
    """Register a new user in Supabase or local store."""
    sb = get_client()
    user_id = str(uuid.uuid4())
    
    if sb:
        try:
            user_row = {
                "user_id": user_id,
                "name": name,
                "email": email,
                "password_hash": password_hash,
                "role": role,
                "created_at": datetime.now(timezone.utc).isoformat()
            }
            sb.table("users").insert(user_row).execute()
            
            if role == "PATIENT":
                patient_id = generate_unique_patient_id(email)
                info = additional_info or {}
                patient_row = {
                    "user_id": user_id,
                    "patient_id": patient_id,
                    "age": info.get("age"),
                    "phone": info.get("phone"),
                    "emergency_contact": info.get("emergency_contact")
                }
                sb.table("patients").insert(patient_row).execute()
                user_row["patient_id"] = patient_id
            elif role == "CARETAKER":
                info = additional_info or {}
                caretaker_row = {
                    "user_id": user_id,
                    "phone": info.get("phone"),
                    "relationship": info.get("relationship")
                }
                sb.table("caretakers").insert(caretaker_row).execute()
                
            return user_row
        except Exception as e:
            logger.error(f"Registration error (Supabase): {e}")
            return None
    else:
        # Fallback to local JSON (simplified for demo)
        users = _load_json("users.json", [])
        if any(u["email"] == email for u in users):
            return None
            
        user_row = {
            "user_id": user_id,
            "name": name,
            "email": email,
            "password_hash": password_hash,
            "role": role,
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        
        if role == "PATIENT":
            patient_id = generate_unique_patient_id(email)
            user_row["patient_id"] = patient_id
            user_row.update(additional_info or {})
        
        users.append(user_row)
        _save_json("users.json", users)
        return user_row

def get_user_by_email(email: str) -> Optional[dict]:
    """Fetch user by email."""
    sb = get_client()
    if sb:
        try:
            res = sb.table("users").select("*").eq("email", email).execute()
            if res.data:
                user = res.data[0]
                if user["role"] == "PATIENT":
                    p_res = sb.table("patients").select("patient_id").eq("user_id", user["user_id"]).execute()
                    if p_res.data:
                        user["patient_id"] = p_res.data[0]["patient_id"]
                return user
        except Exception as e:
            logger.error(f"User fetch error: {e}")
    else:
        users = _load_json("users.json", [])
        for u in users:
            if u["email"] == email:
                return u
    return None

def generate_unique_patient_id(email: str) -> str:
    """
    Generate a unique MC-XXXX Patient ID.
    Length dynamic based on email length as requested.
    """
    import random
    import string
    
    # Logic:
    # If email length <= 6 -> ID length = 4-6
    # If email length 7-12 -> ID length = 6-8
    # If email length > 12 -> ID length = 8-12
    email_len = len(email)
    if email_len <= 6:
        length = random.randint(4, 6)
    elif email_len <= 12:
        length = random.randint(6, 8)
    else:
        length = random.randint(8, 12)
        
    chars = string.digits + string.ascii_uppercase
    
    # Try generating until unique
    while True:
        suffix = ''.join(random.choice(chars) for _ in range(length))
        candidate = f"MC-{suffix}"
        
        # Check uniqueness
        if not is_patient_id_taken(candidate):
            return candidate

def is_patient_id_taken(patient_id: str) -> bool:
    """Check if patient ID is already used."""
    sb = get_client()
    if sb:
        try:
            res = sb.table("patients").select("patient_id").eq("patient_id", patient_id).execute()
            return len(res.data) > 0
        except:
            return False
    else:
        users = _load_json("users.json", [])
        return any(u.get("patient_id") == patient_id for u in users)
    return False

def link_caretaker_patient(caretaker_id: str, patient_id: str) -> bool:
    """Create a connection request from caretaker to patient."""
    sb = get_client()
    if sb:
        try:
            # Check if patient exists
            p_res = sb.table("patients").select("user_id").eq("patient_id", patient_id).execute()
            if not p_res.data:
                return False
                
            sb.table("caretaker_patient_map").insert({
                "caretaker_id": caretaker_id,
                "patient_id": patient_id,
                "status": "PENDING",
                "requested_at": datetime.now(timezone.utc).isoformat()
            }).execute()
            return True
        except Exception as e:
            logger.error(f"Linking error: {e}")
            return False
    else:
        # Local mock
        links = _load_json("links.json", [])
        links.append({
            "caretaker_id": caretaker_id,
            "patient_id": patient_id,
            "status": "APPROVED", # Auto-approve in demo mode
            "requested_at": datetime.now(timezone.utc).isoformat()
        })
        _save_json("links.json", links)
        return True

import uuid


# ── VITALS ─────────────────────────────────────────────────────────────────────

def store_vitals(patient_id: str, reading: dict) -> bool:
    """Persist a vitals reading to Supabase."""
    sb = get_client()
    if not sb:
        return False
    try:
        row = {
            "patient_id":       patient_id,
            "heart_rate":       reading.get("heart_rate"),
            "systolic_bp":      reading.get("systolic_bp"),
            "diastolic_bp":     reading.get("diastolic_bp"),
            "spo2":             reading.get("spo2"),
            "temperature_f":    reading.get("temperature_f"),
            "respiratory_rate": reading.get("respiratory_rate"),
            "step_count":       reading.get("step_count"),
            "sleep_hours":      reading.get("sleep_hours"),
            "calories_burned":  reading.get("calories_burned"),
            "distance_m":       reading.get("distance_m"),
            "source_device_model": reading.get("source_device_model"),
            "is_validated":     reading.get("is_validated", True),
            "recorded_at":      datetime.now(timezone.utc).isoformat(),
        }
        row = {k: v for k, v in row.items() if v is not None}
        sb.table("vitals").insert(row).execute()
        return True
    except Exception as e:
        logger.error(f"Vitals store error: {e}")
        return False


def fetch_vitals_history(patient_id: str, limit: int = 100) -> list:
    """Fetch recent vitals from Supabase."""
    sb = get_client()
    if not sb:
        return []
    try:
        res = (
            sb.table("vitals")
            .select("*")
            .eq("patient_id", patient_id)
            .order("recorded_at", desc=True)
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.error(f"Vitals fetch error: {e}")
        return []


def fetch_all_patients_vitals() -> dict:
    """Fetch latest vitals for every patient (for caretaker dashboard)."""
    sb = get_client()
    if not sb:
        return {}
    try:
        res = sb.table("vitals").select("*").order("recorded_at", desc=True).execute()
        # Group latest reading per patient
        seen = {}
        for row in (res.data or []):
            pid = row["patient_id"]
            if pid not in seen:
                seen[pid] = row
        return seen
    except Exception as e:
        logger.error(f"All patients fetch error: {e}")
        return {}

# ── REPORTS ────────────────────────────────────────────────────────────────────

def store_report_metadata(user_id: str, filename: str, summary: str,
                           affected_anatomy: list, entities: dict,
                           storage_path: str = "") -> Optional[int]:
    """Record report analysis result in Supabase."""
    sb = get_client()
    if not sb:
        return None
    try:
        res = sb.table("reports").insert({
            "user_id":         user_id,
            "filename":        filename,
            "storage_path":    storage_path,
            "summary":         summary,
            "affected_anatomy": affected_anatomy,
            "entities":        entities,
            "uploaded_at":     datetime.now(timezone.utc).isoformat(),
        }).execute()
        if res.data:
            return res.data[0].get("id")
    except Exception as e:
        logger.error(f"Report store error: {e}")
    return None


def upload_report_file(file_bytes: bytes, filename: str, user_id: str) -> str:
    """Upload a report PDF/image to Supabase Storage. Returns storage path."""
    sb = get_client()
    if not sb:
        return ""
    try:
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        path = f"{user_id}/{ts}_{filename}"
        sb.storage.from_("reports").upload(
            path, file_bytes,
            {"content-type": "application/octet-stream", "upsert": "true"}
        )
        return path
    except Exception as e:
        logger.error(f"Storage upload error: {e}")
        return ""


def get_report_url(storage_path: str) -> str:
    """Get a signed URL (1 hour) for a stored report file."""
    sb = get_client()
    if not sb or not storage_path:
        return ""
    try:
        res = sb.storage.from_("reports").create_signed_url(storage_path, 3600)
        return res.get("signedURL", "")
    except Exception as e:
        logger.error(f"Signed URL error: {e}")
        return ""


def fetch_user_reports(user_id: str) -> list:
    """Fetch report history for a user."""
    sb = get_client()
    if not sb:
        return []
    try:
        res = (
            sb.table("reports")
            .select("*")
            .eq("user_id", user_id)
            .order("uploaded_at", desc=True)
            .limit(50)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.error(f"Reports fetch error: {e}")
        return []

# ── EMERGENCIES ────────────────────────────────────────────────────────────────

def store_emergency(event: dict) -> bool:
    """Upsert an emergency event to Supabase."""
    sb = get_client()
    if not sb:
        return False
    try:
        row = {
            "event_id":        event.get("event_id"),
            "idempotency_key": event.get("idempotency_key"),
            "patient_id":      event.get("patient_id"),
            "patient_name":    event.get("patient_name"),
            "trigger_source":  event.get("trigger_source"),
            "status":          event.get("status"),
            "triggered_at":    event.get("triggered_at"),
            "resolved_at":     event.get("resolved_at"),
            "resolved_by":     event.get("resolved_by"),
            "vitals_snapshot": event.get("vitals_snapshot", {}),
            "location":        event.get("location"),
            "actions_taken":   event.get("actions_taken", []),
        }
        sb.table("emergencies").upsert(row).execute()
        return True
    except Exception as e:
        logger.error(f"Emergency store error: {e}")
        return False


def fetch_active_emergency(patient_id: str) -> Optional[dict]:
    """Fetch active (non-resolved) emergency for a patient."""
    sb = get_client()
    if not sb:
        return None
    try:
        res = (
            sb.table("emergencies")
            .select("*")
            .eq("patient_id", patient_id)
            .not_.in_("status", ["RESOLVED", "CANCELLED"])
            .order("triggered_at", desc=True)
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception as e:
        logger.error(f"Emergency fetch error: {e}")
        return None

# ── AUDIT LOG ──────────────────────────────────────────────────────────────────

def append_audit(event_type: str, patient_id: str, details: Optional[dict] = None) -> bool:
    """Write an audit entry to Supabase."""
    sb = get_client()
    if not sb:
        return False
    try:
        sb.table("audit_log").insert({
            "event_type": event_type,
            "patient_id": patient_id,
            "details":    details or {},
            "logged_at":  datetime.now(timezone.utc).isoformat(),
        }).execute()
        return True
    except Exception as e:
        logger.error(f"Audit log error: {e}")
        return False


def fetch_audit_log(limit: int = 200) -> list:
    """Fetch recent audit events."""
    sb = get_client()
    if not sb:
        return []
    try:
        res = (
            sb.table("audit_log")
            .select("*")
            .order("logged_at", desc=True)
            .limit(limit)
            .execute()
        )
        return res.data or []
    except Exception as e:
        logger.error(f"Audit fetch error: {e}")
        return []
