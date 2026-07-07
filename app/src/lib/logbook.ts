// @ts-nocheck
// Ported from the POC. Server holds the source of truth (exercises, pain
// categories, workouts); localStorage only keeps a draft of the in-progress
// session + current view so an accidental refresh at the gym isn't lost.

/* ============ Constants ============ */
const STORAGE_KEY = "logbook_draft";
const WEIGHT_STEP = 2.5;
const REPS_STEP = 1;
const DURATION_STEP = 1;   // minutes
const DISTANCE_STEP = 0.5; // km
const RPE_MIN = 1;
const RPE_MAX = 10;

const PAIN_MAX = 10;
const DEFAULT_PAIN_LEVEL = 5;
const SEED_PAIN_CATEGORIES = ["Lower back", "Knees", "Shoulders", "Elbows", "Wrists", "Hips", "Neck"];

// Only cardio activities are seeded — they back the Bike/Run/Walk/Interval
// categories and stay hidden from the gym picker. The gym library starts empty
// and is built entirely from user-created custom exercises.
const SEED_EXERCISES = [
  { id: "run",      name: "Run",            type: "cardio", muscle: "Cardio" },
  { id: "walk",     name: "Walk",           type: "cardio", muscle: "Cardio" },
  { id: "bike",     name: "Cycling",        type: "cardio", muscle: "Cardio" },
  { id: "bike_int", name: "Bike Intervals", type: "cardio", muscle: "Cardio" },
];

const SUGGESTED_MUSCLES = ["Chest", "Back", "Shoulders", "Arms", "Legs", "Glutes", "Core", "Calves"];

const SEED_ROUTINES = [
  { id: "gym",     name: "Gym",           icon: "\u{1F3CB}️", exerciseIds: [] },
  { id: "bike",    name: "Bike",          icon: "\u{1F6B4}",       exerciseIds: ["bike"] },
  { id: "run",     name: "Run",           icon: "\u{1F3C3}",       exerciseIds: ["run"] },
  { id: "walk",    name: "Walk",          icon: "\u{1F6B6}",       exerciseIds: ["walk"] },
  { id: "bikeint", name: "Bike Interval", icon: "⚡",          exerciseIds: ["bike_int"] },
];

/* ============ State ============ */
// Server-backed collections start empty and are filled by boot() from /api/data.
// UI/draft state (active session, current view) is restored from localStorage.
let state = load();

function load() {
  let draft = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) { draft = JSON.parse(raw); }
  } catch (e) { /* ignore corrupt draft */ }
  return {
    exercises: [],
    routines: SEED_ROUTINES.slice(),
    painCategories: [],
    workouts: [],
    active: draft.active || null,
    view: draft.view || "home",
    picker: draft.picker || { q: "", cat: "All" },
    cal: draft.cal || currentMonth(),
    newDate: draft.newDate || null,
    detailId: draft.detailId || null,
  };
}

/* ============ Server sync ============ */
async function apiGet(url) {
  const r = await fetch(url);
  if (!r.ok) { throw new Error("GET " + url + " -> " + r.status); }
  return r.json();
}

async function apiPost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { throw new Error("POST " + url + " -> " + r.status); }
  return r.json();
}

function currentMonth() { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; }

function isToday(ts) {
  const d = new Date(ts), n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

function dateInputValue(ts) {
  const d = new Date(ts), p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// Persist only the client-side draft (in-progress session + view), not the
// server-owned collections.
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      active: state.active,
      view: state.view,
      picker: state.picker,
      cal: state.cal,
      newDate: state.newDate,
      detailId: state.detailId,
    }));
  } catch (e) { /* storage full / unavailable */ }
}

function uid() { return Math.random().toString(36).slice(2, 9); }
function exById(id) {
  return state.exercises.find((e) => e.id === id) || { id, name: "Unknown", type: "strength", muscle: "" };
}

// Timestamp of the most recent workout containing an exercise (0 = never used).
function lastUsedAt(id) {
  for (let i = state.workouts.length - 1; i >= 0; i--) {
    if (state.workouts[i].entries.some((en) => en.exerciseId === id)) { return state.workouts[i].startedAt; }
  }
  return 0;
}

// Muscle-group tags present in the user's gym library (cardio excluded).
function uniqueMuscles() {
  const out = [];
  state.exercises.filter((e) => e.type !== "cardio").forEach((e) => {
    if (e.muscle && !out.includes(e.muscle)) { out.push(e.muscle); }
  });
  return out.sort();
}

function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }

function workoutsByDay() {
  const m = {};
  state.workouts.forEach((w) => { const k = dayKey(w.startedAt); (m[k] = m[k] || []).push(w); });
  return m;
}

