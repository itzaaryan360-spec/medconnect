import React, { useState, useCallback } from 'react';
import Navbar from "@/components/Navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ZoomIn, ZoomOut, RotateCcw, Download, FileText, Brain, Activity } from "lucide-react";
import { Link, useNavigate } from 'react-router-dom';
import { downloadReport } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type LayerKey = 'organs' | 'skeletal' | 'cardiovascular' | 'nervous' | 'muscular';

const LAYER_META: { key: LayerKey; label: string; color: string; icon: string }[] = [
  { key: 'organs', label: 'Organs', color: '#f97316', icon: '🫁' },
  { key: 'skeletal', label: 'Skeletal', color: '#d4b896', icon: '🦴' },
  { key: 'cardiovascular', label: 'Cardiovascular', color: '#ef4444', icon: '❤️' },
  { key: 'nervous', label: 'Nervous', color: '#a855f7', icon: '🧠' },
  { key: 'muscular', label: 'Muscular', color: '#dc2626', icon: '💪' },
];

interface OrganDef {
  name: string; cx: number; cy: number;
  color: string; desc: string;
  path: string;
}

const ORGANS: OrganDef[] = [
  {
    name: 'Brain', cx: 150, cy: 52, color: '#f59e0b',
    desc: 'Central nervous system — cognition, motor control, autonomic functions.',
    path: 'M150 18 C128 18 114 30 112 46 C110 62 118 76 130 80 C134 86 140 88 150 88 C160 88 166 86 170 80 C182 76 190 62 188 46 C186 30 172 18 150 18Z',
  },
  {
    name: 'Heart', cx: 144, cy: 248, color: '#ef4444',
    desc: 'Cardiac pump — circulates ~5 L of blood per minute at rest.',
    path: 'M144 232 C141 224 130 224 130 234 C130 242 138 250 144 258 C150 250 158 242 158 234 C158 224 147 224 144 232Z',
  },
  {
    name: 'Left Lung', cx: 124, cy: 232, color: '#93c5fd',
    desc: 'Left respiratory lobe — two lobes, gas exchange (O₂/CO₂).',
    path: 'M124 190 C110 192 100 204 100 218 C100 240 106 258 112 268 C116 276 120 278 126 276 C132 274 136 266 136 254 C138 242 138 228 136 216 C134 202 130 190 124 190Z',
  },
  {
    name: 'Right Lung', cx: 176, cy: 232, color: '#93c5fd',
    desc: 'Right respiratory lobe — three lobes, slightly larger than left.',
    path: 'M176 190 C190 192 200 204 200 218 C200 244 194 264 188 272 C184 278 180 280 174 278 C168 276 164 268 162 256 C160 244 160 228 162 216 C164 202 170 190 176 190Z',
  },
  {
    name: 'Liver', cx: 172, cy: 298, color: '#92400e',
    desc: 'Metabolic hub — detoxification, bile production, glycogen storage.',
    path: 'M148 280 C158 280 170 282 180 286 C190 290 198 298 198 308 C198 318 190 324 178 326 C166 328 154 326 146 320 C138 314 134 304 136 294 C138 284 144 280 148 280Z',
  },
  {
    name: 'Stomach', cx: 130, cy: 300, color: '#84cc16',
    desc: 'J-shaped digestive organ — acid-based protein breakdown, ~1L capacity.',
    path: 'M122 284 C114 286 110 296 112 306 C114 316 120 324 128 326 C136 328 142 322 142 312 C144 302 142 292 136 286 C132 282 126 284 122 284Z',
  },
  {
    name: 'Spleen', cx: 106, cy: 288, color: '#c084fc',
    desc: 'Immune organ — filters blood, recycles red blood cells.',
    path: 'M106 274 C98 276 94 284 96 292 C98 300 104 304 110 302 C116 300 118 294 116 286 C114 278 110 274 106 274Z',
  },
  {
    name: 'Kidneys', cx: 150, cy: 342, color: '#fb923c',
    desc: 'Paired filtration organs — regulate fluid, electrolytes and acid-base balance.',
    path: 'M120 332 C114 332 110 338 110 344 C110 352 114 358 120 360 C126 362 132 358 134 352 C136 346 134 338 130 334 C126 332 122 332 120 332Z M180 332 C186 332 190 338 190 344 C190 352 186 358 180 360 C174 362 168 358 166 352 C164 346 166 338 170 334 C174 332 178 332 180 332Z',
  },
  {
    name: 'Intestines', cx: 150, cy: 390, color: '#f97316',
    desc: 'Small + large intestine — 8–9m total, nutrient absorption and waste.',
    path: 'M150 356 C132 356 116 364 112 378 C108 392 114 410 122 420 C130 430 142 436 152 436 C162 436 174 432 180 422 C188 412 190 394 184 380 C178 366 164 356 150 356Z',
  },
  {
    name: 'Bladder', cx: 150, cy: 446, color: '#bfdbfe',
    desc: 'Urine reservoir — typical capacity 400–600 mL.',
    path: 'M150 434 C140 434 132 440 130 448 C128 456 132 464 140 468 C144 470 150 470 156 468 C164 464 168 456 166 448 C164 440 158 434 150 434Z',
  },
];

// ── SVG Layers ─────────────────────────────────────────────────────────────────

