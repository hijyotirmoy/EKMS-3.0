/**
 * ESIS Dispensary OPD Appointment Slot Configuration
 * - 3-minute slot intervals
 * - Operating hours:
 *     Monday to Saturday: 10:00 AM to 04:00 PM (No lunch break; full day open)
 *     Sunday: CLOSED (Holiday)
 * - Single Booking per Slot per Dispensary per Day: Once booked, slot is Locked & Reserved forever
 */

function formatTime12(hours, minutes) {
  const meridiem = hours >= 12 ? "PM" : "AM";
  let h12 = hours % 12;
  if (h12 === 0) h12 = 12;
  const hStr = String(h12).padStart(2, "0");
  const mStr = String(minutes).padStart(2, "0");
  return `${hStr}:${mStr} ${meridiem}`;
}

// Lunch break removed - from 1 to 2 PM appointments can be booked
export function isLunchSlot(slotStr) {
  return false;
}

export function generateAllSlots() {
  const slots = [];
  // 10:00 AM to 04:00 PM (minutes 600 to 960, 3 min intervals)
  // Total: 120 slots per day (10:00 - 10:03, 10:03 - 10:06, ..., 03:57 - 04:00)
  for (let mins = 10 * 60; mins < 16 * 60; mins += 3) {
    const startH = Math.floor(mins / 60);
    const startM = mins % 60;
    const endMins = mins + 3;
    const endH = Math.floor(endMins / 60);
    const endM = endMins % 60;
    slots.push(`${formatTime12(startH, startM)} - ${formatTime12(endH, endM)}`);
  }
  return slots;
}

export const ALL_OPD_TIME_SLOTS = generateAllSlots();

export const OPERATING_HOURS_LABEL =
  "Mon–Sat: 10:00 AM – 04:00 PM (Closed Sunday)";

