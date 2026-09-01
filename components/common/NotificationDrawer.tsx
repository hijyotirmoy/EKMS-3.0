"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  query,
  onSnapshot,
  orderBy,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { AppNotification, Announcement, UserProfile } from "@/lib/types";
import { parseMarkdownLinks } from "@/lib/utils";
import { maskNotificationMessage } from "@/lib/maskUtils";
import {
  formatNotificationTime,
  markNotificationRead,
  markNotificationUnread,
  markAllNotificationsRead,
  closeNotification,
  checkAndCreateBirthdayNotifications,
  getLocalReadNotifications,
  getLocalClosedNotifications,
} from "@/lib/notificationService";
import {
  Bell,
  X,
  CheckCheck,
  CalendarCheck,
  Cake,
  Megaphone,
  Gamepad2,
  GraduationCap,
  HelpCircle,
  CheckCircle2,
  Circle,
  Inbox,
  Sparkles,
  ArrowRight,
  Flag,
  BookOpen,
} from "lucide-react";

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function NotificationDrawer({ isOpen, onClose }: NotificationDrawerProps) {
  const { user, userProfile, isAdmin } = useAuth();
  const router = useRouter();
  const userEmail = (user?.email || "").toLowerCase().trim();

  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [activeTab, setActiveTab] = useState<"all" | "live" | "closed">("all");
  const [loading, setLoading] = useState(true);
  const [localReadIds, setLocalReadIds] = useState<string[]>(() =>
    userEmail ? getLocalReadNotifications(userEmail) : []
  );
  const [localClosedIds, setLocalClosedIds] = useState<string[]>(() =>
    userEmail ? getLocalClosedNotifications(userEmail) : []
  );

  useEffect(() => {
    if (userEmail) {
      setLocalReadIds((prev) =>
        Array.from(new Set([...prev, ...getLocalReadNotifications(userEmail)]))
      );
      setLocalClosedIds((prev) =>
        Array.from(new Set([...prev, ...getLocalClosedNotifications(userEmail)]))
      );
    }
  }, [userEmail]);

  // 1. Sync User Notifications & Announcements
  useEffect(() => {
    let notifsFromDb: AppNotification[] = [];
    let notifsFromAnn: AppNotification[] = [];
    let announcementsFromDb: Announcement[] = [];

    const mergeAndSet = () => {
      const map = new Map<string, AppNotification>();
      notifsFromDb.forEach((n) => map.set(n.id, n));
      notifsFromAnn.forEach((a) => {
        if (!map.has(a.id)) {
          map.set(a.id, a);
        } else {
          const existing = map.get(a.id)!;
          map.set(a.id, {
            ...a,
            ...existing,
            readBy: Array.from(new Set([...(existing.readBy || []), ...(a.readBy || [])])),
            closedBy: Array.from(new Set([...(existing.closedBy || []), ...(a.closedBy || [])])),
          });
        }
      });
      const combined = Array.from(map.values());
      combined.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setNotifications(combined);
      setAnnouncements(announcementsFromDb);
      setLoading(false);
    };

    // A. Real-time Notifications Query
    const unsubNotifs = onSnapshot(
      collection(db, "notifications"),
      (snapshot) => {
        const list: AppNotification[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...(docSnap.data() as Omit<AppNotification, "id">) });
        });
        notifsFromDb = list;
        mergeAndSet();
      },
      (err) => {
        console.warn("Notifications collection notice:", err);
      }
    );

    // B. Real-time Announcements Query
    const unsubAnn = onSnapshot(
      collection(db, "announcements"),
      (snapshot) => {
        const notifList: AppNotification[] = [];
        const aList: Announcement[] = [];

        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as any;
          if (data.isNotification || (data.type && data.type !== "announcement")) {
            notifList.push({ id: docSnap.id, ...data });
          } else if (data.isVisible) {
            aList.push({ id: docSnap.id, ...data });
            notifList.push({
              id: docSnap.id,
              title: data.title || "📢 Official Announcement",
              message: data.message,
              type: "announcement",
              targetEmail: (data.targetEmail || "all").toLowerCase().trim(),
              targetRole: data.targetRole || "all",
              readBy: data.readBy || [],
              closedBy: data.closedBy || [],
              createdAt: data.createdAt || Date.now(),
            });
          }
        });

        notifsFromAnn = notifList;
        announcementsFromDb = aList;
        mergeAndSet();
      },
      (err) => {
        console.warn("Announcements collection notice:", err);
      }
    );

    return () => {
      try {
        unsubNotifs();
      } catch (e) {}
      try {
        unsubAnn();
      } catch (e) {}
    };
  }, []);

  // Birthday notifications check
  useEffect(() => {
    if (isOpen) {
      const checkBirthdays = async () => {
        try {
          const usersSnap = await import("firebase/firestore").then((f) =>
            f.getDocs(f.collection(db, "users"))
          );
          const uList: UserProfile[] = [];
          usersSnap.forEach((d) => uList.push({ ...(d.data() as UserProfile), email: d.id }));
          await checkAndCreateBirthdayNotifications(uList);
        } catch (e) {
          console.error("Birthday check error:", e);
        }
      };
      checkBirthdays();
    }
  }, [isOpen]);

  // 2. Merge and Filter Notifications for Current User
  const userVisibleList = useMemo(() => {
    const userRole = (userProfile?.role || (user ? "Agent" : "guest")).toLowerCase().trim();
    const isUserAdmin = isAdmin || userRole.includes("admin") || userRole.includes("master");

    const directNotifs = notifications.filter((item) => {
      const target = (item.targetEmail || "all").toLowerCase().trim();
      const isDirectlyForMe = target !== "all" && target === userEmail;

      const notifRole = (item.targetRole || "all").toLowerCase().trim();
      const isRoleAdmin = notifRole === "admin" || notifRole === "master_admin" || notifRole === "admins";
      const isRoleAgent = notifRole === "agent" || notifRole === "agents";

      // Role filtering
      if (isRoleAdmin && !isUserAdmin) return false;
      if (isRoleAgent && isUserAdmin && !isDirectlyForMe) return false;

      // Target must be "all" or specific to user's email
      if (target !== "all" && target !== userEmail) return false;

      // For birthday reminders, hide reminder about celebrant's own birthday from themselves
      if (item.type === "birthday" && item.celebrantEmail && item.celebrantEmail.toLowerCase().trim() === userEmail) {
        return false;
      }
      return true;
    });

    // Deduplicate by ID and sort newest first
    const map = new Map<string, AppNotification>();
    directNotifs.forEach((n) => {
      map.set(n.id, n);
    });

    const combined = Array.from(map.values());
    combined.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    return combined;
  }, [notifications, userEmail, isAdmin, userProfile]);

  // Derived categorized lists
  const { allList, liveList, closedList, unreadCount } = useMemo(() => {
    let unread = 0;
    const all: Array<AppNotification & { isRead: boolean; isClosed: boolean }> = [];
    const live: typeof all = [];
    const closed: typeof all = [];

    userVisibleList.forEach((item) => {
      const isRead = !!item.readBy?.includes(userEmail) || localReadIds.includes(item.id);
      const isClosed = !!item.closedBy?.includes(userEmail) || localClosedIds.includes(item.id);

      if (!isRead && !isClosed) unread++;

      const enriched = { ...item, isRead, isClosed };
      all.push(enriched);

      if (isClosed || isRead) {
        closed.push(enriched);
      } else {
        live.push(enriched);
      }
    });

    return {
      allList: all,
      liveList: live,
      closedList: closed,
      unreadCount: unread,
    };
  }, [userVisibleList, userEmail, localReadIds, localClosedIds]);

  const displayedList = useMemo(() => {
    if (activeTab === "live") return liveList;
    if (activeTab === "closed") return closedList;
    return allList;
  }, [activeTab, allList, liveList, closedList]);

  // Handle Mark All As Read
  const handleMarkAllRead = async () => {
    if (!userEmail) return;
    const unreadIds = liveList.map((n) => n.id);
    if (unreadIds.length === 0) return;
    setLocalReadIds((prev) => Array.from(new Set([...prev, ...unreadIds])));
    window.dispatchEvent(
      new CustomEvent("ekms-notification-read-update", { detail: { ids: unreadIds } })
    );
    await markAllNotificationsRead(unreadIds, userEmail);
  };

  // Helper to render type-specific icons
  const renderNotifIcon = (type?: string) => {
    switch (type) {
      case "booking":
        return (
          <div className="w-9 h-9 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 shadow-xs border border-blue-200">
            <CalendarCheck className="w-4 h-4" />
          </div>
        );
      case "birthday":
        return (
          <div className="w-9 h-9 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center shrink-0 shadow-xs border border-purple-200">
            <Cake className="w-4 h-4" />
          </div>
        );
      case "announcement":
        return (
          <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 shadow-xs border border-amber-200">
            <Megaphone className="w-4 h-4" />
          </div>
        );
      case "quiz":
        return (
          <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 shadow-xs border border-indigo-200">
            <Gamepad2 className="w-4 h-4" />
          </div>
        );
      case "course":
        return (
          <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 shadow-xs border border-emerald-200">
            <GraduationCap className="w-4 h-4" />
          </div>
        );
      case "doubt":
        return (
          <div className="w-9 h-9 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center shrink-0 shadow-xs border border-teal-200">
            <HelpCircle className="w-4 h-4" />
          </div>
        );
      case "report":
        return (
          <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0 shadow-xs border border-rose-200">
            <Flag className="w-4 h-4" />
          </div>
        );
      case "qna":
        return (
          <div className="w-9 h-9 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0 shadow-xs border border-sky-200">
            <BookOpen className="w-4 h-4" />
          </div>
        );
      default:
        return (
          <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0 shadow-xs border border-slate-200">
            <Bell className="w-4 h-4" />
          </div>
        );
    }
  };

  // Escape key listener & body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden select-none">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-xs transition-opacity duration-300 animate-in fade-in"
      />

      {/* Responsive Slide-over Drawer (Leaves peek space on left on mobile, 420px on desktop) */}
      <div className="fixed inset-y-0 right-0 max-w-full flex justify-end z-50 pointer-events-none">
        <div className="w-[86vw] sm:w-[420px] sm:max-w-md bg-white shadow-2xl border-l border-slate-200 flex flex-col pointer-events-auto h-full animate-in slide-in-from-right duration-300">
          {/* Header */}
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/90 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center">
                <Bell className="w-4 h-4" />
              </div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">Notifications</h2>
                {unreadCount > 0 && (
                  <span className="px-2 py-0.5 bg-rose-500 text-white text-[10px] font-extrabold rounded-full animate-pulse shadow-xs">
                    {unreadCount} new
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1">
              {liveList.length > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 p-1.5 px-2 text-slate-600 hover:text-blue-600 hover:bg-blue-50 active:bg-blue-100 rounded-lg text-xs font-semibold transition-colors"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-4 h-4" />
                  <span className="hidden sm:inline text-[11px]">Mark all read</span>
                </button>
              )}
              {/* Close Button: Fully visible and easily tappable on all screen sizes */}
              <button
                onClick={onClose}
                className="p-2 -mr-1 text-slate-500 hover:text-slate-900 hover:bg-slate-200/80 active:bg-slate-300 rounded-full transition-colors cursor-pointer"
                title="Close (Esc)"
                aria-label="Close Notifications"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 3 Horizontal Scrolling Filter Tabs */}
          <div className="px-4 py-2.5 border-b border-slate-100 bg-white flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                activeTab === "all"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              All ({allList.length})
            </button>
            <button
              onClick={() => setActiveTab("live")}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                activeTab === "live"
                  ? "bg-amber-500 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Live / Unread ({liveList.length})
            </button>
            <button
              onClick={() => setActiveTab("closed")}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                activeTab === "closed"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              Closed / Read ({closedList.length})
            </button>
          </div>

          {/* Notifications Feed */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {loading ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                <span>Loading notifications...</span>
              </div>
            ) : displayedList.length === 0 ? (
              <div className="p-12 text-center text-slate-400 space-y-2 flex flex-col items-center">
                <Inbox className="w-10 h-10 opacity-30 text-slate-400 stroke-1" />
                <h3 className="text-sm font-bold text-slate-700">No notifications in this view</h3>
                <p className="text-xs text-slate-400 max-w-xs">
                  {activeTab === "live"
                    ? "You are completely caught up! No live or unread alerts right now."
                    : "No notifications recorded yet."}
                </p>
              </div>
            ) : (
              displayedList.map((item) => {
                const isUnread = !item.isRead;
                return (
                  <div
                    key={item.id}
                    className={`p-4 transition-all relative group cursor-pointer flex items-start gap-3.5 ${
                      isUnread
                        ? "bg-blue-50/40 hover:bg-blue-50/70"
                        : "bg-white hover:bg-slate-50"
                    }`}
                    onClick={() => {
                      if (isUnread && userEmail) {
                        setLocalReadIds((prev) => Array.from(new Set([...prev, item.id])));
                        window.dispatchEvent(
                          new CustomEvent("ekms-notification-read-update", { detail: { ids: [item.id] } })
                        );
                        markNotificationRead(item.id, userEmail);
                      }
                      if (item.link) {
                        onClose();
                        router.push(item.link);
                      }
                    }}
                  >
                    {/* Icon */}
                    {renderNotifIcon(item.type)}

                    {/* Content */}
                    <div className="flex-1 min-w-0 pr-4 space-y-1">
                      <div className="flex items-center justify-between gap-1">
                        <h4
                          className={`text-xs font-bold leading-tight truncate ${
                            isUnread ? "text-slate-900" : "text-slate-700"
                          }`}
                          dangerouslySetInnerHTML={{
                            __html: parseMarkdownLinks(
                              maskNotificationMessage(item.title, (item.metadata as any)?.ipName)
                            ),
                          }}
                        />
                        <span className="text-[10px] text-slate-400 whitespace-nowrap shrink-0">
                          {formatNotificationTime(item.createdAt)}
                        </span>
                      </div>

                      <div
                        className="text-xs text-slate-600 leading-relaxed break-words line-clamp-3"
                        dangerouslySetInnerHTML={{
                          __html: parseMarkdownLinks(
                            maskNotificationMessage(item.message, (item.metadata as any)?.ipName)
                          ),
                        }}
                      />

                      {/* Link Action Button */}
                      {item.link && (
                        <div className="pt-1">
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 hover:text-blue-700">
                            <span>Open details</span>
                            <ArrowRight className="w-3 h-3" />
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Actions & Unread Indicator */}
                    <div className="flex flex-col items-center gap-1.5 shrink-0 pt-0.5">
                      {isUnread && (
                        <div className="w-2.5 h-2.5 rounded-full bg-blue-600 shadow-xs" title="Unread notification" />
                      )}

                      <div className="opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (userEmail) {
                              if (isUnread) {
                                setLocalReadIds((prev) => Array.from(new Set([...prev, item.id])));
                                window.dispatchEvent(
                                  new CustomEvent("ekms-notification-read-update", { detail: { ids: [item.id] } })
                                );
                                markNotificationRead(item.id, userEmail);
                              } else {
                                setLocalReadIds((prev) => prev.filter((id) => id !== item.id));
                                markNotificationUnread(item.id, userEmail);
                              }
                            }
                          }}
                          className="p-1 hover:bg-slate-200/70 rounded-full text-slate-400 hover:text-blue-600 transition-colors"
                          title={isUnread ? "Mark as read" : "Mark as unread"}
                        >
                          {isUnread ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Circle className="w-3.5 h-3.5" />}
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (userEmail) {
                              setLocalClosedIds((prev) => Array.from(new Set([...prev, item.id])));
                              window.dispatchEvent(
                                new CustomEvent("ekms-notification-read-update", { detail: { ids: [item.id] } })
                              );
                              closeNotification(item.id, userEmail);
                            }
                          }}
                          className="p-1 hover:bg-slate-200/70 rounded-full text-slate-400 hover:text-rose-600 transition-colors"
                          title="Close / Dismiss"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
