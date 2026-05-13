# Velour — Deployment Guide

## Overview

```
Browser → POST https://velour-gemini-proxy.YOUR_SUBDOMAIN.workers.dev
              ↓  (Cloudflare Worker — free tier)
              ↓  verifies Firebase Auth ID token
              ↓  reads GEMINI_API_KEY (secret, never exposed)
              ↓  calls Gemini API server-side
Browser ← AI reply
```

The Gemini API key **never reaches the browser**. Only your signed-in Firebase users can trigger AI requests.

---

## Step 1 — Deploy the Cloudflare Worker

### 1a. Create a free Cloudflare account
Sign up at https://dash.cloudflare.com/sign-up (no credit card required).

### 1b. Install Wrangler (Cloudflare CLI)

```bash
cd cloudflare-worker
npm install
```

### 1c. Login to Cloudflare

```bash
npx wrangler login
```

A browser window will open — log in with your Cloudflare account.

### 1d. Deploy the worker

```bash
npx wrangler deploy
```

You'll see output like:
```
Deployed velour-gemini-proxy (1.23 sec)
https://velour-gemini-proxy.YOUR_SUBDOMAIN.workers.dev
```

Copy that URL — you'll need it in Step 3.//https://velour-gemini-proxy.smithiian34.workers.dev

---

## Step 2 — Set environment variables in Cloudflare

Go to: **Cloudflare Dashboard → Workers & Pages → velour-gemini-proxy → Settings → Variables**

Add these:

| Variable | Type | Value |
|---|---|---|
| `GEMINI_API_KEY` | **Secret** (encrypted) | Your Gemini API key |
| `FIREBASE_PROJECT_ID` | Plain text | Your Firebase project ID (e.g. `velour-app-22f69`) |
| `ALLOWED_ORIGIN` | Plain text | Your app URL (e.g. `https://velour-app-22f69.web.app`) |

Click **Save and Deploy** after adding all three.

> ⚠️ Mark `GEMINI_API_KEY` as a **Secret** — this encrypts it at rest and hides it from logs.

---

## Step 3 — Update the frontend

In `public/assets/index.js`, find line 42 and replace the placeholder with your actual Worker URL:

```js
// Before
const GU = "https://velour-gemini-proxy.YOUR_SUBDOMAIN.workers.dev";

// After (use your real subdomain from Step 1d)
const GU = "https://velour-gemini-proxy.acmecorp.workers.dev";
```

---

## Step 4 — Deploy the Firebase app

```bash
firebase deploy --only hosting
```

---

## Local development

To test the worker locally:

```bash
cd cloudflare-worker
```

Create a `.dev.vars` file (never commit this):
```
GEMINI_API_KEY=AIzaSyDvcK_Tw4L9omTCEgi_hYuLtqY-kIMGcnM
FIREBASE_PROJECT_ID=velour-app-22f69
ALLOWED_ORIGIN=http://localhost:5000
```

Then run:
```bash
npx wrangler dev
```

The worker runs at `http://localhost:8787`. Update `GU` in `index.js` to point there during local dev.

---

## Rotating the Gemini key

1. Go to Cloudflare Dashboard → Workers → velour-gemini-proxy → Settings → Variables
2. Update `GEMINI_API_KEY` with the new key
3. Click Save and Deploy — live instantly, no redeployment needed

---

## Free tier limits

| | Cloudflare Workers Free | Your usage |
|---|---|---|
| Requests/day | 100,000 | ~1 per AI message |
| CPU time | 10ms per request | Well within limit |
| Cost | $0 forever | — |

