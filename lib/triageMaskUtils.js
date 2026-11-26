// Insured Person (IP) / Beneficiary Data Masking Utilities
// Controls masking of IP numbers, Phone numbers, and Caller names across the platform

export function isMaskIpInfoEnabled() {
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

export function maskIpNumber(ipNumber) {
  if (!ipNumber) return "";
  const str = String(ipNumber).trim();
  if (str === "N/A" || str.length <= 4) return str;
  return "*".repeat(Math.max(4, str.length - 4)) + str.slice(-4);
}

export function maskPhone(phone) {
  if (!phone) return "";
  const str = String(phone).trim();
  if (str === "N/A" || str.length <= 4) return str;
  return "*".repeat(Math.max(4, str.length - 4)) + str.slice(-4);
}

export function maskName(name) {
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

export function formatBeneficiaryName(name, forceMask) {
  if (!forceMask && !isMaskIpInfoEnabled()) return name || "";
  return maskName(name);
}

export function formatBeneficiaryPhone(phone, forceMask) {
  if (!forceMask && !isMaskIpInfoEnabled()) return phone || "";
  return maskPhone(phone);
}

export function formatBeneficiaryIp(ipNumber, forceMask) {
  if (!forceMask && !isMaskIpInfoEnabled()) return ipNumber || "";
  return maskIpNumber(ipNumber);
}
