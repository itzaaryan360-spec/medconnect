/**
 * Connect Care — useVitals Hook
 * ─────────────────────────────
 * Polls /api/vitals/history and /api/vitals/submit.
 * Exposes: currentVitals, thresholds, trends, riskFlags, loading, error.
 * Auto-refreshes every 30s. Sounds a toast on critical threshold breach.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    VitalsReading, ThresholdResult, TrendResult, RiskFlag,
    VitalsSubmitResponse, VitalsHistorySummary
} from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

const BASE_URL = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:5000';
const POLL_MS = 30_000;   // 30 seconds
const HISTORY_WINDOW = 24; // readings per metric in summary

export interface UseVitalsReturn {
    currentVitals: VitalsReading;
    thresholds: ThresholdResult[];
    trends: TrendResult[];
    riskFlags: RiskFlag[];
    historySummary: Record<string, VitalsHistorySummary>;
    loading: boolean;
    error: string | null;
    submitVitals: (reading: VitalsReading & { patient_id?: string }) => Promise<VitalsSubmitResponse | null>;
    refresh: () => void;
}

export function useVitals(patientId = 'local'): UseVitalsReturn {
    const { toast } = useToast();
    const [currentVitals, setCurrentVitals] = useState<VitalsReading>({});
    const [thresholds, setThresholds] = useState<ThresholdResult[]>([]);
    const [trends, setTrends] = useState<TrendResult[]>([]);
    const [riskFlags, setRiskFlags] = useState<RiskFlag[]>([]);
    const [historySummary, setHistorySummary] = useState<Record<string, VitalsHistorySummary>>({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // Track which flags we've already toasted so we don't re-fire every poll
    const alertedFlagsRef = useRef<Set<string>>(new Set());

    // ── Fetch history & summary ──────────────────────────────────────────────
    const fetchHistory = useCallback(async () => {
        try {
            const res = await fetch(`${BASE_URL}/api/vitals/history/${encodeURIComponent(patientId)}`);
            if (!res.ok) return;
            const data = await res.json();
            if (data.status === 'ok') {
                setHistorySummary(data.summary ?? {});
                // Set currentVitals from latest readings in summary
                const latest: VitalsReading = {};
                for (const [metric, summary] of Object.entries(data.summary ?? {})) {
                    (latest as Record<string, number>)[metric] = (summary as VitalsHistorySummary).latest;
                }
                setCurrentVitals(prev => ({ ...prev, ...latest }));
            }
        } catch (e) {
            // Silently ignore network failures during background poll
        }
    }, [patientId]);

    // ── Submit a new reading ─────────────────────────────────────────────────
    const submitVitals = useCallback(async (
        reading: VitalsReading & { patient_id?: string }
    ): Promise<VitalsSubmitResponse | null> => {
        setLoading(true);
        setError(null);
        try {
            const payload = { patient_id: patientId, ...reading };
            const res = await fetch(`${BASE_URL}/api/vitals/submit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data: VitalsSubmitResponse = await res.json();
            if (!res.ok) throw new Error(data.status);

            setCurrentVitals(data.current_vitals);
            setThresholds(data.threshold_results);
            setTrends(data.trends);
            setRiskFlags(data.risk_flags);

            // ── Alert on critical flags (de-duplicated) ─────────────────────────
            for (const flag of data.risk_flags) {
                if (flag.severity === 'critical' && !alertedFlagsRef.current.has(flag.flag_id)) {
                    alertedFlagsRef.current.add(flag.flag_id);
                    toast({
                        title: `🚨 ${flag.title}`,
                        description: flag.recommendation,
                        variant: 'destructive',
                        duration: 8000,
                    });
                } else if (flag.severity === 'warning' && !alertedFlagsRef.current.has(flag.flag_id)) {
                    alertedFlagsRef.current.add(flag.flag_id);
                    toast({
                        title: `⚠️ ${flag.title}`,
                        description: flag.detail,
                        duration: 6000,
                    });
                }
            }

            // Auto-emergency triggered
            if (data.auto_emergency_triggered) {
                toast({
                    title: '🚨 Emergency Auto-Triggered',
                    description: 'Critical vitals detected — emergency response activated.',
                    variant: 'destructive',
                    duration: 10000,
                });
            }

            // Refresh history after submitting
            await fetchHistory();
            return data;
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Vitals submission failed.';
            setError(msg);
            return null;
        } finally {
            setLoading(false);
        }
    }, [patientId, toast, fetchHistory]);

    // ── Polling ──────────────────────────────────────────────────────────────
    const refresh = useCallback(() => { void fetchHistory(); }, [fetchHistory]);

    useEffect(() => {
        void fetchHistory();
        const timer = setInterval(fetchHistory, POLL_MS);
        return () => clearInterval(timer);
    }, [fetchHistory]);

    return { currentVitals, thresholds, trends, riskFlags, historySummary, loading, error, submitVitals, refresh };
}
