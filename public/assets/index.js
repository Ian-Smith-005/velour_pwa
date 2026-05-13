import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  onSnapshot,
  writeBatch,
  updateDoc,
  deleteField,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ─── CONFIG ─────────────────────────────────── */
// Replace these with your Firebase config + Gemini key
const FB = {
  apiKey: "AIzaSyAKA1dM-WnQ56L3BEEycpuJ5oHVAdYit_U",
  authDomain: "velour-app-22f69.firebaseapp.com",
  databaseURL: "https://velour-app-22f69-default-rtdb.firebaseio.com",
  projectId: "velour-app-22f69",
  storageBucket: "velour-app-22f69.firebasestorage.app",
  messagingSenderId: "394876548225",
  appId: "1:394876548225:web:fc0fc98e951f87215c4980",
};
const VAPID_KEY =
  "BDBnahouOzDo_PV-dJ30TOeSv4YGysdUic8QlnRaLtn2c6FgKN-cAMjiOAo3YxlZCyZujh2at_Ljskz5e5e56u0"; // from Firebase Console > Cloud Messaging
const GK = "AIzaSyDvcK_Tw4L9omTCEgi_hYuLtqY-kIMGcnM"; // Gemini API key
const GU = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GK}`;

/* ─── FIREBASE INIT ──────────────────────────── */
let auth,
  db,
  me = null,
  fbOk = false;
try {
  if (!FB.apiKey.startsWith("YOUR_")) {
    const a = initializeApp(FB);
    auth = getAuth(a);
    db = getFirestore(a);
    fbOk = true;
  }
} catch (e) {
  console.warn("Firebase not configured:", e.message);
}

/* ─── APP MODE ───────────────────────────────── */
// 'client' = normal user tracking their own cycle
// 'partner' = read-only partner viewing someone else's cycle
let appMode = "client"; // set on mode select screen

/* ─── INDEXEDDB (local fallback) ─────────────── */
let idb = null;
const openDB = () =>
  new Promise((res, rej) => {
    const r = indexedDB.open("velour_v4", 1);
    r.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("logs"))
        d.createObjectStore("logs", { keyPath: "date" });
      if (!d.objectStoreNames.contains("prefs"))
        d.createObjectStore("prefs", { keyPath: "key" });
      if (!d.objectStoreNames.contains("notifs"))
        d.createObjectStore("notifs", {
          keyPath: "id",
          autoIncrement: true,
        });
    };
    r.onsuccess = (e) => res(e.target.result);
    r.onerror = (e) => rej(e.target.error);
  });
const op = (s, m, fn) =>
  new Promise((res, rej) => {
    const r = fn(idb.transaction(s, m).objectStore(s));
    r.onsuccess = (e) => res(e.target.result);
    r.onerror = (e) => rej(e.target.error);
  });
const iGet = (s, k) => op(s, "readonly", (o) => o.get(k));
const iPut = (s, v) => op(s, "readwrite", (o) => o.put(v));
const iAll = (s) => op(s, "readonly", (o) => o.getAll());
const getPref = (k, d = null) =>
  iGet("prefs", k).then((r) => (r ? r.value : d));
const setPref = (k, v) => iPut("prefs", { key: k, value: v });

/* ─── DATA LAYER ─────────────────────────────── */
// Primary DB: Firestore (if configured). Fallback: IndexedDB only.
const tod = () => new Date().toISOString().slice(0, 10);

async function saveLog(log) {
  log.date = log.date || tod();
  log.ts = Date.now();
  await iPut("logs", log); // always save locally first
  if (fbOk && me) {
    try {
      const { notes: _, ...pub } = log; // never sync private notes
      await setDoc(
        doc(db, "users", me.uid, "logs", log.date),
        { ...pub, updatedAt: serverTimestamp() },
        { merge: true },
      );
    } catch (e) {
      console.warn("Firestore save failed:", e.message);
    }
  }
}
async function getLog() {
  // Try Firestore first if online, else local
  if (fbOk && me) {
    try {
      const snap = await getDoc(doc(db, "users", me.uid, "logs", tod()));
      if (snap.exists()) {
        const d = snap.data();
        await iPut("logs", { ...d, date: tod() });
        return d;
      }
    } catch (e) {}
  }
  return iGet("logs", tod());
}
async function getLogs() {
  if (fbOk && me) {
    try {
      const snap = await getDocs(
        query(
          collection(db, "users", me.uid, "logs"),
          orderBy("date", "desc"),
          limit(90),
        ),
      );
      const logs = snap.docs.map((d) => ({ date: d.id, ...d.data() }));
      for (const l of logs) await iPut("logs", l); // cache locally
      return logs;
    } catch (e) {}
  }
  const all = await iAll("logs");
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

/* ─── SPERMATOGENESIS CYCLE (74 days) ───────────
   We mimic a menstrual cycle but for the "male cycle".
   The real spermatogenesis cycle is ~74 days, so we map
   wellness phases across that timeline — with tongue-in-cheek
   naming that mirrors the original app's concept.
   Phase names mirror follicular/ovulation/luteal energy
   patterns because... why not? It's funnier that way.
────────────────────────────────────────────────── */
const CYCLE_DAYS = 74;

// Map a day of the cycle (1-74) to a phase
function cyclePhase(day) {
  if (day <= 10)
    return {
      id: "proliferative",
      n: "Proliferative Phase",
      s: "Genesis",
      desc: "New cycle, new sperm. Factory floor at full production. Testosterone rising.",
      tips: [
        "Great week for starting new projects",
        "High testosterone = high confidence",
      ],
      c: "#5B0EA6",
      rec: "Build habits now that future-you will be grateful for.",
    };
  if (day <= 18)
    return {
      id: "peak",
      n: "Peak Production",
      s: "Peak",
      desc: "Maximum output. All systems at 100%. This is your power window.",
      tips: [
        "Best week for hard workouts and high performance",
        "Social energy is peaked",
      ],
      c: "#7C3AED",
      rec: "Schedule your most challenging tasks this week.",
    };
  if (day <= 30)
    return {
      id: "maturation",
      n: "Maturation Phase",
      s: "Refine",
      desc: "Quality control in progress. Energy steady, focus sharp.",
      tips: [
        "Good for detail-oriented work",
        "Sustained energy — use it for deep work",
      ],
      c: "#6366F1",
      rec: "Deep work, learning, and skill-building are optimal now.",
    };
  if (day <= 50)
    return {
      id: "transport",
      n: "Transport Phase",
      s: "Flow",
      desc: "Systems are flowing. Not peak, but reliable. Like a well-oiled machine.",
      tips: [
        "Collaborative work shines here",
        "Good for communication and networking",
      ],
      c: "#4F46E5",
      rec: "Team projects and social commitments work well now.",
    };
  if (day <= 62)
    return {
      id: "decline",
      n: "Recharge Phase",
      s: "Rest",
      desc: "Energy dipping. Your body is reallocating resources. Rest is productive.",
      tips: [
        "Prioritize sleep and recovery",
        "Light exercise only — no ego lifting",
      ],
      c: "#6B7280",
      rec: "Prioritize nutrition, sleep 8h+, and stress management.",
    };
  return {
    id: "renewal",
    n: "Renewal Phase",
    s: "Reset",
    desc: "Cycle end. New beginnings loading... Factory reset incoming.",
    tips: [
      "Reflect on the cycle — what worked?",
      "Prepare for the next Genesis phase",
    ],
    c: "#374151",
    rec: "Journal, reflect, and prepare for the next cycle peak.",
  };
}

// Get current cycle day based on user-set start date
async function getCycleDay() {
  const startStr = await getPref("cycle_start");
  if (!startStr) return null;
  const start = new Date(startStr);
  const now = new Date();
  const diff = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  return (((diff % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS) + 1;
}

// Phase from log (energy-based) or cycle-based
async function phaseFrom(log) {
  const day = await getCycleDay();
  if (day) return cyclePhase(day);
  // Fallback to energy-based if no cycle set
  if (!log) return cyclePhase(37); // transport/flow phase
  if (log.energy >= 8) return cyclePhase(15);
  if (log.energy >= 6) return cyclePhase(25);
  if (log.energy >= 4) return cyclePhase(37);
  if (log.energy >= 2) return cyclePhase(55);
  return cyclePhase(68);
}

/* ─── SYMPTOMS ───────────────────────────────── */
const SX = [
  "Fatigue",
  "Irritability",
  "Confidence spike",
  "Low motivation",
  "Laser focus",
  "Brain fog",
  "High drive",
  "Social energy",
  "Need solitude",
  "Gym ready",
  "Headache",
  "Low mood",
  "Restless",
  "Calm",
];

/* ─── MOOD QUOTES ────────────────────────────── */
const MQ = [
  "Even rocks have bad days.",
  "Gravity feels personal today.",
  "Not great, not terrible.",
  "Could be worse.",
  "Solidly mid.",
  "Things are going.",
  "Pretty decent.",
  "Good day — enjoy it.",
  "Excellent. Probably hydrated.",
  "Absolute peak energy. Legendary.",
];

/* ─── ONBOARDING DATA ────────────────────────── */
const OB = [
  {
    ic: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="30" height="30"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
    t: "Welcome to Velour",
    s: "The first male cycle tracker. Sort of.",
    f: "Did you know men have an ~74-day spermatogenesis cycle? We track that now. You're welcome.",
  },
  {
    ic: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="30" height="30"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
    t: "Track Like a King",
    s: "Log mood, energy, stress and sleep every day.",
    f: "Testosterone fluctuates daily, weekly, and seasonally. Your data will actually show this.",
  },
  {
    ic: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="30" height="30"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
    t: "AI Wellness Coach",
    s: "Ask anything. Our AI will not judge you.",
    f: "Science says writing about your feelings helps. Our AI says the same thing, but funnier.",
  },
  {
    ic: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="30" height="30"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
    t: "Your Data in Firestore",
    s: "Real-time sync across all your devices.",
    f: "Data lives in your Firebase project. Not ours. We just wrote the code.",
  },
];

/* ─── AMBIENT BUBBLES ────────────────────────── */
function spawnBubbles() {
  const c = document.getElementById("bb");
  for (let i = 0; i < 11; i++) {
    const b = document.createElement("div");
    b.className = "bub";
    const sz = Math.random() * 55 + 18;
    b.style.cssText = `width:${sz}px;height:${sz}px;left:${Math.random() * 100}%;animation-duration:${Math.random() * 17 + 11}s;animation-delay:${Math.random() * 18}s`;
    c.appendChild(b);
  }
}

/* ─── AOS ────────────────────────────────────── */
function aos(el = document) {
  requestAnimationFrame(() => {
    (el.querySelectorAll ? el : document)
      .querySelectorAll("[data-a]")
      .forEach((e) => {
        setTimeout(
          () => e.classList.add("done"),
          parseInt(e.dataset.a || 0) * 50,
        );
      });
  });
}

/* ─── NAVIGATION ─────────────────────────────── */
let cur = "login",
  hist = [];
function go(id, push = true) {
  const prev = document.querySelector(".sc.on");
  const next = document.getElementById("screen-" + id);
  if (!next || next === prev) return;
  if (prev) {
    prev.classList.remove("on");
    prev.classList.add("out");
    setTimeout(() => prev.classList.remove("out"), 200);
  }
  next.classList.add("on");
  next.scrollTop = 0;
  if (push && !["login", "onboarding"].includes(id)) hist.push(id);
  cur = id;
  const mains = ["dashboard", "tracker", "calendar", "insights", "partner"];
  const nav = document.getElementById("nav"),
    fab = document.getElementById("chat-fab");
  // Partner-view is a full-screen mode (no nav, no chat fab)
  if (id === "partner-view") {
    nav.classList.remove("on");
    fab.style.display = "none";
    rPartnerView();
    aos(next);
    return;
  }
  if (mains.includes(id)) {
    nav.classList.add("on");
    fab.style.display = "flex";
    document
      .querySelectorAll(".ni[data-nav]")
      .forEach((b) => b.classList.toggle("on", b.dataset.nav === id));
  } else {
    nav.classList.remove("on");
    fab.style.display = "none";
  }
  if (id === "dashboard") rDash();
  if (id === "insights") rIns();
  if (id === "calendar") rCal();
  if (id === "partner") rPart();
  if (id === "tracker") resetT();
  aos(next);
}
const goBack = () => {
  if (hist.length > 1) {
    hist.pop();
    go(hist[hist.length - 1], false);
  } else go("dashboard", false);
};

/* ─── ONBOARDING ─────────────────────────────── */
let obP = 0;
function rOb() {
  const d = OB[obP];
  document.getElementById("ob-icon").innerHTML = d.ic;
  document.getElementById("ob-title").textContent = d.t;
  document.getElementById("ob-sub").textContent = d.s;
  document.getElementById("ob-fact").textContent = d.f;
  document
    .querySelectorAll(".dot")
    .forEach((el, i) => el.classList.toggle("on", i === obP));
  const last = obP === OB.length - 1;
  document.getElementById("ob-next").textContent = last
    ? "Enter Velour"
    : "Continue";
  document.getElementById("ob-skip").classList.toggle("hid", last);
}
document.getElementById("ob-next").addEventListener("click", () => {
  if (obP < OB.length - 1) {
    obP++;
    rOb();
  } else {
    setPref("onboarded", true);
    go("dashboard");
    hist = ["dashboard"];
  }
});
document.getElementById("ob-skip").addEventListener("click", () => {
  setPref("onboarded", true);
  go("dashboard");
  hist = ["dashboard"];
});

/* ─── AUTH ───────────────────────────────────── */
async function afterLogin(user) {
  me = user;
  if (user && fbOk) {
    // Sync any cached local logs to Firestore
    try {
      const local = await iAll("logs");
      for (const l of local.slice(0, 7)) {
        const { notes: _, ...pub } = l;
        await setDoc(
          doc(db, "users", me.uid, "logs", l.date),
          { ...pub, updatedAt: serverTimestamp() },
          { merge: true },
        );
      }
    } catch (e) {}
    listenForPartnerRequests();
    // Initialize AI chat listeners
    initAIChatListeners();

    // Fetch user profile to get name and phase
    try {
      const userDoc = await getDoc(doc(db, "users", me.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        userName = userData.displayName || "";
        // Try to get cycle phase from stored data or calculate it
        userPhase = userData.currentPhase || "";
      }
    } catch (error) {
      console.error("Error fetching user profile:", error);
    }

    // Set up listener for profile changes
    setupProfileChangeListener();
  }
  const ob = await getPref("onboarded");
  if (!ob) go("onboarding");
  else {
    if (appMode === "partner") {
      go("partner-view");
    } else {
      go("dashboard");
      hist = ["dashboard"];
    }
  }
}

document.getElementById("btn-google").addEventListener("click", async () => {
  if (!fbOk) {
    const el = document.getElementById("login-err");
    el.textContent = "Firebase not configured — see README.md for setup.";
    el.classList.remove("hid");
    return;
  }
  try {
    const r = await signInWithPopup(auth, new GoogleAuthProvider());
    try {
      await setDoc(
        doc(db, "users", r.user.uid),
        {
          displayName: r.user.displayName || "",
          email: r.user.email || "",
          photoUrl: r.user.photoURL || "",
          lastSeen: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (profileErr) {
      console.warn("Profile save failed:", profileErr);
      // Non-fatal — continue to app
    }
    await afterLogin(r.user);
  } catch (e) {
    console.error("Sign-in error:", e);
    const el = document.getElementById("login-err");
    el.textContent = "Sign-in failed. Please try again.";
    el.classList.remove("hid");
  }
});
document
  .getElementById("btn-guest")
  .addEventListener("click", () => afterLogin(null));
if (fbOk)
  onAuthStateChanged(auth, async (u) => {
    if (u && cur === "login") await afterLogin(u);
  });
document.getElementById("signout-btn")?.addEventListener("click", async () => {
  if (fbOk && auth) await signOut(auth);
  // Clean up chat listeners
  if (partnerChatUnsub) {
    partnerChatUnsub();
    partnerChatUnsub = null;
  }
  if (aiChatUnsub) {
    aiChatUnsub();
    aiChatUnsub = null;
  }
  me = null;
  hist = [];
  appMode = "client";
  await setPref("appMode", null);
  document.getElementById("nav").classList.remove("on");
  document.getElementById("chat-fab").style.display = "none";
  go("mode", false);
});
document
  .getElementById("pv-signout-btn")
  ?.addEventListener("click", async () => {
    if (fbOk && auth) await signOut(auth);
    me = null;
    hist = [];
    appMode = "client";
    await setPref("appMode", null);
    go("mode", false);
  });

/* ─── DASHBOARD RENDER ───────────────────────── */
const greet = () => {
  const h = new Date().getHours();
  return h < 5
    ? "Night shift, champion"
    : h < 12
      ? "Good morning"
      : h < 17
        ? "Good afternoon"
        : h < 21
          ? "Good evening"
          : "Burning midnight oil";
};

async function rDash() {
  document.getElementById("d-greet").textContent = greet();
  const name = me?.displayName?.split(" ")[0];
  document.getElementById("d-name").textContent = name
    ? "Welcome back, " + name
    : "";
  // Set user avatar
  const avatar = document.getElementById('d-avatar');
  if (avatar) {
    avatar.src = userPhotoURL || '';
  }
  const log = await getLog();
  const ph = await phaseFrom(log);
  const day = await getCycleDay();

  // Phase card with cycle ring
  const ring = day
    ? `
    <div class="cycle-ring" style="margin-bottom:14px">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(124,58,237,.15)" stroke-width="8"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="${ph.c}" stroke-width="8"
          stroke-dasharray="${2 * Math.PI * 42}" stroke-dashoffset="${2 * Math.PI * 42 * (1 - day / CYCLE_DAYS)}"
          stroke-linecap="round" transform="rotate(-90 50 50)"
          style="transition:stroke-dashoffset .8s cubic-bezier(.34,1.56,.64,1)"/>
      </svg>
      <div class="cycle-day-badge">
        <div class="cycle-day-num" style="color:${ph.c}">${day}</div>
        <div class="cycle-day-lbl">of ${CYCLE_DAYS} days</div>
      </div>
    </div>`
    : "";

  document.getElementById("pcard").innerHTML = `
    ${ring}
    <div class="f ic g3 mb3">
      <div style="width:36px;height:36px;border-radius:9px;background:${ph.c}22;color:${ph.c};display:flex;align-items:center;justify-content:center;flex-shrink:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </div>
      <div class="f1">
        <div class="xs mu">${day ? `Day ${day} — ` : ""}Spermatogenesis Cycle</div>
        <div class="fd bold" style="font-size:.9rem;color:${ph.c}">${ph.n}</div>
      </div>
      <div class="phase-pill" style="color:${ph.c};border-color:${ph.c}44;background:${ph.c}16">${ph.s}</div>
    </div>
    <p class="sm mu mb3" style="line-height:1.6">${ph.desc}</p>
    ${ph.tips.map((t) => `<div class="f ic g2 sm mu" style="margin-bottom:3px"><div style="width:3px;height:3px;border-radius:50%;background:${ph.c};flex-shrink:0"></div>${t}</div>`).join("")}
    ${
      !day
        ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--rim)"><p class="xs mu mb2">Set your cycle start date to track your ${CYCLE_DAYS}-day cycle:</p>
    <div class="f g2"><input type="date" id="cycle-date-inp" class="inp f1" style="height:34px;font-size:.77rem" value="${new Date().toISOString().slice(0, 10)}"/>
    <button class="btn btn-p btn-sm" id="set-cycle-btn" style="width:auto;padding:0 12px">Set</button></div></div>`
        : ""
    }
    <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--rim)">
      <div class="xs mu mb2">Rec: ${ph.rec}</div>
    </div>`;

  document.getElementById("pcard").style.cssText =
    `border-radius:var(--r);padding:13px 15px;margin:0 13px 13px;position:relative;z-index:2;box-shadow:0 6px 22px rgba(0,0,0,.32);background:linear-gradient(135deg,${ph.c}20,${ph.c}09);border:1px solid ${ph.c}2e`;

  document
    .getElementById("set-cycle-btn")
    ?.addEventListener("click", async () => {
      const v = document.getElementById("cycle-date-inp")?.value;
      if (v) {
        await setPref("cycle_start", v);
        if (fbOk && me) {
          try {
            await updateDoc(doc(db, "users", me.uid), { cycleStart: v });
          } catch (e) {}
        }
        rDash();
      }
    });

  if (log) {
    document.getElementById("vsec").classList.remove("hid");
    document.getElementById("v-mood").textContent = log.mood + "/10";
    document.getElementById("v-en").textContent = log.energy + "/10";
    document.getElementById("v-st").textContent = log.stress + "/10";
  } else document.getElementById("vsec").classList.add("hid");
}
document.getElementById("d-log").addEventListener("click", () => go("tracker"));
document
  .getElementById("d-ins")
  .addEventListener("click", () => go("insights"));

