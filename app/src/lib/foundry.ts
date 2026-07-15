// @ts-nocheck
import { pushState, replaceState } from '$app/navigation';
import { page } from '$app/stores';
// Ported from the POC. Server holds the source of truth (exercises, pain
// categories, workouts); localStorage only keeps a draft of the in-progress
// session + current view so an accidental refresh at the gym isn't lost.

/* ============ Constants ============ */
const STORAGE_KEY = "foundry_draft";
const WEIGHT_STEP = 2.5;
const TIME_STEP = 5;       // seconds, for the "sec" load unit
const REPS_STEP = 1;
const DURATION_STEP = 1;   // minutes
const DISTANCE_STEP = 0.5; // km
const RPE_MIN = 1;
const RPE_MAX = 10;

const PAIN_MAX = 10;
const DEFAULT_PAIN_LEVEL = 5;
const SEED_PAIN_CATEGORIES = ["Lower back", "Knees", "Shoulders", "Elbows", "Wrists", "Hips", "Neck"];

// Walk logs time + a pace instead of manual distance; distance is estimated.
const PACED_CARDIO = ["walk"];
const WALK_SPEEDS = { normal: 5, fast: 6.5 }; // km/h
const DEFAULT_STRENGTH_SET = { reps: 8, weight: 20 };

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
    muscleGroups: SUGGESTED_MUSCLES.slice(),
    workouts: [],
    workoutThemes: [],
    templates: [],
    programs: [],
    notes: [],
    foods: [],
    meals: [],
    profile: { dob: null, height: null, gender: null, targets: { kcal: null, protein: null, carbs: null, fat: null } },
    bodyWeights: [],
    albums: [],
    photos: [],
    active: draft.active || null,
    view: draft.view || "home",
    picker: draft.picker || { q: "", cat: "All" },
    cal: draft.cal || currentMonth(),
    newDate: draft.newDate || null,
    detailId: draft.detailId || null,
    albumId: draft.albumId || null,
    nutritionDay: draft.nutritionDay || null,
    dayLog: null,
    photoTag: null,
    loaded: false,
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

async function apiDelete(url, body) {
  const r = await fetch(url, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { throw new Error("DELETE " + url + " -> " + r.status); }
  return r.json();
}

async function apiPut(url, body) {
  const r = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) { throw new Error("PUT " + url + " -> " + r.status); }
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
      albumId: state.albumId,
      nutritionDay: state.nutritionDay,
    }));
  } catch (e) { /* storage full / unavailable */ }
}

function uid() { return Math.random().toString(36).slice(2, 9); }
function exById(id) {
  return state.exercises.find((e) => e.id === id) || { id, name: "Unknown", type: "strength", muscles: [], bodyweight: false, unit: "kg" };
}

// Label for an exercise's load field (the second stepper on a set).
function loadUnit(ex) { return ex.unit === "sec" ? "sec" : "kg"; }

// Accordion: exactly one exercise expanded at a time keeps the active list dense.
function setOnlyExpanded(idx) {
  state.active.entries.forEach((en, i) => { en.expanded = i === idx; });
}
function toggleExpand(entryIdx) {
  const en = state.active.entries[entryIdx];
  if (en.expanded) { en.expanded = false; } else { setOnlyExpanded(entryIdx); }
  save();
  render();
}

function isPaced(ex) { return PACED_CARDIO.includes(ex.id); }

// Estimated walk distance (km) from minutes at the chosen pace.
function walkDistance(duration, pace) {
  const kmh = WALK_SPEEDS[pace] || WALK_SPEEDS.normal;
  return Math.round((duration / 60) * kmh * 10) / 10;
}

// Timestamp of the most recent workout containing an exercise (0 = never used).
function lastUsedAt(id) {
  for (let i = state.workouts.length - 1; i >= 0; i--) {
    if (state.workouts[i].entries.some((en) => en.exerciseId === id)) { return state.workouts[i].startedAt; }
  }
  return 0;
}

// Tags (muscle groups) actually used across the gym library, for the filter row.
function uniqueMuscles() {
  const out = [];
  state.exercises.filter((e) => e.type !== "cardio").forEach((e) => {
    (e.muscles || []).forEach((m) => { if (m && !out.includes(m)) { out.push(m); } });
  });
  return out.sort();
}

// The reusable tag "data bank" (seeded + everything the user has created).
function tagBank() {
  const out = state.muscleGroups.slice();
  uniqueMuscles().forEach((m) => { if (!out.includes(m)) { out.push(m); } });
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
// Strength = a checklist that can optionally carry weight+reps sets.
// Cardio = one set: paced walk (duration + pace) or duration + distance.
function newEntry(ex) {
  if (ex.type === "cardio") {
    const last = lastSetFor(ex.id);
    if (isPaced(ex)) {
      const duration = last ? last.duration : 30;
      const pace = (last && last.pace) || "normal";
      return { exerciseId: ex.id, sets: [{ duration, pace, distance: walkDistance(duration, pace) }] };
    }
    const seed = last ? { duration: last.duration, distance: last.distance } : blankSet("cardio");
    return { exerciseId: ex.id, sets: [{ duration: seed.duration, distance: seed.distance }] };
  }
  return { exerciseId: ex.id, sets: [] };
}

// Clone an entry's sets as starting values for a new session ("repeat"), dropping
// per-session state (pain, notes).
function cloneEntryForRepeat(entry) {
  return { exerciseId: entry.exerciseId, sets: (entry.sets || []).map((s) => ({ ...s })) };
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
  if (entries.length) { setOnlyExpanded(entries.length - 1); }
  go("active");
}

// Start a new session today, pre-filled from a past workout's exercises + sets.
function repeatWorkout(w) {
  state.active = {
    id: uid(),
    startedAt: Date.now(),
    manual: false,
    routineName: w.routineName,
    entries: w.entries.map(cloneEntryForRepeat),
    feel: null,
    energy: null,
    pains: {},
    notes: "",
  };
  if (state.active.entries.length) { setOnlyExpanded(state.active.entries.length - 1); }
  go("active");
  toast("Copied — adjust and finish");
}

function addExerciseToActive(id) {
  state.active.entries.push(newEntry(exById(id)));
  setOnlyExpanded(state.active.entries.length - 1);
  save();
  history.back();   // pop the picker off the stack, back to the workout
}

// Move a saved workout to a different day (edit its date from the detail screen).
async function changeWorkoutDate(id, startedAt) {
  const w = state.workouts.find((x) => x.id === id);
  if (!w) { return; }
  w.startedAt = startedAt;                 // optimistic
  state.workouts.sort((a, b) => a.startedAt - b.startedAt);
  render();
  try {
    await apiPut("/api/workouts", { id, startedAt });
    toast("Date updated ✓");
  } catch (e) {
    toast("Couldn't update date");
  }
}

/* ---- Templates ---- */
// Start a session prefilled from a template: each exercise gets `setCount` sets
// seeded with the template's default reps/weight (weight dropped for bodyweight).
function startFromTemplate(t, ts) {
  if (!t) { return; }
  const backdated = ts && !isToday(ts);
  const entries = t.entries.map((te) => {
    const ex = exById(te.exerciseId);
    const count = Math.max(1, te.setCount || 1);
    const sets = [];
    for (let i = 0; i < count; i++) {
      const s = { reps: te.reps != null ? te.reps : DEFAULT_STRENGTH_SET.reps };
      if (!ex.bodyweight) { s.weight = te.weight != null ? te.weight : DEFAULT_STRENGTH_SET.weight; }
      sets.push(s);
    }
    return { exerciseId: te.exerciseId, sets };
  });
  state.active = {
    id: uid(),
    startedAt: backdated ? ts : Date.now(),
    manual: !!backdated,
    routineName: t.name,
    entries,
    feel: null,
    energy: null,
    pains: {},
    notes: "",
  };
  if (entries.length) { setOnlyExpanded(entries.length - 1); }
  go("active");
  toast("Template loaded — adjust and finish");
}

function newTemplate() {
  state.templateEdit = { id: null, name: "", icon: "", entries: [] };
  go("tpledit");
}

function editTemplate(id) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) { return; }
  state.templateEdit = {
    id: t.id,
    name: t.name,
    icon: t.icon || "",
    entries: t.entries.map((e) => ({ ...e })),
  };
  go("tpledit");
}

// Build a template draft from the sets the user actually logged in a workout.
function templateEntriesFromWorkout(w) {
  return w.entries
    .filter((en) => exById(en.exerciseId).type !== "cardio")
    .map((en) => {
      const sets = en.sets || [];
      const first = sets[0] || {};
      return {
        exerciseId: en.exerciseId,
        setCount: sets.length || 1,
        reps: first.reps != null ? first.reps : DEFAULT_STRENGTH_SET.reps,
        weight: first.weight != null ? first.weight : null,
      };
    });
}

function saveActiveAsTemplate() {
  const w = state.active;
  if (!w) { return; }
  const entries = templateEntriesFromWorkout(w);
  if (!entries.length) { toast("Add a gym exercise first"); return; }
  state.templateEdit = { id: null, name: w.routineName && w.routineName !== "Workout" ? w.routineName : "", icon: "", entries };
  state.templateReturn = "active";
  go("tpledit");
}

function addExerciseToTemplate(id) {
  const ex = exById(id);
  const last = lastSetFor(id);
  state.templateEdit.entries.push({
    exerciseId: id,
    setCount: 3,
    reps: last && last.reps != null ? last.reps : DEFAULT_STRENGTH_SET.reps,
    weight: ex.bodyweight ? null : (last && last.weight != null ? last.weight : DEFAULT_STRENGTH_SET.weight),
  });
  history.back();   // pop the picker, back to the template editor
}

function delTplEntry(idx) {
  state.templateEdit.entries.splice(idx, 1);
  render();
}

function bumpTplField(idx, field, dir) {
  const e = state.templateEdit.entries[idx];
  const step = field === "weight" ? WEIGHT_STEP : 1;
  const v = (e[field] || 0) + dir * step;
  e[field] = Math.max(field === "setCount" ? 1 : 0, Math.round(v * 100) / 100);
  render();
}

function setTplField(idx, field, value) {
  const e = state.templateEdit.entries[idx];
  const n = parseFloat(value);
  e[field] = isNaN(n) ? (field === "setCount" ? 1 : 0) : Math.max(field === "setCount" ? 1 : 0, n);
}

async function saveTemplateEdit() {
  const te = state.templateEdit;
  const name = (te.name || "").trim();
  if (!name) { toast("Name the template first"); return; }
  if (!te.entries.length) { toast("Add at least one exercise"); return; }
  let saved;
  try {
    saved = await apiPost("/api/templates", {
      id: te.id || undefined,
      name,
      icon: te.icon || null,
      entries: te.entries,
    });
  } catch (e) { toast("Couldn't save template"); return; }
  const i = state.templates.findIndex((x) => x.id === saved.id);
  if (i >= 0) { state.templates[i] = saved; } else { state.templates.push(saved); }
  state.templateReturn = null;
  state.templateEdit = null;
  history.back();   // pop the editor, back to where it was opened from
  toast(te.id ? "Template updated" : "Template saved ✓");
}

function deleteTemplateById(id) {
  apiDelete("/api/templates", { id }).catch(() => {});
  state.templates = state.templates.filter((t) => t.id !== id);
  render();
}

/* ---- Strength sets (weight + reps, carried over) ---- */
function addSet(entryIdx) {
  const entry = state.active.entries[entryIdx];
  const bw = exById(entry.exerciseId).bodyweight;
  const prev = entry.sets[entry.sets.length - 1];
  let s;
  if (prev) {
    s = { reps: prev.reps };
    if (!bw) { s.weight = prev.weight; }
  } else {
    const last = lastSetFor(entry.exerciseId);
    const reps = last && last.reps != null ? last.reps : DEFAULT_STRENGTH_SET.reps;
    s = { reps };
    if (!bw) { s.weight = last && last.weight != null ? last.weight : DEFAULT_STRENGTH_SET.weight; }
  }
  entry.sets.push(s);
  save();
  render();
}

function delSet(entryIdx, setIdx) {
  state.active.entries[entryIdx].sets.splice(setIdx, 1);
  save();
  render();
}

/* ---- Walk pace ---- */
function setPace(entryIdx, pace) {
  const s = state.active.entries[entryIdx].sets[0];
  s.pace = pace;
  s.distance = walkDistance(s.duration, pace);
  save();
  render();
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

/* ---- Workout theme (a reusable "Shoulders" / "Knee rehab" label) ---- */
function addWorkoutTheme(name) {
  const n = (name || "").trim();
  if (!n) { return null; }
  if (!state.workoutThemes.includes(n)) {
    state.workoutThemes.push(n);
    state.workoutThemes.sort((a, b) => a.localeCompare(b));
    apiPost("/api/workout-themes", { name: n }).catch(() => {});
  }
  return n;
}
function setActiveTheme(theme) {
  const w = state.active;
  w.theme = w.theme === theme ? null : theme;
  save();
  render();
}
function openFinishThemeNew() { state.active.themeNewOpen = true; render(); }
function addFinishThemeNew() {
  const w = state.active;
  const th = addWorkoutTheme(w.themeNewText);
  w.themeNewOpen = false;
  w.themeNewText = "";
  if (th) { w.theme = th; }
  save();
  render();
}
// Editing an existing workout's theme from the detail screen.
async function changeWorkoutTheme(id, theme) {
  const w = state.workouts.find((x) => x.id === id);
  if (!w) { return; }
  const next = w.theme === theme ? null : theme;
  if (theme) { addWorkoutTheme(theme); }
  w.theme = next;
  render();
  try { await apiPut("/api/workouts", { id, theme: next }); toast("Theme updated ✓"); }
  catch (e) { toast("Couldn't update theme"); }
}
function openDetailThemeNew() { state.detailThemeNewOpen = true; render(); }
function addDetailThemeNew(id) {
  const th = addWorkoutTheme(state.detailThemeNewText);
  state.detailThemeNewOpen = false;
  state.detailThemeNewText = "";
  if (th) { changeWorkoutTheme(id, th); } else { render(); }
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
  const entry = state.active.entries[entryIdx];
  entry.pain = null;
  entry.painOpen = false;
  save();
  render();
}

/* Inline "new pain area" (replaces the old prompt() dialog) — per exercise */
function openExPainNew(entryIdx) {
  state.active.entries[entryIdx].painNewOpen = true;
  render();
}
function addExPainNew(entryIdx) {
  const entry = state.active.entries[entryIdx];
  const c = addPainCategory(entry.painNewText);
  entry.painNewOpen = false;
  entry.painNewText = "";
  if (c) { setExPainCat(entryIdx, c); } else { render(); }
}

/* Inline "new pain area" — finish screen */
function openFinishPainNew() {
  state.active.painNewOpen = true;
  render();
}
function addFinishPainNew() {
  const w = state.active;
  const c = addPainCategory(w.painNewText);
  w.painNewOpen = false;
  w.painNewText = "";
  if (c) { focusFinishPain(c); } else { render(); }
}

/* ---- Custom exercises (create + edit) ---- */
// Open the shared exercise form. exId = null → create; otherwise edit that exercise.
function openExerciseForm(exId) {
  const ex = exId ? exById(exId) : null;
  state.picker = state.picker || {};
  state.picker.creating = true;
  state.picker.editingId = exId || null;
  // Editing is reached from the active workout; creating from the picker.
  state.picker.editReturn = exId ? "active" : "picker";
  state.picker.newName = ex ? ex.name : (state.picker.q || "");
  state.picker.newTags = ex ? (ex.muscles || []).slice() : [];
  state.picker.newTagText = "";
  state.picker.newBodyweight = ex ? !!ex.bodyweight : false;
  state.picker.newUnit = ex ? loadUnit(ex) : "kg";
  state.picker.newImage = ex ? (ex.image || null) : null;
  state.picker.imageBusy = false;
  go("picker"); // the form renders inside the picker view
}

// Upload an image for the exercise being created/edited (downscaled first).
async function onExerciseImage(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) { return; }
  state.picker.imageBusy = true; render();
  try {
    const blob = await downscale(file);
    const fd = new FormData();
    fd.append("file", blob, "image.jpg");
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    if (!r.ok) { throw new Error("upload failed"); }
    const out = await r.json();
    state.picker.newImage = out.filename;
  } catch (e) { toast("Image upload failed"); }
  state.picker.imageBusy = false; render();
}

function toggleNewTag(tag) {
  const tags = state.picker.newTags;
  const i = tags.indexOf(tag);
  if (i >= 0) { tags.splice(i, 1); } else { tags.push(tag); }
  render();
}

// Add a brand-new tag to the bank and select it.
function addNewTag(name) {
  const n = (name || "").trim();
  if (!n) { return; }
  if (!state.muscleGroups.includes(n)) {
    state.muscleGroups.push(n);
    apiPost("/api/muscle-groups", { name: n }).catch(() => {});
  }
  if (!state.picker.newTags.includes(n)) { state.picker.newTags.push(n); }
  state.picker.newTagText = "";
  render();
}

