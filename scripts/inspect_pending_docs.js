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

const config = {
  apiKey: env.NEXT_PUBLIC_BOOKING_FIREBASE_API_KEY,
  authDomain: env.NEXT_PUBLIC_BOOKING_FIREBASE_AUTH_DOMAIN,
  projectId: env.NEXT_PUBLIC_BOOKING_FIREBASE_PROJECT_ID,
};

const app = initializeApp(config, 'doctor-check');
const db = getFirestore(app);

async function inspect() {
  const snap = await getDocs(collection(db, 'dispensary_appointments'));
  const docs = [];
  snap.docs.forEach((d) => {
    const data = d.data();
    if (data.doctorName || data.prescribedBy || data.doctor) {
      docs.push({
        id: d.id,
        token: data.tokenNo,
        doctor: data.doctorName || data.prescribedBy || data.doctor,
        doctorNotes: data.doctorNotes,
        consultationType: data.consultationType,
        dispensedBy: data.dispensedBy || data.pharmacistName,
        reception: data.receptionCheckedInBy || data.visitedBy
      });
    }
  });

  console.log('Sample appointments WITH doctor:');
  console.log(JSON.stringify(docs.slice(0, 5), null, 2));
}

inspect().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
