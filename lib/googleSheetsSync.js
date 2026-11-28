/**
 * Google Sheets Integration for EKMS Triage & Facility Bookings
 * Spreadsheet URL: https://docs.google.com/spreadsheets/d/1be-yMMFGcXJToYbQI3KJnadURgjWeGncGmxGbJzFLso/edit?usp=sharing
 * Sheet ID: 1be-yMMFGcXJToYbQI3KJnadURgjWeGncGmxGbJzFLso
 *
 * Requirements:
 * - Stores Reference ID, Name, Phone No, IP No, Date & Time, Dispensary Name, Agent Name
 * - Record Type: "Triage Only" (if only triage completed) or "Booking Done" (if booking completed)
 * - Permanent Append-Only: No data can be deleted once recorded.
 */

import { getCallerIdForPhone } from "./callerId.js";

export const GOOGLE_SHEET_ID = "1be-yMMFGcXJToYbQI3KJnadURgjWeGncGmxGbJzFLso";
export const GOOGLE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1be-yMMFGcXJToYbQI3KJnadURgjWeGncGmxGbJzFLso/edit?usp=sharing";
export const DEFAULT_WEBHOOK_URL =
  "https://script.google.com/macros/s/AKfycbzzk3DPzW9urW_i350_Kq5Sm1rPw9pcha6pEafuTowHH1Vcbl08vRxWX89qnlJgTjQP6w/exec";

export function getWebhookUrl() {
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem("ekms_google_sheets_webhook_url");
      if (saved && saved.trim().startsWith("http")) return saved.trim();
    } catch (e) {}
  }
  return (
    process.env.NEXT_PUBLIC_GOOGLE_SHEETS_WEBHOOK_URL ||
    process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
    DEFAULT_WEBHOOK_URL
  );
}

export function setWebhookUrl(url) {
  if (typeof window !== "undefined") {
    try {
      if (url) {
        localStorage.setItem("ekms_google_sheets_webhook_url", url.trim());
      } else {
        localStorage.removeItem("ekms_google_sheets_webhook_url");
      }
    } catch (e) {}
  }
}

/**
 * Format timestamp in IST
 */
