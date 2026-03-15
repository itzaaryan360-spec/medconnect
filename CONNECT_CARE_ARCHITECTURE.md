# Connect Care — System Architecture

> **Status:** Platform foundation complete. Backend + Frontend + Emergency Engine deployed.
> **Last updated:** 2026-02-23

---

## 1. Architecture Overview

```
┌───────────────────────────────────────────────────────────────────┐
│                     CONNECT CARE PLATFORM                         │
│          Fault-Tolerant Real-Time Healthcare Monitoring           │
│                      (Telangana, India)                           │
└───────────────────────────────────────────────────────────────────┘

          Patient App                  Caretaker App (Web)
         (React/Vite)                   (React/Vite)
               │                              │
               │  HTTPS + JWT                 │  HTTPS + JWT
               │                              │
         ┌─────▼──────────────────────────────▼──────┐
         │            API Gateway (Flask)             │
         │  RBAC enforced on every route via JWT      │
         │  Waitress WSGI  +  keep_alive watchdog     │
         └────┬──────────────┬──────────────┬─────────┘
              │              │              │
      ┌───────▼────┐  ┌──────▼──────┐  ┌───▼─────────────┐
      │  Vitals    │  │  Emergency  │  │  Analytics      │
      │  Engine    │  │  Engine     │  │  Engine         │
      │  (pure fn) │  │(state mach.)│  │(temporal aggr.) │
      └───────┬────┘  └──────┬──────┘  └───┬─────────────┘
              │              │              │
              └──────┬───────┘──────────────┘
                     │
              ┌──────▼───────┐
              │  File-backed │  (dev/MVP)
              │  Persistence │  → swap with PostgreSQL
              │  audit.jsonl │    + TimescaleDB (prod)
              └──────────────┘
```

---

## 2. RBAC Design

| Role       | Can read own vitals | Submit vitals | Read all patients | Override emergency | Modify other's data |
|------------|--------------------:|:-------------:|:-----------------:|:------------------:|:-------------------:|
| PATIENT    | ✅                 | ✅            | ❌                | ❌                | ❌                  |
| CARETAKER  | ✅ (read-only)     | ❌ (blocked)  | ✅                | ✅                | ❌                  |
| ADMIN      | ✅                 | ✅            | ✅                | ✅                | ✅                  |

**Decision:** CARETAKER cannot submit vitals — prevents false data injection on patient records (audit-critical).

**Implementation:** `backend/rbac.py` — uses HS256 JWT. If `PyJWT` is unavailable, falls back to base64 tokens (dev-only).

---

## 3. Vitals Intelligence Engine (`backend/vitals_engine.py`)

### Data flow

```
Raw reading  →  Threshold check  →  Outlier detection  →  Trend analysis  →  Risk flags
```

### Clinical thresholds (WHO / Indian medical guidelines)

| Metric            | Warning Low | Warning High | Critical Low | Critical High |
|-------------------|:-----------:|:------------:|:------------:|:-------------:|
| Heart Rate (bpm)  | 50          | 100          | 40           | 130           |
| Systolic BP (mmHg)| 90          | 140          | 70           | 180           |
| SpO₂ (%)          | 94          | —            | 90           | —             |
| Temperature (°F)  | 96.8        | 99.5         | 95           | 103           |

### Algorithms

- **Threshold breach:** O(1) lookup against per-metric band table.
- **Outlier detection:** Modified Z-score against rolling 20-window history. Z > 3.5 → outlier.
- **Trend analysis:** Linear regression (numpy polyfit) on last 10 readings → slope → direction classification.
- **Risk flags:** Composite flags from multi-metric correlation (e.g., high BP + elevated HR → hypertensive urgency flag).

---

## 4. Emergency Orchestration Engine (`backend/emergency_engine.py`)

### State Machine

```
PENDING_CONFIRMATION ──(no response within T)──► ESCALATED
        │                                            │
        │ (patient cancels)                    (108 dialled,
        ▼                                       GPS shared,
   CANCELLED                                    SMS sent)
                                                     │
                  CARETAKER_OVERRIDE ◄───────────────┤
                                                     │
                                              RESOLVED
```

### Idempotency

Every trigger carries an `idempotency_key` (SHA256 of `patient_id + trigger_source + 5-minute bucket`).
Duplicate triggers within 5 minutes are silently deduplicated — prevents double-dispatch from flaky wearables.

