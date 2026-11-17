"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { db, getSecondaryAuth } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { UserProfile, DispensaryAccount } from "@/lib/types";
import { ALL_AGENT_PAGES } from "@/lib/pageAccess";
import { logUserActivity } from "@/lib/activityLogger";
import * as XLSX from "xlsx";
import {
  Building2,
  Plus,
  Search,
  Trash2,
  Edit2,
  Download,
  RotateCcw,
  X,
  MapPin,
  Phone,
  Mail,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  Lock,
  Unlock,
  Key,
  Copy,
  Check,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";

export default function ManageDispensaryPage() {
  const { userProfile: currentAdminProfile, isMasterAdmin } = useAuth();
  const { toast, showAlert, showConfirm } = usePopup();

  const [dispensaries, setDispensaries] = useState<DispensaryAccount[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [stateFilter, setStateFilter] = useState("all");

  // Add / Edit Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<DispensaryAccount | null>(null);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form Fields
  const [formName, setFormName] = useState("");
  const [formId, setFormId] = useState("");
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("esic123");
  const [showPassword, setShowPassword] = useState(false);
  const [formPhone, setFormPhone] = useState("");
  const [formState, setFormState] = useState("");
  const [formDistrict, setFormDistrict] = useState("");
  const [formLocation, setFormLocation] = useState("");
  const [formStatus, setFormStatus] = useState<"active" | "inactive">("active");
  const [formRestrictedPages, setFormRestrictedPages] = useState<string[]>([]);
  const [showPagesAccordion, setShowPagesAccordion] = useState(false);

  // 1. Live Sync from Firestore users collection where role === 'Dispensary'
  useEffect(() => {
    let isMounted = true;
    const unsub = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: DispensaryAccount[] = [];
        snap.forEach((d) => {
          const data = d.data();
          if (data.role === "Dispensary") {
            const email = (data.email || d.id || "").toLowerCase().trim();
            list.push({
              id: d.id,
              dispensaryId: data.dispensaryId || d.id.split("@")[0].toUpperCase(),
              dispensaryName: data.dispensaryName || data.displayName || data.name || "Dispensary",
              email: email,
              location: data.location || "",
              district: data.district || "",
              state: data.state || "",
              phone: data.phone || "",
              status: data.status === "inactive" ? "inactive" : "active",
              role: "Dispensary",
              createdAt: data.createdAt || 0,
              updatedAt: data.updatedAt || 0,
              restrictedPages: Array.isArray(data.restrictedPages) ? data.restrictedPages : [],
              isLocked: data.isLocked || false,
              lastLoginAt: data.lastLoginAt || 0,
            });
          }
        });

        // Sort by dispensary ID or name
        list.sort((a, b) => a.dispensaryName.localeCompare(b.dispensaryName));

        if (isMounted) {
          setDispensaries(list);
          setLoading(false);
        }
      },
      (err) => {
        console.error("Dispensary live sync error:", err);
        if (isMounted) setLoading(false);
      }
    );

    return () => {
      isMounted = false;
      unsub();
    };
  }, []);

  // Compute stats & distinct states
  const { activeCount, inactiveCount, distinctStates } = useMemo(() => {
    let active = 0;
    let inactive = 0;
    const statesSet = new Set<string>();

    dispensaries.forEach((d) => {
      if (d.status === "active") active++;
      else inactive++;
      if (d.state && d.state.trim()) {
        statesSet.add(d.state.trim());
      }
    });

    return {
      activeCount: active,
      inactiveCount: inactive,
      distinctStates: Array.from(statesSet).sort(),
    };
  }, [dispensaries]);

  // Next suggested Dispensary ID
  const nextGeneratedId = useMemo(() => {
    const count = dispensaries.length + 1;
    return `DISP-${String(count).padStart(3, "0")}`;
  }, [dispensaries]);

  // Filtered Dispensaries
  const filteredDispensaries = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return dispensaries.filter((d) => {
      // Status filter
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      // State filter
      if (stateFilter !== "all" && d.state?.toLowerCase() !== stateFilter.toLowerCase()) return false;
      // Search query
      if (q) {
        const matchesName = d.dispensaryName.toLowerCase().includes(q);
        const matchesId = d.dispensaryId.toLowerCase().includes(q);
        const matchesEmail = d.email.toLowerCase().includes(q);
        const matchesLoc = d.location?.toLowerCase().includes(q);
        const matchesDist = d.district?.toLowerCase().includes(q);
        const matchesState = d.state?.toLowerCase().includes(q);
        const matchesPhone = d.phone?.toLowerCase().includes(q);
        return (
          matchesName ||
          matchesId ||
          matchesEmail ||
          matchesLoc ||
          matchesDist ||
          matchesState ||
          matchesPhone
        );
      }
      return true;
    });
  }, [dispensaries, searchQuery, statusFilter, stateFilter]);

  // Open modal for Adding
  const handleOpenAdd = () => {
    setEditingAccount(null);
    setFormName("");
    setFormId(nextGeneratedId);
    setFormEmail("");
    setFormPassword("esic123");
    setShowPassword(false);
    setFormPhone("");
    setFormState("");
    setFormDistrict("");
    setFormLocation("");
    setFormStatus("active");
    setFormRestrictedPages([]);
    setShowPagesAccordion(false);
    setModalOpen(true);
  };

  // Open modal for Editing
  const handleOpenEdit = (acc: DispensaryAccount) => {
    setEditingAccount(acc);
    setFormName(acc.dispensaryName);
    setFormId(acc.dispensaryId);
    setFormEmail(acc.email);
    setFormPassword(""); // Leave empty unless changing
    setShowPassword(false);
    setFormPhone(acc.phone || "");
    setFormState(acc.state || "");
    setFormDistrict(acc.district || "");
    setFormLocation(acc.location || "");
    setFormStatus(acc.status);
    setFormRestrictedPages(acc.restrictedPages || []);
    setShowPagesAccordion(false);
    setModalOpen(true);
  };

  // Copy helper
  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    toast.success(`Copied "${text}" to clipboard`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Page Restriction toggle helper
  const togglePageRestriction = (path: string) => {
    setFormRestrictedPages((prev) =>
      prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]
    );
  };

  // Save (Create or Update) Dispensary
  const handleSaveDispensary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !formEmail.trim() || !formId.trim()) {
      toast.error("Dispensary Name, ID, and Email are required.");
      return;
    }

    setSaving(true);
    const cleanEmail = formEmail.trim().toLowerCase();
    const cleanId = formId.trim().toUpperCase();

    try {
      if (!editingAccount) {
        // 1. Create in Firebase Auth using secondary instance (prevents admin logout)
        const secAuth = getSecondaryAuth();
        try {
          await createUserWithEmailAndPassword(secAuth, cleanEmail, formPassword.trim() || "esic123");
          await secAuth.signOut();
        } catch (authErr: any) {
          console.warn("Dispensary Auth User creation notice:", authErr.message);
        }

        // 2. Save user document in Firestore 'users'
        const userDocPayload: any = {
          email: cleanEmail,
          displayName: formName.trim(),
          name: formName.trim(),
          dispensaryName: formName.trim(),
          dispensaryId: cleanId,
          role: "Dispensary",
          status: formStatus,
          location: formLocation.trim(),
          district: formDistrict.trim(),
          state: formState.trim(),
          phone: formPhone.trim(),
          restrictedPages: formRestrictedPages,
          createdAt: Date.now(),
          mustChangePassword: true,
          password: formPassword.trim() || "esic123",
          passwordUpdatedAt: Date.now(),
        };

        await setDoc(doc(db, "users", cleanEmail), userDocPayload);

        // 3. Also save in 'dispensaries' collection indexed by cleanId for instant lookup
        await setDoc(doc(db, "dispensaries", cleanId.toLowerCase()), {
          ...userDocPayload,
          id: cleanId,
        });

        logUserActivity(currentAdminProfile?.email, {
          desc: `Created Dispensary account ${formName.trim()} (${cleanId} / ${cleanEmail})`,
          type: "add",
        });

        showAlert({
          title: "Dispensary Account Created!",
          message: `Dispensary ID: ${cleanId}\nLogin Email: ${cleanEmail}\nTemporary Password: ${
            formPassword.trim() || "esic123"
          }\n\nThe dispensary can now sign in using their Dispensary ID or Email at the Dispensary login portal.`,
          type: "success",
        });
      } else {
        // Update existing dispensary
        const updatePayload: any = {
          displayName: formName.trim(),
          name: formName.trim(),
          dispensaryName: formName.trim(),
          dispensaryId: cleanId,
          status: formStatus,
          location: formLocation.trim(),
          district: formDistrict.trim(),
          state: formState.trim(),
          phone: formPhone.trim(),
          restrictedPages: formRestrictedPages,
          updatedAt: Date.now(),
        };

        const newPass = formPassword.trim();
        if (newPass) {
          updatePayload.password = newPass;
          updatePayload.passwordUpdatedAt = Date.now();
          updatePayload.mustChangePassword = false;

          try {
            const secAuth = getSecondaryAuth();
            const existingDisp = dispensaries.find((a: DispensaryAccount) => a.email.toLowerCase() === cleanEmail);
            const prevPass = (existingDisp as any)?.password || "esic123";
            const secCred = await signInWithEmailAndPassword(secAuth, cleanEmail, prevPass).catch(() => null);
            if (secCred) {
              const { updatePassword: updateSecPassword } = await import("firebase/auth");
              await updateSecPassword(secCred.user, newPass);
              await secAuth.signOut();
            }
          } catch (secErr) {
            console.warn("Secondary auth dispensary password update note:", secErr);
          }
        }

        await setDoc(doc(db, "users", cleanEmail), updatePayload, { merge: true });

        // Update dispensaries collection
        await setDoc(doc(db, "dispensaries", cleanId.toLowerCase()), updatePayload, {
          merge: true,
        });

        // Vanish password from component state instantly
        setFormPassword("");
        setShowPassword(false);

        logUserActivity(currentAdminProfile?.email, {
          desc: `Updated Dispensary details for ${formName.trim()} (${cleanId})`,
          type: "edit",
        });

        toast.success(`Dispensary ${formName} updated successfully.`);
      }

      setModalOpen(false);
    } catch (err: any) {
      console.error("Save dispensary error:", err);
      toast.error(err.message || "Failed to save dispensary.");
    } finally {
      setSaving(false);
    }
  };

  // Toggle Active/Inactive Status
  const handleToggleStatus = async (acc: DispensaryAccount) => {
    const newStatus = acc.status === "active" ? "inactive" : "active";
    try {
      await setDoc(doc(db, "users", acc.email), { status: newStatus }, { merge: true });
      await setDoc(
        doc(db, "dispensaries", acc.dispensaryId.toLowerCase()),
        { status: newStatus },
        { merge: true }
      );

      logUserActivity(currentAdminProfile?.email, {
        desc: `Changed dispensary status of ${acc.dispensaryName} to ${newStatus.toUpperCase()}`,
        type: "edit",
      });

      if (newStatus === "active") {
        toast.success(`${acc.dispensaryName} is now ACTIVE`);
      } else {
        toast.info(`${acc.dispensaryName} is now INACTIVE`);
      }
    } catch (err: any) {
      toast.error("Could not update status.");
    }
  };

  // Send Password Reset Email
  const handleResetPassword = async (acc: DispensaryAccount) => {
    const confirmed = await showConfirm({
      title: "Send Password Reset Link?",
      message: `Send an official password reset link to ${acc.email} for dispensary "${acc.dispensaryName}"?`,
      confirmText: "Send Reset Link",
      isDestructive: false,
    });
    if (!confirmed) return;

    try {
      const secAuth = getSecondaryAuth();
      await sendPasswordResetEmail(secAuth, acc.email);
      await secAuth.signOut();
      toast.success(`Reset link dispatched to ${acc.email}`);
      logUserActivity(currentAdminProfile?.email, {
        desc: `Dispatched password reset email to dispensary ${acc.email}`,
        type: "edit",
      });
    } catch (e: any) {
      toast.error(e.message || "Failed to send reset link.");
    }
  };

  // Delete Dispensary Account
  const handleDeleteDispensary = async (acc: DispensaryAccount) => {
    const confirmed = await showConfirm({
      title: "Delete Dispensary Account?",
      message: `Are you sure you want to delete ${acc.dispensaryName} (${acc.dispensaryId})? This action cannot be reversed.`,
      confirmText: "Delete Account",
      isDestructive: true,
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "users", acc.email));
      await deleteDoc(doc(db, "dispensaries", acc.dispensaryId.toLowerCase()));

      logUserActivity(currentAdminProfile?.email, {
        desc: `Deleted dispensary account ${acc.dispensaryName} (${acc.email})`,
        type: "delete",
      });

      toast.success("Dispensary account deleted.");
    } catch (e: any) {
      toast.error("Failed to delete account.");
    }
  };

  // Export to Excel
  const handleExportExcel = () => {
    if (dispensaries.length === 0) {
      toast.info("No dispensaries available to export.");
      return;
    }

    const data = filteredDispensaries.map((d) => ({
      "Dispensary ID": d.dispensaryId,
      "Dispensary Name": d.dispensaryName,
      "Login Email": d.email,
      "Phone / Contact": d.phone || "—",
      Location: d.location || "—",
      District: d.district || "—",
      State: d.state || "—",
      Status: d.status.toUpperCase(),
      "Restricted Pages Count": (d.restrictedPages || []).length,
      "Restricted Pages": (d.restrictedPages || []).join(", ") || "None (Full Access)",
      "Created Date": d.createdAt ? new Date(d.createdAt).toLocaleDateString() : "—",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dispensaries");
    XLSX.writeFile(wb, `EKMS_Dispensaries_${new Date().toISOString().slice(0, 10)}.xlsx`);

    toast.success("Dispensaries roster exported successfully.");
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* 1. Header & Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 bg-teal-50 border border-teal-200/80 rounded-2xl flex items-center justify-center text-teal-600 shadow-2xs">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <span>Manage Appointment</span>
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-teal-100 text-teal-800">
                Dispensary Portal
              </span>
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Create and manage dispensary appointment accounts, configure branch access, and monitor credentials.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            onClick={handleExportExcel}
            className="inline-flex items-center gap-2 px-3.5 py-2 bg-slate-50 hover:bg-slate-100 active:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 transition-colors shadow-2xs cursor-pointer"
            title="Download Excel spreadsheet"
          >
            <Download className="w-4 h-4 text-slate-600" />
            <span>Export Excel</span>
          </button>

          <button
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Dispensary</span>
          </button>
        </div>
      </div>

      {/* 2. Metrics Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Total Dispensaries
            </div>
            <div className="text-2xl font-black text-slate-900 mt-1">{dispensaries.length}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
            <Building2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Active Accounts
            </div>
            <div className="text-2xl font-black text-emerald-600 mt-1">{activeCount}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Inactive / Suspended
            </div>
            <div className="text-2xl font-black text-rose-600 mt-1">{inactiveCount}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <XCircle className="w-5 h-5" />
          </div>
        </div>

        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Covered States
            </div>
            <div className="text-2xl font-black text-teal-600 mt-1">{distinctStates.length}</div>
          </div>
          <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
            <MapPin className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* 3. Search & Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-xs flex flex-col md:flex-row gap-3 items-center justify-between">
        <div className="relative w-full md:max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by ID, name, email, district, state..."
            className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2.5 w-full md:w-auto flex-wrap justify-end">
          {/* Status Filter */}
          <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
            <button
              onClick={() => setStatusFilter("all")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                statusFilter === "all"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setStatusFilter("active")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                statusFilter === "active"
                  ? "bg-white text-emerald-700 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Active
            </button>
            <button
              onClick={() => setStatusFilter("inactive")}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                statusFilter === "inactive"
                  ? "bg-white text-rose-700 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Inactive
            </button>
          </div>

          {/* State Filter */}
          {distinctStates.length > 0 && (
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              <option value="all">All States</option>
              {distinctStates.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>
          )}

          {(searchQuery || statusFilter !== "all" || stateFilter !== "all") && (
            <button
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
                setStateFilter("all");
              }}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg"
              title="Reset Filters"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 4. Dispensaries Table & Cards */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-slate-500">
            <div className="w-8 h-8 border-2 border-teal-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-xs font-medium">Loading dispensary accounts...</p>
          </div>
        ) : filteredDispensaries.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <Building2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-700">No dispensaries found</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              {searchQuery || statusFilter !== "all"
                ? "Try adjusting your search criteria or filters."
                : "Get started by adding your first dispensary branch account."}
            </p>
            {(!searchQuery && statusFilter === "all") && (
              <button
                onClick={handleOpenAdd}
                className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white rounded-xl text-xs font-bold hover:bg-teal-700 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add First Dispensary</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200/80 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3.5 px-4">Dispensary ID</th>
                  <th className="py-3.5 px-4">Dispensary Name & Location</th>
                  <th className="py-3.5 px-4">Login Email</th>
                  <th className="py-3.5 px-4">State & District</th>
                  <th className="py-3.5 px-4">Phone</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Page Access</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDispensaries.map((acc) => {
                  const isRestrictedCount = (acc.restrictedPages || []).length;
                  return (
                    <tr
                      key={acc.id || acc.email}
                      className="hover:bg-slate-50/70 transition-colors group"
                    >
                      {/* Dispensary ID Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 bg-teal-50 text-teal-700 font-mono font-bold px-2.5 py-1 rounded-lg border border-teal-200">
                          <span>{acc.dispensaryId}</span>
                          <button
                            onClick={() => handleCopy(acc.dispensaryId, `id-${acc.dispensaryId}`)}
                            className="text-teal-500 hover:text-teal-800 p-0.5"
                            title="Copy ID"
                          >
                            {copiedId === `id-${acc.dispensaryId}` ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Name & Address */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{acc.dispensaryName}</div>
                        {acc.location ? (
                          <div className="text-[11px] text-slate-500 truncate max-w-xs flex items-center gap-1 mt-0.5">
                            <MapPin className="w-3 h-3 text-slate-400 flex-shrink-0" />
                            <span className="truncate">{acc.location}</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">No address provided</span>
                        )}
                      </td>

                      {/* Login Email */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1 text-slate-700 font-medium">
                          <Mail className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />
                          <span>{acc.email}</span>
                          <button
                            onClick={() => handleCopy(acc.email, `email-${acc.email}`)}
                            className="text-slate-400 hover:text-slate-700 p-0.5"
                            title="Copy Email"
                          >
                            {copiedId === `email-${acc.email}` ? (
                              <Check className="w-3 h-3 text-emerald-600" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* State & District */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="text-slate-800 font-medium">{acc.state || "—"}</div>
                        <div className="text-[11px] text-slate-400">{acc.district || "—"}</div>
                      </td>

                      {/* Phone */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-slate-600">
                        {acc.phone ? (
                          <div className="flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-400" />
                            <span>{acc.phone}</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>

                      {/* Status Toggle */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <button
                          onClick={() => handleToggleStatus(acc)}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border transition-colors cursor-pointer ${
                            acc.status === "active"
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                              : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                          }`}
                          title={`Click to ${acc.status === "active" ? "deactivate" : "activate"}`}
                        >
                          {acc.status === "active" ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              <span>Active</span>
                            </>
                          ) : (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              <span>Inactive</span>
                            </>
                          )}
                        </button>
                      </td>

                      {/* Page Access */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        {isRestrictedCount === 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                            <Unlock className="w-3 h-3" />
                            <span>Full Portal</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                            <Lock className="w-3 h-3" />
                            <span>{isRestrictedCount} Pages Restricted</span>
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleResetPassword(acc)}
                            className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors cursor-pointer"
                            title="Send Password Reset Email"
                          >
                            <Key className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleOpenEdit(acc)}
                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
                            title="Edit Dispensary"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleDeleteDispensary(acc)}
                            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Delete Account"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. ADD / EDIT DISPENSARY MODAL */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-100 overflow-hidden relative my-8">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {editingAccount ? "Edit Dispensary Account" : "Add New Dispensary"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {editingAccount
                      ? "Update branch location, credentials, and page restrictions."
                      : "Create a new dispensary login account with assigned credentials."}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200/50"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form */}
            <form onSubmit={handleSaveDispensary} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Dispensary Name */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Dispensary Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="e.g. ESIS Dispensary Guwahati"
                    required
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {/* Dispensary ID */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Dispensary ID / Code <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formId}
                    onChange={(e) => setFormId(e.target.value.toUpperCase())}
                    placeholder="e.g. DISP-001"
                    required
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {/* Login Email */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Login Email Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="e.g. disp001@ekms.in"
                    required
                    disabled={!!editingAccount}
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-60"
                  />
                </div>

                {/* SET / UPDATE PASSWORD */}
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>SET / UPDATE PASSWORD</span>
                    <span className="text-[10px] font-normal text-slate-400">
                      {editingAccount ? "Optional" : "Default: esic123"}
                    </span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={formPassword}
                      onChange={(e) => setFormPassword(e.target.value)}
                      placeholder={editingAccount ? "Enter new password to update..." : "Enter password (or leave for esic123)"}
                      className="w-full px-3.5 py-2 pr-10 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-teal-500 font-mono tracking-wider"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                      title={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                    <Lock className="w-3 h-3 text-emerald-600 shrink-0" />
                    <span>Saved securely directly to Firebase and never exposed in website storage.</span>
                  </p>
                </div>

                {/* Phone / Contact */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Contact Phone
                  </label>
                  <input
                    type="text"
                    value={formPhone}
                    onChange={(e) => setFormPhone(e.target.value)}
                    placeholder="e.g. 9876543210"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {/* State */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    State
                  </label>
                  <input
                    type="text"
                    value={formState}
                    onChange={(e) => setFormState(e.target.value)}
                    placeholder="e.g. Assam, Delhi, etc."
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {/* District */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    District
                  </label>
                  <input
                    type="text"
                    value={formDistrict}
                    onChange={(e) => setFormDistrict(e.target.value)}
                    placeholder="e.g. Kamrup Metro"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {/* Address / Location */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Location / Full Address
                  </label>
                  <textarea
                    rows={2}
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    placeholder="e.g. Dispensary Road, Ulubari, Guwahati"
                    className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>

                {/* Status Selection */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Account Status
                  </label>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                      <input
                        type="radio"
                        name="accountStatus"
                        checked={formStatus === "active"}
                        onChange={() => setFormStatus("active")}
                        className="text-teal-600 focus:ring-teal-500"
                      />
                      <span>Active (Allows Login)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700">
                      <input
                        type="radio"
                        name="accountStatus"
                        checked={formStatus === "inactive"}
                        onChange={() => setFormStatus("inactive")}
                        className="text-rose-600 focus:ring-rose-500"
                      />
                      <span>Inactive / Suspended</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Page Access Restrictions Accordion */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowPagesAccordion(!showPagesAccordion)}
                  className="w-full flex items-center justify-between py-2 text-xs font-bold text-slate-700 hover:text-teal-700 cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-slate-400" />
                    <span>Page Access Restrictions ({formRestrictedPages.length} Restricted)</span>
                  </span>
                  {showPagesAccordion ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>

                {showPagesAccordion && (
                  <div className="mt-2 p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2">
                    <p className="text-[11px] text-slate-500">
                      Check any pages you wish to <strong>block / lock</strong> for this dispensary account:
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {ALL_AGENT_PAGES.map((page) => {
                        const isBlocked = formRestrictedPages.includes(page.path);
                        return (
                          <label
                            key={page.path}
                            className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                              isBlocked
                                ? "bg-rose-50 border-rose-200 text-rose-800"
                                : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={isBlocked}
                                onChange={() => togglePageRestriction(page.path)}
                                className="rounded text-rose-600 focus:ring-rose-500"
                              />
                              <span className="font-medium">{page.label}</span>
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">{page.path}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  disabled={saving}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 bg-teal-600 hover:bg-teal-700 active:bg-teal-800 disabled:bg-teal-400 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {saving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>{editingAccount ? "Save Changes" : "Create Dispensary"}</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
