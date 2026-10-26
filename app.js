/* Datatilt-SuiviConsultant v2 — missions, affectations récurrentes, saisie au jour */
(function () {
"use strict";

const CFG = window.APP_CONFIG || {};
const DAY = 864e5;
const TYPES = {
  BUILD:   { label: "Mission client", color: "var(--t-build)" },
  RUN:     { label: "Mission client", color: "var(--t-build)" }, // ancien type, fusionné avec BUILD (migration_v6)
  AVV:     { label: "Avant-vente / POC IA", color: "var(--t-avv)" },
  INTERNE: { label: "Interne / formation", color: "var(--t-int)" },
  ABSENCE: { label: "Absence / congés", color: "var(--t-abs)" }
};
const TYPE_ORDER = ["BUILD", "AVV", "INTERNE", "ABSENCE"];
const WORK_TYPES = ["BUILD", "AVV", "INTERNE"];
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
  planMember: null, planOffset: 0, mxOffset: 0,
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
const frDateY = t => !isFinite(t) ? "–" : new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
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
/* un consultant peut appartenir à plusieurs groupes (group_ids, migration_v5) */
const memberGroups = m => Array.isArray(m.group_ids) && m.group_ids.length ? m.group_ids : m.group_id ? [m.group_id] : [];
const inGroup = (m, gid) => memberGroups(m).includes(gid);
const groupNames = m => { const n = memberGroups(m).map(id => (state.groups.find(g => g.id === id) || {}).name).filter(Boolean); return n.length ? n.join(", ") : "Sans groupe"; };
const hasGroupsCol = () => state.members.some(x => "group_ids" in x);
const cName = id => (memberById(id) || {}).name || "—";
const isAdmin = () => state.me.isAdmin;
const MANAGER_ROLES = ["Manager", "Directeur de projet"];
const isManager = () => { const m = myMember(); return !!m && MANAGER_ROLES.includes(m.role); };
const canOverview = () => isAdmin() || isManager();
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
    r[p.m.type === "RUN" ? "BUILD" : p.m.type] += v;
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
function rebuild() { state.consultants = state.members.filter(m => !state.group || inGroup(m, state.group)); }

/* ================= KPI ================= */
function kpis() {
  const D = horizonDays(); let net = 0, staffed = 0, bill = 0, avv = 0, free = 0, prob = 0, over = 0, freeWeek = 0; const inter = [];
  for (const c of state.consultants) {
    for (const t of D) { const r = dayCell(c.id, t, state.prob); net += r.net; staffed += r.staffed; bill += r.bill; avv += r.AVV; free += r.free; prob += r.prob; if (r.load != null && r.load > 1.001) over++; }
    const w = weekCell(c.id, monday(TODAY), state.prob); freeWeek += w.free; if (w.net > 0.01 && w.bill / w.net < 0.5) inter.push(c.name);
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
    ${tile("Taux facturable", pct(k.bill), billCls, `Missions client · objectif ${Math.round(TARGET_BILL * 100)} %`, g)}
    ${tile("Taux d'occupation", pct(k.occ), "", `dont ${pct(k.avvShare)} en avant-vente IA`)}
    ${tile("Jours disponibles", d1(k.free), "", `${d1(k.freeWeek)} j cette semaine · ${d1(k.prob)} j probables ${state.prob ? "inclus" : "exclus"}`)}
    ${tile("Intercontrat", k.inter.length, k.inter.length ? "warn" : "good", k.inter.length ? esc(k.inter.slice(0, 3).join(", ")) + (k.inter.length > 3 ? "…" : "") : "Tout le monde est facturable à 50 % ou plus cette semaine")}
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
        while (j < D.length) { const rj = dayCell(c.id, D[j], state.prob); if (!(rj.load != null && rj.load > 1.001)) break; mx = Math.max(mx, rj.load); if (rj.AVV > 0 && rj.BUILD > 0) both = true; j++; }
        out.push({ lvl: "bad", w: 3, t: `<strong>${esc(c.name)}</strong> en surcharge (${pct(mx)}) ${j - i > 1 ? `du ${frDate(D[i])} au ${frDate(D[j - 1])}` : `le ${frDate(D[i])}`}`, m: both ? "Mission client et avant-vente IA le même jour : l'avant-vente risque de sauter" : "Arbitrer ou décaler une affectation" });
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
  const stale = state.consultants.filter(c => { const f = freshness(c); return f.days == null || f.days > STALE_DAYS; });
  if (stale.length) out.push({ lvl: "warn", w: 1.5, t: `${stale.length} planning${stale.length > 1 ? "s" : ""} à relancer`, m: esc(stale.map(c => c.name).join(", ")) + ` · pas de confirmation depuis plus de ${STALE_DAYS} j` });
  if (CFG.SKILL_ALERTS) for (const sk of SKILLS) {
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
function legendHtml() { return `<div class="heat-legend"><span><i class="sw" style="background:var(--h-low)"></i>&lt; 50 %</span><span><i class="sw" style="background:var(--h-mid)"></i>50–85 %</span><span><i class="sw" style="background:var(--h-ok)"></i>85–100 % · cible</span><span><i class="sw" style="background:var(--h-over)"></i>&gt; 100 % · surcharge</span><span><i class="sw hatch"></i>Absent ou férié</span><span><i class="p" style="display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--t-avv)"></i>contient du probable</span></div>`; }
function renderHeat(cols) {
  // groupe filtré : une seule section (sinon un consultant de plusieurs groupes apparaîtrait plusieurs fois)
  const order = state.group ? [state.group] : [...state.groups.map(g => g.id), ""];
  const byG = order.map(gid => ({ gid, list: state.consultants.filter(c => gid ? inGroup(c, gid) : !state.groups.some(g => inGroup(c, g.id))) })).filter(x => x.list.length);
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
      <select class="sel" id="gSel" aria-label="Groupe"><option value="">Toute l'équipe (${state.members.length})</option>${state.groups.map(g => `<option value="${esc(g.id)}" ${state.group === g.id ? "selected" : ""}>${esc(g.name)} (${state.members.filter(m => inGroup(m, g.id)).length})</option>`).join("")}</select>
      <div class="seg" role="group" aria-label="Horizon">${HORIZONS.map(h => `<button data-h="${h}" aria-pressed="${state.h === h}">${h === 3 ? "3 sem. · par jour" : h + " sem."}</button>`).join("")}</div>
      ${canOverview() ? `<label class="toggle"><input type="checkbox" id="optProb" ${state.prob ? "checked" : ""}> Inclure le probable</label>` : ""}</div>
    <div class="controls"><span class="muted" style="font-size:.85rem">S${isoWeek(cols[0].t)} à S${isoWeek(last)}</span>${canOverview() ? `<button class="btn small" id="btnRemind">✉ Envoyer un rappel</button>` : ""}</div></div>`;
  if (!state.consultants.length) return bar + `<div class="panel state">Aucun consultant dans ce groupe.</div>`;
  return `${bar}${renderKpis(kpis())}<div class="grid2">${renderAlerts(alerts())}${renderChart(cols)}</div>${renderHeat(cols)}${renderFinderShell()}${renderAssignList()}`;
}

/* ================= vue Planning (au jour) ================= */
function viewPlanning() {
  const own = myMember();
  if (!canOverview()) state.planMember = null;
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
      ${free.length ? `<ul class="pick">${free.map(x => `<li><button data-claim="${esc(x.id)}"><strong>${esc(x.name)}</strong><span class="muted" style="font-size:.8rem">${esc(groupNames(x))} · ${esc(x.role || "")}</span></button></li>`).join("")}</ul>` : `<p class="empty-note">Aucun profil disponible. Demande à l'administrateur de créer le tien.</p>`}</section>`;
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
  /* missions ajoutées depuis la grille, pas encore saisies sur ces 3 semaines */
  for (const id of (state.gridExtra || {})[m.id] || []) { const x = missionById(id); if (x && !rowsMap.has(id)) rows.push({ m: x, vals: new Map() }); }
  const head = headRows(days.map(t => ({ t, kind: "day" })), `<th class="lbl">Mission</th>`);
  const cellBtn = (d, inner) => ro ? inner : `<button data-day="${d}" aria-label="Modifier le ${esc(frLong(d))}">${inner}</button>`;
  const body = rows.map(row => `<tr><th class="lbl" scope="row"><span class="mrow"><i class="dot" style="background:${TYPES[row.m.type].color}"></i>${ro ? "<span>" : `<button class="rowsel" data-rowsel="${esc(row.m.id)}" title="Sélectionner la ligne pour la remplir en bloc">`}${esc(row.m.name)}<small>${esc(row.m.client || TYPES[row.m.type].label)}${row.m.status === "probable" ? " · probable" : ""}</small>${ro ? "</span>" : "</button>"}${ro ? "" : `<button class="rowdel" data-rowdel="${esc(row.m.id)}" data-from="${days[0]}" title="Retirer cette mission des 3 semaines affichées" aria-label="Retirer ${esc(row.m.name)} des 3 semaines affichées">✕</button>`}</span></th>${days.map((d, i) => {
      const wk = wdIdx(d) === 1 ? "wk" : "";
      if (!totals[i]) return `<td class="v hol ${wk}">Férié</td>`;
      const v = row.vals.get(d); const ex = totals[i].explicit ? "ex" : "";
      const inner = v ? Math.round(v) : "";
      return `<td class="v ${v ? "on" : ""} ${ex} ${wk}" style="--c:${TYPES[row.m.type].color}">${ro ? inner : `<button data-cell="${d}" data-mis="${esc(row.m.id)}" aria-label="${esc(row.m.name)} le ${esc(frLong(d))} : modifier le %">${inner}</button>`}</td>`;
    }).join("")}</tr>`).join("");
  const totalRow = `<tr class="total"><th class="lbl" scope="row">Charge du jour</th>${days.map((d, i) => {
      const wk = wdIdx(d) === 1 ? "wk" : ""; const r = totals[i];
      if (!r) return `<td class="v hol ${wk}">Férié</td>`;
      const b = band(r); const txt = b === "abs" ? "Abs." : Math.round(r.load * 100) + "%";
      return `<td class="v c ${b} ${r.explicit ? "ex" : ""} ${wk}" title="${esc(frLong(d))}${r.explicit ? " · ajusté manuellement" : ""}">${cellBtn(d, txt)}</td>`;
    }).join("")}</tr>`;
  const addable = ro ? [] : state.missions.filter(x => x.active !== false && !rows.some(r => r.m.id === x.id)).sort(missionSort);
  gridAddable = addable;
  const addRow = addable.length ? `<tr class="addrow"><th class="lbl" scope="row"><input type="search" class="sel" id="gridAddQ" placeholder="+ Ajouter une mission…" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="gridAddList" aria-label="Rechercher une mission à ajouter"><ul id="gridAddList" class="ga-list" role="listbox" hidden></ul></th><td colspan="${days.length}"></td></tr>` : "";
  const emptyRow = rows.length ? "" : `<tr><th class="lbl muted" scope="row">Aucune mission</th><td colspan="${days.length}" class="empty-note" style="padding:12px">${ro ? "Rien de planifié sur ces 3 semaines." : "Affecte-toi à une mission récurrente, ou clique sur un jour pour le remplir."}</td></tr>`;
  const free = totals.reduce((s, r) => s + (r ? r.free : 0), 0);

  const mine = (IDX.assign[m.id] || []).slice().sort((a, b) => missionSort(missionById(a.mission_id) || {}, missionById(b.mission_id) || {}));
  const work = mine.filter(a => { const x = missionById(a.mission_id); return x && x.type !== "ABSENCE" && aEnd(a) >= TODAY - 14 * DAY; });
  const absn = mine.filter(a => { const x = missionById(a.mission_id); return x && x.type === "ABSENCE" && aEnd(a) >= TODAY; });

  return `${selector}${back}
  <section class="panel hello"><div><span class="eyebrow">${esc(groupNames(m))} · ${esc(m.role || "")}</span><h2 style="font-size:1.4rem">${esc(m.name)}</h2>
    <p class="${stale ? "" : "muted"}" style="${stale ? "color:var(--warn)" : ""}">${freshTxt}${stale && !ro ? " Vérifie tes 3 prochaines semaines puis confirme." : ""}</p></div>
    ${ro ? "" : `<div class="actions"><button class="btn" id="btnConfirm">Confirmer le planning</button><button class="btn" id="btnAbsence">Poser une absence</button><button class="btn primary" id="btnAssign">+ Affecter à une mission</button></div>`}</section>
  <section class="panel"><div class="panel-head"><h2>Vue sur 3 semaines</h2>
    <div class="navw"><span class="eyebrow">${d1(free)} j libres</span><button class="btn small" data-nav="-1" aria-label="Semaine précédente">←</button><button class="btn small" data-nav="0">Aujourd'hui</button><button class="btn small" data-nav="1" aria-label="Semaine suivante">→</button></div></div>
    ${ro ? "" : `<form class="gselbar" id="gselBar" hidden><span id="gselInfo"></span><label>Mettre<input type="number" id="gselVal" min="0" max="100" step="1" inputmode="numeric" placeholder="%" aria-label="Pourcentage à appliquer"> %</label><button class="btn small primary" type="submit">Appliquer</button><button class="btn small" type="button" id="gselZero">Vider</button><span class="sep" aria-hidden="true"></span><button class="btn small" type="button" data-gk="abs">Absent</button><button class="btn small" type="button" data-gk="half">½ journée d'absence</button><button class="btn small" type="button" data-gk="normal">Comme prévu</button><button class="btn small" type="button" id="gselCancel">Annuler</button></form>`}
    <div class="scroll"><table class="dgrid"><thead>${head}</thead><tbody>${body}${emptyRow}${addRow}${totalRow}</tbody></table></div>
    <p class="muted small">${ro ? "" : "Clique sur une case pour saisir le % (Entrée ou Tab pour valider, Échap pour annuler, 0 pour retirer). Pour remplir en bloc : glisse sur plusieurs cases, Maj+clic, ou clique sur le nom d'une mission pour prendre ses 3 semaines. Clique sur la charge du jour pour poser une absence ou ajouter une autre mission. "}Les valeurs sont en % de la journée. Un point signale un jour ajusté manuellement.</p></section>
  <section class="panel"><div class="panel-head"><h2>Missions récurrentes</h2><span class="eyebrow">remplissent automatiquement le planning</span></div>
    <div class="scroll"><table class="list"><thead><tr><th>Mission</th><th>Type</th><th>Statut</th><th>Temps</th><th>Jours</th><th>Période</th><th>Fin dans</th><th></th></tr></thead><tbody>${assignRows(work, false) || `<tr><td colspan="8" class="empty-note">Aucune mission récurrente${ro ? "." : " : « + Affecter à une mission » pour en ajouter une."}</td></tr>`}</tbody></table></div></section>
  ${absn.length ? `<section class="panel"><div class="panel-head"><h2>Absences à venir</h2></div><div class="scroll"><table class="list"><thead><tr><th>Motif</th><th>Type</th><th></th><th>Temps</th><th>Jours</th><th>Période</th><th>Fin dans</th><th></th></tr></thead><tbody>${assignRows(absn, false)}</tbody></table></div></section>` : ""}`;
}

/* motif d'absence par défaut */
const absenceMission = () => state.missions.find(x => x.type === "ABSENCE" && x.active !== false && x.name === "Congés / absence") || state.missions.find(x => x.type === "ABSENCE" && x.active !== false);
/* ================= « + Ajouter une mission » : recherche dans le catalogue ================= */
let gridAddable = [], gaActive = 0, gaHits = [];
function gridAddPick(mis) {
  const mid = planTarget(); if (!mid || !mis) return;
  gaClose();
  state.gridExtra = state.gridExtra || {}; const ex = state.gridExtra[mid] = state.gridExtra[mid] || []; if (!ex.includes(mis)) ex.push(mis);
  const inp = $("gridAddQ"); if (inp) { inp.value = ""; inp.blur(); }
  render();
  const cells = [...document.querySelectorAll(`button[data-cell][data-mis="${CSS.escape(mis)}"]`)];
  const first = cells.find(b => +b.dataset.cell >= TODAY) || cells[0]; if (first) openCell(first);
}
function gaClose() { const l = $("gridAddList"); if (l) l.hidden = true; const i = $("gridAddQ"); if (i) i.setAttribute("aria-expanded", "false"); }
function gaDraw() {
  const inp = $("gridAddQ"), list = $("gridAddList"); if (!inp || !list) return;
  const words = normTxt(inp.value).split(/\s+/).filter(Boolean);
  gaHits = gridAddable.filter(m => { const h = normTxt(`${m.client} ${m.name} ${TYPES[m.type].label}`); return words.every(w => h.includes(w)); });
  gaActive = Math.min(gaActive, Math.max(0, gaHits.length - 1));
  const r = inp.getBoundingClientRect();
  Object.assign(list.style, { top: r.bottom + 4 + "px", left: r.left + "px", width: Math.max(r.width, 340) + "px" });
  list.innerHTML = gaHits.length ? gaHits.slice(0, 80).map((m, i) => `<li role="option" id="ga${i}" data-gadd="${esc(m.id)}" aria-selected="${i === gaActive}"><i class="dot" style="background:${TYPES[m.type].color}"></i><span><strong>${esc(m.name)}</strong>${m.client ? ` <span class="muted">· ${esc(m.client)}</span>` : ""}</span><small>${esc(TYPES[m.type].label)}${m.status === "probable" && m.type !== "ABSENCE" ? " · probable" : ""}</small></li>`).join("") + (gaHits.length > 80 ? `<li class="muted small more">… ${gaHits.length - 80} autres : précise ta recherche</li>` : "") : `<li class="muted small more">Aucune mission ne correspond</li>`;
  list.hidden = false; inp.setAttribute("aria-expanded", "true"); inp.setAttribute("aria-activedescendant", gaHits.length ? "ga" + gaActive : "");
  const act = $("ga" + gaActive); if (act) act.scrollIntoView({ block: "nearest" });
}
document.addEventListener("focusin", e => { if (e.target.id === "gridAddQ") { cellEditing = true; gaActive = 0; gaDraw(); } });
document.addEventListener("focusout", e => { if (e.target.id === "gridAddQ") { cellEditing = false; setTimeout(gaClose, 150); } });
document.addEventListener("keydown", e => {
  if (e.target.id !== "gridAddQ") return;
  if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); gaActive = Math.max(0, Math.min(Math.min(gaHits.length, 80) - 1, gaActive + (e.key === "ArrowDown" ? 1 : -1))); gaDraw(); }
  else if (e.key === "Enter") { e.preventDefault(); if (gaHits[gaActive]) gridAddPick(gaHits[gaActive].id); }
  else if (e.key === "Escape") { e.stopPropagation(); e.target.value = ""; e.target.blur(); }
});
document.addEventListener("mousedown", e => { const li = e.target.closest("#gridAddList [data-gadd]"); if (li) { e.preventDefault(); gridAddPick(li.dataset.gadd); } });
window.addEventListener("resize", gaClose);
document.addEventListener("scroll", e => { const l = $("gridAddList"); if (!l || l.hidden || e.target === l) return; const i = $("gridAddQ"), r = i && i.getBoundingClientRect(); if (r) Object.assign(l.style, { top: r.bottom + 4 + "px", left: r.left + "px" }); }, true);

/* ================= saisie en bloc : sélection de plusieurs cases (glisser, Maj+clic, clic sur le nom de la mission) ================= */
let gsel = null, gselDrag = false, gselMoved = false, gselNoClick = false;
function gridMatrix() {
  const table = document.querySelector("table.dgrid"); if (!table) return null;
  return [...table.querySelectorAll("tbody tr")].filter(tr => tr.querySelector("button[data-cell]")).map(tr => [...tr.querySelectorAll("td.v")]);
}
function cellPos(btn) { const M = gridMatrix(); if (!M) return null; const td = btn.closest("td"); for (let r = 0; r < M.length; r++) { const c = M[r].indexOf(td); if (c >= 0) return { r, c }; } return null; }
function gselCells() {
  const M = gridMatrix(); if (!gsel || !M) return [];
  const [r0, r1] = [gsel.a.r, gsel.b.r].sort((x, y) => x - y), [c0, c1] = [gsel.a.c, gsel.b.c].sort((x, y) => x - y);
  const out = []; for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const b = M[r] && M[r][c] && M[r][c].querySelector("button[data-cell]"); if (b) out.push(b); }
  return out;
}
function gselPaint() {
  document.querySelectorAll("table.dgrid td.gsel").forEach(td => td.classList.remove("gsel"));
  const cells = gselCells(); cells.forEach(b => b.parentElement.classList.add("gsel"));
  const bar = $("gselBar"); if (!bar) return;
  if (cells.length < 2) { bar.hidden = true; cellEditing = false; return; }
  cellEditing = true; bar.hidden = false;
  const days = new Set(cells.map(b => b.dataset.cell)).size, mis = new Set(cells.map(b => b.dataset.mis)).size;
  $("gselInfo").textContent = `${cells.length} cases · ${days} jour${days > 1 ? "s" : ""}${mis > 1 ? ` · ${mis} missions` : ""}`;
  const inp = $("gselVal"); if (document.activeElement !== inp) { inp.focus(); inp.select(); }
}
function gselClear() { gsel = null; gselPaint(); }
function gselRow(btn) { const M = gridMatrix(); const pos = cellPos(btn); if (!M || !pos) return; const row = M[pos.r]; gsel = { a: { r: pos.r, c: 0 }, b: { r: pos.r, c: row.length - 1 } }; gselPaint(); }
async function gselApply(v) {
  const cells = gselCells(); const mid = planTarget(); const m = mid && memberById(mid);
  if (!cells.length || !m || !canEditMember(m)) return;
  v = Math.max(0, Math.min(100, Math.round(+v || 0)));
  const byDay = new Map(); for (const b of cells) { const t = +b.dataset.cell; (byDay.get(t) || byDay.set(t, new Set()).get(t)).add(b.dataset.mis); }
  const days = [...byDay.keys()]; const ins = [];
  for (const t of days) {
    const set = byDay.get(t);
    const rows = dayRows(mid, t).filter(r => !set.has(r.mission) && r.pct > 0);
    if (v > 0) set.forEach(mis => rows.push({ mission: mis, pct: v }));
    if (rows.length) rows.forEach(r => ins.push({ member_id: mid, day: iso(t), mission_id: r.mission, pct: r.pct })); else ins.push({ member_id: mid, day: iso(t), mission_id: null, pct: 0 });
  }
  $("gselBar").querySelectorAll("button,input").forEach(x => x.disabled = true);
  try {
    await q(sb.from("day_entries").delete().eq("member_id", mid).in("day", days.map(iso)));
    for (let i = 0; i < ins.length; i += 500) await q(sb.from("day_entries").insert(ins.slice(i, i + 500)));
    await touchStatus(mid, "updated_at");
    toast(`${days.length} jour${days.length > 1 ? "s" : ""} mis à jour`);
  } catch (err) { toast(errMsg(err)); }
  gsel = null; cellEditing = false; await after();
}
/* absence, demi-journée ou retour aux missions récurrentes sur tous les jours sélectionnés */
async function gselKind(kind) {
  const cells = gselCells(); const mid = planTarget(); const m = mid && memberById(mid);
  if (!cells.length || !m || !canEditMember(m)) return;
  if (kind !== "normal" && !absenceMission()) { toast("Aucun motif d'absence dans le catalogue."); return; }
  const days = [...new Set(cells.map(b => +b.dataset.cell))]; const ins = [];
  for (const t of days) { const rows = kindRows(mid, t, kind); if (rows == null) continue; if (rows.length) rows.forEach(r => ins.push({ member_id: mid, day: iso(t), mission_id: r.mission, pct: r.pct })); else ins.push({ member_id: mid, day: iso(t), mission_id: null, pct: 0 }); }
  $("gselBar").querySelectorAll("button,input").forEach(x => x.disabled = true);
  try {
    await q(sb.from("day_entries").delete().eq("member_id", mid).in("day", days.map(iso)));
    for (let i = 0; i < ins.length; i += 500) await q(sb.from("day_entries").insert(ins.slice(i, i + 500)));
    await touchStatus(mid, "updated_at");
    toast(`${{ abs: "Absence", half: "Demi-journée d'absence", normal: "Retour aux missions récurrentes" }[kind]} : ${days.length} jour${days.length > 1 ? "s" : ""}`);
  } catch (err) { toast(errMsg(err)); }
  gsel = null; cellEditing = false; await after();
}
document.addEventListener("mousedown", e => {
  if (e.button !== 0) return;
  const b = e.target.closest("table.dgrid button[data-cell]");
  if (!b) { if (gsel && !e.target.closest("#gselBar")) gselClear(); return; }
  const pos = cellPos(b); if (!pos) return;
  if (e.shiftKey && gsel) { e.preventDefault(); gsel.b = pos; gselNoClick = true; gselPaint(); return; }
  gsel = { a: pos, b: pos }; gselDrag = true; gselMoved = false; gselPaint();
});
document.addEventListener("mouseover", e => {
  if (!gselDrag || !gsel) return;
  const b = e.target.closest("table.dgrid button[data-cell]"); if (!b) return;
  const pos = cellPos(b); if (!pos || (pos.r === gsel.b.r && pos.c === gsel.b.c)) return;
  gsel.b = pos; gselMoved = true; e.preventDefault(); gselPaint();
});
document.addEventListener("mouseup", () => { if (!gselDrag) return; gselDrag = false; if (gselMoved) gselNoClick = true; else gsel = gsel && { a: gsel.a, b: gsel.a }; });
document.addEventListener("selectstart", e => { if (gselDrag) e.preventDefault(); });

/* ================= saisie directe dans la grille ================= */
let cellEditing = false, cellQueue = Promise.resolve();
function dayRows(mid, t) {
  const rows = []; for (const p of partsFor(mid, t).parts) { const r = rows.find(x => x.mission === p.m.id); if (r) r.pct += p.pct; else rows.push({ mission: p.m.id, pct: p.pct }); }
  rows.forEach(r => r.pct = Math.min(100, Math.round(r.pct)));
  return rows;
}
function cellSiblings(btn) { return [...btn.closest("tr").querySelectorAll("button[data-cell]")]; }
function openCell(btn) {
  const mid = planTarget(); const m = mid && memberById(mid); if (!m || !canEditMember(m)) return;
  const t = +btn.dataset.cell, mis = btn.dataset.mis;
  const cur = (dayRows(mid, t).find(r => r.mission === mis) || {}).pct || 0;
  const td = btn.parentElement;
  td.innerHTML = `<input type="number" class="cin" min="0" max="100" step="1" inputmode="numeric" value="${cur || ""}" aria-label="${esc(btn.getAttribute("aria-label"))}">`;
  const inp = td.firstElementChild; cellEditing = true; inp.focus(); inp.select();
  let done = false;
  const finish = (save, move) => {
    if (done) return; done = true; cellEditing = false;
    const raw = inp.value.trim(); const v = raw === "" ? 0 : Math.max(0, Math.min(100, Math.round(+raw)));
    const next = move ? { t: t + 0, mis, move } : null;
    if (!save || isNaN(v) || v === cur) {
      td.innerHTML = ""; td.append(btn); btn.textContent = cur || "";
      if (next) { const sib = cellSiblings(btn); const n = sib[sib.indexOf(btn) + move]; if (n) openCell(n); } else btn.focus();
      return;
    }
    td.innerHTML = `<span class="cin-wait">${v || ""}</span>`;
    cellQueue = cellQueue.then(() => saveCell(mid, t, mis, v, next));
  };
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); finish(true, 0); }
    else if (e.key === "Tab") { e.preventDefault(); finish(true, e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false, 0); }
  });
  inp.addEventListener("blur", () => finish(true, 0));
}
/* retire une mission de toutes les journées affichées (les autres missions du jour sont conservées) */
async function removeRow(mid, mis, from) {
  const ex = (state.gridExtra || {})[mid]; if (ex) state.gridExtra[mid] = ex.filter(x => x !== mis);
  const touched = threeWeeks(from).filter(d => isWorkday(d) && dayRows(mid, d).some(r => r.mission === mis));
  if (!touched.length) { render(); return; }
  const ins = [];
  for (const d of touched) {
    const rows = dayRows(mid, d).filter(r => r.mission !== mis && r.pct > 0);
    if (rows.length) rows.forEach(r => ins.push({ member_id: mid, day: iso(d), mission_id: r.mission, pct: r.pct })); else ins.push({ member_id: mid, day: iso(d), mission_id: null, pct: 0 });
  }
  try {
    await q(sb.from("day_entries").delete().eq("member_id", mid).in("day", touched.map(iso)));
    await q(sb.from("day_entries").insert(ins));
    await touchStatus(mid, "updated_at");
    toast(`Mission retirée de ${touched.length} jour${touched.length > 1 ? "s" : ""}`);
  } catch (err) { toast(errMsg(err)); }
  await after();
}
async function saveCell(mid, t, mis, v, next) {
  const rows = dayRows(mid, t).filter(r => r.mission !== mis && r.pct > 0);
  if (v > 0) rows.push({ mission: mis, pct: v });
  try {
    await q(sb.from("day_entries").delete().eq("member_id", mid).eq("day", iso(t)));
    await q(sb.from("day_entries").insert(rows.length ? rows.map(r => ({ member_id: mid, day: iso(t), mission_id: r.mission, pct: r.pct })) : [{ member_id: mid, day: iso(t), mission_id: null, pct: 0 }]));
    await touchStatus(mid, "updated_at");
  } catch (err) { toast(errMsg(err)); }
  try { await loadAll(); } catch (err) { toast(errMsg(err)); }
  if (cellEditing) { schedule(); return; }
  render();
  if (next) {
    const btn = document.querySelector(`button[data-cell="${t}"][data-mis="${CSS.escape(mis)}"]`);
    const n = btn && cellSiblings(btn)[cellSiblings(btn).indexOf(btn) + next.move];
    if (n) openCell(n);
  }
}
/* lignes d'une journée pour un choix rapide (null = revenir aux missions récurrentes, [] = libre).
   La demi-journée garde les missions du jour, saisies à la main ou récurrentes, ramenées à leur moitié. */
function kindRows(mid, t, kind) {
  if (kind === "normal") return null;
  if (kind === "free") return [];
  const a = absenceMission(); if (!a) return undefined;
  if (kind === "abs") return [{ mission: a.id, pct: 100 }];
  const cur = partsFor(mid, t).parts;
  const abs = Math.min(100, cur.filter(p => p.m.type === "ABSENCE").reduce((s, p) => s + p.pct, 0));
  let work = abs < 100 ? cur.filter(p => p.m.type !== "ABSENCE" && p.pct > 0).map(p => ({ id: p.m.id, pct: p.pct * 100 / (100 - abs) })) : [];
  if (!work.length) work = partsFor(mid, t, true).parts.filter(p => p.m.type !== "ABSENCE" && p.pct > 0).map(p => ({ id: p.m.id, pct: p.pct }));
  const rows = [{ mission: a.id, pct: 50 }];
  for (const p of work) { const v = Math.max(5, Math.round(Math.min(100, p.pct) / 2 / 5) * 5); const x = rows.find(r => r.mission === p.id); if (x) x.pct = Math.min(100, x.pct + v); else rows.push({ mission: p.id, pct: v }); }
  return rows;
}

/* ================= Matrice de disponibilité (admin) ================= */
const MX_WEEKS = 4;
/* nom affiché du projet : le client, sauf pour l'interne où l'on garde le nom de la mission */
function projectName(m) { const c = (m.client || "").trim(); return c && c.toLowerCase() !== "interne" ? c : m.name; }
function frac(v, days) { const r = Math.round(v * 2) / 2; return `${String(r).replace(".", ",")}/${days}`; }
function mxWeeks() { const s = monday(TODAY) + state.mxOffset * 7 * DAY; return Array.from({ length: MX_WEEKS }, (_, i) => s + i * 7 * DAY); }
function matrixCell(mid, mon) {
  const segs = new Map(); let days = 0, abs = 0, free = 0, net = 0, client = 0;
  for (let i = 0; i < 5; i++) {
    const t = mon + i * DAY; const r = dayCell(mid, t, true); if (!r) continue;
    days++; abs += r.abs; free += r.free; net += r.net; client += r.BUILD + r.RUN;
    for (const p of r.parts) {
      if (p.m.type === "ABSENCE") continue;
      const prob = p.m.status === "probable"; const key = projectName(p.m) + (prob ? "|p" : "");
      const sg = segs.get(key) || { label: projectName(p.m), prob, v: 0 }; sg.v += p.pct / 100; segs.set(key, sg);
    }
  }
  const list = [...segs.values()].filter(x => x.v >= 0.05).sort((a, b) => b.v - a.v);
  const out = { days, abs, free, net, client, segs: list, cls: "ok", parts: [] };
  if (!days) { out.cls = "hol"; out.parts = [{ t: "Férié" }]; return out; }
  if (abs >= days - 0.01) { out.cls = "off"; out.parts = [{ t: "Off" }]; return out; }
  if (!list.length && free > 0.01) { out.cls = "interco"; out.parts = [{ t: "Interco" }]; return out; }
  const n = list.length + (abs > 0.01 ? 1 : 0) + (free >= 0.5 ? 1 : 0); const many = n > 1;
  out.parts = list.map(x => ({ t: x.label + (x.prob ? " ?" : "") + (many ? ` (${frac(x.v, days)})` : ""), c: x.prob ? "sg-prob" : "" }));
  if (abs > 0.01) out.parts.push({ t: `Off (${frac(abs, days)})`, c: "sg-off" });
  if (free >= 0.5) out.parts.push({ t: `Interco (${frac(free, days)})`, c: "sg-int" });
  out.cls = list.some(x => x.prob) ? "prob" : "ok";
  return out;
}
function matrixData() {
  const W = mxWeeks(); const people = state.consultants.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "fr"));
  const rows = people.map(c => ({ c, cells: W.map(w => matrixCell(c.id, w)) }));
  const tot = W.map((w, i) => { const t = { free: 0, net: 0, client: 0, days: 0 }; rows.forEach(r => { const x = r.cells[i]; t.free += x.free; t.net += x.net; t.client += x.client; t.days = Math.max(t.days, x.days); }); return t; });
  return { W, rows, tot };
}
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
const monthName = t => capFirst(new Date(t).toLocaleDateString("fr-FR", { month: "long", timeZone: "UTC" }));
const wkRange = t => `${new Date(t).getUTCDate()} → ${new Date(t + 4 * DAY).getUTCDate()}`;
function viewMatrix() {
  if (!state.members.length) return `<div class="panel state"><h2>Aucun consultant</h2><p>Crée l'équipe dans l'administration pour voir la matrice.</p></div>`;
  const { W, rows, tot } = matrixData(); const cur = monday(TODAY);
  const head = `<tr class="m"><th class="who" rowspan="3">Consultant</th>${W.map(w => `<th class="${w === cur ? "now" : ""}">${monthName(w)}</th>`).join("")}</tr>
    <tr>${W.map(w => `<th class="${w === cur ? "now" : ""}">S${isoWeek(w)}</th>`).join("")}</tr>
    <tr>${W.map(w => `<th class="${w === cur ? "now" : ""}">${wkRange(w)}</th>`).join("")}</tr>`;
  const body = rows.map(r => `<tr><th class="who" scope="row"><button data-plan="${esc(r.c.id)}">${esc(r.c.name)}</button><small>${esc(r.c.role || "")}</small></th>${r.cells.map((x, i) => `<td class="cell ${x.cls} ${W[i] === cur ? "now" : ""}">${x.parts.map(p => p.c ? `<span class="${p.c}">${esc(p.t)}</span>` : esc(p.t)).join(" / ")}</td>`).join("")}</tr>`).join("");
  const foot = `<tr class="gap"><th></th>${W.map(() => "<td></td>").join("")}</tr>
    <tr><th>Ressources en interco</th>${tot.map(t => `<td class="${t.free >= 0.5 ? "bad" : ""}">${t.days ? d1(t.free / t.days) : "–"}</td>`).join("")}</tr>
    <tr><th>% interco</th>${tot.map(t => `<td>${t.net ? Math.round(t.free / t.net * 100) + " %" : "–"}</td>`).join("")}</tr>
    <tr><th>Taux de staffing client</th>${tot.map(t => `<td>${t.net ? Math.round(t.client / t.net * 100) + " %" : "–"}</td>`).join("")}</tr>`;
  return `<div class="bar"><div class="controls">
      <select class="sel" id="gSel" aria-label="Groupe"><option value="">Toute l'équipe (${state.members.length})</option>${state.groups.map(g => `<option value="${esc(g.id)}" ${state.group === g.id ? "selected" : ""}>${esc(g.name)} (${state.members.filter(m => inGroup(m, g.id)).length})</option>`).join("")}</select>
      <div class="navw"><button class="btn small" data-mxnav="-4" aria-label="4 semaines plus tôt">←</button><button class="btn small" data-mxnav="0">Aujourd'hui</button><button class="btn small" data-mxnav="4" aria-label="4 semaines plus tard">→</button></div></div>
    <button class="btn" id="btnMxExport">Exporter (Excel)</button></div>
  <section class="panel"><div class="panel-head"><h2>Matrice de disponibilité</h2><span class="eyebrow">S${isoWeek(W[0])} à S${isoWeek(W[W.length - 1])} · par semaine</span></div>
    <div class="scroll"><table class="mx"><thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>
    <div class="mx-legend"><span><i style="background:var(--h-ok)"></i>Staffé (ferme)</span><span><i style="background:var(--h-low)"></i>Contient du probable « ? »</span><span><i style="background:var(--h-over)"></i>Interco</span><span><i style="background:var(--off)"></i>Off (absence)</span><span>(3/5) = 3 jours sur 5 ouvrés</span></div>
  </section>`;
}
function exportMatrix() {
  const { W, rows, tot } = matrixData();
  const cell = v => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [["Consultant", ...W.map(w => `S${isoWeek(w)} (${frDate(w)} → ${frDate(w + 4 * DAY)})`)]];
  rows.forEach(r => lines.push([r.c.name, ...r.cells.map(x => x.parts.map(p => p.t).join(" / "))]));
  lines.push([]);
  lines.push(["Ressources en interco", ...tot.map(t => t.days ? d1(t.free / t.days) : "")]);
  lines.push(["% interco", ...tot.map(t => t.net ? Math.round(t.free / t.net * 100) + " %" : "")]);
  lines.push(["Taux de staffing client", ...tot.map(t => t.net ? Math.round(t.client / t.net * 100) + " %" : "")]);
  const csv = "\ufeff" + lines.map(l => l.map(cell).join(";")).join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `Matrice-disponibilite_S${isoWeek(W[0])}-S${isoWeek(W[W.length - 1])}_${iso(TODAY)}.csv`;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  toast("Matrice exportée");
}

/* ================= vue Missions (admin) ================= */
function viewMissions() {
  const f = state.mFilter;
  const list = state.missions.filter(m => f === "toutes" || (f === "actives" ? m.active !== false : m.active === false)).sort(missionSort);
  const D = workdaysBetween(monday(TODAY), monday(TODAY) + 20 * DAY);
  const sel = state.mSel = state.mSel || new Set();
  for (const id of [...sel]) if (!list.some(m => m.id === id)) sel.delete(id);
  const allSel = list.length > 0 && list.every(m => sel.has(m.id));
  const rows = list.map(m => {
    const who = [...new Set(state.assign.filter(a => a.mission_id === m.id && aEnd(a) >= TODAY).map(a => a.member_id))];
    let charge = 0; for (const mem of state.members) for (const t of D) { const r = dayCell(mem.id, t, true); for (const p of r.parts) if (p.m.id === m.id) charge += p.pct / 100; }
    return `<tr${sel.has(m.id) ? ' class="sel"' : ""}><td class="chk"><input type="checkbox" class="mSelChk" data-msel="${esc(m.id)}" ${sel.has(m.id) ? "checked" : ""} aria-label="Sélectionner ${esc(missionLabel(m))}"></td><td><strong>${esc(m.name)}</strong><br><span class="muted">${esc(m.client || "")}</span></td><td>${typeTag(m.type)}</td><td>${statusPill(m)}${m.active === false ? ' <span class="pill">Archivée</span>' : ""}</td>
      <td class="mono small" style="white-space:nowrap">${m.start_date ? frDateY(parse(m.start_date)) : "—"} → ${m.end_date ? frDateY(parse(m.end_date)) : "sans fin"}</td>
      <td class="small">${who.length ? esc(who.map(cName).join(", ")) : `<span class="muted">Personne</span>`}</td><td class="mono">${d1(charge)} j</td>
      <td style="white-space:nowrap"><button class="btn small" data-mi="${esc(m.id)}">Modifier</button> ${m.active !== false ? `<button class="btn small" data-massign="${esc(m.id)}">Affecter</button>` : ""}</td></tr>`;
  }).join("");
  return `<div class="bar"><div class="seg" role="group" aria-label="Filtre">${[["actives", "Actives"], ["archivees", "Archivées"], ["toutes", "Toutes"]].map(([k, l]) => `<button data-mf="${k}" aria-pressed="${f === k}">${l}</button>`).join("")}</div><div class="bar"><button class="btn" id="btnBulkM">Import en masse</button><button class="btn primary" id="btnAddM">+ Mission</button></div></div>
  <section class="panel"><div class="panel-head"><h2>Catalogue des missions</h2>${sel.size ? `<div class="bar selbar"><strong>${sel.size} sélectionnée${sel.size > 1 ? "s" : ""}</strong><button class="btn small" id="mSelNone">Désélectionner</button><button class="btn small" id="mSelArch">Archiver</button><button class="btn small" id="mSelUnarch">Réactiver</button><button class="btn small danger" id="mSelDel">Supprimer</button></div>` : `<span class="eyebrow">${list.length} mission${list.length > 1 ? "s" : ""}</span>`}</div>
    <p class="muted small">Les collaborateurs choisissent dans ce catalogue. Une mission sans date de fin (ex. projet à l'année, TMA) remplit leur planning en continu. Les missions de type Absence (congés, temps partiel) sont proposées à tous dans « Poser une absence ».</p>
    <div class="scroll"><table class="list"><thead><tr><th class="chk"><input type="checkbox" id="mSelAll" ${allSel ? "checked" : ""} ${list.length ? "" : "disabled"} aria-label="Tout sélectionner"></th><th>Mission</th><th>Type</th><th>Statut</th><th>Période</th><th>Consultants</th><th>Charge 3 sem.</th><th></th></tr></thead><tbody>${rows || `<tr><td colspan="8" class="empty-note">Aucune mission. Commence par « + Mission ».</td></tr>`}</tbody></table></div></section>`;
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
      <ul class="mstaff">${state.groups.map(g => { const n = state.members.filter(m => inGroup(m, g.id)).length; return `<li class="grow"><div class="inline row1"><input id="gName-${esc(g.id)}" value="${esc(g.name)}" aria-label="Nom du groupe"><button class="btn small" data-grename="${esc(g.id)}">Renommer</button>${hasGroupsCol() ? `<button class="btn small" data-gmem="${esc(g.id)}">Membres (${n})</button> ` : ""}<button class="btn small danger" data-gdel="${esc(g.id)}" ${n ? `disabled title="Le groupe contient ${n} consultant(s)"` : ""}>Supprimer</button></div></li>`; }).join("") || `<li class="empty-note">Aucun groupe.</li>`}</ul>
      <form class="inline" id="gAddForm"><input id="gNew" placeholder="Nouveau groupe, ex. Pôle IA & Agents" required aria-label="Nom du nouveau groupe"><button class="btn primary small" type="submit">Ajouter</button></form>
    </section>
  </div>
  <section class="panel"><h2>Inviter un collaborateur</h2>
    <ol class="steps"><li>Crée son profil ci-dessous avec son e-mail ${esc(DOMAINS.map(d => "@" + d).join(" ou "))} et un mot de passe provisoire (ou « Créer le compte » sur un profil existant). Aucun e-mail n'est envoyé.</li><li>Transmets-lui l'adresse de l'application et ce mot de passe.</li><li>À sa première connexion, il choisit son propre mot de passe, puis s'affecte à ses missions en quelques clics.</li></ol>
    <p class="muted small">Autre possibilité : il se connecte par lien, choisit son nom dans « Mon planning » et tu valides la demande en haut de cette page.</p></section>
  <section class="panel"><div class="panel-head"><h2>Équipe</h2><button class="btn primary" id="btnAddC">+ Consultant</button></div>
    <div class="scroll"><table class="list"><thead><tr><th>Consultant</th><th>Groupes</th><th>Rôle</th><th>Compte</th><th>Planning</th><th></th></tr></thead><tbody>${state.members.map(m => { const f = freshness(m); return `<tr><td><strong>${esc(m.name)}</strong></td><td>${esc(groupNames(m))}</td><td>${esc(m.role || "")}</td><td>${m.user_id ? esc(m.user_email || "Compte rattaché") : `<span class="pill">Non rattaché</span>`}</td><td><span class="person"><i class="fresh ${f.cls}"></i>${esc(f.label)}</span></td><td style="white-space:nowrap"><button class="btn small" data-c="${esc(m.id)}">Modifier</button> <button class="btn small" data-plan="${esc(m.id)}">Planning</button>${m.user_id ? ` <button class="btn small" data-pwreset="${esc(m.id)}">Mot de passe</button> <button class="btn small" data-unlink="${esc(m.id)}">Détacher</button>` : ` <button class="btn small primary" data-acct="${esc(m.id)}">Créer le compte</button>`}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty-note">Aucun consultant.</td></tr>`}</tbody></table></div></section>`;
}

/* ================= connexion ================= */
function viewLogin(msg) {
  $("tabs").innerHTML = ""; $("meChip").hidden = true; $("banner").hidden = true;
  main().innerHTML = `<section class="panel login">
    <span class="eyebrow">Connexion</span>
    <h2>Accède au plan de charge</h2>
    <p class="muted">Connecte-toi avec ton e-mail professionnel et ton mot de passe. Ton administrateur t'a donné un mot de passe provisoire ? Utilise-le : tu choisiras le tien juste après. Sinon, reçois un lien par e-mail.</p>
    <form id="loginForm" class="login-form">
      <label class="f">E-mail<input type="email" id="loginEmail" required autocomplete="username" placeholder="prenom.nom@${esc(DOMAINS[0] || "datatilt.com")}"></label>
      <label class="f">Mot de passe<input type="password" id="loginPw" autocomplete="current-password"></label>
      <button class="btn primary" type="submit" id="loginBtn">Se connecter</button>
      <div class="login-alt"><button class="btn" type="button" id="loginLink">Recevoir un lien de connexion</button><button class="linkbtn" type="button" id="loginForgot">Mot de passe oublié ?</button></div>
    </form>
    <p id="loginMsg" class="login-msg">${msg || ""}</p>
  </section>`;
}
const loginMsg = (html, ok) => { $("loginMsg").innerHTML = `<span style="color:var(${ok ? "--good" : "--bad"})">${html}</span>`; };
function loginEmailOk() {
  const email = $("loginEmail").value.trim().toLowerCase();
  if (!email || !$("loginEmail").checkValidity()) { loginMsg("Saisis ton adresse e-mail."); $("loginEmail").focus(); return null; }
  const dom = email.split("@")[1] || "";
  if (DOMAINS.length && !DOMAINS.includes(dom)) { loginMsg(`Seules les adresses ${esc(DOMAINS.map(d => "@" + d).join(", "))} peuvent se connecter.`); return null; }
  return email;
}
async function signInPw() {
  const email = loginEmailOk(); if (!email) return;
  const pw = $("loginPw").value;
  if (!pw) { loginMsg("Saisis ton mot de passe, ou reçois un lien de connexion."); $("loginPw").focus(); return; }
  $("loginBtn").disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password: pw });
  if (!$("loginBtn")) return;
  $("loginBtn").disabled = false;
  if (error) loginMsg(/invalid/i.test(error.message || "") ? "E-mail ou mot de passe incorrect. Pas encore de mot de passe ? Clique sur « Recevoir un lien de connexion »." : "Connexion impossible : " + esc(error.message));
}
async function forgotPw() {
  const email = loginEmailOk(); if (!email) return;
  $("loginForgot").disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname });
  $("loginForgot").disabled = false;
  if (error) { loginMsg(/rate|seconds/i.test(error.message || "") ? "Trop de demandes rapprochées : patiente une minute." : "Envoi impossible : " + esc(error.message)); return; }
  loginMsg(`Un lien pour choisir un nouveau mot de passe a été envoyé à <strong>${esc(email)}</strong>.`, true);
}
/* choisir ou changer son mot de passe (aussi ouvert après un lien « mot de passe oublié ») */
function passwordModal(recovery, forced) {
  openModal(`<form class="modal" id="pwForm" aria-label="Mot de passe">
    <h2>${forced ? "Choisis ton mot de passe" : recovery ? "Choisis un nouveau mot de passe" : "Mon mot de passe"}</h2>
    ${forced ? `<p class="small">Tu t'es connecté avec un mot de passe provisoire. Remplace-le par le tien pour continuer.</p>` : ""}
    <p class="muted small">Au moins 8 caractères. Tu pourras ensuite te connecter avec ${esc(state.me.email)} et ce mot de passe, sans attendre de lien.</p>
    <input type="text" autocomplete="username" value="${esc(state.me.email)}" hidden>
    <label class="f">Nouveau mot de passe<input type="password" id="pw1" required minlength="8" autocomplete="new-password"></label>
    <label class="f">Confirmation<input type="password" id="pw2" required minlength="8" autocomplete="new-password"></label>
    <p class="small" id="pwMsg"></p>
    <div class="row-actions"><span></span><div class="r"><button type="button" class="btn" id="pwCancel">${forced ? "Se déconnecter" : "Annuler"}</button><button class="btn primary" type="submit" id="pwSave">Enregistrer</button></div></div>
  </form>`);
  modalLocked = !!forced;
  $("pw1").focus();
  $("pwCancel").onclick = forced ? () => { modalLocked = false; closeModal(); sb.auth.signOut(); } : closeModal;
  $("pwForm").addEventListener("submit", async e => {
    e.preventDefault();
    const a = $("pw1").value, b = $("pw2").value; const msg = t => $("pwMsg").innerHTML = `<span style="color:var(--bad)">${esc(t)}</span>`;
    if (a.length < 8) return msg("Le mot de passe doit faire au moins 8 caractères.");
    if (a !== b) return msg("Les deux mots de passe ne sont pas identiques.");
    $("pwSave").disabled = true;
    const { error } = await sb.auth.updateUser({ password: a, data: { must_change_password: false } });
    if (error) { $("pwSave").disabled = false; return msg(/same/i.test(error.message || "") ? "C'est déjà ton mot de passe actuel." : /reauth|recent/i.test(error.message || "") ? "Pour des raisons de sécurité, reconnecte-toi avec un lien puis recommence." : /weak|short|least/i.test(error.message || "") ? "Mot de passe trop simple : allonge-le ou ajoute des chiffres et symboles." : "Enregistrement impossible : " + error.message); }
    modalLocked = false; closeModal(); toast("Mot de passe enregistré");
  });
}
async function sendLink(email) {
  email = loginEmailOk(); if (!email) return;
  $("loginLink").disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin + window.location.pathname } });
  $("loginLink").disabled = false;
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
  const tabs = [["moi", "Mon planning"]];
  if (canOverview()) tabs.push(["equipe", "Équipe"]);
  if (isAdmin()) tabs.push(["matrice", "Matrice"], ["missions", "Missions"], ["admin", "Administration"]);
  $("tabs").innerHTML = tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${l}${k === "admin" && pc ? `<span class="count">${pc}</span>` : ""}</button>`).join("");
}
function renderChip() {
  const chip = $("meChip"); chip.hidden = false; const m = myMember();
  chip.innerHTML = `<span class="avatar" aria-hidden="true"></span><span class="n"></span><span class="badge ${isAdmin() ? "admin" : ""}">${isAdmin() ? "Administrateur" : isManager() ? "Manager" : "Collaborateur"}</span><button class="btn small" id="btnPw">Mot de passe</button><button class="btn small" id="btnLogout">Déconnexion</button>`;
  chip.querySelector(".avatar").textContent = initials(m ? m.name : state.me.email);
  chip.querySelector(".n").textContent = m ? m.name : state.me.email;
}
function render() {
  if (!state.me.id) return;
  if (!state.loaded) { main().innerHTML = `<div class="state">Chargement du plan de charge…</div>`; return; }
  if (!state.tab) state.tab = canOverview() ? "equipe" : "moi";
  if (state.tab === "equipe" && !canOverview()) { state.tab = "moi"; state.planMember = null; }
  if ((state.tab === "admin" || state.tab === "missions" || state.tab === "matrice") && !isAdmin()) state.tab = "moi";
  if (!canOverview()) state.prob = true;
  if (state.group && !state.groups.some(g => g.id === state.group)) state.group = "";
  rebuild(); renderTabs(); renderChip();
  const ex = state.members.some(m => m.example) || state.missions.some(m => m.example); const ban = $("banner"); ban.hidden = !(ex && isAdmin());
  if (ex && isAdmin()) ban.innerHTML = `<div class="banner"><span><strong>Données d'exemple.</strong> Ces consultants et missions montrent l'outil. Crée tes missions et ton équipe, puis supprime-les.</span><button class="btn small danger" id="btnClearEx">Supprimer les exemples</button></div>`;
  const fs = document.activeElement && document.activeElement.id;
  const views = { admin: viewAdmin, missions: viewMissions, matrice: viewMatrix, moi: viewPlanning, equipe: viewTeam };
  main().innerHTML = `<div class="stack">${(views[state.tab] || viewTeam)()}</div>`;
  renderFinderResults();
  if (fs) { const el = $(fs); if (el && el.focus) { el.focus(); if (el.type === "search" || el.type === "text") { const v = el.value; try { el.setSelectionRange(v.length, v.length); } catch (_) {} } } }
}
let rT = null; const schedule = () => { clearTimeout(rT); rT = setTimeout(() => cellEditing ? schedule() : render(), 30); };

/* ================= données ================= */
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
async function fetchAll(make) {
  const out = [];
  for (let from = 0; ; from += 1000) { const { data, error } = await make().range(from, from + 999); if (error) throw error; out.push(...data); if (data.length < 1000) break; }
  return out;
}
async function loadAll() {
  const from = iso(monday(TODAY) - 13 * 7 * DAY), to = iso(TODAY + 40 * 7 * DAY);
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
let modalLocked = false; // modale qu'on ne peut pas fermer (mot de passe provisoire à remplacer)
function closeModal() { if (modalLocked) return; $("modalRoot").innerHTML = ""; }
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
  const drawTotal = () => {
    const abs = rows.filter(r => (missionById(r.mission) || {}).type === "ABSENCE").reduce((s, r) => s + (+r.pct || 0), 0);
    const work = rows.filter(r => (missionById(r.mission) || {}).type !== "ABSENCE").reduce((s, r) => s + (+r.pct || 0), 0);
    const load = abs >= 100 ? null : work / (100 - abs);
    $("dTotal").innerHTML = abs >= 100 ? "Absent toute la journée" : `Charge : <strong style="color:${load > 1.001 ? "var(--bad)" : load >= .85 ? "var(--good)" : "inherit"}">${pct(load)}</strong>${abs ? ` · absence ${abs} %` : ""}`;
  };
  const draw = () => {
    $("dRows").innerHTML = rows.length ? rows.map((r, i) => `<li class="drow"><select data-ri="${i}" class="dM" aria-label="Mission">${missionOptions(list, r.mission)}</select><input type="number" class="dP" data-ri="${i}" min="1" max="100" step="1" value="${r.pct}" aria-label="Pourcentage de la journée"><button type="button" class="btn small" data-rdel="${i}" aria-label="Retirer">✕</button></li>`).join("") : `<li class="empty-note">Journée libre : aucune mission ce jour-là.</li>`;
    drawTotal();
  };
  draw();
  const form = $("dForm");
  form.addEventListener("input", e => { const i = +e.target.dataset.ri; if (isNaN(i)) return; if (e.target.classList.contains("dM")) rows[i].mission = e.target.value; if (e.target.classList.contains("dP")) rows[i].pct = Math.max(0, Math.min(100, +e.target.value || 0)); drawTotal(); });
  form.addEventListener("change", e => { const i = +e.target.dataset.ri; if (isNaN(i)) return; if (e.target.classList.contains("dM")) rows[i].mission = e.target.value; if (e.target.classList.contains("dP")) { rows[i].pct = Math.max(0, Math.min(100, +e.target.value || 0)); e.target.value = rows[i].pct; } drawTotal(); });
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
      <div class="full"><span class="eyebrow">${absence ? "Durée" : "Temps passé chaque jour"}</span><div class="pcts" id="aPcts">${presets.map(([v, l]) => `<button type="button" data-p="${v}" aria-pressed="${cur.pct === v}">${l}</button>`).join("")}<input type="number" id="aPct" min="1" max="100" step="1" value="${cur.pct}" aria-label="Pourcentage personnalisé"> %</div></div>
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
/* --- suppression de missions (une ou plusieurs). Une mission utilisée dans des plannings
   n'est supprimée qu'après confirmation, avec ses affectations et ses jours saisis. --- */
function deleteMissions(ids) {
  const usage = ids.map(id => {
    const as = state.assign.filter(a => a.mission_id === id); const en = state.entries.filter(e => e.mission_id === id);
    return { id, m: missionById(id), as: as.length, days: new Set(en.map(e => e.member_id + e.day)).size, who: [...new Set([...as, ...en].map(x => x.member_id))] };
  });
  const used = usage.filter(u => u.as || u.days);
  if (!used.length) return runDelete(ids, false);
  const freeN = ids.length - used.length;
  openModal(`<div class="modal" role="dialog" aria-label="Supprimer des missions utilisées">
    <h2>${used.length === 1 ? "Cette mission est utilisée" : `${used.length} missions sont utilisées`}</h2>
    <p class="muted small">Les supprimer efface aussi leurs affectations et les jours saisis dans les plannings des consultants concernés. Cette action est définitive. Pour garder l'historique, archive-les plutôt.</p>
    <div class="scroll" style="max-height:260px;overflow:auto"><table class="list"><thead><tr><th>Mission</th><th>Consultants</th><th>Affectations</th><th>Jours saisis</th></tr></thead><tbody>${used.map(u => `<tr><td><strong>${esc(missionLabel(u.m))}</strong></td><td class="small">${esc(u.who.map(cName).join(", "))}</td><td class="mono">${u.as}</td><td class="mono">${u.days}</td></tr>`).join("")}</tbody></table></div>
    <div class="row-actions"><button type="button" class="btn" id="xArch">Archiver plutôt</button><div class="r"><button type="button" class="btn" id="xCancel">Annuler</button>${freeN ? `<button type="button" class="btn" id="xFree">Supprimer seulement les ${freeN} non utilisée${freeN > 1 ? "s" : ""}</button>` : ""}<button type="button" class="btn danger" id="xAll">Tout supprimer</button></div></div>
  </div>`);
  $("xCancel").onclick = closeModal;
  $("xArch").onclick = async () => { try { await q(sb.from("missions").update({ active: false }).in("id", used.map(u => u.id))); closeModal(); if (state.mSel) state.mSel.clear(); toast(`${used.length} mission${used.length > 1 ? "s archivées" : " archivée"}`); await after(); } catch (err) { toast(errMsg(err)); } };
  if ($("xFree")) $("xFree").onclick = () => { closeModal(); runDelete(ids.filter(id => !used.some(u => u.id === id)), false); };
  $("xAll").onclick = () => { $("xAll").disabled = true; closeModal(); runDelete(ids, true); };
}
async function runDelete(ids, force) {
  try {
    if (force) {
      await q(sb.from("day_entries").delete().in("mission_id", ids));
      await q(sb.from("assignments").delete().in("mission_id", ids));
    }
    await q(sb.from("missions").delete().in("id", ids));
    toast(`${ids.length} mission${ids.length > 1 ? "s supprimées" : " supprimée"}`);
  } catch (err) { toast(errMsg(err)); }
  if (state.mSel) state.mSel.clear();
  await after();
}
/* --- import de missions en masse (copier-coller depuis Excel ou une ligne par mission) --- */
const normTxt = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
function parseType(s, def) {
  const x = normTxt(s); if (!x) return def;
  if (x.startsWith("build") || x.startsWith("run") || x.includes("tma") || x.startsWith("client") || x.startsWith("mission")) return "BUILD";
  if (x.startsWith("avv") || x.includes("avant") || x.includes("poc") || x.includes("presales")) return "AVV";
  if (x.startsWith("int") || x.includes("formation")) return "INTERNE";
  if (x.startsWith("abs") || x.includes("conge")) return "ABSENCE";
  return null;
}
function parseStatus(s, def) { const x = normTxt(s); if (!x) return def; if (x.startsWith("prob") || x.includes("pipe")) return "probable"; if (x.startsWith("ferm") || x.startsWith("sign") || x.startsWith("conf")) return "ferme"; return null; }
function parseDateFr(s) {
  const x = String(s || "").trim(); if (!x || /^(-|–|sans( fin)?|aucune)$/i.test(x)) return { v: null };
  let m = x.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (m) return { v: `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` };
  m = x.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; const mo = +m[2], d = +m[1]; if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return { v: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` }; }
  return { err: true };
}
function bulkMissionModal() {
  if (!isAdmin()) return;
  openModal(`<form class="modal wide" id="bForm" aria-label="Import de missions en masse">
    <h2>Import de missions en masse</h2>
    <p class="muted small">Colle les lignes copiées depuis Excel (une mission par ligne), ou sépare les colonnes par « ; ». Ordre des colonnes : <strong>Client ; Nom ; Type ; Statut ; Début ; Fin</strong>. Seul le nom est obligatoire et une ligne d'en-tête est ignorée. Avec une seule colonne, c'est le nom ; avec deux, le client puis le nom. Fin vide = sans date de fin.</p>
    <textarea id="bText" rows="8" spellcheck="false" placeholder="L'Oréal;Budget PA 2027;Client;ferme;01/11/2026;30/06/2027&#10;IGESA;TMA Board;Client;ferme;01/01/2027;&#10;Michelin;POC IA prévisions;Avant-vente;probable;15/11/2026;15/12/2026"></textarea>
    <div class="form-grid">
      <label class="f">Type par défaut<select id="bType">${TYPE_ORDER.map(k => `<option value="${k}">${TYPES[k].label}</option>`).join("")}</select></label>
      <label class="f">Statut par défaut<select id="bStatus"><option value="ferme">Ferme</option><option value="probable">Probable</option></select></label>
      <label class="f">Début par défaut<input type="date" id="bStart" value="${iso(TODAY)}"></label>
      <div class="checks" style="align-self:end"><label><input type="checkbox" id="bSkipDup" checked> Ignorer les missions déjà au catalogue</label></div>
    </div>
    <div class="scroll" id="bPrev"></div>
    <div class="row-actions"><span class="muted small" id="bSum"></span><div class="r"><button type="button" class="btn" id="bCancel">Annuler</button><button class="btn primary" type="submit" id="bSave" disabled>Créer</button></div></div>
  </form>`);
  const existing = new Set(state.missions.map(m => normTxt(m.client) + "|" + normTxt(m.name)));
  const compute = () => {
    const defT = $("bType").value, defS = $("bStatus").value, defStart = $("bStart").value || null, skip = $("bSkipDup").checked;
    const seen = new Set(); const items = [];
    $("bText").value.split(/\r?\n/).filter(l => l.trim()).forEach((line, i) => {
      let c = line.split(line.includes("\t") ? "\t" : ";").map(x => x.trim());
      if (i === 0 && c.some(x => ["nom", "mission", "nom de la mission"].includes(normTxt(x)))) return;
      if (c.length === 1) c = ["", c[0]];
      const [client = "", name = "", ty = "", st = "", d1 = "", d2 = ""] = c;
      const a = parseDateFr(d1), b = parseDateFr(d2);
      const it = { client, name, type: parseType(ty, defT), status: parseStatus(st, defS), start_date: d1 ? a.v : defStart, end_date: b.v || null, errs: [] };
      if (!name) it.errs.push("nom manquant");
      if (!it.type) it.errs.push(`type « ${ty} » inconnu`);
      if (!it.status) it.errs.push(`statut « ${st} » inconnu`);
      if (a.err) it.errs.push(`début « ${d1} » illisible`);
      if (b.err) it.errs.push(`fin « ${d2} » illisible`);
      if (it.start_date && it.end_date && parse(it.end_date) < parse(it.start_date)) it.errs.push("fin avant début");
      const k = normTxt(client) + "|" + normTxt(name);
      if (name && seen.has(k)) it.dup = "en double dans la liste"; else if (name && existing.has(k)) it.dup = "déjà au catalogue";
      it.skip = !!it.dup && (skip || it.dup === "en double dans la liste");
      seen.add(k); items.push(it);
    });
    const ok = items.filter(it => !it.errs.length && !it.skip);
    $("bPrev").innerHTML = items.length ? `<table class="list"><thead><tr><th>Client</th><th>Nom</th><th>Type</th><th>Statut</th><th>Période</th><th></th></tr></thead><tbody>${items.map(it => `<tr${it.errs.length ? ' class="bad"' : ""}><td>${esc(it.client)}</td><td><strong>${esc(it.name)}</strong></td><td>${it.type ? typeTag(it.type) : "?"}</td><td class="small">${it.status === "probable" ? "Probable" : it.status ? "Ferme" : "?"}</td><td class="mono small" style="white-space:nowrap">${it.start_date ? frDate(parse(it.start_date)) : "—"} → ${it.end_date ? frDate(parse(it.end_date)) : "sans fin"}</td><td class="small">${it.errs.length ? `<span style="color:var(--bad)">${esc(it.errs.join(", "))}</span>` : it.dup ? `<span class="muted">${esc(it.dup)}${it.skip ? " · ignorée" : ""}</span>` : "✓"}</td></tr>`).join("")}</tbody></table>` : "";
    const nErr = items.filter(it => it.errs.length).length;
    $("bSum").textContent = items.length ? `${ok.length} à créer${nErr ? ` · ${nErr} ligne${nErr > 1 ? "s" : ""} en erreur, non créée${nErr > 1 ? "s" : ""}` : ""}` : "";
    $("bSave").disabled = !ok.length; $("bSave").textContent = ok.length ? `Créer ${ok.length} mission${ok.length > 1 ? "s" : ""}` : "Créer";
    return ok;
  };
  $("bForm").addEventListener("input", compute); $("bForm").addEventListener("change", compute);
  $("bCancel").onclick = closeModal;
  $("bText").focus();
  $("bForm").addEventListener("submit", async e => {
    e.preventDefault();
    const ok = compute(); if (!ok.length) return;
    $("bSave").disabled = true;
    try {
      const rows = ok.map(it => ({ client: it.client, name: it.name, type: it.type, status: it.status, start_date: it.start_date, end_date: it.end_date, active: true }));
      for (let i = 0; i < rows.length; i += 500) await q(sb.from("missions").insert(rows.slice(i, i + 500)));
      closeModal(); toast(`${rows.length} mission${rows.length > 1 ? "s créées" : " créée"}`); await after();
    } catch (err) { toast(errMsg(err)); const sv = $("bSave"); if (sv) sv.disabled = false; }
  });
}
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
      <div class="full checks"><label><input type="checkbox" id="mNoEnd" ${m.end_date ? "" : "checked"}> Sans date de fin (projet à l'année, TMA…)</label><label><input type="checkbox" id="mArch" ${m.active === false ? "checked" : ""}> Archivée (n'est plus proposée)</label></div>
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
    closeModal(); deleteMissions([id]);
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

/* --- rappel par e-mail (admins, managers, directeurs de projet : ouvre leur messagerie, destinataires en Cci) --- */
const hasEmailCol = () => state.members.some(x => "email" in x);
const memberEmail = m => (m.email || m.user_email || "").trim();
const firstName = n => String(n || "").trim().split(/\s+/)[0] || "";
function planGaps(m) {
  const days = workdaysBetween(TODAY, monday(TODAY) + 20 * DAY);
  const free = days.reduce((s, d) => s + dayCell(m.id, d, true).free, 0);
  const t = lastUpdate(m.id); const age = t ? Math.round((TODAY - t) / DAY) : null;
  const never = age == null && !days.some(d => dayCell(m.id, d, true).parts.length);
  return { free, age, never, stale: age == null || age > STALE_DAYS, need: never || age == null || age > STALE_DAYS || free >= 0.5 };
}
function gapText(g) {
  if (g.never) return "Planning jamais rempli";
  const out = [];
  if (g.free >= 0.5) out.push(`${d1(g.free)} j non renseigné${g.free >= 2 ? "s" : ""} sur 3 semaines`);
  if (g.age == null) out.push("jamais confirmé"); else if (g.age > STALE_DAYS) out.push(`confirmé il y a ${g.age} j`);
  return out.join(" · ") || "À jour";
}
const mailto = (to, bcc, subject, body) => `mailto:${encodeURIComponent(to).replace(/%40/g, "@").replace(/%2C/g, ",")}?${bcc ? "bcc=" + bcc.map(x => encodeURIComponent(x).replace(/%40/g, "@")).join(",") + "&" : ""}subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
function remindModal() {
  if (!canOverview()) return;
  const me = myMember(); const sign = me ? me.name : "";
  const url = location.origin + location.pathname;
  const list = state.consultants.map(m => ({ m, g: planGaps(m) })).sort((a, b) => (b.g.need - a.g.need) || a.m.name.localeCompare(b.m.name, "fr"));
  const canEdit = hasEmailCol() && isAdmin(); // seuls les admins modifient les profils
  const defBody = `Bonjour,\n\nPetit rappel : merci de compléter ton plan de charge sur les 3 prochaines semaines (missions, absences, jours libres), puis de cliquer sur « Confirmer le planning ».\n\n${url}\n\nMerci !\n${sign}`;
  openModal(`<form class="modal wide" id="rForm" aria-label="Envoyer un rappel">
    <h2>Rappel de mise à jour des plannings</h2>
    <p class="muted small">Sont cochés les consultants dont le planning n'est pas rempli, incomplet sur les 3 prochaines semaines ou non confirmé depuis plus de ${STALE_DAYS} jours. Le bouton ouvre ta messagerie avec le message prêt, destinataires en copie cachée : il ne reste qu'à cliquer sur Envoyer. ✉ sur une ligne prépare un message personnalisé.</p>
    <div class="bar"><div class="checks"><label><input type="checkbox" id="rAll"> Tout cocher</label></div><span class="muted small" id="rCount"></span></div>
    <div class="scroll" id="rList" style="max-height:300px;overflow:auto"><table class="list"><thead><tr><th></th><th>Consultant</th><th>État</th><th>E-mail</th><th></th></tr></thead><tbody>${list.map(({ m, g }, i) => {
      const em = memberEmail(m);
      return `<tr><td><input type="checkbox" class="rChk" data-ri="${i}" ${g.need && em ? "checked" : ""} ${em ? "" : "disabled"} aria-label="${esc(m.name)}"></td><td><strong>${esc(m.name)}</strong><br><span class="muted small">${esc(groupNames(m))}</span></td>
        <td class="small"><span class="pill ${g.need ? "wait" : "ok"}">${esc(gapText(g))}</span></td>
        <td class="small">${em ? esc(em) : canEdit ? `<input type="email" class="rEm" data-ri="${i}" placeholder="e-mail manquant" aria-label="E-mail de ${esc(m.name)}">` : `<span class="muted">e-mail inconnu</span>`}</td>
        <td><button type="button" class="btn small" data-rone="${i}" ${em ? "" : "disabled"} title="Message personnalisé" aria-label="Message personnalisé à ${esc(m.name)}">✉</button></td></tr>`;
    }).join("")}</tbody></table></div>
    <label class="f">Objet<input id="rSubj" value="Rappel : mets à jour ton plan de charge"></label>
    <label class="f">Message<textarea id="rBody" rows="7">${esc(defBody)}</textarea></label>
    <div class="row-actions"><button type="button" class="btn" id="rCopy">Copier les adresses</button><div class="r"><button type="button" class="btn" id="rCancel">Fermer</button><button class="btn primary" type="submit" id="rSend">Ouvrir dans ma messagerie</button></div></div>
  </form>`);
  const emails = () => [...document.querySelectorAll(".rChk:checked")].map(c => memberEmail(list[+c.dataset.ri].m)).filter(Boolean);
  const sync = () => { const n = emails().length; $("rCount").textContent = `${n} destinataire${n > 1 ? "s" : ""}`; $("rSend").disabled = !n; const all = [...document.querySelectorAll(".rChk:not(:disabled)")]; $("rAll").checked = all.length > 0 && all.every(c => c.checked); };
  sync();
  $("rForm").addEventListener("change", async e => {
    if (e.target.id === "rAll") { document.querySelectorAll(".rChk:not(:disabled)").forEach(c => c.checked = e.target.checked); sync(); return; }
    if (e.target.classList.contains("rEm")) {
      const i = +e.target.dataset.ri; const v = e.target.value.trim(); if (!v || !e.target.checkValidity()) return;
      const m = list[i].m;
      try { await q(sb.from("members").update({ email: v }).eq("id", m.id)); m.email = v; const c = document.querySelector(`.rChk[data-ri="${i}"]`); c.disabled = false; c.checked = true; document.querySelector(`[data-rone="${i}"]`).disabled = false; toast(`E-mail de ${m.name} enregistré`); } catch (err) { toast(errMsg(err)); }
    }
    sync();
  });
  $("rForm").addEventListener("click", e => {
    const b = e.target.closest("[data-rone]"); if (!b) return;
    const { m, g } = list[+b.dataset.rone];
    const what = g.never ? "ton planning n'est pas encore rempli" : g.free >= 0.5 ? `il reste ${d1(g.free)} jour${g.free >= 2 ? "s" : ""} non renseigné${g.free >= 2 ? "s" : ""} sur tes 3 prochaines semaines` : g.age == null ? "ton planning n'a pas encore été confirmé" : `ton planning n'a pas été confirmé depuis ${g.age} jours`;
    const body = `Bonjour ${firstName(m.name)},\n\nPetit rappel : ${what}. Peux-tu le compléter (missions, absences, jours libres) puis cliquer sur « Confirmer le planning » ?\n\n${url}\n\nMerci !\n${sign}`;
    location.href = mailto(memberEmail(m), null, $("rSubj").value, body);
  });
  $("rCopy").onclick = async () => { const list = emails(); if (!list.length) return; try { await navigator.clipboard.writeText(list.join("; ")); toast("Adresses copiées"); } catch (_) { toast(list.join("; ")); } };
  $("rCancel").onclick = closeModal;
  $("rForm").addEventListener("submit", e => {
    e.preventDefault(); const list = emails(); if (!list.length) return;
    location.href = mailto(state.me.email || "", list, $("rSubj").value, $("rBody").value);
  });
}

/* --- consultant (admin) --- */
function memberModal(id) {
  const admin = isAdmin(); if (!admin) return; const isNew = !id;
  const m = memberById(id) || { name: "", role: "Consultant", skills: [], group_ids: [state.group || (state.groups[0] || {}).id].filter(Boolean) };
  const n = isNew ? 0 : (IDX.assign[id] || []).length; const multiG = hasGroupsCol();
  openModal(`<form class="modal" id="cForm" aria-label="Consultant">
    <h2>${isNew ? "Nouveau consultant" : esc(m.name)}</h2>
    <div class="form-grid">
      <label class="f">Nom<input id="cName" required value="${esc(m.name)}"></label>
      <label class="f">E-mail<input type="email" id="cEmail" value="${esc(memberEmail(m))}" placeholder="prenom.nom@${esc(DOMAINS[0] || "datatilt.com")}" ${hasEmailCol() || !state.members.length ? "" : "disabled title=\"Exécute supabase/migration_v3.sql pour activer ce champ\""}></label>
      ${isNew ? `<label class="f">Mot de passe provisoire<input type="text" id="cPw" minlength="8" autocomplete="off" spellcheck="false" placeholder="Optionnel, 8 caractères min."><span class="muted small">Renseigné avec l'e-mail : le compte est créé tout de suite, sans e-mail envoyé.</span></label>` : ""}
      ${multiG ? "" : `<label class="f">Groupe<select id="cGroup"><option value="">Sans groupe</option>${state.groups.map(g => `<option value="${esc(g.id)}" ${inGroup(m, g.id) ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select><span class="muted small">Exécute supabase/migration_v5.sql pour choisir plusieurs groupes.</span></label>`}
      <label class="f">Rôle<select id="cRole">${ROLES.map(r => `<option ${m.role === r ? "selected" : ""}>${r}</option>`).join("")}</select><span class="muted small">Manager et Directeur de projet voient la vue d'ensemble de l'équipe.</span></label>
      ${multiG ? `<div class="full"><span class="eyebrow">Groupes</span><div class="checks">${state.groups.map((g, i) => `<label><input type="checkbox" id="cG${i}" ${inGroup(m, g.id) ? "checked" : ""}>${esc(g.name)}</label>`).join("") || `<span class="muted small">Aucun groupe : crée-les dans le bloc « Groupes ».</span>`}</div></div>` : ""}
      <div class="full"><span class="eyebrow">Compétences</span><div class="checks">${SKILLS.map((s, i) => `<label><input type="checkbox" id="cSk${i}" ${(m.skills || []).includes(s) ? "checked" : ""}>${esc(s)}</label>`).join("")}</div></div>
    </div>
    <div class="row-actions">${isNew ? "<span></span>" : `<button type="button" class="btn danger" id="cDel">Supprimer</button>`}<div class="r">${isNew ? "" : `<button type="button" class="btn" id="cPlan">Voir le planning</button>`}<button type="button" class="btn" id="cCancel">Fermer</button><button class="btn primary" type="submit">Enregistrer</button></div></div>
  </form>`);
  $("cCancel").onclick = closeModal;
  if ($("cPlan")) $("cPlan").onclick = () => { closeModal(); state.planMember = id; state.planOffset = 0; state.tab = "moi"; render(); };
  $("cForm").addEventListener("submit", async e => {
    e.preventDefault();
    const body = { name: $("cName").value.trim(), role: $("cRole").value, skills: SKILLS.filter((_, i) => $("cSk" + i).checked) };
    if (multiG) { body.group_ids = state.groups.filter((_, i) => $("cG" + i).checked).map(g => g.id); body.group_id = body.group_ids[0] || null; }
    else body.group_id = $("cGroup").value || null;
    if (!body.name) return;
    if (!$("cEmail").disabled && (hasEmailCol() || $("cEmail").value.trim())) body.email = $("cEmail").value.trim() || null;
    const pw = isNew ? $("cPw").value : ""; const mail = $("cEmail").value.trim().toLowerCase();
    if (pw && !acctCheck(mail, pw, t => toast(t))) return;
    let saved = false;
    try {
      const row = await q(isNew ? sb.from("members").insert(body).select("id").single() : sb.from("members").update(body).eq("id", id));
      saved = true;
      if (pw) await q(sb.rpc("admin_create_account", { p_member: row.id, p_email: mail, p_password: pw }));
      closeModal(); toast(pw ? `Consultant et compte créés : transmets le mot de passe à ${body.name}` : isNew ? "Consultant ajouté" : "Consultant mis à jour"); await after();
    } catch (err) { if (saved) { closeModal(); await after(); toast("Consultant ajouté, mais compte non créé : " + acctErr(err)); } else toast(errMsg(err)); }
  });
  const del = $("cDel");
  if (del) del.onclick = async () => {
    if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = n ? `Confirmer (supprime aussi ${n} affectation${n > 1 ? "s" : ""})` : "Confirmer la suppression"; return; }
    try { await q(sb.from("members").delete().eq("id", id)); closeModal(); toast("Consultant supprimé"); await after(); } catch (err) { toast(errMsg(err)); }
  };
}

/* --- membres d'un groupe (un consultant peut être dans plusieurs groupes) --- */
function groupMembersModal(gid) {
  const g = state.groups.find(x => x.id === gid); if (!g || !isAdmin()) return;
  const list = [...state.members].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  openModal(`<form class="modal" id="gmForm" aria-label="Membres du groupe">
    <h2>Membres · ${esc(g.name)}</h2>
    <p class="muted small">Coche les consultants de ce groupe. Ils restent dans leurs autres groupes.</p>
    <div class="checks" style="max-height:50vh;overflow:auto;flex-direction:column;flex-wrap:nowrap">${list.map((m, i) => `<label><input type="checkbox" id="gm${i}" ${inGroup(m, gid) ? "checked" : ""}>${esc(m.name)} <span class="muted small">${esc(groupNames(m))}</span></label>`).join("") || `<span class="muted small">Aucun consultant.</span>`}</div>
    <div class="row-actions"><span></span><div class="r"><button type="button" class="btn" id="gmCancel">Annuler</button><button class="btn primary" type="submit" id="gmSave">Enregistrer</button></div></div>
  </form>`);
  $("gmCancel").onclick = closeModal;
  $("gmForm").addEventListener("submit", async e => {
    e.preventDefault(); $("gmSave").disabled = true;
    const changes = list.map((m, i) => ({ m, on: $("gm" + i).checked })).filter(x => x.on !== inGroup(x.m, gid));
    try {
      for (const { m, on } of changes) {
        const ids = on ? [...memberGroups(m), gid] : memberGroups(m).filter(x => x !== gid);
        await q(sb.from("members").update({ group_ids: ids, group_id: ids[0] || null }).eq("id", m.id));
      }
      closeModal(); toast(changes.length ? `Groupe « ${g.name} » mis à jour` : "Aucun changement"); await after();
    } catch (err) { $("gmSave").disabled = false; toast(errMsg(err)); }
  });
}

/* --- compte de connexion créé par un administrateur (sans e-mail) --- */
function acctCheck(mail, pw, msg) {
  if (mail !== null) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) { msg("Saisis l'e-mail professionnel du consultant."); return false; }
    if (DOMAINS.length && !DOMAINS.includes(mail.split("@")[1])) { msg(`Seules les adresses ${DOMAINS.map(d => "@" + d).join(", ")} sont autorisées.`); return false; }
  }
  if (pw.length < 8) { msg("Le mot de passe provisoire doit faire au moins 8 caractères."); return false; }
  return true;
}
const acctErr = err => /admin_(create_account|set_password)|PGRST202/i.test(((err && err.message) || "") + ((err && err.code) || "")) && !(err && err.code === "P0001") ? "exécute d'abord supabase/migration_v4.sql dans Supabase." : errMsg(err);
function accountModal(id, reset) {
  const m = memberById(id); if (!m || !isAdmin()) return;
  openModal(`<form class="modal" id="acForm" aria-label="Compte de connexion">
    <h2>${reset ? "Nouveau mot de passe provisoire" : "Créer le compte"} · ${esc(m.name)}</h2>
    <p class="muted small">${reset ? `Remplace le mot de passe de <strong>${esc(m.user_email || "")}</strong>.` : "Le compte est créé tout de suite, sans e-mail envoyé (s'il existe déjà, il est rattaché à ce profil)."} Transmets ce mot de passe à ${esc(m.name)} : il devra en choisir un nouveau à sa prochaine connexion.</p>
    ${reset ? "" : `<label class="f">E-mail<input type="email" id="acMail" required value="${esc(memberEmail(m))}" placeholder="prenom.nom@${esc(DOMAINS[0] || "datatilt.com")}"></label>`}
    <label class="f">Mot de passe provisoire<input type="text" id="acPw" required minlength="8" autocomplete="off" spellcheck="false"></label>
    <p class="small" id="acMsg"></p>
    <div class="row-actions"><span></span><div class="r"><button type="button" class="btn" id="acCancel">Annuler</button><button class="btn primary" type="submit" id="acSave">${reset ? "Enregistrer" : "Créer le compte"}</button></div></div>
  </form>`);
  (reset || memberEmail(m) ? $("acPw") : $("acMail")).focus();
  $("acCancel").onclick = closeModal;
  $("acForm").addEventListener("submit", async e => {
    e.preventDefault();
    const msg = t => $("acMsg").innerHTML = `<span style="color:var(--bad)">${esc(t)}</span>`;
    const pw = $("acPw").value, mail = reset ? null : $("acMail").value.trim().toLowerCase();
    if (!acctCheck(mail, pw, msg)) return;
    $("acSave").disabled = true;
    try {
      await q(reset ? sb.rpc("admin_set_password", { p_member: id, p_password: pw }) : sb.rpc("admin_create_account", { p_member: id, p_email: mail, p_password: pw }));
      closeModal(); toast(reset ? `Mot de passe provisoire enregistré pour ${m.name}` : `Compte créé : transmets le mot de passe à ${m.name}`); await after();
    } catch (err) { $("acSave").disabled = false; msg(acctErr(err)); }
  });
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
  if (t.id === "btnPw") { passwordModal(false); return; }
  if (t.id === "loginLink") { sendLink(); return; }
  if (t.id === "loginForgot") { forgotPw(); return; }
  if (d.tab) { state.tab = d.tab; if (d.tab === "moi") { state.planMember = null; state.planOffset = 0; } render(); return; }
  if (d.h) { state.h = +d.h; try { localStorage.setItem("pdc.h2", state.h); } catch (_) {} render(); return; }
  if (d.mxnav !== undefined) { state.mxOffset = +d.mxnav === 0 ? 0 : Math.max(-12, Math.min(24, state.mxOffset + +d.mxnav)); render(); return; }
  if (t.id === "btnMxExport") { exportMatrix(); return; }
  if (d.mf) { state.mFilter = d.mf; render(); return; }
  if (d.nav !== undefined) { state.planOffset = +d.nav === 0 ? 0 : state.planOffset + +d.nav; render(); return; }
  if (d.day) { const mid = planTarget(); if (mid) dayModal(mid, +d.day); return; }
  if (d.cell) { if (gselNoClick) { gselNoClick = false; return; } if (gsel && gselCells().length > 1) return; gsel = null; gselPaint(); openCell(t); return; }
  if (d.rowsel) { gselRow(t.closest("tr").querySelector("button[data-cell]")); return; }
  if (t.id === "gselZero") { gselApply(0); return; }
  if (d.gk) { gselKind(d.gk); return; }
  if (t.id === "gselCancel") { gselClear(); return; }
  if (d.rowdel) {
    const mid = planTarget(); if (!mid) return;
    if (t.dataset.armed !== "1") { t.dataset.armed = "1"; t.textContent = "Retirer ?"; t.classList.add("armed"); setTimeout(() => { if (t.isConnected) { t.dataset.armed = ""; t.textContent = "✕"; t.classList.remove("armed"); } }, 4000); return; }
    t.disabled = true; removeRow(mid, d.rowdel, +d.from); return;
  }
  if (d.plan) { state.planMember = d.plan; state.planOffset = 0; state.tab = "moi"; render(); window.scrollTo(0, 0); return; }
  if (d.a) { assignModal({ aId: d.a }); return; }
  if (d.mi) { missionModal(d.mi); return; }
  if (d.massign) { const mm = missionById(d.massign); assignModal({ missionId: d.massign, pickMember: true, absence: mm && mm.type === "ABSENCE" }); return; }
  if (d.c) { memberModal(d.c); return; }
  if (d.acct) { accountModal(d.acct, false); return; }
  if (d.gmem) { groupMembersModal(d.gmem); return; }
  if (d.pwreset) { accountModal(d.pwreset, true); return; }
  if (t.id === "btnAddC") { memberModal(null); return; }
  if (t.id === "btnAddM") { missionModal(null); return; }
  if (t.id === "btnBulkM") { bulkMissionModal(); return; }
  if (t.id === "btnRemind") { remindModal(); return; }
  if (t.id === "mSelNone") { state.mSel.clear(); render(); return; }
  if (t.id === "mSelArch" || t.id === "mSelUnarch") { const ids = [...state.mSel]; guard(t, () => q(sb.from("missions").update({ active: t.id === "mSelUnarch" }).in("id", ids)), `${ids.length} mission${ids.length > 1 ? "s" : ""} ${t.id === "mSelUnarch" ? "réactivée" : "archivée"}${ids.length > 1 ? "s" : ""}`); state.mSel.clear(); return; }
  if (t.id === "mSelDel") {
    if (t.dataset.armed !== "1") { t.dataset.armed = "1"; t.textContent = `Confirmer la suppression (${state.mSel.size})`; return; }
    t.disabled = true; deleteMissions([...state.mSel]); return;
  }
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
      const used = new Set(state.members.filter(m => !m.example).flatMap(memberGroups));
      const ids = state.groups.filter(g => g.example && !used.has(g.id)).map(g => g.id);
      if (ids.length) await q(sb.from("groups").delete().in("id", ids));
    }, "Exemples supprimés");
  }
});
document.addEventListener("submit", e => {
  if (e.target.id === "gselBar") { e.preventDefault(); const v = $("gselVal").value.trim(); if (v !== "") gselApply(v); return; }
  if (e.target.id === "gAddForm") { e.preventDefault(); const v = $("gNew").value.trim(); if (v) guard(null, () => q(sb.from("groups").insert({ name: v })), "Groupe ajouté"); }
  if (e.target.id === "adAddForm") {
    e.preventDefault(); const v = $("adNew").value.trim().toLowerCase(); if (!v) return;
    const dom = v.split("@")[1] || "";
    guard(null, () => q(sb.from("admins").insert({ email: v })), DOMAINS.length && !DOMAINS.includes(dom) ? "Administrateur ajouté (attention : ce domaine ne peut pas se connecter)" : "Administrateur ajouté");
  }
  if (e.target.id === "loginForm") { e.preventDefault(); signInPw(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") { if (gsel) gselClear(); closeModal(); } });
document.addEventListener("change", e => {
  if (e.target.id === "optProb") { state.prob = e.target.checked; try { localStorage.setItem("pdc.prob", state.prob ? "1" : "0"); } catch (_) {} render(); }
  if (e.target.id === "gSel") { state.group = e.target.value; try { localStorage.setItem("pdc.g", state.group); } catch (_) {} render(); }
  if (e.target.id === "mSelAll") { const f = state.mFilter; state.missions.filter(m => f === "toutes" || (f === "actives" ? m.active !== false : m.active === false)).forEach(m => e.target.checked ? state.mSel.add(m.id) : state.mSel.delete(m.id)); render(); return; }
  if (e.target.classList.contains("mSelChk")) { const id = e.target.dataset.msel; e.target.checked ? state.mSel.add(id) : state.mSel.delete(id); render(); return; }
  if (e.target.id === "pmSel") { state.planMember = e.target.value || null; state.planOffset = 0; render(); }
});
document.addEventListener("input", e => {
  if (e.target.id === "gridAddQ") { gaActive = 0; gaDraw(); return; }
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
    modalLocked = false; closeModal();
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
  try { await refreshAdmin(); await loadAll(); subscribe(); render(); if (pwRecovery) { pwRecovery = false; passwordModal(true); } else if (u.user_metadata && u.user_metadata.must_change_password) passwordModal(false, true); }
  catch (e) { main().innerHTML = `<div class="panel state"><h2>Chargement impossible</h2><p>${esc(e.message || "Erreur de connexion à la base.")}</p><p class="muted small">As-tu exécuté <code>supabase/migration_v2.sql</code> ?</p><button class="btn" id="btnLogout">Se déconnecter</button></div>`; }
}
let pwRecovery = false;
sb.auth.onAuthStateChange((ev, session) => { if (ev === "PASSWORD_RECOVERY") { if (currentUser && state.loaded) setTimeout(() => passwordModal(true), 0); else pwRecovery = true; } setTimeout(() => onSession(session), 0); });
sb.auth.getSession().then(({ data }) => onSession(data.session));
})();
