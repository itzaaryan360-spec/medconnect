import { useState, useCallback } from "react";
import Navbar from "@/components/Navbar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Upload, FileText, CheckCircle, Loader2, Brain,
  AlertCircle, Download, Activity, ChevronDown, ChevronUp,
  Globe, Sparkles, ShieldCheck, ListChecks, Send, MessageSquareText
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import {
  summarizeReport,
  saveReportToStorage,
  downloadReport,
  SUPPORTED_LANGUAGES,
  SummarizeReportResponse,
  SupportedLanguage,
  chatWithAI,
} from "@/lib/api";

// ── Language metadata ─────────────────────────────────────────────────────────
const LANGUAGE_META: Record<SupportedLanguage, { flag: string; native: string }> = {
  English: { flag: "🇬🇧", native: "English" },
  Hindi: { flag: "🇮🇳", native: "हिन्दी" },
  Telugu: { flag: "🇮🇳", native: "తెలుగు" },
  Kannada: { flag: "🇮🇳", native: "ಕನ್ನಡ" },
  Malayalam: { flag: "🇮🇳", native: "മലയാളം" },
  Tamil: { flag: "🇮🇳", native: "தமிழ்" },
  Odia: { flag: "🇮🇳", native: "ଓଡ଼ିଆ" },
};

