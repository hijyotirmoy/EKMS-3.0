"use client";

import React, { useState, useRef } from "react";
import {
  X,
  UploadCloud,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Calendar,
  Building2,
  User,
  Phone,
  FileText,
  Stethoscope,
  Pill,
  UserCheck,
} from "lucide-react";
import { doc, setDoc } from "firebase/firestore";
import { bookingDb, oldBookingDb, db, casesSettingsDb } from "@/lib/firebase";
import { getEffectiveAppointmentStage } from "@/lib/appointmentTypes";

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  currentUser?: any;
}

export const APPOINTMENT_TEMPLATE_COLUMNS = [
  "Token / Ref",
  "Caller ID",
  "Patient / IP Name",
  "Phone Number",
  "IP Number",
  "Age",
  "Gender",
  "Target Dispensary",
  "District",
  "OPD Slot Date",
  "OPD Slot Time",
  "Chief Complaint",
  "Booking Date & Time",
  "Booked By",
  "Status",
  "Reception Check-in By",
  "Reception Check-in Time",
  "Doctor Prescribed By",
  "Doctor Prescribed Time",
  "Doctor Notes",
  "Pharmacy Dispensed By",
  "Pharmacy Dispensed Time",
  "Dispensation Notes",
  "Notes",
];

export const TEMPLATE_SAMPLE_ROWS = [
  {
    "Token / Ref": "ESI-000001-DISP",
    "Caller ID": "CID0021A006",
    "Patient / IP Name": "NABAKANTA DEKA",
    "Phone Number": "8749973006",
    "IP Number": "8100776891",
    "Age": "44",
    "Gender": "Male",
    "Target Dispensary": "ESIS Dispensary, Amingaon",
    "District": "Kamrup Rural",
    "OPD Slot Date": "2026-11-20",
    "OPD Slot Time": "10:18 AM - 10:21 AM",
    "Chief Complaint": "Fever & Body Ache",
    "Booking Date & Time": "20 Nov 2026, 09:45 am",
    "Booked By": "ankita.barichowa",
    "Status": "COMPLETED",
    "Reception Check-in By": "Bimal Haloi",
    "Reception Check-in Time": "20 Nov 2026, 10:15 am",
    "Doctor Prescribed By": "Dr Deep Ranjan",
    "Doctor Prescribed Time": "20 Nov 2026, 10:25 am",
    "Doctor Notes": "Viral flu suspected, prescribed Paracetamol 650mg and Cetirizine",
    "Pharmacy Dispensed By": "Jerifa Begum",
    "Pharmacy Dispensed Time": "20 Nov 2026, 10:40 am",
    "Dispensation Notes": "All 2 medicines dispensed in full",
    "Notes": "Past completed visit fully fulfilled",
  },
  {
    "Token / Ref": "ESI-000002-DISP",
    "Caller ID": "CID0020A286",
    "Patient / IP Name": "riyazuddin saikia",
    "Phone Number": "9854131286",
    "IP Number": "4301207458",
    "Age": "25",
    "Gender": "Male",
    "Target Dispensary": "ESIS Dispensary, Amingaon",
    "District": "Kamrup Rural",
    "OPD Slot Date": "2026-11-20",
    "OPD Slot Time": "10:21 AM - 10:24 AM",
    "Chief Complaint": "Stomach Pain & Acidity",
    "Booking Date & Time": "20 Nov 2026, 09:50 am",
    "Booked By": "mohsin.ansari",
    "Status": "WITH PHARMACIST",
    "Reception Check-in By": "Bimal Haloi",
    "Reception Check-in Time": "20 Nov 2026, 10:20 am",
    "Doctor Prescribed By": "Dr Deep Ranjan",
    "Doctor Prescribed Time": "20 Nov 2026, 10:35 am",
    "Doctor Notes": "Gastritis, prescribed Pantoprazole and Antacid syrup",
    "Pharmacy Dispensed By": "",
    "Pharmacy Dispensed Time": "",
    "Dispensation Notes": "",
    "Notes": "Consulted by doctor, pending pharmacy dispensation",
  },
  {
    "Token / Ref": "ESI-000003-DISP",
    "Caller ID": "CID0020A907",
    "Patient / IP Name": "Pankaj Bardhan",
    "Phone Number": "9707920907",
    "IP Number": "4301101729",
    "Age": "36",
    "Gender": "Male",
    "Target Dispensary": "ESIS Dispensary, Amingaon",
    "District": "Kamrup Rural",
    "OPD Slot Date": "2026-11-20",
    "OPD Slot Time": "10:24 AM - 10:27 AM",
    "Chief Complaint": "Joint Pain (Knee)",
    "Booking Date & Time": "20 Nov 2026, 09:55 am",
    "Booked By": "kaushik.das",
    "Status": "WITH DOCTOR",
    "Reception Check-in By": "Bimal Haloi",
    "Reception Check-in Time": "20 Nov 2026, 10:25 am",
    "Doctor Prescribed By": "",
    "Doctor Prescribed Time": "",
    "Doctor Notes": "",
    "Pharmacy Dispensed By": "",
    "Pharmacy Dispensed Time": "",
    "Dispensation Notes": "",
    "Notes": "Checked in at reception, waiting for doctor consultation",
  },
  {
    "Token / Ref": "",
    "Caller ID": "CID0022A091",
    "Patient / IP Name": "Bhupen Barman",
    "Phone Number": "9707115091",
    "IP Number": "4301533960",
    "Age": "30",
    "Gender": "Male",
    "Target Dispensary": "ESIS Dispensary, Amingaon",
    "District": "Kamrup Rural",
    "OPD Slot Date": "2026-11-28",
    "OPD Slot Time": "10:27 AM - 10:30 AM",
    "Chief Complaint": "Skin Allergy & Rashes",
    "Booking Date & Time": "27 Nov 2026, 02:00 pm",
    "Booked By": "Triage Desk",
    "Status": "SCHEDULED",
    "Reception Check-in By": "",
    "Reception Check-in Time": "",
    "Doctor Prescribed By": "",
    "Doctor Prescribed Time": "",
    "Doctor Notes": "",
    "Pharmacy Dispensed By": "",
    "Pharmacy Dispensed Time": "",
    "Dispensation Notes": "",
    "Notes": "Token left blank - system will auto-assign sequential token ESI-00000X-DISP",
  },
  {
    "Token / Ref": "ESI-000004-DISP",
    "Caller ID": "CID0017A185",
    "Patient / IP Name": "Riju Amhed",
    "Phone Number": "8638236185",
    "IP Number": "4301954020",
    "Age": "36",
    "Gender": "Male",
    "Target Dispensary": "ESIS Dispensary, Amingaon",
    "District": "Kamrup Rural",
    "OPD Slot Date": "2026-11-20",
    "OPD Slot Time": "10:30 AM - 10:33 AM",
    "Chief Complaint": "[Reimbursement] Claim Submission",
    "Booking Date & Time": "20 Nov 2026, 10:00 am",
    "Booked By": "Triage Desk",
    "Status": "COMPLETED",
    "Reception Check-in By": "Bimal Haloi",
    "Reception Check-in Time": "20 Nov 2026, 10:18 am",
    "Doctor Prescribed By": "",
    "Doctor Prescribed Time": "",
    "Doctor Notes": "N/A - Non-clinical reimbursement verified",
    "Pharmacy Dispensed By": "",
    "Pharmacy Dispensed Time": "",
    "Dispensation Notes": "N/A - Non-clinical document verification completed",
    "Notes": "Non-clinical claim submission fulfilled at reception",
  },
];