export function formatISTDateTime(dateObj = new Date()) {
  try {
    const d = new Date(dateObj);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch (e) {
    return new Date().toISOString();
  }
}

/**
 * Cleanly format staff timestamps in IST
 */
export function formatStaffTimestamp(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch (_) {
    return String(ts);
  }
}

/**
 * Extract structured clinical summary and staff fulfillment fields from any appointment or case object
 */
export function extractClinicalAndStaffDetails(data = {}) {
  if (!data) return {};

  const clinicalRecord = data.clinicalRecord || data.clinicalOverview || data.triageState || {};
  const intake = data.intake || {};
  const triage = data.triage || {};
  const summaryText = typeof data.clinicalSummary === "string" ? data.clinicalSummary : "";

  // 1. Clinical Red Flags:
  let redFlags = [];
  if (Array.isArray(clinicalRecord.redFlags) && clinicalRecord.redFlags.length > 0) {
    redFlags = clinicalRecord.redFlags;
  } else if (Array.isArray(data.redFlags) && data.redFlags.length > 0) {
    redFlags = data.redFlags;
  } else if (Array.isArray(triage.red_flags) && triage.red_flags.length > 0) {
    redFlags = triage.red_flags;
  } else if (Array.isArray(clinicalRecord.redFlagsDetected) && clinicalRecord.redFlagsDetected.length > 0) {
    redFlags = clinicalRecord.redFlagsDetected;
  } else if (summaryText) {
    const rfMatch = summaryText.match(/•?\s*Clinical Red Flags:\s*([\s\S]*?)(?=•?\s*(?:History of Present Illness|Associated Symptoms|Comorbidity|$))/i);
    if (rfMatch && rfMatch[1]) {
      redFlags = rfMatch[1]
        .split("\n")
        .map((s) => s.replace(/^\s*•\s*/, "").trim())
        .filter((s) => s && !/none reported/i.test(s));
    }
  }
  const cleanRedFlags = redFlags
    .filter((f) => f && !/none reported/i.test(String(f)))
    .map((f) => String(f).trim());
  const clinicalRedFlagsStr = cleanRedFlags.length > 0 ? cleanRedFlags.join(", ") : "None reported";

  // 2. History of Present Illness(from how long it happening)
  let hpi = clinicalRecord.hpiDuration || data.hpiDuration || intake.duration || triage.duration || "";
  if (!hpi && summaryText) {
    const hpiMatch = summaryText.match(/•?\s*History of Present Illness[^:\r\n]*:[^\S\r\n]*([^\r\n•]+)/i);
    if (hpiMatch) hpi = hpiMatch[1].trim();
  }
  const hpiDurationStr = (hpi && !/^(none|nil|n\/a)/i.test(hpi)) ? hpi : "Reported today";

  // 3. Associated Symptoms
  let assoc = clinicalRecord.associatedSymptoms || data.associatedSymptoms || intake.associated_symptoms || "";
  if (Array.isArray(assoc)) assoc = assoc.join(", ");
  if (!assoc && summaryText) {
    const assocMatch = summaryText.match(/•?\s*Associated Symptoms:[^\S\r\n]*([^\r\n•]+)/i);
    if (assocMatch) assoc = assocMatch[1].trim();
  }
  const associatedSymptomsStr = (assoc && !/^(none|nil|no |none reported|n\/a)/i.test(assoc)) ? assoc : "None reported";

  // 4. Comorbidity
  let comorb = clinicalRecord.comorbidity || data.comorbidity || intake.comorbidity || intake.comorbidities || triage.comorbidities || "";
  if (Array.isArray(comorb)) comorb = comorb.join(", ");
  if (!comorb && summaryText) {
    const comorbMatch = summaryText.match(/•?\s*Comorbidity:[^\S\r\n]*([^\r\n•]+)/i);
    if (comorbMatch) comorb = comorbMatch[1].trim();
  }
  const comorbidityStr = (comorb && !/^(none|nil|no |none reported|not reported|n\/a)/i.test(comorb)) ? comorb : "None reported";

  // 5. Any medication
  let med = clinicalRecord.medications || data.medications || intake.medications || intake.current_medications || "";
  if (Array.isArray(med)) med = med.join(", ");
  if (!med && summaryText) {
    const medMatch = summaryText.match(/•?\s*Any medication:[^\S\r\n]*([^\r\n•]+)/i);
    if (medMatch) med = medMatch[1].trim();
  }
  const anyMedicationStr = (med && !/^(none|nil|no |none reported|not reported|n\/a)/i.test(med)) ? med : "None reported";

  // 6. Reception by
  const receptionStaff = data.receptionCheckedInBy || data.receptionBy || data.visitedBy || "";
  const receptionTime = formatStaffTimestamp(data.receptionCheckedInAt || data.visitedAt);
  const receptionNotes = (data.receptionNotes || data.visitedNotes || "").trim();
  let receptionByStr = "—";
  if (receptionStaff || receptionTime) {
    receptionByStr = `Reception by ${receptionStaff || "Staff"}${receptionTime ? `, ${receptionTime}` : ""}${receptionNotes ? ` • Note: ${receptionNotes}` : ""}`;
  } else if (data.status === "visited" || data.status === "completed") {
    receptionByStr = "Completed";
  }

  // 7. Prescribed by
  const docName = data.doctorName || data.prescribedBy || data.doctor || "";
  const docTime = formatStaffTimestamp(data.doctorConsultedAt || data.prescribedAt);
  const docNotes = (data.doctorNotes || data.prescriptionNotes || "").trim();
  const consultType = (data.consultationType || "").trim();
  let prescribedByStr = "—";
  if (docName || docTime) {
    const cleanDoc = docName ? (docName.toLowerCase().startsWith("dr") ? docName : `Dr. ${docName}`) : "Medical Officer";
    prescribedByStr = `Prescribed by ${cleanDoc}${docTime ? `, ${docTime}` : ""}${consultType ? ` [${consultType}]` : ""}${docNotes ? ` • Rx: ${docNotes}` : ""}`;
  }

  // 8. Dispensed by
  const pharmName = data.dispensedBy || data.pharmacistName || "";
  const pharmTime = formatStaffTimestamp(data.dispensedAt);
  const pharmNotes = (data.dispensationNotes || data.dispensedNotes || data.pharmacyNotes || "").trim();
  let dispensedByStr = "—";
  if (pharmName || pharmTime) {
    dispensedByStr = `Dispensed by ${pharmName || "Staff"}${pharmTime ? `, ${pharmTime}` : ""}${pharmNotes ? ` • Note: ${pharmNotes}` : ""}`;
  }

  // 9. Follow-up Status & Details
  let followUpStatusStr = "None";
  let followUpDetailsStr = "—";
  if (data.followUpStatus === "closed") {
    followUpStatusStr = "Follow-up Done (Case Closed)";
  } else if (data.followUpStatus === "pending") {
    followUpStatusStr = `Pending Follow-up${data.followUpAt ? ` (${data.followUpAt})` : ""}`;
  } else if (data.followUpStatus && data.followUpStatus !== "none") {
    followUpStatusStr = String(data.followUpStatus);
  }

  if (data.followUpNotes) {
    followUpDetailsStr = `"${data.followUpNotes}"${data.followUpAgent ? ` (${data.followUpAgent})` : ""}`;
  } else if (Array.isArray(data.followUpHistory) && data.followUpHistory.length > 0) {
    const latest = data.followUpHistory[data.followUpHistory.length - 1];
    if (latest && (latest.message || latest.agent)) {
      followUpDetailsStr = `"${latest.message || ""}"${latest.agent ? ` (${latest.agent})` : ""}`;
    }
  }

  return {
    clinical_red_flags: clinicalRedFlagsStr,
    hpi_duration: hpiDurationStr,
    associated_symptoms: associatedSymptomsStr,
    comorbidity: comorbidityStr,
    any_medication: anyMedicationStr,
    reception_by: receptionByStr,
    prescribed_by: prescribedByStr,
    dispensed_by: dispensedByStr,
    follow_up_status: followUpStatusStr,
    follow_up_details: followUpDetailsStr,
  };
}

/**
 * Send an immutable record to the Google Sheets backend & webhook.
 * Guarantees append-only permanence with full clinical summary and staff columns.
 */
export async function sendToGoogleSheet({
  timestamp = "",
  recordType = "Call Only", // "Call Only" | "Booking Done"
  caseId = "",
  bookingRefId = "",
  referenceId = "",
  name = "",
  phone = "",
  ipNo = "",
  dateTime = "",
  dispensaryName = "",
  agentName = "Agent",
  complaint = "",
  clinicalRedFlags = "",
  hpiDuration = "",
  associatedSymptoms = "",
  comorbidity = "",
  anyMedication = "",
  receptionBy = "",
  prescribedBy = "",
  dispensedBy = "",
  followUpStatus = "",
  followUpDetails = "",
  urgency = "Mild",
  status = "Recorded",
  metadata = {},
} = {}) {
  let finalCaseId = String(caseId || metadata?.case_ref || (referenceId?.startsWith("CA") ? referenceId : "") || "").trim();
  if (finalCaseId.startsWith("ESI-") || finalCaseId.startsWith("ESIC-") || finalCaseId.startsWith("DISP-")) {
    finalCaseId = "";
  }

  const finalBookingId = String(
    bookingRefId ||
    metadata?.tokenNo ||
    (referenceId?.startsWith("ESI") ? referenceId : (recordType === "Booking Done" ? referenceId : "")) ||
    ""
  ).trim();

  const isBooking = Boolean(finalBookingId || recordType === "Booking Done");
  const normalizedRecordType = isBooking ? "Booking Done" : "Call Only";
  const normalizedBookingId = isBooking ? finalBookingId : ""; // Completely empty if no booking!
  const normalizedRefId = isBooking ? (finalBookingId || finalCaseId || referenceId || "") : finalCaseId;
  const normalizedDateTime = isBooking ? (dateTime || formatISTDateTime()) : ""; // Strictly empty if Call Only!
  const normalizedStatus = isBooking ? (status || "Booking Confirmed") : "Call Only";
  const normalizedTimestamp = timestamp ? formatISTDateTime(timestamp) : formatISTDateTime();

  const cleanDigits = String(phone || "").replace(/\D/g, "");
  const callerId = (typeof apptData !== "undefined" && apptData?.caller_id && !apptData.caller_id.startsWith("CAL-"))
    ? apptData.caller_id
    : ((typeof apptData !== "undefined" && apptData?.callerId && !apptData.callerId.startsWith("CAL-"))
      ? apptData.callerId
      : ((typeof metadata !== "undefined" && metadata?.caller_id && !metadata.caller_id.startsWith("CAL-"))
        ? metadata.caller_id
        : ((typeof metadata !== "undefined" && metadata?.callerId && !metadata.callerId.startsWith("CAL-"))
          ? metadata.callerId
          : (cleanDigits ? getCallerIdForPhone(cleanDigits) : ""))));

  const isStatusUpdate = Boolean(metadata?.is_status_update);

  const payload = {
    timestamp: normalizedTimestamp,
    record_type: normalizedRecordType,
    case_id: finalCaseId,
    booking_ref_id: normalizedBookingId,
    reference_id: normalizedRefId,
    caller_id: callerId,
    callerId: callerId,
    name: name || "Anonymous",
    phone_no: phone || "",
    ip_no: ipNo || "N/A",
    date_time: normalizedDateTime,
    dispensary_name: dispensaryName || "ESIS Dispensary",
    agent_name: agentName || "Agent",
    chief_complaint: complaint || "",
    clinical_red_flags: clinicalRedFlags || "None reported",
    hpi_duration: hpiDuration || "Reported today",
    associated_symptoms: associatedSymptoms || "None reported",
    comorbidity: comorbidity || "None reported",
    any_medication: anyMedication || "None reported",
    urgency_level: urgency || "Mild",
    status: normalizedStatus,
    reception_by: receptionBy || "—",
    prescribed_by: prescribedBy || "—",
    dispensed_by: dispensedBy || "—",
    follow_up_status: followUpStatus || "None",
    follow_up_details: followUpDetails || "—",
    is_status_update: isStatusUpdate,
    sheet_id: GOOGLE_SHEET_ID,
    sheet_url: GOOGLE_SHEET_URL,
    metadata,
  };

  try {
    // 1. Post to local server API (which stores in append-only JSON journal & Firestore and calls webhook if set)
    const isBrowser = typeof window !== "undefined";
    const endpoint = isBrowser ? "/api/google-sheets/record" : "http://localhost:3000/api/google-sheets/record";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) {
    console.warn("sendToGoogleSheet local endpoint notice, attempting direct webhook fallback:", err);
    // Direct fallback to Google Apps Script webhook
    try {
      const webhookUrl = getWebhookUrl();
      if (webhookUrl && webhookUrl.startsWith("http")) {
        await fetch(webhookUrl, {
          method: "POST",
          mode: "no-cors",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            action: payload.is_status_update ? "update" : "append",
            is_new_booking: !payload.is_status_update,
          }),
        });
        return { success: true, mode: "direct_webhook_fallback", payload };
      }
    } catch (whErr) {
      console.warn("Direct webhook fallback notice:", whErr);
    }
    return { success: false, error: err.message, payload };
  }
}

