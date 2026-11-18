import { collection, doc, setDoc, deleteDoc, getDocs, onSnapshot, query, where } from "firebase/firestore";
import { db, bookingDb } from "@/lib/firebase";
import { isDispensaryMatch } from "@/lib/appointmentTypes";
import { getTriageBaseUrl } from "@/lib/triageSync";

export interface DoctorAvailabilityRecord {
  id: string; // e.g., `${cleanDoctorId}_${date}`
  doctorId: string; // email or user id
  doctorName: string;
  doctorEmail: string;
  dispensaryName: string;
  dispensaryId?: string;
  date: string; // "YYYY-MM-DD"
  isAvailable: boolean; // true = Available, false = Unavailable / On Leave
  reason?: string;
  updatedAt: number;
  updatedBy: string;
}

export interface DoctorProfile {
  id: string;
  email: string;
  displayName: string;
  name?: string;
  role: string;
  dispensaryRole?: string;
  dispensaryName: string;
  dispensaryId?: string;
  phone?: string;
}

export function isDoctorUser(user: any): boolean {
  if (!user) return false;
  const dispRole = String(user.dispensaryRole || "").toLowerCase().trim();
  const role = String(user.role || "").toLowerCase().trim();
  const name = String(user.displayName || user.name || "").toLowerCase().trim();
  return dispRole === "doctor" || role === "doctor" || name.startsWith("dr.") || name.startsWith("dr ");
}

/**
 * Normalizes a date into YYYY-MM-DD local string (strictly avoids UTC day-shift bugs in IST)
 */
