/**
 * IP Information Masking Utilities for EKMS Booking & Admin Modules
 * When 'Mask IP Info' is toggled ON:
 * - IP Name: First 3 letters + '***' and '***' + last 3 letters (e.g., 'KESHAB HAZARIKA' -> 'KES*** ***IKA')
 * - Phone: First digits replaced with stars, showing only the last 4 digits (e.g., '9613457320' -> '******7320')
 *
 * When 'Mask IP Info' is toggled OFF (Unmasked):
 * - Shows the complete raw IP full name and phone number.
 */

export function maskIpName(name: string): string {
  if (!name || typeof name !== "string") return "";
  const trimmed = name.trim();
  if (!trimmed) return "";

  const words = trimmed.split(/\s+/);
  if (words.length === 1) {
    const single = words[0];
    const prefix = single.length <= 3 ? single : single.slice(0, 3);
    return `${prefix}***`;
  }

  const firstWord = words[0];
  const lastWord = words[words.length - 1];

  const firstPart = (firstWord.length <= 3 ? firstWord : firstWord.slice(0, 3)) + "***";
  const lastPart = "***" + (lastWord.length <= 3 ? lastWord : lastWord.slice(-3));

  return `${firstPart} ${lastPart}`;
}

export function maskPhone(phone: string): string {
  if (!phone || typeof phone !== "string") return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return phone;

  const last4 = digits.slice(-4);
  const starCount = Math.max(6, digits.length - 4);
  return `${"*".repeat(starCount)}${last4}`;
}

/**
 * Dispensary Staff IP Number Masking:
 * Masks all previous numbers and keeps only the last 3 digits.
 * E.g., '1324514465' -> '*******465', '21126830784' -> '********784'.
 */
