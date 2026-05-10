# Velour — Setup Guide

**The world's first male spermatogenesis cycle tracker.**
*(Scientifically satirical. Genuinely useful.)*

---

## What's New in v4

| Feature | Details |
|---|---|
| **Primary DB** | Firebase Firestore — real-time, cross-device, scales to millions |
| **Partner invites** | 6-character code system — no email lookup, share anywhere |
| **Real-time sync** | Partner data updates live via Firestore `onSnapshot` |
| **Spermatogenesis cycle** | 74-day cycle tracker with 6 named phases |
| **Push notifications** | Browser push + local scheduled reminders |
| **Offline fallback** | IndexedDB caches all data locally if offline |

---

## Files

```
velour-v4/
├── index.html     ← Entire app (all screens, logic, styles)
├── sw.js          ← Service worker (offline cache + push handler)
├── manifest.json  ← PWA install metadata
└── README.md      ← This file
```

---

## Step 1 — Firebase Project

Firebase is the primary database. Everything lives in **your** project — Velour never touches your data.

### 1.1 Create the project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → give it a name (e.g. `velour-app`)
3. Disable Google Analytics (optional) → **Create project**

### 1.2 Enable Authentication

1. Left sidebar → **Build → Authentication**
2. Click **Get started**
3. Sign-in method tab → **Google** → Enable → add your support email → **Save**

### 1.3 Create Firestore Database

1. Left sidebar → **Build → Firestore Database**
2. Click **Create database**
3. A dialog opens with two steps:

   **Step 1 — Security rules**
   You will see two options:
   - **Start in production mode** — all reads and writes blocked by default
   - **Start in test mode** — all reads and writes open for 30 days

   Choose **Start in production mode**. We will fix the rules manually in a moment.

   Click **Next**.

   **Step 2 — Location**
   Pick the Cloud Firestore location closest to your users (e.g. `eur3` for Europe, `us-central` for US). This cannot be changed later.

   Click **Enable** and wait about 30 seconds for the database to provision.

4. Once the database is ready, click the **Rules** tab at the top of the Firestore page.

5. You will see a default rules block that looks like this (locked mode):

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /{document=**} {
         allow read, write: if false;
       }
     }
   }
   ```

6. **Select all of that text and delete it entirely.** Then paste the following to replace it:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /users/{userId} {
         allow read: if request.auth != null;
         allow write: if request.auth != null && request.auth.uid == userId;
         match /logs/{logId} {
           allow read: if request.auth != null;
           allow write: if request.auth != null && request.auth.uid == userId;
         }
         match /push/{doc} {
           allow read, write: if request.auth != null && request.auth.uid == userId;
         }
       }
     }
   }
   ```

   > The key difference from locked mode: we replace `match /{document=**}` (which matches everything and denies it) with specific `match /users/{userId}` rules that allow authenticated access only where needed.

7. Click **Publish**. A green confirmation bar should appear. If you see a parsing error, make sure you deleted the original block completely before pasting — do not merge the two blocks together.

### 1.4 Add a Web App

1. Click the **Project Overview** link at the top of the left sidebar
2. Under "Get started by adding Firebase to your app", click the **</>** (Web) icon
   - If you already have apps registered, click the **Add app** button instead (also a `</>` icon)
3. Give the app a nickname — anything works, e.g. `velour-pwa`
4. Leave "Also set up Firebase Hosting" **unchecked** unless you want to use Firebase Hosting specifically
5. Click **Register app**
6. Firebase shows you a code block like this:

   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project-id",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   };
   ```

   Copy these values — you need them in the next step.

7. Click **Continue to console**

### 1.5 Add Your Config to index.html

Open `index.html` and find this block near the top of the `<script>` section:

```javascript
const FB = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

Replace each value with what Firebase gave you.

### 1.6 Authorized Domains (for Google Sign-In)

1. Firebase Console → **Authentication → Settings → Authorized domains**
2. Click **Add domain**
3. Add your deployment URL (e.g. `velour.yourdomain.com` or `velour.netlify.app`)
4. `localhost` is already there for local testing

---

## Step 2 — Gemini AI (Free)

The AI chat uses Google's Gemini Flash model.

1. Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
2. Click **Create API key** → copy it
3. In `index.html`, find:

```javascript
const GK = "YOUR_GEMINI_API_KEY";
```

Replace with your key.