/**
 * Convenience helper: Record a completed triage case to Google Sheet immediately as "Call Only"
 */
export async function recordTriageCaseToSheet(caseData = {}, agentObj = null) {
  if (!caseData) return;
  const intake = caseData.intake || {};
  const triage = caseData.triage || {};

  const caseId = String(caseData.case_ref || caseData.id || intake.case_ref || "").trim();
  if (!caseId) return;

  const name = intake.caller_name || intake.name || caseData.caller_name || "Anonymous";
  const phone = intake.phone || caseData.phone || "";
  const rawIp =
    intake.ip_number ||
    intake.ipNumber ||
    intake.ip_no ||
    intake.ipNo ||
    caseData.ip_number ||
    caseData.ipNumber ||
    caseData.ip_no ||
    caseData.ipNo ||
    "";
  const cleanIpDigits = String(rawIp).replace(/[^\d]/g, "").trim();
  const ipNo = (cleanIpDigits && cleanIpDigits.length >= 6)
    ? cleanIpDigits
    : (cleanIpDigits || (String(rawIp).trim() && String(rawIp).trim() !== "N/A" ? String(rawIp).trim() : "N/A"));
  const dispensary =
    triage.referral_destination ||
    caseData.forwarded_to ||
    intake.recommended_facility ||
    "ESIS Dispensary";

  // Extract the exact booking/managing account name (Admin, Agent, Staff)
  let agent = "";
  if (caseData.bookedByName && caseData.bookedByName !== "Agent" && caseData.bookedByName !== "Staff") {
    agent = caseData.bookedByName;
  } else if (caseData.agent_name && caseData.agent_name !== "Agent") {
    agent = caseData.agent_name;
  } else if (caseData.bookedBy && caseData.bookedBy !== "Agent" && caseData.bookedBy !== "Staff") {
    agent = caseData.bookedBy;
  }

  if (!agent || agent === "Agent" || agent === "Staff") {
    if (agentObj) {
      if (typeof agentObj === "string") {
        agent = agentObj;
      } else {
        agent = agentObj.displayName || agentObj.name || agentObj.agentName || (agentObj.email ? agentObj.email.split("@")[0] : "");
      }
    }
  }

  if (!agent || agent === "Agent" || agent === "Staff") {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("ekms_active_agent") || sessionStorage.getItem("ekms_active_agent") || localStorage.getItem("ekms_auth_agent") || localStorage.getItem("crm_user_profile");
        if (raw) {
          const a = JSON.parse(raw);
          agent = a.displayName || a.name || a.agentName || (a.email ? a.email.split("@")[0] : "");
        }
      } catch (_) {}
    }
  }

  if (!agent || agent === "Agent" || agent === "Staff") {
    if (caseData.bookedByEmail || caseData.agent_email) {
      const email = caseData.bookedByEmail || caseData.agent_email;
      const parts = email.split("@")[0].split(/[._\-\s]+/).filter(Boolean);
      agent = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
    }
  }

  if (!agent) {
    agent = caseData.agent || "Triage Desk";
  }
  const finalAgent = (typeof resolveAgentFullName === "function" ? resolveAgentFullName(agent) : agent) || agent;
  const complaint =
    triage.primary_complaint ||
    intake.symptom_notes ||
    intake.complaint ||
    caseData.complaint ||
    "";
  const urgency = triage.urgency_level || caseData.urgency || "Mild";

  const hasBooking = Boolean(caseData.booked_appointment || caseData.appointment);
  const bAppt = caseData.booked_appointment || caseData.appointment;
  const bookingRefId = hasBooking
    ? (bAppt?.tokenNo || bAppt?.referenceNo || bAppt?.token || "")
    : "";

  const clinicalDetails = extractClinicalAndStaffDetails(caseData);
  const caseTime = caseData.created_at || caseData.timestamp || caseData.date || "";

  return await sendToGoogleSheet({
    timestamp: caseTime,
    recordType: hasBooking ? "Booking Done" : "Call Only", // EXACTLY "Call Only" if only triage!
    caseId,
    bookingRefId: hasBooking ? bookingRefId : "", // empty if no booking!
    referenceId: hasBooking ? (bookingRefId || caseId) : caseId,
    name,
    phone,
    ipNo,
    dateTime: hasBooking && bAppt?.date && bAppt?.timeSlot ? `${bAppt.date} ${bAppt.timeSlot}` : "", // empty if no booking!
    dispensaryName: hasBooking ? (bAppt?.facilityName || dispensary) : dispensary,
    agentName: finalAgent,
    complaint,
    clinicalRedFlags: clinicalDetails.clinical_red_flags,
    hpiDuration: clinicalDetails.hpi_duration,
    associatedSymptoms: clinicalDetails.associated_symptoms,
    comorbidity: clinicalDetails.comorbidity,
    anyMedication: clinicalDetails.any_medication,
    receptionBy: clinicalDetails.reception_by,
    prescribedBy: clinicalDetails.prescribed_by,
    dispensedBy: clinicalDetails.dispensed_by,
    followUpStatus: clinicalDetails.follow_up_status,
    followUpDetails: clinicalDetails.follow_up_details,
    urgency,
    status: hasBooking ? "Booking Confirmed" : "Call Only",
    metadata: { case_ref: caseId },
  });
}