async function saveExercise() {
  const name = (state.picker.newName || "").trim();
  if (!name) { toast("Add a name first"); return; }
  const tags = state.picker.newTags.slice();
  const editingId = state.picker.editingId;
  let ex;
  try {
    ex = await apiPost("/api/exercises", {
      id: editingId || undefined,
      name,
      muscles: tags,
      bodyweight: !!state.picker.newBodyweight,
      unit: state.picker.newUnit || "kg",
      image: state.picker.newImage || null,
    });
  } catch (e) {
    toast("Couldn't save exercise");
    return;
  }
  if (editingId) {
    const i = state.exercises.findIndex((e) => e.id === editingId);
    if (i >= 0) { state.exercises[i] = ex; }
  } else {
    state.exercises.push(ex);
  }
  const wasEditing = !!editingId;
  const target = state.picker.target;
  state.picker.creating = false;
  state.picker.editingId = null;
  state.picker.newName = "";
  state.picker.newTags = [];
  // Editing came from the active workout (pop back to it); creating adds the new
  // exercise to wherever the picker was opened from (active workout / template).
  if (wasEditing) { history.back(); }
  else if (target === "template") { addExerciseToTemplate(ex.id); }
  else { addExerciseToActive(ex.id); }
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
  const entry = state.active.entries[entryIdx];
  const set = entry.sets[setIdx];
  const weightStep = loadUnit(exById(entry.exerciseId)) === "sec" ? TIME_STEP : WEIGHT_STEP;
  const steps = { reps: REPS_STEP, weight: weightStep, duration: DURATION_STEP, distance: DISTANCE_STEP };
  const v = (set[field] || 0) + dir * steps[field];
  set[field] = Math.max(0, Math.round(v * 100) / 100);
  if (field === "duration" && isPaced(exById(entry.exerciseId))) {
    set.distance = walkDistance(set.duration, set.pace);
  }
  save();
  render();
}

function setField(entryIdx, setIdx, field, value) {
  const entry = state.active.entries[entryIdx];
  const set = entry.sets[setIdx];
  const n = parseFloat(value);
  set[field] = isNaN(n) ? 0 : Math.max(0, n);
  if (field === "duration" && isPaced(exById(entry.exerciseId))) {
    set.distance = walkDistance(set.duration, set.pace);
  }
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
    theme: w.theme || null,
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
  const changed = view !== state.view;
  state.view = view;
  closeDrawer();
  save();
  if (changed) { pushState("", { v: view }); }  // SvelteKit shallow routing → phone Back walks the stack
  render();
  window.scrollTo(0, 0);
}

// Close the top-most open overlay (drawer/sheet/modal). Returns true if it closed
// one — used so the phone Back button dismisses overlays before navigating.
function closeTopOverlay() {
  if (state.viewPhotoId) { state.viewPhotoId = null; render(); return true; }
  if (state.pendingUpload) { cancelUpload(); return true; }
  if (state.confirm) { state.confirm = null; render(); return true; }
  if (state.entryEdit) { state.entryEdit = null; render(); return true; }
  if (state.targetEdit) { state.targetEdit = null; render(); return true; }
  if (drawerIsOpen()) { closeDrawer(); return true; }
  return false;
}

/* ============ Render ============ */
const app = document.getElementById("app");
let prevView = null;

function render() {
  let html = "";
  if (state.view === "home") { html = viewHome(); }
  else if (state.view === "choose") { html = viewChoose(); }
  else if (state.view === "active") { html = viewActive(); }
  else if (state.view === "picker") { html = viewPicker(); }
  else if (state.view === "finish") { html = viewFinish(); }
  else if (state.view === "history") { html = viewHistory(); }
  else if (state.view === "detail") { html = viewDetail(); }
  else if (state.view === "profile") { html = viewProfile(); }
  else if (state.view === "photos") { html = viewPhotos(); }
  else if (state.view === "album") { html = viewAlbum(); }
  else if (state.view === "templates") { html = viewTemplates(); }
  else if (state.view === "tpledit") { html = viewTemplateEdit(); }
  else if (state.view === "nutrition") { html = viewNutrition(); }
  else if (state.view === "addfood") { html = viewAddFood(); }
  else if (state.view === "foodedit") { html = viewFoodEdit(); }
  else if (state.view === "mealedit") { html = viewMealEdit(); }
  else if (state.view === "programs") { html = viewPrograms(); }
  else if (state.view === "program") { html = viewProgram(); }
  else if (state.view === "progedit") { html = viewProgramEdit(); }
  else if (state.view === "notes") { html = viewNotes(); }
  else if (state.view === "noteedit") { html = viewNoteEdit(); }
  else if (state.view === "exinfo") { html = viewExInfo(); }
  app.innerHTML = html + overlays();
  // Play the entrance animation only when the view actually changes, so
  // in-place updates (adding a set, toggling pain) don't re-animate everything.
  if (state.view !== prevView && app.firstElementChild) {
    app.firstElementChild.classList.add("view-enter");
    prevView = state.view;
  }
  if (state.view === "profile") { drawWeightChart(); }
  if (state.view === "program") { renderProgramPdf(); }
}

function header(opts) {
  // Top-level screens (no back) show the drawer hamburger on the left; subviews
  // show a Back button that pops the history stack (data-act nav-back). The
  // exercise form is a special case that passes its own back act.
  const left = opts.back
    ? `<button class="back-btn" data-act="${opts.backAct || "nav-back"}">‹ ${opts.backLabel || "Back"}</button>`
    : `<button class="iconbtn hamburger" data-act="menu-toggle" aria-label="Menu">☰</button>${opts.title ? `<span class="bar-title">${opts.title}</span>` : ""}`;
  let right = "";
  if (opts.dateLabel) {
    right = `<div class="timer">📅 ${opts.dateLabel}</div>`;
  } else if (opts.action) {
    right = opts.action;
  }
  return `<header class="bar">${left}<div class="spacer"></div>${right}</header>`;
}

// Persistent slide-in navigation drawer (from the left). Lives on <body> so it
// survives re-renders and can follow the finger during a swipe. Opened by the
// hamburger or an edge swipe; closed by tapping the scrim, swiping left, or Back.
let drawerEl = null;
function drawerIsOpen() { return !!drawerEl && drawerEl.classList.contains("open"); }
function openDrawer() { if (drawerEl) { drawerEl.classList.add("open"); } }
function closeDrawer() { if (drawerEl) { drawerEl.classList.remove("open"); } }
function toggleDrawer() { drawerIsOpen() ? closeDrawer() : openDrawer(); }

function buildDrawer() {
  const root = document.createElement("div");
  root.className = "drawer-root";
  const item = (nav, icon, label) => `<button class="menu-item" data-nav="${nav}"><span class="menu-ico">${icon}</span>${label}</button>`;
  root.innerHTML = `<div class="drawer-scrim" data-dw="close"></div>
    <nav class="drawer-panel">
      <div class="drawer-head eyebrow">Foundry</div>
      ${item("home", "\u{1F3E0}", "Home")}
      ${item("nutrition", "\u{1F34E}", "Nutrition")}
      ${item("history", "\u{1F4D6}", "History")}
      ${item("notes", "\u{1F4DD}", "Notes")}
      ${item("programs", "\u{1FA79}", "Programs")}
      ${item("photos", "\u{1F5BC}️", "Photos")}
      ${item("profile", "\u{1F464}", "Profile")}
      <div class="menu-sep"></div>
      ${item("logout", "⏻", "Sign out")}
    </nav>`;
  document.body.appendChild(root);
  root.addEventListener("click", (e) => {
    const b = e.target.closest("[data-nav]");
    if (!b) {
      if (e.target.closest('[data-dw="close"]')) { closeDrawer(); }
      return;
    }
    closeDrawer();
    const nav = b.dataset.nav;
    if (nav === "logout") {
      state.confirm = { title: "Sign out?", body: "You'll be logged out of Foundry.", ok: "Sign out", danger: true, onOk: () => { window.location.href = "/logout"; } };
      render();
    } else if (nav === "nutrition") { openNutrition(); }
    else if (nav === "programs") { openPrograms(); }
    else if (nav === "notes") { openNotes(); }
    else if (nav === "photos") { state.photoTag = null; go("photos"); }
    else { go(nav); }
  });
  drawerEl = root;
}

// Generic centered confirmation dialog.
function confirmModal() {
  const c = state.confirm;
  if (!c) { return ""; }
  return `<div class="modal-scrim" data-act="confirm-cancel">
    <div class="modal" data-act="noop">
      <div class="modal-title">${escAttr(c.title)}</div>
      ${c.body ? `<div class="modal-body">${escAttr(c.body)}</div>` : ""}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-act="confirm-cancel">${escAttr(c.cancel || "Cancel")}</button>
        <button class="btn ${c.danger ? "btn-danger" : "btn-primary"}" data-act="confirm-ok">${escAttr(c.ok || "OK")}</button>
      </div>
    </div>
  </div>`;
}

// Global overlays layered on top of whatever view is showing. (The nav drawer is
// a persistent element on <body>, managed outside render() for smooth gestures.)
function overlays() {
  return confirmModal() + entryEditSheet() + targetsSheet();
}

/* ---- Home ---- */
function viewHome() {
  const recent = state.workouts.slice(-3).reverse();

  const recentHtml = recent.length
    ? recent.map(historyCard).join("")
    : `<div class="empty">No workouts yet.</div>`;

  const today = new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

  return `<div class="app">
    ${header({ title: today })}
    <main>
      ${calendarWidget()}

      <div class="section-head">
        <span class="eyebrow">Recent</span>
        ${state.workouts.length > 3 ? `<button class="back-btn" data-act="history">All ›</button>` : ""}
      </div>
      ${recentHtml}
    </main>
    <div class="footer">
      <button class="btn btn-primary btn-lg" data-act="add-workout">+  Add workout</button>
    </div>
  </div>`;
}

// Chooser reached from "Add workout" (today) or tapping an empty calendar day
// (backdated — state.newDate holds the chosen day). Lists templates first, then
// the basic activity types.
function viewChoose() {
  const ts = state.newDate;                       // null → today
  const dateAttr = ts ? ` data-date="${ts}"` : "";
  const label = ts
    ? new Date(ts).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    : "Today";

  const tplHtml = state.templates.length
    ? `<div class="section-head"><span class="eyebrow">Templates</span>
        <button class="back-btn" data-act="templates">Manage ›</button></div>
       <div class="tpl-list">${state.templates.map((t) => templateChooseCard(t, dateAttr)).join("")}</div>`
    : `<div class="section-head"><span class="eyebrow">Templates</span>
        <button class="back-btn" data-act="new-template">+ New ›</button></div>
       <div class="empty" style="padding:22px;">No templates yet — build one for one-tap gym days.</div>`;

  const basicsHtml = state.routines.map((r) =>
    `<button class="routine" data-act="start-routine" data-id="${r.id}"${dateAttr}>
      <span class="r-icon">${r.icon}</span>
      <span class="r-name">${r.name}</span>
    </button>`
  ).join("");

  return `<div class="app">
    ${header({ back: true, backLabel: "Home" })}
    <main>
      <div class="section-head"><span class="eyebrow">Add workout · ${label}</span></div>
      ${tplHtml}
      <div class="section-head"><span class="eyebrow">Basics</span></div>
      <div class="routines">${basicsHtml}</div>
    </main>
    <div class="footer">
      <button class="btn btn-primary btn-lg" data-act="start-empty"${dateAttr}>+  Empty workout</button>
    </div>
  </div>`;
}

function templateChooseCard(t, dateAttr) {
  const n = t.entries.length;
  return `<button class="tpl-card" data-act="start-template" data-id="${t.id}"${dateAttr}>
    <span class="tpl-ico">${t.icon || "\u{1F4CB}"}</span>
    <span class="tpl-body">
      <span class="tpl-name">${escAttr(t.name)}</span>
      <span class="tpl-meta">${n} exercise${n !== 1 ? "s" : ""}</span>
    </span>
    <span class="tpl-go">›</span>
  </button>`;
}

/* ---- Templates manager ---- */
function viewTemplates() {
  const list = state.templates.map((t) => {
    const n = t.entries.length;
    const preview = t.entries.slice(0, 4).map((e) => escAttr(exById(e.exerciseId).name)).join(" · ");
    return `<div class="tpl-card tpl-manage">
      <button class="tpl-open" data-act="edit-template" data-id="${t.id}">
        <span class="tpl-ico">${t.icon || "\u{1F4CB}"}</span>
        <span class="tpl-body">
          <span class="tpl-name">${escAttr(t.name)}</span>
          <span class="tpl-meta">${n} exercise${n !== 1 ? "s" : ""}${preview ? " · " + preview : ""}</span>
        </span>
      </button>
      <button class="tpl-del" data-act="del-template" data-id="${t.id}" aria-label="Delete template">×</button>
    </div>`;
  }).join("");

  const body = state.templates.length
    ? `<div class="tpl-list">${list}</div>`
    : `<div class="empty">No templates yet. Build one, then start it in a tap from “Add workout”.</div>`;

  return `<div class="app">
    ${header({ back: true, backLabel: "Home" })}
    <main>
      <div class="section-head"><span class="eyebrow">Templates</span></div>
      ${body}
      <button class="add-ex-btn" data-act="new-template" style="margin-top:14px;">+  New template</button>
    </main>
  </div>`;
}

/* ---- Template editor ---- */
function viewTemplateEdit() {
  const te = state.templateEdit;
  if (!te) { go("templates"); return ""; }

  const rows = te.entries.map((e, i) => {
    const ex = exById(e.exerciseId);
    const tags = (ex.muscles || []).length
      ? `<span class="ex-tags">${ex.muscles.map((m) => `<span class="ex-tag">${escAttr(m)}</span>`).join("")}</span>`
      : "";
    const unit = loadUnit(ex);
    return `<div class="ex-card expanded">
      <div class="ex-head">
        <span class="ex-name">${escAttr(ex.name)}</span>${tags}
        <button class="ex-del" data-act="del-tpl-entry" data-i="${i}" aria-label="Remove">×</button>
      </div>
      <div class="set-row"><div class="set-fields">
        ${tplStepper(i, "setCount", e.setCount || 1, "sets")}
        ${tplStepper(i, "reps", e.reps != null ? e.reps : DEFAULT_STRENGTH_SET.reps, "reps")}
        ${ex.bodyweight ? "" : tplStepper(i, "weight", e.weight != null ? e.weight : DEFAULT_STRENGTH_SET.weight, unit)}
      </div></div>
    </div>`;
  }).join("");

  const editing = !!te.id;
  return `<div class="app">
    ${header({ back: true, backLabel: state.templateReturn === "active" ? "Workout" : "Templates" })}
    <main>
      <div class="section-head"><span class="eyebrow">${editing ? "Edit template" : "New template"}</span></div>
      <div class="tpl-name-row">
        <input class="picker-search" style="margin:0;flex:0 0 3.2rem;text-align:center;" placeholder="🏋" value="${escAttr(te.icon || "")}" data-act="tpl-icon" maxlength="2" aria-label="Icon">
        <input class="picker-search" style="margin:0;flex:1;" placeholder="Template name" value="${escAttr(te.name || "")}" data-act="tpl-name" autofocus>
      </div>
      ${rows}
      <button class="add-ex-btn" data-act="add-tpl-ex" style="margin-top:12px;">+  Add exercise</button>
    </main>
    <div class="footer">
      <button class="btn btn-primary" data-act="save-template">${editing ? "Save template" : "Create template"}</button>
    </div>
  </div>`;
}

