"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { touchMetadata } from "@/lib/cache";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { QnAItem } from "@/lib/types";
import { logUserActivity } from "@/lib/activityLogger";
import { createNotification } from "@/lib/notificationService";
import * as XLSX from "xlsx";
import {
  HelpCircle,
  Plus,
  FileSpreadsheet,
  Download,
  Upload,
  Search,
  Trash2,
  Edit2,
  ChevronLeft,
  ChevronRight,
  Bot,
  Tags,
  Layers,
  X,
  Bold,
  Italic,
  List,
  Link as LinkIcon,
} from "lucide-react";

export default function AdminQAPage() {
  const { user } = useAuth();
  const { toast, showAlert, showConfirm } = usePopup();
  const [qaList, setQaList] = useState<QnAItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Search & Pagination
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Add / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [qaQuestion, setQaQuestion] = useState("");
  const [qaAnswer, setQaAnswer] = useState("");
  const [qaCategory, setQaCategory] = useState("General");
  const [qaCategoryCustom, setQaCategoryCustom] = useState("");
  const [qaTags, setQaTags] = useState("");
  const [qaAiOptimized, setQaAiOptimized] = useState(false);
  const [modalSaving, setModalSaving] = useState(false);

  // Custom Link Modal
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("https://");

  // 1. Fetch Q&A Listener
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "qna"),
      (snapshot) => {
        const list: QnAItem[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...(d.data() as Omit<QnAItem, "id">) });
        });
        list.sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
        setQaList(list);
        setLoading(false);
      },
      (err) => console.error("Q&A sync error:", err)
    );

    return () => unsubscribe();
  }, []);

  // 2. Metrics & Category Breakdown
  const { metrics, categoryBreakdown, distinctCategories } = useMemo(() => {
    const total = qaList.length;
    const catMap: Record<string, number> = {};
    let aiCount = 0;

    qaList.forEach((q) => {
      const c = q.category?.trim() || "Uncategorized";
      catMap[c] = (catMap[c] || 0) + 1;
      if (q.isAiOptimized) aiCount++;
    });

    const breakdown = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
    const categories = Object.keys(catMap).sort();

    return {
      metrics: { total, categoriesCount: categories.length, aiCount },
      categoryBreakdown: breakdown,
      distinctCategories: categories,
    };
  }, [qaList]);

  // 3. Filtered List
  const filteredQAs = useMemo(() => {
    if (!searchTerm.trim()) return qaList;
    const q = searchTerm.toLowerCase().trim();
    const numQ = q.replace(/\D/g, "");

    return qaList.filter((item) => {
      const matchQ = item.question?.toLowerCase().includes(q);
      const matchA = item.answer?.toLowerCase().includes(q);
      const matchCat = item.category?.toLowerCase().includes(q);
      const matchTag = item.tags?.some((t) => t.toLowerCase().includes(q));
      const matchCode = item.qaCode?.toLowerCase().includes(q);
      const matchSeq = numQ && item.qaSequence && String(item.qaSequence) === numQ;

      return matchQ || matchA || matchCat || matchTag || matchCode || matchSeq;
    });
  }, [qaList, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filteredQAs.length / itemsPerPage));
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredQAs.slice(start, start + itemsPerPage);
  }, [filteredQAs, currentPage]);

  // Open Modal Handler
  const handleOpenModal = (qa?: QnAItem) => {
    if (qa) {
      setEditId(qa.id);
      setQaQuestion(qa.question || "");
      setQaAnswer(qa.answer || "");
      setQaTags((qa.tags || []).join(", "));
      setQaAiOptimized(!!qa.isAiOptimized);

      if (distinctCategories.includes(qa.category || "")) {
        setQaCategory(qa.category || "General");
        setQaCategoryCustom("");
      } else {
        setQaCategory("_custom_");
        setQaCategoryCustom(qa.category || "");
      }
    } else {
      setEditId(null);
      setQaQuestion("");
      setQaAnswer("");
      setQaCategory("General");
      setQaCategoryCustom("");
      setQaTags("");
      setQaAiOptimized(false);
    }
    setModalOpen(true);
  };

  // Save Modal
  const handleSaveModal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qaQuestion.trim() || !qaAnswer.trim()) {
      toast.warning("Both Question/Title and Answer are required.");
      return;
    }

    setModalSaving(true);
    const finalCategory = qaCategory === "_custom_" ? qaCategoryCustom.trim() : qaCategory;
    const tagArray = qaTags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    try {
      if (editId) {
        await setDoc(
          doc(db, "qna", editId),
          {
            question: qaQuestion.trim(),
            answer: qaAnswer.trim(),
            category: finalCategory || "General",
            tags: tagArray,
            isAiOptimized: qaAiOptimized,
            updatedAt: Date.now(),
          },
          { merge: true }
        );
        logUserActivity(user?.email, {
          desc: `Edited Q&A: "${qaQuestion.trim().substring(0, 40)}..."`,
          type: "edit",
        });
        toast.success("Q&A article updated successfully!");
      } else {
        // Compute next sequence number
        const nextSeq = Math.max(0, ...qaList.map((q) => q.qaSequence || 0)) + 1;
        const qaCode = `QA-${String(nextSeq).padStart(3, "0")}`;

        await setDoc(doc(collection(db, "qna")), {
          question: qaQuestion.trim(),
          answer: qaAnswer.trim(),
          category: finalCategory || "General",
          tags: tagArray,
          isAiOptimized: qaAiOptimized,
          qaSequence: nextSeq,
          qaCode,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        logUserActivity(user?.email, {
          desc: `Published new Q&A [${qaCode}]: "${qaQuestion.trim().substring(0, 40)}..."`,
          type: "add",
        });

        // Notify all users about new Q&A
        await createNotification({
          title: `💡 New Guidance: ${qaCode}`,
          message: `A new guidance article **[${qaCode}] "${qaQuestion.trim().substring(0, 60)}..."** has been published under **${finalCategory || "General"}**.`,
          type: "qna",
          targetEmail: "all",
          link: `/?search=${encodeURIComponent(qaCode)}`,
        });

        toast.success("New Q&A article published!");
      }

      await touchMetadata("qna");
      setModalOpen(false);
    } catch (err: any) {
      toast.error("Failed to save Q&A: " + err.message);
    } finally {
      setModalSaving(false);
    }
  };

  // Delete Single
  const handleDeleteSingle = async (id: string) => {
    const target = qaList.find((q) => q.id === id);
    const confirmed = await showConfirm({
      title: "Delete Q&A Article?",
      message: "Are you sure you want to permanently delete this Q&A article?",
      isDestructive: true,
      confirmText: "Delete Article",
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "qna", id));
      await touchMetadata("qna");
      logUserActivity(user?.email, {
        desc: `Deleted Q&A [${target?.qaCode || "Article"}]: "${(target?.question || "").substring(0, 35)}..."`,
        type: "delete",
      });
      toast.success("Q&A article deleted.");
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await showConfirm({
      title: "Delete Selected Articles?",
      message: `Are you sure you want to delete ${selectedIds.size} selected Q&A articles?`,
      isDestructive: true,
      confirmText: "Delete Articles",
    });
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      const batch = writeBatch(db);
      selectedIds.forEach((id) => {
        batch.delete(doc(db, "qna", id));
      });
      await batch.commit();
      await touchMetadata("qna");
      setSelectedIds(new Set());
      toast.success(`${selectedIds.size} articles deleted successfully.`);
    } catch (e: any) {
      toast.error("Bulk delete failed: " + e.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  // Export Excel
  const handleExportExcel = () => {
    const ws = XLSX.utils.json_to_sheet(
      qaList.map((q) => ({
        "Q&A Code": q.qaCode,
        Category: q.category,
        "Title or Question": q.question,
        "Main Content / Answer": q.answer,
        Tags: (q.tags || []).join(", "),
        "AI Optimized": q.isAiOptimized ? "Yes" : "No",
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Master_QA");
    XLSX.writeFile(wb, `ESIC_QNA_Export_${new Date().toISOString().split("T")[0]}.xlsx`);
  };

  // Download Template
  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Category", "Title or Question", "Main Content / Answer", "Tags"],
      ["ESIC Claims", "How to submit sickness claim?", "Submit Form 9 to branch office.", "sickness, claim, benefits"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "QA_Template");
    XLSX.writeFile(wb, "ESIC_QA_Bulk_Template.xlsx");
  };

  // Bulk Excel Upload
  const handleBulkUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

        if (rows.length === 0) {
          toast.warning("The uploaded spreadsheet is empty.");
          return;
        }

        let nextSeq = Math.max(0, ...qaList.map((q) => q.qaSequence || 0));
        const batch = writeBatch(db);
        let count = 0;

        rows.forEach((row) => {
          const q = row["Title or Question"] || row["Question"] || row["title"] || "";
          const a = row["Main Content / Answer"] || row["Answer"] || row["content"] || "";
          const cat = row["Category"] || "General";
          const tags = row["Tags"] || "";

          if (!String(q).trim() || !String(a).trim()) return;

          nextSeq++;
          const qaCode = `QA-${String(nextSeq).padStart(3, "0")}`;
          const tagArray = String(tags)
            .split(",")
            .map((t) => t.trim())
            .filter((t) => t.length > 0);

          const docRef = doc(collection(db, "qna"));
          batch.set(docRef, {
            question: String(q).trim(),
            answer: String(a).trim(),
            category: String(cat).trim(),
            tags: tagArray,
            isAiOptimized: false,
            qaSequence: nextSeq,
            qaCode,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          });
          count++;
        });

        if (count > 0) {
          await batch.commit();
          await touchMetadata("qna");

          // Dispatch ONE summary notification for the bulk upload
          await createNotification({
            title: `📚 ${count} New Guidance Articles Published`,
            message: `**${count} new Q&A articles** have been added to the ESIC KMS knowledge base. Search or explore them on the guidance portal!`,
            type: "qna",
            targetEmail: "all",
            link: "/",
          });

          toast.success(`Successfully uploaded ${count} new Q&A items!`);
        }
      } catch (err: any) {
        toast.error("Upload error: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manage Q&A</h1>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="file"
            id="bulkQaInput"
            accept=".xlsx, .xls, .csv"
            className="hidden"
            onChange={handleBulkUpload}
          />

          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold shadow-xs"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export (.xlsx)</span>
          </button>

          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-blue-600 rounded-xl text-xs font-semibold shadow-xs"
          >
            <Download className="w-4 h-4" />
            <span>Template</span>
          </button>

          <button
            onClick={() => document.getElementById("bulkQaInput")?.click()}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 text-emerald-800 rounded-xl text-xs font-semibold shadow-xs"
          >
            <Upload className="w-4 h-4" />
            <span>Bulk Upload</span>
          </button>

          <button
            onClick={() => handleOpenModal()}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold shadow-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Add New Q&A</span>
          </button>
        </div>
      </div>

      {/* 3 Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-blue-50/70 border border-blue-200 p-3.5 rounded-xl flex flex-col justify-between">
          <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">Total Q&A Articles</div>
          <div className="text-xl sm:text-2xl font-black text-blue-900 mt-1">{metrics.total}</div>
        </div>

        <div className="bg-emerald-50/70 border border-emerald-200 p-3.5 rounded-xl flex flex-col justify-between">
          <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Total Categories</div>
          <div className="text-xl sm:text-2xl font-black text-emerald-900 mt-1">{metrics.categoriesCount}</div>
        </div>

        <div className="bg-purple-50/70 border border-purple-200 p-3.5 rounded-xl col-span-2 sm:col-span-1 flex flex-col justify-between">
          <div className="text-[10px] font-bold text-purple-800 uppercase tracking-wider">VA Responses</div>
          <div className="text-xl sm:text-2xl font-black text-purple-900 mt-1">{metrics.aiCount}</div>
        </div>
      </div>

      {/* Category Breakdown Pills */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-3">
        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
          <Layers className="w-4 h-4 text-emerald-600" />
          <span>Category Distribution</span>
        </h3>
        <div className="flex items-center gap-2 flex-wrap">
          {categoryBreakdown.map(([cat, count]) => (
            <span
              key={cat}
              className="bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full text-xs font-semibold text-slate-700 flex items-center gap-2"
            >
              <span>{cat}</span>
              <span className="bg-blue-100 text-blue-800 text-[10px] font-extrabold px-2 py-0.2 rounded-full">
                {count}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
        {/* Table Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setCurrentPage(1);
                }}
                placeholder="Search Q&A code, question, category, or answer content..."
                className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm("");
                    setCurrentPage(1);
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                  title="Clear Search"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Total Results Found Badge */}
            <div className="px-3 py-2 bg-blue-50 border border-blue-200 rounded-xl text-xs font-bold text-blue-700 whitespace-nowrap shadow-xs">
              <span>{filteredQAs.length}</span>
              <span className="text-blue-500 font-medium"> of </span>
              <span>{qaList.length}</span>
              <span className="hidden md:inline"> Q&As</span>
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-rose-800">{selectedIds.size} selected</span>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{bulkDeleting ? "Deleting..." : "Delete Selected"}</span>
              </button>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                <th className="p-4 text-center">
                  <input
                    type="checkbox"
                    checked={
                      paginatedList.length > 0 && paginatedList.every((q) => selectedIds.has(q.id))
                    }
                    onChange={(e) => {
                      const next = new Set(selectedIds);
                      if (e.target.checked) {
                        paginatedList.forEach((q) => next.add(q.id));
                      } else {
                        paginatedList.forEach((q) => next.delete(q.id));
                      }
                      setSelectedIds(next);
                    }}
                    className="cursor-pointer"
                  />
                </th>
                <th className="p-4">Q&A No.</th>
                <th className="p-4">Category</th>
                <th className="p-4">Title / Question</th>
                <th className="p-4">Date</th>
                <th className="p-4 text-center">AI Ready</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {paginatedList.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-400">
                    No Q&A articles found.
                  </td>
                </tr>
              ) : (
                paginatedList.map((qa) => (
                  <tr key={qa.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-4 text-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(qa.id)}
                        onChange={(e) => {
                          const next = new Set(selectedIds);
                          if (e.target.checked) next.add(qa.id);
                          else next.delete(qa.id);
                          setSelectedIds(next);
                        }}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="p-4 font-mono font-bold text-blue-600">{qa.qaCode || "QA-???"}</td>
                    <td className="p-4">
                      <span className="bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded text-[10px] uppercase">
                        {qa.category}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-slate-900 line-clamp-2 max-w-md">{qa.question}</div>
                    </td>
                    <td className="p-4 text-slate-400">
                      {new Date(qa.updatedAt || qa.createdAt || Date.now()).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td className="p-4 text-center">
                      {qa.isAiOptimized ? (
                        <span className="bg-purple-50 text-purple-700 font-bold px-2 py-0.5 rounded-full text-[10px]">
                          Optimized
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleOpenModal(qa)}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded"
                          title="Edit Q&A"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteSingle(qa.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded"
                          title="Delete Q&A"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-3">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-1 bg-slate-100 disabled:opacity-40 rounded text-xs font-semibold"
            >
              Previous
            </button>
            <span className="text-xs text-slate-500">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-1 bg-slate-100 disabled:opacity-40 rounded text-xs font-semibold"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* --- ADD / EDIT Q&A MODAL --- */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white max-w-2xl w-full rounded-3xl shadow-2xl p-6 sm:p-8 space-y-4 max-h-[90vh] overflow-y-auto border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editId ? "Edit Knowledge Q&A" : "Add New Knowledge Q&A"}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveModal} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Title / Question *
                </label>
                <input
                  type="text"
                  value={qaQuestion}
                  onChange={(e) => setQaQuestion(e.target.value)}
                  placeholder="e.g. What documents are required for Maternity Benefit claim?"
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Main Content / Answer (HTML / Formatted) *
                  </label>
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setLinkModalOpen(true)}
                      className="p-1 text-slate-600 hover:bg-white rounded"
                      title="Insert Link"
                    >
                      <LinkIcon className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <textarea
                  value={qaAnswer}
                  onChange={(e) => setQaAnswer(e.target.value)}
                  rows={8}
                  required
                  placeholder="Type clear explanation, bullet points, or instructions here..."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 leading-relaxed font-sans"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Category
                  </label>
                  <select
                    value={qaCategory}
                    onChange={(e) => setQaCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none font-semibold"
                  >
                    {distinctCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                    <option value="_custom_">+ Add New Category</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Tags (Comma-Separated)
                  </label>
                  <input
                    type="text"
                    value={qaTags}
                    onChange={(e) => setQaTags(e.target.value)}
                    placeholder="e.g. maternity, claim, form 9"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {qaCategory === "_custom_" && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    New Category Name
                  </label>
                  <input
                    type="text"
                    value={qaCategoryCustom}
                    onChange={(e) => setQaCategoryCustom(e.target.value)}
                    placeholder="Enter new category..."
                    required
                    className="w-full px-3 py-2 text-xs border border-blue-500 rounded-lg outline-none"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="aiOptToggle"
                  checked={qaAiOptimized}
                  onChange={(e) => setQaAiOptimized(e.target.checked)}
                  className="w-4 h-4 text-purple-600 rounded"
                />
                <label htmlFor="aiOptToggle" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Mark as Virtual Assistant (AI) Optimized Knowledge
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {modalSaving ? "Saving..." : editId ? "Update Q&A" : "Publish Q&A"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- INSERT LINK MODAL --- */}
      {linkModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white max-w-sm w-full rounded-2xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <h3 className="text-base font-bold text-slate-900">Insert Link</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Web Address (URL)</label>
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setLinkModalOpen(false)}
                className="px-3 py-1.5 border rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setQaAnswer((prev) => `${prev} [Link](${linkUrl})`);
                  setLinkModalOpen(false);
                }}
                className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold shadow-xs"
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