export function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTomorrowDateString() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const day = String(tomorrow.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getYesterdayDateString() {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const year = yesterday.getFullYear();
  const month = String(yesterday.getMonth() + 1).padStart(2, "0");
  const day = String(yesterday.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Check Saturday details:
 * Saturday is fully open for OPD bookings from 10:00 AM to 04:00 PM. Only Sunday is closed.
 */
export function getSaturdayInfo(dateStr) {
  if (!dateStr) return { isSaturday: false, isOpen: false, saturdayNumber: 0 };
  const parts = String(dateStr).split("-").map((v) => parseInt(v, 10));
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) {
    return { isSaturday: false, isOpen: false, saturdayNumber: 0 };
  }
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  const day = dateObj.getDay();
  if (day !== 6) return { isSaturday: false, isOpen: false, saturdayNumber: 0 };

  const dayOfMonth = dateObj.getDate();
  const saturdayNumber = Math.ceil(dayOfMonth / 7);
  return { isSaturday: true, isOpen: true, saturdayNumber };
}

export function isWeekendOrHoliday(dateStr) {
  if (!dateStr) return false;
  const parts = String(dateStr).split("-").map((v) => parseInt(v, 10));
  if (parts.length < 3 || isNaN(parts[0]) || isNaN(parts[1]) || isNaN(parts[2])) return false;
  const dateObj = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  const day = dateObj.getDay();

  // Only Sunday is closed
  if (day === 0) return true;

  // Saturday is fully open (10:00 AM to 04:00 PM)
  return false;
}

export function getNextWorkingDateString(fromDateStr = getTodayDateString()) {
  const parts = String(fromDateStr).split("-").map((v) => parseInt(v, 10));
  const [y, m, d] = parts;
  let cur = new Date(y, m - 1, d, 12, 0, 0);

  for (let i = 1; i <= 7; i++) {
    cur.setDate(cur.getDate() + 1);
    const day = cur.getDay();
    // Sunday: closed
    if (day === 0) continue;
    // Monday to Saturday: open
    const nY = cur.getFullYear();
    const nM = String(cur.getMonth() + 1).padStart(2, "0");
    const nD = String(cur.getDate()).padStart(2, "0");
    return `${nY}-${nM}-${nD}`;
  }
  return getTomorrowDateString();
}

export function areFacilitiesMatching(facA, facB) {
  if (!facA || !facB) return false;
  const cleanA = String(facA).toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanB = String(facB).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;
  if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
  return false;
}

export function areDatesMatching(d1, d2) {
  if (!d1 || !d2) return false;
  const s1 = String(d1).trim();
  const s2 = String(d2).trim();
  if (s1 === s2) return true;

  const toYmd = (s) => {
    // YYYY-MM-DD
    const ymd = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (ymd) return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
    // DD-MM-YYYY
    const dmy = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return s;
  };

  return toYmd(s1) === toYmd(s2);
}

export function areSlotsMatching(s1, s2) {
  if (!s1 || !s2) return false;
  const norm = (s) =>
    String(s)
      .toLowerCase()
      .replace(/\b0(\d):/g, "$1:") // normalize leading zero: 02:55 -> 2:55
      .replace(/[\s–—]+/g, " ")
      .trim();
  const n1 = norm(s1);
  const n2 = norm(s2);
  if (n1 === n2) return true;

  // Also match by start time so legacy 5-min intervals connect with new 3-min intervals
  const start1 = n1.split("-")[0]?.trim();
  const start2 = n2.split("-")[0]?.trim();
  if (start1 && start2 && start1 === start2) return true;

  return false;
}

export function findSlotBooking(slotStr, dateStr, facilityName, appointments = [], currentDocId = null) {
  if (!slotStr || !dateStr || !Array.isArray(appointments) || appointments.length === 0) {
    return null;
  }
  return (
    appointments.find((app) => {
      if (!app) return false;
      if (app.status === "cancelled") return false;
      if (
        currentDocId &&
        (app.id === currentDocId ||
          app.tokenNo === currentDocId ||
          app.referenceNo === currentDocId ||
          app.caseRef === currentDocId)
      ) {
        return false;
      }
      if (!areDatesMatching(app.date, dateStr)) return false;
      const appSlot = app.timeSlot || app.slot;
      if (!areSlotsMatching(appSlot, slotStr)) return false;

      if (
        !facilityName ||
        facilityName === "All Facilities" ||
        facilityName === "All Dispensaries" ||
        facilityName === "all"
      ) {
        return true;
      }
      const appFac = app.facilityName || app.dispensaryName || "";
      return areFacilitiesMatching(appFac, facilityName);
    }) || null
  );
}

export function isSlotReserved(slotStr, dateStr, facilityName, appointments = [], currentDocId = null) {
  return Boolean(findSlotBooking(slotStr, dateStr, facilityName, appointments, currentDocId));
}

export function isSlotInPast(slotStr, selectedDateStr) {
  if (!slotStr || !selectedDateStr) return false;

  // If date is completely closed (Sunday only)
  if (isWeekendOrHoliday(selectedDateStr)) return true;

  const todayStr = getTodayDateString();

  // If selected date is in the past, all slots are past
  if (selectedDateStr < todayStr) return true;

  // Selected date is Today or a future open date: check slot start time
  const startPart = slotStr.split("-")[0]?.trim();
  if (!startPart) return false;

  const match = startPart.match(/(\d+):(\d+)\s*(AM|PM)/i);
  if (!match) return false;

  let h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const meridiem = match[3].toUpperCase();

  if (meridiem === "PM" && h < 12) h += 12;
  if (meridiem === "AM" && h === 12) h = 0;

  const slotStartMinutes = h * 60 + m;

  // Saturday operating hours are 10:00 AM to 04:00 PM (full day, open till 4 PM; only Sunday closed)

  // If selected date is in the future weekday or open Saturday, slot is available
  if (selectedDateStr > todayStr) return false;

  // Selected date is Today: check slot start time against current hour & minute
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  return slotStartMinutes <= currentMinutes;
}

export function getFirstAvailableSlot(dateStr, facilityName = "", appointments = [], currentDocId = null) {
  if (isWeekendOrHoliday(dateStr)) return null;
  for (const slot of ALL_OPD_TIME_SLOTS) {
    if (isSlotInPast(slot, dateStr)) continue;
    if (facilityName && isSlotReserved(slot, dateStr, facilityName, appointments, currentDocId)) continue;
    return slot;
  }
  return null;
}

export function findNextAvailableSlot(requestedSlot, dateStr, facilityName = "", appointments = [], currentDocId = null) {
  if (isWeekendOrHoliday(dateStr)) return null;
  const startIdx = ALL_OPD_TIME_SLOTS.findIndex((s) => areSlotsMatching(s, requestedSlot));
  const candidateIndices = [];
  // First look forward from the requested slot
  const start = startIdx >= 0 ? startIdx + 1 : 0;
  for (let i = start; i < ALL_OPD_TIME_SLOTS.length; i++) {
    candidateIndices.push(i);
  }
  // Then wrap around to earlier slots if needed
  if (startIdx > 0) {
    for (let i = 0; i < startIdx; i++) {
      candidateIndices.push(i);
    }
  }
  for (const idx of candidateIndices) {
    const slot = ALL_OPD_TIME_SLOTS[idx];
    if (isSlotInPast(slot, dateStr)) continue;
    if (facilityName && isSlotReserved(slot, dateStr, facilityName, appointments, currentDocId)) continue;
    return slot;
  }
  return null;
}

export function areAllSlotsPastToday() {
  const todayStr = getTodayDateString();
  if (isWeekendOrHoliday(todayStr)) return true;
  return ALL_OPD_TIME_SLOTS.every((s) => isSlotInPast(s, todayStr));
}

/**
 * Check if a dispensary has any doctor available on a given date.
 * Rule:
 * If at least 1 doctor is on duty -> isAvailable: true (bookings allowed).
 * If ALL doctors assigned to that dispensary are on leave -> isAvailable: false (bookings unavailable).
 */
export function checkDispensaryDoctorAvailability(
  facilityName,
  dateStr,
  doctorAvailabilityRecords = [],
  platformDoctors = []
) {
  if (!facilityName || !dateStr) {
    return {
      isAvailable: true,
      totalDoctors: 0,
      availableDoctorsCount: 0,
      unavailableDoctorsCount: 0,
      availableDoctors: [],
      onLeaveDoctors: [],
      reason: null,
    };
  }

  const norm = (s) =>
    (s || "")
      .toLowerCase()
      .replace(/\besis\b|\besic\b|\bdispensary\b|[^a-z0-9]/g, "")
      .trim();

  const targetNorm = norm(facilityName);
  if (!targetNorm) {
    return {
      isAvailable: true,
      totalDoctors: 0,
      availableDoctorsCount: 0,
      unavailableDoctorsCount: 0,
      availableDoctors: [],
      onLeaveDoctors: [],
      reason: null,
    };
  }

  const knownDoctorsMap = new Map();

  (platformDoctors || []).forEach((d) => {
    const docNorm = norm(d.dispensaryName);
    if (docNorm && (docNorm.includes(targetNorm) || targetNorm.includes(docNorm))) {
      const id = String(d.email || d.id || d.name || "").toLowerCase().trim();
      if (id) {
        knownDoctorsMap.set(id, {
          id,
          name: d.displayName || d.name || (d.email ? d.email.split("@")[0] : id),
          email: d.email || id,
          dispensaryName: d.dispensaryName,
        });
      }
    }
  });

  (doctorAvailabilityRecords || []).forEach((r) => {
    const dispNorm = norm(r.dispensaryName);
    if (dispNorm && (dispNorm.includes(targetNorm) || targetNorm.includes(dispNorm))) {
      const id = String(r.doctorEmail || r.doctorId || r.doctorName || "").toLowerCase().trim();
      if (id && !knownDoctorsMap.has(id)) {
        knownDoctorsMap.set(id, {
          id,
          name: r.doctorName || r.doctorId || id,
          email: r.doctorEmail || id,
          dispensaryName: r.dispensaryName,
        });
      }
    }
  });

  const targetDoctors = Array.from(knownDoctorsMap.values());
  if (targetDoctors.length === 0) {
    return {
      isAvailable: true,
      totalDoctors: 0,
      availableDoctorsCount: 0,
      unavailableDoctorsCount: 0,
      availableDoctors: [],
      onLeaveDoctors: [],
      reason: null,
    };
  }

  const onLeaveDoctors = [];
  const availableDoctors = [];
  const targetDatePrefix = String(dateStr).slice(0, 10);

  targetDoctors.forEach((doc) => {
    const docId = doc.id;
    const docName = doc.name.toLowerCase();
    const docEmail = String(doc.email || "").toLowerCase();

    const rec = (doctorAvailabilityRecords || []).find((r) => {
      const rDate = String(r.date || "").slice(0, 10);
      if (rDate !== targetDatePrefix) return false;

      const rDocId = String(r.doctorId || "").toLowerCase().trim();
      const rEmail = String(r.doctorEmail || "").toLowerCase().trim();
      const rName = String(r.doctorName || "").toLowerCase().trim();

      return (
        (rDocId && (rDocId === docId || rDocId === docEmail)) ||
        (rEmail && (rEmail === docEmail || rEmail === docId)) ||
        (rName && (rName === docName || docName.includes(rName) || rName.includes(docName)))
      );
    });

    if (rec && rec.isAvailable === false) {
      onLeaveDoctors.push({ name: doc.name, reason: rec.reason || "On Leave" });
    } else {
      availableDoctors.push({ name: doc.name });
    }
  });

  const isAvailable = availableDoctors.length > 0;

  return {
    isAvailable,
    totalDoctors: targetDoctors.length,
    availableDoctorsCount: availableDoctors.length,
    unavailableDoctorsCount: onLeaveDoctors.length,
    availableDoctors,
    onLeaveDoctors,
    reason: !isAvailable ? `All doctors at ${facilityName} are on leave on ${targetDatePrefix}` : null,
  };
}
