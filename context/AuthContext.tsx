"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, onSnapshot, arrayUnion, increment, collection, query, where, getDocs } from "firebase/firestore";
import { auth, db, logsDb } from "@/lib/firebase";
import { UserProfile, UserRole, SystemStatus } from "@/lib/types";
import { logUserActivity } from "@/lib/activityLogger";

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  role: UserRole | "guest";
  isLoggedIn: boolean;
  isAdmin: boolean;
  isMasterAdmin: boolean;
  loading: boolean;
  loginWithRole: (requestedRole: UserRole, email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfileData: (data: Partial<UserProfile>) => Promise<void>;
  systemStatus: SystemStatus | null;
  maintenanceMessage: string | null;
  showLoginModal: boolean;
  setShowLoginModal: (show: boolean) => void;
  openLoginModal: () => void;
  closeLoginModal: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  const role: UserRole | "guest" = userProfile?.role || (user ? "Agent" : "guest");
  const isLoggedIn = !!user;
  const isMasterAdmin = role === "Master Admin";
  const isAdmin = isMasterAdmin || role === "Admin";

  const openLoginModal = () => setShowLoginModal(true);
  const closeLoginModal = () => setShowLoginModal(false);

  // 1. Fetch User Profile
  const fetchUserProfile = async (currentUser: User) => {
    try {
      const email = currentUser.email?.toLowerCase();
      if (!email) return null;

      const userDocRef = doc(db, "users", email);
      const snap = await getDoc(userDocRef);

      if (snap.exists()) {
        const data = snap.data() as UserProfile;
        setUserProfile(data);
        return data;
      } else {
        // Auto-provision profile if missing
        const newProfile: UserProfile = {
          email: email,
          displayName: currentUser.displayName || email.split("@")[0],
          name: currentUser.displayName || email.split("@")[0],
          role: "Agent",
          createdAt: Date.now(),
        };
        await setDoc(userDocRef, newProfile, { merge: true });
        setUserProfile(newProfile);
        return newProfile;
      }
    } catch (err) {
      console.error("Error fetching user profile:", err);
      return null;
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchUserProfile(user);
    }
  };

  const updateProfileData = async (data: Partial<UserProfile>) => {
    if (!user || !user.email) return;
    const email = user.email.toLowerCase();
    const userDocRef = doc(db, "users", email);
    await setDoc(userDocRef, { ...data, updatedAt: Date.now() }, { merge: true });
    await refreshProfile();
  };

  // 2. Auth State & Live Profile Listener
  useEffect(() => {
    let unsubProfile: (() => void) | null = null;
    let safetyTimer: NodeJS.Timeout | null = setTimeout(() => {
      setLoading(false);
    }, 2500);

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (safetyTimer) {
        clearTimeout(safetyTimer);
        safetyTimer = null;
      }
      setUser(currentUser);
      if (currentUser && currentUser.email) {
        if (unsubProfile) unsubProfile();

        const email = currentUser.email.toLowerCase();
        const userDocRef = doc(db, "users", email);

        const snapTimeout = setTimeout(() => {
          setLoading(false);
        }, 2000);

        unsubProfile = onSnapshot(
          userDocRef,
          (snap) => {
            clearTimeout(snapTimeout);
            let profileData: UserProfile;
            if (snap.exists()) {
              profileData = snap.data() as UserProfile;
              setUserProfile(profileData);
            } else {
              profileData = {
                email: email,
                displayName: currentUser.displayName || email.split("@")[0],
                name: currentUser.displayName || email.split("@")[0],
                role: "Agent",
                createdAt: Date.now(),
              };
              setDoc(userDocRef, profileData, { merge: true });
              setUserProfile(profileData);
            }

            // Sync active user account to storage for consistent booking attribution across all modules
            if (typeof window !== "undefined") {
              const activeAgentData = {
                displayName: profileData.displayName || profileData.name || currentUser.displayName || email.split("@")[0],
                name: profileData.name || profileData.displayName || currentUser.displayName || email.split("@")[0],
                email: email,
                role: profileData.role || "Agent",
                agentId: currentUser.uid || email.split("@")[0],
              };
              try {
                localStorage.setItem("ekms_active_agent", JSON.stringify(activeAgentData));
                sessionStorage.setItem("ekms_active_agent", JSON.stringify(activeAgentData));
                localStorage.setItem("ekms_auth_agent", JSON.stringify(activeAgentData));
                localStorage.setItem("crm_user_profile", JSON.stringify(profileData));
              } catch (e) {}
            }

            setLoading(false);
          },
          (err) => {
            clearTimeout(snapTimeout);
            console.error("User profile live sync error:", err);
            setLoading(false);
          }
        );
      } else {
        if (unsubProfile) {
          unsubProfile();
          unsubProfile = null;
        }
        setUserProfile(null);
        if (typeof window !== "undefined") {
          try {
            localStorage.removeItem("ekms_active_agent");
            sessionStorage.removeItem("ekms_active_agent");
            localStorage.removeItem("ekms_auth_agent");
            localStorage.removeItem("crm_user_profile");
          } catch (e) {}
        }
        setLoading(false);
      }
    });

    return () => {
      if (safetyTimer) clearTimeout(safetyTimer);
      unsubscribe();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  // 3. Maintenance Mode Listener
  useEffect(() => {
    const statusDocRef = doc(db, "system", "status");
    const unsubscribe = onSnapshot(
      statusDocRef,
      (docSnap) => {
        if (docSnap.exists()) {
          const status = docSnap.data() as SystemStatus;
          setSystemStatus(status);

          const isMaint =
            status.maintenanceMode === true || String(status.maintenanceMode).toLowerCase() === "true";

          if (isMaint && user && userProfile && userProfile.role !== "Master Admin") {
            setMaintenanceMessage(
              status.maintenanceMessage ||
                "The system is currently undergoing scheduled maintenance. You have been safely logged out."
            );
            fbSignOut(auth);
            setUser(null);
            setUserProfile(null);
          } else if (!isMaint) {
            setMaintenanceMessage(null);
          }
        }
      },
      (err) => console.log("System status listener delayed:", err)
    );

    return () => unsubscribe();
  }, [user, userProfile]);

  // 4. Inactivity Auto-Logout Monitor
  useEffect(() => {
    if (!isLoggedIn || !systemStatus?.sessionTimeoutEnabled) return;

    let idleTimer: NodeJS.Timeout | null = null;
    const durationMins = systemStatus.sessionTimeoutDuration || 30;
    const timeoutMs = durationMins * 60 * 1000;

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(async () => {
        console.warn("Security session expired due to user inactivity.");
        await fbSignOut(auth);
        setUser(null);
        setUserProfile(null);
        setShowLoginModal(true);
      }, timeoutMs);
    };

    const events = ["mousedown", "mousemove", "keypress", "scroll", "touchstart"];
    events.forEach((evt) => window.addEventListener(evt, resetIdleTimer, { passive: true }));
    resetIdleTimer();

    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      events.forEach((evt) => window.removeEventListener(evt, resetIdleTimer));
    };
  }, [isLoggedIn, systemStatus]);

  // 5. Login function with Tier Validation & 5-Attempt Security Lock
  const loginWithRole = async (requestedRole: UserRole, emailOrId: string, pass: string) => {
    let cleanEmail = emailOrId.trim().toLowerCase();

    // If identifier doesn't contain '@', resolve by dispensaryId or agentId from Firestore
    if (!cleanEmail.includes("@")) {
      try {
        const qDisp = query(collection(db, "users"), where("dispensaryId", "==", emailOrId.trim()));
        const snapDisp = await getDocs(qDisp);
        if (!snapDisp.empty) {
          const docData = snapDisp.docs[0].data();
          if (docData?.email) {
            cleanEmail = docData.email.toLowerCase().trim();
          }
        } else {
          const qAgent = query(collection(db, "users"), where("agentId", "==", emailOrId.trim()));
          const snapAgent = await getDocs(qAgent);
          if (!snapAgent.empty) {
            const docData = snapAgent.docs[0].data();
            if (docData?.email) {
              cleanEmail = docData.email.toLowerCase().trim();
            }
          } else {
            // Also check direct document in dispensaries collection if any
            const dispDoc = await getDoc(doc(db, "dispensaries", cleanEmail));
            if (dispDoc.exists() && dispDoc.data()?.email) {
              cleanEmail = dispDoc.data().email.toLowerCase().trim();
            } else {
              cleanEmail = `${cleanEmail}@ekms.in`;
            }
          }
        }
      } catch (e) {
        cleanEmail = `${cleanEmail}@ekms.in`;
      }
    }

    const userDocRef = doc(db, "users", cleanEmail);
    const now = Date.now();

    // Helper to get local lock record
    const getLocalLock = () => {
      try {
        const raw = typeof window !== "undefined" ? localStorage.getItem(`ekms_lock_${cleanEmail}`) : null;
        if (raw) return JSON.parse(raw);
      } catch (e) {}
      return null;
    };

    const setLocalLock = (data: any) => {
      try {
        if (typeof window !== "undefined") {
          localStorage.setItem(`ekms_lock_${cleanEmail}`, JSON.stringify(data));
        }
      } catch (e) {}
    };

    // 1. Check if user account is currently locked (Firestore + API + localStorage)
    let userData: any = null;
    try {
      const lockSnap = await getDoc(doc(db, "security_locks", cleanEmail));
      if (lockSnap.exists()) {
        userData = lockSnap.data();
      } else {
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          userData = userSnap.data();
        }
      }
    } catch (e) {
      console.warn("Firestore pre-login check:", e);
    }

    // Also check server API in case client Firestore was stale
    try {
      const res = await fetch(`/api/auth/security-lock?email=${encodeURIComponent(cleanEmail)}`);
      if (res.ok) {
        const apiData = await res.json();
        if (apiData.isLocked === false && (apiData.failedAttempts === 0 || !apiData.failedAttempts)) {
          userData = { isLocked: false, failedAttempts: 0 };
        } else if (apiData.isLocked) {
          userData = apiData;
        }
      }
    } catch (e) {}

    const localData = getLocalLock();

    // If admin has unlocked in Firestore or API, clear local lock
    if (userData && userData.isLocked === false && (userData.failedAttempts === 0 || !userData.failedAttempts)) {
      setLocalLock({ isLocked: false, failedAttempts: 0, lockedUntil: 0 });
      if (typeof window !== "undefined") {
        localStorage.removeItem(`ekms_lock_${cleanEmail}`);
      }
    }

    // Determine current lock status
    const isLocked =
      userData?.isLocked && (!userData?.lockedUntil || now < userData.lockedUntil)
        ? true
        : userData && userData.isLocked === false
        ? false
        : localData?.isLocked && (!localData?.lockedUntil || now < localData.lockedUntil);

    const lockedUntil = userData?.lockedUntil || localData?.lockedUntil || 0;

    if (isLocked) {
      const hoursRemaining = Math.max(1, Math.ceil((lockedUntil - now) / (3600 * 1000)));
      throw new Error(
        `Account Locked: 5 failed attempts exceeded. Your account is locked for ${hoursRemaining} more hours. Please contact an Administrator to unlock your account.`
      );
    }

    let userCredential;
    try {
      userCredential = await signInWithEmailAndPassword(auth, cleanEmail, pass);
    } catch (authErr: any) {
      // If primary auth failed, check if password was updated by admin in Firestore users collection
      let recovered = false;
      try {
        const uSnap = await getDoc(userDocRef);
        const uData = uSnap.exists() ? uSnap.data() : null;
        if (uData?.password && uData.password === pass) {
          const { getSecondaryAuth } = await import("@/lib/firebase");
          const { createUserWithEmailAndPassword, updatePassword: updateAuthPassword } = await import("firebase/auth");
          const secAuth = getSecondaryAuth();

          // Try 1: Maybe user hasn't been created in Firebase Auth yet
          try {
            await createUserWithEmailAndPassword(secAuth, cleanEmail, pass);
            await secAuth.signOut();
          } catch (createErr: any) {
            // Try 2: If user exists in Auth with older default password, sign in and update
            const defaultPasswords = ["esic123", "ekms123", "password", "123456"];
            for (const candPass of defaultPasswords) {
              try {
                const sCred = await signInWithEmailAndPassword(secAuth, cleanEmail, candPass);
                if (sCred) {
                  await updateAuthPassword(sCred.user, pass);
                  await secAuth.signOut();
                  break;
                }
              } catch (_) {}
            }
          }

          // Try signing in on primary auth with the synced password
          const retryCred = await signInWithEmailAndPassword(auth, cleanEmail, pass).catch(() => null);
          if (retryCred) {
            userCredential = retryCred;
            recovered = true;
          }
        }
      } catch (recoveryErr) {
        console.warn("Admin password recovery notice:", recoveryErr);
      }

      if (!recovered) {
        // Failed login attempt tracking
        const lastFailedTime = userData?.lastFailedAttempt || localData?.lastFailedAttempt || 0;
      const isOlderThan24h = (now - lastFailedTime) > 24 * 3600 * 1000;
      const currentFailed = isOlderThan24h ? 0 : Math.max(userData?.failedAttempts || 0, localData?.failedAttempts || 0);
      const newFailed = currentFailed + 1;
      const remainingAttempts = Math.max(0, 5 - newFailed);

      if (newFailed >= 5) {
        const lockExpiry = now + 24 * 3600 * 1000;
        const lockPayload = {
          email: cleanEmail,
          failedAttempts: 5,
          lastFailedAttempt: now,
          isLocked: true,
          lockedAt: now,
          lockedUntil: lockExpiry,
          lockReason: "5 consecutive failed login attempts",
        };

        setLocalLock(lockPayload);

        // Server API sync + client Firestore sync
        try {
          fetch("/api/auth/security-lock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(lockPayload),
          }).catch(() => {});

          await Promise.allSettled([
            setDoc(doc(db, "security_locks", cleanEmail), lockPayload, { merge: true }),
            setDoc(userDocRef, lockPayload, { merge: true }),
          ]);
        } catch (e) {
          console.warn("Could not write lock state to Firestore:", e);
        }

        throw new Error(
          "Account Locked: 5 failed attempts exceeded. Your account is locked for 24 hours. Please contact an Administrator to unlock your account."
        );
      } else {
        const attemptPayload = {
          email: cleanEmail,
          failedAttempts: newFailed,
          lastFailedAttempt: now,
          isLocked: false,
        };

        setLocalLock(attemptPayload);

        try {
          fetch("/api/auth/security-lock", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(attemptPayload),
          }).catch(() => {});

          await Promise.allSettled([
            setDoc(doc(db, "security_locks", cleanEmail), attemptPayload, { merge: true }),
            setDoc(userDocRef, attemptPayload, { merge: true }),
          ]);
        } catch (e) {
          console.warn("Could not write attempt count to Firestore:", e);
        }

        throw new Error(
          `ID or Password is incorrect. (${remainingAttempts} attempt${remainingAttempts === 1 ? "" : "s"} remaining)`
        );
      }
      }
    }

    if (!userCredential) {
      throw new Error("Authentication failed. Please check your credentials.");
    }

    // Clear local & server lock record on successful sign-in
    setLocalLock({ isLocked: false, failedAttempts: 0, lockedUntil: 0 });
    const currentUser = userCredential.user;
    try {
      const idToken = await currentUser.getIdToken();
      fetch("/api/auth/security-lock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`,
        },
        body: JSON.stringify({ email: cleanEmail, action: "unlock" }),
      }).catch(() => {});

      await Promise.allSettled([
        setDoc(doc(db, "security_locks", cleanEmail), { isLocked: false, failedAttempts: 0, lockedUntil: null }, { merge: true }),
        setDoc(userDocRef, { isLocked: false, failedAttempts: 0, lockedUntil: null }, { merge: true }),
      ]);
    } catch (e) {}

    const profile = await fetchUserProfile(currentUser);
    const actualRole: UserRole = profile?.role || "Agent";

    // Maintenance Check
    if (systemStatus?.maintenanceMode && actualRole !== "Master Admin") {
      await fbSignOut(auth);
      throw new Error(
        systemStatus.maintenanceMessage ||
          "The system is currently undergoing maintenance. Please try again later."
      );
    }

    // Role Validation Check
    if (requestedRole === "Master Admin" && actualRole !== "Master Admin") {
      await fbSignOut(auth);
      throw new Error("Access Denied: You do not have Master Admin permissions.");
    }
    if (requestedRole === "Admin" && actualRole !== "Admin" && actualRole !== "Master Admin") {
      await fbSignOut(auth);
      throw new Error("Access Denied: You do not have Admin permissions.");
    }
    const isActualDispensary = actualRole === "Dispensary Staff" || actualRole === "Dispensary";
    const isRequestedDispensary = requestedRole === "Dispensary Staff" || requestedRole === "Dispensary";

    if (isRequestedDispensary && !isActualDispensary) {
      await fbSignOut(auth);
      throw new Error("Access Denied: This account is not registered as Dispensary Staff.");
    }
    if (requestedRole === "Agent" && isActualDispensary) {
      await fbSignOut(auth);
      throw new Error("Access Denied: Dispensary Staff must sign in using the Dispensary Staff option.");
    }
    if (isActualDispensary && profile?.status === "inactive") {
      await fbSignOut(auth);
      throw new Error("Account Deactivated: This dispensary account has been deactivated. Please contact an administrator.");
    }

    // Record login session ONLY when user logs in via the login window/form & reset failed counter
    try {
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const docId = `${cleanEmail}_${today}`;
      const userName = profile?.displayName || profile?.name || currentUser.displayName || cleanEmail.split("@")[0];

      const snap = await getDoc(doc(logsDb, "daily_activity", docId));
      if (!snap.exists()) {
        await setDoc(doc(logsDb, "daily_activity", docId), {
          email: cleanEmail,
          name: userName,
          date: today,
          loginTime: now,
          firstLogin: now,
          lastActive: now,
          loginCount: 1,
          totalSeconds: 0,
          pageVisits: {},
          timelineEvents: [],
        });
      } else {
        await updateDoc(doc(logsDb, "daily_activity", docId), {
          name: userName,
          lastActive: now,
          loginTime: now,
          loginCount: increment(1),
        });
      }

      // Also log into userActivityLogs collection for global system logs
      const sessionNum = snap.exists() ? (snap.data()?.loginCount || 0) + 1 : 1;
      logUserActivity(cleanEmail, {
        desc: `Logged in to EKMS Portal (Session #${sessionNum})`,
        type: "auth",
        color: "emerald",
        icon: "LogIn",
      });

      await setDoc(
        userDocRef,
        {
          failedAttempts: 0,
          isLocked: false,
          lockedUntil: null,
          lockReason: null,
          lastLogin: now,
          lastActive: now,
          isOnline: true,
        },
        { merge: true }
      );
    } catch (err) {
      console.error("Login session tracking error:", err);
    }
  };

  const logout = async () => {
    try {
      if (user?.email) {
        const email = user.email.toLowerCase();
        const now = Date.now();
        const d = new Date();
        const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const docId = `${email}_${today}`;
        
        try {
          await updateDoc(doc(logsDb, "daily_activity", docId), {
            logoutTime: now,
            lastActive: now,
          });
        } catch {
          await setDoc(
            doc(logsDb, "daily_activity", docId),
            {
              email,
              logoutTime: now,
              lastActive: now,
            },
            { merge: true }
          );
        }

        // Also log logout event to userActivityLogs in logsDb
        logUserActivity(email, {
          desc: "User logged out of session",
          type: "auth",
          color: "slate",
          icon: "LogOut",
        });

        await setDoc(
          doc(db, "users", email),
          {
            lastLogout: now,
            isOnline: false,
          },
          { merge: true }
        );
      }
    } catch (e) {
      console.error("Logout recording error:", e);
    }
    await fbSignOut(auth);
    setUser(null);
    setUserProfile(null);
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("ekms_active_agent");
        sessionStorage.removeItem("ekms_active_agent");
        localStorage.removeItem("ekms_auth_agent");
        localStorage.removeItem("crm_user_profile");
      } catch (e) {}
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        role,
        isLoggedIn,
        isAdmin,
        isMasterAdmin,
        loading,
        loginWithRole,
        logout,
        refreshProfile,
        updateProfileData,
        systemStatus,
        maintenanceMessage,
        showLoginModal,
        setShowLoginModal,
        openLoginModal,
        closeLoginModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
