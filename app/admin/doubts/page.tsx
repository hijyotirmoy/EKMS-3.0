"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  deleteDoc,
  getDocs,
  increment,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Doubt } from "@/lib/types";
import { logUserActivity } from "@/lib/activityLogger";
import {
  HelpCircle,
  Clock,
  ShieldAlert,
  CheckCircle2,
  Trophy,
  Trash2,
  CheckCheck,
  X,
  Crown,
  Shield,
  Headphones,
} from "lucide-react";

export default function AdminDoubtsPage() {
  const { user, userProfile } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Resolve Modal
  const [resolveDoubt, setResolveDoubt] = useState<Doubt | null>(null);
  const [resolveText, setResolveText] = useState("");
  const [resolveSaving, setResolveSaving] = useState(false);

  // 1. Fetch Doubts & Users
  useEffect(() => {
    const unsubDoubts = onSnapshot(collection(db, "doubts"), (snap) => {
      const list: Doubt[] = [];
      snap.forEach((d) => list.push({ id: d.id, ...(d.data() as Omit<Doubt, "id">) }));
      list.sort((a, b) => {
        const order: Record<string, number> = { pending: 1, waiting: 2, resolved: 3 };
        const aOrder = order[a.status] || 1;
        const bOrder = order[b.status] || 1;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      setDoubts(list);
      setLoading(false);
    });

    const fetchUsers = async () => {
      try {
        const snap = await getDocs(collection(db, "users"));
        const uList: any[] = [];
        snap.forEach((d) => uList.push({ email: d.id, ...d.data() }));
        setUsers(uList);
      } catch (e) {
        console.error(e);
      }
    };
    fetchUsers();

    return () => unsubDoubts();
  }, []);

  // Metrics
  const metrics = useMemo(() => {
    const total = doubts.length;
    const resolved = doubts.filter((d) => d.status === "resolved").length;
    const waiting = doubts.filter((d) => d.status === "waiting").length;
    const pending = doubts.filter((d) => d.status === "pending" || !d.status).length;
    return { total, resolved, waiting, pending };
  }, [doubts]);

  // Contributor Leaderboard
  const leaderboard = useMemo(() => {
    const stats = users.map((u) => {
      const asked = doubts.filter((d) => d.authorEmail?.toLowerCase() === u.email.toLowerCase()).length;
      const resolved = doubts.filter((d) => d.resolvedByEmail?.toLowerCase() === u.email.toLowerCase()).length;
      return {
        ...u,
        asked,
        resolved,
        totalImpact: asked + resolved,
      };
    });

    return stats.filter((s) => s.totalImpact > 0).sort((a, b) => b.totalImpact - a.totalImpact);
  }, [users, doubts]);

  // Submit Resolution
  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveDoubt || !resolveText.trim()) return;

    setResolveSaving(true);
    try {
      const docRef = doc(db, "doubts", resolveDoubt.id);
      await updateDoc(docRef, {
        status: "resolved",
        answer: resolveText.trim(),
        resolvedBy: userProfile?.displayName || user?.email?.split("@")[0] || "Admin",
        resolvedByEmail: user?.email?.toLowerCase() || null,
        resolvedAt: Date.now(),
        updatedAt: Date.now(),
      });

      if (resolveDoubt.authorEmail) {
        try {
          const userDocRef = doc(db, "users", resolveDoubt.authorEmail.toLowerCase());
          await updateDoc(userDocRef, { doubtsResolved: increment(1) });
        } catch (e) {}
      }

      logUserActivity(user?.email, {
        desc: `Verified and resolved doubt: "${(resolveDoubt.question || "Doubt").substring(0, 40)}..."`,
        type: "doubt",
      });

      setResolveDoubt(null);
      setResolveText("");
      toast.success("Doubt marked as resolved!");
    } catch (err: any) {
      toast.error("Failed to resolve: " + err.message);
    } finally {
      setResolveSaving(false);
    }
  };

  // Delete Doubt
  const handleDeleteDoubt = async (id: string) => {
    const target = doubts.find((d) => d.id === id);
    const confirmed = await showConfirm({
      title: "Delete Community Doubt?",
      message: "Are you sure you want to permanently delete this doubt query?",
      isDestructive: true,
      confirmText: "Delete Doubt",
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "doubts", id));
      logUserActivity(user?.email, {
        desc: `Deleted community doubt: "${(target?.question || "Doubt").substring(0, 40)}..."`,
        type: "delete",
      });
      toast.success("Doubt deleted successfully.");
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manage Doubts</h1>
      </div>

      {/* 4 KPI Metrics (2 in a row on mobile) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3 text-center">
        <div className="bg-white border border-slate-200 p-3 sm:p-4 rounded-2xl shadow-xs">
          <div className="text-xl sm:text-2xl font-black text-blue-600">{metrics.total}</div>
          <div className="text-[9px] sm:text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
            Total Doubts
          </div>
        </div>
        <div className="bg-rose-50 border border-rose-200 p-3 sm:p-4 rounded-2xl shadow-xs">
          <div className="text-xl sm:text-2xl font-black text-rose-700">{metrics.pending}</div>
          <div className="text-[9px] sm:text-[10px] font-bold text-rose-600 uppercase tracking-wider mt-1">
            Pending
          </div>
        </div>
        <div className="bg-amber-50 border border-amber-200 p-3 sm:p-4 rounded-2xl shadow-xs">
          <div className="text-xl sm:text-2xl font-black text-amber-700">{metrics.waiting}</div>
          <div className="text-[9px] sm:text-[10px] font-bold text-amber-600 uppercase tracking-wider mt-1">
            Waiting Verif.
          </div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 p-3 sm:p-4 rounded-2xl shadow-xs">
          <div className="text-xl sm:text-2xl font-black text-emerald-700">{metrics.resolved}</div>
          <div className="text-[9px] sm:text-[10px] font-bold text-emerald-600 uppercase tracking-wider mt-1">
            Resolved
          </div>
        </div>
      </div>

      {/* Contributor Leaderboard */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <Trophy className="w-5 h-5 text-amber-500" />
          <span>Contributor Leaderboard</span>
        </h2>

        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                <th className="p-3.5">Agent / Admin Name</th>
                <th className="p-3.5 text-center">Role</th>
                <th className="p-3.5 text-center">Doubts Asked</th>
                <th className="p-3.5 text-center">Doubts Resolved</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-slate-400">
                    No community doubt activity logged yet.
                  </td>
                </tr>
              ) : (
                leaderboard.map((u) => {
                  const isMaster = u.role === "Master Admin";
                  const isAdmin = u.role === "Admin";

                  return (
                    <tr key={u.email} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-3.5 font-bold text-slate-900">{u.displayName || u.email}</td>
                      <td className="p-3.5 text-center">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            isMaster
                              ? "bg-rose-50 text-rose-700"
                              : isAdmin
                              ? "bg-purple-50 text-purple-700"
                              : "bg-blue-50 text-blue-700"
                          }`}
                        >
                          {u.role || "Agent"}
                        </span>
                      </td>
                      <td className="p-3.5 text-center font-bold text-amber-600">{u.asked}</td>
                      <td className="p-3.5 text-center font-bold text-emerald-700">{u.resolved}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Doubts Management Table */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
        <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <HelpCircle className="w-5 h-5 text-blue-600" />
          <span>Doubts Registry</span>
        </h2>

        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                <th className="p-4">Author</th>
                <th className="p-4">Doubt Summary</th>
                <th className="p-4">Date</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-400">
                    Loading doubts...
                  </td>
                </tr>
              ) : doubts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-slate-400">
                    No doubts posted yet.
                  </td>
                </tr>
              ) : (
                doubts.map((d) => {
                  const isResolved = d.status === "resolved";
                  const isWaiting = d.status === "waiting";

                  return (
                    <tr key={d.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-4 font-bold text-slate-900">{d.author || "Anonymous"}</td>
                      <td className="p-4">
                        <div className="font-semibold text-slate-800 line-clamp-2 max-w-md">{d.question}</div>
                      </td>
                      <td className="p-4 text-slate-400">
                        {new Date(d.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </td>
                      <td className="p-4 text-center">
                        {isResolved ? (
                          <span className="bg-emerald-50 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full text-[10px]">
                            Resolved
                          </span>
                        ) : isWaiting ? (
                          <span className="bg-amber-50 text-amber-700 font-bold px-2.5 py-0.5 rounded-full text-[10px]">
                            Waiting Check
                          </span>
                        ) : (
                          <span className="bg-rose-50 text-rose-700 font-bold px-2.5 py-0.5 rounded-full text-[10px]">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => {
                              setResolveDoubt(d);
                              setResolveText(d.answer || "");
                            }}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold"
                          >
                            Resolve
                          </button>
                          <button
                            onClick={() => handleDeleteDoubt(d.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 rounded transition-colors"
                            title="Delete Doubt"
                          >
                            <Trash2 className="w-4 h-4" />
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

      {/* --- RESOLVE MODAL --- */}
      {resolveDoubt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Resolve Doubt</h3>
              <button onClick={() => setResolveDoubt(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-blue-50 border-l-4 border-blue-600 rounded-lg text-xs text-slate-800">
              <strong className="block text-[10px] text-blue-700 font-bold uppercase tracking-wider mb-1">
                Question:
              </strong>
              {resolveDoubt.question}
            </div>

            <form onSubmit={handleResolveSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Official Answer / Resolution
                </label>
                <textarea
                  value={resolveText}
                  onChange={(e) => setResolveText(e.target.value)}
                  rows={6}
                  required
                  placeholder="Provide resolution details..."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setResolveDoubt(null)}
                  className="px-3 py-1.5 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resolveSaving}
                  className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {resolveSaving ? "Saving..." : "Mark as Resolved"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
