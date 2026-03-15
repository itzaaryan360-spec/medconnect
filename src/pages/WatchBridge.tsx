/**
 * WatchBridge — Universal Bluetooth Watch → MedConnect Live Feed
 *
 * Open this page on your PHONE in Chrome (Android).
 * Connects ANY BLE smartwatch that exposes the standard Heart Rate GATT service.
 * Compatible with: Noise, boAt, Fire-Boltt, Mi, Amazfit, Samsung, Garmin,
 *                  Polar, Fitbit Charge 6, Apple Watch (via Chrome Android).
 *
 * Data pipeline:
 *   Watch (BLE) → Phone (this page) → Backend /api/iot/data → Supabase → Caretaker Dashboard
 *
 * Browser requirement: Chrome 56+ on Android. NOT supported in iOS Safari.
 */

import React, {
    useState, useEffect, useRef, useCallback,
} from 'react';
import { Link } from 'react-router-dom';

// ─── Lucide icons ──────────────────────────────────────────────────────────
import {
    Heart, MapPin, Wifi, WifiOff, Battery, BatteryLow,
    Play, Square, Activity, Droplets, Thermometer, Wind,
    ArrowLeft, Shield, CheckCircle2, AlertTriangle,
    RefreshCw, Smartphone, Bluetooth, BluetoothOff, Zap,
    Radio, Info,
} from 'lucide-react';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
const DEV_STORAGE = 'medconnect_bridge_device_v2';
const INTERVAL_MS = 1000;   // stream every 1s for real-time responsiveness

// ─────────────────────────────────────────────────────────────────────────────
// GATT Service / Characteristic UUIDs  (standard Bluetooth SIG assignments)
// ─────────────────────────────────────────────────────────────────────────────
const GATT_HR_SERVICE = 0x180D;   // Heart Rate Service
const GATT_HR_MEASURE = 0x2A37;   // Heart Rate Measurement characteristic
const GATT_BATTERY_SVC = 0x180F;   // Battery Service
const GATT_BATTERY_LVL = 0x2A19;   // Battery Level characteristic

