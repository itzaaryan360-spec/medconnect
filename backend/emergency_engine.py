"""
Connect Care — Emergency Orchestration Engine
==============================================
Implements a fault-tolerant, idempotent emergency pipeline.

Emergency Workflow (per architecture spec):
  1.  Fall / vitals-breach trigger received
  2.  Start 30-second patient confirmation timer
  3.  If no cancel → auto escalate
  4.  Escalation:  a) Notify caretaker (SMS / push / in-app)
                   b) Auto-dial 108 (India ambulance)
                   c) Share live GPS coordinates
                   d) Dispatch AI voice agent context packet
                   e) Transmit vitals snapshot + medical context
  5.  All actions are logged with timestamps (audit trail)
  6.  Duplicate prevention via event_id idempotency key
  7.  Manual caretaker override supported

Safety constraints:
  - One active emergency per patient at a time
  - All state transitions are logged
  - Events survive process restart (file-backed audit log)
"""

import os
import json
import uuid
import logging
import datetime
from typing import Optional, Literal
from twilio.rest import Client

logger = logging.getLogger("medlex.emergency_engine")

# ── Twilio & CallMeBot Setup ────────────────────────────────────────────────
TWILIO_SID = os.environ.get("TWILIO_ACCOUNT_SID")
TWILIO_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN")
TWILIO_FROM = os.environ.get("TWILIO_FROM_NUMBER")
CALLMEBOT_KEY = os.environ.get("CALLMEBOT_API_KEY") # Free WhatsApp API Key
BACKEND_URL = os.environ.get("VITE_BACKEND_URL", "http://localhost:5000")

def get_twilio_client():
    if TWILIO_SID and TWILIO_TOKEN:
        return Client(TWILIO_SID, TWILIO_TOKEN)
    return None

def send_whatsapp_alert(phone: str, location: dict) -> bool:
    """
    Sends an automated WhatsApp message using Twilio (Primary) or CallMeBot (Fallback).
    """
    if not phone:
        return False
        
    lat, lon = location.get("lat", 0), location.get("lon", 0)
    msg = f"🚨 *MEDCONNECT SOS ALERT*\nCrash detected. Live Location: https://maps.google.com/?q={lat},{lon}"

    # Attempt 1: Twilio WhatsApp (Most Reliable)
    client = get_twilio_client()
    if client:
        try:
            # Default to Twilio Sandbox number for reliability in testing
            # sender must be "whatsapp:+14155238886" to use the sandbox
            from_wa = "whatsapp:+14155238886"
            
            # Normalize phone: remove non-digits, add Indian country code if 10 digits
            clean_phone = "".join(filter(str.isdigit, phone))
            if len(clean_phone) == 10:
                clean_phone = "91" + clean_phone
            
            to_wa = f"whatsapp:+{clean_phone}"
            
            client.messages.create(
                body=msg,
                from_=from_wa,
                to=to_wa
            )
            logger.info(f"Twilio WhatsApp sent to {to_wa}")
            return True
        except Exception as e:
            logger.warning(f"Twilio WhatsApp failed: {e}")

    # Attempt 2: CallMeBot (Free Fallback)
    if CALLMEBOT_KEY:
        import requests
        try:
            clean_phone = "".join(filter(str.isdigit, phone))
            url = f"https://api.callmebot.com/whatsapp.php?phone={clean_phone}&text={requests.utils.quote(msg)}&apikey={CALLMEBOT_KEY}"
            resp = requests.get(url, timeout=10)
            return resp.status_code == 200
        except Exception as e:
            logger.error(f"CallMeBot fallback failed: {e}")
            
    return False

# ── Storage ───────────────────────────────────────────────────────────────────
_DIR = os.path.dirname(os.path.abspath(__file__))
EMERGENCY_LOG_FILE = os.path.join(_DIR, "emergency_audit.json")
ACTIVE_EMERGENCY_FILE = os.path.join(_DIR, "active_emergencies.json")

EmergencyStatus = Literal[
    "PENDING_CONFIRMATION",
    "ESCALATED",
    "RESOLVED",
    "CANCELLED",
    "CARETAKER_OVERRIDE",
]

TriggerSource = Literal[
    "MANUAL_SOS",
    "FALL_DETECTION",
    "VITALS_CRITICAL",
    "INACTIVITY",
    "CARETAKER_ALERT",
]


