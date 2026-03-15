/**
 * Connect Care — Shared TypeScript Types
 * Used across frontend hooks, API service, and components.
 */

// ─── Roles ────────────────────────────────────────────────────────────────────

export type UserRole = 'PATIENT' | 'CARETAKER' | 'ADMIN';

export interface AuthUser {
    user_id: string;
    role: UserRole;
    name: string;
    token: string;
    permissions: string[];
}

// ─── Vitals ───────────────────────────────────────────────────────────────────

export interface VitalsReading {
    heart_rate?: number;
    systolic_bp?: number;
    diastolic_bp?: number;
    spo2?: number;
    temperature_f?: number;
    respiratory_rate?: number;
    // Native Health Framework extras
    step_count?: number;
    sleep_hours?: number;
    calories_burned?: number;
    distance_m?: number;
    source_device_model?: string;
    is_validated?: boolean;
}

export type SeverityLevel = 'normal' | 'warning' | 'critical';
export type TrendDirection = 'rising' | 'falling' | 'stable' | 'insufficient_data';

export interface ThresholdResult {
    metric: string;
    value: number;
    unit: string;
    severity: SeverityLevel;
    message: string;
    auto_emergency: boolean;
}

export interface OutlierResult {
    is_outlier: boolean;
    z_score: number;
    deviation_pct: number;
    message: string;
}

export interface TrendResult {
    metric: string;
    direction: TrendDirection;
    slope_per_reading: number;
    change_pct_over_window: number;
    message: string;
}

export interface RiskFlag {
    flag_id: string;
    severity: SeverityLevel;
    title: string;
    detail: string;
    recommendation: string;
}

export interface VitalsSubmitResponse {
    status: string;
    patient_id: string;
    timestamp: string;
    current_vitals: VitalsReading;
    threshold_results: ThresholdResult[];
    outlier_results: Record<string, OutlierResult>;
    trends: TrendResult[];
    risk_flags: RiskFlag[];
    auto_emergency_triggered: boolean;
    emergency_event?: EmergencyEvent;
}

export interface VitalsHistorySummary {
    latest: number;
    min: number;
    max: number;
    avg: number;
    trend: TrendResult;
}

// ─── Emergency ────────────────────────────────────────────────────────────────

export type EmergencyStatus =
    | 'PENDING_CONFIRMATION'
    | 'ESCALATED'
    | 'RESOLVED'
    | 'CANCELLED'
    | 'CARETAKER_OVERRIDE'
    | 'active'     // backend short name
    | string;      // allow any backend string

export type TriggerSource =
    | 'MANUAL_SOS'
    | 'FALL_DETECTION'
    | 'VITALS_CRITICAL'
    | 'INACTIVITY'
    | 'CARETAKER_ALERT'
    | 'high_heart_rate'  // backend short name
    | string;            // allow any backend string

export interface EmergencyEvent {
    event_id: string;
    idempotency_key: string;
    patient_id: string;
    patient_name?: string;
    trigger_source: TriggerSource;
    status: EmergencyStatus;
    triggered_at: string;
    confirmation_deadline: string;
    vitals_snapshot: VitalsReading;
    location?: { lat: number; lon: number; accuracy_m?: number };
    caretaker_phone?: string;
    medical_context?: string;
    actions_taken: Array<{
        action: string;
        timestamp: string;
        success: boolean;
        [key: string]: unknown;
    }>;
    resolved_at?: string;
    resolved_by?: string;
}

// ─── Caretaker ────────────────────────────────────────────────────────────────

export interface PatientSummary {
    patient_id: string;
    patient_name?: string;
    latest_vitals: VitalsReading;
    has_emergency: boolean;
    active_emergency?: EmergencyEvent;
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export type AnalyticsPeriod = 'daily' | 'weekly' | 'monthly';

export interface MetricAnalytics {
    period: AnalyticsPeriod;
    reading_count: number;
    min: number;
    max: number;
    avg: number;
    latest: number;
    trend: TrendResult;
    threshold_status?: ThresholdResult;
}

export interface AnalyticsSummaryResponse {
    status: string;
    patient_id: string;
    period: AnalyticsPeriod;
    analytics: Record<string, MetricAnalytics>;
}