/* ─── TRACKER ────────────────────────────────── */
let selSx = new Set();
function resetT() {
  selSx.clear();
  ["r-m", "r-e", "r-s", "r-f", "r-l"].forEach(
    (id) => (document.getElementById(id).value = 5),
  );
  document.getElementById("r-sl").value = 7;
  document.getElementById("lib-tog").checked = false;
  document.getElementById("lib-row").classList.add("hid");
  document.getElementById("nt-inp").value = "";
  uRanges();
  buildSx();
}
function uRanges() {
  const m = +document.getElementById("r-m").value;
  document.getElementById("mv").textContent = m;
  document.getElementById("mq").textContent = '"' + MQ[m - 1] + '"';
  document.getElementById("ev").textContent =
    document.getElementById("r-e").value;
  document.getElementById("sv").textContent =
    document.getElementById("r-s").value;
  const st = +document.getElementById("r-s").value;
  document.getElementById("smsg").textContent =
    st > 7 ? "High stress. Breathe." : st < 4 ? "Calm." : "Manageable.";
  document.getElementById("fv").textContent =
    document.getElementById("r-f").value;
  const sl = +document.getElementById("r-sl").value;
  document.getElementById("slv").textContent = sl.toFixed(1);
  document.getElementById("slmsg").textContent =
    sl < 6
      ? "Under 6h. Factory output may suffer."
      : sl >= 8
        ? "8h+. Optimal production conditions."
        : "Decent. Could be better.";
  document.getElementById("lv").textContent =
    document.getElementById("r-l").value;
}
["r-m", "r-e", "r-s", "r-f", "r-sl", "r-l"].forEach((id) =>
  document.getElementById(id).addEventListener("input", uRanges),
);
document
  .getElementById("lib-tog")
  .addEventListener("change", (e) =>
    document
      .getElementById("lib-row")
      .classList.toggle("hid", !e.target.checked),
  );
