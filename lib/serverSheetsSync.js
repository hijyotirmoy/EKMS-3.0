import fs from "fs";
import path from "path";
import { getFirestoreDb } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { extractClinicalAndStaffDetails } from "@/lib/googleSheetsSync";

function getRecordsFilePath() {
  const directPath = path.join(process.cwd(), "data", "google_sheets_records.json");
  if (fs.existsSync(directPath)) return directPath;
  const srcPath = path.join(process.cwd(), "src", "data", "google_sheets_records.json");
  if (fs.existsSync(srcPath)) return srcPath;
  return directPath;
}
const RECORDS_FILE_PATH = getRecordsFilePath();
export const GOOGLE_SHEET_ID = "1be-yMMFGcXJToYbQI3KJnadURgjWeGncGmxGbJzFLso";
export const GOOGLE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1be-yMMFGcXJToYbQI3KJnadURgjWeGncGmxGbJzFLso/edit?usp=sharing";

function formatIST(dateVal) {
  try {
    if (!dateVal) return "";
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
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
    return String(dateVal);
  }
}

export function appendServerSheetRecord(record) {
  try {
    let list = [];
    if (fs.existsSync(RECORDS_FILE_PATH)) {
      try {
        const content = fs.readFileSync(RECORDS_FILE_PATH, "utf8");
        list = JSON.parse(content);
        if (!Array.isArray(list)) list = [];
      } catch (_) {
        list = [];
      }
    }

    const caseId = (record.case_id || record.reference_id || "").trim();
    const bookingRefId = (record.booking_ref_id || "").trim();
    const cleanIp = String(record.ip_no || "").replace(/[^\d]/g, "").trim();

    // Find if record already exists by IP (if valid), case_id, or booking_ref_id to ensure single row per patient/case
    const existingIndex = list.findIndex((r) => {
      if (cleanIp && cleanIp.length >= 6 && cleanIp !== "N/A") {
        const rIp = String(r.ip_no || "").replace(/[^\d]/g, "").trim();
        if (rIp && rIp === cleanIp) return true;
      }
      if (caseId && r.case_id && r.case_id.toLowerCase() === caseId.toLowerCase()) return true;
      if (bookingRefId && r.booking_ref_id && r.booking_ref_id.toLowerCase() === bookingRefId.toLowerCase()) return true;
      if (caseId && r.reference_id && r.reference_id.toLowerCase() === caseId.toLowerCase()) return true;
      if (bookingRefId && r.reference_id && r.reference_id.toLowerCase() === bookingRefId.toLowerCase()) return true;
      return false;
    });

    if (existingIndex >= 0) {
      // Merge into the single existing row
      const prev = list[existingIndex];
      const mergedIp = (cleanIp && cleanIp.length >= 6) ? cleanIp : ((record.ip_no && record.ip_no !== "N/A") ? record.ip_no : (prev.ip_no || "N/A"));
      const isNowBooking = Boolean(
        record.record_type === "Booking Done" ||
        bookingRefId ||
        prev.record_type === "Booking Done" ||
        prev.booking_ref_id
      );

      const pickNonEmpty = (newVal, oldVal, fallback = "—") => {
        if (newVal && newVal !== "—" && newVal !== "None reported" && newVal !== "None" && newVal !== "N/A") return newVal;
        return oldVal || newVal || fallback;
      };

      list[existingIndex] = {
        ...prev,
        ...record,
        timestamp: prev.timestamp || record.timestamp,
        record_type: isNowBooking ? "Booking Done" : (prev.record_type || record.record_type || "Call Only"),
        case_id: caseId || prev.case_id || "",
        booking_ref_id: isNowBooking ? (bookingRefId || prev.booking_ref_id || "") : "",
        reference_id: isNowBooking ? (bookingRefId || record.reference_id || prev.booking_ref_id || prev.reference_id || "") : (caseId || prev.case_id || ""),
        ip_no: mergedIp,
        date_time: isNowBooking ? (record.date_time || prev.date_time || "") : "",
        dispensary_name: record.dispensary_name || prev.dispensary_name || "ESIS Dispensary",
        status: isNowBooking ? (record.status !== "Call Only" ? record.status : (prev.status !== "Call Only" ? prev.status : "Booking Confirmed")) : "Call Only",
        clinical_red_flags: pickNonEmpty(record.clinical_red_flags, prev.clinical_red_flags, "None reported"),
        hpi_duration: pickNonEmpty(record.hpi_duration, prev.hpi_duration, "Reported today"),
        associated_symptoms: pickNonEmpty(record.associated_symptoms, prev.associated_symptoms, "None reported"),
        comorbidity: pickNonEmpty(record.comorbidity, prev.comorbidity, "None reported"),
        any_medication: pickNonEmpty(record.any_medication, prev.any_medication, "None reported"),
        reception_by: pickNonEmpty(record.reception_by, prev.reception_by, "—"),
        prescribed_by: pickNonEmpty(record.prescribed_by, prev.prescribed_by, "—"),
        dispensed_by: pickNonEmpty(record.dispensed_by, prev.dispensed_by, "—"),
        follow_up_status: pickNonEmpty(record.follow_up_status, prev.follow_up_status, "None"),
        follow_up_details: pickNonEmpty(record.follow_up_details, prev.follow_up_details, "—"),
        updated_at: new Date().toISOString(),
      };
    } else {
      const isBooking = Boolean(bookingRefId || record.record_type === "Booking Done");
      list.push({
        ...record,
        record_type: isBooking ? "Booking Done" : "Call Only",
        case_id: caseId,
        booking_ref_id: isBooking ? bookingRefId : "",
        reference_id: isBooking ? (bookingRefId || record.reference_id || caseId) : "",
        date_time: isBooking ? (record.date_time || "") : "",
        status: isBooking ? (record.status || "Booking Confirmed") : "Call Only",
        clinical_red_flags: record.clinical_red_flags || "None reported",
        hpi_duration: record.hpi_duration || "Reported today",
        associated_symptoms: record.associated_symptoms || "None reported",
        comorbidity: record.comorbidity || "None reported",
        any_medication: record.any_medication || "None reported",
        reception_by: record.reception_by || "—",
        prescribed_by: record.prescribed_by || "—",
        dispensed_by: record.dispensed_by || "—",
        follow_up_status: record.follow_up_status || "None",
        follow_up_details: record.follow_up_details || "—",
        created_at: new Date().toISOString(),
      });
    }

    const dir = path.dirname(RECORDS_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RECORDS_FILE_PATH, JSON.stringify(list, null, 2), "utf8");

    // Also persist to Firestore permanent collection
    try {
      const db = getFirestoreDb();
      const primaryDocId = caseId || bookingRefId || record.reference_id;
      if (db && primaryDocId) {
        const cleanRef = String(primaryDocId).replace(/[^a-zA-Z0-9_-]/g, "_");
        const docId = `record_${cleanRef}`;
        setDoc(doc(db, "google_sheets_records", docId), record, { merge: true }).catch(() => {});
      }
    } catch (_) {}

    // Also forward to Google Apps Script Webhook if configured
    const defaultWebhook = "https://script.google.com/macros/s/AKfycbzzk3DPzW9urW_i350_Kq5Sm1rPw9pcha6pEafuTowHH1Vcbl08vRxWX89qnlJgTjQP6w/exec";
    const webhookUrl =
      process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
      process.env.NEXT_PUBLIC_GOOGLE_SHEETS_WEBHOOK_URL ||
      defaultWebhook;
    if (webhookUrl && webhookUrl.startsWith("http")) {
      fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(6000),
        body: JSON.stringify(record),
      }).catch(() => {});
    }

    return record;
  } catch (err) {
    console.warn("appendServerSheetRecord notice:", err.message);
    return null;
  }
}

