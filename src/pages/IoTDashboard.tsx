import { useState, useEffect, useRef, useCallback } from "react";
import Navbar from "@/components/Navbar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase, SUPABASE_ENABLED } from "@/lib/supabase";
import {
    Activity, Heart, Droplets, Thermometer, Wind, Wifi, WifiOff,
    Battery, BatteryLow, MapPin, Plus, Trash2, RefreshCw, Watch,
    AlertTriangle, CheckCircle2, Zap, BluetoothOff,
} from "lucide-react";

const BACKEND = import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";

// ── Types ─────────────────────────────────────────────────────────────────────
interface VitalReading {
    id: number;
    patient_id: string;
    device_id?: string;
    source?: string;
    heart_rate?: number;
    systolic_bp?: number;
    diastolic_bp?: number;
    spo2?: number;
    temperature_f?: number;
    respiratory_rate?: number;
    latitude?: number;
    longitude?: number;
    battery_pct?: number;
    recorded_at: string;
}

interface IoTDevice {
    id: string;
    patient_id: string;
    device_type: string;
    device_name: string;
    is_active: boolean;
    last_seen?: string;
    battery_pct?: number;
    firmware?: string;
}

// ── Vital card component ──────────────────────────────────────────────────────
const VitalCard = ({
    icon, label, value, unit, normal, warning, critical, trend,
}: {
    icon: React.ReactNode; label: string; value?: number; unit: string;
    normal: [number, number]; warning: [number, number]; critical?: [number, number];
    trend?: "rising" | "falling" | "stable";
}) => {
    const getColor = () => {
        if (value === undefined) return "text-slate-400";
        if (critical && (value < critical[0] || value > critical[1])) return "text-red-500";
        if (value < warning[0] || value > warning[1]) return "text-amber-400";
        return "text-emerald-400";
    };
    const getBg = () => {
        if (value === undefined) return "border-slate-700/50";
        if (critical && (value < critical[0] || value > critical[1])) return "border-red-500/40 shadow-red-900/20 shadow-lg";
        if (value < warning[0] || value > warning[1]) return "border-amber-400/40 shadow-amber-900/20";
        return "border-emerald-500/20";
    };
    const trendIcon = trend === "rising" ? "↑" : trend === "falling" ? "↓" : "→";

    return (
        <Card className={`bg-slate-800/60 border ${getBg()} transition-all duration-500`}>
            <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-400 text-xs font-medium flex items-center gap-1">
                        {icon} {label}
                    </span>
                    {trend && <span className={`text-xs font-bold ${getColor()}`}>{trendIcon}</span>}
                </div>
                <div className={`text-3xl font-bold font-mono ${getColor()} transition-all duration-300`}>
                    {value !== undefined ? value.toFixed(1) : "--"}
                    <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>
                </div>
                <div className="text-xs text-slate-500 mt-1">
                    Normal: {normal[0]}–{normal[1]}
                </div>
            </CardContent>
        </Card>
    );
};

// ── Mini spark line ───────────────────────────────────────────────────────────
const Sparkline = ({ data, color = "#10b981" }: { data: number[]; color?: string }) => {
    if (data.length < 2) return null;
    const min = Math.min(...data), max = Math.max(...data);
    const range = max - min || 1;
    const w = 120, h = 36, pad = 2;
    const pts = data.map((v, i) => {
        const x = pad + (i / (data.length - 1)) * (w - 2 * pad);
        const y = h - pad - ((v - min) / range) * (h - 2 * pad);
        return `${x},${y}`;
    }).join(" ");
    return (
        <svg width={w} height={h} className="opacity-70">
            <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
    );
};

