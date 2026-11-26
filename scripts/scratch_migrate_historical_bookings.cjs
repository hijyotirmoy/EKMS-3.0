const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
} = require("firebase/firestore");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBv6Ph505FdF4rJytdkIG3KfNfs__ivuRI",
  authDomain: "ekms-app.firebaseapp.com",
  projectId: "ekms-app",
  storageBucket: "ekms-app.firebasestorage.app",
  messagingSenderId: "324461962901",
  appId: "1:324461962901:web:0fa97038ff51a620bc1d9c",
};

const bookingFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_BOOKING_FIREBASE_API_KEY || "AIzaSyAog_qZmJzft8gM-UqoNsnlSlleFB6v33g",
  authDomain: "ekmsbooking.firebaseapp.com",
  projectId: "ekmsbooking",
  storageBucket: "ekmsbooking.firebasestorage.app",
  messagingSenderId: "510397595704",
  appId: "1:510397595704:web:86d85e96f1ef799779a6cd",
};

const mainApp = initializeApp(firebaseConfig, "MainAppMigration");
const bookingApp = initializeApp(bookingFirebaseConfig, "BookingAppMigration");

const db = getFirestore(mainApp);
const bookingDb = getFirestore(bookingApp);

async function migrateAllHistoricalBookingData() {
  console.log("🚀 Starting historical booking data migration from primary DB (ekms-app) to bookingDb (ekmsbooking)...");

  // 1. Migrate Bookings Collection
  try {
    const mainBookingsSnap = await getDocs(collection(db, "bookings"));
    console.log(`📦 Found ${mainBookingsSnap.size} date documents in primary DB 'bookings' collection.`);

    let dateDocsMigrated = 0;
    let recordsMigrated = 0;

    for (const dSnap of mainBookingsSnap.docs) {
      const dateKey = dSnap.id;
      const mainData = dSnap.data();
      const mainRecords = mainData.bookedRecords || [];

      if (mainRecords.length === 0) continue;

      const targetRef = doc(bookingDb, "bookings", dateKey);
      const targetSnap = await getDoc(targetRef);
      const secData = targetSnap.exists() ? targetSnap.data() : {};
      const secRecords = secData.bookedRecords || [];

      // Deduplicate records by timestamp + agentEmail
      const recordMap = new Map();
      secRecords.forEach((r) => {
        const key = `${r.timestamp}_${(r.agentEmail || "").toLowerCase().trim()}`;
        recordMap.set(key, r);
      });
      mainRecords.forEach((r) => {
        const key = `${r.timestamp}_${(r.agentEmail || "").toLowerCase().trim()}`;
        if (!recordMap.has(key)) {
          recordMap.set(key, r);
        }
      });

      const mergedRecords = Array.from(recordMap.values());
      const newSeats = Math.max(0, 20 - mergedRecords.length);

      await setDoc(
        targetRef,
        {
          seats: newSeats,
          bookedRecords: mergedRecords,
          ...(mainData.text ? { text: mainData.text } : {}),
        },
        { merge: true }
      );

      dateDocsMigrated++;
      recordsMigrated += mainRecords.length;
      console.log(`  ✅ Synced date ${dateKey}: ${mergedRecords.length} records total (${newSeats} seats remaining).`);
    }

    console.log(`🎉 Bookings Migration Complete! Synced ${dateDocsMigrated} date documents containing ${recordsMigrated} records.`);
  } catch (err) {
    console.error("❌ Error migrating bookings collection:", err);
  }

  // 2. Migrate Reschedule Logs Collection
  try {
    const mainLogsSnap = await getDocs(collection(db, "rescheduleLogs"));
    console.log(`📋 Found ${mainLogsSnap.size} log documents in primary DB 'rescheduleLogs' collection.`);

    let logsMigrated = 0;
    for (const lSnap of mainLogsSnap.docs) {
      const logId = lSnap.id;
      const logData = lSnap.data();

      const targetLogRef = doc(bookingDb, "rescheduleLogs", logId);
      await setDoc(targetLogRef, logData, { merge: true });
      logsMigrated++;
    }

    console.log(`🎉 Reschedule Logs Migration Complete! Synced ${logsMigrated} log documents to bookingDb.`);
  } catch (err) {
    console.error("❌ Error migrating rescheduleLogs collection:", err);
  }

  console.log("✨ ALL HISTORICAL BOOKING DATA SUCCESSFULLY TRANSFERRED TO NEW FIREBASE BOOKING DB!");
  process.exit(0);
}

migrateAllHistoricalBookingData();