function buildSx() {
  const g = document.getElementById("sx-grid");
  g.innerHTML = SX.map(
    (s) => `<button class="chip" data-s="${s}">${s}</button>`,
  ).join("");
  g.querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => {
      selSx.has(b.dataset.s)
        ? (selSx.delete(b.dataset.s), b.classList.remove("on"))
        : (selSx.add(b.dataset.s), b.classList.add("on"));
    }),
  );
}
document.getElementById("save-btn").addEventListener("click", async () => {
  const btn = document.getElementById("save-btn");
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Saving...';
  const energy = +document.getElementById("r-e").value;
  const ph = await phaseFrom({ energy });
  const log = {
    date: tod(),
    mood: +document.getElementById("r-m").value,
    energy,
    stress: +document.getElementById("r-s").value,
    focus: +document.getElementById("r-f").value,
    sleepHours: +document.getElementById("r-sl").value,
    libido: document.getElementById("lib-tog").checked
      ? +document.getElementById("r-l").value
      : null,
    symptoms: JSON.stringify([...selSx]),
    notes: document.getElementById("nt-inp").value,
    phase: ph.n,
    cyclePhase: ph.id,
  };
  await saveLog(log);
  addNotif({
    type: "log",
    title: "Log saved",
    body: `Day logged — ${ph.n} phase. Keep it up.`,
    icon: "check",
  });
  btn.disabled = false;
  btn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg> Save Today\'s Log';
  goBack();
});

/* ─── INSIGHTS ───────────────────────────────── */
async function rIns() {
  const body = document.getElementById("ins-body"),
    logs = await getLogs();
  if (!logs.length) {
    body.innerHTML = `<div class="tc" style="padding:44px 16px">
      <div style="width:48px;height:48px;border-radius:13px;background:var(--layer);border:1px solid var(--rim);display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="20" height="20"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      </div>
      <h2 class="mb2">No data yet</h2><p class="mu sm">Start logging — insights appear after a few days.</p></div>`;
    return;
  }
  const avg = (fn) =>
    (logs.reduce((s, l) => s + fn(l), 0) / logs.length).toFixed(1);
  const am = avg((l) => l.mood),
    ae = avg((l) => l.energy),
    asl = avg((l) => l.sleepHours);
  const r14 = logs.slice(0, 14).reverse();
  const hes = logs.filter((l) => l.sleepHours >= 7.5 && l.energy >= 7).length;
  const shi = logs.filter((l) => l.stress >= 7 && l.mood <= 4).length;
  // Phase distribution
  const phases = {};
  logs.forEach((l) => {
    if (l.phase) {
      phases[l.phase] = (phases[l.phase] || 0) + 1;
    }
  });
  const topPhase = Object.entries(phases).sort((a, b) => b[1] - a[1])[0];

  body.innerHTML = `
  <div class="spill" data-a="1">
    <div class="sp"><div class="sn so">${logs.length}</div><div class="sl">Days Logged</div></div>
    <div class="sp"><div class="sn" style="color:var(--lil)">${am}</div><div class="sl">Avg Mood</div></div>
    <div class="sp"><div class="sn" style="color:#7C3AED">${ae}</div><div class="sl">Avg Energy</div></div>
    <div class="sp"><div class="sn" style="color:#6366F1">${asl}h</div><div class="sl">Avg Sleep</div></div>
  </div>
  ${
    r14.length >= 2
      ? `<div class="card" data-a="2"><div class="semi sm mb3">14-Day Mood Trend</div>
    <div class="cbars">${r14.map((l) => `<div class="bar" style="height:${Math.round((l.mood / 10) * 100)}%" title="${l.date}: ${l.mood}"></div>`).join("")}</div>
  </div>`
      : ""
  }
  <div class="card" data-a="3"><div class="semi sm mb3">Cycle Insights</div>
    ${
      topPhase
        ? `<div class="ii"><div class="ii-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
    <div><div class="semi sm mb2 so">Dominant Phase</div><div class="xs mu" style="line-height:1.6">You spend most time in <strong>${topPhase[0]}</strong> (${topPhase[1]} days logged). Plan accordingly.</div></div></div>`
        : ""
    }
    <div class="ii"><div class="ii-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 18a5 5 0 00-10 0"/><line x1="12" y1="2" x2="12" y2="9"/></svg></div>
    <div><div class="semi sm mb2 so">Sleep</div><div class="xs mu" style="line-height:1.6">${+asl >= 7.5 ? `${asl}h average. Factory running at capacity.` : `${asl}h average. Sperm don't thrive on poor sleep. Neither do you.`}</div></div></div>
    ${
      hes > 0
        ? `<div class="ii"><div class="ii-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
    <div><div class="semi sm mb2 so">Sleep → Energy</div><div class="xs mu" style="line-height:1.6">On ${hes} days with 7.5h+ sleep, you hit high energy. The correlation is real.</div></div></div>`
        : ""
    }
    ${
      shi > 0
        ? `<div class="ii"><div class="ii-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg></div>
    <div><div class="semi sm mb2 so">Stress Impact</div><div class="xs mu" style="line-height:1.6">${shi} high-stress days correlated with low mood. Stress tanks testosterone too — fact.</div></div></div>`
        : ""
    }
    <div class="ii" style="border-bottom:none"><div class="ii-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg></div>
    <div><div class="semi sm mb2 ok">Best Days</div><div class="xs mu" style="line-height:1.6">Your peak performance days cluster at energy 7+. That's your window.</div></div></div>
  </div>
  ${
    logs.length >= 3
      ? `<div class="card" data-a="4"><div class="semi sm mb3">This Week</div>
    ${logs
      .slice(0, 7)
      .map(
        (l) => `<div class="f ic g3" style="margin-bottom:7px">
      <div class="xs mu" style="width:34px">${l.date.slice(5)}</div>
      <div class="pb f1"><div class="pf" style="width:${l.energy * 10}%"></div></div>
      <div class="xs so semi" style="width:30px;text-align:right">${l.energy}/10</div>
    </div>`,
      )
      .join("")}
  </div>`
      : ""
  }`;
  aos(body);
}

/* ─── CALENDAR ───────────────────────────────── */
let cY,
  cM,
  selD = null;
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
async function rCal() {
  const now = new Date();
  if (!cY) {
    cY = now.getFullYear();
    cM = now.getMonth();
  }
  const logs = await getLogs(),
    lm = {};
  logs.forEach((l) => (lm[l.date] = l));
  document.getElementById("cal-mo").textContent = `${MONTHS[cM]} ${cY}`;
  document.getElementById("cal-hd").innerHTML = DAYS.map(
    (d) => `<div class="chdr">${d}</div>`,
  ).join("");
  const fd = new Date(cY, cM, 1).getDay(),
    dm = new Date(cY, cM + 1, 0).getDate();
  let cells = Array(fd).fill(null);
  for (let i = 1; i <= dm; i++) cells.push(i);
  while (cells.length % 7 !== 0) cells.push(null);
  const gr = document.getElementById("cal-gr");
  gr.innerHTML = cells
    .map((day) => {
      if (!day) return `<div class="cday emp"></div>`;
      const ds = `${cY}-${String(cM + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const log = lm[ds],
        cd = new Date(cY, cM, day);
      const isTod = cd.toDateString() === now.toDateString(),
        isFut = cd > now,
        isSel = ds === selD;
      let cls = "cday";
      if (isTod) cls += " tod";
      if (isFut) cls += " fut";
      if (isSel) cls += " sel";
      else if (log) {
        cls += log.energy >= 8 ? " hi" : log.energy >= 6 ? " good" : " lo";
      }
      return `<div class="${cls}" data-d="${ds}">${day}${log && !isSel ? '<div class="cdot"></div>' : ""}</div>`;
    })
    .join("");
  gr.querySelectorAll(".cday:not(.emp):not(.fut)").forEach((c) =>
    c.addEventListener("click", () => {
      selD = c.dataset.d;
      rCal();
      showDD(lm[selD], selD);
    }),
  );
  if (selD) showDD(lm[selD], selD);
}
function showDD(log, ds) {
  const el = document.getElementById("day-det");
  el.classList.remove("hid");
  const d = new Date(ds + "T12:00:00");
  const dn = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][d.getDay()];
  if (!log) {
    el.innerHTML = `<div class="card"><div class="semi sm mb2">${dn}, ${MONTHS[d.getMonth()]} ${d.getDate()}</div><div class="xs mu">No log for this day.</div></div>`;
    return;
  }
  el.innerHTML = `<div class="card"><div class="semi sm mb3">${dn}, ${MONTHS[d.getMonth()]} ${d.getDate()}</div>
    <div class="mrow">
      <div class="ms"><div class="mv so">${log.mood}</div><div class="ml">Mood</div></div>
      <div class="ms"><div class="mv so">${log.energy}</div><div class="ml">Energy</div></div>
      <div class="ms"><div class="mv so">${log.stress}</div><div class="ml">Stress</div></div>
      <div class="ms"><div class="mv so">${log.sleepHours}h</div><div class="ml">Sleep</div></div>
    </div>
    ${log.phase ? `<div class="xs mu mt3" style="line-height:1.6;border-top:1px solid var(--rim);padding-top:9px;margin-top:9px">Phase: ${log.phase}</div>` : ""}
    ${log.notes ? `<div class="xs mu mt2" style="line-height:1.6;font-style:italic">"${log.notes}"</div>` : ""}
  </div>`;
}
document.getElementById("cal-p").addEventListener("click", () => {
  cM--;
  if (cM < 0) {
    cM = 11;
    cY--;
  }
  selD = null;
  document.getElementById("day-det").classList.add("hid");
  rCal();
});
document.getElementById("cal-n").addEventListener("click", () => {
  const n = new Date();
  if (cY === n.getFullYear() && cM >= n.getMonth()) return;
  cM++;
  if (cM > 11) {
    cM = 0;
    cY++;
  }
  selD = null;
  document.getElementById("day-det").classList.add("hid");
  rCal();
});