// ── Offline demo helper ───────────────────────────────────────────────────────
function buildDemoResult(filename: string, language: SupportedLanguage): SummarizeReportResponse {
  return {
    status: "success",
    session_id: "demo-session",
    filename,
    language,
    affected_anatomy: ["Lungs", "Heart"],
    simplified_summary:
      "⚠️ Backend offline — showing demo result.\n\n" +
      "Report Summary:\nThe patient shows signs of mild respiratory infection affecting the lungs. " +
      "A mildly elevated heart rate has been detected. No critical findings are present. " +
      "The doctor recommends a follow-up visit in 2 weeks.\n\n" +
      "Key Points:\n- Mild respiratory infection detected\n- Heart rate slightly elevated\n- No critical findings\n- Follow-up in 2 weeks recommended\n\n" +
      "Disclaimer:\nThis summary is for understanding purposes only and not a medical diagnosis.",
    sections: {
      report_summary:
        "The patient shows signs of mild respiratory infection affecting the lungs. " +
        "A mildly elevated heart rate has been detected. No critical findings are present. " +
        "A follow-up visit in 2 weeks is recommended.",
      key_points: [
        "Mild respiratory infection detected",
        "Heart rate slightly elevated",
        "No critical findings present",
        "Follow-up appointment in 2 weeks recommended",
      ],
      disclaimer: "This summary is for understanding purposes only and not a medical diagnosis.",
    },
    entities: { CONDITION: ["respiratory infection", "elevated heart rate"] },
    extracted_text: "(Backend not running — demo mode active)",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
const Reports = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<SummarizeReportResponse | null>(null);
  const [showFullText, setShowFullText] = useState(false);
  const [selectedLang, setSelectedLang] = useState<SupportedLanguage>("English");
  const { toast } = useToast();
  const navigate = useNavigate();

  // ── Chat State ──────────────────────────────────────────────────────────────
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // ── Drag & Drop ─────────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleUpload(files[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLang]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) handleUpload(e.target.files[0]);
  };

  // ── Upload & Summarize ──────────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    setIsUploading(true);
    setResult(null);

    try {
      const data = await summarizeReport(file, selectedLang);

      if (data.status === "error") {
        toast({
          title: "Processing Failed",
          description: data.message || "Could not process this file.",
          variant: "destructive",
        });
        return;
      }

      saveReportToStorage(data);
      setResult(data);
      toast({
        title: "✅ Report Summarized",
        description: `AI summary ready in ${selectedLang}. ${data.affected_anatomy?.length ?? 0} area(s) identified.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "An unexpected error occurred.";

      // Graceful offline fallback
      if (msg.includes("fetch") || msg.includes("Failed to fetch") || msg.includes("ECONNREFUSED")) {
        const demo = buildDemoResult(file.name, selectedLang);
        saveReportToStorage(demo);
        setResult(demo);
        toast({
          title: "Demo Mode",
          description: "Backend not reachable. Showing sample result. Start Flask server to process real reports.",
        });
      } else {
        toast({ title: "Upload Error", description: msg, variant: "destructive" });
      }
    } finally {
      setIsUploading(false);
    }
  };

  // ── Export ──────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    if (!result) return;
    try {
      await downloadReport({
        filename: result.filename ?? "report",
        simplified_summary: result.simplified_summary ?? "",
        affected_anatomy: result.affected_anatomy ?? [],
        entities: result.entities ?? {},
      });
      toast({ title: "Report Downloaded", description: "Saved as .txt file." });
    } catch {
      toast({ title: "Export Failed", description: "Could not generate export.", variant: "destructive" });
    }
  };

  // ── Chat Handler ─────────────────────────────────────────────────────────────
  const handleSendMessage = async () => {
    if (!chatInput.trim() || !result) return;
    const userMsg = chatInput.trim();
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
    setChatInput("");
    setIsChatLoading(true);

    try {
      const summaryText = result.simplified_summary || result.sections?.report_summary || "";
      const data = await chatWithAI(userMsg, summaryText, selectedLang);
      setChatHistory(prev => [...prev, { role: 'ai', content: data.response }]);
    } catch (err: any) {
      toast({
        title: "Chat Error",
        description: err.message || "Could not connect to health assistant.",
        variant: "destructive",
      });
    } finally {
      setIsChatLoading(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* ── Page Styles ───────────────────────────────────────────────────── */}
      <style>{`
        .lang-pill {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 14px; border-radius: 999px; cursor: pointer;
          font-size: 13px; font-weight: 500; transition: all .2s;
          border: 1.5px solid transparent;
          background: hsl(var(--muted));
          color: hsl(var(--muted-foreground));
        }
        .lang-pill:hover { border-color: hsl(var(--primary)/0.4); background: hsl(var(--primary)/0.06); }
        .lang-pill.active {
          background: hsl(var(--primary)/0.12);
          border-color: hsl(var(--primary)/0.7);
          color: hsl(var(--primary));
        }
        .section-card {
          border-radius: 16px; border: 1px solid hsl(var(--border));
          background: hsl(var(--card)); padding: 24px;
          animation: fadeSlide .35s ease both;
        }
        @keyframes fadeSlide {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .section-icon-bg {
          width: 38px; height: 38px; border-radius: 10px;
          display: flex; align-items: center; justify-content: center; flex-shrink: 0;
        }
        .key-point-item {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 10px 14px; border-radius: 10px;
          background: hsl(var(--muted)/0.5); font-size: 14px; line-height: 1.55;
        }
        .key-point-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: hsl(var(--primary)); flex-shrink: 0; margin-top: 5px;
        }
        .disclaimer-strip {
          display: flex; align-items: flex-start; gap: 10px;
          padding: 14px 18px; border-radius: 12px;
          background: hsl(var(--muted)/0.4);
          border: 1px solid hsl(var(--border));
          font-size: 13px; color: hsl(var(--muted-foreground));
        }
        .llama-badge {
          display: inline-flex; align-items: center; gap: 6px;
          padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600;
          background: linear-gradient(135deg, hsl(260 80% 55% / 0.15), hsl(210 80% 55% / 0.15));
          border: 1px solid hsl(260 80% 55% / 0.3);
          color: hsl(260 70% 60%);
        }
        .upload-zone {
          position: relative; display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          min-height: 280px; border-radius: 18px;
          border: 2px dashed hsl(var(--border)); transition: all .25s;
          background: hsl(var(--card));
        }
        .upload-zone.dragging {
          border-color: hsl(var(--primary));
          background: hsl(var(--primary)/0.04);
          box-shadow: 0 0 0 4px hsl(var(--primary)/0.08);
        }
        .upload-icon-ring {
          width: 72px; height: 72px; border-radius: 20px;
          display: flex; align-items: center; justify-content: center;
          background: linear-gradient(135deg, hsl(var(--primary)/0.12), hsl(var(--primary)/0.06));
          margin-bottom: 18px;
        }
        .chat-container {
          border-radius: 20px; border: 1px solid hsl(var(--border)/0.8);
          background: hsl(var(--card)); display: flex; flex-direction: column;
          overflow: hidden; margin-top: 24px; box-shadow: 0 4px 20px -5px rgb(0 0 0 / 10%);
        }
        .chat-bubble {
          max-width: 85%; padding: 12px 16px; border-radius: 14px; font-size: 14px; line-height: 1.5;
        }
        .chat-bubble.user {
          align-self: flex-end; background: hsl(var(--primary)); color: hsl(var(--primary-foreground));
          border-bottom-right-radius: 4px;
        }
        .chat-bubble.ai {
          align-self: flex-start; background: hsl(var(--muted)); color: hsl(var(--foreground));
          border-bottom-left-radius: 4px;
        }
      `}</style>

      <main className="container py-10 max-w-3xl mx-auto">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="font-display text-3xl font-bold">Medical Report Explainer</h1>
            <p className="mt-1 text-muted-foreground text-sm">
              Upload any health document — our AI explains it in plain language.
            </p>
          </div>
          <span className="llama-badge hidden sm:inline-flex">
            <Brain className="h-3 w-3" />
            Powered by LLaMA 3
          </span>
        </div>

        {/* ── Language Selector ────────────────────────────────────────────── */}
        <div className="mt-6 rounded-2xl border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="section-icon-bg" style={{ background: "hsl(210 80% 55% / 0.12)" }}>
              <Globe className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="font-semibold text-sm">Output Language</p>
              <p className="text-xs text-muted-foreground">Summary will be generated in the selected language</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2" id="language-selector">
            {SUPPORTED_LANGUAGES.map((lang) => (
              <button
                key={lang}
                id={`lang-${lang.toLowerCase()}`}
                className={`lang-pill ${selectedLang === lang ? "active" : ""}`}
                onClick={() => setSelectedLang(lang)}
                type="button"
              >
                <span>{LANGUAGE_META[lang].flag}</span>
                <span>{LANGUAGE_META[lang].native}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Upload Zone ──────────────────────────────────────────────────── */}
        <div className="mt-6">
          <div
            id="upload-drop-zone"
            className={`upload-zone ${isDragging ? "dragging" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="upload-icon-ring">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">Upload Medical Document</h3>
            <p className="mt-2 text-center text-sm text-muted-foreground max-w-xs px-4">
              Drag &amp; drop a prescription, lab report, discharge summary, or scan.
              AI will extract and explain it in <strong>{LANGUAGE_META[selectedLang].native}</strong>.
            </p>

            <div className="mt-6">
              <Button asChild size="lg" id="choose-file-btn">
                <label className="cursor-pointer">
                  <input
                    type="file"
                    className="hidden"
                    onChange={handleFileChange}
                    accept=".pdf,.jpg,.png,.jpeg,.bmp,.tiff,.webp"
                    id="report-file-input"
                  />
                  {isUploading ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Analyzing Report…</>
                  ) : (
                    <><FileText className="mr-2 h-4 w-4" />Choose File</>
                  )}
                </label>
              </Button>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              Supports PDF, JPG, PNG, TIFF &bull; Max 20 MB &bull; Your data stays private
            </p>
          </div>
        </div>

        {/* ── AI Pipeline Info ─────────────────────────────────────────────── */}
        {!result && (
          <div className="mt-6 rounded-2xl border bg-card p-5">
            <h3 className="flex items-center gap-2 font-semibold text-sm text-primary mb-4">
              <Sparkles className="h-4 w-4" /> How It Works
            </h3>
            <ol className="space-y-2.5 text-sm text-muted-foreground">
              {[
                ["1", "OCR extracts text from scanned documents & PDFs"],
                ["2", "Medical terms are identified via spaCy Med7 NER"],
                ["3", "LLaMA 3 generates a structured, multilingual summary"],
                ["4", "Affected organs are mapped to a 3D anatomy model"],
              ].map(([n, label]) => (
                <li key={n} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                    {n}
                  </span>
                  {label}
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* ── Results ──────────────────────────────────────────────────────── */}
        {result && result.status === "success" && (
          <div className="mt-8 space-y-5" id="report-results">

            {/* Language badge */}
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="secondary" className="gap-1.5 text-xs py-1 px-3">
                <Globe className="h-3 w-3" />
                Summarized in: <strong>{result.language ?? selectedLang}</strong>
              </Badge>
              {(result.affected_anatomy?.length ?? 0) > 0 && (
                <Badge variant="outline" className="gap-1.5 text-xs py-1 px-3">
                  <Activity className="h-3 w-3 text-red-500" />
                  {result.affected_anatomy!.length} area(s) detected
                </Badge>
              )}
            </div>

            {/* ── Report Summary ──────────────────────────────────────────── */}
            {(result.sections?.report_summary || result.simplified_summary) && (
              <div className="section-card" id="report-summary-card">
                <div className="flex items-start gap-3 mb-4">
                  <div className="section-icon-bg" style={{ background: "hsl(260 80% 55% / 0.12)" }}>
                    <Brain className="h-5 w-5" style={{ color: "hsl(260 70% 60%)" }} />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base">Report Summary</h3>
                    <p className="text-xs text-muted-foreground">Plain-language explanation of your document</p>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-foreground whitespace-pre-line">
                  {result.sections?.report_summary || result.simplified_summary}
                </p>
              </div>
            )}

            {/* ── Key Points ─────────────────────────────────────────────── */}
            {(result.sections?.key_points?.length ?? 0) > 0 && (
              <div className="section-card" id="key-points-card">
                <div className="flex items-start gap-3 mb-4">
                  <div className="section-icon-bg" style={{ background: "hsl(145 65% 45% / 0.12)" }}>
                    <ListChecks className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base">Key Points</h3>
                    <p className="text-xs text-muted-foreground">Important findings at a glance</p>
                  </div>
                </div>
                <div className="space-y-2">
                  {result.sections!.key_points.map((point, i) => (
                    <div key={i} className="key-point-item">
                      <span className="key-point-dot" />
                      <span>{point}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Affected Anatomy ───────────────────────────────────────── */}
            {(result.affected_anatomy?.length ?? 0) > 0 && (
              <div className="section-card" id="affected-anatomy-card">
                <div className="flex items-start gap-3 mb-4">
                  <div className="section-icon-bg" style={{ background: "hsl(0 75% 55% / 0.1)" }}>
                    <Activity className="h-5 w-5 text-red-500" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base">Affected Areas Detected</h3>
                    <p className="text-xs text-muted-foreground">Organs & systems identified in the document</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mb-4">
                  {result.affected_anatomy!.map((organ) => (
                    <Badge key={organ} variant="destructive" className="text-sm">{organ}</Badge>
                  ))}
                </div>
                <Button
                  size="sm" variant="outline" id="view-3d-btn"
                  onClick={() => navigate("/3d-view")}
                  className="gap-2"
                >
                  <Activity className="h-4 w-4" />
                  View in 3D Anatomy Model
                </Button>
              </div>
            )}

            {/* ── Detected Entities ──────────────────────────────────────── */}
            {result.entities && Object.keys(result.entities).length > 0 && (
              <div className="section-card" id="entities-card">
                <div className="flex items-start gap-3 mb-4">
                  <div className="section-icon-bg" style={{ background: "hsl(38 90% 50% / 0.12)" }}>
                    <CheckCircle className="h-5 w-5 text-amber-500" />
                  </div>
                  <h3 className="font-semibold text-base self-center">Detected Medical Terms</h3>
                </div>
                <div className="space-y-2">
                  {Object.entries(result.entities).map(([label, terms]) => (
                    <div key={label} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium text-muted-foreground w-28 shrink-0 text-xs uppercase tracking-wide">
                        {label}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {terms.slice(0, 8).map((t) => (
                          <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Disclaimer ─────────────────────────────────────────────── */}
            <div className="disclaimer-strip" id="disclaimer-strip">
              <ShieldCheck className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <span>
                <strong>Disclaimer: </strong>
                {result.sections?.disclaimer ||
                  "This summary is for understanding purposes only and not a medical diagnosis."}
              </span>
            </div>

            {/* ── Extracted Text Collapsible ─────────────────────────────── */}
            {result.extracted_text && result.extracted_text !== "(Backend not running — demo mode active)" && (
              <div className="section-card" id="extracted-text-card">
                <button
                  className="flex w-full items-center justify-between font-semibold text-sm"
                  onClick={() => setShowFullText((v) => !v)}
                  id="toggle-extracted-text"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    Raw Extracted Text
                  </span>
                  {showFullText ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {showFullText && (
                  <pre className="mt-3 max-h-64 overflow-y-auto rounded-lg bg-muted p-3 text-xs leading-relaxed whitespace-pre-wrap">
                    {result.extracted_text}
                  </pre>
                )}
              </div>
            )}

            {/* ── Action Buttons ────────────────────────────────────────────── */}
            <div className="flex flex-wrap gap-3 pt-1">
              <Button onClick={handleExport} variant="outline" className="gap-2" id="export-report-btn">
                <Download className="h-4 w-4" /> Export Report
              </Button>
              <Button onClick={() => navigate("/3d-view")} className="gap-2" id="open-3d-view-btn">
                <Activity className="h-4 w-4" /> Open 3D View
              </Button>
            </div>

            {/* ── Interactive Health Assistant ─────────────────────────────── */}
            <div className="chat-container" id="health-assistant-chat">
              <div className="p-4 border-b bg-muted/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4 text-primary" />
                  <span className="font-semibold text-sm">Interactive Health Assistant</span>
                </div>
                <Badge variant="outline" className="text-[10px] uppercase tracking-wider">Online</Badge>
              </div>

              <div className="p-5 space-y-4 max-h-[400px] overflow-y-auto flex flex-col min-h-[120px]">
                {chatHistory.length === 0 ? (
                  <div className="text-center py-6">
                    <Sparkles className="h-8 w-8 text-muted/40 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground">
                      Ask about your symptoms or have the AI explain specific parts of the report.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2 justify-center">
                      {[
                        "What are the symptoms of this?",
                        "Is this report serious?",
                        "What do I do next?",
                      ].map(suggestion => (
                        <button
                          key={suggestion}
                          onClick={() => setChatInput(suggestion)}
                          className="text-[11px] px-3 py-1.5 rounded-full border bg-muted/50 hover:bg-muted transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  chatHistory.map((chat, i) => (
                    <div key={i} className={`chat-bubble ${chat.role}`}>
                      {chat.content}
                    </div>
                  ))
                )}
                {isChatLoading && (
                  <div className="chat-bubble ai flex items-center gap-2 italic text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Thinking...
                  </div>
                )}
              </div>

              <div className="p-3 border-t bg-muted/10">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Describe your symptoms or ask a question..."
                    className="w-full bg-background border rounded-xl pl-4 pr-12 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={!chatInput.trim() || isChatLoading}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-primary disabled:text-muted-foreground transition-colors"
                  >
                    <Send className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Session ID */}
            {result.session_id && (
              <p className="text-xs text-muted-foreground">
                Session ID: <span className="font-mono">{result.session_id}</span>
              </p>
            )}
          </div>
        )}

        {/* ── Error State ───────────────────────────────────────────────────── */}
        {result && result.status === "error" && (
          <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5 p-6 flex items-start gap-3"
            id="error-state">
            <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-destructive">Processing Failed</p>
              <p className="mt-1 text-sm text-muted-foreground">{result.message}</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default Reports;