/* Datatilt-SuiviConsultant v2 — missions, affectations récurrentes, saisie au jour */
(function () {
"use strict";

const CFG = window.APP_CONFIG || {};
const DAY = 864e5;
const TYPES = {
  BUILD:   { label: "BUILD", color: "var(--t-build)" },
  RUN:     { label: "RUN · TMA", color: "var(--t-run)" },
  AVV:     { label: "Avant-vente / POC IA", color: "var(--t-avv)" },
  INTERNE: { label: "Interne / formation", color: "var(--t-int)" },
  ABSENCE: { label: "Absence / congés", color: "var(--t-abs)" }
};
const TYPE_ORDER = ["BUILD", "RUN", "AVV", "INTERNE", "ABSENCE"];
const WORK_TYPES = ["BUILD", "RUN", "AVV", "INTERNE"];
const SKILLS = ["Planning Analytics", "BOARD", "Watson Orchestrate", "Gestion de projet"];
const ROLES = ["Consultant", "Consultant senior", "Manager", "Directeur de projet"];
const TARGET_BILL = CFG.TARGET_BILLABLE || 0.8;
const STALE_DAYS = CFG.STALE_DAYS || 14;
const DOMAINS = (CFG.ALLOWED_DOMAINS || []).map(d => d.toLowerCase());
const WD = ["L", "M", "M", "J", "V"];
const WD_SHORT = ["lun.", "mar.", "mer.", "jeu.", "ven."];
const ALL_WD = [1, 2, 3, 4, 5];
const HORIZONS = [3, 8, 12];

const state = {
  tab: null, h: 3, prob: true, group: "", filter: "", mFilter: "actives",
  planMember: null, planOffset: 0, weekOffset: 0,
  me: { id: null, email: "", isAdmin: false },
  members: [], groups: [], claims: [], missions: [], assign: [], entries: [], status: {}, admins: [],
  consultants: [], loaded: false
};
try {
  const h = +localStorage.getItem("pdc.h2"); if (HORIZONS.includes(h)) state.h = h;
  const p = localStorage.getItem("pdc.prob"); if (p !== null) state.prob = p === "1";
  state.group = localStorage.getItem("pdc.g") || "";
} catch (e) {}

const $ = id => document.getElementById(id);
const main = () => $("main");

/* ================= thème clair / sombre ================= */
const THEMES = {
  auto:  { next: "light", label: "Auto",   icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>' },
  light: { next: "dark",  label: "Clair",  icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' },
  dark:  { next: "auto",  label: "Sombre", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>' }
};
let theme = "auto";
try { const t = localStorage.getItem("pdc.theme"); if (THEMES[t]) theme = t; } catch (e) {}
function applyTheme() {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme"); else document.documentElement.setAttribute("data-theme", theme);
  const b = $("themeBtn"); if (!b) return;
  b.innerHTML = `${THEMES[theme].icon}<span>${THEMES[theme].label}</span>`;
  b.setAttribute("aria-label", `Thème : ${THEMES[theme].label}. Cliquer pour passer en ${THEMES[THEMES[theme].next].label.toLowerCase()}`);
}
applyTheme();
document.getElementById("themeBtn")?.addEventListener("click", () => { theme = THEMES[theme].next; try { localStorage.setItem("pdc.theme", theme); } catch (e) {} applyTheme(); });

if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("VOTRE-PROJET") || !window.supabase) {
  main().innerHTML = `<div class="panel state"><h2>Configuration manquante</h2><p>Renseigne SUPABASE_URL et SUPABASE_ANON_KEY dans le fichier <code>config.js</code> (voir README).</p></div>`;
  return;
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

/* ================= dates ================= */
const n0 = new Date(); const TODAY = Date.UTC(n0.getFullYear(), n0.getMonth(), n0.getDate());
const parse = s => { if (!s) return NaN; const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
const iso = t => new Date(t).toISOString().slice(0, 10);
const monday = t => { const d = new Date(t).getUTCDay(); return t - ((d + 6) % 7) * DAY; };
const isoWeek = t => { const m = monday(t); const y = new Date(m + 3 * DAY).getUTCFullYear(); return 1 + Math.round((m - monday(Date.UTC(y, 0, 4))) / (7 * DAY)); };
const frDate = t => !isFinite(t) ? "–" : new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const frLong = t => new Date(t).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const wdIdx = t => new Date(t).getUTCDay();
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return Date.UTC(y, mo - 1, da); }
const holCache = {};
function holidays(y) { if (holCache[y]) return holCache[y]; const e = easter(y); const s = new Set([[0, 1], [4, 1], [4, 8], [6, 14], [7, 15], [10, 1], [10, 11], [11, 25]].map(([m, d]) => Date.UTC(y, m, d))); [1, 39, 50].forEach(o => s.add(e + o * DAY)); return holCache[y] = s; }
const isHoliday = t => holidays(new Date(t).getUTCFullYear()).has(t);
function isWorkday(t) { const d = wdIdx(t); return d >= 1 && d <= 5 && !isHoliday(t); }
function workdaysBetween(a, b, max = 400) { const out = []; for (let t = a; t <= b && out.length < max; t += DAY) if (isWorkday(t)) out.push(t); return out; }
const weeks = n => { const m0 = monday(TODAY); return Array.from({ length: n }, (_, i) => m0 + i * 7 * DAY); };
function threeWeeks(start) { const out = []; for (let w = 0; w < 3; w++) for (let i = 0; i < 5; i++) out.push(start + (w * 7 + i) * DAY); return out; }

/* ================= helpers ================= */
const pct = x => x == null || !isFinite(x) ? "–" : Math.round(x * 100) + " %";
const d1 = x => (Math.round(x * 10) / 10).toLocaleString("fr-FR");
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const memberById = id => state.members.find(m => m.id === id);
const groupName = id => (state.groups.find(g => g.id === id) || {}).name || "Sans groupe";
const cName = id => (memberById(id) || {}).name || "—";
const isAdmin = () => state.me.isAdmin;
const myMember = () => state.me.id ? state.members.find(m => m.user_id === state.me.id) : null;
const canEditMember = m => !!m && (isAdmin() || (state.me.id && m.user_id === state.me.id));
const initials = s => (String(s || "?").split(/[@.\s_-]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("") || "?").toUpperCase();
const missionById = id => IDX.mission[id];
const missionLabel = m => !m ? "Mission supprimée" : (m.client ? `${m.client} · ${m.name}` : m.name);
const missionEnd = m => m && m.end_date ? parse(m.end_date) : Infinity;
const missionStart = m => m && m.start_date ? parse(m.start_date) : -Infinity;
function aStart(a) { return Math.max(parse(a.start_date), missionStart(missionById(a.mission_id))); }
function aEnd(a) { return Math.min(a.end_date ? parse(a.end_date) : Infinity, missionEnd(missionById(a.mission_id))); }
function periodTxt(a) {
  const e = aEnd(a);
  const tail = a.end_date ? frDate(parse(a.end_date)) : (isFinite(e) ? `fin de mission (${frDate(e)})` : "fin de mission");
  return `${frDate(aStart(a))} → ${tail}`;
}
const wdTxt = w => { w = (w && w.length ? w : ALL_WD).slice().sort(); return w.length === 5 ? "Lun → ven" : w.map(i => WD_SHORT[i - 1]).join(" "); };
const typeTag = t => `<span class="tag"><i class="sw" style="background:${TYPES[t]?.color}"></i>${TYPES[t]?.label || esc(t)}</span>`;
const statusPill = m => !m || m.type === "ABSENCE" ? "" : `<span class="pill ${m.status === "probable" ? "probable" : "ferme"}">${m.status === "probable" ? "Probable" : "Ferme"}</span>`;
const missionSort = (a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || missionLabel(a).localeCompare(missionLabel(b), "fr");
function lastUpdate(mid) { const p = state.status[mid]; if (!p) return null; const t = Math.max(parse(p.updated_at) || 0, parse(p.confirmed_at) || 0); return t || null; }
function freshness(m) { const t = lastUpdate(m.id); if (!t) return { cls: "never", days: null, label: "Jamais mis à jour" }; const d = Math.round((TODAY - t) / DAY); return { cls: d > STALE_DAYS ? "stale" : "", days: d, label: d <= 0 ? "Mis à jour aujourd'hui" : `Mis à jour il y a ${d} j` }; }

/* ================= calcul ================= */
let IDX = { mission: {}, assign: {}, entries: {} };
let CACHE = new Map();
function reindex() {
  IDX = { mission: {}, assign: {}, entries: {} };
  for (const m of state.missions) IDX.mission[m.id] = m;
  for (const a of state.assign) (IDX.assign[a.member_id] = IDX.assign[a.member_id] || []).push(a);
  for (const e of state.entries) { const k = e.member_id + "|" + e.day; (IDX.entries[k] = IDX.entries[k] || []).push(e); }
  CACHE = new Map();
}
/* Ce que fait un consultant un jour donné : ajustement du jour s'il existe, sinon ses affectations récurrentes.
   Les absences récurrentes suspendent les missions au prorata. */
function partsFor(mid, t, ignoreEntries) {
  const ex = ignoreEntries ? null : IDX.entries[mid + "|" + iso(t)];
  if (ex && ex.length) return { explicit: true, parts: ex.filter(e => e.mission_id && missionById(e.mission_id)).map(e => ({ m: missionById(e.mission_id), pct: +e.pct })) };
  const wd = wdIdx(t); const parts = [];
  for (const a of IDX.assign[mid] || []) {
    const m = missionById(a.mission_id); if (!m) continue;
    if (t < aStart(a) || t > aEnd(a)) continue;
    if (!(a.weekdays && a.weekdays.length ? a.weekdays : ALL_WD).includes(wd)) continue;
    parts.push({ m, pct: +a.pct, a });
  }
  const abs = Math.min(100, parts.filter(p => p.m.type === "ABSENCE").reduce((s, p) => s + p.pct, 0));
  if (abs > 0) for (const p of parts) if (p.m.type !== "ABSENCE") p.pct = p.pct * (100 - abs) / 100;
  return { explicit: false, parts };
}
function finish(r) {
  r.abs = Math.min(r.abs, r.days); r.net = r.days - r.abs;
  r.staffed = r.BUILD + r.RUN + r.AVV + r.INTERNE; r.bill = r.BUILD + r.RUN;
  r.load = r.net > 0.01 ? r.staffed / r.net : null; r.free = Math.max(0, r.net - r.staffed);
  return r;
}
function dayCell(mid, t, incl) {
  if (!isWorkday(t)) return null;
  const key = mid + "|" + t + "|" + (incl ? 1 : 0);
  if (CACHE.has(key)) return CACHE.get(key);
  const { explicit, parts } = partsFor(mid, t);
  const r = { days: 1, abs: 0, BUILD: 0, RUN: 0, AVV: 0, INTERNE: 0, prob: 0, explicit, parts };
  for (const p of parts) {
    const v = p.pct / 100;
    if (p.m.type === "ABSENCE") { r.abs += v; continue; }
    if (p.m.status === "probable") { r.prob += v; if (!incl) continue; }
    r[p.m.type] += v;
  }
  finish(r); CACHE.set(key, r); return r;
}
function weekCell(mid, mon, incl) {
  const r = { days: 0, abs: 0, BUILD: 0, RUN: 0, AVV: 0, INTERNE: 0, prob: 0, explicit: false };
  for (let i = 0; i < 5; i++) {
    const c = dayCell(mid, mon + i * DAY, incl); if (!c) continue;
    r.days++; r.abs += c.abs; r.prob += c.prob; WORK_TYPES.forEach(k => r[k] += c[k]); if (c.explicit) r.explicit = true;
  }
  return finish(r);
}
function columns() {
  if (state.h === 3) return threeWeeks(monday(TODAY)).map(t => ({ t, kind: "day" }));
  return weeks(state.h).map(t => ({ t, kind: "week" }));
}
const cellAt = (mid, col, incl = state.prob) => col.kind === "day" ? dayCell(mid, col.t, incl) : weekCell(mid, col.t, incl);
function horizonDays() { const m0 = monday(TODAY); return workdaysBetween(m0, m0 + state.h * 7 * DAY - DAY); }
function band(r) { if (!r || r.days === 0) return "hol"; if (r.load == null) return "abs"; if (r.load > 1.001) return "over"; if (r.load >= .85) return "ok"; if (r.load >= .5) return "mid"; return "low"; }
function rebuild() { state.consultants = state.members.filter(m => !state.group || m.group_id === state.group); }

/* ================= KPI ================= */
function kpis() {
  const D = horizonDays(); let net = 0, staffed = 0, bill = 0, avv = 0, free = 0, prob = 0, over = 0, freeWeek = 0; const inter = [];
  for (const c of state.consultants) {
    for (const t of D) { const r = dayCell(c.id, t, state.prob); net += r.net; staffed += r.staffed; bill += r.bill; avv += r.AVV; free += r.free; prob += r.prob; if (r.load != null && r.load > 1.001) over++; }
    const w = weekCell(c.id, monday(TODAY), state.prob); freeWeek += w.free; if (w.load != null && w.load < 0.5) inter.push(c.name);
  }
  const fresh = state.consultants.filter(c => { const f = freshness(c); return f.days != null && f.days <= STALE_DAYS; }).length;
  return { occ: net ? staffed / net : null, bill: net ? bill / net : null, avvShare: staffed ? avv / staffed : null, free, freeWeek, prob, over, inter, fresh, total: state.consultants.length };
}
function renderKpis(k) {
  const billCls = k.bill == null ? "" : k.bill >= TARGET_BILL ? "good" : k.bill >= TARGET_BILL - .15 ? "warn" : "bad";
  const fr = k.total ? k.fresh / k.total : 1;
  const tile = (label, v, cls, sub, extra = "") => `<div class="kpi"><span class="eyebrow">${label}</span><span class="v ${cls}">${v}</span>${extra}<span class="s">${sub}</span></div>`;
  const g = k.bill == null ? "" : `<div class="gauge" aria-hidden="true"><i style="width:${Math.min(100, k.bill * 100)}%"></i><b style="left:${TARGET_BILL * 100}%"></b></div>`;
  return `<section class="kpis" aria-label="Indicateurs">
    ${tile("Taux facturable", pct(k.bill), billCls, `BUILD + RUN · objectif ${Math.round(TARGET_BILL * 100)} %`, g)}
    ${tile("Taux d'occupation", pct(k.occ), "", `dont ${pct(k.avvShare)} en avant-vente IA`)}
    ${tile("Jours disponibles", d1(k.free), "", `${d1(k.freeWeek)} j cette semaine · ${d1(k.prob)} j probables ${state.prob ? "inclus" : "exclus"}`)}
    ${tile("Intercontrat", k.inter.length, k.inter.length ? "warn" : "good", k.inter.length ? esc(k.inter.slice(0, 3).join(", ")) + (k.inter.length > 3 ? "…" : "") : "Personne sous 50 % cette semaine")}
    ${tile("Surcharges", k.over, k.over ? "bad" : "good", k.over ? "jours-consultant au-delà de 100 %" : "Aucun jour au-delà de 100 %")}
    ${tile("Plannings à jour", `${k.fresh}/${k.total}`, fr >= .8 ? "good" : fr >= .5 ? "warn" : "bad", `confirmés il y a moins de ${STALE_DAYS} j`)}
  </section>`;
}

/* ================= alertes ================= */
function alerts() {
  const out = []; const D = horizonDays();
  if (isAdmin() && state.claims.length) out.push({ lvl: "info", w: 5, t: `<strong>${state.claims.length} demande${state.claims.length > 1 ? "s" : ""} de rattachement</strong> à valider`, m: "Onglet Administration" });
  const ids = new Set(state.consultants.map(c => c.id));
  for (const c of state.consultants) {
    let i = 0;
    while (i < D.length) {
      const r = dayCell(c.id, D[i], state.prob);
      if (r.load != null && r.load > 1.001) {
        let j = i, mx = 0, both = false;
        while (j < D.length) { const rj = dayCell(c.id, D[j], state.prob); if (!(rj.load != null && rj.load > 1.001)) break; mx = Math.max(mx, rj.load); if (rj.AVV > 0 && rj.RUN > 0) both = true; j++; }
        out.push({ lvl: "bad", w: 3, t: `<strong>${esc(c.name)}</strong> en surcharge (${pct(mx)}) ${j - i > 1 ? `du ${frDate(D[i])} au ${frDate(D[j - 1])}` : `le ${frDate(D[i])}`}`, m: both ? "TMA et avant-vente IA le même jour : l'avant-vente risque de sauter" : "Arbitrer ou décaler une affectation" });
        i = j;
      } else i++;
    }
    const w0 = weekCell(c.id, monday(TODAY), state.prob), w1 = weekCell(c.id, monday(TODAY) + 7 * DAY, state.prob);
    if (w0.load != null && w1.load != null && w0.load < .5 && w1.load < .5) out.push({ lvl: "warn", w: 2, t: `<strong>${esc(c.name)}</strong> sous 50 % sur les 2 prochaines semaines`, m: `${d1(w0.free + w1.free)} j libres · à positionner sur avant-vente ou mission` });
  }
  const seen = new Set();
  for (const a of state.assign) {
    const m = missionById(a.mission_id); if (!ids.has(a.member_id) || !m || m.type === "ABSENCE" || m.type === "INTERNE") continue;
    const e = aEnd(a); if (!isFinite(e) || e < TODAY || e > TODAY + 21 * DAY || seen.has(a.member_id)) continue;
    const nx = monday(e) + 7 * DAY; const w = weekCell(a.member_id, nx, true);
    if (w.load != null && w.load < .5) { seen.add(a.member_id); out.push({ lvl: "warn", w: 2, t: `<strong>${esc(cName(a.member_id))}</strong> se libère S${isoWeek(nx)}`, m: `Fin de ${esc(missionLabel(m))} le ${frDate(e)} · pas de relais affecté` }); }
  }
  for (const m of state.missions) {
    if (m.status !== "probable" || m.active === false) continue;
    const st = missionStart(m); if (!isFinite(st)) continue; const dd = Math.round((st - TODAY) / DAY);
    const who = new Set(state.assign.filter(a => a.mission_id === m.id && ids.has(a.member_id)).map(a => a.member_id));
    if (dd >= -7 && dd <= 14 && who.size) out.push({ lvl: "info", w: 1.2, t: `À confirmer : ${esc(missionLabel(m))}`, m: `Mission probable · démarrage ${frDate(st)} · ${who.size} consultant${who.size > 1 ? "s" : ""} affecté${who.size > 1 ? "s" : ""}` });
  }
  if (isAdmin() && !state.group) {
    for (const m of state.missions) {
      if (m.active === false || m.type === "ABSENCE" || m.type === "INTERNE") continue;
      if (missionEnd(m) < TODAY || (isFinite(missionStart(m)) && missionStart(m) > TODAY + 14 * DAY)) continue;
      const used = state.assign.some(a => a.mission_id === m.id && aEnd(a) >= TODAY) || state.entries.some(e => e.mission_id === m.id && parse(e.day) >= TODAY);
      if (!used) out.push({ lvl: "warn", w: 1.8, t: `Mission sans consultant : ${esc(missionLabel(m))}`, m: isFinite(missionStart(m)) && missionStart(m) > TODAY ? `Démarre le ${frDate(missionStart(m))}` : "En cours, personne n'y est affecté" });
    }
  }
  const stale = state.consultants.filter(c => { const f = freshness(c); return f.days == null || f.days > STALE_DAYS; });
  if (stale.length) out.push({ lvl: "warn", w: 1.5, t: `${stale.length} planning${stale.length > 1 ? "s" : ""} à relancer`, m: esc(stale.map(c => c.name).join(", ")) + ` · pas de confirmation depuis plus de ${STALE_DAYS} j` });
  for (const sk of SKILLS) {
    const who = state.members.filter(c => (c.skills || []).includes(sk));
    if (state.members.length >= 3 && who.length <= 1) out.push({ lvl: "info", w: 1, t: `Compétence fragile : ${esc(sk)}`, m: who.length ? `Seul(e) ${esc(who[0].name)} la détient · prévoir un binôme ou une formation` : "Aucun consultant ne la détient" });
  }
  return out.sort((a, b) => b.w - a.w);
}
function renderAlerts(list) {
  return `<section class="panel"><div class="panel-head"><h2>Points d'attention</h2><span class="eyebrow">${list.length} alerte${list.length > 1 ? "s" : ""}</span></div>
  ${list.length ? `<ul class="alerts">${list.map(a => `<li class="alert ${a.lvl}"><div>${a.t}<div class="meta">${a.m}</div></div></li>`).join("")}</ul>` : `<p class="empty-note">Rien à signaler sur l'horizon.</p>`}</section>`;
}

/* ================= graphique ================= */
function colLabel(col) { return col.kind === "day" ? `${WD[wdIdx(col.t) - 1]} ${new Date(col.t).getUTCDate()}` : `S${isoWeek(col.t)}`; }
function renderChart(cols) {
  const tot = cols.map(col => { const t = { net: 0, BUILD: 0, RUN: 0, AVV: 0, INTERNE: 0 }; for (const c of state.consultants) { const r = cellAt(c.id, col); if (!r) continue; t.net += r.net; WORK_TYPES.forEach(k => t[k] += r[k]); } return t; });
  const max = Math.max(1, ...tot.map(t => Math.max(t.net, t.BUILD + t.RUN + t.AVV + t.INTERNE)));
  const step = max > 80 ? 20 : max > 40 ? 10 : max > 16 ? 5 : max > 8 ? 2 : 1; const top = Math.ceil(max * 1.08 / step) * step;
  const Wd = 720, H = 230, L = 40, R = 10, T = 12, B = 28, pw = Wd - L - R, ph = H - T - B, bw = pw / cols.length; const y = v => T + ph - (v / top) * ph;
  let g = "";
  for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${v}</text>`;
  tot.forEach((t, i) => {
    const col = cols[i]; const x = L + i * bw + bw * .18, w = bw * .64; let acc = 0;
    if (col.kind === "day" && i > 0 && wdIdx(col.t) === 1) g += `<line x1="${L + i * bw}" x2="${L + i * bw}" y1="${T}" y2="${T + ph}" stroke="var(--line)" stroke-dasharray="3 3"/>`;
    WORK_TYPES.forEach(k => { if (t[k] <= 0) return; g += `<rect x="${x}" y="${y(acc + t[k])}" width="${w}" height="${(t[k] / top) * ph}" fill="${TYPES[k].color}"><title>${colLabel(col)} · ${TYPES[k].label} : ${d1(t[k])} j</title></rect>`; acc += t[k]; });
    g += `<line x1="${L + i * bw + 2}" x2="${L + (i + 1) * bw - 2}" y1="${y(t.net)}" y2="${y(t.net)}" stroke="var(--ink)" stroke-width="2"><title>Capacité nette ${colLabel(col)} : ${d1(t.net)} j</title></line>`;
    const now = col.kind === "day" ? col.t === TODAY : i === 0;
    g += `<text x="${L + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="10" fill="${now ? "var(--accent)" : "var(--muted)"}" font-family="IBM Plex Mono, monospace">${colLabel(col)}</text>`;
  });
  return `<section class="panel chart"><div class="panel-head"><h2>Charge de l'équipe</h2><span class="eyebrow">jours ${state.h === 3 ? "par jour" : "par semaine"}</span></div>
  <svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Jours staffés par type et capacité nette">${g}</svg>
  <div class="legend">${WORK_TYPES.map(k => `<span><i class="sw" style="background:${TYPES[k].color}"></i>${TYPES[k].label}</span>`).join("")}<span><i class="sw" style="background:var(--ink);height:2px"></i>Capacité nette (hors congés et fériés)</span></div></section>`;
}

/* ================= heatmap équipe ================= */
function headRows(cols, firstTh) {
  if (cols[0].kind === "week") return `<tr>${firstTh}${cols.map((c, i) => `<th class="${i === 0 ? "now" : ""}" title="Semaine du ${frDate(c.t)}">S${isoWeek(c.t)}<br><span style="font-weight:400">${frDate(c.t)}</span></th>`).join("")}</tr>`;
  const wk = []; for (let i = 0; i < cols.length; i += 5) wk.push(`<th colspan="5" class="wk wkh">S${isoWeek(cols[i].t)} · ${frDate(cols[i].t)}</th>`);
  return `<tr>${firstTh.replace("<th", '<th rowspan="2"')}${wk.join("")}</tr><tr>${cols.map(c => `<th class="${c.t === TODAY ? "now" : ""} ${wdIdx(c.t) === 1 ? "wk" : ""}" title="${frLong(c.t)}">${WD[wdIdx(c.t) - 1]}<br><span style="font-weight:400">${new Date(c.t).getUTCDate()}</span></th>`).join("")}</tr>`;
}
function cellHtml(c, r, col, showFree) {
  const wk = col.kind === "day" && wdIdx(col.t) === 1 ? "wk" : "";
  const now = col.kind === "day" ? col.t === TODAY : col.t === monday(TODAY);
  const b = band(r);
  if (b === "hol") return `<td class="c hol ${wk}" title="Jour férié">Férié</td>`;
  const strip = r.net > 0 ? WORK_TYPES.filter(k => r[k] > 0).map(k => `<i style="width:${Math.min(100, r[k] / r.net * 100)}%;background:${TYPES[k].color}"></i>`).join("") : "";
  const tip = `${c.name} · ${col.kind === "day" ? frLong(col.t) : "S" + isoWeek(col.t)}\nCapacité nette : ${d1(r.net)} j${r.abs ? ` (absence ${d1(r.abs)} j)` : ""}\n` + WORK_TYPES.filter(k => r[k] > 0).map(k => `${TYPES[k].label} : ${d1(r[k])} j`).join("\n") + (r.prob ? `\nDont probable : ${d1(r.prob)} j` : "") + `\nLibre : ${d1(r.free)} j` + (r.explicit ? "\nAjusté manuellement" : "");
  const label = b === "abs" ? (col.kind === "day" ? "Abs." : "Absent") : (col.kind === "day" ? Math.round(r.load * 100) : pct(r.load));
  return `<td class="c ${b} ${now ? "now" : ""} ${wk}" title="${esc(tip)}">${label}${showFree && b !== "abs" ? `<span class="free">${d1(r.free)} j libres</span>` : ""}${r.prob && state.prob ? '<span class="p" aria-hidden="true"></span>' : ""}${strip ? `<span class="strip">${strip}</span>` : ""}</td>`;
}
function legendHtml() { return `<div class="heat-legend"><span><i class="sw" style="background:var(--h-low)"></i>&lt; 50 % · intercontrat</span><span><i class="sw" style="background:var(--h-mid)"></i>50–85 %</span><span><i class="sw" style="background:var(--h-ok)"></i>85–100 % · cible</span><span><i class="sw" style="background:var(--h-over)"></i>&gt; 100 % · surcharge</span><span><i class="sw hatch"></i>Absent ou férié</span><span><i class="p" style="display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--t-avv)"></i>contient du probable</span></div>`; }
function renderHeat(cols) {
  const order = [...state.groups.map(g => g.id), ""];
  const byG = order.map(gid => ({ gid, list: state.consultants.filter(c => gid ? c.group_id === gid : !state.groups.some(g => g.id === c.group_id)) })).filter(x => x.list.length);
  const rows = byG.map(({ gid, list }) => `${state.group ? "" : `<tr class="grp"><td colspan="${cols.length + 1}">${esc(gid ? groupName(gid) : "Sans groupe")} · ${list.length}</td></tr>`}` + list.map(c => {
    const f = freshness(c);
    return `<tr><th class="who" scope="row"><button data-plan="${esc(c.id)}"><span class="n"><i class="fresh ${f.cls}" title="${esc(f.label)}"></i>${esc(c.name)}</span><span class="r">${esc(c.role || "")} · ${esc(f.label.toLowerCase())}</span></button></th>${cols.map(col => cellHtml(c, cellAt(c.id, col), col, false)).join("")}</tr>`;
  }).join("")).join("");
  return `<section class="panel"><div class="panel-head"><h2>Disponibilité par consultant</h2><span class="eyebrow">clique un nom pour ouvrir son planning</span></div>
  <div class="scroll"><table class="heat ${cols[0].kind === "day" ? "days" : ""}"><thead>${headRows(cols, `<th class="who">Consultant</th>`)}</thead><tbody>${rows}</tbody></table></div>${legendHtml()}</section>`;
}

/* ================= recherche de dispo ================= */
const finder = { skill: "", start: iso(monday(TODAY) + 7 * DAY), weeks: 3, days: 3 };
function renderFinderShell() {
  return `<section class="panel"><div class="panel-head"><h2>Qui est disponible ?</h2><span class="eyebrow">pour une mission ou une avant-vente</span></div>
  <div class="finder-form">
    <label class="f">Compétence<select id="fSkill"><option value="">Toutes</option>${SKILLS.map(s => `<option ${finder.skill === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
    <label class="f">À partir du<input type="date" id="fStart" value="${finder.start}"></label>
    <label class="f">Durée (semaines)<input type="number" id="fWeeks" min="1" max="26" value="${finder.weeks}"></label>
    <label class="f">Jours / semaine<input type="number" id="fDays" min="0.5" max="5" step="0.5" value="${finder.days}"></label>
  </div><ul class="results" id="fRes"></ul></section>`;
}
function renderFinderResults() {
  const el = $("fRes"); if (!el) return;
  const st = monday(parse(finder.start)); if (isNaN(st)) { el.innerHTML = ""; return; }
  const n = Math.max(1, Math.min(26, +finder.weeks || 1)), need = +finder.days || 1;
  const W = Array.from({ length: n }, (_, i) => st + i * 7 * DAY);
  const res = state.consultants.filter(c => !finder.skill || (c.skills || []).includes(finder.skill)).map(c => {
    const cells = W.map(w => weekCell(c.id, w, true)); const needW = cells.map(r => need * r.days / 5);
    const got = cells.reduce((a, r, i) => a + Math.min(r.free, needW[i]), 0), want = needW.reduce((a, b) => a + b, 0);
    return { c, cells, fit: want ? got / want : 0, free: cells.reduce((a, r) => a + r.free, 0) };
  }).sort((a, b) => b.fit - a.fit || b.free - a.free).slice(0, 6);
  if (!res.length) { el.innerHTML = `<li class="empty-note">Aucun consultant avec cette compétence${state.group ? " dans ce groupe" : ""}.</li>`; return; }
  el.innerHTML = res.map(r => `<li class="res"><div><strong>${esc(r.c.name)}</strong><div class="chips">${(r.c.skills || []).map(s => `<span class="chip ${s === finder.skill ? "on" : ""}">${esc(s)}</span>`).join("")}</div></div>
    <span class="fit" style="color:${r.fit >= .9 ? "var(--good)" : r.fit >= .5 ? "var(--warn)" : "var(--bad)"}">${pct(r.fit)}</span>
    <span class="mini" title="Jours libres par semaine">${r.cells.map(x => `<i style="height:${Math.max(2, Math.min(100, x.free / 5 * 100))}%"></i>`).join("")}</span>
    <span class="mono muted" style="font-size:.8rem">${d1(r.free)} j libres</span></li>`).join("");
}

/* ================= listes d'affectations ================= */
function assignRows(list, withWho) {
  return list.map(a => {
    const m = missionById(a.mission_id) || {}; const e = aEnd(a); const dd = isFinite(e) ? Math.round((e - TODAY) / DAY) : null;
    const due = dd == null ? `<span class="muted">—</span>` : dd < 0 ? `<span class="due past">terminé</span>` : `<span class="due ${dd <= 21 ? "soon" : ""}">${dd} j</span>`;
    const mem = memberById(a.member_id);
    return `<tr>${withWho ? `<td>${esc(mem ? mem.name : "—")}</td>` : ""}<td><strong>${esc(m.name || "—")}</strong><br><span class="muted">${esc(m.client || "")}</span></td>
      <td>${typeTag(m.type)}</td><td>${statusPill(m)}</td><td class="mono">${a.pct} %</td><td class="small">${wdTxt(a.weekdays)}</td>
      <td class="mono small" style="white-space:nowrap">${periodTxt(a)}</td><td class="mono">${due}</td>
      <td>${canEditMember(mem) ? `<button class="btn small" data-a="${esc(a.id)}">Modifier</button>` : ""}</td></tr>`;
  }).join("");
}
function renderAssignList() {
  const ids = new Set(state.consultants.map(c => c.id)); const q = state.filter.toLowerCase();
  const rows = state.assign.filter(a => ids.has(a.member_id)).filter(a => { const m = missionById(a.mission_id); return m && m.type !== "ABSENCE"; })
    .filter(a => aEnd(a) >= TODAY - 14 * DAY)
    .filter(a => { if (!q) return true; const m = missionById(a.mission_id); return [missionLabel(m), cName(a.member_id), TYPES[m.type].label].join(" ").toLowerCase().includes(q); })
    .sort((x, y) => aEnd(x) - aEnd(y));
  return `<section class="panel"><div class="panel-head"><h2>Affectations en cours et à venir</h2><label class="f" style="min-width:220px"><input type="search" id="lFilter" placeholder="Filtrer : client, mission, consultant…" value="${esc(state.filter)}"></label></div>
  <div class="scroll"><table class="list"><thead><tr><th>Consultant</th><th>Mission</th><th>Type</th><th>Statut</th><th>Temps</th><th>Jours</th><th>Période</th><th>Fin dans</th><th></th></tr></thead><tbody>${assignRows(rows, true) || `<tr><td colspan="9" class="empty-note">Aucune affectation ne correspond.</td></tr>`}</tbody></table></div></section>`;
}

/* ================= vue Équipe ================= */
function viewTeam() {
  if (!state.members.length) return `<div class="panel state"><h2>L'équipe n'est pas encore créée</h2><p>${isAdmin() ? "Crée les missions, puis les groupes et les consultants dans l'administration." : "L'administrateur n'a pas encore ajouté l'équipe."}</p>${isAdmin() ? `<button class="btn primary" data-tab="admin">Aller à l'administration</button>` : ""}</div>`;
  const cols = columns(); const last = cols[cols.length - 1].t;
  const bar = `<div class="bar"><div class="controls">
      <select class="sel" id="gSel" aria-label="Groupe"><option value="">Toute l'équipe (${state.members.length})</option>${state.groups.map(g => `<option value="${esc(g.id)}" ${state.group === g.id ? "selected" : ""}>${esc(g.name)} (${state.members.filter(m => m.group_id === g.id).length})</option>`).join("")}</select>
      <div class="seg" role="group" aria-label="Horizon">${HORIZONS.map(h => `<button data-h="${h}" aria-pressed="${state.h === h}">${h === 3 ? "3 sem. · par jour" : h + " sem."}</button>`).join("")}</div>
      ${isAdmin() ? `<label class="toggle"><input type="checkbox" id="optProb" ${state.prob ? "checked" : ""}> Inclure le probable</label>` : ""}</div>
    <span class="muted" style="font-size:.85rem">S${isoWeek(cols[0].t)} à S${isoWeek(last)}</span></div>`;
  if (!state.consultants.length) return bar + `<div class="panel state">Aucun consultant dans ce groupe.</div>`;
  if (!isAdmin()) return `${bar}${renderHeat(cols)}`;
  return `${bar}${renderKpis(kpis())}<div class="grid2">${renderAlerts(alerts())}${renderChart(cols)}</div>${renderHeat(cols)}${renderFinderShell()}${renderAssignList()}`;
}

/* ================= vue Planning (au jour) ================= */
function viewPlanning() {
  const own = myMember();
  let m = state.planMember ? memberById(state.planMember) : own;
  if (state.planMember && !m) { state.planMember = null; m = own; }
  const selector = isAdmin() && state.members.length ? `<div class="bar"><label class="toggle">Planning de
      <select class="sel" id="pmSel">${own ? "" : `<option value="">— choisir —</option>`}${state.members.map(x => `<option value="${esc(x.id)}" ${m && m.id === x.id ? "selected" : ""}>${esc(x.name)}${own && x.id === own.id ? " (moi)" : ""}</option>`).join("")}</select></label></div>` : "";
  if (!m) {
    const claim = state.claims.find(c => c.user_id === state.me.id);
    const cm = claim && memberById(claim.member_id);
    if (cm) return selector + `<section class="panel state"><h2>Rattachement en attente</h2><p>Tu as demandé à être rattaché(e) au profil <strong>${esc(cm.name)}</strong>. Dès que l'administrateur aura validé, tu pourras remplir ton planning ici.</p><button class="btn" id="btnUnclaim">Changer de profil</button></section>`;
    const free = state.members.filter(x => !x.user_id);
    return selector + `<section class="panel"><h2>Qui es-tu ?</h2><p class="muted">Choisis ton nom une seule fois. ${isAdmin() ? "Comme administrateur, le rattachement est immédiat." : "L'administrateur valide ensuite le rattachement à ton compte."}</p>
      ${free.length ? `<ul class="pick">${free.map(x => `<li><button data-claim="${esc(x.id)}"><strong>${esc(x.name)}</strong><span class="muted" style="font-size:.8rem">${esc(groupName(x.group_id))} · ${esc(x.role || "")}</span></button></li>`).join("")}</ul>` : `<p class="empty-note">Aucun profil disponible. Demande à l'administrateur de créer le tien.</p>`}</section>`;
  }
  const ro = !canEditMember(m); const self = own && m.id === own.id;
  const back = !isAdmin() && !self ? `<div class="banner"><span>Planning de <strong>${esc(m.name)}</strong> · lecture seule</span>${own ? `<button class="btn small" id="btnBackMine">Revenir à mon planning</button>` : ""}</div>` : "";
  const t = lastUpdate(m.id); const age = t ? Math.round((TODAY - t) / DAY) : null;
  const stale = age == null || age > STALE_DAYS;
  const freshTxt = age == null ? (self ? "Tu n'as pas encore confirmé ton planning." : "Planning jamais confirmé.") : age <= 0 ? "Planning à jour aujourd'hui." : `Dernière mise à jour il y a ${age} jour${age > 1 ? "s" : ""}.`;

  const start = monday(TODAY) + state.planOffset * 7 * DAY;
  const days = threeWeeks(start);
  const rowsMap = new Map(); const totals = [];
  for (const d of days) {
    if (!isWorkday(d)) { totals.push(null); continue; }
    const r = dayCell(m.id, d, true); totals.push(r);
    for (const p of r.parts) { let row = rowsMap.get(p.m.id); if (!row) { row = { m: p.m, vals: new Map() }; rowsMap.set(p.m.id, row); } row.vals.set(d, (row.vals.get(d) || 0) + p.pct); }
  }
  const rows = [...rowsMap.values()].sort((a, b) => missionSort(a.m, b.m));
  const head = headRows(days.map(t => ({ t, kind: "day" })), `<th class="lbl">Mission</th>`);
  const cellBtn = (d, inner) => ro ? inner : `<button data-day="${d}" aria-label="Modifier le ${esc(frLong(d))}">${inner}</button>`;
  const body = rows.map(row => `<tr><th class="lbl" scope="row"><span class="mrow"><i class="dot" style="background:${TYPES[row.m.type].color}"></i><span>${esc(row.m.name)}<small>${esc(row.m.client || TYPES[row.m.type].label)}${row.m.status === "probable" ? " · probable" : ""}</small></span></span></th>${days.map((d, i) => {
      const wk = wdIdx(d) === 1 ? "wk" : "";
      if (!totals[i]) return `<td class="v hol ${wk}">Férié</td>`;
      const v = row.vals.get(d); const ex = totals[i].explicit ? "ex" : "";
      return `<td class="v ${v ? "on" : ""} ${ex} ${wk}" style="--c:${TYPES[row.m.type].color}">${cellBtn(d, v ? Math.round(v) : "")}</td>`;
    }).join("")}</tr>`).join("");
  const totalRow = `<tr class="total"><th class="lbl" scope="row">Charge du jour</th>${days.map((d, i) => {
      const wk = wdIdx(d) === 1 ? "wk" : ""; const r = totals[i];
      if (!r) return `<td class="v hol ${wk}">Férié</td>`;
      const b = band(r); const txt = b === "abs" ? "Abs." : Math.round(r.load * 100) + "%";
      return `<td class="v c ${b} ${r.explicit ? "ex" : ""} ${wk}" title="${esc(frLong(d))}${r.explicit ? " · ajusté manuellement" : ""}">${cellBtn(d, txt)}</td>`;
    }).join("")}</tr>`;
  const emptyRow = rows.length ? "" : `<tr><th class="lbl muted" scope="row">Aucune mission</th><td colspan="${days.length}" class="empty-note" style="padding:12px">${ro ? "Rien de planifié sur ces 3 semaines." : "Affecte-toi à une mission récurrente, ou clique sur un jour pour le remplir."}</td></tr>`;
  const free = totals.reduce((s, r) => s + (r ? r.free : 0), 0);

  const mine = (IDX.assign[m.id] || []).slice().sort((a, b) => missionSort(missionById(a.mission_id) || {}, missionById(b.mission_id) || {}));
  const work = mine.filter(a => { const x = missionById(a.mission_id); return x && x.type !== "ABSENCE" && aEnd(a) >= TODAY - 14 * DAY; });
  const absn = mine.filter(a => { const x = missionById(a.mission_id); return x && x.type === "ABSENCE" && aEnd(a) >= TODAY; });

  return `${selector}${back}
  <section class="panel hello"><div><span class="eyebrow">${esc(groupName(m.group_id))} · ${esc(m.role || "")}</span><h2 style="font-size:1.4rem">${esc(m.name)}</h2>
    <p class="${stale ? "" : "muted"}" style="${stale ? "color:var(--warn)" : ""}">${freshTxt}${stale && !ro ? " Vérifie tes 3 prochaines semaines puis confirme." : ""}</p></div>
    ${ro ? "" : `<div class="actions"><button class="btn" id="btnConfirm">Confirmer le planning</button><button class="btn" id="btnAbsence">Poser une absence</button><button class="btn primary" id="btnAssign">+ Affecter à une mission</button></div>`}</section>
  ${ro ? "" : weekCards(m)}
  <section class="panel"><div class="panel-head"><h2>Vue sur 3 semaines</h2>
    <div class="navw"><span class="eyebrow">${d1(free)} j libres</span><button class="btn small" data-nav="-1" aria-label="Semaine précédente">←</button><button class="btn small" data-nav="0">Aujourd'hui</button><button class="btn small" data-nav="1" aria-label="Semaine suivante">→</button></div></div>
    <div class="scroll"><table class="dgrid"><thead>${head}</thead><tbody>${body}${emptyRow}${totalRow}</tbody></table></div>
    <p class="muted small">${ro ? "" : "Clique sur un jour pour l'ajuster (absence, demi-journée, autre mission). "}Les valeurs sont en % de la journée. Un point signale un jour ajusté manuellement.</p></section>
  <section class="panel"><div class="panel-head"><h2>Missions récurrentes</h2><span class="eyebrow">remplissent automatiquement le planning</span></div>
    <div class="scroll"><table class="list"><thead><tr><th>Mission</th><th>Type</th><th>Statut</th><th>Temps</th><th>Jours</th><th>Période</th><th>Fin dans</th><th></th></tr></thead><tbody>${assignRows(work, false) || `<tr><td colspan="8" class="empty-note">Aucune mission récurrente${ro ? "." : " : « + Affecter à une mission » pour en ajouter une."}</td></tr>`}</tbody></table></div></section>
  ${absn.length ? `<section class="panel"><div class="panel-head"><h2>Absences à venir</h2></div><div class="scroll"><table class="list"><thead><tr><th>Motif</th><th>Type</th><th></th><th>Temps</th><th>Jours</th><th>Période</th><th>Fin dans</th><th></th></tr></thead><tbody>${assignRows(absn, false)}</tbody></table></div></section>` : ""}`;
}

/* ================= « Ma semaine » : saisie en 1 clic ================= */
const absenceMission = () => state.missions.find(x => x.type === "ABSENCE" && x.active !== false && x.name === "Congés / absence") || state.missions.find(x => x.type === "ABSENCE" && x.active !== false);
function dayKind(r) {
  if (!r.explicit) return "normal";
  if (!r.parts.length) return "free";
  const abs = r.parts.filter(p => p.m.type === "ABSENCE").reduce((s, p) => s + p.pct, 0);
  if (abs >= 100) return "abs";
  if (abs === 50) return "half";
  return "custom";
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function weekCards(m) {
  const mon = monday(TODAY) + state.weekOffset * 7 * DAY;
  const absM = absenceMission();
  const cards = [0, 1, 2, 3, 4].map(i => {
    const t = mon + i * DAY; const title = cap(new Date(t).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", timeZone: "UTC" }));
    if (!isWorkday(t)) return `<li class="wcard hol"><div class="wd"><span>${title}</span></div><p class="muted small">Jour férié</p></li>`;
    const r = dayCell(m.id, t, true); const k = dayKind(r);
    const lines = r.parts.length ? r.parts.map(p => `<li><i class="dot" style="background:${TYPES[p.m.type].color}"></i><span title="${esc(missionLabel(p.m))}">${esc(p.m.name)}</span><b>${Math.round(p.pct)} %</b></li>`).join("") : `<li class="muted">Libre</li>`;
    const btn = (kind, label, dis) => `<button class="qbtn" data-qd="${t}" data-qk="${kind}" aria-pressed="${k === kind}" ${dis ? "disabled" : ""}>${label}</button>`;
    const loadTxt = r.load == null ? "Absent" : Math.round(r.load * 100) + " %";
    return `<li class="wcard ${t === TODAY ? "today" : ""} ${band(r)}"><div class="wd"><span>${title}</span><span class="mono">${loadTxt}</span></div><ul class="wparts">${lines}</ul>
      <div class="qbtns">${btn("normal", "Comme prévu")}${btn("abs", "Absent", !absM)}${btn("half", "½ journée", !absM)}${btn("free", "Libre")}<button class="qbtn more" data-day="${t}">Autre…</button></div></li>`;
  }).join("");
  const label = state.weekOffset === 0 ? "Cette semaine" : state.weekOffset === 1 ? "Semaine prochaine" : `Semaine ${isoWeek(mon)}`;
  return `<section class="panel"><div class="panel-head"><div><h2>${label}</h2><span class="muted small">S${isoWeek(mon)} · du ${frDate(mon)} au ${frDate(mon + 4 * DAY)} · un clic suffit</span></div>
    <div class="navw"><button class="btn small" data-wnav="-1" aria-label="Semaine précédente">←</button><button class="btn small" data-wnav="0">Cette semaine</button><button class="btn small" data-wnav="1" aria-label="Semaine suivante">→</button></div></div>
    <ul class="week">${cards}</ul></section>`;
}
async function quickDay(mid, t, kind, btn) {
  const m = memberById(mid); if (!m || !canEditMember(m)) return;
  let rows = null;
  if (kind === "abs") { const a = absenceMission(); if (!a) return; rows = [{ mission: a.id, pct: 100 }]; }
  else if (kind === "free") rows = [];
  else if (kind === "half") {
    const a = absenceMission(); if (!a) return;
    const work = partsFor(mid, t, true).parts.filter(p => p.m.type !== "ABSENCE");
    rows = [{ mission: a.id, pct: 50 }];
    for (const p of work) { const v = Math.max(5, Math.round(p.pct / 2 / 5) * 5); const x = rows.find(r => r.mission === p.m.id); if (x) x.pct = Math.min(100, x.pct + v); else rows.push({ mission: p.m.id, pct: v }); }
  }
  if (btn) btn.disabled = true;
  try {
    await q(sb.from("day_entries").delete().eq("member_id", mid).eq("day", iso(t)));
    if (rows) await q(sb.from("day_entries").insert(rows.length ? rows.map(r => ({ member_id: mid, day: iso(t), mission_id: r.mission, pct: r.pct })) : [{ member_id: mid, day: iso(t), mission_id: null, pct: 0 }]));
    await touchStatus(mid, "updated_at");
    toast({ normal: "Journée remise comme prévu", abs: "Absence enregistrée", half: "Demi-journée enregistrée", free: "Journée libre enregistrée" }[kind]);
    await after();
  } catch (err) { toast(errMsg(err)); if (btn && btn.isConnected) btn.disabled = false; }
}

/* ================= vue Missions (admin) ================= */
function viewMissions() {
  const f = state.mFilter;
  const list = state.missions.filter(m => f === "toutes" || (f === "actives" ? m.active !== false : m.active === false)).sort(missionSort);
  const D = workdaysBetween(monday(TODAY), monday(TODAY) + 20 * DAY);
  const rows = list.map(m => {
    const who = [...new Set(state.assign.filter(a => a.mission_id === m.id && aEnd(a) >= TODAY).map(a => a.member_id))];
    let charge = 0; for (const mem of state.members) for (const t of D) { const r = dayCell(mem.id, t, true); for (const p of r.parts) if (p.m.id === m.id) charge += p.pct / 100; }
    return `<tr><td><strong>${esc(m.name)}</strong><br><span class="muted">${esc(m.client || "")}</span></td><td>${typeTag(m.type)}</td><td>${statusPill(m)}${m.active === false ? ' <span class="pill">Archivée</span>' : ""}</td>
      <td class="mono small" style="white-space:nowrap">${m.start_date ? frDate(parse(m.start_date)) : "—"} → ${m.end_date ? frDate(parse(m.end_date)) : "sans fin"}</td>
      <td class="small">${who.length ? esc(who.map(cName).join(", ")) : `<span class="muted">Personne</span>`}</td><td class="mono">${d1(charge)} j</td>
      <td style="white-space:nowrap"><button class="btn small" data-mi="${esc(m.id)}">Modifier</button> ${m.active !== false ? `<button class="btn small" data-massign="${esc(m.id)}">Affecter</button>` : ""}</td></tr>`;
  }).join("");
  return `<div class="bar"><div class="seg" role="group" aria-label="Filtre">${[["actives", "Actives"], ["archivees", "Archivées"], ["toutes", "Toutes"]].map(([k, l]) => `<button data-mf="${k}" aria-pressed="${f === k}">${l}</button>`).join("")}</div><button class="btn primary" id="btnAddM">+ Mission</button></div>
  <section class="panel"><div class="panel-head"><h2>Catalogue des missions</h2><span class="eyebrow">${list.length} mission${list.length > 1 ? "s" : ""}</span></div>
    <p class="muted small">Les collaborateurs choisissent dans ce catalogue. Une mission sans date de fin (ex. BUILD à l'année, TMA) remplit leur planning en continu. Les missions de type Absence (congés, temps partiel) sont proposées à tous dans « Poser une absence ».</p>
    <div class="scroll"><table class="list"><thead><tr><th>Mission</th><th>Type</th><th>Statut</th><th>Période</th><th>Consultants</th><th>Charge 3 sem.</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="empty-note">Aucune mission. Commence par « + Mission ».</td></tr>`}</tbody></table></div></section>`;
}

/* ================= vue Administration ================= */
function viewAdmin() {
  const pc = state.claims; const meMail = (state.me.email || "").toLowerCase();
  const adminSet = new Set(state.admins.map(a => a.email));
  const sugg = state.members.filter(x => x.user_email && !adminSet.has(x.user_email.toLowerCase()));
  return `<section class="panel"><div class="panel-head"><h2>Demandes de rattachement</h2><span class="eyebrow">${pc.length} en attente</span></div>
    ${pc.length ? `<div class="scroll"><table class="list"><thead><tr><th>Compte</th><th>Profil demandé</th><th>Le</th><th></th></tr></thead><tbody>${pc.map(c => { const m = memberById(c.member_id); return `<tr><td>${esc(c.email)}</td><td><strong>${esc(m ? m.name : "Profil supprimé")}</strong>${m && m.user_id ? ` <span class="pill wait">déjà rattaché à ${esc(m.user_email || "un compte")}</span>` : ""}</td><td class="mono">${frDate(parse(c.created_at))}</td><td style="white-space:nowrap"><button class="btn small primary" data-approve="${esc(c.user_id)}" ${m ? "" : "disabled"}>Valider</button> <button class="btn small danger" data-reject="${esc(c.user_id)}">Refuser</button></td></tr>`; }).join("")}</tbody></table></div>` : `<p class="empty-note">Aucune demande. Quand un collaborateur choisit son nom, la demande apparaît ici.</p>`}</section>
  <div class="grid2 even">
    <section class="panel"><div class="panel-head"><h2>Administrateurs</h2><span class="eyebrow">${state.admins.length}</span></div>
      <ul class="mstaff">${state.admins.map(a => `<li><span>${esc(a.email)} ${a.email === meMail ? '<span class="pill ok">toi</span>' : ""}</span><button class="btn small danger" data-adel="${esc(a.email)}" ${state.admins.length <= 1 ? 'disabled title="Il doit rester au moins un administrateur"' : ""}>Retirer</button></li>`).join("")}</ul>
      <form class="inline" id="adAddForm"><input type="email" id="adNew" list="adSugg" placeholder="prenom.nom@${esc(DOMAINS[0] || "datatilt.com")}" required aria-label="E-mail du nouvel administrateur"><datalist id="adSugg">${sugg.map(x => `<option value="${esc(x.user_email)}">${esc(x.name)}</option>`).join("")}</datalist><button class="btn primary small" type="submit">Ajouter</button></form>
      <p class="muted small">Un administrateur gère les missions, l'équipe et les groupes, et peut modifier tous les plannings. Il se connecte avec cet e-mail.</p></section>
    <section class="panel"><div class="panel-head"><h2>Groupes</h2></div>
      <ul class="mstaff">${state.groups.map(g => { const n = state.members.filter(m => m.group_id === g.id).length; return `<li><div class="inline"><input id="gName-${esc(g.id)}" value="${esc(g.name)}" aria-label="Nom du groupe"><button class="btn small" data-grename="${esc(g.id)}">Renommer</button></div><button class="btn small danger" data-gdel="${esc(g.id)}" ${n ? `disabled title="Le groupe contient ${n} consultant(s)"` : ""}>Supprimer</button></li>`; }).join("") || `<li class="empty-note">Aucun groupe.</li>`}</ul>
      <form class="inline" id="gAddForm"><input id="gNew" placeholder="Nouveau groupe, ex. Pôle IA & Agents" required aria-label="Nom du nouveau groupe"><button class="btn primary small" type="submit">Ajouter</button></form>
    </section>
  </div>
  <section class="panel"><h2>Inviter un collaborateur</h2>
    <ol class="steps"><li>Crée son profil ci-dessous (nom, groupe, compétences).</li><li>Envoie-lui l'adresse de l'application.</li><li>Il se connecte avec son e-mail ${esc(DOMAINS.map(d => "@" + d).join(" ou "))} et choisit son nom dans « Mon planning ».</li><li>Tu valides la demande en haut de cette page. Il s'affecte ensuite à ses missions en quelques clics.</li></ol></section>
  <section class="panel"><div class="panel-head"><h2>Équipe</h2><button class="btn primary" id="btnAddC">+ Consultant</button></div>
    <div class="scroll"><table class="list"><thead><tr><th>Consultant</th><th>Groupe</th><th>Rôle</th><th>Compte</th><th>Planning</th><th></th></tr></thead><tbody>${state.members.map(m => { const f = freshness(m); return `<tr><td><strong>${esc(m.name)}</strong></td><td>${esc(groupName(m.group_id))}</td><td>${esc(m.role || "")}</td><td>${m.user_id ? esc(m.user_email || "Compte rattaché") : `<span class="pill">Non rattaché</span>`}</td><td><span class="person"><i class="fresh ${f.cls}"></i>${esc(f.label)}</span></td><td style="white-space:nowrap"><button class="btn small" data-c="${esc(m.id)}">Modifier</button> <button class="btn small" data-plan="${esc(m.id)}">Planning</button>${m.user_id ? ` <button class="btn small" data-unlink="${esc(m.id)}">Détacher</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty-note">Aucun consultant.</td></tr>`}</tbody></table></div></section>`;
}

/* ================= connexion ================= */
function viewLogin(msg) {
  $("tabs").innerHTML = ""; $("meChip").hidden = true; $("banner").hidden = true;
  main().innerHTML = `<section class="panel login">
    <span class="eyebrow">Connexion</span>
    <h2>Accède au plan de charge</h2>
    <p class="muted">Saisis ton adresse e-mail professionnelle : tu reçois un lien de connexion, sans mot de passe.</p>
    <form id="loginForm" class="login-form">
      <label class="f">E-mail<input type="email" id="loginEmail" required autocomplete="email" placeholder="prenom.nom@${esc(DOMAINS[0] || "datatilt.com")}"></label>
      <button class="btn primary" type="submit" id="loginBtn">Recevoir mon lien de connexion</button>
    </form>
    <p id="loginMsg" class="login-msg">${msg || ""}</p>
  </section>`;
}
async function sendLink(email) {
  email = email.trim().toLowerCase();
  const dom = email.split("@")[1] || "";
  if (DOMAINS.length && !DOMAINS.includes(dom)) { $("loginMsg").innerHTML = `<span style="color:var(--bad)">Seules les adresses ${esc(DOMAINS.map(d => "@" + d).join(", "))} peuvent se connecter.</span>`; return; }
  $("loginBtn").disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
  $("loginBtn").disabled = false;
  if (error) {
    const rate = /rate|seconds/i.test(error.message || "");
    $("loginMsg").innerHTML = `<span style="color:var(--bad)">${rate ? "Trop de demandes rapprochées : patiente une minute avant de redemander un lien." : "Envoi impossible : " + esc(error.message)}</span>`;
    return;
  }
  $("loginMsg").innerHTML = `<span style="color:var(--good)">Lien envoyé à <strong>${esc(email)}</strong>. Ouvre ta boîte mail et clique sur le lien pour te connecter.</span>`;
}

/* ================= rendu ================= */
function renderTabs() {
  const pc = isAdmin() ? state.claims.length : 0;
  const tabs = [["moi", "Mon planning"], ["equipe", "Équipe"]];
  if (isAdmin()) tabs.push(["missions", "Missions"], ["admin", "Administration"]);
  $("tabs").innerHTML = tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${l}${k === "admin" && pc ? `<span class="count">${pc}</span>` : ""}</button>`).join("");
}
function renderChip() {
  const chip = $("meChip"); chip.hidden = false; const m = myMember();
  chip.innerHTML = `<span class="avatar" aria-hidden="true"></span><span class="n"></span><span class="badge ${isAdmin() ? "admin" : ""}">${isAdmin() ? "Administrateur" : "Collaborateur"}</span><button class="btn small" id="btnLogout">Déconnexion</button>`;
  chip.querySelector(".avatar").textContent = initials(m ? m.name : state.me.email);
  chip.querySelector(".n").textContent = m ? m.name : state.me.email;
}
function render() {
  if (!state.me.id) return;
  if (!state.loaded) { main().innerHTML = `<div class="state">Chargement du plan de charge…</div>`; return; }
  if (!state.tab) state.tab = isAdmin() ? "equipe" : "moi";
  if ((state.tab === "admin" || state.tab === "missions") && !isAdmin()) state.tab = "moi";
  if (!isAdmin()) state.prob = true;
  if (state.group && !state.groups.some(g => g.id === state.group)) state.group = "";
  rebuild(); renderTabs(); renderChip();
  const ex = state.members.some(m => m.example) || state.missions.some(m => m.example); const ban = $("banner"); ban.hidden = !(ex && isAdmin());
  if (ex && isAdmin()) ban.innerHTML = `<div class="banner"><span><strong>Données d'exemple.</strong> Ces consultants et missions montrent l'outil. Crée tes missions et ton équipe, puis supprime-les.</span><button class="btn small danger" id="btnClearEx">Supprimer les exemples</button></div>`;
  const fs = document.activeElement && document.activeElement.id;
  const views = { admin: viewAdmin, missions: viewMissions, moi: viewPlanning, equipe: viewTeam };
  main().innerHTML = `<div class="stack">${(views[state.tab] || viewTeam)()}</div>`;
  renderFinderResults();
  if (fs) { const el = $(fs); if (el && el.focus) { el.focus(); if (el.type === "search" || el.type === "text") { const v = el.value; try { el.setSelectionRange(v.length, v.length); } catch (_) {} } } }
}
let rT = null; const schedule = () => { clearTimeout(rT); rT = setTimeout(render, 30); };

/* ================= données ================= */
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
async function fetchAll(make) {
  const out = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await make().range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; }
  return out;
}
async function loadAll() {
  const from = iso(monday(TODAY) - 28 * DAY), to = iso(TODAY + 40 * 7 * DAY);
  const [g, m, c, mi, a, e, s] = await Promise.all([
    q(sb.from("groups").select("*").order("name")),
    q(sb.from("members").select("*").order("name")),
    q(sb.from("claims").select("*").order("created_at")),
    fetchAll(() => sb.from("missions").select("*").order("id")),
    fetchAll(() => sb.from("assignments").select("*").order("id")),
    fetchAll(() => sb.from("day_entries").select("*").gte("day", from).lte("day", to).order("id")),
    q(sb.from("plan_status").select("*"))
  ]);
  state.groups = g; state.members = m; state.claims = c; state.missions = mi; state.assign = a;
  state.entries = e.map(x => ({ ...x, day: String(x.day).slice(0, 10) }));
  state.status = {}; s.forEach(r => state.status[r.member_id] = r);
  state.admins = isAdmin() ? await q(sb.from("admins").select("*").order("email")) : [];
  reindex();
  state.loaded = true;
}
let lT = null;
function reloadSoon() { clearTimeout(lT); lT = setTimeout(async () => { try { await loadAll(); schedule(); } catch (e) { console.error(e); } }, 250); }
let channel = null;
function subscribe() {
  if (channel) return;
  channel = sb.channel("pdc-changes");
  ["groups", "members", "claims", "missions", "assignments", "day_entries", "plan_status", "admins"].forEach(t => channel.on("postgres_changes", { event: "*", schema: "public", table: t }, reloadSoon));
  channel.subscribe();
}

/* ================= écritures ================= */
function toast(msg) { const r = $("toastRoot"); r.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => r.innerHTML = "", 3200); }
function errMsg(e) {
  const code = e && e.code; const msg = (e && e.message) || "";
  if (code === "42501" || /row-level security/i.test(msg)) return "Action refusée : tu ne peux modifier que ton propre planning.";
  if (code === "23503") return "Cette mission est utilisée dans des plannings : archive-la plutôt que de la supprimer.";
  if (code === "23505") return "Cet élément existe déjà.";
  if (code === "23514") return "Valeur invalide : vérifie les dates, les jours et le pourcentage.";
  if (code === "P0001") return msg;
  return "Enregistrement impossible : " + (msg || "réessaie dans un instant.");
}
const nowIso = () => new Date().toISOString();
const touchStatus = (memberId, field) => q(sb.from("plan_status").upsert({ member_id: memberId, [field]: nowIso() }, { onConflict: "member_id" }));
async function after() { await loadAll(); render(); }
async function linkMember(memberId, userId, email) {
  const prev = state.members.find(x => x.user_id === userId && x.id !== memberId);
  if (prev) await q(sb.from("members").update({ user_id: null, user_email: null }).eq("id", prev.id));
  await q(sb.from("members").update({ user_id: userId, user_email: email }).eq("id", memberId));
  await q(sb.from("claims").delete().eq("user_id", userId));
}
async function refreshAdmin() { const { data } = await sb.rpc("is_admin"); state.me.isAdmin = data === true; }

/* ================= modales ================= */
function closeModal() { $("modalRoot").innerHTML = ""; }
function openModal(html) { $("modalRoot").innerHTML = `<div class="overlay" id="ov">${html}</div>`; }
function missionOptions(list, selected) {
  return TYPE_ORDER.map(t => { const ms = list.filter(m => m.type === t); if (!ms.length) return "";
    return `<optgroup label="${esc(TYPES[t].label)}">${ms.map(m => `<option value="${esc(m.id)}" ${m.id === selected ? "selected" : ""}>${esc(missionLabel(m))}${m.status === "probable" && m.type !== "ABSENCE" ? " (probable)" : ""}${m.end_date ? " · jusqu'au " + frDate(parse(m.end_date)) : ""}</option>`).join("")}</optgroup>`; }).join("");
}

/* --- ajuster un ou plusieurs jours --- */
function dayModal(mid, t) {
  const m = memberById(mid); if (!m || !canEditMember(m)) return;
  const pp = partsFor(mid, t);
  let rows = []; for (const p of pp.parts) { const r = rows.find(x => x.mission === p.m.id); if (r) r.pct += p.pct; else rows.push({ mission: p.m.id, pct: Math.round(p.pct) }); }
  rows.forEach(r => r.pct = Math.min(100, Math.round(r.pct)));
  const used = new Set(rows.map(r => r.mission));
  const list = state.missions.filter(x => x.active !== false || used.has(x.id)).sort(missionSort);
  if (!list.length) { toast("Aucune mission dans le catalogue : un administrateur doit d'abord en créer."); return; }
  const absM = list.find(x => x.type === "ABSENCE");
  openModal(`<form class="modal" id="dForm" aria-label="Ajuster une journée">
    <div><span class="eyebrow">${esc(m.name)}</span><h2>${esc(frLong(t))}</h2></div>
    <p class="muted small">${pp.explicit ? "Ce jour est ajusté manuellement." : "Ce jour suit les missions récurrentes. Ta modification ne concerne que les jours choisis ci-dessous."}</p>
    <div class="quick"><button type="button" class="btn small" id="qAbs" ${absM ? "" : "disabled"}>Journée d'absence</button><button type="button" class="btn small" id="qHalf" ${absM ? "" : "disabled"}>Demi-journée d'absence</button><button type="button" class="btn small" id="qFree">Journée libre</button></div>
    <ul class="drows" id="dRows"></ul>
    <div class="row-actions"><button type="button" class="btn small" id="dAdd">+ Ajouter une mission</button><span class="total-line" id="dTotal"></span></div>
    <label class="f">Appliquer jusqu'au (inclus)<input type="date" id="dUntil" value="${iso(t)}" min="${iso(t)}"></label>
    <div class="row-actions">${pp.explicit ? `<button type="button" class="btn" id="dReset">Revenir aux missions récurrentes</button>` : "<span></span>"}<div class="r"><button type="button" class="btn" id="dCancel">Annuler</button><button class="btn primary" type="submit" id="dSave">Enregistrer</button></div></div>
  </form>`);
  const draw = () => {
    $("dRows").innerHTML = rows.length ? rows.map((r, i) => `<li class="drow"><select data-ri="${i}" class="dM" aria-label="Mission">${missionOptions(list, r.mission)}</select><input type="number" class="dP" data-ri="${i}" min="5" max="100" step="5" value="${r.pct}" aria-label="Pourcentage de la journée"><button type="button" class="btn small" data-rdel="${i}" aria-label="Retirer">✕</button></li>`).join("") : `<li class="empty-note">Journée libre : aucune mission ce jour-là.</li>`;
    const abs = rows.filter(r => (missionById(r.mission) || {}).type === "ABSENCE").reduce((s, r) => s + (+r.pct || 0), 0);
    const work = rows.filter(r => (missionById(r.mission) || {}).type !== "ABSENCE").reduce((s, r) => s + (+r.pct || 0), 0);
    const load = abs >= 100 ? null : work / (100 - abs);
    $("dTotal").innerHTML = abs >= 100 ? "Absent toute la journée" : `Charge : <strong style="color:${load > 1.001 ? "var(--bad)" : load >= .85 ? "var(--good)" : "inherit"}">${pct(load)}</strong>${abs ? ` · absence ${abs} %` : ""}`;
  };
  draw();
  const form = $("dForm");
  form.addEventListener("input", e => { const i = +e.target.dataset.ri; if (isNaN(i)) return; if (e.target.classList.contains("dM")) rows[i].mission = e.target.value; if (e.target.classList.contains("dP")) rows[i].pct = Math.max(0, Math.min(100, +e.target.value || 0)); draw(); });
  form.addEventListener("change", e => { if (e.target.classList.contains("dM")) { rows[+e.target.dataset.ri].mission = e.target.value; draw(); } });
  form.addEventListener("click", e => { const b = e.target.closest("[data-rdel]"); if (b) { rows.splice(+b.dataset.rdel, 1); draw(); } });
  $("dAdd").onclick = () => { const firstWork = list.find(x => x.type !== "ABSENCE" && !rows.some(r => r.mission === x.id)) || list[0]; rows.push({ mission: firstWork.id, pct: 50 }); draw(); };
  $("qAbs").onclick = () => { rows = [{ mission: absM.id, pct: 100 }]; draw(); };
  $("qHalf").onclick = () => { const work = rows.filter(r => (missionById(r.mission) || {}).type !== "ABSENCE").map(r => ({ ...r, pct: Math.max(5, Math.round(r.pct / 2 / 5) * 5) })); rows = [{ mission: absM.id, pct: 50 }, ...work]; draw(); };
  $("qFree").onclick = () => { rows = []; draw(); };
  $("dCancel").onclick = closeModal;
  const range = () => { const u = parse($("dUntil").value); const end = isNaN(u) || u < t ? t : Math.min(u, t + 180 * DAY); return [t, end]; };
  if ($("dReset")) $("dReset").onclick = async () => {
    const [a, b] = range();
    try { await q(sb.from("day_entries").delete().eq("member_id", mid).gte("day", iso(a)).lte("day", iso(b))); await touchStatus(mid, "updated_at"); closeModal(); toast("Jour remis sur les missions récurrentes"); await after(); } catch (err) { toast(errMsg(err)); }
  };
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const merged = []; for (const r of rows) { if (!r.mission || !(+r.pct > 0)) continue; const x = merged.find(y => y.mission === r.mission); if (x) x.pct = Math.min(100, x.pct + +r.pct); else merged.push({ mission: r.mission, pct: Math.min(100, +r.pct) }); }
    const [a, b] = range(); const days = workdaysBetween(a, b, 130);
    if (!days.length) { toast("Aucun jour ouvré dans cette période."); return; }
    const ins = []; for (const d of days) { if (merged.length) merged.forEach(r => ins.push({ member_id: mid, day: iso(d), mission_id: r.mission, pct: r.pct })); else ins.push({ member_id: mid, day: iso(d), mission_id: null, pct: 0 }); }
    $("dSave").disabled = true;
    try {
      await q(sb.from("day_entries").delete().eq("member_id", mid).gte("day", iso(a)).lte("day", iso(b)));
      for (let i = 0; i < ins.length; i += 500) await q(sb.from("day_entries").insert(ins.slice(i, i + 500)));
      await touchStatus(mid, "updated_at"); closeModal(); toast(days.length > 1 ? `${days.length} jours mis à jour` : "Journée mise à jour"); await after();
    } catch (err) { toast(errMsg(err)); const s = $("dSave"); if (s) s.disabled = false; }
  });
}

/* --- affectation récurrente / absence --- */
function assignModal({ memberId, aId, missionId, absence, pickMember }) {
  const a = aId ? state.assign.find(x => x.id === aId) : null;
  if (a) { memberId = a.member_id; absence = (missionById(a.mission_id) || {}).type === "ABSENCE"; }
  const mem = memberById(memberId);
  if (!pickMember && (!mem || !canEditMember(mem))) return;
  const list = state.missions.filter(x => (absence ? x.type === "ABSENCE" : x.type !== "ABSENCE") && (x.active !== false || (a && a.mission_id === x.id))).sort(missionSort);
  if (!list.length) { toast(absence ? "Aucun motif d'absence : un administrateur doit créer une mission de type Absence." : "Aucune mission disponible : un administrateur doit d'abord créer les missions."); return; }
  const cur = {
    member: memberId || (state.members[0] || {}).id, mission: a ? a.mission_id : (missionId || list[0].id), pct: a ? a.pct : 100,
    wd: a ? (a.weekdays && a.weekdays.length ? a.weekdays.slice() : ALL_WD.slice()) : ALL_WD.slice(),
    start: a ? a.start_date : iso(TODAY), mode: a ? (a.end_date ? "date" : "mission") : (absence ? "date" : "mission"), end: a && a.end_date ? a.end_date : iso(TODAY)
  };
  if (!a && !absence) { const mm = missionById(cur.mission); if (mm && mm.start_date && parse(mm.start_date) > TODAY) cur.start = mm.start_date; }
  const presets = absence ? [[100, "Journée"], [50, "Demi-journée"]] : [[100, "100 %"], [80, "80 %"], [50, "50 %"], [20, "20 %"]];
  const endLbl = () => { const mm = missionById(cur.mission); return mm && mm.end_date ? `Jusqu'à la fin de la mission (${frDate(parse(mm.end_date))})` : "Jusqu'à la fin de la mission (sans date de fin)"; };
  const custom = a && (a.pct !== 100 || (a.weekdays && a.weekdays.length && a.weekdays.length < 5) || a.end_date);
  const advOpen = absence || custom;
  openModal(`<form class="modal" id="aForm" aria-label="Affectation">
    <h2>${a ? "Modifier" : absence ? "Poser une absence" : "Affecter à une mission"}${mem && !pickMember ? ` · ${esc(mem.name)}` : ""}</h2>
    <div class="form-grid">
      ${pickMember ? `<label class="f full">Consultant<select id="aMember">${state.members.map(x => `<option value="${esc(x.id)}" ${x.id === cur.member ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
      <label class="f full">${absence ? "Motif" : "Mission"}<select id="aMission" class="big">${missionOptions(list, cur.mission)}</select></label>
    </div>
    ${absence ? "" : `<p class="express" id="aSummary"></p>`}
    <details class="adv" id="aAdv" ${advOpen ? "open" : ""}>${absence ? "" : `<summary>Temps partiel, jours ou dates différents</summary>`}
    <div class="form-grid">
      <div class="full"><span class="eyebrow">${absence ? "Durée" : "Temps passé chaque jour"}</span><div class="pcts" id="aPcts">${presets.map(([v, l]) => `<button type="button" data-p="${v}" aria-pressed="${cur.pct === v}">${l}</button>`).join("")}<input type="number" id="aPct" min="5" max="100" step="5" value="${cur.pct}" aria-label="Pourcentage personnalisé"> %</div></div>
      <div class="full"><span class="eyebrow">Jours concernés</span><div class="wds" id="aWds">${ALL_WD.map(i => `<button type="button" data-wd="${i}" aria-pressed="${cur.wd.includes(i)}" title="${WD_SHORT[i - 1]}">${WD[i - 1]}</button>`).join("")}</div></div>
      <label class="f">À partir du<input type="date" id="aStart" value="${esc(cur.start)}" required></label>
      <div class="full radios"><span class="eyebrow">Jusqu'à</span>
        <label><input type="radio" name="aMode" id="aModeM" value="mission" ${cur.mode === "mission" ? "checked" : ""}><span id="aEndLbl">${esc(endLbl())}</span></label>
        <label><input type="radio" name="aMode" id="aModeD" value="date" ${cur.mode === "date" ? "checked" : ""}>Une date précise <input type="date" id="aEnd" value="${esc(cur.end)}" aria-label="Date de fin"></label>
      </div>
    </div>
    </details>
    <p class="empty-note" id="aHint"></p>
    <div class="row-actions">${a ? `<button type="button" class="btn danger" id="aDel">Supprimer</button>` : "<span></span>"}<div class="r"><button type="button" class="btn" id="aCancel">Annuler</button><button class="btn primary" type="submit" id="aSave">${a ? "Enregistrer" : absence ? "Poser l'absence" : "Affecter"}</button></div></div>
  </form>`);
  const syncPct = () => document.querySelectorAll("#aPcts [data-p]").forEach(b => b.setAttribute("aria-pressed", String(+b.dataset.p === cur.pct)));
  const summary = () => {
    const el = $("aSummary"); if (!el) return; const mm = missionById(cur.mission);
    const end = cur.mode === "mission" ? (mm && mm.end_date ? `jusqu'à la fin de la mission (${frDate(parse(mm.end_date))})` : "jusqu'à la fin de la mission") : `jusqu'au ${frDate(parse(cur.end))}`;
    const from = parse(cur.start) > TODAY ? ` à partir du ${frDate(parse(cur.start))}` : "";
    el.innerHTML = `<strong>${cur.pct} %</strong> · ${esc(wdTxt(cur.wd).toLowerCase())} · ${esc(end)}${esc(from)}`;
  };
  const hint = () => {
    summary(); const h = $("aHint"); if (absence) { h.textContent = "Pendant une absence, les missions récurrentes sont suspendues automatiquement."; return; }
    const mid = pickMember ? $("aMember").value : memberId; const s = parse(cur.start);
    const e = cur.mode === "mission" ? missionEnd(missionById(cur.mission)) : parse(cur.end);
    if (isNaN(s) || isNaN(e)) { h.textContent = ""; return; } if (e < s) { h.innerHTML = `<span style="color:var(--bad)">La fin doit être après le début.</span>`; return; }
    const mm = missionById(cur.mission); const from = Math.max(s, monday(TODAY), missionStart(mm));
    const days = workdaysBetween(from, Math.min(e, from + 26 * 7 * DAY), 130).filter(t => cur.wd.includes(wdIdx(t)));
    let mx = 0, at = null;
    for (const t of days) {
      const r = dayCell(mid, t, true); if (r.explicit) continue;
      const own = a ? r.parts.filter(p => p.a && p.a.id === a.id).reduce((x, p) => x + p.pct, 0) / 100 : 0;
      const l = r.net > 0 ? (r.staffed - own + cur.pct / 100 * (r.net / r.days)) / r.net : 0;
      if (l > mx) { mx = l; at = t; }
    }
    h.innerHTML = !days.length ? "" : mx > 1.001 ? `<span style="color:var(--bad)">Attention : la charge monterait à ${pct(mx)} le ${frDate(at)} ; pense à ajuster les autres missions.</span>` : `Charge maximale sur la période : ${pct(mx)}.`;
  };
  hint();
  $("aPcts").addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (!b) return; cur.pct = +b.dataset.p; $("aPct").value = cur.pct; syncPct(); hint(); });
  $("aPct").addEventListener("input", e => { cur.pct = Math.max(0, Math.min(100, +e.target.value || 0)); syncPct(); hint(); });
  $("aWds").addEventListener("click", e => { const b = e.target.closest("[data-wd]"); if (!b) return; const i = +b.dataset.wd; cur.wd = cur.wd.includes(i) ? cur.wd.filter(x => x !== i) : [...cur.wd, i].sort(); b.setAttribute("aria-pressed", String(cur.wd.includes(i))); hint(); });
  $("aMission").addEventListener("change", e => { cur.mission = e.target.value; $("aEndLbl").textContent = endLbl(); const mm = missionById(cur.mission); if (!a && mm && mm.start_date && parse(mm.start_date) > parse(cur.start)) { cur.start = mm.start_date; $("aStart").value = cur.start; } hint(); });
  $("aStart").addEventListener("input", e => { cur.start = e.target.value; hint(); });
  $("aEnd").addEventListener("input", e => { cur.end = e.target.value; cur.mode = "date"; $("aModeD").checked = true; hint(); });
  document.querySelectorAll('input[name="aMode"]').forEach(r => r.addEventListener("change", e => { cur.mode = e.target.value; hint(); }));
  if (pickMember) $("aMember").addEventListener("change", hint);
  $("aCancel").onclick = closeModal;
  const del = $("aDel");
  if (del) del.onclick = async () => {
    if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Confirmer la suppression"; return; }
    try { await q(sb.from("assignments").delete().eq("id", a.id)); await touchStatus(a.member_id, "updated_at"); closeModal(); toast("Affectation supprimée"); await after(); } catch (err) { toast(errMsg(err)); }
  };
  $("aForm").addEventListener("submit", async e => {
    e.preventDefault();
    const mid = pickMember ? $("aMember").value : memberId;
    if (!(cur.pct > 0 && cur.pct <= 100)) { toast("Indique un pourcentage entre 5 et 100 %."); return; }
    if (!cur.wd.length) { toast("Choisis au moins un jour de la semaine."); return; }
    if (cur.mode === "date" && parse(cur.end) < parse(cur.start)) { toast("La date de fin doit être après le début."); return; }
    const body = { member_id: mid, mission_id: cur.mission, pct: Math.round(cur.pct), weekdays: cur.wd.slice().sort(), start_date: cur.start, end_date: cur.mode === "date" ? cur.end : null };
    $("aSave").disabled = true;
    try { await q(a ? sb.from("assignments").update(body).eq("id", a.id) : sb.from("assignments").insert(body)); await touchStatus(mid, "updated_at"); closeModal(); toast(absence ? "Absence enregistrée" : "Affectation enregistrée : le planning est rempli"); await after(); }
    catch (err) { toast(errMsg(err)); const s = $("aSave"); if (s) s.disabled = false; }
  });
}

/* --- mission (admin) --- */
function missionModal(id) {
  if (!isAdmin()) return;
  const isNew = !id; const m = missionById(id) || { client: "", name: "", type: "BUILD", status: "ferme", start_date: iso(TODAY), end_date: null, active: true };
  const asg = isNew ? [] : state.assign.filter(a => a.mission_id === id).sort((x, y) => cName(x.member_id).localeCompare(cName(y.member_id), "fr"));
  openModal(`<form class="modal" id="mForm" aria-label="Mission">
    <h2>${isNew ? "Nouvelle mission" : esc(missionLabel(m))}</h2>
    <div class="form-grid">
      <label class="f">Client<input id="mClient" value="${esc(m.client)}" placeholder="ex. L'Oréal, Interne…"></label>
      <label class="f">Nom de la mission<input id="mName" required value="${esc(m.name)}" placeholder="ex. Budget & forecast PA"></label>
      <label class="f">Type<select id="mType">${TYPE_ORDER.map(k => `<option value="${k}" ${m.type === k ? "selected" : ""}>${TYPES[k].label}</option>`).join("")}</select></label>
      <label class="f">Statut<select id="mStatus"><option value="ferme" ${m.status !== "probable" ? "selected" : ""}>Ferme (signée / confirmée)</option><option value="probable" ${m.status === "probable" ? "selected" : ""}>Probable (pipeline)</option></select></label>
      <label class="f">Début<input type="date" id="mStart" value="${esc(m.start_date || "")}"></label>
      <label class="f">Fin<input type="date" id="mEnd" value="${esc(m.end_date || "")}" ${m.end_date ? "" : "disabled"}></label>
      <div class="full checks"><label><input type="checkbox" id="mNoEnd" ${m.end_date ? "" : "checked"}> Sans date de fin (BUILD à l'année, TMA…)</label><label><input type="checkbox" id="mArch" ${m.active === false ? "checked" : ""}> Archivée (n'est plus proposée)</label></div>
    </div>
    ${isNew ? "" : `<div class="stack-s"><div class="panel-head"><span class="eyebrow">Consultants affectés (${asg.length})</span><button type="button" class="btn small" id="mAssign">+ Affecter un consultant</button></div>
      <ul class="mstaff">${asg.map(a => `<li><span><strong>${esc(cName(a.member_id))}</strong> · ${a.pct} % · ${wdTxt(a.weekdays)}<br><span class="mono muted small">${periodTxt(a)}</span></span><button type="button" class="btn small" data-ma="${esc(a.id)}">Modifier</button></li>`).join("") || `<li class="empty-note">Personne n'est affecté à cette mission.</li>`}</ul></div>`}
    <div class="row-actions">${isNew ? "<span></span>" : `<button type="button" class="btn danger" id="mDel">Supprimer</button>`}<div class="r"><button type="button" class="btn" id="mCancel">Fermer</button><button class="btn primary" type="submit">Enregistrer</button></div></div>
  </form>`);
  $("mNoEnd").addEventListener("change", e => { $("mEnd").disabled = e.target.checked; });
  $("mCancel").onclick = closeModal;
  const ma = $("mAssign"); if (ma) ma.onclick = () => assignModal({ missionId: id, pickMember: true, absence: m.type === "ABSENCE" });
  document.querySelectorAll("#mForm [data-ma]").forEach(b => b.onclick = () => assignModal({ aId: b.dataset.ma }));
  const del = $("mDel");
  if (del) del.onclick = async () => {
    if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Confirmer la suppression"; return; }
    try { await q(sb.from("missions").delete().eq("id", id)); closeModal(); toast("Mission supprimée"); await after(); } catch (err) { toast(errMsg(err)); }
  };
  $("mForm").addEventListener("submit", async e => {
    e.preventDefault();
    const noEnd = $("mNoEnd").checked;
    const body = { client: $("mClient").value.trim(), name: $("mName").value.trim(), type: $("mType").value, status: $("mStatus").value, start_date: $("mStart").value || null, end_date: noEnd ? null : ($("mEnd").value || null), active: !$("mArch").checked };
    if (!body.name) return;
    if (body.start_date && body.end_date && parse(body.end_date) < parse(body.start_date)) { toast("La date de fin doit être après le début."); return; }
    try { await q(isNew ? sb.from("missions").insert(body) : sb.from("missions").update(body).eq("id", id)); closeModal(); toast(isNew ? "Mission créée" : "Mission mise à jour"); await after(); } catch (err) { toast(errMsg(err)); }
  });
}

/* --- consultant (admin) --- */
function memberModal(id) {
  const admin = isAdmin(); if (!admin) return; const isNew = !id;
  const m = memberById(id) || { name: "", role: "Consultant", skills: [], group_id: state.group || (state.groups[0] || {}).id || "" };
  const n = isNew ? 0 : (IDX.assign[id] || []).length;
  openModal(`<form class="modal" id="cForm" aria-label="Consultant">
    <h2>${isNew ? "Nouveau consultant" : esc(m.name)}</h2>
    <div class="form-grid">
      <label class="f full">Nom<input id="cName" required value="${esc(m.name)}"></label>
      <label class="f">Groupe<select id="cGroup"><option value="">Sans groupe</option>${state.groups.map(g => `<option value="${esc(g.id)}" ${m.group_id === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>
      <label class="f">Rôle<select id="cRole">${ROLES.map(r => `<option ${m.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>
      <div class="full"><span class="eyebrow">Compétences</span><div class="checks">${SKILLS.map((s, i) => `<label><input type="checkbox" id="cSk${i}" ${(m.skills || []).includes(s) ? "checked" : ""}>${esc(s)}</label>`).join("")}</div></div>
    </div>
    <div class="row-actions">${isNew ? "<span></span>" : `<button type="button" class="btn danger" id="cDel">Supprimer</button>`}<div class="r">${isNew ? "" : `<button type="button" class="btn" id="cPlan">Voir le planning</button>`}<button type="button" class="btn" id="cCancel">Fermer</button><button class="btn primary" type="submit">Enregistrer</button></div></div>
  </form>`);
  $("cCancel").onclick = closeModal;
  if ($("cPlan")) $("cPlan").onclick = () => { closeModal(); state.planMember = id; state.planOffset = 0; state.tab = "moi"; render(); };
  $("cForm").addEventListener("submit", async e => {
    e.preventDefault();
    const body = { name: $("cName").value.trim(), group_id: $("cGroup").value || null, role: $("cRole").value, skills: SKILLS.filter((_, i) => $("cSk" + i).checked) };
    if (!body.name) return;
    try { await q(isNew ? sb.from("members").insert(body) : sb.from("members").update(body).eq("id", id)); closeModal(); toast(isNew ? "Consultant ajouté" : "Consultant mis à jour"); await after(); } catch (err) { toast(errMsg(err)); }
  });
  const del = $("cDel");
  if (del) del.onclick = async () => {
    if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = n ? `Confirmer (supprime aussi ${n} affectation${n > 1 ? "s" : ""})` : "Confirmer la suppression"; return; }
    try { await q(sb.from("members").delete().eq("id", id)); closeModal(); toast("Consultant supprimé"); await after(); } catch (err) { toast(errMsg(err)); }
  };
}

/* ================= événements ================= */
async function guard(btn, fn, ok) {
  if (btn) btn.disabled = true;
  try { await fn(); if (ok) toast(ok); await after(); }
  catch (err) { toast(errMsg(err)); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
}
const planTarget = () => state.planMember || (myMember() || {}).id;
document.addEventListener("click", async e => {
  if (e.target.id === "ov") { closeModal(); return; }
  const t = e.target.closest("button"); if (!t) return;
  if (t.closest("#modalRoot")) return;
  const d = t.dataset;
  if (t.id === "btnLogout") { await sb.auth.signOut(); return; }
  if (d.tab) { state.tab = d.tab; if (d.tab === "moi") { state.planMember = null; state.planOffset = 0; } render(); return; }
  if (d.h) { state.h = +d.h; try { localStorage.setItem("pdc.h2", state.h); } catch (_) {} render(); return; }
  if (d.mf) { state.mFilter = d.mf; render(); return; }
  if (d.nav !== undefined) { state.planOffset = +d.nav === 0 ? 0 : state.planOffset + +d.nav; render(); return; }
  if (d.day) { const mid = planTarget(); if (mid) dayModal(mid, +d.day); return; }
  if (d.qd) { const mid = planTarget(); if (mid && t.getAttribute("aria-pressed") !== "true") quickDay(mid, +d.qd, d.qk, t); return; }
  if (d.wnav !== undefined) { state.weekOffset = +d.wnav === 0 ? 0 : state.weekOffset + +d.wnav; render(); return; }
  if (d.plan) { state.planMember = d.plan; state.planOffset = 0; state.tab = "moi"; render(); window.scrollTo(0, 0); return; }
  if (d.a) { assignModal({ aId: d.a }); return; }
  if (d.mi) { missionModal(d.mi); return; }
  if (d.massign) { const mm = missionById(d.massign); assignModal({ missionId: d.massign, pickMember: true, absence: mm && mm.type === "ABSENCE" }); return; }
  if (d.c) { memberModal(d.c); return; }
  if (t.id === "btnAddC") { memberModal(null); return; }
  if (t.id === "btnAddM") { missionModal(null); return; }
  if (t.id === "btnAssign") { assignModal({ memberId: planTarget() }); return; }
  if (t.id === "btnAbsence") { assignModal({ memberId: planTarget(), absence: true }); return; }
  if (t.id === "btnBackMine") { state.planMember = null; state.planOffset = 0; render(); return; }
  if (t.id === "btnConfirm") { const mid = planTarget(); if (mid) guard(t, () => touchStatus(mid, "confirmed_at"), "Planning confirmé, merci !"); return; }
  if (d.claim) {
    if (isAdmin()) guard(t, () => linkMember(d.claim, state.me.id, state.me.email), "Profil rattaché à ton compte");
    else guard(t, () => q(sb.from("claims").upsert({ user_id: state.me.id, email: state.me.email, member_id: d.claim }, { onConflict: "user_id" })), "Demande envoyée à l'administrateur");
    return;
  }
  if (t.id === "btnUnclaim") { guard(t, () => q(sb.from("claims").delete().eq("user_id", state.me.id))); return; }
  if (d.approve) { const c = state.claims.find(x => x.user_id === d.approve); if (c) guard(t, () => linkMember(c.member_id, c.user_id, c.email), "Rattachement validé"); return; }
  if (d.reject) { guard(t, () => q(sb.from("claims").delete().eq("user_id", d.reject)), "Demande refusée"); return; }
  if (d.unlink) {
    if (d.armed !== "1") { t.dataset.armed = "1"; t.textContent = "Confirmer"; return; }
    guard(t, () => q(sb.from("members").update({ user_id: null, user_email: null }).eq("id", d.unlink)), "Compte détaché"); return;
  }
  if (d.adel) {
    if (d.armed !== "1") { t.dataset.armed = "1"; t.textContent = d.adel === (state.me.email || "").toLowerCase() ? "Confirmer (tu perds tes droits)" : "Confirmer"; return; }
    guard(t, async () => { await q(sb.from("admins").delete().eq("email", d.adel)); await refreshAdmin(); }, "Administrateur retiré"); return;
  }
  if (d.grename) { const v = $("gName-" + d.grename).value.trim(); if (v) guard(t, () => q(sb.from("groups").update({ name: v }).eq("id", d.grename)), "Groupe renommé"); return; }
  if (d.gdel) { if (d.armed !== "1") { t.dataset.armed = "1"; t.textContent = "Confirmer"; return; } guard(t, () => q(sb.from("groups").delete().eq("id", d.gdel)), "Groupe supprimé"); return; }
  if (t.id === "btnClearEx") {
    if (d.armed !== "1") { t.dataset.armed = "1"; t.textContent = "Confirmer : supprimer tous les exemples"; return; }
    guard(t, async () => {
      await q(sb.from("members").delete().eq("example", true));
      for (const m of state.missions.filter(x => x.example)) { try { await q(sb.from("missions").delete().eq("id", m.id)); } catch (_) {} }
      const used = new Set(state.members.filter(m => !m.example).map(m => m.group_id));
      const ids = state.groups.filter(g => g.example && !used.has(g.id)).map(g => g.id);
      if (ids.length) await q(sb.from("groups").delete().in("id", ids));
    }, "Exemples supprimés");
  }
});
document.addEventListener("submit", e => {
  if (e.target.id === "gAddForm") { e.preventDefault(); const v = $("gNew").value.trim(); if (v) guard(null, () => q(sb.from("groups").insert({ name: v })), "Groupe ajouté"); }
  if (e.target.id === "adAddForm") {
    e.preventDefault(); const v = $("adNew").value.trim().toLowerCase(); if (!v) return;
    const dom = v.split("@")[1] || "";
    guard(null, () => q(sb.from("admins").insert({ email: v })), DOMAINS.length && !DOMAINS.includes(dom) ? "Administrateur ajouté (attention : ce domaine ne peut pas se connecter)" : "Administrateur ajouté");
  }
  if (e.target.id === "loginForm") { e.preventDefault(); sendLink($("loginEmail").value); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
document.addEventListener("change", e => {
  if (e.target.id === "optProb") { state.prob = e.target.checked; try { localStorage.setItem("pdc.prob", state.prob ? "1" : "0"); } catch (_) {} render(); }
  if (e.target.id === "gSel") { state.group = e.target.value; try { localStorage.setItem("pdc.g", state.group); } catch (_) {} render(); }
  if (e.target.id === "pmSel") { state.planMember = e.target.value || null; state.planOffset = 0; render(); }
});
document.addEventListener("input", e => {
  const id = e.target.id;
  if (id === "lFilter") { state.filter = e.target.value; clearTimeout(render.t); render.t = setTimeout(render, 200); return; }
  if (id === "fSkill") finder.skill = e.target.value; else if (id === "fStart") finder.start = e.target.value; else if (id === "fWeeks") finder.weeks = e.target.value; else if (id === "fDays") finder.days = e.target.value; else return;
  renderFinderResults();
});

/* ================= session ================= */
let currentUser = null;
async function onSession(session) {
  const u = session && session.user;
  if (!u) {
    currentUser = null; state.me = { id: null, email: "", isAdmin: false }; state.loaded = false; state.tab = null;
    if (channel) { sb.removeChannel(channel); channel = null; }
    const err = new URLSearchParams(window.location.hash.slice(1)).get("error_description");
    viewLogin(err ? `<span style="color:var(--bad)">${esc(err.replace(/\+/g, " "))}</span>` : "");
    return;
  }
  if (currentUser === u.id) return;
  currentUser = u.id;
  state.me = { id: u.id, email: u.email || "", isAdmin: false };
  if (window.location.hash.includes("access_token")) history.replaceState(null, "", window.location.pathname);
  main().innerHTML = `<div class="state">Chargement du plan de charge…</div>`;
  try { await refreshAdmin(); await loadAll(); subscribe(); render(); }
  catch (e) { main().innerHTML = `<div class="panel state"><h2>Chargement impossible</h2><p>${esc(e.message || "Erreur de connexion à la base.")}</p><p class="muted small">As-tu exécuté <code>supabase/migration_v2.sql</code> ?</p><button class="btn" id="btnLogout">Se déconnecter</button></div>`; }
}
sb.auth.onAuthStateChange((_ev, session) => { setTimeout(() => onSession(session), 0); });
sb.auth.getSession().then(({ data }) => onSession(data.session));
})();