/* ============ Helpers ============ */
function heatColor(rpe) {
  // Map 1..10 onto cool -> warm -> hot.
  const t = Math.max(0, Math.min(1, (rpe - 1) / (RPE_MAX - 1)));
  const stops = [
    [76, 201, 176],  // --cool
    [246, 197, 73],  // --warm
    [238, 90, 82],   // --hot
  ];
  const seg = t < 0.5 ? 0 : 1;
  const localT = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = stops[seg], b = stops[seg + 1];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * localT));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

function lastSetFor(exerciseId) {
  for (let i = state.workouts.length - 1; i >= 0; i--) {
    const entry = state.workouts[i].entries.find((en) => en.exerciseId === exerciseId);
    if (entry && entry.sets.length) { return entry.sets[entry.sets.length - 1]; }
  }
  return null;
}

function blankSet(type) {
  if (type === "cardio") { return { duration: 20, distance: 5, rpe: null }; }
  return { reps: 8, weight: 20, rpe: null };
}

function fmtDate(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(ts); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) { return "Today"; }
  if (diff === 1) { return "Yesterday"; }
  if (diff < 7) { return d.toLocaleDateString(undefined, { weekday: "long" }); }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function totalSets(w) { return w.entries.reduce((n, e) => n + e.sets.length, 0); }

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 1800);
}

/* ============ Actions ============ */
// Gym exercises are a checklist (no sets). Cardio carries duration + distance.
function newEntry(ex) {
  if (ex.type === "cardio") {
    const last = lastSetFor(ex.id);
    const seed = last ? { duration: last.duration, distance: last.distance } : blankSet("cardio");
    return { exerciseId: ex.id, sets: [seed] };
  }
  return { exerciseId: ex.id, sets: [] };
}

// ts (optional) = a chosen day for a backdated session. A workout on a past day
// is "manual" (no live timer, no duration); today always runs live.
function startWorkout(routine, ts) {
  const entries = [];
  if (routine) {
    routine.exerciseIds.forEach((id) => {
      const ex = exById(id);
      if (ex) { entries.push(newEntry(ex)); }
    });
  }
  const backdated = ts && !isToday(ts);
  state.active = {
    id: uid(),
    startedAt: backdated ? ts : Date.now(),
    manual: !!backdated,
    routineName: routine ? routine.name : null,
    entries,
    feel: null,
    energy: null,
    pains: {},
    notes: "",
  };
  go("active");
}

function addExerciseToActive(id) {
  state.active.entries.push(newEntry(exById(id)));
  save();
  go("active");
}

function toggleExNote(entryIdx) {
  const entry = state.active.entries[entryIdx];
  entry.noteOpen = !entry.noteOpen;
  if (!entry.noteOpen) { entry.note = ""; }
  save();
  render();
}

function setExNote(entryIdx, value) {
  state.active.entries[entryIdx].note = value;
  save();
}

// Optimistic: add locally now, persist in the background (keeps the sync signature).
function addPainCategory(name) {
  const n = (name || "").trim();
  if (!n) { return null; }
  if (!state.painCategories.includes(n)) {
    state.painCategories.push(n);
    apiPost("/api/pain-categories", { name: n }).catch(() => {});
  }
  return n;
}

/* ---- Per-exercise pain (single { cat, level } per exercise) ---- */
function toggleExPain(entryIdx) {
  const entry = state.active.entries[entryIdx];
  entry.painOpen = !entry.painOpen;
  save();
  render();
}

function setExPainCat(entryIdx, cat) {
  const entry = state.active.entries[entryIdx];
  entry.pain = { cat, level: (entry.pain && entry.pain.level) || DEFAULT_PAIN_LEVEL };
  entry.painOpen = true;
  save();
  render();
}

function setExPainLevel(entryIdx, level) {
  const entry = state.active.entries[entryIdx];
  if (!entry.pain) { return; }
  entry.pain.level = level;
  save();
  render();
}

function clearExPain(entryIdx) {
  state.active.entries[entryIdx].pain = null;
  save();
  render();
}

/* ---- Custom exercises ---- */
async function createExercise(name, muscle) {
  let ex;
  try {
    ex = await apiPost("/api/exercises", { name: name.trim(), muscle: (muscle || "").trim() || "Other" });
  } catch (e) {
    toast("Couldn't save exercise");
    return;
  }
  state.exercises.push(ex);
  state.picker.creating = false;
  state.picker.newName = "";
  state.picker.newMuscle = "";
  addExerciseToActive(ex.id);
}

