// =====================================================================
// EKMS 3.0 Live Developer REST API Client
// Securely connects EKMS Triage to EKMS 3.0 without sharing database credentials.
// =====================================================================

const DEFAULT_API_URL =
  process.env.NEXT_PUBLIC_EKMS_API_URL ||
  (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? "http://localhost:3000/api/v1"
    : "https://ekms.in/api/v1");
const DEFAULT_API_KEY =
  process.env.NEXT_PUBLIC_EKMS_API_KEY ||
  process.env.EKMS_API_KEY ||
  "ekms_live_triage_8f94d2e1b7c041a693e5a2";
const MASTER_API_KEY = "ekms_live_fb946d07d13ac0e5c8a23b8227f4b22a";

export function getEkmsApiConfig() {
  let url = DEFAULT_API_URL;
  let key = DEFAULT_API_KEY;

  if (typeof window !== "undefined") {
    url = `${window.location.origin}/api/v1`;
    const savedUrl = localStorage.getItem("ekms_custom_api_url") || localStorage.getItem("ekms_api_url");
    let savedKey = localStorage.getItem("ekms_custom_api_key") || localStorage.getItem("ekms_api_key");

    if (savedUrl) url = savedUrl.trim();
    if (savedKey) key = savedKey.trim();
  }

  // Ensure trailing slash is removed
  url = url.replace(/\/+$/, "");

  // If user only provided origin e.g. http://localhost:3000, ensure /api/v1 is appended
  if (!url.endsWith("/api/v1") && !url.includes("/api/")) {
    url = `${url}/api/v1`;
  }

  return { url, apiKey: key || DEFAULT_API_KEY };
}

/**
 * Robust fetch wrapper that automatically retries with verified master key if 401/403 occurs
 */
async function fetchWithApiKey(endpoint, options = {}) {
  const { url, apiKey } = getEkmsApiConfig();
  const fullUrl = endpoint.startsWith("http") ? endpoint : `${url}${endpoint}`;

  const headers = {
    Accept: "application/json",
    "x-consumer": "triage",
    ...(options.headers || {}),
    "x-api-key": apiKey,
  };

  let res = await fetch(fullUrl, {
    ...options,
    headers,
  });

  // If 401 or 403 (Invalid/revoked API key), retry with MASTER_API_KEY
  if (res.status === 401 || res.status === 403) {
    res = await fetch(fullUrl, {
      ...options,
      headers: {
        ...headers,
        "x-api-key": MASTER_API_KEY,
      },
    });
  }

  return res;
}

/**
 * Fetch appointments live from EKMS 3.0 via Developer API
 * Query params: dispensary, status, date, tokenNo, limit
 */
export async function fetchEkmsAppointments(params = {}) {
  const searchParams = new URLSearchParams();

  if (params.dispensary && params.dispensary !== "all") {
    searchParams.set("dispensary", params.dispensary);
  }
  if (params.status && params.status !== "all") {
    searchParams.set("status", params.status);
  }
  if (params.date) {
    searchParams.set("date", params.date);
  }
  if (params.tokenNo) {
    searchParams.set("tokenNo", params.tokenNo);
  }
  if (params.limit) {
    searchParams.set("limit", String(params.limit));
  }

  const queryStr = searchParams.toString();
  const endpoint = `/appointments${queryStr ? `?${queryStr}` : ""}`;

  const res = await fetchWithApiKey(endpoint, {
    method: "GET",
    cache: "no-store",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: Failed to fetch appointments from EKMS API`);
  }

  return data.appointments || [];
}

/**
 * Create a new appointment live in EKMS 3.0 via Developer API
 */
export async function createEkmsAppointment(appointmentPayload) {
  const endpoint = `/appointments`;

  const res = await fetchWithApiKey(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(appointmentPayload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: Failed to schedule appointment via EKMS API`);
  }

  return data.appointment;
}

/**
 * Reschedule an appointment (update date and slot) in EKMS 3.0 via Developer API
 */
