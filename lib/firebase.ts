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

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBv6Ph505FdF4rJytdkIG3KfNfs__ivuRI",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "ekms-app.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "ekms-app",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "ekms-app.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "324461962901",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:324461962901:web:0fa97038ff51a620bc1d9c",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || "G-HQQSYC3LC4",
};

const bookingFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_API_KEY || "AIzaSyAog_qZmJzft8gM-UqoNsnlSlleFB6v33g",
  authDomain: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_AUTH_DOMAIN || "ekmsbooking.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_PROJECT_ID || "ekmsbooking",
  storageBucket: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_STORAGE_BUCKET || "ekmsbooking.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_MESSAGING_SENDER_ID || "510397595704",
  appId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_APP_ID || "1:510397595704:web:86d85e96f1ef799779a6cd",
  measurementId: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_MEASUREMENT_ID || "G-S4K53XNQ92",
};

const logsFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_LOGS_FIREBASE_API_KEY || "AIzaSyAVgwUI96k1zwFRqOeienKiORcNr4MvzXI",
  authDomain: process.env.NEXT_PUBLIC_LOGS_FIREBASE_AUTH_DOMAIN || "ekms-logs.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_PROJECT_ID || "ekms-logs",
  storageBucket: process.env.NEXT_PUBLIC_LOGS_FIREBASE_STORAGE_BUCKET || "ekms-logs.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_MESSAGING_SENDER_ID || "329565552036",
  appId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_APP_ID || "1:329565552036:web:15fd1b8e3a3a420580d531",
  measurementId: process.env.NEXT_PUBLIC_LOGS_FIREBASE_MEASUREMENT_ID || "G-SW0HRQM9ZQ",
};

// Initialize or reuse main Firebase App
export const app = getApps().find((a) => a.name === "[DEFAULT]") || (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig));
export const auth = getAuth(app);

// Use persistentLocalCache with persistentMultipleTabManager for modern zero-warning multi-tab persistence
export const db = (() => {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      experimentalAutoDetectLongPolling: true,
    });
  } catch (e) {
    return getFirestore(app);
  }
})();

export const storage = getStorage(app);

// Dedicated Booking Firebase App ("ekmsbooking") with memory cache to avoid multi-app IndexedDB collision
export const bookingApp = getApps().find((a) => a.name === "BookingApp") || initializeApp(bookingFirebaseConfig, "BookingApp");
export const bookingDb = (() => {
  try {
    return initializeFirestore(bookingApp, {
      localCache: memoryLocalCache(),
    });
  } catch (e) {
    return getFirestore(bookingApp);
  }
})();

// Dedicated Logs Firebase App ("ekms-logs") with memory cache to avoid multi-app IndexedDB collision
export const logsApp = getApps().find((a) => a.name === "LogsApp") || initializeApp(logsFirebaseConfig, "LogsApp");
export const logsDb = (() => {
  try {
    return initializeFirestore(logsApp, {
      localCache: memoryLocalCache(),
    });
  } catch (e) {
    return getFirestore(logsApp);
  }
})();

// Secondary app for admin creating new user profiles without signing out current admin
export const getSecondaryAuth = () => {
  const secondaryApp = getApps().find((a) => a.name === "SecondaryApp") || initializeApp(firebaseConfig, "SecondaryApp");
  return getAuth(secondaryApp);
};