/* ─── PARTNER SYSTEM ─────────────────────────── */
// Real-time via 6-digit invite CODES stored in Firestore
// No email needed — just share the code

let pD = { info: null, req: null, logs: [], sync: false };
let pListeners = [];
let myCode = null;
// Partner chat
let pcH = []; // Partner chat history
let pcListeners = [];
let pcUnsub = null;

// Generate a random 6-char alphanumeric code
function genCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

// Create or get my invite code
async function getMyCode() {
  if (!fbOk || !me) return null;
  const snap = await getDoc(doc(db, "users", me.uid));
  if (snap.data()?.inviteCode) return snap.data().inviteCode;
  const code = genCode();
  await updateDoc(doc(db, "users", me.uid), { inviteCode: code });
  return code;
}

// Real-time listener for incoming partner requests
function listenForPartnerRequests() {
  if (!fbOk || !me) return;
  const unsub = onSnapshot(doc(db, "users", me.uid), async (snap) => {
    const data = snap.data() || {};
    const partnerUid = data.partnerUid;
    const req = data.pendingRequest;
    if (req && !partnerUid) {
      // Someone wants to connect
      pD.req = {
        fromUid: req.fromUid,
        fromName: req.fromName,
        fromEmail: req.fromEmail,
        fromCode: req.fromCode,
      };
      addNotif({
        type: "partner",
        title: "Partner request!",
        body: `${req.fromName} wants to sync with you.`,
        icon: "heart",
      });
    } else {
      pD.req = null;
    }
    if (partnerUid) {
      // Fetch partner profile + start real-time log sync
      try {
        const ps = await getDoc(doc(db, "users", partnerUid));
        if (ps.exists()) {
          pD.info = { uid: partnerUid, ...ps.data() };
          startPartnerLogSync(partnerUid);
          // Initialize partner chat listeners
          initPartnerChatListeners(partnerUid);
        }
      } catch (e) {}
    } else {
      pD.info = null;
      pD.logs = [];
      // Clean up partner chat listeners
      if (partnerChatUnsub) {
        partnerChatUnsub();
        partnerChatUnsub = null;
      }
    }
    if (cur === "partner") rPart();
    // Update partner chat UI when in client mode
    if (appMode === "client") {
      updatePartnerChatUI();
    }
  });
  pListeners.push(unsub);
}

// Real-time sync of partner logs
function startPartnerLogSync(partnerUid) {
  if (!fbOk) return;
  const unsub = onSnapshot(
    query(
      collection(db, "users", partnerUid, "logs"),
      orderBy("date", "desc"),
      limit(30),
    ),
    (snap) => {
      pD.logs = snap.docs.map((d) => ({ date: d.id, ...d.data() }));
      if (cur === "partner") rPart();
    },
    (e) => console.warn("Partner log sync:", e),
  );
  pListeners.push(unsub);
}

async function rPart() {
  const body = document.getElementById("pt-body");
  if (!fbOk || !me) {
    body.innerHTML = `<div class="card tc" style="padding:24px 14px">
      <div style="width:44px;height:44px;border-radius:12px;background:var(--layer);border:1px solid var(--rim);display:flex;align-items:center;justify-content:center;margin:0 auto 11px">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="20" height="20"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
      </div>
      <h3 class="mb2">Sign in for Partner Sync</h3>
      <p class="sm mu">Google sign-in required for real-time partner features.</p>
    </div>`;
    return;
  }

  myCode = await getMyCode();
  let h = "";

  // Incoming request banner
  if (pD.req) {
    h += `<div class="card" style="border-color:rgba(52,211,153,.3);background:rgba(52,211,153,.05);animation:fUp .3s ease">
      <div class="f ic g3 mb3">
        <div style="width:34px;height:34px;border-radius:9px;background:rgba(52,211,153,.15);display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        </div>
        <div>
          <div class="semi sm ok f ic g2"><div class="live-dot"></div>Partner Request!</div>
          <div class="xs mu">${pD.req.fromName} (code: ${pD.req.fromCode || "—"}) wants to sync with you.</div>
        </div>
      </div>
      <div class="apair" style="gap:7px">
        <button class="btn btn-a btn-sm" id="acc">Accept & Connect</button>
        <button class="btn btn-o btn-sm" id="dec">Decline</button>
      </div>
    </div>`;
  }

  // Connected partner — real-time data
  if (pD.info) {
    const ini = (pD.info.displayName || "?")[0].toUpperCase();
    h += `<div class="card">
      <div class="f ic g3 mb3">
        <div class="av">${ini}</div>
        <div class="f1">
          <div class="f ic g2"><div class="live-dot"></div><div class="semi sm">${pD.info.displayName || "Partner"}</div></div>
          <div class="xs mu">${pD.info.email || ""}</div>
          <span class="badge bgr" style="margin-top:4px">Live Sync Active</span>
        </div>
      </div>
      <div class="div"></div>
      <div class="f ic jb">
        <div><div class="semi sm">Share My Data</div><div class="xs mu">Mood, energy, sleep — no notes</div></div>
        <label class="tog"><input type="checkbox" id="sync-tog" ${pD.sync ? "checked" : ""}/><span class="tog-sl"></span></label>
      </div>
      <button class="btn btn-g btn-d btn-sm mt3" id="disc" style="justify-content:flex-start;gap:7px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M18.36 6.64a9 9 0 11-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
        Disconnect
      </button>
    </div>`;

    if (pD.sync && pD.logs.length) {
      const partnerPh = pD.logs[0]?.phase || "—";
      h += `<div class="card">
        <div class="f ic jb mb3">
          <div class="semi sm">Partner's Data</div>
          <div class="f ic g2 xs mu"><div class="live-dot"></div>Real-time</div>
        </div>
        <div class="f ic jb mb3">
          <div class="xs mu">Current phase</div>
          <div class="xs so semi">${partnerPh}</div>
        </div>
        ${pD.logs
          .slice(0, 7)
          .map(
            (l) => `<div class="f ic g3" style="margin-bottom:7px">
          <div class="xs mu" style="width:34px">${l.date.slice(5)}</div>
          <div style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${l.mood >= 8 ? "var(--ink)" : l.mood >= 6 ? "var(--vi)" : "var(--mute)"}"></div>
          <div class="pb f1"><div class="pf" style="width:${l.energy * 10}%"></div></div>
          <div class="xs mu" style="width:30px;text-align:right">${l.energy}/10</div>
        </div>`,
          )
          .join("")}
      </div>`;
    }
  } else if (!pD.req) {
    // Not connected — show code-based invite system
    h += `
    <!-- My invite code -->
    <div class="card">
      <div class="semi sm mb2">Your Invite Code</div>
      <div class="xs mu mb3">Share this code with your partner. They enter it below to connect.</div>
      <div class="code-box" id="code-display" title="Click to copy">${myCode || "••••••"}</div>
      <div class="code-copy" id="code-copy-hint">Tap to copy</div>
      <div class="f g2 mt3">
        <button class="btn btn-o btn-sm f1" id="regen-code-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10"/></svg>
          New Code
        </button>
        <button class="btn btn-p btn-sm f1" id="share-code-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          Share
        </button>
      </div>
    </div>

    <!-- Enter partner's code -->
    <div class="card">
      <div class="semi sm mb2">Enter Partner's Code</div>
      <div class="xs mu mb3">Ask them for their 6-character code and enter it here.</div>
      <input type="text" id="partner-code-inp" class="inp mb3" placeholder="Enter code (e.g. AB12CD)"
        style="text-transform:uppercase;letter-spacing:.15em;font-family:'Bricolage Grotesque',sans-serif;font-size:1.1rem;text-align:center;height:44px"
        maxlength="6"/>
      <button class="btn btn-p" id="connect-code-btn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
        Connect
      </button>
      <div id="code-msg" class="mt3 hid"></div>
    </div>`;
  }

  // Privacy note
  h += `<div class="card f g3">
    <div style="width:30px;height:30px;border-radius:7px;background:rgba(124,58,237,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
    </div>
    <div><div class="semi sm mb2">Privacy First</div>
    <div class="xs mu" style="line-height:1.5">Personal notes are never shared. Only mood, energy, sleep and phase — always optional and reversible.</div></div>
  </div>`;

  body.innerHTML = h;

  // Attach events
  document.getElementById("acc")?.addEventListener("click", async () => {
    if (!pD.req) return;
    const b = writeBatch(db);
    b.update(doc(db, "users", me.uid), {
      partnerUid: pD.req.fromUid,
      pendingRequest: deleteField(),
    });
    b.update(doc(db, "users", pD.req.fromUid), {
      partnerUid: me.uid,
      pendingRequest: deleteField(),
    });
    await b.commit();
    pD.req = null;
    rPUI_refresh();
    // Update partner chat UI when partner is connected
    if (appMode === "client") {
      updatePartnerChatUI();
    }
  });
  document.getElementById("dec")?.addEventListener("click", async () => {
    await updateDoc(doc(db, "users", me.uid), {
      pendingRequest: deleteField(),
    });
    pD.req = null;
    rPart();
  });
  document.getElementById("sync-tog")?.addEventListener("change", (e) => {
    pD.sync = e.target.checked;
  });
  document.getElementById("disc")?.addEventListener("click", async () => {
    if (!confirm("Disconnect from partner?")) return;
    // Clean up partner chat listeners
    if (partnerChatUnsub) {
      partnerChatUnsub();
      partnerChatUnsub = null;
    }
    const b = writeBatch(db);
    b.update(doc(db, "users", me.uid), { partnerUid: deleteField() });
    b.update(doc(db, "users", pD.info.uid), {
      partnerUid: deleteField(),
    });
    await b.commit();
    pD = { info: null, req: null, logs: [], sync: false };
    pListeners.forEach((u) => u());
    pListeners = [];
    listenForPartnerRequests();
    rPart();
    // Update partner chat UI when partner is disconnected
    if (appMode === "client") {
      updatePartnerChatUI();
    }
  });

  // Code copy
  document
    .getElementById("code-display")
    ?.addEventListener("click", async () => {
      if (myCode) {
        try {
          await navigator.clipboard.writeText(myCode);
          document.getElementById("code-copy-hint").textContent = "Copied!";
        } catch (e) {
          document.getElementById("code-copy-hint").textContent =
            "Code: " + myCode;
        }
        setTimeout(() => {
          const el = document.getElementById("code-copy-hint");
          if (el) el.textContent = "Tap to copy";
        }, 2000);
      }
    });

  // Share code via Web Share API
  document
    .getElementById("share-code-btn")
    ?.addEventListener("click", async () => {
      const txt = `Join me on Velour! Use code ${myCode} to sync our wellness data. Get the app at ${location.href}`;
      if (navigator.share) {
        try {
          await navigator.share({
            title: "Velour Partner Invite",
            text: txt,
          });
          return;
        } catch (e) {}
      }
      // Fallback: copy
      try {
        await navigator.clipboard.writeText(txt);
      } catch (e) {}
      addNotif({
        type: "info",
        title: "Code copied",
        body: "Share link copied to clipboard.",
        icon: "share",
      });
    });

  // Regenerate code
  document
    .getElementById("regen-code-btn")
    ?.addEventListener("click", async () => {
      const code = genCode();
      await updateDoc(doc(db, "users", me.uid), { inviteCode: code });
      myCode = code;
      document.getElementById("code-display").textContent = code;
    });

  // Connect via code
  document
    .getElementById("connect-code-btn")
    ?.addEventListener("click", async () => {
      const raw = document
        .getElementById("partner-code-inp")
        .value.trim()
        .toUpperCase();
      const msg = document.getElementById("code-msg");
      if (raw.length !== 6) {
        msg.className = "mt3 ebox";
        msg.textContent = "Enter a 6-character code.";
        msg.classList.remove("hid");
        return;
      }
      try {
        // Find user with this invite code
        const snap = await getDocs(
          query(collection(db, "users"), where("inviteCode", "==", raw)),
        );
        if (snap.empty) {
          msg.className = "mt3 ebox";
          msg.textContent =
            "No user found with that code. Ask them to check their code.";
          msg.classList.remove("hid");
          return;
        }
        const partnerDoc = snap.docs[0];
        if (partnerDoc.id === me.uid) {
          msg.className = "mt3 ebox";
          msg.textContent = "That's your own code, champion.";
          msg.classList.remove("hid");
          return;
        }
        const partnerData = partnerDoc.data();
        // Send pending request to their profile (real-time listener will pick it up)
        await updateDoc(doc(db, "users", partnerDoc.id), {
          pendingRequest: {
            fromUid: me.uid,
            fromName: me.displayName || "A Velour User",
            fromEmail: me.email || "",
            fromCode: myCode,
            timestamp: Date.now(),
          },
        });
        msg.className = "mt3 obox";
        msg.textContent = `Request sent to ${partnerData.displayName || "your partner"}! They'll see it instantly.`;
        msg.classList.remove("hid");
        document.getElementById("partner-code-inp").value = "";
      } catch (e) {
        msg.className = "mt3 ebox";
        msg.textContent = "Something went wrong. Please try again.";
        msg.classList.remove("hid");
      }
    });

  // Update partner chat UI when partner data is available (for client mode)
  if (appMode === "client") {
    updatePartnerChatUI();
  }
}

