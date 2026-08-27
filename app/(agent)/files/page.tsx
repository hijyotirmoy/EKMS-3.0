"use client";

import React, { useState, useEffect, useMemo } from "react";
import { doc, updateDoc, increment } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getOrFetchCollection } from "@/lib/cache";
import { AppFile } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import {
  Folder,
  Search,
  FileText,
  Image as ImageIcon,
  Download,
  Flag,
  RotateCcw,
} from "lucide-react";
import ReportIssueModal from "@/components/common/ReportIssueModal";

export default function FilesPage() {
  const [files, setFiles] = useState<AppFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");

  // Report Modal
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ id: string; name: string }>({ id: "", name: "" });

  // 1. Fetch Files with smart browser cache
  useEffect(() => {
    let isMounted = true;

    const loadFiles = async () => {
      try {
        const list = await getOrFetchCollection<AppFile>("files");
        if (isMounted) {
          list.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
          setFiles(list);
          setLoading(false);
        }
      } catch (err) {
        console.error("Files load error:", err);
        if (isMounted) setLoading(false);
      }
    };

    loadFiles();

    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Extract Categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    files.forEach((f) => {
      if (f.category) set.add(f.category.trim());
    });
    return ["all", ...Array.from(set).sort()];
  }, [files]);

  // 3. Filtered Files
  const filteredFiles = useMemo(() => {
    let list = files;

    if (selectedCategory !== "all") {
      list = list.filter((f) => f.category?.trim() === selectedCategory);
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase().trim();
      list = list.filter(
        (f) =>
          f.name?.toLowerCase().includes(q) ||
          f.category?.toLowerCase().includes(q) ||
          f.fileType?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [files, selectedCategory, searchTerm]);

  // Download tracker
  const handleDownload = async (file: AppFile) => {
    if (!file.id) return;
    try {
      const docRef = doc(db, "files", file.id);
      await updateDoc(docRef, { downloadCount: increment(1) });
    } catch (e) {
      console.log("Download tracking sync delayed.", e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Search & Category Filter in Same Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight whitespace-nowrap">Files Library</h1>
        </div>

        {/* Filter & Search Bar */}
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search documents by title or keyword..."
              className="w-full pl-10 pr-8 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs font-medium"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 font-bold"
              >
                ×
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3.5 py-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 outline-none w-full sm:w-auto shadow-2xs"
            >
              <option value="all">ALL CATEGORIES</option>
              {categories
                .filter((c) => c !== "all")
                .map((cat) => (
                  <option key={cat} value={cat}>
                    {cat.toUpperCase()}
                  </option>
                ))}
            </select>

            {(selectedCategory !== "all" || searchTerm) && (
              <button
                onClick={() => {
                  setSelectedCategory("all");
                  setSearchTerm("");
                }}
                className="p-2 bg-white border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-xl transition-colors shadow-2xs"
                title="Reset Filters"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Files Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {loading ? (
          <div className="col-span-full text-center py-16 text-slate-400">
            <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Loading document repository...</p>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="col-span-full bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-xs">
            <Folder className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800 mb-1">No Files Found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mb-4">
              There are no documents matching your search or category filter.
            </p>
            <button
              onClick={() => {
                setSelectedCategory("all");
                setSearchTerm("");
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-sm"
            >
              Show All Files
            </button>
          </div>
        ) : (
          filteredFiles.map((file) => {
            const isPdf =
              file.fileType === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf");
            const targetLink = file.dataUrl || file.driveUrl || file.url || "#";
            const fileSize = file.sizeBytes || file.size;

            return (
              <div
                key={file.id}
                className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:shadow-md transition-all flex flex-col items-center justify-between text-center relative group"
              >
                {/* Category Badge & Report Flag */}
                <div className="flex items-center justify-between w-full mb-3">
                  <span className="bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded text-[9px] uppercase tracking-wider truncate max-w-[80px]">
                    {file.category || "General"}
                  </span>
                  <button
                    onClick={() => {
                      setReportTarget({ id: file.id, name: file.name });
                      setReportModalOpen(true);
                    }}
                    className="text-slate-300 hover:text-rose-600 p-1 rounded transition-colors"
                    title="Report issue with file"
                  >
                    <Flag className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* File Icon & Name */}
                <div className="flex flex-col items-center space-y-2 flex-1 w-full">
                  <div className="w-14 h-14 rounded-2xl bg-slate-50 flex items-center justify-center group-hover:scale-105 transition-transform">
                    {isPdf ? (
                      <FileText className="w-8 h-8 text-rose-600" />
                    ) : (
                      <ImageIcon className="w-8 h-8 text-blue-600" />
                    )}
                  </div>
                  <h3
                    className="text-xs font-bold text-slate-800 line-clamp-2 leading-snug break-words w-full"
                    title={file.name}
                  >
                    {file.name}
                  </h3>
                  {fileSize && (
                    <span className="text-[10px] font-semibold text-slate-400">
                      {formatBytes(fileSize)}
                    </span>
                  )}
                </div>

                {/* Download Button */}
                <a
                  href={targetLink}
                  download={file.name}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => handleDownload(file)}
                  className="mt-3 w-full py-2 bg-slate-50 hover:bg-blue-50 text-blue-600 hover:text-blue-700 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border border-slate-200 transition-colors shadow-2xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
              </div>
            );
          })
        )}
      </div>

      {/* Report Modal */}
      <ReportIssueModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        targetId={reportTarget.id}
        reportType="Files"
        targetCodeOrName={reportTarget.name}
      />
    </div>
  );
}