const BodyOutline = ({ opacity = 1 }: { opacity?: number }) => (
  <g opacity={opacity}>
    <defs>
      <radialGradient id="skinGrad" cx="40%" cy="30%" r="65%">
        <stop offset="0%" stopColor="#f5d5b8" />
        <stop offset="60%" stopColor="#e8b89a" />
        <stop offset="100%" stopColor="#c9956a" />
      </radialGradient>
      <radialGradient id="skinDark" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="#e8b89a" />
        <stop offset="100%" stopColor="#b87754" />
      </radialGradient>
      <filter id="bodyShad">
        <feDropShadow dx="2" dy="4" stdDeviation="5" floodColor="#00000044" />
      </filter>
    </defs>
    {/* Head */}
    <ellipse cx="150" cy="52" rx="42" ry="48" fill="url(#skinGrad)" filter="url(#bodyShad)" />
    {/* Ear left */}
    <ellipse cx="108" cy="54" rx="8" ry="12" fill="url(#skinDark)" />
    {/* Ear right */}
    <ellipse cx="192" cy="54" rx="8" ry="12" fill="url(#skinDark)" />
    {/* Eyes */}
    <ellipse cx="137" cy="48" rx="7" ry="8" fill="#2d1a0e" />
    <ellipse cx="163" cy="48" rx="7" ry="8" fill="#2d1a0e" />
    <ellipse cx="135" cy="46" rx="2" ry="2.5" fill="#fff8" />
    <ellipse cx="161" cy="46" rx="2" ry="2.5" fill="#fff8" />
    {/* Eyebrows */}
    <path d="M130 38 Q137 34 144 37" stroke="#7a4a2a" strokeWidth="2" fill="none" strokeLinecap="round" />
    <path d="M156 37 Q163 34 170 38" stroke="#7a4a2a" strokeWidth="2" fill="none" strokeLinecap="round" />
    {/* Nose */}
    <path d="M147 56 L144 66 Q150 70 156 66 L153 56" stroke="#c49070" strokeWidth="1.2" fill="none" />
    {/* Mouth */}
    <path d="M140 76 Q150 82 160 76" stroke="#c07060" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    {/* Neck */}
    <path d="M134 98 Q130 115 120 132 L180 132 Q170 115 166 98 Z" fill="url(#skinGrad)" />
    {/* Torso */}
    <path d="M88 134 Q76 162 78 192 Q80 248 102 292 Q98 338 90 382 L210 382 Q202 338 198 292 Q220 248 222 192 Q224 162 212 134 Z" fill="url(#skinGrad)" filter="url(#bodyShad)" />
    {/* Chest pectoral lines */}
    <path d="M150 155 Q130 165 112 160" stroke="#c9956a55" strokeWidth="1.5" fill="none" />
    <path d="M150 155 Q170 165 188 160" stroke="#c9956a55" strokeWidth="1.5" fill="none" />
    {/* Navel */}
    <ellipse cx="150" cy="290" rx="5" ry="4" fill="#c9956a" opacity="0.5" />
    {/* Left arm */}
    <path d="M90 158 L76 160 L56 268 L72 272 Z" fill="url(#skinGrad)" />
    <ellipse cx="64" cy="270" rx="14" ry="10" fill="url(#skinGrad)" />
    <path d="M56 272 L42 272 L36 360 L50 360 Z" fill="url(#skinGrad)" />
    <ellipse cx="42" cy="384" rx="16" ry="24" fill="url(#skinGrad)" />
    {/* Right arm */}
    <path d="M210 158 L224 160 L244 268 L228 272 Z" fill="url(#skinGrad)" />
    <ellipse cx="236" cy="270" rx="14" ry="10" fill="url(#skinGrad)" />
    <path d="M244 272 L258 272 L264 360 L250 360 Z" fill="url(#skinGrad)" />
    <ellipse cx="258" cy="384" rx="16" ry="24" fill="url(#skinGrad)" />
    {/* Hip gap */}
    <path d="M90 382 Q90 390 92 400 L118 400 L118 382Z" fill="url(#skinGrad)" />
    <path d="M210 382 Q210 390 208 400 L182 400 L182 382Z" fill="url(#skinGrad)" />
    {/* Left leg */}
    <path d="M92 398 L120 398 L122 510 L90 510 Z" fill="url(#skinGrad)" />
    <ellipse cx="106" cy="512" rx="22" ry="14" fill="url(#skinGrad)" />
    <path d="M88 524 L124 524 L120 610 L92 610 Z" fill="url(#skinGrad)" />
    <path d="M90 610 L122 610 Q126 626 114 630 L80 630 Q76 618 82 608 Z" fill="url(#skinGrad)" />
    <ellipse cx="106" cy="612" rx="20" ry="10" fill="url(#skinDark)" opacity="0.4" />
    {/* Right leg */}
    <path d="M180 398 L208 398 L210 510 L178 510 Z" fill="url(#skinGrad)" />
    <ellipse cx="194" cy="512" rx="22" ry="14" fill="url(#skinGrad)" />
    <path d="M176 524 L212 524 L208 610 L178 610 Z" fill="url(#skinGrad)" />
    <path d="M178 610 L210 610 Q214 626 202 630 L166 630 Q162 618 168 608 Z" fill="url(#skinGrad)" />
    <ellipse cx="194" cy="612" rx="20" ry="10" fill="url(#skinDark)" opacity="0.4" />
  </g>
);

