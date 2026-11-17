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
}

export function getStatusDisplay(status: string): {
  label: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
} {
  switch (status) {
    case "with_doctor":
    case "visited":
      return {
        label: "WITH DOCTOR",
        bgClass: "bg-blue-50",
        textClass: "text-blue-700",
        borderClass: "border-blue-300",
      };
    case "pharmacy_queue":
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
