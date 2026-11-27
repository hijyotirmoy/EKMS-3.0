export type AppointmentStatus =
  | "scheduled"      // Incoming / Booked from Triage or Portal - waiting for reception arrival
  | "with_doctor"    // Reception checked-in patient & recorded vitals - waiting for doctor consultation
  | "visited"        // Legacy/alias for with_doctor
  | "pharmacy_queue" // Doctor consultation complete, medicines prescribed - waiting for pharmacy dispensation
  | "completed"      // Pharmacist dispensed medicines - visit fully completed
  | "cancelled";     // Patient or triage cancelled

export interface PrescriptionItem {
  medicineName: string;
  dosage: string;
  frequency: string; // e.g. "1-0-1 (After Food)"
  duration: string;  // e.g. "5 Days"
  instructions?: string;
  dispensed?: boolean;
}

export interface AppointmentVitals {
  bp?: string;
  pulse?: string;
  temp?: string;
  weight?: string;
  spo2?: string;
}

export const CONSULTATION_TYPES = [
  "Maternity Certificate",
  "Sickness Certificate",
  "Referral",
  "Medical Consultation",
] as const;

export type ConsultationType = (typeof CONSULTATION_TYPES)[number];

export interface AppointmentRecord {
  id: string;
  tokenNo: string;
  referenceNo: string;
  ipName: string;
  ipNumber: string;
  phone: string;
  age?: string;
  gender?: string;
  dispensaryName: string;
  dispensaryId?: string;
  location?: string;
  district?: string;
  date: string;
  timeSlot: string;
  department?: string;
  purpose: string;
  chiefComplaint?: string;
  notes?: string;
  status: AppointmentStatus;
  bookedByEmail: string;
  bookedByName: string;
  bookedAt?: string;
  createdAt: number;

  // Aliases for compatibility
  token?: string;
  patientName?: string;
  patientPhone?: string;
  patientAge?: string;
  patientGender?: string;
  appointmentDate?: string;

  // 1. Reception Desk Check-in
  visitedAt?: number;
  visitedBy?: string;
  visitedNotes?: string;
  receptionCheckedInAt?: number;
  receptionCheckedInBy?: string;
  vitals?: AppointmentVitals;

  // 2. Doctor Desk Consultation
  doctorConsultedAt?: number;
  doctorName?: string;
  doctorEmail?: string;
  consultationType?: string;
  diagnosis?: string;
  prescriptions?: PrescriptionItem[];
  doctorNotes?: string;

  // 3. Pharmacy Desk Dispensation
  dispensedAt?: number | string;
  dispensedBy?: string;
  dispensationNotes?: string;

  cancellationReason?: string;
  cancelledAt?: string;
  updatedAt?: number;
  updatedBy?: string;
  source?: string;

  // Clinical Summary Dossier from EKMS Triage
  callerId?: string;
  caller_id?: string;
  clinicalSummary?: string;
  clinicalRecord?: any;
  clinicalOverview?: any;
  redFlags?: (string | { name?: string; label?: string })[];
  past3Calls?: any[];
  pastCallHistory?: any[];
  pastCallsCount?: number;
  triageLevel?: string;
  triageScore?: number | null;
  callType?: string;
  enquiryType?: string;
  chiefIssue?: string;
  remarks?: string;
  appointmentType?: string;
}

