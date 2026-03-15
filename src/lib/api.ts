/**
 * MedLex API Service
 * Handles all communication with the Flask backend.
 * Backend URL is configured via VITE_BACKEND_URL env variable,
 * defaulting to http://localhost:5000.
 */

const BASE_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

// ─── Types ────────────────────────────────────────────────────────────────────

export const SUPPORTED_LANGUAGES = [
    'English', 'Hindi', 'Telugu', 'Kannada', 'Malayalam', 'Tamil', 'Odia'
] as const;

export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

export interface SummarySections {
    report_summary: string;
    key_points: string[];
    disclaimer: string;
}

export interface ProcessReportResponse {
    status: 'success' | 'error';
    session_id?: string;
    filename?: string;
    extracted_text?: string;
    entities?: Record<string, string[]>;
    simplified_summary?: string;
    affected_anatomy?: string[];
    language?: string;
    message?: string;
}

export interface SummarizeReportResponse extends ProcessReportResponse {
    sections?: SummarySections;
    supported_languages?: string[];
}

export interface HealthCheckResponse {
    status: string;
    timestamp: string;
    services: {
        ocr_tesseract: boolean;
        nlp_spacy: boolean;
        nlp_model: string;
        ai_ollama: boolean;
        pdf_support: boolean;
    };
}

export interface SessionLog {
    session_id: string;
    timestamp: string;
    filename: string;
    status: string;
    affected_anatomy: string[];
}

export interface ReportExportPayload {
    filename: string;
    simplified_summary: string;
    affected_anatomy: string[];
    entities: Record<string, string[]>;
}

// ─── Storage Key ──────────────────────────────────────────────────────────────

export const REPORT_STORAGE_KEY = 'lastReport';

// ─── API Calls ────────────────────────────────────────────────────────────────

/**
 * Upload a medical report file (PDF, JPG, PNG) to the backend for processing.
 * Returns structured data: extracted text, NER entities, AI summary, affected anatomy.
 * @param language - Optional language for the AI summary (defaults to English on backend).
 */
export async function processReport(
    file: File,
    language: SupportedLanguage = 'English'
): Promise<ProcessReportResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('language', language);

    const response = await fetch(`${BASE_URL}/api/process-report`, {
        method: 'POST',
        body: formData,
    });

    const data: ProcessReportResponse = await response.json();

    if (!response.ok) {
        throw new Error(data.message || `Server error: ${response.status}`);
    }

    return data;
}

/**
 * Primary multilingual endpoint: upload a medical document and get a
 * structured LLaMA 3 summary (Report Summary / Key Points / Disclaimer)
 * in the chosen language.
 */
export async function summarizeReport(
    file: File,
    language: SupportedLanguage = 'English'
): Promise<SummarizeReportResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('language', language);

    const response = await fetch(`${BASE_URL}/api/summarize-report`, {
        method: 'POST',
        body: formData,
    });

    const data: SummarizeReportResponse = await response.json();

    if (!response.ok) {
        throw new Error(data.message || `Server error: ${response.status}`);
    }

    return data;
}

/**
 * Chat with the AI assistant about symptoms or the report.
 */
export async function chatWithAI(
    message: string,
    reportSummary: string,
    language: string = 'English'
): Promise<{ status: string; response: string; message?: string }> {
    const response = await fetch(`${BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, report_summary: reportSummary, language }),
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.message || `Server error: ${response.status}`);
    }
    return data;
}

/**
 * Check the health and service status of the backend.
 */
export async function checkHealth(): Promise<HealthCheckResponse> {
    const response = await fetch(`${BASE_URL}/api/health`);
    if (!response.ok) throw new Error('Backend health check failed');
    return response.json();
}

/**
 * Trigger a download of the processed report as a .txt file.
 * Calls the /api/export-report endpoint and initiates browser download.
 */
export async function downloadReport(payload: ReportExportPayload): Promise<void> {
    const response = await fetch(`${BASE_URL}/api/export-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ message: 'Export failed' }));
        throw new Error(err.message || 'Export failed');
    }

    // Stream the file to the browser as a download
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const contentDisposition = response.headers.get('content-disposition') || '';
    const nameMatch = contentDisposition.match(/filename="?([^"]+)"?/);
    anchor.download = nameMatch?.[1] || 'medlex_report.txt';
    anchor.href = url;
    anchor.click();
    URL.revokeObjectURL(url);
}

/**
 * Fetch recent session logs from the backend.
 */
export async function fetchSessionLogs(): Promise<SessionLog[]> {
    const response = await fetch(`${BASE_URL}/api/session-logs`);
    if (!response.ok) throw new Error('Failed to fetch session logs');
    const data = await response.json();
    return data.logs ?? [];
}

// ─── LocalStorage Helpers ─────────────────────────────────────────────────────

/** Save a processed report result to localStorage for use by ThreeDView. */
export function saveReportToStorage(data: ProcessReportResponse): void {
    const record = {
        name: data.filename,
        session_id: data.session_id,
        date: new Date().toISOString(),
        affected_anatomy: data.affected_anatomy ?? [],
        summary: data.simplified_summary ?? '',
        entities: data.entities ?? {},
        extracted_text: data.extracted_text?.slice(0, 500) ?? '',  // Store a preview
    };
    localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(record));
}

/** Load the last saved report from localStorage. */
export function loadReportFromStorage(): ReturnType<typeof saveReportToStorage> | null {
    try {
        const raw = localStorage.getItem(REPORT_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}
