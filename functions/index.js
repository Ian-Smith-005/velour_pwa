const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { getAuth } = require("firebase-admin/auth");
const { initializeApp } = require("firebase-admin/app");

initializeApp();

// Secret stored in Firebase Secret Manager — never in source code
const geminiKey = defineSecret("GEMINI_API_KEY");

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

exports.geminiProxy = onRequest(
  {
    secrets: [geminiKey],
    cors: true, // Firebase handles CORS origin matching via hosting rewrites
    maxInstances: 10,
  },
  async (req, res) => {
    // Only allow POST
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Verify Firebase Auth token — only your signed-in users can call this
    const authHeader = req.headers.authorization || "";
    const idToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!idToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      await getAuth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // Forward request to Gemini
    const { system_instruction, contents, generationConfig } = req.body;

    if (!contents || !Array.isArray(contents)) {
      return res.status(400).json({ error: "Invalid request body" });
    }

    try {
      const geminiRes = await fetch(
        `${GEMINI_URL}?key=${geminiKey.value()}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ system_instruction, contents, generationConfig }),
        }
      );

      if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        console.error("Gemini API error:", geminiRes.status, errText);
        return res.status(502).json({ error: "AI service unavailable" });
      }

      const data = await geminiRes.json();
      return res.json(data);
    } catch (e) {
      console.error("Proxy error:", e);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);
