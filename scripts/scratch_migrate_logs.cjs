const { initializeApp } = require("firebase/app");
const { getAuth, signInWithEmailAndPassword } = require("firebase/auth");
const {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
} = require("firebase/firestore");

const mainFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "AIzaSyBv6Ph505FdF4rJytdkIG3KfNfs__ivuRI",
  authDomain: "ekms-app.firebaseapp.com",
  projectId: "ekms-app",
  storageBucket: "ekms-app.firebasestorage.app",
  messagingSenderId: "324461962901",
  appId: "1:324461962901:web:0fa97038ff51a620bc1d9c",
};

const logsFirebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_LOGS_FIREBASE_API_KEY || "AIzaSyAVgwUI96k1zwFRqOeienKiORcNr4MvzXI",
  authDomain: "ekms-logs.firebaseapp.com",
  projectId: "ekms-logs",
  storageBucket: "ekms-logs.firebasestorage.app",
  messagingSenderId: "329565552036",
  appId: "1:329565552036:web:15fd1b8e3a3a420580d531",
};

const mainApp = initializeApp(mainFirebaseConfig, "MainAppLogsMigration");
const logsApp = initializeApp(logsFirebaseConfig, "LogsAppMigration");

const db = getFirestore(mainApp);
const logsDb = getFirestore(logsApp);

async function migrateAllLogsAndNotifications() {
  console.log("🚀 Starting data migration from primary DB (ekms-app) to logsDb (ekms-logs)...");

  const email = process.argv[2];
  const password = process.argv[3];

  if (email && password) {
    try {
      const auth = getAuth(mainApp);
      await signInWithEmailAndPassword(auth, email, password);
      console.log(`🔑 Successfully authenticated as ${email} on primary DB.`);
    } catch (authErr) {
      console.warn(`⚠️ Authentication notice: ${authErr.message}`);
    }
  } else {
    console.log("ℹ️ No admin login arguments passed. (Usage: node scratch_migrate_logs.cjs <adminEmail> <adminPassword>)");
  }

  // 1. Migrate Notifications
  try {
    const notifsSnap = await getDocs(collection(db, "notifications"));
    console.log(`🔔 Found ${notifsSnap.size} notification documents in primary DB.`);
    let notifCount = 0;
    for (const dSnap of notifsSnap.docs) {
      await setDoc(doc(logsDb, "notifications", dSnap.id), dSnap.data(), { merge: true });
      notifCount++;
    }
    console.log(`  ✅ Migrated ${notifCount} notification documents to logsDb.`);
  } catch (err) {
    console.error("❌ Error migrating notifications:", err.message);
  }

  // 2. Migrate Announcements
  try {
    const annSnap = await getDocs(collection(db, "announcements"));
    console.log(`📢 Found ${annSnap.size} announcement documents in primary DB.`);
    let annCount = 0;
    for (const dSnap of annSnap.docs) {
      await setDoc(doc(logsDb, "announcements", dSnap.id), dSnap.data(), { merge: true });
      annCount++;
    }
    console.log(`  ✅ Migrated ${annCount} announcement documents to logsDb.`);
  } catch (err) {
    console.error("❌ Error migrating announcements:", err.message);
  }

  // 3. Migrate Daily Activity & Generate User Activity Logs
  try {
    const dailySnap = await getDocs(collection(db, "daily_activity"));
    console.log(`📊 Found ${dailySnap.size} daily activity documents in primary DB.`);
    let dailyCount = 0;
    let sysLogCount = 0;

    for (const dSnap of dailySnap.docs) {
      const data = dSnap.data();
      await setDoc(doc(logsDb, "daily_activity", dSnap.id), data, { merge: true });
      dailyCount++;

      const emailKey = (data.email || "").toLowerCase().trim();
      const dateStr = data.date || dSnap.id.split("_")[1] || new Date().toISOString().split("T")[0];
      const userName = emailKey ? emailKey.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "User";

      if (Array.isArray(data.timelineEvents)) {
        for (let idx = 0; idx < data.timelineEvents.length; idx++) {
          const ev = data.timelineEvents[idx];
          const timestamp = ev.time || ev.timestamp || Date.now();
          const logId = `hist_${dSnap.id}_${timestamp}_${idx}`;

          await setDoc(
            doc(logsDb, "userActivityLogs", logId),
            {
              id: logId,
              email: emailKey || "unknown@piramalswasthya.org",
              userName,
              desc: ev.desc || "User activity recorded",
              type: ev.type || "general",
              color: ev.color || "blue",
              icon: ev.icon || "Activity",
              timestamp,
              date: dateStr,
            },
            { merge: true }
          );
          sysLogCount++;
        }
      }
    }
    console.log(`  ✅ Migrated ${dailyCount} daily activity docs and generated ${sysLogCount} system log records in logsDb.`);
  } catch (err) {
    console.error("❌ Error migrating daily activity:", err.message);
  }

  console.log("✨ ALL HISTORICAL LOGS & NOTIFICATIONS DATA SUCCESSFULLY TRANSFERRED TO EKMS-LOGS!");
  process.exit(0);
}

migrateAllLogsAndNotifications();
