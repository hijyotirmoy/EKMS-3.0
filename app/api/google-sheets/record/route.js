import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getFirestoreDb } from "@/lib/firebase";
import { doc, setDoc } from "firebase/firestore";
import { generateNextCaseRef } from "@/lib/caseId";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RECORDS_FILE_PATH = path.join(process.cwd(), "data", "google_sheets_records.json");
const GOOGLE_SHEET_ID = "1be-yMMFGcXJToYbQI3KJnadURgjWeGncGmxGbJzFLso";
const GOOGLE_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/1be-yMMFGcXJToYbQI3KJnadURgjWeGncGmxGbJzFLso/edit?usp=sharing";

function readLocalRecords() {
  try {
    if (fs.existsSync(RECORDS_FILE_PATH)) {
      const content = fs.readFileSync(RECORDS_FILE_PATH, "utf8");
      const parsed = JSON.parse(content);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch (e) {
    console.warn("readLocalRecords error:", e.message);
  }
  return [];
}

function appendLocalRecord(record) {
  try {
    const list = readLocalRecords();
    const caseId = (record.case_id || (record.reference_id?.startsWith("CA") ? record.reference_id : "")).trim();
    const bookingRefId = (record.booking_ref_id || (record.reference_id?.startsWith("ESI") ? record.reference_id : "")).trim();
    const cleanIp = String(record.ip_no || "").replace(/[^\d]/g, "").trim();
    const cleanPhone = String(record.phone_no || "").replace(/\D/g, "").trim();

    // STRICT APPEND-AT-TOP GUARANTEE:
    // Every new booking submission ALWAYS prepends a brand new row at the top of the Google Sheet.
    // An existing row is ONLY updated when an explicit update/status-change flag is passed
    // (e.g. from Reception check-in, Doctor consultation, Pharmacy dispensation) matching THAT EXACT TOKEN.
    // Bookings for the same patient or phone number NEVER overwrite older bookings.
    const isExplicitUpdate = Boolean(
      record.is_status_update ||
      record._isStatusUpdate ||
      record.is_update ||
      record.action === "update"
    );

    let existingIndex = -1;
    if (isExplicitUpdate && bookingRefId) {
      existingIndex = list.findIndex((r) => {
        const rBookingId = String(r.booking_ref_id || (r.reference_id?.startsWith("ESI") ? r.reference_id : "")).trim();
        return rBookingId && rBookingId.toLowerCase() === bookingRefId.toLowerCase();
      });
    } else if (isExplicitUpdate && caseId && record.record_type === "Call Only") {
      existingIndex = list.findIndex((r) => {
        const rCaseId = String(r.case_id || (r.reference_id?.startsWith("CA") ? r.reference_id : "")).trim();
        return rCaseId && rCaseId.toLowerCase() === caseId.toLowerCase() && r.record_type === "Call Only";
      });
    }

    let finalRecord = record;

    if (existingIndex >= 0) {
      // Update ONLY status and dispensary milestone fields in-place for this specific token
      const prev = list[existingIndex];
      const mergedIp = (cleanIp && cleanIp.length >= 6) ? cleanIp : ((record.ip_no && record.ip_no !== "N/A") ? record.ip_no : (prev.ip_no || "N/A"));

      const pickNonEmpty = (newVal, oldVal, fallback = "—") => {
        if (newVal && newVal !== "—" && newVal !== "â€”" && newVal !== "None reported" && newVal !== "None" && newVal !== "N/A") return newVal;
        return oldVal || newVal || fallback;
      };

      const pickDispensary = (newVal, oldVal) => {
        const cleanNew = String(newVal || "").trim();
        const cleanOld = String(oldVal || "").trim();
        if (cleanNew && cleanNew !== "ESIS Dispensary" && cleanNew !== "—") return cleanNew;
        if (cleanOld && cleanOld !== "ESIS Dispensary" && cleanOld !== "—") return cleanOld;
        return cleanNew || cleanOld || "ESIS Dispensary";
      };

      finalRecord = {
        ...prev,
        ...record,
        timestamp: prev.timestamp || record.timestamp,
        record_type: prev.record_type || record.record_type || "Booking Done",
        case_id: prev.case_id || caseId || "",
        booking_ref_id: prev.booking_ref_id || bookingRefId || "",
        reference_id: prev.reference_id || bookingRefId || record.reference_id || "",
        ip_no: mergedIp,
        date_time: prev.date_time || record.date_time || "",
        dispensary_name: pickDispensary(record.dispensary_name, prev.dispensary_name),
        agent_name: prev.agent_name || record.agent_name || "Agent",
        chief_complaint: prev.chief_complaint || record.chief_complaint || "",
        status: record.status || prev.status || "Booking Confirmed",
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
      list[existingIndex] = finalRecord;
    } else {
      const isBooking = Boolean(bookingRefId || record.record_type === "Booking Done");
      finalRecord = {
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
      };
      // Always place new bookings at the very top of the list
      list.unshift(finalRecord);
    }

    const dir = path.dirname(RECORDS_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(RECORDS_FILE_PATH, JSON.stringify(list, null, 2), "utf8");
    return { list, record: finalRecord };
  } catch (e) {
    console.error("appendLocalRecord error:", e.message);
    return { list: [], record };
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");

  const records = readLocalRecords();

  if (format === "csv") {
    const headers = [
      "Timestamp (IST)",
      "Record Type",
      "Case ID",
      "Booking Reference ID",
      "Patient / Caller Name",
      "Phone No",
      "IP No",
      "Date & Time (Slot / Call)",
      "Dispensary / Facility",
      "Agent Name",
      "Chief Complaint / Reason",
      "Clinical Red Flags",
      "History of Present Illness(from how long it happening)",
      "Associated Symptoms",
      "Comorbidity",
      "Any medication",
      "Triage Urgency / Severity",
      "Status",
      "Reception by",
      "Prescribed by",
      "Dispensed by",
      "Follow-up Status",
      "Follow-up Details",
      "Permanent Audit Lock",
    ];

    const rows = records.map((r) => {
      const isCallOnly = r.record_type === "Call Only";
      const caseIdVal = r.case_id || (r.reference_id?.startsWith("CA") ? r.reference_id : "");
      const bookingVal = isCallOnly ? "" : (r.booking_ref_id || (r.reference_id?.startsWith("ESIC-") ? r.reference_id : ""));
      return [
        `"${String(r.timestamp || "").replace(/"/g, '""')}"`,
        `"${String(r.record_type || (isCallOnly ? "Call Only" : "Booking Done")).replace(/"/g, '""')}"`,
        `"${String(caseIdVal || "").replace(/"/g, '""')}"`,
        `"${String(bookingVal || "").replace(/"/g, '""')}"`,
        `"${String(r.name || "").replace(/"/g, '""')}"`,
        `"${String(r.phone_no || "").replace(/"/g, '""')}"`,
        `"${String(r.ip_no || "").replace(/"/g, '""')}"`,
        `"${isCallOnly ? "" : String(r.date_time || "").replace(/"/g, '""')}"`,
        `"${String(r.dispensary_name || "").replace(/"/g, '""')}"`,
        `"${String(r.agent_name || "").replace(/"/g, '""')}"`,
        `"${String(r.chief_complaint || "").replace(/"/g, '""')}"`,
        `"${String(r.clinical_red_flags || "None reported").replace(/"/g, '""')}"`,
        `"${String(r.hpi_duration || "Reported today").replace(/"/g, '""')}"`,
        `"${String(r.associated_symptoms || "None reported").replace(/"/g, '""')}"`,
        `"${String(r.comorbidity || "None reported").replace(/"/g, '""')}"`,
        `"${String(r.any_medication || "None reported").replace(/"/g, '""')}"`,
        `"${String(r.urgency_level || "").replace(/"/g, '""')}"`,
        `"${String(isCallOnly ? "Call Only" : (r.status || "Booking Confirmed")).replace(/"/g, '""')}"`,
        `"${String(r.reception_by || "—").replace(/"/g, '""')}"`,
        `"${String(r.prescribed_by || "—").replace(/"/g, '""')}"`,
        `"${String(r.dispensed_by || "—").replace(/"/g, '""')}"`,
        `"${String(r.follow_up_status || "None").replace(/"/g, '""')}"`,
        `"${String(r.follow_up_details || "—").replace(/"/g, '""')}"`,
        `"${String(r.permanent_flag || "LOCKED_IMMUTABLE").replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");

    return new Response(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ekms_triage_google_sheet_export_${Date.now()}.csv"`,
      },
    });
  }

  return NextResponse.json({
    sheet_id: GOOGLE_SHEET_ID,
    sheet_url: GOOGLE_SHEET_URL,
    total_records: records.length,
    records,
  });
}

export async function POST(request) {
  try {
    const body = await request.json();
    let caseId = (body.case_id || (body.reference_id?.startsWith("CA") ? body.reference_id : "")).trim();
    if (caseId.startsWith("ESI-") || caseId.startsWith("ESIC-") || caseId.startsWith("DISP-")) {
      caseId = "";
    }
    const isStatusUpdate = Boolean(body.is_status_update || body._isStatusUpdate || body.is_update || body.action === "update");

    // Ensure new bookings/calls ALWAYS have a unique monotonic Case ID (floor >= CA0251AB01)
    // Never allow empty case_id on new entries so Google Apps Script never collides with historical rows
    if (!caseId && !isStatusUpdate) {
      caseId = generateNextCaseRef();
    }
    const bookingRefId = (body.booking_ref_id || (body.reference_id?.startsWith("ESI") ? body.reference_id : "")).trim();

    if (!caseId && !bookingRefId && !body?.reference_id) {
      return NextResponse.json(
        { detail: "case_id or booking_ref_id is required for permanent sheet recording" },
        { status: 400 }
      );
    }

    const isBooking = Boolean(bookingRefId || body.record_type === "Booking Done");
    const cleanPhone = String(body.phone_no || body.phone || "").replace(/\D/g, "");
    const callerId = body.caller_id || body.callerId || (cleanPhone.length >= 10 ? `CAL-${cleanPhone.slice(-10)}` : (cleanPhone ? `CAL-${cleanPhone}` : ""));
    const rawIp =
      body.ip_no ||
      body.ipNo ||
      body.ip_number ||
      body.ipNumber ||
      body.intake?.ip_number ||
      body.intake?.ipNumber ||
      "";
    const cleanIpDigits = String(rawIp).replace(/[^\d]/g, "").trim();
    const finalIpNo = (cleanIpDigits && cleanIpDigits.length >= 6)
      ? cleanIpDigits
      : (cleanIpDigits || (String(rawIp).trim() && String(rawIp).trim() !== "N/A" ? String(rawIp).trim() : "N/A"));

    const rawDispensary =
      body.dispensary_name ||
      body.facility_name ||
      body.facilityName ||
      body.dispensaryName ||
      body.facility ||
      body.target_facility ||
      body.targetFacility ||
      body.recommended_facility ||
      "";
    const cleanDispensary = typeof rawDispensary === "object"
      ? (rawDispensary.name || rawDispensary.displayName || "")
      : String(rawDispensary || "").trim();
    const finalDispensaryName = (cleanDispensary && cleanDispensary !== "ESIS Dispensary")
      ? cleanDispensary
      : (cleanDispensary || "ESIS Dispensary");

    const record = {
      timestamp: body.timestamp || new Date().toISOString(),
      record_type: isBooking ? "Booking Done" : "Call Only",
      case_id: caseId,
      booking_ref_id: isBooking ? bookingRefId : "", // Strictly empty if no booking!
      reference_id: isBooking ? (bookingRefId || caseId || "") : caseId,
      caller_id: callerId,
      callerId: callerId,
      name: body.name || body.patientName || body.ipName || body.callerName || "Anonymous",
      phone_no: body.phone_no || body.phone || body.patientPhone || "",
      ip_no: finalIpNo,
      date_time: isBooking ? (body.date_time || "") : "", // Empty if Call Only!
      dispensary_name: finalDispensaryName,
      agent_name: body.agent_name || body.agentName || body.bookedByName || "Agent",
      chief_complaint: body.chief_complaint || body.chiefComplaint || body.complaint || "",
      clinical_red_flags: body.clinical_red_flags || body.clinicalRedFlags || "None reported",
      hpi_duration: body.hpi_duration || body.hpiDuration || "Reported today",
      associated_symptoms: body.associated_symptoms || body.associatedSymptoms || "None reported",
      comorbidity: body.comorbidity || "None reported",
      any_medication: body.any_medication || body.anyMedication || body.medications || "None reported",
      urgency_level: body.urgency_level || "Mild",
      status: isBooking ? (body.status || "Booking Confirmed") : "Call Only",
      reception_by: body.reception_by || body.receptionBy || "—",
      prescribed_by: body.prescribed_by || body.prescribedBy || "—",
      dispensed_by: body.dispensed_by || body.dispensedBy || "—",
      follow_up_status: body.follow_up_status || body.followUpStatus || "None",
      follow_up_details: body.follow_up_details || body.followUpDetails || "—",
      is_status_update: Boolean(body.is_status_update || body._isStatusUpdate || body.is_update || body.action === "update"),
      permanent_flag: "PERMANENT_NO_DELETE",
    };

    // 1. Append/merge to local server permanent JSON log (single row per case)
    const { record: finalRecord } = appendLocalRecord(record);

    // 2. Persist to Firestore (permanent collection that is never purged)
    try {
      const db = getFirestoreDb();
      if (db) {
        const primaryRef = finalRecord.case_id || finalRecord.booking_ref_id || finalRecord.reference_id;
        const cleanRef = primaryRef.replace(/[^a-zA-Z0-9_-]/g, "_");
        const docId = `record_${cleanRef}`;
        await setDoc(doc(db, "google_sheets_records", docId), finalRecord, { merge: true });
      }
    } catch (fsErr) {
      console.warn("Firestore sheets log warning:", fsErr.message);
    }

    // 3. Forward to Google Apps Script Webhook with timeout protection and retry
    const defaultWebhook =
      "https://script.google.com/macros/s/AKfycbzzk3DPzW9urW_i350_Kq5Sm1rPw9pcha6pEafuTowHH1Vcbl08vRxWX89qnlJgTjQP6w/exec";
    const webhookUrl =
      body.webhook_url ||
      process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
      process.env.NEXT_PUBLIC_GOOGLE_SHEETS_WEBHOOK_URL ||
      defaultWebhook;

    let webhookStatus = "skipped_no_webhook";
    let webhookResponse = null;

    if (webhookUrl && webhookUrl.startsWith("http")) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            redirect: "follow",
            signal: AbortSignal.timeout(15000),
            body: JSON.stringify({
              ...finalRecord,
              action: finalRecord.is_status_update ? "update" : "append",
              is_new_booking: !finalRecord.is_status_update,
            }),
          });
          webhookStatus = res.ok ? "delivered" : `error_${res.status}`;
          try {
            webhookResponse = await res.text();
          } catch (_) {}
          if (res.ok) break;
        } catch (whErr) {
          webhookStatus = `network_error: ${whErr.message}`;
          if (attempt === 2) {
            console.warn("Webhook delivery retry error:", whErr.message);
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: "Record permanently saved to Google Sheets audit repository",
      record: finalRecord,
      webhook_status: webhookStatus,
      webhook_response: webhookResponse,
      sheet_url: GOOGLE_SHEET_URL,
    });
  } catch (err) {
    console.error("POST /api/google-sheets/record error:", err);
    return NextResponse.json(
      { detail: `Failed to record to sheets: ${err.message}` },
      { status: 500 }
    );
  }
}
