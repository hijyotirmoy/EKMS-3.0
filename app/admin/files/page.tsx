"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  addDoc,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { touchMetadata } from "@/lib/cache";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { AppFile } from "@/lib/types";
import { formatBytes } from "@/lib/utils";
import {
  Folder,
  Upload,
  Download,
  Database,
  FileText,
  ImageIcon,
  Trash2,
  ExternalLink,
  Search,
  X,
  Plus,
} from "lucide-react";

export default function AdminFilesPage() {
  const { user } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [files, setFiles] = useState<AppFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // 10-Row Advanced Uploader Modal
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadRows, setUploadRows] = useState<
    Array<{
      file: File | null;
      category: string;
      customCategory: string;
      title: string;
    }>
  >(
    Array(10).fill({
      file: null,
      category: "General",
      customCategory: "",
      title: "",
    })
  );
  const [uploadingStatus, setUploadingStatus] = useState<string | null>(null);
  const [uploadLoading, setUploadLoading] = useState(false);

  // 1. Fetch Files Listener
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "files"),
      (snapshot) => {
        const list: AppFile[] = [];
        snapshot.forEach((d) => {
          const data = d.data();
          const size = data.sizeBytes || (data.dataUrl ? data.dataUrl.length * 0.75 : 0);
          list.push({ id: d.id, size, ...data } as AppFile);
        });
        list.sort((a, b) => (b.uploadedAt || 0) - (a.uploadedAt || 0));
        setFiles(list);
        setLoading(false);
      },
      (err) => console.error("Files sync error:", err)
    );

    return () => unsubscribe();
  }, []);

  // Metrics
  const { totalFiles, totalDownloads, totalStorageBytes } = useMemo(() => {
    let downloads = 0;
    let bytes = 0;
    files.forEach((f) => {
      downloads += f.downloadCount || f.downloads || 0;
      bytes += f.sizeBytes || f.size || 0;
    });
    return {
      totalFiles: files.length,
      totalDownloads: downloads,
      totalStorageBytes: bytes,
    };
  }, [files]);

  // Filtered List
  const filteredFiles = useMemo(() => {
    if (!searchTerm.trim()) return files;
    const q = searchTerm.toLowerCase().trim();
    return files.filter(
      (f) =>
        f.name?.toLowerCase().includes(q) ||
        f.category?.toLowerCase().includes(q) ||
        f.fileType?.toLowerCase().includes(q)
    );
  }, [files, searchTerm]);

  // Delete Single
  const handleDeleteSingle = async (id: string, driveUrl?: string) => {
    const confirmed = await showConfirm({
      title: "Delete File Document?",
      message: "Are you sure you want to permanently delete this file record?",
      isDestructive: true,
      confirmText: "Delete File",
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "files", id));

      // Call Google Apps Script delete if applicable
      const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;
      if (scriptUrl && driveUrl?.includes("drive.google.com")) {
        const urlObj = new URL(driveUrl);
        const driveFileId = urlObj.searchParams.get("id");
        if (driveFileId) {
          fetch(scriptUrl, {
            method: "POST",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "delete", fileId: driveFileId }),
          }).catch((e) => console.warn("Drive delete delayed", e));
        }
      }
      await touchMetadata("files");
      toast.success("File record deleted successfully.");
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await showConfirm({
      title: "Delete Selected Files?",
      message: `Are you sure you want to delete ${selectedIds.size} selected files?`,
      isDestructive: true,
      confirmText: "Delete Files",
    });
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;

      for (const id of Array.from(selectedIds)) {
        const f = files.find((item) => item.id === id);
        await deleteDoc(doc(db, "files", id));

        if (scriptUrl && f?.driveUrl?.includes("drive.google.com")) {
          const urlObj = new URL(f.driveUrl);
          const driveFileId = urlObj.searchParams.get("id");
          if (driveFileId) {
            fetch(scriptUrl, {
              method: "POST",
              headers: { "Content-Type": "text/plain;charset=utf-8" },
              body: JSON.stringify({ action: "delete", fileId: driveFileId }),
            }).catch((e) => console.warn("Drive delete delayed", e));
          }
        }
      }

      await touchMetadata("files");
      setSelectedIds(new Set());
      toast.success(`${selectedIds.size} files deleted successfully.`);
    } catch (e: any) {
      toast.error("Bulk delete error: " + e.message);
    } finally {
      setBulkDeleting(false);
    }
  };

  // Open 10-Row Bulk Uploader
  const handleOpenUploader = () => {
    setUploadRows(
      Array(10)
        .fill(null)
        .map(() => ({
          file: null,
          category: "General",
          customCategory: "",
          title: "",
        }))
    );
    setUploadingStatus(null);
    setUploadModalOpen(true);
  };

  // Row input updater
  const updateRow = (index: number, patch: Partial<(typeof uploadRows)[0]>) => {
    setUploadRows((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...patch };
      return copy;
    });
  };

  // Execute 10-Row Advanced Bulk Upload
  const handleProcessBulkUpload = async () => {
    const validRows = uploadRows.filter((r) => r.file !== null);
    if (validRows.length === 0) {
      setUploadingStatus("Please select at least one file to upload.");
      return;
    }

    setUploadLoading(true);
    const scriptUrl = process.env.NEXT_PUBLIC_GOOGLE_SCRIPT_URL;
    let successCount = 0;

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      const file = row.file!;
      setUploadingStatus(`Uploading file ${i + 1} of ${validRows.length}: "${row.title}"...`);

      try {
        const base64Data: string = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.readAsDataURL(file);
          reader.onload = () => resolve((reader.result as string).split(",")[1]);
          reader.onerror = (err) => reject(err);
        });

        let finalUrl = "";

        if (scriptUrl) {
          try {
            const resp = await fetch(scriptUrl, {
              method: "POST",
              headers: { "Content-Type": "text/plain;charset=utf-8" },
              body: JSON.stringify({
                name: file.name,
                type: file.type,
                base64: base64Data,
              }),
            });
            const resData = await resp.json();
            if (resData?.status === "success" && resData?.url) {
              finalUrl = resData.url;
            }
          } catch (e) {
            console.warn("Drive script fallback to data URI", e);
          }
        }

        const finalCat =
          row.category === "_custom_" ? row.customCategory.trim() || "General" : row.category;
        const finalTitle = row.title.trim() || file.name.replace(/\.[^/.]+$/, "");

        await addDoc(collection(db, "files"), {
          name: finalTitle,
          category: finalCat,
          fileType: file.type || "application/octet-stream",
          driveUrl: finalUrl || `data:${file.type};base64,${base64Data}`,
          dataUrl: `data:${file.type};base64,${base64Data}`,
          sizeBytes: file.size,
          downloadCount: 0,
          uploadedBy: user?.email?.split("@")[0] || "Admin",
          uploadedAt: Date.now(),
        });

        successCount++;
      } catch (err) {
        console.error("Failed to upload file:", row.title, err);
      }
    }

    if (successCount > 0) {
      await touchMetadata("files");
    }

    setUploadingStatus(`Successfully saved ${successCount} out of ${validRows.length} documents!`);
    setTimeout(() => {
      setUploadModalOpen(false);
      setUploadLoading(false);
    }, 1500);
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Manage Resource Files</h1>
        </div>

        <button
          onClick={handleOpenUploader}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors self-start"
        >
          <Upload className="w-4 h-4" />
          <span>Upload Files</span>
        </button>
      </div>

      {/* 3 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
          <Folder className="w-6 h-6 text-blue-600 mx-auto mb-2" />
          <div className="text-2xl font-extrabold text-slate-900">{totalFiles}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
            Total Files Hosted
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
          <Download className="w-6 h-6 text-emerald-600 mx-auto mb-2" />
          <div className="text-2xl font-extrabold text-slate-900">{totalDownloads}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
            Total Downloads
          </div>
        </div>

        <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-xs text-center">
          <Database className="w-6 h-6 text-amber-600 mx-auto mb-2" />
          <div className="text-2xl font-extrabold text-slate-900">{formatBytes(totalStorageBytes)}</div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-1">
            Est. Storage Used
          </div>
        </div>
      </div>

      {/* Files Table Section */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search file name, category, or type..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white"
            />
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-rose-800">{selectedIds.size} selected</span>
              <button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg shadow-xs flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
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
                      filteredFiles.length > 0 && filteredFiles.every((f) => selectedIds.has(f.id))
                    }
                    onChange={(e) => {
                      const next = new Set(selectedIds);
                      if (e.target.checked) {
                        filteredFiles.forEach((f) => next.add(f.id));
                      } else {
                        filteredFiles.forEach((f) => next.delete(f.id));
                      }
                      setSelectedIds(next);
                    }}
                    className="cursor-pointer"
                  />
                </th>
                <th className="p-4">File Name & Category</th>
                <th className="p-4">Size</th>
                <th className="p-4">Upload Date</th>
                <th className="p-4 text-center">Downloads</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    Loading files...
                  </td>
                </tr>
              ) : filteredFiles.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-slate-400">
                    No files found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredFiles.map((file) => {
                  const isPdf =
                    file.fileType === "application/pdf" || file.name?.toLowerCase().endsWith(".pdf");
                  const targetUrl = file.dataUrl || file.driveUrl || file.url || "#";

                  return (
                    <tr key={file.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="p-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(file.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds);
                            if (e.target.checked) next.add(file.id);
                            else next.delete(file.id);
                            setSelectedIds(next);
                          }}
                          className="cursor-pointer"
                        />
                      </td>

                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                            {isPdf ? (
                              <FileText className="w-4 h-4 text-rose-600" />
                            ) : (
                              <ImageIcon className="w-4 h-4 text-blue-600" />
                            )}
                          </div>
                          <div>
                            <div className="font-bold text-slate-900 line-clamp-1 max-w-xs">{file.name}</div>
                            <div className="text-[10px] text-blue-600 font-semibold">{file.category}</div>
                          </div>
                        </div>
                      </td>

                      <td className="p-4 text-slate-500 font-mono">
                        {formatBytes(file.sizeBytes || file.size)}
                      </td>

                      <td className="p-4 text-slate-400">
                        {new Date(file.uploadedAt || Date.now()).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </td>

                      <td className="p-4 text-center font-bold text-emerald-700">
                        <span className="bg-emerald-50 px-2.5 py-1 rounded-full text-xs">
                          {file.downloadCount || file.downloads || 0}
                        </span>
                      </td>

                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {targetUrl && targetUrl !== "#" && (
                            <a
                              href={targetUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 text-blue-600 hover:bg-blue-50 rounded"
                              title="Open File"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                          <button
                            onClick={() => handleDeleteSingle(file.id, file.driveUrl)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                            title="Delete File"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
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

      {/* --- 10-ROW BULK UPLOADER MODAL --- */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-white max-w-4xl w-full rounded-3xl shadow-2xl p-6 sm:p-8 space-y-4 max-h-[90vh] overflow-y-auto border border-slate-100 flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">Advanced 10-Row Bulk Uploader</h3>
                <p className="text-xs text-slate-500">
                  Select up to 10 files. Custom titles and categories are auto-extracted.
                </p>
              </div>
              <button onClick={() => setUploadModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* 10 Rows */}
            <div className="space-y-3 flex-1 overflow-y-auto py-2">
              {uploadRows.map((row, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row items-center gap-3"
                >
                  <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
                    #{idx + 1}
                  </span>

                  {/* File input */}
                  <div className="flex-1 w-full">
                    <input
                      type="file"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        updateRow(idx, {
                          file,
                          title: file ? file.name.replace(/\.[^/.]+$/, "") : "",
                        });
                      }}
                      className="text-xs text-slate-600 file:mr-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer w-full"
                    />
                  </div>

                  {/* Category */}
                  <div className="w-full sm:w-44">
                    <select
                      value={row.category}
                      onChange={(e) => updateRow(idx, { category: e.target.value })}
                      className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none font-semibold text-blue-600"
                    >
                      <option value="General">General</option>
                      <option value="Guidelines">Guidelines</option>
                      <option value="Circulars">Circulars</option>
                      <option value="Forms">Forms</option>
                      <option value="Policies">Policies</option>
                      <option value="_custom_">+ Add New Category</option>
                    </select>

                    {row.category === "_custom_" && (
                      <input
                        type="text"
                        value={row.customCategory}
                        onChange={(e) => updateRow(idx, { customCategory: e.target.value })}
                        placeholder="Custom category..."
                        className="w-full mt-1.5 px-2.5 py-1 text-xs border border-blue-500 rounded-lg outline-none"
                      />
                    )}
                  </div>

                  {/* Title */}
                  <div className="w-full sm:flex-1">
                    <input
                      type="text"
                      value={row.title}
                      onChange={(e) => updateRow(idx, { title: e.target.value })}
                      placeholder="Document title..."
                      className="w-full px-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-blue-500 font-medium"
                    />
                  </div>
                </div>
              ))}
            </div>

            {uploadingStatus && (
              <div className="p-3 bg-blue-50 text-blue-800 text-xs font-semibold rounded-xl text-center">
                {uploadingStatus}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setUploadModalOpen(false)}
                className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleProcessBulkUpload}
                disabled={uploadLoading}
                className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-sm"
              >
                {uploadLoading ? "Uploading..." : "Upload Selected Files"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
