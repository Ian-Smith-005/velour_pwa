# Velour PWA — Setup & Deployment Guide

## Quick Start (Guest Mode — works immediately)
Open `public/index.html` in a browser. No setup needed for local data & AI chat.

## Full Setup (Firebase Auth + Partner Sync)

### 1. Firebase Setup
1. Go to [Firebase Console](https://console.firebase.google.com) → Create project
2. Enable **Authentication** → Sign-in method → **Google**
3. Enable **Firestore Database** → Start in production mode
4. Add a **Web app** → copy the config object
5. In `public/index.html`, replace the `FIREBASE_CONFIG` block:

```js
const FIREBASE_CONFIG = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};
```

### 2. Gemini AI Setup
1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Create a free API key
3. In `public/index.html`, replace:

```js
const GEMINI_API_KEY = "your-gemini-key-here";
```

### 3. Firestore Security Rules
In Firebase Console → Firestore → Rules, paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
      match /logs/{logId} {
        allow read: if request.auth != null;
        allow write: if request.auth != null && request.auth.uid == userId;
      }
      match /partnerRequests/{reqId} {
        allow read, write: if request.auth != null;
      }
    }
  }
}
```

### 4. Authorized Domains (for Google Sign-In)
Firebase Console → Authentication → Settings → Authorized domains
Add your deployment domain (e.g. `velour.yourdomain.com`)

---

## Deployment Options

### Option A: Firebase Hosting (recommended — free)
```bash
npm install -g firebase-tools
firebase login
firebase init hosting   # select public/ as public dir, SPA: yes
firebase deploy
```

### Option B: Vercel
```bash
npm install -g vercel
cd public
vercel --prod
```

### Option C: Netlify
Drag & drop the `public/` folder at https://app.netlify.com/drop

### Option D: Any static host
Upload the contents of `public/` to any web server.
Ensure `manifest.json` and `sw.js` are served from the same origin as `index.html`.

---

## PWA Install (Add to Home Screen)
- **iOS Safari**: Share → Add to Home Screen
- **Android Chrome**: Menu → Add to Home Screen (or install banner auto-appears)
- **Desktop Chrome**: Address bar install icon

## File Structure
```
velour-pwa/
└── public/
    ├── index.html   ← Entire app (all screens, logic, styles)
    ├── manifest.json ← PWA manifest (name, icons, theme)
    └── sw.js        ← Service worker (offline caching)
```

## Features
| Feature | Guest Mode | With Firebase |
|---|---|---|
| Daily logging | ✅ Local (IndexedDB) | ✅ + cloud backup |
| Insights & trends | ✅ | ✅ |
| Calendar view | ✅ | ✅ |
| AI wellness coach | ✅ (needs Gemini key) | ✅ |
| Partner sync | ❌ | ✅ |
| Cross-device sync | ❌ | ✅ |
| Offline support | ✅ (service worker) | ✅ |

## ANR → PWA Migration Notes
The original Android ANRs were caused by:
- Firestore listeners stacking on every re-render (now: single managed listeners)
- Room DB called from main coroutine competing with flow collectors (now: IndexedDB async, non-blocking)
- OkHttp BODY logging on I/O thread (now: no logging layer needed)
- `loadDashboard()` called after every `saveLog()` (now: reactive — dashboard reads from same IDB store)
