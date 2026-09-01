/**
 * IP Information Masking Utilities for EKMS Booking & Admin Modules
 * When 'Mask IP Info' is toggled ON:
 * - IP Name: First 3 letters + '***' and '***' + last 3 letters (e.g., 'KESHAB HAZARIKA' -> 'KES*** ***IKA')
 * - Phone: First digits replaced with stars, showing only the last 4 digits (e.g., '9613457320' -> '******7320')
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
 * Always masks IP names inside notification messages or titles regardless of toggle state.
 * Handles markdown formatting (**...**) and plain text notifications.
 */
export function maskNotificationMessage(msg: string, metadataIpName?: string): string {
  if (!msg || typeof msg !== "string") return "";

  let result = msg;

  if (metadataIpName && typeof metadataIpName === "string" && metadataIpName.trim()) {
    const rawIp = metadataIpName.trim();
    const masked = maskIpName(rawIp);
    result = result.split(rawIp).join(masked);
  }

  // Pattern 1: ... (booked an appointment for / appointment for) [**]NAME[**] on [**]DATE[**]
  result = result.replace(
    /(booked an appointment for\s+\*{0,2}|appointment for\s+\*{0,2})([^*]+?)(\*{0,2}\s+on\s+)/gi,
    (match, p1, p2, p3) => {
      return p1 + maskIpName(p2.trim()) + p3;
    }
  );

  // Pattern 2: ... (booking for / verification booking for) [**]NAME[**] (on|was|from|to|is) ...
  result = result.replace(
    /(booking for\s+\*{0,2}|verification booking for\s+\*{0,2})([^*]+?)(\*{0,2}\s+(?:on|was|from|to|is)\s+)/gi,
    (match, p1, p2, p3) => {
      return p1 + maskIpName(p2.trim()) + p3;
    }
  );

  return result;
}

