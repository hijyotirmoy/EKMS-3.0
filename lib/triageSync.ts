/**
 * Utility for synchronizing appointment deletions and clinical data with Triage API
 */

export function getTriageBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_TRIAGE_API_URL) {
    return process.env.NEXT_PUBLIC_TRIAGE_API_URL;
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      return "https://triage.ekms.in";
    }
    // Running in local environment
    return "http://localhost:3001";
  }
  if (process.env.NODE_ENV === "production") {
    return "https://triage.ekms.in";
  }
  return "http://localhost:3001";
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
