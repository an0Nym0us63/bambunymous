import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, CameraOff, Clock, Layers, Thermometer, Droplets, WifiOff, ChevronRight, ChevronDown,
         CalendarClock, Flame, Users, ListChecks, Trophy, AlertTriangle, Moon, Sun } from "lucide-react";
import client, { apiUrl } from "../../api/client";
import { usePrinter } from "../../store/printer";
import { useAuth } from "../../store/auth";
import { Medal, gradeOf, GradeEmblem, CARD_ORDER } from "../Achievements";

// Briques communes des accueils de test (/accueil1, /accueil2), 22/10/2026.
// Prevu pour les farces : chaque tuile est une « .card » (les farces les
// prennent une a une), et ses morceaux (mots des titres, pastilles, chiffres,
// icones) portent data-pk : ils bougent chacun de leur cote.

export const LIVE = ["RUNNING", "PAUSE", "PAUSED", "PREPARE", "SLICING"];
const ymd = d => d.toLocaleDateString("sv");                    // AAAA-MM-JJ, heure locale

// Un texte decoupe en mots (chacun peut s'envoler)
export function Words({ text, style }) {
  const parts = String(text ?? "").split(/(\s+)/);
  return <span style={style}>{parts.map((p, i) => /\s/.test(p) || !p ? p : <span key={i} data-pk="">{p}</span>)}</span>;
}

export const hexCss = h => {
  const s = String(h || "").replace("#", "");
  return s.length >= 6 ? `#${s.slice(0, 6)}` : "#888";
};
export const fmtDur = mins => {
  if (mins == null || mins < 0) return "";
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
};
const fmtHours = s => {
  const h = (s || 0) / 3600;
  return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1).replace(".", ",")} h`;
};
const fmtG = g => (g || 0) >= 1000 ? `${((g || 0) / 1000).toFixed(1).replace(".", ",")} kg` : `${Math.round(g || 0)} g`;
const at = mins => {
  const d = new Date(Date.now() + mins * 60000);
  const same = d.toDateString() === new Date().toDateString();
  const hm = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return same ? hm : `${d.toLocaleDateString("fr-FR", { weekday: "short" })} ${hm}`;
};
const AMS_LABEL = id => id >= 128 ? `HT-${String.fromCharCode(65 + id - 128)}` : id === 255 || id === 254 ? "Externe" : `AMS-${String.fromCharCode(65 + id)}`;

// ── Donnees ──────────────────────────────────────────────────────────────────
export function useHomeData() {
  const { status, startPolling, stopPolling } = usePrinter();
  const [d, setD] = useState({});
  const job = status?.job_id || status?.print_name || "";
  useEffect(() => {
    startPolling(3000);
    return () => stopPolling();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let dead = false;
    const put = (k, p) => p.then(r => { if (!dead) setD(x => ({ ...x, [k]: r.data })); }).catch(() => {});
    const now = new Date(), monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const often = () => {
      put("attention", client.get("/attention"));
      put("friends", client.get("/friends/shared/printing"));
      put("feed", client.get("/notify/me/history"));
      put("today", client.get("/prints/kpis", { params: { date_from: ymd(now) } }));
      put("week", client.get("/prints/kpis", { params: { date_from: ymd(monday) } }));
    };
    often();
    put("queue", client.get("/makerworld/queue"));
    put("ach", client.get("/achievements"));
    const t = setInterval(often, 60000);
    return () => { dead = true; clearInterval(t); };
  }, []);
  // l'impression en cours (ou la derniere) : vignette et nom
  useEffect(() => {
    client.get("/prints", { params: { limit: 1 } })
      .then(({ data }) => setD(x => ({ ...x, last: (data.prints || data.items || [])[0] || null }))).catch(() => {});
  }, [job]);
  return { status, ...d };
}

// ── Bonjour ──────────────────────────────────────────────────────────────────
export function greetingLine(status, today) {
  const st = String(status?.status || "").toUpperCase();
  const bits = [];
  if (!status?.connected && status) bits.push("l'imprimante ne répond pas");
  else if (LIVE.includes(st)) bits.push(`${status.print_name || "une impression"} tourne, fin vers ${at(status.remaining_minutes || 0)}`);
  else if (status) bits.push("l'imprimante est au repos");
  if (today?.count) bits.push(`${today.count} impression${today.count > 1 ? "s" : ""} aujourd'hui`);
  return bits.join(" · ");
}
export function Greeting({ status, today, compact = false }) {
  const username = useAuth(s => s.username) || "";
  const h = new Date().getHours();
  const hello = h >= 18 || h < 5 ? "Bonsoir" : "Bonjour";
  const name = username ? username.charAt(0).toUpperCase() + username.slice(1) : "";
  const date = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="card" style={{ padding: compact ? "14px 16px" : "18px 20px", display: "flex", alignItems: "center", gap: 14 }}>
      <span data-pk="" aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 14, flexShrink: 0, display: "flex",
        alignItems: "center", justifyContent: "center", background: "rgba(245,183,0,0.14)", color: "#F5B700" }}>
        {h >= 18 || h < 5 ? <Moon size={22}/> : <Sun size={22}/>}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: compact ? 19 : 23, fontWeight: 800, color: "var(--text)", lineHeight: 1.15 }}>
          <Words text={`${hello}${name ? " " + name : ""}`}/></div>
        <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 3, textTransform: "capitalize" }}><Words text={date}/></div>
        <div style={{ fontSize: 13, color: "var(--text2)", marginTop: 5, lineHeight: 1.4 }}><Words text={greetingLine(status, today)}/></div>
      </div>
    </div>
  );
}

