import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyBv6Ph505FdF4rJytdkIG3KfNfs__ivuRI",
  authDomain: "ekms-app.firebaseapp.com",
  projectId: "ekms-app",
  storageBucket: "ekms-app.firebasestorage.app",
  messagingSenderId: "324461962901",
  appId: "1:324461962901:web:0fa97038ff51a620bc1d9c",
  measurementId: "G-HQQSYC3LC4",
};

const bookingFirebaseConfig = {
  apiKey: "AIzaSyAog_qZmJzft8gM-UqoNsnlSlleFB6v33g",
  authDomain: "ekmsbooking.firebaseapp.com",
  projectId: "ekmsbooking",
  storageBucket: "ekmsbooking.firebasestorage.app",
  messagingSenderId: "510397595704",
  appId: "1:510397595704:web:86d85e96f1ef799779a6cd",
  measurementId: "G-S4K53XNQ92",
};

const logsFirebaseConfig = {
  apiKey: "AIzaSyAVgwUI96k1zwFRqOeienKiORcNr4MvzXI",
  authDomain: "ekms-logs.firebaseapp.com",
  projectId: "ekms-logs",
  storageBucket: "ekms-logs.firebasestorage.app",
  messagingSenderId: "329565552036",
  appId: "1:329565552036:web:15fd1b8e3a3a420580d531",
  measurementId: "G-SW0HRQM9ZQ",
};

// Initialize main Firebase App
export const app = getApps().find((a) => a.name === "[DEFAULT]") || (getApps().length > 0 ? getApp() : initializeApp(firebaseConfig));
export const auth = getAuth(app);

// Use persistentLocalCache for offline support on mobile devices
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

// Dedicated Booking Firebase App ("ekmsbooking")
export const bookingApp = getApps().find((a) => a.name === "BookingApp") || initializeApp(bookingFirebaseConfig, "BookingApp");
export const bookingDb = (() => {
  try {
    return initializeFirestore(bookingApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      experimentalAutoDetectLongPolling: true,
    });
  } catch (e) {
    return getFirestore(bookingApp);
  }
})();

// Dedicated Logs Firebase App ("ekms-logs") for notifications
export const logsApp = getApps().find((a) => a.name === "LogsApp") || initializeApp(logsFirebaseConfig, "LogsApp");
export const logsDb = (() => {
  try {
    return initializeFirestore(logsApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      experimentalAutoDetectLongPolling: true,
    });
  } catch (e) {
    return getFirestore(logsApp);
  }
})();