const OrgansLayer = () => (
  <g>
    <defs>
      <filter id="organGlow">
        <feGaussianBlur stdDeviation="2.5" result="blur" />
        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
      </filter>
    </defs>
    {/* Trachea */}
    <line x1="150" y1="130" x2="150" y2="195" stroke="#94a3b8" strokeWidth="5" strokeDasharray="3,2" strokeLinecap="round" />
    <line x1="150" y1="192" x2="125" y2="204" stroke="#94a3b8" strokeWidth="3.5" strokeLinecap="round" />
    <line x1="150" y1="192" x2="175" y2="204" stroke="#94a3b8" strokeWidth="3.5" strokeLinecap="round" />
    {/* Brain */}
    <path d="M150 20 C128 20 112 32 110 50 C108 66 116 80 130 84 C134 90 142 92 150 92 C158 92 166 90 170 84 C184 80 192 66 190 50 C188 32 172 20 150 20Z"
      fill="#f59e0b" fillOpacity="0.75" stroke="#d97706" strokeWidth="1.2" filter="url(#organGlow)" />
    <path d="M128 42 Q136 36 150 40 Q164 36 172 42" fill="none" stroke="#d97706" strokeWidth="1" />
    <path d="M124 52 Q136 46 150 50 Q164 46 176 52" fill="none" stroke="#d97706" strokeWidth="1" />
    <path d="M126 62 Q138 56 150 60 Q162 56 174 62" fill="none" stroke="#d97706" strokeWidth="1" />
    {/* Left Lung */}
    <path d="M123 192 C109 194 99 208 99 222 C99 246 106 264 113 272 C117 278 122 280 128 278 C134 276 137 268 138 256 C140 244 139 228 137 216 C135 202 130 191 123 192Z"
      fill="#93c5fd" fillOpacity="0.75" stroke="#3b82f6" strokeWidth="1.2" filter="url(#organGlow)" />
    <path d="M118 222 Q126 218 134 222" fill="none" stroke="#3b82f6" strokeWidth="0.8" />
    <path d="M116 242 Q126 236 134 242" fill="none" stroke="#3b82f6" strokeWidth="0.8" />
    {/* Right Lung */}
    <path d="M177 192 C191 194 201 208 201 222 C201 248 194 268 187 274 C183 280 178 282 172 280 C166 278 163 270 161 258 C159 246 159 230 161 218 C163 204 170 191 177 192Z"
      fill="#93c5fd" fillOpacity="0.75" stroke="#3b82f6" strokeWidth="1.2" filter="url(#organGlow)" />
    <path d="M166 216 Q174 212 182 216" fill="none" stroke="#3b82f6" strokeWidth="0.8" />
    <path d="M164 234 Q174 228 182 234" fill="none" stroke="#3b82f6" strokeWidth="0.8" />
    <path d="M166 252 Q174 246 182 252" fill="none" stroke="#3b82f6" strokeWidth="0.8" />
    {/* Heart */}
    <path d="M144 228 C140 218 126 218 126 230 C126 240 136 250 144 260 C152 250 162 240 162 230 C162 218 148 218 144 228Z"
      fill="#ef4444" fillOpacity="0.85" stroke="#dc2626" strokeWidth="1.2" filter="url(#organGlow)" />
    {/* Diaphragm */}
    <path d="M92 284 Q120 296 150 294 Q180 296 208 284" fill="none" stroke="#94a3b880" strokeWidth="1.8" strokeDasharray="4,3" />
    {/* Liver */}
    <path d="M147 285 C158 284 172 286 183 292 C193 298 199 308 197 318 C195 328 186 334 174 335 C162 336 150 332 143 324 C136 316 135 304 138 294 C141 286 145 285 147 285Z"
      fill="#92400e" fillOpacity="0.7" stroke="#78350f" strokeWidth="1.2" filter="url(#organGlow)" />
    {/* Gallbladder */}
    <ellipse cx="178" cy="335" rx="7" ry="5" fill="#22c55e" fillOpacity="0.7" stroke="#16a34a" strokeWidth="0.8" />
    {/* Stomach */}
    <path d="M119 283 C112 285 108 296 110 308 C112 320 119 330 128 332 C137 334 144 328 145 318 C146 306 143 294 136 287 C131 282 124 282 119 283Z"
      fill="#84cc16" fillOpacity="0.7" stroke="#65a30d" strokeWidth="1.2" filter="url(#organGlow)" />
    {/* Spleen */}
    <path d="M100 272 C93 274 89 283 91 292 C93 301 100 307 107 305 C114 303 117 296 115 288 C113 280 107 272 100 272Z"
      fill="#c084fc" fillOpacity="0.7" stroke="#9333ea" strokeWidth="1.2" filter="url(#organGlow)" />
    {/* Pancreas */}
    <path d="M118 305 Q135 300 152 302 Q164 302 172 308 Q162 312 148 310 Q132 310 118 305Z"
      fill="#fbcfe8" fillOpacity="0.7" stroke="#ec4899" strokeWidth="0.8" />
    {/* Left Kidney */}
    <path d="M107 325 C100 325 96 333 97 341 C98 351 104 357 111 356 C118 355 122 348 121 340 C120 331 114 324 107 325Z"
      fill="#fb923c" fillOpacity="0.75" stroke="#ea580c" strokeWidth="1.2" filter="url(#organGlow)" />
    {/* Right Kidney */}
    <path d="M193 325 C200 325 204 333 203 341 C202 351 196 357 189 356 C182 355 178 348 179 340 C180 331 186 324 193 325Z"
      fill="#fb923c" fillOpacity="0.75" stroke="#ea580c" strokeWidth="1.2" filter="url(#organGlow)" />
    {/* Large intestine (colon frame) */}
    <path d="M108 355 Q104 368 106 386 Q108 404 116 412 Q128 420 150 420 Q172 420 184 412 Q192 404 194 386 Q196 368 192 355"
      fill="none" stroke="#a16207" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    {/* Small intestine */}
    <path d="M130 358 Q140 364 150 360 Q160 356 162 366 Q164 376 152 378 Q140 380 136 372 Q132 364 140 368 Q150 372 152 382 Q154 392 144 394"
      fill="none" stroke="#ca8a04" strokeWidth="4" strokeLinecap="round" />
    {/* Bladder */}
    <path d="M150 428 C138 428 130 436 130 446 C130 456 136 464 146 467 C150 468 154 468 158 467 C168 464 170 456 168 446 C166 436 160 428 150 428Z"
      fill="#bfdbfe" fillOpacity="0.7" stroke="#3b82f6" strokeWidth="1.2" filter="url(#organGlow)" />
  </g>
);

