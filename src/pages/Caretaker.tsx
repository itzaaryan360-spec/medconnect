/**
 * Caretaker Dashboard — Standalone page for monitoring all patients in real-time.
 * Includes:
 *  - Live IoT vitals stream per patient (Supabase Realtime or simulated)
 *  - GPS patient location tracking
 *  - Emergency banners & resolution controls
 *  - Weekly analytics per patient
 *  - Device registry (register/remove wearables)
 *  - Offline demo mode when backend is unreachable
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Users, Activity, AlertTriangle, CheckCircle2, Clock,
    RefreshCw, PhoneCall, MapPin, Heart, Thermometer,
    Droplets, Wind, TrendingUp, TrendingDown, Minus,
    Shield, Bell, Eye, EyeOff, BarChart3, Watch, Wifi,
    WifiOff, Battery, BatteryLow, Zap, Plus, Trash2,
    XCircle, ArrowLeft, Bluetooth, BluetoothOff, Loader2
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import {
    apiGetCaretakerPatients, apiGetAnalytics,
    apiCaretakerOverride, apiResolveEmergency, loadAuthFromStorage,
    apiConnectPatient
} from '@/lib/connectCareApi';
import { supabase, SUPABASE_ENABLED } from '@/lib/supabase';
import type { PatientSummary, AnalyticsPeriod, TrendDirection } from '@/lib/types';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

// ─────────────────────────────────────────────────────────────────────────────
// Constants / meta
// ─────────────────────────────────────────────────────────────────────────────
const METRICS: Record<string, {
    label: string; unit: string; color: string;
    icon: React.ReactNode; normal: [number, number]; warn: [number, number];
}> = {
    heart_rate: { label: 'Heart Rate', unit: 'bpm', color: '#ef4444', normal: [60, 100], warn: [50, 120], icon: <Heart className="h-3 w-3" /> },
    systolic_bp: { label: 'Systolic', unit: 'mmHg', color: '#3b82f6', normal: [90, 120], warn: [80, 140], icon: <Activity className="h-3 w-3" /> },
    diastolic_bp: { label: 'Diastolic', unit: 'mmHg', color: '#60a5fa', normal: [60, 80], warn: [50, 90], icon: <Activity className="h-3 w-3" /> },
    spo2: { label: 'SpO₂', unit: '%', color: '#06b6d4', normal: [95, 100], warn: [90, 100], icon: <Droplets className="h-3 w-3" /> },
    temperature_f: { label: 'Temp', unit: '°F', color: '#f97316', normal: [97, 99], warn: [96, 100.4], icon: <Thermometer className="h-3 w-3" /> },
    respiratory_rate: { label: 'Resp Rate', unit: '/min', color: '#8b5cf6', normal: [12, 20], warn: [10, 25], icon: <Wind className="h-3 w-3" /> },
};

const DEMO_PATIENTS: PatientSummary[] = [
    {
        patient_id: 'demo_patient_001',
        has_emergency: false,
        latest_vitals: { heart_rate: 74, systolic_bp: 118, diastolic_bp: 76, spo2: 98.2, temperature_f: 98.4, respiratory_rate: 15 },
    },
    {
        patient_id: 'demo_patient_002',
        has_emergency: true,
        active_emergency: {
            event_id: 'em_001', idempotency_key: 'demo-key-001', patient_id: 'demo_patient_002',
            trigger_source: 'high_heart_rate', status: 'active',
            triggered_at: new Date(Date.now() - 4 * 60_000).toISOString(),
            confirmation_deadline: new Date(Date.now() + 2 * 60_000).toISOString(),
            vitals_snapshot: { heart_rate: 145, spo2: 91 },
            actions_taken: [],
        },

        latest_vitals: { heart_rate: 145, systolic_bp: 158, diastolic_bp: 98, spo2: 91, temperature_f: 101.2, respiratory_rate: 24 },
    },
];

// Demo audit log entries — shown when backend has no real events yet
const DEMO_AUDIT_LOGS = [
    { event_type: 'EMERGENCY_TRIGGER', patient_id: 'demo_patient_002', actor: 'system', logged_at: new Date(Date.now() - 4 * 60_000).toISOString(), notes: 'Heart rate 145 bpm exceeded threshold' },
    { event_type: 'ESCALATION', patient_id: 'demo_patient_002', actor: 'system', logged_at: new Date(Date.now() - 3 * 60_000).toISOString(), notes: 'Auto-escalated after 60s' },
    { event_type: 'CARETAKER_OVERRIDE', patient_id: 'demo_patient_002', actor: 'caretaker', logged_at: new Date(Date.now() - 2 * 60_000).toISOString(), notes: 'Caretaker acknowledged situation' },
    { event_type: 'EMERGENCY_TRIGGER', patient_id: 'demo_patient_001', actor: 'system', logged_at: new Date(Date.now() - 25 * 60_000).toISOString(), notes: 'SpO₂ dropped to 88%' },
    { event_type: 'EMERGENCY_RESOLVE', patient_id: 'demo_patient_001', actor: 'caretaker', logged_at: new Date(Date.now() - 22 * 60_000).toISOString(), notes: 'Patient stabilised, oxygen administered' },
    { event_type: 'EMERGENCY_TRIGGER', patient_id: 'demo_patient_001', actor: 'system', logged_at: new Date(Date.now() - 3 * 60 * 60_000).toISOString(), notes: 'Temperature 101.8°F detected' },
    { event_type: 'EMERGENCY_RESOLVE', patient_id: 'demo_patient_001', actor: 'caretaker', logged_at: new Date(Date.now() - 2.5 * 60 * 60_000).toISOString(), notes: 'Fever subsided after medication' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function vitalColor(metric: string, value?: number): string {
    if (value === undefined) return 'text-slate-500';
    const m = METRICS[metric];
    if (!m) return 'text-slate-300';
    if (value < m.warn[0] || value > m.warn[1]) return 'text-red-400';
    if (value < m.normal[0] || value > m.normal[1]) return 'text-amber-400';
    return 'text-emerald-400';
}

function TrendIcon({ d }: { d: TrendDirection }) {
    if (d === 'rising') return <TrendingUp className="h-3 w-3 text-red-400" />;
    if (d === 'falling') return <TrendingDown className="h-3 w-3 text-blue-400" />;
    return <Minus className="h-3 w-3 text-emerald-400" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// IoT Realtime Strip (embedded in each patient card)
// ─────────────────────────────────────────────────────────────────────────────
interface LiveVitals {
    heart_rate?: number; systolic_bp?: number; diastolic_bp?: number;
    spo2?: number; temperature_f?: number; respiratory_rate?: number;
    latitude?: number; longitude?: number; battery_pct?: number;
    device_id?: string; source?: string; recorded_at?: string;
}

function IoTStrip({ patientId }: { patientId: string }) {
    const [live, setLive] = useState<LiveVitals | null>(null);
    const [connected, setConnected] = useState(false);
    const [bleSource, setBleSource] = useState(false);  // true = real BLE data from WatchBridge
    const [ago, setAgo] = useState(0);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
    const lastUpdateRef = useRef<number>(Date.now());

    // Elapsed timer
    useEffect(() => {
        const t = setInterval(() => setAgo(Math.round((Date.now() - lastUpdateRef.current) / 1000)), 1000);
        return () => clearInterval(t);
    }, []);

    useEffect(() => {
        const bump = (v: LiveVitals, fromBle = false) => {
            setLive(v); lastUpdateRef.current = Date.now(); setAgo(0);
            if (fromBle) { setConnected(true); setBleSource(true); }
        };

        // ── BroadcastChannel: live data from WatchBridge page (same browser) ──
        // This fires instantly when the patient opens /bridge and streams,
        // even without Supabase or backend running.
        let bc: BroadcastChannel | null = null;
        try {
            bc = new BroadcastChannel(`medconnect_vitals_${patientId}`);
            bc.onmessage = (evt: MessageEvent<LiveVitals>) => bump(evt.data, true);
        } catch { /* BroadcastChannel not available */ }

        if (!supabase || !SUPABASE_ENABLED) {
            // REMOVED auto-simulation fallback to prevent showing fake data
            setConnected(false);
            return;
        }

        // Supabase: load latest then subscribe to new inserts
        supabase.from('vitals').select('*')
            .eq('patient_id', patientId)
            .order('recorded_at', { ascending: false })
            .limit(1)
            .then(({ data }) => {
                if (data?.[0]) {
                    const latest = data[0] as LiveVitals;
                    const diff = Math.abs(Date.now() - new Date(latest.recorded_at!).getTime());
                    if (diff < 86400000) bump(latest);
                }
            });

        const ch = supabase
            .channel(`ct-live-${patientId}-${Math.random()}`)
            .on('postgres_changes', {
                event: 'INSERT', schema: 'public', table: 'vitals',
                filter: `patient_id=eq.${patientId}`,
            }, payload => bump(payload.new as LiveVitals))
            .subscribe(s => setConnected(s === 'SUBSCRIBED'));

        channelRef.current = ch;
        return () => {
            bc?.close();
            if (channelRef.current && supabase) supabase.removeChannel(channelRef.current);
        };
    }, [patientId]);

    return (
        <div className={`mt-3 rounded-xl border p-3 transition-all ${bleSource ? 'border-violet-500/40 bg-violet-950/20' : 'border-teal-500/25 bg-slate-900/60'
            }`}>
            {/* Header row */}
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 text-xs font-semibold">
                    <Watch className={`h-3.5 w-3.5 ${bleSource ? 'text-violet-400' : 'text-teal-400'}`} />
                    <span className={bleSource ? 'text-violet-400' : 'text-teal-400'}>
                        {bleSource ? '⌚ BLE Live' : 'IoT Live Stream'}
                    </span>
                    <span className={`w-1.5 h-1.5 rounded-full animate-pulse ${bleSource ? 'bg-violet-400' :
                        (SUPABASE_ENABLED && connected) ? 'bg-teal-400' : 'bg-amber-400'
                        }`} />
                    {bleSource && <span className="text-[10px] text-violet-400/70 font-normal">Watch Bridge</span>}
                    {!SUPABASE_ENABLED && !bleSource && <span className="text-amber-400 font-normal text-[10px]">(simulated)</span>}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500">
                    {ago > 0 && <span>{ago}s ago</span>}
                    {live?.battery_pct !== undefined && (
                        <span className={`flex items-center gap-0.5 ${live.battery_pct < 20 ? 'text-red-400' : 'text-slate-400'}`}>
                            {live.battery_pct < 20 ? <BatteryLow className="h-3 w-3" /> : <Battery className="h-3 w-3" />}
                            {live.battery_pct}%
                        </span>
                    )}
                </div>
            </div>

            {/* Vitals grid */}
            {live && ago < 120 ? (
                <div className="grid grid-cols-3 gap-2">
                    {Object.keys(METRICS).map(m => {
                        const val = (live as Record<string, number | undefined>)[m];
                        return (
                            <div key={m} className="text-center py-1 rounded-lg bg-slate-800/60">
                                <div className={`text-sm font-bold font-mono leading-tight ${vitalColor(m, val)}`}>
                                    {val !== undefined ? val.toFixed(1) : '—'}
                                </div>
                                <div className="text-[9px] text-slate-500 leading-tight">{METRICS[m].unit}</div>
                                <div className="text-[9px] text-slate-600 leading-tight truncate px-1">{METRICS[m].label}</div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <div className="flex items-center justify-center gap-2 text-[10px] text-slate-500 py-6 bg-slate-900/40 rounded-lg border border-dashed border-slate-700">
                    <div className="flex flex-col items-center gap-1">
                        <BluetoothOff className="h-4 w-4 opacity-50" />
                        <span>No live device connected</span>
                    </div>
                </div>
            )}

            {/* GPS Row */}
            {live?.latitude && live?.longitude && (
                <a
                    href={`https://maps.google.com/?q=${live.latitude},${live.longitude}`}
                    target="_blank" rel="noopener noreferrer"
                    className="mt-2 flex items-center gap-1.5 text-[10px] text-teal-400 hover:text-teal-300 transition-colors"
                >
                    <MapPin className="h-3 w-3" />
                    GPS: {live.latitude.toFixed(4)}°N, {live.longitude.toFixed(4)}°E — Open Maps ↗
                </a>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Emergency Banner
// ─────────────────────────────────────────────────────────────────────────────
function EmergencyBanner({ patient, onOverride, onResolve }: {
    patient: PatientSummary; onOverride: () => void; onResolve: () => void;
}) {
    const em = patient.active_emergency!;
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const start = new Date(em.triggered_at).getTime();
        const t = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
        return () => clearInterval(t);
    }, [em.triggered_at]);

    return (
        <div className="rounded-xl border-2 border-red-500/70 bg-red-950/40 p-4 shadow-xl shadow-red-950/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500 shrink-0 animate-pulse">
                        <AlertTriangle className="h-5 w-5 text-white" />
                    </div>
                    <div>
                        <p className="font-bold text-red-400 text-sm tracking-wide">
                            🚨 ACTIVE EMERGENCY — {patient.patient_id.replace(/_/g, ' ').toUpperCase()}
                        </p>
                        <p className="text-xs text-red-400/70 mt-0.5">
                            Trigger: <strong>{em.trigger_source.replace(/_/g, ' ')}</strong> ·
                            Active for: <strong>{Math.floor(elapsed / 60)}m {elapsed % 60}s</strong> ·
                            Status: <strong>{em.status}</strong>
                        </p>
                    </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <Button size="sm" variant="outline" className="border-red-500/50 text-red-400 hover:bg-red-950 text-xs" onClick={onOverride}>
                        <Shield className="h-3 w-3 mr-1" /> Override
                    </Button>
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs" onClick={onResolve}>
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Resolve
                    </Button>
                    <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 hover:bg-slate-800 text-xs" onClick={() => window.open('tel:108')}>
                        <PhoneCall className="h-3 w-3 mr-1" /> 108
                    </Button>
                </div>
            </div>
            {em.vitals_snapshot && Object.keys(em.vitals_snapshot).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 border-t border-red-500/20 pt-3">
                    {Object.entries(em.vitals_snapshot).map(([k, v]) => {
                        const m = METRICS[k];
                        return m ? (
                            <span key={k} className="text-xs bg-red-900/50 border border-red-700/40 rounded-full px-2 py-0.5 text-red-300 font-medium">
                                {m.label}: {String(v)} {m.unit}
                            </span>
                        ) : null;
                    })}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Patient Card
// ─────────────────────────────────────────────────────────────────────────────
function PatientCard({ patient, analytics, onOverride, onResolve }: {
    patient: PatientSummary;
    analytics: Record<string, unknown> | null;
    onOverride: (pid: string) => void;
    onResolve: (pid: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const displayName = patient.patient_id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    return (
        <div className={`rounded-2xl border bg-slate-800/70 backdrop-blur-sm transition-all duration-300 ${patient.has_emergency
            ? 'border-red-500/60 shadow-lg shadow-red-950/40'
            : 'border-slate-700/60 hover:border-teal-500/40'
            }`}>
            {/* Card header */}
            <div className="p-4 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-xl font-bold text-sm text-white ${patient.has_emergency ? 'bg-red-500 animate-pulse' : 'bg-teal-600'
                        }`}>
                        {displayName.slice(0, 2)}
                    </div>
                    <div>
                        <div className="font-bold text-white text-sm">{displayName}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{patient.patient_id}</div>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {patient.has_emergency
                        ? <Badge className="bg-red-500/20 text-red-400 border-red-500/40 text-[10px] animate-pulse">🚨 Emergency</Badge>
                        : <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px]">✓ Stable</Badge>
                    }
                    <button onClick={() => setExpanded(e => !e)}
                        className="text-slate-500 hover:text-teal-400 transition-colors p-1 rounded">
                        {expanded ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
            </div>

            {/* Vitals snapshot */}
            <div className="px-4 pb-2">
                <div className="grid grid-cols-3 gap-1.5">
                    {Object.entries(patient.latest_vitals).slice(0, 6).map(([metric, value]) => {
                        const m = METRICS[metric];
                        const val = Number(value);
                        if (!m) return null;
                        const analyticsRow = (analytics as Record<string, {
                            trend: { direction: TrendDirection }; threshold_status?: { severity: string };
                        }> | null)?.[metric];
                        return (
                            <div key={metric} className={`rounded-lg border px-2 py-1.5 ${analyticsRow?.threshold_status?.severity === 'critical' ? 'border-red-500/30 bg-red-950/30' :
                                analyticsRow?.threshold_status?.severity === 'warning' ? 'border-amber-500/30 bg-amber-950/20' :
                                    'border-slate-700/60 bg-slate-900/40'
                                }`}>
                                <div className="flex items-center justify-between mb-0.5">
                                    <span style={{ color: m.color }}>{m.icon}</span>
                                    {analyticsRow && <TrendIcon d={analyticsRow.trend.direction} />}
                                </div>
                                <p className={`text-sm font-bold font-mono leading-none ${vitalColor(metric, val)}`}>{val.toFixed(1)}</p>
                                <p className="text-[9px] text-slate-500 leading-tight">{m.unit}</p>
                                <p className="text-[9px] text-slate-600 leading-tight truncate">{m.label}</p>
                            </div>
                        );
                    })}
                </div>

                {/* IoT Live Strip */}
                <IoTStrip patientId={patient.patient_id} />

                {/* Emergency actions */}
                {patient.has_emergency && (
                    <div className="flex gap-2 mt-3">
                        <Button size="sm" variant="outline" className="flex-1 text-xs border-red-500/40 text-red-400 hover:bg-red-950"
                            onClick={() => onOverride(patient.patient_id)}>
                            <Shield className="h-3 w-3 mr-1" /> Override
                        </Button>
                        <Button size="sm" className="flex-1 text-xs bg-emerald-600 hover:bg-emerald-700"
                            onClick={() => onResolve(patient.patient_id)}>
                            <CheckCircle2 className="h-3 w-3 mr-1" /> Resolve
                        </Button>
                    </div>
                )}

                {/* Expanded analytics */}
                {expanded && analytics && (
                    <div className="mt-3 pt-3 border-t border-slate-700/60 space-y-2">
                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">Weekly Analytics</p>
                        {Object.entries(analytics as Record<string, {
                            avg: number; min: number; max: number;
                            trend: { direction: TrendDirection; change_pct_over_window: number };
                            threshold_status?: { severity: string; message: string };
                        }>).map(([metric, stats]) => {
                            const m = METRICS[metric];
                            if (!m) return null;
                            return (
                                <div key={metric} className="rounded-lg border border-slate-700/60 bg-slate-900/50 p-2">
                                    <div className="flex items-center justify-between mb-0.5">
                                        <span className="text-[11px] font-medium text-slate-300">{m.label}</span>
                                        <div className="flex items-center gap-1">
                                            <TrendIcon d={stats.trend.direction} />
                                            <span className={`text-[10px] ${stats.trend.change_pct_over_window > 0 ? 'text-red-400' : 'text-blue-400'}`}>
                                                {stats.trend.change_pct_over_window > 0 ? '+' : ''}{stats.trend.change_pct_over_window.toFixed(1)}%
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                                        <span>Avg: <strong className="text-slate-200">{stats.avg}</strong></span>
                                        <span>Min: {stats.min}</span>
                                        <span>Max: {stats.max}</span>
                                        <span className="text-slate-600">{m.unit}</span>
                                    </div>
                                    {stats.threshold_status?.severity !== 'normal' && (
                                        <p className="text-[10px] text-amber-400 mt-0.5">{stats.threshold_status?.message}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Device Registration Panel
// ─────────────────────────────────────────────────────────────────────────────
interface IoTDevice { id: string; device_name: string; device_type: string; is_active: boolean; battery_pct?: number; last_seen?: string; }

function DevicePanel({ patientId }: { patientId: string }) {
    const [devices, setDevices] = useState<IoTDevice[]>([]);
    const [devType, setDevType] = useState('smartwatch');
    const [devName, setDevName] = useState('');
    const [apiResult, setApiResult] = useState<{ api_key?: string; device_id?: string } | null>(null);
    const [busy, setBusy] = useState(false);

    const loadDevices = useCallback(async () => {
        try {
            const r = await fetch(`${BACKEND}/api/iot/devices/${patientId}`);
            const d = await r.json();
            if (d.status === 'ok') setDevices(d.devices || []);
        } catch { /* backend offline */ }
    }, [patientId]);

    useEffect(() => { void loadDevices(); }, [loadDevices]);

    const registerDevice = async () => {
        if (devices.filter(d => d.is_active).length >= 3) {
            setApiResult({ api_key: 'Error: Maximum of 3 active devices allowed per patient.' });
            return;
        }
        setBusy(true);
        try {
            const r = await fetch(`${BACKEND}/api/iot/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ patient_id: patientId, device_type: devType, device_name: devName }),
            });
            const d = await r.json();
            if (d.status === 'ok') {
                setApiResult({ api_key: d.device.api_key, device_id: d.device.id });
                loadDevices();
            } else {
                setApiResult({ api_key: d.message || 'Registration failed' });
            }
        } catch {
            setApiResult({ api_key: 'Backend offline — start Flask server first.' });
        }
        setBusy(false);
    };

    const removeDevice = async (id: string) => {
        await fetch(`${BACKEND}/api/iot/deregister/${id}`, { method: 'DELETE' });
        void loadDevices();
    };

    return (
        <div className="space-y-3">
            {/* Existing devices */}
            {devices.map(d => (
                <div key={d.id} className="flex items-center justify-between p-3 bg-slate-800/60 rounded-xl border border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className={`w-2 h-2 rounded-full ${d.is_active ? 'bg-teal-400 animate-pulse' : 'bg-slate-500'}`} />
                        <div>
                            <div className="text-sm font-medium text-white">{d.device_name}</div>
                            <div className="text-[10px] text-slate-400">{d.device_type} · {d.id.slice(-8)}</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {d.battery_pct !== undefined && (
                            <span className={`text-[10px] flex items-center gap-0.5 ${d.battery_pct < 20 ? 'text-red-400' : 'text-slate-400'}`}>
                                <Battery className="h-3 w-3" /> {d.battery_pct}%
                            </span>
                        )}
                        <button onClick={() => removeDevice(d.id)} className="text-slate-500 hover:text-red-400 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                </div>
            ))}
            {devices.length === 0 && (
                <p className="text-xs text-slate-500 bg-slate-800/40 rounded-xl p-3 border border-slate-700">
                    No devices registered. Add one below.
                </p>
            )}

            {/* Register new */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
                <select value={devType} onChange={e => setDevType(e.target.value)}
                    className="col-span-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-500">
                    <option value="smartwatch">⌚ Smart Watch</option>
                    <option value="bp_monitor">💊 BP Monitor</option>
                    <option value="oximeter">🩸 Pulse Oximeter</option>
                    <option value="custom">🔧 Custom Device</option>
                </select>
                <input value={devName} onChange={e => setDevName(e.target.value)} placeholder="Device name (optional)"
                    className="col-span-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-teal-500" />
                <Button onClick={registerDevice} disabled={busy || devices.filter(d => d.is_active).length >= 3} size="sm"
                    className={`col-span-1 ${devices.filter(d => d.is_active).length >= 3 ? 'bg-slate-700' : 'bg-teal-500 hover:bg-teal-600'} text-white text-xs`}>
                    {busy ? <RefreshCw className="h-3 w-3 animate-spin mr-1" /> : <Plus className="h-3 w-3 mr-1" />}
                    {devices.filter(d => d.is_active).length >= 3 ? "Limit Reached" : "Register"}
                </Button>
            </div>

            {apiResult && (
                <div className={`rounded-xl p-3 border text-xs space-y-1 ${apiResult.api_key.includes('Error') ? 'bg-red-950/30 border-red-500/30' : 'bg-slate-900 border-teal-500/30'}`}>
                    <div className={`font-semibold ${apiResult.api_key.includes('Error') ? 'text-red-400' : 'text-teal-400'}`}>
                        {apiResult.api_key.includes('Error') ? '✗ Failed!' : '✓ Registered! Save this API key:'}
                    </div>
                    <div className={`font-mono break-all ${apiResult.api_key.includes('Error') ? 'text-red-300' : 'text-teal-300'}`}>{apiResult.api_key}</div>
                    {!apiResult.api_key.includes('Error') && <div className="text-amber-400">⚠ Not shown again. Use it in your device or simulator.</div>}
                    {apiResult.device_id && (
                        <div className="text-slate-500 font-mono mt-2 bg-slate-800 rounded p-2">
                            python backend/device_simulator.py --patient {patientId} --api-key {apiResult.api_key} --scenario normal
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Caretaker Dashboard
// ─────────────────────────────────────────────────────────────────────────────
const Caretaker = () => {
    const { toast } = useToast();
    const auth = loadAuthFromStorage();

    const [patients, setPatients] = useState<PatientSummary[]>([]);
    const [analytics, setAnalytics] = useState<Record<string, Record<string, unknown>>>({});
    const [period, setPeriod] = useState<AnalyticsPeriod>('weekly');
    const [loading, setLoading] = useState(false);
    const [isDemo, setIsDemo] = useState(false);
    const [lastRefresh, setLastRefresh] = useState(new Date());
    const [auditLogs, setAuditLogs] = useState<unknown[]>([]);
    const [showAudit, setShowAudit] = useState(false);
    const [showDevices, setShowDevices] = useState(false);
    const [selPatient, setSelPatient] = useState('');
    const [connectId, setConnectId] = useState('');
    const [connecting, setConnecting] = useState(false);

    // ── Fetch patients ─────────────────────────────────────────────────────────
    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const { patients: list } = await apiGetCaretakerPatients();
            setPatients(list);
            setIsDemo(false);
            const aMap: Record<string, Record<string, unknown>> = {};
            await Promise.all(list.map(async p => {
                try {
                    const res = await apiGetAnalytics(p.patient_id, period);
                    if (res.status === 'ok') aMap[p.patient_id] = res.analytics;
                } catch { /* offline */ }
            }));
            setAnalytics(aMap);
            setLastRefresh(new Date());
        } catch {
            setPatients(DEMO_PATIENTS);
            setIsDemo(true);
            setLastRefresh(new Date());
        } finally {
            setLoading(false);
        }
    }, [period]);

    // ── Emergency Listener (High Urgency) ────────────────────────────────────
    useEffect(() => {
        const bc = new BroadcastChannel("medconnect_emergency");
        bc.onmessage = (ev) => {
            if (ev.data === "CRASH_DETECTED") {
                toast({
                    title: "🚨 HIGH IMPACT CRASH DETECTED",
                    description: "A patient wearable has detected a severe crash. Emergency SOS triggered.",
                    variant: "destructive",
                });
                refresh();
            }
        };
        return () => bc.close();
    }, [refresh, toast]);

    const handleConnect = async () => {
        if (!connectId) return;
        setConnecting(true);
        try {
            const res = await apiConnectPatient(connectId);
            if (res.status === 'ok') {
                toast({ title: "Patient Linked!", description: `Connected to ${connectId}` });
                setConnectId('');
                void refresh();
            } else {
                toast({ title: "Failed", description: res.message, variant: "destructive" });
            }
        } catch (err: any) {
            toast({ title: "Error", description: err.message, variant: "destructive" });
        } finally {
            setConnecting(false);
        }
    };

    const fetchAudit = useCallback(async () => {
        try {
            const r = await fetch(`${BACKEND}/api/emergency/audit`, { signal: AbortSignal.timeout(4000) });
            const d = await r.json();
            if (d.status === 'ok') {
                if (d.logs.length === 0) setAuditLogs(DEMO_AUDIT_LOGS);
                else setAuditLogs(d.logs);
            }
        } catch {
            // Backend offline — show demo audit logs so the feature is visible
            setAuditLogs(DEMO_AUDIT_LOGS);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);
    useEffect(() => { const t = setInterval(refresh, 30_000); return () => clearInterval(t); }, [refresh]);

    // ── Emergency actions ──────────────────────────────────────────────────────
    const handleOverride = async (pid: string) => {
        try {
            await apiCaretakerOverride(pid, auth?.user_id ?? 'caretaker');
            toast({ title: 'Override Active', description: 'You have taken control of this emergency.' });
            void refresh();
        } catch {
            toast({
                title: isDemo ? 'Demo Mode' : 'Override failed', variant: isDemo ? 'default' : 'destructive',
                description: isDemo ? 'Start the Flask backend to perform real actions.' : undefined
            });
        }
    };

    const handleResolve = async (pid: string) => {
        try {
            await apiResolveEmergency(pid, auth?.user_id ?? 'CARETAKER');
            toast({ title: 'Emergency Resolved', description: `Patient ${pid} emergency cleared.` });
            void refresh();
        } catch {
            setPatients(ps => ps.map(p => p.patient_id === pid ? { ...p, has_emergency: false, active_emergency: undefined } : p));
            toast({ title: 'Resolved (Demo)', description: 'Start backend for persistent changes.' });
        }
    };

    const emergencyCount = patients.filter(p => p.has_emergency).length;
    const stableCount = patients.length - emergencyCount;

    return (
        <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #0a0f1e 0%, #0f172a 50%, #0a1628 100%)' }}>
            {/* ── Sticky header bar ────────────────────────────────────────────────── */}
            <div className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-900/95 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
                    {/* Left: logo + title */}
                    <div className="flex items-center gap-3">
                        <Link to="/" className="flex items-center gap-1.5 text-slate-400 hover:text-white transition-colors text-xs">
                            <ArrowLeft className="h-3.5 w-3.5" />
                            <span className="font-bold text-teal-400">MedConnect</span>
                        </Link>
                        <span className="text-slate-700">|</span>
                        <div className="flex items-center gap-2">
                            <Shield className="h-5 w-5 text-teal-400" />
                            <span className="font-bold text-white text-base">Caretaker Dashboard</span>
                            {auth?.name && <span className="text-xs text-slate-400 hidden sm:inline">· {auth.name}</span>}
                        </div>
                    </div>

                    {/* Center: status badges */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {isDemo && (
                            <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-[10px]">⚠ Demo — Backend offline</Badge>
                        )}
                        {SUPABASE_ENABLED ? (
                            <Badge className="bg-teal-500/15 text-teal-400 border-teal-500/30 flex gap-1 text-[10px]">
                                <Wifi className="h-2.5 w-2.5" /> Supabase Realtime Live
                            </Badge>
                        ) : (
                            <Badge className="bg-slate-700/50 text-slate-400 border-slate-600 flex gap-1 text-[10px]">
                                <WifiOff className="h-2.5 w-2.5" /> Simulated Mode
                            </Badge>
                        )}
                        {(['daily', 'weekly', 'monthly'] as AnalyticsPeriod[]).map(p => (
                            <button key={p} onClick={() => setPeriod(p)}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border transition-all ${period === p ? 'bg-teal-600 text-white border-teal-600' : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-teal-500'
                                    }`}>
                                {p.charAt(0).toUpperCase() + p.slice(1)}
                            </button>
                        ))}
                    </div>

                    {/* Right: actions */}
                    <div className="flex items-center gap-2">
                        <div className="flex bg-slate-900 border border-slate-700 rounded-lg p-1 overflow-hidden">
                            <input
                                type="text"
                                placeholder="Patient ID (MC-XXXX)"
                                className="bg-transparent border-none text-[10px] px-2 py-1 focus:outline-none text-white w-32 md:w-40"
                                value={connectId}
                                onChange={e => setConnectId(e.target.value)}
                            />
                            <button
                                onClick={handleConnect}
                                disabled={connecting}
                                className="h-6 text-[10px] font-bold px-2 rounded bg-teal-600/20 text-teal-400 hover:bg-teal-600/30 transition-all disabled:opacity-50"
                            >
                                {connecting ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : "Link"}
                            </button>
                        </div>

                        <button onClick={() => { void refresh(); }} disabled={loading}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 border border-slate-700 hover:border-teal-500 hover:text-teal-400 transition-all disabled:opacity-50">
                            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
                        </button>
                        <button onClick={() => { setShowAudit(s => !s); void fetchAudit(); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 border border-slate-700 hover:border-teal-500 hover:text-teal-400 transition-all">
                            <BarChart3 className="h-3 w-3" /> Audit
                        </button>
                        <Link to="/bridge"
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-violet-600/20 text-violet-400 border border-violet-500/40 hover:bg-violet-600/30 transition-all">
                            <Bluetooth className="h-3 w-3" /> Connect Watch
                        </Link>
                        <button onClick={() => { setShowDevices(s => !s); setSelPatient(patients[0]?.patient_id ?? ''); }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600/20 text-teal-400 border border-teal-500/40 hover:bg-teal-600/30 transition-all">
                            <Watch className="h-3 w-3" /> Devices
                        </button>
                    </div>
                </div>
            </div>

            <main className="max-w-7xl mx-auto px-4 py-8">

                {/* ── KPI Row ──────────────────────────────────────────────────────── */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                    {[
                        { label: 'Total Patients', value: patients.length, sub: `${stableCount} stable`, icon: <Users className="h-5 w-5 text-teal-400" />, border: 'border-teal-500/20' },
                        {
                            label: 'Active Emergencies', value: emergencyCount, sub: emergencyCount > 0 ? '⚠ Action required' : 'All clear',
                            icon: <AlertTriangle className="h-5 w-5 text-red-400" />, border: `border-red-500/20 ${emergencyCount > 0 ? 'bg-red-950/20' : ''}`
                        },
                        {
                            label: 'IoT Devices', value: SUPABASE_ENABLED ? '●' : '○', sub: SUPABASE_ENABLED ? 'Realtime active' : 'Simulated',
                            icon: <Watch className="h-5 w-5 text-violet-400" />, border: 'border-violet-500/20'
                        },
                        {
                            label: 'Last Refreshed', value: lastRefresh.toLocaleTimeString().slice(0, -3), sub: `Auto every 30s`,
                            icon: <Clock className="h-5 w-5 text-slate-400" />, border: 'border-slate-700'
                        },
                    ].map(({ label, value, sub, icon, border }) => (
                        <div key={label} className={`rounded-xl border bg-slate-800/50 p-4 ${border}`}>
                            <div className="flex items-center gap-2 mb-2">{icon}
                                <span className="text-xs text-slate-400">{label}</span>
                            </div>
                            <div className={`text-2xl font-bold font-mono ${label === 'Active Emergencies' && emergencyCount > 0 ? 'text-red-400 animate-pulse' : 'text-white'}`}>
                                {value}
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>
                        </div>
                    ))}
                </div>

                {/* ── Emergency Banners ─────────────────────────────────────────────── */}
                {emergencyCount > 0 && (
                    <div className="mb-8 space-y-3">
                        <h2 className="text-xs font-bold text-red-400 uppercase tracking-widest flex items-center gap-2">
                            <Bell className="h-3.5 w-3.5" /> Active Emergencies
                        </h2>
                        {patients.filter(p => p.has_emergency && p.active_emergency).map(p => (
                            <EmergencyBanner key={p.patient_id} patient={p}
                                onOverride={() => handleOverride(p.patient_id)}
                                onResolve={() => handleResolve(p.patient_id)}
                            />
                        ))}
                    </div>
                )}

                {/* ── Patient Grid ──────────────────────────────────────────────────── */}
                <div>
                    <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2 mb-4">
                        <Activity className="h-3.5 w-3.5 text-teal-400" />
                        Patient Monitoring + IoT Live Feed
                        <Badge className="bg-slate-700/60 text-slate-400 border-slate-600 text-[9px] ml-1">{period}</Badge>
                    </h2>

                    {loading && patients.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-32 gap-3">
                            <RefreshCw className="h-8 w-8 text-teal-400 animate-spin" />
                            <p className="text-slate-400 text-sm">Loading patient data…</p>
                        </div>
                    ) : patients.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-32 gap-4">
                            <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center">
                                <Users className="h-8 w-8 text-slate-600" />
                            </div>
                            <p className="text-lg font-bold text-slate-400">No patients linked</p>
                            <p className="text-sm text-slate-500 text-center max-w-xs">
                                Once patients submit vitals or IoT devices send data, they'll appear here automatically.
                            </p>
                        </div>
                    ) : (
                        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                            {patients.map(p => (
                                <PatientCard
                                    key={p.patient_id} patient={p}
                                    analytics={analytics[p.patient_id] ?? null}
                                    onOverride={handleOverride}
                                    onResolve={handleResolve}
                                />
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Device Management Panel ───────────────────────────────────────── */}
                {showDevices && (
                    <div className="mt-10 rounded-2xl border border-teal-500/25 bg-slate-800/50 p-6">
                        <div className="flex items-center justify-between mb-5">
                            <div>
                                <h2 className="text-sm font-bold text-white flex items-center gap-2">
                                    <Watch className="h-4 w-4 text-teal-400" /> IoT Device Management
                                </h2>
                                <p className="text-xs text-slate-400 mt-0.5">Register smartwatches, BP monitors, pulse oximeters</p>
                            </div>
                            <button onClick={() => setShowDevices(false)} className="text-slate-500 hover:text-white">
                                <XCircle className="h-4 w-4" />
                            </button>
                        </div>

                        {/* Patient selector */}
                        <div className="mb-4">
                            <label className="text-[10px] text-slate-400 block mb-1">Select Patient</label>
                            <select value={selPatient} onChange={e => setSelPatient(e.target.value)}
                                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500">
                                {patients.map(p => <option key={p.patient_id} value={p.patient_id}>{p.patient_id}</option>)}
                            </select>
                        </div>

                        {selPatient && <DevicePanel patientId={selPatient} />}
                    </div>
                )}

                {/* ── Audit Log ─────────────────────────────────────────────────────── */}
                {showAudit && (
                    <div className="mt-8 rounded-2xl border border-slate-700/60 bg-slate-800/50 p-5">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                                <BarChart3 className="h-3.5 w-3.5 text-teal-400" /> Emergency Audit Log
                                <span className="text-slate-600 normal-case font-normal">
                                    {auditLogs.length} event{auditLogs.length !== 1 ? 's' : ''}
                                    {isDemo && <span className="text-amber-500"> · demo data</span>}
                                </span>
                            </h2>
                            <button onClick={() => setShowAudit(false)} className="text-slate-500 hover:text-white">
                                <XCircle className="h-4 w-4" />
                            </button>
                        </div>
                        {auditLogs.length === 0 ? (
                            <p className="text-sm text-slate-500 text-center py-6">No emergency events recorded yet.</p>
                        ) : (
                            <div className="divide-y divide-slate-700/50 max-h-80 overflow-y-auto rounded-xl border border-slate-700 bg-slate-900/50">
                                {[...auditLogs].reverse().map((log, i) => {
                                    const e = log as Record<string, string>;
                                    const isSystem = !e.actor || e.actor === 'system';
                                    const isTrigger = e.event_type?.includes('TRIGGER');
                                    const isResolve = e.event_type?.includes('RESOLVE');
                                    const isEscalate = e.event_type?.includes('ESCALAT');
                                    const isOverride = e.event_type?.includes('OVERRIDE');
                                    return (
                                        <div key={i} className="px-4 py-3 hover:bg-slate-800/50">
                                            <div className="flex items-center justify-between gap-2 flex-wrap">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isTrigger ? 'bg-red-500/20 text-red-400' :
                                                        isResolve ? 'bg-emerald-500/20 text-emerald-400' :
                                                            isEscalate ? 'bg-orange-500/20 text-orange-400' :
                                                                isOverride ? 'bg-violet-500/20 text-violet-400' :
                                                                    'bg-slate-600/40 text-slate-400'
                                                        }`}>{e.event_type?.replace(/_/g, ' ')}</span>
                                                    <span className="text-xs text-slate-400">
                                                        Patient: <strong className="text-white">{e.patient_id}</strong>
                                                    </span>
                                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${isSystem ? 'bg-slate-700 text-slate-400' : 'bg-teal-900/40 text-teal-400'
                                                        }`}>
                                                        {isSystem ? '🤖 system' : `👤 ${e.actor}`}
                                                    </span>
                                                </div>
                                                <span className="text-[10px] text-slate-500 flex items-center gap-1 shrink-0">
                                                    <Clock className="h-3 w-3" />{new Date(e.logged_at ?? '').toLocaleString()}
                                                </span>
                                            </div>
                                            {e.notes && (
                                                <p className="text-[11px] text-slate-500 mt-1 pl-1">{e.notes}</p>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

            </main>
        </div>
    );
};

export default Caretaker;