/* ---- Calendar ---- */
function calShift(delta) {
  let { year, month } = state.cal;
  month += delta;
  if (month < 0) { month = 11; year--; }
  if (month > 11) { month = 0; year++; }
  state.cal = { year, month };
  save();
  render();
}

function delExercise(entryIdx) {
  state.active.entries.splice(entryIdx, 1);
  save();
  render();
}

function bumpField(entryIdx, setIdx, field, dir) {
  const set = state.active.entries[entryIdx].sets[setIdx];
  const steps = { reps: REPS_STEP, weight: WEIGHT_STEP, duration: DURATION_STEP, distance: DISTANCE_STEP };
  const v = (set[field] || 0) + dir * steps[field];
  set[field] = Math.max(0, Math.round(v * 100) / 100);
  save();
  render();
}

function setField(entryIdx, setIdx, field, value) {
  const set = state.active.entries[entryIdx].sets[setIdx];
  const n = parseFloat(value);
  set[field] = isNaN(n) ? 0 : Math.max(0, n);
  save();
}

// Finish-screen pain: state.active.pains is a map { cat: level }; painFocus is
// the category whose 1-10 scale is currently shown.
function focusFinishPain(cat) {
  const w = state.active;
  w.painFocus = cat;
  if (!w.pains[cat]) { w.pains[cat] = DEFAULT_PAIN_LEVEL; }
  save();
  render();
}

function setFinishPainLevel(level) {
  const w = state.active;
  if (w.painFocus) { w.pains[w.painFocus] = level; save(); render(); }
}

function removeFinishPain() {
  const w = state.active;
  if (w.painFocus) { delete w.pains[w.painFocus]; w.painFocus = null; save(); render(); }
}

async function finishWorkout() {
  const w = state.active;
  const payload = {
    startedAt: w.startedAt,
    routineName: w.routineName,
    feel: w.feel,
    energy: w.energy,
    notes: w.notes || "",
    pains: Object.entries(w.pains).map(([cat, level]) => ({ cat, level })),
    entries: w.entries.map((en) => ({
      exerciseId: en.exerciseId,
      sets: en.sets,
      note: en.note || "",
      pain: en.pain || null,
    })),
  };
  // Optimistic: clear the active session and return home immediately.
  state.active = null;
  save();
  go("home");
  toast("Workout saved ✓");
  try {
    const saved = await apiPost("/api/workouts", payload);
    state.workouts.push(saved);
  } catch (e) {
    // Keep a local copy so it still appears; it can be re-synced later.
    state.workouts.push({ id: "local-" + uid(), ...payload });
    toast("Saved on device — will sync later");
  }
  render();
}

function cancelWorkout() {
  state.active = null;
  save();
  go("home");
}

function go(view) {
  state.view = view;
  save();
  render();
  window.scrollTo(0, 0);
}

/* ============ Render ============ */
const app = document.getElementById("app");

function render() {
  let html = "";
  if (state.view === "home") { html = viewHome(); }
  else if (state.view === "newday") { html = viewNewDay(); }
  else if (state.view === "active") { html = viewActive(); }
  else if (state.view === "picker") { html = viewPicker(); }
  else if (state.view === "finish") { html = viewFinish(); }
  else if (state.view === "history") { html = viewHistory(); }
  else if (state.view === "detail") { html = viewDetail(); }
  app.innerHTML = html;
}

function header(opts) {
  const left = opts.back
    ? `<button class="back-btn" data-act="${opts.back}">‹ ${opts.backLabel || "Back"}</button>`
    : `<div class="wordmark">log<span>book</span></div>`;
  let right = "";
  if (opts.dateLabel) {
    right = `<div class="timer">📅 ${opts.dateLabel}</div>`;
  } else if (opts.action) {
    right = opts.action;
  } else if (!opts.back) {
    right = `<div style="display:flex;gap:8px;">
      <button class="iconbtn" data-act="history" aria-label="History">\u{1F4D6}</button>
      <button class="iconbtn" data-act="logout" aria-label="Sign out">⏻</button>
    </div>`;
  }
  return `<header class="bar">${left}<div class="spacer"></div>${right}</header>`;
}

