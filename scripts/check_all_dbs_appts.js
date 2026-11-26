const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs } = require('firebase/firestore');

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

const projects = [
  {
    name: 'Booking (ekmsbooking)',
    apiKey: env.NEXT_PUBLIC_BOOKING_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_BOOKING_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_BOOKING_FIREBASE_PROJECT_ID,
  },
  {
    name: 'Core (ekms-app)',
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  },
  {
    name: 'Cases & Settings (triage-cases-settings)',
    apiKey: env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_CASES_SETTINGS_FIREBASE_PROJECT_ID,
  },
  {
    name: 'Aux Triage Main (ekms-triage-main)',
    apiKey: env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_PROJECT_ID,
  }
];

async function checkAll() {
  for (const p of projects) {
    if (!p.apiKey || !p.projectId) continue;
    try {
      const app = initializeApp(p, p.name);
      const db = getFirestore(app);
      const snap = await getDocs(collection(db, 'dispensary_appointments'));
      console.log(`\n=== ${p.name} (${p.projectId}) ===`);
      console.log(`Count in dispensary_appointments: ${snap.docs.length}`);
      const statuses = {};
      snap.docs.forEach(d => {
        const st = d.data().status || 'undefined';
        statuses[st] = (statuses[st] || 0) + 1;
      });
      console.log(`Statuses:`, statuses);
      if (statuses['scheduled']) {
        console.log('Sample scheduled in this DB:');
        const sch = snap.docs.filter(d => d.data().status === 'scheduled');
        sch.slice(0, 5).forEach(d => {
          const dt = d.data();
          console.log(`- ID: ${d.id} | Token: ${dt.tokenNo} | Name: ${dt.patientName} | Date: ${dt.date}`);
        });
      }
    } catch (e) {
      console.log(`=== ${p.name} (${p.projectId}) === ERROR:`, e.message);
    }
  }
}

checkAll().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