export async function downloadBulkUploadTemplate() {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.json_to_sheet(TEMPLATE_SAMPLE_ROWS);
  const colWidths = Object.keys(TEMPLATE_SAMPLE_ROWS[0] || {}).map((key) => ({
    wch: Math.max(key.length + 4, 18),
  }));
  worksheet["!cols"] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Appointments_Template");
  XLSX.writeFile(workbook, "EKMS_Dispensary_Appointments_Bulk_Upload_Template.xlsx");
}

function parseExcelDate(val: any): string {
  if (!val) return "";
  if (typeof val === "string") {
    const s = val.trim();
    // YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    // DD/MM/YYYY or DD-MM-YYYY
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
      const day = dmy[1].padStart(2, "0");
      const month = dmy[2].padStart(2, "0");
      const year = dmy[3];
      return `${year}-${month}-${day}`;
    }
  } else if (typeof val === "number" && !isNaN(val)) {
    // Excel numeric date serial
    try {
      const utc_days = Math.floor(val - 25569);
      const utc_value = utc_days * 86400;
      const date_info = new Date(utc_value * 1000);
      const year = date_info.getUTCFullYear();
      const month = String(date_info.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date_info.getUTCDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    } catch (_) {}
  }
  return String(val).trim();
}

function parseExcelTimestamp(val: any, fallbackDateStr: string = ""): number | null {
  if (!val) return null;
  if (typeof val === "number") {
    // If epoch ms
    if (val > 100000000000) return val;
    // Excel serial date+time
    try {
      const ms = Math.round((val - 25569) * 86400 * 1000);
      if (!isNaN(ms) && ms > 0) return ms;
    } catch (_) {}
  }
  if (typeof val === "string") {
    const s = val.trim();
    // Try native date parse
    const parsed = Date.parse(s);
    if (!isNaN(parsed) && parsed > 0) return parsed;
    // Try parsing "20 Nov 2026, 10:15 am" or similar
    const clean = s.replace(/,\s*/, " ");
    const p2 = Date.parse(clean);
    if (!isNaN(p2) && p2 > 0) return p2;
  }
  if (fallbackDateStr) {
    const pFallback = Date.parse(fallbackDateStr);
    if (!isNaN(pFallback)) return pFallback;
  }
  return null;
}

