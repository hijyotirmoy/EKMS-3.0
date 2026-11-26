import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

// ==============================================================================
// 1. PRIMARY FIREBASE PROJECT (ekms-app)
// Core Services: Authentication, User Profiles, Knowledge Q&A, Facilities,
// Doubts Community Forum, Files & Documents Library, Training & Quizzes
// ==============================================================================
const BUILD_SAFE_API_KEY = "AIzaSyBuildSafePlaceholderKey000000000";

export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || BUILD_SAFE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "ekms-app.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ekms-app",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "ekms-app.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:1234567890:web:abcdef",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "",
};

// ==============================================================================
// 2. DEDICATED APPOINTMENT & BOOKINGS FIREBASE PROJECT (ekmsbooking)
// Services: Insured Person (IP) Verification, Dispensary Slot Quotas,
// Doctor Duty Rosters, Verification Appointment Schedules
// ==============================================================================
export const bookingFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_API_KEY || BUILD_SAFE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_AUTH_DOMAIN || "ekmsbooking.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_PROJECT_ID || "ekmsbooking",
  storageBucket: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_STORAGE_BUCKET || "ekmsbooking.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_APP_ID || "1:1234567890:web:abcdef",
  measurementId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_MEASUREMENT_ID || "",
};

// ==============================================================================
// 3. DEDICATED LOGS & NOTIFICATIONS FIREBASE PROJECT (ekms-logs)
// Services: System Audit Trails, Push Notifications, Broadcast Announcements,
// User Activity Tracking, Security Logs
// ==============================================================================
export const logsFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_LOGS_FIREBASE_API_KEY || BUILD_SAFE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_LOGS_FIREBASE_AUTH_DOMAIN || "ekms-logs.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_PROJECT_ID || "ekms-logs",
  storageBucket: process.env.NEXT_PUBLIC_LOGS_FIREBASE_STORAGE_BUCKET || "ekms-logs.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_APP_ID || "1:1234567890:web:abcdef",
  measurementId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_MEASUREMENT_ID || "",
};

// ==============================================================================
// 4. DEDICATED TRIAGE CASES, SETTINGS & DHWANI CRM SYNC (triage-cases-settings)
// Services: Triage Clinical Case Logs, Patient Case History, Intake Records,
// Dhwani CRM Live Intake Sync, Telemetry, Audit Records, 7-Day Holding Vault
// ==============================================================================
export const casesSettingsFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_API_KEY || BUILD_SAFE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_AUTH_DOMAIN || "triage-cases-settings.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_PROJECT_ID || "triage-cases-settings",
  storageBucket: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_STORAGE_BUCKET || "triage-cases-settings.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_APP_ID || "1:1234567890:web:abcdef",
  measurementId: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_MEASUREMENT_ID || "",
};

// ==============================================================================
// 5. AUXILIARY TRIAGE SESSIONS FIREBASE PROJECT (ekms-triage-main)
// Services: Triage Active Sessions, Dispatches & Secondary Backup Store
// ==============================================================================
export const triageMainFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_API_KEY || BUILD_SAFE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_AUTH_DOMAIN || "ekms-triage-main.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_PROJECT_ID || "ekms-triage-main",
  storageBucket: process.env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_STORAGE_BUCKET || "ekms-triage-main.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_MESSAGING_SENDER_ID || "1234567890",
  appId: process.env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_APP_ID || "1:1234567890:web:abcdef",
  measurementId: process.env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_MEASUREMENT_ID || "",
};

// ------------------------------------------------------------------------------
// Instance Initializations with Persistent IndexedDB Client Caching
// ------------------------------------------------------------------------------

/**
 * Smart Local Cache Selector:
 * In browser: Activates persistentLocalCache with persistentMultipleTabManager (IndexedDB).
 * All documents are cached on disk, reducing Firebase network reads by up to 90% across page loads and multiple tabs.
 * In server / SSR: Gracefully falls back to memoryLocalCache() to avoid Node.js runtime errors.
 */
const createOptimizedFirestoreCache = () => {
  if (typeof window !== "undefined") {
    try {
      return persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      });
    } catch (e) {
      console.warn("Persistent IndexedDB fallback to memory:", e);
      return memoryLocalCache();
    }
  }
  return memoryLocalCache();
};

// 1. Core EKMS App (ekms-app)
export const app =
  getApps().find((a) => a.name === "[DEFAULT]") ||
  (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig));
