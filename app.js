/* Datatilt-SuiviConsultant — plan de charge et disponibilité des consultants */
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
const WORK_TYPES = ["BUILD", "RUN", "AVV", "INTERNE"];
const SKILLS = ["Planning Analytics", "BOARD", "Watson Orchestrate", "Gestion de projet"];
const ROLES = ["Consultant", "Consultant senior", "Manager", "Directeur de projet"];
const TARGET_BILL = CFG.TARGET_BILLABLE || 0.8;
const STALE_DAYS = CFG.STALE_DAYS || 14;
const DOMAINS = (CFG.ALLOWED_DOMAINS || []).map(d => d.toLowerCase());

const state = {
  tab: null, h: 8, prob: true, group: "", filter: "",
  me: { id: null, email: "", isAdmin: false },
  members: [], groups: [], claims: [], items: [], status: {},
  consultants: [], staffs: [], loaded: false
};
try {
  const h = +localStorage.getItem("pdc.h"); if ([4, 8, 12].includes(h)) state.h = h;
  const p = localStorage.getItem("pdc.prob"); if (p !== null) state.prob = p === "1";
  state.group = localStorage.getItem("pdc.g") || "";
} catch (e) {}

const $ = id => document.getElementById(id);
const main = () => $("main");

/* ---------- configuration ---------- */
if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes("VOTRE-PROJET") || !window.supabase) {
  main().innerHTML = `<div class="panel state"><h2>Configuration manquante</h2><p>Renseigne SUPABASE_URL et SUPABASE_ANON_KEY dans le fichier <code>config.js</code> (voir README).</p></div>`;
  return;
}
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});

/* ---------- dates ---------- */
const n0 = new Date(); const TODAY = Date.UTC(n0.getFullYear(), n0.getMonth(), n0.getDate());
const parse = s => { if (!s) return NaN; const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return Date.UTC(y, m - 1, d); };
const iso = t => new Date(t).toISOString().slice(0, 10);
const monday = t => { const d = new Date(t).getUTCDay(); return t - ((d + 6) % 7) * DAY; };
const isoWeek = t => { const m = monday(t); const y = new Date(m + 3 * DAY).getUTCFullYear(); return 1 + Math.round((m - monday(Date.UTC(y, 0, 4))) / (7 * DAY)); };
const frDate = t => isNaN(t) ? "–" : new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return Date.UTC(y, mo - 1, da); }
const holCache = {};
function holidays(y) { if (holCache[y]) return holCache[y]; const e = easter(y); const s = new Set([[0, 1], [4, 1], [4, 8], [6, 14], [7, 15], [10, 1], [10, 11], [11, 25]].map(([m, d]) => Date.UTC(y, m, d))); [1, 39, 50].forEach(o => s.add(e + o * DAY)); return holCache[y] = s; }
function workdays(mon) { let n = 0; for (let i = 0; i < 5; i++) { const t = mon + i * DAY; if (!holidays(new Date(t).getUTCFullYear()).has(t)) n++; } return n; }
const weeks = n => { const m0 = monday(TODAY); return Array.from({ length: n }, (_, i) => m0 + i * 7 * DAY); };