function rPUI_refresh() {
  // Small helper to refresh partner UI after accept
  pD.req = null;
  rPart();
}

/* ─── NOTIFICATIONS ──────────────────────────── */
let notifs = [];
let unreadCount = 0;

function addNotif({ type, title, body, icon }) {
  notifs.unshift({
    type,
    title,
    body,
    icon,
    ts: Date.now(),
    read: false,
  });
  if (notifs.length > 50) notifs = notifs.slice(0, 50);
  unreadCount++;
  updateNotifBadge();
  renderNotifList();
}

function updateNotifBadge() {
  const badge = document.getElementById("notif-badge");
  if (unreadCount > 0) {
    badge.textContent = unreadCount > 9 ? "9+" : unreadCount;
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

function renderNotifList() {
  const list = document.getElementById("notif-list");
  if (!notifs.length) {
    list.innerHTML = `<div class="tc mu xs" style="padding:32px 16px">No notifications yet.<br>Log daily and connect with a partner to get started.</div>`;
    return;
  }
  const iconMap = {
    log: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="15" height="15"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    partner:
      '<svg viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2" width="15" height="15"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>',
    check:
      '<svg viewBox="0 0 24 24" fill="none" stroke="var(--ok)" stroke-width="2" width="15" height="15"><polyline points="20 6 9 17 4 12"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    push: '<svg viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2" width="15" height="15"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/></svg>',
  };
  const bgMap = {
    log: "rgba(124,58,237,.13)",
    partner: "rgba(52,211,153,.13)",
    check: "rgba(52,211,153,.13)",
    info: "rgba(124,58,237,.13)",
    push: "rgba(251,191,36,.13)",
  };
  list.innerHTML = notifs
    .map(
      (n, i) => `
    <div class="notif-item ${n.read ? "" : "unread"}" data-i="${i}">
      <div class="notif-icon" style="background:${bgMap[n.icon] || bgMap.info}">${iconMap[n.icon] || iconMap.info}</div>
      <div class="f1">
        <div class="semi sm">${n.title}</div>
        <div class="xs mu" style="line-height:1.5;margin-top:2px">${n.body}</div>
        <div class="xs mu" style="margin-top:3px;opacity:.6">${timeAgo(n.ts)}</div>
      </div>
    </div>`,
    )
    .join("");
  list.querySelectorAll(".notif-item").forEach((el) => {
    el.addEventListener("click", () => {
      const i = +el.dataset.i;
      notifs[i].read = true;
      updateNotifBadge();
      renderNotifList();
    });
  });
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}

// Notification panel open/close
document.getElementById("notif-btn").addEventListener("click", () => {
  document.getElementById("notif-panel").classList.add("on");
  document.getElementById("notif-overlay").classList.add("on");
  notifs.forEach((n) => (n.read = true));
  unreadCount = 0;
  updateNotifBadge();
  renderNotifList();
});
document
  .getElementById("notif-close")
  .addEventListener("click", closeNotifPanel);
document
  .getElementById("notif-overlay")
  .addEventListener("click", closeNotifPanel);
function closeNotifPanel() {
  document.getElementById("notif-panel").classList.remove("on");
  document.getElementById("notif-overlay").classList.remove("on");
}

/* ─── PUSH NOTIFICATIONS ─────────────────────── */
let pushEnabled = false;

async function enablePush() {
  if (!("Notification" in window)) {
    addNotif({
      type: "info",
      title: "Not supported",
      body: "Push notifications aren't supported in this browser.",
      icon: "info",
    });
    return;
  }
  const perm = await Notification.requestPermission();
  if (perm !== "granted") {
    addNotif({
      type: "info",
      title: "Permission denied",
      body: "Allow notifications in browser settings to enable push.",
      icon: "info",
    });
    return;
  }
  if (!("serviceWorker" in navigator)) {
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    if (!VAPID_KEY.startsWith("YOUR_")) {
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_KEY),
      });
      // Save subscription to Firestore for server-sent pushes
      if (fbOk && me) {
        await setDoc(
          doc(db, "users", me.uid, "push", "subscription"),
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: btoa(
                String.fromCharCode(...new Uint8Array(sub.getKey("p256dh"))),
              ),
              auth: btoa(
                String.fromCharCode(...new Uint8Array(sub.getKey("auth"))),
              ),
            },
          },
          { merge: true },
        );
      }
    }
    pushEnabled = true;
    await setPref("push_enabled", true);
    scheduleLocalReminder();
    addNotif({
      type: "push",
      title: "Push enabled!",
      body: "You'll get daily check-in reminders and partner updates.",
      icon: "push",
    });
    document.getElementById("enable-push-btn").textContent =
      "Notifications Active";
    document.getElementById("enable-push-btn").style.background =
      "rgba(52,211,153,.2)";
    document.getElementById("enable-push-btn").style.color = "var(--ok)";
  } catch (e) {
    addNotif({
      type: "info",
      title: "Push setup failed",
      body: "Something went wrong. Please try again.",
      icon: "info",
    });
  }
}

function scheduleLocalReminder() {
  // Schedule a local "reminder" using the Notifications API directly
  // (true push requires a server; this fires when app is in background/foreground)
  if ("Notification" in window && Notification.permission === "granted") {
    // Check once per hour if user hasn't logged today
    setInterval(
      async () => {
        const log = await iGet("logs", tod());
        if (!log) {
          new Notification("Velour — Daily Check-in", {
            body: "How are you feeling today, chief? Log takes 30 seconds.",
            icon: "/icon-192.png",
            tag: "daily-reminder",
          });
        }
      },
      60 * 60 * 1000,
    ); // check every hour
    // Also fire at 8pm local time
    scheduleAt(20, 0, async () => {
      const log = await iGet("logs", tod());
      if (!log)
        new Notification("Velour", {
          body: "End-of-day check-in? Takes 30 seconds.",
          icon: "/icon-192.png",
          tag: "evening-reminder",
        });
    });
  }
}