/* ---- Home ---- */
function viewHome() {
  const recent = state.workouts.slice(-3).reverse();

  const routinesHtml = state.routines.map((r) =>
    `<button class="routine" data-act="start-routine" data-id="${r.id}">
      <span class="r-icon">${r.icon}</span>
      <span class="r-name">${r.name}</span>
    </button>`
  ).join("");

  const recentHtml = recent.length
    ? recent.map(historyCard).join("")
    : `<div class="empty">No workouts yet.</div>`;

  return `<div class="app">
    ${header({})}
    <main>
      <div class="routines">${routinesHtml}</div>

      ${calendarWidget()}

      <div class="section-head">
        <span class="eyebrow">Recent</span>
        ${state.workouts.length > 3 ? `<button class="back-btn" data-act="history">All ›</button>` : ""}
      </div>
      ${recentHtml}
    </main>
    <div class="footer">
      <button class="btn btn-primary" data-act="start-empty">+  Start empty workout</button>
    </div>
  </div>`;
}

// Category chooser for a backdated session (reached by tapping an empty calendar day).
function viewNewDay() {
  const ts = state.newDate;
  const label = new Date(ts).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const routinesHtml = state.routines.map((r) =>
    `<button class="routine" data-act="start-routine" data-id="${r.id}" data-date="${ts}">
      <span class="r-icon">${r.icon}</span>
      <span class="r-name">${r.name}</span>
    </button>`
  ).join("");

  return `<div class="app">
    ${header({ back: "home", backLabel: "Home" })}
    <main>
      <div class="section-head"><span class="eyebrow">Add session · ${label}</span></div>
      <div class="routines">${routinesHtml}</div>
    </main>
    <div class="footer">
      <button class="btn btn-primary" data-act="start-empty" data-date="${ts}">+  Empty workout</button>
    </div>
  </div>`;
}

function historyCard(w) {
  const feel = w.feel || 0;
  const badgeStyle = feel
    ? `background:${heatColor(feel)};color:#14171C;`
    : `background:var(--surface-2);color:var(--muted);`;
  const exPain = w.entries.filter((e) => e.pain).length;
  const painCount = (w.pains || []).length + exPain;
  const exCount = w.entries.length;
  const exStr = exCount ? ` · ${exCount} exercise${exCount !== 1 ? "s" : ""}` : "";
  return `<button class="hcard" data-act="detail" data-id="${w.id}">
    <div class="feel-badge tnum" style="${badgeStyle}">${feel || "–"}</div>
    <div class="h-body">
      <div class="h-title">${w.routineName || "Workout"}</div>
      <div class="h-meta">${fmtDate(w.startedAt)}${exStr}</div>
    </div>
    ${painCount ? `<span class="pain-flag">⚠ ${painCount}</span>` : ""}
  </button>`;
}