const SkeletalLayer = () => (
  <g stroke="#d4b896" fill="#d4b896" fillOpacity="0.2">
    {/* Skull */}
    <ellipse cx="150" cy="50" rx="38" ry="44" fillOpacity="0.25" strokeWidth="1.5" />
    <ellipse cx="136" cy="45" rx="7" ry="8" fillOpacity="0.3" strokeWidth="1" />
    <ellipse cx="164" cy="45" rx="7" ry="8" fillOpacity="0.3" strokeWidth="1" />
    <path d="M138 68 Q150 74 162 68" fill="none" strokeWidth="1" />
    {/* Mandible */}
    <path d="M116 72 Q150 86 184 72" fill="none" strokeWidth="1.5" />
    {/* Spine */}
    {[108, 116, 124, 132, 140, 148, 156, 164, 172, 180, 188, 196, 204, 212, 220, 228, 236, 244, 252, 260, 268, 276, 284, 292].map((y, i) => (
      <rect key={i} x="145" y={y} width="10" height="6" rx="2" fillOpacity="0.4" strokeWidth="0.8" />
    ))}
    {/* Clavicles */}
    <path d="M150 132 Q125 128 104 136" fill="none" strokeWidth="2" strokeLinecap="round" />
    <path d="M150 132 Q175 128 196 136" fill="none" strokeWidth="2" strokeLinecap="round" />
    {/* Sternum */}
    <rect x="146" y="138" width="8" height="78" rx="3" fillOpacity="0.4" strokeWidth="1" />
    {/* Ribs */}
    {[140, 150, 160, 170, 180, 188, 196, 202, 208, 212, 216, 220].map((y, i) => (
      <g key={i}>
        <path d={`M150 ${y} Q${126 - i} ${y + 4} ${108 - i * 0.5} ${y + 12}`} fill="none" strokeWidth="1.2" strokeLinecap="round" />
        <path d={`M150 ${y} Q${174 + i} ${y + 4} ${192 + i * 0.5} ${y + 12}`} fill="none" strokeWidth="1.2" strokeLinecap="round" />
      </g>
    ))}
    {/* Pelvis */}
    <path d="M88 370 Q86 392 94 408 Q110 422 150 424 Q190 422 206 408 Q214 392 212 370Z" fillOpacity="0.2" strokeWidth="1.5" />
    {/* Arm bones */}
    <line x1="84" y1="160" x2="64" y2="270" strokeWidth="5" strokeLinecap="round" />
    <line x1="64" y1="274" x2="44" y2="360" strokeWidth="4" strokeLinecap="round" />
    <line x1="216" y1="160" x2="236" y2="270" strokeWidth="5" strokeLinecap="round" />
    <line x1="236" y1="274" x2="256" y2="360" strokeWidth="4" strokeLinecap="round" />
    {/* Elbow joints */}
    <circle cx="64" cy="272" r="9" fillOpacity="0.4" strokeWidth="1" />
    <circle cx="236" cy="272" r="9" fillOpacity="0.4" strokeWidth="1" />
    {/* Femurs */}
    <line x1="106" y1="406" x2="106" y2="512" strokeWidth="7" strokeLinecap="round" />
    <line x1="194" y1="406" x2="194" y2="512" strokeWidth="7" strokeLinecap="round" />
    {/* Knees */}
    <ellipse cx="106" cy="514" rx="16" ry="10" fillOpacity="0.4" strokeWidth="1.5" />
    <ellipse cx="194" cy="514" rx="16" ry="10" fillOpacity="0.4" strokeWidth="1.5" />
    {/* Tibias */}
    <line x1="106" y1="524" x2="103" y2="612" strokeWidth="5" strokeLinecap="round" />
    <line x1="194" y1="524" x2="197" y2="612" strokeWidth="5" strokeLinecap="round" />
  </g>
);

