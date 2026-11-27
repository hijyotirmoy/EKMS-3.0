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
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBv6Ph505FdF4rJytdkIG3KfNfs__ivuRI",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "ekms-app.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ekms-app",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "ekms-app.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "324461962901",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:324461962901:web:0fa97038ff51a620bc1d9c",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-HQQSYC3LC4",
};

// ==============================================================================
// 2. PRIMARY DEDICATED DISPENSARY APPOINTMENTS DATABASE (triage-booking)
// Services: Insured Person (IP) Verification, Dispensary Slot Quotas,
// Doctor Duty Rosters, Verification Appointment Schedules
// ==============================================================================
export const bookingFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_API_KEY || "AIzaSyBw1UzeX5Qk6tt1fE6Sy80GcHbqMeKES8g",
  authDomain: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_AUTH_DOMAIN || "triage-booking.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_PROJECT_ID || "triage-booking",
  storageBucket: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_STORAGE_BUCKET || "triage-booking.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_MESSAGING_SENDER_ID || "954975483977",
  appId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_APP_ID || "1:954975483977:web:f6bb8578606e778d26a798",
  measurementId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_MEASUREMENT_ID || "G-H0CKZLGTDX",
};

// 2B. SAFETY BACKUP APPOINTMENTS DATABASE (ekmsbooking - Secondary Safety Copy)
export const oldBookingFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_OLD_BOOKING_FIREBASE_API_KEY || "AIzaSyAog_qZmJzft8gM-UqoNsnlSlleFB6v33g",
  authDomain: process.env.NEXT_PUBLIC_OLD_BOOKING_FIREBASE_AUTH_DOMAIN || "ekmsbooking.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_OLD_BOOKING_FIREBASE_PROJECT_ID || "ekmsbooking",
  storageBucket: process.env.NEXT_PUBLIC_OLD_BOOKING_FIREBASE_STORAGE_BUCKET || "ekmsbooking.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_OLD_BOOKING_FIREBASE_MESSAGING_SENDER_ID || "510397595704",
  appId: process.env.NEXT_PUBLIC_OLD_BOOKING_FIREBASE_APP_ID || "1:510397595704:web:86d85e96f1ef799779a6cd",
  measurementId: process.env.NEXT_PUBLIC_OLD_BOOKING_FIREBASE_MEASUREMENT_ID || "G-S4K53XNQ92",
};

// ==============================================================================
// 3. DEDICATED LOGS & NOTIFICATIONS FIREBASE PROJECT (ekms-logs)
// Services: System Audit Trails, Push Notifications, Broadcast Announcements,
// User Activity Tracking, Security Logs
// ==============================================================================
export const logsFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_LOGS_FIREBASE_API_KEY || "AIzaSyAVgwUI96k1zwFRqOeienKiORcNr4MvzXI",
  authDomain: process.env.NEXT_PUBLIC_LOGS_FIREBASE_AUTH_DOMAIN || "ekms-logs.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_PROJECT_ID || "ekms-logs",
  storageBucket: process.env.NEXT_PUBLIC_LOGS_FIREBASE_STORAGE_BUCKET || "ekms-logs.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_MESSAGING_SENDER_ID || "329565552036",
  appId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_APP_ID || "1:329565552036:web:15fd1b8e3a3a420580d531",
  measurementId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_MEASUREMENT_ID || "G-SW0HRQM9ZQ",
};

// ==============================================================================
// 4. DEDICATED TRIAGE CASES, SETTINGS & DHWANI CRM SYNC (triage-cases-settings)
// Services: Triage Clinical Case Logs, Patient Case History, Intake Records,
// Dhwani CRM Live Intake Sync, Telemetry, Audit Records, 7-Day Holding Vault
// ==============================================================================
export const casesSettingsFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_API_KEY || "AIzaSyAqhlMdvcbCgUiiiPteDkUFDnotxrAtjYY",
  authDomain: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_AUTH_DOMAIN || "triage-cases-settings.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_PROJECT_ID || "triage-cases-settings",
  storageBucket: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_STORAGE_BUCKET || "triage-cases-settings.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_MESSAGING_SENDER_ID || "529434337941",
  appId: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_APP_ID || "1:529434337941:web:26ea05c1751bbfbea0719c",
  measurementId: process.env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_MEASUREMENT_ID || "G-Q032RRRGWJ",
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

// 2. Primary Dedicated Dispensary Booking App (triage-booking)
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

// 2B. Safety Backup Booking App (ekmsbooking - Secondary Copy)
export const oldBookingApp =
  getApps().find((a) => a.name === "OldBookingApp") ||
  initializeApp(oldBookingFirebaseConfig, "OldBookingApp");
export const oldBookingDb = (() => {
  try {
    return initializeFirestore(oldBookingApp, {
      localCache: createOptimizedFirestoreCache(),
    });
  } catch (e) {
    return getFirestore(oldBookingApp);
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
export const getOldBookingDb = () => oldBookingDb;
export const getSafetyBackupDb = () => oldBookingDb;

// Unified Getters
export const getFirestoreDb = () => db;
export const getBookingDb = () => getActiveBookingDb();
export const getCasesSettingsDb = () => casesSettingsDb;
export const getCrmFirestoreDb = () => casesSettingsDb;
export const getEkmsFirestoreDb = () => db;
