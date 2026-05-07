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
      } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

      /* CONFIG — replace these */
      const FB = {
        apiKey: "AIzaSyAB0HEagjsCbj9hKzvoDhCd4IjRt8ShHys",
        authDomain: "vecour-e15e8.firebaseapp.com",
        projectId: "vecour-e15e8",
        storageBucket: "vecour-e15e8.firebasestorage.app",
        messagingSenderId: "841316633130",
        appId: "1:841316633130:web:487a86e34c7c534998d153",
        measurementId: "G-YP9F062HXZ",
      };
      const GK = "AIzaSyDvcK_Tw4L9omTCEgi_hYuLtqY-kIMGcnM";
      const GU = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GK}`;

      /* Firebase */
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
        console.warn("FB:", e.message);
      }

      /* IDB */
      let idb = null;
      const openDB = () =>
        new Promise((res, rej) => {
          const r = indexedDB.open("velour2", 1);
          r.onupgradeneeded = (e) => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains("logs"))
              d.createObjectStore("logs", { keyPath: "date" });
            if (!d.objectStoreNames.contains("prefs"))
              d.createObjectStore("prefs", { keyPath: "key" });
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

      /* Data */
      const tod = () => new Date().toISOString().slice(0, 10);
      async function saveLog(log) {
        log.date = log.date || tod();
        log.ts = Date.now();
        await iPut("logs", log);
        if (fbOk && me) {
          try {
            const { notes: _, ...p } = log;
            await setDoc(doc(db, "users", me.uid, "logs", log.date), p, {
              merge: true,
            });
          } catch (e) {}
        }
      }
      const getLog = () => iGet("logs", tod());
      const getLogs = () =>
        iAll("logs").then((a) =>
          a.sort((a, b) => b.date.localeCompare(a.date)),
        );

      /* Phases */
      const PH = [
        {
          n: "Peak Performance",
          s: "Peak",
          c: "#5B0EA6",
          ic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
          d: "Firing on all cylinders. Go conquer something.",
          t: [
            "Schedule your hardest tasks now",
            "Great day for social commitments",
          ],
        },
        {
          n: "High Energy",
          s: "High",
          c: "#7C3AED",
          ic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
          d: "Energy is up. Your future self thanks you.",
          t: [
            "Tackle the project you've been avoiding",
            "Good day for creative work",
          ],
        },
        {
          n: "Balanced",
          s: "Good",
          c: "#6366F1",
          ic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/></svg>`,
          d: "Steady as she goes. Reliable and consistent.",
          t: ["Routine work flows smoothly", "Good day for planning"],
        },
        {
          n: "Recovery Mode",
          s: "Rest",
          c: "#6B7280",
          ic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><path d="M17 18a5 5 0 00-10 0"/><line x1="12" y1="2" x2="12" y2="9"/></svg>`,
          d: "Your body sent a memo. Respect it.",
          t: ["Prioritize sleep tonight", "Light movement only"],
        },
        {
          n: "Recharge",
          s: "Low",
          c: "#4F46E5",
          ic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="17" height="17"><rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="13" x2="23" y2="11"/></svg>`,
          d: "Even phones need charging. Take notes.",
          t: ["Cancel non-essential meetings", "Focus on nutrition today"],
        },
      ];
      const phFrom = (l) => {
        if (!l) return PH[2];
        if (l.energy >= 8) return PH[0];
        if (l.energy >= 6) return PH[1];
        if (l.energy >= 4) return PH[2];
        if (l.energy >= 2) return PH[3];
        return PH[4];
      };

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
      ];
      const MQ = [
        "Even rocks have bad days. Valid.",
        "Gravity feels personal today.",
        "Not great, not terrible.",
        "Could be worse.",
        "Solidly mid.",
        "Things are going.",
        "Pretty decent.",
        "Good day. Enjoy it.",
        "Excellent. Hydrated?",
        "Absolute peak energy.",
      ];
      const OB = [
        {
          ic: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="30" height="30"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>`,
          t: "Welcome to Velour",
          s: "Your premium wellness companion.",
          f: "You have moods. They have patterns. Time to learn them.",
        },
        {
          ic: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="30" height="30"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>`,
          t: "Track Your Patterns",
          s: "Log mood, energy, stress and sleep daily.",
          f: "Men have hormonal cycles too — less discussed, completely real.",
        },
        {
          ic: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="30" height="30"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>`,
          t: "AI Wellness Coach",
          s: "Ask anything wellness-related.",
          f: "70% science, 30% wit, 100% on your side.",
        },
        {
          ic: `<svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="30" height="30"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`,
          t: "Your Data, Your Rules",
          s: "Local-first. Privacy by design.",
          f: "Your data stays on your device. Not for sale.",
        },
      ];

      /* Ambient bubbles */
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

      /* AOS */
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

      /* Nav */
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
        const mains = [
          "dashboard",
          "tracker",
          "calendar",
          "insights",
          "partner",
        ];
        const nav = document.getElementById("nav"),
          fab = document.getElementById("chat-fab");
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

      /* Onboarding */
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

      /* Auth */
      async function afterLogin(user) {
        me = user;
        const ob = await getPref("onboarded");
        if (!ob) go("onboarding");
        else {
          go("dashboard");
          hist = ["dashboard"];
        }
      }
      document
        .getElementById("btn-google")
        .addEventListener("click", async () => {
          if (!fbOk) {
            const e = document.getElementById("login-err");
            e.textContent = "Firebase not configured. Use guest mode.";
            e.classList.remove("hid");
            return;
          }
          try {
            const r = await signInWithPopup(auth, new GoogleAuthProvider());
            await setDoc(
              doc(db, "users", r.user.uid),
              {
                displayName: r.user.displayName || "",
                email: r.user.email || "",
                photoUrl: r.user.photoURL || "",
                lastSeen: Date.now(),
              },
              { merge: true },
            );
            await afterLogin(r.user);
          } catch (e) {
            const el = document.getElementById("login-err");
            el.textContent = "Sign-in failed: " + e.message;
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
      document
        .getElementById("signout-btn")
        ?.addEventListener("click", async () => {
          if (fbOk && auth) await signOut(auth);
          me = null;
          hist = [];
          document.getElementById("nav").classList.remove("on");
          document.getElementById("chat-fab").style.display = "none";
          go("login", false);
        });

      /* Dashboard */
      const greet = () => {
        const h = new Date().getHours();
        return h < 5
          ? "Night shift"
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
        const log = await getLog(),
          ph = phFrom(log);
        const pc = document.getElementById("pcard");
        pc.style.background = `linear-gradient(135deg,${ph.c}20,${ph.c}09)`;
        pc.style.borderColor = `${ph.c}2e`;
        pc.style.border = "1px solid";
        document.getElementById("p-icon").innerHTML = ph.ic;
        document.getElementById("p-icon").style.cssText =
          `width:36px;height:36px;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;background:${ph.c}1e;color:${ph.c}`;
        document.getElementById("p-name").textContent = ph.n;
        document.getElementById("p-name").style.color = ph.c;
        document.getElementById("p-pill").textContent = ph.s;
        document.getElementById("p-pill").style.cssText =
          `display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:.67rem;font-weight:600;border:1px solid;color:${ph.c};border-color:${ph.c}44;background:${ph.c}14`;
        document.getElementById("p-desc").textContent = ph.d;
        document.getElementById("p-tips").innerHTML = ph.t
          .map(
            (t) =>
              `<div class="f ic g2 sm mu" style="margin-bottom:3px"><div style="width:3px;height:3px;border-radius:50%;background:${ph.c};flex-shrink:0"></div>${t}</div>`,
          )
          .join("");
        if (log) {
          document.getElementById("vsec").classList.remove("hid");
          document.getElementById("v-mood").textContent = log.mood + "/10";
          document.getElementById("v-en").textContent = log.energy + "/10";
          document.getElementById("v-st").textContent = log.stress + "/10";
        } else document.getElementById("vsec").classList.add("hid");
      }
      document
        .getElementById("d-log")
        .addEventListener("click", () => go("tracker"));
      document
        .getElementById("d-ins")
        .addEventListener("click", () => go("insights"));

      /* Tracker */
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
          sl < 6 ? "Under 6h. Risky." : sl >= 8 ? "8h+ Optimal." : "Decent.";
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
      document
        .getElementById("save-btn")
        .addEventListener("click", async () => {
          const btn = document.getElementById("save-btn");
          btn.disabled = true;
          btn.innerHTML = '<div class="spin"></div> Saving...';
          await saveLog({
            date: tod(),
            mood: +document.getElementById("r-m").value,
            energy: +document.getElementById("r-e").value,
            stress: +document.getElementById("r-s").value,
            focus: +document.getElementById("r-f").value,
            sleepHours: +document.getElementById("r-sl").value,
            libido: document.getElementById("lib-tog").checked
              ? +document.getElementById("r-l").value
              : null,
            symptoms: JSON.stringify([...selSx]),
            notes: document.getElementById("nt-inp").value,
            phase: phFrom({ energy: +document.getElementById("r-e").value }).n,
          });
          btn.disabled = false;
          btn.innerHTML =
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg> Save Today\'s Log';
          goBack();
        });

      /* Insights */
      async function rIns() {
        const body = document.getElementById("ins-body"),
          logs = await getLogs();
        if (!logs.length) {
          body.innerHTML = `<div class="tc" style="padding:44px 16px">
      <div style="width:48px;height:48px;border-radius:13px;background:var(--layer);border:1px solid var(--rim);display:flex;align-items:center;justify-content:center;margin:0 auto 12px">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="20" height="20"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      </div>
      <h2 class="mb2">No data yet</h2><p class="mu sm">Start logging daily — insights appear here.</p></div>`;
          return;
        }
        const avg = (fn) =>
          (logs.reduce((s, l) => s + fn(l), 0) / logs.length).toFixed(1);
        const am = avg((l) => l.mood),
          ae = avg((l) => l.energy),
          asl = avg((l) => l.sleepHours);
        const r14 = logs.slice(0, 14).reverse();
        const hes = logs.filter(
          (l) => l.sleepHours >= 7.5 && l.energy >= 7,
        ).length;
        const shi = logs.filter((l) => l.stress >= 7 && l.mood <= 4).length;
        body.innerHTML = `
  <div class="spill" data-a="1">
    <div class="sp"><div class="sn so">${logs.length}</div><div class="sl">Days Logged</div></div>
    <div class="sp"><div class="sn" style="color:var(--lil)">${am}</div><div class="sl">Avg Mood</div></div>
    <div class="sp"><div class="sn" style="color:#7C3AED">${ae}</div><div class="sl">Avg Energy</div></div>
    <div class="sp"><div class="sn" style="color:#6366F1">${asl}h</div><div class="sl">Avg Sleep</div></div>
  </div>
  ${
    r14.length >= 2
      ? `<div class="card" data-a="2">
    <div class="semi sm mb3">14-Day Mood Trend</div>
    <div class="cbars">${r14.map((l) => `<div class="bar" style="height:${Math.round((l.mood / 10) * 100)}%" title="${l.date}: ${l.mood}"></div>`).join("")}</div>
  </div>`
      : ""
  }
  <div class="card" data-a="3">
    <div class="semi sm mb3">Patterns</div>
    <div class="ii">
      <div class="ii-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M17 18a5 5 0 00-10 0"/><line x1="12" y1="2" x2="12" y2="9"/></svg></div>
      <div><div class="semi sm mb2 so">Sleep</div><div class="xs mu" style="line-height:1.6">${+asl >= 7.5 ? `${asl}h average. Well-rested.` : `${asl}h average. More sleep = more gains.`}</div></div>
    </div>
    ${
      hes > 0
        ? `<div class="ii"><div class="ii-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
      <div><div class="semi sm mb2 so">Sleep → Energy</div><div class="xs mu" style="line-height:1.6">On ${hes} days with 7.5h+ sleep you hit high energy.</div></div></div>`
        : ""
    }
    ${
      shi > 0
        ? `<div class="ii"><div class="ii-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/></svg></div>
      <div><div class="semi sm mb2 so">Stress Impact</div><div class="xs mu" style="line-height:1.6">${shi} high-stress days correlated with low mood.</div></div></div>`
        : ""
    }
    <div class="ii" style="border-bottom:none"><div class="ii-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg></div>
      <div><div class="semi sm mb2 ok">Best Days</div><div class="xs mu" style="line-height:1.6">Peak days align with energy above 7. The data doesn't lie.</div></div>
    </div>
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

      /* Calendar */
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
              cls +=
                log.energy >= 8 ? " hi" : log.energy >= 6 ? " good" : " lo";
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
    ${log.notes ? `<div class="xs mu mt3" style="line-height:1.6;border-top:1px solid var(--rim);padding-top:9px;margin-top:9px">"${log.notes}"</div>` : ""}
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

      /* Partner */
      let pD = { info: null, req: null, logs: [], sync: false },
        pL = null;
      async function rPart() {
        const body = document.getElementById("pt-body");
        if (!fbOk || !me) {
          body.innerHTML = `<div class="card tc" style="padding:24px 14px">
    <div style="width:44px;height:44px;border-radius:12px;background:var(--layer);border:1px solid var(--rim);display:flex;align-items:center;justify-content:center;margin:0 auto 11px">
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="20" height="20"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
    </div>
    <h3 class="mb2">Sign in for Partner Sync</h3>
    <p class="sm mu">Connect with your partner and share wellness data.</p>
  </div>`;
          return;
        }
        if (!pL) {
          pL = onSnapshot(doc(db, "users", me.uid), async (snap) => {
            const pu = snap.data()?.partnerUid;
            if (pu) {
              const ps = await getDoc(doc(db, "users", pu));
              if (ps.exists()) {
                pD.info = { uid: pu, ...ps.data() };
                pD.sync = true;
                const ls = await getDocs(
                  query(
                    collection(db, "users", pu, "logs"),
                    orderBy("date", "desc"),
                    limit(30),
                  ),
                );
                pD.logs = ls.docs.map((d) => ({ date: d.id, ...d.data() }));
              }
            }
            rPUI(body);
          });
          onSnapshot(
            query(
              collection(db, "users", me.uid, "partnerRequests"),
              where("status", "==", "pending"),
            ),
            (snap) => {
              const r = snap.docs[0]?.data();
              pD.req = r ? { id: snap.docs[0].id, ...r } : null;
              rPUI(body);
            },
          );
        }
        rPUI(body);
      }
      function rPUI(body) {
        let h = "";
        if (pD.req) {
          h += `<div class="card" style="border-color:rgba(124,58,237,.28);background:rgba(124,58,237,.05)">
    <div class="f ic g3 mb3">
      <div style="width:34px;height:34px;border-radius:9px;background:rgba(124,58,237,.13);display:flex;align-items:center;justify-content:center">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="16" height="16"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
      </div>
      <div><div class="semi sm so">Partner Request</div><div class="xs mu">${pD.req.fromName} (${pD.req.fromEmail})</div></div>
    </div>
    <div class="apair" style="gap:7px">
      <button class="btn btn-p btn-sm" id="acc">Accept</button>
      <button class="btn btn-o btn-sm" id="dec">Decline</button>
    </div>
  </div>`;
        }
        if (pD.info) {
          const ini = (pD.info.displayName || "?")[0].toUpperCase();
          h += `<div class="card"><div class="f ic g3 mb3">
      <div class="av">${ini}</div>
      <div class="f1"><div class="semi sm">${pD.info.displayName || "Partner"}</div>
      <div class="xs mu">${pD.info.email || ""}</div>
      <span class="badge bgr" style="margin-top:4px">Connected</span></div>
    </div><div class="div"></div>
    <div class="f ic jb"><div><div class="semi sm">Share My Data</div><div class="xs mu">Mood, energy, sleep only</div></div>
      <label class="tog"><input type="checkbox" id="sync-tog" ${pD.sync ? "checked" : ""}/><span class="tog-sl"></span></label>
    </div>
    <button class="btn btn-g btn-d btn-sm mt3" id="disc" style="justify-content:flex-start;gap:7px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M18.36 6.64a9 9 0 11-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>Disconnect
    </button></div>`;
          if (pD.sync && pD.logs.length) {
            h += `<div class="card"><div class="semi sm mb3">Partner's Week</div>
      ${pD.logs
        .slice(0, 7)
        .map(
          (l) => `<div class="f ic g3" style="margin-bottom:6px">
        <div class="xs mu" style="width:34px">${l.date.slice(5)}</div>
        <div style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:${l.mood >= 8 ? "var(--ink)" : l.mood >= 6 ? "var(--vi)" : "var(--mute)"}"></div>
        <div class="pb f1"><div class="pf" style="width:${l.energy * 10}%"></div></div>
        <div class="xs mu" style="width:38px">${(l.phase || "").split(" ")[0]}</div>
      </div>`,
        )
        .join("")}</div>`;
          }
        } else if (!pD.req) {
          h += `<div class="card tc" style="padding:20px 14px">
    <div style="width:44px;height:44px;border-radius:12px;background:var(--layer);border:1px solid var(--rim);display:flex;align-items:center;justify-content:center;margin:0 auto 11px">
      <svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="20" height="20"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
    </div>
    <h3 class="mb2">Partner Sync</h3><p class="sm mu">Share your journey. Notes stay private.</p>
  </div>
  <div class="card"><div class="semi sm mb2">Invite Partner</div>
    <div class="xs mu mb3">They need a Velour account first.</div>
    <input type="email" id="pe" class="inp mb3" placeholder="partner@email.com"/>
    <button class="btn btn-p" id="inv"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>Send Invite</button>
    <div id="pmsg" class="mt3 hid"></div>
  </div>`;
        }
        h += `<div class="card f g3"><div style="width:30px;height:30px;border-radius:7px;background:rgba(124,58,237,.1);display:flex;align-items:center;justify-content:center;flex-shrink:0">
    <svg viewBox="0 0 24 24" fill="none" stroke="var(--lil)" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
  </div><div><div class="semi sm mb2">Privacy First</div><div class="xs mu" style="line-height:1.5">Notes never shared. Only mood, energy, sleep and phase — always optional.</div></div></div>`;
        body.innerHTML = h;
        document.getElementById("acc")?.addEventListener("click", async () => {
          const b = writeBatch(db);
          b.set(
            doc(db, "users", me.uid),
            { partnerUid: pD.req.fromUid },
            { merge: true },
          );
          b.set(
            doc(db, "users", pD.req.fromUid),
            { partnerUid: me.uid },
            { merge: true },
          );
          b.update(doc(db, "users", me.uid, "partnerRequests", pD.req.id), {
            status: "accepted",
          });
          await b.commit();
          pD.req = null;
          rPUI(body);
        });
        document.getElementById("dec")?.addEventListener("click", () => {
          pD.req = null;
          rPUI(body);
        });
        document.getElementById("sync-tog")?.addEventListener("change", (e) => {
          pD.sync = e.target.checked;
          rPUI(body);
        });
        document.getElementById("disc")?.addEventListener("click", async () => {
          if (!confirm("Disconnect?")) return;
          const b = writeBatch(db);
          b.update(doc(db, "users", me.uid), { partnerUid: null });
          b.update(doc(db, "users", pD.info.uid), { partnerUid: null });
          await b.commit();
          pD = { info: null, req: null, logs: [], sync: false };
          pL = null;
          rPUI(body);
        });
        document.getElementById("inv")?.addEventListener("click", async () => {
          const em = document.getElementById("pe").value.trim();
          if (!em) return;
          const msg = document.getElementById("pmsg");
          try {
            const s = await getDocs(
              query(collection(db, "users"), where("email", "==", em)),
            );
            if (s.empty) {
              msg.className = "mt3 ebox";
              msg.textContent = "No account found for that email.";
              msg.classList.remove("hid");
              return;
            }
            const pu = s.docs[0].id;
            if (pu === me.uid) {
              msg.className = "mt3 ebox";
              msg.textContent = "That's you.";
              msg.classList.remove("hid");
              return;
            }
            await setDoc(doc(db, "users", pu, "partnerRequests", me.uid), {
              fromUid: me.uid,
              fromName: me.displayName || "A Velour User",
              fromEmail: me.email || "",
              status: "pending",
              timestamp: Date.now(),
            });
            msg.className = "mt3 obox";
            msg.textContent = "Invite sent!";
            msg.classList.remove("hid");
            document.getElementById("pe").value = "";
          } catch (e) {
            const msg = document.getElementById("pmsg");
            msg.className = "mt3 ebox";
            msg.textContent = e.message;
            msg.classList.remove("hid");
          }
        });
      }

      /* AI Chat */
      let chatH = [];
      const SYS = `You are Velour's AI wellness coach — helpful, witty, concise. Give real actionable advice on mood, energy, stress, sleep, men's health. Be encouraging but honest. Use light humor. Never diagnose. 2-3 sentences max unless user wants detail.`;
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
              system_instruction: { parts: [{ text: SYS }] },
              contents,
              generationConfig: { maxOutputTokens: 380, temperature: 0.8 },
            }),
          });
          const json = await res.json();
          const reply =
            json.candidates?.[0]?.content?.parts?.[0]?.text ||
            "Connection issue. Try again.";
          document.getElementById(tid)?.remove();
          chatH.push({ role: "model", txt: reply, u: false });
          addB(reply, false);
        } catch (e) {
          document.getElementById(tid)?.remove();
          addB(
            GK.startsWith("YOUR_")
              ? "Add your Gemini API key in index.html. Free at aistudio.google.com"
              : "Connection error.",
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
      const scrollC = () =>
        (document.getElementById("chat-msgs").scrollTop = 9999);

      const cp = document.getElementById("chat-panel");
      document.getElementById("chat-fab").addEventListener("click", () => {
        cp.classList.toggle("on");
        document.getElementById("cu").style.display = "none";
      });
      document
        .getElementById("chat-close")
        .addEventListener("click", () => cp.classList.remove("on"));
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

      /* Nav events */
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

      /* Boot */
      async function boot() {
        spawnBubbles();
        idb = await openDB();
        rOb();
        buildSx();
        uRanges();
        if ("serviceWorker" in navigator)
          navigator.serviceWorker.register("sw.js").catch(() => {});
        if (!fbOk) {
          const ob = await getPref("onboarded");
          if (ob) {
            go("dashboard");
            hist = ["dashboard"];
          }
        }
        aos(document.getElementById("screen-login"));
      }
      boot();