function scheduleAt(hour, min, fn) {
  const now = new Date(),
    target = new Date();
  target.setHours(hour, min, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const ms = target - now;
  setTimeout(() => {
    fn();
    setInterval(fn, 24 * 60 * 60 * 1000);
  }, ms);
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i)
    outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

document
  .getElementById("enable-push-btn")
  .addEventListener("click", enablePush);

/* ─── AI CHAT ────────────────────────────────── */
let chatH = [];
let userName = ""; // Will be populated from user profile
let userPhase = ""; // Will be populated from user cycle data
let userPhotoURL = ""; // Will be populated from user profile

// Function to get personalized system prompt
function getAISystemPrompt() {
  const namePart = userName ? `You are speaking with ${userName}` : "You are speaking with the user";
  const phasePart = userPhase ? `, who is currently in the ${userPhase} phase of their wellness cycle` : "";
  return `You are Velour's AI wellness coach — helpful, witty, concise.
${namePart}${phasePart}.
Context: Velour is a humor app that tracks a fictional "spermatogenesis cycle" (74 days) for men, mimicking period tracking apps. The humor is self-aware and tongue-in-cheek.
Give real actionable wellness advice on mood, energy, stress, sleep, and men's health.
Be encouraging, honest, and occasionally riff on the "male cycle" concept humorously.
Never diagnose. Suggest doctors for medical issues. Max 3 sentences unless user asks for detail.`;
}

async function sendM(txt) {
  if (!txt.trim()) return;
  document.getElementById("chat-sugg")?.remove();
  chatH.push({ role: "user", txt, u: true });
  addB(txt, true);
  const btn = document.getElementById("chat-send");
  btn.disabled = true;
  document.getElementById("chat-in").value = "";
  document.getElementById("chat-in").style.height = "auto";
  const tid = "t" + Date.now();
  document
    .getElementById("chat-msgs")
    .insertAdjacentHTML(
      "beforeend",
      `<div class="cmsg ai" id="${tid}"><div class="cav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div><div class="cbub"><div class="tdots"><span></span><span></span><span></span></div></div></div>`,
    );
  scrollC();
  try {
    const contents = chatH.slice(-10).map((m) => ({
      role: m.u ? "user" : "model",
      parts: [{ text: m.txt }],
    }));
    const res = await fetch(GU, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: getAISystemPrompt() }] },
        contents,
        generationConfig: { maxOutputTokens: 400, temperature: 0.8 },
      }),
    });
    const json = await res.json();
    const reply =
      json.candidates?.[0]?.content?.parts?.[0]?.text ||
      "Connection issue. Try again.";
    document.getElementById(tid)?.remove();

    // Add to local chat history
    chatH.push({ role: "model", txt: reply, u: false });
    addB(reply, false);

    // Store in Firestore if available
    if (fbOk && me) {
      try {
        const messageRef = doc(collection(db, "users", me.uid, "aiMessages"));
        await setDoc(messageRef, {
          text: reply,
          senderId: me.uid,
          senderName: me.displayName || "User",
          timestamp: serverTimestamp(),
          type: "text",
          read: false,
          isAI: true
        });
      } catch (firestoreError) {
        console.error("Error storing AI chat message in Firestore:", firestoreError);
        // Continue anyway - message is still displayed locally
      }
    }
  } catch (e) {
    document.getElementById(tid)?.remove();
    addB(
      GK.startsWith("YOUR_")
        ? "Add your Gemini API key to activate the AI. Free at aistudio.google.com"
        : "Connection error. Try again.",
      false,
    );
  }
  btn.disabled = false;
  scrollC();
}
function addB(txt, u) {
  const d = document.createElement("div");
  d.className = "cmsg " + (u ? "u" : "ai");
  const esc = (s) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br>");
  d.innerHTML = u
    ? `<div class="cbub">${esc(txt)}</div>`
    : `<div class="cav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div><div class="cbub">${esc(txt)}</div>`;
  document.getElementById("chat-msgs").appendChild(d);
}
const scrollC = () => (document.getElementById("chat-msgs").scrollTop = 9999);

const cp = document.getElementById("chat-panel");
document.getElementById("chat-fab").addEventListener("click", () => {
  // Reset to AI chat when opening chat panel
  if (!cp.classList.contains("on")) {
    currentChatMode = "ai";
    updatePartnerChatUI();
  }
  cp.classList.toggle("on");
  document.getElementById("cu").style.display = "none";
});
document
  .getElementById("chat-close")
  .addEventListener("click", () => {
    cp.classList.remove("on");
  });
const ci = document.getElementById("chat-in");
ci.addEventListener("input", (e) => {
  document.getElementById("chat-send").disabled = !e.target.value.trim();
  e.target.style.height = "auto";
  e.target.style.height = Math.min(e.target.scrollHeight, 72) + "px";
});
ci.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendM(e.target.value);
  }
});
document
  .getElementById("chat-send")
  .addEventListener("click", () => sendM(ci.value));
document
  .querySelectorAll(".sug[data-q]")
  .forEach((b) => b.addEventListener("click", () => sendM(b.dataset.q)));

/* ─── PARTNER CHAT ──────────────────────────────── */
// Partner chat state
let currentChatMode = "ai"; // "ai" or "partner"
let partnerChatUnsub = null;
let partnerChatHistory = [];

// AI chat state
let aiChatUnsub = null;
let aiChatHistory = [];

// Initialize partner chat listeners when a partner is connected
function initPartnerChatListeners(partnerUid) {
  // Clean up existing listeners
  if (partnerChatUnsub) {
    partnerChatUnsub();
    partnerChatUnsub = null;
  }

  if (!fbOk || !me || !partnerUid) return;

  // Listen to partner chat messages
  const chatRef = collection(db, "users", me.uid, "chats", partnerUid, "messages");
  const q = query(chatRef, orderBy("timestamp", "desc"), limit(50));

  partnerChatUnsub = onSnapshot(q, (snapshot) => {
    // Convert to ascending order for display (oldest first)
    partnerChatHistory = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      }))
      .reverse(); // Reverse to get oldest first for display

    // Update UI if we're in partner chat mode
    if (currentChatMode === "partner" && appMode === "client") {
      renderPartnerChat();
    }
  }, (error) => {
    console.error("Partner chat listener error:", error);
  });
}

// Initialize AI chat listeners
function initAIChatListeners() {
  // Clean up existing listeners
  if (aiChatUnsub) {
    aiChatUnsub();
    aiChatUnsub = null;
  }

  if (!fbOk || !me) return;

  // Listen to AI chat messages
  const chatRef = collection(db, "users", me.uid, "aiMessages");
  const q = query(chatRef, orderBy("timestamp", "asc"), limit(100));

  aiChatUnsub = onSnapshot(q, (snapshot) => {
    // Convert to array for display
    aiChatHistory = snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data()
      }));

    // Update UI if we're in AI chat mode
    if (currentChatMode === "ai" && appMode === "client") {
      renderAIChatMessagesFromFirestore();
    }
  }, (error) => {
    console.error("AI chat listener error:", error);
  });
}

// Send a message to partner chat
async function sendPartnerMessage(text) {
  if (!text.trim() || !fbOk || !me) return;

  // Get partner UID from partner data
  const partnerUid = pD.info?.uid;
  if (!partnerUid) {
    addNotif({
      type: "info",
      title: "No partner connected",
      body: "Connect with a partner first to send messages.",
      icon: "info"
    });
    return;
  }

  try {
    // Optimistically add message to local history
    const optimisticMessage = {
      id: "temp-" + Date.now(),
      text: text.trim(),
      senderId: me.uid,
      senderName: me.displayName || "User",
      timestamp: new Date(),
      type: "text",
      read: false,
      isAI: false
    };
    partnerChatHistory.push(optimisticMessage);
    if (currentChatMode === "partner" && appMode === "client") {
      renderPartnerChat();
    }

    // Clear input
    document.getElementById("partner-chat-in").value = "";
    document.getElementById("partner-chat-in").style.height = "auto";

    // Add message to Firestore
    const messageRef = doc(collection(db, "users", me.uid, "chats", partnerUid, "messages"));
    await setDoc(messageRef, {
      text: text.trim(),
      senderId: me.uid,
      senderName: me.displayName || "User",
      timestamp: serverTimestamp(),
      type: "text",
      read: false,
      isAI: false
    });

    // Also add to partner's chat collection (for bidirectional sync)
    const partnerMessageRef = doc(collection(db, "users", partnerUid, "chats", me.uid, "messages"));
    await setDoc(partnerMessageRef, {
      text: text.trim(),
      senderId: me.uid,
      senderName: me.displayName || "User",
      timestamp: serverTimestamp(),
      type: "text",
      read: false,
      isAI: false
    });

    // Remove optimistic message and replace with real one from Firestore (will happen via listener)
    // We'll keep the optimistic one for now and let the listener update it with the real ID and timestamp
  } catch (error) {
    console.error("Error sending partner message:", error);
    addNotif({
      type: "info",
      title: "Message failed",
      body: "Failed to send message. Please try again.",
      icon: "info"
    });

    // Remove optimistic message on error
    if (partnerChatHistory.length > 0 && partnerChatHistory[partnerChatHistory.length - 1].id.startsWith("temp-")) {
      partnerChatHistory.pop();
      if (currentChatMode === "partner" && appMode === "client") {
        renderPartnerChat();
      }
    }
  }
}

