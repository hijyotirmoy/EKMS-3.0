import React, { useState, useEffect } from "react";
import { collection, query, orderBy, limit, onSnapshot, doc, updateDoc, arrayUnion } from "firebase/firestore";
import { logsDb } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { AppNotification } from "../lib/types";
import { X, Bell, CheckCheck, Megaphone, CalendarCheck, HelpCircle, GraduationCap, Cake } from "lucide-react";

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onUnreadChange: (count: number) => void;
}

export default function NotificationDrawer({ isOpen, onClose, onUnreadChange }: NotificationDrawerProps) {
  const { user, userProfile, isAdmin } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "unread">("all");
  const userEmail = (user?.email || "").toLowerCase().trim();

  useEffect(() => {
    if (!userEmail) return;

    const q = query(
      collection(logsDb, "notifications"),
      orderBy("createdAt", "desc"),
      limit(40)
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: AppNotification[] = [];
        const userRole = (userProfile?.role || (user ? "Agent" : "guest")).toLowerCase().trim();
        const isUserAdmin = isAdmin || userRole.includes("admin") || userRole.includes("master");

        snapshot.forEach((docSnap) => {
          const item = { id: docSnap.id, ...docSnap.data() } as AppNotification;
          const target = (item.targetEmail || "all").toLowerCase().trim();
          const isDirectlyForMe = target !== "all" && target === userEmail;

          const notifRole = (item.targetRole || "all").toLowerCase().trim();
          const isRoleAdmin = notifRole === "admin" || notifRole === "master_admin" || notifRole === "admins";
          const isRoleAgent = notifRole === "agent" || notifRole === "agents";

          if (isRoleAdmin && !isUserAdmin) return;
          if (isRoleAgent && isUserAdmin && !isDirectlyForMe) return;
          if (target !== "all" && target !== userEmail) return;

          if (item.type === "birthday" && item.celebrantEmail?.toLowerCase().trim() === userEmail) {
            return;
          }

          list.push(item);
        });

        setNotifications(list);

        // Count unread
        const unread = list.filter((n) => !n.readBy?.map((e) => e.toLowerCase().trim()).includes(userEmail)).length;
        onUnreadChange(unread);
      },
      (err) => console.warn("Mobile notifications listener notice:", err)
    );

    return () => unsub();
  }, [userEmail, isAdmin, userProfile, user, onUnreadChange]);

  const markAsRead = async (id: string) => {
    if (!id || !userEmail) return;
    try {
      await updateDoc(doc(logsDb, "notifications", id), {
        readBy: arrayUnion(userEmail),
      });
    } catch (e) {
      console.warn("Could not mark read in logsDb:", e);
    }
  };

  const markAllRead = async () => {
    if (!userEmail || notifications.length === 0) return;
    try {
      const promises = notifications
        .filter((n) => !n.readBy?.includes(userEmail))
        .map((n) => updateDoc(doc(logsDb, "notifications", n.id), { readBy: arrayUnion(userEmail) }));
      await Promise.allSettled(promises);
    } catch (e) {}
  };

  if (!isOpen) return null;

  const filteredNotifs = activeTab === "unread"
    ? notifications.filter((n) => !n.readBy?.map((e) => e.toLowerCase().trim()).includes(userEmail))
    : notifications;

  const getTypeIcon = (type: string) => {
    switch (type) {
      case "booking":
        return <CalendarCheck className="w-4 h-4 text-emerald-400" />;
      case "announcement":
        return <Megaphone className="w-4 h-4 text-amber-400" />;
      case "doubt":
        return <HelpCircle className="w-4 h-4 text-cyan-400" />;
      case "quiz":
        return <GraduationCap className="w-4 h-4 text-purple-400" />;
      case "birthday":
        return <Cake className="w-4 h-4 text-pink-400" />;
      default:
        return <Bell className="w-4 h-4 text-blue-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-h-[85vh] bg-slate-900 border-t border-slate-800 rounded-t-3xl flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-300">
        {/* Handle bar */}
        <div className="w-12 h-1.5 bg-slate-700/60 rounded-full mx-auto mt-3 mb-1" />

        {/* Drawer Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-blue-400" />
            <h3 className="font-bold text-base text-white">Notifications</h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={markAllRead}
              className="px-2.5 py-1 text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" />
              Mark all read
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 px-5 py-2.5 bg-slate-950/40 border-b border-slate-800/60">
          <button
            onClick={() => setActiveTab("all")}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              activeTab === "all"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            All ({notifications.length})
          </button>
          <button
            onClick={() => setActiveTab("unread")}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              activeTab === "unread"
                ? "bg-blue-600 text-white"
                : "bg-slate-800 text-slate-400 hover:text-white"
            }`}
          >
            Unread (
            {
              notifications.filter(
                (n) => !n.readBy?.map((e) => e.toLowerCase().trim()).includes(userEmail)
              ).length
            }
            )
          </button>
        </div>

        {/* Notification List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 pb-safe">
          {filteredNotifs.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Bell className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm font-medium">No notifications right now</p>
            </div>
          ) : (
            filteredNotifs.map((item) => {
              const isRead = item.readBy?.map((e) => e.toLowerCase().trim()).includes(userEmail);
              return (
                <div
                  key={item.id}
                  onClick={() => markAsRead(item.id)}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    isRead
                      ? "bg-slate-900/60 border-slate-800/60 opacity-80"
                      : "bg-blue-950/20 border-blue-500/30 shadow-sm"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-slate-800/80 mt-0.5 flex-shrink-0">
                      {getTypeIcon(item.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold text-white truncate">
                          {item.title}
                        </h4>
                        {!isRead && (
                          <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-slate-300 mt-1 leading-relaxed line-clamp-3">
                        {item.message}
                      </p>
                      <span className="text-[10px] text-slate-500 mt-2 block">
                        {item.createdAt ? new Date(item.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : "Recently"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
