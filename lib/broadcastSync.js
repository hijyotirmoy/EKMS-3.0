// Real-Time Cross-Tab & Cross-Window Synchronization
// Provides instant 0-latency updates across all open tabs with 0 Firestore reads

const CHANNEL_NAME = "ekms_triage_sync_v1";

let channel = null;
const localListeners = new Set();

function getChannel() {
  if (typeof window === "undefined") return null;
  if (!channel && typeof window.BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch (e) {
      console.warn("BroadcastChannel not supported in this environment:", e);
    }
  }
  return channel;
}

/**
 * Broadcast an event to all other open tabs/windows
 */
export function broadcastEvent(type, payload = {}) {
  const msg = {
    type,
    payload,
    timestamp: Date.now(),
  };

  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage(msg);
    } catch (e) {
      console.warn("Broadcast event error:", e);
    }
  }

  // Notify local in-tab subscribers immediately
  localListeners.forEach((handler) => {
    try {
      handler(msg);
    } catch (e) {
      console.warn("Local sync listener error:", e);
    }
  });

  // Cross-App Bridge: If event contains an IP number, store in localStorage & broadcast
  try {
    const rawIp =
      payload?.ip_number ||
      payload?.ipNumber ||
      payload?.ipNo ||
      payload?.ip ||
      payload?.intake?.ip_number ||
      payload?.intake?.ipNumber ||
      payload?.intake?.city ||
      payload?.city ||
      "";

    const cleanIp = String(rawIp).trim();
    if (cleanIp && cleanIp !== "." && cleanIp !== "N/A" && typeof window !== "undefined") {
      const dataPayload = {
        ip_number: cleanIp,
        caller_name: payload.caller_name || payload.callerName || payload.intake?.caller_name || "",
        phone: payload.phone || payload.caller_id || payload.intake?.phone || "",
        case_ref: payload.case_ref || payload.caseRef || payload.case_id || payload.id || "",
        urgency: payload.urgency || payload.urgency_level || payload.triage?.urgency_level || "",
      };

      // Store in localStorage for instant cross-tab storage event (0 network errors)
      localStorage.setItem("ekms_active_ip_number", cleanIp);
      localStorage.setItem("ekms_triage_active_ip", JSON.stringify(dataPayload));
    }
  } catch (_) {}
}

/**
 * Direct helper to send an IP number to EKMS Data
 */
export function sendIpToEkmsData(ipNumber, extra = {}) {
  const cleanIp = String(ipNumber || "").trim();
  if (!cleanIp) return;

  broadcastEvent("TRIAGE_IP_SENT", {
    ip_number: cleanIp,
    ...extra,
  });
}

/**
 * Subscribe to real-time events from other tabs/windows
 */
export function subscribeToSync(handler) {
  if (typeof handler !== "function") return () => {};

  localListeners.add(handler);
  const ch = getChannel();

  const listener = (event) => {
    if (event && event.data) {
      handler(event.data);
    }
  };

  if (ch) {
    ch.addEventListener("message", listener);
  }

  return () => {
    localListeners.delete(handler);
    if (ch) {
      try {
        ch.removeEventListener("message", listener);
      } catch (_) {}
    }
  };
}
