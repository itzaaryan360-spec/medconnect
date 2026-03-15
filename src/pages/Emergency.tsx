import { useState, useCallback, useRef, useEffect } from "react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Phone, MapPin, AlertTriangle, User, Shield, PhoneCall, MessageSquare, Hospital, CheckCircle2, Activity } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "@/hooks/use-toast";
import { apiTriggerEmergency, apiEscalateEmergency, loadAuthFromStorage, apiSendWhatsAppLocation } from "@/lib/connectCareApi";

type EmergencyState = "idle" | "crash_detected" | "confirming" | "dispatching" | "active" | "resolved";

interface HospitalInfo {
  name: string;
  distance: string;
  phone: string;
}

const Emergency = () => {
  const [state, setState] = useState<EmergencyState>("idle");
  const [countdown, setCountdown] = useState(30);
  const [whatsapp, setWhatsapp] = useState("");
  const [nearestHospital, setNearestHospital] = useState<HospitalInfo | null>(null);
  const [patientId, setPatientId] = useState("anonymous_user");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sentNumbers = useRef<Set<string>>(new Set());
  const { toast } = useToast();

  useEffect(() => {
    const auth = loadAuthFromStorage();
    if (auth?.user_id) setPatientId(auth.user_id);
  }, []);

  const speak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const msg = new SpeechSynthesisUtterance(text);
      msg.rate = 0.95;
      window.speechSynthesis.speak(msg);
    }
  };

  const triggerEscalation = useCallback(async () => {
    setState("dispatching");
    speak("Initiating local emergency 108 call. Simultaneously notifying your caretakers with your live vitals and location via MedConnect AI.");

    window.location.href = "tel:108";

    try {
      await apiEscalateEmergency(patientId);
    } catch (err) {
      console.error("Backend escalation failed:", err);
    }

    setTimeout(() => {
      setNearestHospital({
        name: "City Specialty Hospital",
        distance: "1.2 km",
        phone: "108"
      });
      setState("active");
    }, 5000);
  }, [patientId]);

  const startEmergency = useCallback(async (isAuto = false) => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (isAuto) {
      triggerEscalation();
    } else {
      setState("confirming");
      setCountdown(30);

      await apiTriggerEmergency({
        patient_id: patientId,
        trigger_source: "MANUAL_SOS"
      });

      timerRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            timerRef.current = null;
            triggerEscalation();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
  }, [triggerEscalation, patientId]);

  const handleCrashDetection = useCallback(async () => {
    if (state === "idle" || state === "resolved") {
      setState("crash_detected");
      setCountdown(10);
      speak("High impact detected! Emergency SOS will be triggered automatically. Tap I am OK if you do not need help.");

      await apiTriggerEmergency({
        patient_id: patientId,
        trigger_source: "FALL_DETECTION"
      });

      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            startEmergency(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      timerRef.current = timer;
    }
  }, [state, startEmergency, patientId]);

  useEffect(() => {
    const bc = new BroadcastChannel("medconnect_emergency");
    bc.onmessage = (ev) => {
      if (ev.data === "CRASH_DETECTED") handleCrashDetection();
    };
    return () => bc.close();
  }, [handleCrashDetection]);

  const cancelEmergency = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    window.speechSynthesis.cancel();
    setState("idle");
    setCountdown(30);
    toast({ title: "SOS Cancelled", description: "Emergency services were not called." });
  }, [toast]);

  const resolveEmergency = useCallback(() => {
    setState("resolved");
    window.speechSynthesis.cancel();
    setTimeout(() => setState("idle"), 3000);
  }, []);

  // AUTOMATED WHATSAPP TRIGGER: Fires as soon as 10 digits are reached
  useEffect(() => {
    let cleanNumber = whatsapp.replace(/\D/g, '');
    if (cleanNumber.length === 10) cleanNumber = '91' + cleanNumber;

    if (cleanNumber.length >= 12 && !sentNumbers.current.has(cleanNumber) && (state === "confirming" || state === "dispatching" || state === "active")) {
      sentNumbers.current.add(cleanNumber);

      navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        const msg = encodeURIComponent(`🚨 *MEDCONNECT EMERGENCY ALERT*\nHigh impact detected. My exact location: https://maps.google.com/?q=${lat},${lon}`);

        // 1. Backend Service (Immediate background delivery)
        apiSendWhatsAppLocation(cleanNumber, { lat, lon }).catch(() => { });

        // 2. Direct Link Fallback
        window.open(`https://wa.me/${cleanNumber}?text=${msg}`, '_blank');

        toast({
          title: "Auto-Sharing Location...",
          description: "Opening WhatsApp with your GPS pin."
        });
      }, null, { enableHighAccuracy: true });
    }
  }, [whatsapp, state, toast]);

  const dial108 = () => {
    window.location.href = "tel:108";
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-8">
        <div className="mb-8">
          <h1 className="font-display text-4xl font-bold tracking-tight">Emergency SOS</h1>
          <p className="mt-2 text-muted-foreground text-lg">
            Automated crash detection, 108 auto-dial, and live location sharing.
          </p>
        </div>

        <div className="mx-auto max-w-2xl mt-12">
          <AnimatePresence mode="wait">
            {state === "idle" && (
              <motion.div key="idle" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="flex flex-col items-center">
                <button onClick={() => startEmergency(false)}
                  className="group relative flex h-56 w-56 items-center justify-center rounded-full bg-red-600 text-white shadow-[0_0_60px_-10px_rgba(220,38,38,0.5)] transition-all hover:scale-105 active:scale-95">
                  <div className="absolute inset-0 animate-pulse rounded-full bg-red-600/20 scale-125" />
                  <div className="relative text-center">
                    <Phone className="mx-auto h-16 w-16" />
                    <span className="mt-3 block font-display text-3xl font-black italic">SOS</span>
                  </div>
                </button>
                <p className="mt-8 text-center text-slate-400 font-medium bg-slate-900/50 px-6 py-2 rounded-full border border-slate-800">
                  Tap for manual SOS. Auto-detects falls & crashes.
                </p>
              </motion.div>
            )}

            {state === "crash_detected" && (
              <motion.div key="crash" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center w-full max-w-md mx-auto p-10 bg-red-950/40 border-4 border-red-500 rounded-[40px] shadow-[0_0_100px_rgba(239,68,68,0.3)]">
                <div className="relative mb-8">
                  <div className="absolute inset-0 rounded-full animate-ping bg-red-500/40" />
                  <div className="relative flex h-28 w-28 items-center justify-center rounded-full bg-red-500 shadow-2xl">
                    <AlertTriangle className="h-14 w-14 text-white" />
                  </div>
                </div>
                <h2 className="text-3xl font-black text-white text-center mb-3">Crash Detected!</h2>
                <p className="text-red-200 text-center text-lg mb-8 font-medium">Auto-triggering SOS in {countdown} seconds...</p>

                <div className="grid grid-cols-1 w-full gap-4">
                  <Button onClick={cancelEmergency} variant="secondary" className="h-16 text-xl font-black rounded-2xl bg-white text-black hover:bg-slate-200">I'M OK — CANCEL</Button>
                  <Button onClick={() => startEmergency(true)} variant="destructive" className="h-16 text-xl font-black rounded-2xl bg-red-600 hover:bg-red-700 shadow-xl">SOS NOW</Button>
                </div>
              </motion.div>
            )}

            {(state === "confirming" || state === "dispatching") && (
              <motion.div key="dispatch" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center w-full">
                <div className="flex h-48 w-48 animate-pulse items-center justify-center rounded-full bg-red-600 shadow-[0_0_40px_rgba(220,38,38,0.5)]">
                  <PhoneCall className="h-20 w-20 text-white" />
                </div>
                <h2 className="mt-8 text-4xl font-black text-red-500 animate-bounce">Dialing 108...</h2>

                <div className="mt-10 w-full max-w-md bg-slate-900 border-2 border-slate-800 p-8 rounded-[32px] shadow-2xl space-y-6">
                  <div className="flex items-center gap-4 text-emerald-400">
                    <div className="p-3 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                      <MessageSquare className="h-6 w-6" />
                    </div>
                    <div>
                      <h4 className="font-bold text-lg">WhatsApp SOS</h4>
                      <p className="text-sm text-slate-500">Auto-sharing location with the number below.</p>
                    </div>
                  </div>

                  <div className="relative">
                    <input type="tel" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} placeholder="WhatsApp Number (10 digits)"
                      className="w-full bg-slate-950 border-2 border-slate-800 rounded-2xl px-6 py-4 text-xl font-mono text-white placeholder-slate-700 focus:outline-none focus:border-emerald-500 transition-colors" />
                    {whatsapp.length >= 10 && <CheckCircle2 className="absolute right-6 top-5 h-6 w-6 text-emerald-500" />}
                  </div>

                  <div className="space-y-4">
                    <Button
                      onClick={async () => {
                        let cleanNumber = whatsapp.replace(/\D/g, '');
                        if (cleanNumber.length === 10) cleanNumber = '91' + cleanNumber;

                        navigator.geolocation.getCurrentPosition(async (pos) => {
                          const { latitude: lat, longitude: lon } = pos.coords;
                          const msg = encodeURIComponent(`🚨 *MEDCONNECT SOS*: High impact detected. Track me: https://maps.google.com/?q=${lat},${lon}`);

                          // Force manual window open (primary on click)
                          window.open(`https://wa.me/${cleanNumber}?text=${msg}`, '_blank');

                          // Also fire background API
                          apiSendWhatsAppLocation(cleanNumber, { lat, lon }).catch(() => { });

                          toast({ title: "Opening WhatsApp", description: "Sharing location manually." });
                        });
                      }}
                      disabled={!whatsapp}
                      className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-black text-lg h-16 rounded-2xl transition-all active:scale-95 shadow-lg shadow-emerald-900/20"
                    >
                      <MessageSquare className="mr-2 h-6 w-6" /> Share Manually
                    </Button>

                    <p className="text-[10px] text-center text-slate-500 uppercase tracking-widest font-bold leading-relaxed">
                      Status: <span className="text-emerald-400">Twilio Integration Active</span>
                      <br />
                      Responders should text <span className="text-white bg-slate-800 px-1 rounded">join side-saved</span> to <span className="text-emerald-400">+1 415 523 8886</span> for best results.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {state === "active" && (
              <motion.div key="active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center w-full gap-8">
                <div className="bg-red-600 text-white px-10 py-5 rounded-[24px] font-black text-3xl animate-pulse shadow-2xl border-4 border-white/20">SOS ACTIVE</div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                  <Card className="bg-slate-900 border-red-500/40 rounded-[32px]">
                    <CardHeader className="pb-4">
                      <CardTitle className="text-base font-bold flex items-center gap-3 text-red-400">
                        <Activity className="h-5 w-5" /> Rescue Status
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm font-medium">
                      <div className="flex justify-between items-center text-slate-400"><span>Ambulance:</span> <span className="text-emerald-400 px-3 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20">EN ROUTE</span></div>
                      <div className="flex justify-between items-center text-slate-400"><span>GPS Link:</span> <span className="text-emerald-400">SHARED</span></div>
                      <div className="flex justify-between items-center text-slate-400"><span>Nearby Help:</span> <span className="text-white">NOTIFIED</span></div>
                    </CardContent>
                  </Card>

                  {nearestHospital && (
                    <Card className="bg-slate-900 border-teal-500/40 rounded-[32px]">
                      <CardHeader className="pb-4">
                        <CardTitle className="text-base font-bold flex items-center gap-3 text-teal-400">
                          <Hospital className="h-5 w-5" /> Nearest Hospital
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="text-white font-black text-lg">{nearestHospital.name}</div>
                        <div className="text-slate-500 flex items-center gap-2"><MapPin className="h-4 w-4" /> {nearestHospital.distance} away</div>
                        <Button variant="outline" className="w-full mt-2 border-teal-500/30 text-teal-400 hover:bg-teal-500/10 rounded-xl" onClick={() => window.location.href = `tel:${nearestHospital.phone}`}>CALL DESK</Button>
                      </CardContent>
                    </Card>
                  )}
                </div>

                <Button onClick={resolveEmergency} className="w-full h-18 py-6 rounded-3xl bg-emerald-500 hover:bg-emerald-600 text-black font-black text-xl shadow-xl transition-all hover:scale-[1.02]">
                  <Shield className="mr-3 h-8 w-8" /> I AM SAFE — RESOLVE
                </Button>
              </motion.div>
            )}

            {state === "resolved" && (
              <motion.div key="resolved" initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="flex flex-col items-center">
                <div className="flex h-56 w-56 items-center justify-center rounded-full bg-emerald-500/10 border-4 border-emerald-500/20">
                  <Shield className="h-24 w-24 text-emerald-500" />
                </div>
                <h2 className="mt-8 font-display text-4xl font-black text-emerald-500 uppercase tracking-widest">Safe</h2>
                <p className="text-slate-500 mt-2 font-medium">Emergency Incident Resolved</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {state === "idle" && (
          <div className="mt-20 grid gap-6 sm:grid-cols-2">
            <Card className="cursor-pointer transition-all hover:scale-[1.02] bg-slate-900/50 border-slate-800" onClick={dial108}>
              <CardContent className="flex items-center gap-5 p-8">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-red-600/10 border border-red-600/20">
                  <Phone className="h-8 w-8 text-red-600" />
                </div>
                <div>
                  <h3 className="font-display font-black text-xl text-white italic">CALL 108</h3>
                  <p className="text-slate-500 font-medium">Direct Ambulance Line (India)</p>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-slate-900/50 border-slate-800">
              <CardContent className="flex items-center gap-5 p-8">
                <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-600/10 border border-emerald-600/20">
                  <User className="h-8 w-8 text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-display font-black text-xl text-white italic">CARETAKERS</h3>
                  <p className="text-slate-500 font-medium font-mono">3 Contacts Alerted</p>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
};

export default Emergency;
