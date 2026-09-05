"use client";

import React, { useState, useEffect, useMemo } from "react";
import { doc, getDoc, setDoc, collection, onSnapshot } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { logUserActivity } from "@/lib/activityLogger";
import { UserProfile } from "@/lib/types";
import { ALL_AGENT_PAGES, ALL_ADMIN_PAGES, AppPageDef, isPageRestricted } from "@/lib/pageAccess";
import {
  Settings,
  Image as ImageIcon,
  Folder,
  Clock,
  Wrench,
  Shield,
  Save,
  CheckCircle2,
  AlertTriangle,
  EyeOff,
  Eye,
  KeyRound,
  ShieldCheck,
  Lock,
  Unlock,
  Users,
  Search,
  Check,
  X,
  UserCheck,
  ShieldAlert,
  RotateCcw,
  CheckCheck,
  Home,
  HelpCircle,
  Building2,
  GraduationCap,
  Gamepad2,
  CalendarCheck,
  Database,
  Flag,
  User,
  PieChart,
  Edit,
  FileSpreadsheet,
  Users2,
  Bell,
  ClipboardCheck,
} from "lucide-react";

export default function AdminSettingsPage() {
  const { userProfile, isMasterAdmin } = useAuth();
  const { toast } = usePopup();
  const [activeTab, setActiveTab] = useState<
    "privacy" | "access" | "session" | "maintenance" | "images" | "files"
  >("privacy");

  // Mask IP Info Policy
  const [maskIpInfo, setMaskIpInfo] = useState(false);
  const [followUpDays, setFollowUpDays] = useState<number>(8);
  const [savingMaskIp, setSavingMaskIp] = useState(false);
  const [savingFollowUp, setSavingFollowUp] = useState(false);

  // Page Access Control State
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [selectedUserEmail, setSelectedUserEmail] = useState<string>("");
  const [selectedRestrictedPages, setSelectedRestrictedPages] = useState<string[]>([]);
  const [userSearchTerm, setUserSearchTerm] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<"all" | "Agent" | "Admin" | "Master Admin">("all");
  const [savingAccess, setSavingAccess] = useState(false);

  // Session Policy
  const [sessionTimeoutEnabled, setSessionTimeoutEnabled] = useState(true);
  const [sessionTimeoutDuration, setSessionTimeoutDuration] = useState(30);
  const [savingSession, setSavingSession] = useState(false);

  // Maintenance Policy
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState(
    "The system is currently undergoing scheduled maintenance. Please check back soon."
  );
  const [savingMaintenance, setSavingMaintenance] = useState(false);

  // Image Settings
  const [autoCompress, setAutoCompress] = useState(true);
  const [maxImageSize, setMaxImageSize] = useState(2);

  // 1. Fetch System Settings from Firestore
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const docSnap = await getDoc(doc(db, "system", "status"));
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data.maskIpInfo !== undefined) {
            setMaskIpInfo(!!data.maskIpInfo);
          }
          if (data.followUpDays !== undefined) {
            setFollowUpDays(Number(data.followUpDays));
          }
          if (data.sessionTimeoutEnabled !== undefined) {
            setSessionTimeoutEnabled(!!data.sessionTimeoutEnabled);
          }
          if (data.sessionTimeoutDuration !== undefined) {
            setSessionTimeoutDuration(Number(data.sessionTimeoutDuration));
          }
          if (data.maintenanceMode !== undefined) {
            setMaintenanceMode(
              data.maintenanceMode === true || String(data.maintenanceMode).toLowerCase() === "true"
            );
          }
          if (data.maintenanceMessage) {
            setMaintenanceMessage(data.maintenanceMessage);
          }
        }
      } catch (e) {
        console.error("Settings load error:", e);
      }
    };
    fetchSettings();
  }, []);

  // 2. Realtime listener for Users list (for Page Access Control)
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: UserProfile[] = [];
        snap.forEach((d) => {
          const data = d.data() as UserProfile;
          list.push({
            ...data,
            email: data.email || d.id,
            displayName: data.displayName || data.name || (data.email ? data.email.split("@")[0] : d.id),
            role: data.role || "Agent",
            restrictedPages: Array.isArray(data.restrictedPages) ? data.restrictedPages : [],
          });
        });

        // Sort alphabetically by displayName or name
        list.sort((a, b) => (a.displayName || a.email).localeCompare(b.displayName || b.email));
        setUsersList(list);

        // Auto-select first user if none selected
        if (list.length > 0 && !selectedUserEmail) {
          const defaultUser = list.find((u) => u.role === "Agent") || list[0];
          setSelectedUserEmail(defaultUser.email);
          setSelectedRestrictedPages(defaultUser.restrictedPages || []);
        }
      },
      (err) => {
        console.error("Error loading users for permissions:", err);
      }
    );

    return () => unsub();
  }, [selectedUserEmail]);

  // Sync selected user restricted pages when selection changes
  const selectedUser = useMemo(() => {
    return usersList.find((u) => u.email.toLowerCase() === selectedUserEmail.toLowerCase()) || null;
  }, [usersList, selectedUserEmail]);

  const handleSelectUser = (email: string) => {
    setSelectedUserEmail(email);
    const target = usersList.find((u) => u.email.toLowerCase() === email.toLowerCase());
    setSelectedRestrictedPages(target?.restrictedPages || []);
  };

  // Filtered users for dropdown/search
  const filteredUsers = useMemo(() => {
    return usersList.filter((u) => {
      if (userRoleFilter !== "all" && u.role !== userRoleFilter) return false;
      if (userSearchTerm.trim()) {
        const q = userSearchTerm.toLowerCase().trim();
        const name = (u.displayName || u.name || "").toLowerCase();
        const email = (u.email || "").toLowerCase();
        const agentId = (u.agentId || "").toLowerCase();
        return name.includes(q) || email.includes(q) || agentId.includes(q);
      }
      return true;
    });
  }, [usersList, userRoleFilter, userSearchTerm]);

  // Is selected user Master Admin?
  const isSelectedMasterAdmin = useMemo(() => {
    const r = (selectedUser?.role || "").toLowerCase().trim();
    return r.includes("master");
  }, [selectedUser]);

  // Applicable pages list for selected user
  const applicablePages: AppPageDef[] = useMemo(() => {
    if (!selectedUser) return ALL_AGENT_PAGES;
    const roleStr = (selectedUser.role || "").toLowerCase().trim();
    if (roleStr.includes("admin") || roleStr.includes("master")) {
      return ALL_ADMIN_PAGES;
    }
    return ALL_AGENT_PAGES;
  }, [selectedUser]);

  // Toggle single page permission
  const handleTogglePagePermission = (pagePath: string) => {
    if (isSelectedMasterAdmin) return;

    setSelectedRestrictedPages((prev) => {
      const isCurrentlyRestricted = prev.includes(pagePath);
      if (isCurrentlyRestricted) {
        // Remove from restricted -> ALLOW page
        return prev.filter((p) => p !== pagePath);
      } else {
        // Add to restricted -> LOCK page
        return [...prev, pagePath];
      }
    });
  };

  // Bulk permission actions
  const handleAllowAllPages = () => {
    setSelectedRestrictedPages([]);
    toast.info("All pages set to ALLOWED for this user.");
  };

  const handleRestrictAllPages = () => {
    if (isSelectedMasterAdmin) return;
    const allPaths = applicablePages.map((p) => p.path);
    setSelectedRestrictedPages(allPaths);
    toast.warning("All pages set to RESTRICTED for this user.");
  };

  const handleResetToDefault = () => {
    // Default: all accessible for their role
    setSelectedRestrictedPages([]);
    toast.info("Permissions reset to default (All pages accessible).");
  };

  // Save Page Access Permissions to Firestore
  const handleSavePageAccess = async () => {
    if (!selectedUser || !selectedUser.email) return;
    if (isSelectedMasterAdmin) {
      toast.info("Master Administrators always retain full, unrestricted access.");
      return;
    }

    setSavingAccess(true);
    try {
      const email = selectedUser.email.toLowerCase();
      await setDoc(
        doc(db, "users", email),
        {
          restrictedPages: selectedRestrictedPages,
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      logUserActivity(userProfile?.email, {
        desc: `Updated Page Access Permissions for ${selectedUser.displayName || email} (${selectedUser.role}): ${
          selectedRestrictedPages.length === 0
            ? "Full Access (All Allowed)"
            : `${selectedRestrictedPages.length} pages restricted`
        }`,
        type: "settings",
      });

      toast.success(
        `Page permissions updated for ${selectedUser.displayName || email}! ${
          selectedRestrictedPages.length === 0
            ? "All pages are now allowed."
            : `${selectedRestrictedPages.length} pages locked.`
        }`
      );
    } catch (err: any) {
      console.error("Save permissions error:", err);
      toast.error("Failed to save permissions: " + err.message);
    } finally {
      setSavingAccess(false);
    }
  };

  // Save Mask IP Info Policy
  const handleSaveMaskIp = async () => {
    setSavingMaskIp(true);
    try {
      await setDoc(
        doc(db, "system", "status"),
        {
          maskIpInfo,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      logUserActivity(userProfile?.email, {
        desc: `Updated IP Privacy Policy: Masking ${maskIpInfo ? "ENABLED" : "DISABLED"}`,
        type: "settings",
      });
      toast.success(
        maskIpInfo
          ? "Mask IP Info enabled! IP names and phone numbers are now masked across all booking interfaces."
          : "Mask IP Info disabled. Full IP names and numbers are now visible."
      );
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSavingMaskIp(false);
    }
  };

  // Save Follow-Up Schedule Policy
  const handleSaveFollowUp = async () => {
    setSavingFollowUp(true);
    try {
      const validFollowUpDays = Number(followUpDays) > 0 ? Number(followUpDays) : 8;
      await setDoc(
        doc(db, "system", "status"),
        {
          followUpDays: validFollowUpDays,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      logUserActivity(userProfile?.email, {
        desc: `Updated Follow-Up Schedule Offset: ${validFollowUpDays} days`,
        type: "settings",
      });
      toast.success(`Follow-Up schedule offset updated to ${validFollowUpDays} days!`);
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSavingFollowUp(false);
    }
  };

  // Save Session Policy
  const handleSaveSession = async () => {
    setSavingSession(true);
    try {
      await setDoc(
        doc(db, "system", "status"),
        {
          sessionTimeoutEnabled,
          sessionTimeoutDuration: Number(sessionTimeoutDuration),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      logUserActivity(userProfile?.email, {
        desc: `Updated session policy: timeout ${sessionTimeoutDuration} mins (${sessionTimeoutEnabled ? "Enabled" : "Disabled"})`,
        type: "settings",
      });
      toast.success("Session security policy updated across all terminals!");
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSavingSession(false);
    }
  };

  // Save Maintenance Policy
  const handleSaveMaintenance = async () => {
    if (!isMasterAdmin) {
      toast.error("Only Master Admins have authorization to toggle global maintenance.");
      return;
    }

    setSavingMaintenance(true);
    try {
      await setDoc(
        doc(db, "system", "status"),
        {
          maintenanceMode,
          maintenanceMessage: maintenanceMessage.trim(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      logUserActivity(userProfile?.email, {
        desc: `Toggled Global Maintenance Mode: ${maintenanceMode ? "ENABLED" : "DISABLED"}`,
        type: "settings",
      });
      if (maintenanceMode) {
        toast.warning("Global maintenance enabled! All standard agents have been signed out.");
      } else {
        toast.success("Maintenance mode disabled. System open for all agents.");
      }
    } catch (e: any) {
      toast.error("Save failed: " + e.message);
    } finally {
      setSavingMaintenance(false);
    }
  };

  // Helper to map icon name to component
  const getPageIcon = (iconName: string) => {
    switch (iconName) {
      case "Home":
        return Home;
      case "Folder":
        return Folder;
      case "HelpCircle":
        return HelpCircle;
      case "Building2":
        return Building2;
      case "GraduationCap":
        return GraduationCap;
      case "Gamepad2":
        return Gamepad2;
      case "Users":
        return Users;
      case "CalendarCheck":
        return CalendarCheck;
      case "Database":
        return Database;
      case "Flag":
        return Flag;
      case "User":
        return User;
      case "PieChart":
        return PieChart;
      case "Edit":
        return Edit;
      case "FileSpreadsheet":
        return FileSpreadsheet;
      case "Users2":
        return Users2;
      case "Bell":
        return Bell;
      case "ClipboardCheck":
        return ClipboardCheck;
      case "Settings":
        return Settings;
      default:
        return KeyRound;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">System Settings</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Settings Navigation Sidebar (Narrower width for larger right panel) */}
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-3xl p-3 sm:p-4 shadow-xs space-y-1 select-none">
          <button
            onClick={() => setActiveTab("privacy")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "privacy"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <EyeOff className="w-4 h-4 shrink-0" />
            <span>Mask IP Info</span>
          </button>

          <button
            onClick={() => setActiveTab("access")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "access"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>Page Access Control</span>
          </button>

          <button
            onClick={() => setActiveTab("session")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "session"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Clock className="w-4 h-4 shrink-0" />
            <span>Session Timeout Policy</span>
          </button>

          <button
            onClick={() => setActiveTab("maintenance")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "maintenance"
                ? "bg-rose-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Wrench className="w-4 h-4 shrink-0" />
            <span>Global Maintenance Mode</span>
          </button>

          <button
            onClick={() => setActiveTab("images")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "images"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <ImageIcon className="w-4 h-4 shrink-0" />
            <span>Image Compression</span>
          </button>

          <button
            onClick={() => setActiveTab("files")}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all text-left cursor-pointer ${
              activeTab === "files"
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-700 hover:bg-slate-50"
            }`}
          >
            <Folder className="w-4 h-4 shrink-0" />
            <span>Storage & Security Limits</span>
          </button>
        </div>

        {/* Settings Panel Content Area (Larger & Expansive width) */}
        <div className="lg:col-span-9 bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs min-w-0">
          {/* ----------------------------------------------------
              TAB 0: MASK IP INFO (PRIVACY)
              ---------------------------------------------------- */}
          {activeTab === "privacy" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <EyeOff className="w-5 h-5 text-blue-600" />
                  <span>Mask IP Info (Privacy & Data Protection)</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Controls whether Insured Persons (IP) contact details are masked across Agent and Admin Booking interfaces.
                </p>
              </div>

              <div className="space-y-5">
                {/* 1. Mask IP Info Toggle Card & Save Button */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1 max-w-lg">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2">
                        <span>Enable IP Info Masking</span>
                        {maskIpInfo ? (
                          <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                            ACTIVE
                          </span>
                        ) : (
                          <span className="bg-slate-200 text-slate-600 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                            DISABLED
                          </span>
                        )}
                      </h4>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        When toggled ON, IP names show only the first 3 letters and last 3 letters (e.g. <strong>RAM*** ***ESH</strong>), and phone numbers show only the last 4 digits (e.g. <strong>******4821</strong>).
                      </p>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                      <input
                        type="checkbox"
                        checked={maskIpInfo}
                        onChange={(e) => setMaskIpInfo(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-12 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>

                  <div className="pt-3 border-t border-slate-200/60 flex justify-end">
                    <button
                      onClick={handleSaveMaskIp}
                      disabled={savingMaskIp}
                      className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      <span>{savingMaskIp ? "Saving Mask IP Policy..." : "Save Mask IP Policy"}</span>
                    </button>
                  </div>
                </div>

                {/* 2. Follow-Up Days Card & Save Button */}
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1 max-w-lg">
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        <span>Follow-Up Schedule Offset</span>
                        <span className="bg-amber-100 text-amber-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full">
                          {followUpDays} DAYS
                        </span>
                      </h4>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        Configures how many days after a scheduled booking date a follow-up appointment is automatically calculated across agent and admin tables (Default: 8 days).
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 ml-4">
                      <input
                        type="number"
                        min={1}
                        max={90}
                        value={followUpDays}
                        onChange={(e) => setFollowUpDays(Math.max(1, Number(e.target.value)))}
                        className="w-24 px-3 py-2 text-xs border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-amber-500 font-bold bg-white text-slate-900"
                      />
                      <span className="text-xs text-slate-600 font-semibold">days</span>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200/60 flex justify-end">
                    <button
                      onClick={handleSaveFollowUp}
                      disabled={savingFollowUp}
                      className="flex items-center gap-2 px-5 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                    >
                      <Save className="w-4 h-4" />
                      <span>{savingFollowUp ? "Saving Schedule..." : "Save Follow-Up Schedule"}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 1: PAGE ACCESS CONTROL (NEW FEATURE!)
              ---------------------------------------------------- */}
          {activeTab === "access" && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Header */}
              <div className="border-b border-slate-100 pb-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <ShieldCheck className="w-5 h-5 text-blue-600" />
                      <span>User Page Access Permissions</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Grant or restrict access to specific pages for individual Agents and Admins. By default, newly created users have full access to all pages for their role.
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <span className="bg-indigo-50 border border-indigo-200 text-indigo-700 text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1">
                      <Shield className="w-3 h-3 text-indigo-600" />
                      <span>Master Admin = Always Unrestricted</span>
                    </span>
                  </div>
                </div>
              </div>

              {/* User Selector & Search Filter Bar */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <UserCheck className="w-4 h-4 text-blue-600" />
                    <span>Select User to Configure Permissions:</span>
                  </div>

                  {/* Role filter pills */}
                  <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl p-1 shadow-2xs">
                    {(["all", "Agent", "Admin", "Master Admin"] as const).map((r) => (
                      <button
                        key={r}
                        onClick={() => setUserRoleFilter(r)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                          userRoleFilter === r
                            ? "bg-blue-600 text-white shadow-xs"
                            : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        {r === "all" ? "All Users" : r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Dropdown Selector + Search */}
                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-7">
                    <select
                      value={selectedUserEmail}
                      onChange={(e) => handleSelectUser(e.target.value)}
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:border-blue-500 shadow-2xs cursor-pointer"
                    >
                      {filteredUsers.length === 0 ? (
                        <option value="">No matching users found</option>
                      ) : (
                        filteredUsers.map((u) => (
                          <option key={u.email} value={u.email}>
                            {u.displayName || u.name || u.email} ({u.role}) — {u.email}
                          </option>
                        ))
                      )}
                    </select>
                  </div>

                  <div className="md:col-span-5 relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={userSearchTerm}
                      onChange={(e) => setUserSearchTerm(e.target.value)}
                      placeholder="Search user by name or email..."
                      className="w-full pl-8 pr-7 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:border-blue-500 shadow-2xs"
                    />
                    {userSearchTerm && (
                      <button
                        onClick={() => setUserSearchTerm("")}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Selected User Profile Summary Banner */}
              {selectedUser && (
                <div className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-11 h-11 rounded-2xl flex items-center justify-center font-bold text-sm text-white shadow-xs ${
                        isSelectedMasterAdmin
                          ? "bg-gradient-to-br from-indigo-500 to-purple-600"
                          : selectedUser.role === "Admin"
                          ? "bg-gradient-to-br from-blue-500 to-sky-600"
                          : "bg-gradient-to-br from-emerald-500 to-teal-600"
                      }`}
                    >
                      {(selectedUser.displayName || selectedUser.email || "U")
                        .charAt(0)
                        .toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="font-extrabold text-slate-900 text-sm">
                          {selectedUser.displayName || selectedUser.name || selectedUser.email}
                        </h4>
                        <span
                          className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${
                            isSelectedMasterAdmin
                              ? "bg-indigo-100 text-indigo-800 border border-indigo-300"
                              : selectedUser.role === "Admin"
                              ? "bg-blue-100 text-blue-800 border border-blue-300"
                              : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          }`}
                        >
                          {selectedUser.role}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 font-mono mt-0.5">
                        {selectedUser.email}
                      </p>
                    </div>
                  </div>

                  {/* Summary Access Stats */}
                  <div className="flex items-center gap-2">
                    {isSelectedMasterAdmin ? (
                      <span className="bg-indigo-50 text-indigo-800 border border-indigo-200 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                        <Shield className="w-3.5 h-3.5 text-indigo-600" />
                        <span>All Pages Allowed (Unrestricted)</span>
                      </span>
                    ) : selectedRestrictedPages.length === 0 ? (
                      <span className="bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>All {applicablePages.length} Pages Allowed</span>
                      </span>
                    ) : (
                      <span className="bg-rose-50 text-rose-800 border border-rose-200 text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-rose-600" />
                        <span>
                          {selectedRestrictedPages.length} of {applicablePages.length} Pages Restricted
                        </span>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Master Admin Notice Banner if selected */}
              {isSelectedMasterAdmin && (
                <div className="bg-indigo-50 border border-indigo-200/80 rounded-2xl p-4 flex items-start gap-3">
                  <ShieldAlert className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs text-indigo-950">
                    <p className="font-bold">
                      Master Administrator — Permanent Unrestricted Global Access
                    </p>
                    <p className="text-indigo-800 leading-relaxed text-[11px]">
                      Master Administrators retain supreme administrative authority across all modules, databases, and configuration settings. Page permissions for Master Admins cannot be revoked or locked.
                    </p>
                  </div>
                </div>
              )}

              {/* Quick Actions Toolbar */}
              {!isSelectedMasterAdmin && (
                <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleAllowAllPages}
                      className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                      <span>Allow All</span>
                    </button>
                    <button
                      onClick={handleRestrictAllPages}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Restrict All</span>
                    </button>
                    <button
                      onClick={handleResetToDefault}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset to Default</span>
                    </button>
                  </div>

                  <span className="text-[11px] text-slate-400 font-medium">
                    Toggle switch ON to allow access, OFF to lock page.
                  </span>
                </div>
              )}

              {/* Page Permissions Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {applicablePages.map((page) => {
                  const PageIcon = getPageIcon(page.iconName);
                  const isRestricted = selectedRestrictedPages.includes(page.path);
                  const isAllowed = isSelectedMasterAdmin || !isRestricted;

                  return (
                    <div
                      key={page.path}
                      onClick={() => !isSelectedMasterAdmin && handleTogglePagePermission(page.path)}
                      className={`p-4 rounded-2xl border transition-all select-none flex items-start justify-between gap-3.5 ${
                        isSelectedMasterAdmin
                          ? "bg-slate-50/70 border-slate-200 opacity-90 cursor-default"
                          : isAllowed
                          ? "bg-white border-slate-200/90 hover:border-blue-300 hover:shadow-2xs cursor-pointer"
                          : "bg-rose-50/40 border-rose-200/90 hover:border-rose-300 cursor-pointer"
                      }`}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div
                          className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                            isAllowed
                              ? "bg-blue-50 text-blue-600 border border-blue-100"
                              : "bg-rose-100 text-rose-600 border border-rose-200"
                          }`}
                        >
                          <PageIcon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <h4
                              className={`font-bold text-xs truncate ${
                                isAllowed ? "text-slate-900" : "text-rose-950 font-extrabold"
                              }`}
                            >
                              {page.label}
                            </h4>
                          </div>
                          <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5 leading-tight">
                            {page.description}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1.5">
                            <span className="font-mono text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded">
                              {page.path}
                            </span>
                            {isAllowed ? (
                              <span className="bg-emerald-50 text-emerald-700 text-[10px] font-black px-1.5 py-0.2 rounded border border-emerald-200 inline-flex items-center gap-1">
                                <Unlock className="w-2.5 h-2.5" />
                                <span>ALLOWED</span>
                              </span>
                            ) : (
                              <span className="bg-rose-100 text-rose-800 text-[10px] font-black px-1.5 py-0.2 rounded border border-rose-300 inline-flex items-center gap-1">
                                <Lock className="w-2.5 h-2.5" />
                                <span>LOCKED</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* iOS Style Permission Toggle */}
                      <div className="shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isAllowed}
                            disabled={isSelectedMasterAdmin}
                            onChange={() => handleTogglePagePermission(page.path)}
                            className="sr-only peer"
                          />
                          <div
                            className={`w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all ${
                              isSelectedMasterAdmin
                                ? "peer-checked:bg-indigo-600 opacity-60 cursor-not-allowed"
                                : "peer-checked:bg-emerald-600"
                            }`}
                          ></div>
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Bottom Save Action Bar */}
              <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="text-xs text-slate-500 font-medium">
                  {selectedUser && (
                    <span>
                      Modifying permissions for:{" "}
                      <strong className="text-slate-800">
                        {selectedUser.displayName || selectedUser.email}
                      </strong>
                    </span>
                  )}
                </div>

                <button
                  onClick={handleSavePageAccess}
                  disabled={savingAccess || isSelectedMasterAdmin}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {savingAccess ? "Saving Permissions..." : "Save Page Permissions"}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 2: SESSION TIMEOUT
              ---------------------------------------------------- */}
          {activeTab === "session" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900">Inactivity Timeout Policy</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Automatically terminates idle terminal sessions to comply with security standards.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Enable Inactivity Auto-Logout</h4>
                    <p className="text-[11px] text-slate-500">
                      Monitors mouse movements, keystrokes, and touch events on all terminals.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={sessionTimeoutEnabled}
                    onChange={(e) => setSessionTimeoutEnabled(e.target.checked)}
                    className="w-5 h-5 text-blue-600 rounded"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Timeout Inactivity Interval
                  </label>
                  <select
                    value={sessionTimeoutDuration}
                    disabled={!sessionTimeoutEnabled}
                    onChange={(e) => setSessionTimeoutDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold text-slate-800 disabled:opacity-50"
                  >
                    <option value={1}>1 Minute (Testing Mode)</option>
                    <option value={15}>15 Minutes</option>
                    <option value={30}>30 Minutes (Recommended)</option>
                    <option value={60}>1 Hour</option>
                    <option value={240}>4 Hours</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={handleSaveSession}
                    disabled={savingSession}
                    className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingSession ? "Saving Policy..." : "Update Session Policy"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 3: MAINTENANCE MODE
              ---------------------------------------------------- */}
          {activeTab === "maintenance" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-rose-700 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5" />
                  <span>Global Maintenance Mode</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Restricts portal access during major upgrades or database migrations. Master Admins bypass lockouts.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-rose-50 border border-rose-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-rose-900">Enable Maintenance Mode</h4>
                    <p className="text-[11px] text-rose-600">
                      When enabled, all non-Master Admins are immediately signed out and shown a maintenance modal.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={maintenanceMode}
                    onChange={(e) => setMaintenanceMode(e.target.checked)}
                    className="w-5 h-5 text-rose-600 rounded"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Custom Maintenance Announcement
                  </label>
                  <textarea
                    value={maintenanceMessage}
                    onChange={(e) => setMaintenanceMessage(e.target.value)}
                    rows={4}
                    placeholder="e.g. Scheduled database maintenance in progress..."
                    className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-rose-500 leading-relaxed font-sans"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={handleSaveMaintenance}
                    disabled={savingMaintenance}
                    className="flex items-center gap-2 px-5 py-2.5 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl shadow-xs transition-colors"
                  >
                    <Save className="w-4 h-4" />
                    <span>{savingMaintenance ? "Applying Rules..." : "Apply Maintenance Rules"}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 4: IMAGE COMPRESSION
              ---------------------------------------------------- */}
          {activeTab === "images" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900">Image Compression Settings</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Controls client-side image downscaling before uploading to avoid database bloat.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">Auto-Compress Uploads</h4>
                    <p className="text-[11px] text-slate-500">
                      Downscales large camera photos to max 600px with 75% JPEG quality.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoCompress}
                    onChange={(e) => setAutoCompress(e.target.checked)}
                    className="w-5 h-5 text-blue-600 rounded"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Hard Maximum Upload Limit
                  </label>
                  <select
                    value={maxImageSize}
                    onChange={(e) => setMaxImageSize(Number(e.target.value))}
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-bold"
                  >
                    <option value={1}>1 MB</option>
                    <option value={2}>2 MB (Recommended)</option>
                    <option value={5}>5 MB</option>
                  </select>
                </div>

                <div className="pt-3 border-t border-slate-100 flex justify-end">
                  <button
                    onClick={() => toast.success("Image compression preferences saved locally.")}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs"
                  >
                    Save Preferences
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* ----------------------------------------------------
              TAB 5: STORAGE & LIMITS
              ---------------------------------------------------- */}
          {activeTab === "files" && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <h3 className="text-base font-bold text-slate-900">Storage Policies</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Firestore document size constraints and Google Drive proxy rules.
                </p>
              </div>

              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl space-y-2">
                <div className="flex items-center gap-2 font-bold text-xs text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Strict Firestore Document Size Guard (1 MB Limit)</span>
                </div>
                <p className="text-[11px] text-emerald-700 leading-relaxed">
                  The client-side upload pipeline enforces a strict 950KB ceiling on raw document blobs to prevent
                  database document overflows. Files exceeding this size are routed to the Google Apps Script Drive proxy.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
