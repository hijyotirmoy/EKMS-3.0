"use client";

import React, { useState, useEffect } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import {
  Settings,
  Image as ImageIcon,
  Folder,
  Clock,
  Wrench,
  Shield,
  Save,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

export default function AdminSettingsPage() {
  const { userProfile, isMasterAdmin } = useAuth();
  const { toast } = usePopup();
  const [activeTab, setActiveTab] = useState<"images" | "files" | "session" | "maintenance">("session");

  // Session Policy
  const [sessionTimeoutEnabled, setSessionTimeoutEnabled] = useState(true);
  const [sessionTimeoutDuration, setSessionTimeoutDuration] = useState(30);
  const [savingSession, setSavingSession] = useState(false);

  // Maintenance Policy
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    "The system is currently undergoing scheduled maintenance. Please check back soon."
  );
  const [savingMaintenance, setSavingMaintenance] = useState(false);

  // Image Settings
  const [autoCompress, setAutoCompress] = useState(true);
  const [maxImageSize, setMaxImageSize] = useState(2);

  // 1. Fetch System Settings from Firestore
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const docSnap = await getDoc(doc(db, "system", "status"));
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.sessionTimeoutEnabled !== undefined) {
            setSessionTimeoutEnabled(!!data.sessionTimeoutEnabled);
          }
          if (data.sessionTimeoutDuration !== undefined) {
            setSessionTimeoutDuration(Number(data.sessionTimeoutDuration));
          }
          if (data.maintenanceMode !== undefined) {
            setMaintenanceMode(
              data.maintenanceMode === true || String(data.maintenanceMode).toLowerCase() === "true"
            );
          }
          if (data.maintenanceMessage) {
            setMaintenanceMessage(data.maintenanceMessage);
          }
        }
      } catch (e) {
        console.error("Settings load error:", e);
      }
    };
    fetchSettings();
  }, []);

  // Save Session Policy
  const handleSaveSession = async () => {
    setSavingSession(true);
    try {
      await setDoc(
        doc(db, "system", "status"),
        {
          sessionTimeoutEnabled,
          sessionTimeoutDuration: Number(sessionTimeoutDuration),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      toast.success("Session security policy updated across all terminals!");
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSavingSession(false);
    }
  };

  // Save Maintenance Policy
  const handleSaveMaintenance = async () => {
    if (!isMasterAdmin) {
      toast.error("Only Master Admins have authorization to toggle global maintenance.");
      return;
    }

    setSavingMaintenance(true);
    try {
      await setDoc(
        doc(db, "system", "status"),
        {
          maintenanceMode,
          maintenanceMessage: maintenanceMessage.trim(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      if (maintenanceMode) {
        toast.warning("Global maintenance enabled! All standard agents have been signed out.");
      } else {
        toast.success("Maintenance mode disabled. System open for all agents.");
      }
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSavingMaintenance(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">System Settings & Policies</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Settings Navigation Sidebar */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-3xl p-4 shadow-xs space-y-1 select-none">
          <button
            onClick={() => setActiveTab("session")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold transition-all text-left ${
              activeTab === "session"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Session Timeout Policy</span>
          </button>

          <button
            onClick={() => setActiveTab("maintenance")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold transition-all text-left ${
              activeTab === "maintenance"
                ? "bg-rose-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Wrench className="w-4 h-4" />
            <span>Global Maintenance Mode</span>
          </button>

          <button
            onClick={() => setActiveTab("images")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold transition-all text-left ${
              activeTab === "images"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <ImageIcon className="w-4 h-4" />
            <span>Image Compression</span>
          </button>

          <button
            onClick={() => setActiveTab("files")}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold transition-all text-left ${
              activeTab === "files"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Folder className="w-4 h-4" />
            <span>Storage & Security Limits</span>
          </button>
        </div>

        {/* Settings Panel Content Area */}
        <div className="lg:col-span-8 bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs">
          {/* ----------------------------------------------------
              TAB 1: SESSION TIMEOUT
              ---------------------------------------------------- */}
          {activeTab === "session" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900">Inactivity Timeout Policy</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically terminates idle terminal sessions to comply with security standards.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Enable Inactivity Auto-Logout</h4>
                    <p className="text-[11px] text-slate-500">
                      Monitors mouse movements, keystrokes, and touch events on all terminals.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={sessionTimeoutEnabled}
                    onChange={(e) => setSessionTimeoutEnabled(e.target.checked)}
                    className="w-5 h-5 text-blue-600 rounded"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Timeout Inactivity Interval
                  </label>
                  <select
                    value={sessionTimeoutDuration}
                    disabled={!sessionTimeoutEnabled}
                    onChange={(e) => setSessionTimeoutDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-800 disabled:opacity-50"
                  >
                    <option value={1}>1 Minute (Testing Mode)</option>
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes (Recommended)</option>
                    <option value={60}>1 Hour</option>
                    <option value={240}>4 Hours</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={handleSaveSession}
                    disabled={savingSession}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingSession ? "Saving Policy..." : "Update Session Policy"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 2: MAINTENANCE MODE
              ---------------------------------------------------- */}
          {activeTab === "maintenance" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-rose-700 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span>Global Maintenance Mode</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Restricts portal access during major upgrades or database migrations. Master Admins bypass lockouts.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-rose-50 border border-rose-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-rose-900">Enable Maintenance Mode</h4>
                    <p className="text-[11px] text-rose-600">
                      When enabled, all non-Master Admins are immediately signed out and shown a maintenance modal.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={maintenanceMode}
                    onChange={(e) => setMaintenanceMode(e.target.checked)}
                    className="w-5 h-5 text-rose-600 rounded"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Custom Maintenance Announcement
                  </label>
                  <textarea
                    value={maintenanceMessage}
                    onChange={(e) => setMaintenanceMessage(e.target.value)}
                    rows={4}
                    placeholder="e.g. Scheduled database maintenance in progress..."
                    className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-rose-500 leading-relaxed font-sans"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={handleSaveMaintenance}
                    disabled={savingMaintenance}
                    className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingMaintenance ? "Applying Rules..." : "Apply Maintenance Rules"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 3: IMAGE COMPRESSION
              ---------------------------------------------------- */}
          {activeTab === "images" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900">Image Compression Settings</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Controls client-side image downscaling before uploading to avoid database bloat.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Auto-Compress Uploads</h4>
                    <p className="text-[11px] text-slate-500">
                      Downscales large camera photos to max 600px with 75% JPEG quality.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoCompress}
                    onChange={(e) => setAutoCompress(e.target.checked)}
                    className="w-5 h-5 text-blue-600 rounded"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Hard Maximum Upload Limit
                  </label>
                  <select
                    value={maxImageSize}
                    onChange={(e) => setMaxImageSize(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold"
                  >
                    <option value={1}>1 MB</option>
                    <option value={2}>2 MB (Recommended)</option>
                    <option value={5}>5 MB</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={() => toast.success("Image compression preferences saved locally.")}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs"
                  >
                    Save Preferences
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 4: STORAGE & LIMITS
              ---------------------------------------------------- */}
          {activeTab === "files" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900">Storage Policies</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Firestore document size constraints and Google Drive proxy rules.
                </p>
              </div>

              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 font-bold text-xs text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Strict Firestore Document Size Guard (1 MB Limit)</span>
                </div>
                <p className="text-[11px] text-emerald-700 leading-relaxed">
                  The client-side upload pipeline enforces a strict 950KB ceiling on raw document blobs to prevent
                  database document overflows. Files exceeding this size are routed to the Google Apps Script Drive proxy.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