function tplStepper(i, field, value, label) {
  return `<div class="step-grp">
    <span class="lbl">${label}</span>
    <button class="step-btn" data-act="tpl-dec" data-i="${i}" data-field="${field}">−</button>
    <input class="step-val tnum" type="number" inputmode="decimal" value="${value}"
      data-act="tpl-setfield" data-i="${i}" data-field="${field}" aria-label="${label}">
    <button class="step-btn" data-act="tpl-inc" data-i="${i}" data-field="${field}">+</button>
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
  const title = w.theme || w.routineName || "Workout";
  const sub = w.theme && w.routineName ? `${w.routineName} · ` : "";
  return `<button class="hcard" data-act="detail" data-id="${w.id}">
    <div class="feel-badge tnum" style="${badgeStyle}">${feel || "–"}</div>
    <div class="h-body">
      <div class="h-title">${escAttr(title)}</div>
      <div class="h-meta">${sub}${fmtDate(w.startedAt)}${exStr}</div>
    </div>
    ${painCount ? `<span class="pain-flag">⚠ ${painCount}</span>` : ""}
  </button>`;
}

// ISO 8601 week number (weeks start Monday; week 1 contains the first Thursday).
function isoWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dow = (d.getDay() + 6) % 7;      // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow + 3);      // move to the Thursday of this week
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const ftDow = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - ftDow + 3);
  return 1 + Math.round((d - firstThursday) / (7 * 86400000));
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

  // Header: an empty corner (over the week-number column) + the weekday labels.
  let cells = `<div class="cal-wk cal-corner"></div>`;
  cells += ["M", "T", "W", "T", "F", "S", "S"].map((d) => `<div class="cal-dow">${d}</div>`).join("");

  const rows = Math.ceil((startDow + daysInMonth) / 7);
  for (let r = 0; r < rows; r++) {
    const rowFirstDay = 1 - startDow + r * 7;           // day-of-month at this row's Monday (may spill months)
    cells += `<div class="cal-wk">${isoWeek(new Date(year, month, rowFirstDay))}</div>`;
    for (let c = 0; c < 7; c++) {
      const day = rowFirstDay + c;
      if (day < 1 || day > daysInMonth) {
        cells += `<div class="cal-day blank"></div>`;
        continue;
      }
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
        <button class="discard-btn" data-act="cancel">Discard</button>
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
  const cardio = ex.type === "cardio";
  const pain = entry.pain;
  const hasNote = entry.note && entry.note.length;

  // --- Collapsed: one dense, tappable row (keeps the list compact) ---
  if (!entry.expanded) {
    const flags = `${pain ? `<span class="ec-flag" style="color:${heatColor(pain.level)}">⚠</span>` : ""}${hasNote ? `<span class="ec-flag">✎</span>` : ""}`;
    return `<div class="ex-card ec-row">
      <span class="drag-handle" data-drag data-ei="${ei}" aria-label="Drag to reorder">⠿</span>
      <button class="ex-collapsed" data-act="toggle-expand" data-ei="${ei}">
        <span class="ec-name">${ex.name}</span>
        <span class="ec-summary">${entrySummary(ex, entry)}</span>
        ${flags}
        <span class="ec-chev">›</span>
      </button>
    </div>`;
  }

  // --- Expanded: full editor ---
  let bodyRows = "";
  if (cardio && isPaced(ex)) {
    const s = entry.sets[0];
    const seg = (key, label) =>
      `<button class="seg-btn ${s.pace === key ? "active" : ""}" data-act="pace" data-ei="${ei}" data-pace="${key}">${label}</button>`;
    bodyRows = `<div class="cardio-paced">
      <div class="big-stepper">
        <button class="big-step" data-act="dec" data-ei="${ei}" data-si="0" data-field="duration" aria-label="Less time">−</button>
        <div class="big-val">
          <input class="big-val-input tnum" type="number" inputmode="numeric" value="${s.duration}" data-act="setfield" data-ei="${ei}" data-si="0" data-field="duration" aria-label="Minutes">
          <span class="big-unit">min</span>
        </div>
        <button class="big-step" data-act="inc" data-ei="${ei}" data-si="0" data-field="duration" aria-label="More time">+</button>
      </div>
      <div class="seg">${seg("normal", "Normal")}${seg("fast", "Fast")}</div>
      <div class="est-dist">≈ ${s.distance} km</div>
    </div>`;
  } else if (cardio) {
    const s = entry.sets[0];
    bodyRows = `<div class="set-row"><div class="set-fields">
      ${stepper(ei, 0, "duration", s.duration, "min")}
      ${stepper(ei, 0, "distance", s.distance, "km")}
    </div></div>`;
  } else {
    // Strength: optional sets. Bodyweight = reps only; else reps + load (kg/sec).
    const unit = loadUnit(ex);
    const setRows = entry.sets.map((s, si) => `<div class="set-row">
      <span class="set-num tnum">${si + 1}</span>
      <div class="set-fields">
        ${stepper(ei, si, "reps", s.reps, "reps")}
        ${ex.bodyweight ? "" : stepper(ei, si, "weight", s.weight, unit)}
      </div>
      <button class="set-del" data-act="del-set" data-ei="${ei}" data-si="${si}" aria-label="Remove set">×</button>
    </div>`).join("");
    bodyRows = `${setRows}<button class="addset" data-act="add-set" data-ei="${ei}">+ Add set</button>`;
  }

  const tagsHtml = (ex.muscles || []).length
    ? `<span class="ex-tags">${ex.muscles.map((m) => `<span class="ex-tag">${m}</span>`).join("")}</span>`
    : "";
  // Hide a cardio name that just mirrors the routine title (e.g. "Walk").
  const showName = !(cardio && ex.name === state.active.routineName);
  const nameHtml = !showName
    ? `<span class="ex-name" style="color:var(--muted-2);font-weight:600;">Session</span>`
    : cardio
      ? `<span class="ex-name">${ex.name}</span>${tagsHtml}`
      : `<button class="ex-name ex-name-edit" data-act="edit-ex" data-id="${ex.id}">${ex.name} <span class="edit-hint">✎</span></button>${tagsHtml}`;
  const headHtml = `<div class="ex-head">
      <span class="drag-handle" data-drag data-ei="${ei}" aria-label="Drag to reorder">⠿</span>
      <button class="ec-chev open" data-act="toggle-expand" data-ei="${ei}" aria-label="Collapse">›</button>
      ${nameHtml}
      <button class="ex-del" data-act="del-ex" data-ei="${ei}" aria-label="Remove exercise">×</button>
    </div>`;

  // --- Pain (collapsible) ---
  const painStyle = pain ? `background:${heatColor(pain.level)};color:#14171C;border-color:transparent;` : "";
  const painLabel = pain ? `${pain.cat} ${pain.level}` : "Pain";
  let painEditHtml = "";
  if (entry.painOpen) {
    const catChips = state.painCategories.map((c) =>
      `<button class="chip ${pain && pain.cat === c ? "active" : ""}" data-act="ex-pain-cat" data-ei="${ei}" data-cat="${escAttr(c)}">${c}</button>`
    ).join("");
    const newHtml = entry.painNewOpen
      ? inlineNewField("ex-pain-new-text", "ex-pain-new-add", ei, entry.painNewText || "", "New area…")
      : `<button class="chip" data-act="ex-pain-new" data-ei="${ei}">+ New</button>`;
    painEditHtml = `<div class="pain-edit">
      <div class="chip-row">${catChips}${newHtml}</div>
      ${pain ? `<div class="rpe-scale">${levelBtns("ex-pain-level", ei, pain.level)}</div>
        <button class="text-btn" data-act="ex-pain-clear" data-ei="${ei}">Clear pain</button>` : ""}
    </div>`;
  }

  const noteOpen = entry.noteOpen || hasNote;
  const noteHtml = noteOpen
    ? `<div class="ex-note-wrap"><input class="ex-note" data-act="ex-note" data-ei="${ei}" value="${escAttr(entry.note || "")}"></div>`
    : "";

  return `<div class="ex-card expanded">
    ${headHtml}
    ${bodyRows}
    <div class="ex-actions">
      <button class="mini-chip ${entry.painOpen && !pain ? "active" : ""}" data-act="ex-pain-toggle" data-ei="${ei}" style="${painStyle}">⚠ ${painLabel}</button>
      <button class="mini-chip ${noteOpen ? "active" : ""}" data-act="ex-note-toggle" data-ei="${ei}">✎ Note</button>
    </div>
    ${painEditHtml}
    ${noteHtml}
  </div>`;
}

// A compact inline "type a name + Add" field (replaces prompt()).
function inlineNewField(inputAct, addAct, ei, value, placeholder) {
  const eiAttr = ei === null ? "" : ` data-ei="${ei}"`;
  return `<span class="inline-new">
    <input class="inline-new-input" data-act="${inputAct}"${eiAttr} value="${escAttr(value)}" placeholder="${placeholder}" autofocus>
    <button class="chip" data-act="${addAct}"${eiAttr}>Add</button>
  </span>`;
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
  if (ex.type === "cardio") {
    const paceStr = s.pace ? ` · ${s.pace}` : "";
    return `${s.duration} min · ${s.distance} km${paceStr}`;
  }
  if (ex.bodyweight || s.weight == null) { return `${s.reps} reps`; }
  return `${s.reps} × ${s.weight} ${loadUnit(ex)}`;
}

// One dense line summarizing an entry (shown when the card is collapsed).
function entrySummary(ex, entry) {
  if (ex.type === "cardio") {
    const s = entry.sets[0] || {};
    const paceStr = s.pace ? ` · ${s.pace}` : "";
    return `${s.duration || 0} min · ${s.distance || 0} km${paceStr}`;
  }
  const n = entry.sets.length;
  if (!n) { return "No sets — tap to add"; }
  const reps = entry.sets.map((s) => s.reps).join("·");
  const weights = entry.sets.map((s) => s.weight);
  const uniform = weights.every((x) => x === weights[0]);
  const u = loadUnit(ex);
  const wStr = ex.bodyweight
    ? ""
    : uniform
      ? ` · ${weights[0]}${u}`
      : ` · ${Math.min(...weights)}–${Math.max(...weights)}${u}`;
  return `${n} set${n > 1 ? "s" : ""} · ${reps} reps${wStr}`;
}

/* ---- Picker ---- */
// Gym-only library (cardio excluded), filtered, sorted most-recently-used first.
function pickerExercises() {
  const q = state.picker.q.toLowerCase();
  const cat = state.picker.cat;
  return state.exercises
    .filter((e) => e.type !== "cardio")
    .filter((e) => (cat === "All" || (e.muscles || []).includes(cat)) && (!q || e.name.toLowerCase().includes(q)))
    .sort((a, b) => lastUsedAt(b.id) - lastUsedAt(a.id) || a.name.localeCompare(b.name));
}

function pickerItemHtml(e) {
  const thumb = e.image
    ? `<img class="p-thumb" src="/api/file/${e.image}" loading="lazy" alt="">`
    : `<span class="p-thumb p-thumb-empty">\u{1F3CB}️</span>`;
  return `<button class="ex-pick" data-act="pick" data-id="${e.id}">
    ${thumb}
    <div style="flex:1;min-width:0;"><div class="p-name">${e.name}</div>
    <div class="p-muscle">${(e.muscles || []).join(" · ")}</div></div>
    <span class="p-add">+</span>
  </button>`;
}

function viewPicker() {
  if (state.picker.creating) { return viewExerciseForm(); }

  const cats = ["All"].concat(uniqueMuscles());
  const cat = state.picker.cat;
  const catHtml = cats.map((c) =>
    `<button class="chip ${c === cat ? "active" : ""}" data-act="set-cat" data-cat="${escAttr(c)}">${c}</button>`
  ).join("");

  const list = pickerExercises();
  const listHtml = list.length ? list.map(pickerItemHtml).join("") : `<div class="empty">No exercises yet — add one.</div>`;
  const backTo = state.picker.backTo || "active";
  const backLabel = backTo === "tpledit" ? "Template" : "Workout";

  return `<div class="app">
    ${header({ back: true, backLabel })}
    <main>
      <input class="picker-search" id="picker-q" placeholder="Search…" value="${escAttr(state.picker.q)}" data-act="search">
      ${cats.length > 1 ? `<div class="cat-row">${catHtml}</div>` : ""}
      <button class="add-ex-btn" data-act="new-ex" style="margin-bottom:14px;">+  New exercise</button>
      ${listHtml}
    </main>
  </div>`;
}

