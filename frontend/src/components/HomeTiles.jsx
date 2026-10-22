import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, BarChart3, ListChecks, History, Package, Flame, Droplets, Coins, Star, Users, Trophy,
         Dices, ChevronRight, Camera, Video, Thermometer, CalendarDays, ShoppingBag, Rss, Images, Zap, Medal as MedalIcon,
         BellRing, TrendingUp, TrendingDown, Key, Ticket } from "lucide-react";
import client, { apiUrl } from "../api/client";
import { mwImg } from "./MwImg";
import LiveCamera from "./LiveCamera";
import { Medal, gradeOf, GradeEmblem, CARD_ORDER } from "../pages/Achievements";

// Les tuiles de l'accueil (22/10/2026). Chaque tuile :
//  - s'adapte a sa place : demi-largeur ou toute la colonne (w), 1 a 3 rangees
//    de haut (h) ; plus elle a de place, plus elle montre (graphique, liste…) ;
//  - montre en visuel ce qui s'y prete (anneau, jauge, barres, courbe, bobines) ;
//  - a ses options, reglees dans son panneau (« Options ») et gardees par disposition.
// Chaque tuile est une « .card » et ses morceaux (mots, chiffres, pastilles,
// vignettes) portent data-pk : les effets de l'accueil les font bouger un par un.

const ymd = d => d.toLocaleDateString("sv");
const hexCss = h => { const s = String(h || "").replace("#", ""); return s.length >= 6 ? `#${s.slice(0, 6)}` : "#888"; };
const fmtH = s => { const h = (s || 0) / 3600; return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1).replace(".", ",")} h`; };
const fmtG = g => (g || 0) >= 1000 ? `${((g || 0) / 1000).toFixed(1).replace(".", ",")} kg` : `${Math.round(g || 0)} g`;
const fmtDur = s => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; };
const fmtEur = v => `${(v || 0).toFixed(2).replace(".", ",")} €`;
const ago = iso => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 60 ? `il y a ${Math.max(1, m)} min` : m < 1440 ? `il y a ${Math.round(m / 60)} h` : `il y a ${Math.round(m / 1440)} j`;
};
const noEmoji = t => String(t || "").replace(/^\p{Extended_Pictographic}️?\s*/u, "");

function W({ text }) {
  return String(text ?? "").split(/(\s+)/).map((p, i) => /\s/.test(p) || !p ? p : <span key={i} data-pk="">{p}</span>);
}

// ── Gabarit et visuels communs ───────────────────────────────────────────────
function Tile({ icon, color, label, onClick, badge, children, mini = false, summary = null }) {
  // demi-hauteur : une seule ligne, l'icone, le nom, et l'essentiel en gros a droite
  if (mini) return (
    <div className="card" role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      style={{ padding: "0 12px", display: "flex", alignItems: "center", gap: 8, minWidth: 0, cursor: onClick ? "pointer" : "default",
        position: "relative", overflow: "hidden", height: "100%", boxSizing: "border-box" }}>
      <span data-pk="" style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
        background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
      <span className="tile-head" style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis",
        whiteSpace: "nowrap", minWidth: 0, flexShrink: 1 }}><W text={label}/></span>
      <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 15, fontWeight: 900,
        color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden" }}>{summary}</span>
    </div>
  );
  return (
    <div className="card" role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      onKeyDown={e => { if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}
      style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0, cursor: onClick ? "pointer" : "default",
        position: "relative", overflow: "hidden", height: "100%", boxSizing: "border-box" }}>
      <span aria-hidden="true" style={{ position: "absolute", right: -24, top: -24, width: 80, height: 80, borderRadius: "50%",
        background: `${color}22`, pointerEvents: "none" }}/>
      <div className="tile-head" style={{ display: "flex", alignItems: "center", gap: 8, position: "relative", minWidth: 0 }}>
        <span data-pk="" style={{ width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
          background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", letterSpacing: ".02em", overflow: "hidden", textOverflow: "ellipsis",
          whiteSpace: "nowrap", minWidth: 0 }}><W text={label}/></span>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {badge}{onClick && <ChevronRight size={14} style={{ color: "var(--muted)" }}/>}</span>
      </div>
      <div style={{ position: "relative", minWidth: 0, flex: 1, display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}
const Big = ({ children, color = "var(--text)", size }) =>
  <div data-pk="" style={{ fontSize: size || "clamp(19px, 5.4vw, 24px)", fontWeight: 900, color, lineHeight: 1.05, letterSpacing: "-.01em" }}>{children}</div>;
const clamp = n => ({ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: n, WebkitBoxOrient: "vertical", lineHeight: 1.35 });
const Sub = ({ children, lines = 2 }) =>
  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, ...clamp(lines) }}>{children}</div>;
const Line = ({ children }) =>
  <div style={{ fontSize: 12.5, color: "var(--text2)", ...clamp(2) }}>{children}</div>;
const Unit = ({ children }) => <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 700 }}>{children}</span>;
const Row = ({ children, gap = 6, style }) => <div style={{ display: "flex", alignItems: "baseline", gap, flexWrap: "wrap", ...style }}>{children}</div>;
// un anneau (0 a 1), un nombre au centre
function Ring({ value, size = 54, color = "#3b82f6", stroke = 7, children }) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value || 0));
  return (
    <span data-pk="" style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-flex" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface2)" strokeWidth={stroke}/>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - v)} style={{ transition: "stroke-dashoffset .6s" }}/>
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * (String(children ?? "").length > 3 ? 0.2 : 0.24),
        fontWeight: 900, color: "var(--text)" }}>{children}</span>
    </span>
  );
}
// une jauge en demi-cercle
function Gauge({ value, max = 100, size = 74, color, label, sub }) {
  const v = Math.max(0, Math.min(1, (value || 0) / max)), r = size / 2 - 6, C = Math.PI * r;
  return (
    <div data-pk="" style={{ display: "flex", flexDirection: "column", alignItems: "center", width: size, flexShrink: 0 }}>
      <svg width={size} height={size / 2 + 6} viewBox={`0 0 ${size} ${size / 2 + 6}`} aria-hidden="true">
        <path d={`M6 ${size / 2} A${r} ${r} 0 0 1 ${size - 6} ${size / 2}`} fill="none" stroke="var(--surface2)" strokeWidth="8" strokeLinecap="round"/>
        <path d={`M6 ${size / 2} A${r} ${r} 0 0 1 ${size - 6} ${size / 2}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - v)} style={{ transition: "stroke-dashoffset .6s" }}/>
      </svg>
      <span style={{ marginTop: -14, fontSize: 15, fontWeight: 900, color: "var(--text)" }}>{label}</span>
      {sub && <span style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 700 }}>{sub}</span>}
    </div>
  );
}
// des barres (une par valeur), la derniere ou « hi » en plein
function Bars({ values, labels, color, height = 40, hi = -1, showValues = false, fmt = v => v }) {
  const max = Math.max(1, ...values);
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: height + (labels ? 16 : 0) + (showValues ? 14 : 0) }}>
      {values.map((v, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          {showValues && <span style={{ fontSize: 9.5, color: "var(--muted)", fontWeight: 700, whiteSpace: "nowrap" }}>{v ? fmt(v) : ""}</span>}
          <span data-pk="" style={{ width: "100%", maxWidth: 26, borderRadius: 5, minHeight: 3, height: `${Math.round(height * v / max)}px`,
            background: i === hi ? color : `${color}59` }}/>
          {labels && <span style={{ fontSize: 10, color: i === hi ? "var(--text)" : "var(--muted)", fontWeight: i === hi ? 800 : 600 }}>{labels[i]}</span>}
        </div>
      ))}
    </div>
  );
}
// une petite courbe remplie
function Spark({ values, color, height = 38 }) {
  if (!values?.length) return null;
  const max = Math.max(1, ...values), n = values.length;
  const pts = values.map((v, i) => `${(i / Math.max(1, n - 1)) * 100},${height - 3 - (v / max) * (height - 6)}`).join(" ");
  return (
    <svg data-pk="" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ width: "100%", height }} aria-hidden="true">
      <polyline points={`0,${height} ${pts} 100,${height}`} fill={`${color}26`} stroke="none"/>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round"/>
    </svg>
  );
}
// une bobine : sa couleur, et ce qu'il en reste en anneau
function SpoolDot({ color, pct, size = 34, title }) {
  const r = size / 2 - 3, C = 2 * Math.PI * r, v = Math.max(0, Math.min(1, pct ?? 1));
  return (
    <span data-pk="" title={title} style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-flex" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface2)" strokeWidth="4"/>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={v < 0.15 ? "#ef4444" : v < 0.35 ? "#f59e0b" : "#22c55e"}
          strokeWidth="4" strokeDasharray={C} strokeDashoffset={C * (1 - v)}/>
      </svg>
      <span style={{ position: "absolute", inset: 6, borderRadius: "50%", background: hexCss(color), border: "1px solid rgba(0,0,0,0.15)" }}/>
    </span>
  );
}
const Delta = ({ now, before, unit = "" }) => {
  if (before == null || now == null) return null;
  const d = now - before;
  if (!d) return <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700 }}>= hier</span>;
  const up = d > 0;
  return <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 11.5, fontWeight: 800,
    color: up ? "#16a34a" : "#dc2626" }}>{up ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}{up ? "+" : ""}{unit ? fmtG(d) : d}</span>;
};