/* ---- Calendar widget ---- */
function calendarWidget() {
  const { year, month } = state.cal;
  const first = new Date(year, month, 1);
  const monthName = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const startDow = (first.getDay() + 6) % 7;            // shift so Monday = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const byDay = workoutsByDay();
  const today = new Date();
  const thisMonth = today.getFullYear() === year && today.getMonth() === month;

  let cells = ["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < startDow; i++) { cells += `<div class="cal-day blank"></div>`; }
  for (let day = 1; day <= daysInMonth; day++) {
    const ws = byDay[year + "-" + month + "-" + day];
    if (ws && ws.length) {
      const maxFeel = Math.max(...ws.map((w) => w.feel || 0));
      const color = maxFeel ? heatColor(maxFeel) : "var(--accent)";
      const last = ws[ws.length - 1];
      cells += `<button class="cal-day has" style="background:${color}" data-act="cal-day" data-id="${last.id}">${day}${ws.length > 1 ? `<span class="cal-multi">${ws.length}</span>` : ""}</button>`;
    } else {
      const todayCls = (thisMonth && today.getDate() === day) ? " today" : "";
      const ts = new Date(year, month, day, 12).getTime();
      cells += `<button class="cal-day${todayCls}" data-act="cal-new" data-date="${ts}">${day}</button>`;
    }
  }

  return `<div class="cal">
    <div class="cal-head">
      <button class="cal-nav" data-act="cal-prev" aria-label="Previous month">‹</button>
      <span class="cal-title">${monthName}</span>
      <button class="cal-nav" data-act="cal-next" aria-label="Next month">›</button>
    </div>
    <div class="cal-grid">${cells}</div>
  </div>`;
}

// A 1-10 scale of buttons (shared by per-exercise and finish-screen pain).
function levelBtns(act, ei, selected) {
  let out = "";
  for (let i = 1; i <= PAIN_MAX; i++) {
    const sel = selected === i;
    const eiAttr = ei === null ? "" : ` data-ei="${ei}"`;
    out += `<button class="rpe-btn ${sel ? "sel" : ""}" data-act="${act}"${eiAttr} data-v="${i}" style="${sel ? `background:${heatColor(i)};` : ""}">${i}</button>`;
  }
  return out;
}

/* ---- Active ---- */
function viewActive() {
  const w = state.active;
  if (!w) { go("home"); return ""; }

  const exHtml = w.entries.map((entry, ei) => entryCard(entry, ei)).join("");

  const body = w.entries.length ? exHtml : "";

  return `<div class="app">
    ${header({ dateLabel: fmtDate(w.startedAt) })}
    <main>
      <div class="section-head">
        <span class="eyebrow">${w.routineName || "Workout"}</span>
        <button class="back-btn" data-act="cancel">Discard</button>
      </div>
      ${body}
      <button class="add-ex-btn" data-act="open-picker" style="margin-top:4px;">+  Add exercise</button>
    </main>
    <div class="footer">
      <button class="btn btn-primary" data-act="open-finish">Finish workout</button>
    </div>
  </div>`;
}

function entryCard(entry, ei) {
  const ex = exById(entry.exerciseId);
  let bodyRows = "";
  if (ex.type === "cardio") {
    const s = entry.sets[0];
    bodyRows = `<div class="set-row">
      <div class="set-fields">
        ${stepper(ei, 0, "duration", s.duration, "min")}
        ${stepper(ei, 0, "distance", s.distance, "km")}
      </div>
    </div>`;
  }

  const pain = entry.pain;
  const painStyle = pain ? `background:${heatColor(pain.level)};color:#14171C;border-color:transparent;` : "";
  const painLabel = pain ? `${pain.cat} ${pain.level}` : "Pain";
  const painOpen = entry.painOpen || pain;

  let painEditHtml = "";
  if (painOpen) {
    const catChips = state.painCategories.map((c) =>
      `<button class="chip ${pain && pain.cat === c ? "active" : ""}" data-act="ex-pain-cat" data-ei="${ei}" data-cat="${escAttr(c)}">${c}</button>`
    ).join("");
    painEditHtml = `<div class="pain-edit">
      <div class="chip-row">${catChips}<button class="chip" data-act="ex-pain-new" data-ei="${ei}">+ New</button></div>
      ${pain ? `<div class="rpe-scale">${levelBtns("ex-pain-level", ei, pain.level)}</div>
        <button class="text-btn" data-act="ex-pain-clear" data-ei="${ei}">Clear pain</button>` : ""}
    </div>`;
  }

  const noteOpen = entry.noteOpen || (entry.note && entry.note.length);
  const noteHtml = noteOpen
    ? `<div class="ex-note-wrap"><input class="ex-note" data-act="ex-note" data-ei="${ei}" value="${escAttr(entry.note || "")}"></div>`
    : "";

  return `<div class="ex-card">
    <div class="ex-head">
      <span class="ex-name">${ex.name}</span>
      <span class="ex-tag">${ex.muscle}</span>
      <button class="ex-del" data-act="del-ex" data-ei="${ei}" aria-label="Remove exercise">×</button>
    </div>
    ${bodyRows}
    <div class="ex-actions">
      <button class="mini-chip ${painOpen && !pain ? "active" : ""}" data-act="ex-pain-toggle" data-ei="${ei}" style="${painStyle}">⚠ ${painLabel}</button>
      <button class="mini-chip ${noteOpen ? "active" : ""}" data-act="ex-note-toggle" data-ei="${ei}">✎ Note</button>
    </div>
    ${painEditHtml}
    ${noteHtml}
  </div>`;
}

function escAttr(s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); }

function stepper(ei, si, field, value, label) {
  return `<div class="step-grp">
    <span class="lbl">${label}</span>
    <button class="step-btn" data-act="dec" data-ei="${ei}" data-si="${si}" data-field="${field}">−</button>
    <input class="step-val tnum" type="number" inputmode="decimal" value="${value}"
      data-act="setfield" data-ei="${ei}" data-si="${si}" data-field="${field}" aria-label="${label}">
    <button class="step-btn" data-act="inc" data-ei="${ei}" data-si="${si}" data-field="${field}">+</button>
  </div>`;
}

function describeSet(ex, s) {
  if (ex.type === "cardio") { return `${s.duration} min · ${s.distance} km`; }
  return `${s.reps} × ${s.weight} kg`;
}

/* ---- Picker ---- */
// Gym-only library (cardio excluded), filtered, sorted most-recently-used first.
function pickerExercises() {
  const q = state.picker.q.toLowerCase();
  const cat = state.picker.cat;
  return state.exercises
    .filter((e) => e.type !== "cardio")
    .filter((e) => (cat === "All" || e.muscle === cat) && (!q || e.name.toLowerCase().includes(q)))
    .sort((a, b) => lastUsedAt(b.id) - lastUsedAt(a.id) || a.name.localeCompare(b.name));
}