// Shared create/edit exercise form. state.picker.editingId decides the mode.
function viewExerciseForm() {
  const editing = !!state.picker.editingId;
  const name = state.picker.newName || "";
  const selected = state.picker.newTags || [];
  const bank = tagBank();
  const chips = bank.map((m) =>
    `<button class="chip ${selected.includes(m) ? "active" : ""}" data-act="toggle-tag" data-m="${escAttr(m)}">${m}</button>`
  ).join("");

  return `<div class="app">
    ${header({ back: true, backAct: "close-create", backLabel: editing ? "Back" : "Cancel" })}
    <main>
      <div class="section-head"><span class="eyebrow">${editing ? "Edit exercise" : "New exercise"}</span></div>
      <input class="picker-search" id="new-name" placeholder="Name" value="${escAttr(name)}" data-act="new-name" autofocus>
      <div class="eyebrow" style="margin:18px 2px 10px;">Tags <span style="color:var(--muted-2);font-weight:600;">· tap to toggle</span></div>
      <div class="chip-row" style="margin-bottom:12px;">${chips}</div>
      <div class="inline-new" style="width:100%;">
        <input class="picker-search" style="margin:0;" placeholder="Add a new tag…" value="${escAttr(state.picker.newTagText || "")}" data-act="new-tag-text">
        <button class="chip" data-act="add-tag">Add</button>
      </div>

      <div class="eyebrow" style="margin:20px 2px 10px;">Logging</div>
      <div class="chip-row">
        <button class="chip ${state.picker.newBodyweight ? "active" : ""}" data-act="toggle-bodyweight">Bodyweight (reps only)</button>
      </div>
      ${state.picker.newBodyweight ? "" : `<div class="chip-row" style="margin-top:8px;">
        <span style="align-self:center;color:var(--muted);font-size:0.85rem;margin-right:2px;">Load unit:</span>
        <button class="chip ${state.picker.newUnit !== "sec" ? "active" : ""}" data-act="set-unit" data-unit="kg">kg</button>
        <button class="chip ${state.picker.newUnit === "sec" ? "active" : ""}" data-act="set-unit" data-unit="sec">sec (time)</button>
      </div>`}

      <div class="eyebrow" style="margin:20px 2px 10px;">Image</div>
      ${state.picker.newImage
        ? `<div class="ex-img-edit">
            <img class="ex-img-preview" src="/api/file/${state.picker.newImage}" alt="exercise">
            <button class="chip" data-act="ex-img-remove">Remove</button>
          </div>`
        : `<button class="add-ex-btn" data-act="ex-img-pick" ${state.picker.imageBusy ? "disabled style=opacity:0.5" : ""}>${state.picker.imageBusy ? "Uploading…" : "＋ Add image"}</button>`}
      <input type="file" accept="image/*" id="ex-img-file" data-act="ex-img-file" style="display:none">
    </main>
    <div class="footer">
      <button class="btn btn-ghost" data-act="close-create">Back</button>
      <button class="btn btn-primary" data-act="save-ex">${editing ? "Save" : "Add exercise"}</button>
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

  const newHtml = w.painNewOpen
    ? inlineNewField("finish-pain-new-text", "finish-pain-new-add", null, w.painNewText || "", "New area…")
    : `<button class="chip" data-act="finish-pain-new">+ New</button>`;
  const painHtml = `<div class="chip-row">${painChips}${newHtml}</div>${painScale}`;

  return `<div class="app">
    ${header({ back: true, backLabel: "Workout" })}
    <main>
      <div class="section-head"><span class="eyebrow">Finish</span></div>

      <div class="finish-block">
        <span class="eyebrow">Date</span>
        <input class="date-input" type="date" value="${dateInputValue(w.startedAt)}" data-act="wdate">
      </div>

      ${(() => {
        const cardioOnly = w.entries.length > 0 && w.entries.every((en) => exById(en.exerciseId).type === "cardio");
        if (cardioOnly) { return ""; }
        const chips = state.workoutThemes.map((th) =>
          `<button class="chip ${w.theme === th ? "active" : ""}" data-act="set-theme" data-theme="${escAttr(th)}">${th}</button>`
        ).join("");
        const newHtml = w.themeNewOpen
          ? inlineNewField("theme-new-text", "theme-new-add", null, w.themeNewText || "", "New category…")
          : `<button class="chip" data-act="theme-new">+ New</button>`;
        return `<div class="finish-block">
          <span class="eyebrow">Category <span style="color:var(--muted-2);font-weight:600;text-transform:none;letter-spacing:0;">· e.g. Shoulders, Knee rehab</span></span>
          <div class="chip-row">${chips}${newHtml}</div>
        </div>`;
      })()}

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

      ${w.entries.some((en) => exById(en.exerciseId).type !== "cardio")
        ? `<button class="text-btn" data-act="save-as-template" style="display:block;margin:6px auto 0;">＋ Save this as a template</button>`
        : ""}
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
    ${header({ back: true, backLabel: "Home" })}
    <main>
      <div class="section-head"><span class="eyebrow">All workouts · ${list.length}</span></div>
      ${body}
    </main>
  </div>`;
}

/* ---- Detail ---- */
function viewDetail() {
  const w = state.workouts.find((x) => x.id === state.detailId);
  if (!w) {
    if (state.loaded) { go("history"); return ""; }
    return loadingShell("History", "history");
  }

  // Compact: one dense line per exercise (name + set summary), with pain/note
  // folded underneath only when present.
  const exHtml = `<div class="d-ex-list">${w.entries.map((entry) => {
    const ex = exById(entry.exerciseId);
    let summary = "";
    if (ex.type === "cardio") {
      summary = entry.sets[0] ? describeSet(ex, entry.sets[0]) : "";
    } else if (entry.sets.length) {
      summary = entrySummary(ex, entry);
    }
    const img = ex.image ? `<img class="d-ex-img" src="/api/file/${ex.image}" loading="lazy" alt="">` : "";
    const sub = [];
    if (entry.pain) { sub.push(`<span style="color:${heatColor(entry.pain.level)};font-weight:700;">⚠ ${escAttr(entry.pain.cat)} ${entry.pain.level}</span>`); }
    if (entry.note) { sub.push(`<span class="d-ex-note">${escAttr(entry.note)}</span>`); }
    return `<button class="d-ex" data-act="ex-info" data-id="${escAttr(ex.id)}">
      ${img}
      <div class="d-ex-body">
        <div class="d-ex-top"><span class="d-ex-name">${escAttr(ex.name)}</span><span class="d-ex-sum tnum">${summary}</span></div>
        ${sub.length ? `<div class="d-ex-sub">${sub.join(" · ")}</div>` : ""}
      </div>
      <span class="d-ex-chev">›</span>
    </button>`;
  }).join("")}</div>`;

  const painHtml = (w.pains || []).length
    ? `<div class="finish-block"><span class="eyebrow" style="display:block;margin-bottom:10px;">Pain logged</span><div class="pain-grid">${
        w.pains.map((p) => `<span class="pain-chip" style="background:${heatColor(p.level)};color:#14171C;border-color:transparent;">${p.cat} <span class="sev">${p.level}</span></span>`).join("")
      }</div></div>`
    : "";

  return `<div class="app">
    ${header({ back: true, backLabel: "History" })}
    <main>
      <div class="section-head"><span class="eyebrow">${w.routineName || "Workout"}${w.theme ? " · " + escAttr(w.theme) : ""} · ${fmtDate(w.startedAt)}</span></div>
      <div class="finish-block">
        <span class="eyebrow">Date</span>
        <input class="date-input" type="date" value="${dateInputValue(w.startedAt)}" data-act="detail-date" data-id="${w.id}">
      </div>
      ${(() => {
        const cardioOnly = w.entries.length > 0 && w.entries.every((en) => exById(en.exerciseId).type === "cardio");
        if (cardioOnly) { return ""; }
        const chips = state.workoutThemes.map((th) =>
          `<button class="chip ${w.theme === th ? "active" : ""}" data-act="detail-theme" data-id="${w.id}" data-theme="${escAttr(th)}">${th}</button>`
        ).join("");
        const newHtml = state.detailThemeNewOpen
          ? `<span class="inline-new"><input class="inline-new-input" data-act="detail-theme-new-text" value="${escAttr(state.detailThemeNewText || "")}" placeholder="New category…" autofocus><button class="chip" data-act="detail-theme-new-add" data-id="${w.id}">Add</button></span>`
          : `<button class="chip" data-act="detail-theme-new" data-id="${w.id}">+ New</button>`;
        return `<div class="finish-block">
          <span class="eyebrow">Category</span>
          <div class="chip-row">${chips}${newHtml}</div>
        </div>`;
      })()}
      <div class="detail-stat-row">
        <div class="dstat"><div class="v tnum" style="color:${w.feel ? heatColor(w.feel) : "var(--text)"}">${w.feel || "–"}</div><div class="k">Effort</div></div>
        <div class="dstat"><div class="v tnum">${w.entries.length}</div><div class="k">Exercises</div></div>
      </div>
      ${exHtml}
      ${painHtml}
      ${w.notes ? `<div class="finish-block"><span class="eyebrow" style="display:block;margin-bottom:8px;">Notes</span><div style="color:var(--muted);line-height:1.6;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px;">${w.notes.replace(/</g, "&lt;")}</div></div>` : ""}
    </main>
    <div class="footer">
      <button class="btn btn-primary" data-act="repeat" data-id="${w.id}">↻  Repeat this workout</button>
    </div>
  </div>`;
}

/* ---- Exercise info (tapped from a workout summary) ---- */
function openExInfo(id) { state.exInfoId = id; go("exinfo"); }

function exStats(id) {
  let count = 0, lastAt = 0, lastSets = null;
  for (const w of state.workouts) {
    const e = w.entries.find((en) => en.exerciseId === id);
    if (e) { count++; if (w.startedAt > lastAt) { lastAt = w.startedAt; lastSets = e.sets; } }
  }
  return { count, lastAt, lastSets };
}

function viewExInfo() {
  const ex = state.exInfoId ? exById(state.exInfoId) : null;
  if (!ex) { go("history"); return ""; }
  const st = exStats(ex.id);
  const canEdit = ex.type !== "cardio";
  const img = ex.image
    ? `<img class="exinfo-img" src="/api/file/${ex.image}" alt="${escAttr(ex.name)}">`
    : `<div class="exinfo-img exinfo-img-empty">\u{1F3CB}️</div>`;
  const tags = (ex.muscles || []).length
    ? `<div class="ex-tags" style="justify-content:center;margin-top:10px;">${ex.muscles.map((m) => `<span class="ex-tag">${escAttr(m)}</span>`).join("")}</div>`
    : "";
  const lastStr = st.lastAt ? fmtDate(st.lastAt) : "—";
  const lastSets = st.lastSets && st.lastSets.length
    ? st.lastSets.map((s) => ex.type === "cardio" ? describeSet(ex, s) : (ex.bodyweight || s.weight == null ? `${s.reps}` : `${s.reps} × ${s.weight} ${loadUnit(ex)}`)).join("  ·  ")
    : "";
  return `<div class="app">
    ${header({ back: true, backLabel: "Back", action: canEdit ? `<button class="back-btn" data-act="edit-ex" data-id="${ex.id}">Edit ›</button>` : "" })}
    <main>
      ${img}
      <div class="exinfo-name">${escAttr(ex.name)}</div>
      ${tags}
      <div class="detail-stat-row" style="margin-top:18px;">
        <div class="dstat"><div class="v tnum">${st.count}</div><div class="k">Times done</div></div>
        <div class="dstat"><div class="v" style="font-size:1.05rem;">${lastStr}</div><div class="k">Last</div></div>
      </div>
      ${lastSets ? `<div class="finish-block" style="margin-top:16px;"><span class="eyebrow">Last time</span><div class="prog-notes tnum">${lastSets}</div></div>` : ""}
    </main>
  </div>`;
}

/* ============ Profile + weight ============ */
function ageFrom(dob) {
  if (!dob) { return null; }
  const b = new Date(dob), n = new Date();
  let a = n.getFullYear() - b.getFullYear();
  const m = n.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < b.getDate())) { a--; }
  return a;
}
function latestWeight() {
  const w = state.bodyWeights;
  return w.length ? w[w.length - 1].weight : null;
}
function persistProfile() { apiPost("/api/profile", state.profile).catch(() => {}); }

function setGender(g) { state.profile.gender = g; persistProfile(); render(); }

async function addWeighIn() {
  const wv = parseFloat(state.weighWeight);
  if (!wv || wv <= 0) { toast("Enter a weight"); return; }
  const at = state.weighDate
    ? (() => { const [y, m, d] = state.weighDate.split("-").map(Number); return new Date(y, m - 1, d, 12).getTime(); })()
    : Date.now();
  try {
    const row = await apiPost("/api/weights", { weight: wv, at });
    state.bodyWeights.push(row);
    state.bodyWeights.sort((a, b) => a.at - b.at);
    state.weighWeight = "";
    render();
    toast("Weigh-in added");
  } catch (e) { toast("Couldn't save"); }
}
async function deleteWeighIn(id) {
  try { await apiDelete("/api/weights", { id }); } catch (e) { /* ignore */ }
  state.bodyWeights = state.bodyWeights.filter((w) => w.id !== id);
  render();
}

function viewProfile() {
  const p = state.profile;
  const age = ageFrom(p.dob);
  const lw = latestWeight();
  const genders = ["Male", "Female", "Other"];
  const genderChips = genders.map((g) =>
    `<button class="chip ${p.gender === g ? "active" : ""}" data-act="gender" data-g="${g}">${g}</button>`
  ).join("");

  const stat = (v, k) => `<div class="dstat"><div class="v tnum">${v}</div><div class="k">${k}</div></div>`;
  const history = state.bodyWeights.slice().reverse().map((w) =>
    `<div class="wrow">
      <span class="wrow-date">${new Date(w.at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
      <span class="wrow-val tnum">${w.weight} kg</span>
      <button class="wrow-del" data-act="del-weigh" data-id="${w.id}" aria-label="Delete">×</button>
    </div>`
  ).join("");

  return `<div class="app">
    ${header({ back: true, backLabel: "Home" })}
    <main>
      <div class="section-head"><span class="eyebrow">Profile</span></div>

      <div class="detail-stat-row">
        ${stat(age != null ? age : "–", "Age")}
        ${stat(p.height ? p.height : "–", "Height cm")}
        ${stat(lw != null ? lw : "–", "Weight kg")}
      </div>

      <div class="finish-block">
        <span class="eyebrow">Date of birth</span>
        <input class="date-input" type="date" value="${p.dob || ""}" data-act="dob">
      </div>
      <div class="finish-block">
        <span class="eyebrow">Height (cm)</span>
        <input class="picker-search" type="number" inputmode="decimal" placeholder="cm" value="${p.height != null ? p.height : ""}" data-act="height">
      </div>
      <div class="finish-block">
        <span class="eyebrow">Gender</span>
        <div class="chip-row">${genderChips}</div>
      </div>

      <div class="section-head" style="margin-top:8px;"><span class="eyebrow">Weight over time</span></div>
      <div class="chart-card">
        <canvas id="wchart" class="wchart"></canvas>
        ${state.bodyWeights.length === 0 ? `<div class="chart-empty">No weigh-ins yet</div>` : ""}
      </div>

      <div class="weigh-add">
        <input class="picker-search" style="margin:0;flex:1;" type="number" inputmode="decimal" placeholder="Weight kg" value="${escAttr(state.weighWeight || "")}" data-act="weigh-weight">
        <input class="date-input" style="flex:0 0 auto;width:auto;" type="date" value="${state.weighDate || dateInputValue(Date.now())}" data-act="weigh-date">
        <button class="chip" data-act="add-weigh">Add</button>
      </div>

      ${history ? `<div class="wlist">${history}</div>` : ""}
    </main>
  </div>`;
}

function drawWeightChart() {
  const cv = document.getElementById("wchart");
  if (!cv) { return; }
  const data = state.bodyWeights;
  const ctx = cv.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 300;
  const H = cv.clientHeight || 140;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!data.length) { return; }

  const pad = { l: 10, r: 10, t: 14, b: 18 };
  const ys = data.map((d) => d.weight);
  let minY = Math.min(...ys), maxY = Math.max(...ys);
  if (minY === maxY) { minY -= 1; maxY += 1; }
  const minX = data[0].at, maxX = data[data.length - 1].at;
  const spanX = (maxX - minX) || 1;
  const px = (t) => pad.l + (W - pad.l - pad.r) * ((t - minX) / spanX);
  const py = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - minY) / (maxY - minY));

  const pts = data.map((d) => [data.length === 1 ? W / 2 : px(d.at), py(d.weight)]);

  // Area fill
  const grad = ctx.createLinearGradient(0, pad.t, 0, H - pad.b);
  grad.addColorStop(0, "rgba(251,113,65,0.32)");
  grad.addColorStop(1, "rgba(251,113,65,0.02)");
  ctx.beginPath();
  ctx.moveTo(pts[0][0], H - pad.b);
  pts.forEach((p) => ctx.lineTo(p[0], p[1]));
  ctx.lineTo(pts[pts.length - 1][0], H - pad.b);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Line
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.strokeStyle = "#FB7141";
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Endpoint dot
  const last = pts[pts.length - 1];
  ctx.beginPath();
  ctx.arc(last[0], last[1], 4, 0, Math.PI * 2);
  ctx.fillStyle = "#FB7141";
  ctx.fill();

  // Min/max labels
  ctx.fillStyle = "rgba(232,235,240,0.5)";
  ctx.font = "600 10px -apple-system, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(maxY.toFixed(1), pad.l, pad.t - 3);
  ctx.fillText(minY.toFixed(1), pad.l, H - 5);
}

/* ============ Photos / albums ============ */
function photosInAlbum(albumId) {
  return state.photos.filter((p) => (albumId === null ? true : p.albumId === albumId));
}
function albumCover(albumId) {
  const ps = state.photos.filter((p) => p.albumId === albumId);
  return ps.length ? ps[0].id : null;
}
function allPhotoTags() {
  const out = [];
  state.photos.forEach((p) => (p.tags || []).forEach((t) => { if (!out.includes(t)) { out.push(t); } }));
  return out.sort();
}

function viewPhotos() {
  const albumCards = state.albums.map((a) => {
    const cover = albumCover(a.id);
    const count = state.photos.filter((p) => p.albumId === a.id).length;
    const bg = cover
      ? `background-image:url(/api/photos/${cover});`
      : "background:var(--surface-2);";
    return `<button class="album-card" data-act="open-album" data-id="${a.id}">
      <div class="album-cover" style="${bg}">${cover ? "" : "🖼️"}</div>
      <div class="album-meta"><span class="album-name">${a.name}</span><span class="album-count">${count} photo${count !== 1 ? "s" : ""}</span></div>
    </button>`;
  }).join("");

  const allCount = state.photos.length;
  const allCover = state.photos[0] ? state.photos[0].id : null;

  return `<div class="app">
    ${header({ back: true, backLabel: "Home" })}
    <main>
      <div class="section-head">
        <span class="eyebrow">Photos</span>
        ${state.newAlbumOpen
          ? `<span class="inline-new"><input class="inline-new-input" data-act="new-album-text" value="${escAttr(state.newAlbumName || "")}" placeholder="Album name…" autofocus><button class="chip" data-act="new-album-add">Add</button></span>`
          : `<button class="back-btn" data-act="new-album">+ New album</button>`}
      </div>
      <div class="album-grid">
        <button class="album-card" data-act="open-album" data-id="__all__">
          <div class="album-cover" style="${allCover ? `background-image:url(/api/photos/${allCover});` : "background:var(--surface-2);"}">${allCover ? "" : "🖼️"}</div>
          <div class="album-meta"><span class="album-name">All photos</span><span class="album-count">${allCount} photo${allCount !== 1 ? "s" : ""}</span></div>
        </button>
        ${albumCards}
      </div>
      ${state.albums.length === 0 && allCount === 0 ? `<div class="empty" style="margin-top:16px;">No photos yet. Make an album and upload progress pics.</div>` : ""}
    </main>
  </div>`;
}

function loadingShell(backLabel, backTarget) {
  return `<div class="app">${header({ back: true, backLabel })}<main></main></div>`;
}

function viewAlbum() {
  const isAll = state.albumId === "__all__";
  const album = isAll ? { id: "__all__", name: "All photos" } : state.albums.find((a) => a.id === state.albumId);
  if (!album) {
    if (state.loaded) { go("photos"); return ""; }
    return loadingShell("Albums", "photos"); // data still loading after a reload
  }

  let photos = photosInAlbum(isAll ? null : album.id);
  const tags = allPhotoTags();
  if (state.photoTag) { photos = photos.filter((p) => (p.tags || []).includes(state.photoTag)); }

  const tagRow = tags.length
    ? `<div class="cat-row">
        <button class="chip ${!state.photoTag ? "active" : ""}" data-act="photo-tag" data-tag="">All</button>
        ${tags.map((t) => `<button class="chip ${state.photoTag === t ? "active" : ""}" data-act="photo-tag" data-tag="${escAttr(t)}">${t}</button>`).join("")}
      </div>`
    : "";

  const grid = photos.length
    ? `<div class="pgrid">${photos.map((p) =>
        `<button class="pgrid-cell" data-act="open-photo" data-id="${p.id}">
          <img class="pgrid-img" src="/api/photos/${p.id}" loading="lazy" alt="${escAttr(p.caption || "photo")}">
        </button>`
      ).join("")}</div>`
    : `<div class="empty" style="margin-top:16px;">No photos${state.photoTag ? " with this tag" : " yet"}.</div>`;

  const lightbox = state.viewPhotoId ? photoLightbox() : "";
  const sheet = state.pendingUpload ? uploadSheet() : "";

  return `<div class="app">
    ${header({ back: true, backLabel: "Albums" })}
    <main>
      <div class="section-head"><span class="eyebrow">${album.name}</span></div>
      ${tagRow}
      ${grid}
    </main>
    <div class="footer">
      <button class="btn btn-primary" data-act="pick-photo">＋  Add photo</button>
    </div>
    <input type="file" accept="image/*" id="photo-file" data-act="photo-file" multiple style="display:none">
    ${lightbox}
    ${sheet}
  </div>`;
}

function photoLightbox() {
  const p = state.photos.find((x) => x.id === state.viewPhotoId);
  if (!p) { return ""; }
  const tags = (p.tags || []).map((t) => `<span class="ex-tag">${t}</span>`).join("");
  return `<div class="lightbox" data-act="close-photo">
    <div class="lightbox-inner" data-act="noop">
      <img class="lightbox-img" src="/api/photos/${p.id}" alt="${escAttr(p.caption || "photo")}">
      ${p.caption ? `<div class="lightbox-cap">${escAttr(p.caption)}</div>` : ""}
      ${tags ? `<div class="ex-tags" style="justify-content:center;">${tags}</div>` : ""}
      <button class="text-btn" style="color:var(--hot);margin-top:6px;" data-act="del-photo" data-id="${p.id}">Delete photo</button>
    </div>
    <button class="lightbox-close" data-act="close-photo" aria-label="Close">×</button>
  </div>`;
}

function uploadSheet() {
  const u = state.pendingUpload;
  const multi = u.files.length > 1;
  const thumbs = u.previews
    .map((src) => `<img class="sheet-thumb ${multi ? "" : "solo"}" src="${src}" alt="preview">`)
    .join("");
  const label = u.busy
    ? "Uploading…"
    : multi ? `Upload ${u.files.length} photos` : "Upload";
  return `<div class="sheet-wrap" data-act="cancel-upload">
    <div class="sheet" data-act="noop">
      <div class="eyebrow" style="margin-bottom:12px;">${multi ? u.files.length + " photos" : "New photo"}</div>
      <div class="sheet-thumbs ${multi ? "multi" : ""}">${thumbs}</div>
      <input class="picker-search" placeholder="Caption${multi ? " (applies to all)" : " (optional)"}" value="${escAttr(u.caption)}" data-act="up-caption">
      <input class="picker-search" placeholder="Tags, comma-separated (e.g. front, week 1)" value="${escAttr(u.tags)}" data-act="up-tags">
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="cancel-upload">Cancel</button>
        <button class="btn btn-primary" data-act="confirm-upload" ${u.busy ? "disabled style=opacity:0.5" : ""}>${label}</button>
      </div>
    </div>
  </div>`;
}

/* ---- Upload flow (browser downscales before sending) ---- */
const MAX_UPLOAD_DIM = 1920;
function pickPhoto() {
  const el = document.getElementById("photo-file");
  if (el) { el.click(); }
}
function onPhotoFile(files) {
  const arr = Array.from(files || []).filter((f) => f && f.type && f.type.startsWith("image/"));
  if (!arr.length) { return; }
  const previews = arr.map((f) => URL.createObjectURL(f));
  state.pendingUpload = { files: arr, previews, caption: "", tags: "", busy: false };
  render();
}
function downscale(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      const scale = Math.min(1, MAX_UPLOAD_DIM / Math.max(width, height));
      width = Math.round(width * scale);
      height = Math.round(height * scale);
      const cv = document.createElement("canvas");
      cv.width = width; cv.height = height;
      cv.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      cv.toBlob((blob) => resolve(blob || file), "image/jpeg", 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
async function confirmUpload() {
  const u = state.pendingUpload;
  if (!u || u.busy) { return; }
  u.busy = true; render();
  const caption = u.caption || "";
  const tags = u.tags || "";
  const total = u.files.length;
  let ok = 0;
  for (const file of u.files) {
    try {
      const blob = await downscale(file);
      const fd = new FormData();
      fd.append("file", blob, "photo.jpg");
      if (state.albumId && state.albumId !== "__all__") { fd.append("albumId", state.albumId); }
      fd.append("caption", caption);
      fd.append("tags", tags);
      const r = await fetch("/api/photos", { method: "POST", body: fd });
      if (!r.ok) { throw new Error("upload failed"); }
      state.photos.unshift(await r.json());
      ok++;
    } catch (e) { /* keep going with the rest of the batch */ }
  }
  u.previews.forEach((p) => URL.revokeObjectURL(p));
  state.pendingUpload = null;
  render();
  if (ok === total) { toast(total > 1 ? total + " photos added ✓" : "Photo added ✓"); }
  else if (ok) { toast(ok + " of " + total + " uploaded"); }
  else { toast("Upload failed"); }
}
function cancelUpload() {
  if (state.pendingUpload) { state.pendingUpload.previews.forEach((p) => URL.revokeObjectURL(p)); }
  state.pendingUpload = null;
  render();
}
async function deletePhotoById(id) {
  try { await apiDelete("/api/photos", { id }); } catch (e) { /* ignore */ }
  state.photos = state.photos.filter((p) => p.id !== id);
  state.viewPhotoId = null;
  render();
}

/* ============ Nutrition ============ */
const NUTRI_SLOTS = [["breakfast", "Breakfast"], ["lunch", "Lunch"], ["dinner", "Dinner"], ["snack", "Snacks"]];

function todayISO() { return dateInputValue(Date.now()); }
function nutriTargets() { return (state.profile && state.profile.targets) || { kcal: null, protein: null, carbs: null, fat: null }; }
function numOrNull(v) { if (v === "" || v == null) { return null; } const n = parseFloat(v); return isNaN(n) ? null : n; }
function round1(n) { return Math.round(n * 10) / 10; }
function fmtNum(n) { return Number.isInteger(n) ? String(n) : String(round1(n)); }
function slotTitle(key) { const s = NUTRI_SLOTS.find((x) => x[0] === key); return s ? s[1] : "Meal"; }

// Food entries store per-100g macros + grams → total = per100g × g/100.
// Quick-add / legacy entries have no grams → total = macros × qty.
function entryTotals(e) {
  const f = e.grams != null ? (e.grams / 100) : (e.qty || 1);
  return { kcal: (e.kcal || 0) * f, protein: (e.protein || 0) * f, carbs: (e.carbs || 0) * f, fat: (e.fat || 0) * f };
}
const DEFAULT_GRAMS = 100;
function sumTotals(list) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  (list || []).forEach((e) => { const x = entryTotals(e); t.kcal += x.kcal; t.protein += x.protein; t.carbs += x.carbs; t.fat += x.fat; });
  return t;
}

function openNutrition() {
  if (!state.nutritionDay) { state.nutritionDay = todayISO(); }
  state.dayLog = null;
  go("nutrition");
  loadDayLog();
}
async function loadDayLog() {
  const day = state.nutritionDay;
  try {
    const log = await apiGet("/api/nutrition?day=" + encodeURIComponent(day));
    if (state.nutritionDay === day) { state.dayLog = log; render(); }
  } catch (e) {
    if (state.dayLog === null) { state.dayLog = []; render(); }
  }
}
function nutritionShift(delta) {
  const [y, m, d] = state.nutritionDay.split("-").map(Number);
  state.nutritionDay = dateInputValue(new Date(y, m - 1, d + delta, 12).getTime());
  state.dayLog = null;
  save();
  render();
  loadDayLog();
}
function setNutritionDay(iso) {
  if (!iso) { return; }
  state.nutritionDay = iso;
  state.dayLog = null;
  save();
  render();
  loadDayLog();
}

async function addLogEntries(slot, entries) {
  const day = state.nutritionDay;
  try {
    const log = await apiPost("/api/nutrition", { day, slot, entries });
    if (state.nutritionDay === day) { state.dayLog = log; }
    render();
    toast(entries.length > 1 ? entries.length + " items added ✓" : "Added ✓");
  } catch (e) { toast("Couldn't add"); }
}
function foodToEntry(f, grams) {
  // Snapshot the food's per-100g macros + the gram amount onto the entry.
  return { foodId: f.id, grams, name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat };
}
function logFood(f) {
  if (!f) { return; }
  addLogEntries(state.addFood.slot, [foodToEntry(f, DEFAULT_GRAMS)]);
}
function mealToEntries(m) {
  return (m.items || []).map((it) => ({
    foodId: it.foodId, grams: it.grams != null ? it.grams : null, qty: it.grams != null ? undefined : (it.qty || 1),
    name: it.name, kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat
  }));
}
function logMeal(m) {
  if (!m) { return; }
  const entries = mealToEntries(m);
  if (!entries.length) { toast("Empty meal"); return; }
  addLogEntries(state.addFood.slot, entries);
}
// Add all "everyday" meals to the current day, each into its default slot.
function addDailyMeals() {
  const daily = state.meals.filter((m) => m.everyday && m.items.length);
  if (!daily.length) { toast("No everyday meals set"); return; }
  const day = state.nutritionDay;
  (async () => {
    let added = 0;
    for (const m of daily) {
      try {
        const log = await apiPost("/api/nutrition", { day, slot: m.slot || "snack", entries: mealToEntries(m) });
        if (state.nutritionDay === day) { state.dayLog = log; }
        added++;
      } catch (e) { /* continue */ }
    }
    render();
    toast(added ? `Added ${added} daily meal${added !== 1 ? "s" : ""} ✓` : "Couldn't add");
  })();
}
function logQuick() {
  const q = state.addFood.quick;
  const kcal = numOrNull(q.kcal), p = numOrNull(q.protein), c = numOrNull(q.carbs), f = numOrNull(q.fat);
  if (kcal == null && p == null && c == null && f == null) { toast("Enter calories"); return; }
  addLogEntries(state.addFood.slot, [{ foodId: null, qty: 1, name: (q.name || "").trim() || "Quick add", kcal, protein: p, carbs: c, fat: f }]);
  state.addFood.quick = { name: "", kcal: "", protein: "", carbs: "", fat: "" };
}

/* ---- Diary entry edit ---- */
function openEntryEdit(id) {
  const e = (state.dayLog || []).find((x) => x.id === id);
  if (!e) { return; }
  state.entryEdit = { ...e };
  render();
}
async function saveEntryEdit() {
  const e = state.entryEdit;
  try {
    const log = await apiPut("/api/nutrition", {
      id: e.id, slot: e.slot, grams: e.grams != null ? numOrNull(e.grams) : null, qty: numOrNull(e.qty) ?? 1,
      name: e.name, kcal: numOrNull(e.kcal), protein: numOrNull(e.protein), carbs: numOrNull(e.carbs), fat: numOrNull(e.fat),
    });
    state.dayLog = log;
  } catch (err) { toast("Couldn't save"); return; }
  state.entryEdit = null; render();
}
async function deleteEntry(id) {
  try { const log = await apiDelete("/api/nutrition", { id }); state.dayLog = log; } catch (e) { /* ignore */ }
  state.entryEdit = null; render();
}

/* ---- Food library (macros per 100 g) ---- */
function openFoodEdit(id, back) {
  const f = id ? state.foods.find((x) => x.id === id) : null;
  state.foodEdit = f
    ? { ...f }
    : { id: null, name: "", image: null, kcal: "", protein: "", carbs: "", fat: "" };
  state.foodImageBusy = false;
  state.foodEditReturn = back || "addfood";
  go("foodedit");
}
async function onFoodImage(file) {
  if (!file || !file.type || !file.type.startsWith("image/")) { return; }
  state.foodImageBusy = true; render();
  try {
    const blob = await downscale(file);
    const fd = new FormData();
    fd.append("file", blob, "food.jpg");
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    if (!r.ok) { throw new Error("upload failed"); }
    state.foodEdit.image = (await r.json()).filename;
  } catch (e) { toast("Image upload failed"); }
  state.foodImageBusy = false; render();
}
async function saveFoodEdit() {
  const f = state.foodEdit;
  if (!(f.name || "").trim()) { toast("Name the food"); return; }
  let saved;
  try {
    saved = await apiPost("/api/foods", { id: f.id || undefined, name: f.name.trim(), image: f.image || null, kcal: numOrNull(f.kcal), protein: numOrNull(f.protein), carbs: numOrNull(f.carbs), fat: numOrNull(f.fat) });
  } catch (e) { toast("Couldn't save food"); return; }
  const i = state.foods.findIndex((x) => x.id === saved.id);
  if (i >= 0) { state.foods[i] = saved; } else { state.foods.push(saved); }
  state.foods.sort((a, b) => a.name.localeCompare(b.name));
  state.foodEdit = null; state.foodEditReturn = null;
  history.back();   // pop the food editor, back to where it was opened from
  toast(f.id ? "Food updated" : "Food added ✓");
}
function deleteFoodById(id) {
  apiDelete("/api/foods", { id }).catch(() => {});
  state.foods = state.foods.filter((f) => f.id !== id);
  render();
}

/* ---- Saved meals (foods by grams) ---- */
function openMealEdit(id, back) {
  const m = id ? state.meals.find((x) => x.id === id) : null;
  state.mealEdit = m
    ? { id: m.id, name: m.name, icon: m.icon || "", everyday: !!m.everyday, slot: m.slot || null, items: m.items.map((it) => ({ ...it })) }
    : { id: null, name: "", icon: "", everyday: false, slot: null, items: [] };
  state.mealEditReturn = back || "addfood";
  state.mealAddOpen = false; state.mealQ = "";
  go("mealedit");
}
function addFoodToMeal(f) {
  if (!f) { return; }
  state.mealEdit.items.push({ foodId: f.id, grams: DEFAULT_GRAMS, name: f.name, kcal: f.kcal, protein: f.protein, carbs: f.carbs, fat: f.fat });
  render();
}
function delMealItem(i) { state.mealEdit.items.splice(i, 1); render(); }
function bumpMealGrams(i, dir) {
  const it = state.mealEdit.items[i];
  it.grams = Math.max(1, Math.round(((it.grams || DEFAULT_GRAMS) + dir * 10)));
  render();
}
async function saveMealEdit() {
  const m = state.mealEdit;
  if (!(m.name || "").trim()) { toast("Name the meal"); return; }
  if (!m.items.length) { toast("Add a food"); return; }
  let saved;
  try {
    saved = await apiPost("/api/meals", { id: m.id || undefined, name: m.name.trim(), icon: m.icon || null, everyday: !!m.everyday, slot: m.slot || null, items: m.items });
  } catch (e) { toast("Couldn't save meal"); return; }
  const i = state.meals.findIndex((x) => x.id === saved.id);
  if (i >= 0) { state.meals[i] = saved; } else { state.meals.push(saved); }
  state.meals.sort((a, b) => a.name.localeCompare(b.name));
  const wasEditing = !!m.id;
  state.mealEdit = null; state.mealEditReturn = null;
  history.back();   // pop the meal editor, back to where it was opened from
  toast(wasEditing ? "Meal updated" : "Meal saved ✓");
}
function deleteMealById(id) {
  apiDelete("/api/meals", { id }).catch(() => {});
  state.meals = state.meals.filter((m) => m.id !== id);
  render();
}
// Turn a day's slot into a reusable saved meal.
function saveSlotAsMeal(slot) {
  const items = (state.dayLog || []).filter((e) => e.slot === slot)
    .map((e) => ({ foodId: e.foodId, grams: e.grams != null ? e.grams : null, qty: e.grams != null ? undefined : (e.qty || 1), name: e.name, kcal: e.kcal, protein: e.protein, carbs: e.carbs, fat: e.fat }));
  if (!items.length) { toast("Nothing to save"); return; }
  state.mealEdit = { id: null, name: "", icon: "", everyday: false, slot, items };
  state.mealEditReturn = "nutrition";
  state.mealAddOpen = false; state.mealQ = "";
  go("mealedit");
}

/* ---- Targets ---- */
function openTargets() {
  const t = nutriTargets();
  state.targetEdit = { kcal: t.kcal ?? "", protein: t.protein ?? "", carbs: t.carbs ?? "", fat: t.fat ?? "" };
  render();
}
async function saveTargetsEdit() {
  const t = state.targetEdit;
  try {
    state.profile = await apiPost("/api/targets", { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat });
  } catch (e) { toast("Couldn't save"); return; }
  state.targetEdit = null; render(); toast("Targets saved ✓");
}

/* ---- Nutrition views ---- */
function macroBar(label, val, target, color) {
  const pct = target ? Math.min(100, Math.round((val / target) * 100)) : 0;
  const over = target && val > target;
  const tgtStr = target ? " / " + fmtNum(target) : "";
  return `<div class="macro">
    <div class="macro-top"><span class="macro-lbl">${label}</span><span class="macro-val tnum ${over ? "over" : ""}">${fmtNum(round1(val))}${tgtStr}g</span></div>
    <div class="bar"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
  </div>`;
}

function entryRow(e) {
  const x = entryTotals(e);
  const amt = e.grams != null
    ? ` <span class="entry-qty">${fmtNum(e.grams)} g</span>`
    : (e.qty && e.qty !== 1 ? ` <span class="entry-qty">×${fmtNum(e.qty)}</span>` : "");
  return `<button class="entry" data-act="edit-entry" data-id="${e.id}">
    <span class="entry-name">${escAttr(e.name)}${amt}</span>
    <span class="entry-kcal tnum">${fmtNum(Math.round(x.kcal))}</span>
  </button>`;
}

function viewNutrition() {
  const day = state.nutritionDay || todayISO();
  const isToday = day === todayISO();
  const [y, mo, d] = day.split("-").map(Number);
  const dt = new Date(y, mo - 1, d, 12);
  const label = isToday ? "Today" : dt.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  const t = nutriTargets();
  const tot = sumTotals(state.dayLog);
  const loading = state.dayLog === null;

  const kcalPct = t.kcal ? Math.min(100, Math.round((tot.kcal / t.kcal) * 100)) : 0;
  const remaining = t.kcal != null ? Math.round(t.kcal - tot.kcal) : null;
  const kcalSub = t.kcal
    ? `<span class="kcal-target">/ ${fmtNum(t.kcal)} kcal · ${remaining >= 0 ? remaining + " left" : -remaining + " over"}</span>`
    : `<span class="kcal-target">kcal</span>`;
  const kcalBar = t.kcal ? `<div class="bar big"><div class="bar-fill" style="width:${kcalPct}%;background:var(--accent)"></div></div>` : "";

  const totalsCard = `<div class="nutri-card">
    <div class="nutri-kcal">
      <div class="kcal-block"><div class="kcal-num tnum">${fmtNum(Math.round(tot.kcal))}</div><div class="kcal-cap">${kcalSub}</div></div>
      <button class="chip" data-act="edit-targets">🎯 Targets</button>
    </div>
    ${kcalBar}
    <div class="macro-row">
      ${macroBar("Protein", tot.protein, t.protein, "var(--cool)")}
      ${macroBar("Carbs", tot.carbs, t.carbs, "var(--warm)")}
      ${macroBar("Fat", tot.fat, t.fat, "var(--accent)")}
    </div>
  </div>`;

  const slotsHtml = NUTRI_SLOTS.map(([key, title]) => {
    const entries = (state.dayLog || []).filter((e) => e.slot === key);
    const st = sumTotals(entries);
    const rows = entries.map(entryRow).join("");
    const saveMealBtn = entries.length ? `<button class="text-btn" data-act="slot-save-meal" data-slot="${key}">Save as meal</button>` : "";
    return `<div class="nutri-slot">
      <div class="slot-head">
        <span class="slot-title">${title}</span>
        <span class="slot-kcal tnum">${fmtNum(Math.round(st.kcal))} kcal</span>
      </div>
      ${rows}
      <div class="slot-actions">
        <button class="add-ex-btn slot-add" data-act="add-food" data-slot="${key}">＋ Add</button>
        ${saveMealBtn}
      </div>
    </div>`;
  }).join("");

  return `<div class="app">
    ${header({ back: true, backLabel: "Home" })}
    <main>
      <div class="daynav">
        <button class="cal-nav" data-act="nutri-prev" aria-label="Previous day">‹</button>
        <label class="daynav-center">
          <span class="daynav-label">${label}</span>
          <input class="daynav-date" type="date" value="${day}" data-act="nutri-date" aria-label="Pick day">
        </label>
        <button class="cal-nav" data-act="nutri-next" aria-label="Next day">›</button>
      </div>
      ${totalsCard}
      ${state.meals.some((m) => m.everyday && m.items.length) ? `<button class="add-ex-btn" data-act="add-daily" style="margin-bottom:16px;">＋ Add daily meals</button>` : ""}
      ${loading ? `<div class="empty" style="margin-top:14px;">Loading…</div>` : slotsHtml}
    </main>
  </div>`;
}

function quickField(label, field, val) {
  return `<div class="finish-block"><span class="eyebrow">${label}</span>
    <input class="picker-search" type="number" inputmode="decimal" placeholder="0" value="${escAttr(val == null ? "" : val)}" data-act="quick-field" data-field="${field}"></div>`;
}

function foodThumb(f) {
  return f.image
    ? `<img class="p-thumb" src="/api/file/${f.image}" loading="lazy" alt="">`
    : `<span class="p-thumb p-thumb-empty">🍎</span>`;
}
function addFoodRows() {
  const q = (state.addFood.q || "").toLowerCase();
  const list = state.foods.filter((f) => !q || f.name.toLowerCase().includes(q));
  return list.length
    ? list.map((f) => `<div class="pick-food">
        <button class="pick-food-main pick-food-img" data-act="log-food" data-id="${f.id}">
          ${foodThumb(f)}
          <span class="pf-txt"><span class="pf-name">${escAttr(f.name)}</span>
          <span class="pf-macro">${fmtNum(Math.round(f.kcal || 0))} kcal / 100 g</span></span>
        </button>
        <button class="pf-edit" data-act="edit-food" data-id="${f.id}" aria-label="Edit food">✎</button>
      </div>`).join("")
    : `<div class="empty">No foods${q ? " match" : " yet — add one"}.</div>`;
}

function viewAddFood() {
  const af = state.addFood;
  if (!af) { go("nutrition"); return ""; }
  const title = slotTitle(af.slot);
  const mode = af.mode || "foods";
  const seg = (k, l) => `<button class="seg-btn ${mode === k ? "active" : ""}" data-act="addfood-mode" data-mode="${k}">${l}</button>`;

  let body = "";
  if (mode === "foods") {
    body = `<input class="picker-search" id="addfood-q" placeholder="Search foods…" value="${escAttr(af.q || "")}" data-act="addfood-q">
      <button class="add-ex-btn" data-act="new-food" style="margin-bottom:12px;">＋ New food</button>
      <div class="food-list">${addFoodRows()}</div>`;
  } else if (mode === "meals") {
    const rows = state.meals.length
      ? state.meals.map((m) => {
          const tot = sumTotals(m.items);
          return `<div class="pick-food">
            <button class="pick-food-main" data-act="log-meal" data-id="${m.id}">
              <span class="pf-name">${m.icon ? m.icon + " " : ""}${escAttr(m.name)}</span>
              <span class="pf-macro">${m.items.length} item${m.items.length !== 1 ? "s" : ""} · ${fmtNum(Math.round(tot.kcal))} kcal</span>
            </button>
            <button class="pf-edit" data-act="edit-meal" data-id="${m.id}" aria-label="Edit meal">✎</button>
          </div>`;
        }).join("")
      : `<div class="empty">No saved meals yet.</div>`;
    body = `<button class="add-ex-btn" data-act="new-meal" style="margin-bottom:12px;">＋ New meal</button>${rows}`;
  } else {
    const qk = af.quick;
    body = `<div class="finish-block"><span class="eyebrow">Name (optional)</span>
        <input class="picker-search" placeholder="e.g. Protein bar" value="${escAttr(qk.name || "")}" data-act="quick-name"></div>
      ${quickField("Calories", "kcal", qk.kcal)}
      ${quickField("Protein (g)", "protein", qk.protein)}
      ${quickField("Carbs (g)", "carbs", qk.carbs)}
      ${quickField("Fat (g)", "fat", qk.fat)}
      <button class="btn btn-primary" style="width:100%;margin-top:8px;" data-act="log-quick">Add to ${title}</button>`;
  }

  return `<div class="app">
    ${header({ back: true, backLabel: title })}
    <main>
      <div class="section-head"><span class="eyebrow">Add · ${title}</span></div>
      <div class="seg" style="margin-bottom:14px;">${seg("foods", "Foods")}${seg("meals", "Meals")}${seg("quick", "Quick add")}</div>
      ${body}
    </main>
  </div>`;
}

function viewFoodEdit() {
  const f = state.foodEdit;
  if (!f) { go("addfood"); return ""; }
  const editing = !!f.id;
  const field = (label, k, ph, attrs) => `<div class="finish-block"><span class="eyebrow">${label}</span>
    <input class="picker-search" ${attrs || 'type="text"'} value="${escAttr(f[k] == null ? "" : f[k])}" placeholder="${ph || ""}" data-act="food-field" data-field="${k}"></div>`;
  const numAttr = 'type="number" inputmode="decimal"';
  const imgRow = f.image
    ? `<div class="ex-img-edit"><img class="ex-img-preview" src="/api/file/${f.image}" alt="food"><button class="chip" data-act="food-img-remove">Remove</button></div>`
    : `<button class="add-ex-btn" data-act="food-img-pick" ${state.foodImageBusy ? "disabled style=opacity:0.5" : ""}>${state.foodImageBusy ? "Uploading…" : "＋ Add image"}</button>`;
  return `<div class="app">
    ${header({ back: true, backLabel: "Back" })}
    <main>
      <div class="section-head"><span class="eyebrow">${editing ? "Edit food" : "New food"}</span></div>
      ${field("Name", "name", "e.g. Greek yogurt")}
      <div class="eyebrow" style="margin:16px 2px 10px;">Per 100 g</div>
      <div class="macro-grid">
        ${field("Calories", "kcal", "0", numAttr)}
        ${field("Protein (g)", "protein", "0", numAttr)}
        ${field("Carbs (g)", "carbs", "0", numAttr)}
        ${field("Fat (g)", "fat", "0", numAttr)}
      </div>
      <div class="eyebrow" style="margin:16px 2px 10px;">Image</div>
      ${imgRow}
      <input type="file" accept="image/*" id="food-img-file" data-act="food-img-file" style="display:none">
    </main>
    <div class="footer">
      ${editing ? `<button class="btn btn-ghost" data-act="del-food" data-id="${f.id}">Delete</button>` : ""}
      <button class="btn btn-primary" data-act="save-food">${editing ? "Save" : "Add food"}</button>
    </div>
  </div>`;
}

function viewMealEdit() {
  const m = state.mealEdit;
  if (!m) { go("addfood"); return ""; }
  const editing = !!m.id;
  const tot = sumTotals(m.items);
  const items = m.items.map((it, i) => {
    const g = it.grams != null ? it.grams : DEFAULT_GRAMS;
    const kcal = Math.round((it.kcal || 0) * (it.grams != null ? g / 100 : (it.qty || 1)));
    const gramsCtl = it.grams != null
      ? `<div class="step-grp"><span class="lbl">grams</span>
          <button class="step-btn" data-act="meal-g-dec" data-i="${i}">−</button>
          <input class="step-val tnum" type="number" inputmode="numeric" value="${g}" data-act="meal-grams" data-i="${i}">
          <button class="step-btn" data-act="meal-g-inc" data-i="${i}">+</button></div>`
      : `<div class="step-grp"><span class="lbl">qty</span><input class="step-val tnum" type="number" inputmode="decimal" value="${it.qty || 1}" data-act="meal-qty" data-i="${i}"></div>`;
    return `<div class="ex-card expanded">
      <div class="ex-head"><span class="ex-name">${escAttr(it.name)}</span>
        <button class="ex-del" data-act="del-meal-item" data-i="${i}" aria-label="Remove">×</button></div>
      <div class="set-row"><div class="set-fields">
        ${gramsCtl}
        <span class="entry-kcal tnum" style="align-self:center;">${fmtNum(kcal)} kcal</span>
      </div></div>
    </div>`;
  }).join("");

  const q = (state.mealQ || "").toLowerCase();
  const foodList = state.foods.filter((f) => !q || f.name.toLowerCase().includes(q));
  const chooser = state.mealAddOpen
    ? `<div class="meal-chooser">
        <input class="picker-search" id="meal-q" placeholder="Search foods…" value="${escAttr(state.mealQ || "")}" data-act="meal-q">
        <button class="add-ex-btn" data-act="meal-new-food" style="margin-bottom:10px;">＋ New food</button>
        <div class="food-list">${foodList.length
          ? foodList.map((f) => `<button class="pick-food-main pick-food-img" data-act="meal-add-food" data-id="${f.id}">${foodThumb(f)}<span class="pf-txt"><span class="pf-name">${escAttr(f.name)}</span><span class="pf-macro">${fmtNum(Math.round(f.kcal || 0))} kcal / 100 g</span></span></button>`).join("")
          : `<div class="empty">No foods — create one.</div>`}</div>
      </div>`
    : `<button class="add-ex-btn" data-act="meal-add-open" style="margin-top:12px;">＋ Add food</button>`;

  const slotChips = NUTRI_SLOTS.map(([k, l]) => `<button class="chip ${m.slot === k ? "active" : ""}" data-act="meal-slot" data-slot="${k}">${l}</button>`).join("");
  const everydayBlock = `<div class="finish-block" style="margin-top:18px;">
    <div class="chip-row"><button class="chip ${m.everyday ? "active" : ""}" data-act="meal-everyday">${m.everyday ? "★ Every day" : "☆ Every day"}</button></div>
    ${m.everyday ? `<div class="eyebrow" style="margin:12px 2px 8px;">Default meal</div><div class="chip-row">${slotChips}</div>` : ""}
  </div>`;

  return `<div class="app">
    ${header({ back: true, backLabel: state.mealEditReturn === "nutrition" ? "Nutrition" : "Back" })}
    <main>
      <div class="section-head"><span class="eyebrow">${editing ? "Edit meal" : "New meal"} · ${fmtNum(Math.round(tot.kcal))} kcal</span></div>
      <div class="tpl-name-row">
        <input class="picker-search" style="margin:0;flex:0 0 3.2rem;text-align:center;" placeholder="🍳" value="${escAttr(m.icon || "")}" data-act="meal-icon" maxlength="2" aria-label="Icon">
        <input class="picker-search" style="margin:0;flex:1;" placeholder="Meal name" value="${escAttr(m.name || "")}" data-act="meal-name">
      </div>
      ${items}
      ${chooser}
      ${everydayBlock}
    </main>
    <div class="footer">
      <button class="btn btn-primary" data-act="save-meal">${editing ? "Save meal" : "Create meal"}</button>
    </div>
  </div>`;
}

/* ---- Nutrition overlays (sheets) ---- */
function entryEditSheet() {
  const e = state.entryEdit;
  if (!e) { return ""; }
  const x = entryTotals(e);
  const isFood = e.grams != null;
  const slotSeg = NUTRI_SLOTS.map(([k, l]) => `<button class="seg-btn ${e.slot === k ? "active" : ""}" data-act="entry-slot" data-slot="${k}">${l}</button>`).join("");
  const f = (label, k) => `<div class="step-grp narrow"><span class="lbl">${label}</span>
    <input class="step-val tnum" type="number" inputmode="decimal" value="${e[k] == null ? "" : e[k]}" data-act="entry-field" data-field="${k}" aria-label="${label}"></div>`;
  // Food entries adjust by grams (macros computed); quick-add entries edit macros directly.
  const amountBlock = isFood
    ? `<div class="finish-block"><span class="eyebrow">Amount (g)</span>
        <div class="set-fields"><div class="step-grp">
          <button class="step-btn" data-act="entry-g-dec">−</button>
          <input class="step-val tnum" type="number" inputmode="numeric" value="${e.grams}" data-act="entry-grams" aria-label="Grams">
          <button class="step-btn" data-act="entry-g-inc">+</button>
        </div></div>
        <div class="kcal-cap" style="margin-top:8px;">${fmtNum(Math.round(x.kcal))} kcal · P ${fmtNum(round1(x.protein))} · C ${fmtNum(round1(x.carbs))} · F ${fmtNum(round1(x.fat))}</div>
      </div>`
    : `<div class="finish-block"><span class="eyebrow">Totals</span>
        <div class="set-fields wrap">${f("kcal", "kcal")}${f("P", "protein")}${f("C", "carbs")}${f("F", "fat")}</div>
      </div>`;
  return `<div class="sheet-wrap" data-act="close-entry">
    <div class="sheet" data-act="noop">
      <div class="eyebrow" style="margin-bottom:12px;">${escAttr(e.name)}</div>
      ${amountBlock}
      <div class="finish-block"><span class="eyebrow">Meal</span><div class="seg wrap">${slotSeg}</div></div>
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="del-entry" data-id="${e.id}">Delete</button>
        <button class="btn btn-primary" data-act="save-entry">Save</button>
      </div>
    </div>
  </div>`;
}

function targetsSheet() {
  const t = state.targetEdit;
  if (!t) { return ""; }
  const f = (label, k) => `<div class="finish-block"><span class="eyebrow">${label}</span>
    <input class="picker-search" type="number" inputmode="decimal" placeholder="—" value="${escAttr(t[k] == null ? "" : t[k])}" data-act="target-field" data-field="${k}"></div>`;
  return `<div class="sheet-wrap" data-act="close-targets">
    <div class="sheet" data-act="noop">
      <div class="eyebrow" style="margin-bottom:12px;">Daily targets</div>
      ${f("Calories", "kcal")}${f("Protein (g)", "protein")}${f("Carbs (g)", "carbs")}${f("Fat (g)", "fat")}
      <div class="sheet-actions">
        <button class="btn btn-ghost" data-act="close-targets">Cancel</button>
        <button class="btn btn-primary" data-act="save-targets">Save</button>
      </div>
    </div>
  </div>`;
}

// Re-render just the food list (search) without losing input focus.
function refreshFoodList(containerSel, rowsFn) {
  const main = app.querySelector(containerSel);
  if (main) { main.innerHTML = rowsFn(); }
}

/* ============ Programs / rehab / events ============ */
const PROGRAM_KINDS = [["program", "Program", "\u{1F3CB}️"], ["rehab", "Rehab", "\u{1FA79}"], ["event", "Event", "\u{1F4C5}"]];
function programKind(k) { return PROGRAM_KINDS.find((x) => x[0] === k) || PROGRAM_KINDS[0]; }

function openPrograms() { go("programs"); }
function newProgram() {
  state.programEdit = { id: null, title: "", kind: "rehab", startDate: todayISO(), notes: "", filename: null, mime: null, fileBusy: false };
  go("progedit");
}
function editProgram(id) {
  const p = state.programs.find((x) => x.id === id);
  if (!p) { return; }
  state.programEdit = { id: p.id, title: p.title, kind: p.kind, startDate: p.startDate || "", notes: p.notes || "", filename: p.filename, mime: p.mime, fileBusy: false };
  go("progedit");
}
function openProgram(id) { state.programView = id; go("program"); }

async function onProgramFile(file) {
  if (!file) { return; }
  const isPdf = file.type === "application/pdf";
  if (!isPdf && !(file.type && file.type.startsWith("image/"))) { toast("PDF or image only"); return; }
  state.programEdit.fileBusy = true; render();
  try {
    const blob = isPdf ? file : await downscale(file);
    const fd = new FormData();
    fd.append("file", blob, isPdf ? "doc.pdf" : "image.jpg");
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    if (!r.ok) { throw new Error("upload failed"); }
    const out = await r.json();
    state.programEdit.filename = out.filename;
    state.programEdit.mime = out.mime;
  } catch (e) { toast("Upload failed"); }
  state.programEdit.fileBusy = false; render();
}

async function saveProgramEdit() {
  const p = state.programEdit;
  if (!(p.title || "").trim()) { toast("Add a title"); return; }
  let saved;
  try {
    saved = await apiPost("/api/programs", {
      id: p.id || undefined, title: p.title.trim(), kind: p.kind,
      startDate: p.startDate || null, notes: p.notes || "",
      filename: p.filename ?? null, mime: p.mime ?? null,
    });
  } catch (e) { toast("Couldn't save"); return; }
  const i = state.programs.findIndex((x) => x.id === saved.id);
  if (i >= 0) { state.programs[i] = saved; } else { state.programs.unshift(saved); }
  const wasEditing = !!p.id;
  state.programEdit = null;
  history.back();
  toast(wasEditing ? "Updated ✓" : "Saved ✓");
}
function deleteProgramById(id) {
  apiDelete("/api/programs", { id }).catch(() => {});
  state.programs = state.programs.filter((p) => p.id !== id);
  history.back();
}

function fmtDay(iso) {
  if (!iso) { return ""; }
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// pdf.js is loaded on demand (only when viewing a PDF program) to keep the
// initial bundle small. The worker is served from our own origin (CSP-safe).
let pdfjsLib = null;
async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist");
    // Bundle the worker (Vite ?worker) and hand it over as a port. More robust
    // across PWA/service-worker environments than pointing workerSrc at a URL.
    const PdfWorker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?worker")).default;
    pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker();
  }
  return pdfjsLib;
}

// Render every page of the current program's PDF into #pdf-doc as canvases.
async function renderProgramPdf() {
  const p = state.programs.find((x) => x.id === state.programView);
  if (!p || p.mime !== "application/pdf") { return; }
  const host = document.getElementById("pdf-doc");
  if (!host) { return; }
  const url = "/api/file/" + p.filename;
  try {
    const pdfjs = await getPdfjs();
    const doc = await pdfjs.getDocument(url).promise;
    if (state.view !== "program" || state.programView !== p.id) { return; }  // navigated away
    host.innerHTML = "";
    const cssWidth = host.clientWidth || 360;
    const dpr = window.devicePixelRatio || 1;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: (cssWidth / base.width) * dpr });
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page";
      canvas.width = vp.width;
      canvas.height = vp.height;
      canvas.style.width = "100%";
      host.appendChild(canvas);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e);
    try { console.error("PDF render failed:", e); } catch (_) { /* ignore */ }
    host.innerHTML = `<div class="empty">Couldn't render the PDF.<br><span style="font-size:0.78rem;opacity:0.8;">${escAttr(msg)}</span><br><a class="text-btn" href="${url}" target="_blank" rel="noopener">Open it ↗</a></div>`;
  }
}

function viewPrograms() {
  const cards = state.programs.map((p) => {
    const k = programKind(p.kind);
    return `<button class="tpl-card" data-act="open-program" data-id="${p.id}">
      <span class="tpl-ico">${k[2]}</span>
      <span class="tpl-body">
        <span class="tpl-name">${escAttr(p.title)}</span>
        <span class="tpl-meta">${k[1]}${p.startDate ? " · from " + fmtDay(p.startDate) : ""}${p.filename ? " · 📄" : ""}</span>
      </span>
      <span class="tpl-go">›</span>
    </button>`;
  }).join("");
  const body = state.programs.length
    ? `<div class="tpl-list">${cards}</div>`
    : `<div class="empty">No programs yet. Upload a training plan, rehab protocol, or event.</div>`;
  return `<div class="app">
    ${header({ back: true, backLabel: "Home" })}
    <main>
      <div class="section-head"><span class="eyebrow">Programs & rehab</span></div>
      ${body}
      <button class="add-ex-btn" data-act="new-program" style="margin-top:14px;">＋  Add program</button>
    </main>
  </div>`;
}

function viewProgram() {
  const p = state.programs.find((x) => x.id === state.programView);
  if (!p) { if (state.loaded) { go("programs"); return ""; } return loadingShell("Programs", "programs"); }
  const k = programKind(p.kind);
  let doc = "";
  if (p.filename) {
    if (p.mime === "application/pdf") {
      // Rendered to <canvas> by pdf.js (renderProgramPdf) — Android's webview won't
      // display a PDF in an <iframe>, so we draw it ourselves.
      doc = `<div class="pdf-doc" id="pdf-doc"><div class="empty">Loading PDF…</div></div>
        <a class="text-btn" style="display:block;text-align:center;margin-top:8px;" href="/api/file/${p.filename}" target="_blank" rel="noopener">Open full screen ↗</a>`;
    } else {
      doc = `<img class="doc-img" src="/api/file/${p.filename}" alt="${escAttr(p.title)}">`;
    }
  }
  return `<div class="app">
    ${header({ back: true, backLabel: "Programs" })}
    <main>
      <div class="section-head"><span class="eyebrow">${k[1]}</span>
        <button class="back-btn" data-act="edit-program" data-id="${p.id}">Edit ›</button></div>
      <div class="prog-title">${k[2]} ${escAttr(p.title)}</div>
      ${p.startDate ? `<div class="prog-meta">Starts ${fmtDay(p.startDate)}</div>` : ""}
      ${p.notes ? `<div class="prog-notes">${escAttr(p.notes)}</div>` : ""}
      ${doc || `<div class="empty" style="margin-top:14px;">No document attached.</div>`}
    </main>
  </div>`;
}

function viewProgramEdit() {
  const p = state.programEdit;
  if (!p) { go("programs"); return ""; }
  const editing = !!p.id;
  const kindChips = PROGRAM_KINDS.map(([k, label, ico]) =>
    `<button class="chip ${p.kind === k ? "active" : ""}" data-act="prog-kind" data-kind="${k}">${ico} ${label}</button>`
  ).join("");
  const fileRow = p.filename
    ? `<div class="ex-img-edit"><span class="pf-macro">${p.mime === "application/pdf" ? "📄 PDF attached" : "🖼️ Image attached"}</span>
        <button class="chip" data-act="prog-file-remove">Remove</button></div>`
    : `<button class="add-ex-btn" data-act="prog-file-pick" ${p.fileBusy ? "disabled style=opacity:0.5" : ""}>${p.fileBusy ? "Uploading…" : "＋ Attach PDF or image"}</button>`;
  return `<div class="app">
    ${header({ back: true, backLabel: editing ? "Back" : "Cancel" })}
    <main>
      <div class="section-head"><span class="eyebrow">${editing ? "Edit program" : "New program"}</span></div>
      <div class="finish-block"><span class="eyebrow">Title</span>
        <input class="picker-search" placeholder="e.g. Left knee ACL rehab" value="${escAttr(p.title || "")}" data-act="prog-title" autofocus></div>
      <div class="finish-block"><span class="eyebrow">Type</span><div class="chip-row">${kindChips}</div></div>
      <div class="finish-block"><span class="eyebrow">Start date</span>
        <input class="date-input" type="date" value="${p.startDate || ""}" data-act="prog-date"></div>
      <div class="finish-block"><span class="eyebrow">Notes</span>
        <textarea class="notes" data-act="prog-notes" placeholder="Anything to remember…">${escAttr(p.notes || "")}</textarea></div>
      <div class="finish-block"><span class="eyebrow">Document</span>${fileRow}</div>
      <input type="file" accept="application/pdf,image/*" id="program-file" data-act="program-file" style="display:none">
    </main>
    <div class="footer">
      ${editing ? `<button class="btn btn-ghost" data-act="del-program" data-id="${p.id}">Delete</button>` : ""}
      <button class="btn btn-primary" data-act="save-program">${editing ? "Save" : "Add program"}</button>
    </div>
  </div>`;
}

/* ============ Notes (date-bound journal) ============ */
function openNotes() { state.notesQ = ""; go("notes"); }
function newNote() {
  state.noteEdit = { id: null, day: todayISO(), text: "" };
  go("noteedit");
}
function editNote(id) {
  const n = state.notes.find((x) => x.id === id);
  if (!n) { return; }
  state.noteEdit = { id: n.id, day: n.day, text: n.text };
  go("noteedit");
}
async function saveNoteEdit() {
  const n = state.noteEdit;
  if (!(n.text || "").trim()) { toast("Write something first"); return; }
  let saved;
  try {
    saved = await apiPost("/api/notes", { id: n.id || undefined, day: n.day, text: n.text.trim() });
  } catch (e) { toast("Couldn't save note"); return; }
  const i = state.notes.findIndex((x) => x.id === saved.id);
  if (i >= 0) { state.notes[i] = saved; } else { state.notes.push(saved); }
  state.notes.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : b.createdAt - a.createdAt));
  const wasEditing = !!n.id;
  state.noteEdit = null;
  history.back();
  toast(wasEditing ? "Note updated ✓" : "Note saved ✓");
}
function deleteNoteById(id) {
  apiDelete("/api/notes", { id }).catch(() => {});
  state.notes = state.notes.filter((n) => n.id !== id);
  history.back();
}

