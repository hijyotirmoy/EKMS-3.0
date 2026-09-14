import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore, initializeFirestore } from "firebase/firestore";
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

// Initialize or reuse main Firebase App
export const app = getApps().find((a) => a.name === "[DEFAULT]") || (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig));
export const auth = getAuth(app);

// Use initializeFirestore with experimentalAutoDetectLongPolling: true to fix net::ERR_QUIC_PROTOCOL_ERROR.QUIC_TOO_MANY_RTOS
export const db = (() => {
  try {
    return initializeFirestore(app, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch (e) {
    return getFirestore(app);
  }
})();

export const storage = getStorage(app);

// Dedicated Booking Firebase App ("ekmsbooking") for storing all booking records separately
export const bookingApp = getApps().find((a) => a.name === "BookingApp") || initializeApp(bookingFirebaseConfig, "BookingApp");
export const bookingDb = (() => {
  try {
    return initializeFirestore(bookingApp, {
      experimentalAutoDetectLongPolling: true,
    });
  } catch (e) {
    return getFirestore(bookingApp);
  }
})();

// Secondary app for admin creating new user profiles without signing out current admin
export const getSecondaryAuth = () => {
  const secondaryApp = getApps().find((a) => a.name === "SecondaryApp") || initializeApp(firebaseConfig, "SecondaryApp");
  return getAuth(secondaryApp);
};