// ── L'imprimante ─────────────────────────────────────────────────────────────
function Ring({ value, size = 92, color = "#22c55e" }) {
  const R = 40, C = 2 * Math.PI * R, v = Math.max(0, Math.min(100, value || 0));
  return (
    <span data-pk="" style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "inline-flex" }}>
      <svg width={size} height={size} viewBox="0 0 92 92" style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle cx="46" cy="46" r={R} fill="none" stroke="var(--surface2)" strokeWidth="8"/>
        <circle cx="46" cy="46" r={R} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - v / 100)} style={{ transition: "stroke-dashoffset .6s" }}/>
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.22, fontWeight: 900, color: "var(--text)" }}>{Math.round(v)}%</span>
    </span>
  );
}
function Chip({ icon, children, tone }) {
  return (
    <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 20,
      fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", color: tone || "var(--text2)", background: "var(--surface2)",
      border: "1px solid var(--border)" }}>{icon}{children}</span>
  );
}
function activeTray(status) {
  const a = (status?.ams_list || []).find(x => x.id === status?.active_ams_id);
  return a ? (a.trays || []).find(t => t.id === status?.active_tray_id) : null;
}
function LiveCamera() {
  const ref = useRef(null);
  useEffect(() => {
    let busy = false;
    const tick = () => { if (!busy && ref.current) { busy = true; ref.current.src = apiUrl(`/camera/snapshot?t=${Date.now()}`); } };
    const img = ref.current;
    const done = () => { busy = false; };
    img?.addEventListener("load", done); img?.addEventListener("error", done);
    tick();
    const t = setInterval(tick, 1500);
    return () => { clearInterval(t); img?.removeEventListener("load", done); img?.removeEventListener("error", done); };
  }, []);
  return <img ref={ref} alt="Caméra de l'imprimante" style={{ width: "100%", aspectRatio: "16/9", objectFit: "cover", borderRadius: 12,
    background: "#000", display: "block" }}/>;
}
export function PrinterHero({ status, last, compact = false }) {
  const [cam, setCam] = useState(false);
  const nav = useNavigate();
  const st = String(status?.status || "").toUpperCase();
  const live = LIVE.includes(st), paused = st === "PAUSE" || st === "PAUSED";
  const off = status && !status.connected;
  const tray = activeTray(status);
  const nozzle = (status?.nozzles || []).find(n => n.active) || (status?.nozzles || [])[0];
  const color = off ? "#ef4444" : paused ? "#f59e0b" : live ? "#22c55e" : "#94a3b8";
  const label = !status ? "Connexion…" : off ? "Injoignable" : paused ? "En pause" : live ? "En cours" :
    st === "FINISH" ? "Terminée" : st === "FAILED" ? "Échouée" : "Au repos";
  const name = live ? status.print_name || last?.translated_name || last?.file_name : last?.translated_name || last?.task_name || last?.file_name;
  return (
    <div className="card" style={{ padding: compact ? 14 : 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span data-pk="" style={{ width: 9, height: 9, borderRadius: "50%", background: color, boxShadow: `0 0 0 4px ${color}33` }}/>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color }}><Words text={label}/></span>
        <span style={{ flex: 1 }}/>
        {status?.connected && (
          <button onClick={() => setCam(c => !c)} aria-label={cam ? "Masquer la caméra" : "Voir la caméra"}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 10, cursor: "pointer",
              border: "1px solid var(--border)", background: cam ? "rgba(59,130,246,0.12)" : "var(--surface2)",
              color: cam ? "#3b82f6" : "var(--text2)", fontSize: 12, fontWeight: 700 }}>
            {cam ? <CameraOff size={14}/> : <Camera size={14}/>}{cam ? "Masquer" : "Caméra"}</button>
        )}
      </div>
      {cam && <LiveCamera/>}
      {off ? (
        <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--text2)", fontSize: 13.5 }}>
          <WifiOff size={26} style={{ color: "#ef4444" }}/>
          <Words text="Plus de nouvelles de l'imprimante : éteinte, ou Wi-Fi coupé ?"/>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {last?.id ? <img data-pk="" src={apiUrl(`/prints/${last.id}/image`)} alt="" onClick={() => nav("/prints")}
              onError={e => { e.currentTarget.style.display = "none"; }}
              style={{ width: compact ? 64 : 84, height: compact ? 64 : 84, borderRadius: 14, objectFit: "cover", flexShrink: 0,
                background: "var(--surface2)", cursor: "pointer" }}/>
            : <span style={{ width: compact ? 64 : 84, height: compact ? 64 : 84, borderRadius: 14, background: "var(--surface2)", flexShrink: 0 }}/>}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ fontSize: compact ? 16 : 18, fontWeight: 800, color: "var(--text)", lineHeight: 1.2,
              overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
              <Words text={name || (live ? "Impression" : "Rien en cours")}/></div>
            {live ? <>
              <div style={{ fontSize: 13, color: "var(--text2)" }}>
                <Words text={`Fin vers ${at(status.remaining_minutes || 0)} · encore ${fmtDur(status.remaining_minutes)}`}/></div>
              {status.total_layers > 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>
                <Words text={`Couche ${status.layer} sur ${status.total_layers}`}/></div>}
            </> : <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
              <Words text={last ? "Dernière impression" : "Prête à imprimer"}/></div>}
          </div>
          {live && <Ring value={status.progress} size={compact ? 72 : 92} color={color}/>}
        </div>
      )}
      {!off && status && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {tray && live && <Chip icon={<span style={{ width: 11, height: 11, borderRadius: "50%", background: hexCss(tray.color),
            border: "1px solid var(--border)" }}/>}>{tray.spool_info?.translated_name || tray.spool_info?.name || tray.filament_type}</Chip>}
          {nozzle && <Chip icon={<Flame size={12}/>}>Buse {Math.round(nozzle.temp || 0)}°</Chip>}
          <Chip icon={<Thermometer size={12}/>}>Plateau {Math.round(status.bed_temp || 0)}°</Chip>
          {status.chamber_temp > 0 && <Chip icon={<Thermometer size={12}/>}>Chambre {Math.round(status.chamber_temp)}°</Chip>}
          {(status.hms_errors || []).length > 0 && <Chip icon={<AlertTriangle size={12}/>} tone="#ef4444">
            {status.hms_errors.length} alerte{status.hms_errors.length > 1 ? "s" : ""}</Chip>}
        </div>
      )}
    </div>
  );
}

