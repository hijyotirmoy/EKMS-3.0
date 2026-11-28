"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Sparkles, RefreshCw, X, Rocket, CheckCircle2, ArrowRight } from "lucide-react";

export const APP_BUILD_VERSION = "3.0.2";
const CLIENT_BUILD_TIME = process.env.NEXT_PUBLIC_BUILD_TIME || "dev-build";

export default function AppUpdateBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [remoteVersion, setRemoteVersion] = useState<string>("");
  const [changelog, setChangelog] = useState<string>("");
  const [dismissed, setDismissed] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const checkTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleUpdate = useCallback(async () => {
    setIsUpdating(true);
    try {
      if (typeof window !== "undefined") {
        if ("caches" in window) {
          const names = await caches.keys();
          await Promise.all(names.map((n) => caches.delete(n)));
        }
        if ("serviceWorker" in navigator) {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((r) => r.unregister()));
        }
        setTimeout(() => {
          window.location.reload();
        }, 800);
      }
    } catch (_) {
      window.location.reload();
    }
  }, []);

  // 1. Dynamic API check for new deployment (Vercel / Netlify live deployment update)
  const checkForDeploymentUpdate = useCallback(async () => {
    try {
      const res = await fetch(`/api/version?_t=${Date.now()}`, {
        cache: "no-store",
        headers: { "Pragma": "no-cache", "Cache-Control": "no-cache" },
      });
      if (res.ok) {
        const data = await res.json();
        const serverBuild = String(data.buildTime || "");
        if (
          serverBuild &&
          CLIENT_BUILD_TIME &&
          CLIENT_BUILD_TIME !== "dev-build" &&
          serverBuild !== "dev-build" &&
          serverBuild !== CLIENT_BUILD_TIME
        ) {
          setRemoteVersion(data.version || "New Release");
          setChangelog("A new EKMS update has been deployed with latest features & fixes.");
          setUpdateAvailable(true);
        }
      }
    } catch (_) {}
  }, []);

  useEffect(() => {
    // Immediate check
    checkForDeploymentUpdate();

    // Periodic check every 45 seconds
    const interval = setInterval(checkForDeploymentUpdate, 45000);

    // Check on tab focus or visibility change (e.g. when agent switches to tab)
    const onFocusOrVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        checkForDeploymentUpdate();
      }
    };
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);

    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [checkForDeploymentUpdate]);

  // 2. Firestore fallback listener
  useEffect(() => {
    const lastDismissedVer = typeof window !== "undefined" ? sessionStorage.getItem("ekms_dismissed_update") : null;

    const unsub = onSnapshot(
      doc(db, "system", "app_version"),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          const latest = data.latestVersion || APP_BUILD_VERSION;
          setRemoteVersion(latest);
          if (data.changelog) setChangelog(data.changelog);

          if (latest !== APP_BUILD_VERSION) {
            if (lastDismissedVer !== latest) {
              setUpdateAvailable(true);
            }
          }
        }
      },
      () => {}
    );

    return () => {
      try {
        if (typeof unsub === "function") unsub();
      } catch (_) {}
    };
  }, []);

  if (!updateAvailable || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== "undefined" && remoteVersion) {
      sessionStorage.setItem("ekms_dismissed_update", remoteVersion);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-300">
      <div className="relative w-full max-w-md bg-gradient-to-b from-slate-900 to-slate-950 border border-blue-500/30 rounded-3xl p-6 sm:p-7 shadow-[0_20px_60px_-15px_rgba(37,99,235,0.35)] text-white overflow-hidden animate-in zoom-in-95 duration-300">
        <div className="absolute -top-16 -right-16 w-36 h-36 bg-blue-600/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-36 h-36 bg-indigo-600/20 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={handleDismiss}
          disabled={isUpdating}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white rounded-full bg-slate-800/60 hover:bg-slate-800 transition-colors"
          title="Dismiss for now"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Icon & Version Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-blue-500/30 flex-shrink-0 animate-bounce">
            <Rocket className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold tracking-wide uppercase bg-blue-500/15 text-blue-400 border border-blue-500/30 mb-1">
              <Sparkles className="w-3 h-3" />
              New Update Deployed
            </div>
            <h3 className="text-lg font-bold text-white tracking-tight">
              System Update Available
            </h3>
          </div>
        </div>

        {/* Version comparison tag */}
        <div className="flex items-center justify-between px-3.5 py-2 rounded-xl bg-slate-800/70 border border-slate-700/60 text-xs text-slate-300 mb-4">
          <span className="text-slate-400">Current: <strong className="text-slate-200">v{APP_BUILD_VERSION}</strong></span>
          <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-blue-400 font-semibold">Latest: <strong className="text-white font-bold">{remoteVersion || "New Release"}</strong></span>
        </div>

        {/* Changelog details */}
        <div className="mb-6">
          <p className="text-xs text-slate-400 mb-1.5 font-medium uppercase tracking-wider">What&apos;s New:</p>
          <div className="p-3.5 rounded-xl bg-slate-800/40 border border-slate-800 text-xs text-slate-200 leading-relaxed max-h-32 overflow-y-auto">
            {changelog || "Latest system enhancements, live deletion sync, and deployment updates."}
          </div>
          <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            Click Update Now to load the latest build without losing your session.
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleUpdate}
            disabled={isUpdating}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-blue-600 via-blue-500 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-semibold text-sm shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2 transition-all transform active:scale-95 disabled:opacity-75 cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${isUpdating ? "animate-spin" : ""}`} />
            {isUpdating ? "Applying Update..." : "Update Now"}
          </button>
          <button
            onClick={handleDismiss}
            disabled={isUpdating}
            className="py-3 px-4 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 font-medium text-sm transition-colors cursor-pointer"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