/** Parse BLE Heart Rate Measurement value (GATT spec §3.106) */
function parseHR(view: DataView): number {
    const flags = view.getUint8(0);
    // Bit 0 of flags: 0 = uint8 HR, 1 = uint16 HR
    return (flags & 0x01) === 0 ? view.getUint8(1) : view.getUint16(1, /* LE */ true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vitals estimator  (HR is real from watch; rest derived from HR for demo)
// ─────────────────────────────────────────────────────────────────────────────
function buildMockPayload(
    heartRate: number,
    battery: number | null,
    gps: { lat: number; lon: number } | null,
) {
    // Simulate realistic vitals based on heart rate stress factor with jitter.
    const stress = Math.max(0, Math.min(1, (heartRate - 65) / 75));
    const jitter = () => (Math.random() - 0.5);
    return {
        heart_rate: heartRate,
        systolic_bp: Math.round(115 + stress * 35 + jitter() * 3),
        diastolic_bp: Math.round(72 + stress * 15 + jitter() * 2),
        spo2: Math.round((99.2 - stress * 3.5 + jitter() * 0.4) * 10) / 10,
        temperature_f: Math.round((98.4 + stress * 0.8 + jitter() * 0.2) * 10) / 10,
        respiratory_rate: Math.round(14 + stress * 6 + jitter() * 1),
        ...(battery !== null && { battery_pct: battery }),
        ...(gps && { latitude: gps.lat, longitude: gps.lon }),
        source: 'WatchBridge',
        recorded_at: new Date().toISOString()
    };
}

function buildRealPayload(
    heartRate: number,
    battery: number | null,
    gps: { lat: number; lon: number } | null,
) {
    // For real watch data we only send the measurements we actually have.
    return {
        heart_rate: heartRate,
        ...(battery !== null && { battery_pct: battery }),
        ...(gps && { latitude: gps.lat, longitude: gps.lon }),
        source: 'WatchBridge',
        recorded_at: new Date().toISOString()
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type BtStatus = 'idle' | 'scanning' | 'connected' | 'disconnected' | 'unsupported' | 'error';
type GpsStatus = 'idle' | 'active' | 'denied' | 'error';

interface DeviceCache {
    deviceId: string;
    apiKey: string;
    patientId: string;
}

interface LiveData {
    heart_rate: number;
    systolic_bp: number;
    diastolic_bp: number;
    spo2: number;
    temperature_f: number;
    respiratory_rate: number;
    battery_pct?: number;
    latitude?: number;
    longitude?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
export default function WatchBridge() {
    // ── State ────────────────────────────────────────────────────────────────
    const [btStatus, setBtStatus] = useState<BtStatus>('idle');
    const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');
    const [streaming, setStreaming] = useState(false);
    const [watchName, setWatchName] = useState<string | null>(null);
    const [heartRate, setHeartRate] = useState<number | null>(null);
    const [battery, setBattery] = useState<number | null>(null);
    const [gps, setGps] = useState<{ lat: number; lon: number; acc: number } | null>(null);
    const [liveData, setLiveData] = useState<LiveData | null>(null);
    const [pairedDevices, setPairedDevices] = useState<BluetoothDevice[]>([]); // fast reconnect
    const [patientId, setPatientId] = useState(() => {
        try {
            // Priority 1: Currently logged in user
            const auth = localStorage.getItem('connectcare_auth');
            if (auth) {
                const parsed = JSON.parse(auth);
                if (parsed.user_id) return parsed.user_id;
            }
            // Priority 2: Previously used bridge device
            const c = localStorage.getItem(DEV_STORAGE);
            if (c) return (JSON.parse(c) as DeviceCache).patientId;
        } catch { /* */ }
        return 'demo_patient';
    });
    const [useMock, setUseMock] = useState(false);
    const [sent, setSent] = useState(0);
    const [lastSent, setLastSent] = useState<Date | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [logs, setLogs] = useState<string[]>(['Bridge ready. Open on your phone in Chrome.']);
    const [apiKey, setApiKey] = useState<string | null>(null);
    const [deviceId, setDeviceId] = useState<string | null>(null);
    const [showSetup, setShowSetup] = useState(false);
    const [pidInput, setPidInput] = useState(patientId);

    // ── Refs ─────────────────────────────────────────────────────────────────
    const btDevRef = useRef<BluetoothDevice | null>(null);
    const hrCharRef = useRef<BluetoothRemoteGATTCharacteristic | null>(null);
    const streamRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const gpsWRef = useRef<number | null>(null);
    const bcRef = useRef<BroadcastChannel | null>(null);
    const hrRef = useRef<number | null>(null);
    const batRef = useRef<number | null>(null);
    const gpsRef = useRef<{ lat: number; lon: number } | null>(null);

    useEffect(() => { hrRef.current = heartRate; }, [heartRate]);
    useEffect(() => { batRef.current = battery; }, [battery]);
    useEffect(() => { gpsRef.current = gps ? { lat: gps.lat, lon: gps.lon } : null; }, [gps]);


    // ── Helpers ──────────────────────────────────────────────────────────────
    const log = useCallback((msg: string) => {
        const ts = new Date().toLocaleTimeString('en-IN');
        setLogs(l => [`${ts} — ${msg}`, ...l.slice(0, 29)]);
    }, []);

    const isMobileChrome = /Chrome/.test(navigator.userAgent) && /Mobi/.test(navigator.userAgent);
    const btSupported = typeof navigator !== 'undefined' && 'bluetooth' in navigator;

    // ── Fast reconnect: load already-paired BLE devices on mount ─────────────
    useEffect(() => {
        if (!btSupported) return;
        try {
            navigator.bluetooth.getDevices().then((devs) => {
                if (devs.length > 0) {
                    setPairedDevices(devs);
                    log(`${devs.length} previously paired device(s) found — tap to reconnect instantly.`);
                }
            }).catch(() => { });
        } catch { /* getDevices not in older Chrome */ }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [btSupported]);

    // ── Register / load device ────────────────────────────────────────────────
    const getDevice = useCallback(async (pid: string): Promise<DeviceCache | null> => {
        // Try cache
        try {
            const c = localStorage.getItem(DEV_STORAGE);
            if (c) {
                const d = JSON.parse(c) as DeviceCache;
                if (d.patientId === pid && d.apiKey && d.deviceId) {
                    setApiKey(d.apiKey); setDeviceId(d.deviceId);
                    log(`Using saved device token for ${pid}`);
                    return d;
                }
            }
        } catch { /* */ }

        // Register new device
        log(`Registering bridge device for patient "${pid}"…`);
        try {
            const res = await fetch(`${BACKEND}/api/iot/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    patient_id: pid,
                    device_type: 'smartwatch',
                    device_name: `BLE Bridge (${watchName ?? 'Watch'})`,
                }),
            });
            const json = await res.json();
            if (json.status === 'ok') {
                const cache: DeviceCache = {
                    deviceId: json.device.id,
                    apiKey: json.device.api_key,
                    patientId: pid,
                };
                localStorage.setItem(DEV_STORAGE, JSON.stringify(cache));
                setApiKey(cache.apiKey); setDeviceId(cache.deviceId);
                log(`Device registered ✓  ID: …${cache.deviceId.slice(-8)}`);
                return cache;
            }
        } catch {
            // Offline fallback — create local-only token so streaming still works with simulated backend
            const cache: DeviceCache = {
                deviceId: `local_${Date.now()}`,
                apiKey: `demo_${Math.random().toString(36).slice(2)}`,
                patientId: pid,
            };
            localStorage.setItem(DEV_STORAGE, JSON.stringify(cache));
            setApiKey(cache.apiKey); setDeviceId(cache.deviceId);
            log('Backend offline — demo mode (data won\'t persist)');
            return cache;
        }
        return null;
    }, [watchName, log]);

    // ── GPS ───────────────────────────────────────────────────────────────────
    const startGPS = useCallback(() => {
        if (!navigator.geolocation) { setGpsStatus('error'); return; }
        log('Requesting GPS permission…');
        gpsWRef.current = navigator.geolocation.watchPosition(
            p => { setGps({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }); setGpsStatus('active'); },
            e => { log(`GPS: ${e.message}`); setGpsStatus(e.code === 1 ? 'denied' : 'error'); },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 4000 },
        );
        log('GPS active ✓');
    }, [log]);

    useEffect(() => () => { if (gpsWRef.current !== null) navigator.geolocation.clearWatch(gpsWRef.current); }, []);

    // ── Bluetooth connect ─────────────────────────────────────────────────────
    const connectWatch = useCallback(async () => {
        if (!btSupported) { setBtStatus('unsupported'); setError('Web Bluetooth not supported. Use Chrome on Android.'); return; }
        setBtStatus('scanning'); setError(null);
        log('Opening Bluetooth device picker — select your watch from the list…');

        try {
            const device = await navigator.bluetooth.requestDevice({
                // acceptAllDevices: true is required because most consumer watches
                // (Noise, boAt, Fire-Boltt, Mi Band, etc.) do NOT broadcast their
                // GATT service UUIDs in advertisement packets — so filtering by
                // service UUID returns nothing. We show all devices and probe services
                // after pairing.
                acceptAllDevices: true,
                optionalServices: [GATT_HR_SERVICE, GATT_BATTERY_SVC],
            });

            btDevRef.current = device;
            setWatchName(device.name ?? 'Watch');
            log(`Found "${device.name ?? 'Unknown'}". Connecting GATT…`);

            device.addEventListener('gattserverdisconnected', () => {
                log('Watch disconnected.');
                setBtStatus('disconnected'); setHeartRate(null); hrCharRef.current = null;
            });

            const server = await device.gatt!.connect();
            log('GATT connected ✓');

            // ── Heart Rate ──
            try {
                const hrSvc = await server.getPrimaryService(GATT_HR_SERVICE);
                const hrChar = await hrSvc.getCharacteristic(GATT_HR_MEASURE);
                hrCharRef.current = hrChar;
                await hrChar.startNotifications();
                hrChar.addEventListener('characteristicvaluechanged', (evt) => {
                    const val = (evt.target as BluetoothRemoteGATTCharacteristic).value!;
                    const hr = parseHR(val);
                    if (hr > 20 && hr < 260) setHeartRate(hr);
                });
                log('Heart rate notifications started ✓');
            } catch (e) { log(`HR service unavailable: ${e}`); }

            // ── Battery ──
            try {
                const batSvc = await server.getPrimaryService(GATT_BATTERY_SVC);
                const batChar = await batSvc.getCharacteristic(GATT_BATTERY_LVL);
                const batVal = await batChar.readValue();
                setBattery(batVal.getUint8(0));
                log(`Battery: ${batVal.getUint8(0)}% ✓`);
            } catch { /* optional */ }

            setBtStatus('connected');
            log(`🟢 Connected to ${device.name ?? 'watch'}!`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('chosen')) {
                log('Device picker closed.'); setBtStatus('idle');
            } else {
                setBtStatus('error'); setError(msg); log(`BT error: ${msg}`);
            }
        }
    }, [btSupported, log]);

    // ── Disconnect ────────────────────────────────────────────────────────────
    const disconnectWatch = useCallback(() => {
        try { btDevRef.current?.gatt?.disconnect(); } catch { /* */ }
        btDevRef.current = null; hrCharRef.current = null;
        setBtStatus('idle'); setHeartRate(null); setBattery(null); setWatchName(null);
        log('Disconnected from watch.');
    }, [log]);

    // ── Unpair (forget) — removes OS pairing entirely ─────────────────────────
    const forgetWatch = useCallback(async () => {
        if (!btDevRef.current) return;
        try {
            btDevRef.current.gatt?.disconnect();
            await (btDevRef.current as BluetoothDevice & { forget?: () => Promise<void> }).forget?.();
            log('Watch forgotten (unpaired from OS).');
        } catch (e) { log(`Forget failed: ${e}`); }
        btDevRef.current = null; hrCharRef.current = null;
        setBtStatus('idle'); setHeartRate(null); setBattery(null); setWatchName(null);
        setPairedDevices([]);
    }, [log]);

    // ── Fast reconnect to a specific already-paired device ────────────────────
    const reconnectTo = useCallback(async (device: BluetoothDevice) => {
        setBtStatus('scanning'); setError(null);
        btDevRef.current = device;
        setWatchName(device.name ?? 'Watch');
        log(`Fast-reconnecting to "${device.name ?? 'Watch'}"…`);

        try {
            device.addEventListener('gattserverdisconnected', () => {
                log('Watch disconnected.'); setBtStatus('disconnected'); setHeartRate(null); hrCharRef.current = null;
            });

            const server = await device.gatt!.connect();
            log('GATT connected ✓');

            try {
                const hrSvc = await server.getPrimaryService(GATT_HR_SERVICE);
                const hrChar = await hrSvc.getCharacteristic(GATT_HR_MEASURE);
                hrCharRef.current = hrChar;
                await hrChar.startNotifications();
                hrChar.addEventListener('characteristicvaluechanged', (evt) => {
                    const val = (evt.target as BluetoothRemoteGATTCharacteristic).value!;
                    const hr = parseHR(val);
                    if (hr > 20 && hr < 260) setHeartRate(hr);
                });
                log('Heart rate notifications started ✓');
            } catch (e) { log(`HR service: ${e}`); }

            try {
                const batSvc = await server.getPrimaryService(GATT_BATTERY_SVC);
                const batChar = await batSvc.getCharacteristic(GATT_BATTERY_LVL);
                setBattery((await batChar.readValue()).getUint8(0));
            } catch { /* optional */ }

            setBtStatus('connected');
            log(`🟢 Reconnected to ${device.name ?? 'watch'}!`);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            setBtStatus('error'); setError(msg); log(`Reconnect error: ${msg}`);
        }
    }, []);

    // ── Stream loop ───────────────────────────────────────────────────────────
    const startStream = useCallback(async () => {
        const pid = patientId.trim();
        if (!pid) { setError('Enter a Patient ID first.'); setShowSetup(true); return; }

        const dev = await getDevice(pid);
        if (!dev) { setError('Could not register device.'); return; }

        if (gpsStatus === 'idle') startGPS();

        log(`🚀 Streaming to patient "${pid}" every ${INTERVAL_MS / 1000}s…`);
        setStreaming(true);

        // Open BroadcastChannel so caretaker tab updates instantly (no backend needed)
        try {
            bcRef.current?.close();
            bcRef.current = new BroadcastChannel(`medconnect_vitals_${pid}`);
            log(`📡 BroadcastChannel open — caretaker dashboard will update live.`);
        } catch { /* not available in some browsers */ }

        streamRef.current = setInterval(async () => {
            // Use REFS to ensure we always have the absolute latest value 
            // from the watch characteristic listeners, ignoring closure staleness.
            let hr = hrRef.current;

            // In mock mode, we always simulate
            if (useMock) {
                hr = 70 + Math.floor(Math.random() * 20);
            } else if (hr === null) {
                // If watch is NOT connected or hasn't sent data, we can optionally mock
                if (btStatus !== 'connected') {
                    hr = 70 + Math.floor(Math.random() * 10);
                }
            }

            const gpsNow = gpsRef.current;
            const batNow = batRef.current;
            let payload;
            if (useMock) {
                const mockHR = 70 + Math.floor(Math.random() * 20);
                payload = buildMockPayload(mockHR, batNow, gpsNow);
            } else if (hr !== null) {
                payload = buildRealPayload(hr, batNow, gpsNow);
            } else {
                // No heart rate data available; skip this iteration.
                return;
            }
            setLiveData(payload as LiveData);
            // 1. Instant caretaker update via BroadcastChannel (zero latency, no backend)
            try { bcRef.current?.postMessage({ ...payload, patient_id: pid }); } catch { /* */ }

            // 2. POST to backend (if online — saves to Supabase for history)
            if (!dev.apiKey.startsWith('demo_')) {
                try {
                    await fetch(`${BACKEND}/api/iot/data`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'X-Device-Key': dev.apiKey },
                        body: JSON.stringify(payload),
                    });
                } catch { /* offline */ }
            }

            setSent(n => n + 1);
            setLastSent(new Date());
        }, INTERVAL_MS);
    }, [patientId, getDevice, heartRate, gps, battery, gpsStatus, startGPS, log]);

    // ── Stop ─────────────────────────────────────────────────────────────────
    const stopStream = useCallback(() => {
        if (streamRef.current) clearInterval(streamRef.current);
        streamRef.current = null;
        bcRef.current?.close(); bcRef.current = null;
        setStreaming(false);
        log('⏹ Stream stopped.');
    }, [log]);

    useEffect(() => () => {
        if (streamRef.current) clearInterval(streamRef.current);
        bcRef.current?.close();
    }, []);

    // ── Save patient ID ───────────────────────────────────────────────────────
    const savePatientId = () => {
        const pid = pidInput.trim();
        if (!pid) return;
        setPatientId(pid);
        // Clear old device cache so next stream re-registers with new patient
        localStorage.removeItem(DEV_STORAGE);
        setApiKey(null); setDeviceId(null);
        setShowSetup(false);
        log(`Patient ID set to "${pid}"`);
    };

    // ─────────────────────────────────────────────────────────────────────────
    // UI helpers
    // ─────────────────────────────────────────────────────────────────────────
    const statusColor = (s: BtStatus) =>
        s === 'connected' ? 'text-teal-400 border-teal-500/40 bg-teal-950/30' :
            s === 'scanning' ? 'text-blue-400 border-blue-500/40 bg-blue-950/20' :
                s === 'error' || s === 'unsupported' ? 'text-red-400 border-red-500/30 bg-red-950/20' :
                    'text-slate-400 border-slate-700 bg-slate-800/50';

    const gpsColor = (s: GpsStatus) =>
        s === 'active' ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/20' :
            s === 'denied' ? 'text-red-400 border-red-500/30 bg-red-950/20' :
                'text-slate-400 border-slate-700 bg-slate-800/50';

    const currentURL = typeof window !== 'undefined' ? window.location.href : '';

    // ─────────────────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div
            className="min-h-screen text-white flex flex-col"
            style={{ background: 'linear-gradient(160deg,#080d1a 0%,#0f172a 60%,#080d1a 100%)', maxWidth: 520, margin: '0 auto' }}
        >
            {/* ── Header ─────────────────────────────────────────────────────────── */}
            <div className="sticky top-0 z-50 backdrop-blur-md border-b border-slate-800 bg-slate-900/95 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Link to="/dashboard" className="text-slate-400 hover:text-white text-xs flex items-center gap-1">
                        <ArrowLeft className="h-3.5 w-3.5" />
                    </Link>
                    <div>
                        <div className="font-bold text-white text-sm flex items-center gap-2">
                            <Bluetooth className="h-4 w-4 text-violet-400" />
                            Wearable Control
                        </div>
                        <div className="text-[10px] text-slate-500">Live Device Synchronization</div>
                    </div>
                </div>
                <Link to="/dashboard"
                    className="flex items-center gap-1.5 text-xs font-medium text-teal-400 border border-teal-500/30 px-2.5 py-1 rounded-lg hover:bg-teal-900/30 transition-all">
                    <Shield className="h-3 w-3" /> Dashboard ↗
                </Link>
            </div>

            <div className="flex-1 px-4 py-5 space-y-4">

                {/* ── Wearable Device Info Section ── */}
                <div className="rounded-2xl border border-slate-700 bg-slate-800/40 overflow-hidden shadow-xl">
                    <div className="bg-slate-700/30 px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Info className="h-4 w-4 text-teal-400" />
                            <span className="text-sm font-bold tracking-tight">Wearable Status</span>
                        </div>
                        {btStatus === 'connected' && (
                            <div className="flex items-center gap-1.5">
                                <div className="h-2 w-2 rounded-full bg-teal-400 animate-pulse" />
                                <span className="text-[10px] font-bold text-teal-400 uppercase tracking-widest">Live</span>
                            </div>
                        )}
                    </div>
                    <div className="p-4 grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Device Model</p>
                            <p className="text-sm font-bold text-white font-mono truncate">{watchName || "No Device"}</p>
                        </div>
                        <div className="space-y-1 text-right">
                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Connection</p>
                            <p className={`text-sm font-bold font-mono ${btStatus === 'connected' ? 'text-teal-400' : 'text-slate-500'}`}>
                                {btStatus === 'connected' ? 'SECURE_BLE' : btStatus.toUpperCase()}
                            </p>
                        </div>
                        <div className="space-y-1">
                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Battery Status</p>
                            <div className="flex items-center gap-2">
                                {battery !== null ? (
                                    <>
                                        <div className="flex-1 h-2 bg-slate-900 rounded-full border border-slate-700 relative overflow-hidden">
                                            <div
                                                className={`h-full transition-all duration-1000 ${battery < 20 ? 'bg-red-500' : 'bg-teal-500'}`}
                                                style={{ width: `${battery}%` }}
                                            />
                                        </div>
                                        <span className="text-xs font-bold font-mono">{battery}%</span>
                                    </>
                                ) : (
                                    <span className="text-xs text-slate-600 font-mono">--%</span>
                                )}
                            </div>
                        </div>
                        <div className="space-y-1 text-right">
                            <p className="text-[10px] text-slate-500 uppercase font-black tracking-widest">Tracking Efficiency</p>
                            <div className="flex items-center justify-end gap-2">
                                <span className={`text-xs font-bold font-mono ${gps ? 'text-emerald-400' : 'text-slate-600'}`}>
                                    {gps ? `${Math.max(0, Math.min(100, 100 - gps.acc))}%` : '0%'}
                                </span>
                                <div className="flex gap-0.5">
                                    {[1, 2, 3, 4].map(i => (
                                        <div
                                            key={i}
                                            className={`h-2.5 w-1 rounded-full ${gps && i <= (gps.acc < 15 ? 4 : gps.acc < 30 ? 3 : 2) ? 'bg-emerald-400' : 'bg-slate-700'}`}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ── URL Banner (for sharing to phone) ─────────────────────────── */}
                {!isMobileChrome && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-3">
                        <div className="flex items-start gap-2">
                            <Smartphone className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-xs font-semibold text-amber-400 mb-1">Open on your Android phone in Chrome</p>
                                <p className="text-[10px] text-amber-300/70 font-mono break-all bg-amber-950/40 rounded p-1.5 border border-amber-700/30">{currentURL}</p>
                                <p className="text-[10px] text-amber-400/60 mt-1">Bluetooth only works in Chrome on Android.</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Patient ID Setup ──────────────────────────────────────────── */}
                <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                            <Radio className="h-3.5 w-3.5 text-teal-400" /> Streaming to Patient
                        </div>
                        <button onClick={() => { setPidInput(patientId); setShowSetup(s => !s); }}
                            className="text-[10px] text-teal-400 hover:text-teal-300">
                            {showSetup ? 'Cancel' : 'Change'}
                        </button>
                    </div>
                    {showSetup ? (
                        <div className="flex gap-2">
                            <input
                                value={pidInput} onChange={e => setPidInput(e.target.value)}
                                placeholder="e.g. demo_patient_001"
                                className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500"
                                onKeyDown={e => { if (e.key === 'Enter') savePatientId(); }}
                            />
                            <button onClick={savePatientId}
                                className="px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium">
                                Save
                            </button>
                        </div>
                    ) : (
                        <div className={`text-sm font-mono font-bold ${patientId ? 'text-teal-400' : 'text-amber-400'}`}>
                            {patientId || '⚠ Set a patient ID before streaming'}
                        </div>
                    )}
                </div>

                {/* ── Mode Selector ─────────────────────────────────────────────── */}
                <div className="flex gap-2">
                    <button
                        onClick={() => setUseMock(false)}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${!useMock ? 'bg-teal-600 border-teal-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                    >
                        Real Watch
                    </button>
                    <button
                        onClick={() => setUseMock(true)}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-all ${useMock ? 'bg-violet-600 border-violet-500 text-white' : 'bg-slate-800 border-slate-700 text-slate-500'}`}
                    >
                        Mock Engine (Lively)
                    </button>
                </div>

                {/* ── Status Row ────────────────────────────────────────────────── */}
                <div className="grid grid-cols-2 gap-3">
                    {/* Bluetooth card */}
                    <div className={`rounded-xl border p-3 ${statusColor(btStatus)}`}>
                        <div className="flex items-center gap-2 mb-2">
                            {btStatus === 'connected'
                                ? <Bluetooth className="h-4 w-4" />
                                : <BluetoothOff className="h-4 w-4" />
                            }
                            <span className="text-xs font-semibold">Watch</span>
                            {battery !== null && (
                                <span className={`ml-auto text-[10px] flex items-center gap-0.5 ${battery < 20 ? 'text-red-400' : ''}`}>
                                    {battery < 20 ? <BatteryLow className="h-3 w-3" /> : <Battery className="h-3 w-3" />}
                                    {battery}%
                                </span>
                            )}
                        </div>
                        <div className="text-[11px] font-medium leading-tight">
                            {btStatus === 'connected' ? `✓ ${watchName}` :
                                btStatus === 'scanning' ? '🔍 Scanning…' :
                                    btStatus === 'disconnected' ? '⚡ Reconnect?' :
                                        btStatus === 'unsupported' ? '✗ Not supported' :
                                            btStatus === 'error' ? '✗ Error' : 'Not connected'}
                        </div>
                    </div>

                    {/* GPS card */}
                    <div className={`rounded-xl border p-3 ${gpsColor(gpsStatus)}`}>
                        <div className="flex items-center gap-2 mb-2">
                            <MapPin className="h-4 w-4" />
                            <span className="text-xs font-semibold">GPS</span>
                        </div>
                        <div className="text-[11px] font-medium leading-tight">
                            {gps
                                ? `${gps.lat.toFixed(5)}, ${gps.lon.toFixed(5)}`
                                : gpsStatus === 'denied' ? '✗ Access denied'
                                    : gpsStatus === 'active' ? 'Locating…'
                                        : 'Inactive'}
                        </div>
                        {gps && <div className="text-[9px] opacity-60 mt-0.5">±{Math.round(gps.acc)}m</div>}
                    </div>
                </div>

                {/* ── Live Heart Rate ────────────────────────────────────────────── */}
                {(btStatus === 'connected' || streaming) && (
                    <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5 text-center transition-all">
                        <div className="flex items-center justify-center gap-2 text-xs text-slate-400 mb-2">
                            <Heart className="h-3.5 w-3.5 text-red-400 animate-pulse" />
                            {useMock ? 'Simulated Lively Heart Rate' : (btStatus === 'connected' ? 'Live Heart Rate from Watch' : 'Simulated Heart Rate (Idle)')}
                        </div>
                        <div className="text-7xl font-black font-mono text-red-400 tabular-nums">
                            {useMock || btStatus !== 'connected' ? (liveData?.heart_rate ?? '--') : (heartRate ?? '--')}
                        </div>
                        <div className="text-sm text-slate-400 mt-1">bpm</div>
                        {((useMock ? liveData?.heart_rate : heartRate) ?? 0) > 0 && (
                            <div className={`text-xs mt-2 font-medium ${((useMock ? liveData?.heart_rate : heartRate) ?? 0) < 60 ? 'text-blue-400' :
                                ((useMock ? liveData?.heart_rate : heartRate) ?? 0) > 100 ? 'text-red-400' : 'text-emerald-400'
                                }`}>
                                {((useMock ? liveData?.heart_rate : heartRate) ?? 0) < 60 ? '↓ Bradycardia range' :
                                    ((useMock ? liveData?.heart_rate : heartRate) ?? 0) > 100 ? '↑ Tachycardia range' : '✓ Normal range'}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Live vitals grid (when streaming) ─────────────────────────── */}
                {streaming && liveData && (
                    <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-2">
                            <Zap className="h-3 w-3 text-teal-400" /> Live Estimated Vitals
                            <span className="text-slate-600">(HR from watch, rest derived)</span>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            {[
                                { label: 'SpO₂', value: liveData.spo2, unit: '%', color: 'text-cyan-400', icon: <Droplets className="h-3 w-3" /> },
                                { label: 'Sys BP', value: liveData.systolic_bp, unit: 'mmHg', color: 'text-blue-400', icon: <Activity className="h-3 w-3" /> },
                                { label: 'Dia BP', value: liveData.diastolic_bp, unit: 'mmHg', color: 'text-indigo-400', icon: <Activity className="h-3 w-3" /> },
                                { label: 'Temp', value: liveData.temperature_f, unit: '°F', color: 'text-orange-400', icon: <Thermometer className="h-3 w-3" /> },
                                { label: 'Resp', value: liveData.respiratory_rate, unit: '/min', color: 'text-violet-400', icon: <Wind className="h-3 w-3" /> },
                                { label: 'Packets', value: sent, unit: 'sent', color: 'text-teal-400', icon: <Wifi className="h-3 w-3" /> },
                            ].map(({ label, value, unit, color, icon }) => (
                                <div key={label} className="rounded-xl border border-slate-700 bg-slate-800/60 p-2.5 text-center">
                                    <div className={`flex justify-center mb-1 ${color}`}>{icon}</div>
                                    <div className={`text-sm font-bold font-mono ${color}`}>
                                        {typeof value === 'number' ? value.toFixed(label === 'Packets' ? 0 : 1) : value}
                                    </div>
                                    <div className="text-[9px] text-slate-500">{unit}</div>
                                    <div className="text-[9px] text-slate-600">{label}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* ── Error ──────────────────────────────────────────────────────── */}
                {error && (
                    <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-3 flex gap-2">
                        <AlertTriangle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                        <p className="text-xs text-red-300">{error}</p>
                    </div>
                )}

                {/* ── Action Buttons ─────────────────────────────────────────────── */}
                <div className="space-y-3">

                    {/* Previously-paired: fast reconnect */}

                    {btStatus !== 'connected' && pairedDevices.length > 0 && (

                        <div className="rounded-xl border border-violet-500/30 bg-violet-950/20 p-3">

                            <p className="text-[10px] font-bold text-violet-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">

                                <Bluetooth className="h-3 w-3" /> Previously Paired — Tap to Reconnect

                            </p>

                            {pairedDevices.map((dev) => (

                                <button key={dev.id} onClick={() => void reconnectTo(dev)}

                                    disabled={btStatus === 'scanning'}

                                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-violet-900/30 border border-violet-500/30 hover:bg-violet-900/50 transition-all mb-1 last:mb-0">

                                    <div className="flex items-center gap-2">

                                        <div className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />

                                        <span className="text-sm font-semibold text-white">{dev.name ?? 'Unknown Watch'}</span>

                                    </div>

                                    <span className="text-xs text-violet-400 font-medium">⚡ Connect</span>

                                </button>

                            ))}

                        </div>

                    )}



                    {/* New BT connection picker */}

                    {btStatus !== 'connected' && (

                        <button onClick={connectWatch}

                            disabled={btStatus === 'scanning' || btStatus === 'unsupported'}

                            className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-bold text-sm transition-all ${btStatus === 'scanning' ? 'bg-blue-900/50 border border-blue-500/40 text-blue-300 cursor-not-allowed' :

                                btStatus === 'unsupported' ? 'bg-slate-800 border border-slate-700 text-slate-500 cursor-not-allowed' :

                                    pairedDevices.length > 0 ? 'bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600' :

                                        'bg-violet-600 hover:bg-violet-700 text-white border border-violet-500 shadow-lg shadow-violet-950/40'

                                }`}>

                            {btStatus === 'scanning'

                                ? <><RefreshCw className="h-4 w-4 animate-spin" /> Scanning…</>

                                : <><Bluetooth className="h-4 w-4" /> {pairedDevices.length > 0 ? 'Connect a Different Watch…' : 'Connect Bluetooth Watch'}</>

                            }

                        </button>

                    )}



                    {/* Connected: Disconnect + Unpair */}

                    {btStatus === 'connected' && (

                        <div className="flex gap-2">

                            <button onClick={disconnectWatch}

                                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-teal-600/20 border border-teal-500/50 text-teal-400 hover:bg-teal-600/30 transition-all">

                                <CheckCircle2 className="h-4 w-4" /> {watchName} — Disconnect

                            </button>

                            <button onClick={() => void forgetWatch()}

                                title="Unpair: removes this watch from browser Bluetooth memory"

                                className="px-4 py-3 rounded-xl font-semibold text-sm bg-red-900/30 border border-red-500/40 text-red-400 hover:bg-red-900/50 transition-all flex items-center gap-1.5">

                                <BluetoothOff className="h-4 w-4" /> Unpair

                            </button>

                        </div>

                    )}


                    {/* GPS */}
                    {gpsStatus === 'idle' && (
                        <button onClick={startGPS}
                            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-semibold text-sm bg-emerald-600 hover:bg-emerald-700 text-white border border-emerald-500 transition-all">
                            <MapPin className="h-4 w-4" /> Enable GPS Location Tracking
                        </button>
                    )}

                    {/* ── Emergency Simulation ── */}
                    {streaming && (
                        <button
                            onClick={() => {
                                const bc = new BroadcastChannel("medconnect_emergency");
                                bc.postMessage("CRASH_DETECTED");
                                log("⚠️ Emergency Signal Sent (Crash Simulation)");
                            }}
                            className="w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl font-black text-base bg-red-950/20 border-2 border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-lg shadow-red-900/10"
                        >
                            <AlertTriangle className="h-5 w-5" />
                            Simulate Fall / Crash Detect
                        </button>
                    )}

                    {/* Start / Stop stream */}
                    <button
                        onClick={streaming ? stopStream : startStream}
                        className={`w-full flex items-center justify-center gap-2.5 py-4 rounded-2xl font-black text-base transition-all ${streaming
                            ? 'bg-red-600 hover:bg-red-700 text-white border border-red-500'
                            : 'bg-teal-500 hover:bg-teal-600 text-white border border-teal-400 shadow-xl shadow-teal-950/40'
                            }`}
                    >
                        {streaming
                            ? <><Square className="h-5 w-5 fill-current" /> Stop Streaming</>
                            : <><Play className="h-5 w-5 fill-current" /> Start Live Stream to Caretaker</>
                        }
                    </button>
                </div>

                {/* ── Last sent status ──────────────────────────────────────────── */}
                {lastSent && (
                    <div className="text-center text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
                        <Wifi className="h-3 w-3 text-teal-500 animate-pulse" />
                        Last sent: {lastSent.toLocaleTimeString()} · {sent} packets · Patient: <strong className="text-teal-400">{patientId}</strong>
                    </div>
                )}

                {/* ── GPS Map Link ──────────────────────────────────────────────── */}
                {gps && (
                    <a
                        href={`https://maps.google.com/?q=${gps.lat},${gps.lon}`}
                        target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 py-2 rounded-xl border border-slate-700 text-xs text-slate-400 hover:text-teal-400 hover:border-teal-500/40 transition-all"
                    >
                        <MapPin className="h-3.5 w-3.5" /> View current location on Google Maps ↗
                    </a>
                )}

                {/* ── Setup Instructions ────────────────────────────────────────── */}
                <div className="rounded-xl border border-slate-700/60 bg-slate-800/30 p-4 space-y-3">
                    <div className="flex items-center gap-2 text-sm font-bold text-slate-300">
                        <Info className="h-4 w-4 text-teal-400" /> How to set up
                    </div>
                    <ol className="space-y-2.5 text-xs text-slate-400">
                        {[
                            ['📱', 'Open this page on your Android phone in Chrome'],
                            ['🔵', 'Set your Patient ID (ask your caretaker for it, or use "demo_patient_001")'],
                            ['⌚', 'Turn on your watch and enable Bluetooth on your phone'],
                            ['🔗', 'Tap "Connect Bluetooth Watch" → your watch appears in the list'],
                            ['📍', 'Tap "Enable GPS" to allow location tracking'],
                            ['🚀', 'Tap "Start Live Stream" — your caretaker sees all data instantly'],
                            ['🖥️', 'Caretaker opens /caretaker on any device to monitor you live'],
                        ].map(([emoji, text], i) => (
                            <li key={i} className="flex gap-2">
                                <span className="shrink-0 text-slate-500">{i + 1}.</span>
                                <span>{emoji} {text}</span>
                            </li>
                        ))}
                    </ol>
                    <div className="pt-2 border-t border-slate-700/40 text-[10px] text-slate-500">
                        <strong className="text-amber-400">Watch compatibility:</strong> Any BLE watch exposing the
                        standard Heart Rate GATT service (0x180D) — Noise, boAt, Fire-Boltt, Mi Band,
                        Amazfit, Garmin, Polar, Samsung Galaxy Watch, etc.
                        <br />
                        <strong className="text-amber-400">Note:</strong> BP, SpO₂ and temperature are estimated
                        from heart rate for demo purposes.
                    </div>
                </div>

                {/* ── Activity Log ─────────────────────────────────────────────── */}
                <div className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Activity Log</div>
                    <div className="space-y-0.5 max-h-32 overflow-y-auto">
                        {logs.map((l, i) => (
                            <p key={i} className="text-[10px] font-mono text-slate-500 leading-relaxed">{l}</p>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
}
