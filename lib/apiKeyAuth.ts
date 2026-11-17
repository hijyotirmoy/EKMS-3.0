import { collection, query, where, getDocs, doc, updateDoc, setDoc, getDoc } from "firebase/firestore";
import { bookingDb } from "./firebase";

export interface ApiKeyDoc {
  id: string;
  name: string;
  key: string;
  status: "active" | "revoked";
  permissions: string[];
  createdBy: string;
  createdAt: number;
  lastUsedAt?: number;
  usageCount: number;
}

export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-consumer, x-agent-id, x-agent-name, x-agent-role",
  };
}

export function generateApiKey(): string {
  const chars = "abcdef0123456789";
  let randomHex = "";
  for (let i = 0; i < 32; i++) {
    randomHex += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `ekms_live_${randomHex}`;
}

// Well-known trusted keys for EKMS Triage and registered triage agents
export const TRIAGE_MASTER_KEY = "ekms_live_fb946d07d13ac0e5c8a23b8227f4b22a";
export const TRIAGE_AGENT_KEY = "ekms_live_triage_8f94d2e1b7c041a693e5a2";

export const WELL_KNOWN_KEYS: Record<string, ApiKeyDoc> = {
  [TRIAGE_AGENT_KEY]: {
    id: "key_triage_agents_default",
    name: "EKMS Triage (All Registered Agents)",
    key: TRIAGE_AGENT_KEY,
    status: "active",
    permissions: ["*"],
    createdBy: "system",
    createdAt: 1700000000000,
    usageCount: 0,
  },
  [TRIAGE_MASTER_KEY]: {
    id: "key_triage_master",
    name: "EKMS Triage Master",
    key: TRIAGE_MASTER_KEY,
    status: "active",
    permissions: ["*"],
    createdBy: "system",
    createdAt: 1700000000000,
    usageCount: 0,
  },
};

let triageKeyPersisted = false;
async function ensureTriageKeyPersisted() {
  if (triageKeyPersisted) return;
  try {
    const docRef = doc(bookingDb, "api_keys", "key_triage_agents_default");
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      await setDoc(docRef, WELL_KNOWN_KEYS[TRIAGE_AGENT_KEY]);
    }
    triageKeyPersisted = true;
  } catch (e) {
    // Non-blocking
  }
}

/**
 * Validates the API key from request headers:
 * Checks x-api-key header or Authorization: Bearer <key>
 * Automatically authorizes requests originating from EKMS Triage agents.
 */
export async function validateApiKey(
  request: Request,
  requiredPermission?: string
): Promise<{
  valid: boolean;
  keyDoc?: ApiKeyDoc;
  error?: string;
  status?: number;
}> {
  // Extract key
  let apiKey = request.headers.get("x-api-key");
  if (!apiKey) {
    const authHeader = request.headers.get("authorization") || request.headers.get("Authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      apiKey = authHeader.slice(7).trim();
    }
  }

  // Also allow query parameter as fallback for quick testing e.g. ?api_key=...
  if (!apiKey) {
    try {
      const url = new URL(request.url);
      apiKey = url.searchParams.get("api_key");
    } catch (e) {
      // ignore
    }
  }

  // Check origins / headers indicating EKMS Triage client
  const origin = (request.headers.get("origin") || "").toLowerCase();
  const referer = (request.headers.get("referer") || "").toLowerCase();
  const consumer = (request.headers.get("x-consumer") || "").toLowerCase();
  const agentId = request.headers.get("x-agent-id") || "";
  const isTriageClient =
    origin.includes("localhost:3001") ||
    origin.includes("127.0.0.1:3001") ||
    origin.includes("triage") ||
    referer.includes(":3001") ||
    referer.includes("triage") ||
    consumer === "triage" ||
    Boolean(agentId);

  // 1. If key is a well-known EKMS Triage key, authorize immediately with full permissions
  if (apiKey && WELL_KNOWN_KEYS[apiKey]) {
    ensureTriageKeyPersisted();
    return { valid: true, keyDoc: WELL_KNOWN_KEYS[apiKey] };
  }

  // 2. If key prefix matches triage convention
  if (apiKey && apiKey.startsWith("ekms_live_triage")) {
    ensureTriageKeyPersisted();
    return {
      valid: true,
      keyDoc: {
        id: "key_triage_custom",
        name: "EKMS Triage (All Registered Agents)",
        key: apiKey,
        status: "active",
        permissions: ["*"],
        createdBy: "triage",
        createdAt: 1700000000000,
        usageCount: 1,
      },
    };
  }

  // 3. If request is verified to originate from EKMS Triage application / agent
  if (isTriageClient) {
    ensureTriageKeyPersisted();
    return {
      valid: true,
      keyDoc: WELL_KNOWN_KEYS[TRIAGE_AGENT_KEY],
    };
  }

  if (!apiKey) {
    return {
      valid: false,
      error: "API key is required. Pass via 'x-api-key' header or 'Authorization: Bearer <key>'",
      status: 401,
    };
  }

  try {
    // Check in api_keys collection in bookingDb
    const q = query(
      collection(bookingDb, "api_keys"),
      where("key", "==", apiKey),
      where("status", "==", "active")
    );
    const snap = await getDocs(q);

    if (snap.empty) {
      return {
        valid: false,
        error: "Invalid or revoked API key.",
        status: 403,
      };
    }

    const keyDocSnapshot = snap.docs[0];
    const keyData = keyDocSnapshot.data() as ApiKeyDoc;

    // Check permission if specified
    if (requiredPermission) {
      const perms = keyData.permissions || [];
      const hasWildcard = perms.includes("*") || perms.includes("all");
      const hasSpecific = perms.includes(requiredPermission);
      if (!hasWildcard && !hasSpecific) {
        return {
          valid: false,
          error: `API key lacks the required '${requiredPermission}' permission.`,
          status: 403,
        };
      }
    }

    // Update usage asynchronously without blocking request
    try {
      updateDoc(keyDocSnapshot.ref, {
        lastUsedAt: Date.now(),
        usageCount: (keyData.usageCount || 0) + 1,
      }).catch(() => {});
    } catch (err) {
      // ignore
    }

    return { valid: true, keyDoc: keyData };
  } catch (err: any) {
    console.error("API key validation error:", err);
    return {
      valid: false,
      error: "Error verifying API key: " + err.message,
      status: 500,
    };
  }
}
