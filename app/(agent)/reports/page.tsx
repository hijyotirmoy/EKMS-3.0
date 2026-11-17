"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  addDoc,
  deleteDoc,
  writeBatch,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { AppReport } from "@/lib/types";
import { logUserActivity } from "@/lib/activityLogger";
import { createNotification, notifyAdmins } from "@/lib/notificationService";
import {
  Flag,
  Search,
  Plus,
  Eye,
  CheckCircle2,
  X,
  FileText,
  HelpCircle,
  Gamepad2,
  GraduationCap,
  Building2,
  Megaphone,
  CalendarCheck,
  MessageSquare,
  Clock,
  Check,
  Layers,
  ArrowRight,
  Filter,
  Trash2,
  AlertTriangle,
  CheckSquare,
  Square,
} from "lucide-react";

export default function ReportsPage() {
  const { user, userProfile, isAdmin, isLoggedIn, openLoginModal } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [allReports, setAllReports] = useState<AppReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter State: 'pending' (default) | 'solved' | 'all'
  const [statusFilter, setStatusFilter] = useState<"pending" | "solved" | "all">("pending");

  // Selection & Bulk Actions
  const [selectedReportIds, setSelectedReportIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Modals
  const [viewReport, setViewReport] = useState<AppReport | null>(null);
  const [solveReport, setSolveReport] = useState<AppReport | null>(null);
  const [solveRemarks, setSolveRemarks] = useState("");
  const [solveLoading, setSolveLoading] = useState(false);

  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addType, setAddType] = useState("Q&A Knowledge Base");
  const [addMessage, setAddMessage] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // 1. Fetch All Reports in Real-Time
  useEffect(() => {
    let isMounted = true;

    const unsubscribe = onSnapshot(
      collection(db, "reports"),
      (snapshot) => {
        const list: AppReport[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...(doc.data() as Omit<AppReport, "id">) });
        });
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (isMounted) {
          setAllReports(list);
          setLoading(false);
        }
      },
      (err) => console.error("Reports sync error:", err)
    );

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  // 2. Counts for KPI boxes
  const { totalCount, pendingCount, solvedCount } = useMemo(() => {
    let pending = 0;
    let solved = 0;

    allReports.forEach((r) => {
      if (r.status === "solved") solved++;
      else pending++;
    });

    return {
      totalCount: allReports.length,
      pendingCount: pending,
      solvedCount: solved,
    };
  }, [allReports]);

  // 3. Filter Reports by Status & Search
  const filteredReports = useMemo(() => {
    let list = allReports;

    // Non-admin users can ONLY see pending reports and cannot see solved reports
    if (!isAdmin) {
      list = list.filter((r) => r.status !== "solved");
    } else {
      if (statusFilter === "pending") {
        list = list.filter((r) => r.status !== "solved");
      } else if (statusFilter === "solved") {
        list = list.filter((r) => r.status === "solved");
      }
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.reporterName?.toLowerCase().includes(q) ||
          r.reporterEmail?.toLowerCase().includes(q) ||
          r.message?.toLowerCase().includes(q) ||
          r.type?.toLowerCase().includes(q) ||
          r.targetCode?.toLowerCase().includes(q) ||
          r.resolvedBy?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [allReports, statusFilter, searchQuery, isAdmin]);

  // 4. Mark Report Solved with Admin Remarks Modal
  const handleOpenSolveModal = (report: AppReport) => {
    if (!isAdmin) return;
    setSolveReport(report);
    setSolveRemarks("");
  };

  const handleConfirmSolveReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !solveReport) return;

    if (!solveRemarks.trim()) {
      toast.error("Please enter resolution remarks before marking as solved.");
      return;
    }

    setSolveLoading(true);
    try {
      const adminName = userProfile?.displayName || userProfile?.name || user?.email?.split("@")[0] || "Admin";
      const remarksText = solveRemarks.trim();
      const docRef = doc(db, "reports", solveReport.id);

      await updateDoc(docRef, {
        status: "solved",
        resolvedAt: Date.now(),
        resolvedBy: adminName,
        adminRemarks: remarksText,
      });

      logUserActivity(user?.email, {
        desc: `Marked ${solveReport.type || "System"} report as solved with remarks: "${remarksText.substring(0, 40)}..."`,
        type: "report",
      });

      // Notify the agent who reported the issue with Admin Remarks
      if (solveReport.reporterEmail) {
        await createNotification({
          title: "✅ Reported Issue Resolved",
          message: `Your report regarding **${solveReport.targetCode || solveReport.type || "Feedback"}** has been marked as **Solved** by Admin (${adminName}).\n\n**Admin Remarks:** ${remarksText}`,
          type: "report",
          targetEmail: solveReport.reporterEmail.toLowerCase().trim(),
          link: "/reports",
        });
      }

      setSolveReport(null);
      setSolveRemarks("");
      if (viewReport?.id === solveReport.id) {
        setViewReport((prev) =>
          prev
            ? {
                ...prev,
                status: "solved",
                resolvedBy: adminName,
                resolvedAt: Date.now(),
                adminRemarks: remarksText,
              }
            : null
        );
      }
      toast.success("Report marked as solved with remarks.");
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to solve report.");
    } finally {
      setSolveLoading(false);
    }
  };

  // 5. Toggle Individual Report Selection
  const handleToggleSelectReport = (id: string) => {
    setSelectedReportIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 6. Toggle Select All Currently Filtered Reports
  const handleToggleSelectAll = () => {
    if (filteredReports.length === 0) return;
    const allFilteredSelected = filteredReports.every((r) => selectedReportIds.has(r.id));
    if (allFilteredSelected) {
      setSelectedReportIds(new Set());
    } else {
      const next = new Set(selectedReportIds);
      filteredReports.forEach((r) => next.add(r.id));
      setSelectedReportIds(next);
    }
  };

  // 7. Bulk Delete Selected Reports (Admin Only)
  const handleBulkDelete = async () => {
    if (!isAdmin || selectedReportIds.size === 0) return;

    const count = selectedReportIds.size;
    const confirmed = await showConfirm({
      title: `Permanently Delete ${count} Report${count === 1 ? "" : "s"}?`,
      message: `Are you sure you want to permanently delete ${count} selected report${count === 1 ? "" : "s"}? This action cannot be undone and will remove them from all views.`,
      isDestructive: true,
      confirmText: `Yes, Delete ${count} Report${count === 1 ? "" : "s"}`,
    });
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      const batch = writeBatch(db);
      selectedReportIds.forEach((id) => {
        batch.delete(doc(db, "reports", id));
      });
      await batch.commit();

      logUserActivity(user?.email, {
        desc: `Bulk deleted ${count} issue report${count === 1 ? "" : "s"}`,
        type: "delete",
      });

      setSelectedReportIds(new Set());
      if (viewReport && selectedReportIds.has(viewReport.id)) {
        setViewReport(null);
      }
      toast.success(`Successfully deleted ${count} report${count === 1 ? "" : "s"}.`);
    } catch (err: any) {
      console.error("Bulk delete error:", err);
      toast.error("Failed to delete reports: " + (err.message || "Unknown error"));
    } finally {
      setBulkDeleting(false);
    }
  };

  // 8. Single Report Delete (Admin Only)
  const handleSingleDelete = async (report: AppReport) => {
    if (!isAdmin) return;

    const confirmed = await showConfirm({
      title: "Delete Report?",
      message: `Are you sure you want to permanently delete this report by ${report.reporterName || report.reporterEmail || "Agent"}?`,
      isDestructive: true,
      confirmText: "Delete Report",
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "reports", report.id));
      logUserActivity(user?.email, {
        desc: `Deleted report from ${report.reporterName || report.reporterEmail}`,
        type: "delete",
      });
      setSelectedReportIds((prev) => {
        const next = new Set(prev);
        next.delete(report.id);
        return next;
      });
      if (viewReport?.id === report.id) {
        setViewReport(null);
      }
      toast.success("Report deleted successfully.");
    } catch (err: any) {
      console.error("Delete report error:", err);
      toast.error("Failed to delete report.");
    }
  };

  // 5. Submit Manual Report
  const handleCreateManualReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isLoggedIn || !user) {
      openLoginModal();
      return;
    }
    if (!addMessage.trim()) return;

    setAddLoading(true);
    try {
      const payload = {
        type: addType,
        message: addMessage.trim(),
        targetCode: "Manual Report",
        targetSourceTitle: "User Feedback",
        reporterName: userProfile?.displayName || userProfile?.name || user.email?.split("@")[0] || "Agent",
        reporterEmail: user.email?.toLowerCase() || "",
        status: "pending" as const,
        createdAt: Date.now(),
      };

      await addDoc(collection(db, "reports"), payload);
      logUserActivity(user.email, {
        desc: `Submitted ${addType} report: "${addMessage.trim().substring(0, 45)}..."`,
        type: "report",
      });

      // Notify Admins
      await notifyAdmins({
        title: `🚩 Issue Reported: ${addType}`,
        message: `**${payload.reporterName}** submitted a report: "${addMessage.trim().substring(0, 80)}..."`,
        type: "report",
        link: "/reports",
      });

      setAddMessage("");
      setAddModalOpen(false);
      toast.success("Report submitted successfully!");
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to submit report.");
    } finally {
      setAddLoading(false);
    }
  };

  // Type badge helper (Updated with Booking and Feedback, removed Updates/News)
  const getTypeBadge = (type?: string) => {
    const t = (type || "others").toLowerCase();
    if (t.includes("booking"))
      return { bg: "bg-orange-50 text-orange-700 border-orange-200", icon: CalendarCheck, label: "Booking" };
    if (t.includes("feedback"))
      return { bg: "bg-pink-50 text-pink-700 border-pink-200", icon: MessageSquare, label: "Feedback" };
    if (t.includes("file"))
      return { bg: "bg-blue-50 text-blue-700 border-blue-200", icon: FileText, label: "Files" };
    if (t.includes("q&a") || t.includes("qna") || t.includes("knowledge"))
      return { bg: "bg-rose-50 text-rose-700 border-rose-200", icon: HelpCircle, label: "Q&A" };
    if (t.includes("quiz"))
      return { bg: "bg-purple-50 text-purple-700 border-purple-200", icon: Gamepad2, label: "Quiz" };
    if (t.includes("facility"))
      return { bg: "bg-teal-50 text-teal-700 border-teal-200", icon: Building2, label: "Facility" };
    if (t.includes("course") || t.includes("onboarding"))
      return { bg: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: GraduationCap, label: "Course" };
    if (t.includes("update") || t.includes("news"))
      return { bg: "bg-amber-50 text-amber-700 border-amber-200", icon: Megaphone, label: "Updates" };
    return { bg: "bg-slate-100 text-slate-700 border-slate-200", icon: Flag, label: "Others" };
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manage Reports</h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-48 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search reports by user, message..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
            />
          </div>

          <button
            onClick={() => {
              if (!isLoggedIn) {
                openLoginModal();
                return;
              }
              setAddMessage("");
              setAddModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Create Report</span>
          </button>
        </div>
      </div>

      {/* Top KPI Filter Boxes (Admins see all 3, Regular users only see Pending) */}
      <div className={`grid gap-3 select-none ${isAdmin ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-3"}`}>
        {/* Pending Reports (Active by Default) */}
        <div
          onClick={() => setStatusFilter("pending")}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
            statusFilter === "pending"
              ? "bg-amber-50/90 border-amber-400 ring-2 ring-amber-500/30 shadow-md scale-[1.01]"
              : "bg-amber-50/70 border-amber-200 hover:border-amber-300 hover:shadow-xs"
          }`}
        >
          <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">
            Pending Reports
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-900 mt-1">{pendingCount}</div>
        </div>

        {/* Solved Reports - Admin Only */}
        {isAdmin && (
          <div
            onClick={() => setStatusFilter("solved")}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
              statusFilter === "solved"
                ? "bg-emerald-50/90 border-emerald-400 ring-2 ring-emerald-500/30 shadow-md scale-[1.01]"
                : "bg-emerald-50/70 border-emerald-200 hover:border-emerald-300 hover:shadow-xs"
            }`}
          >
            <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">
              Solved Reports
            </div>
            <div className="text-xl sm:text-2xl font-black text-emerald-900 mt-1">{solvedCount}</div>
          </div>
        )}

        {/* Total Reports - Admin Only */}
        {isAdmin && (
          <div
            onClick={() => setStatusFilter("all")}
            className={`p-3.5 rounded-xl border transition-all cursor-pointer col-span-2 sm:col-span-1 flex flex-col justify-between ${
              statusFilter === "all"
                ? "bg-blue-50/90 border-blue-400 ring-2 ring-blue-500/30 shadow-md scale-[1.01]"
                : "bg-blue-50/70 border-blue-200 hover:border-blue-300 hover:shadow-xs"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">
                Total Reports
              </div>
              <span className="text-[10px] bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded font-bold">
                Admin
              </span>
            </div>
            <div className="text-xl sm:text-2xl font-black text-blue-900 mt-1">{totalCount}</div>
          </div>
        )}
      </div>

      {/* Reports Table Section */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-900 text-base">
              {statusFilter === "pending"
                ? "Pending Resolution Queue"
                : statusFilter === "solved"
                ? "Resolved Issues History"
                : "All Reports & Feedback"}
            </h3>
            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold text-xs">
              {filteredReports.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isAdmin && filteredReports.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleToggleSelectAll}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-xs font-semibold transition-colors flex items-center gap-1"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    {filteredReports.length > 0 &&
                    filteredReports.every((r) => selectedReportIds.has(r.id))
                      ? "Deselect All"
                      : "Select All"}
                  </span>
                </button>
                {selectedReportIds.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="px-3.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-xs font-bold shadow-xs transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{bulkDeleting ? "Deleting..." : `Delete (${selectedReportIds.size})`}</span>
                  </button>
                )}
              </div>
            )}

            {isAdmin && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setStatusFilter("pending")}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                    statusFilter === "pending"
                      ? "bg-amber-600 text-white shadow-2xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Pending
                </button>
                <button
                  onClick={() => setStatusFilter("solved")}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                    statusFilter === "solved"
                      ? "bg-emerald-600 text-white shadow-2xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  Solved History
                </button>
                <button
                  onClick={() => setStatusFilter("all")}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                    statusFilter === "all"
                      ? "bg-blue-600 text-white shadow-2xs"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  All
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Bulk Action Bar for Selected Reports */}
        {isAdmin && selectedReportIds.size > 0 && (
          <div className="flex items-center justify-between bg-rose-50 border border-rose-200 px-4 py-2.5 rounded-2xl text-xs shadow-xs animate-in fade-in">
            <div className="flex items-center gap-2 font-bold text-rose-900">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>
                {selectedReportIds.size} report{selectedReportIds.size === 1 ? "" : "s"} selected for deletion
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedReportIds(new Set())}
                className="px-3 py-1.5 bg-white border border-rose-200 text-rose-700 hover:bg-rose-50 rounded-xl font-semibold transition-colors"
              >
                Deselect All
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl font-bold flex items-center gap-1.5 shadow-xs transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{bulkDeleting ? "Deleting..." : `Delete Selected (${selectedReportIds.size})`}</span>
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                {isAdmin && (
                  <th className="p-4 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={
                        filteredReports.length > 0 &&
                        filteredReports.every((r) => selectedReportIds.has(r.id))
                      }
                      onChange={handleToggleSelectAll}
                      className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                      title="Select all"
                    />
                  </th>
                )}
                <th className="p-4">Reporter</th>
                <th className="p-4">Date & Time</th>
                <th className="p-4">Domain Context</th>
                <th className="p-4">Message</th>
                {statusFilter === "solved" && <th className="p-4">Resolved By</th>}
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {loading ? (
                <tr>
                  <td
                    colSpan={isAdmin ? (statusFilter === "solved" ? 7 : 6) : statusFilter === "solved" ? 6 : 5}
                    className="text-center py-16 text-slate-400"
                  >
                    Loading reports...
                  </td>
                </tr>
              ) : filteredReports.length === 0 ? (
                <tr>
                  <td
                    colSpan={isAdmin ? (statusFilter === "solved" ? 7 : 6) : statusFilter === "solved" ? 6 : 5}
                    className="text-center py-16 text-slate-400"
                  >
                    {statusFilter === "pending"
                      ? "No pending reports! All reported issues are currently resolved."
                      : statusFilter === "solved"
                      ? "No solved reports recorded yet."
                      : "No reports found matching your criteria."}
                  </td>
                </tr>
              ) : (
                filteredReports.map((report) => {
                  const badge = getTypeBadge(report.type);
                  const IconComp = badge.icon;
                  const isSolved = report.status === "solved";
                  const isSelected = selectedReportIds.has(report.id);

                  return (
                    <tr
                      key={report.id}
                      className={`transition-colors ${
                        isSelected ? "bg-rose-50/50" : "hover:bg-slate-50/70"
                      }`}
                    >
                      {isAdmin && (
                        <td className="p-4 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleSelectReport(report.id)}
                            className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                          />
                        </td>
                      )}

                      <td className="p-4">
                        <div className="font-bold text-slate-900">{report.reporterName || "Agent"}</div>
                        <div className="text-[10px] text-slate-400">{report.reporterEmail}</div>
                      </td>

                      <td className="p-4 text-slate-500 whitespace-nowrap">
                        {report.createdAt
                          ? new Date(report.createdAt).toLocaleString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : "—"}
                      </td>

                      <td className="p-4 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-bold border ${badge.bg}`}
                        >
                          <IconComp className="w-3 h-3" />
                          <span>{badge.label}</span>
                        </span>
                      </td>

                      <td className="p-4 max-w-md">
                        <div className="text-slate-800 line-clamp-2 leading-relaxed">{report.message}</div>
                        {report.targetCode && (
                          <div className="text-[10px] text-blue-600 font-semibold mt-0.5">
                            Target: {report.targetCode}
                          </div>
                        )}
                      </td>

                      {statusFilter === "solved" && (
                        <td className="p-4 whitespace-nowrap">
                          <div className="font-semibold text-emerald-700">
                            {report.resolvedBy || "Admin"}
                          </div>
                          {report.resolvedAt && (
                            <div className="text-[10px] text-slate-400">
                              {new Date(report.resolvedAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                              })}
                            </div>
                          )}
                        </td>
                      )}

                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setViewReport(report)}
                            className="flex items-center gap-1 px-2.5 py-1 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
                          </button>

                          {isAdmin && !isSolved && (
                            <button
                              onClick={() => handleOpenSolveModal(report)}
                              className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-2xs transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Solved</span>
                            </button>
                          )}

                          {isAdmin && (
                            <button
                              onClick={() => handleSingleDelete(report)}
                              className="flex items-center gap-1 px-2 py-1 border border-rose-200 hover:bg-rose-50 text-rose-600 hover:text-rose-700 rounded-lg text-xs font-semibold transition-colors"
                              title="Delete report"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span className="hidden md:inline">Delete</span>
                            </button>
                          )}
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

      {/* ====================================================
          MODAL 1: VIEW REPORT DETAILS
          ==================================================== */}
      {viewReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-lg w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Flag className="w-5 h-5 text-rose-600" />
                <span>Report Details</span>
              </h3>
              <button
                onClick={() => setViewReport(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Reporter</span>
                  <span className="font-bold text-slate-900">{viewReport.reporterName}</span>
                  <div className="text-[10px] text-slate-400">{viewReport.reporterEmail}</div>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Category</span>
                  <span className="font-bold text-slate-800">{viewReport.type}</span>
                </div>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Message</span>
                <p className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 leading-relaxed whitespace-pre-wrap">
                  {viewReport.message}
                </p>
              </div>

              {viewReport.status === "solved" && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-900 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs flex items-center gap-1.5 text-emerald-800">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      Status: Resolved
                    </span>
                    <span className="text-[10px] text-emerald-700">
                      {viewReport.resolvedAt
                        ? new Date(viewReport.resolvedAt).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                  <div className="text-[11px] text-emerald-800">
                    <span className="font-semibold">Resolved by:</span> {viewReport.resolvedBy || "Admin"}
                  </div>
                  {viewReport.adminRemarks && (
                    <div className="pt-2 border-t border-emerald-200/60">
                      <span className="font-bold text-xs text-emerald-900 block mb-1">
                        Admin Remarks:
                      </span>
                      <p className="text-xs text-emerald-950 bg-white/80 p-2.5 rounded-lg border border-emerald-200/80 leading-relaxed whitespace-pre-wrap">
                        {viewReport.adminRemarks}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => handleSingleDelete(viewReport)}
                  className="px-3.5 py-2 border border-rose-200 hover:bg-rose-50 text-rose-600 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete Report</span>
                </button>
              ) : (
                <div />
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewReport(null)}
                  className="px-4 py-2 border rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Close
                </button>
                {isAdmin && viewReport.status !== "solved" && (
                  <button
                    type="button"
                    onClick={() => handleOpenSolveModal(viewReport)}
                    disabled={solveLoading}
                    className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1 transition-colors"
                  >
                    <Check className="w-4 h-4" />
                    <span>Mark as Solved</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL 2: SOLVE REPORT & ENTER REMARKS (ADMIN)
          ==================================================== */}
      {solveReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                <span>Mark Report as Solved</span>
              </h3>
              <button
                onClick={() => setSolveReport(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmSolveReport} className="space-y-4">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-xs">
                <div className="font-bold text-slate-800 flex items-center justify-between">
                  <span>Report from {solveReport.reporterName}</span>
                  <span className="text-[10px] text-slate-500">{solveReport.reporterEmail}</span>
                </div>
                <p className="text-slate-600 line-clamp-2 italic">"{solveReport.message}"</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Admin Remarks / Resolution Details *
                </label>
                <textarea
                  value={solveRemarks}
                  onChange={(e) => setSolveRemarks(e.target.value)}
                  placeholder="Enter remarks explaining how the issue was resolved..."
                  required
                  rows={4}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500 leading-relaxed font-sans resize-none"
                />
                <span className="text-[10px] text-slate-400 mt-1 block">
                  These remarks will be attached to the report and sent as a notification to the reporting agent.
                </span>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setSolveReport(null)}
                  className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={solveLoading}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition-colors"
                >
                  <Check className="w-4 h-4" />
                  <span>{solveLoading ? "Resolving..." : "Confirm & Solve"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Flag className="w-5 h-5 text-rose-600" />
                <span>Create New Report</span>
              </h3>
              <button
                onClick={() => setAddModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateManualReport} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Category Type
                </label>
                <select
                  value={addType}
                  onChange={(e) => setAddType(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-800"
                >
                  <option value="Q&A Knowledge Base">Q&A Knowledge Base</option>
                  <option value="Files">Files</option>
                  <option value="Quiz / Assessment">Quiz / Assessment</option>
                  <option value="Course / Onboarding">Course / Onboarding</option>
                  <option value="Facility Locator">Facility Locator</option>
                  <option value="Booking">Booking</option>
                  <option value="Feedback">Feedback</option>
                  <option value="Others">Others</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Issue Description or Feedback *
                </label>
                <textarea
                  value={addMessage}
                  onChange={(e) => setAddMessage(e.target.value)}
                  placeholder="Describe the issue, correction, or feedback in detail..."
                  required
                  rows={4}
                  className="w-full px-3.5 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-rose-500 leading-relaxed font-sans resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addLoading}
                  className="px-5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs"
                >
                  {addLoading ? "Submitting..." : "Submit Report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
