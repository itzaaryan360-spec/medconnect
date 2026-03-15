/**
 * Connect Care — API service additions
 * Extends src/lib/api.ts with Connect Care endpoints.
 */

// ── Base URL ─────────────────────────────────────────────────────────────────
const BASE = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';

// ── Types from shared lib ────────────────────────────────────────────────────
import type {
    AuthUser, VitalsReading, PatientSummary,
    AnalyticsSummaryResponse, AnalyticsPeriod,
    EmergencyEvent,
} from '@/lib/types';

// ─────────────────────────────────────────────────────────────────────────────
// Auth
// ─────────────────────────────────────────────────────────────────────────────

export async function apiLogin(
    email: string, password?: string
): Promise<AuthUser> {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? 'Login failed');
    return data as AuthUser;
}

export async function apiRegister(payload: {
    name: string; email: string; password?: string;
    role: 'PATIENT' | 'CARETAKER';
    age?: number; phone?: string; emergency_contact?: string;
    relationship?: string;
}): Promise<AuthUser> {
    const res = await fetch(`${BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message ?? 'Registration failed');
    return data as AuthUser;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vitals
// ─────────────────────────────────────────────────────────────────────────────

export async function apiSubmitVitals(
    reading: VitalsReading & { patient_id: string; timestamp?: string }
) {
    const res = await fetch(`${BASE}/api/vitals/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reading),
    });
    return res.json();
}

export async function apiGetVitalsHistory(patientId: string) {
    const res = await fetch(`${BASE}/api/vitals/history/${encodeURIComponent(patientId)}`);
    return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

export async function apiGetAnalytics(
    patientId: string, period: AnalyticsPeriod = 'weekly'
): Promise<AnalyticsSummaryResponse> {
    const res = await fetch(`${BASE}/api/analytics/summary/${encodeURIComponent(patientId)}?period=${period}`);
    return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Emergency
// ─────────────────────────────────────────────────────────────────────────────

export async function apiTriggerEmergency(payload: {
    patient_id: string; trigger_source: string;
    vitals_snapshot?: VitalsReading; location?: { lat: number; lon: number };
    caretaker_phone?: string; patient_name?: string; idempotency_key?: string;
}): Promise<{ status: string; event: EmergencyEvent }> {
    const res = await fetch(`${BASE}/api/emergency/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return res.json();
}

export async function apiEscalateEmergency(patientId: string, location?: { lat: number; lon: number }) {
    const res = await fetch(`${BASE}/api/emergency/escalate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, location }),
    });
    return res.json();
}

export async function apiCancelEmergency(patientId: string) {
    const res = await fetch(`${BASE}/api/emergency/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, cancelled_by: 'PATIENT' }),
    });
    return res.json();
}

export async function apiResolveEmergency(patientId: string, resolvedBy = 'CARETAKER') {
    const res = await fetch(`${BASE}/api/emergency/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, resolved_by: resolvedBy }),
    });
    return res.json();
}

export async function apiCaretakerOverride(patientId: string, caretakerId: string) {
    const res = await fetch(`${BASE}/api/emergency/override`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patient_id: patientId, caretaker_id: caretakerId }),
    });
    return res.json();
}

export async function apiSendWhatsAppLocation(phone: string, location: { lat: number; lon: number }) {
    const res = await fetch(`${BASE}/api/emergency/whatsapp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, location }),
    });
    return res.json();
}

export async function apiGetEmergencyStatus(patientId: string) {
    const res = await fetch(`${BASE}/api/emergency/status/${encodeURIComponent(patientId)}`);
    return res.json();
}

export async function apiGetEmergencyAudit() {
    const res = await fetch(`${BASE}/api/emergency/audit`);
    return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Caretaker
// ─────────────────────────────────────────────────────────────────────────────

export async function apiGetCaretakerPatients(): Promise<{ status: string; patients: PatientSummary[] }> {
    const res = await fetch(`${BASE}/api/caretaker/patients`);
    return res.json();
}

export async function apiConnectPatient(patientId: string) {
    const auth = loadAuthFromStorage();
    const res = await fetch(`${BASE}/api/caretaker/connect`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${auth?.token}`
        },
        body: JSON.stringify({ patient_id: patientId }),
    });
    return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Local auth store helpers
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_KEY = 'connectcare_auth';

export function saveAuthToStorage(user: AuthUser) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(user));
}

export function loadAuthFromStorage(): AuthUser | null {
    try {
        const raw = localStorage.getItem(AUTH_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function clearAuthFromStorage() {
    localStorage.removeItem(AUTH_KEY);
}

// Re-export everything from original api.ts
export {
    processReport, checkHealth, downloadReport, fetchSessionLogs,
    saveReportToStorage, loadReportFromStorage,
} from '@/lib/api';

export type { ProcessReportResponse, HealthCheckResponse } from '@/lib/api';
