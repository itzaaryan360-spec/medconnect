import React from 'react';
import Navbar from '@/components/Navbar';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Heart, Activity, Thermometer, Droplets, Server, CheckCircle2, XCircle, Loader2, Bluetooth, Watch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { checkHealth, HealthCheckResponse } from "@/lib/api";
import { supabase, SUPABASE_ENABLED } from "@/lib/supabase";

const Dashboard = () => {
  const [vitals, setVitals] = React.useState<{
    heartRate?: number;
    systolic?: number;
    diastolic?: number;
    temp?: number;
    spo2?: number;
    source?: string;
    recordedAt?: string;
  } | null>(null);

  const patientId = (() => {
    try {
      const auth = JSON.parse(localStorage.getItem("connectcare_auth") || "{}");
      const id = auth.user_id || "demo_patient_001";
      console.log("[Dashboard] Tracking Patient ID:", id);
      return id;
    } catch {
      return "demo_patient_001";
    }
  })();

  const [backendStatus, setBackendStatus] = React.useState<'checking' | 'online' | 'offline'>('checking');
  const [backendInfo, setBackendInfo] = React.useState<HealthCheckResponse | null>(null);

  // Real-world data integration
  React.useEffect(() => {
    const processReading = (data: any) => {
      // Only accept if recent (within 24 hours to prevent clock skew issues)
      const diff = Math.abs(Date.now() - new Date(data.recorded_at || Date.now()).getTime());
      if (diff > 86400000) return;

      setVitals({
        heartRate: data.heart_rate,
        systolic: data.systolic_bp,
        diastolic: data.diastolic_bp,
        temp: data.temperature_f,
        spo2: data.spo2,
        source: data.source,
        recordedAt: data.recorded_at
      });
    };

    // 1. Listen for local Bluetooth scans (BroadcastChannel)
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel(`medconnect_vitals_${patientId}`);
      bc.onmessage = (evt) => processReading(evt.data);
    } catch (e) { console.error("BC error", e); }

    // 2. Listen for remote IoT updates (Supabase)
    let channel: any = null;
    if (SUPABASE_ENABLED && supabase) {
      // Initial fetch
      supabase.from('vitals')
        .select('*')
        .eq('patient_id', patientId)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .then(({ data }) => {
          if (data?.[0]) processReading(data[0]);
        });

      // Subscription
      channel = supabase.channel(`dashboard-vitals-${patientId}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'vitals',
          filter: `patient_id=eq.${patientId}`
        }, (payload) => processReading(payload.new))
        .subscribe();
    }

    return () => {
      bc?.close();
      if (channel) supabase?.removeChannel(channel);
    };
  }, [patientId]);

  // Backend health check — runs on mount and every 30 seconds
  const pingBackend = React.useCallback(async () => {
    try {
      const info = await checkHealth();
      setBackendStatus('online');
      setBackendInfo(info);
    } catch {
      setBackendStatus('offline');
      setBackendInfo(null);
    }
  }, []);

  React.useEffect(() => {
    pingBackend();
    const interval = setInterval(pingBackend, 30_000);
    return () => clearInterval(interval);
  }, [pingBackend]);

  return (
    <div>
      <Navbar />

      <div className="container mx-auto py-10">
        <h1 className="text-4xl font-bold mb-8 text-center">Health Dashboard</h1>

        {/* Vitals Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card className={vitals ? "border-emerald-500/20 shadow-sm" : "opacity-60 bg-slate-50/50"}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
                  <Heart className="h-4 w-4 text-red-500" /> Heart Rate
                  {vitals && <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse ml-1" title="Live data" />}
                </div>
                {vitals?.source && <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-600 border-emerald-100">{vitals.source}</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-1">
                <p className={`text-4xl font-bold tracking-tight ${vitals?.heartRate ? "text-slate-900" : "text-slate-300"}`}>
                  {vitals?.heartRate || "--"}
                </p>
                <span className="text-sm text-muted-foreground font-medium">bpm</span>
              </div>
              {!vitals && <p className="text-[10px] text-slate-400 mt-2 italic flex items-center gap-1"><Bluetooth className="h-3 w-3" /> Waiting for watch scan...</p>}
            </CardContent>
          </Card>

          <Card className={vitals ? "border-blue-500/20 shadow-sm" : "opacity-60 bg-slate-50/50"}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
                <Activity className="h-4 w-4 text-blue-500" /> Blood Pressure
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-1">
                <p className={`text-4xl font-bold tracking-tight ${vitals?.systolic ? "text-slate-900" : "text-slate-300"}`}>
                  {vitals?.systolic ? `${vitals.systolic}/${vitals.diastolic}` : "--/--"}
                </p>
                <span className="text-sm text-muted-foreground font-medium">mmHg</span>
              </div>
            </CardContent>
          </Card>

          <Card className={vitals ? "border-orange-500/20 shadow-sm" : "opacity-60 bg-slate-50/50"}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
                <Thermometer className="h-4 w-4 text-orange-500" /> Temperature
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-1">
                <p className={`text-4xl font-bold tracking-tight ${vitals?.temp ? "text-slate-900" : "text-slate-300"}`}>
                  {vitals?.temp || "--"}
                </p>
                <span className="text-sm text-muted-foreground font-medium">°F</span>
              </div>
            </CardContent>
          </Card>

          <Card className={vitals ? "border-cyan-500/20 shadow-sm" : "opacity-60 bg-slate-50/50"}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wider">
                <Droplets className="h-4 w-4 text-cyan-500" /> SpO2 Level
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-1">
                <p className={`text-4xl font-bold tracking-tight ${vitals?.spo2 ? "text-slate-900" : "text-slate-300"}`}>
                  {vitals?.spo2 || "--"}
                </p>
                <span className="text-sm text-muted-foreground font-medium">%</span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Backend Status Card */}
        <div className="mt-8">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Server className="h-5 w-5 text-slate-500" /> AI Backend Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-4">
                {/* Online/offline indicator */}
                <div className="flex items-center gap-2">
                  {backendStatus === 'checking' && (
                    <><Loader2 className="h-4 w-4 animate-spin text-slate-400" /><span className="text-sm text-muted-foreground">Checking...</span></>
                  )}
                  {backendStatus === 'online' && (
                    <><CheckCircle2 className="h-4 w-4 text-green-500" /><span className="text-sm font-medium text-green-600">Backend Online</span></>
                  )}
                  {backendStatus === 'offline' && (
                    <><XCircle className="h-4 w-4 text-red-500" /><span className="text-sm font-medium text-red-600">Backend Offline</span></>
                  )}
                </div>

                {/* Service badges (shown when online) */}
                {backendStatus === 'online' && backendInfo?.services && (
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={backendInfo.services.ocr_tesseract ? 'default' : 'secondary'}>
                      OCR {backendInfo.services.ocr_tesseract ? '✓' : '✗'}
                    </Badge>
                    <Badge variant={backendInfo.services.nlp_spacy ? 'default' : 'secondary'}>
                      NLP ({backendInfo.services.nlp_model})
                    </Badge>
                    <Badge variant={backendInfo.services.ai_ollama ? 'default' : 'secondary'}>
                      AI {backendInfo.services.ai_ollama ? '✓' : '✗'}
                    </Badge>
                    <Badge variant={backendInfo.services.pdf_support ? 'default' : 'secondary'}>
                      PDF {backendInfo.services.pdf_support ? '✓' : '✗'}
                    </Badge>
                  </div>
                )}

                {/* Offline guidance */}
                {backendStatus === 'offline' && (
                  <p className="text-xs text-muted-foreground">
                    Start the backend: run <code className="bg-muted px-1 py-0.5 rounded text-xs">start.bat</code> or{' '}
                    <code className="bg-muted px-1 py-0.5 rounded text-xs">.\start.ps1</code> from the project root.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="mt-8 text-center">
          <p className="text-xl text-gray-600">
            Go to <Link to="/reports" className="text-blue-600 hover:underline">Reports</Link> to upload medical reports
          </p>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;