const CardiovascularLayer = () => (
  <g fill="none" strokeLinecap="round">
    {/* Beating heart shape */}
    <path d="M144 228 C140 218 126 218 126 230 C126 240 136 250 144 260 C152 250 162 240 162 230 C162 218 148 218 144 228Z"
      fill="#ef4444" fillOpacity="0.8" stroke="#dc2626" strokeWidth="1.2" />
    {/* Aortic arch */}
    <path d="M148 232 L148 210 Q148 195 156 188 L162 184" stroke="#dc2626" strokeWidth="4" strokeLinecap="round" />
    {/* Descending aorta */}
    <path d="M148 232 L148 360" stroke="#dc2626" strokeWidth="4" />
    {/* Iliac arteries */}
    <path d="M148 360 Q136 375 128 402" stroke="#dc2626" strokeWidth="3" />
    <path d="M148 360 Q160 375 172 402" stroke="#dc2626" strokeWidth="3" />
    {/* Femoral arteries */}
    <path d="M128 402 L120 510 L116 610" stroke="#dc2626" strokeWidth="2.5" />
    <path d="M172 402 L180 510 L184 610" stroke="#dc2626" strokeWidth="2.5" />
    {/* Carotids */}
    <path d="M150 184 Q144 164 142 136" stroke="#dc2626" strokeWidth="2.5" />
    <path d="M150 184 Q156 164 158 136" stroke="#dc2626" strokeWidth="2.5" />
    {/* Subclavian/brachial L */}
    <path d="M138 170 Q112 180 90 200 L66 268 L44 358" stroke="#dc2626" strokeWidth="2" />
    {/* Subclavian/brachial R */}
    <path d="M162 170 Q188 180 210 200 L234 268 L256 358" stroke="#dc2626" strokeWidth="2" />
    {/* Superior vena cava */}
    <path d="M148 228 Q144 198 143 168 L143 136" stroke="#3b82f6" strokeWidth="3" />
    {/* Inferior vena cava */}
    <path d="M148 250 L148 358" stroke="#3b82f6" strokeWidth="3" />
    {/* Iliac veins */}
    <path d="M148 358 Q140 374 132 400" stroke="#3b82f6" strokeWidth="2.5" />
    <path d="M148 358 Q156 374 164 400" stroke="#3b82f6" strokeWidth="2.5" />
    {/* Femoral veins */}
    <path d="M132 400 L124 510 L120 608" stroke="#3b82f6" strokeWidth="2" />
    <path d="M164 400 L176 510 L180 608" stroke="#3b82f6" strokeWidth="2" />
    {/* Jugular */}
    <path d="M140 168 L138 136" stroke="#3b82f6" strokeWidth="2" />
    <path d="M146 168 L148 136" stroke="#3b82f6" strokeWidth="2" />
    {/* Arm veins */}
    <path d="M134 172 Q108 184 86 206 L62 272 L42 362" stroke="#3b82f6" strokeWidth="1.8" />
    <path d="M166 172 Q192 184 214 206 L238 272 L258 362" stroke="#3b82f6" strokeWidth="1.8" />
  </g>
);

const NervousLayer = () => (
  <g fill="none" stroke="#a855f7" strokeLinecap="round">
    {/* Brain */}
    <ellipse cx="150" cy="50" rx="36" ry="42" fill="#a855f7" fillOpacity="0.15" stroke="#a855f7" strokeWidth="1.5" />
    {['M124 36 Q136 28 150 32 Q164 28 176 36', 'M120 48 Q136 40 150 44 Q164 40 180 48', 'M122 60 Q136 52 150 56 Q164 52 178 60'].map((d, i) => (
      <path key={i} d={d} strokeWidth="0.9" />
    ))}
    {/* Brain stem */}
    <path d="M150 92 L150 108" strokeWidth="3" />
    {/* Spinal cord */}
    <path d="M150 108 L150 370" strokeWidth="3.5" />
    {/* Cervical nerves */}
    <path d="M150 120 L134 130" strokeWidth="1.2" /><path d="M150 120 L166 130" strokeWidth="1.2" />
    <path d="M150 130 L126 144" strokeWidth="1.2" /><path d="M150 130 L174 144" strokeWidth="1.2" />
    {/* Brachial plexus */}
    <path d="M150 148 Q122 158 100 180 L70 266 L46 358" strokeWidth="1.5" />
    <path d="M150 148 Q178 158 200 180 L230 266 L254 358" strokeWidth="1.5" />
    {/* Thoracic nerves */}
    {[150, 162, 174, 186, 198, 210, 222, 234].map((y, i) => (
      <g key={i}>
        <path d={`M150 ${y} Q${132 - i} ${y + 4} ${116 - i} ${y + 8}`} strokeWidth="0.9" />
        <path d={`M150 ${y} Q${168 + i} ${y + 4} ${184 + i} ${y + 8}`} strokeWidth="0.9" />
      </g>
    ))}
    {/* Sciatic nerves */}
    <path d="M150 360 Q136 376 128 404 L116 510 L108 610" strokeWidth="2" />
    <path d="M150 360 Q164 376 172 404 L184 510 L192 610" strokeWidth="2" />
    {/* Femoral nerve branches */}
    <path d="M116 510 L110 560 L104 610" strokeWidth="1.2" />
    <path d="M116 510 L118 560 L116 610" strokeWidth="1.2" />
    <path d="M184 510 L190 560 L196 610" strokeWidth="1.2" />
    <path d="M184 510 L182 560 L184 610" strokeWidth="1.2" />
  </g>
);