export const auth = (() => {
  try {
    return getAuth(app);
  } catch (e) {
    return null as any;
  }
})();
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: createOptimizedFirestoreCache(),
    });
  } catch (e) {
    return getFirestore(app);
  }
})();
export const storage = getStorage(app);

// 2. Primary Dedicated Booking App (ekmsbooking)
export const bookingApp =
  getApps().find((a) => a.name === "BookingApp") ||
  initializeApp(bookingFirebaseConfig, "BookingApp");
export const bookingDb = (() => {
  try {
    return initializeFirestore(bookingApp, {
      localCache: createOptimizedFirestoreCache(),
    });
  } catch (e) {
    return getFirestore(bookingApp);
  }
})();

// 3. Dedicated Logs & Notifications App (ekms-logs)
export const logsApp =
  getApps().find((a) => a.name === "LogsApp") ||
  initializeApp(logsFirebaseConfig, "LogsApp");
export const logsDb = (() => {
  try {
    return initializeFirestore(logsApp, {
      localCache: createOptimizedFirestoreCache(),
    });
  } catch (e) {
    return getFirestore(logsApp);
  }
})();

// 4. Dedicated Triage Cases, Settings & Dhwani CRM App (triage-cases-settings)
export const casesSettingsApp =
  getApps().find((a) => a.name === "CasesSettingsApp") ||
  initializeApp(casesSettingsFirebaseConfig, "CasesSettingsApp");
export const casesSettingsDb = (() => {
  try {
    return initializeFirestore(casesSettingsApp, {
      localCache: createOptimizedFirestoreCache(),
    });
  } catch (e) {
    return getFirestore(casesSettingsApp);
  }
})();

// 5. Auxiliary Triage Main App (ekms-triage-main)
export const triageMainApp =
  getApps().find((a) => a.name === "TriageMainApp") ||
  initializeApp(triageMainFirebaseConfig, "TriageMainApp");
export const triageMainDb = (() => {
  try {
    return initializeFirestore(triageMainApp, {
      localCache: createOptimizedFirestoreCache(),
    });
  } catch (e) {
    return getFirestore(triageMainApp);
  }
})();

// Secondary auth for non-destructive user account creations
export const getSecondaryAuth = () => {
  try {
    const secondaryApp =
      getApps().find((a) => a.name === "SecondaryApp") ||
      initializeApp(firebaseConfig, "SecondaryApp");
    return getAuth(secondaryApp);
  } catch (e) {
    return null as any;
  }
};

// ------------------------------------------------------------------------------
// Secondary Database Failover & Unified Getters
// ------------------------------------------------------------------------------

/**
 * Global Failover State for Booking Operations:
 * If bookingDb exceeds 50k reads or throws 'resource-exhausted',
 * the failover triggers automatically to casesSettingsDb (or backup).
 */
let isBookingFailoverActive = false;

export const setBookingFailoverActive = (active: boolean) => {
  isBookingFailoverActive = active;
  if (typeof window !== "undefined") {
    try {
      if (active) {
        sessionStorage.setItem("ekms_booking_failover_active", "true");
        window.dispatchEvent(new CustomEvent("ekms-booking-failover-changed", { detail: { active: true } }));
      } else {
        sessionStorage.removeItem("ekms_booking_failover_active");
      }
    } catch (_) {}
  }
};

export const getIsBookingFailoverActive = (): boolean => {
  if (isBookingFailoverActive) return true;
  if (typeof window !== "undefined") {
    try {
      return sessionStorage.getItem("ekms_booking_failover_active") === "true";
    } catch (_) {}
  }
  return false;
};

/**
 * Returns the active booking Firestore database.
 * If failover is triggered (e.g. 50k reads crossed), seamlessly returns secondary casesSettingsDb.
 */
export const getActiveBookingDb = () => {
  if (getIsBookingFailoverActive()) {
    return casesSettingsDb;
  }
  return bookingDb;
};

// Secondary booking database reference (Dedicated fallback)
export const getSecondaryBookingDb = () => casesSettingsDb;

// Unified Getters
export const getFirestoreDb = () => db;
export const getBookingDb = () => getActiveBookingDb();
export const getCasesSettingsDb = () => casesSettingsDb;
export const getCrmFirestoreDb = () => casesSettingsDb;
export const getTriageMainDb = () => triageMainDb;
export const getEkmsFirestoreDb = () => db;