// ── Donnees ──────────────────────────────────────────────────────────────────
export function useTilesData() {
  const [d, setD] = useState({});
  useEffect(() => {
    let dead = false;
    const put = (k, p) => p.then(r => { if (!dead) setD(x => ({ ...x, [k]: r })); }).catch(() => { if (!dead) setD(x => ({ ...x, [k]: null })); });
    const get = (url, params) => client.get(url, { params }).then(r => r.data);
    const load = () => {
      const now = new Date(), t = ymd(now), y = new Date(now); y.setDate(now.getDate() - 1);
      put("today", Promise.all([get("/prints/kpis", { date_from: t }), get("/prints/kpis", { date_from: t, status: "SUCCESS" }),
        get("/prints/kpis", { date_from: ymd(y), date_to: ymd(y) })])
        .then(([all, ok, yd]) => ({ ...all, ok: ok.count, yesterday: yd })));
      put("prints", get("/prints", { limit: 16 }).then(r => (r.prints || r.items || []).filter(p => p.status !== "IN_PROGRESS")));
      put("spools", get("/filaments/spools", { archived: false }));
      put("dry", get("/filaments/drying/overview"));
      put("friends", get("/friends/shared/printing"));
      put("ach", get("/achievements"));
      const m0 = new Date(now.getFullYear(), now.getMonth(), 1), p0 = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const pEnd = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), 28));
      put("month", Promise.all([get("/prints/kpis", { date_from: ymd(m0) }), get("/prints/kpis", { date_from: ymd(p0), date_to: ymd(pEnd) })])
        .then(([cur, prev]) => ({ ...cur, prev })));
      put("sales", get("/objects/objects/stats"));
      put("feed", get("/notify/me/history"));
      put("attention", get("/attention"));
    };
    load();
    put("queue", get("/makerworld/queue"));
    put("mw", get("/makerworld/creator"));
    put("rate", get("/makerworld/to-rate"));
    put("podium", get("/achievements/podium"));
    const iv = setInterval(load, 120000);
    return () => { dead = true; clearInterval(iv); };
  }, []);
  return d;
}
// une serie par jour (n jours jusqu'a aujourd'hui), chargee par la tuile qui la demande
function useDays(n) {
  const [v, setV] = useState(null);
  useEffect(() => {
    let dead = false;
    const now = new Date();
    const days = [...Array(n)].map((_, i) => { const x = new Date(now); x.setDate(now.getDate() - n + 1 + i); return x; });
    Promise.all(days.map(x => client.get("/prints/kpis", { params: { date_from: ymd(x), date_to: ymd(x) } }).then(r => r.data).catch(() => ({}))))
      .then(rs => { if (!dead) setV(rs.map((r, i) => ({ day: days[i], ...r }))); });
    return () => { dead = true; };
  }, [n]);
  return v;
}