const MuscularLayer = () => (
  <g fill="#dc2626" fillOpacity="0.22" stroke="#dc2626" strokeWidth="0.8">
    {/* Trapezius */}
    <path d="M118 130 Q134 118 150 122 Q166 118 182 130 Q170 148 150 152 Q130 148 118 130Z" />
    {/* Pectorals */}
    <path d="M84 162 Q100 154 138 158 L136 188 Q114 196 90 186 Z" />
    <path d="M162 158 Q200 154 216 162 L210 186 Q186 196 164 188 Z" />
    {/* Deltoids */}
    <path d="M82 148 Q72 150 66 166 L80 184 Q84 166 90 156 Z" />
    <path d="M218 148 Q228 150 234 166 L220 184 Q216 166 210 156 Z" />
    {/* Biceps */}
    <path d="M70 170 Q60 196 58 226 L74 228 Q76 200 82 172 Z" />
    <path d="M218 172 Q224 200 226 228 L242 226 Q240 196 230 170 Z" />
    {/* Forearms */}
    <path d="M56 232 Q46 262 40 308 L54 308 Q58 264 66 234 Z" />
    <path d="M244 234 Q254 264 260 308 L246 308 Q242 264 234 234 Z" />
    {/* Abs 8-pack */}
    {[172, 194, 216, 238].map((y, i) => (
      <g key={i}>
        <rect x="128" y={y} width="18" height="16" rx="4" />
        <rect x="154" y={y} width="18" height="16" rx="4" />
      </g>
    ))}
    {/* Obliques */}
    <path d="M96 180 Q108 210 114 260 Q108 282 98 300 Q90 280 88 250 Q86 210 96 180Z" />
    <path d="M204 180 Q192 210 186 260 Q192 282 202 300 Q210 280 212 250 Q214 210 204 180Z" />
    {/* Glutes */}
    <path d="M90 374 Q86 400 94 418 Q108 430 122 426 Q128 412 126 394 L108 380 Z" fillOpacity="0.18" />
    <path d="M210 374 Q214 400 206 418 Q192 430 178 426 Q172 412 174 394 L192 380 Z" fillOpacity="0.18" />
    {/* Quadriceps */}
    <path d="M90 402 Q84 444 86 494 L108 496 Q110 450 108 404 Z" />
    <path d="M192 404 Q192 450 194 496 L216 494 Q218 444 210 402 Z" />
    {/* Hamstrings */}
    <path d="M108 404 Q112 448 112 494 L122 492 Q122 446 118 402 Z" fillOpacity="0.14" />
    <path d="M178 402 Q182 446 182 492 L192 494 Q192 448 194 404 Z" fillOpacity="0.14" />
    {/* Calves */}
    <path d="M91 526 Q86 560 90 598 L106 598 Q108 560 104 526 Z" />
    <path d="M196 526 Q196 560 194 598 L210 598 Q214 560 210 526 Z" />
  </g>
);

