const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc } = require('firebase/firestore');

const envFile = fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf-8');
const env = {};
envFile.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const k = trimmed.substring(0, idx).trim();
      let v = trimmed.substring(idx + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[k] = v;
    }
  }
});

const config = {
  apiKey: env.NEXT_PUBLIC_BOOKING_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_BOOKING_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_BOOKING_FIREBASE_PROJECT_ID,
  storageBucket: env.NEXT_PUBLIC_BOOKING_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_BOOKING_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_BOOKING_FIREBASE_APP_ID
};

console.log('Target Project ID:', config.projectId);
const app = initializeApp(config, 'booking-audit-app');
const db = getFirestore(app);

async function main() {
  const snap = await getDocs(collection(db, 'dispensary_appointments'));
  console.log('Total documents in dispensary_appointments:', snap.docs.length);

  const statusCount = {};
  const items = [];

  snap.docs.forEach(d => {
    const data = d.data();
    statusCount[data.status] = (statusCount[data.status] || 0) + 1;
    items.push({ id: d.id, ...data });
  });

  console.log('Status counts:', statusCount);

  console.log('\n--- ALL 70 APPOINTMENTS SUMMARY ---');
  items.forEach((item, idx) => {
    console.log(`[${idx + 1}] ID: ${item.id} | Token: ${item.tokenNo} | Status: "${item.status}" | Name: ${item.patientName || item.name} | Date: ${item.date || item.appointmentDate} | Slot: ${item.timeSlot} | Reception: ${item.receptionCheckedInAt || 'none'} | Doctor: ${item.doctorConsultedAt || 'none'} | Dispensed: ${item.dispensedAt || 'none'} | Visited: ${item.visitedAt || 'none'}`);
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
