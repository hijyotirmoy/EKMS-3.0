import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getCases } from "@/lib/db";
import { getFirestoreDb, getBookingDb } from "@/lib/firebase";
import { collection, getDocs } from "firebase/firestore";
import { extractClinicalAndStaffDetails } from "@/lib/googleSheetsSync";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RECORDS_FILE_PATH = path.join(process.cwd(), "src", "data", "google_sheets_records.json");
const GOOGLE_SHEET_ID = "1be-yMMFGcXJToYbQI3KJnadURgjWeGncGmxGbJzFLso";
const GOOGLE_SHEET_URL =
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

export async function POST(request) {
  try {
    const defaultWebhook =
      "https://script.google.com/macros/s/AKfycbzzk3DPzW9urW_i350_Kq5Sm1rPw9pcha6pEafuTowHH1Vcbl08vRxWX89qnlJgTjQP6w/exec";
    let webhookUrl =
      process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
      process.env.NEXT_PUBLIC_GOOGLE_SHEETS_WEBHOOK_URL ||
      defaultWebhook;

    try {
      const body = await request.json();
      if (body?.webhook_url) webhookUrl = body.webhook_url.trim();
    } catch (_) {}

    // 1. Gather all cases
    const allCases = await getCases({ urgency: "all" });

    // 2. Gather all appointments
    let allAppointments = [];
    try {
      const db = getFirestoreDb() || getBookingDb();
      if (db) {
        const snap = await getDocs(collection(db, "dispensary_appointments"));
        snap.forEach((d) => allAppointments.push({ id: d.id, ...d.data() }));
      }
    } catch (e) {
      console.warn("Sync fetch appointments warning:", e.message);
    }

    const recordsMap = new Map();

    // Map all cases
    allCases.forEach((c) => {
      const ref = String(c.case_ref || c.id || "").trim();
      if (!ref) return;
      const intake = c.intake || {};
      const triage = c.triage || {};

      const hasBooking = Boolean(c.booked_appointment || c.appointment);
      const bAppt = c.booked_appointment || c.appointment;
      const bookingRefId = hasBooking ? String(bAppt?.tokenNo || bAppt?.referenceNo || bAppt?.token || "").trim() : "";
      const clinical = extractClinicalAndStaffDetails(c);

      const record = {
        timestamp: formatIST(c.created_at || c.date || Date.now()),
        record_type: hasBooking ? "Booking Done" : "Call Only",
        case_id: ref,
        booking_ref_id: bookingRefId, // Empty string if triage only!
        reference_id: hasBooking ? (bookingRefId || ref) : "", // Strictly empty if Call Only!
        name: intake.caller_name || intake.name || c.caller_name || "Anonymous",
        phone_no: intake.phone || c.phone || "",
        ip_no: intake.ip_no || intake.ipNo || c.ip_no || "N/A",
        date_time: hasBooking && bAppt?.date && bAppt?.timeSlot
          ? `${bAppt.date} ${bAppt.timeSlot}`
          : "", // Strictly empty if Call Only!
        dispensary_name:
          bAppt?.facilityName ||
          bAppt?.dispensaryName ||
          triage.referral_destination ||
          c.forwarded_to ||
          "ESIS Dispensary",
        agent_name: c.agent_name || c.agent || "Agent",
        chief_complaint: triage.primary_complaint || intake.symptom_notes || intake.complaint || "",
        clinical_red_flags: clinical.clinical_red_flags || "None reported",
        hpi_duration: clinical.hpi_duration || "Reported today",
        associated_symptoms: clinical.associated_symptoms || "None reported",
        comorbidity: clinical.comorbidity || "None reported",
        any_medication: clinical.any_medication || "None reported",
        urgency_level: triage.urgency_level || c.urgency || "Mild",
        status: hasBooking ? "Booking Confirmed" : "Call Only",
        reception_by: clinical.reception_by || "—",
        prescribed_by: clinical.prescribed_by || "—",
        dispensed_by: clinical.dispensed_by || "—",
        follow_up_status: clinical.follow_up_status || "None",
        follow_up_details: clinical.follow_up_details || "—",
        permanent_flag: "PERMANENT_NO_DELETE",
      };

      recordsMap.set(ref.toLowerCase(), record);
    });

    // Map appointments: merge with matching case or keep single standalone row
    allAppointments.forEach((a) => {
      const token = String(a.tokenNo || a.referenceNo || a.id || "").trim();
      if (!token) return;

      const aClinical = extractClinicalAndStaffDetails(a);
      const matchedCaseKey = String(a.case_ref || a.referenceNo || "").toLowerCase().trim();
      const rawIp = a.ipNo || a.ip_no || a.ipNumber || a.ip_number || "";
      const cleanIp = String(rawIp).replace(/[^\d]/g, "").trim();

      // Check if existing case matches by case key or by IP
      let existing = null;
      if (matchedCaseKey && recordsMap.has(matchedCaseKey)) {
        existing = recordsMap.get(matchedCaseKey);
      } else if (cleanIp && cleanIp.length >= 6 && cleanIp !== "N/A") {
        for (const r of recordsMap.values()) {
          const rIp = String(r.ip_no || "").replace(/[^\d]/g, "").trim();
          if (rIp && rIp === cleanIp) {
            existing = r;
            break;
          }
        }
      }

      if (existing) {
        // Upgrade existing triage case in-place to Booking Done! Never duplicate!
        existing.record_type = "Booking Done";
        existing.booking_ref_id = token;
        existing.reference_id = token || existing.case_id || "";
        existing.status = a.status ? String(a.status).toUpperCase() : "Booking Confirmed";
        if (a.date && a.timeSlot) existing.date_time = `${a.date} ${a.timeSlot}`;
        if (a.facilityName || a.dispensaryName) existing.dispensary_name = a.facilityName || a.dispensaryName;
        if (a.patientName) existing.name = a.patientName;
        if (a.phone) existing.phone_no = a.phone;
        if (cleanIp && cleanIp.length >= 6) existing.ip_no = cleanIp;
        if (aClinical.reception_by && aClinical.reception_by !== "—") existing.reception_by = aClinical.reception_by;
        if (aClinical.prescribed_by && aClinical.prescribed_by !== "—") existing.prescribed_by = aClinical.prescribed_by;
        if (aClinical.dispensed_by && aClinical.dispensed_by !== "—") existing.dispensed_by = aClinical.dispensed_by;
        if (aClinical.follow_up_status && aClinical.follow_up_status !== "None") existing.follow_up_status = aClinical.follow_up_status;
        if (aClinical.follow_up_details && aClinical.follow_up_details !== "—") existing.follow_up_details = aClinical.follow_up_details;
        if (aClinical.clinical_red_flags && aClinical.clinical_red_flags !== "None reported" && existing.clinical_red_flags === "None reported") {
          existing.clinical_red_flags = aClinical.clinical_red_flags;
        }
        return;
      }

      // Check if any case already has this booking token
      for (const existingRec of recordsMap.values()) {
        if (existingRec.booking_ref_id && existingRec.booking_ref_id.toLowerCase() === token.toLowerCase()) {
          if (aClinical.reception_by && aClinical.reception_by !== "—") existingRec.reception_by = aClinical.reception_by;
          if (aClinical.prescribed_by && aClinical.prescribed_by !== "—") existingRec.prescribed_by = aClinical.prescribed_by;
          if (aClinical.dispensed_by && aClinical.dispensed_by !== "—") existingRec.dispensed_by = aClinical.dispensed_by;
          if (aClinical.follow_up_status && aClinical.follow_up_status !== "None") existingRec.follow_up_status = aClinical.follow_up_status;
          if (aClinical.follow_up_details && aClinical.follow_up_details !== "—") existingRec.follow_up_details = aClinical.follow_up_details;
          if (a.status) existingRec.status = String(a.status).toUpperCase();
          return; // Already accounted for
        }
      }

      const record = {
        timestamp: formatIST(a.createdAt || a.created_at || Date.now()),
        record_type: "Booking Done",
        case_id: String(a.case_ref || a.caseId || "").trim(),
        booking_ref_id: token,
        reference_id: token,
        name: a.patientName || a.callerName || a.name || "Patient",
        phone_no: a.phone || a.phoneNumber || "",
        ip_no: (cleanIp && cleanIp.length >= 6) ? cleanIp : (a.ipNo || a.ip_no || "N/A"),
        date_time: `${a.date || ""} ${a.timeSlot || a.slot || ""}`.trim() || formatIST(a.createdAt),
        dispensary_name: a.facilityName || a.dispensaryName || "ESIS Dispensary",
        agent_name: a.agentName || a.agent || "Agent",
        chief_complaint: a.chiefComplaint || a.chiefIssue || a.complaint || "",
        clinical_red_flags: aClinical.clinical_red_flags || "None reported",
        hpi_duration: aClinical.hpi_duration || "Reported today",
        associated_symptoms: aClinical.associated_symptoms || "None reported",
        comorbidity: aClinical.comorbidity || "None reported",
        any_medication: aClinical.any_medication || "None reported",
        urgency_level: a.urgency || "Booked OPD",
        status: a.status ? a.status.toUpperCase() : "SCHEDULED",
        reception_by: aClinical.reception_by || "—",
        prescribed_by: aClinical.prescribed_by || "—",
        dispensed_by: aClinical.dispensed_by || "—",
        follow_up_status: aClinical.follow_up_status || "None",
        follow_up_details: aClinical.follow_up_details || "—",
        permanent_flag: "PERMANENT_NO_DELETE",
      };

      recordsMap.set(token.toLowerCase(), record);
    });

    const synchronizedList = Array.from(recordsMap.values());

    // Save to permanent file
    const dir = path.dirname(RECORDS_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RECORDS_FILE_PATH, JSON.stringify(synchronizedList, null, 2), "utf8");

    // If webhook is provided, batch send or test send
    let webhookDeliveries = 0;
    if (webhookUrl && webhookUrl.startsWith("http")) {
      try {
        // Send bulk or array
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(6000),
          body: JSON.stringify({
            action: "batch_sync",
            records: synchronizedList,
          }),
        });
        if (res.ok) webhookDeliveries = synchronizedList.length;
      } catch (whErr) {
        console.warn("Webhook bulk sync error:", whErr.message);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Synchronized ${synchronizedList.length} permanent records`,
      total_records: synchronizedList.length,
      cases_count: allCases.length,
      appointments_count: allAppointments.length,
      webhook_url_configured: Boolean(webhookUrl),
      webhook_delivered_count: webhookDeliveries,
      sheet_id: GOOGLE_SHEET_ID,
      sheet_url: GOOGLE_SHEET_URL,
    });
  } catch (err) {
    console.error("POST /api/google-sheets/sync error:", err);
    return NextResponse.json({ detail: err.message }, { status: 500 });
  }
}
