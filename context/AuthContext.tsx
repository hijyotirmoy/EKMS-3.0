"use client";

import React, { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, onAuthStateChanged, signInWithEmailAndPassword, signOut as fbSignOut } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { UserProfile, UserRole, SystemStatus } from "@/lib/types";

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
  const isAdmin = role === "Admin" || role === "Master Admin";

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

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser && currentUser.email) {
        if (unsubProfile) unsubProfile();

        const email = currentUser.email.toLowerCase();
        const userDocRef = doc(db, "users", email);

        unsubProfile = onSnapshot(
          userDocRef,
          (snap) => {
            if (snap.exists()) {
              setUserProfile(snap.data() as UserProfile);
            } else {
              const newProfile: UserProfile = {
                email: email,
                displayName: currentUser.displayName || email.split("@")[0],
                name: currentUser.displayName || email.split("@")[0],
                role: "Agent",
                createdAt: Date.now(),
              };
              setDoc(userDocRef, newProfile, { merge: true });
              setUserProfile(newProfile);
            }
            setLoading(false);
          },
          (err) => {
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
        setLoading(false);
      }
    });

    return () => {
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

  // 5. Login function with Tier Validation
  const loginWithRole = async (requestedRole: UserRole, email: string, pass: string) => {
    const userCredential = await signInWithEmailAndPassword(auth, email, pass);
    const currentUser = userCredential.user;

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
  };

  const logout = async () => {
    await fbSignOut(auth);
    setUser(null);
    setUserProfile(null);
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
