"use client";

import React from "react";
import { useAuth } from "@/context/AuthContext";
import { Wrench } from "lucide-react";

export default function MaintenanceModal() {
  const { maintenanceMessage } = useAuth();

  if (!maintenanceMessage) return null;

  return (
    <div className="fixed inset-0 z-[999999] flex items-center justify-center bg-black/70 backdrop-blur-md p-4 animate-in fade-in duration-300">
      <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl p-8 text-center border border-amber-200">
        <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Wrench className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-slate-800 mb-2">System Maintenance</h2>
        <p className="text-sm text-slate-600 leading-relaxed mb-6 whitespace-pre-wrap">
          {maintenanceMessage}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-sm transition-colors text-sm"
        >
          Check Again / Reload
        </button>
      </div>
    </div>
  );
}
