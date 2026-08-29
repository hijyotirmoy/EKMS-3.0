"use client";

import React, { useState } from "react";
import { collection, addDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { logUserActivity } from "@/lib/activityLogger";
import { notifyAdmins } from "@/lib/notificationService";
import { Flag, X, AlertCircle } from "lucide-react";

interface ReportIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetId?: string;
  reportType?: string; // 'Files' | 'Q&A' | 'Quiz' | 'Course' | 'Facility' | 'Updates' | 'Others'
  targetCodeOrName?: string;
}

export default function ReportIssueModal({
  isOpen,
  onClose,
  targetId = "",
  reportType = "Others",
  targetCodeOrName = "",
}: ReportIssueModalProps) {
  const { user, userProfile, isLoggedIn, openLoginModal } = useAuth();
  const { toast } = usePopup();
  const [selectedType, setSelectedType] = useState(reportType);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoggedIn || !user) {
      onClose();
      openLoginModal();
      return;
    }

    if (!message.trim()) {
      setErrorMsg("Please provide a description of the issue.");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const payload = {
        type: selectedType || "Others",
        message: message.trim(),
        targetCode: targetCodeOrName || targetId || "General Item",
        targetId: targetId || "",
        reporterName: userProfile?.displayName || userProfile?.name || user.email?.split("@")[0] || "Agent",
        reporterEmail: user.email?.toLowerCase() || "",
        status: "pending" as const,
        createdAt: Date.now(),
      };

      await addDoc(collection(db, "reports"), payload);

      const targetLabel = targetCodeOrName || targetId || selectedType;
      logUserActivity(user.email, {
        desc: `Submitted report on ${selectedType} [${targetLabel}]: "${message.trim().substring(0, 45)}..."`,
        type: "report",
      });

      // Notify Admins
      await notifyAdmins({
        title: `🚩 Issue Reported: ${selectedType}`,
        message: `**${payload.reporterName}** reported an issue regarding **${targetLabel}**: "${message.trim().substring(0, 80)}..."`,
        type: "report",
        link: "/reports",
      });

      setMessage("");
      onClose();
      toast.success("Your report has been submitted to the administration team. Thank you!");
    } catch (err: any) {
      console.error("Failed to submit report:", err);
      setErrorMsg("Failed to submit report. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-100 p-6">
        <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100">
          <div className="flex items-center gap-2 text-rose-600 font-bold text-lg">
            <Flag className="w-5 h-5" />
            <span>Report an Issue</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {targetCodeOrName && (
          <p className="text-xs text-slate-500 mb-4 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            Reporting on: <strong className="text-slate-800 font-semibold">{targetCodeOrName}</strong>
          </p>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Category
            </label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
            >
              <option value="Q&A">Q&A Knowledge Base</option>
              <option value="Files">Files & Downloads</option>
              <option value="Quiz">Assessment / Quiz</option>
              <option value="Course">Onboarding Course</option>
              <option value="Facility">Facility Locator</option>
              <option value="Others">Others / App Feedback</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Description of the Issue
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Describe typos, outdated information, broken links, or corrections..."
              required
              className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
            ></textarea>
          </div>

          {errorMsg && (
            <div className="flex items-start gap-2 bg-rose-50 text-rose-700 text-xs p-3 rounded-lg border border-rose-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 text-sm font-medium rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:bg-rose-400 text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
            >
              {submitting ? "Submitting..." : "Send Report"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