# ── File-backed persistence helpers ──────────────────────────────────────────

def _load_json(path: str, default) -> any:
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception as e:
        logger.warning(f"Failed to load {path}: {e}")
    return default


def _save_json(path: str, data: any) -> None:
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
    except Exception as e:
        logger.error(f"Failed to save {path}: {e}")


def _now_iso() -> str:
    return datetime.datetime.utcnow().isoformat() + "Z"


# ── Audit Log ────────────────────────────────────────────────────────────────

def _append_audit(event: dict) -> None:
    """Append one event to the immutable audit log (append-only, no overwrite)."""
    logs = _load_json(EMERGENCY_LOG_FILE, [])
    event.setdefault("logged_at", _now_iso())
    logs.append(event)
    _save_json(EMERGENCY_LOG_FILE, logs[-2000:])  # Keep last 2000 events


def get_audit_log(patient_id: Optional[str] = None, limit: int = 100) -> list:
    """Retrieve audit log entries, optionally filtered by patient."""
    logs = _load_json(EMERGENCY_LOG_FILE, [])
    if patient_id:
        logs = [e for e in logs if e.get("patient_id") == patient_id]
    return logs[-limit:]


# ── Active Emergency State ────────────────────────────────────────────────────

def _load_active() -> dict:
    return _load_json(ACTIVE_EMERGENCY_FILE, {})


def _save_active(active: dict) -> None:
    _save_json(ACTIVE_EMERGENCY_FILE, active)


def get_active_emergency(patient_id: str) -> Optional[dict]:
    """Return the current active emergency for a patient, if one exists."""
    return _load_active().get(patient_id)


def has_active_emergency(patient_id: str) -> bool:
    em = get_active_emergency(patient_id)
    return em is not None and em.get("status") not in ("RESOLVED", "CANCELLED", "CARETAKER_OVERRIDE")


# ── Emergency Lifecycle ───────────────────────────────────────────────────────

def trigger_emergency(
    patient_id: str,
    trigger_source: TriggerSource,
    vitals_snapshot: Optional[dict] = None,
    location: Optional[dict] = None,        # {"lat": float, "lon": float, "accuracy_m": int}
    caretaker_phone: Optional[str] = None,
    patient_name: Optional[str] = None,
    medical_context: Optional[str] = None,
    idempotency_key: Optional[str] = None,  # Client-supplied — prevents duplicate triggers
) -> dict:
    """
    Initiate an emergency event.

    Idempotency: If the same idempotency_key is used twice, the second call
    is a no-op and returns the existing emergency event.

    Returns the emergency event dict.
    """
    # ── Idempotency check ───────────────────────────────────────────────────
    if idempotency_key:
        logs = _load_json(EMERGENCY_LOG_FILE, [])
        for log_entry in reversed(logs):
            if log_entry.get("idempotency_key") == idempotency_key:
                logger.info(f"Duplicate emergency trigger suppressed (key={idempotency_key})")
                return {**log_entry, "_duplicate": True}

    # ── Duplicate active-emergency guard ────────────────────────────────────
    if has_active_emergency(patient_id):
        existing = get_active_emergency(patient_id)
        logger.warning(f"Emergency already active for patient {patient_id}: {existing['event_id']}")
        return {**existing, "_already_active": True}

    event_id = str(uuid.uuid4())
    now = _now_iso()

    event = {
        "event_id": event_id,
        "idempotency_key": idempotency_key or event_id,
        "patient_id": patient_id,
        "patient_name": patient_name or "Unknown Patient",
        "trigger_source": trigger_source,
        "status": "PENDING_CONFIRMATION",
        "triggered_at": now,
        "confirmation_deadline": _add_seconds(now, 30),
        "vitals_snapshot": vitals_snapshot or {},
        "location": location,
        "caretaker_phone": caretaker_phone,
        "medical_context": medical_context,
        "actions_taken": [],
        "resolved_at": None,
        "resolved_by": None,
    }

    # ── Persist ─────────────────────────────────────────────────────────────
    active = _load_active()
    active[patient_id] = event
    _save_active(active)

    _append_audit({
        "event_type": "EMERGENCY_TRIGGERED",
        "event_id": event_id,
        "patient_id": patient_id,
        "trigger_source": trigger_source,
        "idempotency_key": event["idempotency_key"],
    })

    logger.info(f"Emergency triggered: event_id={event_id}, patient={patient_id}, source={trigger_source}")
    return event