export function logCaseToSheetServer(caseData) {
  if (!caseData) return;
  const intake = caseData.intake || {};
  const triage = caseData.triage || {};

  const caseId = String(caseData.case_ref || caseData.id || intake.case_ref || "").trim();
  if (!caseId) return;

  const hasBooking = Boolean(caseData.booked_appointment || caseData.appointment);
  const bAppt = caseData.booked_appointment || caseData.appointment;
  const bookingRefId = hasBooking
    ? String(bAppt?.tokenNo || bAppt?.referenceNo || bAppt?.token || bAppt?.id || "").trim()
    : "";

  const rawIp =
    intake.ip_number ||
    intake.ipNumber ||
    intake.ip_no ||
    intake.ipNo ||
    caseData.ip_number ||
    caseData.ipNumber ||
    caseData.ip_no ||
    caseData.ipNo ||
    bAppt?.ip_number ||
    bAppt?.ipNumber ||
    bAppt?.ipNo ||
    bAppt?.ip_no ||
    "";
  const cleanIpDigits = String(rawIp).replace(/[^\d]/g, "").trim();
  const finalIpNo = (cleanIpDigits && cleanIpDigits.length >= 6)
    ? cleanIpDigits
    : (cleanIpDigits || (String(rawIp).trim() && String(rawIp).trim() !== "N/A" ? String(rawIp).trim() : "N/A"));

    const clinicalDetails = extractClinicalAndStaffDetails(caseData);

  const record = {
    timestamp: formatIST(caseData.created_at || caseData.date || Date.now()),
    record_type: hasBooking ? "Booking Done" : "Call Only",
    case_id: caseId,
    booking_ref_id: bookingRefId, // empty if triage only!
    reference_id: hasBooking ? (bookingRefId || caseId) : "", // empty if Call Only!
    name: intake.caller_name || intake.name || caseData.caller_name || "Anonymous",
    phone_no: intake.phone || caseData.phone || "",
    ip_no: finalIpNo,
    date_time: hasBooking && bAppt?.date && bAppt?.timeSlot
      ? `${bAppt.date} ${bAppt.timeSlot}`
      : "", // empty if Call Only!
    dispensary_name:
      bAppt?.facilityName ||
      bAppt?.dispensaryName ||
      triage.referral_destination ||
      caseData.forwarded_to ||
      "ESIS Dispensary",
    agent_name: caseData.agent_name || caseData.agent || "Agent",
    chief_complaint: triage.primary_complaint || intake.symptom_notes || intake.complaint || "",
    clinical_red_flags: clinicalDetails.clinical_red_flags || "None reported",
    hpi_duration: clinicalDetails.hpi_duration || "Reported today",
    associated_symptoms: clinicalDetails.associated_symptoms || "None reported",
    comorbidity: clinicalDetails.comorbidity || "None reported",
    any_medication: clinicalDetails.any_medication || "None reported",
    urgency_level: triage.urgency_level || caseData.urgency || "Mild",
    status: hasBooking ? "Booking Confirmed" : "Call Only",
    reception_by: clinicalDetails.reception_by || "—",
    prescribed_by: clinicalDetails.prescribed_by || "—",
    dispensed_by: clinicalDetails.dispensed_by || "—",
    follow_up_status: clinicalDetails.follow_up_status || "None",
    follow_up_details: clinicalDetails.follow_up_details || "—",
    permanent_flag: "PERMANENT_NO_DELETE",
  };

  return appendServerSheetRecord(record);
}
