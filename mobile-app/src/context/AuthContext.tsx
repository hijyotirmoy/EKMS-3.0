import React, { createContext, useContext, useEffect, useState } from "react";
import {
  User,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import { doc, getDoc, onSnapshot, setDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { UserProfile, UserRole } from "../lib/types";

interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
  isMasterAdmin: boolean;
  loading: boolean;
  showLoginModal: boolean;
  initialSelectedRole: UserRole | null;
  openLoginModal: (role?: UserRole) => void;
  closeLoginModal: () => void;
  loginWithRole: (requestedRole: UserRole, email: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  userProfile: null,
  isLoggedIn: false,
  isAdmin: false,
  isMasterAdmin: false,
  loading: true,
  showLoginModal: false,
  initialSelectedRole: null,
  openLoginModal: () => {},
  closeLoginModal: () => {},
  loginWithRole: async () => ({ success: false }),
  logout: async () => {},
  refreshProfile: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(() => {
    try {
      const cached = localStorage.getItem("ekms_mobile_cached_profile");
      return cached ? JSON.parse(cached) : null;
    } catch (e) {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [initialSelectedRole, setInitialSelectedRole] = useState<UserRole | null>(null);

  const openLoginModal = (role?: UserRole) => {
    setInitialSelectedRole(role || null);
    setShowLoginModal(true);
  };

  const closeLoginModal = () => {
    setShowLoginModal(false);
    setInitialSelectedRole(null);
  };

  const fetchProfile = async (email: string) => {
    try {
      const snap = await getDoc(doc(db, "users", email.toLowerCase().trim()));
      if (snap.exists()) {
        const p = { id: snap.id, ...snap.data() } as UserProfile;
        setUserProfile(p);
        localStorage.setItem("ekms_mobile_cached_profile", JSON.stringify(p));
        return p;
      }
    } catch (e) {
      console.warn("Failed to fetch user profile:", e);
    }
    return null;
  };

  useEffect(() => {
    let unsubDoc = () => {};

    const unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser?.email) {
        const cleanEmail = currentUser.email.toLowerCase().trim();
        await fetchProfile(cleanEmail);

        // Real-time listener for profile updates
        unsubDoc = onSnapshot(doc(db, "users", cleanEmail), (snap) => {
          if (snap.exists()) {
            const p = { id: snap.id, ...snap.data() } as UserProfile;
            setUserProfile(p);
            localStorage.setItem("ekms_mobile_cached_profile", JSON.stringify(p));
          }
        });
      } else {
        setUserProfile(null);
        localStorage.removeItem("ekms_mobile_cached_profile");
      }
      setLoading(false);
    });

    return () => {
      unsubAuth();
      unsubDoc();
    };
  }, []);

  const loginWithRole = async (requestedRole: UserRole, email: string, pass: string) => {
    const cleanEmail = email.trim().toLowerCase();
    try {
      // 1. Authenticate with Firebase Auth
      const res = await signInWithEmailAndPassword(auth, cleanEmail, pass);
      const currentUser = res.user;

      if (!currentUser?.email) {
        throw new Error("Login failed. No email associated with account.");
      }

      // 2. Fetch User Profile
      let profile = await fetchProfile(cleanEmail);
      let actualRole: UserRole = profile?.role || "Agent";

      // If no profile document exists, attempt to check if master or create agent profile
      if (!profile) {
        const newProfile: UserProfile = {
          email: cleanEmail,
          displayName: cleanEmail.split("@")[0],
          role: requestedRole,
          createdAt: Date.now(),
        };
        try {
          await setDoc(doc(db, "users", cleanEmail), newProfile, { merge: true });
          profile = newProfile;
          actualRole = requestedRole;
          setUserProfile(newProfile);
        } catch (e) {}
      }

      // 3. Role Validation Check
      if (requestedRole === "Master Admin" && actualRole !== "Master Admin") {
        await fbSignOut(auth);
        setUser(null);
        setUserProfile(null);
        return {
          success: false,
          error: "Access Denied: Your account does not have Master Admin permissions.",
        };
      }

      if (requestedRole === "Admin" && actualRole !== "Admin" && actualRole !== "Master Admin") {
        await fbSignOut(auth);
        setUser(null);
        setUserProfile(null);
        return {
          success: false,
          error: "Access Denied: Your account does not have Admin permissions.",
        };
      }

      return { success: true };
    } catch (e: any) {
      let msg = e.message?.replace("Firebase:", "").trim() || "Login failed.";
      if (e.code === "auth/user-not-found" || e.code === "auth/wrong-password" || e.code === "auth/invalid-credential") {
        msg = "Incorrect email or password. Please verify your credentials.";
      } else if (e.code === "auth/too-many-requests") {
        msg = "Account access temporarily restricted due to multiple failed attempts. Try again later.";
      }
      return { success: false, error: msg };
    }
  };

  const logout = async () => {
    try {
      await fbSignOut(auth);
      setUser(null);
      setUserProfile(null);
      localStorage.removeItem("ekms_mobile_cached_profile");
    } catch (e) {
      console.error("Logout error:", e);
    }
  };

  const refreshProfile = async () => {
    if (user?.email) {
      await fetchProfile(user.email);
    }
  };

  const role = (userProfile?.role || "").toLowerCase().trim();
  const isAdmin = role.includes("admin") || role.includes("master");
  const isMasterAdmin = role.includes("master");

  return (
    <AuthContext.Provider
      value={{
        user,
        userProfile,
        isLoggedIn: !!user,
        isAdmin,
        isMasterAdmin,
        loading,
        showLoginModal,
        initialSelectedRole,
        openLoginModal,
        closeLoginModal,
        loginWithRole,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
