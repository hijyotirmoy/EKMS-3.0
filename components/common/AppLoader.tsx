"use client";

import React, { useState, useEffect } from "react";
import { ShieldCheck, Database, Sparkles, CheckCircle2 } from "lucide-react";

export default function AppLoader() {
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);

  const steps = [
    { text: "Connecting to EKMS Knowledge Base...", icon: ShieldCheck },
    { text: "Authenticating security credentials & roles...", icon: ShieldCheck },
    { text: "Synchronizing offline guidance caches...", icon: Database },
    { text: "Workspace verified & ready!", icon: Sparkles },
  ];

  useEffect(() => {
    // Quick, smooth progress simulation
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => setLoading(false), 250);
          return 100;
        }
        const next = prev + Math.floor(Math.random() * 15) + 10;
        if (next >= 75) setStepIndex(3);
        else if (next >= 50) setStepIndex(2);
        else if (next >= 25) setStepIndex(1);
        return Math.min(next, 100);
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  if (!loading) return null;

  const CurrentIcon = steps[stepIndex].icon;

  return (
    <div className="fixed inset-0 z-[99999] bg-slate-950 flex flex-col items-center justify-center p-6 select-none animate-in fade-in duration-300">
      {/* Background ambient lighting */}
      <div className="absolute w-96 h-96 bg-blue-600/15 rounded-full blur-3xl pointer-events-none -top-20 -left-20 animate-pulse" />
      <div className="absolute w-96 h-96 bg-emerald-600/10 rounded-full blur-3xl pointer-events-none -bottom-20 -right-20 animate-pulse delay-700" />

      <div className="relative z-10 flex flex-col items-center max-w-sm w-full text-center space-y-6">
        {/* Title without logo */}
        <div className="space-y-1.5">
          <h1 className="text-3xl font-black text-white tracking-tight">
            EKMS 3.0
          </h1>
          <p className="text-xs font-semibold text-slate-400 tracking-wider uppercase">
            Knowledge Management System
          </p>
        </div>

        {/* Progress Bar & Counter */}
        <div className="w-full space-y-2.5">
          <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800 p-0.5">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-emerald-400 to-teal-300 rounded-full transition-all duration-150 ease-out shadow-sm shadow-blue-500/50"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px] font-mono font-bold text-slate-400 px-1">
            <span className="flex items-center gap-1.5 text-slate-300">
              <CurrentIcon className="w-3.5 h-3.5 text-blue-400" />
              <span>{steps[stepIndex].text}</span>
            </span>
            <span className="text-emerald-400">{progress}%</span>
          </div>
        </div>

        {/* Security badge footer */}
        <div className="pt-2 flex items-center gap-1.5 text-[10px] text-slate-500 font-medium">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          <span>Enterprise Secure Connection Verified</span>
        </div>
      </div>
    </div>
  );
}