// ── Les tuiles ───────────────────────────────────────────────────────────────
// Aujourd'hui : un anneau de reussite, le compte, le poids, les heures, l'ecart avec hier
function Today({ v, o, sz }) {
  const nav = useNavigate();
  const rate = v?.count ? v.ok / v.count : null;
  const col = rate == null ? "#94a3b8" : rate >= 0.9 ? "#22c55e" : rate >= 0.7 ? "#f59e0b" : "#ef4444";
  return (
    <Tile icon={<CalendarClock size={15}/>} color="#3B82F6" label="Aujourd'hui" onClick={() => nav("/prints")}
      mini={sz.h === 0.5} summary={v ? <>{v.count}{rate != null && <span style={{ fontSize: 12, color: col }}>{Math.round(rate * 100)} %</span>}</> : "…"}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {o.ring && rate != null && <Ring value={rate} size={sz.h > 1 ? 70 : 50} color={col}>{Math.round(rate * 100)}%</Ring>}
        <div style={{ minWidth: 0 }}>
          <Row><Big>{v ? v.count : "…"}</Big><Unit>impression{v?.count > 1 ? "s" : ""}</Unit>
            {o.yesterday && v?.yesterday && <Delta now={v.count} before={v.yesterday.count}/>}</Row>
          {v && <Sub lines={sz.h > 1 ? 3 : 2}>
            <W text={[o.weight && fmtG(v.weight_g), o.hours && `${fmtH(v.duration)} de machine`, o.cost && fmtEur(v.cost)].filter(Boolean).join(" · ")}/></Sub>}
        </div>
      </div>
      {sz.h > 1 && v?.yesterday && <div style={{ marginTop: "auto", fontSize: 11.5, color: "var(--muted)" }}>
        Hier : {v.yesterday.count} impression{v.yesterday.count > 1 ? "s" : ""} · {fmtG(v.yesterday.weight_g)} · {fmtH(v.yesterday.duration)}</div>}
    </Tile>
  );
}
// 7, 14 ou 30 jours en barres : heures, impressions ou grammes
function Week({ o, sz }) {
  const nav = useNavigate();
  const n = o.range || 7;
  const v = useDays(n);
  const val = x => o.metric === "n" ? x.count || 0 : o.metric === "g" ? x.weight_g || 0 : x.duration || 0;
  const fmt = x => o.metric === "n" ? `${x}` : o.metric === "g" ? fmtG(x) : fmtH(x);
  const tot = (v || []).reduce((a, x) => a + val(x), 0);
  const today = ymd(new Date());
  const lbl = x => n === 7 ? x.day.toLocaleDateString("fr-FR", { weekday: "narrow" }) : n === 14 ? String(x.day.getDate()) : (x.day.getDate() % 5 === 0 ? String(x.day.getDate()) : "");
  return (
    <Tile icon={<BarChart3 size={15}/>} color="#8B5CF6" label={`${n} derniers jours`} onClick={() => nav("/stats?tab=prints")}
      mini={sz.h === 0.5} summary={v ? <>{fmt(tot)}<span style={{ width: 60, display: "inline-flex" }}><Spark values={v.map(val)} color="#8B5CF6" height={22}/></span></> : "…"}>
      <Row><Big>{v ? fmt(tot) : "…"}</Big>
        {v && o.avg && <Unit>· {fmt(o.metric === "n" ? Math.round(tot / n * 10) / 10 : tot / n)} / jour</Unit>}</Row>
      {v && <div style={{ marginTop: "auto", paddingTop: 6 }}>
        <Bars values={v.map(val)} labels={v.map(lbl)} color="#8B5CF6" height={sz.h > 1 ? 90 : 30}
          hi={v.findIndex(x => ymd(x.day) === today)} showValues={sz.h > 1 && sz.w > 1 && n <= 14} fmt={fmt}/></div>}
    </Tile>
  );
}
// a faire : le prochain (vignette), ou une liste selon la place
function Next({ q, o, sz }) {
  const nav = useNavigate();
  const models = (q?.models || []).filter(m => !o.ready || m.status === "ready");
  const list = models.slice(0, sz.h > 1 ? (sz.h > 2 ? 6 : 3) : 1);
  const ready = (q?.models || []).filter(m => m.status === "ready").length;
  return (
    <Tile icon={<ListChecks size={15}/>} color="#22C55E" label="À faire" onClick={() => nav("/prints?tab=queue")}
      mini={sz.h === 0.5} summary={q ? <>{ready}<span style={{ fontSize: 12, color: "var(--muted)" }}>/ {q.models?.length || 0} prêts</span></> : "…"}
      badge={q?.models?.length ? <span style={{ fontSize: 11, fontWeight: 800, color: "#16a34a" }}>{ready}/{q.models.length} prêts</span> : null}>
      {!list.length ? <Line><W text={q === undefined ? "…" : o.ready ? "Rien de prêt dans l'AMS" : "Rien dans « À faire »"}/></Line>
        : list.map((m, i) => (
          <div key={m.design_id} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: i ? 6 : 0 }}>
            {o.thumbs && (m.cover_url ? <img data-pk="" src={mwImg(m.cover_url, 120)} alt="" style={{ width: i ? 36 : 52, height: i ? 36 : 52, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}/>
              : <span data-pk="" style={{ width: i ? 36 : 52, height: i ? 36 : 52, borderRadius: 10, background: "var(--surface2)", flexShrink: 0 }}/>)}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: i ? 12.5 : 13.5, fontWeight: 800, color: "var(--text)", ...clamp(1) }}><W text={m.title_fr || m.title}/></div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                {m.status === "ready" ? <span style={{ color: "#16a34a", fontWeight: 800 }}>● prêt</span> : <span>○ à préparer</span>}
                {m.seconds ? ` · ${fmtDur(m.seconds)}` : ""}{o.weight && m.weight_g ? ` · ${fmtG(m.weight_g)}` : ""}</div>
            </div>
          </div>
        ))}
    </Tile>
  );
}
// les dernieres impressions : une (grande) ou une liste
function Last({ p, o, sz }) {
  const nav = useNavigate();
  const list = (p || []).slice(0, sz.h > 1 ? (sz.h > 2 ? 6 : 3) : 1);
  if (!list.length) return null;
  return (
    <Tile icon={<History size={15}/>} color="#0EA5E9" label={list.length > 1 ? "Dernières impressions" : "Dernière impression"}
      mini={sz.h === 0.5} summary={<span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis" }}>
        <span style={{ color: list[0].status === "SUCCESS" || list[0].status === "PARTIAL" ? "#22c55e" : "#ef4444" }}>● </span>
        {list[0].file_name || list[0].translated_name}</span>}>
      {list.map((x, i) => {
        const ok = x.status === "SUCCESS" || x.status === "PARTIAL";
        return (
          <div key={x.id} onClick={() => nav(`/prints?id=${x.id}`)} style={{ display: "flex", gap: 10, alignItems: "center", marginTop: i ? 6 : 0, cursor: "pointer" }}>
            <span style={{ position: "relative", flexShrink: 0 }}>
              <img data-pk="" src={apiUrl(`/prints/${x.id}/image`)} alt="" onError={e => { e.currentTarget.style.visibility = "hidden"; }}
                style={{ width: i ? 36 : 52, height: i ? 36 : 52, borderRadius: 10, objectFit: "cover", background: "var(--surface2)", display: "block" }}/>
              <span style={{ position: "absolute", right: -3, bottom: -3, width: 14, height: 14, borderRadius: "50%", border: "2px solid var(--surface)",
                background: ok ? "#22c55e" : "#ef4444" }} title={ok ? "réussie" : "ratée"}/>
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: i ? 12.5 : 13.5, fontWeight: 800, color: "var(--text)", ...clamp(1) }}><W text={x.file_name || x.translated_name || `Impression #${x.id}`}/></div>
              <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                {o.when && x.print_date ? `${ago(x.print_date)} · ` : ""}{x.duration_seconds ? fmtDur(x.duration_seconds) : ""}
                {x.total_weight_g ? ` · ${fmtG(x.total_weight_g)}` : ""}{o.cost && x.total_cost ? ` · ${fmtEur(x.total_cost)}` : ""}</div>
            </div>
            {o.photo && !x.cover_photo && i === 0 && <span data-pk="" title="Pas encore de photo" style={{ display: "inline-flex", alignItems: "center", gap: 4,
              fontSize: 11, fontWeight: 800, color: "#0EA5E9", padding: "4px 8px", borderRadius: 20, background: "rgba(14,165,233,0.12)" }}><Camera size={12}/>photo</span>}
          </div>
        );
      })}
    </Tile>
  );
}
// le stock : le total, et les bobines les plus basses en pastilles (anneau = ce qui reste)
function Stock({ s, o, sz }) {
  const nav = useNavigate();
  const list = Array.isArray(s) ? s : [];
  const kg = list.reduce((a, x) => a + (x.remaining_weight_g || 0), 0);
  const pct = x => x.filament_weight_g ? (x.remaining_weight_g || 0) / x.filament_weight_g : null;
  const n = o.low * (sz.h > 1 ? 2 : 1);
  const low = list.filter(x => x.remaining_weight_g != null)
    .sort((a, b) => o.sort === "pct" ? (pct(a) ?? 1) - (pct(b) ?? 1) : a.remaining_weight_g - b.remaining_weight_g).slice(0, n);
  return (
    <Tile icon={<Package size={15}/>} color="#F59E0B" label="Stock" onClick={() => nav("/filaments")}
      mini={sz.h === 0.5} summary={<>{list.length}<span style={{ display: "inline-flex", gap: 2 }}>{low.slice(0, 3).map(x => <SpoolDot key={x.id} color={x.filament_color} pct={pct(x)} size={22}/>)}</span></>}>
      <Row><Big>{s === undefined ? "…" : list.length}</Big><Unit>bobines{o.kg ? ` · ${fmtG(kg)}` : ""}</Unit></Row>
      {o.style === "dots" ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          {low.map(x => <SpoolDot key={x.id} color={x.filament_color} pct={pct(x)} size={sz.w > 1 ? 38 : 32}
            title={`${x.filament_translated_name || x.filament_name} · ${Math.round(x.remaining_weight_g)} g`}/>)}
        </div>
      ) : low.map(x => (
        <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, fontSize: 12, color: "var(--text2)", minWidth: 0 }}>
          <SpoolDot color={x.filament_color} pct={pct(x)} size={20}/>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}><W text={x.filament_translated_name || x.filament_name}/></span>
          <span data-pk="" style={{ fontWeight: 800, color: "#d97706" }}>{Math.round(x.remaining_weight_g)} g</span>
        </div>
      ))}
    </Tile>
  );
}
// le sechage : un anneau par AMS qui seche (temps restant), sinon les bobines a secher
function Dry({ v, status, o, sz }) {
  const nav = useNavigate();
  const drying = (status?.ams_list || []).filter(a => a.is_drying && a.dry_time > 0);
  const lab = a => a.id >= 128 ? `HT-${String.fromCharCode(65 + a.id - 128)}` : `AMS-${String.fromCharCode(65 + a.id)}`;
  const k = v?.kpis;
  return (
    <Tile icon={<Flame size={15}/>} color="#EF4444" label="Séchage" onClick={() => nav("/stats?tab=drying")}
      mini={sz.h === 0.5} summary={drying.length ? <span style={{ fontSize: 13, color: "#ef4444" }}>{drying.length} en cours · {fmtDur(drying[0].dry_time)}</span>
        : <span style={{ color: k?.to_dry ? "#dc2626" : "var(--text)" }}>{k?.to_dry ?? "…"} <span style={{ fontSize: 12, color: "var(--muted)" }}>à sécher</span></span>}>
      {drying.length ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {drying.map(a => {
            const tot = (a.dry_duration || 0) * 60, left = a.dry_time || 0;
            return (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Ring value={tot ? 1 - left / tot : 0.5} size={sz.h > 1 ? 64 : 48} color="#ef4444">{a.dry_temperature ? `${a.dry_temperature}°` : ""}</Ring>
                <div><div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>{lab(a)}</div>
                  <div style={{ fontSize: 11.5, color: "var(--muted)" }}>encore {fmtDur(left)}{a.dry_filament ? ` · ${a.dry_filament}` : ""}</div></div>
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {o.ring && k?.active ? <Ring value={(k.ok || 0) / k.active} size={sz.h > 1 ? 64 : 48} color="#22c55e">{Math.round(100 * (k.ok || 0) / k.active)}%</Ring> : null}
          <div style={{ minWidth: 0 }}>
            <Row><Big color={k?.to_dry ? "#dc2626" : "var(--text)"}>{v ? k?.to_dry ?? 0 : "…"}</Big><Unit>à sécher</Unit></Row>
            {k && <Sub>{k.soon ? `${k.soon} bientôt · ` : ""}{k.ok || 0} au sec{o.inams && k.to_dry_in_ams ? ` · ${k.to_dry_in_ams} dans l'AMS` : ""}</Sub>}
          </div>
        </div>
      )}
      {sz.h > 1 && (v?.to_dry || []).slice(0, sz.h > 2 ? 6 : 3).map(x => (
        <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, fontSize: 12, color: "var(--text2)" }}>
          <span data-pk="" style={{ width: 10, height: 10, borderRadius: "50%", background: hexCss(x.color), flexShrink: 0 }}/>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</span>
          <span style={{ fontWeight: 800, color: "#dc2626" }}>{x.age_days != null ? `${x.age_days} j` : "jamais"}</span>
        </div>
      ))}
    </Tile>
  );
}
// l'humidite : des jauges (ou des barres), avec ses seuils
function Humidity({ status, o, sz }) {
  const nav = useNavigate();
  const list = (status?.ams_list || []).filter(a => a.humidity > 0 && a.id !== 255 && a.id !== 254);
  if (!list.length) return null;
  const [lo, hi] = o.thr === "strict" ? [20, 30] : o.thr === "loose" ? [40, 55] : [30, 40];
  const col = h => h < lo ? "#22c55e" : h < hi ? "#f59e0b" : "#ef4444";
  const lab = a => a.id >= 128 ? `HT-${String.fromCharCode(65 + a.id - 128)}` : `AMS-${String.fromCharCode(65 + a.id)}`;
  return (
    <Tile icon={<Droplets size={15}/>} color="#06B6D4" label="Humidité des AMS" onClick={() => nav("/stats?tab=drying")}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 8 }}>{list.map(a => <span key={a.id} style={{ color: col(a.humidity) }}>{a.humidity}%</span>)}</span>}>
      {o.style === "gauges" ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "space-around" }}>
          {list.map(a => <Gauge key={a.id} value={a.humidity} color={col(a.humidity)} size={sz.w > 1 || list.length < 3 ? 74 : 60}
            label={`${a.humidity}%`} sub={`${lab(a)}${o.temp && a.temp ? ` · ${Math.round(a.temp)}°` : ""}`}/>)}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {list.map(a => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span style={{ width: 48, flexShrink: 0, whiteSpace: "nowrap", color: "var(--text2)", fontWeight: 700 }}>{lab(a)}</span>
              <span style={{ flex: 1, height: 7, borderRadius: 7, background: "var(--surface2)", overflow: "hidden" }}>
                <span data-pk="" style={{ display: "block", height: "100%", width: `${Math.min(100, a.humidity)}%`, background: col(a.humidity), borderRadius: 7 }}/></span>
              <span data-pk="" style={{ width: 34, textAlign: "right", fontWeight: 800, color: col(a.humidity) }}>{a.humidity} %</span>
              {o.temp && a.temp > 0 && <span style={{ width: 34, textAlign: "right", color: "var(--muted)" }}>{Math.round(a.temp)}°</span>}
            </div>
          ))}
        </div>
      )}
    </Tile>
  );
}
// les copains : qui imprime (vignette, avancement), et les autres
function Friends({ f, o, sz }) {
  const p = f?.printing || [];
  const states = f?.states || {};
  const n = Object.keys(states).length;
  if (!f || !n) return null;
  const list = p.slice(0, sz.h > 1 ? 5 : 2);
  return (
    <Tile icon={<Users size={15}/>} color="#14B8A6" label="Copains" badge={<span style={{ fontSize: 11, fontWeight: 800, color: "#0d9488" }}>{p.length}/{n}</span>}
      mini={sz.h === 0.5} summary={<span style={{ fontSize: 13 }}>{p.length ? `${p.map(x => x.name).join(", ")} imprime${p.length > 1 ? "nt" : ""}` : "personne n'imprime"}</span>}>
      {list.length ? list.map(x => (
        <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          {o.thumbs && x.print?.image ? <img data-pk="" src={x.print.image} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
            style={{ width: 30, height: 30, borderRadius: 8, objectFit: "cover", flexShrink: 0, background: "var(--surface2)" }}/>
            : <span data-pk="" style={{ width: 24, height: 24, borderRadius: "50%", background: "#14B8A6", color: "#fff", fontSize: 11, fontWeight: 900,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{(x.name || "?").slice(0, 1).toUpperCase()}</span>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <b data-pk="" style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.name}</b>
              <span data-pk="" style={{ fontSize: 11.5, fontWeight: 800, color: "#0d9488" }}>{Math.round(x.progress || 0)} %</span>
            </div>
            <div style={{ height: 4, borderRadius: 4, background: "var(--surface2)", overflow: "hidden", margin: "2px 0" }}>
              <div data-pk="" style={{ height: "100%", width: `${Math.round(x.progress || 0)}%`, background: "#14B8A6" }}/></div>
            <div style={{ fontSize: 11, color: "var(--muted)", ...clamp(1) }}><W text={x.print?.name || x.print_name || "imprime"}/></div>
          </div>
        </div>
      )) : <Line><W text="Personne n'imprime en ce moment"/></Line>}
      {o.idle && sz.h > 1 && Object.values(states).some(s => s.state !== "printing") && (
        <div style={{ marginTop: "auto", fontSize: 11.5, color: "var(--muted)" }}>
          {Object.values(states).filter(s => s.state === "standby").length} au repos · {Object.values(states).filter(s => s.state === "off").length} éteinte(s)</div>
      )}
    </Tile>
  );
}
// les points MakerWorld : le solde, les gains, et la courbe des derniers jours
function MwPoints({ c, o, sz }) {
  const nav = useNavigate();
  const [hist, setHist] = useState(null);
  useEffect(() => {
    if (!o.chart || !c?.profile) return;
    client.get("/makerworld/creator/points").then(({ data }) => {
      const days = 14, out = Array(days).fill(0), now = Date.now();
      (data?.items || []).forEach(x => {
        const d = Math.floor((now - new Date(x.time).getTime()) / 86400000);
        if (d >= 0 && d < days) out[days - 1 - d] += Number(x.point ?? x.points ?? x.amount ?? 0) || 0;
      });
      setHist(out);
    }).catch(() => setHist(null));
  }, [o.chart, !!c?.profile]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c?.profile) return null;
  const per = o.period || "7";
  const earned = c.earned?.[per] ?? (per === "7" ? c.earned7 : c.earned30);
  const head = c.head?.[per]?.totals;
  return (
    <Tile icon={<Coins size={15}/>} color="#EAB308" label="MakerWorld" onClick={() => nav("/prints?tab=makerworld")}
      mini={sz.h === 0.5} summary={<>{Math.round(c.profile.points?.total || 0)}{earned != null && <span style={{ fontSize: 12, color: "#16a34a" }}>+{Math.round(earned)}</span>}</>}>
      <Row><Big>{Math.round(c.profile.points?.total || 0)}</Big><Unit>points</Unit>
        {earned != null && <span data-pk="" style={{ fontSize: 12, fontWeight: 800, color: "#16a34a" }}>+{Math.round(earned)} en {per} j</span>}</Row>
      {o.chart && hist && <div style={{ marginTop: 6 }}><Spark values={hist} color="#EAB308" height={sz.h > 1 ? 56 : 30}/></div>}
      {o.stats && head && (sz.w > 1 || sz.h > 1) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, marginTop: "auto", paddingTop: 6 }}>
          {[["⬇️", head.downloads, "téléch."], ["🖨️", head.prints, "impr."], ["🚀", head.boosts, "boosts"], ["❤️", head.likes, "j'aime"]].map(([e, n, l]) => (
            <div key={l} data-pk="" style={{ textAlign: "center" }}><div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)" }}>{e} {n ?? 0}</div>
              <div style={{ fontSize: 10, color: "var(--muted)" }}>{l}</div></div>))}
        </div>
      )}
    </Tile>
  );
}
function ToRate({ r, o, sz }) {
  const nav = useNavigate();
  const items = r?.items || [];
  if (!r) return null;
  const list = items.slice(0, sz.h > 1 ? 4 : 0);
  return (
    <Tile icon={<Star size={15}/>} color="#F97316" label="À évaluer" onClick={() => nav("/prints?tab=makerworld")}
      mini={sz.h === 0.5} summary={<span style={{ color: items.length ? "#ea580c" : "var(--text)" }}>{items.length}</span>}>
      <Row><Big color={items.length ? "#ea580c" : "var(--text)"}>{items.length}</Big><Unit>modèle{items.length > 1 ? "s" : ""}</Unit></Row>
      {o.thumbs && items.length > 0 && !list.length && (
        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          {items.slice(0, sz.w > 1 ? 6 : 3).map(x => x.cover_url && <img key={x.design_id} data-pk="" src={mwImg(x.cover_url, 80)} alt=""
            style={{ width: 30, height: 30, borderRadius: 8, objectFit: "cover" }}/>)}
        </div>
      )}
      {list.map(x => (
        <div key={x.design_id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
          {o.thumbs && x.cover_url && <img data-pk="" src={mwImg(x.cover_url, 80)} alt="" style={{ width: 28, height: 28, borderRadius: 7, objectFit: "cover" }}/>}
          <span style={{ fontSize: 12, color: "var(--text2)", ...clamp(1) }}>{x.title || `Modèle ${x.design_id}`}</span>
        </div>
      ))}
      {!items.length && <Sub>Tout est évalué</Sub>}
    </Tile>
  );
}
function Wheel({ a, o, sz = { h: 1 } }) {
  const nav = useNavigate();
  const k = a?.keys;
  if (!k) return null;
  const spins = k.wheel?.spins || 0, tickets = k.wheel?.tickets || 0;
  const cell = (icon, n, l, c) => <div data-pk="" style={{ display: "flex", flexDirection: "column", alignItems: "center", minWidth: 44 }}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 19, fontWeight: 900, color: c }}>{icon}{n}</span>
    <span style={{ fontSize: 10.5, color: "var(--muted)" }}>{l}</span></div>;
  return (
    <Tile icon={<Dices size={15}/>} color="#EC4899" label="Roue et clés" onClick={sz.h === 0.5 ? () => nav("/stats?tab=achievements") : undefined}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 10, fontSize: 14 }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}><Dices size={13}/>{spins}</span>
        {o.keys && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#d97706" }}><Key size={13}/>{k.balance}</span>}
        {o.tickets && <span style={{ display: "inline-flex", alignItems: "center", gap: 3, color: "#db2777" }}><Ticket size={13}/>{tickets}</span>}</span>}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        {cell(<Dices size={15}/>, spins, `tour${spins > 1 ? "s" : ""}`, "var(--text)")}
        {o.keys && cell(<Key size={15}/>, k.balance, `clé${k.balance > 1 ? "s" : ""}`, "#d97706")}
        {o.tickets && cell(<Ticket size={15}/>, tickets, `ticket${tickets > 1 ? "s" : ""}`, "#db2777")}
        <button onClick={e => { e.stopPropagation(); nav("/stats?tab=achievements"); }} data-pk=""
          style={{ marginLeft: "auto", flexShrink: 0, padding: "8px 12px", borderRadius: 10, border: "none", fontWeight: 900, fontSize: 12.5, cursor: "pointer",
            color: "#3b2300", background: spins ? "linear-gradient(135deg, #FDE68A, #F59E0B)" : "var(--surface2)" }}>
          {spins ? "Tourner" : "Voir"}</button>
      </div>
    </Tile>
  );
}
function Ach({ a, o, sz }) {
  const nav = useNavigate();
  const v = a?.score_max ? a.score / a.score_max : 0;
  const g = gradeOf(null, v);
  const nexts = useMemo(() => (a?.items || []).filter(x => x.cat === "cards" && x.level < 0 && x.prog?.[1])
    .sort((x, y) => y.prog[0] / y.prog[1] - x.prog[0] / x.prog[1] || CARD_ORDER.indexOf(x.tiers[0].id) - CARD_ORDER.indexOf(y.tiers[0].id)), [a]);
  const recent = (a?.recent || []).slice(0, sz.h > 1 ? 4 : 1).map(r => ({ r, it: (a.items || []).find(x => x.id === r.id) })).filter(x => x.it);
  if (!a) return null;
  return (
    <Tile icon={<Trophy size={15}/>} color="#D4A017" label="Succès" onClick={() => nav("/stats?tab=achievements")}
      mini={sz.h === 0.5} summary={<><GradeEmblem i={Math.max(0, g.i)} size={20} locked={g.i < 0}/><span style={{ fontSize: 13 }}>{g.name || "—"}</span></>}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {o.grade && <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span data-pk=""><GradeEmblem i={Math.max(0, g.i)} size={34} locked={g.i < 0}/></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: "var(--text)" }}><W text={g.name || "Pas encore de grade"}/></div>
            <Sub lines={1}><W text={`${a.score.toLocaleString("fr-FR")} pts${g.next ? ` · prochain : ${g.next}` : ""}`}/></Sub>
          </div>
        </div>}
        {o.score && <Ring value={v} size={46} color="#D4A017">{Math.round(v * 100)}%</Ring>}
      </div>
      {o.cards && nexts.slice(0, sz.h > 1 ? 3 : 1).map(nx => (
        <div key={nx.id} onClick={e => { e.stopPropagation(); nav(`/stats?tab=achievements&a=${nx.id}`); }}
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span data-pk=""><Medal tier={nx.tiers[0]} emoji={nx.emoji} size={30} locked/></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", ...clamp(1) }}><W text={nx.name}/></div>
            <div style={{ height: 5, borderRadius: 5, background: "var(--surface2)", overflow: "hidden", marginTop: 3 }}>
              <div data-pk="" style={{ height: "100%", width: `${Math.round(100 * nx.prog[0] / nx.prog[1])}%`, background: nx.tiers[0].color }}/></div>
          </div>
          <span data-pk="" style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>{nx.prog[0]}/{nx.prog[1]}</span>
        </div>
      ))}
      {o.recent && recent.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          {recent.map(({ r, it }) => <span key={it.id + r.tier} title={it.name} onClick={e => { e.stopPropagation(); nav(`/stats?tab=achievements&a=${it.id}`); }}>
            <Medal tier={it.tiers[r.tier]} emoji={it.emoji} size={sz.h > 1 ? 36 : 30}/></span>)}
        </div>
      )}
    </Tile>
  );
}
function LiveCam({ status, o }) {
  const on = !!status?.connected;
  const pct = Math.round(status?.progress || 0);
  const live = ["RUNNING", "PAUSE", "PAUSED"].includes(String(status?.status || "").toUpperCase());
  return (
    <Tile icon={<Video size={15}/>} color="#64748B" label="Caméra">
      {on ? (
        <div style={{ position: "relative", borderRadius: 10, overflow: "hidden" }}>
          <LiveCamera mode={o.mode}/>
          {o.overlay && live && <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 10px 6px", color: "#fff",
            background: "linear-gradient(transparent, rgba(0,0,0,0.65))", display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 800 }}>
            <span style={{ flex: 1, height: 5, borderRadius: 5, background: "rgba(255,255,255,0.3)", overflow: "hidden" }}>
              <span style={{ display: "block", height: "100%", width: `${pct}%`, background: "#22c55e" }}/></span>
            {pct}%{status.remaining_minutes ? ` · ${fmtDur(status.remaining_minutes * 60)}` : ""}</div>}
        </div>
      ) : <Line><W text="L'imprimante ne répond pas."/></Line>}
    </Tile>
  );
}
// les temperatures : en jauges (consigne = plein) ou en lignes
function Temps({ status, o, sz }) {
  if (!status?.connected) return null;
  const nz = status.nozzles || [];
  const rows = [
    ...nz.map(n => ({ k: `n${n.id}`, l: nz.length > 1 ? `Buse ${n.id === 1 ? "G" : "D"}` : "Buse", v: n.temp, t: n.target, max: 300, c: "#f97316" })),
    { k: "bed", l: "Plateau", v: status.bed_temp, t: status.target_bed_temp, max: 120, c: "#ef4444" },
    ...(o.chamber && status.chamber_temp > 0 ? [{ k: "ch", l: "Chambre", v: status.chamber_temp, t: status.target_chamber_temp, max: 70, c: "#eab308" }] : []),
  ];
  return (
    <Tile icon={<Thermometer size={15}/>} color="#F97316" label="Températures"
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 8 }}>{rows.map(r => <span key={r.k} title={r.l}
        style={{ color: (r.v || 0) > 40 ? r.c : "var(--text)" }}>{Math.round(r.v || 0)}°</span>)}</span>}>
      {o.style === "gauges" ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "space-around" }}>
          {rows.map(r => <Gauge key={r.k} value={r.v} max={r.t > 0 ? r.t : r.max} color={(r.v || 0) > 40 ? r.c : "#94a3b8"}
            size={sz.w > 1 ? 74 : 58} label={`${Math.round(r.v || 0)}°`} sub={`${r.l}${o.targets && r.t > 0 ? ` / ${Math.round(r.t)}°` : ""}`}/>)}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {rows.map(r => (
            <div key={r.k} style={{ display: "flex", alignItems: "baseline", gap: 6, fontSize: 12 }}>
              <span style={{ flex: 1, color: "var(--text2)", fontWeight: 700 }}>{r.l}</span>
              <span data-pk="" style={{ fontSize: 17, fontWeight: 900, color: (r.v || 0) > 40 ? r.c : "var(--text)" }}>{Math.round(r.v || 0)}°</span>
              {o.targets && r.t > 0 && <span style={{ color: "var(--muted)", fontWeight: 700 }}>/ {Math.round(r.t)}°</span>}
            </div>
          ))}
        </div>
      )}
    </Tile>
  );
}
function Month({ v, o, sz }) {
  const nav = useNavigate();
  const name = new Date().toLocaleDateString("fr-FR", { month: "long" });
  const days = useDays(sz.h > 1 && o.chart ? new Date().getDate() : 0);
  return (
    <Tile icon={<CalendarDays size={15}/>} color="#6366F1" label={`En ${name}`} onClick={() => nav("/stats?tab=prints")}
      mini={sz.h === 0.5} summary={<>{v ? v.count : "…"}{o.compare && v?.prev && <Delta now={v.count} before={v.prev.count}/>}</>}>
      <Row><Big>{v ? v.count : "…"}</Big><Unit>impression{v?.count > 1 ? "s" : ""}</Unit>
        {o.compare && v?.prev && <Delta now={v.count} before={v.prev.count}/>}</Row>
      {v && <Sub><W text={[fmtG(v.weight_g), fmtH(v.duration), o.cost && fmtEur(v.cost)].filter(Boolean).join(" · ")}/></Sub>}
      {o.compare && v?.prev && <div style={{ fontSize: 11, color: "var(--muted)" }}>à la même date le mois dernier : {v.prev.count}</div>}
      {days && days.length > 1 && <div style={{ marginTop: "auto", paddingTop: 6 }}>
        <Bars values={days.map(x => x.count || 0)} color="#6366F1" height={sz.h > 2 ? 90 : 44} hi={days.length - 1}/></div>}
    </Tile>
  );
}
// objets et ventes : un anneau vendus / a vendre, le chiffre et la marge
function Sales({ v, o, sz }) {
  const nav = useNavigate();
  if (!v || !v.total) return null;
  const share = (v.sold || 0) / Math.max(1, (v.sold || 0) + (v.available || 0));
  return (
    <Tile icon={<ShoppingBag size={15}/>} color="#EC4899" label="Objets et ventes" onClick={() => nav("/objects")}
      mini={sz.h === 0.5} summary={<>{v.available}<span style={{ fontSize: 12, color: "var(--muted)" }}>à vendre · {v.sold} vendus</span></>}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {o.ring && <Ring value={share} size={sz.h > 1 ? 64 : 48} color="#EC4899">{v.sold}</Ring>}
        <div style={{ minWidth: 0 }}>
          <Row><Big>{v.available}</Big><Unit>à vendre</Unit></Row>
          <Sub><W text={[`${v.sold} vendu${v.sold > 1 ? "s" : ""}`, o.revenue && `${Math.round(v.revenue || 0)} €`,
            o.margin && `marge ${Math.round(v.margin || 0)} €${v.margin_pct ? ` (${Math.round(v.margin_pct)} %)` : ""}`].filter(Boolean).join(" · ")}/></Sub>
        </div>
      </div>
      {sz.h > 1 && o.potential && <div style={{ marginTop: "auto", fontSize: 11.5, color: "var(--muted)" }}>
        En stock : {fmtEur(v.stock_cost)} de coût · {fmtEur(v.potential_value)} de valeur</div>}
    </Tile>
  );
}
const FEED_SECTIONS = { all: null, prints: ["prints", "printer"], spools: ["spools", "dry"], mw: ["mw"], friends: ["friends"] };
function Feed({ f, o, sz }) {
  const nav = useNavigate();
  if (!f) return null;
  const want = FEED_SECTIONS[o.section || "all"];
  const items = (f.items || []).filter(x => !want || want.includes(x.section)).slice(0, o.count || (sz.h > 2 ? 10 : 6));
  return (
    <Tile icon={<Rss size={15}/>} color="#0EA5E9" label="Le fil du jour" onClick={() => nav("/notifications")}>
      {!items.length ? <Line><W text="Rien de neuf."/></Line> : items.map((x, i) => {
        const sw = String(x.image || "").startsWith("color:") ? x.image.slice(6).split(",")[0] : null;
        return (
          <div key={x.id} onClick={e => { if (x.link) { e.stopPropagation(); nav(x.link); } }}
            style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
            {o.time && <span data-pk="" style={{ width: 38, flexShrink: 0, fontSize: 11, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
              {new Date(x.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>}
            <span data-pk="" style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 12, background: sw ? hexCss(sw) : `${x.section_color || "#64748B"}22` }}>{sw ? "" : x.section_emoji}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, color: "var(--text)", fontWeight: x.seen ? 600 : 800, ...clamp(1) }}><W text={noEmoji(x.title)}/></span>
              {o.detail && sz.w > 1 && <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", ...clamp(1) }}>{String(x.message || "").split("\n")[0]}</span>}
            </span>
            {!x.seen && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#3b82f6", flexShrink: 0 }}/>}
          </div>
        );
      })}
    </Tile>
  );
}
function Gallery({ g, o, sz }) {
  const nav = useNavigate();
  const list = (g || []).filter(p => !o.okOnly || p.status === "SUCCESS" || p.status === "PARTIAL").slice(0, o.count || 8);
  if (!list.length) return null;
  const min = sz.w > 1 ? (sz.h > 1 ? 72 : 56) : 46;
  return (
    <Tile icon={<Images size={15}/>} color="#14B8A6" label="Dernières impressions" onClick={() => nav("/prints?tab=gallery")}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${min}px, 1fr))`, gap: 6 }}>
        {list.map(p => <img key={p.id} data-pk="" src={apiUrl(`/prints/${p.id}/image`)} alt="" title={p.file_name || p.translated_name}
          onClick={e => { e.stopPropagation(); nav(`/prints?id=${p.id}`); }} onError={e => { e.currentTarget.style.visibility = "hidden"; }}
          style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: o.round ? "50%" : 9, background: "var(--surface2)", cursor: "pointer",
            outline: p.status === "SUCCESS" || p.status === "PARTIAL" ? "none" : "2px solid rgba(239,68,68,0.6)" }}/>)}
      </div>
    </Tile>
  );
}
const SHORTCUTS = [["hist", "Historique", "/prints", History], ["fil", "Filaments", "/filaments", Package], ["todo", "À faire", "/prints?tab=queue", ListChecks],
  ["dry", "Séchage", "/stats?tab=drying", Flame], ["notif", "Notifications", "/notifications", BellRing], ["ach", "Succès", "/stats?tab=achievements", Trophy],
  ["obj", "Objets", "/objects", ShoppingBag], ["stats", "Statistiques", "/stats", BarChart3], ["gal", "Galerie", "/prints?tab=gallery", Images]];
function Shortcuts({ o, sz = { h: 1 } }) {
  const nav = useNavigate();
  const list = SHORTCUTS.filter(([k]) => o[`s_${k}`]);
  if (sz.h === 0.5) return (
    <div className="card" style={{ height: "100%", boxSizing: "border-box", padding: "0 10px", display: "flex", alignItems: "center", gap: 6 }}>
      {list.map(([k, l, to, I]) => <button key={k} data-pk="" onClick={() => nav(to)} title={l} style={{ flex: 1, height: 36, borderRadius: 10,
        border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", cursor: "pointer", display: "flex",
        alignItems: "center", justifyContent: "center" }}><I size={17}/></button>)}
    </div>
  );
  return (
    <Tile icon={<Zap size={15}/>} color="#EAB308" label="Raccourcis">
      <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${o.iconsOnly ? 40 : 96}px, 1fr))`, gap: 6 }}>
        {list.map(([k, l, to, I]) => (
          <button key={k} data-pk="" onClick={() => nav(to)} title={l} style={{ display: "flex", alignItems: "center", justifyContent: o.iconsOnly ? "center" : "flex-start",
            gap: 6, padding: o.iconsOnly ? "9px 0" : "8px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)",
            color: "var(--text2)", fontWeight: 700, fontSize: 12, cursor: "pointer", minWidth: 0 }}>
            <I size={o.iconsOnly ? 17 : 14}/>{!o.iconsOnly && <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l}</span>}</button>
        ))}
      </div>
    </Tile>
  );
}
function Podium({ p, o, sz }) {
  const nav = useNavigate();
  const people = (p?.people || []).filter(x => x.status === "ok").sort((a, b) => (b.score || 0) - (a.score || 0));
  if (people.length < 2) return null;
  const max = Math.max(1, people[0].score || 0);
  const list = people.slice(0, sz.h > 1 ? 6 : 3);
  if (o.style === "podium" && list.length >= 2) {
    const order = [list[1], list[0], list[2]].filter(Boolean), hs = { 0: 1, 1: 0.72, 2: 0.52 };
    return (
      <Tile icon={<MedalIcon size={15}/>} color="#A855F7" label="Classement des copains" onClick={() => nav("/stats?tab=achievements")}>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 6, marginTop: "auto", height: sz.h > 1 ? 120 : 76 }}>
          {order.map(x => { const rank = list.indexOf(x); return (
            <div key={x.name} style={{ flex: 1, maxWidth: 90, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <span style={{ fontSize: 11.5, fontWeight: x.me ? 900 : 700, color: "var(--text)", ...clamp(1) }}>{x.me ? "Toi" : x.name}</span>
              <div data-pk="" style={{ width: "100%", height: `${hs[rank] * (sz.h > 1 ? 80 : 46)}px`, borderRadius: "8px 8px 0 0",
                background: ["#D4A017", "#94A3B8", "#B45309"][rank], display: "flex", alignItems: "flex-start", justifyContent: "center",
                color: "#fff", fontWeight: 900, fontSize: 13, paddingTop: 3 }}>{rank + 1}</div>
            </div>); })}
        </div>
      </Tile>
    );
  }
  return (
    <Tile icon={<MedalIcon size={15}/>} color="#A855F7" label="Classement des copains" onClick={() => nav("/stats?tab=achievements")}
      mini={sz.h === 0.5} summary={<span style={{ fontSize: 13 }}>🥇 {list[0].me ? "Toi" : list[0].name} · {(list[0].score || 0).toLocaleString("fr-FR")}</span>}>
      {list.map((x, i) => (
        <div key={x.id || x.name} style={{ marginTop: i ? 5 : 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span data-pk="" style={{ width: 16, fontWeight: 900, color: ["#D4A017", "#94A3B8", "#B45309"][i] || "var(--muted)" }}>{i + 1}</span>
            <span style={{ flex: 1, minWidth: 0, fontWeight: x.me ? 900 : 700, color: "var(--text)", ...clamp(1) }}>{x.me ? "Toi" : x.name}</span>
            <span data-pk="" style={{ fontWeight: 800, color: "var(--text2)" }}>{(x.score || 0).toLocaleString("fr-FR")}</span>
          </div>
          {o.bars && <div style={{ height: 4, borderRadius: 4, background: "var(--surface2)", marginLeft: 24, overflow: "hidden" }}>
            <div data-pk="" style={{ height: "100%", width: `${Math.round(100 * (x.score || 0) / max)}%`, background: x.me ? "#A855F7" : "#C4B5FD" }}/></div>}
        </div>
      ))}
    </Tile>
  );
}
// ouvre les points d'attention de l'accueil (sur une categorie) ; sans la tuile a l'ecran, les reglages
const openAttention = category => {
  if (document.getElementById("att-section")) window.dispatchEvent(new CustomEvent("bn-attention-open", { detail: { category } }));
  else window.location.assign("/settings?tab=display");
};
function Alerts({ a, o, sz }) {
  const cats = (a?.categories || []).filter(c => c.total);
  if (!a) return null;
  const total = cats.reduce((n, c) => n + c.total, 0);
  return (
    <Tile icon={<BellRing size={15}/>} color="#F59E0B" label="Alertes" onClick={() => openAttention()}
      mini={sz.h === 0.5} summary={<span style={{ display: "inline-flex", gap: 6, fontSize: 13 }}>{cats.length ? cats.map(c => <span key={c.category}
        title={c.label}>{c.icon}<b style={{ color: "#b45309" }}>{c.total}</b></span>) : "rien à signaler"}</span>}
      badge={total ? <span style={{ fontSize: 11, fontWeight: 900, color: "#fff", background: "#f59e0b", borderRadius: 20, padding: "1px 7px" }}>{total}</span> : null}>
      {!cats.length ? <Line><W text="Rien à signaler."/></Line> : o.style === "list" || sz.h > 1 ? cats.map(c => (
        <div key={c.category} role="button" onClick={e => { e.stopPropagation(); openAttention(c.category); }}
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, cursor: "pointer" }}>
          <span data-pk="" style={{ fontSize: 15 }}>{c.icon}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{c.label}
            {sz.w > 1 && o.detail && <span style={{ fontWeight: 500, color: "var(--muted)" }}> · {(c.alerts || []).slice(0, 2).map(x => x.title).join(", ")}</span>}</span>
          <span data-pk="" style={{ fontSize: 12, fontWeight: 900, color: "#b45309" }}>{c.total}</span>
        </div>
      )) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {cats.map(c => <span key={c.category} data-pk="" role="button" tabIndex={0} title={c.label}
            onClick={e => { e.stopPropagation(); openAttention(c.category); }}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", cursor: "pointer",
            borderRadius: 20, fontSize: 12, fontWeight: 800, background: "rgba(245,158,11,0.12)", color: "#b45309" }}>
            {c.icon}{o.style !== "icons" && ` ${c.label}`} <b>{c.total}</b></span>)}
        </div>
      )}
    </Tile>
  );
}