// ── Les AMS, en pastilles ────────────────────────────────────────────────────
export function AmsStrip({ status, onDetail, open }) {
  const list = (status?.ams_list || []).filter(a => (a.trays || []).length);
  if (!list.length) return null;
  const live = LIVE.includes(String(status?.status || "").toUpperCase());
  return (
    <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
          <Words text="Bobines chargées"/></span>
        <span style={{ flex: 1 }}/>
        {onDetail && <button onClick={onDetail} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "none",
          border: "none", color: "var(--text2)", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
          {open ? "Replier" : "Détails"}{open ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}</button>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
        {list.map(a => (
          <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px", borderRadius: 12,
            background: "var(--surface2)", border: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)", fontWeight: 700 }}>
              <span data-pk="" style={{ color: "var(--text2)" }}>{AMS_LABEL(a.id)}</span>
              <span style={{ flex: 1 }}/>
              {a.humidity > 0 && <span data-pk="" style={{ display: "inline-flex", alignItems: "center", gap: 2 }}><Droplets size={11}/>{a.humidity}%</span>}
              {a.is_drying && <span data-pk="" style={{ color: "#f59e0b" }}>séchage</span>}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
              {a.trays.map(t => {
                const on = live && a.id === status.active_ams_id && t.id === status.active_tray_id;
                const empty = t.empty || !(t.filament_type || "").trim();
                const rest = t.spool_info?.remaining_weight_g;
                return (
                  <span key={t.id} title={empty ? "Vide" : `${t.spool_info?.translated_name || t.spool_info?.name || t.filament_type}${rest != null ? ` · ${Math.round(rest)} g` : ""}`}
                    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <span data-pk="" style={{ width: 24, height: 24, borderRadius: "50%", boxSizing: "border-box",
                      background: empty ? "transparent" : hexCss(t.color), border: empty ? "1.5px dashed var(--border)" : "1px solid rgba(0,0,0,0.18)",
                      boxShadow: on ? "0 0 0 2px var(--surface), 0 0 0 4px #22c55e" : "none" }}/>
                    <span data-pk="" style={{ fontSize: 10, color: "var(--muted)", fontWeight: 700 }}>{empty ? "—" : t.filament_type}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Tuiles ───────────────────────────────────────────────────────────────────
export function Tile({ icon, label, value, sub, tone = "var(--text)", onClick, span = 1, children }) {
  return (
    <div className="card" role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      onKeyDown={e => { if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}
      style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0, gridColumn: span > 1 ? `span ${span}` : undefined,
        cursor: onClick ? "pointer" : "default" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 800, color: "var(--muted)",
        letterSpacing: ".04em" }}>
        <span data-pk="" style={{ display: "inline-flex" }}>{icon}</span><Words text={label}/>
        {onClick && <ChevronRight size={13} style={{ marginLeft: "auto" }}/>}
      </div>
      {value != null && <div data-pk="" style={{ fontSize: 22, fontWeight: 900, color: tone, lineHeight: 1.1 }}>{value}</div>}
      {sub && <div style={{ fontSize: 12, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        <Words text={sub}/></div>}
      {children}
    </div>
  );
}
export function StatTiles({ today, week }) {
  return <>
    <Tile icon={<CalendarClock size={14}/>} label="Aujourd'hui" value={today ? `${today.count}` : "…"}
      sub={today ? `${fmtG(today.weight_g)} · ${fmtHours(today.duration)} de machine` : ""}/>
    <Tile icon={<Clock size={14}/>} label="Cette semaine" value={week ? fmtHours(week.duration) : "…"}
      sub={week ? `${week.count} impression${week.count > 1 ? "s" : ""} · ${fmtG(week.weight_g)}` : ""}/>
  </>;
}
// les points d'attention, chacun sa tuile (les plus fournis d'abord)
export function AlertTiles({ attention, max = 2, onOpen }) {
  const cats = [...(attention?.categories || [])].sort((a, b) => (b.total || 0) - (a.total || 0)).slice(0, max);
  return cats.map(c => (
    <Tile key={c.category} icon={<span style={{ fontSize: 13 }}>{c.icon}</span>} label={c.label} value={c.total}
      tone="#f59e0b" sub={(c.alerts || []).map(a => a.title).slice(0, 2).join(", ")} onClick={onOpen}/>
  ));
}
export function QueueTile({ queue }) {
  const nav = useNavigate();
  const models = queue?.models || [];
  const ready = models.filter(m => m.status === "ready" || (m.plates_ready || 0) > 0);
  const next = ready[0] || models[0];
  return <Tile icon={<ListChecks size={14}/>} label="À faire" value={queue ? models.length : "…"}
    sub={next ? `${ready.length ? `${ready.length} prêt${ready.length > 1 ? "s" : ""} · ` : ""}${next.title_fr || next.title}` : queue ? "Rien en attente" : ""}
    onClick={() => nav("/prints?tab=queue")}/>;
}
export function FriendsTile({ friends }) {
  const p = friends?.printing || [];
  const n = Object.keys(friends?.states || {}).length;
  if (!friends || !n) return null;
  return <Tile icon={<Users size={14}/>} label="Copains" value={p.length ? `${p.length}/${n}` : "0"}
    sub={p.length ? `${p.map(x => x.name).join(", ")} imprime${p.length > 1 ? "nt" : ""}` : "Personne n'imprime"}/>;
}
// Succes : grade de maker et prochaine carte
export function AchievementTile({ ach, span = 1 }) {
  const nav = useNavigate();
  const v = ach?.score_max ? ach.score / ach.score_max : 0;
  const g = gradeOf(null, v);
  const next = useMemo(() => (ach?.items || []).filter(x => x.cat === "cards" && x.level < 0 && x.prog?.[1])
    .sort((a, b) => b.prog[0] / b.prog[1] - a.prog[0] / a.prog[1]
      || CARD_ORDER.indexOf(a.tiers[0].id) - CARD_ORDER.indexOf(b.tiers[0].id))[0], [ach]);
  if (!ach) return <Tile icon={<Trophy size={14}/>} label="Succès" value="…" span={span}/>;
  return (
    <Tile icon={<Trophy size={14}/>} label="Succès" span={span} onClick={() => nav("/stats?tab=achievements")}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
        <span data-pk=""><GradeEmblem i={Math.max(0, g.i)} size={34} locked={g.i < 0}/></span>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}><Words text={g.name || "Pas encore de grade"}/></div>
          <div style={{ fontSize: 12, color: "var(--text2)" }}>
            <Words text={`${ach.score.toLocaleString("fr-FR")} pts${g.next ? ` · prochain : ${g.next}` : ""}`}/></div>
        </div>
      </div>
      {next && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <span data-pk=""><Medal tier={next.tiers[0]} emoji={next.emoji} size={30} locked/></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <Words text={`Prochaine carte : ${next.name}`}/></div>
            <div style={{ height: 5, borderRadius: 5, background: "var(--surface2)", overflow: "hidden", marginTop: 4 }}>
              <div data-pk="" style={{ height: "100%", width: `${Math.round(100 * next.prog[0] / next.prog[1])}%`,
                background: next.tiers[0].color, borderRadius: 5 }}/></div>
          </div>
          <span data-pk="" style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>{next.prog[0]}/{next.prog[1]}</span>
        </div>
      )}
    </Tile>
  );
}

// ── Le fil du jour ───────────────────────────────────────────────────────────
export function Timeline({ feed, max = 8, title = "Le fil du jour" }) {
  const nav = useNavigate();
  const items = (feed?.items || []).slice(0, max);
  const day = t => new Date(t).toDateString();
  const today = new Date().toDateString();
  return (
    <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)" }}>
          <Words text={title}/></span>
        <span style={{ flex: 1 }}/>
        <button onClick={() => nav("/notifications")} style={{ background: "none", border: "none", color: "var(--text2)", fontSize: 12,
          fontWeight: 700, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}>Tout voir<ChevronRight size={14}/></button>
      </div>
      {!feed && <div style={{ fontSize: 13, color: "var(--muted)" }}>…</div>}
      {feed && !items.length && <div style={{ fontSize: 13, color: "var(--muted)" }}><Words text="Rien de neuf pour l'instant."/></div>}
      {items.map((x, i) => {
        const sw = String(x.image || "").startsWith("color:") ? x.image.slice(6).split(",")[0] : null;
        const newDay = i > 0 && day(items[i - 1].time) !== day(x.time);
        return (
          <React.Fragment key={x.id}>
            {(i === 0 ? day(x.time) !== today : newDay) && (
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", textTransform: "capitalize", margin: "6px 0 2px" }}>
                {day(x.time) === today ? "Aujourd'hui" : new Date(x.time).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "short" })}</div>
            )}
            <div onClick={() => x.link && nav(x.link)} style={{ display: "flex", gap: 10, padding: "7px 0", cursor: x.link ? "pointer" : "default",
              borderTop: i && !newDay ? "1px solid var(--border)" : "none" }}>
              <span data-pk="" style={{ width: 42, flexShrink: 0, fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums", paddingTop: 2 }}>
                {new Date(x.time).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
              <span data-pk="" style={{ width: 28, height: 28, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 14, background: sw ? hexCss(sw) : `${x.section_color || "#64748B"}22`,
                border: sw ? "1px solid rgba(0,0,0,0.15)" : "none" }}>{sw ? "" : x.section_emoji}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden",
                  textOverflow: "ellipsis", whiteSpace: "nowrap" }}><Words text={String(x.title || "").replace(/^\p{Extended_Pictographic}️?\s*/u, "")}/></span>
                <span style={{ display: "block", fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis",
                  whiteSpace: "nowrap" }}><Words text={String(x.message || "").split("\n")[0]}/></span>
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