### Failure handling

| Failure | Mitigation |
|---------|-----------|
| Network down | Actions queued in `pending_actions[]`, retried on reconnect |
| Location denied | Falls back to last-known location or "location unavailable" in 108 dispatch |
| Call failure | Retry 3× with exponential backoff; fallback to SMS |
| Backend crash | `keep_alive.py` restarts within 2s; `active_emergencies/<pid>.json` survives restart |
| Duplicate trigger | Idempotency key prevents double-dispatch |

---

## 5. API Routes

| Method | Endpoint | Role Required | Description |
|--------|----------|:-------------:|-------------|
| POST | `/api/auth/login` | None | Issue JWT for role |
| GET  | `/api/auth/verify` | Any | Verify + refresh token |
| POST | `/api/vitals/submit` | PATIENT | Submit vitals reading |
| GET  | `/api/vitals/history/<pid>` | PATIENT/CARETAKER | Vitals + trend summary |
| GET  | `/api/analytics/summary/<pid>` | Any | Temporal analytics |
| POST | `/api/emergency/trigger` | Any | Trigger emergency |
| POST | `/api/emergency/escalate` | Any | Skip confirmation → 108 |
| POST | `/api/emergency/cancel` | PATIENT | Patient self-cancel |
| POST | `/api/emergency/resolve` | CARETAKER | Mark resolved |
| POST | `/api/emergency/override` | CARETAKER | Manual caretaker takeover |
| GET  | `/api/emergency/status/<pid>` | Any | Current emergency state |
| GET  | `/api/emergency/audit` | CARETAKER | Full audit log |
| GET  | `/api/caretaker/patients` | CARETAKER | All linked patients |

---

## 6. Frontend Pages

| Route | Component | Role |
|-------|-----------|------|
| `/auth` | `Auth.tsx` | All — issues JWT, routes by role |
| `/dashboard` | `Dashboard.tsx` | PATIENT — vitals + backend status |
| `/caretaker` | `Caretaker.tsx` | CARETAKER — all patients, emergencies, analytics, audit |
| `/3d-view` | `ThreeDView.tsx` | All — R3F anatomical viewer |
| `/emergency` | `Emergency.tsx` | PATIENT — SOS state machine |
| `/reports` | `Reports.tsx` | PATIENT — upload + AI analysis |

---

## 7. Key Hooks

### `useVitals(patientId)`

```ts
const { currentVitals, thresholds, trends, riskFlags, submitVitals, refresh } = useVitals('patient_001');
```

- Polls `/api/vitals/history/<pid>` every 30s.
- `submitVitals()` → POST → returns full threshold/trend/risk analysis.
- De-duplicated toast alerts for `warning` and `critical` flags.
- Auto-emergency toast when backend auto-escalates.

---

## 8. Production Deployment

```
start.bat / start.ps1
  ├── keep_alive.py  →  run_server.py  →  Waitress (multi-thread)
  └── npm run dev    →  Vite (hot-reload)
```

**Watchdog (`keep_alive.py`):** Restarts backend within 2s of crash.  
Exponential backoff on repeated failures (1s → 2s → 4s → 8s max).

---

## 9. Trade-offs & Decisions

| Decision | Alternative | Why chosen |
|----------|-------------|------------|
| File-backed persistence | PostgreSQL + TimescaleDB | MVP speed; file state survives restarts without DB setup |
| Simulated SMS/108 stubs | Twilio / Exotel | Requires telecom credentials; stubs log the exact payload |
| JWT (HS256) | OAuth2 / Supabase Auth | Zero-dependency for demo; swap for Supabase in prod |
| R3F anatomy (primitives) | GLTF model from CDN | CDN CORS unreliable; primitives load instantly, fully interactive |
| Per-metric threshold table | ML anomaly model | Deterministic + auditable; ML adds latency and training data needs |

---

## 10. What's Left for Production

- [ ] Replace file persistence with PostgreSQL (vitals) + TimescaleDB (time-series)
- [ ] Integrate Exotel/Twilio for real SMS + outbound call to 108
- [ ] Native Android/iOS app (React Native + Expo) for background execution + HealthKit
- [ ] WebSocket stream for real-time vitals (replace 30s poll)
- [ ] DPDP Act (India) compliance audit
- [ ] Integration tests for emergency state machine
- [ ] RBAC token refresh + revocation
