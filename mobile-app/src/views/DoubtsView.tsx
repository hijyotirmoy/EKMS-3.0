import React, { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { collection, onSnapshot, doc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Doubt } from "../lib/types";
import {
  HelpCircle,
  Plus,
  CheckCircle2,
  Clock,
  User,
  X,
  Send,
  MessageSquare,
} from "lucide-react";

export default function DoubtsView() {
  const { user, userProfile, isAdmin } = useAuth();
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "resolved">("all");
  const [isAskOpen, setIsAskOpen] = useState(false);

  // Form State
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Admin Resolve Modal State
  const [resolvingDoubt, setResolvingDoubt] = useState<Doubt | null>(null);
  const [adminAnswer, setAdminAnswer] = useState("");
  const [resolvingSubmitting, setResolvingSubmitting] = useState(false);

  const userEmail = (user?.email || "").toLowerCase().trim();

  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "doubts"),
      (snapshot) => {
        const list: Doubt[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as Doubt);
        });
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setDoubts(list);
      },
      (err) => console.warn("Doubts listener error:", err)
    );

    return () => unsub();
  }, []);

  const handleAskDoubt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;

    setSubmitting(true);
    try {
      const docId = `doubt_${Date.now()}`;
      const newDoubt: Doubt = {
        id: docId,
        question: question.trim(),
        description: description.trim(),
        author: userProfile?.displayName || userProfile?.name || "Agent",
        authorEmail: userEmail,
        status: "pending",
        createdAt: Date.now(),
      };

      await setDoc(doc(db, "doubts", docId), newDoubt);

      setQuestion("");
      setDescription("");
      setIsAskOpen(false);
    } catch (e) {
      console.error("Ask doubt error:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResolveDoubt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvingDoubt || !adminAnswer.trim()) return;

    setResolvingSubmitting(true);
    try {
      await updateDoc(doc(db, "doubts", resolvingDoubt.id), {
        status: "resolved",
        answer: adminAnswer.trim(),
        resolvedBy: userProfile?.displayName || userProfile?.name || "Admin",
        resolvedAt: Date.now(),
      });

      setResolvingDoubt(null);
      setAdminAnswer("");
    } catch (e) {
      console.error("Resolve doubt error:", e);
    } finally {
      setResolvingSubmitting(false);
    }
  };

  const filteredDoubts = doubts.filter((d) => {
    if (filter === "pending") return d.status !== "resolved";
    if (filter === "resolved") return d.status === "resolved";
    return true;
  });

  return (
    <div className="p-4 space-y-4 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Q&A Knowledge</h2>
          <p className="text-xs text-slate-400">
            {doubts.length} queries submitted by field agents
          </p>
        </div>

        <button
          onClick={() => setIsAskOpen(true)}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-md shadow-blue-600/30 transition-all active:scale-95"
        >
          <Plus className="w-4 h-4" />
          Ask Doubt
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 p-1 rounded-2xl bg-slate-900 border border-slate-800 text-xs">
        <button
          onClick={() => setFilter("all")}
          className={`flex-1 py-1.5 rounded-xl font-semibold transition-all ${
            filter === "all" ? "bg-blue-600 text-white shadow" : "text-slate-400"
          }`}
        >
          All ({doubts.length})
        </button>
        <button
          onClick={() => setFilter("pending")}
          className={`flex-1 py-1.5 rounded-xl font-semibold transition-all ${
            filter === "pending" ? "bg-blue-600 text-white shadow" : "text-slate-400"
          }`}
        >
          Pending ({doubts.filter((d) => d.status !== "resolved").length})
        </button>
        <button
          onClick={() => setFilter("resolved")}
          className={`flex-1 py-1.5 rounded-xl font-semibold transition-all ${
            filter === "resolved" ? "bg-blue-600 text-white shadow" : "text-slate-400"
          }`}
        >
          Resolved ({doubts.filter((d) => d.status === "resolved").length})
        </button>
      </div>

      {/* List */}
      <div className="space-y-3">
        {filteredDoubts.length === 0 ? (
          <div className="text-center py-16 bg-slate-900/60 rounded-3xl border border-slate-800/60 p-6">
            <HelpCircle className="w-12 h-12 mx-auto mb-2 text-slate-600" />
            <h4 className="font-semibold text-white text-sm">No Queries</h4>
            <p className="text-xs text-slate-400 mt-1">
              Have questions regarding ESIC policies? Tap Ask Doubt above.
            </p>
          </div>
        ) : (
          filteredDoubts.map((item) => {
            const isResolved = item.status === "resolved";
            return (
              <div
                key={item.id}
                className="p-4 rounded-2xl bg-slate-900 border border-slate-800 space-y-2.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-bold text-white text-sm leading-snug">
                    {item.question}
                  </h4>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider flex-shrink-0 ${
                      isResolved
                        ? "bg-emerald-950/60 text-emerald-400 border border-emerald-500/30"
                        : "bg-amber-950/60 text-amber-400 border border-amber-500/30"
                    }`}
                  >
                    {isResolved ? "Answered" : "Pending"}
                  </span>
                </div>

                {item.description && (
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {item.description}
                  </p>
                )}

                {/* Answer box if resolved */}
                {isResolved && item.answer && (
                  <div className="p-3 rounded-xl bg-blue-950/30 border border-blue-500/20 text-xs text-slate-200">
                    <div className="flex items-center gap-1.5 text-blue-400 font-semibold mb-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Answer by {item.resolvedBy || "Expert"}:
                    </div>
                    <p className="leading-relaxed">{item.answer}</p>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
                  <span className="flex items-center gap-1 truncate max-w-[160px]">
                    <User className="w-3.5 h-3.5 text-slate-500" />
                    {item.author || item.authorEmail}
                  </span>

                  {isAdmin && !isResolved && (
                    <button
                      onClick={() => {
                        setResolvingDoubt(item);
                        setAdminAnswer("");
                      }}
                      className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-[11px] transition-colors"
                    >
                      Answer Query
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Ask Doubt */}
      {isAskOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-white animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-base text-white">Ask New Doubt</h3>
              <button
                onClick={() => setIsAskOpen(false)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAskDoubt} className="space-y-3.5">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Question
                </label>
                <input
                  type="text"
                  required
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="e.g. How to verify ESIC biometric for new IP?"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Additional Details (Optional)
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Provide context or hospital branch if applicable..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm shadow-md transition-all disabled:opacity-50"
                >
                  {submitting ? "Posting..." : "Submit Question"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsAskOpen(false)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-medium text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Admin Answer Query */}
      {resolvingDoubt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl text-white animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-base text-white">Answer Doubt</h3>
              <button
                onClick={() => setResolvingDoubt(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-blue-300 font-medium mb-3 p-2.5 rounded-xl bg-blue-950/40 border border-blue-500/30">
              &quot;{resolvingDoubt.question}&quot;
            </p>

            <form onSubmit={handleResolveDoubt} className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-300 block mb-1">
                  Your Official Answer
                </label>
                <textarea
                  rows={4}
                  required
                  value={adminAnswer}
                  onChange={(e) => setAdminAnswer(e.target.value)}
                  placeholder="Type clear resolution for the field agent..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={resolvingSubmitting}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm shadow-md transition-all disabled:opacity-50"
                >
                  {resolvingSubmitting ? "Saving..." : "Publish Answer"}
                </button>
                <button
                  type="button"
                  onClick={() => setResolvingDoubt(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-medium text-sm"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
