# Deploying the Gemini Proxy Cloud Function

The Gemini API key is stored in **Firebase Secret Manager** — never in source code or `.env` files committed to git.

---

## One-time setup

### 1. Install dependencies

```bash
cd functions
npm install
```

### 2. Store the Gemini API key as a Firebase secret

```bash
firebase functions:secrets:set GEMINI_API_KEY
# Paste your key when prompted: AIzaSyDvcK_Tw4L9omTCEgi_hYuLtqY-kIMGcnM
```

This stores the key in Google Cloud Secret Manager. It is never written to disk or visible in your code.

### 3. Deploy the function + hosting together

```bash
firebase deploy
```

Or deploy only the function:

```bash
firebase deploy --only functions
```

---

## How it works

```
Browser → POST /api/gemini (with Firebase Auth token)
             ↓  (Firebase Hosting rewrite)
         Cloud Function (geminiProxy)
             ↓  verifies ID token
             ↓  reads GEMINI_API_KEY from Secret Manager
             ↓  calls Gemini API server-side
             ↓  returns response
Browser ← AI reply
```

- The Gemini key **never reaches the browser**
- Only authenticated users (signed in via Google) can call the proxy
- Guest users fall back gracefully (no AI chat without sign-in)

---

## Local development (emulator)

To run locally with the emulator, create `functions/.secret.local`:

```
GEMINI_API_KEY=AIzaSyDvcK_Tw4L9omTCEgi_hYuLtqY-kIMGcnM
```

Then run:

```bash
firebase emulators:start --only functions,hosting
```

**Do not commit `.secret.local` to git.**

---

## Rotating the key

```bash
firebase functions:secrets:set GEMINI_API_KEY
# Enter the new key
firebase deploy --only functions
```

The old version is automatically retired.