// ── GPS Map (simple SVG placeholder with coordinates) ─────────────────────────
const MiniMap = ({ lat, lon }: { lat?: number; lon?: number }) => (
    <div className="bg-slate-900/60 rounded-xl border border-slate-700 p-4 flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
            <MapPin className="h-3.5 w-3.5 text-teal-400" /> GPS Location
        </div>
        {lat && lon ? (
            <>
                <div className="relative w-full h-32 bg-slate-800 rounded-lg overflow-hidden">
                    {/* Simple dot-on-grid map */}
                    <svg width="100%" height="100%" className="opacity-30">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <line key={`h${i}`} x1="0" y1={`${i * 20}%`} x2="100%" y2={`${i * 20}%`} stroke="#334155" strokeWidth="0.5" />
                        ))}
                        {Array.from({ length: 8 }).map((_, i) => (
                            <line key={`v${i}`} x1={`${i * 14}%`} y1="0" x2={`${i * 14}%`} y2="100%" stroke="#334155" strokeWidth="0.5" />
                        ))}
                    </svg>
                    {/* Patient dot */}
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="relative">
                            <div className="w-4 h-4 bg-teal-400 rounded-full shadow-lg shadow-teal-500/50" />
                            <div className="absolute inset-0 w-4 h-4 bg-teal-400 rounded-full animate-ping opacity-60" />
                        </div>
                    </div>
                </div>
                <div className="text-xs text-slate-400 font-mono">
                    {lat.toFixed(5)}°N, {lon.toFixed(5)}°E
                </div>
                <a
                    href={`https://maps.google.com/?q=${lat},${lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-teal-400 hover:text-teal-300 underline"
                >
                    Open in Google Maps ↗
                </a>
            </>
        ) : (
            <div className="text-slate-500 text-xs">No GPS data yet</div>
        )}
    </div>
);

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IoTDashboard() {
    const patientId = (() => {
        try { return (JSON.parse(localStorage.getItem("connectcare_auth") || "{}") as { user_id?: string }).user_id || "demo_patient"; }
        catch { return "demo_patient"; }
    })();

    const [live, setLive] = useState<VitalReading | null>(null);
    const [history, setHistory] = useState<VitalReading[]>([]);
    const [devices, setDevices] = useState<IoTDevice[]>([]);
    const [connected, setConnected] = useState(false);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [registerType, setRegisterType] = useState("smartwatch");
    const [registerName, setRegisterName] = useState("");
    const [regResult, setRegResult] = useState<{ api_key?: string; device_id?: string } | null>(null);
    const [registering, setRegistering] = useState(false);
    const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

    // ── Supabase Realtime subscription ────────────────────────────────────────
    const subscribeRealtime = useCallback(() => {
        if (!supabase || !SUPABASE_ENABLED) return;

        if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
        }

        const ch = supabase
            .channel(`iot-vitals-${patientId}`)
            .on(
                "postgres_changes",
                {
                    event: "INSERT",
                    schema: "public",
                    table: "vitals",
                    filter: `patient_id=eq.${patientId}`,
                },
                (payload) => {
                    const row = payload.new as VitalReading;
                    setLive(row);
                    setHistory(h => [row, ...h.slice(0, 59)]);
                    setLastUpdate(new Date());
                }
            )
            .subscribe((status) => {
                setConnected(status === "SUBSCRIBED");
            });

        channelRef.current = ch;
        return ch;
    }, [patientId]);

    useEffect(() => {
        subscribeRealtime();
        fetchDevices();
        fetchHistory();

        // Stale data watchdog: clear live state if no update after 2 mins
        const interval = setInterval(() => {
            setLastUpdate(prev => {
                if (prev && (Date.now() - prev.getTime() > 120000)) {
                    setLive(null);
                }
                return prev;
            });
        }, 10000);

        return () => {
            clearInterval(interval);
            if (channelRef.current && supabase) {
                supabase.removeChannel(channelRef.current);
            }
        };
    }, [subscribeRealtime]);

    const fetchHistory = async () => {
        if (!supabase) return;
        const { data } = await supabase
            .from("vitals")
            .select("*")
            .eq("patient_id", patientId)
            .order("recorded_at", { ascending: false })
            .limit(60);
        if (data?.length) {
            setHistory(data as VitalReading[]);
            // Only set as 'live' if the record is very recent (within 2 minutes)
            const latest = data[0] as VitalReading;
            const diff = Date.now() - new Date(latest.recorded_at).getTime();
            if (diff < 120000) {
                setLive(latest);
                setLastUpdate(new Date(latest.recorded_at));
            }
        }
    };

    const fetchDevices = async () => {
        try {
            const r = await fetch(`${BACKEND}/api/iot/devices/${patientId}`);
            const d = await r.json();
            if (d.status === "ok") setDevices(d.devices || []);
        } catch { /* backend offline */ }
    };

    const handleRegisterDevice = async () => {
        if (devices.filter(d => d.is_active).length >= 3) {
            setRegResult({ api_key: "Error: Maximum of 3 active devices allowed per patient." });
            return;
        }
        setRegistering(true);
        try {
            const r = await fetch(`${BACKEND}/api/iot/register`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ patient_id: patientId, device_type: registerType, device_name: registerName }),
            });
            const d = await r.json();
            if (d.status === "ok") {
                setRegResult({ api_key: d.device.api_key, device_id: d.device.id });
                fetchDevices();
            } else {
                setRegResult({ api_key: d.message || "Registration failed" });
            }
        } catch {
            setRegResult({ api_key: "Backend offline — start the Flask server first." });
        }
        setRegistering(false);
    };

    const handleRemoveDevice = async (deviceId: string) => {
        await fetch(`${BACKEND}/api/iot/deregister/${deviceId}`, { method: "DELETE" });
        fetchDevices();
    };

    // Extract sparkline history
    const hrData = history.filter(r => r.heart_rate).map(r => r.heart_rate!).reverse();
    const sysData = history.filter(r => r.systolic_bp).map(r => r.systolic_bp!).reverse();
    const spo2Data = history.filter(r => r.spo2).map(r => r.spo2!).reverse();

    const elapsed = lastUpdate ? Math.round((Date.now() - lastUpdate.getTime()) / 1000) : null;

    return (
        <div className="min-h-screen bg-slate-950 text-white">
            <Navbar />

            <div className="max-w-7xl mx-auto px-4 py-8 space-y-8">

                {/* Header */}
                <div className="flex items-center justify-between flex-wrap gap-4">
                    <div>
                        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
                            <Watch className="h-8 w-8 text-teal-400" />
                            IoT Live Monitor
                        </h1>
                        <p className="text-slate-400 mt-1">Real-time vitals from wearable devices — powered by Supabase Realtime</p>
                    </div>
                    <div className="flex items-center gap-3">
                        {SUPABASE_ENABLED ? (
                            connected ? (
                                <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 flex gap-1.5 animate-pulse">
                                    <Wifi className="h-3 w-3" /> LIVE
                                </Badge>
                            ) : (
                                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 flex gap-1.5">
                                    <RefreshCw className="h-3 w-3 animate-spin" /> Connecting...
                                </Badge>
                            )
                        ) : (
                            <Badge className="bg-slate-700 text-slate-400 border-slate-600 flex gap-1.5">
                                <WifiOff className="h-3 w-3" /> Supabase not configured
                            </Badge>
                        )}
                        {elapsed !== null && elapsed < 120 ? (
                            <span className="text-xs text-slate-500">Updated {elapsed}s ago</span>
                        ) : elapsed !== null ? (
                            <Badge variant="outline" className="text-red-400 border-red-500/20 text-[10px]">
                                <BluetoothOff className="h-2.5 w-2.5 mr-1" /> DISCONNECTED
                            </Badge>
                        ) : null}
                    </div>
                </div>

                {/* Live Vitals Grid */}
                <div>
                    <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                        <Activity className="h-4 w-4" /> Live Vitals
                        {live?.source && (
                            <Badge className="ml-2 text-xs bg-teal-500/10 text-teal-400 border-teal-500/20">
                                {live.source}
                            </Badge>
                        )}
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                        <VitalCard icon={<Heart className="h-3 w-3 text-red-400" />} label="Heart Rate"
                            value={live?.heart_rate} unit="bpm"
                            normal={[60, 100]} warning={[50, 120]} critical={[30, 150]} />
                        <VitalCard icon={<Activity className="h-3 w-3 text-blue-400" />} label="Systolic BP"
                            value={live?.systolic_bp} unit="mmHg"
                            normal={[90, 120]} warning={[80, 140]} critical={[60, 180]} />
                        <VitalCard icon={<Activity className="h-3 w-3 text-indigo-400" />} label="Diastolic BP"
                            value={live?.diastolic_bp} unit="mmHg"
                            normal={[60, 80]} warning={[50, 90]} critical={[40, 120]} />
                        <VitalCard icon={<Droplets className="h-3 w-3 text-cyan-400" />} label="SpO₂"
                            value={live?.spo2} unit="%"
                            normal={[95, 100]} warning={[90, 100]} critical={[80, 100]} />
                        <VitalCard icon={<Thermometer className="h-3 w-3 text-orange-400" />} label="Temperature"
                            value={live?.temperature_f} unit="°F"
                            normal={[97, 99]} warning={[96, 100.4]} critical={[90, 104]} />
                        <VitalCard icon={<Wind className="h-3 w-3 text-violet-400" />} label="Resp. Rate"
                            value={live?.respiratory_rate} unit="/min"
                            normal={[12, 20]} warning={[10, 25]} critical={[6, 30]} />
                    </div>
                </div>

                {/* Sparklines + GPS */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {[
                        { label: "Heart Rate History", data: hrData, color: "#ef4444", unit: "bpm" },
                        { label: "Systolic BP History", data: sysData, color: "#60a5fa", unit: "mmHg" },
                        { label: "SpO₂ History", data: spo2Data, color: "#22d3ee", unit: "%" },
                    ].map(({ label, data, color, unit }) => (
                        <Card key={label} className="bg-slate-800/60 border-slate-700">
                            <CardContent className="p-4">
                                <div className="text-xs text-slate-400 font-medium mb-2">{label}</div>
                                {data.length > 1 ? (
                                    <div className="flex items-end gap-3">
                                        <svg viewBox="0 0 200 50" className="flex-1 h-12">
                                            <polyline
                                                points={data.map((v, i) => {
                                                    const mn = Math.min(...data), mx = Math.max(...data);
                                                    const r = mx - mn || 1;
                                                    return `${(i / (data.length - 1)) * 200},${50 - ((v - mn) / r) * 46}`;
                                                }).join(" ")}
                                                fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round"
                                            />
                                        </svg>
                                        <span className="text-xl font-bold font-mono" style={{ color }}>
                                            {data[data.length - 1]?.toFixed(1)} <span className="text-xs text-slate-400">{unit}</span>
                                        </span>
                                    </div>
                                ) : (
                                    <div className="text-slate-500 text-sm">Waiting for data...</div>
                                )}
                            </CardContent>
                        </Card>
                    ))}
                </div>

                {/* GPS Tracking + Device List */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

                    {/* GPS */}
                    <div>
                        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <MapPin className="h-4 w-4" /> Patient Location
                        </h2>
                        <MiniMap lat={live?.latitude} lon={live?.longitude} />
                    </div>

                    {/* Registered Devices */}
                    <div>
                        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                            <Watch className="h-4 w-4" /> Registered Devices
                        </h2>
                        <div className="space-y-2">
                            {devices.length === 0 && (
                                <div className="text-slate-500 text-sm p-4 bg-slate-800/40 rounded-xl border border-slate-700">
                                    No devices registered yet. Add one below.
                                </div>
                            )}
                            {devices.map(d => (
                                <div key={d.id} className="flex items-center justify-between p-3 bg-slate-800/60 rounded-xl border border-slate-700">
                                    <div className="flex items-center gap-3">
                                        <div className={`w-2 h-2 rounded-full ${d.is_active ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
                                        <div>
                                            <div className="text-sm font-medium text-white">{d.device_name}</div>
                                            <div className="text-xs text-slate-400">{d.device_type} · ID: {d.id.slice(-8)}</div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {d.battery_pct !== undefined && (
                                            <span className={`text-xs flex items-center gap-1 ${d.battery_pct < 20 ? "text-red-400" : "text-slate-400"}`}>
                                                {d.battery_pct < 20 ? <BatteryLow className="h-3 w-3" /> : <Battery className="h-3 w-3" />}
                                                {d.battery_pct}%
                                            </span>
                                        )}
                                        <button onClick={() => handleRemoveDevice(d.id)} className="text-slate-500 hover:text-red-400 transition-colors">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Recent Scan History */}
                <Card className="bg-slate-800/40 border-slate-700/50">
                    <CardHeader className="py-3 border-b border-slate-700/50">
                        <CardTitle className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                            <Activity className="h-4 w-4 text-teal-400" /> Recent IoT Scan Records
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-slate-900/50 text-slate-500 font-medium">
                                    <tr>
                                        <th className="px-4 py-3">Time</th>
                                        <th className="px-4 py-3">Source</th>
                                        <th className="px-4 py-3">HR</th>
                                        <th className="px-4 py-3">BP (S/D)</th>
                                        <th className="px-4 py-3">SpO₂</th>
                                        <th className="px-4 py-3">Temp</th>
                                        <th className="px-4 py-3">Status</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/50">
                                    {history.slice(0, 10).map((r, i) => (
                                        <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                                            <td className="px-4 py-3 text-slate-400 font-mono">
                                                {new Date(r.recorded_at).toLocaleTimeString()}
                                            </td>
                                            <td className="px-4 py-3">
                                                <Badge variant="outline" className="text-[10px] bg-slate-900 border-slate-700">
                                                    {r.source?.replace('iot_', '') || 'manual'}
                                                </Badge>
                                            </td>
                                            <td className="px-4 py-3 font-semibold text-emerald-400">{r.heart_rate || '--'} <span className="text-[10px] font-normal text-slate-500">bpm</span></td>
                                            <td className="px-4 py-3 font-semibold text-blue-400">{r.systolic_bp || '--'}/{r.diastolic_bp || '--'}</td>
                                            <td className="px-4 py-3 font-semibold text-cyan-400">{r.spo2 || '--'}%</td>
                                            <td className="px-4 py-3 font-semibold text-orange-400">{r.temperature_f || '--'}°F</td>
                                            <td className="px-4 py-3">
                                                <div className={`h-1.5 w-1.5 rounded-full ${connected && i === 0 ? 'bg-emerald-500 animate-pulse' : 'bg-slate-600'}`} />
                                            </td>
                                        </tr>
                                    ))}
                                    {history.length === 0 && (
                                        <tr>
                                            <td colSpan={7} className="px-4 py-8 text-center text-slate-500 italic">No scans recorded yet.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </CardContent>
                </Card>

                {/* Register New Device */}
                <Card className="bg-slate-800/60 border-slate-700">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2 text-white">
                            <Plus className="h-4 w-4 text-teal-400" />
                            Register New Device (Limit: 3)
                            <Badge variant="outline" className="ml-2 text-[10px] border-slate-600">
                                {devices.filter(d => d.is_active).length}/3 Active
                            </Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Device Type</label>
                                <select
                                    value={registerType}
                                    onChange={e => setRegisterType(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-teal-500"
                                >
                                    <option value="smartwatch">⌚ Smart Watch</option>
                                    <option value="bp_monitor">💊 BP Monitor</option>
                                    <option value="oximeter">🩸 Pulse Oximeter</option>
                                    <option value="custom">🔧 Custom Device</option>
                                </select>
                            </div>
                            <div>
                                <label className="text-xs text-slate-400 block mb-1">Device Name</label>
                                <input
                                    value={registerName}
                                    onChange={e => setRegisterName(e.target.value)}
                                    placeholder="e.g. My Smart Watch"
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-teal-500"
                                />
                            </div>
                            <div className="flex items-end">
                                <Button onClick={handleRegisterDevice} disabled={registering || devices.filter(d => d.is_active).length >= 3}
                                    className={`w-full ${devices.filter(d => d.is_active).length >= 3 ? 'bg-slate-700' : 'bg-teal-500 hover:bg-teal-600'} text-white`}>
                                    {registering ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                                    {devices.filter(d => d.is_active).length >= 3 ? "Device Limit Reached" : "Register Device"}
                                </Button>
                            </div>
                        </div>

                        {regResult && (
                            <div className={`rounded-xl p-4 border space-y-2 ${regResult.api_key.includes("Error") ? "bg-red-950/30 border-red-500/30" : "bg-slate-900 border-teal-500/30"}`}>
                                <div className={`flex items-center gap-2 font-semibold text-sm ${regResult.api_key.includes("Error") ? "text-red-400" : "text-teal-400"}`}>
                                    {regResult.api_key.includes("Error") ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                                    {regResult.api_key.includes("Error") ? "Registration Failed" : "Device Registered Successfully"}
                                </div>
                                {regResult.device_id && (
                                    <div className="text-xs text-slate-400">Device ID: <code className="text-slate-200">{regResult.device_id}</code></div>
                                )}
                                <div className="text-xs text-slate-400">
                                    {regResult.api_key.includes("Error") ? "Message: " : "API Key: "}
                                    <code className={`${regResult.api_key.includes("Error") ? "text-red-300" : "text-teal-300"} break-all`}>{regResult.api_key}</code>
                                </div>
                                {!regResult.api_key.includes("Error") && (
                                    <div className="text-xs text-amber-400 flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3" /> Save this API key — it won't be shown again!
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="text-xs text-slate-500 bg-slate-900/50 rounded-lg p-3">
                            <strong className="text-slate-300">How IoT devices send data:</strong> Programs or hardware send a
                            POST request to <code className="text-teal-400">/api/iot/data</code> with header{" "}
                            <code className="text-teal-400">X-Device-Key: mck_xxxx</code> and body containing vitals
                            (heart_rate, spo2, systolic_bp, etc.) + optional GPS coordinates.
                            Supabase Realtime instantly pushes updates to this page — no refresh needed.
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
