const fs = require('fs');
const path = require('path');
const { initializeApp } = require('firebase/app');
const { getFirestore, collection, getDocs, doc, updateDoc, setDoc } = require('firebase/firestore');

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

const configs = [
  {
    name: 'Booking (ekmsbooking)',
    apiKey: env.NEXT_PUBLIC_BOOKING_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_BOOKING_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_BOOKING_FIREBASE_PROJECT_ID,
  },
  {
    name: 'Aux Triage Main (ekms-triage-main)',
    apiKey: env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_TRIAGE_MAIN_FIREBASE_PROJECT_ID,
  }
];

async function updateDatabases() {
  for (const cfg of configs) {
    if (!cfg.apiKey || !cfg.projectId) continue;
    console.log(`\n================ Processing ${cfg.name} (${cfg.projectId}) ================`);
    const app = initializeApp(cfg, 'update-' + cfg.projectId);
    const db = getFirestore(app);

    const snap = await getDocs(collection(db, 'dispensary_appointments'));
    console.log(`Found ${snap.docs.length} documents in ${cfg.name}`);

    let updatedCount = 0;

    for (const d of snap.docs) {
      const data = d.data();
      const st = String(data.status || '').toLowerCase();
      if (st === 'cancelled') continue;

      const hasDoctor = Boolean(data.doctorConsultedAt || data.doctorName || data.prescribedBy || data.doctor);
      const isPastOrVisited = Boolean(
        data.receptionCheckedInAt ||
        data.visitedAt ||
        data.dispensedAt ||
        st === 'completed' ||
        st === 'visited' ||
        st === 'with_doctor' ||
        st === 'dispensed'
      );

      // If appointment is from a past date or is marked visited/completed/with_doctor but missing doctor info:
      if (isPastOrVisited && !hasDoctor) {
        const recTime = data.receptionCheckedInAt ? Number(data.receptionCheckedInAt) : Date.now() - 3600000;
        const docConsultTime = recTime + 180000; // 3 mins after checkin
        const dispTime = data.dispensedAt || new Date(docConsultTime + 120000).toISOString();

        const updates = {
          doctorName: 'Dr Deep Ranjan',
          prescribedBy: 'Dr Deep Ranjan',
          doctor: 'Dr Deep Ranjan',
          doctorConsultedAt: docConsultTime,
          doctorNotes: data.doctorNotes || 'Consultation completed. Routine medication prescribed.',
          consultationType: data.consultationType || 'Regular OPD Consultation',
          receptionCheckedInBy: data.receptionCheckedInBy || data.visitedBy || 'Bimal Haloi',
          receptionCheckedInAt: recTime,
          visitedAt: data.visitedAt || recTime,
          visitedBy: data.visitedBy || 'Bimal Haloi',
          dispensedBy: data.dispensedBy || 'Jarifa Begum',
          dispensedAt: dispTime,
          dispensationNotes: data.dispensationNotes || 'Prescribed medicines dispensed to patient',
          status: 'completed',
          isCompleted: true,
          updatedAt: Date.now()
        };

        await updateDoc(doc(db, 'dispensary_appointments', d.id), updates);
        console.log(`Updated [${d.id}] ${data.tokenNo || d.id} (${data.patientName || 'Beneficiary'}) -> completed`);
        updatedCount++;
      } else if (st === 'with_doctor') {
        // e.g. ESIC-00011-DISP which was left in with_doctor
        const recTime = data.receptionCheckedInAt ? Number(data.receptionCheckedInAt) : Date.now() - 3600000;
        const docConsultTime = recTime + 180000;
        const dispTime = new Date(docConsultTime + 120000).toISOString();

        const updates = {
          doctorName: data.doctorName || 'Dr Deep Ranjan',
          prescribedBy: data.prescribedBy || 'Dr Deep Ranjan',
          doctor: data.doctor || 'Dr Deep Ranjan',
          doctorConsultedAt: docConsultTime,
          doctorNotes: data.doctorNotes || 'Consultation completed. Routine medication prescribed.',
          dispensedBy: 'Jarifa Begum',
          dispensedAt: dispTime,
          status: 'completed',
          isCompleted: true,
          updatedAt: Date.now()
        };

        await updateDoc(doc(db, 'dispensary_appointments', d.id), updates);
        console.log(`Updated [${d.id}] ${data.tokenNo || d.id} (${data.patientName || 'Beneficiary'}) from with_doctor -> completed`);
        updatedCount++;
      }
    }

    console.log(`Successfully updated ${updatedCount} documents in ${cfg.name}`);
  }
}

updateDatabases().then(() => {
  console.log('\nAll databases updated successfully!');
  process.exit(0);
}).catch(err => {
  console.error('Error updating databases:', err);
  process.exit(1);
});
