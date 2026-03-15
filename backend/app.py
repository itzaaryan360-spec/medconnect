from flask import Flask, request, jsonify, send_file, g
from flask_cors import CORS
import traceback
import logging
import io
import os
import json
import datetime
import uuid

from dotenv import load_dotenv
load_dotenv()

import google.generativeai as genai
from openai import OpenAI
import requests

# Configure Gemini globally
if os.environ.get("GOOGLE_API_KEY"):
    genai.configure(api_key=os.environ.get("GOOGLE_API_KEY"))
try:
    import pytesseract
    from PIL import Image
    import cv2
    import numpy as np
    
    # Cloud/Linux deployment: Tesseract is usually in the PATH
    # Windows: Manual path setting
    if os.name == 'nt':
         pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'
    
    TESSERACT_AVAILABLE = True
except Exception:
    TESSERACT_AVAILABLE = False

try:
    import spacy
    try:
        nlp = spacy.load("en_core_med7_lg")
        NLP_MODEL = "med7"
    except Exception:
        nlp = spacy.load("en_core_web_sm")
        NLP_MODEL = "en_core_web_sm"
    SPACY_AVAILABLE = True
except Exception:
    SPACY_AVAILABLE = False
    NLP_MODEL = "none"

try:
    import ollama
    OLLAMA_AVAILABLE = True
except Exception:
    OLLAMA_AVAILABLE = False

try:
    import pdfplumber
    PDF_AVAILABLE = True
except Exception:
    try:
        import PyPDF2
        PDF_AVAILABLE = True
    except Exception:
        PDF_AVAILABLE = False

# ── Connect Care sub-engines ──────────────────────────────────────────────────
from vitals_engine import (
    check_all_thresholds,
    detect_outlier,
    smooth_readings,
    analyze_trend,
    generate_risk_flags,
    batch_trend_analysis,
)
from emergency_engine import (
    trigger_emergency,
    escalate_emergency,
    cancel_emergency,
    resolve_emergency,
    caretaker_override,
    get_active_emergency,
    get_audit_log,
    has_active_emergency,
)
from rbac import (
    generate_token,
    decode_token,
    require_role,
    optional_auth,
    ROLE_PERMISSIONS,
)
from database import (
    register_user,
    get_user_by_email,
    link_caretaker_patient,
    fetch_vitals_history,
    fetch_all_patients_vitals,
)

# ── App Setup ──────────────────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)   # Allow all origins in dev — restrict per-origin in production


logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Storage files ─────────────────────────────────────────────────────────────
_DIR = os.path.dirname(os.path.abspath(__file__))
SESSION_LOG_FILE = os.path.join(_DIR, "session_logs.json")
VITALS_STORE_FILE = os.path.join(_DIR, "vitals_store.json")      # {patient_id: {metric: [readings]}}
PATIENTS_FILE = os.path.join(_DIR, "patients.json")               # Basic patient registry

# ── Anatomy Mapping ───────────────────────────────────────────────────────────
ANATOMY_MAP = {
    "heart": "Heart", "cardiac": "Heart", "myocardial": "Heart",
    "coronary": "Heart", "arrhythmia": "Heart", "hypertension": "Heart",
    "tachycardia": "Heart", "bradycardia": "Heart", "chest": "Heart",
    "lung": "Lungs", "pulmonary": "Lungs", "bronchi": "Lungs",
    "pneumonia": "Lungs", "urti": "Lungs", "asthma": "Lungs",
    "copd": "Lungs", "pleural": "Lungs", "respiratory": "Lungs", "thorax": "Lungs",
    "breath": "Lungs",
    "brain": "Brain", "neuro": "Brain", "cerebral": "Brain",
    "migraine": "Brain", "stroke": "Brain", "seizure": "Brain",
    "epilepsy": "Brain", "cognitive": "Brain", "head": "Brain", "skull": "Brain",
    "liver": "Liver", "hepatic": "Liver", "hepatitis": "Liver",
    "cirrhosis": "Liver", "jaundice": "Liver", "gallbladder": "Liver",
    "kidney": "Kidneys", "renal": "Kidneys", "nephr": "Kidneys",
    "urinary": "Kidneys", "dialysis": "Kidneys", "creatinine": "Kidneys",
    "stomach": "Stomach", "gastric": "Stomach", "gastro": "Stomach",
    "peptic": "Stomach", "ulcer": "Stomach", "gerd": "Stomach", "abdomen": "Stomach", "abdominal": "Stomach",
    "intestin": "Intestines", "bowel": "Intestines", "colon": "Intestines",
    "colitis": "Intestines", "ibs": "Intestines", "crohn": "Intestines", "digestive": "Intestines",
    "bladder": "Bladder", "cystitis": "Bladder", "urology": "Bladder",
    "spleen": "Spleen", "splenic": "Spleen",
}

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _load_json(path, default):
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return default


def _save_json(path, data):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, default=str)
    except Exception as e:
        logger.error(f"Save failed {path}: {e}")


def _load_vitals_store():
    return _load_json(VITALS_STORE_FILE, {})


def _save_vitals_store(data):
    _save_json(VITALS_STORE_FILE, data)


def log_session(session_id, filename, status, affected):
    try:
        logs = _load_json(SESSION_LOG_FILE, [])
        logs.append({
            "session_id": session_id,
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            "filename": filename,
            "status": status,
            "affected_anatomy": affected,
        })
        _save_json(SESSION_LOG_FILE, logs[-500:])
    except Exception as e:
        logger.warning(f"Session log error: {e}")


def extract_text_from_image(file_bytes):
    if not TESSERACT_AVAILABLE:
        raise RuntimeError("Tesseract not available.")
    img_array = np.frombuffer(file_bytes, np.uint8)
    img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image.")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    enhanced = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    pil_image = Image.fromarray(enhanced)
    text = pytesseract.image_to_string(pil_image, lang='eng', config='--psm 6')
    return ' '.join(text.split()).strip()


