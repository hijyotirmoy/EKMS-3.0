/**
 * Utility for synchronizing appointment deletions and clinical data with Triage API
 */

export function getTriageBaseUrl(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_TRIAGE_API_URL || "http://localhost:3000";
}

export interface TriageDeleteParams {
  id?: string;
  tokenNo?: string;
  referenceNo?: string;
  tokens?: string[];
  ids?: string[];
}

/**
 * Call Triage API to permanently delete an appointment from Triage's internal database
 */
export async function deleteAppointmentFromTriageApi(
  params: TriageDeleteParams
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const baseUrl = getTriageBaseUrl();
    const res = await fetch(`${baseUrl}/api/appointments/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(params),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) {
      console.warn("Triage appointment delete warning:", data.error || res.statusText);
      return { success: false, error: data.error || res.statusText };
    }
    return { success: true, message: data.message };
  } catch (err: any) {
    console.warn("deleteAppointmentFromTriageApi network warning:", err?.message || err);
    return { success: false, error: err?.message || "Failed to reach Triage API" };
  }
}

export interface TriageConsultationParams {
  id?: string;
  tokenNo?: string;
  referenceNo?: string;
  phone?: string;
  doctorName?: string;
  doctorEmail?: string;
  consultationType?: string;
  doctorNotes?: string;
  prescriptions?: any[];
  doctorConsultedAt?: number;
}

/**
 * Replicate Doctor Consultation details (Consultation Type, Doctor Name, Prescriptions, Notes) to Triage API
 */
export async function syncConsultationToTriageApi(
  params: TriageConsultationParams
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    const baseUrl = getTriageBaseUrl();
    const payload = {
      ...params,
      status: "pharmacy_queue",
      updatedAt: Date.now(),
    };

    // 1. Post to Triage consultation endpoint
    fetch(`${baseUrl}/api/appointments/consultation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});

    // 2. Also post to Triage generic appointment update endpoint for comprehensive sync
    fetch(`${baseUrl}/api/appointments/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => {});

    // 3. Post to BroadcastChannel for instant cross-tab sync with Triage in the browser
    if (typeof window !== "undefined" && typeof (window as any).BroadcastChannel !== "undefined") {
      try {
        const channel = new BroadcastChannel("ekms_triage_sync_v1");
        channel.postMessage({ type: "APPOINTMENT_CONSULTED", payload });
      } catch (_) {}
    }

    return { success: true };
  } catch (err: any) {
    console.warn("syncConsultationToTriageApi network notice:", err?.message || err);
    return { success: false, error: err?.message || "Failed to reach Triage API" };
  }
}
