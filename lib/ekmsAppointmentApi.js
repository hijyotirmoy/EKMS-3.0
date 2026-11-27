// EKMS REST API Client for external applications (EKMS Triage)
// Connects to EKMS 3.0 via HTTP REST endpoints (supports localhost and https://ekms.in)

export function getEkmsApiBaseUrl() {
  // 1. Explicit saved custom URL in localStorage
  if (typeof window !== "undefined") {
    try {
      const saved = localStorage.getItem("ekms_custom_api_url") || localStorage.getItem("ekms_api_url");
      if (saved && saved.trim()) {
        let clean = saved.trim().replace(/\/+$/, "");
        if (!clean.endsWith("/api/v1") && !clean.includes("/api/")) clean = `${clean}/api/v1`;
        return clean;
      }
    } catch (e) {}
  }

  // 2. Environment variable (e.g. from .env.local)
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_EKMS_API_URL) {
    let clean = process.env.NEXT_PUBLIC_EKMS_API_URL.trim().replace(/\/+$/, "");
    if (!clean.endsWith("/api/v1") && !clean.includes("/api/")) clean = `${clean}/api/v1`;
    return clean;
  }

  // 3. Dynamic domain resolution based on browser location (always same-origin to prevent CORS/redirect errors)
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/v1`;
  }

  // 4. Default production URL
  return "https://ekms.in/api/v1";
}

const DEFAULT_ACTIVE_API_KEY = "ekms_live_triage_8f94d2e1b7c041a693e5a2";

export function getEkmsApiKey() {
  if (typeof window !== "undefined") {
    try {
      const stored =
        localStorage.getItem("ekms_custom_api_key") ||
        localStorage.getItem("ekms_api_key") ||
        sessionStorage.getItem("ekms_api_key");
      if (stored && stored.trim()) {
        return stored.trim();
      }
    } catch (e) {}
  }
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_EKMS_API_KEY) {
    return process.env.NEXT_PUBLIC_EKMS_API_KEY.trim();
  }
  return DEFAULT_ACTIVE_API_KEY;
}

export function setEkmsApiConfig({ apiKey, apiUrl }) {
  if (typeof window === "undefined") return;
  try {
    if (apiKey !== undefined) {
      if (apiKey) localStorage.setItem("ekms_api_key", apiKey.trim());
      else localStorage.removeItem("ekms_api_key");
    }
    if (apiUrl !== undefined) {
      if (apiUrl) localStorage.setItem("ekms_api_url", apiUrl.trim());
      else localStorage.removeItem("ekms_api_url");
    }
  } catch (e) {}
}

/**
 * Book an appointment via EKMS REST API
 * POST /api/v1/appointments
 */
export async function bookAppointmentViaEkmsApi(payload) {
  const baseUrl = getEkmsApiBaseUrl();
  const apiKey = getEkmsApiKey();

  if (!apiKey) {
    console.warn("EKMS API key is not configured in Triage. Appointments will not be synced to EKMS until an API key is generated.");
    return {
      success: false,
      error: "No EKMS API key found. Please generate an API key in EKMS Admin Settings and configure it in Triage.",
    };
  }

  try {
    const response = await fetch(`${baseUrl}/appointments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "x-consumer": "triage",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      const errMsg = data?.error || `HTTP ${response.status}: Failed to schedule appointment via EKMS API`;
      console.warn("EKMS API Booking Warning:", errMsg);
      return { success: false, error: errMsg };
    }

    return { success: true, appointment: data.appointment, message: data.message };
  } catch (err) {
    console.error("EKMS API Booking Network Error:", err);
    return { success: false, error: err.message || "Network error connecting to EKMS API" };
  }
}

/**
 * Cancel an appointment via EKMS REST API
 * PATCH /api/v1/appointments/[id]
 */
export async function cancelAppointmentViaEkmsApi(idOrToken, reason = "Cancelled in EKMS Triage") {
  if (!idOrToken) return { success: false, error: "Missing appointment token/id" };

  const baseUrl = getEkmsApiBaseUrl();
  const apiKey = getEkmsApiKey();

  if (!apiKey) {
    return {
      success: false,
      error: "No EKMS API key found.",
    };
  }

  try {
    const cleanId = encodeURIComponent(idOrToken.trim());
    const response = await fetch(`${baseUrl}/appointments/${cleanId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "x-consumer": "triage",
      },
      body: JSON.stringify({
        status: "cancelled",
        cancelledAt: new Date().toISOString(),
        cancellationReason: reason,
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok || !data?.success) {
      const errMsg = data?.error || `HTTP ${response.status}: Failed to cancel appointment via EKMS API`;
      console.warn("EKMS API Cancellation Warning:", errMsg);
      return { success: false, error: errMsg };
    }

    return { success: true, message: data.message, appointment: data.appointment };
  } catch (err) {
    console.error("EKMS API Cancellation Network Error:", err);
    return { success: false, error: err.message || "Network error connecting to EKMS API" };
  }
}

/**
 * Fetch appointments via EKMS REST API
 * GET /api/v1/appointments
 */
export async function fetchAppointmentsViaEkmsApi(filters = {}) {
  const baseUrl = getEkmsApiBaseUrl();
  const apiKey = getEkmsApiKey();

  if (!apiKey) {
    return { success: false, error: "No API key configured", appointments: [] };
  }

  const queryParams = new URLSearchParams();
  if (filters.dispensary) queryParams.set("dispensary", filters.dispensary);
  if (filters.status) queryParams.set("status", filters.status);
  if (filters.date) queryParams.set("date", filters.date);
  if (filters.tokenNo) queryParams.set("tokenNo", filters.tokenNo);
  if (filters.limit) queryParams.set("limit", String(filters.limit));

  const url = `${baseUrl}/appointments${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": apiKey,
        "x-consumer": "triage",
      },
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      return { success: false, error: data?.error || `HTTP ${response.status}`, appointments: [] };
    }

    return { success: true, count: data.count, appointments: data.appointments || [] };
  } catch (err) {
    console.error("EKMS API Fetch Network Error:", err);
    return { success: false, error: err.message, appointments: [] };
  }
}
