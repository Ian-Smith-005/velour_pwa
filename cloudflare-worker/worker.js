/**
 * Velour — Gemini API Proxy Worker
 * Deployed on Cloudflare Workers (free tier: 100k req/day)
 *
 * Environment variables (set in Cloudflare dashboard → Workers → Settings → Variables):
 *   GEMINI_API_KEY   — your Gemini key (mark as Secret)
 *   FIREBASE_PROJECT_ID — e.g. "velour-app-22f69"
 *   ALLOWED_ORIGIN   — your app URL e.g. "https://velour-app-22f69.web.app"
 */

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";

    // ── CORS preflight ────────────────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin),
      });
    }

    // ── Only POST ─────────────────────────────────────────────────────
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, allowedOrigin);
    }

    // ── Verify Firebase ID token ──────────────────────────────────────
    const authHeader = request.headers.get("Authorization") || "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!idToken) {
      return json({ error: "Unauthorized" }, 401, allowedOrigin);
    }

    const tokenValid = await verifyFirebaseToken(
      idToken,
      env.FIREBASE_PROJECT_ID
    );
    if (!tokenValid) {
      return json({ error: "Invalid token" }, 401, allowedOrigin);
    }

    // ── Parse request body ────────────────────────────────────────────
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, allowedOrigin);
    }

    const { system_instruction, contents, generationConfig } = body;

    if (!contents || !Array.isArray(contents)) {
      return json({ error: "Invalid request body" }, 400, allowedOrigin);
    }

    // ── Proxy to Gemini ───────────────────────────────────────────────
    try {
      const geminiRes = await fetch(
        `${GEMINI_URL}?key=${env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction,
            contents,
            generationConfig,
          }),
        }
      );

      if (!geminiRes.ok) {
        console.error("Gemini error:", geminiRes.status);
        return json({ error: "AI service unavailable" }, 502, allowedOrigin);
      }

      const data = await geminiRes.json();
      return json(data, 200, allowedOrigin);
    } catch (e) {
      console.error("Worker error:", e);
      return json({ error: "Internal server error" }, 500, allowedOrigin);
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
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });
}

/**
 * Verify a Firebase ID token using Google's public keys.
 * Firebase tokens are signed JWTs — we verify the signature
 * against Google's published public keys without any SDK.
 */
async function verifyFirebaseToken(idToken, projectId) {
  try {
    // Decode header to get key ID (kid)
    const [headerB64, payloadB64, sigB64] = idToken.split(".");
    if (!headerB64 || !payloadB64 || !sigB64) return false;

    const header = JSON.parse(atob(headerB64.replace(/-/g, "+").replace(/_/g, "/")));
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) return false;

    // Check audience matches our Firebase project
    if (payload.aud !== projectId) return false;

    // Check issuer
    if (payload.iss !== `https://securetoken.google.com/${projectId}`) return false;

    // Fetch Google's public keys (cached by Cloudflare CDN)
    const keysRes = await fetch(
      "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com",
      { cf: { cacheEverything: true, cacheTtl: 3600 } }
    );
    const keys = await keysRes.json();
    const certPem = keys[header.kid];
    if (!certPem) return false;

    // Import the public key
    const certDer = pemToDer(certPem);
    const cryptoKey = await crypto.subtle.importKey(
      "spki",
      certDer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );

    // Verify signature
    const sigBytes = base64UrlToBytes(sigB64);
    const dataBytes = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    return await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      sigBytes,
      dataBytes
    );
  } catch (e) {
    console.error("Token verification error:", e);
    return false;
  }
}

function pemToDer(pem) {
  const base64 = pem
    .replace(/-----BEGIN CERTIFICATE-----/, "")
    .replace(/-----END CERTIFICATE-----/, "")
    .replace(/\s+/g, "");
  return base64UrlToBytes(base64, true);
}

function base64UrlToBytes(b64, standard = false) {
  const s = standard
    ? b64
    : b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