def extract_text_from_pdf(file_bytes):
    text = ""
    try:
        import pdfplumber
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            text = ' '.join(
                ' '.join((p.extract_text() or '').split()) for p in pdf.pages
            ).strip()
            if text:
                return text
    except Exception as e:
        logger.warning(f"pdfplumber failed: {e}")

    try:
        import PyPDF2
        reader = PyPDF2.PdfReader(io.BytesIO(file_bytes))
        text = ' '.join(
            ' '.join((page.extract_text() or '').split()) for page in reader.pages
        ).strip()
        if text:
            return text
    except Exception as e:
        logger.warning(f"PyPDF2 failed: {e}")

    if text:
        return text
    raise RuntimeError("Could not extract any text from PDF using available libraries.")


def extract_entities(text):
    if not SPACY_AVAILABLE:
        return {}
    doc = nlp(text[:5000])
    entities = {}
    for ent in doc.ents:
        entities.setdefault(ent.label_, [])
        if ent.text not in entities[ent.label_]:
            entities[ent.label_].append(ent.text)
    return entities


def detect_affected_anatomy(text, entities):
    lower_text = text.lower()
    affected = set()
    for keyword, organ in ANATOMY_MAP.items():
        if keyword in lower_text:
            affected.add(organ)
    for entity_text in [t for sub in entities.values() for t in sub]:
        for keyword, organ in ANATOMY_MAP.items():
            if keyword in entity_text.lower():
                affected.add(organ)
    return sorted(list(affected))


def _extractive_summary(text: str, max_sentences: int = 8) -> str:
    """
    Pure-Python extractive summariser — no GPU, no model needed.
    Scores sentences by medical keyword density and picks the top N.
    Always works, even fully offline.
    """
    import re

    MEDICAL_TERMS = {
        "diagnosis", "patient", "treatment", "medication", "prescribed", "findings",
        "abnormal", "normal", "result", "test", "blood", "pressure", "heart",
        "rate", "level", "elevated", "low", "high", "recommended", "follow",
        "report", "history", "symptom", "condition", "examination", "lab",
        "mg", "mmhg", "bpm", "procedure", "doctor", "hospital", "clinic",
        "scan", "x-ray", "mri", "ct", "ecg", "ekg", "glucose", "cholesterol",
        "hemoglobin", "creatinine", "thyroid", "diabetes", "hypertension",
        "infection", "inflammation", "chronic", "acute", "severe", "mild",
    }

    # Split into sentences
    raw_sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    sentences = [s.strip() for s in raw_sentences if len(s.strip()) > 20]

    if not sentences:
        return "Could not extract summary from report text."

    # Score each sentence by medical term density
    def score(s: str) -> float:
        words = re.findall(r'\b\w+\b', s.lower())
        if not words:
            return 0.0
        hits = sum(1 for w in words if w in MEDICAL_TERMS)
        return hits / len(words)

    scored = sorted(enumerate(sentences), key=lambda x: score(x[1]), reverse=True)
    # Pick top sentences, re-order by original position for readability
    top_indices = sorted([i for i, _ in scored[:max_sentences]])
    chosen = [sentences[i] for i in top_indices]

    summary = " ".join(chosen)
    return (
        "📄 Report Summary (AI-Extracted):\n\n" + summary +
        "\n\n⚠️ Note: AI model was unavailable — this summary was extracted "
        "directly from the report text. Please consult your physician for interpretation."
    )


# ── Supported output languages ────────────────────────────────────────────────
SUPPORTED_LANGUAGES = [
    "English", "Hindi", "Telugu", "Kannada", "Malayalam", "Tamil", "Odia"
]


def _build_llama3_prompt(text: str, language: str) -> str:
    text = str(text or "")
    """
    Build a specialized medical prompt for LLaMA 3 / Gemini.
    Focuses on summarizing reports and reading prescriptions correctly.
    """
    lang = language if language in SUPPORTED_LANGUAGES else "English"

    prompt = f"""You are a 'Medical Companion' - an expert in reading doctor prescriptions and lab reports.

Your task:
1. Analyze the extracted medical text.
2. If it is a prescription, identify medications, dosages, and intake times clearly.
3. If it is a lab report, explain the results (Normal vs Abnormal) simply.
4. Use a warm, supportive, and extremely clear tone.
5. Avoid complex jargon. Explain 'BP' as Blood Pressure, etc.
6. Generate a response in {lang}.
7. Determine which body organs/systems are affected. At the very bottom, add exactly: "SYSTEM_ORGANS: [List]"
   ONLY use these names: Brain, Heart, Lungs, Liver, Stomach, Spleen, Kidneys, Intestines, Bladder.

Output Format (STRICT):
---------------------------------------
Report Summary:
(3–6 sentences explaining the gist and next steps)

Key Points:
- [Medication Name] : [Dosage/Instruction] (if prescription)
- [Key Finding] : [Simple Explanation]
- Follow-up: [When/Who]

Disclaimer:
This is an AI summary. Always consult your doctor before starting or stopping any medication.
---------------------------------------
SYSTEM_ORGANS: [Organ1, Organ2]

USER REPORT TEXT:
{text[:3000]}

Now generate the expert summary in {lang} following the format exactly."""
    return prompt


