"use client";

import React, { useState, useEffect } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { touchMetadata } from "@/lib/cache";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { Announcement } from "@/lib/types";
import { parseMarkdownLinks } from "@/lib/utils";
import {
  Megaphone,
  Plus,
  Eye,
  EyeOff,
  Edit2,
  Trash2,
  X,
} from "lucide-react";

export default function AdminAnnouncementsPage() {
  const { user } = useAuth();
  const { toast, showConfirm } = usePopup();
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [isVisible, setIsVisible] = useState(true);
  const [saving, setSaving] = useState(false);

  // 1. Fetch Announcements
  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, "announcements"),
      (snapshot) => {
        const list: Announcement[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...(d.data() as Omit<Announcement, "id">) });
        });
        list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setAnnouncements(list);
        setLoading(false);
      },
      (err) => console.error("Announcements sync error:", err)
    );

    return () => unsubscribe();
  }, []);

  // 2. Toggle Status
  const handleToggleStatus = async (item: Announcement) => {
    try {
      const docRef = doc(db, "announcements", item.id);
      await updateDoc(docRef, { isVisible: !item.isVisible, updatedAt: Date.now() });
      await touchMetadata("announcements");
      toast.info(`Announcement ${!item.isVisible ? "published" : "hidden"}.`);
    } catch (e: any) {
      toast.error("Failed to toggle visibility: " + e.message);
    }
  };

  // 3. Save Modal
  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;

    setSaving(true);
    const payload = {
      message: message.trim(),
      isVisible,
      updatedAt: Date.now(),
    };

    try {
      if (editId) {
        await setDoc(doc(db, "announcements", editId), payload, { merge: true });
        toast.success("Announcement updated successfully!");
      } else {
        await addDoc(collection(db, "announcements"), {
          ...payload,
          createdAt: Date.now(),
        });
        toast.success("New announcement published!");
      }
      await touchMetadata("announcements");
      setModalOpen(false);
    } catch (err: any) {
      toast.error("Failed to save: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // 4. Delete
  const handleDeleteAnnouncement = async (id: string) => {
    const confirmed = await showConfirm({
      title: "Delete Announcement?",
      message: "Are you sure you want to permanently delete this announcement?",
      isDestructive: true,
      confirmText: "Delete Announcement",
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "announcements", id));
      await touchMetadata("announcements");
      toast.success("Announcement deleted.");
    } catch (e: any) {
      toast.error("Delete failed: " + e.message);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Broadcast Announcements</h1>
        </div>

        <button
          onClick={() => {
            setEditId(null);
            setMessage("");
            setIsVisible(true);
            setModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors self-start"
        >
          <Plus className="w-4 h-4" />
          <span>New Announcement</span>
        </button>
      </div>

      {/* Announcements Table */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                <th className="p-4 w-1/2">Announcement Message</th>
                <th className="p-4">Date Posted</th>
                <th className="p-4 text-center">Status</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={4} className="text-center py-12 text-slate-400">
                    Loading announcements...
                  </td>
                </tr>
              ) : announcements.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-12 text-slate-400">
                    No announcements created yet.
                  </td>
                </tr>
              ) : (
                announcements.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="p-4">
                      <div
                        className="text-slate-800 leading-relaxed text-xs break-words"
                        dangerouslySetInnerHTML={{ __html: parseMarkdownLinks(item.message) }}
                      />
                    </td>
                    <td className="p-4 text-slate-400">
                      {new Date(item.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </td>
                    <td className="p-4 text-center">
                      {item.isVisible ? (
                        <span className="bg-emerald-50 text-emerald-700 font-bold px-2.5 py-0.5 rounded-full text-[10px]">
                          Active (Visible)
                        </span>
                      ) : (
                        <span className="bg-slate-100 text-slate-500 font-bold px-2.5 py-0.5 rounded-full text-[10px]">
                          Hidden
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleToggleStatus(item)}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded"
                          title={item.isVisible ? "Hide Announcement" : "Make Visible"}
                        >
                          {item.isVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        <button
                          onClick={() => {
                            setEditId(item.id);
                            setMessage(item.message);
                            setIsVisible(item.isVisible);
                            setModalOpen(true);
                          }}
                          className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-50 rounded"
                          title="Edit Announcement"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAnnouncement(item.id)}
                          className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded"
                          title="Delete Announcement"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* --- CREATE / EDIT ANNOUNCEMENT MODAL --- */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editId ? "Edit Announcement" : "New Announcement"}
              </h3>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAnnouncement} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Announcement Message (Use [Text](https://url.com) for links)
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={6}
                  required
                  placeholder="Example: Please review the updated [Operational Guide](https://example.com) before tomorrow."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-lg outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-sans leading-relaxed"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="visToggle"
                  checked={isVisible}
                  onChange={(e) => setIsVisible(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
                <label htmlFor="visToggle" className="text-xs font-semibold text-slate-700 cursor-pointer">
                  Visible immediately to all agent terminals
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-3 py-1.5 border border-slate-200 text-xs font-semibold rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  {saving ? "Publishing..." : "Publish"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