// ── Interactive Organ Overlay ──────────────────────────────────────────────────
function OrganHitArea({
  organ, affected, selected, onSelect
}: {
  organ: OrganDef; affected: boolean; selected: boolean; onSelect: (n: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isActive = hovered || selected;
  return (
    <g
      style={{ cursor: 'pointer' }}
      onClick={() => onSelect(organ.name)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* Invisible hit area */}
      <path d={organ.path} fill="transparent" stroke="none" />
      {/* Glow ring when hovered/selected or affected */}
      {(isActive || affected) && (
        <path d={organ.path}
          fill="none"
          stroke={affected ? '#ef4444' : organ.color}
          strokeWidth={affected ? 3 : 2}
          opacity={0.8}
          style={affected ? { animation: 'pulse 1.2s infinite' } : undefined}
        />
      )}
      {/* Hover label */}
      {hovered && (
        <g>
          <rect x={organ.cx + 12} y={organ.cy - 14} width={94} height={28} rx={6}
            fill="#0f172a" fillOpacity="0.95" />
          <text x={organ.cx + 59} y={organ.cy + 1}
            textAnchor="middle" fontSize="10" fontWeight="bold" fill="white">
            {organ.name}
          </text>
          {affected && (
            <text x={organ.cx + 59} y={organ.cy + 12}
              textAnchor="middle" fontSize="9" fill="#f87171">⚠ Affected</text>
          )}
          {!affected && (
            <text x={organ.cx + 59} y={organ.cy + 12}
              textAnchor="middle" fontSize="9" fill="#86efac">✓ Normal</text>
          )}
        </g>
      )}
    </g>
  );
}

// ── Main ViewBox Component ─────────────────────────────────────────────────────
function AnatomyViewer({
  layer, affected, selectedOrgan, onOrganSelect, zoom
}: {
  layer: LayerKey; affected: string[]; selectedOrgan: string | null;
  onOrganSelect: (n: string) => void; zoom: number;
}) {
  const bodyOpacity =
    layer === 'organs' ? 0.35 :
      layer === 'skeletal' ? 0.12 :
        layer === 'cardiovascular' ? 0.14 :
          layer === 'nervous' ? 0.12 : 1.0;

  const isAffected = (name: string) => {
    const n = name.toLowerCase();
    const matches = affected.some(a => {
      const term = a.toLowerCase();
      // Direct or partial match (e.g., "Lung" matches "Left Lung")
      if (n.includes(term) || term.includes(n)) return true;

      // Broad region mapping
      if (term.includes('abdomen') || term.includes('stomach') || term.includes('digestive') || term.includes('gastro')) {
        return ['stomach', 'intestines', 'liver', 'spleen', 'bladder'].some(org => n.includes(org));
      }
      if (term.includes('chest') || term.includes('thoracic') || term.includes('respiratory')) {
        return ['heart', 'lungs'].some(org => n.includes(org));
      }
      if (term.includes('renal') || term.includes('urinary')) {
        return ['kidneys', 'bladder'].some(org => n.includes(org));
      }
      if (term.includes('head') || term.includes('neuro') || term.includes('brain')) {
        return n.includes('brain');
      }
      return false;
    });
    return matches;
  };

  return (
    <svg
      viewBox="0 0 300 650"
      xmlns="http://www.w3.org/2000/svg"
      style={{
        width: '100%', height: '100%', maxHeight: '580px',
        transform: `scale(${zoom})`, transformOrigin: 'top center',
        transition: 'transform 0.3s ease',
        filter: 'drop-shadow(0 8px 32px rgba(0,0,0,0.5))',
      }}
    >
      <style>{`
        @keyframes pulse { 
          0%, 100% { opacity: 0.6; stroke-width: 2; filter: drop-shadow(0 0 2px #ef4444); } 
          50% { opacity: 1; stroke-width: 5; filter: drop-shadow(0 0 12px #ef4444); } 
        }
        @keyframes organPulse { 0%, 100% { opacity: 0.72; } 50% { opacity: 1; } }
      `}</style>

      {/* Background glow behind body */}
      <ellipse cx="150" cy="330" rx="90" ry="280"
        fill="rgba(148,163,184,0.04)" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />

      {/* Body skin — always rendered, opacity changes by layer */}
      <BodyOutline opacity={bodyOpacity} />

      {/* System layers */}
      {layer === 'organs' && <OrgansLayer />}
      {layer === 'skeletal' && <SkeletalLayer />}
      {layer === 'cardiovascular' && <CardiovascularLayer />}
      {layer === 'nervous' && <NervousLayer />}
      {layer === 'muscular' && <MuscularLayer />}

      {/* Interactive hit areas — shown on organ layer */}
      {layer === 'organs' && ORGANS.map(o => (
        <OrganHitArea
          key={o.name} organ={o}
          affected={isAffected(o.name)}
          selected={selectedOrgan === o.name}
          onSelect={onOrganSelect}
        />
      ))}

      {/* Affected organ status dots — all layers */}
      {ORGANS.map(o => {
        const aff = isAffected(o.name);
        if (!aff) return null;
        return (
          <g key={o.name}>
            <circle cx={o.cx} cy={o.cy} r="16" fill="#ef4444" fillOpacity="0.12"
              style={{ animation: 'pulse 1.2s infinite' }} />
            <circle cx={o.cx} cy={o.cy} r="6" fill="#ef4444" fillOpacity="0.9" />
          </g>
        );
      })}
    </svg>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────
const ThreeDView = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [layer, setLayer] = useState<LayerKey>('organs');
  const [selectedOrgan, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const lastReport = JSON.parse(localStorage.getItem('lastReport') || '{}');
  const anatomy: string[] = lastReport.affected_anatomy || [];
  const summary: string = lastReport.summary || '';
  const entities: Record<string, string[]> = lastReport.entities || {};
  const reportName: string = lastReport.name || '';

  // Auto-select the first affected organ on load
  React.useEffect(() => {
    if (anatomy.length > 0) {
      const firstAffected = ORGANS.find(o =>
        anatomy.some(a => o.name.toLowerCase().includes(a.toLowerCase()))
      );
      if (firstAffected) {
        setSelected(firstAffected.name);
        setZoom(1.2);
        toast({
          title: "Anatomy Alert",
          description: `Highlighting ${anatomy.join(", ")} based on your report.`,
        });
      }
    }
  }, []);

  const handleExport = async () => {
    try {
      await downloadReport({ filename: reportName || 'report', simplified_summary: summary, affected_anatomy: anatomy, entities });
      toast({ title: 'Report Downloaded' });
    } catch {
      toast({ title: 'Export Failed', variant: 'destructive' });
    }
  };

  const selectedOrganDef = ORGANS.find(o => o.name === selectedOrgan);
  const currentLayer = LAYER_META.find(l => l.key === layer)!;

  const isAffected = (name: string) =>
    anatomy.some(a =>
      name.toLowerCase().includes(a.toLowerCase()) ||
      a.toLowerCase().includes(name.toLowerCase().split(' ').pop() ?? '')
    );

  return (
    <div className="min-h-screen bg-[#0a0f1e]">
      <Navbar />
      <main className="container py-6">
        {/* Header */}
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-white flex items-center gap-2">
              <Activity className="h-7 w-7 text-blue-400" /> Interactive 3D Human Body
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Click organs to inspect · Switch layers to explore anatomy
              {anatomy.length === 0 && <> · <Link to="/reports" className="text-blue-400 hover:underline">Upload a report</Link> to highlight areas</>}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={() => setZoom(z => Math.min(z + 0.15, 2))}><ZoomIn className="h-4 w-4 mr-1" />Zoom In</Button>
            <Button variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={() => setZoom(z => Math.max(z - 0.15, 0.5))}><ZoomOut className="h-4 w-4 mr-1" />Zoom Out</Button>
            <Button variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={() => setZoom(1)}><RotateCcw className="h-4 w-4" /></Button>
            {reportName && <Button variant="outline" size="sm" className="border-slate-700 text-slate-300" onClick={handleExport}><Download className="h-4 w-4 mr-1" />Export</Button>}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-4">
          {/* Main viewer */}
          <div className="lg:col-span-3 flex flex-col gap-3">
            {/* Layer tabs */}
            <div className="flex flex-wrap gap-2">
              {LAYER_META.map(l => (
                <button key={l.key} onClick={() => { setLayer(l.key); setSelected(null); }}
                  className={`flex items-center gap-1.5 rounded-full border px-4 py-1.5 text-sm font-semibold transition-all duration-200 ${layer === l.key ? 'text-white shadow-lg scale-105 border-transparent' : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-white'}`}
                  style={layer === l.key ? { backgroundColor: l.color, boxShadow: `0 0 20px ${l.color}55` } : undefined}>
                  <span>{l.icon}</span>{l.label}
                </button>
              ))}
            </div>

            {/* Viewer card */}
            <Card className="border border-slate-800 overflow-hidden relative"
              style={{ background: 'radial-gradient(ellipse at 50% 20%, #1a2240, #060c1a)', minHeight: 560 }}>
              {/* Badges */}
              <div className="absolute top-4 left-4 z-10 flex gap-2">
                <Badge className="bg-slate-900/80 text-slate-300 border-slate-700 text-xs">Anterior View</Badge>
                <Badge className="text-xs border" style={{ backgroundColor: currentLayer.color + '22', color: currentLayer.color, borderColor: currentLayer.color + '66' }}>
                  {currentLayer.icon} {currentLayer.label}
                </Badge>
              </div>

              {/* Selected organ panel */}
              {selectedOrganDef && (
                <div className="absolute bottom-4 left-4 z-10 max-w-xs rounded-xl bg-slate-900/95 border border-slate-700 p-4 shadow-xl">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedOrganDef.color }} />
                    <span className="font-bold text-white text-sm">{selectedOrganDef.name}</span>
                    {isAffected(selectedOrganDef.name) && <Badge variant="destructive" className="text-xs">Affected</Badge>}
                  </div>
                  <p className="text-slate-400 text-xs leading-relaxed">{selectedOrganDef.desc}</p>
                  <button className="mt-2 text-xs text-slate-500 hover:text-slate-300" onClick={() => setSelected(null)}>✕ Close</button>
                </div>
              )}

              <CardContent className="flex justify-center items-start pt-14 pb-6 px-4" style={{ minHeight: 560 }}>
                <AnatomyViewer
                  layer={layer} affected={anatomy}
                  selectedOrgan={selectedOrgan}
                  onOrganSelect={n => setSelected(prev => prev === n ? null : n)}
                  zoom={zoom}
                />
              </CardContent>
            </Card>

            {/* Layer description */}
            <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2.5 text-xs text-slate-400 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: currentLayer.color }} />
              {layer === 'organs' && 'Click any organ to inspect. Organs are shown in their correct anatomical positions inside the body.'}
              {layer === 'skeletal' && 'Skeletal system — skull, spine (24 vertebrae), 12 rib pairs, pelvis, arm and leg bones.'}
              {layer === 'cardiovascular' && 'Cardiovascular system — heart, arteries (red), veins (blue), aorta and major vessels.'}
              {layer === 'nervous' && 'Nervous system — brain, spinal cord, brachial plexus, thoracic and sciatic nerves.'}
              {layer === 'muscular' && 'Major muscle groups — pectorals, deltoids, abs, obliques, quadriceps, calves.'}
              {anatomy.length > 0 && <span className="ml-1 text-red-400 font-medium">· Red dots = affected regions</span>}
            </div>
          </div>

          {/* Right panel */}
          <div className="space-y-4">
            <Card className="bg-slate-900 border-slate-800">
              <CardContent className="p-5">
                <h3 className="font-semibold text-white mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-blue-400" /> System Status
                </h3>
                <div className="space-y-2">
                  {ORGANS.map(o => {
                    const aff = isAffected(o.name);
                    return (
                      <button key={o.name} onClick={() => { setLayer('organs'); setSelected(o.name); }}
                        className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-all hover:scale-[1.02] ${selectedOrgan === o.name ? 'border-blue-500/50 bg-blue-900/30' : 'border-slate-800 bg-slate-800/50 hover:border-slate-600'}`}>
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${aff ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                          <span className="text-slate-300 font-medium">{o.name}</span>
                        </div>
                        <Badge className={`text-[10px] px-1.5 ${aff ? 'bg-red-900/60 text-red-300 border-red-800' : 'bg-green-900/40 text-green-400 border-green-800'}`} variant="outline">
                          {aff ? '⚠ Alert' : '✓ OK'}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {summary ? (
              <Card className="bg-gradient-to-br from-indigo-950 to-slate-900 border-indigo-900">
                <CardContent className="p-5">
                  <h3 className="flex items-center gap-2 text-sm font-semibold mb-3 text-indigo-200">
                    <Brain className="h-4 w-4 text-indigo-400" /> AI Summary
                  </h3>
                  {reportName && <div className="flex items-center gap-1.5 mb-2"><FileText className="h-3 w-3 text-indigo-400" /><span className="text-xs text-indigo-400 truncate">{reportName}</span></div>}
                  <p className="text-xs text-slate-300 leading-relaxed line-clamp-7">
                    {summary.split('SYSTEM_ORGANS:')[0].trim()}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs border-indigo-800 text-indigo-300 hover:bg-indigo-900" onClick={() => navigate('/reports')}>New Report</Button>
                    {reportName && <Button size="sm" variant="outline" className="text-xs border-indigo-800 text-indigo-300 hover:bg-indigo-900" onClick={handleExport}><Download className="h-3 w-3 mr-1" />Export</Button>}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="bg-slate-900 border-slate-800">
                <CardContent className="p-5 text-center">
                  <FileText className="h-8 w-8 text-slate-600 mx-auto mb-3" />
                  <p className="text-slate-500 text-xs mb-3">Upload a medical report to highlight affected organs.</p>
                  <Button size="sm" className="text-xs" onClick={() => navigate('/reports')}>Upload Report</Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default ThreeDView;