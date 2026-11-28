// =====================================================================
// Facility Availability & Operational Status Module
// Controls which facilities are currently accepting bookings & forwarding
// Synchronized globally in real-time across all users (Admin & Agents)
// =====================================================================

export const FACILITY_AVAILABILITY_KEY = "ekms_facility_availability_v2";

if (typeof window !== "undefined") {
  try {
    if (localStorage.getItem("ekms_facility_availability_v1")) {
      localStorage.removeItem("ekms_facility_availability_v1");
    }
  } catch (e) {}
}

let syncInitialized = false;

/**
 * Normalizes a facility name or ID for consistent key lookup
 */
export function normalizeFacilityKey(facilityOrName) {
  if (!facilityOrName) return "";
  if (typeof facilityOrName === "object") {
    if (facilityOrName.id) return String(facilityOrName.id).trim();
    if (facilityOrName.site_code) return String(facilityOrName.site_code).trim();
    return String(facilityOrName.name || "").toLowerCase().trim();
  }
  return String(facilityOrName).toLowerCase().trim();
}

/**
 * Returns map of facilityKey -> boolean (true = accepting, false = suspended/offline)
 */
export function getFacilityAvailabilityMap() {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(FACILITY_AVAILABILITY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

/**
 * Checks if a specific facility is currently accepting bookings & forwarding.
 * Default is TRUE (available) unless explicitly set to false.
 * @param {any} facilityOrName
 * @param {any} [mapOverride]
 * @returns {boolean}
 */
export function isFacilityAccepting(facilityOrName, mapOverride = null) {
  if (!facilityOrName) return false;
  const map = mapOverride || getFacilityAvailabilityMap();

  if (typeof facilityOrName === "object") {
    // 1. Check by ID
    if (facilityOrName.id && map[facilityOrName.id] !== undefined) {
      return Boolean(map[facilityOrName.id]);
    }
    // 2. Check by site_code
    if (facilityOrName.site_code && map[facilityOrName.site_code] !== undefined) {
      return Boolean(map[facilityOrName.site_code]);
    }
    // 3. Check by normalized name
    const cleanName = (facilityOrName.name || "").toLowerCase().trim();
    if (cleanName && map[cleanName] !== undefined) {
      return Boolean(map[cleanName]);
    }
    // 4. Check by original name
    if (facilityOrName.name && map[facilityOrName.name] !== undefined) {
      return Boolean(map[facilityOrName.name]);
    }
    return false;
  }

  const str = String(facilityOrName).trim();
  const clean = str.toLowerCase();
  if (map[str] !== undefined) return Boolean(map[str]);
  if (map[clean] !== undefined) return Boolean(map[clean]);

  return false;
}

/**
 * Update availability for a single facility
 */
export function setFacilityAvailability(facilityOrName, isAccepting) {
  if (typeof window === "undefined") return;
  const key = normalizeFacilityKey(facilityOrName);
  if (!key) return;

  const map = getFacilityAvailabilityMap();
  map[key] = Boolean(isAccepting);
  // Also store clean name if object has name
  if (typeof facilityOrName === "object" && facilityOrName.name) {
    map[facilityOrName.name.toLowerCase().trim()] = Boolean(isAccepting);
    map[facilityOrName.name] = Boolean(isAccepting);
  }

  saveAllFacilityAvailability(map);
}

/**
 * Bulk save the entire availability map & broadcast to API / Firestore
 */
export function saveAllFacilityAvailability(map) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FACILITY_AVAILABILITY_KEY, JSON.stringify(map));
  } catch (e) {}

  window.dispatchEvent(new CustomEvent("facility_availability_change", { detail: map }));

  // Push to server endpoint asynchronously so ALL agents/users get it
  try {
    fetch("/api/facilities/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ replace: true, availability: map }),
    }).catch(() => {});
  } catch (e) {}
}

/**
 * Synchronize facility availability map from server API and Firestore
 * Safe to call on page load or periodically
 */
export function syncFacilityAvailability() {
  if (typeof window === "undefined") return;

  fetch("/api/facilities/availability")
    .then((res) => res.json())
    .then((data) => {
      const serverMap = data?.availability && typeof data.availability === "object" ? data.availability : {};
      localStorage.setItem(FACILITY_AVAILABILITY_KEY, JSON.stringify(serverMap));
      window.dispatchEvent(new CustomEvent("facility_availability_change", { detail: serverMap }));
    })
    .catch(() => {});

  if (syncInitialized) return;
  syncInitialized = true;

  // Real-time Firestore sync via triage-cases-settings database
  try {
    import("./firebase").then(({ getCasesSettingsDb, getFirestoreDb }) => {
      const db = getCasesSettingsDb() || getFirestoreDb();
      if (db) {
        import("firebase/firestore").then(({ doc, onSnapshot }) => {
          onSnapshot(
            doc(db, "system_meta", "facility_availability"),
            (snap) => {
              if (snap.exists()) {
                const cloudMap = snap.data()?.availability;
                if (cloudMap && typeof cloudMap === "object") {
                  localStorage.setItem(FACILITY_AVAILABILITY_KEY, JSON.stringify(cloudMap));
                  window.dispatchEvent(new CustomEvent("facility_availability_change", { detail: cloudMap }));
                }
              }
            },
            () => {}
          );
        });
      }
    }).catch(() => {});
  } catch (e) {}
}
