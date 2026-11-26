"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  deleteDoc,
  writeBatch,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import { db, logsDb } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { AppNotification, NotificationType, NotificationTargetRole } from "@/lib/types";
import { parseMarkdownLinks } from "@/lib/utils";
import { formatNotificationMessage } from "@/lib/maskUtils";
import { logUserActivity } from "@/lib/activityLogger";
import { createNotification, formatNotificationTime, isStaleBirthdayNotification, NOTIFICATIONS_PAUSED } from "@/lib/notificationService";
import {
  Megaphone,
  Plus,
  Eye,
  Trash2,
  X,
  Search,
  CheckSquare,
  AlertTriangle,
  Users,
  Shield,
  User,
  CalendarCheck,
  Flag,
  HelpCircle,
  Gamepad2,
  GraduationCap,
  Cake,
  Bell,
  ArrowRight,
  Info,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";

export default function AdminAnnouncementsPage() {
  const { user, userProfile, isAdmin } = useAuth();
  const { toast, showConfirm } = usePopup();

  // All unified notification & announcement items
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  // Filter State: 'all' | 'broadcast' | 'admin' | 'targeted' | 'agent' | 'birthday'
  const [filterTab, setFilterTab] = useState<
    "all" | "broadcast" | "admin" | "targeted" | "agent" | "birthday"
  >("all");

  // Selection & Bulk Actions
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Modals
  const [viewItem, setViewItem] = useState<AppNotification | null>(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [maskIpInfo, setMaskIpInfo] = useState(false);

  // Form State for New Notification / Broadcast
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [targetType, setTargetType] = useState<"all" | "admin" | "agent" | "specific">("all");
  const [specificEmail, setSpecificEmail] = useState("");
  const [link, setLink] = useState("");
  const [saving, setSaving] = useState(false);

  // 1. Fetch from BOTH `notifications` and `announcements` Collections in logsDb in Real Time
  useEffect(() => {
    let notifsFromDb: AppNotification[] = [];
    let annFromDb: AppNotification[] = [];

    const syncAll = () => {
      const map = new Map<string, AppNotification>();
      notifsFromDb.forEach((n) => {
        if (!isStaleBirthdayNotification(n)) {
          map.set(n.id, n);
        } else {
          try { deleteDoc(doc(logsDb, "notifications", n.id)); } catch (e) {}
        }
      });
      annFromDb.forEach((a) => {
        if (isStaleBirthdayNotification(a)) {
          try { deleteDoc(doc(logsDb, "announcements", a.id)); } catch (e) {}
          return;
        }
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
      setItems(combined);
      setLoading(false);
    };

    // A. Listen to notifications collection in logsDb (Limited to 50 newest to prevent read bloat)
    const unsubNotifs = onSnapshot(
      query(collection(logsDb, "notifications"), orderBy("createdAt", "desc"), limit(50)),
      (snapshot) => {
        const list: AppNotification[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...(docSnap.data() as Omit<AppNotification, "id">) });
        });
        notifsFromDb = list;
        syncAll();
      },
      (err) => console.warn("logsDb notifications sync notice:", err)
    );

    // B. Listen to announcements collection in logsDb
    const unsubAnn = onSnapshot(
      collection(logsDb, "announcements"),
      (snapshot) => {
        const list: AppNotification[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as any;
          list.push({
            id: docSnap.id,
            title: data.title || "📢 Official Broadcast",
            message: data.message || "",
            type: data.type || "announcement",
            targetEmail: (data.targetEmail || "all").toLowerCase().trim(),
            targetRole: data.targetRole || "all",
            celebrantEmail: data.celebrantEmail,
            readBy: data.readBy || [],
            closedBy: data.closedBy || [],
            createdAt: data.createdAt || Date.now(),
            link: data.link,
            metadata: data.metadata || {},
          });
        });
        annFromDb = list;
        syncAll();
      },
      (err) => console.warn("logsDb announcements sync notice:", err)
    );

    // C. Listen to System Status for Masking Policy
    const unsubStatus = onSnapshot(
      doc(db, "system", "status"),
      (snap) => {
        if (snap.exists()) {
          setMaskIpInfo(!!snap.data().maskIpInfo);
        }
      },
      (err) => console.warn("status sync notice:", err)
    );

    return () => {
      try { unsubNotifs(); } catch (e) {}
      try { unsubAnn(); } catch (e) {}
      try { unsubStatus(); } catch (e) {}
    };
  }, []);

  // 2. Counts for KPI boxes
  const { totalCount, broadcastCount, adminCount, targetedCount } = useMemo(() => {
    let broadcast = 0;
    let admin = 0;
    let targeted = 0;

    items.forEach((item) => {
      const isTargetAll = !item.targetEmail || item.targetEmail === "all";
      const isRoleAdmin = item.targetRole === "admin";
      const isRoleAgent = item.targetRole === "agent";

      if (!isTargetAll) {
        targeted++;
      } else if (isRoleAdmin) {
        admin++;
      } else {
        broadcast++;
      }
    });

    return {
      totalCount: items.length,
      broadcastCount: broadcast,
      adminCount: admin,
      targetedCount: targeted,
    };
  }, [items]);

  // 3. Filter Items by Tab and Search
  const filteredItems = useMemo(() => {
    let list = items;

    if (NOTIFICATIONS_PAUSED) {
      // User policy: Stop all action notifications from showing
      list = list.filter((i) => i.type === "announcement");
    }

    if (filterTab === "broadcast") {
      list = list.filter(
        (i) => (!i.targetEmail || i.targetEmail === "all") && (!i.targetRole || i.targetRole === "all")
      );
    } else if (filterTab === "admin") {
      list = list.filter((i) => i.targetRole === "admin");
    } else if (filterTab === "targeted") {
      list = list.filter((i) => i.targetEmail && i.targetEmail !== "all");
    } else if (filterTab === "agent") {
      list = list.filter((i) => i.targetRole === "agent");
    } else if (filterTab === "birthday") {
      list = list.filter((i) => i.type === "birthday" && !isStaleBirthdayNotification(i));
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (i) =>
          i.title?.toLowerCase().includes(q) ||
          i.message?.toLowerCase().includes(q) ||
          i.targetEmail?.toLowerCase().includes(q) ||
          i.targetRole?.toLowerCase().includes(q) ||
          i.type?.toLowerCase().includes(q) ||
          i.celebrantEmail?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [items, filterTab, searchQuery]);

  // 4. Selection Handlers
  const handleToggleSelectItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleSelectAll = () => {
    if (filteredItems.length === 0) return;
    const allSelected = filteredItems.every((i) => selectedIds.has(i.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      const next = new Set(selectedIds);
      filteredItems.forEach((i) => next.add(i.id));
      setSelectedIds(next);
    }
  };

  // 5. Bulk Delete from Both Collections
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    const confirmed = await showConfirm({
      title: `Permanently Delete ${count} Item${count === 1 ? "" : "s"}?`,
      message: `Are you sure you want to permanently delete ${count} selected notification${count === 1 ? "" : "s"} / broadcast${count === 1 ? "" : "s"}? This action cannot be undone and will remove them from all user drawers.`,
      isDestructive: true,
      confirmText: `Yes, Delete ${count} Item${count === 1 ? "" : "s"}`,
    });
    if (!confirmed) return;

    setBulkDeleting(true);
    try {
      const batch1 = writeBatch(logsDb);
      const batch2 = writeBatch(logsDb);

      selectedIds.forEach((id) => {
        batch1.delete(doc(logsDb, "notifications", id));
        batch2.delete(doc(logsDb, "announcements", id));
      });

      await Promise.allSettled([batch1.commit(), batch2.commit()]);

      logUserActivity(user?.email, {
        desc: `Bulk deleted ${count} notifications/announcements`,
        type: "delete",
      });

      setSelectedIds(new Set());
      if (viewItem && selectedIds.has(viewItem.id)) {
        setViewItem(null);
      }
      toast.success(`Successfully deleted ${count} item${count === 1 ? "" : "s"}.`);
    } catch (err: any) {
      console.error("Bulk delete error:", err);
      toast.error("Failed to delete items: " + (err.message || "Unknown error"));
    } finally {
      setBulkDeleting(false);
    }
  };

  // 6. Single Item Delete
  const handleSingleDelete = async (item: AppNotification) => {
    const confirmed = await showConfirm({
      title: "Delete Notification / Broadcast?",
      message: `Are you sure you want to permanently delete "${item.title || "this item"}"?`,
      isDestructive: true,
      confirmText: "Delete",
    });
    if (!confirmed) return;

    try {
      await Promise.allSettled([
        deleteDoc(doc(logsDb, "notifications", item.id)),
        deleteDoc(doc(logsDb, "announcements", item.id)),
      ]);

      logUserActivity(user?.email, {
        desc: `Deleted notification: "${item.title}"`,
        type: "delete",
      });

      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });

      if (viewItem?.id === item.id) {
        setViewItem(null);
      }
      toast.success("Item deleted successfully.");
    } catch (err: any) {
      console.error("Delete error:", err);
      toast.error("Failed to delete item.");
    }
  };

  // 7. Create New Broadcast / Notification
  const handleCreateNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (NOTIFICATIONS_PAUSED) {
      toast.info("Notification system is currently paused. No data was sent to Firebase.");
      setCreateModalOpen(false);
      return;
    }
    if (!message.trim()) return;

    setSaving(true);
    try {
      const targetEmail =
        targetType === "specific" && specificEmail.trim()
          ? specificEmail.trim().toLowerCase()
          : "all";

      const targetRole: NotificationTargetRole =
        targetType === "admin"
          ? "admin"
          : targetType === "agent"
          ? "agent"
          : "all";

      await createNotification({
        title: title.trim() || (targetType === "admin" ? "🛡️ Admin Notice" : "📢 Official Announcement"),
        message: message.trim(),
        type: "announcement",
        targetEmail,
        targetRole,
        link: link.trim() || undefined,
      });

      logUserActivity(user?.email, {
        desc: `Dispatched notification/broadcast: "${(title || message).substring(0, 40)}..." [Target: ${targetType}]`,
        type: "add",
      });

      setTitle("");
      setMessage("");
      setTargetType("all");
      setSpecificEmail("");
      setLink("");
      setCreateModalOpen(false);
      toast.success("Broadcast dispatched successfully to target audience!");
    } catch (err: any) {
      console.error("Failed to dispatch:", err);
      toast.error("Failed to dispatch broadcast: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Type badge helper
  const getTypeBadge = (type?: NotificationType) => {
    switch (type) {
      case "booking":
        return { bg: "bg-blue-50 text-blue-700 border-blue-200", icon: CalendarCheck, label: "Booking" };
      case "report":
        return { bg: "bg-rose-50 text-rose-700 border-rose-200", icon: Flag, label: "Report" };
      case "doubt":
        return { bg: "bg-amber-50 text-amber-700 border-amber-200", icon: HelpCircle, label: "Doubt" };
      case "quiz":
        return { bg: "bg-purple-50 text-purple-700 border-purple-200", icon: Gamepad2, label: "Quiz" };
      case "course":
        return { bg: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: GraduationCap, label: "Course" };
      case "birthday":
        return { bg: "bg-pink-50 text-pink-700 border-pink-200", icon: Cake, label: "Birthday" };
      case "announcement":
        return { bg: "bg-indigo-50 text-indigo-700 border-indigo-200", icon: Megaphone, label: "Broadcast" };
      default:
        return { bg: "bg-slate-100 text-slate-700 border-slate-200", icon: Bell, label: "System" };
    }
  };

  // Audience badge helper
  const getAudienceBadge = (item: AppNotification) => {
    const isTargetAll = !item.targetEmail || item.targetEmail === "all";
    const role = (item.targetRole || "all").toLowerCase();

    if (!isTargetAll) {
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
            <User className="w-3 h-3" />
            <span>Specific User</span>
          </span>
          <span className="text-[10px] text-slate-500 font-mono truncate max-w-[160px]" title={item.targetEmail}>
            {item.targetEmail}
          </span>
        </div>
      );
    }

    if (role === "admin" || role === "master_admin" || role === "admins") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
          <Shield className="w-3 h-3 text-amber-600" />
          <span>Admins Only</span>
        </span>
      );
    }

    if (role === "agent" || role === "agents") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
          <Users className="w-3 h-3 text-emerald-600" />
          <span>Agents Only</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
        <Megaphone className="w-3 h-3 text-blue-600" />
        <span>All Users</span>
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Manage Notifications
            </h1>
            {NOTIFICATIONS_PAUSED && (
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300">
                System Paused
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-48 sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by title, message, user..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 shadow-xs"
            />
          </div>

          <button
            onClick={() => {
              if (NOTIFICATIONS_PAUSED) {
                toast.info("Notifications are paused per system policy. No data will be written to Firebase.");
                return;
              }
              setCreateModalOpen(true);
            }}
            className={`flex items-center gap-1.5 px-4 py-2 font-semibold text-xs rounded-xl shadow-xs transition-colors shrink-0 ${
              NOTIFICATIONS_PAUSED
                ? "bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-300"
                : "bg-blue-600 hover:bg-blue-700 text-white"
            }`}
            title={NOTIFICATIONS_PAUSED ? "Notification system is paused" : "Create Broadcast"}
          >
            <Plus className="w-4 h-4" />
            <span>{NOTIFICATIONS_PAUSED ? "Create Broadcast (Paused)" : "Create Broadcast"}</span>
          </button>
        </div>
      </div>

      {/* Paused Notification System Policy Banner */}
      {NOTIFICATIONS_PAUSED && (
        <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0 text-amber-700">
              <Bell className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-amber-900 tracking-tight">All Action Notifications Paused</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-200 text-amber-900">
                  Firebase Writes Halted
                </span>
              </div>
              <p className="text-xs text-amber-700 mt-0.5">
                Notifications for all actions and automated events have been paused. No data is sent or written to Firebase. All functions and schemas remain completely intact for future use.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 4 Interactive KPI Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 select-none">
        {/* Total Notifications */}
        <div
          onClick={() => setFilterTab("all")}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
            filterTab === "all"
              ? "bg-slate-100/90 border-slate-400 ring-2 ring-slate-500/30 shadow-md scale-[1.01]"
              : "bg-slate-50 border-slate-200 hover:border-slate-300 hover:shadow-xs"
          }`}
        >
          <div className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">
            Total Dispatched
          </div>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1">{totalCount}</div>
        </div>

        {/* Public Broadcasts */}
        <div
          onClick={() => setFilterTab("broadcast")}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
            filterTab === "broadcast"
              ? "bg-blue-50/90 border-blue-400 ring-2 ring-blue-500/30 shadow-md scale-[1.01]"
              : "bg-blue-50/60 border-blue-200 hover:border-blue-300 hover:shadow-xs"
          }`}
        >
          <div className="text-[10px] font-bold text-blue-800 uppercase tracking-wider">
            Broadcast (All Users)
          </div>
          <div className="text-xl sm:text-2xl font-black text-blue-900 mt-1">{broadcastCount}</div>
        </div>

        {/* Admin Alerts */}
        <div
          onClick={() => setFilterTab("admin")}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
            filterTab === "admin"
              ? "bg-amber-50/90 border-amber-400 ring-2 ring-amber-500/30 shadow-md scale-[1.01]"
              : "bg-amber-50/60 border-amber-200 hover:border-amber-300 hover:shadow-xs"
          }`}
        >
          <div className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">
            Admin Action Alerts
          </div>
          <div className="text-xl sm:text-2xl font-black text-amber-900 mt-1">{adminCount}</div>
        </div>

        {/* Targeted User Alerts */}
        <div
          onClick={() => setFilterTab("targeted")}
          className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
            filterTab === "targeted"
              ? "bg-purple-50/90 border-purple-400 ring-2 ring-purple-500/30 shadow-md scale-[1.01]"
              : "bg-purple-50/60 border-purple-200 hover:border-purple-300 hover:shadow-xs"
          }`}
        >
          <div className="text-[10px] font-bold text-purple-800 uppercase tracking-wider">
            Direct User Alerts
          </div>
          <div className="text-xl sm:text-2xl font-black text-purple-900 mt-1">{targetedCount}</div>
        </div>
      </div>

      {/* Main Table Container */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-xs space-y-4">
        {/* Table Filter Tabs and Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-slate-900 text-base">Dispatched Notification Feed</h3>
            <span className="px-2.5 py-0.5 bg-slate-100 text-slate-600 rounded-full font-bold text-xs">
              {filteredItems.length}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {filteredItems.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleToggleSelectAll}
                  className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-full text-xs font-semibold transition-colors flex items-center gap-1"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-slate-500" />
                  <span>
                    {filteredItems.length > 0 && filteredItems.every((i) => selectedIds.has(i.id))
                      ? "Deselect All"
                      : "Select All"}
                  </span>
                </button>

                {selectedIds.size > 0 && (
                  <button
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                    className="px-3.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-full text-xs font-bold shadow-xs transition-colors flex items-center gap-1"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{bulkDeleting ? "Deleting..." : `Delete (${selectedIds.size})`}</span>
                  </button>
                )}
              </div>
            )}

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1">
              <button
                onClick={() => setFilterTab("all")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  filterTab === "all"
                    ? "bg-slate-900 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilterTab("broadcast")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  filterTab === "broadcast"
                    ? "bg-blue-600 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                📢 Broadcasts
              </button>
              <button
                onClick={() => setFilterTab("admin")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  filterTab === "admin"
                    ? "bg-amber-600 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                🛡️ Admin Alerts
              </button>
              <button
                onClick={() => setFilterTab("targeted")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  filterTab === "targeted"
                    ? "bg-purple-600 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                🎯 Direct Users
              </button>
              <button
                onClick={() => setFilterTab("agent")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  filterTab === "agent"
                    ? "bg-emerald-600 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                👥 Agents
              </button>
              <button
                onClick={() => setFilterTab("birthday")}
                className={`px-3 py-1 rounded-full text-xs font-bold transition-all ${
                  filterTab === "birthday"
                    ? "bg-pink-600 text-white shadow-2xs"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                🎂 Birthdays
              </button>
            </div>
          </div>
        </div>

        {/* Bulk Action Bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center justify-between bg-rose-50 border border-rose-200 px-4 py-2.5 rounded-2xl text-xs shadow-xs animate-in fade-in">
            <div className="flex items-center gap-2 font-bold text-rose-900">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>
                {selectedIds.size} notification{selectedIds.size === 1 ? "" : "s"} / broadcast
                {selectedIds.size === 1 ? "" : "s"} selected for deletion
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedIds(new Set())}
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
                <span>{bulkDeleting ? "Deleting..." : `Delete Selected (${selectedIds.size})`}</span>
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto rounded-2xl border border-slate-100">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 border-b border-slate-200 uppercase tracking-wider font-semibold">
                <th className="p-4 w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      filteredItems.length > 0 && filteredItems.every((i) => selectedIds.has(i.id))
                    }
                    onChange={handleToggleSelectAll}
                    className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                    title="Select all"
                  />
                </th>
                <th className="p-4">Type & Title</th>
                <th className="p-4">Target Audience / Recipient</th>
                <th className="p-4">Message Snippet</th>
                <th className="p-4">Dispatched At</th>
                <th className="p-4 text-center">Read / Dismissed</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-slate-400">
                    Loading dispatched notifications and broadcasts...
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-16 text-slate-400">
                    No notifications found in this view.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const typeBadge = getTypeBadge(item.type);
                  const IconComp = typeBadge.icon;
                  const isSelected = selectedIds.has(item.id);
                  const readCount = item.readBy?.length || 0;
                  const closedCount = item.closedBy?.length || 0;

                  return (
                    <tr
                      key={item.id}
                      className={`transition-colors ${
                        isSelected ? "bg-rose-50/50" : "hover:bg-slate-50/70"
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="p-4 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelectItem(item.id)}
                          className="w-4 h-4 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                        />
                      </td>

                      {/* Type & Title */}
                      <td className="p-4 min-w-[180px]">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border ${typeBadge.bg}`}
                          >
                            <IconComp className="w-3 h-3" />
                            <span>{typeBadge.label}</span>
                          </span>
                        </div>
                        <div
                          className="font-bold text-slate-900 leading-snug line-clamp-1"
                          dangerouslySetInnerHTML={{
                            __html: parseMarkdownLinks(
                              formatNotificationMessage(
                                item.title,
                                maskIpInfo,
                                (item.metadata as any)?.ipName,
                                (item.metadata as any)?.phone
                              )
                            ),
                          }}
                        />
                      </td>

                      {/* Audience */}
                      <td className="p-4 whitespace-nowrap">{getAudienceBadge(item)}</td>

                      {/* Message Snippet */}
                      <td className="p-4 max-w-xs">
                        <div
                          className="text-slate-700 line-clamp-2 leading-relaxed text-xs"
                          dangerouslySetInnerHTML={{
                            __html: parseMarkdownLinks(
                              formatNotificationMessage(
                                item.message,
                                maskIpInfo,
                                (item.metadata as any)?.ipName,
                                (item.metadata as any)?.phone
                              )
                            ),
                          }}
                        />
                      </td>

                      {/* Dispatched At */}
                      <td className="p-4 text-slate-500 whitespace-nowrap">
                        <div>
                          {item.createdAt
                            ? new Date(item.createdAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                              })
                            : "—"}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {formatNotificationTime(item.createdAt)}
                        </div>
                      </td>

                      {/* Read Stats */}
                      <td className="p-4 text-center whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-slate-100 rounded-lg text-[10px] font-bold text-slate-700">
                          <span className="text-emerald-600">{readCount} read</span>
                          <span>•</span>
                          <span className="text-slate-500">{closedCount} closed</span>
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setViewItem(item)}
                            className="flex items-center gap-1 px-2.5 py-1 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View</span>
                          </button>

                          <button
                            onClick={() => handleSingleDelete(item)}
                            className="flex items-center gap-1 px-2 py-1 border border-rose-200 hover:bg-rose-50 text-rose-600 hover:text-rose-700 rounded-lg text-xs font-semibold transition-colors"
                            title="Delete notification"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span className="hidden md:inline">Delete</span>
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

      {/* ====================================================
          MODAL 1: VIEW FULL DETAILS & AUDIENCE INSPECTOR
          ==================================================== */}
      {viewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-lg w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Bell className="w-5 h-5 text-blue-600" />
                <span>Notification & Broadcast Inspector</span>
              </h3>
              <button
                onClick={() => setViewItem(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              {/* Type and Audience */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    Notification Type
                  </span>
                  <span className="font-bold text-slate-900 capitalize">{viewItem.type}</span>
                </div>
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                    Target Audience
                  </span>
                  <div>{getAudienceBadge(viewItem)}</div>
                </div>
              </div>

              {/* Title */}
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Title</span>
                <div
                  className="font-bold text-slate-900 p-2.5 bg-slate-50 rounded-xl border border-slate-200"
                  dangerouslySetInnerHTML={{
                    __html: parseMarkdownLinks(
                      formatNotificationMessage(
                        viewItem.title,
                        maskIpInfo,
                        (viewItem.metadata as any)?.ipName,
                        (viewItem.metadata as any)?.phone
                      )
                    ),
                  }}
                />
              </div>

              {/* Message */}
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                  Message Content
                </span>
                <div
                  className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-800 leading-relaxed whitespace-pre-wrap"
                  dangerouslySetInnerHTML={{
                    __html: parseMarkdownLinks(
                      formatNotificationMessage(
                        viewItem.message,
                        maskIpInfo,
                        (viewItem.metadata as any)?.ipName,
                        (viewItem.metadata as any)?.phone
                      )
                    ),
                  }}
                />
              </div>

              {/* Link Target */}
              {viewItem.link && (
                <div className="flex items-center gap-2 p-2.5 bg-blue-50 text-blue-800 border border-blue-200 rounded-xl">
                  <ExternalLink className="w-4 h-4 text-blue-600 shrink-0" />
                  <div className="truncate">
                    <span className="font-bold">Redirect Link: </span>
                    <span className="font-mono text-[11px]">{viewItem.link}</span>
                  </div>
                </div>
              )}

              {/* Read / Closed User Lists */}
              <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 rounded-xl">
                <div>
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block mb-1">
                    Read by ({viewItem.readBy?.length || 0} users)
                  </span>
                  {viewItem.readBy && viewItem.readBy.length > 0 ? (
                    <div className="max-h-24 overflow-y-auto space-y-1 text-[11px] text-slate-600 font-mono">
                      {viewItem.readBy.map((em, idx) => (
                        <div key={idx} className="truncate" title={em}>
                          • {em}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-400 text-[11px]">No users read yet</span>
                  )}
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block mb-1">
                    Closed by ({viewItem.closedBy?.length || 0} users)
                  </span>
                  {viewItem.closedBy && viewItem.closedBy.length > 0 ? (
                    <div className="max-h-24 overflow-y-auto space-y-1 text-[11px] text-slate-600 font-mono">
                      {viewItem.closedBy.map((em, idx) => (
                        <div key={idx} className="truncate" title={em}>
                          • {em}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-slate-400 text-[11px]">No users dismissed yet</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => handleSingleDelete(viewItem)}
                className="px-3.5 py-2 border border-rose-200 hover:bg-rose-50 text-rose-600 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>Delete Notification</span>
              </button>

              <button
                type="button"
                onClick={() => setViewItem(null)}
                className="px-4 py-2 border rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====================================================
          MODAL 2: CREATE NEW BROADCAST / NOTIFICATION
          ==================================================== */}
      {createModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-lg w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-blue-600" />
                <span>Dispatch Broadcast / Notification</span>
              </h3>
              <button
                onClick={() => setCreateModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateNotification} className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Notification Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. 📢 System Maintenance Scheduled"
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              {/* Message */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Message Body (Supports **bold**, *italic*, and [links](url))
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={4}
                  required
                  placeholder="Example: Please review the updated **Operational Guidelines** before tomorrow."
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-sans leading-relaxed"
                />
              </div>

              {/* Target Audience */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Target Audience
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTargetType("all")}
                    className={`p-2 rounded-xl border text-xs font-bold transition-all text-left flex items-center gap-2 ${
                      targetType === "all"
                        ? "bg-blue-50 border-blue-500 text-blue-800"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Megaphone className="w-4 h-4 text-blue-600" />
                    <span>All Users</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTargetType("admin")}
                    className={`p-2 rounded-xl border text-xs font-bold transition-all text-left flex items-center gap-2 ${
                      targetType === "admin"
                        ? "bg-amber-50 border-amber-500 text-amber-800"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Shield className="w-4 h-4 text-amber-600" />
                    <span>Admins Only</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTargetType("agent")}
                    className={`p-2 rounded-xl border text-xs font-bold transition-all text-left flex items-center gap-2 ${
                      targetType === "agent"
                        ? "bg-emerald-50 border-emerald-500 text-emerald-800"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <Users className="w-4 h-4 text-emerald-600" />
                    <span>Agents Only</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setTargetType("specific")}
                    className={`p-2 rounded-xl border text-xs font-bold transition-all text-left flex items-center gap-2 ${
                      targetType === "specific"
                        ? "bg-purple-50 border-purple-500 text-purple-800"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <User className="w-4 h-4 text-purple-600" />
                    <span>Specific User</span>
                  </button>
                </div>
              </div>

              {/* Specific Email Input */}
              {targetType === "specific" && (
                <div className="animate-in fade-in">
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    User Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={specificEmail}
                    onChange={(e) => setSpecificEmail(e.target.value)}
                    placeholder="e.g. agent.name@piramalswasthya.org"
                    className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-purple-500 font-mono"
                  />
                </div>
              )}

              {/* Optional Link */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Action Link / URL (Optional)
                </label>
                <input
                  type="text"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="e.g. /booking or /quiz or /facilities"
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCreateModalOpen(false)}
                  className="px-4 py-2 border rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-xs transition-colors"
                >
                  {saving ? "Dispatching..." : "Dispatch Broadcast"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