> **Rate limits:** The free tier gives 15 requests/minute and 1 million tokens/day — more than enough for personal use.

---

## Step 3 — Push Notifications (Optional but Recommended)

Push notifications work in two layers in Velour:

**Layer 1 — Local notifications** (works immediately, no extra setup)
The app schedules reminders using `Notification` API when the app is open or in background on supported browsers.

**Layer 2 — True server push** (requires VAPID key, sends even when app is closed)

### 3.1 Get your VAPID Key

1. Firebase Console → **Project Settings** (gear icon)
2. **Cloud Messaging** tab
3. Scroll to **Web Push certificates**
4. Click **Generate key pair**
5. Copy the **Key pair** value (this is your VAPID public key)

### 3.2 Add VAPID Key to index.html

```javascript
const VAPID_KEY = "YOUR_VAPID_PUBLIC_KEY";
```

Replace with the key from Firebase.

### 3.3 Server-Side Push (Advanced)

For true background push (when the browser is closed), you need a small server to call Firebase Cloud Messaging. The push subscriptions are automatically saved to Firestore at `users/{uid}/push/subscription` when a user enables push.

To send a push from a server:

```javascript
// Node.js example using web-push library
const webpush = require('web-push');

webpush.setVapidDetails(
  'mailto:you@yourdomain.com',
  'YOUR_VAPID_PUBLIC_KEY',
  'YOUR_VAPID_PRIVATE_KEY'  // from Firebase Console
);

// Get subscription from Firestore, then:
await webpush.sendNotification(subscription, JSON.stringify({
  title: 'Velour',
  body: 'Time to log today, chief.',
  tag: 'daily-reminder'
}));
```

> For most users, Layer 1 local notifications work perfectly. You only need Layer 2 if you want push when the browser is 100% closed.

---

## Step 4 — Deploy

### Option A: Netlify (Recommended — Free, HTTPS automatic)

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag and drop the `velour-v4/` folder onto the page
3. Done — you get a live HTTPS URL instantly
4. Add that URL to Firebase Authorized Domains (Step 1.6)

To use a custom domain:
- Netlify Dashboard → your site → **Domain settings** → **Add custom domain**

### Option B: Firebase Hosting (Seamless integration)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# Public directory: . (current folder)
# Single-page app: yes
# Overwrite index.html: no
firebase deploy
```

### Option C: Vercel

```bash
npm install -g vercel
cd velour-v4
vercel --prod
```

### Option D: GitHub Pages

1. Push the `velour-v4/` contents to a GitHub repo
2. Repo Settings → Pages → Source: **GitHub Actions** or **Deploy from branch**
3. Set branch to `main`, folder to `/` (root)

> HTTPS is required for service workers and push notifications to work. All options above provide it.

---

## Step 5 — Install as PWA

Once deployed to HTTPS:

- **iOS Safari:** Share button → **Add to Home Screen**
- **Android Chrome:** Menu → **Add to Home Screen** (or tap the install banner)
- **Desktop Chrome/Edge:** Click the install icon in the address bar

---

## Firestore Data Structure

```
users/
  {uid}/
    displayName: string
    email: string
    photoUrl: string
    lastSeen: timestamp
    inviteCode: string        ← 6-char partner invite code
    partnerUid: string        ← set when connected
    pendingRequest: {         ← incoming partner request
      fromUid, fromName, fromEmail, fromCode, timestamp
    }
    cycleStart: string        ← "YYYY-MM-DD" user-set cycle start
    
    logs/
      {YYYY-MM-DD}/
        mood: number (1-10)
        energy: number (1-10)
        stress: number (1-10)
        focus: number (1-10)
        sleepHours: number
        libido: number | null
        symptoms: string (JSON array)
        phase: string
        cyclePhase: string
        updatedAt: timestamp
        # notes are NEVER synced — local only
    
    push/
      subscription/
        endpoint: string
        keys: { p256dh, auth }