function pickerItemHtml(e) {
  return `<button class="ex-pick" data-act="pick" data-id="${e.id}">
    <div style="flex:1;min-width:0;"><div class="p-name">${e.name}</div>
    <div class="p-muscle">${e.muscle || ""}</div></div>
    <span class="p-add">+</span>
  </button>`;
}

function viewPicker() {
  if (state.picker.creating) { return viewCreateExercise(); }

  const cats = ["All"].concat(uniqueMuscles());
  const cat = state.picker.cat;
  const catHtml = cats.map((c) =>
    `<button class="chip ${c === cat ? "active" : ""}" data-act="set-cat" data-cat="${escAttr(c)}">${c}</button>`
  ).join("");

  const list = pickerExercises();
  const listHtml = list.length ? list.map(pickerItemHtml).join("") : `<div class="empty">No exercises yet — add one.</div>`;

  return `<div class="app">
    ${header({ back: "active", backLabel: "Workout" })}
    <main>
      <input class="picker-search" id="picker-q" placeholder="Search…" value="${escAttr(state.picker.q)}" data-act="search">
      ${cats.length > 1 ? `<div class="cat-row">${catHtml}</div>` : ""}
      <button class="add-ex-btn" data-act="new-ex" style="margin-bottom:14px;">+  New exercise</button>
      ${listHtml}
    </main>
  </div>`;
}

function viewCreateExercise() {
  const name = state.picker.newName || "";
  const muscle = state.picker.newMuscle || "";
  const chips = SUGGESTED_MUSCLES.map((m) =>
    `<button class="chip ${m === muscle ? "active" : ""}" data-act="pick-muscle" data-m="${m}">${m}</button>`
  ).join("");

  return `<div class="app">
    ${header({ back: "close-create", backLabel: "Back" })}
    <main>
      <div class="section-head"><span class="eyebrow">New exercise</span></div>
      <input class="picker-search" id="new-name" placeholder="Name" value="${escAttr(name)}" data-act="new-name" autofocus>
      <div class="eyebrow" style="margin:18px 2px 10px;">Muscle group</div>
      <div class="chip-row" style="margin-bottom:12px;">${chips}</div>
      <input class="picker-search" placeholder="Custom muscle…" value="${escAttr(muscle)}" data-act="new-muscle">
    </main>
    <div class="footer">
      <button class="btn btn-primary" data-act="create-ex">Add exercise</button>
    </div>
  </div>`;
}

/* ---- Finish ---- */
function viewFinish() {
  const w = state.active;
  if (!w) { go("home"); return ""; }

  const rpeBtns = [];
  for (let i = RPE_MIN; i <= RPE_MAX; i++) {
    const sel = w.feel === i;
    const style = sel ? `background:${heatColor(i)};` : "";
    rpeBtns.push(`<button class="rpe-btn ${sel ? "sel" : ""}" data-act="feel" data-v="${i}" style="${style}">${i}</button>`);
  }

  const energyBtns = [];
  for (let i = 1; i <= 5; i++) {
    const sel = w.energy === i;
    energyBtns.push(`<button class="rpe-btn ${sel ? "sel" : ""}" data-act="energy" data-v="${i}" style="${sel ? "background:var(--accent);color:#1a0f08;" : ""}">${i}</button>`);
  }

  const painChips = state.painCategories.map((cat) => {
    const lvl = w.pains[cat];
    const style = lvl
      ? `background:${heatColor(lvl)};color:#14171C;border-color:transparent;`
      : (w.painFocus === cat ? "border-color:var(--accent);color:var(--accent);" : "");
    return `<button class="chip ${lvl ? "active" : ""}" data-act="finish-pain-cat" data-cat="${escAttr(cat)}" style="${style}">${cat}${lvl ? ` ${lvl}` : ""}</button>`;
  }).join("");

  const painScale = w.painFocus
    ? `<div class="pain-edit" style="padding:14px 0 0;border:none;">
        <div class="eyebrow" style="margin-bottom:8px;">${w.painFocus} — level</div>
        <div class="rpe-scale">${levelBtns("finish-pain-level", null, w.pains[w.painFocus])}</div>
        <button class="text-btn" data-act="finish-pain-remove">Remove</button>
      </div>`
    : "";

  const painHtml = `<div class="chip-row">${painChips}<button class="chip" data-act="finish-pain-new">+ New</button></div>${painScale}`;

  return `<div class="app">
    ${header({ back: "active", backLabel: "Workout" })}
    <main>
      <div class="section-head"><span class="eyebrow">Finish</span></div>

      <div class="finish-block">
        <span class="eyebrow">Date</span>
        <input class="date-input" type="date" value="${dateInputValue(w.startedAt)}" data-act="wdate">
      </div>

      <div class="finish-block">
        <span class="eyebrow">Effort</span>
        <div class="rpe-scale">${rpeBtns.join("")}</div>
      </div>

      <div class="finish-block">
        <span class="eyebrow">Energy</span>
        <div class="rpe-scale">${energyBtns.join("")}</div>
      </div>

      <div class="finish-block">
        <span class="eyebrow">Pain</span>
        ${painHtml}
      </div>

      <div class="finish-block">
        <span class="eyebrow">Notes</span>
        <textarea class="notes" id="notes" data-act="notes">${w.notes}</textarea>
      </div>
    </main>
    <div class="footer">
      <button class="btn btn-primary" data-act="save">Save workout</button>
    </div>
  </div>`;
}