export function isNonClinicalAppointment(data: any): boolean {
  if (!data) return false;
  const ct = String(data.callType || data.call_type || "").toLowerCase().trim();
  if (ct === "clinical") return false;
  if (ct === "non_clinical") return true;
  if (data.isNonClinical === false || data.is_non_clinical === false) return false;
  if (data.isNonClinical === true || data.is_non_clinical === true) return true;

  const dept = String(data.department || "").toLowerCase();
  const apptType = String(data.appointmentType || data.appointment_type || "").toLowerCase();
  if (dept.includes("regular opd") || dept.includes("general medicine") || dept.includes("primary care")) return false;
  if (apptType.includes("regular opd")) return false;
  if (dept.includes("non-clinical") || apptType.includes("non-clinical")) return true;

  const sanitizeStr = (val: any) => {
    if (!val || typeof val !== "string") return "";
    const trimmed = val.trim();
    if (/^(na|none|n\/a|select enquiry type|null|undefined)$/i.test(trimmed)) return "";
    return trimmed;
  };

  const enq = sanitizeStr(data.enquiryType) || sanitizeStr(data.enquiry_type);
  if (enq && !/^(regular|clinical|general)/i.test(enq)) return true;

  if (typeof data.clinicalSummary === "string" && data.clinicalSummary.includes("[NON-CLINICAL")) return true;
  
  const purp = typeof data.purpose === "string" ? data.purpose : "";
  const cc = typeof data.chiefComplaint === "string" ? data.chiefComplaint : "";
  const pc = typeof data.primaryComplaint === "string" ? data.primaryComplaint : "";

  if (purp.includes("Non-Clinical") || cc.includes("Non-Clinical") || pc.includes("Non-Clinical")) return true;
  if (
    /\[(cash|medical|maternity|disablement|pension|dependent|grievance|other|general|non-clinical|benefit|scheme|ip)/i.test(purp) ||
    /\[(cash|medical|maternity|disablement|pension|dependent|grievance|other|general|non-clinical|benefit|scheme|ip)/i.test(cc) ||
    /\[(cash|medical|maternity|disablement|pension|dependent|grievance|other|general|non-clinical|benefit|scheme|ip)/i.test(pc)
  ) return true;
  if (
    /benefit|enquiry|grievance|claim|reimbursement/i.test(purp) ||
    /benefit|enquiry|grievance|claim|reimbursement/i.test(cc) ||
    /benefit|enquiry|grievance|claim|reimbursement/i.test(pc)
  ) {
    return true;
  }
  return false;
}

export function extractIpNumber(data: any): string {
  if (!data) return "N/A";
  const raw =
    data.ipNumber ??
    data.ipNo ??
    data.ip_no ??
    data.ip_number ??
    data.esicNumber ??
    data.esicNo ??
    data.esic_no ??
    data.esic_number ??
    data.insuranceNumber ??
    data.insuranceNo ??
    data.insurance_no ??
    data.insuredPersonNumber ??
    data.insured_person_number ??
    data.patientIp ??
    data.patient_ip ??
    data.patientEsic ??
    data.patient_esic ??
    data.beneficiaryId ??
    data.beneficiary_id ??
    data.ip ??
    data.esic ??
    data.clinicalRecord?.ipNumber ??
    data.clinicalRecord?.ipNo ??
    data.clinicalRecord?.esicNumber ??
    data.clinicalOverview?.ipNumber ??
    data.clinicalOverview?.ipNo ??
    data.triageData?.ipNumber ??
    data.triageData?.ipNo ??
    data.triageData?.esicNumber ??
    "";

  if (typeof raw === "string") {
    const s = raw.trim();
    if (s && s.toLowerCase() !== "n/a" && s.toLowerCase() !== "null" && s.toLowerCase() !== "undefined") {
      return s;
    }
  } else if (typeof raw === "number" && !isNaN(raw)) {
    return String(raw);
  }

  // Check if callerId contains an IP number pattern (e.g. IP-1234567890)
  const caller = data.callerId || data.caller_id || "";
  if (typeof caller === "string" && /^IP-?\d+/i.test(caller.trim())) {
    return caller.trim().replace(/^IP-?/i, "");
  }

  return "N/A";
}

export type EffectiveAppointmentStage =
  | "scheduled"        // Awaiting reception arrival & check-in
  | "with_doctor"      // Checked in by reception, waiting for doctor consultation
  | "with_pharmacist"  // Doctor consulted & Rx issued, waiting for pharmacy dispensation
  | "completed"        // Dispensed by pharmacist (or non-clinical finalized at reception)
  | "cancelled";       // Cancelled

export function getEffectiveAppointmentStage(app: any): EffectiveAppointmentStage {
  if (!app) return "scheduled";

  const rawStatus = String(app.status || "").toLowerCase().trim();
  if (rawStatus === "cancelled") return "cancelled";

  // Explicit completion / dispensation
  if (
    rawStatus === "completed" ||
    rawStatus === "dispensed" ||
    Boolean(app.isCompleted) ||
    Boolean(app.completedAt)
  ) {
    return "completed";
  }

  const isNonClin = isNonClinicalAppointment(app);

  // 1. Pharmacist Dispensation / Completed Visit (Enforce Rule 2.2: Doctor must consult before clinical completion)
  const hasDoctorConsulted = Boolean(
    app.doctorName ||
    app.prescribedBy ||
    app.doctor ||
    app.doctorConsultedAt ||
    app.doctorNotes ||
    (app.prescriptions && Array.isArray(app.prescriptions) && app.prescriptions.length > 0)
  );

  const hasDispensed = Boolean(
    (isNonClin || hasDoctorConsulted) && (
      app.dispensedAt ||
      app.dispensedBy ||
      (isNonClin && (app.receptionCheckedInAt || app.receptionCheckedInBy || app.visitedAt || app.visitedBy))
    )
  );
  if (hasDispensed) return "completed";

  // 2. Doctor Consultation done -> Waiting for Pharmacy
  const hasDoctor = Boolean(
    rawStatus === "pharmacy_queue" ||
    rawStatus === "with_pharmacist" ||
    rawStatus === "prescribed" ||
    rawStatus === "consulted" ||
    app.doctorConsultedAt ||
    hasDoctorConsulted
  );
  if (hasDoctor && !isNonClin) return "with_pharmacist";

  // 3. Reception Check-in done -> Waiting for Doctor
  const hasReception = Boolean(
    rawStatus === "with_doctor" ||
    rawStatus === "visited" ||
    rawStatus === "checked_in" ||
    app.receptionCheckedInAt ||
    app.receptionCheckedInBy ||
    app.visitedAt ||
    app.visitedBy
  );
  if (hasReception) return "with_doctor";

  return "scheduled";
}

export function getStatusDisplay(statusOrApp: string | any): {
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
} {
  const stage = typeof statusOrApp === "object" && statusOrApp !== null
    ? getEffectiveAppointmentStage(statusOrApp)
    : (() => {
        const s = String(statusOrApp || "").toLowerCase().trim();
        if (s === "completed" || s === "dispensed") return "completed";
        if (s === "pharmacy_queue" || s === "with_pharmacist") return "with_pharmacist";
        if (s === "with_doctor" || s === "visited") return "with_doctor";
        if (s === "cancelled") return "cancelled";
        return "scheduled";
      })();

  switch (stage) {
    case "with_doctor":
      return {
        label: "WITH DOCTOR",
        bgClass: "bg-blue-50",
        textClass: "text-blue-700",
        borderClass: "border-blue-300",
      };
    case "with_pharmacist":
      return {
        label: "WITH PHARMACIST",
        bgClass: "bg-purple-50",
        textClass: "text-purple-700",
        borderClass: "border-purple-300",
      };
    case "completed":
      return {
        label: "VISIT COMPLETED",
        bgClass: "bg-emerald-50",
        textClass: "text-emerald-700",
        borderClass: "border-emerald-300",
      };
    case "cancelled":
      return {
        label: "CANCELLED",
        bgClass: "bg-rose-50",
        textClass: "text-rose-700",
        borderClass: "border-rose-300",
      };
    case "scheduled":
    default:
      return {
        label: "SCHEDULED",
        bgClass: "bg-amber-50",
        textClass: "text-amber-800",
        borderClass: "border-amber-300",
      };
  }
}

export function normalizeDispensaryName(str: string): string {
  if (!str) return "";
  return str
    .toLowerCase()
    .replace(/\besis\b/g, "")
    .replace(/\besic\b/g, "")
    .replace(/\bdispensary\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function isDispensaryMatch(dispA: string, dispB: string, idA?: string, idB?: string): boolean {
  if (idA && idB && idA === idB) return true;
  if (!dispA || !dispB) return false;
  const cleanA = dispA.toLowerCase().trim();
  const cleanB = dispB.toLowerCase().trim();
  if (cleanA === cleanB || cleanA.includes(cleanB) || cleanB.includes(cleanA)) return true;
  const normA = normalizeDispensaryName(dispA);
  const normB = normalizeDispensaryName(dispB);
  if (normA && normB && (normA === normB || normA.includes(normB) || normB.includes(normA))) return true;
  return false;
}

export function formatStaffTimestamp(val: any): string {
  if (!val) return "";
  try {
    let d: Date | null = null;
    if (typeof val === "object" && typeof val.toDate === "function") {
      d = val.toDate();
    } else if (typeof val === "object" && typeof val.seconds === "number") {
      d = new Date(val.seconds * 1000);
    } else if (typeof val === "number") {
      d = val < 10000000000 ? new Date(val * 1000) : new Date(val);
    } else if (typeof val === "string") {
      const num = Number(val);
      if (!isNaN(num) && num > 1000000000) {
        d = num < 10000000000 ? new Date(num * 1000) : new Date(num);
      } else {
        d = new Date(val);
      }
    }
    if (!d || isNaN(d.getTime())) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${y}-${m}-${day} , ${hours}:${mins}`;
  } catch {
    return "";
  }
}