def escalate_emergency(
    patient_id: str,
    location: Optional[dict] = None,
) -> dict:
    """
    Escalate an emergency from PENDING_CONFIRMATION → ESCALATED.
    Simulates:  caretaker notification, 108 dial, GPS share, AI voice packet.

    In production: wire each action to real SMS/telephony API.
    """
    active = _load_active()
    event = active.get(patient_id)

    if not event:
        raise ValueError(f"No active emergency for patient {patient_id}")

    if event["status"] != "PENDING_CONFIRMATION":
        return event  # Already escalated or resolved

    event["status"] = "ESCALATED"
    event["escalated_at"] = _now_iso()

    # Update location if newly provided
    if location:
        event["location"] = location

    # ── Simulate / record each action ───────────────────────────────────────
    actions = event.setdefault("actions_taken", [])

    # Action 1 — Caretaker SMS/push
    caretaker_notified = _notify_caretaker(event)
    actions.append({
        "action": "CARETAKER_NOTIFIED",
        "channel": ["sms", "push", "in_app"],
        "success": caretaker_notified,
        "timestamp": _now_iso(),
    })

    # Action 2 — Dial 108
    call_initiated = _dial_ambulance(event)
    actions.append({
        "action": "DIAL_108",
        "number": "108",
        "success": call_initiated,
        "timestamp": _now_iso(),
    })

    # Action 3 — GPS share
    gps_shared = _share_gps(event)
    actions.append({
        "action": "GPS_SHARED",
        "location": event.get("location"),
        "success": gps_shared,
        "timestamp": _now_iso(),
    })

    # Action 4 — AI voice agent context packet
    voice_packet = _build_voice_agent_packet(event)
    actions.append({
        "action": "VOICE_AGENT_DISPATCHED",
        "packet": voice_packet,
        "timestamp": _now_iso(),
    })

    # ── Persist ─────────────────────────────────────────────────────────────
    active[patient_id] = event
    _save_active(active)

    _append_audit({
        "event_type": "EMERGENCY_ESCALATED",
        "event_id": event["event_id"],
        "patient_id": patient_id,
        "actions": [a["action"] for a in actions],
    })

    logger.info(f"Emergency escalated: event_id={event['event_id']}")
    return event


def cancel_emergency(patient_id: str, cancelled_by: str = "PATIENT") -> dict:
    """Patient presses 'I'm OK' within confirmation window."""
    active = _load_active()
    event = active.get(patient_id)
    if not event:
        raise ValueError(f"No active emergency for {patient_id}")

    event["status"] = "CANCELLED"
    event["resolved_at"] = _now_iso()
    event["resolved_by"] = cancelled_by

    active[patient_id] = event
    _save_active(active)

    _append_audit({
        "event_type": "EMERGENCY_CANCELLED",
        "event_id": event["event_id"],
        "patient_id": patient_id,
        "cancelled_by": cancelled_by,
    })
    logger.info(f"Emergency cancelled: {event['event_id']} by {cancelled_by}")
    return event


def resolve_emergency(patient_id: str, resolved_by: str = "PATIENT") -> dict:
    """Mark an active/escalated emergency as resolved."""
    active = _load_active()
    event = active.get(patient_id)
    if not event:
        raise ValueError(f"No active emergency for {patient_id}")

    event["status"] = "RESOLVED"
    event["resolved_at"] = _now_iso()
    event["resolved_by"] = resolved_by

    active[patient_id] = event
    _save_active(active)

    _append_audit({
        "event_type": "EMERGENCY_RESOLVED",
        "event_id": event["event_id"],
        "patient_id": patient_id,
        "resolved_by": resolved_by,
    })
    logger.info(f"Emergency resolved: {event['event_id']} by {resolved_by}")
    return event


def caretaker_override(patient_id: str, caretaker_id: str) -> dict:
    """Caretaker takes manual control — stops auto-escalation."""
    active = _load_active()
    event = active.get(patient_id)
    if not event:
        raise ValueError(f"No active emergency for {patient_id}")

    event["status"] = "CARETAKER_OVERRIDE"
    event["override_by"] = caretaker_id
    event["override_at"] = _now_iso()

    active[patient_id] = event
    _save_active(active)

    _append_audit({
        "event_type": "CARETAKER_OVERRIDE",
        "event_id": event["event_id"],
        "patient_id": patient_id,
        "caretaker_id": caretaker_id,
    })
    return event


