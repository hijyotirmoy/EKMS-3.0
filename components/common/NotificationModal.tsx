"use client";

import React, { useEffect, useState } from "react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Announcement } from "@/lib/types";
import { parseMarkdownLinks } from "@/lib/utils";
import { Bell, X } from "lucide-react";

interface NotificationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationModal({ isOpen, onClose }: NotificationModalProps) {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, "announcements"), where("isVisible", "==", true));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: Announcement[] = [];
        snapshot.forEach((doc) => {
          list.push({ id: doc.id, ...(doc.data() as Omit<Announcement, "id">) });
        });
        list.sort((a, b) => b.createdAt - a.createdAt);
        setAnnouncements(list);
        setLoading(false);
      },
      (err) => {
        console.error("Announcements listener error:", err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="bg-white max-w-lg w-full rounded-2xl shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-blue-600 font-bold text-lg">
            <Bell className="w-5 h-5" />
            <span>Announcements & Alerts</span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content list */}
        <div className="p-6 overflow-y-auto divide-y divide-slate-100 flex-1 space-y-4">
          {loading ? (
            <div className="text-center py-10 text-slate-400 text-sm">Loading announcements...</div>
          ) : announcements.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-sm flex flex-col items-center gap-2">
              <Bell className="w-8 h-8 opacity-30" />
              <span>No new announcements currently.</span>
            </div>
          ) : (
            announcements.map((item) => {
              const dateStr = new Date(item.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              });
              return (
                <div key={item.id} className="pt-4 first:pt-0 flex items-start gap-3.5">
                  <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bell className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">
                      {dateStr}
                    </div>
                    <div
                      className="text-sm text-slate-800 leading-relaxed break-words"
                      dangerouslySetInnerHTML={{ __html: parseMarkdownLinks(item.message) }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
