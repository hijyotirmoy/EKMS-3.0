"use client";

import React, { useState, useEffect, useMemo } from "react";
import { collection, onSnapshot, addDoc, doc, updateDoc, increment } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Doubt } from "@/lib/types";
import {
  HelpCircle,
  Clock,
  ShieldAlert,
  CheckCircle2,
  Plus,
  Search,
  X,
  MessageSquare,
  CheckCheck,
  User as UserIcon,
} from "lucide-react";

export default function DoubtsPage() {
  const { user, userProfile, isLoggedIn, isAdmin, openLoginModal } = useAuth();
  const { toast } = usePopup();
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [activeFilter, setActiveFilter] = useState<"all" | "pending" | "waiting" | "resolved">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals
  const [askModalOpen, setAskModalOpen] = useState(false);
  const [askContent, setAskContent] = useState("");
  const [askLoading, setAskLoading] = useState(false);

  const [resolveModalDoubt, setResolveModalDoubt] = useState<Doubt | null>(null);
  const [resolveAnswer, setResolveAnswer] = useState("");
  const [resolveLoading, setResolveLoading] = useState(false);

  const [verifyModalDoubt, setVerifyModalDoubt] = useState<Doubt | null>(null);
  const [verifyAnswer, setVerifyAnswer] = useState("");
  const [verifyLoading, setVerifyLoading] = useState(false);

  // 1. Fetch Doubts Listener with cache-first instant render
  useEffect(() => {
    const cached = sessionStorage.getItem("ekms_doubts_cache");
    if (cached) {
      try {
        setDoubts(JSON.parse(cached));
        setLoading(false);
      } catch (e) {}
    }

    const unsubscribe = onSnapshot(
      collection(db, "doubts"),
      (snapshot) => {
        const list: Doubt[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...(doc.data() as Omit<Doubt, "id">) });
        });
        list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
        setDoubts(list);
        setLoading(false);

        try {
          sessionStorage.setItem("ekms_doubts_cache", JSON.stringify(list));
        } catch (e) {}
      },
      (err) => console.error("Doubts sync error:", err)
    );

    return () => unsubscribe();
  }, []);

  // Metrics
  const metrics = useMemo(() => {
    const total = doubts.length;
    const resolved = doubts.filter((d) => d.status === "resolved").length;
    const waiting = doubts.filter((d) => d.status === "waiting").length;
    const pending = doubts.filter((d) => d.status === "pending" || !d.status).length;
    return { total, resolved, waiting, pending };
  }, [doubts]);

  // Filtered List
  const filteredDoubts = useMemo(() => {
    let list = doubts;

    if (activeFilter !== "all") {
      list = list.filter((d) => d.status === activeFilter || (!d.status && activeFilter === "pending"));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (d) =>
          d.question?.toLowerCase().includes(q) ||
          d.answer?.toLowerCase().includes(q) ||
          d.author?.toLowerCase().includes(q) ||
          d.resolvedBy?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [doubts, activeFilter, searchQuery]);

  // --- 2. POST DOUBT ---
  const handlePostDoubt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoggedIn || !user) {
      openLoginModal();
      return;
    }
    if (!askContent.trim()) return;

    setAskLoading(true);
    try {
      const newDoubt = {
        question: askContent.trim(),
        description: "",
        author: userProfile?.displayName || userProfile?.name || user.email?.split("@")[0] || "Agent",
        authorEmail: user.email?.toLowerCase() || "",
        authorPhoto: userProfile?.photoURL || null,
        status: "pending" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await addDoc(collection(db, "doubts"), newDoubt);
      setAskContent("");
      setAskModalOpen(false);
      toast.success("Your doubt has been posted to the board!");
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to post doubt: " + err.message);
    } finally {
      setAskLoading(false);
    }
  };

  // --- 3. SUBMIT RESOLUTION (Moves to 'waiting') ---
  const handleSubmitResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveModalDoubt || !user) return;
    if (!resolveAnswer.trim()) return;

    setResolveLoading(true);
    const docRef = doc(db, "doubts", resolveModalDoubt.id);

    try {
      await updateDoc(docRef, {
        status: "waiting",
        answer: resolveAnswer.trim(),
        resolvedBy: userProfile?.displayName || userProfile?.name || user.email?.split("@")[0] || "Agent",
        resolvedByEmail: user.email?.toLowerCase(),
        resolvedByPhoto: userProfile?.photoURL || null,
        resolvedAt: Date.now(),
        updatedAt: Date.now(),
      });

      setResolveModalDoubt(null);
      setResolveAnswer("");
      toast.success("Your answer has been submitted for admin verification!");
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to submit resolution: " + err.message);
    } finally {
      setResolveLoading(false);
    }
  };

  // --- 4. ADMIN VERIFY RESOLUTION (Moves to 'resolved') ---
  const handleVerifyResolution = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyModalDoubt || !isAdmin) return;
    if (!verifyAnswer.trim()) return;

    setVerifyLoading(true);
    const docRef = doc(db, "doubts", verifyModalDoubt.id);

    try {
      await updateDoc(docRef, {
        status: "resolved",
        answer: verifyAnswer.trim(),
        updatedAt: Date.now(),
      });

      // Increment doubtsResolved on author profile
      if (verifyModalDoubt.resolvedByEmail) {
        try {
          const userDocRef = doc(db, "users", verifyModalDoubt.resolvedByEmail);
          await updateDoc(userDocRef, { doubtsResolved: increment(1) });
        } catch (e) {}
      }

      setVerifyModalDoubt(null);
      setVerifyAnswer("");
      toast.success("Answer approved and marked as officially resolved!");
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to verify doubt: " + err.message);
    } finally {
      setVerifyLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Community Doubts Board</h1>
        </div>
        <button
          onClick={() => {
            if (!isLoggedIn) {
              openLoginModal();
              return;
            }
            setAskContent("");
            setAskModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-sm transition-colors self-start"
        >
          <Plus className="w-4 h-4" />
          <span>Post a Doubt</span>
        </button>
      </div>

      {/* 4 Clickable Metric Filter Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 select-none">
        <button
          onClick={() => setActiveFilter("all")}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeFilter === "all"
              ? "bg-blue-600 border-blue-600 text-white shadow-md scale-[1.02]"
              : "bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider">Total Doubts</span>
            <HelpCircle className={`w-5 h-5 ${activeFilter === "all" ? "text-blue-200" : "text-blue-600"}`} />
          </div>
          <div className="text-2xl font-extrabold mt-2">{metrics.total}</div>
        </button>

        <button
          onClick={() => setActiveFilter("pending")}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeFilter === "pending"
              ? "bg-rose-600 border-rose-600 text-white shadow-md scale-[1.02]"
              : "bg-white border-slate-200 text-slate-700 hover:border-rose-300 hover:bg-rose-50/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider">Pending</span>
            <Clock className={`w-5 h-5 ${activeFilter === "pending" ? "text-rose-200" : "text-rose-600"}`} />
          </div>
          <div className="text-2xl font-extrabold mt-2">{metrics.pending}</div>
        </button>

        <button
          onClick={() => setActiveFilter("waiting")}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeFilter === "waiting"
              ? "bg-amber-600 border-amber-600 text-white shadow-md scale-[1.02]"
              : "bg-white border-slate-200 text-slate-700 hover:border-amber-300 hover:bg-amber-50/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider truncate">Waiting Verification</span>
            <ShieldAlert className={`w-5 h-5 ${activeFilter === "waiting" ? "text-amber-200" : "text-amber-600"}`} />
          </div>
          <div className="text-2xl font-extrabold mt-2">{metrics.waiting}</div>
        </button>

        <button
          onClick={() => setActiveFilter("resolved")}
          className={`p-4 rounded-xl border text-left transition-all ${
            activeFilter === "resolved"
              ? "bg-emerald-700 border-emerald-700 text-white shadow-md scale-[1.02]"
              : "bg-white border-slate-200 text-slate-700 hover:border-emerald-300 hover:bg-emerald-50/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider">Resolved</span>
            <CheckCircle2 className={`w-5 h-5 ${activeFilter === "resolved" ? "text-emerald-200" : "text-emerald-600"}`} />
          </div>
          <div className="text-2xl font-extrabold mt-2">{metrics.resolved}</div>
        </button>
      </div>

      {/* Live Search */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search doubts by question, author, or answer..."
          className="w-full pl-10 pr-8 py-2.5 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Doubts List */}
      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-16 text-slate-400">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Loading doubts board...</p>
          </div>
        ) : filteredDoubts.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs">
            <HelpCircle className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800 mb-1">No Doubts Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              There are no doubts matching your active filter. Be the first to post a question!
            </p>
            <button
              onClick={() => {
                setActiveFilter("all");
                setSearchQuery("");
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          filteredDoubts.map((doubt) => {
            const isResolved = doubt.status === "resolved";
            const isWaiting = doubt.status === "waiting";
            const isPending = doubt.status === "pending" || !doubt.status;

            const dateStr = new Date(doubt.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            });

            return (
              <div
                key={doubt.id}
                className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs hover:shadow-md transition-all space-y-4"
              >
                {/* Author & Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-700 font-bold text-xs flex items-center justify-center overflow-hidden border border-slate-200">
                      {doubt.authorPhoto ? (
                        <img src={doubt.authorPhoto} alt="Author" className="w-full h-full object-cover" />
                      ) : (
                        (doubt.author || "A").charAt(0).toUpperCase()
                      )}
                    </div>
                    <div>
                      <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                        <span>{doubt.author}</span>
                        <span className="text-[11px] font-normal text-slate-400">(asked by)</span>
                      </div>
                      <div className="text-[11px] text-slate-400">{dateStr}</div>
                    </div>
                  </div>

                  {/* Status Badge & Actions */}
                  <div className="flex flex-col items-end gap-2">
                    {isResolved ? (
                      <span className="bg-emerald-50 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Resolved
                      </span>
                    ) : isWaiting ? (
                      <span className="bg-amber-50 text-amber-700 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                        <ShieldAlert className="w-3 h-3" /> Waiting Verification
                      </span>
                    ) : (
                      <span className="bg-rose-50 text-rose-700 font-bold px-2.5 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Pending
                      </span>
                    )}

                    {/* Action Buttons */}
                    {isPending && (
                      <button
                        onClick={() => {
                          if (!isLoggedIn) {
                            openLoginModal();
                            return;
                          }
                          setResolveModalDoubt(doubt);
                          setResolveAnswer("");
                        }}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-semibold shadow-xs transition-colors"
                      >
                        Provide Answer
                      </button>
                    )}

                    {isWaiting && isAdmin && (
                      <button
                        onClick={() => {
                          setVerifyModalDoubt(doubt);
                          setVerifyAnswer(doubt.answer || "");
                        }}
                        className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold shadow-xs transition-colors flex items-center gap-1"
                      >
                        <CheckCheck className="w-3 h-3" /> Review & Verify
                      </button>
                    )}
                  </div>
                </div>

                {/* Question */}
                <div className="text-sm font-medium text-slate-800 leading-relaxed pl-12 whitespace-pre-wrap">
                  {doubt.question}
                </div>

                {/* Resolution Answer Box (If answered or verified) */}
                {(isResolved || isWaiting) && doubt.answer && (
                  <div className="mt-4 pt-4 border-t border-slate-100 pl-12 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-[10px] flex items-center justify-center overflow-hidden">
                        {doubt.resolvedByPhoto ? (
                          <img src={doubt.resolvedByPhoto} alt="Resolver" className="w-full h-full object-cover" />
                        ) : (
                          (doubt.resolvedBy || "A").charAt(0).toUpperCase()
                        )}
                      </div>
                      <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <span>{doubt.resolvedBy || "Agent"}</span>
                        {isResolved ? (
                          <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-0.5">
                            <CheckCircle2 className="w-3 h-3 inline" /> Verified Official Answer
                          </span>
                        ) : (
                          <span className="text-[10px] text-amber-600 font-semibold flex items-center gap-0.5">
                            <ShieldAlert className="w-3 h-3 inline" /> Proposed Answer (Pending Admin Check)
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-200 whitespace-pre-wrap">
                      {doubt.answer}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* --- POST DOUBT MODAL --- */}
      {askModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <HelpCircle className="w-5 h-5 text-blue-600" />
                <span>Ask a Question</span>
              </h3>
              <button onClick={() => setAskModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handlePostDoubt} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Your Question / Doubt Details
                </label>
                <textarea
                  value={askContent}
                  onChange={(e) => setAskContent(e.target.value)}
                  rows={5}
                  required
                  placeholder="Describe your question or difficulty regarding ESIC procedures, circulars, or portal operations..."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAskModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={askLoading}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {askLoading ? "Posting..." : "Post Question"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- PROVIDE ANSWER MODAL --- */}
      {resolveModalDoubt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">Resolve Doubt</h3>
              <button onClick={() => setResolveModalDoubt(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-blue-50 border-l-4 border-blue-600 rounded-lg text-xs text-slate-800">
              <strong className="block text-[10px] text-blue-700 font-bold uppercase tracking-wider mb-1">
                Original Question:
              </strong>
              {resolveModalDoubt.question}
            </div>

            <form onSubmit={handleSubmitResolution} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Your Proposed Answer
                </label>
                <textarea
                  value={resolveAnswer}
                  onChange={(e) => setResolveAnswer(e.target.value)}
                  rows={5}
                  required
                  placeholder="Provide a clear, accurate explanation to resolve this agent's query..."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setResolveModalDoubt(null)}
                  className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resolveLoading}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {resolveLoading ? "Submitting..." : "Submit for Verification"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- ADMIN REVIEW & VERIFY MODAL --- */}
      {verifyModalDoubt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <span>Review & Approve Answer</span>
              </h3>
              <button onClick={() => setVerifyModalDoubt(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800">
              <strong className="block text-[10px] text-slate-500 font-bold uppercase tracking-wider mb-1">
                Question:
              </strong>
              {verifyModalDoubt.question}
            </div>

            <form onSubmit={handleVerifyResolution} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Official Verified Answer (You may edit before approving)
                </label>
                <textarea
                  value={verifyAnswer}
                  onChange={(e) => setVerifyAnswer(e.target.value)}
                  rows={6}
                  required
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 font-normal leading-relaxed"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setVerifyModalDoubt(null)}
                  className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={verifyLoading}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm flex items-center gap-1.5"
                >
                  <CheckCheck className="w-4 h-4" />
                  <span>{verifyLoading ? "Publishing..." : "Approve & Publish"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