def generate_summary(text: str, language: str = "English", file_bytes: bytes = b"", filename: str = "") -> str:
    """
    Multilingual summary generation with absolute robustness.
    Prioritizes Gemini/Groq because OpenAI is out of quota (429).
    """
    import base64
    logs = []
    
    def log(msg):
        print(f"[DEBUG-AI] {msg}")
        logs.append(msg)

    # Ensure text is a string
    safetext = str(text or "")
    log(f"Starting analysis for {filename} (Lang: {language})")
    
    is_scan = not safetext or len(safetext.strip()) < 100 or safetext.startswith("(AI Vision Analysis)")
    
    v_prompt = (
        f"You are a medical report analyst. Analyze this document image. "
        f"Generate a SHORT (3-5 sentences) summary in {language}. "
        f"Identify affected organs, meds, and advice. "
        "Use headers: 'Report Summary:' and 'Key Points:'. "
        "At the bottom, add: 'SYSTEM_ORGANS: [List]'. "
        "ONLY use these names: Brain, Heart, Lungs, Liver, Stomach, Spleen, Kidneys, Intestines, Bladder."
    )

    # ── TIER 1: Google Gemini (Vision) ──────────────────────────────────
    google_key = os.environ.get("GOOGLE_API_KEY")
    if google_key and file_bytes:
        # Verified models from system list
        models_to_try = [
            "gemini-2.0-flash", 
            "models/gemini-2.0-flash",
            "gemini-flash-latest",
            "models/gemini-flash-latest",
            "gemini-1.5-flash",
            "models/gemini-1.5-flash"
        ]
        for m_name in models_to_try:
            try:
                log(f"Trying Gemini {m_name}...")
                model = genai.GenerativeModel(m_name)
                ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else 'jpg'
                
                # Setup Mime Type correctly
                if ext == "pdf":
                    mime = "application/pdf"
                elif ext in ("png", "webp"):
                    mime = f"image/{ext}"
                else:
                    mime = "image/jpeg"
                
                # Gemini generate_content with multimodal payload
                response = model.generate_content([{'mime_type': mime, 'data': file_bytes}, v_prompt], stream=False)
                
                if response and response.text:
                    log(f"Gemini {m_name} SUCCESS")
                    return response.text.strip()
            except Exception as e:
                log(f"Gemini {m_name} Error: {str(e)[:100]}")

    # ── TIER 2: Groq (Llama 3 Text) - New Primary Text Engine ───────────
    groq_key = os.environ.get("GROQ_API_KEY")
    if groq_key:
        try:
            log("Attempting Groq (Llama 3)...")
            from groq import Groq
            g_client = Groq(api_key=groq_key)
            
            # Text analysis
            input_content = safetext if (len(safetext) > 20) else "Handwritten medical document scan analysis request."
            prompt = _build_llama3_prompt(input_content, language)
            
            completion = g_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3
            )
            res = completion.choices[0].message.content.strip()
            if res:
                log("Groq SUCCESS")
                return res
        except Exception as e:
            log(f"Groq Error: {str(e)[:100]}")

    # ── TIER 3: OpenAI (GPT-4o) - Last resort (Quota Risk) ──────────────
    openai_key = os.environ.get("OPENAI_API_KEY")
    if openai_key:
        try:
            log("Attempting OpenAI (Quota Fallback)...")
            client = OpenAI(api_key=openai_key)
            prompt = _build_llama3_prompt(safetext if len(safetext) > 20 else "Medical doc", language)
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=500
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            log(f"OpenAI Error: {str(e)[:100]}")

    # ── Final Fallback: Local Extractive ─────────────────────────────────
    if len(safetext) > 20:
        log("Using local extraction.")
        return _extractive_summary(safetext)
    
    return f"Summary unavailable. Tries: {', '.join(logs)}. Please ensure the document is clear or try again later."
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# ── AUTH ROUTES ───────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/api/auth/register', methods=['POST'])
def auth_register():
    """Register a new user with role-specific fields."""
    data = request.get_json(force=True) or {}
    email = data.get("email")
    password = data.get("password")
    name = data.get("name")
    role = data.get("role", "PATIENT").upper()
    
    if not email or not password or not name:
        return jsonify({"status": "error", "message": "Missing required fields"}), 400
        
    password_hash = f"hash_{password}" 
    
    additional_info = {
        "age": data.get("age"),
        "phone": data.get("phone"),
        "emergency_contact": data.get("emergency_contact"),
        "relationship": data.get("relationship")
    }
    
    user = register_user(name, email, password_hash, role, additional_info)
    if not user:
        return jsonify({"status": "error", "message": "Email already registered or registration failed"}), 400
        
    token = generate_token(user["user_id"], user["role"], user["name"])
    return jsonify({
        "status": "ok",
        "token": token,
        "user_id": user["user_id"],
        "role": user["role"],
        "name": user["name"],
        "patient_id": user.get("patient_id"),
        "permissions": sorted(ROLE_PERMISSIONS.get(user["role"], [])),
    })

@app.route('/api/auth/login', methods=['POST'])
def auth_login():
    """Authenticate user and issue JWT."""
    data = request.get_json(force=True) or {}
    email = data.get("email")
    password = data.get("password")
    
    if not email or not password:
        user_id = data.get("user_id", str(uuid.uuid4()))
        role = data.get("role", "PATIENT").upper()
        name = data.get("name", "Demo User")
    else:
        user = get_user_by_email(email)
        if not user or user["password_hash"] != f"hash_{password}":
            return jsonify({"status": "error", "message": "Invalid email or password"}), 401
        
        user_id = user["user_id"]
        role = user["role"]
        name = user["name"]
        patient_id = user.get("patient_id")

    try:
        token = generate_token(user_id, role, name)
        res = {
            "status": "ok",
            "token": token,
            "user_id": user_id,
            "role": role,
            "name": name,
            "permissions": sorted(ROLE_PERMISSIONS.get(role, [])),
        }
        if 'patient_id' in locals() and patient_id:
            res["patient_id"] = patient_id
        return jsonify(res)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/auth/verify', methods=['POST'])
def auth_verify():
    """Verify a token and return its payload."""
    data = request.get_json(force=True) or {}
    token = data.get("token") or request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    if not token:
        return jsonify({"status": "error", "message": "No token provided"}), 400
    payload = decode_token(token)
    if not payload:
        return jsonify({"status": "error", "message": "Invalid or expired token"}), 401
    return jsonify({"status": "ok", "payload": payload})