export function formatAppointmentStatusForSheet(rawStatus) {
  if (!rawStatus) return "Booking Confirmed";
  const s = String(rawStatus).toLowerCase().trim();
  if (s === "scheduled" || s === "booked" || s === "booking confirmed") return "Booking Confirmed";
  if (s === "with_doctor" || s === "doctor_queue") return "With Doctor";
  if (s === "pharmacy_queue" || s === "with_pharmacy") return "Pharmacy Queue";
  if (s === "completed" || s === "dispensed" || s === "visited") return "Completed";
  if (s === "cancelled") return "Cancelled";
  if (s === "call only") return "Call Only";
  return rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1);
}

/**
 * Convenience helper: Record an appointment booking to Google Sheet
 * @param {any} [apptData]
 * @param {any} [agentObj]
 * @param {string} [caseIdHint]
 */
export async function recordAppointmentBookingToSheet(apptData = {}, agentObj = null, caseIdHint = "") {
  if (!apptData) return;
  const token = apptData.tokenNo || apptData.token || apptData.referenceNo || apptData.id || "";
  let caseId = caseIdHint || apptData.case_ref || apptData.caseId || "";
  if (caseId.startsWith("ESIC-") || caseId.startsWith("DISP-")) {
    caseId = "";
  }
  const resolveFacilityName = (src) => {
    if (!src) return "";
    if (typeof src === "string") return src.trim();
    if (typeof src === "object") {
      return (src.name || src.displayName || src.dispensaryName || src.facilityName || "").trim();
    }
    return String(src).trim();
  };

  const resolveAgentFullName = (rawAgent) => {
    if (!rawAgent) return "";
    let clean = String(rawAgent).trim();
    if (typeof window !== "undefined") {
      try {
        const storedMap = JSON.parse(sessionStorage.getItem("ekms_staff_directory_map") || "{}");
        if (storedMap[clean.toLowerCase()]) return storedMap[clean.toLowerCase()];
        const prefix = clean.split("@")[0].toLowerCase();
        if (storedMap[prefix]) return storedMap[prefix];
      } catch (_) {}
    }
    // If it's dot-separated like "mohsin.ansari", format nicely as "Mohsin Ansari"
    if (clean.includes(".") && !clean.includes(" ") && !clean.includes("@")) {
      return clean
        .split(".")
        .filter(Boolean)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
        .join(" ");
    }
    return clean;
  };

  const apptTime = apptData.createdAt || apptData.bookedAt || apptData.timestamp || (apptData.date && apptData.timeSlot ? `${apptData.date} ${apptData.timeSlot}` : "");
  const name =
    apptData.patientName ||
    apptData.ipName ||
    apptData.callerName ||
    apptData.name ||
    apptData.intake?.caller_name ||
    apptData.intake?.name ||
    "Patient";
  const phone =
    apptData.patientPhone ||
    apptData.phone ||
    apptData.phoneNumber ||
    apptData.mobile ||
    apptData.contact ||
    apptData.intake?.phone ||
    "";
  const cleanDigits = String(phone || "").replace(/\D/g, "");
  const callerId = (typeof apptData !== "undefined" && apptData?.caller_id && !apptData.caller_id.startsWith("CAL-"))
    ? apptData.caller_id
    : ((typeof apptData !== "undefined" && apptData?.callerId && !apptData.callerId.startsWith("CAL-"))
      ? apptData.callerId
      : ((typeof metadata !== "undefined" && metadata?.caller_id && !metadata.caller_id.startsWith("CAL-"))
        ? metadata.caller_id
        : ((typeof metadata !== "undefined" && metadata?.callerId && !metadata.callerId.startsWith("CAL-"))
          ? metadata.callerId
          : (cleanDigits ? getCallerIdForPhone(cleanDigits) : ""))));
  const rawIp =
    apptData.ipNumber ||
    apptData.ip_number ||
    apptData.ipNo ||
    apptData.ip_no ||
    apptData.insuredPersonNo ||
    apptData.insuredPersonNumber ||
    apptData.ip ||
    apptData.intake?.ip_number ||
    apptData.intake?.ipNumber ||
    apptData.intake?.ip_no ||
    apptData.intake?.ipNo ||
    (typeof window !== "undefined" ? localStorage.getItem("ekms_active_ip_number") : "") ||
    "";
  const cleanIpDigits = String(rawIp).replace(/[^\d]/g, "").trim();
  const ipNo = (cleanIpDigits && cleanIpDigits.length >= 6)
    ? cleanIpDigits
    : (cleanIpDigits || (String(rawIp).trim() && String(rawIp).trim() !== "N/A" ? String(rawIp).trim() : "N/A"));
  const apptDate = apptData.date || apptData.appointmentDate || "";
  const apptSlot = apptData.timeSlot || apptData.slot || "";
  const dateTime = `${apptDate} ${apptSlot}`.trim() || formatISTDateTime();
  const dispensary =
    resolveFacilityName(apptData.facilityName) ||
    resolveFacilityName(apptData.dispensaryName) ||
    resolveFacilityName(apptData.targetFacilityName) ||
    resolveFacilityName(apptData.facility) ||
    resolveFacilityName(apptData.dispensary) ||
    resolveFacilityName(apptData.selectedFacility) ||
    "ESIS Dispensary";

  // Extract the exact account name that booked this appointment (Admin or Agent)
  let agent = "";
  if (apptData.bookedByName && apptData.bookedByName !== "Agent" && apptData.bookedByName !== "Staff") {
    agent = apptData.bookedByName;
  } else if (apptData.bookedBy && apptData.bookedBy !== "Agent" && apptData.bookedBy !== "Staff") {
    agent = apptData.bookedBy;
  } else if (apptData.agentName && apptData.agentName !== "Agent" && apptData.agentName !== "Staff") {
    agent = apptData.agentName;
  }

  if (!agent || agent === "Agent" || agent === "Staff") {
    if (agentObj) {
      if (typeof agentObj === "string") {
        agent = agentObj;
      } else {
        agent = agentObj.displayName || agentObj.name || agentObj.agentName || (agentObj.email ? agentObj.email.split("@")[0] : "");
      }
    }
  }

  if (!agent || agent === "Agent" || agent === "Staff") {
    if (typeof window !== "undefined") {
      try {
        const raw = localStorage.getItem("ekms_active_agent") || sessionStorage.getItem("ekms_active_agent") || localStorage.getItem("ekms_auth_agent") || localStorage.getItem("crm_user_profile");
        if (raw) {
          const a = JSON.parse(raw);
          agent = a.displayName || a.name || a.agentName || (a.email ? a.email.split("@")[0] : "");
        }
      } catch (_) {}
    }
  }

  if (!agent || agent === "Agent" || agent === "Staff") {
    if (apptData.bookedByEmail) {
      const parts = apptData.bookedByEmail.split("@")[0].split(/[._\-\s]+/).filter(Boolean);
      agent = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
    }
  }

  if (!agent) {
    agent = apptData.agent || "Triage Agent";
  }

  const finalAgentName = resolveAgentFullName(agent);

  const complaint = apptData.chiefComplaint || apptData.chiefIssue || apptData.complaint || "";
  const clinicalDetails = extractClinicalAndStaffDetails(apptData);

  return await sendToGoogleSheet({
    timestamp: apptTime,
    recordType: "Booking Done",
    caseId,
    bookingRefId: token,
    referenceId: token || caseId,
    callerId,
    caller_id: callerId,
    name,
    phone,
    ipNo,
    dateTime,
    dispensaryName: dispensary,
    agentName: finalAgentName || agent,
    complaint,
    clinicalRedFlags: clinicalDetails.clinical_red_flags,
    hpiDuration: clinicalDetails.hpi_duration,
    associatedSymptoms: clinicalDetails.associated_symptoms,
    comorbidity: clinicalDetails.comorbidity,
    anyMedication: clinicalDetails.any_medication,
    receptionBy: clinicalDetails.reception_by,
    prescribedBy: clinicalDetails.prescribed_by,
    dispensedBy: clinicalDetails.dispensed_by,
    followUpStatus: clinicalDetails.follow_up_status,
    followUpDetails: clinicalDetails.follow_up_details,
    urgency: apptData.urgency || "Booked OPD",
    status: formatAppointmentStatusForSheet(apptData.status),
    metadata: {
      tokenNo: token,
      slot: apptSlot,
      date: apptDate,
      case_ref: caseId,
      is_status_update: Boolean(apptData.is_status_update),
    },
  });
}

/**
 * Convenience helper: Sync an appointment status / reception / prescription / dispensation update to Google Sheet
 * @param {any} [apptData]
 * @param {any} [updates]
 * @param {any} [agentObj]
 */
export async function syncAppointmentUpdateToSheet(apptData = {}, updates = {}, agentObj = null) {
  const merged = { ...apptData, ...updates, is_status_update: true };
  const effectiveCaseId = merged.case_ref || merged.caseId || apptData.case_ref || apptData.caseId || "";
  return await recordAppointmentBookingToSheet(merged, agentObj, effectiveCaseId);
}