export function formatIsoDateOnly(date: Date | string): string {
  if (!date) return "";
  if (typeof date === "string") {
    // If already in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
    const parsed = new Date(date);
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear();
      const m = String(parsed.getMonth() + 1).padStart(2, "0");
      const d = String(parsed.getDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
    return date.slice(0, 10);
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Generate standard document ID for doctor availability record
 */
export function getAvailabilityDocId(doctorIdOrEmail: string, date: string): string {
  const cleanId = String(doctorIdOrEmail).toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${cleanId}_${date}`;
}

/**
 * Save or update doctor availability for a specific date in Firestore
 */
export async function saveDoctorAvailability(record: Omit<DoctorAvailabilityRecord, "id" | "updatedAt">): Promise<void> {
  const dateStr = formatIsoDateOnly(record.date);
  const docId = getAvailabilityDocId(record.doctorId || record.doctorEmail, dateStr);

  const payload: DoctorAvailabilityRecord = {
    ...record,
    id: docId,
    date: dateStr,
    updatedAt: Date.now(),
  };

  let saved = false;

  // 1. Save directly to bookingDb (open for dispensary operations)
  try {
    if (bookingDb) {
      await setDoc(doc(bookingDb, "doctor_availability", docId), payload, { merge: true });
      saved = true;
    }
  } catch (e) {
    console.warn("bookingDb doctor_availability client save notice:", e);
  }

  // 2. Attempt save to main db (safely catch any security rule errors so they don't break the UI)
  try {
    if (db) {
      await setDoc(doc(db, "doctor_availability", docId), payload, { merge: true });
      saved = true;
    }
  } catch (e) {
    console.warn("main db doctor_availability client save notice:", e);
  }

  // 3. Post to local EKMS API endpoint (runs server-side, bypassing client permission limits)
  try {
    const res = await fetch("/api/doctor-availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      saved = true;
    }
  } catch (apiErr) {
    console.warn("EKMS local API availability persist note:", apiErr);
  }

  // 4. Replicate to Triage API if available
  try {
    const triageUrl = `${getTriageBaseUrl()}/api/doctor-availability`;

    fetch(triageUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});
  } catch (e) {}

  if (!saved) {
    throw new Error("Unable to persist doctor availability record. Please check your connection.");
  }
}

/**
 * Remove an availability record (restoring default availability)
 */
export async function removeDoctorAvailability(doctorIdOrEmail: string, date: string): Promise<void> {
  const dateStr = formatIsoDateOnly(date);
  const docId = getAvailabilityDocId(doctorIdOrEmail, dateStr);

  // 1. Delete from bookingDb
  try {
    if (bookingDb) {
      await deleteDoc(doc(bookingDb, "doctor_availability", docId));
    }
  } catch (e) {}

  // 2. Delete from main db
  try {
    if (db) {
      await deleteDoc(doc(db, "doctor_availability", docId));
    }
  } catch (e) {}

  // 3. Call local API endpoint
  try {
    await fetch(`/api/doctor-availability?id=${encodeURIComponent(docId)}`, {
      method: "DELETE",
    });
  } catch (e) {}

  // 4. Call Triage API endpoint
  try {
    const triageUrl = `${getTriageBaseUrl()}/api/doctor-availability?id=${encodeURIComponent(docId)}`;
    fetch(triageUrl, { method: "DELETE" }).catch(() => {});
  } catch (e) {}
}

/**
 * Core Rule: Checks dispensary availability on a given date based on registered doctors.
 * If multiple doctors are assigned to a dispensary:
 * - If at least ONE doctor is available -> Dispensary is AVAILABLE for bookings.
 * - Only if ALL doctors assigned to that dispensary are UNAVAILABLE on that date -> Dispensary is UNAVAILABLE.
 * - If no doctors are assigned or none marked unavailable -> Defaults to AVAILABLE.
 */
export function checkDispensaryAvailabilityForDate(
  dispensaryName: string,
  date: string,
  allDoctors: DoctorProfile[],
  availabilityRecords: DoctorAvailabilityRecord[]
): {
  isAvailable: boolean;
  totalDoctors: number;
  availableDoctorsCount: number;
  unavailableDoctorsCount: number;
  availableDoctorNames: string[];
  unavailableDoctorNames: string[];
  reason?: string;
} {
  const targetDate = formatIsoDateOnly(date);

  // Match doctors belonging to this dispensary
  const dispensaryDoctors = allDoctors.filter((d) =>
    isDispensaryMatch(d.dispensaryName, dispensaryName, d.dispensaryId)
  );

  if (dispensaryDoctors.length === 0) {
    return {
      isAvailable: true,
      totalDoctors: 0,
      availableDoctorsCount: 0,
      unavailableDoctorsCount: 0,
      availableDoctorNames: [],
      unavailableDoctorNames: [],
    };
  }

  const availableDoctorNames: string[] = [];
  const unavailableDoctorNames: string[] = [];
  const leaveReasons: string[] = [];

  for (const doc of dispensaryDoctors) {
    const docId = (doc.email || doc.id).toLowerCase().trim();
    const docName = doc.displayName || doc.name || doc.email.split("@")[0];

    // Check if there is an availability record for this doctor on this target date
    const record = availabilityRecords.find((r) => {
      const matchDoc =
        r.doctorId?.toLowerCase() === docId ||
        r.doctorEmail?.toLowerCase() === docId ||
        r.doctorName?.toLowerCase() === docName.toLowerCase();
      return matchDoc && formatIsoDateOnly(r.date) === targetDate;
    });

    if (record && record.isAvailable === false) {
      unavailableDoctorNames.push(docName);
      if (record.reason) {
        leaveReasons.push(`${docName}: ${record.reason}`);
      } else {
        leaveReasons.push(`${docName}: On Leave`);
      }
    } else {
      // Default: Doctor is AVAILABLE
      availableDoctorNames.push(docName);
    }
  }

  // Key user requirement:
  // If at least one doctor is available -> Dispensary can accept bookings!
  // Only if all doctors at this dispensary are unavailable -> Dispensary cannot accept bookings!
  const isAvailable = availableDoctorNames.length > 0;

  return {
    isAvailable,
    totalDoctors: dispensaryDoctors.length,
    availableDoctorsCount: availableDoctorNames.length,
    unavailableDoctorsCount: unavailableDoctorNames.length,
    availableDoctorNames,
    unavailableDoctorNames,
    reason: !isAvailable
      ? `All doctors at ${dispensaryName} are unavailable on ${targetDate} (${unavailableDoctorNames.join(", ")})`
      : undefined,
  };
}

/**
 * Synchronizes doctors list across Firestore booking database and Triage API
 */
export async function syncDoctorsToTriageAndBookingDb(doctors: DoctorProfile[]) {
  if (!doctors || doctors.length === 0) return;

  // 1. Sync into bookingDb dispensary_doctors collection
  try {
    if (bookingDb) {
      for (const d of doctors) {
        const docId = (d.email || d.id).toLowerCase().replace(/[^a-zA-Z0-9_-]/g, "_");
        await setDoc(
          doc(bookingDb, "dispensary_doctors", docId),
          {
            id: docId,
            email: (d.email || d.id).toLowerCase(),
            displayName: d.displayName || d.name || d.email.split("@")[0],
            name: d.name || d.displayName,
            dispensaryName: d.dispensaryName || "",
            dispensaryId: d.dispensaryId || "",
            role: "Doctor",
            dispensaryRole: "doctor",
            updatedAt: Date.now(),
          },
          { merge: true }
        ).catch(() => {});
      }
    }
  } catch (e) {
    console.warn("syncDoctorsToTriageAndBookingDb bookingDb notice:", e);
  }

  // 2. Post doctors list to Triage API
  try {
    const triageUrl = `${getTriageBaseUrl()}/api/doctor-availability`;

    fetch(triageUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctors }),
    }).catch(() => {});
  } catch (_) {}
}