# ─────────────────────────────────────────────────────────────────────────────
# ── VITALS ROUTES (Connect Care — Real-time Ingestion) ───────────────────────
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/api/vitals/submit', methods=['POST'])
@optional_auth
def submit_vitals():
    """
    Ingest a vitals reading from wearable / manual entry.

    Body (JSON):
    {
        patient_id: str,
        timestamp: str (ISO 8601) — optional,
        heart_rate: float,
        systolic_bp: float,
        diastolic_bp: float,
        spo2: float,
        temperature_f: float,
        respiratory_rate: float  — optional
    }

    Returns: threshold breach results, outlier flags, trend analysis, risk flags.
    """
    data = request.get_json(force=True) or {}

    # RBAC: caretakers cannot write patient vitals
    if getattr(g, 'user_role', None) == 'CARETAKER':
        return jsonify({"status": "error", "message": "Caretakers cannot write patient health data."}), 403

    patient_id = data.get("patient_id", getattr(g, 'user_id', None) or "anonymous")
    timestamp = data.get("timestamp", datetime.datetime.utcnow().isoformat() + "Z")

    # Extract known vitals
    VITAL_KEYS = ["heart_rate", "systolic_bp", "diastolic_bp", "spo2", "temperature_f", "respiratory_rate"]
    current = {k: float(data[k]) for k in VITAL_KEYS if k in data}

    if not current:
        return jsonify({"status": "error", "message": "No vital metrics in request."}), 400

    # ── Load history for this patient ────────────────────────────────────────
    store = _load_json(VITALS_STORE_FILE, {})
    patient_store = store.setdefault(patient_id, {"raw": {}, "smoothed": {}})

    for metric, value in current.items():
        raw_history = patient_store["raw"].setdefault(metric, [])
        raw_history.append({"timestamp": timestamp, "value": value})
        patient_store["raw"][metric] = raw_history[-200:]   # Keep 200 per metric

    _save_json(VITALS_STORE_FILE, store)

    # ── Analysis ─────────────────────────────────────────────────────────────
    threshold_results = check_all_thresholds(current)

    outlier_results = {}
    for metric, value in current.items():
        history_vals = [r["value"] for r in patient_store["raw"].get(metric, [])[:-1]]
        outlier_results[metric] = detect_outlier(value, history_vals)

    trend_history = {
        metric: [r["value"] for r in patient_store["raw"].get(metric, [])[-30:]]
        for metric in current
    }
    trends = batch_trend_analysis(trend_history)

    risk_flags = generate_risk_flags(current, trends, threshold_results)

    # ── Auto-emergency trigger on critical breach ─────────────────────────────
    auto_triggered = None
    for tr in threshold_results:
        if tr["auto_emergency"] and not has_active_emergency(patient_id):
            auto_triggered = trigger_emergency(
                patient_id=patient_id,
                trigger_source="VITALS_CRITICAL",
                vitals_snapshot=current,
                idempotency_key=f"auto_{patient_id}_{timestamp}",
            )
            break

    return jsonify({
        "status": "ok",
        "patient_id": patient_id,
        "timestamp": timestamp,
        "current_vitals": current,
        "threshold_results": threshold_results,
        "outlier_results": outlier_results,
        "trends": trends,
        "risk_flags": risk_flags,
        "auto_emergency_triggered": auto_triggered is not None,
        "emergency_event": auto_triggered,
    })


@app.route('/api/vitals/history/<patient_id>', methods=['GET'])
@optional_auth
def get_vitals_history(patient_id):
    """
    Return vitals history for a patient.
    RBAC: CARETAKER can read patient vitals (read-only).
    """
    store = _load_json(VITALS_STORE_FILE, {})
    patient_data = store.get(patient_id, {})
    raw = patient_data.get("raw", {})

    # Build smoothed versions
    smoothed = {
        metric: smooth_readings([r["value"] for r in readings])
        for metric, readings in raw.items()
    }

    # Recent summary (last 24 readings per metric)
    summary = {}
    for metric, readings in raw.items():
        vals = [r["value"] for r in readings[-24:]]
        if vals:
            summary[metric] = {
                "latest": vals[-1],
                "min": min(vals),
                "max": max(vals),
                "avg": round(sum(vals) / len(vals), 2),
                "trend": analyze_trend(metric, vals),
            }

    return jsonify({
        "status": "ok",
        "patient_id": patient_id,
        "raw": raw,
        "smoothed": smoothed,
        "summary": summary,
    })

@app.route('/api/caretaker/connect', methods=['POST'])
@require_role('CARETAKER')
def caretaker_connect_patient():
    """Allow caretaker to link a patient via Patient ID."""
    data = request.get_json(force=True) or {}
    patient_id = data.get("patient_id")
    if not patient_id:
        return jsonify({"status": "error", "message": "Patient ID is required"}), 400
        
    success = link_caretaker_patient(g.user_id, patient_id)
    if success:
        return jsonify({"status": "ok", "message": "Connection request sent successfully"})
    else:
        return jsonify({"status": "error", "message": "Invalid Patient ID or already linked"}), 400


@app.route('/api/analytics/summary/<patient_id>', methods=['GET'])
@optional_auth
def analytics_summary(patient_id):
    """
    Temporal analytics summary for a patient.
    Query param: period = daily | weekly | monthly (default: weekly)
    """
    period = request.args.get("period", "weekly")
    store = _load_json(VITALS_STORE_FILE, {})
    raw = store.get(patient_id, {}).get("raw", {})

    # Define window sizes (number of readings as a proxy for time)
    windows = {"daily": 8, "weekly": 56, "monthly": 240}
    window = windows.get(period, 56)

    analytics = {}
    for metric, readings in raw.items():
        recent = readings[-window:]
        vals = [r["value"] for r in recent]
        if not vals:
            continue
        trend = analyze_trend(metric, vals)
        threshold_res = None
        from vitals_engine import check_threshold
        threshold_res = check_threshold(metric, vals[-1]) if vals else None
        analytics[metric] = {
            "period": period,
            "reading_count": len(vals),
            "min": min(vals),
            "max": max(vals),
            "avg": round(sum(vals) / len(vals), 2),
            "latest": vals[-1],
            "trend": trend,
            "threshold_status": threshold_res,
        }

    return jsonify({
        "status": "ok",
        "patient_id": patient_id,
        "period": period,
        "analytics": analytics,
    })


