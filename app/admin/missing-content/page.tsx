"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { usePopup } from "@/context/PopupContext";
import { MissingSearchLog } from "@/lib/types";
import {
  SearchX,
  Sparkles,
  X,
  Trash2,
  CheckCircle2,
} from "lucide-react";

export default function AdminMissingContentPage() {
  const router = useRouter();
  const { toast, showConfirm } = usePopup();
  const [logs, setLogs] = useState<MissingSearchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearingAll, setClearingAll] = useState(false);

  // 1. Fetch Missing Searches
  useEffect(() => {
    const q = query(collection(db, "missing_searches"), orderBy("count", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: MissingSearchLog[] = [];
        snapshot.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<MissingSearchLog, "id">) }));
        setLogs(list);
        setLoading(false);
      },
      (err) => console.error("Missing content sync error:", err)
    );

    return () => unsubscribe();
  }, []);

  // Resolve (Deletes log and teleports to Q&A authoring)
  const handleResolve = async (log: MissingSearchLog) => {
    if (log.id) {
      try {
        await deleteDoc(doc(db, "missing_searches", log.id));
      } catch (e) {}
    }
    router.push(`/admin/qa?draft=${encodeURIComponent(log.term)}`);
  };

  // Dismiss Single
  const handleDismiss = async (id?: string) => {
    if (!id) return;
    try {
      await deleteDoc(doc(db, "missing_searches", id));
      toast.success("Log dismissed.");
    } catch (e: any) {
      toast.error("Failed to dismiss: " + e.message);
    }
  };

  // Clear All
  const handleClearAll = async () => {
    const confirmed = await showConfirm({
      title: "Clear All Search Logs?",
      message: "Are you sure you want to permanently clear all failed search logs?",
      isDestructive: true,
      confirmText: "Clear All Logs",
    });
    if (!confirmed) return;

    setClearingAll(true);
    try {
      const batch = writeBatch(db);
      logs.forEach((l) => {
        if (l.id) batch.delete(doc(db, "missing_searches", l.id));
      });
      await batch.commit();
      toast.success("All failed search logs cleared.");
    } catch (e: any) {
      toast.error("Failed to clear: " + e.message);
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Missing Content Analytics</h1>
        </div>

        {logs.length > 0 && (
          <button
            onClick={handleClearAll}
            disabled={clearingAll}
            className="flex items-center gap-1.5 px-3.5 py-2 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-xs transition-colors"
          >
            <Trash2 className="w-4 h-4 text-rose-600" />
            <span>{clearingAll ? "Clearing..." : "Clear All Logs"}</span>
          </button>
        )}
      </div>

      {/* Logs Table */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                <th className="p-4 w-1/2">Failed Search Term</th>
                <th className="p-4 text-center">Failed Count</th>
                <th className="p-4">Last Attempted</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={4} className="text-center py-12 text-slate-400">
                    Analyzing search logs...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-12 text-slate-400 space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto" />
                    <div>Knowledge base is fully optimized. Zero failed searches logged!</div>
                  </td>
                </tr>
              ) : (
                logs.map((log) => {
                  const dateStr = log.lastAttempt
                    ? new Date(log.lastAttempt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "-";

                  return (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-4 font-bold text-rose-600">&quot;{log.term}&quot;</td>
                      <td className="p-4 text-center">
                        <span className="bg-rose-50 text-rose-700 font-bold px-2.5 py-0.5 rounded-full text-xs">
                          {log.count} misses
                        </span>
                      </td>
                      <td className="p-4 text-slate-400">{dateStr}</td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleResolve(log)}
                            className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 font-bold rounded-lg text-xs flex items-center gap-1 transition-colors"
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Author Q&A</span>
                          </button>
                          <button
                            onClick={() => handleDismiss(log.id)}
                            className="p-1.5 text-slate-400 hover:text-slate-600 rounded"
                            title="Dismiss Log"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