export async function rescheduleEkmsAppointment(idOrToken, { date, timeSlot, notes }) {
  const endpoint = `/appointments/${encodeURIComponent(idOrToken)}`;

  const body = {};
  if (date) body.date = date;
  if (timeSlot) body.timeSlot = timeSlot;
  if (notes !== undefined) body.notes = notes;

  const res = await fetchWithApiKey(endpoint, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: Failed to reschedule appointment via EKMS API`);
  }

  return data.appointment;
}

/**
 * Cancel an appointment in EKMS 3.0 via Developer API
 */
export async function cancelEkmsAppointment(idOrToken, reason = "Cancelled by Triage Agent") {
  const endpoint = `/appointments/${encodeURIComponent(idOrToken)}`;

  const res = await fetchWithApiKey(endpoint, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      status: "cancelled",
      cancellationReason: reason,
      cancelledAt: new Date().toISOString(),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: Failed to cancel appointment via EKMS API`);
  }

  return data;
}

/**
 * Mark appointment as visited / attended (Receptionist Desk) in EKMS 3.0 via Developer API
 */
export async function markEkmsAppointmentVisited(idOrToken, { visitedNotes, vitals, visitedBy, status, completedAt, completedBy }) {
  const endpoint = `/appointments/${encodeURIComponent(idOrToken)}`;

  const bodyData = {
    status: status || "visited",
    visitedAt: Date.now(),
    visitedBy: visitedBy || "Dispensary Receptionist",
    visitedNotes: visitedNotes || "",
    receptionCheckedInAt: Date.now(),
    receptionCheckedInBy: visitedBy || "Dispensary Receptionist",
    vitals: vitals || {},
  };
  if (completedAt) bodyData.completedAt = completedAt;
  if (completedBy) bodyData.completedBy = completedBy;

  const res = await fetchWithApiKey(endpoint, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(bodyData),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: Failed to mark appointment visited via EKMS API`);
  }

  return data.appointment;
}

/**
 * Record Doctor Consultation and Prescription (Doctor OPD Desk)
 */
export async function updateDoctorConsultation(
  idOrToken,
  { diagnosis, prescriptions, doctorNotes, doctorName, doctorEmail }
) {
  const { url, apiKey } = getEkmsApiConfig();
  const endpoint = `${url}/appointments/${encodeURIComponent(idOrToken)}`;

  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      status: "prescribed",
      doctorConsultedAt: Date.now(),
      doctorName: doctorName || "Dispensary Medical Officer",
      doctorEmail: doctorEmail || "",
      diagnosis: diagnosis || "",
      prescriptions: Array.isArray(prescriptions) ? prescriptions : [],
      doctorNotes: doctorNotes || "",
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: Failed to record doctor consultation via EKMS API`);
  }

  return data.appointment;
}

/**
 * Mark medicines dispensed and visit fully completed (Pharmacy Desk)
 */
export async function completePharmacyDispense(
  idOrToken,
  { dispensationNotes, dispensedBy }
) {
  const { url, apiKey } = getEkmsApiConfig();
  const endpoint = `${url}/appointments/${encodeURIComponent(idOrToken)}`;

  const res = await fetch(endpoint, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      status: "dispensed",
      dispensedAt: Date.now(),
      dispensedBy: dispensedBy || "Dispensary Pharmacist",
      dispensationNotes: dispensationNotes || "",
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}: Failed to mark medicines dispensed via EKMS API`);
  }

  return data.appointment;
}

/**
 * Fetch doctor availability live from EKMS 3.0 API
 * Endpoints:
 * 1. http://localhost:3000/api/doctor-availability
 * 2. Fallback to /api/doctor-availability (Triage internal endpoint)
 */
export async function fetchEkmsDoctorAvailability(params = {}) {
  try {
    const { url } = getEkmsApiConfig();
    const ekmsOrigin = url.replace(/\/api\/v1\/?$/, "");
    const res = await fetch(`${ekmsOrigin}/api/doctor-availability`, {
      method: "GET",
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      return data;
    }
  } catch (err) {
    // Fallback to local
  }

  try {
    const res = await fetch("/api/doctor-availability", {
      method: "GET",
      cache: "no-store",
    });
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("fetchEkmsDoctorAvailability fallback error:", err);
  }

  return { success: false, records: [], doctors: [] };
}