# ─────────────────────────────────────────────────────────────────────────────
# ── EMERGENCY ROUTES ──────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/api/emergency/trigger', methods=['POST'])
@optional_auth
def emergency_trigger():
    """
    Trigger a new emergency event.
    Body: { patient_id, trigger_source, vitals_snapshot?, location?, caretaker_phone?, patient_name?, idempotency_key? }
    """
    data = request.get_json(force=True) or {}
    patient_id = data.get("patient_id", getattr(g, 'user_id', None) or "anonymous")

    try:
        event = trigger_emergency(
            patient_id=patient_id,
            trigger_source=data.get("trigger_source", "MANUAL_SOS"),
            vitals_snapshot=data.get("vitals_snapshot"),
            location=data.get("location"),
            caretaker_phone=data.get("caretaker_phone"),
            patient_name=data.get("patient_name"),
            medical_context=data.get("medical_context"),
            idempotency_key=data.get("idempotency_key"),
        )
        return jsonify({"status": "ok", "event": event})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/emergency/escalate', methods=['POST'])
@optional_auth
def emergency_escalate():
    """Escalate a PENDING emergency to ESCALATED (auto-dial 108, notify caretaker)."""
    data = request.get_json(force=True) or {}
    patient_id = data.get("patient_id", getattr(g, 'user_id', None) or "anonymous")
    try:
        event = escalate_emergency(patient_id, location=data.get("location"))
        return jsonify({"status": "ok", "event": event})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/emergency/cancel', methods=['POST'])
@optional_auth
def emergency_cancel():
    """Patient cancels emergency (I'm OK)."""
    data = request.get_json(force=True) or {}
    patient_id = data.get("patient_id", getattr(g, 'user_id', None) or "anonymous")
    try:
        event = cancel_emergency(patient_id, cancelled_by=data.get("cancelled_by", "PATIENT"))
        return jsonify({"status": "ok", "event": event})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/emergency/resolve', methods=['POST'])
@optional_auth
def emergency_resolve():
    """Mark an emergency as resolved."""
    data = request.get_json(force=True) or {}
    patient_id = data.get("patient_id", getattr(g, 'user_id', None) or "anonymous")
    try:
        event = resolve_emergency(patient_id, resolved_by=data.get("resolved_by", "PATIENT"))
        return jsonify({"status": "ok", "event": event})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/emergency/override', methods=['POST'])
@optional_auth
def emergency_override():
    """Caretaker takes manual control of an active emergency."""
    if getattr(g, 'user_role', None) not in ('CARETAKER', 'ADMIN', None):
        return jsonify({"status": "error", "message": "Only caretakers can override emergencies."}), 403
    data = request.get_json(force=True) or {}
    patient_id = data.get("patient_id")
    if not patient_id:
        return jsonify({"status": "error", "message": "patient_id required"}), 400
    try:
        event = caretaker_override(patient_id, caretaker_id=data.get("caretaker_id", "unknown"))
        return jsonify({"status": "ok", "event": event})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400


@app.route('/api/emergency/whatsapp', methods=['POST'])
@optional_auth
def emergency_whatsapp():
    """Send automated WhatsApp location alert."""
    data = request.get_json(force=True) or {}
    phone = data.get("phone")
    location = data.get("location")
    if not phone or not location:
        return jsonify({"status": "error", "message": "phone and location required"}), 400
    
    from emergency_engine import send_whatsapp_alert
    success = send_whatsapp_alert(phone, location)
    return jsonify({"status": "ok" if success else "error", "success": success})


@app.route('/api/emergency/status/<patient_id>', methods=['GET'])
@optional_auth
def emergency_status(patient_id):
    """Get active emergency state for a patient."""
    event = get_active_emergency(patient_id)
    return jsonify({
        "status": "ok",
        "patient_id": patient_id,
        "has_active_emergency": event is not None and event.get("status") not in ("RESOLVED", "CANCELLED", "CARETAKER_OVERRIDE"),
        "event": event,
    })


@app.route('/api/emergency/audit', methods=['GET'])
def emergency_audit():
    """Return emergency audit log (last 100 events)."""
    patient_id = request.args.get("patient_id")
    logs = get_audit_log(patient_id=patient_id, limit=100)
    return jsonify({"status": "ok", "logs": logs})


@app.route('/api/emergency/twiml/<event_id>')
def emergency_twiml(event_id):
    """
    Generates TwiML for Twilio Programmable Voice.
    The AI Voice Agent script is read to the emergency responder.
    """
    from emergency_engine import _load_active, _build_voice_agent_packet
    active = _load_active()
    # Find patient by event_id
    event = None
    for p_id, e in active.items():
        if e.get("event_id") == event_id:
            event = e
            break
    
    if not event:
        # Fallback script
        script = "This is an automated emergency call from MedConnect. A patient requires help."
    else:
        packet = _build_voice_agent_packet(event)
        script = packet["script"]

    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Joey" language="en-US">
        {script}
    </Say>
    <Pause length="2"/>
    <Say voice="Polly.Joey" language="en-US">
        Repeating: {script}
    </Say>
