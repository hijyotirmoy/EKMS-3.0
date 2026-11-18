"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  writeBatch,
} from "firebase/firestore";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";
import { auth, db, getSecondaryAuth } from "@/lib/firebase";
import { getOrFetchCollection, touchMetadata } from "@/lib/cache";
import { invalidateStaffDirectory } from "@/lib/useStaffDirectory";
import { useAuth } from "@/context/AuthContext";
import { usePopup } from "@/context/PopupContext";
import { UserProfile, UserRole, Quiz, Doubt, Course, Facility } from "@/lib/types";
import { getBase64Image } from "@/lib/utils";
import { logUserActivity } from "@/lib/activityLogger";
import {
  Users,
  Plus,
  Trash2,
  Edit2,
  Shield,
  Crown,
  Headphones,
  Building2,
  Search,
  ChevronLeft,
  ChevronRight,
  PieChart,
  BarChart3,
  Network,
  RotateCcw,
  Sparkles,
  Contact,
  Mail,
  Cake,
  Flame,
  ArrowUp,
  ArrowDown,
  Layers,
  X,
  Camera,
  Upload,
  User,
  GripVertical,
  Lock,
  Eye,
  EyeOff,
} from "lucide-react";

export default function AdminTeamsPage() {
  const { userProfile: currentAdminProfile, isMasterAdmin } = useAuth();
  const { toast, showAlert, showConfirm } = usePopup();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [doubts, setDoubts] = useState<Doubt[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRole, setSelectedRole] = useState<string>("All");

  // Add / Edit User Modal
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editEmail, setEditEmail] = useState<string | null>(null);
  const [formEmail, setFormEmail] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [showEditPassword, setShowEditPassword] = useState(false);
  const [formName, setFormName] = useState("");
  const [formAgentId, setFormAgentId] = useState("");
  const [formRole, setFormRole] = useState<UserRole>("Agent");
  const [formDispensaryName, setFormDispensaryName] = useState("");
  const [formDispensaryId, setFormDispensaryId] = useState("");
  const [formDispensaryRole, setFormDispensaryRole] = useState<"Doctor" | "Pharmacist" | "Receptionist">("Receptionist");
  const [dispensaries, setDispensaries] = useState<Facility[]>([]);
  const [formBirthday, setFormBirthday] = useState("");
  const [formPhotoURL, setFormPhotoURL] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [savingUser, setSavingUser] = useState(false);
  const photoFileInputRef = useRef<HTMLInputElement>(null);

  // 1. Fetch Users in Realtime
  useEffect(() => {
    let isMounted = true;

    const unsubUsers = onSnapshot(
      collection(db, "users"),
      (snap) => {
        const list: UserProfile[] = [];
        snap.forEach((d) => {
          const data = d.data();
          const email = (data.email || d.id || "").toLowerCase().trim();
          list.push({
            ...(data as Omit<UserProfile, "email">),
            email: email,
            id: d.id,
            displayName: data.displayName || data.name || email.split("@")[0],
          });
        });
        if (isMounted) {
          setUsers(list);
          setLoading(false);
        }
      },
      (err) => console.error("Users live sync error:", err)
    );

    const loadExtras = async () => {
      try {
        const [qList, dList, cList, facList] = await Promise.all([
          getOrFetchCollection<Quiz>("quizzes"),
          getOrFetchCollection<Doubt>("doubts"),
          getOrFetchCollection<Course>("onboardings", { metaKey: "onboarding" }),
          getOrFetchCollection<Facility>("facilities"),
        ]);

        if (isMounted) {
          setQuizzes(qList);
          setDoubts(dList);
          setCourses(cList);
          const dispOnly = facList.filter((f) => {
            const typeLower = (f.type || "").toLowerCase();
            const nameLower = (f.name || "").toLowerCase();
            if (typeLower.includes("hospital") || nameLower.includes("hospital")) return false;
            if (typeLower.includes("office") || nameLower.includes("office")) return false;
            return typeLower.includes("dispensary") || nameLower.includes("dispensary");
          });
          setDispensaries(dispOnly);
        }
      } catch (err) {
        console.error("Extras load error:", err);
      }
    };
    loadExtras();

    return () => {
      isMounted = false;
      unsubUsers();
    };
  }, []);

  // Compute Next Sequential Agent ID (e.g. ESIC001A, ESIC015A)
  const nextGeneratedAgentId = useMemo(() => {
    let maxNum = 0;
    users.forEach((u) => {
      if (u.agentId?.startsWith("ESIC") && u.agentId.endsWith("A")) {
        const numPart = u.agentId.replace("ESIC", "").replace("A", "");
        const parsed = parseInt(numPart, 10);
        if (!isNaN(parsed) && parsed > maxNum) maxNum = parsed;
      }
    });
    const nextNum = maxNum + 1;
    return "ESIC" + String(nextNum).padStart(3, "0") + "A";
  }, [users]);

  // Filtered Users List
  const filteredUsers = useMemo(() => {
    let list = users;
    if (selectedRole !== "All") {
      list = list.filter((u) => u.role === selectedRole);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (u) =>
          u.displayName?.toLowerCase().includes(q) ||
          u.name?.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q) ||
          u.agentId?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, selectedRole, searchQuery]);

  // Open User Modal
  const handleOpenUserModal = (u?: UserProfile) => {
    if (u) {
      setEditEmail(u.email);
      setFormEmail(u.email);
      setFormPassword("");
      setShowEditPassword(false);
      setFormName(u.displayName || u.name || "");
      setFormAgentId(u.agentId || "");
      setFormRole(u.role || "Agent");
      setFormDispensaryName(u.dispensaryName || "");
      setFormDispensaryId(u.dispensaryId || "");
      setFormDispensaryRole((u.dispensaryRole as any) || "Receptionist");
      setFormBirthday(u.birthday || (u as any).dob || "");
      setFormPhotoURL(u.photoURL || (u as any).avatarUrl || (u as any).profilePhoto || (u as any).profileImage || "");
    } else {
      setEditEmail(null);
      setFormEmail("");
      setFormPassword("");
      setShowEditPassword(false);
      setFormName("");
      setFormAgentId(nextGeneratedAgentId);
      setFormRole("Agent");
      setFormDispensaryName("");
      setFormDispensaryId("");
      setFormDispensaryRole("Receptionist");
      setFormBirthday("");
      setFormPhotoURL("");
    }
    setUserModalOpen(true);
  };

  // Upload Profile Photo Handler
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingPhoto(true);
    try {
      const dataUri = await getBase64Image(file, 400, 0.8);
      setFormPhotoURL(dataUri);
      toast.success("Profile photo attached!");
    } catch (err: any) {
      toast.error("Failed to process photo: " + err.message);
    } finally {
      setUploadingPhoto(false);
      e.target.value = "";
    }
  };

  // Save User Profile
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formEmail.trim() || !formName.trim()) return;

    setSavingUser(true);
    const emailKey = formEmail.trim().toLowerCase();

    try {
      const photoVal = formPhotoURL.trim() || null;
      const birthdayVal = formBirthday.trim() || null;

      if (!editEmail) {
        const initialPass = formPassword.trim() || "ekms123";
        // Create user in Firebase Auth with initial password using secondary app instance
        const secAuth = getSecondaryAuth();
        try {
          await createUserWithEmailAndPassword(secAuth, emailKey, initialPass);
          await secAuth.signOut();
        } catch (authErr: any) {
          console.warn("Auth user creation note:", authErr.message);
        }

        // Automatically restrict other dispensary desks based on chosen role
        let autoRestricted: string[] = [];
        if (formRole === "Dispensary Staff") {
          if (formDispensaryRole === "Receptionist") {
            autoRestricted = ["/dispensary/doctor", "/dispensary/pharmacy"];
          } else if (formDispensaryRole === "Doctor") {
            autoRestricted = ["/dispensary/reception", "/dispensary/pharmacy"];
          } else if (formDispensaryRole === "Pharmacist") {
            autoRestricted = ["/dispensary/reception", "/dispensary/doctor"];
          }
        }

        await setDoc(doc(db, "users", emailKey), {
          email: emailKey,
          displayName: formName.trim(),
          name: formName.trim(),
          agentId: formAgentId.trim() || nextGeneratedAgentId,
          role: formRole,
          dispensaryName: formRole === "Dispensary Staff" ? formDispensaryName : "",
          dispensaryId: formRole === "Dispensary Staff" ? formDispensaryId : "",
          dispensaryRole: formRole === "Dispensary Staff" ? formDispensaryRole : "",
          restrictedPages: autoRestricted,
          birthday: birthdayVal,
          dob: birthdayVal,
          photoURL: photoVal,
          avatarUrl: photoVal,
          profilePhoto: photoVal,
          createdAt: Date.now(),
          orgTier: "unassigned",
          mustChangePassword: true,
          password: initialPass,
          passwordUpdatedAt: Date.now(),
        });

        // Instantly vanish password from state
        setFormPassword("");
        setShowEditPassword(false);

        logUserActivity(currentAdminProfile?.email, {
          desc: `Created team member profile for ${formName.trim()} (${emailKey}) as ${formRole}`,
          type: "add",
        });

        const hasCustomPass = Boolean(formPassword.trim());
        showAlert({
          title: "Team Member Added Successfully",
          message: `Agent ID: ${formAgentId || nextGeneratedAgentId}\nAccount Email: ${emailKey}\n${
            hasCustomPass
              ? `Assigned Password: ${initialPass}`
              : `Password: System default password assigned.`
          }\n\nPlease copy and share these credentials with the user. User can sign in and change their password anytime from their profile.`,
          type: "success",
        });
      } else {
        // Automatically restrict other dispensary desks based on chosen role
        let autoRestricted: string[] = [];
        if (formRole === "Dispensary Staff") {
          if (formDispensaryRole === "Receptionist") {
            autoRestricted = ["/dispensary/doctor", "/dispensary/pharmacy"];
          } else if (formDispensaryRole === "Doctor") {
            autoRestricted = ["/dispensary/reception", "/dispensary/pharmacy"];
          } else if (formDispensaryRole === "Pharmacist") {
            autoRestricted = ["/dispensary/reception", "/dispensary/doctor"];
          }
        }

        const updatePayload: any = {
          displayName: formName.trim(),
          name: formName.trim(),
          agentId: formAgentId.trim(),
          role: formRole,
          dispensaryName: formRole === "Dispensary Staff" ? formDispensaryName : "",
          dispensaryId: formRole === "Dispensary Staff" ? formDispensaryId : "",
          dispensaryRole: formRole === "Dispensary Staff" ? formDispensaryRole : "",
          restrictedPages: autoRestricted,
          birthday: birthdayVal,
          dob: birthdayVal,
          photoURL: photoVal,
          avatarUrl: photoVal,
          profilePhoto: photoVal,
          updatedAt: Date.now(),
        };

        const newPass = formPassword.trim();
        if (newPass) {
          updatePayload.password = newPass;
          updatePayload.passwordUpdatedAt = Date.now();
          updatePayload.mustChangePassword = false;

          // 1. If editing currently logged in admin's Firebase Auth password
          if (auth.currentUser && auth.currentUser.email?.toLowerCase() === emailKey) {
            try {
              const { updatePassword: updateFbPassword } = await import("firebase/auth");
              await updateFbPassword(auth.currentUser, newPass);
            } catch (err: any) {
              console.warn("Update current user auth password notice:", err);
            }
          }

          // 2. Try updating via secondaryAuth
          try {
            const secAuth = getSecondaryAuth();
            const existingUser = users.find((u) => u.email.toLowerCase() === emailKey);
            const prevPass = (existingUser as any)?.password;
            if (prevPass) {
              const secCred = await signInWithEmailAndPassword(secAuth, emailKey, prevPass).catch(() => null);
              if (secCred) {
                const { updatePassword: updateSecPassword } = await import("firebase/auth");
                await updateSecPassword(secCred.user, newPass);
                await secAuth.signOut();
              }
            }
          } catch (secErr) {
            console.warn("Secondary auth password update note:", secErr);
          }
        }

        await setDoc(doc(db, "users", emailKey), updatePayload, { merge: true });

        // Instantly vanish password from component memory so it is NEVER exposed in website memory or frontend
        setFormPassword("");
        setShowEditPassword(false);

        logUserActivity(currentAdminProfile?.email, {
          desc: `Updated member profile & role for ${formName.trim()} (${emailKey})${
            newPass ? " including updated password" : ""
          }`,
          type: "edit",
        });
        toast.success(
          `Profile for ${formName.trim()} updated successfully${newPass ? " with new password" : ""}!`
        );
      }

      await touchMetadata("users");
      invalidateStaffDirectory();
      setUserModalOpen(false);
    } catch (err: any) {
      toast.error("Error saving member: " + err.message);
    } finally {
      setSavingUser(false);
    }
  };

  // Delete User
  const handleDeleteUser = async (email: string) => {
    const confirmed = await showConfirm({
      title: "Delete Member Profile?",
      message: "Are you sure you want to permanently delete profile for " + email + "?",
      isDestructive: true,
      confirmText: "Delete Profile",
    });
    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, "users", email.toLowerCase()));
      await touchMetadata("users");
      invalidateStaffDirectory();
      logUserActivity(currentAdminProfile?.email, {
        desc: `Deleted user profile for ${email}`,
        type: "delete",
      });
      toast.success("Member profile deleted successfully.");
    } catch (e: any) {
      toast.error("Delete error: " + e.message);
    }
  };

  // Format birthday date display e.g. "Oct 12"
  const formatBirthday = (dobString?: string) => {
    if (!dobString) return null;
    try {
      const parts = dobString.split("-");
      if (parts.length === 3) {
        const dateObj = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      }
      return new Date(dobString).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch {
      return dobString;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header with Search, Role Filter, and Add Team Member */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Team Management</h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Search Bar */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search member by name, email, ID..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
            />
          </div>

          {/* All Role Filter */}
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-slate-200 rounded-xl font-semibold text-slate-700 outline-none shadow-2xs cursor-pointer"
          >
            <option value="All">All Roles</option>
            <option value="Agent">Agents</option>
            <option value="Dispensary Staff">Dispensary Staff</option>
            <option value="Admin">Admins</option>
            <option value="Master Admin">Master Admins</option>
          </select>

          {/* Add Team Member Button */}
          <button
            onClick={() => handleOpenUserModal()}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs rounded-xl shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Team Member</span>
          </button>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 sm:gap-4 animate-in fade-in duration-150">
            {loading ? (
              <div className="col-span-full text-center py-16 text-slate-400 text-xs">
                Loading team directory...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="col-span-full text-center py-16 text-slate-400 text-xs">
                No team members found matching your search.
              </div>
            ) : (
              filteredUsers.map((member) => {
                const streak = member.streak || 0;
                const isMaster = member.role === "Master Admin";
                const isAdmin = member.role === "Admin";
                const isDispensary = member.role === "Dispensary Staff" || member.role === "Dispensary";
                const avatar = member.photoURL || (member as any).avatarUrl || (member as any).profilePhoto || (member as any).profileImage;
                const bday = formatBirthday(member.birthday || (member as any).dob);

                return (
                  <div
                    key={member.email}
                    className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-5 shadow-xs hover:shadow-md transition-all text-center flex flex-col items-center justify-between relative group"
                  >
                    {/* Top Row: Streak badge (left) & Edit/Delete icons + ID (right) */}
                    <div className="flex items-center justify-between w-full mb-2 sm:mb-3 text-[10px] sm:text-xs">
                      {streak > 0 ? (
                        <span className="flex items-center gap-1 font-bold text-rose-600 bg-rose-50 px-1.5 sm:px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] border border-rose-100">
                          <Flame className="w-2.5 h-2.5 sm:w-3 sm:h-3 fill-rose-500 text-rose-500" />
                          <span>{streak}d</span>
                        </span>
                      ) : (
                        <span className="text-[9px] sm:text-[10px] font-bold text-slate-400 font-mono">
                          {member.agentId || "#---"}
                        </span>
                      )}

                      {/* Top Right Action Icons: Edit & Delete */}
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenUserModal(member)}
                          className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          title="Edit Member"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(member.email)}
                          className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                          title="Delete Member"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Avatar Circle */}
                    <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-blue-600 text-white font-extrabold text-lg sm:text-2xl flex items-center justify-center overflow-hidden shadow-md mb-2 sm:mb-3 border-2 border-white">
                      {avatar ? (
                        <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
                      ) : (
                        (member.displayName || member.name || member.email).charAt(0).toUpperCase()
                      )}
                    </div>

                    {/* Name & Role */}
                    <div className="space-y-1 mb-2 sm:mb-4 flex-1 w-full px-1">
                      <h3 className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                        {member.displayName || member.name || "Team Member"}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-bold uppercase tracking-wider ${
                          isMaster
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : isAdmin
                            ? "bg-purple-50 text-purple-700 border border-purple-200"
                            : isDispensary
                            ? "bg-teal-50 text-teal-700 border border-teal-200"
                            : "bg-blue-50 text-blue-700 border border-blue-200"
                        }`}
                      >
                        {isMaster ? (
                          <Crown className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                        ) : isAdmin ? (
                          <Shield className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                        ) : isDispensary ? (
                          <Building2 className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                        ) : (
                          <Headphones className="w-2.5 h-2.5 sm:w-3 sm:h-3" />
                        )}
                        <span className="truncate">
                          {isDispensary && (member as any).dispensaryRole
                            ? `${member.role} (${(member as any).dispensaryRole})`
                            : member.role || "Agent"}
                        </span>
                      </span>

                      {isDispensary && member.dispensaryName && (
                        <div
                          className="mt-1 text-[10px] sm:text-[11px] font-semibold text-teal-800 bg-teal-50 border border-teal-200/80 rounded-lg px-2 py-0.5 truncate flex items-center justify-center gap-1"
                          title={member.dispensaryName}
                        >
                          <Building2 className="w-3 h-3 text-teal-600 shrink-0" />
                          <span className="truncate">{member.dispensaryName}</span>
                        </div>
                      )}
                    </div>

                    {/* Bottom Details: Email & Birthday */}
                    <div className="w-full pt-2 sm:pt-3 border-t border-slate-100 space-y-1 text-slate-500">
                      <div className="flex items-center justify-center gap-1 truncate px-1">
                        <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                        <span
                          className="truncate text-[10px] sm:text-[11px] text-slate-600 font-medium"
                          title={member.email}
                        >
                          {member.email}
                        </span>
                      </div>

                      {bday && (
                        <div className="flex items-center justify-center gap-1 text-amber-600 font-medium text-[10px] sm:text-[11px]">
                          <Cake className="w-3 h-3 shrink-0 text-amber-500" />
                          <span>{bday}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

      {/* ====================================================
          MODAL: ADD / EDIT TEAM MEMBER (WITH PHOTO & BIRTHDAY)
          ==================================================== */}
      {userModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white max-w-md w-full rounded-3xl shadow-2xl p-6 border border-slate-100 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-900">
                {editEmail ? "Edit Team Member" : "Add Team Member"}
              </h3>
              <button
                onClick={() => setUserModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="space-y-4">
              {/* Profile Photo Uploader */}
              <div className="flex items-center gap-4 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
                <div className="w-16 h-16 rounded-full bg-blue-600 text-white font-extrabold text-xl flex items-center justify-center overflow-hidden shrink-0 border-2 border-white shadow-sm">
                  {formPhotoURL ? (
                    <img src={formPhotoURL} alt="Avatar Preview" className="w-full h-full object-cover" />
                  ) : (
                    (formName || formEmail || "U").charAt(0).toUpperCase()
                  )}
                </div>

                <div className="space-y-1.5 flex-1">
                  <div className="text-xs font-bold text-slate-800">Profile Photo</div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => photoFileInputRef.current?.click()}
                      disabled={uploadingPhoto}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl flex items-center gap-1 shadow-2xs"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>{uploadingPhoto ? "Processing..." : "Upload Photo"}</span>
                    </button>

                    {formPhotoURL && (
                      <button
                        type="button"
                        onClick={() => setFormPhotoURL("")}
                        className="px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 rounded-xl font-semibold"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <input
                    ref={photoFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoUpload}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Work Email *
                </label>
                <input
                  type="email"
                  value={formEmail}
                  disabled={!!editEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="example@email.com"
                  required
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 disabled:bg-slate-100 disabled:text-slate-400 font-medium"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Ankita Barichowa"
                  required
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-bold"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Agent ID
                  </label>
                  <input
                    type="text"
                    value={formAgentId}
                    onChange={(e) => setFormAgentId(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-mono font-bold text-blue-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    System Role
                  </label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none font-semibold text-slate-800"
                  >
                    <option value="Agent">Agent</option>
                    <option value="Dispensary Staff">Dispensary Staff</option>
                    <option value="Admin">Admin</option>
                    {isMasterAdmin && <option value="Master Admin">Master Admin</option>}
                  </select>
                </div>
              </div>

              {/* Conditional Dispensary Selection for Dispensary Staff */}
              {formRole === "Dispensary Staff" && (
                <div className="space-y-3 p-3 bg-teal-50/40 rounded-xl border border-teal-200">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Dispensary Sub-Role / Designation *
                    </label>
                    <select
                      value={formDispensaryRole}
                      onChange={(e) => setFormDispensaryRole(e.target.value as any)}
                      className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-semibold text-slate-800"
                    >
                      <option value="Receptionist">Dispensary Receptionist (Arrivals & Check-in)</option>
                      <option value="Doctor">Dispensary Doctor (Consultation & Rx)</option>
                      <option value="Pharmacist">Dispensary Pharmacist (Dispensation)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Select Allotted Dispensary *
                    </label>
                    <select
                      value={formDispensaryName}
                      onChange={(e) => {
                        const selectedName = e.target.value;
                        setFormDispensaryName(selectedName);
                        const match = dispensaries.find((d) => d.name === selectedName);
                        setFormDispensaryId(match?.id || "");
                      }}
                      required={formRole === "Dispensary Staff"}
                      className="w-full px-3.5 py-2 text-xs bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-teal-500 font-semibold text-slate-800"
                    >
                      <option value="">-- Choose Allotted Dispensary ({dispensaries.length}) --</option>
                      {dispensaries.map((d) => (
                        <option key={d.id} value={d.name}>
                          {d.name} {d.district ? `(${d.district})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                  Date of Birth / Birthday
                </label>
                <input
                  type="date"
                  value={formBirthday}
                  onChange={(e) => setFormBirthday(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-semibold"
                />
              </div>

              {/* SET / UPDATE PASSWORD (Optional) */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1 flex items-center justify-between">
                  <span>SET / UPDATE PASSWORD</span>
                  <span className="text-[10px] font-normal text-slate-400">Optional</span>
                </label>
                <div className="relative">
                  <input
                    type={showEditPassword ? "text" : "password"}
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    placeholder={
                      editEmail
                        ? "Enter new password to update (or leave blank to keep unchanged)..."
                        : "Leave blank for default password..."
                    }
                    className="w-full px-3.5 py-2 pr-10 text-xs bg-slate-50 border border-slate-200 rounded-xl outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 font-mono tracking-wider"
                  />
                  <button
                    type="button"
                    onClick={() => setShowEditPassword(!showEditPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
                    title={showEditPassword ? "Hide password" : "Show password"}
                  >
                    {showEditPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-[10px] text-slate-500 mt-1 flex items-center gap-1">
                  <Lock className="w-3 h-3 text-emerald-600 shrink-0" />
                  <span>Saved securely directly to Firebase and never exposed in website storage.</span>
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 text-xs font-semibold rounded-xl hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs"
                >
                  {savingUser ? "Saving..." : "Save Member"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