function viewNotes() {
  const q = (state.notesQ || "").toLowerCase();
  const list = state.notes.filter((n) => !q || n.text.toLowerCase().includes(q));
  const cards = list.map((n) => `<button class="note-card" data-act="edit-note" data-id="${n.id}">
    <div class="note-date">${fmtDay(n.day)}</div>
    <div class="note-text">${escAttr(n.text)}</div>
  </button>`).join("");
  const body = state.notes.length
    ? `<input class="picker-search" placeholder="Search notes…" value="${escAttr(state.notesQ || "")}" data-act="notes-q">
       ${list.length ? `<div class="note-list">${cards}</div>` : `<div class="empty">No notes match.</div>`}`
    : `<div class="empty">No notes yet. Jot a daily status, how you felt, anything to look back on.</div>`;
  return `<div class="app">
    ${header({ back: true, backLabel: "Home" })}
    <main>
      <div class="section-head"><span class="eyebrow">Notes</span></div>
      ${body}
      <button class="add-ex-btn" data-act="new-note" style="margin-top:14px;">＋  Add note</button>
    </main>
  </div>`;
}

function viewNoteEdit() {
  const n = state.noteEdit;
  if (!n) { go("notes"); return ""; }
  const editing = !!n.id;
  return `<div class="app">
    ${header({ back: true, backLabel: "Notes" })}
    <main>
      <div class="section-head"><span class="eyebrow">${editing ? "Edit note" : "New note"}</span></div>
      <div class="finish-block"><span class="eyebrow">Date</span>
        <input class="date-input" type="date" value="${n.day}" data-act="note-date"></div>
      <div class="finish-block"><span class="eyebrow">Note</span>
        <textarea class="notes note-textarea" data-act="note-text" placeholder="How did today go?" autofocus>${escAttr(n.text || "")}</textarea></div>
    </main>
    <div class="footer">
      ${editing ? `<button class="btn btn-ghost" data-act="del-note" data-id="${n.id}">Delete</button>` : ""}
      <button class="btn btn-primary" data-act="save-note">${editing ? "Save" : "Add note"}</button>
    </div>
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
    case "nav-back": history.back(); break;
    case "menu-toggle": toggleDrawer(); break;
    case "logout":
      closeDrawer();
      state.confirm = {
        title: "Sign out?",
        body: "You'll be logged out of Foundry.",
        ok: "Sign out", danger: true,
        onOk: () => { window.location.href = "/logout"; },
      };
      render();
      break;
    case "confirm-ok": { const c = state.confirm; state.confirm = null; if (c && c.onOk) { c.onOk(); } else { render(); } break; }
    case "confirm-cancel": state.confirm = null; render(); break;
    case "history": go("history"); break;
    case "home": go("home"); break;
    case "active": go("active"); break;
    case "profile": go("profile"); break;
    case "photos": state.photoTag = null; go("photos"); break;
    case "gender": setGender(t.dataset.g); break;
    case "add-weigh": addWeighIn(); break;
    case "del-weigh": deleteWeighIn(parseInt(t.dataset.id, 10)); break;
    case "new-album": state.newAlbumOpen = true; render(); break;
    case "new-album-add": {
      const nm = (state.newAlbumName || "").trim();
      if (!nm) { state.newAlbumOpen = false; render(); break; }
      apiPost("/api/albums", { name: nm }).then((a) => {
        state.albums.unshift(a); state.newAlbumOpen = false; state.newAlbumName = "";
        state.albumId = a.id; go("album");
      }).catch(() => toast("Couldn't create album"));
      break;
    }
    case "open-album": state.albumId = t.dataset.id; state.photoTag = null; go("album"); break;
    case "photo-tag": state.photoTag = t.dataset.tag || null; render(); break;
    case "pick-photo": pickPhoto(); break;
    case "confirm-upload": confirmUpload(); break;
    case "cancel-upload": cancelUpload(); break;
    case "open-photo": state.viewPhotoId = t.dataset.id; render(); break;
    case "close-photo": state.viewPhotoId = null; render(); break;
    case "del-photo": deletePhotoById(t.dataset.id); break;
    case "noop": break;
    case "add-workout": state.newDate = null; go("choose"); break;
    case "start-empty": startWorkout(null, t.dataset.date ? parseInt(t.dataset.date, 10) : undefined); break;
    case "start-routine": startWorkout(state.routines.find((r) => r.id === t.dataset.id), t.dataset.date ? parseInt(t.dataset.date, 10) : undefined); break;
    case "start-template": startFromTemplate(state.templates.find((x) => x.id === t.dataset.id), t.dataset.date ? parseInt(t.dataset.date, 10) : undefined); break;
    case "templates": go("templates"); break;
    case "new-template": newTemplate(); break;
    case "edit-template": editTemplate(t.dataset.id); break;
    case "del-template": {
      const id = t.dataset.id;
      const tpl = state.templates.find((x) => x.id === id);
      state.confirm = {
        title: "Delete template?",
        body: tpl ? tpl.name : "",
        ok: "Delete", danger: true,
        onOk: () => deleteTemplateById(id),
      };
      render();
      break;
    }
    case "close-tpledit": { const back = state.templateReturn || "templates"; state.templateReturn = null; state.templateEdit = null; go(back); break; }
    case "add-tpl-ex": state.picker = { q: "", cat: "All", target: "template", backTo: "tpledit" }; go("picker"); break;
    case "del-tpl-entry": delTplEntry(parseInt(t.dataset.i, 10)); break;
    case "tpl-inc": bumpTplField(parseInt(t.dataset.i, 10), t.dataset.field, +1); break;
    case "tpl-dec": bumpTplField(parseInt(t.dataset.i, 10), t.dataset.field, -1); break;
    case "save-template": saveTemplateEdit(); break;
    case "save-as-template": saveActiveAsTemplate(); break;
    case "open-picker": state.picker = { q: "", cat: "All", target: "active", backTo: "active" }; go("picker"); break;
    case "open-finish": go("finish"); break;
    case "cancel":
      state.confirm = {
        title: "Discard workout?",
        body: "Nothing will be saved.",
        ok: "Discard", danger: true,
        onOk: () => cancelWorkout(),
      };
      render();
      break;
    case "pick":
      if (state.picker.target === "template") { addExerciseToTemplate(t.dataset.id); }
      else { addExerciseToActive(t.dataset.id); }
      break;
    case "set-cat": state.picker.cat = t.dataset.cat; render(); break;
    case "del-ex": delExercise(ei); break;
    case "toggle-expand": toggleExpand(ei); break;
    case "add-set": addSet(ei); break;
    case "del-set": delSet(ei, si); break;
    case "pace": setPace(ei, t.dataset.pace); break;
    case "inc": bumpField(ei, si, t.dataset.field, +1); break;
    case "dec": bumpField(ei, si, t.dataset.field, -1); break;
    case "edit-ex": openExerciseForm(t.dataset.id); break;
    case "ex-pain-toggle": toggleExPain(ei); break;
    case "ex-pain-cat": setExPainCat(ei, t.dataset.cat); break;
    case "ex-pain-level": setExPainLevel(ei, parseInt(t.dataset.v, 10)); break;
    case "ex-pain-clear": clearExPain(ei); break;
    case "ex-pain-new": openExPainNew(ei); break;
    case "ex-pain-new-add": addExPainNew(ei); break;
    case "ex-note-toggle": toggleExNote(ei); break;
    case "new-ex": openExerciseForm(null); break;
    case "close-create": {
      // The exercise form is a sub-state of the picker list when created there
      // (stay on picker); reached from another view (editing) it pops the stack.
      const ret = state.picker.editReturn || "picker";
      state.picker.creating = false;
      state.picker.editingId = null;
      if (ret === "picker") { render(); } else { history.back(); }
      break;
    }
    case "toggle-tag": toggleNewTag(t.dataset.m); break;
    case "add-tag": addNewTag(state.picker.newTagText); break;
    case "toggle-bodyweight": state.picker.newBodyweight = !state.picker.newBodyweight; render(); break;
    case "set-unit": state.picker.newUnit = t.dataset.unit; render(); break;
    case "ex-img-pick": { const el = document.getElementById("ex-img-file"); if (el) { el.click(); } break; }
    case "ex-img-remove": state.picker.newImage = null; render(); break;
    case "save-ex": saveExercise(); break;
    case "feel": state.active.feel = parseInt(t.dataset.v, 10); save(); render(); break;
    case "energy": state.active.energy = parseInt(t.dataset.v, 10); save(); render(); break;
    case "finish-pain-cat": focusFinishPain(t.dataset.cat); break;
    case "finish-pain-level": setFinishPainLevel(parseInt(t.dataset.v, 10)); break;
    case "finish-pain-remove": removeFinishPain(); break;
    case "finish-pain-new": openFinishPainNew(); break;
    case "finish-pain-new-add": addFinishPainNew(); break;
    case "set-theme": setActiveTheme(t.dataset.theme); break;
    case "theme-new": openFinishThemeNew(); break;
    case "theme-new-add": addFinishThemeNew(); break;
    case "save": finishWorkout(); break;
    case "repeat": repeatWorkout(state.workouts.find((x) => x.id === t.dataset.id)); break;
    case "detail": state.detailId = t.dataset.id; go("detail"); break;
    case "detail-theme": changeWorkoutTheme(t.dataset.id, t.dataset.theme); break;
    case "detail-theme-new": openDetailThemeNew(); break;
    case "detail-theme-new-add": addDetailThemeNew(t.dataset.id); break;
    case "cal-prev": calShift(-1); break;
    case "cal-next": calShift(+1); break;
    case "cal-day": state.detailId = t.dataset.id; go("detail"); break;
    case "cal-new": state.newDate = parseInt(t.dataset.date, 10); go("choose"); break;

    /* ---- Nutrition ---- */
    case "nutrition": openNutrition(); break;
    case "nutri-prev": nutritionShift(-1); break;
    case "nutri-next": nutritionShift(+1); break;
    case "edit-targets": openTargets(); break;
    case "close-targets": state.targetEdit = null; render(); break;
    case "save-targets": saveTargetsEdit(); break;
    case "add-food":
      state.addFood = { slot: t.dataset.slot, mode: "foods", q: "", quick: { name: "", kcal: "", protein: "", carbs: "", fat: "" } };
      go("addfood");
      break;
    case "addfood-mode": state.addFood.mode = t.dataset.mode; render(); break;
    case "log-food": logFood(state.foods.find((f) => f.id === t.dataset.id)); break;
    case "log-meal": logMeal(state.meals.find((m) => m.id === t.dataset.id)); break;
    case "log-quick": logQuick(); break;
    case "new-food": openFoodEdit(null, "addfood"); break;
    case "edit-food": openFoodEdit(t.dataset.id, "addfood"); break;
    case "close-foodedit": { const back = state.foodEditReturn || "addfood"; state.foodEdit = null; state.foodEditReturn = null; go(back); break; }
    case "save-food": saveFoodEdit(); break;
    case "del-food": {
      const id = t.dataset.id;
      const food = state.foods.find((f) => f.id === id);
      state.confirm = {
        title: "Delete food?",
        body: food ? food.name : "",
        ok: "Delete", danger: true,
        onOk: () => { deleteFoodById(id); state.foodEdit = null; state.foodEditReturn = null; history.back(); },
      };
      render();
      break;
    }
    case "new-meal": openMealEdit(null, "addfood"); break;
    case "edit-meal": openMealEdit(t.dataset.id, "addfood"); break;
    case "close-mealedit": { const back = state.mealEditReturn || "addfood"; state.mealEdit = null; state.mealEditReturn = null; go(back); break; }
    case "save-meal": saveMealEdit(); break;
    case "del-meal-item": delMealItem(parseInt(t.dataset.i, 10)); break;
    case "meal-g-inc": bumpMealGrams(parseInt(t.dataset.i, 10), +1); break;
    case "meal-g-dec": bumpMealGrams(parseInt(t.dataset.i, 10), -1); break;
    case "meal-add-open": state.mealAddOpen = true; render(); break;
    case "meal-add-food": addFoodToMeal(state.foods.find((f) => f.id === t.dataset.id)); break;
    case "meal-new-food": openFoodEdit(null, "mealedit"); break;
    case "meal-everyday": state.mealEdit.everyday = !state.mealEdit.everyday; if (state.mealEdit.everyday && !state.mealEdit.slot) { state.mealEdit.slot = "breakfast"; } render(); break;
    case "meal-slot": state.mealEdit.slot = t.dataset.slot; render(); break;
    case "add-daily": addDailyMeals(); break;
    case "food-img-pick": { const el = document.getElementById("food-img-file"); if (el) { el.click(); } break; }
    case "food-img-remove": state.foodEdit.image = null; render(); break;
    case "slot-save-meal": saveSlotAsMeal(t.dataset.slot); break;
    case "edit-entry": openEntryEdit(t.dataset.id); break;
    case "close-entry": state.entryEdit = null; render(); break;
    case "save-entry": saveEntryEdit(); break;
    case "del-entry": deleteEntry(t.dataset.id); break;
    case "entry-slot": state.entryEdit.slot = t.dataset.slot; render(); break;
    case "entry-g-inc": state.entryEdit.grams = Math.max(1, Math.round((numOrNull(state.entryEdit.grams) || 0) + 10)); render(); break;
    case "entry-g-dec": state.entryEdit.grams = Math.max(1, Math.round((numOrNull(state.entryEdit.grams) || 0) - 10)); render(); break;

    /* ---- Programs ---- */
    case "programs": openPrograms(); break;
    case "new-program": newProgram(); break;
    case "open-program": openProgram(t.dataset.id); break;
    case "edit-program": editProgram(t.dataset.id); break;
    case "save-program": saveProgramEdit(); break;
    case "prog-kind": state.programEdit.kind = t.dataset.kind; render(); break;
    case "prog-file-pick": { const el = document.getElementById("program-file"); if (el) { el.click(); } break; }
    case "prog-file-remove": state.programEdit.filename = null; state.programEdit.mime = null; render(); break;
    case "del-program": {
      const id = t.dataset.id;
      const prog = state.programs.find((x) => x.id === id);
      state.confirm = {
        title: "Delete program?",
        body: prog ? prog.title : "",
        ok: "Delete", danger: true,
        onOk: () => deleteProgramById(id),
      };
      render();
      break;
    }

    /* ---- Notes ---- */
    case "notes": openNotes(); break;
    case "new-note": newNote(); break;
    case "edit-note": editNote(t.dataset.id); break;
    case "save-note": saveNoteEdit(); break;
    case "del-note": {
      const id = t.dataset.id;
      state.confirm = { title: "Delete note?", ok: "Delete", danger: true, onOk: () => deleteNoteById(id) };
      render();
      break;
    }

    /* ---- Exercise info (from workout summary) ---- */
    case "ex-info": openExInfo(t.dataset.id); break;
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
  else if (act === "new-tag-text") { state.picker.newTagText = t.value; }
  else if (act === "dob") { state.profile.dob = t.value || null; persistProfile(); }
  else if (act === "height") { state.profile.height = t.value ? Number(t.value) : null; persistProfile(); }
  else if (act === "weigh-weight") { state.weighWeight = t.value; }
  else if (act === "weigh-date") { state.weighDate = t.value; }
  else if (act === "new-album-text") { state.newAlbumName = t.value; }
  else if (act === "up-caption") { if (state.pendingUpload) { state.pendingUpload.caption = t.value; } }
  else if (act === "up-tags") { if (state.pendingUpload) { state.pendingUpload.tags = t.value; } }
  else if (act === "ex-pain-new-text") { state.active.entries[parseInt(t.dataset.ei, 10)].painNewText = t.value; }
  else if (act === "finish-pain-new-text") { state.active.painNewText = t.value; }
  else if (act === "theme-new-text") { state.active.themeNewText = t.value; }
  else if (act === "detail-theme-new-text") { state.detailThemeNewText = t.value; }
  else if (act === "tpl-name") { state.templateEdit.name = t.value; }
  else if (act === "tpl-icon") { state.templateEdit.icon = t.value; }
  else if (act === "tpl-setfield") { setTplField(parseInt(t.dataset.i, 10), t.dataset.field, t.value); }
  else if (act === "nutri-date") { setNutritionDay(t.value); }
  else if (act === "addfood-q") { state.addFood.q = t.value; refreshFoodList(".food-list", addFoodRows); }
  else if (act === "quick-name") { state.addFood.quick.name = t.value; }
  else if (act === "quick-field") { state.addFood.quick[t.dataset.field] = t.value; }
  else if (act === "food-field") { state.foodEdit[t.dataset.field] = t.value; }
  else if (act === "meal-name") { state.mealEdit.name = t.value; }
  else if (act === "meal-icon") { state.mealEdit.icon = t.value; }
  else if (act === "meal-q") {
    state.mealQ = t.value;
    refreshFoodList(".meal-chooser .food-list", () => {
      const q = (state.mealQ || "").toLowerCase();
      const list = state.foods.filter((f) => !q || f.name.toLowerCase().includes(q));
      return list.length
        ? list.map((f) => `<button class="pick-food-main" data-act="meal-add-food" data-id="${f.id}"><span class="pf-name">${escAttr(f.name)}</span><span class="pf-macro">${fmtNum(Math.round(f.kcal || 0))} kcal</span></button>`).join("")
        : `<div class="empty">No foods — create one.</div>`;
    });
  }
  else if (act === "meal-qty") { state.mealEdit.items[parseInt(t.dataset.i, 10)].qty = numOrNull(t.value) || 1; }
  else if (act === "meal-grams") { state.mealEdit.items[parseInt(t.dataset.i, 10)].grams = numOrNull(t.value) || 0; }
  else if (act === "entry-qty") { state.entryEdit.qty = t.value; }
  else if (act === "entry-grams") { state.entryEdit.grams = t.value; }
  else if (act === "entry-field") { state.entryEdit[t.dataset.field] = t.value; }
  else if (act === "target-field") { state.targetEdit[t.dataset.field] = t.value; }
  else if (act === "prog-title") { state.programEdit.title = t.value; }
  else if (act === "prog-date") { state.programEdit.startDate = t.value; }
  else if (act === "prog-notes") { state.programEdit.notes = t.value; }
  else if (act === "notes-q") {
    state.notesQ = t.value;
    refreshFoodList(".note-list", () => {
      const q = (state.notesQ || "").toLowerCase();
      const list = state.notes.filter((n) => !q || n.text.toLowerCase().includes(q));
      return list.map((n) => `<button class="note-card" data-act="edit-note" data-id="${n.id}"><div class="note-date">${fmtDay(n.day)}</div><div class="note-text">${escAttr(n.text)}</div></button>`).join("");
    });
  }
  else if (act === "note-date") { state.noteEdit.day = t.value; }
  else if (act === "note-text") { state.noteEdit.text = t.value; }
  else if (act === "wdate" && t.value) {
    const [y, m, d] = t.value.split("-").map(Number);
    state.active.startedAt = new Date(y, m - 1, d, 12).getTime();
    state.active.manual = !isToday(state.active.startedAt);
    save();
  }
  else if (act === "detail-date" && t.value) {
    const [y, m, d] = t.value.split("-").map(Number);
    changeWorkoutDate(t.dataset.id, new Date(y, m - 1, d, 12).getTime());
  }
  else if (act === "setfield") {
    const ei = parseInt(t.dataset.ei, 10), si = parseInt(t.dataset.si, 10);
    setField(ei, si, t.dataset.field, t.value);
    // Walk distance is derived from the typed duration; refresh the estimate in
    // place so we don't re-render (which would steal focus from the input).
    const entry = state.active && state.active.entries[ei];
    if (entry && t.dataset.field === "duration" && isPaced(exById(entry.exerciseId))) {
      const est = t.closest(".ex-card") && t.closest(".ex-card").querySelector(".est-dist");
      if (est) { est.textContent = "≈ " + entry.sets[si].distance + " km"; }
    }
  }
});

// File input fires "change", not "input".
app.addEventListener("change", (e) => {
  const t = e.target.closest("[data-act]");
  if (t && t.dataset.act === "photo-file") {
    onPhotoFile(t.files);
    t.value = ""; // allow re-picking the same file(s)
  } else if (t && t.dataset.act === "ex-img-file") {
    onExerciseImage(t.files && t.files[0]);
    t.value = "";
  } else if (t && t.dataset.act === "program-file") {
    onProgramFile(t.files && t.files[0]);
    t.value = "";
  } else if (t && t.dataset.act === "food-img-file") {
    onFoodImage(t.files && t.files[0]);
    t.value = "";
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
const KNOWN_VIEWS = ["home", "choose", "active", "picker", "finish", "history", "detail", "profile", "photos", "album", "templates", "tpledit", "nutrition", "addfood", "foodedit", "mealedit", "programs", "program", "progedit", "notes", "noteedit", "exinfo"];
const EPHEMERAL_VIEWS = ["tpledit", "addfood", "foodedit", "mealedit", "progedit", "program", "noteedit", "exinfo"];  // depend on non-persisted state
async function boot() {
  buildDrawer();
  buildPtr();
  if (state.view === "active" && !state.active) { state.view = "home"; }
  // Transient editor views depend on ephemeral (non-persisted) state; a reload
  // lands them safely. Also maps any legacy view name (e.g. "newday") home.
  if (!KNOWN_VIEWS.includes(state.view) || EPHEMERAL_VIEWS.includes(state.view)) { state.view = "home"; }
  // Seed the history stack: a "home" entry underneath, then the restored view,
  // so the phone Back button walks back to Home instead of exiting the app.
  replaceState("", { v: "home" });
  if (state.view !== "home") { pushState("", { v: state.view }); }
  navReady = true;
  render(); // paint immediately from draft (offline-friendly)
  try {
    const data = await apiGet("/api/data");
    state.exercises = data.exercises;
    state.painCategories = data.painCategories;
    state.muscleGroups = data.muscleGroups || [];
    state.workouts = data.workouts;
    state.workoutThemes = data.workoutThemes || [];
    state.templates = data.templates || [];
    state.programs = data.programs || [];
    state.notes = data.notes || [];
    state.foods = data.foods || [];
    state.meals = data.meals || [];
    state.profile = data.profile || state.profile;
    if (!state.profile.targets) { state.profile.targets = { kcal: null, protein: null, carbs: null, fat: null }; }
    state.bodyWeights = data.bodyWeights || [];
    state.albums = data.albums || [];
    state.photos = data.photos || [];
    state.loaded = true;
    render();
    if (state.view === "nutrition") { loadDayLog(); }
  } catch (e) {
    toast("Offline — showing cached view");
  }
}
/* ---- Drag to reorder exercises (pointer-based, touch-friendly) ---- */
let drag = null;
app.addEventListener("pointerdown", (e) => {
  const h = e.target.closest("[data-drag]");
  if (!h || state.view !== "active" || !state.active) { return; }
  const card = h.closest(".ex-card");
  const container = card && card.parentElement;
  if (!card || !container) { return; }
  e.preventDefault();
  const cardEls = Array.from(container.querySelectorAll(".ex-card"));
  const dragIndex = cardEls.indexOf(card);
  const rects = cardEls.map((el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; });
  drag = { dragIndex, newIndex: dragIndex, el: card, count: cardEls.length, mids: rects, startY: e.clientY };
  card.classList.add("dragging");
  try { h.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
document.addEventListener("pointermove", (e) => {
  if (!drag) { return; }
  drag.el.style.transform = `translateY(${e.clientY - drag.startY}px)`;
  let ni = 0;
  drag.mids.forEach((mid, i) => { if (i !== drag.dragIndex && e.clientY > mid) { ni++; } });
  drag.newIndex = Math.max(0, Math.min(drag.count - 1, ni));
});
function endDrag(commit) {
  if (!drag) { return; }
  const { dragIndex, newIndex, el } = drag;
  el.classList.remove("dragging");
  el.style.transform = "";
  drag = null;
  if (commit && newIndex !== dragIndex && state.active) {
    const arr = state.active.entries;
    arr.splice(newIndex, 0, arr.splice(dragIndex, 1)[0]);
    save();
  }
  render();
}
document.addEventListener("pointerup", () => endDrag(true));
document.addEventListener("pointercancel", () => endDrag(false));

// Phone/browser Back button: SvelteKit updates $page.state on back/forward. We
// react here — close an open overlay first, else move to the popped view.
let navReady = false;
page.subscribe((p) => {
  if (!navReady) { return; }
  const v = p.state && p.state.v;
  if (!v || v === state.view) { return; }   // our own pushState / no change → ignore
  if (closeTopOverlay()) {
    pushState("", { v: state.view });         // consume the Back press, stay put
    return;
  }
  // Workout-flow screens are meaningless once the session is gone (saved/discarded).
  const target = (v === "active" || v === "finish" || v === "picker") && !state.active ? "home" : v;
  state.view = target;
  closeDrawer();
  save();
  render();
  window.scrollTo(0, 0);
});

// Finger-following drawer swipe. Start within EDGE px of the left edge (drawer
// closed) or anywhere while it's open; the panel tracks the finger, then snaps
// open/closed on release based on how far it was dragged.
const DRAWER_EDGE = 48;
let dw = null;
document.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1 || !drawerEl) { dw = null; return; }
  const x = e.touches[0].clientX, y = e.touches[0].clientY;
  const open = drawerIsOpen();
  if (!open && x > DRAWER_EDGE) { dw = null; return; }
  dw = { x0: x, y0: y, open, decided: false, horizontal: false, tx: open ? 0 : -1, panel: null, scrim: null, w: 0 };
}, { passive: true });
document.addEventListener("touchmove", (e) => {
  if (!dw) { return; }
  const x = e.touches[0].clientX, y = e.touches[0].clientY;
  const dx = x - dw.x0, dy = y - dw.y0;
  if (!dw.decided) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) { return; }
    dw.horizontal = Math.abs(dx) > Math.abs(dy);
    dw.decided = true;
    if (!dw.horizontal) { dw = null; return; }  // vertical → let the page scroll
    dw.panel = drawerEl.querySelector(".drawer-panel");
    dw.scrim = drawerEl.querySelector(".drawer-scrim");
    dw.w = dw.panel.offsetWidth;
    drawerEl.classList.add("dragging", "open");
  }
  const w = dw.w;
  let tx = dw.open ? Math.min(0, dx) : Math.max(-w, -w + Math.max(0, dx));
  tx = Math.max(-w, Math.min(0, tx));
  dw.tx = tx;
  dw.panel.style.transform = `translateX(${tx}px)`;
  dw.scrim.style.opacity = String(1 + tx / w);
}, { passive: true });
document.addEventListener("touchend", () => {
  if (!dw) { return; }
  const d = dw; dw = null;
  if (!d.decided || !d.horizontal) { return; }
  drawerEl.classList.remove("dragging");
  if (d.tx > -d.w / 2) { drawerEl.classList.add("open"); } else { drawerEl.classList.remove("open"); }
  d.panel.style.transform = "";
  d.scrim.style.opacity = "";
}, { passive: true });

/* ---- Pull-to-refresh (native is disabled by overscroll-behavior) ---- */
let ptrEl = null;
let ptr = null;
const PTR_MAX = 110, PTR_TRIGGER = 70;
function buildPtr() {
  ptrEl = document.createElement("div");
  ptrEl.className = "ptr";
  ptrEl.innerHTML = `<span class="ptr-spin">↻</span>`;
  document.body.appendChild(ptrEl);
}
function anyOverlay() {
  return drawerIsOpen() || state.confirm || state.entryEdit || state.targetEdit || state.pendingUpload || state.viewPhotoId;
}
document.addEventListener("touchstart", (e) => {
  if (e.touches.length !== 1 || drag || anyOverlay()) { ptr = null; return; }
  if (e.target.closest("[data-drag]")) { ptr = null; return; }        // exercise reorder
  if ((window.scrollY || document.documentElement.scrollTop || 0) > 0) { ptr = null; return; }
  ptr = { y0: e.touches[0].clientY, pull: 0, active: false };
}, { passive: true });
document.addEventListener("touchmove", (e) => {
  if (!ptr) { return; }
  const dy = e.touches[0].clientY - ptr.y0;
  if (dy <= 0 && !ptr.active) { ptr = null; return; }
  ptr.active = true;
  ptr.pull = Math.min(Math.max(0, dy), PTR_MAX);
  ptrEl.style.transition = "none";
  ptrEl.style.transform = `translateX(-50%) translateY(${ptr.pull}px)`;
  ptrEl.style.opacity = String(Math.min(1, ptr.pull / PTR_TRIGGER));
  ptrEl.classList.toggle("ready", ptr.pull >= PTR_TRIGGER);
}, { passive: true });
document.addEventListener("touchend", () => {
  if (!ptr) { return; }
  const trigger = ptr.pull >= PTR_TRIGGER;
  ptr = null;
  ptrEl.style.transition = "";
  if (trigger) {
    ptrEl.classList.add("spinning");
    ptrEl.style.transform = `translateX(-50%) translateY(${PTR_TRIGGER}px)`;
    location.reload();
  } else {
    ptrEl.style.transform = "translateX(-50%) translateY(-100%)";
    ptrEl.style.opacity = "0";
    ptrEl.classList.remove("ready");
  }
}, { passive: true });

boot();

export {}; // mark as a module (side-effect import from +page.svelte)