</Response>
"""
    return twiml, 200, {"Content-Type": "text/xml"}


# ─────────────────────────────────────────────────────────────────────────────
# ── CARETAKER ROUTES ──────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/api/caretaker/patients', methods=['GET'])
def caretaker_patients():
    """
    Returns list of patients linked to a caretaker.
    Query: caretaker_id

    In production: query patient-caretaker mapping table in DB.
    Here we return all patients in the vitals store as a demo.
    """
    store = _load_json(VITALS_STORE_FILE, {})
    patients = []
    for pid, pdata in store.items():
        raw = pdata.get("raw", {})
        latest_vitals = {}
        for metric, readings in raw.items():
            if readings:
                latest_vitals[metric] = readings[-1]["value"]

        em = get_active_emergency(pid)
        patients.append({
            "patient_id": pid,
            "latest_vitals": latest_vitals,
            "has_emergency": em is not None and em.get("status") not in ("RESOLVED", "CANCELLED", "CARETAKER_OVERRIDE"),
            "active_emergency": em,
        })

    return jsonify({"status": "ok", "patients": patients})


# ─────────────────────────────────────────────────────────────────────────────
# ── MEDICAL REPORT ROUTES ─────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────

def _extract_text_from_upload(file_bytes: bytes, filename: str) -> str:
    """
    Tries to extract text locally (Fast).
    If it's an image or scanned PDF, it returns an empty string to trigger 
    the full AI Vision pipeline in generate_summary.
    """
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
    text = ""
    
    # Tier 1: Local PDF/Text Extraction
    try:
        if ext == 'pdf':
            text = extract_text_from_pdf(file_bytes)
            # If PDF has very little text, treat as scanned
            if text and len(text.strip()) < 50:
                print(f"[DEBUG] PDF text {filename} is too short ({len(text)}). Will use Vision.")
                return ""
            return text
        elif ext == 'txt':
            return file_bytes.decode('utf-8', errors='ignore')
    except Exception as e:
        logger.warning(f"Local text extraction failed: {e}")

    # For images, we return empty to force the Vision models (Gemini/OpenAI) to handle it
    print(f"[DEBUG] Document {filename} is image/scan. Handing over to AI Vision.")
    return ""



@app.route('/api/process-report', methods=['POST'])
def process_report():
    """
    Original pipeline — kept for backward compatibility.
    Language defaults to English; use /api/summarize-report for multilingual support.
    """
    session_id = str(uuid.uuid4())
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "No file uploaded."}), 400
        file = request.files['file']
        filename = file.filename or "unknown"
        file_bytes = file.read()
        if not file_bytes:
            return jsonify({"status": "error", "message": "Empty file."}), 400

        extracted_text = _extract_text_from_upload(file_bytes, filename)

        language = request.form.get("language", "English")
        entities = extract_entities(extracted_text)
        affected_anatomy = detect_affected_anatomy(extracted_text, entities)
        simplified_summary = generate_summary(extracted_text, language=language, file_bytes=file_bytes, filename=filename)
        log_session(session_id, filename, "success", affected_anatomy)

        return jsonify({
            "status": "success",
            "session_id": session_id,
            "filename": filename,
            "extracted_text": extracted_text,
            "entities": entities,
            "simplified_summary": simplified_summary,
            "affected_anatomy": affected_anatomy,
            "language": language,
        })
    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "session_id": session_id, "message": str(e)}), 500


@app.route('/api/summarize-report', methods=['POST'])
def summarize_report():
    """
    Primary multilingual medical-document explanation endpoint.

    Accepts multipart/form-data:
      file     : PDF / image of the medical document  (required)
      language : One of the SUPPORTED_LANGUAGES        (optional, default English)

    Returns the structured LLaMA 3 summary in the requested language with
    sections: Report Summary / Key Points / Disclaimer.
    """
    session_id = str(uuid.uuid4())
    try:
        if 'file' not in request.files:
            return jsonify({"status": "error", "message": "No file uploaded."}), 400

        file = request.files['file']
        filename = file.filename or "unknown"
        file_bytes = file.read()
        if not file_bytes:
            return jsonify({"status": "error", "message": "Empty file."}), 400

        language = request.form.get("language", "English")
        if language not in SUPPORTED_LANGUAGES:
            language = "English"

        # ── Step 1: OCR / PDF extraction ─────────────────────────────────
        extracted_text = _extract_text_from_upload(file_bytes, filename)

        # ── Step 2: Clean OCR text ──
        import re as _re
        cleaned_text = _re.sub(r'[ \t]{2,}', ' ', extracted_text) if extracted_text else ""
        cleaned_text = _re.sub(r'\n{3,}', '\n\n', cleaned_text).strip() if cleaned_text else ""

        # ── Step 3: NER entities + anatomy mapping ────────────────────────
        entities = extract_entities(cleaned_text)
        affected_anatomy = detect_affected_anatomy(cleaned_text, entities)

        # ── Step 4: LLaMA 3 multilingual structured summary ───────────────
        summary = generate_summary(cleaned_text, language=language, file_bytes=file_bytes, filename=filename)

        # ── Step 5: Parse the structured output into sections ─────────────
        sections = _parse_summary_sections(summary)
        
        # ── Step 6: Post-process anatomy detection ────────────────────────
        # We now look for 'SYSTEM_ORGANS:' in the AI output for highest accuracy
        ai_organs = []
        if "SYSTEM_ORGANS:" in summary:
            try:
                line = summary.split("SYSTEM_ORGANS:")[-1].split("\n")[0].strip()
                # Clean brackets/quotes if present
                line = line.replace("[", "").replace("]", "").replace("'", "").replace('"', "")
                raw_organs = [o.strip() for o in line.split(",") if o.strip()]
                # Normalize against ANATOMY_MAP to ensure canonical names
                for ro in raw_organs:
                    low_ro = ro.lower()
                    matched = False
                    for kw, canonical in ANATOMY_MAP.items():
                        if kw in low_ro or low_ro in kw:
                            ai_organs.append(canonical)
                            matched = True
                            break
                    if not matched and len(ro) > 2:
                        ai_organs.append(ro.capitalize())
            except Exception as e:
                logger.error(f"Error parsing SYSTEM_ORGANS: {e}")

        if ai_organs:
            logger.info(f"AI specifically identified organs: {ai_organs}")
            # Add these to existing list and remove duplicates
            affected_anatomy = sorted(list(set(affected_anatomy + ai_organs)))
        elif not affected_anatomy and summary:
            logger.info("Local OCR empty. Detecting organs from AI summary text.")
            # Fallback to keyword matching if the structured tag is missing
            affected_anatomy = detect_affected_anatomy(summary.lower(), entities)

        log_session(session_id, filename, "success", affected_anatomy)

        return jsonify({
            "status": "success",
            "session_id": session_id,
            "filename": filename,
            "language": language,
            "extracted_text": extracted_text or "(AI Vision Analysis)",
            "cleaned_text": (cleaned_text[:1000] if cleaned_text else ""),
            "entities": entities,
            "affected_anatomy": affected_anatomy,
            "simplified_summary": summary,      # full raw LLM output
            "sections": sections,               # parsed sections for UI
            "supported_languages": SUPPORTED_LANGUAGES,
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"status": "error", "session_id": session_id, "message": str(e)}), 500


@app.route('/api/chat', methods=['POST'])
def health_chat():
    """
    Interactive health assistant.
    Takes symptoms or questions and provides advice based on the context of the medical report.
    """
    try:
        data = request.get_json(force=True) or {}
        message = data.get("message", "")
        context = data.get("report_summary", "")
        language = data.get("language", "English")

        if not message:
            return jsonify({"status": "error", "message": "No message provided."}), 400

        system_prompt = (
            f"You are a helpful and supportive medical assistant. "
            f"The user has a medical report summary: {context}. "
            f"The user says: {message}. "
            f"Respond in {language}. Be empathetic, clear, and always remind them to consult a real doctor. "
            f"Ask clarifying questions about their symptoms if appropriate."
        )

        # Priority: OpenAI > Gemini > Ollama
        openai_key = os.environ.get("OPENAI_API_KEY")
        if openai_key:
            client = OpenAI(api_key=openai_key)
            resp = client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": system_prompt}],
                max_tokens=500
            )
            return jsonify({"status": "success", "response": resp.choices[0].message.content.strip()})
        
        google_key = os.environ.get("GOOGLE_API_KEY")
        if google_key:
            model = genai.GenerativeModel('gemini-1.5-flash')
            resp = model.generate_content(system_prompt)
            return jsonify({"status": "success", "response": resp.text.strip()})

        return jsonify({"status": "success", "response": "AI processing is currently limited. Please consult a professional."})

    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


def _parse_summary_sections(raw: str) -> dict:
    """
    Parse LLaMA 3 output into structured sections.
    Looks for the section headers defined in the prompt:
      Report Summary: / Key Points: / Disclaimer:
    Returns a dict with keys: report_summary, key_points (list), disclaimer.
    Gracefully handles cases where the model doesn't follow the format exactly.
    """
    import re as _re

    sections: dict = {"report_summary": "", "key_points": [], "disclaimer": ""}

    # Normalise separators / dashes
    text = _re.sub(r'-{5,}', '', raw)

    # Extract Report Summary
    m = _re.search(
        r'(?:Report\s+Summary\s*:)(.+?)(?=Key\s+Points\s*:|Disclaimer\s*:|$)',
        text, _re.IGNORECASE | _re.DOTALL
    )
    if m:
        sections["report_summary"] = m.group(1).strip()

    # Extract Key Points (lines starting with - or •)
    m2 = _re.search(
        r'(?:Key\s+Points\s*:)(.+?)(?=Disclaimer\s*:|$)',
        text, _re.IGNORECASE | _re.DOTALL
    )
    if m2:
        bullet_block = m2.group(1).strip()
        bullets = _re.findall(r'[-•*]\s*(.+)', bullet_block)
        sections["key_points"] = [b.strip() for b in bullets if b.strip()]

    # Extract Disclaimer
    m3 = _re.search(
        r'(?:Disclaimer\s*:)(.+?)$',
        text, _re.IGNORECASE | _re.DOTALL
    )
    if m3:
        sections["disclaimer"] = m3.group(1).strip()

    # Fallback: if parsing failed, put full text in report_summary
    if not sections["report_summary"] and not sections["key_points"]:
        sections["report_summary"] = raw.strip()
        sections["disclaimer"] = "This summary is for understanding purposes only and not a medical diagnosis."

    return sections


@app.route('/api/export-report', methods=['POST'])
def export_report():
    try:
        data = request.get_json(force=True) or {}
        filename = data.get("filename", "report")
        summary = data.get("simplified_summary", data.get("summary", "No summary."))
        affected = data.get("affected_anatomy", [])
        entities = data.get("entities", {})
        timestamp = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

        lines = [
            "=" * 60,
            "          MedLex / Connect Care — Report Summary",
            "=" * 60,
            f"File       : {filename}",
            f"Generated  : {timestamp}",
            "",
            "AFFECTED ANATOMY",
            "-" * 40,
            ", ".join(affected) if affected else "None detected",
            "",
            "SIMPLIFIED SUMMARY",
            "-" * 40,
            summary,
            "",
        ]
        if entities:
            lines += ["DETECTED MEDICAL ENTITIES", "-" * 40]
            for label, terms in entities.items():
                lines.append(f"  [{label}]: {', '.join(terms[:10])}")
            lines.append("")
        lines += [
            "=" * 60,
            "Disclaimer: AI-generated. Consult a qualified medical professional.",
            "=" * 60,
        ]

        buf = io.BytesIO("\n".join(lines).encode("utf-8"))
        buf.seek(0)
        export_name = f"medlex_report_{datetime.datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.txt"
        return send_file(buf, mimetype="text/plain", as_attachment=True, download_name=export_name)
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/session-logs', methods=['GET'])
def session_logs():
    try:
        logs = _load_json(SESSION_LOG_FILE, [])
        return jsonify({"status": "ok", "logs": logs[-50:]})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# ── SYSTEM ROUTES ─────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────

@app.route('/api/health', methods=['GET'])
def health_check():
    from database import SUPABASE_ENABLED
    return jsonify({
        "status": "ok",
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "version": "2.0.0-connect-care",
        "services": {
            "ocr_tesseract":  TESSERACT_AVAILABLE,
            "nlp_spacy":      SPACY_AVAILABLE,
            "nlp_model":      NLP_MODEL,
            "ai_ollama":      OLLAMA_AVAILABLE,
            "pdf_support":    PDF_AVAILABLE,
            "vitals_engine":  True,
            "emergency_engine": True,
            "rbac":           True,
            "supabase":       SUPABASE_ENABLED,
            "iot":            True,
        }
    })




# ─────────────────────────────────────────────────────────────────────────────
# ── IoT / WEARABLE DEVICE ROUTES ──────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
try:
    from iot_engine import (
        register_device, authenticate_device, list_devices,
        deregister_device, update_device_heartbeat, ingest_iot_reading,
        DEVICE_TYPES,
    )
    IOT_AVAILABLE = True
except ImportError as _e:
    IOT_AVAILABLE = False
    logger.warning(f"iot_engine not available: {_e}")


@app.route('/api/iot/register', methods=['POST'])
@optional_auth
def iot_register():
    """
    Register a new IoT device for a patient.
    Body: { patient_id, device_type, device_name }
    Returns: device record with api_key (shown ONCE — save it!)
    """
    if not IOT_AVAILABLE:
        return jsonify({"status": "error", "message": "IoT engine not available"}), 503
    data = request.get_json(force=True) or {}
    patient_id  = data.get("patient_id", "")
    device_type = data.get("device_type", "smartwatch")
    device_name = data.get("device_name", "")
    if not patient_id:
        return jsonify({"status": "error", "message": "patient_id required"}), 400
    try:
        device = register_device(patient_id, device_type, device_name)
        return jsonify({"status": "ok", "device": device,
                        "warning": "Save the api_key now — it will not be shown again."})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/iot/devices/<patient_id>', methods=['GET'])
@optional_auth
def iot_list_devices(patient_id):
    """List all registered IoT devices for a patient (api_key hidden)."""
    if not IOT_AVAILABLE:
        return jsonify({"status": "error", "message": "IoT engine not available"}), 503
    try:
        devices = list_devices(patient_id)
        # Hide API keys
        for d in devices:
            d.pop("api_key", None)
        return jsonify({"status": "ok", "devices": devices,
                        "device_types": DEVICE_TYPES})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/iot/deregister/<device_id>', methods=['DELETE'])
@optional_auth
def iot_deregister(device_id):
    """Deactivate an IoT device."""
    if not IOT_AVAILABLE:
        return jsonify({"status": "error", "message": "IoT engine not available"}), 503
    try:
        deregister_device(device_id)
        return jsonify({"status": "ok", "message": f"Device {device_id} deactivated"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/iot/data', methods=['POST'])
def iot_ingest():
    """
    Primary endpoint for IoT device data ingestion.
    Authenticated via X-Device-Key header (the api_key from registration).
    Body: {
        heart_rate?, systolic_bp?, diastolic_bp?, spo2?,
        temperature_f?, respiratory_rate?,
        latitude?, longitude?,
        battery_pct?,
        firmware?
    }
    This endpoint stores data directly to Supabase, which pushes it to
    the caretaker dashboard via Supabase Realtime (zero polling needed).
    """
    if not IOT_AVAILABLE:
        return jsonify({"status": "error", "message": "IoT engine not available"}), 503

    api_key = (
        request.headers.get("X-Device-Key") or
        request.headers.get("Authorization", "").removeprefix("Bearer ").strip()
    )
    if not api_key:
        return jsonify({"status": "error", "message": "Missing X-Device-Key header"}), 401

    device = authenticate_device(api_key)
    if not device:
        return jsonify({"status": "error", "message": "Invalid or inactive device key"}), 403

    data = request.get_json(force=True) or {}

    # Update heartbeat
    update_device_heartbeat(
        api_key,
        battery_pct=data.get("battery_pct"),
        firmware=data.get("firmware"),
    )

    # Validate — at least one metric must be present
    metric_fields = [
        "heart_rate", "systolic_bp", "diastolic_bp", "spo2", "temperature_f", 
        "respiratory_rate", "step_count", "sleep_hours", "calories_burned", "distance_m"
    ]
    if not any(data.get(f) is not None for f in metric_fields):
        return jsonify({"status": "error", "message": "No metric values provided"}), 400

    try:
        result = ingest_iot_reading(device, data)
        return jsonify(result)
    except Exception as e:
        logger.error(f"IoT ingest error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route('/api/iot/ping', methods=['POST'])
def iot_ping():
    """
    Lightweight heartbeat — device alive check, no vitals.
    Body: { battery_pct?, firmware? }
    Header: X-Device-Key
    """
    api_key = request.headers.get("X-Device-Key", "")
    if not api_key:
        return jsonify({"status": "error", "message": "Missing X-Device-Key"}), 401
    device = authenticate_device(api_key)
    if not device:
        return jsonify({"status": "error", "message": "Invalid key"}), 403
    data = request.get_json(force=True) or {}
    update_device_heartbeat(api_key, battery_pct=data.get("battery_pct"), firmware=data.get("firmware"))
    return jsonify({"status": "ok", "server_time": datetime.datetime.utcnow().isoformat() + "Z"})


# ─────────────────────────────────────────────────────────────────────────────
# ── FRONTEND STATIC SERVING (must be last so /api/* routes take priority) ────
# Flask serves the built Vite/React app from project-root/dist/.
# Build once with:  npm run build   (from the project root folder)
# Then just open:   http://localhost:5000
# ─────────────────────────────────────────────────────────────────────────────
import mimetypes as _mt
_mt.add_type('application/javascript', '.js')
_mt.add_type('text/css', '.css')

_DIST = os.path.join(os.path.dirname(_DIR), 'dist')   # project-root/dist/

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    """Serve React SPA. All non-API paths fall through to index.html."""
    # Safety: never handle paths that look like API routes
    if path.startswith('api/'):
        return jsonify({"status": "error", "message": "Not found"}), 404

    if not os.path.isdir(_DIST):
        return (
            "<h2 style='font-family:sans-serif;padding:2rem'>Frontend not built.</h2>"
            "<p>Run <code>npm run build</code> in the project root, then refresh.</p>",
            200
        )

    # Resolve file safely (prevent directory traversal)
    candidate = os.path.realpath(os.path.join(_DIST, path)) if path else None
    if candidate and candidate.startswith(os.path.realpath(_DIST)) and os.path.isfile(candidate):
        return send_file(candidate)

    # Fallback: return index.html for all React Router paths
    return send_file(os.path.join(_DIST, 'index.html'))


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    from run_server import main
    main()
