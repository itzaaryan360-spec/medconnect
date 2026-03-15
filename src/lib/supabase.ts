import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Will be null if env vars are not set (graceful degradation)
export const supabase =
    supabaseUrl && supabaseAnon
        ? createClient(supabaseUrl, supabaseAnon)
        : null;

export const SUPABASE_ENABLED = supabase !== null;

// ── Auth helpers ──────────────────────────────────────────────────────────────

export async function supabaseSignUp(email: string, password: string, name: string, role: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signUp({
        email, password,
        options: { data: { name, role } },
    });
    if (error) throw error;
    return data;
}

export async function supabaseSignIn(email: string, password: string) {
    if (!supabase) throw new Error('Supabase not configured');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
}

export async function supabaseSignOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
}

export async function supabaseGetSession() {
    if (!supabase) return null;
    const { data } = await supabase.auth.getSession();
    return data.session;
}

// ── Report history ────────────────────────────────────────────────────────────

export interface ReportRecord {
    id: number;
    user_id: string;
    filename: string;
    summary: string;
    affected_anatomy: string[];
    entities: Record<string, string[]>;
    storage_path: string;
    uploaded_at: string;
}

export async function fetchUserReports(userId: string): Promise<ReportRecord[]> {
    if (!supabase) return [];
    const { data } = await supabase
        .from('reports')
        .select('*')
        .eq('user_id', userId)
        .order('uploaded_at', { ascending: false })
        .limit(50);
    return (data as ReportRecord[]) ?? [];
}

export async function getReportSignedUrl(storagePath: string): Promise<string> {
    if (!supabase || !storagePath) return '';
    const { data } = await supabase.storage
        .from('reports')
        .createSignedUrl(storagePath, 3600);
    return data?.signedUrl ?? '';
}

// ── Vitals ────────────────────────────────────────────────────────────────────

export interface VitalsRow {
    id: number;
    patient_id: string;
    heart_rate: number | null;
    systolic_bp: number | null;
    diastolic_bp: number | null;
    spo2: number | null;
    temperature_f: number | null;
    respiratory_rate: number | null;
    recorded_at: string;
}

export async function fetchVitalsHistory(patientId: string, limit = 50): Promise<VitalsRow[]> {
    if (!supabase) return [];
    const { data } = await supabase
        .from('vitals')
        .select('*')
        .eq('patient_id', patientId)
        .order('recorded_at', { ascending: false })
        .limit(limit);
    return (data as VitalsRow[]) ?? [];
}