```

---

## The Spermatogenesis Cycle

Velour's star feature: a 74-day wellness cycle modelled (loosely, humorously) on spermatogenesis.

| Days | Phase | Vibe |
|---|---|---|
| 1–10 | Proliferative Phase | New cycle, rising energy |
| 11–18 | Peak Production | Maximum output, power window |
| 19–30 | Maturation Phase | Focus, quality work |
| 31–50 | Transport Phase | Flow state, collaboration |
| 51–62 | Recharge Phase | Recovery, rest is productive |
| 63–74 | Renewal Phase | Reflection, reset |

The user sets their cycle start date once. The app calculates which phase they're in and shows a radial progress ring on the dashboard.

**The science disclaimer:** Real spermatogenesis takes ~74 days and happens continuously — there's no actual "cycle" affecting your mood. This is wellness tracking with a comedic framing. The underlying mood/energy/sleep tracking is 100% real and useful.

---

## Partner Sync — How the Code System Works

No email lookup, no account search. Just codes.

1. **User A** opens Partner Sync — sees their 6-character code (e.g. `AB12CD`)
2. **User A** shares the code via the Share button (Web Share API) or copies it manually
3. **User B** enters the code in "Enter Partner's Code" and clicks Connect
4. Velour writes a `pendingRequest` to User A's Firestore document
5. User A's real-time listener fires instantly — they see the request appear live
6. User A accepts — both users are linked via `partnerUid` in Firestore
7. Partner log data now streams in real-time via `onSnapshot`

Data that syncs: mood, energy, sleep, stress, phase
Data that never syncs: personal notes (local-only, always)

---

## Local Development

No build step needed — it's plain HTML/CSS/JS.

```bash
# Any static server works. Example with Python:
cd velour-v4
python3 -m http.server 3000
# Open http://localhost:3000

# Or with Node.js npx:
npx serve .

# Or VS Code Live Server extension — just click "Go Live"
```

> Google Sign-In works on `localhost` without adding it to authorized domains (Firebase adds it automatically).

---

## Troubleshooting

**Google sign-in fails with "auth/unauthorized-domain"**
→ Add your domain to Firebase Console → Authentication → Settings → Authorized domains

**Push notifications not working on iOS**
→ iOS requires the PWA to be installed to Home Screen first. Safari → Share → Add to Home Screen, then open from Home Screen.

**Firestore rules show a parsing error on every line**
→ This happens when you paste the new rules on top of the existing locked-mode block instead of replacing it. The editor ends up with two `rules_version` declarations and two `service` blocks, which is invalid. Fix: click inside the rules editor, press Ctrl+A (Cmd+A on Mac) to select all, then delete, then paste the new rules fresh.

**Firestore permission denied**
→ Check that your rules were published successfully (green confirmation bar appeared). Rules can take up to 60 seconds to propagate. Also confirm the user is signed in — all Velour rules require `request.auth != null`.

**Partner code not found**
→ Both users must be signed in with Google (guest mode doesn't support partner sync). The code is generated on first visit to the Partner tab.

**App not installing as PWA**
→ Must be served over HTTPS. `localhost` counts as secure for testing.

**AI chat says "Add your Gemini API key"**
→ Replace `YOUR_GEMINI_API_KEY` in `index.html` with your actual key from aistudio.google.com

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML/CSS/JS — zero build step |
| Fonts | Bricolage Grotesque + DM Sans (Google Fonts) |
| Auth | Firebase Authentication (Google Sign-In) |
| Database | Firebase Firestore (primary) + IndexedDB (offline cache) |
| AI | Google Gemini 1.5 Flash |
| Push | Web Push API + Firebase Cloud Messaging |
| Offline | Service Worker + Cache API |
| Hosting | Any static host (Netlify, Vercel, Firebase, GitHub Pages) |

---

## Environment Variables (Production)

For production, avoid hardcoding keys in `index.html`. Use a build step or server-side injection:

**Option 1: Netlify environment variables**
```toml
# netlify.toml
[build]
  command = "node inject-config.js"
  publish = "dist"
```

```javascript
// inject-config.js
const fs = require('fs');
let html = fs.readFileSync('index.html', 'utf8');
html = html.replace('YOUR_API_KEY', process.env.FIREBASE_API_KEY);
// ... etc
fs.writeFileSync('dist/index.html', html);
fs.copyFileSync('sw.js', 'dist/sw.js');
fs.copyFileSync('manifest.json', 'dist/manifest.json');
```

**Option 2: Firebase Hosting with config injection**
Firebase Hosting can auto-inject the Firebase config — see [Firebase docs](https://firebase.google.com/docs/hosting/reserved-urls#sdk_auto-configuration).

---

*Built with questionable science and excellent taste. Track wisely.*