// Render partner chat messages
function renderPartnerChat() {
  const chatMessagesEl = document.getElementById("chat-msgs");
  if (!chatMessagesEl) return;

  if (partnerChatHistory.length === 0) {
    chatMessagesEl.innerHTML = `
      <div class="tc mu xs" style="padding:40px 16px">
        No messages yet. Start the conversation!
      </div>
    `;
    return;
  }

  chatMessagesEl.innerHTML = partnerChatHistory.map(msg => {
    const isOwnMessage = msg.senderId === me.uid;
    return `
      <div class="f ic jb mb3">
        <div class="cmsg ${isOwnMessage ? "u" : "partner"}">
          <div class="cbub">${msg.text.replace(/\n/g, "<br>")}</div>
          ${!isOwnMessage ? `<div class="cav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>` : ""}
        </div>
      </div>
    `;
  }).join("");

  // Scroll to bottom
  setTimeout(() => {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }, 100);
}

// Render AI chat messages from Firestore
function renderAIChatMessagesFromFirestore() {
  const chatMessagesEl = document.getElementById("chat-msgs");
  if (!chatMessagesEl) return;

  if (aiChatHistory.length === 0) {
    chatMessagesEl.innerHTML = `
      <div class="tc mu xs" style="padding:40px 16px">
        No messages yet. Start the conversation!
      </div>
    `;
    return;
  }

  chatMessagesEl.innerHTML = aiChatHistory.map(msg => {
    const isUserMsg = msg.senderId === me.uid;
    return `
      <div class="f ic jb mb3">
        <div class="cmsg ${isUserMsg ? "u" : "ai"}">
          <div class="cbub">${msg.text.replace(/\n/g, "<br>")}</div>
          ${!isUserMsg ? `<div class="cav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>` : ""}
        </div>
      </div>
    `;
  }).join("");

  // Scroll to bottom
  setTimeout(() => {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }, 100);
}

// Toggle between AI chat and partner chat
function toggleChatMode() {
  currentChatMode = currentChatMode === "ai" ? "partner" : "ai";
  updatePartnerChatUI();
}

// Initialize partner chat UI enhancements
function enhanceChatUI() {
  const chatPanel = document.getElementById("chat-panel");
  if (!chatPanel) return;

  // Add chat mode toggle to header
  const chatHeader = document.querySelector(".ch");
  if (chatHeader && !document.getElementById("chat-mode-toggle")) {
    const toggleBtn = document.createElement("button");
    toggleBtn.id = "chat-mode-toggle";
    toggleBtn.className = "btn btn-o btn-sm";
    toggleBtn.textContent = "Switch to Partner Chat";
    toggleBtn.addEventListener("click", toggleChatMode);
    // Insert after the title but before the close button
    const titleEl = chatHeader.querySelector(".f1");
    if (titleEl) {
      titleEl.appendChild(toggleBtn);
    } else {
      chatHeader.appendChild(toggleBtn);
    }
  }

  // Update existing chat area to support both modes
  const chatMessagesEl = document.getElementById("chat-msgs");
  const chatInputRow = document.querySelector(".cin-row");

  if (chatMessagesEl && chatInputRow) {
    // We'll manage the content dynamically based on chat mode
    // No need to duplicate elements, just switch content
  }
}

// Enhanced sendM function to work with chat mode
const originalSendM = sendM;
window.sendM = function(txt) {
  if (currentChatMode === "partner") {
    sendPartnerMessage(txt);
  } else {
    originalSendM.call(this, txt);
  }
};

// Initialize partner chat when partner data changes
function updatePartnerChatUI() {
  // Update chat header based on mode
  const chatTitle = document.querySelector(".chat-panel .f1");
  if (chatTitle) {
    if (currentChatMode === "partner" && pD.info) {
      chatTitle.innerHTML = `
        <div class="f ic g3">
          <img src="${pD.info.photoUrl}" alt="Partner avatar" class="chat-avatar">
          <div>
            <div class="semi" style="font-size: 0.79rem">${pD.info.displayName || "Partner"}</div>
            <div class="f ic g2">
              <div class="cadot"></div>
              <span class="xs mu">Wellness wingman</span>
            </div>
          </div>
        </div>
      `;
    } else {
      chatTitle.innerHTML = `
        <div class="f ic g3">
          <img src="${userPhotoURL}" alt="User avatar" class="chat-avatar">
          <div>
            <div class="semi" style="font-size: 0.79rem">Velour AI</div>
            <div class="f ic g2">
              <div class="cadot"></div>
              <span class="xs mu">Wellness wingman</span>
            </div>
          </div>
        </div>
      `;
    }
  }

  // Update chat mode toggle button
  const toggleBtn = document.getElementById("chat-mode-toggle");
  if (toggleBtn) {
    toggleBtn.textContent = currentChatMode === "ai" ? "Switch to Partner Chat" : "Switch to AI Chat";
  }

  // Clear and render appropriate chat messages
  const chatMessagesEl = document.getElementById("chat-msgs");
  const chatSuggEl = document.getElementById("chat-sugg");
  if (chatMessagesEl) {
    if (currentChatMode === "partner") {
      renderPartnerChat();
      // Hide suggestions in partner chat mode
      if (chatSuggEl) chatSuggEl.classList.add("hid");
    } else {
      // Render AI chat messages from Firestore
      renderAIChatMessagesFromFirestore();
      // Show suggestions in AI chat mode
      if (chatSuggEl) chatSuggEl.classList.remove("hid");
    }
  }

  // Update input placeholder
  const chatInput = document.getElementById("chat-in");
  if (chatInput) {
    chatInput.placeholder = currentChatMode === "partner"
      ? `Message ${pD.info?.displayName || "partner"}...`
      : "Ask anything...";
  }
}

// Render AI chat messages (existing chat functionality)
function renderAIChatMessages() {
  const chatMessagesEl = document.getElementById("chat-msgs");
  if (!chatMessagesEl) return;

  // Clear existing messages
  chatMessagesEl.innerHTML = "";

  // Add AI chat messages from chatH array
  chatH.forEach((msg, index) => {
    const isUserMsg = msg.role === "user";
    const messageEl = document.createElement("div");
    messageEl.className = `cmsg ${isUserMsg ? "u" : "ai"}`;

    if (isUserMsg) {
      messageEl.innerHTML = `<div class="cbub">${msg.txt.replace(/\n/g, "<br>")}</div>`;
    } else {
      messageEl.innerHTML = `
        <div class="cav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>
        <div class="cbub">${msg.txt.replace(/\n/g, "<br>")}</div>
      `;
    }

    chatMessagesEl.appendChild(messageEl);
  });

  // Scroll to bottom
  setTimeout(() => {
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
  }, 100);
}

/* ─── NAV EVENTS ─────────────────────────────── */
document.querySelectorAll(".ni[data-nav]").forEach((b) =>
  b.addEventListener("click", () => {
    const t = b.dataset.nav;
    if (t !== cur) {
      hist.push(t);
      go(t, false);
    }
  }),
);
document
  .querySelectorAll("[data-back]")
  .forEach((b) => b.addEventListener("click", goBack));

/* ─── MODE SELECTION ─────────────────────────── */
document
  .getElementById("mode-client-btn")
  ?.addEventListener("click", async () => {
    appMode = "client";
    await setPref("appMode", "client");
    // Remove mode screen and show login
    document.getElementById("screen-mode").classList.remove("on");
    go("login");
    // Register auth state listener now (boot() returned early before mode was chosen)
    if (fbOk) {
      onAuthStateChanged(auth, async (u) => {
        if (u && (cur === "login" || cur === "mode")) await afterLogin(u);
        else if (!u && cur !== "login") go("login", false);
      });
    }
  });
document
  .getElementById("mode-partner-btn")
  ?.addEventListener("click", async () => {
    appMode = "partner";
    await setPref("appMode", "partner");
    document.getElementById("screen-mode").classList.remove("on");
    go("login");
    if (fbOk) {
      onAuthStateChanged(auth, async (u) => {
        if (u && (cur === "login" || cur === "mode")) await afterLogin(u);
        else if (!u && cur !== "login") go("login", false);
      });
    }
  });

/* ─── PARTNER VIEW (read-only mode) ──────────── */
async function rPartnerView() {
  const body = document.getElementById("pv-body");
  if (!body) return;

  if (!fbOk || !me) {
    body.innerHTML = `<div class="pv-connect-card" data-a="1">
            <div class="pv-connect-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--champagne)" stroke-width="2" width="22" height="22">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
            </div>
            <h3 style="color:var(--cream);margin-bottom:6px">Sign in to connect</h3>
            <p class="sm mu" style="line-height:1.65;margin-bottom:16px">Sign in with Google, then enter your partner's invite code to start viewing their cycle updates.</p>
            <button class="btn btn-gold btn-lg" id="pv-signin-btn">Continue with Google</button>
          </div>
          <div class="card f g3" data-a="2">
            <div style="width:30px;height:30px;border-radius:7px;background:rgba(214,194,156,0.09);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--champagne)" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </div>
            <div>
              <div class="semi sm gold mb2">Read-only access</div>
              <div class="xs mu" style="line-height:1.5">As a partner you can view phase, insights and logs. You cannot edit or enter data.</div>
            </div>
          </div>`;
    document
      .getElementById("pv-signin-btn")
      ?.addEventListener("click", async () => {
        if (!fbOk) return;
        try {
          const r = await signInWithPopup(auth, new GoogleAuthProvider());
          await setDoc(
            doc(db, "users", r.user.uid),
            {
              displayName: r.user.displayName || "",
              email: r.user.email || "",
              photoUrl: r.user.photoURL || "",
              lastSeen: serverTimestamp(),
              isPartner: true,
            },
            { merge: true },
          );
          await afterLogin(r.user);
        } catch (e) {
          console.error(e);
        }
      });
    aos(body);
    return;
  }

  // Check if connected to a partner
  const mySnap = await getDoc(doc(db, "users", me.uid));
  const myData = mySnap.data() || {};
  const partnerUid = myData.partnerUid;

  if (!partnerUid) {
    // Show code entry to connect to partner
    body.innerHTML = `
          <div class="pv-connect-card" data-a="1">
            <div class="pv-connect-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--champagne)" stroke-width="2" width="22" height="22">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
            </div>
            <h3 style="color:var(--cream);margin-bottom:6px">Connect to your partner</h3>
            <p class="sm mu" style="line-height:1.65;margin-bottom:16px">Ask your partner to share their 6-character invite code from their Velour app.</p>
          </div>
          <div class="card" data-a="2">
            <div class="semi sm mb2" style="color:var(--cream)">Enter Partner's Code</div>
            <div class="xs mu mb3">The code is found under their Partner section.</div>
            <input type="text" id="pv-code-inp" class="inp mb3" placeholder="e.g. AB12CD"
              style="text-transform:uppercase;letter-spacing:.15em;font-size:1.1rem;text-align:center;height:46px"
              maxlength="6"/>
            <button class="btn btn-gold" id="pv-connect-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
              Send Connection Request
            </button>
            <div id="pv-code-msg" class="mt3 hid"></div>
          </div>
          <div class="card f g3" data-a="3">
            <div style="width:30px;height:30px;border-radius:7px;background:rgba(200,182,226,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--lavender)" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </div>
            <div>
              <div class="semi sm so mb2">Privacy note</div>
              <div class="xs mu" style="line-height:1.5">You'll only see mood, energy, sleep and phase. Private notes are never shared.</div>
            </div>
          </div>`;

    document
      .getElementById("pv-connect-btn")
      ?.addEventListener("click", async () => {
        const raw = document
          .getElementById("pv-code-inp")
          .value.trim()
          .toUpperCase();
        const msg = document.getElementById("pv-code-msg");
        if (raw.length !== 6) {
          msg.className = "mt3 ebox";
          msg.textContent = "Enter a 6-character code.";
          msg.classList.remove("hid");
          return;
        }
        try {
          const snap = await getDocs(
            query(collection(db, "users"), where("inviteCode", "==", raw)),
          );
          if (snap.empty) {
            msg.className = "mt3 ebox";
            msg.textContent = "No user found with that code.";
            msg.classList.remove("hid");
            return;
          }
          const partnerDoc = snap.docs[0];
          if (partnerDoc.id === me.uid) {
            msg.className = "mt3 ebox";
            msg.textContent = "That's your own code.";
            msg.classList.remove("hid");
            return;
          }
          await updateDoc(doc(db, "users", partnerDoc.id), {
            pendingRequest: {
              fromUid: me.uid,
              fromName: me.displayName || "Your partner",
              fromEmail: me.email || "",
              isPartnerMode: true,
              timestamp: Date.now(),
            },
          });
          msg.className = "mt3 obox";
          msg.textContent =
            "Connection request sent! Waiting for them to accept.";
          msg.classList.remove("hid");
          document.getElementById("pv-code-inp").value = "";
          // Listen for acceptance
          const unsub = onSnapshot(doc(db, "users", me.uid), (snap) => {
            if (snap.data()?.partnerUid) {
              unsub();
              rPartnerView();
            }
          });
        } catch (e) {
          msg.className = "mt3 ebox";
          msg.textContent = "Something went wrong. Please try again.";
          msg.classList.remove("hid");
        }
      });
    aos(body);
    return;
  }

  // Connected — fetch partner data
  try {
    const [partnerSnap, partnerLogs] = await Promise.all([
      getDoc(doc(db, "users", partnerUid)),
      getDocs(
        query(
          collection(db, "users", partnerUid, "logs"),
          orderBy("date", "desc"),
          limit(14),
        ),
      ),
    ]);
    const pInfo = partnerSnap.data() || {};
    const logs = partnerLogs.docs.map((d) => ({ date: d.id, ...d.data() }));
    const lastLog = logs[0];
    const phase = lastLog?.phase || "—";
    const ini = (pInfo.displayName || "?")[0].toUpperCase();

    // Calculate partner insights
    const avgMood = logs.length
      ? (logs.reduce((s, l) => s + (l.mood || 0), 0) / logs.length).toFixed(1)
      : "—";
    const avgEnergy = logs.length
      ? (logs.reduce((s, l) => s + (l.energy || 0), 0) / logs.length).toFixed(1)
      : "—";
    const avgSleep = logs.length
      ? (
          logs.reduce((s, l) => s + (l.sleepHours || 0), 0) / logs.length
        ).toFixed(1)
      : "—";

    // Partner phase insight text
    const phaseInsights = {
      "Proliferative Phase":
        "Your partner is in their Genesis phase — energy is building, testosterone rising. Great time for shared activities.",
      "Peak Production":
        "Peak week! Your partner is at their highest energy and confidence. Ideal for big plans together.",
      "Maturation Phase":
        "Steady focus phase. Your partner is productive and detail-oriented. Good for collaborative work.",
      "Transport Phase":
        "Social and communicative phase. Your partner is flowing well. Great for quality time together.",
      "Recharge Phase":
        "Rest phase. Your partner's energy is lower — be supportive and patient this week.",
      "Renewal Phase":
        "Cycle end approaching. Expect a reset soon. Reflection and rest are valuable now.",
    };
    const insightText =
      phaseInsights[phase] ||
      "Your partner is actively tracking their wellness cycle.";

    // Real-time listener for partner login notification
    onSnapshot(doc(db, "users", partnerUid), (snap) => {
      const lastSeen = snap.data()?.lastSeen?.toDate?.();
      if (lastSeen && Date.now() - lastSeen.getTime() < 60000) {
        addNotif({
          type: "partner",
          title: pInfo.displayName?.split(" ")[0] + " just logged in",
          body: "Your partner opened Velour.",
          icon: "partner",
        });
      }
    });

    body.innerHTML = `
          <div class="f ic g3 mb2" data-a="1" style="padding:2px 0">
            <img src="${pInfo.photoUrl}" alt="Partner avatar" class="partner-avatar">
            <div class="f1">
              <div class="f ic g2">
                <div class="live-dot"></div>
                <div class="semi" style="font-size:.9rem;color:var(--cream)">${pInfo.displayName || "Partner"}</div>
              </div>
              <div class="xs mu">${pInfo.email || ""}</div>
            </div>
            <button class="btn btn-g btn-sm" id="pv-disconnect" style="width:auto;padding:0 10px;font-size:.68rem">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="11" height="11"><path d="M18.36 6.64a9 9 0 11-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
              Disconnect
            </button>
          </div>

          <div class="pv-phase-card" data-a="2">
            <div class="xs mu mb2">Current Phase</div>
            <div class="pv-phase-name">${phase}</div>
            <div class="pv-phase-desc">${insightText}</div>
          </div>

          <div class="pv-stat-grid" data-a="3">
            <div class="pv-stat">
              <div class="pv-stat-val">${lastLog?.mood ?? "—"}</div>
              <div class="pv-stat-lbl">Last Mood</div>
            </div>
            <div class="pv-stat">
              <div class="pv-stat-val">${lastLog?.energy ?? "—"}</div>
              <div class="pv-stat-lbl">Last Energy</div>
            </div>
            <div class="pv-stat">
              <div class="pv-stat-val">${lastLog?.sleepHours ?? "—"}h</div>
              <div class="pv-stat-lbl">Last Sleep</div>
            </div>
          </div>

          ${
            logs.length >= 3
              ? `
          <div class="pv-insight" data-a="4">
            <div class="pv-insight-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--champagne)" stroke-width="2" width="14" height="14"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              14-Day Averages
            </div>
            <div class="pv-stat-grid" style="margin-bottom:12px">
              <div class="pv-stat"><div class="pv-stat-val">${avgMood}</div><div class="pv-stat-lbl">Avg Mood</div></div>
              <div class="pv-stat"><div class="pv-stat-val">${avgEnergy}</div><div class="pv-stat-lbl">Avg Energy</div></div>
              <div class="pv-stat"><div class="pv-stat-val">${avgSleep}h</div><div class="pv-stat-lbl">Avg Sleep</div></div>
            </div>
            ${logs
              .slice(0, 7)
              .map(
                (l) => `
            <div class="pv-log-row">
              <div class="pv-log-date">${l.date.slice(5)}</div>
              <div class="pv-log-dot" style="background:${l.energy >= 8 ? "var(--lavender)" : l.energy >= 6 ? "var(--deep-lavender)" : "var(--mute)"}"></div>
              <div class="pb f1"><div class="pf" style="width:${(l.energy || 0) * 10}%"></div></div>
              <div class="xs mu" style="width:34px;text-align:right">${l.energy}/10</div>
            </div>`,
              )
              .join("")}
          </div>`
              : ""
          }

          <div class="card f g3" data-a="5">
            <div style="width:30px;height:30px;border-radius:7px;background:rgba(200,182,226,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--lavender)" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            </div>
            <div>
              <div class="semi sm so mb2">Read-only view</div>
              <div class="xs mu" style="line-height:1.5">You are viewing your partner's wellness data. Private notes are never shared.</div>
            </div>
          </div>`;

    document
      .getElementById("pv-disconnect")
      ?.addEventListener("click", async () => {
        if (!confirm("Disconnect from this partner?")) return;
        const b = writeBatch(db);
        b.update(doc(db, "users", me.uid), { partnerUid: deleteField() });
        b.update(doc(db, "users", partnerUid), { partnerUid: deleteField() });
        await b.commit();
        rPartnerView();
      });
    aos(body);
  } catch (e) {
    body.innerHTML = `<div class="card tc"><p class="sm mu">Couldn't load partner data. Please try again.</p></div>`;
  }
}

/* ─── BOOT ───────────────────────────────────── */
async function boot() {
  spawnBubbles();
  idb = await openDB();
  rOb();
  buildSx();
  uRanges();
  renderNotifList();
  if ("serviceWorker" in navigator)
    navigator.serviceWorker.register("sw.js").catch(() => {});

  // Restore saved mode — skip mode select if previously chosen
  const savedMode = await getPref("appMode");
  if (savedMode) {
    appMode = savedMode;
    // Mode already chosen, go to login (let auth state take over)
    const next = document.getElementById("screen-mode");
    if (next) {
      next.classList.remove("on");
    }
  } else {
    // Show mode select — it's already .on in HTML
    aos(document.getElementById("screen-mode"));
    return; // Wait for user mode choice
  }

  // Check push permission state
  if ("Notification" in window && Notification.permission === "granted") {
    pushEnabled = true;
    const el = document.getElementById("enable-push-btn");
    el.textContent = "Notifications Active";
    el.style.background = "rgba(52,211,153,.2)";
    el.style.color = "var(--ok)";
    scheduleLocalReminder();
  }

  // Load cycle start from Firestore if logged in
  if (fbOk) {
    onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Sync cycle start
        try {
          const s = await getDoc(doc(db, "users", u.uid));
          const cs = s.data()?.cycleStart;
          if (cs) await setPref("cycle_start", cs);
        } catch (e) {}
        // Navigate only if still on login/mode screen
        if (cur === "login" || cur === "mode") {
          await afterLogin(u);
        }
      } else {
        // Signed out — go to login if not already there
        if (cur !== "login") go("login", false);
      }
    });
    // Show login — onAuthStateChanged fires immediately and will redirect if already authed
    go("login", false);
  } else {
    // Firebase not configured — guest/local mode
    const ob = await getPref("onboarded");
    if (ob) {
      if (appMode === "partner") {
        go("partner-view");
      } else {
        go("dashboard");
        hist = ["dashboard"];
      }
    } else {
      go("login", false);
    }
  }
}

