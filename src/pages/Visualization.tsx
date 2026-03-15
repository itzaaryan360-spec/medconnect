import Navbar from "@/components/Navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Box, RotateCcw, ZoomIn, ZoomOut, Info } from "lucide-react";

const bodyParts = [
  { name: "Brain", status: "normal", x: "50%", y: "8%" },
  { name: "Heart", status: "attention", x: "45%", y: "30%" },
  { name: "Lungs", status: "normal", x: "55%", y: "28%" },
  { name: "Liver", status: "normal", x: "42%", y: "42%" },
  { name: "Kidneys", status: "warning", x: "50%", y: "48%" },
  { name: "Stomach", status: "normal", x: "52%", y: "44%" },
];

const statusColors: Record<string, string> = {
  normal: "bg-success",
  attention: "bg-warning",
  warning: "bg-emergency",
};

const Visualization = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container py-8">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="font-display text-3xl font-bold">3D Body Visualization</h1>
            <p className="mt-1 text-muted-foreground">
              Interactive anatomy view — highlights affected areas from your medical reports
            </p>
          </div>
          <div className="hidden items-center gap-2 md:flex">
            <Button variant="outline" size="icon"><ZoomIn className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon"><ZoomOut className="h-4 w-4" /></Button>
            <Button variant="outline" size="icon"><RotateCcw className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* 3D viewport placeholder */}
          <div className="lg:col-span-2">
            <Card className="overflow-hidden">
              <CardContent className="relative flex aspect-[4/5] items-center justify-center bg-muted/30 p-0 md:aspect-[3/4]">
                {/* SVG Body silhouette placeholder */}
                <div className="relative h-full w-full max-w-xs">
                  <svg viewBox="0 0 200 500" className="h-full w-full" fill="none" xmlns="http://www.w3.org/2000/svg">
                    {/* Head */}
                    <ellipse cx="100" cy="45" rx="30" ry="35" className="fill-primary/10 stroke-primary/30" strokeWidth="1.5"/>
                    {/* Neck */}
                    <rect x="90" y="78" width="20" height="20" rx="5" className="fill-primary/10 stroke-primary/30" strokeWidth="1.5"/>
                    {/* Torso */}
                    <path d="M60 98 L60 250 Q60 280 80 300 L120 300 Q140 280 140 250 L140 98 Q140 95 120 95 L80 95 Q60 95 60 98Z" className="fill-primary/10 stroke-primary/30" strokeWidth="1.5"/>
                    {/* Arms */}
                    <path d="M60 105 L30 180 L25 240 L35 240 L45 185 L60 140" className="fill-primary/10 stroke-primary/30" strokeWidth="1.5"/>
                    <path d="M140 105 L170 180 L175 240 L165 240 L155 185 L140 140" className="fill-primary/10 stroke-primary/30" strokeWidth="1.5"/>
                    {/* Legs */}
                    <path d="M80 300 L70 420 L60 480 L85 480 L90 420 L95 310" className="fill-primary/10 stroke-primary/30" strokeWidth="1.5"/>
                    <path d="M120 300 L130 420 L140 480 L115 480 L110 420 L105 310" className="fill-primary/10 stroke-primary/30" strokeWidth="1.5"/>
                  </svg>

                  {/* Organ markers */}
                  {bodyParts.map((part) => (
                    <div
                      key={part.name}
                      className="absolute -translate-x-1/2 -translate-y-1/2"
                      style={{ left: part.x, top: part.y }}
                    >
                      <div className="group relative cursor-pointer">
                        <div className={`h-4 w-4 rounded-full ${statusColors[part.status]} shadow-md ring-2 ring-background`} />
                        <div className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 transition-opacity group-hover:opacity-100">
                          {part.name} — {part.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="absolute bottom-4 left-4 right-4 flex items-center gap-2 rounded-lg bg-background/80 p-3 text-sm backdrop-blur">
                  <Box className="h-4 w-4 text-primary" />
                  <span className="text-muted-foreground">
                    Interactive 3D model will load here. Upload a report to highlight affected areas.
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Info panel */}
          <div className="space-y-4">
            <Card>
              <CardContent className="p-6">
                <h3 className="mb-4 font-display text-lg font-semibold">Organ Status</h3>
                <div className="space-y-3">
                  {bodyParts.map((part) => (
                    <div key={part.name} className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-3">
                        <div className={`h-3 w-3 rounded-full ${statusColors[part.status]}`} />
                        <span className="text-sm font-medium">{part.name}</span>
                      </div>
                      <span className="text-xs capitalize text-muted-foreground">{part.status}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start gap-3 p-6">
                <Info className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">How it works</p>
                  <p className="mt-1">
                    Upload a medical report and our AI maps diagnosed conditions to the 3D body model, 
                    highlighting affected organs with color-coded severity.
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <h3 className="mb-2 font-display font-semibold">Legend</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2"><div className="h-3 w-3 rounded-full bg-success" /> Normal</div>
                  <div className="flex items-center gap-2"><div className="h-3 w-3 rounded-full bg-warning" /> Needs Attention</div>
                  <div className="flex items-center gap-2"><div className="h-3 w-3 rounded-full bg-emergency" /> Warning</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
};

export default Visualization;