/* ---------- helpers ---------- */
const pct = x => x == null || !isFinite(x) ? "–" : Math.round(x * 100) + " %";
const d1 = x => (Math.round(x * 10) / 10).toLocaleString("fr-FR");
const esc = s => String(s ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const memberById = id => state.members.find(m => m.id === id);
const groupName = id => (state.groups.find(g => g.id === id) || {}).name || "Sans groupe";
const cName = id => (memberById(id) || {}).name || "—";
const isAdmin = () => state.me.isAdmin;
const myMember = () => state.me.id ? state.members.find(m => m.user_id === state.me.id) : null;
const canEditMember = m => !!m && (isAdmin() || (state.me.id && m.user_id === state.me.id));
function lastUpdate(memberId) { const p = state.status[memberId]; if (!p) return null; const t = Math.max(parse(p.updated_at) || 0, parse(p.confirmed_at) || 0); return t || null; }
function freshness(m) { const t = lastUpdate(m.id); if (!t) return { cls: "never", days: null, label: "Jamais mis à jour" }; const d = Math.round((TODAY - t) / DAY); return { cls: d > STALE_DAYS ? "stale" : "", days: d, label: d <= 0 ? "Mis à jour aujourd'hui" : `Mis à jour il y a ${d} j` }; }
const staffsFor = m => state.items.filter(s => s.consultantId === m.id);
function rebuild() { state.consultants = state.members.filter(m => !state.group || m.group_id === state.group); state.staffs = state.items; }
const initials = s => (String(s || "?").split(/[@.\s_-]+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("") || "?").toUpperCase();

/* ---------- calcul ---------- */
function cellFor(c, wk, includeProb, list = state.staffs) {
  const wd = workdays(wk), cap = (+c.capacity || 5) * wd / 5;
  const r = { cap, wd, abs: 0, BUILD: 0, RUN: 0, AVV: 0, INTERNE: 0, prob: 0 };
  for (const s of list) {
    if (s.consultantId !== c.id) continue;
    const a = monday(parse(s.start)), b = monday(parse(s.end));
    if (isNaN(a) || isNaN(b) || wk < a || wk > b) continue;
    const d = (+s.days || 0) * wd / 5;
    if (s.type === "ABSENCE") { r.abs += d; continue; }
    if (s.status === "probable") { r.prob += d; if (!includeProb) continue; }
    if (r[s.type] !== undefined) r[s.type] += d;
  }
  r.abs = Math.min(r.abs, cap); r.net = cap - r.abs;
  r.staffed = r.BUILD + r.RUN + r.AVV + r.INTERNE; r.bill = r.BUILD + r.RUN;
  r.load = r.net > 0.01 ? r.staffed / r.net : null; r.free = Math.max(0, r.net - r.staffed);
  return r;
}
function matrix() { const W = weeks(state.h); const M = {}; for (const c of state.consultants) M[c.id] = W.map(w => cellFor(c, w, state.prob)); return { W, M }; }
function band(r) { if (r.load == null) return "abs"; if (r.load > 1.001) return "over"; if (r.load >= .85) return "ok"; if (r.load >= .5) return "mid"; return "low"; }

/* ---------- KPI ---------- */
function kpis(W, M) {
  let net = 0, staffed = 0, bill = 0, avv = 0, free = 0, prob = 0, over = 0; const inter = [];
  for (const c of state.consultants) {
    M[c.id].forEach(r => { net += r.net; staffed += r.staffed; bill += r.bill; avv += r.AVV; free += r.free; prob += r.prob; if (r.load != null && r.load > 1.001) over++; });
    const r0 = M[c.id][0]; if (r0.load != null && r0.load < 0.5) inter.push(c.name);
  }
  const freeNow = state.consultants.reduce((a, c) => a + M[c.id][0].free, 0);
  const fresh = state.consultants.filter(c => { const f = freshness(c); return f.days != null && f.days <= STALE_DAYS; }).length;
  return { occ: net ? staffed / net : null, bill: net ? bill / net : null, avvShare: staffed ? avv / staffed : null, free, freeNow, prob, over, inter, fresh, total: state.consultants.length };
}
function renderKpis(k) {
  const billCls = k.bill == null ? "" : k.bill >= TARGET_BILL ? "good" : k.bill >= TARGET_BILL - .15 ? "warn" : "bad";
  const fr = k.total ? k.fresh / k.total : 1;
  const tile = (label, v, cls, sub, extra = "") => `<div class="kpi"><span class="eyebrow">${label}</span><span class="v ${cls}">${v}</span>${extra}<span class="s">${sub}</span></div>`;
  const g = k.bill == null ? "" : `<div class="gauge" aria-hidden="true"><i style="width:${Math.min(100, k.bill * 100)}%"></i><b style="left:${TARGET_BILL * 100}%"></b></div>`;
  return `<section class="kpis" aria-label="Indicateurs">
    ${tile("Taux facturable", pct(k.bill), billCls, `BUILD + RUN · objectif ${Math.round(TARGET_BILL * 100)} %`, g)}
    ${tile("Taux d'occupation", pct(k.occ), "", `dont ${pct(k.avvShare)} en avant-vente IA`)}
    ${tile("Jours disponibles", d1(k.free), "", `${d1(k.freeNow)} j cette semaine · ${d1(k.prob)} j probables ${state.prob ? "inclus" : "exclus"}`)}
    ${tile("Intercontrat", k.inter.length, k.inter.length ? "warn" : "good", k.inter.length ? esc(k.inter.slice(0, 3).join(", ")) + (k.inter.length > 3 ? "…" : "") : "Personne sous 50 % cette semaine")}
    ${tile("Surcharges", k.over, k.over ? "bad" : "good", k.over ? "semaines-consultant au-delà de 100 %" : "Aucune semaine au-delà de 100 %")}
    ${tile("Plannings à jour", `${k.fresh}/${k.total}`, fr >= .8 ? "good" : fr >= .5 ? "warn" : "bad", `confirmés il y a moins de ${STALE_DAYS} j`)}
  </section>`;
}

/* ---------- alertes ---------- */
function alerts(W, M) {
  const out = []; const wk = t => "S" + isoWeek(t);
  if (isAdmin() && state.claims.length) out.push({ lvl: "info", w: 4, t: `<strong>${state.claims.length} demande${state.claims.length > 1 ? "s" : ""} de rattachement</strong> à valider`, m: "Onglet Administration" });
  for (const c of state.consultants) {
    const row = M[c.id]; let i = 0;
    while (i < row.length) {
      if (row[i].load != null && row[i].load > 1.001) {
        let j = i, mx = 0; while (j < row.length && row[j].load != null && row[j].load > 1.001) { mx = Math.max(mx, row[j].load); j++; }
        const both = row.slice(i, j).some(r => r.AVV > 0 && r.RUN > 0);
        out.push({ lvl: "bad", w: 3, t: `<strong>${esc(c.name)}</strong> en surcharge (${pct(mx)}) ${j - i > 1 ? `de ${wk(W[i])} à ${wk(W[j - 1])}` : `en ${wk(W[i])}`}`, m: both ? "TMA et avant-vente IA sur les mêmes semaines : l'avant-vente risque de sauter" : "Arbitrer ou décaler une mission" });
        i = j;
      } else i++;
    }
    if (row.slice(0, 2).every(r => r.load != null && r.load < 0.5)) out.push({ lvl: "warn", w: 2, t: `<strong>${esc(c.name)}</strong> sous 50 % sur les 2 prochaines semaines`, m: `${d1(row[0].free + row[1].free)} j libres · à positionner sur avant-vente ou mission` });
  }
  const ids = new Set(state.consultants.map(c => c.id));
  for (const s of state.staffs) {
    if (!ids.has(s.consultantId) || s.type === "ABSENCE" || s.type === "INTERNE") continue;
    const end = parse(s.end); if (isNaN(end)) continue; const days = Math.round((end - TODAY) / DAY); if (days < 0 || days > 28) continue;
    const c = memberById(s.consultantId); const nx = monday(end) + 7 * DAY; const after = cellFor(c, nx, true);
    if (after.load != null && after.load < 0.5) out.push({ lvl: "warn", w: 2, t: `<strong>${esc(c.name)}</strong> se libère S${isoWeek(nx)}`, m: `Fin ${esc(s.client)} · ${esc(s.mission)} le ${frDate(end)} · pas de relais staffé` });
  }
  for (const s of state.staffs) {
    if (!ids.has(s.consultantId) || s.status !== "probable") continue; const st = parse(s.start); const dd = Math.round((st - TODAY) / DAY);
    if (dd >= -7 && dd <= 14) out.push({ lvl: "info", w: 1, t: `À confirmer : ${esc(s.client)} · ${esc(s.mission)}`, m: `${esc(cName(s.consultantId))} · démarrage ${frDate(st)} · toujours en probable` });
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

/* ---------- graphique ---------- */
function renderChart(W, M) {
  const tot = W.map((_, i) => { const t = { net: 0, BUILD: 0, RUN: 0, AVV: 0, INTERNE: 0 }; for (const c of state.consultants) { const r = M[c.id][i]; t.net += r.net; WORK_TYPES.forEach(k => t[k] += r[k]); } return t; });
  const max = Math.max(5, ...tot.map(t => Math.max(t.net, t.BUILD + t.RUN + t.AVV + t.INTERNE)));
  const step = max > 80 ? 20 : max > 40 ? 10 : 5; const top = Math.ceil(max * 1.08 / step) * step;
  const Wd = 720, H = 230, L = 40, R = 10, T = 12, B = 28, pw = Wd - L - R, ph = H - T - B, bw = pw / W.length; const y = v => T + ph - (v / top) * ph;
  let g = "";
  for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${Wd - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${v}</text>`;
  tot.forEach((t, i) => {
    const x = L + i * bw + bw * .18, w = bw * .64; let acc = 0;
    WORK_TYPES.forEach(k => { if (t[k] <= 0) return; g += `<rect x="${x}" y="${y(acc + t[k])}" width="${w}" height="${(t[k] / top) * ph}" fill="${TYPES[k].color}"><title>S${isoWeek(W[i])} · ${TYPES[k].label} : ${d1(t[k])} j</title></rect>`; acc += t[k]; });
    g += `<line x1="${L + i * bw + 2}" x2="${L + (i + 1) * bw - 2}" y1="${y(t.net)}" y2="${y(t.net)}" stroke="var(--ink)" stroke-width="2"><title>Capacité nette S${isoWeek(W[i])} : ${d1(t.net)} j</title></line>`;
    g += `<text x="${L + i * bw + bw / 2}" y="${H - 10}" text-anchor="middle" font-size="10" fill="${i === 0 ? "var(--accent)" : "var(--muted)"}" font-family="IBM Plex Mono, monospace">S${isoWeek(W[i])}</text>`;
  });
  return `<section class="panel chart"><div class="panel-head"><h2>Charge de l'équipe</h2><span class="eyebrow">jours / semaine</span></div>
  <svg viewBox="0 0 ${Wd} ${H}" role="img" aria-label="Jours staffés par type et capacité nette par semaine">${g}</svg>
  <div class="legend">${WORK_TYPES.map(k => `<span><i class="sw" style="background:${TYPES[k].color}"></i>${TYPES[k].label}</span>`).join("")}<span><i class="sw" style="background:var(--ink);height:2px"></i>Capacité nette (hors congés et fériés)</span></div></section>`;
}

/* ---------- heatmap ---------- */
function weekHead(W) { return W.map((w, i) => `<th class="${i === 0 ? "now" : ""}" title="Semaine du ${frDate(w)}${workdays(w) < 5 ? ` · ${5 - workdays(w)} férié(s)` : ""}">S${isoWeek(w)}${workdays(w) < 5 ? "*" : ""}<br><span style="font-weight:400">${frDate(w)}</span></th>`).join(""); }
function cellHtml(c, r, w, i, showFree) {
  const b = band(r);
  const strip = r.net > 0 ? WORK_TYPES.filter(k => r[k] > 0).map(k => `<i style="width:${Math.min(100, r[k] / r.net * 100)}%;background:${TYPES[k].color}"></i>`).join("") : "";
  const tip = `${c.name} · S${isoWeek(w)}\nCapacité nette : ${d1(r.net)} j${r.abs ? ` (absence ${d1(r.abs)} j)` : ""}\n` + WORK_TYPES.filter(k => r[k] > 0).map(k => `${TYPES[k].label} : ${d1(r[k])} j`).join("\n") + (r.prob ? `\nDont probable : ${d1(r.prob)} j` : "") + `\nLibre : ${d1(r.free)} j`;
  return `<td class="c ${b} ${i === 0 ? "now" : ""}" title="${esc(tip)}">${b === "abs" ? "Absent" : pct(r.load)}${showFree && b !== "abs" ? `<span class="free">${d1(r.free)} j libres</span>` : ""}${r.prob && state.prob ? '<span class="p" aria-hidden="true"></span>' : ""}${strip ? `<span class="strip">${strip}</span>` : ""}</td>`;
}
function legendHtml() { return `<div class="heat-legend"><span><i class="sw" style="background:var(--h-low)"></i>&lt; 50 % · intercontrat</span><span><i class="sw" style="background:var(--h-mid)"></i>50–85 %</span><span><i class="sw" style="background:var(--h-ok)"></i>85–100 % · cible</span><span><i class="sw" style="background:var(--h-over)"></i>&gt; 100 % · surcharge</span><span><i class="sw hatch"></i>Absent</span><span><i class="p" style="display:inline-block;width:8px;height:8px;border-radius:50%;border:1.5px solid var(--t-avv)"></i>contient du probable</span><span>* semaine avec jour férié</span></div>`; }
function renderHeat(W, M) {
  const order = [...state.groups.map(g => g.id), ""];
  const byG = order.map(gid => ({ gid, list: state.consultants.filter(c => gid ? c.group_id === gid : !state.groups.some(g => g.id === c.group_id)) })).filter(x => x.list.length);
  const rows = byG.map(({ gid, list }) => `${state.group ? "" : `<tr class="grp"><td colspan="${W.length + 1}">${esc(gid ? groupName(gid) : "Sans groupe")} · ${list.length}</td></tr>`}` + list.map(c => {
    const f = freshness(c);
    return `<tr><th class="who" scope="row"><button data-c="${esc(c.id)}"><span class="n"><i class="fresh ${f.cls}" title="${esc(f.label)}"></i>${esc(c.name)}</span><span class="r">${esc(c.role || "")} · ${esc(f.label.toLowerCase())}</span></button></th>${M[c.id].map((r, i) => cellHtml(c, r, W[i], i, false)).join("")}</tr>`;
  }).join("")).join("");
  return `<section class="panel"><div class="panel-head"><h2>Disponibilité par consultant</h2><span class="eyebrow">clique un nom pour voir le détail</span></div>
  <div class="scroll"><table class="heat"><thead><tr><th class="who">Consultant</th>${weekHead(W)}</tr></thead><tbody>${rows}</tbody></table></div>${legendHtml()}</section>`;
}

/* ---------- recherche de dispo ---------- */
const finder = { skill: "", start: iso(monday(TODAY) + 7 * DAY), weeks: 4, days: 3 };
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
    const cells = W.map(w => cellFor(c, w, true)); const needW = W.map(w => need * workdays(w) / 5);
    const got = cells.reduce((a, r, i) => a + Math.min(r.free, needW[i]), 0), want = needW.reduce((a, b) => a + b, 0);
    return { c, cells, fit: want ? got / want : 0, free: cells.reduce((a, r) => a + r.free, 0) };
  }).sort((a, b) => b.fit - a.fit || b.free - a.free).slice(0, 6);
  if (!res.length) { el.innerHTML = `<li class="empty-note">Aucun consultant avec cette compétence${state.group ? " dans ce groupe" : ""}.</li>`; return; }
  el.innerHTML = res.map(r => `<li class="res"><div><strong>${esc(r.c.name)}</strong><div class="chips">${(r.c.skills || []).map(s => `<span class="chip ${s === finder.skill ? "on" : ""}">${esc(s)}</span>`).join("")}</div></div>
    <span class="fit" style="color:${r.fit >= .9 ? "var(--good)" : r.fit >= .5 ? "var(--warn)" : "var(--bad)"}">${pct(r.fit)}</span>
    <span class="mini" title="Jours libres par semaine">${r.cells.map(x => `<i style="height:${Math.max(2, Math.min(100, x.free / 5 * 100))}%"></i>`).join("")}</span>
    <span class="mono muted" style="font-size:.8rem">${d1(r.free)} j libres</span></li>`).join("");
}

/* ---------- liste ---------- */
function staffRows(list, withWho) {
  return list.map(s => {
    const end = parse(s.end), dd = Math.round((end - TODAY) / DAY); const m = memberById(s.consultantId) || {};
    const due = isNaN(dd) ? "–" : dd < 0 ? `<span class="due past">terminé</span>` : `<span class="due ${dd <= 28 ? "soon" : ""}">${dd} j</span>`;
    return `<tr>${withWho ? `<td>${esc(m.name || "—")}</td>` : ""}<td><strong>${esc(s.client || "—")}</strong><br><span class="muted">${esc(s.mission || "")}</span></td>
    <td><span class="tag"><i class="sw" style="background:${TYPES[s.type]?.color}"></i>${TYPES[s.type]?.label || esc(s.type)}</span></td>
    <td>${s.type === "ABSENCE" ? "" : `<span class="pill ${s.status === "probable" ? "probable" : "ferme"}">${s.status === "probable" ? "Probable" : "Ferme"}</span>`}</td>
    <td class="mono" style="white-space:nowrap">${frDate(parse(s.start))} → ${frDate(end)}</td><td class="mono">${d1(+s.days || 0)}</td><td class="mono">${due}</td>
    <td>${canEditMember(m) ? `<button class="btn small" data-s="${esc(s.id)}" data-m="${esc(s.consultantId)}">Modifier</button>` : ""}</td></tr>`;
  }).join("");
}
function renderList() {
  const q = state.filter.toLowerCase(); const ids = new Set(state.consultants.map(c => c.id));
  const rows = state.staffs.filter(s => ids.has(s.consultantId)).filter(s => { const e = parse(s.end); return isNaN(e) || e >= TODAY - 14 * DAY; })
    .filter(s => !q || [s.client, s.mission, cName(s.consultantId), TYPES[s.type]?.label].join(" ").toLowerCase().includes(q))
    .sort((a, b) => (parse(a.end) || 0) - (parse(b.end) || 0));
  return `<section class="panel"><div class="panel-head"><h2>Staffings en cours et à venir</h2><label class="f" style="min-width:220px"><input type="search" id="lFilter" placeholder="Filtrer : client, mission, consultant…" value="${esc(state.filter)}"></label></div>
  <div class="scroll"><table class="list"><thead><tr><th>Consultant</th><th>Client · mission</th><th>Type</th><th>Statut</th><th>Période</th><th>j/sem</th><th>Fin dans</th><th></th></tr></thead><tbody>${staffRows(rows, true) || `<tr><td colspan="8" class="empty-note">Aucun staffing ne correspond.</td></tr>`}</tbody></table></div></section>`;
}

/* ---------- vues ---------- */
function viewTeam() {
  if (!state.members.length) return `<div class="panel state"><h2>L'équipe n'est pas encore créée</h2><p>${isAdmin() ? "Commence par créer les groupes et les consultants dans l'onglet Administration." : "L'administrateur n'a pas encore ajouté l'équipe."}</p>${isAdmin() ? `<button class="btn primary" data-tab="admin">Aller à l'administration</button>` : ""}</div>`;
  const { W, M } = matrix();
  const bar = `<div class="bar"><div class="controls">
      <select class="sel" id="gSel" aria-label="Groupe"><option value="">Toute l'équipe (${state.members.length})</option>${state.groups.map(g => `<option value="${esc(g.id)}" ${state.group === g.id ? "selected" : ""}>${esc(g.name)} (${state.members.filter(m => m.group_id === g.id).length})</option>`).join("")}</select>
      <div class="seg" role="group" aria-label="Horizon">${[4, 8, 12].map(h => `<button data-h="${h}" aria-pressed="${state.h === h}">${h} sem.</button>`).join("")}</div>
      <label class="toggle"><input type="checkbox" id="optProb" ${state.prob ? "checked" : ""}> Inclure le probable</label></div>
    <span class="muted" style="font-size:.85rem">S${isoWeek(W[0])} à S${isoWeek(W[W.length - 1])}</span></div>`;
  if (!state.consultants.length) return bar + `<div class="panel state">Aucun consultant dans ce groupe.</div>`;
  return `${bar}${renderKpis(kpis(W, M))}<div class="grid2">${renderAlerts(alerts(W, M))}${renderChart(W, M)}</div>${renderHeat(W, M)}${renderFinderShell()}${renderList()}`;
}

function viewMine() {
  const m = myMember();
  if (!m) {
    const claim = state.claims.find(c => c.user_id === state.me.id);
    const cm = claim && memberById(claim.member_id);
    if (cm) return `<section class="panel state"><h2>Rattachement en attente</h2><p>Tu as demandé à être rattaché(e) au profil <strong>${esc(cm.name)}</strong>. Dès que l'administrateur aura validé, tu pourras remplir ton planning ici.</p><button class="btn" id="btnUnclaim">Changer de profil</button></section>`;
    const free = state.members.filter(x => !x.user_id);
    return `<section class="panel"><h2>Qui es-tu ?</h2><p class="muted">Choisis ton nom une seule fois. ${isAdmin() ? "Comme administrateur, le rattachement est immédiat." : "L'administrateur valide ensuite le rattachement à ton compte."}</p>
      ${free.length ? `<ul class="pick">${free.map(x => `<li><button data-claim="${esc(x.id)}"><strong>${esc(x.name)}</strong><span class="muted" style="font-size:.8rem">${esc(groupName(x.group_id))} · ${esc(x.role || "")}</span></button></li>`).join("")}</ul>` : `<p class="empty-note">Aucun profil disponible. Demande à l'administrateur de créer le tien.</p>`}</section>`;
  }
  const list = staffsFor(m);
  const W = weeks(12); const cells = W.map(w => cellFor(m, w, true, list));
  const t = lastUpdate(m.id); const age = t ? Math.round((TODAY - t) / DAY) : null;
  const freshTxt = age == null ? "Tu n'as pas encore confirmé ton planning." : age <= 0 ? "Planning confirmé aujourd'hui." : `Dernière mise à jour il y a ${age} jour${age > 1 ? "s" : ""}.`;
  const stale = age == null || age > STALE_DAYS;
  const mine = [...list].filter(s => { const e = parse(s.end); return isNaN(e) || e >= TODAY - 14 * DAY; }).sort((a, b) => (parse(a.start) || 0) - (parse(b.start) || 0));
  return `<section class="panel hello"><div><span class="eyebrow">${esc(groupName(m.group_id))} · ${esc(m.role || "")}</span><h2 style="font-size:1.4rem">${esc(m.name)}</h2><p class="${stale ? "" : "muted"}" style="${stale ? "color:var(--warn)" : ""}">${freshTxt} ${stale ? "Vérifie tes semaines à venir puis confirme." : ""}</p></div>
    <div class="actions"><button class="btn" id="btnConfirm">Confirmer mon planning</button><button class="btn primary" id="btnMyAdd">+ Ajouter</button></div></section>
  <section class="panel"><div class="panel-head"><h2>Mes 12 prochaines semaines</h2><span class="eyebrow">${d1(cells.reduce((a, r) => a + r.free, 0))} j libres</span></div>
    <div class="scroll"><table class="heat big"><thead><tr>${weekHead(W)}</tr></thead><tbody><tr>${cells.map((r, i) => cellHtml(m, r, W[i], i, true)).join("")}</tr></tbody></table></div>${legendHtml()}</section>
  <section class="panel"><div class="panel-head"><h2>Mes staffings, absences et congés</h2></div>
    <div class="scroll"><table class="list"><thead><tr><th>Client · mission</th><th>Type</th><th>Statut</th><th>Période</th><th>j/sem</th><th>Fin dans</th><th></th></tr></thead><tbody>${staffRows(mine, false) || `<tr><td colspan="7" class="empty-note">Rien de saisi. Ajoute tes missions, avant-ventes et congés avec « + Ajouter ».</td></tr>`}</tbody></table></div></section>`;
}

function viewAdmin() {
  const pc = state.claims;
  return `<section class="panel"><div class="panel-head"><h2>Demandes de rattachement</h2><span class="eyebrow">${pc.length} en attente</span></div>
    ${pc.length ? `<div class="scroll"><table class="list"><thead><tr><th>Compte</th><th>Profil demandé</th><th>Le</th><th></th></tr></thead><tbody>${pc.map(c => { const m = memberById(c.member_id); return `<tr><td>${esc(c.email)}</td><td><strong>${esc(m ? m.name : "Profil supprimé")}</strong>${m && m.user_id ? ` <span class="pill wait">déjà rattaché à ${esc(m.user_email || "un compte")}</span>` : ""}</td><td class="mono">${frDate(parse(c.created_at))}</td><td style="white-space:nowrap"><button class="btn small primary" data-approve="${esc(c.user_id)}" ${m ? "" : "disabled"}>Valider</button> <button class="btn small danger" data-reject="${esc(c.user_id)}">Refuser</button></td></tr>`; }).join("")}</tbody></table></div>` : `<p class="empty-note">Aucune demande. Quand un collaborateur choisit son nom, la demande apparaît ici.</p>`}</section>
  <div class="grid2">
    <section class="panel"><div class="panel-head"><h2>Groupes</h2></div>
      <ul class="mstaff">${state.groups.map(g => { const n = state.members.filter(m => m.group_id === g.id).length; return `<li><div class="inline"><input id="gName-${esc(g.id)}" value="${esc(g.name)}" aria-label="Nom du groupe"><button class="btn small" data-grename="${esc(g.id)}">Renommer</button></div><button class="btn small danger" data-gdel="${esc(g.id)}" ${n ? `disabled title="Le groupe contient ${n} consultant(s)"` : ""}>Supprimer</button></li>`; }).join("") || `<li class="empty-note">Aucun groupe.</li>`}</ul>
      <form class="inline" id="gAddForm"><input id="gNew" placeholder="Nouveau groupe, ex. Pôle IA & Agents" required><button class="btn primary small" type="submit">Ajouter</button></form>
    </section>
    <section class="panel"><h2>Inviter un collaborateur</h2>
      <ol class="steps"><li>Crée son profil ci-dessous (nom, groupe, compétences).</li><li>Envoie-lui l'adresse de l'application.</li><li>Il se connecte avec son e-mail ${esc(DOMAINS.map(d => "@" + d).join(" ou "))} et choisit son nom dans « Mon planning ».</li><li>Tu valides la demande en haut de cette page.</li></ol>
      <p class="muted" style="font-size:.84rem">Chaque collaborateur ne peut modifier que son propre planning : la règle est appliquée par la base de données. Seuls les administrateurs gèrent l'équipe, les groupes et les plannings des autres.</p></section>
  </div>
  <section class="panel"><div class="panel-head"><h2>Équipe</h2><button class="btn primary" id="btnAddC">+ Consultant</button></div>
    <div class="scroll"><table class="list"><thead><tr><th>Consultant</th><th>Groupe</th><th>Rôle</th><th>Compte</th><th>Planning</th><th></th></tr></thead><tbody>${state.members.map(m => { const f = freshness(m); return `<tr><td><strong>${esc(m.name)}</strong></td><td>${esc(groupName(m.group_id))}</td><td>${esc(m.role || "")}</td><td>${m.user_id ? esc(m.user_email || "Compte rattaché") : `<span class="pill">Non rattaché</span>`}</td><td><span class="person"><i class="fresh ${f.cls}"></i>${esc(f.label)}</span></td><td style="white-space:nowrap"><button class="btn small" data-c="${esc(m.id)}">Modifier</button>${m.user_id ? ` <button class="btn small" data-unlink="${esc(m.id)}">Détacher</button>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="6" class="empty-note">Aucun consultant.</td></tr>`}</tbody></table></div></section>`;
}

/* ---------- connexion ---------- */
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

/* ---------- rendu ---------- */
function renderTabs() {
  const pc = isAdmin() ? state.claims.length : 0;
  const tabs = [["moi", "Mon planning"], ["equipe", "Équipe"]]; if (isAdmin()) tabs.push(["admin", "Administration"]);
  $("tabs").innerHTML = tabs.map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${state.tab === k}">${l}${k === "admin" && pc ? `<span class="count">${pc}</span>` : ""}</button>`).join("");
}
function renderChip() {
  const chip = $("meChip"); chip.hidden = false;
  const m = myMember();
  chip.innerHTML = `<span class="avatar" aria-hidden="true"></span><span class="n"></span><span class="badge ${isAdmin() ? "admin" : ""}">${isAdmin() ? "Administrateur" : "Collaborateur"}</span><button class="btn small" id="btnLogout">Déconnexion</button>`;
  chip.querySelector(".avatar").textContent = initials(m ? m.name : state.me.email);
  chip.querySelector(".n").textContent = m ? m.name : state.me.email;
}
function render() {
  if (!state.me.id) return;
  if (!state.loaded) { main().innerHTML = `<div class="state">Chargement du plan de charge…</div>`; return; }
  if (!state.tab) state.tab = isAdmin() ? "equipe" : "moi";
  if (state.tab === "admin" && !isAdmin()) state.tab = "moi";
  if (state.group && !state.groups.some(g => g.id === state.group)) state.group = "";
  rebuild(); renderTabs(); renderChip();
  const ex = state.members.some(m => m.example); const ban = $("banner"); ban.hidden = !(ex && isAdmin());
  if (ex && isAdmin()) ban.innerHTML = `<div class="banner"><span><strong>Données d'exemple.</strong> Ces consultants et missions montrent l'outil. Crée ton équipe dans l'administration puis supprime-les.</span><button class="btn small danger" id="btnClearEx">Supprimer les exemples</button></div>`;
  const fs = document.activeElement && document.activeElement.id;
  main().innerHTML = `<div class="stack">${state.tab === "admin" ? viewAdmin() : state.tab === "moi" ? viewMine() : viewTeam()}</div>`;
  renderFinderResults();
  if (fs) { const el = $(fs); if (el && el.focus) { el.focus(); if (el.type === "search" || el.type === "text") { const v = el.value; try { el.setSelectionRange(v.length, v.length); } catch (_) {} } } }
}
let rT = null; const schedule = () => { clearTimeout(rT); rT = setTimeout(render, 30); };

/* ---------- données ---------- */
async function q(p) { const { data, error } = await p; if (error) throw error; return data; }
async function loadAll() {
  const since = iso(TODAY - 180 * DAY);
  const [g, m, c, i, s] = await Promise.all([
    q(sb.from("groups").select("*").order("name")),
    q(sb.from("members").select("*").order("name")),
    q(sb.from("claims").select("*").order("created_at")),
    q(sb.from("items").select("*").gte("end_date", since).limit(5000)),
    q(sb.from("plan_status").select("*"))
  ]);
  state.groups = g; state.members = m; state.claims = c;
  state.items = i.map(x => ({ id: x.id, consultantId: x.member_id, type: x.type, client: x.client, mission: x.mission, start: x.start_date, end: x.end_date, days: +x.days, status: x.status, example: x.example }));
  state.status = {}; s.forEach(r => state.status[r.member_id] = r);
  state.loaded = true;
}
let lT = null;
function reloadSoon() { clearTimeout(lT); lT = setTimeout(async () => { try { await loadAll(); schedule(); } catch (e) { console.error(e); } }, 250); }
let channel = null;
function subscribe() {
  if (channel) return;
  channel = sb.channel("pdc-changes");
  ["groups", "members", "claims", "items", "plan_status"].forEach(t => channel.on("postgres_changes", { event: "*", schema: "public", table: t }, reloadSoon));
  channel.subscribe();
}

/* ---------- écritures ---------- */
function toast(msg) { const r = $("toastRoot"); r.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`; clearTimeout(toast.t); toast.t = setTimeout(() => r.innerHTML = "", 2800); }
function errMsg(e) {
  const code = e && e.code;
  if (code === "42501" || /row-level security/i.test(e && e.message || "")) return "Action refusée : tu ne peux modifier que ton propre planning.";
  if (code === "23505") return "Ce compte est déjà rattaché à un autre profil.";
  if (code === "23514") return "Valeur invalide : vérifie les dates et le nombre de jours.";
  return "Enregistrement impossible : " + (e && e.message ? e.message : "réessaie dans un instant.");
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

/* ---------- modales ---------- */
function closeModal() { $("modalRoot").innerHTML = ""; }
function memberModal(id) {
  const admin = isAdmin(); const isNew = !id;
  const m = memberById(id) || { name: "", role: "Consultant", skills: [], capacity: 5, group_id: state.group || (state.groups[0] || {}).id || "" };
  const editPlan = !isNew && canEditMember(m); const dis = admin ? "" : "disabled";
  const list = isNew ? [] : staffsFor(m).sort((a, b) => (parse(a.start) || 0) - (parse(b.start) || 0));
  $("modalRoot").innerHTML = `<div class="overlay" id="ov"><form class="modal" id="cForm" aria-label="Consultant">
    <h2>${isNew ? "Nouveau consultant" : esc(m.name)}</h2>
    <div class="form-grid">
      <label class="f full">Nom<input id="cName" required value="${esc(m.name)}" ${dis}></label>
      <label class="f">Groupe<select id="cGroup" ${dis}><option value="">Sans groupe</option>${state.groups.map(g => `<option value="${esc(g.id)}" ${m.group_id === g.id ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>
      <label class="f">Rôle<select id="cRole" ${dis}>${ROLES.map(r => `<option ${m.role === r ? "selected" : ""}>${r}</option>`).join("")}</select></label>
      <label class="f">Capacité (jours / semaine)<input id="cCap" type="number" min="0.5" max="5" step="0.5" value="${m.capacity || 5}" ${dis}></label>
      <div class="full"><span class="eyebrow">Compétences</span><div class="checks">${SKILLS.map((s, i) => `<label><input type="checkbox" id="cSk${i}" ${(m.skills || []).includes(s) ? "checked" : ""} ${dis}>${esc(s)}</label>`).join("")}</div></div>
    </div>
    ${isNew ? "" : `<div class="stack-s"><div class="panel-head"><span class="eyebrow">Staffings (${list.length})</span>${editPlan ? `<button type="button" class="btn small" id="cAddS">+ Staffing</button>` : ""}</div>
      <ul class="mstaff">${list.map(s => `<li><span><span class="tag"><i class="sw" style="background:${TYPES[s.type]?.color}"></i><strong>${esc(s.client || TYPES[s.type]?.label)}</strong></span> ${esc(s.mission || "")} ${s.status === "probable" ? '<span class="pill probable">Probable</span>' : ""}<br><span class="mono muted" style="font-size:.8rem">${frDate(parse(s.start))} → ${frDate(parse(s.end))} · ${d1(+s.days || 0)} j/sem</span></span>${editPlan ? `<button type="button" class="btn small" data-ms="${esc(s.id)}">Modifier</button>` : ""}</li>`).join("") || `<li class="empty-note">Aucun staffing.</li>`}</ul></div>`}
    <div class="row-actions">${!isNew && admin ? `<button type="button" class="btn danger" id="cDel">Supprimer</button>` : "<span></span>"}<div class="r"><button type="button" class="btn" id="cCancel">Fermer</button>${admin ? `<button class="btn primary" type="submit">Enregistrer</button>` : ""}</div></div>
  </form></div>`;
  $("cForm").addEventListener("submit", async e => {
    e.preventDefault(); if (!admin) return;
    const body = { name: $("cName").value.trim(), group_id: $("cGroup").value || null, role: $("cRole").value, capacity: +$("cCap").value || 5, skills: SKILLS.filter((_, i) => $("cSk" + i).checked) };
    if (!body.name) return;
    try { await q(isNew ? sb.from("members").insert(body) : sb.from("members").update(body).eq("id", id)); closeModal(); toast(isNew ? "Consultant ajouté" : "Consultant mis à jour"); await after(); } catch (err) { toast(errMsg(err)); }
  });
  $("cCancel").onclick = closeModal;
  const del = $("cDel");
  if (del) del.onclick = async () => {
    if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = list.length ? `Confirmer (supprime aussi ${list.length} staffing${list.length > 1 ? "s" : ""})` : "Confirmer la suppression"; return; }
    try { await q(sb.from("members").delete().eq("id", id)); closeModal(); toast("Consultant supprimé"); await after(); } catch (err) { toast(errMsg(err)); }
  };
  const add = $("cAddS"); if (add) add.onclick = () => staffModal(null, m.id);
  document.querySelectorAll("#cForm [data-ms]").forEach(b => b.onclick = () => staffModal(b.dataset.ms, m.id));
}

function staffModal(itemId, memberId) {
  const m = memberById(memberId); if (!m) return;
  const s = state.items.find(x => x.id === itemId) || { client: "", mission: "", type: "BUILD", status: "ferme", start: iso(monday(TODAY)), end: iso(monday(TODAY) + 8 * 7 * DAY + 4 * DAY), days: 5 };
  const list = staffsFor(m);
  $("modalRoot").innerHTML = `<div class="overlay" id="ov"><form class="modal" id="sForm" aria-label="Staffing">
    <h2>${itemId ? "Modifier" : "Ajouter"} · ${esc(m.name)}</h2>
    <div class="form-grid">
      <label class="f full">Type<select id="sType">${Object.keys(TYPES).map(k => `<option value="${k}" ${s.type === k ? "selected" : ""}>${TYPES[k].label}</option>`).join("")}</select></label>
      <label class="f">Client<input id="sClient" value="${esc(s.client)}" placeholder="ex. L'Oréal, Interne…"></label>
      <label class="f">Mission ou motif<input id="sMission" value="${esc(s.mission)}" placeholder="ex. TMA Planning Analytics, congés…"></label>
      <label class="f">Début<input type="date" id="sStart" required value="${esc(s.start)}"></label>
      <label class="f">Fin<input type="date" id="sEnd" required value="${esc(s.end)}"></label>
      <label class="f">Jours / semaine<input type="number" id="sDays" min="0.5" max="5" step="0.5" required value="${s.days}"></label>
      <label class="f">Statut<select id="sStatus"><option value="ferme" ${s.status !== "probable" ? "selected" : ""}>Ferme (confirmé)</option><option value="probable" ${s.status === "probable" ? "selected" : ""}>Probable (pipeline)</option></select></label>
    </div>
    <p class="empty-note" id="sHint"></p>
    <div class="row-actions">${itemId ? `<button type="button" class="btn danger" id="sDel">Supprimer</button>` : "<span></span>"}<div class="r"><button type="button" class="btn" id="sCancel">Annuler</button><button class="btn primary" type="submit" id="sSave">Enregistrer</button></div></div>
  </form></div>`;
  const hint = () => {
    const a = monday(parse($("sStart").value)), b = monday(parse($("sEnd").value)); const h = $("sHint");
    if (isNaN(a) || isNaN(b)) { h.textContent = ""; return; } if (b < a) { h.textContent = "La fin doit être après le début."; return; }
    let mx = 0, wk = null; const others = list.filter(x => x.id !== itemId);
    for (let w = a; w <= b && w < a + 26 * 7 * DAY; w += 7 * DAY) { const r = cellFor(m, w, true, others); const extra = $("sType").value === "ABSENCE" ? 0 : (+$("sDays").value || 0) * r.wd / 5; const l = r.net > 0 ? (r.staffed + extra) / r.net : 0; if (l > mx) { mx = l; wk = w; } }
    h.innerHTML = mx > 1.001 ? `<span style="color:var(--bad)">Avec cette saisie, la charge monte à ${pct(mx)} en S${isoWeek(wk)}.</span>` : `Charge maximale sur la période : ${pct(mx)}.`;
  };
  ["sStart", "sEnd", "sDays", "sType"].forEach(i => $(i).addEventListener("input", hint)); hint();
  $("sForm").addEventListener("submit", async e => {
    e.preventDefault();
    const body = { member_id: m.id, type: $("sType").value, client: $("sClient").value.trim(), mission: $("sMission").value.trim(), start_date: $("sStart").value, end_date: $("sEnd").value, days: +$("sDays").value || 0, status: $("sType").value === "ABSENCE" ? "ferme" : $("sStatus").value };
    if (parse(body.end_date) < parse(body.start_date)) { toast("La date de fin doit être après le début"); return; }
    $("sSave").disabled = true;
    try { await q(itemId ? sb.from("items").update(body).eq("id", itemId) : sb.from("items").insert(body)); await touchStatus(m.id, "updated_at"); closeModal(); toast("Enregistré"); await after(); }
    catch (err) { toast(errMsg(err)); const b = $("sSave"); if (b) b.disabled = false; }
  });
  $("sCancel").onclick = closeModal;
  const del = $("sDel");
  if (del) del.onclick = async () => {
    if (del.dataset.armed !== "1") { del.dataset.armed = "1"; del.textContent = "Confirmer la suppression"; return; }
    try { await q(sb.from("items").delete().eq("id", itemId)); await touchStatus(m.id, "updated_at"); closeModal(); toast("Supprimé"); await after(); } catch (err) { toast(errMsg(err)); }
  };
}

/* ---------- événements ---------- */
async function guard(btn, fn, ok) {
  if (btn) btn.disabled = true;
  try { await fn(); if (ok) toast(ok); await after(); }
  catch (err) { toast(errMsg(err)); }
  finally { if (btn && btn.isConnected) btn.disabled = false; }
}
document.addEventListener("click", async e => {
  if (e.target.id === "ov") { closeModal(); return; }
  const t = e.target.closest("button"); if (!t) return;
  if (t.closest("#modalRoot")) return;
  const d = t.dataset;
  if (t.id === "btnLogout") { await sb.auth.signOut(); return; }
  if (d.tab) { state.tab = d.tab; render(); return; }
  if (d.h) { state.h = +d.h; try { localStorage.setItem("pdc.h", state.h); } catch (_) {} render(); return; }
  if (d.s) { staffModal(d.s, d.m); return; }
  if (d.c) { memberModal(d.c); return; }
  if (t.id === "btnAddC") { memberModal(null); return; }
  if (t.id === "btnMyAdd") { const m = myMember(); if (m) staffModal(null, m.id); return; }
  if (t.id === "btnConfirm") { const m = myMember(); if (m) guard(t, () => touchStatus(m.id, "confirmed_at"), "Planning confirmé, merci !"); return; }
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
  if (d.grename) { const v = $("gName-" + d.grename).value.trim(); if (v) guard(t, () => q(sb.from("groups").update({ name: v }).eq("id", d.grename)), "Groupe renommé"); return; }
  if (d.gdel) { if (d.armed !== "1") { t.dataset.armed = "1"; t.textContent = "Confirmer"; return; } guard(t, () => q(sb.from("groups").delete().eq("id", d.gdel)), "Groupe supprimé"); return; }
  if (t.id === "btnClearEx") {
    if (d.armed !== "1") { t.dataset.armed = "1"; t.textContent = "Confirmer : supprimer tous les exemples"; return; }
    guard(t, async () => {
      await q(sb.from("members").delete().eq("example", true));
      const used = new Set(state.members.filter(m => !m.example).map(m => m.group_id));
      const ids = state.groups.filter(g => g.example && !used.has(g.id)).map(g => g.id);
      if (ids.length) await q(sb.from("groups").delete().in("id", ids));
    }, "Exemples supprimés");
  }
});
document.addEventListener("submit", e => {
  if (e.target.id === "gAddForm") { e.preventDefault(); const v = $("gNew").value.trim(); if (v) guard(null, () => q(sb.from("groups").insert({ name: v })), "Groupe ajouté"); }
  if (e.target.id === "loginForm") { e.preventDefault(); sendLink($("loginEmail").value); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });
document.addEventListener("change", e => {
  if (e.target.id === "optProb") { state.prob = e.target.checked; try { localStorage.setItem("pdc.prob", state.prob ? "1" : "0"); } catch (_) {} render(); }
  if (e.target.id === "gSel") { state.group = e.target.value; try { localStorage.setItem("pdc.g", state.group); } catch (_) {} render(); }
});
document.addEventListener("input", e => {
  const id = e.target.id;
  if (id === "lFilter") { state.filter = e.target.value; clearTimeout(render.t); render.t = setTimeout(render, 200); return; }
  if (id === "fSkill") finder.skill = e.target.value; else if (id === "fStart") finder.start = e.target.value; else if (id === "fWeeks") finder.weeks = e.target.value; else if (id === "fDays") finder.days = e.target.value; else return;
  renderFinderResults();
});

/* ---------- session ---------- */
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
  try {
    const { data } = await sb.rpc("is_admin"); state.me.isAdmin = data === true;
    await loadAll(); subscribe(); render();
  } catch (e) {
    main().innerHTML = `<div class="panel state"><h2>Chargement impossible</h2><p>${esc(e.message || "Erreur de connexion à la base.")}</p><button class="btn" id="btnLogout">Se déconnecter</button></div>`;
  }
}
sb.auth.onAuthStateChange((_ev, session) => { setTimeout(() => onSession(session), 0); });
sb.auth.getSession().then(({ data }) => onSession(data.session));
})();