// Set up listener for profile changes
function setupProfileChangeListener() {
  if (!fbOk || !me) return;

  const userDocRef = doc(db, "users", me.uid);
  const unsub = onSnapshot(userDocRef, (doc) => {
    if (doc.exists()) {
      const userData = doc.data();
      const newName = userData.displayName || "";
      const newPhase = userData.currentPhase || "";
      const newPhotoURL = userData.photoUrl || "";

      // Update if changed
      if (newName !== userName || newPhase !== userPhase || newPhotoURL !== userPhotoURL) {
        userName = newName;
        userPhase = newPhase;
        userPhotoURL = newPhotoURL;
        // Note: The AI system prompt will be updated automatically on next message
        // since we call getAISystemPrompt() each time
      }
    }
  }, (error) => {
    console.error("Error setting up profile change listener:", error);
  });

  // Store the unsubscribe function so we can clean it up later
  // For simplicity, we're not storing it globally here, but in a real app we would
}

/* ─── HELP SECTION INTERACTION ──────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  const helpSectionHeaders = document.querySelectorAll('.help-section-header');

  helpSectionHeaders.forEach(header => {
    // Make headers keyboard focusable
    header.setAttribute('tabindex', '0');

    header.addEventListener('click', () => {
      toggleHelpSection(header);
    });

    header.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleHelpSection(header);
      }
    });

    // Initialize all sections as collapsed (matching HTML aria-expanded="false")
    const content = document.getElementById(header.getAttribute('aria-controls'));
    if (content) {
      content.style.maxHeight = '0'; // Start collapsed
    }
  });

  function toggleHelpSection(header) {
    const isExpanded = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', String(!isExpanded));

    const content = document.getElementById(header.getAttribute('aria-controls'));
    if (content) {
      if (isExpanded) {
        // Collapsing
        content.style.maxHeight = '0';
      } else {
        // Expanding
        content.style.maxHeight = content.scrollHeight + 'px';
      }
    }
  }
});

boot();