// ── Le catalogue ─────────────────────────────────────────────────────────────
// Chaque tuile : ses largeurs (1 = moitie, 2 = toute la colonne) et hauteurs
// (rangees ; la premiere valeur est celle par defaut), ses options (une valeur
// par defaut, un groupe, une explication ; « when » : seulement pour certaines
// tailles). render(donnees, imprimante, options, taille).
const sz = it => ({ w: it?.w || 1, h: typeof it?.h === "number" ? it.h : 1 });   // h : 0,5 (une ligne), 1, 2 ou 3
const B = (key, label, def, extra = {}) => ({ key, label, def, ...extra });
const C = (key, label, def, choices, extra = {}) => ({ key, label, def, choices, ...extra });
export const TILES = {
  today: { label: "Aujourd'hui", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Today v={d.today} o={o} sz={sz(it)}/>,
    options: [B("ring", "Anneau de réussite", true, { hint: "La part des impressions réussies du jour." }), B("yesterday", "Écart avec hier", true),
      B("weight", "Poids imprimé", true), B("hours", "Heures de machine", true), B("cost", "Coût du jour", false)] },
  week: { label: "Derniers jours", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Week o={o} sz={sz(it)}/>,
    options: [C("range", "Période", 7, [[7, "7 jours"], [14, "14 jours"], [30, "30 jours"]]),
      C("metric", "Compter", "h", [["h", "les heures"], ["n", "les impressions"], ["g", "les grammes"]]), B("avg", "Moyenne par jour", true)] },
  next: { label: "À faire", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Next q={d.queue} o={o} sz={sz(it)}/>,
    options: [B("thumbs", "Vignettes", true), B("ready", "Seulement ce qui est prêt", false, { hint: "Les modèles dont les bobines sont dans l'AMS." }),
      B("weight", "Poids", true)] },
  last: { label: "Dernières impressions", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Last p={d.prints} o={o} sz={sz(it)}/>,
    options: [B("when", "Depuis quand", true), B("cost", "Coût", false), B("photo", "Rappel « pas de photo »", true)] },
  stock: { label: "Stock", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Stock s={d.spools} o={o} sz={sz(it)}/>,
    options: [C("style", "Bobines basses", "dots", [["dots", "en pastilles"], ["list", "en liste"]], { hint: "L'anneau d'une pastille montre ce qui reste." }),
      C("low", "Combien", 4, [[2, "2"], [4, "4"], [6, "6"]]), C("sort", "Les plus basses", "g", [["g", "en grammes"], ["pct", "en pourcentage"]]),
      B("kg", "Poids total", true)] },
  dry: { label: "Séchage", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Dry v={d.dry} status={st} o={o} sz={sz(it)}/>,
    options: [B("ring", "Anneau « au sec »", true), B("inams", "Combien sont dans l'AMS", true)] },
  humidity: { label: "Humidité des AMS", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Humidity status={st} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "gauges", [["gauges", "jauges"], ["bars", "barres"]]),
      C("thr", "Seuils", "std", [["strict", "stricts (20/30 %)"], ["std", "normaux (30/40 %)"], ["loose", "souples (40/55 %)"]]),
      B("temp", "Température de l'AMS", false)] },
  friends: { label: "Copains", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Friends f={d.friends} o={o} sz={sz(it)}/>,
    options: [B("thumbs", "Vignette de leur impression", true), B("idle", "Ceux au repos", true)] },
  mw: { label: "MakerWorld", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <MwPoints c={d.mw} o={o} sz={sz(it)}/>,
    options: [C("period", "Gains sur", "7", [["7", "7 jours"], ["30", "30 jours"], ["365", "un an"]]), B("chart", "Courbe des points (14 j)", true),
      B("stats", "Téléchargements, impressions, boosts, j'aime", true, { hint: "Quand la tuile a la place." })] },
  rate: { label: "À évaluer", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <ToRate r={d.rate} o={o} sz={sz(it)}/>,
    options: [B("thumbs", "Vignettes", true)] },
  wheel: { label: "Roue et clés", w: [1, 2], h: [1, 0.5], render: (d, st, o, it) => <Wheel a={d.ach} o={o} sz={sz(it)}/>,
    options: [B("keys", "Clés", true), B("tickets", "Tickets de palier", true)] },
  ach: { label: "Succès", w: [2, 1], h: [1, 2, 0.5], render: (d, st, o, it) => <Ach a={d.ach} o={o} sz={sz(it)}/>,
    options: [B("grade", "Grade de maker", true), B("score", "Anneau du score", false), B("cards", "Prochaines cartes", true), B("recent", "Dernières médailles", true)] },
  // au choix (dans « Ajouter »)
  camera: { label: "Caméra", w: [2, 1], h: [2, 1, 3], render: (d, st, o) => <LiveCam status={st} o={o}/>,
    options: [C("mode", "Image", "auto", [["auto", "auto"], ["stream", "direct"], ["images", "toutes les 2 s"]],
      { hint: "Auto : le direct, et des images si le direct se fige." }), B("overlay", "Avancement sur l'image", true)] },
  temps: { label: "Températures", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Temps status={st} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "gauges", [["gauges", "jauges"], ["list", "lignes"]]), B("targets", "Consignes", true), B("chamber", "Chambre", true)] },
  month: { label: "Ce mois-ci", w: [1, 2], h: [1, 2, 3, 0.5], render: (d, st, o, it) => <Month v={d.month} o={o} sz={sz(it)}/>,
    options: [B("compare", "Comparer au mois dernier", true), B("cost", "Coût", true), B("chart", "Barres par jour", true, { hint: "Quand la tuile a la place." })] },
  sales: { label: "Objets et ventes", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Sales v={d.sales} o={o} sz={sz(it)}/>,
    options: [B("ring", "Anneau vendus / à vendre", true), B("revenue", "Chiffre d'affaires", true), B("margin", "Marge", true),
      B("potential", "Valeur du stock", true, { hint: "Quand la tuile a la place." })] },
  feed: { label: "Le fil du jour", w: [2, 1], h: [2, 3, 1], render: (d, st, o, it) => <Feed f={d.feed} o={o} sz={sz(it)}/>,
    options: [C("count", "Lignes", 6, [[4, "4"], [6, "6"], [10, "10"]]),
      C("section", "Montrer", "all", [["all", "tout"], ["prints", "impressions"], ["spools", "bobines et séchage"], ["mw", "MakerWorld"], ["friends", "copains"]]),
      B("time", "Heure", true), B("detail", "Détail (en pleine largeur)", true)] },
  gallery: { label: "Galerie", w: [2, 1], h: [1, 2], render: (d, st, o, it) => <Gallery g={d.prints} o={o} sz={sz(it)}/>,
    options: [C("count", "Vignettes", 8, [[4, "4"], [8, "8"], [12, "12"], [16, "16"]]), B("okOnly", "Seulement les réussies", false),
      B("round", "Vignettes rondes", false)] },
  shortcuts: { label: "Raccourcis", w: [2, 1], h: [1, 0.5], render: (d, st, o, it) => <Shortcuts o={o} sz={sz(it)}/>,
    options: [B("iconsOnly", "Icônes seules", false, { hint: "Plus compact, le nom au survol." }),
      ...SHORTCUTS.map(([k, l], i) => B(`s_${k}`, l, i < 6, { group: "Raccourcis affichés" }))] },
  podium: { label: "Classement des copains", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Podium p={d.podium} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "list", [["list", "liste"], ["podium", "podium"]]), B("bars", "Barres de score", true)] },
  alerts: { label: "Alertes en bref", w: [1, 2], h: [1, 2, 0.5], render: (d, st, o, it) => <Alerts a={d.attention} o={o} sz={sz(it)}/>,
    options: [C("style", "Affichage", "chips", [["chips", "pastilles"], ["icons", "icônes"], ["list", "liste"]]),
      B("detail", "Exemples (en liste, pleine largeur)", true)] },
};