export function BulkUploadModal({
  isOpen,
  onClose,
  onSuccess,
  currentUser,
}: BulkUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<any[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const [uploadResult, setUploadResult] = useState<{
    success: boolean;
    count: number;
    errors: string[];
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    setFile(selected);
    setUploadResult(null);
    setIsParsing(true);

    try {
      const XLSX = await import("xlsx");
      const buffer = await selected.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const rawJson = XLSX.utils.sheet_to_json<any>(sheet);

      if (!rawJson || rawJson.length === 0) {
        alert("The selected Excel file is empty or contains no data rows.");
        setIsParsing(false);
        return;
      }

      // Map rows (handles both Template column names and Exported column names)
      const normalized = rawJson.map((row, index) => {
        const token = String(
          row["Token / Ref"] ||
          row["Token"] ||
          row["tokenNo"] ||
          row["referenceNo"] ||
          row["Reference ID"] ||
          row["Booking Reference ID"] ||
          ""
        ).trim();

        const patientName = String(
          row["Patient / IP Name"] ||
          row["Patient Name"] ||
          row["IP Name"] ||
          row["name"] ||
          row["patientName"] ||
          row["ipName"] ||
          ""
        ).trim();

        const phone = String(
          row["Phone Number"] ||
          row["Phone"] ||
          row["phone_no"] ||
          row["phone"] ||
          row["patientPhone"] ||
          ""
        ).replace(/\D/g, "");

        const ipNumber = String(
          row["IP Number"] ||
          row["IP No"] ||
          row["ip_no"] ||
          row["ipNumber"] ||
          row["esicNumber"] ||
          "N/A"
        ).trim();

        const callerId = String(
          row["Caller ID"] ||
          row["CallerId"] ||
          row["caller_id"] ||
          row["callerId"] ||
          ""
        ).trim();

        const age = String(row["Age"] || row["age"] || "").trim();
        const gender = String(row["Gender"] || row["gender"] || "Male").trim();

        const dispensary = String(
          row["Target Dispensary"] ||
          row["Dispensary"] ||
          row["facilityName"] ||
          row["dispensaryName"] ||
          row["dispensary_name"] ||
          "ESIS Dispensary, Amingaon"
        ).trim();

        const district = String(row["District"] || row["district"] || "Kamrup Rural").trim();

        // OPD Schedule
        const rawDate = row["OPD Slot Date"] || row["Date"] || row["date"] || "";
        const rawSchedule = row["OPD Slot Schedule"] || "";
        let date = parseExcelDate(rawDate);
        let timeSlot = String(row["OPD Slot Time"] || row["Time Slot"] || row["timeSlot"] || "").trim();

        if (!date && rawSchedule) {
          const parts = String(rawSchedule).split("Slot:");
          date = parseExcelDate(parts[0].trim());
          if (parts[1]) timeSlot = parts[1].trim();
        }

        const chiefComplaint = String(
          row["Chief Complaint"] ||
          row["Purpose"] ||
          row["chief_complaint"] ||
          row["purpose"] ||
          "General OPD Consultation"
        ).trim();

        // Status
        const rawStatus = String(row["Status"] || row["status"] || "SCHEDULED").toLowerCase().trim();

        // Staff milestones
        const bookedBy = String(row["Booked By"] || row["bookedByName"] || row["agent_name"] || "Administrator").trim();
        const bookedAt = String(row["Booking Date & Time"] || row["bookedAt"] || row["timestamp"] || "").trim();

        const receptionBy = String(row["Reception Check-in By"] || row["Reception Check-in"] || row["receptionCheckedInBy"] || "").trim();
        const rawReceptionTime = row["Reception Check-in Time"] || "";

        const doctorBy = String(row["Doctor Prescribed By"] || row["Doctor Prescribed"] || row["doctorName"] || "").trim();
        const rawDoctorTime = row["Doctor Prescribed Time"] || "";
        const doctorNotes = String(row["Doctor Notes"] || row["doctorNotes"] || "").trim();

        const pharmacistBy = String(row["Pharmacy Dispensed By"] || row["Pharmacy Dispensed"] || row["dispensedBy"] || "").trim();
        const rawPharmacistTime = row["Pharmacy Dispensed Time"] || "";
        const dispensationNotes = String(row["Dispensation Notes"] || row["dispensationNotes"] || "").trim();

        const notes = String(row["Notes"] || row["remarks"] || "").trim();

        return {
          rowNum: index + 2,
          token,
          callerId,
          patientName,
          phone,
          ipNumber,
          age,
          gender,
          dispensary,
          district,
          date,
          timeSlot,
          chiefComplaint,
          rawStatus,
          bookedBy,
          bookedAt,
          receptionBy,
          rawReceptionTime,
          doctorBy,
          rawDoctorTime,
          doctorNotes,
          pharmacistBy,
          rawPharmacistTime,
          dispensationNotes,
          notes,
          isValid: Boolean(patientName && (phone || ipNumber !== "N/A")),
        };
      });

      setParsedRows(normalized);
    } catch (err: any) {
      alert("Failed to parse Excel file: " + (err.message || "Unknown error"));
    } finally {
      setIsParsing(false);
    }
  };

  const handleExecuteUpload = async () => {
    if (!parsedRows || parsedRows.length === 0) return;
    setIsUploading(true);
    setUploadProgress({ current: 0, total: parsedRows.length });

    let successCount = 0;
    const errors: string[] = [];

    // Fetch latest sequence number in case tokens are generated
    let currentSeq = 170;
    try {
      const seqRes = await fetch("/api/appointments/next-token");
      if (seqRes.ok) {
        const seqData = await seqRes.json();
        if (seqData.seq) currentSeq = seqData.seq;
      }
    } catch (_) {}

    for (let i = 0; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      setUploadProgress({ current: i + 1, total: parsedRows.length });

      if (!row.patientName) {
        errors.push(`Row ${row.rowNum}: Missing Patient Name`);
        continue;
      }

      try {
        let finalToken = String(row.token || "").trim();
        if (finalToken.toUpperCase().startsWith("ESIC-")) {
          finalToken = finalToken.replace(/^ESIC-/i, "ESI-");
        }
        if (!finalToken) {
          finalToken = `ESI-${String(currentSeq).padStart(6, "0")}-DISP`;
          currentSeq++;
        }

        const docId = finalToken.replace(/[^a-zA-Z0-9_-]/g, "_");
        const appDate = row.date || new Date().toISOString().slice(0, 10);
        const bookedAtMs = parseExcelTimestamp(row.bookedAt, appDate) || Date.now();
        const receptionAtMs = parseExcelTimestamp(row.rawReceptionTime, appDate);
        const doctorAtMs = parseExcelTimestamp(row.rawDoctorTime, appDate);
        const dispensedAtMs = parseExcelTimestamp(row.rawPharmacistTime, appDate);

        // Derive authoritative stage
        const isCompleted =
          row.rawStatus.includes("complete") ||
          row.rawStatus.includes("dispense") ||
          Boolean(row.pharmacistBy || dispensedAtMs);

        const isWithDoctor =
          row.rawStatus.includes("doctor") ||
          Boolean(row.receptionBy || receptionAtMs);

        const isWithPharmacist =
          row.rawStatus.includes("pharm") ||
          Boolean(row.doctorBy || doctorAtMs);

        let finalStatus = "scheduled";
        if (isCompleted) finalStatus = "completed";
        else if (isWithPharmacist) finalStatus = "pharmacy_queue";
        else if (isWithDoctor) finalStatus = "with_doctor";
        else if (row.rawStatus.includes("cancel")) finalStatus = "cancelled";

        const isNonClinical =
          row.chiefComplaint.toLowerCase().includes("[reimbursement]") ||
          row.chiefComplaint.toLowerCase().includes("claim") ||
          row.chiefComplaint.toLowerCase().includes("enquiry") ||
          row.chiefComplaint.toLowerCase().includes("non-clinical");

        const payload: any = {
          id: docId,
          tokenNo: finalToken,
          referenceNo: finalToken,
          patientName: row.patientName,
          ipName: row.patientName,
          phone: row.phone,
          patientPhone: row.phone,
          ipNumber: row.ipNumber,
          ipNo: row.ipNumber,
          esicNumber: row.ipNumber,
          callerId: row.callerId || null,
          age: row.age || "35",
          gender: row.gender || "Male",
          facilityName: row.dispensary,
          dispensaryName: row.dispensary,
          district: row.district || "Kamrup Rural",
          date: appDate,
          timeSlot: row.timeSlot || "10:00 AM - 10:05 AM",
          chiefComplaint: row.chiefComplaint,
          purpose: row.chiefComplaint,
          status: finalStatus,
          isNonClinical,
          callType: isNonClinical ? "non_clinical" : "clinical",
          bookedByName: row.bookedBy || currentUser?.displayName || "Administrator",
          bookedByEmail: currentUser?.email || "admin@ekms.in",
          bookedAt: row.bookedAt || new Date(bookedAtMs).toLocaleString("en-IN"),
          createdAt: bookedAtMs,
          updatedAt: dispensedAtMs || doctorAtMs || receptionAtMs || bookedAtMs,
          notes: row.notes || "",
        };

        // Reception fields
        if (row.receptionBy || receptionAtMs) {
          payload.receptionCheckedInBy = row.receptionBy || "Dispensary Reception";
          payload.receptionCheckedInAt = receptionAtMs || bookedAtMs;
          payload.visitedBy = payload.receptionCheckedInBy;
          payload.visitedAt = payload.receptionCheckedInAt;
        }

        // Doctor fields
        if (row.doctorBy || doctorAtMs || isWithPharmacist || isCompleted) {
          payload.doctorName = row.doctorBy || "Dr Deep Ranjan";
          payload.doctor = payload.doctorName;
          payload.prescribedBy = payload.doctorName;
          payload.doctorConsultedAt = doctorAtMs || (receptionAtMs ? receptionAtMs + 600000 : bookedAtMs + 600000);
          payload.doctorNotes = row.doctorNotes || "General OPD Consultation & Medication Prescribed";
          payload.consultationType = "Medical Consultation";
        }

        // Pharmacy fields
        if (row.pharmacistBy || dispensedAtMs || isCompleted) {
          payload.dispensedBy = row.pharmacistBy || "Jerifa Begum";
          payload.pharmacistName = payload.dispensedBy;
          payload.dispensedAt = dispensedAtMs || (doctorAtMs ? doctorAtMs + 600000 : bookedAtMs + 1200000);
          payload.dispensationNotes = row.dispensationNotes || "Medications dispensed in full";
          payload.isCompleted = true;
          payload.completedAt = payload.dispensedAt;
        }

        // Write directly to triage-booking DB, casesSettingsDb, and safety backup ekmsbooking DB
        await setDoc(doc(bookingDb, "dispensary_appointments", docId), payload, { merge: true });
        if (casesSettingsDb) {
          try {
            await setDoc(doc(casesSettingsDb, "dispensary_appointments", docId), payload, { merge: true });
          } catch (_) {}
        }
        if (oldBookingDb) {
          try {
            await setDoc(doc(oldBookingDb, "dispensary_appointments", docId), payload, { merge: true });
          } catch (_) {}
        }
        try {
          await setDoc(doc(db, "dispensary_appointments", docId), payload, { merge: true });
        } catch (_) {}

        // Log and sync to Google Sheets
        fetch("/api/google-sheets/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timestamp: payload.bookedAt,
            record_type: "Booking Done",
            case_id: "",
            booking_ref_id: payload.tokenNo,
            reference_id: payload.tokenNo,
            caller_id: payload.callerId || "",
            name: payload.patientName,
            phone_no: payload.phone,
            ip_no: payload.ipNumber,
            date_time: `${payload.date} ${payload.timeSlot}`.trim(),
            dispensary_name: payload.dispensaryName,
            agent_name: payload.bookedByName,
            chief_complaint: payload.chiefComplaint,
            status: payload.status === "completed" ? "Completed" : "Booking Confirmed",
          }),
        }).catch(() => {});

        successCount++;
      } catch (err: any) {
        errors.push(`Row ${row.rowNum} (${row.patientName}): ${err.message}`);
      }
    }

    // Broadcast update across browser tabs
    try {
      localStorage.setItem("ekms_bulk_uploaded_timestamp", String(Date.now()));
      if (typeof window !== "undefined" && typeof (window as any).BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("ekms_triage_sync_v1");
        channel.postMessage({ type: "APPOINTMENTS_SYNCED", timestamp: Date.now() });
      }
    } catch (_) {}

    setIsUploading(false);
    setUploadResult({
      success: errors.length === 0,
      count: successCount,
      errors,
    });

    if (successCount > 0 && onSuccess) {
      onSuccess();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-2xs">
              <UploadCloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-900">Bulk Upload Appointments</h2>
              <p className="text-xs text-slate-500 font-medium">
                Upload historical or batch appointments across any past, present, or future dates.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={downloadBulkUploadTemplate}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 text-emerald-800 rounded-xl text-xs font-bold transition shadow-2xs cursor-pointer active:scale-95"
              title="Download pre-filled Excel template with examples"
            >
              <Download className="w-3.5 h-3.5 text-emerald-600" />
              <span>Download Template</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Instructions Box */}
          <div className="bg-blue-50/60 border border-blue-200/80 rounded-2xl p-4 text-xs text-blue-900 space-y-2">
            <div className="font-bold flex items-center gap-1.5 text-blue-950">
              <FileSpreadsheet className="w-4 h-4 text-blue-600" />
              <span>Bulk Upload Guide & Capabilities:</span>
            </div>
            <ul className="list-disc pl-5 space-y-1 text-slate-700 font-medium">
              <li>
                <strong>Any Date Supported:</strong> You can upload appointments for past dates (e.g. 2026-11-20), today, or future dates.
              </li>
              <li>
                <strong>All Stages Supported:</strong> Specify who checked in at Reception, who consulted (Doctor), and who dispensed (Pharmacist) with their exact timestamps.
              </li>
              <li>
                <strong>Automatic Multi-Module Sync:</strong> Uploaded appointments will immediately appear in <strong>Dispensary Appointments</strong>, <strong>Agent Appointments</strong>, <strong>Reception Desk</strong>, <strong>Doctor Desk</strong>, and <strong>Pharmacy Desk</strong> based on their status.
              </li>
              <li>
                <strong>Automatic Token Generation:</strong> If <em>Token / Ref</em> is left blank in your Excel sheet, the system will automatically allocate the next clean sequential token.
              </li>
            </ul>
          </div>

          {/* File Upload Zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-slate-300 hover:border-indigo-500 rounded-2xl p-6 text-center cursor-pointer transition-all bg-slate-50/30 hover:bg-indigo-50/20 group"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="w-12 h-12 mx-auto rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-3 group-hover:scale-105 transition-transform">
              <UploadCloud className="w-6 h-6" />
            </div>
            <div className="text-sm font-bold text-slate-800">
              {file ? file.name : "Click to select or drag & drop Excel / CSV file"}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Supports .xlsx, .xls, and .csv files formatted with the template columns.
            </p>
          </div>

          {/* Parsing Spinner */}
          {isParsing && (
            <div className="flex items-center justify-center py-8 gap-2 text-indigo-600 font-bold text-sm">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Parsing Excel sheet rows...</span>
            </div>
          )}

          {/* Upload Progress */}
          {isUploading && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-indigo-950">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  <span>Uploading appointments to database...</span>
                </span>
                <span>
                  {uploadProgress.current} / {uploadProgress.total} (
                  {Math.round((uploadProgress.current / uploadProgress.total) * 100)}%)
                </span>
              </div>
              <div className="w-full bg-indigo-200/60 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-150"
                  style={{
                    width: `${Math.round((uploadProgress.current / uploadProgress.total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}

          {/* Result Banner */}
          {uploadResult && (
            <div
              className={`p-4 rounded-2xl border text-xs ${
                uploadResult.success
                  ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                  : "bg-amber-50 border-amber-300 text-amber-900"
              }`}
            >
              <div className="font-bold flex items-center gap-1.5 text-sm">
                {uploadResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                )}
                <span>
                  {uploadResult.count} appointment(s) uploaded successfully!
                </span>
              </div>
              {uploadResult.errors.length > 0 && (
                <div className="mt-2 space-y-1 text-slate-700 pl-5 list-disc">
                  {uploadResult.errors.slice(0, 5).map((e, idx) => (
                    <div key={idx}>{e}</div>
                  ))}
                  {uploadResult.errors.length > 5 && (
                    <div>...and {uploadResult.errors.length - 5} more issues.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Parsed Rows Preview Table */}
          {parsedRows.length > 0 && !isUploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-black text-slate-700 uppercase tracking-wider">
                  File Preview ({parsedRows.length} Rows Detected)
                </div>
                <div className="text-xs font-bold text-slate-500">
                  {parsedRows.filter((r) => r.isValid).length} Valid •{" "}
                  {parsedRows.filter((r) => !r.isValid).length} Needs Attention
                </div>
              </div>

              <div className="border border-slate-200 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Token / Ref</th>
                      <th className="py-2 px-3">Patient</th>
                      <th className="py-2 px-3">Phone</th>
                      <th className="py-2 px-3">Date & Slot</th>
                      <th className="py-2 px-3">Target Dispensary</th>
                      <th className="py-2 px-3">Stage / Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRows.slice(0, 15).map((r, idx) => (
                      <tr key={idx} className={r.isValid ? "hover:bg-slate-50/50" : "bg-rose-50/40"}>
                        <td className="py-2 px-3 font-mono text-slate-400">{r.rowNum}</td>
                        <td className="py-2 px-3 font-mono font-bold text-teal-800">
                          {r.token || <span className="text-slate-400 italic">Auto</span>}
                        </td>
                        <td className="py-2 px-3 font-bold text-slate-800">{r.patientName || "—"}</td>
                        <td className="py-2 px-3 text-slate-600">{r.phone || "—"}</td>
                        <td className="py-2 px-3 text-slate-600">
                          {r.date} {r.timeSlot ? `(${r.timeSlot})` : ""}
                        </td>
                        <td className="py-2 px-3 text-slate-600 truncate max-w-[150px]">{r.dispensary}</td>
                        <td className="py-2 px-3 font-bold">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                              r.rawStatus.includes("complete")
                                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                : r.rawStatus.includes("pharm")
                                ? "bg-purple-50 text-purple-700 border border-purple-200"
                                : r.rawStatus.includes("doctor")
                                ? "bg-blue-50 text-blue-700 border border-blue-200"
                                : "bg-amber-50 text-amber-800 border border-amber-200"
                            }`}
                          >
                            {r.rawStatus}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {parsedRows.length > 15 && (
                <div className="text-[11px] text-slate-400 text-center italic">
                  Showing first 15 of {parsedRows.length} rows...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-xs font-bold text-slate-600 transition cursor-pointer"
          >
            Cancel
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={parsedRows.length === 0 || isUploading}
              onClick={handleExecuteUpload}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-50 text-white text-xs font-bold shadow-xs transition cursor-pointer active:scale-95"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Uploading {uploadProgress.current}/{uploadProgress.total}...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>Upload & Save {parsedRows.length} Appointments</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BulkUploadModal;