/* ---- History ---- */
function viewHistory() {
  const list = state.workouts.slice().reverse();
  const body = list.length
    ? list.map(historyCard).join("")
    : `<div class="empty">No workouts logged yet.</div>`;
  return `<div class="app">
    ${header({ back: "home", backLabel: "Home" })}
    <main>
      <div class="section-head"><span class="eyebrow">All workouts · ${list.length}</span></div>
      ${body}
    </main>
  </div>`;
}

/* ---- Detail ---- */
function viewDetail() {
  const w = state.workouts.find((x) => x.id === state.detailId);
  if (!w) { go("history"); return ""; }

  const exHtml = w.entries.map((entry) => {
    const ex = exById(entry.exerciseId);
    const detail = (ex.type === "cardio" && entry.sets[0])
      ? `<div class="d-set"><span class="di">${describeSet(ex, entry.sets[0])}</span></div>`
      : "";
    const pain = entry.pain
      ? `<div class="d-set"><span style="color:${heatColor(entry.pain.level)};font-weight:700;">⚠ ${entry.pain.cat} ${entry.pain.level}</span></div>`
      : "";
    const note = entry.note
      ? `<div class="d-set" style="color:var(--muted);">${escAttr(entry.note)}</div>`
      : "";
    return `<div class="d-ex"><div class="d-ex-name">${ex.name} <span style="color:var(--muted);font-weight:400;font-size:0.85rem;">${ex.muscle}</span></div>${detail}${pain}${note}</div>`;
  }).join("");

  const painHtml = (w.pains || []).length
    ? `<div class="finish-block"><span class="eyebrow" style="display:block;margin-bottom:10px;">Pain logged</span><div class="pain-grid">${
        w.pains.map((p) => `<span class="pain-chip" style="background:${heatColor(p.level)};color:#14171C;border-color:transparent;">${p.cat} <span class="sev">${p.level}</span></span>`).join("")
      }</div></div>`
    : "";

  return `<div class="app">
    ${header({ back: "history", backLabel: "History" })}
    <main>
      <div class="section-head"><span class="eyebrow">${w.routineName || "Workout"} · ${fmtDate(w.startedAt)}</span></div>
      <div class="detail-stat-row">
        <div class="dstat"><div class="v tnum" style="color:${w.feel ? heatColor(w.feel) : "var(--text)"}">${w.feel || "–"}</div><div class="k">Effort</div></div>
        <div class="dstat"><div class="v tnum">${w.entries.length}</div><div class="k">Exercises</div></div>
      </div>
      ${exHtml}
      ${painHtml}
      ${w.notes ? `<div class="finish-block"><span class="eyebrow" style="display:block;margin-bottom:8px;">Notes</span><div style="color:var(--muted);line-height:1.6;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px;">${w.notes.replace(/</g, "&lt;")}</div></div>` : ""}
    </main>
  </div>`;
}