export function maskDispensaryIpNumber(ipNo?: string | null): string {
  if (!ipNo || typeof ipNo !== "string") return "N/A";
  const trimmed = ipNo.trim();
  if (!trimmed || trimmed.toLowerCase() === "n/a" || trimmed === "-" || trimmed === "--") {
    return "N/A";
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return trimmed;
  if (digits.length <= 3) {
    return `*******${digits}`;
  }
  const last3 = digits.slice(-3);
  const starCount = Math.max(7, digits.length - 3);
  return `${"*".repeat(starCount)}${last3}`;
}

/**
 * Dispensary Staff Mobile Number Masking:
 * Masks mobile number showing 7 stars and last 3 digits.
 * E.g., '9876543645' -> '*******645', '8135060278' -> '*******278'.
 */
export function maskDispensaryMobile(phone?: string | null): string {
  if (!phone || typeof phone !== "string") return "";
  const trimmed = phone.trim();
  if (!trimmed || trimmed.toLowerCase() === "n/a" || trimmed === "-" || trimmed === "--") {
    return "";
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) return trimmed;
  if (digits.length <= 3) {
    return `*******${digits}`;
  }
  const last3 = digits.slice(-3);
  const starCount = Math.max(7, digits.length - 3);
  return `${"*".repeat(starCount)}${last3}`;
}

/**
 * Determines whether a user profile belongs to a Dispensary Staff account
 * (Receptionist, Doctor, Pharmacist, Dispensary Staff at ESIS Dispensaries).
 * Admins and Master Admins return false.
 */
export function isDispensaryStaffAccount(userProfile?: any): boolean {
  if (!userProfile) return false;
  const roleStr = String(userProfile.role || "").toLowerCase().trim();
  if (roleStr === "admin" || roleStr === "master admin" || roleStr === "administrator") {
    return false;
  }
  return (
    roleStr === "dispensary staff" ||
    roleStr === "dispensary" ||
    Boolean(userProfile.dispensaryRole) ||
    Boolean(userProfile.dispensaryName) ||
    Boolean(userProfile.dispensaryId)
  );
}

/**
 * Dynamically formats notification text based on the global mask policy.
 * When mask === true: Applies 3-letter + 3-star name and last-4-digit phone masking.
 * When mask === false: Restores / ensures full name and full phone numbers are displayed.
 */
export function formatNotificationMessage(
  msg: string,
  mask: boolean,
  metadataIpName?: string,
  metadataPhone?: string
): string {
  if (!msg || typeof msg !== "string") return "";

  let result = msg;

  if (mask) {
    // 1. Explicit metadata replacement
    if (metadataIpName && typeof metadataIpName === "string" && metadataIpName.trim()) {
      const rawIp = metadataIpName.trim();
      result = result.split(rawIp).join(maskIpName(rawIp));
    }

    if (metadataPhone && typeof metadataPhone === "string" && metadataPhone.trim()) {
      const rawPh = metadataPhone.trim();
      result = result.split(rawPh).join(maskPhone(rawPh));
    }

    // 2. Regex for Phone numbers in text: e.g. Phone: 9613457320 or Phone: **9613457320**
    result = result.replace(
      /(Phone:\s*\*{0,2})([0-9\s\-+]{7,15})(\*{0,2})/gi,
      (match, p1, p2, p3) => {
        return p1 + maskPhone(p2.trim()) + p3;
      }
    );

    // 3. Regex for IP names in text:
    result = result.replace(
      /(booked an appointment for\s+\*{0,2}|appointment for\s+\*{0,2}|booked for\s+\*{0,2}|booking for\s+\*{0,2}|verification booking for\s+\*{0,2}|rescheduled booking for\s+\*{0,2}|appointment of\s+\*{0,2}|booking of\s+\*{0,2})([^*]+?)(\*{0,2}\s*(?:\(Phone|\bon\b|\bwas\b|\bfrom\b|\bto\b|\bis\b|\bhas\b|\.|$))/gi,
      (match, p1, p2, p3) => {
        const candidate = p2.trim();
        // Avoid masking already masked strings or common words
        if (candidate.includes("***")) return match;
        return p1 + maskIpName(candidate) + p3;
      }
    );
  } else {
    // UNMASKED: If notification was previously stored with masked stars but metadata has raw values, restore full values
    if (metadataIpName && typeof metadataIpName === "string" && metadataIpName.trim()) {
      const rawIp = metadataIpName.trim();
      const maskedIp = maskIpName(rawIp);
      if (maskedIp && result.includes(maskedIp)) {
        result = result.split(maskedIp).join(rawIp);
      }
    }

    if (metadataPhone && typeof metadataPhone === "string" && metadataPhone.trim()) {
      const rawPh = metadataPhone.trim();
      const maskedPh = maskPhone(rawPh);
      if (maskedPh && result.includes(maskedPh)) {
        result = result.split(maskedPh).join(rawPh);
      }
    }
  }

  return result;
}

/**
 * Backward-compatible wrapper
 */
export function maskNotificationMessage(
  msg: string,
  metadataIpName?: string,
  metadataPhone?: string
): string {
  return formatNotificationMessage(msg, true, metadataIpName, metadataPhone);
}

export function isMaskIpInfoEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem("ekms_triage_settings_v1");
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Boolean(parsed?.maskIpInfo);
  } catch (e) {
    return false;
  }
}

export function maskIpNumber(ipNumber?: string | null): string {
  if (!ipNumber) return "";
  const str = String(ipNumber).trim();
  if (str === "N/A" || str.length <= 4) return str;
  return "*".repeat(Math.max(4, str.length - 4)) + str.slice(-4);
}

export function maskName(name?: string | null): string {
  if (!name) return "";
  const str = String(name).trim();
  if (str === "Beneficiary" || str === "N/A" || str.length <= 3) return str;
  const parts = str.split(/\s+/);
  if (parts.length > 1) {
    return parts
      .map((p) => {
        if (p.length <= 2) return p;
        return p[0] + "*".repeat(p.length - 2) + p.slice(-1);
      })
      .join(" ");
  }
  return str.slice(0, 3) + "***" + str.slice(-3);
}

export function formatBeneficiaryName(name?: string | null, forceMask?: boolean): string {
  if (!forceMask && !isMaskIpInfoEnabled()) return name || "";
  return maskName(name);
}

export function formatBeneficiaryPhone(phone?: string | null, forceMask?: boolean): string {
  if (!forceMask && !isMaskIpInfoEnabled()) return phone || "";
  return maskPhone(phone || "");
}

export function formatBeneficiaryIp(ipNumber?: string | null, forceMask?: boolean): string {
  if (!forceMask && !isMaskIpInfoEnabled()) return ipNumber || "";
  return maskIpNumber(ipNumber);
}
