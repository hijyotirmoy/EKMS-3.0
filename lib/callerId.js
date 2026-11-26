// Centralized Caller ID Generator & Registry for EKMS Triage
// Format: CID + 4-digit sequence (0001-9999) + 1-letter series (A-Z) + last 3 digits of phone
// Example: CID0001K102 (CID + 0001 + K + 102), CID0005A810

const memoryRegistry = new Map();

// Known seed / demo bindings
memoryRegistry.set("9876543210", "CID0001A210");
memoryRegistry.set("9876543102", "CID0001K102");
memoryRegistry.set("7410741074", "CID0052A074");

export function normalize10DigitPhone(p) {
  if (!p) return "";
  const digits = String(p).replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

function getStoredRegistry() {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("ekms_caller_id_registry");
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return null;
}

function saveStoredRegistry(regObj) {
  if (typeof window === "undefined" || !regObj) return;
  try {
    localStorage.setItem("ekms_caller_id_registry", JSON.stringify(regObj));
  } catch (e) {}
}

/**
 * Format a Caller ID string: CID + 4-digit sequence + 1-letter series + last 3 digits of phone
 * @param {number} seq - 1 to 9999
 * @param {string} letter - 'A' to 'Z'
 * @param {string} phone - phone string
 * @returns {string} e.g. "CID0005A810"
 */
export function formatCallerId(seq = 1, letter = "A", phone = "000") {
  const safeSeq = Math.max(1, Math.min(9999, Math.floor(seq)));
  const seqStr = String(safeSeq).padStart(4, "0");
  const cleanLetter = String(letter || "A").toUpperCase().slice(0, 1);
  const safeLetter = /[A-Z]/.test(cleanLetter) ? cleanLetter : "A";
  const digits = String(phone).replace(/\D/g, "");
  const last3 = digits.length >= 3 ? digits.slice(-3) : digits.padStart(3, "0");
  return `CID${seqStr}${safeLetter}${last3}`;
}

/**
 * Parses a Caller ID string into its components
 */
export function parseCallerId(callerId) {
  if (!callerId || typeof callerId !== "string") return null;
  const match = callerId.trim().match(/^CID(\d{4})([A-Z])(\d{3})$/i);
  if (!match) return null;
  return {
    prefix: "CID",
    seq: parseInt(match[1], 10),
    seqStr: match[1],
    letter: match[2].toUpperCase(),
    last3: match[3],
  };
}

/**
 * Get or assign a deterministic, permanent Caller ID for a given 10-digit phone number.
 * Ensures the exact same phone number ALWAYS receives the exact same Caller ID (e.g. CID0005A810).
 *
 * @param {string} phone - Caller phone number
 * @param {Array} existingCases - Optional list of cases to scan for already assigned caller_ids
 * @returns {string} e.g. "CID0005A810"
 */
export function getCallerIdForPhone(phone, existingCases = []) {
  const cleanPhone = normalize10DigitPhone(phone);
  if (!cleanPhone) {
    const rawDigits = String(phone || "").replace(/\D/g, "");
    if (rawDigits.length >= 3) {
      return formatCallerId(1, "A", rawDigits);
    }
    return "";
  }

  // 1. Check in-memory Map
  if (memoryRegistry.has(cleanPhone)) {
    return memoryRegistry.get(cleanPhone);
  }

  // 2. Check localStorage on client
  const stored = getStoredRegistry();
  if (stored && stored[cleanPhone]) {
    const val = stored[cleanPhone];
    if (/^CID\d{4}[A-Z]\d{3}$/i.test(val)) {
      memoryRegistry.set(cleanPhone, val);
      return val;
    }
  }

  // 3. Check existing cases in database / memory
  if (Array.isArray(existingCases) && existingCases.length > 0) {
    for (const c of existingCases) {
      const casePhone = normalize10DigitPhone(c.intake?.phone || c.phone);
      if (casePhone === cleanPhone) {
        const existingCid = c.caller_id || c.callerId || c.intake?.caller_id;
        if (existingCid && /^CID\d{4}[A-Z]\d{3}$/i.test(existingCid)) {
          memoryRegistry.set(cleanPhone, existingCid.toUpperCase());
          if (stored) {
            stored[cleanPhone] = existingCid.toUpperCase();
            saveStoredRegistry(stored);
          }
          return existingCid.toUpperCase();
        }
      }
    }
  }

  // 4. Calculate next sequence number based on existing known registry count
  const allKnownPhones = new Set([
    ...memoryRegistry.keys(),
    ...(stored ? Object.keys(stored) : []),
  ]);

  if (Array.isArray(existingCases)) {
    for (const c of existingCases) {
      const cp = normalize10DigitPhone(c.intake?.phone || c.phone);
      if (cp) allKnownPhones.add(cp);
    }
  }

  // Deterministic seed based on last 4 digits of phone
  const seedNum = parseInt(cleanPhone.slice(-4), 10) || 1;
  const seq = ((allKnownPhones.size + (seedNum % 20)) % 9999) + 1;
  const letter = "A";
  const newCid = formatCallerId(seq, letter, cleanPhone);

  // Store in memory & localStorage
  memoryRegistry.set(cleanPhone, newCid);
  const reg = stored || {};
  reg[cleanPhone] = newCid;
  saveStoredRegistry(reg);

  return newCid;
}

/**
 * Explicitly register a phone to caller_id mapping
 */
export function registerCallerId(phone, callerId) {
  const cleanPhone = normalize10DigitPhone(phone);
  if (!cleanPhone || !callerId) return;
  const upperCid = callerId.toUpperCase();
  memoryRegistry.set(cleanPhone, upperCid);
  const stored = getStoredRegistry() || {};
  stored[cleanPhone] = upperCid;
  saveStoredRegistry(stored);
}