/* ============ Event delegation ============ */
app.addEventListener("click", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) { return; }
  const act = t.dataset.act;
  const ei = t.dataset.ei !== undefined ? parseInt(t.dataset.ei, 10) : null;
  const si = t.dataset.si !== undefined ? parseInt(t.dataset.si, 10) : null;

  switch (act) {
    case "logout": window.location.href = "/logout"; break;
    case "history": go("history"); break;
    case "home": go("home"); break;
    case "active": go("active"); break;
    case "start-empty": startWorkout(null, t.dataset.date ? parseInt(t.dataset.date, 10) : undefined); break;
    case "start-routine": startWorkout(state.routines.find((r) => r.id === t.dataset.id), t.dataset.date ? parseInt(t.dataset.date, 10) : undefined); break;
    case "open-picker": state.picker = { q: "", cat: "All" }; go("picker"); break;
    case "open-finish": go("finish"); break;
    case "cancel":
      if (confirm("Discard this workout? Nothing will be saved.")) { cancelWorkout(); }
      break;
    case "pick": addExerciseToActive(t.dataset.id); break;
    case "set-cat": state.picker.cat = t.dataset.cat; render(); break;
    case "del-ex": delExercise(ei); break;
    case "inc": bumpField(ei, si, t.dataset.field, +1); break;
    case "dec": bumpField(ei, si, t.dataset.field, -1); break;
    case "ex-pain-toggle": toggleExPain(ei); break;
    case "ex-pain-cat": setExPainCat(ei, t.dataset.cat); break;
    case "ex-pain-level": setExPainLevel(ei, parseInt(t.dataset.v, 10)); break;
    case "ex-pain-clear": clearExPain(ei); break;
    case "ex-pain-new": {
      const c = addPainCategory(prompt("New pain area"));
      if (c) { setExPainCat(ei, c); }
      break;
    }
    case "ex-note-toggle": toggleExNote(ei); break;
    case "new-ex":
      state.picker.creating = true;
      state.picker.newName = state.picker.q || "";
      state.picker.newMuscle = "";
      render();
      break;
    case "close-create": state.picker.creating = false; render(); break;
    case "pick-muscle": state.picker.newMuscle = t.dataset.m; render(); break;
    case "create-ex": {
      const nm = (state.picker.newName || "").trim();
      if (!nm) { toast("Add a name first"); break; }
      createExercise(nm, state.picker.newMuscle);
      break;
    }
    case "feel": state.active.feel = parseInt(t.dataset.v, 10); save(); render(); break;
    case "energy": state.active.energy = parseInt(t.dataset.v, 10); save(); render(); break;
    case "finish-pain-cat": focusFinishPain(t.dataset.cat); break;
    case "finish-pain-level": setFinishPainLevel(parseInt(t.dataset.v, 10)); break;
    case "finish-pain-remove": removeFinishPain(); break;
    case "finish-pain-new": {
      const c = addPainCategory(prompt("New pain area"));
      if (c) { focusFinishPain(c); }
      break;
    }
    case "save": finishWorkout(); break;
    case "detail": state.detailId = t.dataset.id; go("detail"); break;
    case "cal-prev": calShift(-1); break;
    case "cal-next": calShift(+1); break;
    case "cal-day": state.detailId = t.dataset.id; go("detail"); break;
    case "cal-new": state.newDate = parseInt(t.dataset.date, 10); go("newday"); break;
  }
});

app.addEventListener("input", (e) => {
  const t = e.target.closest("[data-act]");
  if (!t) { return; }
  const act = t.dataset.act;
  if (act === "search") { state.picker.q = t.value; /* re-render list only, keep focus */ updatePickerList(); }
  else if (act === "notes") { state.active.notes = t.value; save(); }
  else if (act === "ex-note") { setExNote(parseInt(t.dataset.ei, 10), t.value); }
  else if (act === "new-name") { state.picker.newName = t.value; }
  else if (act === "new-muscle") { state.picker.newMuscle = t.value; }
  else if (act === "wdate" && t.value) {
    const [y, m, d] = t.value.split("-").map(Number);
    state.active.startedAt = new Date(y, m - 1, d, 12).getTime();
    state.active.manual = !isToday(state.active.startedAt);
    save();
  }
  else if (act === "setfield") {
    setField(parseInt(t.dataset.ei, 10), parseInt(t.dataset.si, 10), t.dataset.field, t.value);
  }
});

// Re-render picker list in place so the search input keeps focus while typing.
function updatePickerList() {
  if (state.view !== "picker" || state.picker.creating) { return; }
  const main = app.querySelector("main");
  main.querySelectorAll(".ex-pick, .empty").forEach((n) => n.remove());
  const list = pickerExercises();
  const frag = document.createElement("div");
  frag.innerHTML = list.length ? list.map(pickerItemHtml).join("") : `<div class="empty">No exercises yet — add one.</div>`;
  while (frag.firstChild) { main.appendChild(frag.firstChild); }
}

/* ============ Boot ============ */
async function boot() {
  if (state.view === "active" && !state.active) { state.view = "home"; }
  render(); // paint immediately from draft (offline-friendly)
  try {
    const data = await apiGet("/api/data");
    state.exercises = data.exercises;
    state.painCategories = data.painCategories;
    state.workouts = data.workouts;
    render();
  } catch (e) {
    toast("Offline — showing cached view");
  }
}
boot();

export {}; // mark as a module (side-effect import from +page.svelte)
