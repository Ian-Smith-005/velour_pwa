/**
 * Velour — Gemini API Proxy Worker
 * Cloudflare Workers (free tier: 100k req/day)
 *
 * Set in Cloudflare Dashboard → Workers → velour-gemini-proxy → Settings → Variables:
 *   GEMINI_API_KEY      — Gemini key (mark as Secret)
 *   FIREBASE_PROJECT_ID — e.g. "velour-app-22f69"
 *   ALLOWED_ORIGINS     — comma-separated allowed origins
 *                         e.g. "https://velour-pwa.pages.dev,https://velour-app-22f69.web.app"
 */

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export default {
  async fetch(request, env) {
    const requestOrigin = request.headers.get("Origin") || "";

    // Support multiple allowed origins (comma-separated)
    const allowedOrigins = (env.ALLOWED_ORIGINS || env.ALLOWED_ORIGIN || "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    // Reflect the request origin if allowed; fall back to * if no list configured
    const corsOrigin =
      allowedOrigins.length === 0
        ? "*"
        : allowedOrigins.includes(requestOrigin)
        ? requestOrigin
        : null;

    if (allowedOrigins.length > 0 && !corsOrigin) {
      return new Response("Forbidden", { status: 403 });
    }

    // ── CORS preflight ────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(corsOrigin) });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsOrigin);
    }

    // ── Verify Firebase ID token ──────────────────────────────────────
    const authHeader = request.headers.get("Authorization") || "";
    const idToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!idToken) {
      return json({ error: "Unauthorized" }, 401, corsOrigin);
    }

    const tokenValid = await verifyFirebaseToken(idToken, env.FIREBASE_PROJECT_ID);
    if (!tokenValid) {
      return json({ error: "Invalid token" }, 401, corsOrigin);
    }

    // ── Parse body ────────────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, corsOrigin);
    }

    const { system_instruction, contents, generationConfig } = body;

    if (!contents || !Array.isArray(contents)) {
      return json({ error: "Invalid request body" }, 400, corsOrigin);
    }

    // ── Proxy to Gemini ───────────────────────────────────────────────
    try {
      const geminiRes = await fetch(
        `${GEMINI_URL}?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ system_instruction, contents, generationConfig }),
        }
      );

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        console.error("Gemini error:", geminiRes.status, errText);
        return json({ error: "AI service unavailable" }, 502, corsOrigin);
      }

      const data = await geminiRes.json();
      return json(data, 200, corsOrigin);
    } catch (e) {
      console.error("Worker error:", e);
      return json({ error: "Internal server error" }, 500, corsOrigin);
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

async function verifyFirebaseToken(idToken, projectId) {
  try {
    const [headerB64, payloadB64, sigB64] = idToken.split(".");
    if (!headerB64 || !payloadB64 || !sigB64) return false;

    const header = JSON.parse(b64Decode(headerB64));
    const payload = JSON.parse(b64Decode(payloadB64));

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return false;
    if (payload.aud !== projectId) return false;
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return false;

    const keysRes = await fetch(
      "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
      { cf: { cacheEverything: true, cacheTtl: 3600 } }
    );
    const keys = await keysRes.json();
    const certPem = keys[header.kid];
    if (!certPem) return false;

    const cryptoKey = await crypto.subtle.importKey(
      "spki", pemToDer(certPem),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false, ["verify"]
    );

    const sigBytes = base64UrlToBytes(sigB64);
    const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, sigBytes, dataBytes);
  } catch (e) {
    console.error("Token verification error:", e);
    return false;
  }
}

function b64Decode(b64url) {
  return atob(b64url.replace(/-/g, "+").replace(/_/g, "/"));
}

function pemToDer(pem) {
  const base64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/g, "")
    .replace(/-----END CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  return base64UrlToBytes(base64, true);
}

function base64UrlToBytes(b64, standard = false) {
  const s = standard ? b64 : b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