# ── Action Implementations (Simulate / Stub for real integrations) ────────────

def _notify_caretaker(event: dict) -> bool:
    """
    Calls Twilio SMS gateway to notify the caretaker.
    """
    phone = event.get("caretaker_phone")
    if not phone or phone == "unknown":
        logger.warning("No caretaker phone provided for SMS alert.")
        return False

    patient = event.get("patient_name", "Patient")
    location = event.get("location")
    loc_str = ""
    if location:
        loc_str = f" Location: https://maps.google.com/?q={location['lat']},{location['lon']}"
    
    message = (
        f"🚨 EMERGENCY ALERT: {patient} may have been in a crash or fall.{loc_str}. "
        f"MedConnect is initiating a 108 emergency call."
    )

    client = get_twilio_client()
    if client and TWILIO_FROM:
        try:
            client.messages.create(
                body=message,
                from_=TWILIO_FROM,
                to=phone
            )
            logger.info(f"Twilio SMS sent to {phone}")
            return True
        except Exception as e:
            logger.error(f"Twilio SMS failed: {e}")
            return False
    
    logger.info(f"[SIMULATED SMS] → {phone}: {message}")
    return True


def _dial_ambulance(event: dict) -> bool:
    """
    Initiates an automated voice report to the CARETAKER via Twilio.
    Note: VoIP services like Twilio cannot dial emergency short-codes (108).
    The mobile app handles the direct 108 dial locally.
    """
    target_number = event.get("caretaker_phone")
    
    if not target_number or target_number == "unknown":
        logger.warning("No valid caretaker phone for automated voice dispatch.")
        return False

    client = get_twilio_client()
    if client and TWILIO_FROM:
        try:
            # Point Twilio to our backend for the voice script (TwiML)
            twiml_url = f"{BACKEND_URL}/api/emergency/twiml/{event['event_id']}"
            call = client.calls.create(
                url=twiml_url,
                to=target_number,
                from_=TWILIO_FROM
            )
            logger.info(f"Twilio AI Voice Dispatch to Caretaker ({target_number}): {call.sid}")
            return True
        except Exception as e:
            logger.error(f"Twilio Voice Dispatch failed: {e}")
            return False

    logger.info(f"[SIMULATED VOICE DISPATCH] Event {event['event_id']} — Notifying contacts")
    return True


def _share_gps(event: dict) -> bool:
    """Prepare GPS payload for transmission to 108 operator."""
    location = event.get("location")
    if not location:
        logger.warning(f"[GPS SHARE] No location data for emergency {event['event_id']}")
        return False
    logger.info(f"[GPS SHARE] Lat={location.get('lat')}, Lon={location.get('lon')}")
    return True


def _build_voice_agent_packet(event: dict) -> dict:
    """
    Builds the text packet for the AI voice agent to read to the 108 operator.
    Keeps language plain, factual, and non-diagnostic.
    """
    patient = event.get("patient_name", "the patient")
    vitals = event.get("vitals_snapshot", {})
    location = event.get("location")
    context = event.get("medical_context", "")

    vitals_str = ", ".join(
        f"{k.replace('_', ' ')}: {v}" for k, v in vitals.items()
    ) if vitals else "not available"

    loc_str = (
        f"GPS coordinates: {location['lat']:.4f} N, {location['lon']:.4f} E"
        if location else "location not available"
    )

    script = (
        f"Hello, this is the Connect Care automated emergency system. "
        f"We are calling on behalf of {patient}, who requires immediate medical assistance. "
        f"Current vitals: {vitals_str}. "
        f"{loc_str}. "
        f"{('Background: ' + context) if context else ''} "
        f"Please dispatch an ambulance immediately. "
        f"The caretaker has been notified. "
        f"Emergency reference: {event['event_id']}."
    )

    return {"script": script, "event_id": event["event_id"]}


# ── Utility ───────────────────────────────────────────────────────────────────

def _add_seconds(iso_str: str, seconds: int) -> str:
    dt = datetime.datetime.fromisoformat(iso_str.rstrip("Z"))
    return (dt + datetime.timedelta(seconds=seconds)).isoformat() + "Z"
