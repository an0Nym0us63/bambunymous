import React, { useEffect, useMemo, useState } from "react";
import client, { apiUrl, apiThumb } from "../api/client";
import { FSheet } from "./FicheKit";
import { egg } from "../eggs";

// (13/11/2026) La carte d'identite du reglage d'une impression : tout ce que Bambu Studio a regle dans son 3MF, en
// clair et illustre. En haut, la carte (couches, parois, remplissage, supports, adherence, plateau, buses, chiffres) ;
// puis les buses cote a cote (une colonne par buse : une seule sur une X1/P1/A1, gauche et droite sur une H2D/H2C),
// chaque filament et tous ses reglages, les objets du plateau, les familles de reglages, et la liste complete,
// cherchable. « Modifié » : different du profil systeme (Bambu Studio le note dans le 3MF).
const C = "#6366F1", CH = "#F59E0B";
const LS = "bn-slice-open";
const readOpen = () => { try { return JSON.parse(localStorage.getItem(LS) || "{}") || {}; } catch { return {}; } };

// ── Les dessins ─────────────────────────────────────────────────────────────────────────────────────────────────────
function Frame({ children, size = 54, c = C }) {
  return <svg width={size} height={size} viewBox="0 0 60 60" style={{ flexShrink: 0, display: "block" }} aria-hidden="true">
    <rect x="1" y="1" width="58" height="58" rx="14" fill={`${c}14`} stroke={`${c}55`}/>
    <g stroke={c} fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</g>
  </svg>;
}
const clipId = () => `cl${Math.random().toString(36).slice(2, 8)}`;
// le motif de remplissage, dessine
export function PatternArt({ p, size = 54, c = C }) {
  const id = useMemo(clipId, []);
  const k = String(p || "").toLowerCase();
  const lines = (angles, step = 8) => angles.flatMap(a => { const out = [], r = a * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
    for (let o = -48; o <= 48; o += step) out.push(<line key={`${a}${o}`} x1={30 + o * -sn - 50 * cs} y1={30 + o * cs - 50 * sn} x2={30 + o * -sn + 50 * cs} y2={30 + o * cs + 50 * sn}/>);
    return out; });
  let body;
  if (k === "gyroid") body = [0, 1, 2, 3, 4, 5].map(i => <path key={i} d={`M 4 ${8 + i * 9} q 6 -7 12 0 t 12 0 t 12 0 t 12 0 t 12 0`}/>)
    .concat([0, 1, 2, 3, 4, 5].map(i => <path key={`v${i}`} opacity=".45" d={`M ${8 + i * 9} 4 q -7 6 0 12 t 0 12 t 0 12 t 0 12 t 0 12`}/>));
  else if (/honeycomb/.test(k)) { const hs = []; for (let r = 0; r < 5; r++) for (let q = 0; q < 5; q++) { const x = 6 + q * 13 + (r % 2) * 6.5, y = 6 + r * 11;
    hs.push(<path key={`${r}${q}`} d={`M ${x} ${y - 7} l 6 3.5 v 7 l -6 3.5 l -6 -3.5 v -7 z`}/>); } body = hs; }
  else if (k === "grid" || k === "rectilinear-grid") body = lines([45, -45], 10);
  else if (/cubic|triangles|tri-hexagon|lattice|crosshatch/.test(k)) body = lines([0, 60, 120], 11);
  else if (k === "concentric") body = [0, 1, 2, 3, 4].map(i => <rect key={i} x={6 + i * 5} y={6 + i * 5} width={48 - i * 10} height={48 - i * 10} rx="3"/>);
  else if (k === "lightning") body = [<path key="a" d="M 30 56 L 30 38 L 18 24 L 12 6 M 30 38 L 42 22 L 48 6 M 18 24 L 26 10 M 42 22 L 34 8"/>];
  else if (/hilbert|spiral|archimedean/.test(k)) body = [<path key="h" d="M 8 52 V 8 H 52 V 52 H 16 V 16 H 44 V 44 H 24 V 24 H 36 V 36 H 30"/>];
  else if (/zag/.test(k)) body = [0, 1, 2, 3, 4, 5].map(i => <polyline key={i} points={`4,${8 + i * 9} 14,${3 + i * 9} 24,${8 + i * 9} 34,${3 + i * 9} 44,${8 + i * 9} 54,${3 + i * 9}`}/>);
  else body = lines([45], 7);
  return <svg width={size} height={size} viewBox="0 0 60 60" style={{ flexShrink: 0, display: "block" }} aria-hidden="true">
    <defs><clipPath id={id}><rect x="3" y="3" width="54" height="54" rx="12"/></clipPath></defs>
    <rect x="1" y="1" width="58" height="58" rx="14" fill={`${c}14`} stroke={`${c}55`}/>
    <g clipPath={`url(#${id})`} stroke={c} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{body}</g>
  </svg>;
}
function LayersArt({ h = 0.2, first = 0.2 }) {
  const px = v => Math.max(2.5, Math.min(11, (Number(v) || 0.2) * 32));
  const bars = []; let y = 52; const f = px(first), l = px(h);
  bars.push(<rect key="f" x="10" y={y - f} width="40" height={f} rx="1.5" fill={C} stroke="none"/>); y -= f + 1.5;
  for (let i = 0; y - l > 8 && i < 9; i++) { bars.push(<rect key={i} x={12 + i * 0.6} y={y - l} width={36 - i * 1.2} height={l} rx="1.5" fill={C} opacity={0.75 - i * 0.06} stroke="none"/>); y -= l + 1.5; }
  return <Frame>{bars}</Frame>;
}
function WallsArt({ n = 2 }) {
  const k = Math.max(1, Math.min(6, Number(n) || 1));
  return <Frame>{Array.from({ length: k }, (_, i) => <rect key={i} x={7 + i * 3.6} y={7 + i * 3.6} width={46 - i * 7.2} height={46 - i * 7.2} rx={9 - i} strokeWidth="2.2"/>)}
    <g opacity=".35" strokeWidth="1.2">{[0, 1, 2].map(i => <line key={i} x1={20 + i * 7} y1={7 + k * 3.6 + 3} x2={20 + i * 7} y2={53 - k * 3.6 - 3}/>)}</g></Frame>;
}
function SupportArt({ type }) {
  const t = String(type || "");
  return <Frame c={t ? "#16A34A" : "#94A3B8"}>
    <path d="M 10 22 H 50 V 30 H 30 V 40" strokeWidth="2.4"/>
    {!t && <><line x1="14" y1="34" x2="24" y2="44"/><line x1="24" y1="34" x2="14" y2="44"/></>}
    {/tree/.test(t) && <path d="M 38 52 V 42 L 32 31 M 38 42 L 46 31 M 38 46 L 42 38"/>}
    {/normal/.test(t) && <g strokeWidth="1.6">{[36, 41, 46].map(x => <line key={x} x1={x} y1="31" x2={x} y2="52"/>)}</g>}
    <line x1="6" y1="53" x2="54" y2="53" strokeWidth="1.4"/>
  </Frame>;
}
function BrimArt({ brim }) {
  const on = brim && brim !== "no_brim";
  return <Frame c={on ? "#0EA5E9" : "#94A3B8"}>
    <rect x="20" y="20" width="20" height="20" rx="3" fill="#0EA5E933"/>
    {on && [0, 1, 2].map(i => <rect key={i} x={15 - i * 4} y={15 - i * 4} width={30 + i * 8} height={30 + i * 8} rx={6 + i * 2} strokeWidth="1.3" opacity={1 - i * 0.25}/>)}
  </Frame>;
}
function NozzleArt({ d, used = true, c = C }) {
  const col = used ? c : "#94A3B8";
  return <Frame c={col}>
    <rect x="18" y="8" width="24" height="18" rx="3"/><path d="M 22 26 H 38 L 33 40 H 27 Z" fill={`${col}33`}/>
    <line x1="30" y1="40" x2="30" y2="46"/><circle cx="30" cy="50" r="2.4" fill={col} stroke="none"/>
    {d != null && <text x="30" y="20" textAnchor="middle" fontSize="9" fontWeight="900" fill={col} stroke="none">{String(d).replace(".", ",")}</text>}
  </Frame>;
}
function SpoolArt({ color = "#94A3B8", size = 46 }) {
  return <svg width={size} height={size} viewBox="0 0 60 60" style={{ flexShrink: 0 }} aria-hidden="true">
    <circle cx="30" cy="30" r="27" fill={color} stroke="rgba(0,0,0,.18)"/>
    {[21, 16].map(r => <circle key={r} cx="30" cy="30" r={r} fill="none" stroke="rgba(0,0,0,.16)" strokeWidth="1.2"/>)}
    <circle cx="30" cy="30" r="9" fill="var(--surface)" stroke="rgba(0,0,0,.2)"/><circle cx="30" cy="30" r="3.5" fill="rgba(0,0,0,.25)"/>
  </svg>;
}
function PlateArt({ bed }) {
  const b = String(bed || "").toLowerCase(), tex = /textured|pei/.test(b), col = /supertack/.test(b) ? "#64748B" : /cool/.test(b) ? "#3B82F6" : /engineering/.test(b) ? "#A16207" : "#B45309";
  return <Frame c={col}><rect x="7" y="20" width="46" height="22" rx="4" fill={`${col}26`}/>
    {tex && <g strokeWidth="1" opacity=".6">{[13, 19, 25, 31, 37, 43, 49].map(x => <circle key={x} cx={x} cy="31" r=".9"/>)}</g>}
    <line x1="12" y1="46" x2="48" y2="46" strokeWidth="1.4" opacity=".5"/></Frame>;
}

// ── La fenetre ──────────────────────────────────────────────────────────────────────────────────────────────────────
export default function SliceSettingsSheet({ printId, title, onClose }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  const [only, setOnly] = useState(false), [q, setQ] = useState(""), [open, setOpen] = useState(readOpen), [filOpen, setFilOpen] = useState({});
  useEffect(() => {
    client.get(`/prints/${printId}/settings3mf`, { timeout: 180000 })
      .then(r => { setD(r.data); egg("reglages_lus"); })
      .catch(e => setErr(e.response?.data?.detail || e.message));
  }, [printId]);
  const toggle = id => setOpen(o => { const n = { ...o, [id]: !o[id] }; try { localStorage.setItem(LS, JSON.stringify(n)); } catch { /* rien */ } return n; });
  const keep = r => !only || r.ch;
  const h = d?.hero || {};
  const sides = d?.sides || ["Buse"];
  const card = { borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface2)", padding: "12px 14px" };
  const head = (icon, t, n, extra = null) => <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
    <span style={{ fontSize: 16 }}>{icon}</span><span style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: C }}>{t}</span>
    {n != null && <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)" }}>{n}</span>}<span style={{ flex: 1 }}/>{extra}</div>;
  const badge = <span data-tip="Différent du profil système" style={{ fontSize: 9.5, fontWeight: 900, padding: "1px 6px", borderRadius: 20, color: "#fff", background: CH, marginLeft: 6, whiteSpace: "nowrap" }}>modifié</span>;
  const Row = ({ r, i, cols = null }) => <div style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "5px 0", borderTop: i ? "1px solid var(--border)" : "none",
    ...(r.ch ? { background: `linear-gradient(90deg, ${CH}14, transparent 70%)`, margin: "0 -8px", padding: "5px 8px", borderRadius: 8 } : null),
    ...(r.cur ? { background: `linear-gradient(90deg, ${C}18, transparent 70%)`, margin: "0 -8px", padding: "5px 8px", borderRadius: 8 } : null) }}>
    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>
      {r.l || <code style={{ fontSize: 11.5 }}>{r.k}</code>}{r.ch && badge}{r.cur && <span style={{ fontSize: 9.5, fontWeight: 900, color: C, marginLeft: 6 }}>● ce plateau</span>}</span>
    {cols ? cols.map((v, j) => <span key={j} style={{ width: 92, flexShrink: 0, fontSize: 13, fontWeight: 800, color: "var(--text)", textAlign: "right", overflowWrap: "anywhere" }}>{v ?? "—"}</span>)
      : r.vals ? <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", textAlign: "right" }}>{r.vals.map((v, j) => <span key={j} style={{ display: "block" }}>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)" }}>{sides[j]} </span>{v ?? "—"}</span>)}</span>
      : <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", textAlign: "right", minWidth: 0, maxWidth: "62%", overflowWrap: "anywhere" }}>{r.v}</span>}
  </div>;
  const Tile = ({ art, label, value, sub, c = C }) => <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0, padding: 8, borderRadius: 14,
    background: `radial-gradient(90% 90% at 0% 0%, ${c}18, transparent 70%), var(--surface)`, border: `1px solid color-mix(in srgb, ${c} 25%, var(--border))` }}>
    {art}<span style={{ minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 10, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>{label}</span>
      <span style={{ display: "block", fontSize: 16, fontWeight: 900, color: "var(--text)", lineHeight: 1.15, overflowWrap: "anywhere" }}>{value}</span>
      {sub && <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", lineHeight: 1.3 }}>{sub}</span>}</span></div>;
  const fr = v => v == null ? "—" : String(v).replace(".", ",");
  const restShown = (d?.rest || []).filter(r => keep(r) && (!q.trim() || `${r.l || ""} ${r.k} ${r.v}`.toLowerCase().includes(q.trim().toLowerCase())));
  const nozRows = (d?.nozzle_rows || []).filter(keep);

  return <FSheet onClose={onClose} z={2100}>
    <div style={{ padding: "18px 14px 28px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* l'en-tete : la vignette, le nom, l'imprimante et les profils */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, borderRadius: 18,
        background: `linear-gradient(135deg, ${C}2e, #8B5CF61a 60%, transparent), var(--surface2)`, border: `1px solid ${C}44` }}>
        <img src={apiThumb(apiUrl(`/prints/${printId}/image`), 192)} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
          style={{ width: 74, height: 74, borderRadius: 14, objectFit: "cover", flexShrink: 0, background: "var(--surface)" }}/>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: ".08em", textTransform: "uppercase", color: C }}>🪪 Carte d'identité du réglage</div>
          <div style={{ fontSize: 16.5, fontWeight: 900, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
          {d && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", lineHeight: 1.45 }}>
            🖨 {h.printer || "Imprimante"}{h.process ? ` · ${h.process}` : ""}</div>}
          {d && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)" }}>
              {d.from === "sliced" ? "3MF tranché" : "3MF d'origine"}{d.plate ? ` · plateau ${d.plate}` : ""}</span>
            {h.version && <span style={{ fontSize: 11, fontWeight: 800, padding: "2px 8px", borderRadius: 20, background: "var(--surface)", border: "1px solid var(--border)", color: "var(--muted)" }}>Bambu Studio {h.version}</span>}
            {h.nchanged > 0 && <span style={{ fontSize: 11, fontWeight: 900, padding: "2px 8px", borderRadius: 20, color: "#fff", background: CH }}>
              {h.nchanged} réglage{h.nchanged > 1 ? "s" : ""} modifié{h.nchanged > 1 ? "s" : ""}</span>}
          </div>}
        </div>
      </div>
      {!d && !err && <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center" }}><span className="mw-spin" style={{ width: 14, height: 14 }}/> Lecture du 3MF…</div>}
      {err && <div style={{ fontSize: 13, color: "#DC2626", fontWeight: 700 }}>{err}</div>}
      {d && <>
        {/* la carte : l'essentiel en images */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 158px), 1fr))", gap: 8 }}>
          <Tile art={<LayersArt h={h.layer} first={h.first_layer}/>} label="Couches" value={`${fr(h.layer)} mm`}
            sub={[h.first_layer != null && `1re ${fr(h.first_layer)} mm`, h.layers && `${h.layers} couches`, h.height && `${fr(h.height)} mm de haut`].filter(Boolean).join(" · ")}/>
          <Tile art={<WallsArt n={h.walls}/>} label="Parois" value={`${h.walls ?? "—"} paroi${h.walls > 1 ? "s" : ""}`}
            sub={[h.top != null && `dessus ${h.top}`, h.bottom != null && `dessous ${h.bottom}`, h.seam && `couture ${h.seam.toLowerCase()}`].filter(Boolean).join(" · ")}/>
          <Tile art={<PatternArt p={h.pattern}/>} label="Remplissage" value={String(h.infill || "—").replace("%", " %")} sub={h.pattern_fr}/>
          <Tile art={<SupportArt type={h.support}/>} label="Supports" value={h.support_fr || "Aucun"} c={h.support ? "#16A34A" : "#94A3B8"}
            sub={h.support ? (h.support_used ? "utilisés sur ce plateau" : "pas nécessaires ici") : null}/>
          <Tile art={<BrimArt brim={h.brim}/>} label="Bordure" value={h.brim_fr || "—"} c="#0EA5E9"/>
          <Tile art={<PlateArt bed={h.bed}/>} label="Plateau" value={h.bed || "—"} c="#B45309"/>
          {d.nozzles.filter(n => n.used).map(n => <Tile key={n.side} art={<NozzleArt d={n.diameter}/>} label={d.two ? `Buse ${n.side.toLowerCase()}` : "Buse"}
            value={`${fr(n.diameter)} mm`} sub={[n.flow, n.type, n.rack && `${n.rack} buses en rack`].filter(Boolean).join(" · ")}/>)}
        </div>
        {/* les chiffres et ce qui sort de l'ordinaire */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {[["⏱", h.time], ["⚖️", h.weight != null && `${fr(h.weight)} g`], ["🧸", h.objects && `${h.objects} objet${h.objects > 1 ? "s" : ""}`],
            ["🧵", d.filaments.length && !d.all_fil && `${d.filaments.length} filament${d.filaments.length > 1 ? "s" : ""}`],
            ["🔄", h.changes != null && `${h.changes} changement${h.changes > 1 ? "s" : ""}`], ["🗼", h.prime_tower && "tour de purge"],
            ["🏺", h.vase && "mode vase"], ["✨", h.ironing && `lissage : ${h.ironing.toLowerCase()}`], ["🌫", h.fuzzy && `surface floue : ${h.fuzzy.toLowerCase()}`],
            ["🧱", h.by_object && "objet par objet"], ["🎬", h.timelapse && h.timelapse !== "Non" && `timelapse ${h.timelapse.toLowerCase()}`]]
            .filter(([, v]) => v).map(([ic, v]) => <span key={ic} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 11px", borderRadius: 20,
              background: "var(--surface2)", border: "1px solid var(--border)", fontSize: 12.5, fontWeight: 800, color: "var(--text2)" }}>{ic} {v}</span>)}
        </div>
        {/* filtre global */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => setOnly(v => !v)} style={{ padding: "7px 12px", borderRadius: 20, cursor: "pointer", fontSize: 12.5, fontWeight: 900,
            border: `1px solid ${only ? CH : "var(--border)"}`, background: only ? `${CH}22` : "var(--surface2)", color: only ? "#B45309" : "var(--text2)" }}>
            {only ? "✓ " : ""}Seulement les réglages modifiés</button>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{d.total} réglages dans le 3MF</span>
        </div>

        {/* les buses, cote a cote */}
        {(nozRows.length > 0 || !only) && <div style={card}>
          {head("🔩", d.two ? "Buses" : "Buse", null)}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginBottom: 6 }}>
            {d.nozzles.map(n => <div key={n.side} style={{ width: 92, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, opacity: n.used ? 1 : 0.55 }}>
              <NozzleArt d={n.diameter} used={n.used}/>
              <span style={{ fontSize: 12, fontWeight: 900, color: "var(--text)" }}>{n.side}</span>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: n.used ? "#16A34A" : "var(--muted)" }}>{n.used ? "utilisée" : "pas utilisée"}</span>
            </div>)}
          </div>
          {nozRows.map((r, i) => <Row key={r.k} r={r} i={i} cols={r.vals}/>)}
        </div>}

        {/* les filaments */}
        {d.filaments.length > 0 && (!only || d.filaments.some(f => f.families.some(([, rows]) => rows.some(r => r.ch)))) && <div style={card}>
          {head("🧵", "Filaments", d.all_fil ? "tous ceux du projet (3MF pas tranché)" : `${d.filaments.length} utilisé${d.filaments.length > 1 ? "s" : ""}`)}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {d.filaments.map(f => { const fo = !!filOpen[f.id];
              const fams = f.families.map(([t, rows]) => [t, rows.filter(keep)]).filter(([, rows]) => rows.length);
              if (only && !fams.length) return null;
              return <div key={f.id} style={{ borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", padding: 10 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <SpoolArt color={f.color}/>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 900, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.name || f.type}</span>
                    <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                      {[f.vendor, f.type, d.two && `buse ${f.side.toLowerCase()}`, f.g != null && `${fr(f.g)} g`, f.m != null && `${fr(f.m)} m`,
                        f.support && !f.object ? "supports seulement" : f.support ? "objet et supports" : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  {f.nchanged > 0 && <span style={{ fontSize: 10.5, fontWeight: 900, padding: "2px 7px", borderRadius: 20, color: "#fff", background: CH, whiteSpace: "nowrap" }}>{f.nchanged} modifié{f.nchanged > 1 ? "s" : ""}</span>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  {[["🔥", f.temp != null && `${f.temp} °C${f.temp_first && f.temp_first !== f.temp ? ` (1re ${f.temp_first})` : ""}`, "Température de buse"],
                    ["🔲", f.bed != null && `${f.bed} °C${f.bed_first && f.bed_first !== f.bed ? ` (1re ${f.bed_first})` : ""}`, "Température du plateau (celui de ce plateau)"],
                    ["🌀", f.fan != null && `${f.fan} %`, "Ventilateur maxi"], ["💧", f.flow != null && `débit ${fr(f.flow)}`, "Débit"],
                    ["🚀", f.max_vol && `${fr(f.max_vol)} mm³/s`, "Débit volumique maxi"], ["↩️", f.retract != null && `${fr(f.retract)} mm`, "Rétraction propre au filament"]]
                    .filter(([, v]) => v).map(([ic, v, tip]) => <span key={ic} data-tip={tip} style={{ fontSize: 12, fontWeight: 800, padding: "3px 9px", borderRadius: 20,
                      background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text2)" }}>{ic} {v}</span>)}
                </div>
                <button type="button" onClick={() => setFilOpen(o => ({ ...o, [f.id]: !o[f.id] }))} style={{ marginTop: 8, border: "none", background: "none", cursor: "pointer",
                  padding: 0, fontSize: 12.5, fontWeight: 900, color: C }}>{fo || only ? "▾" : "▸"} Tous ses réglages ({fams.reduce((a, [, r]) => a + r.length, 0)})</button>
                {(fo || only) && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 260px), 1fr))", gap: 8, marginTop: 8 }}>
                  {fams.map(([t, rows]) => <div key={t} style={{ ...card, padding: "8px 12px" }}>
                    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 4 }}>{t}</div>
                    {rows.map((r, i) => <Row key={r.k} r={r} i={i}/>)}</div>)}
                </div>}
              </div>; })}
          </div>
        </div>}

        {/* les objets du plateau */}
        {d.objects.length > 0 && !only && <div style={card}>
          {head("🧸", "Objets du plateau", d.objects.length)}
          {d.objects.map((o, i) => <div key={i} style={{ padding: "5px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 800, color: o.skipped ? "var(--muted)" : "var(--text)", textDecoration: o.skipped ? "line-through" : "none" }}>{o.name}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>{o.skipped ? "annulé · " : ""}{o.size || ""}</span></div>
            {o.own?.length > 0 && <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text2)", marginTop: 2 }}>Réglages propres : {o.own.map(([k, v]) => `${k} ${v}`).join(" · ")}</div>}
          </div>)}
        </div>}

        {/* les familles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 320px), 1fr))", gap: 8, alignItems: "start" }}>
          {d.families.map(fa => { const rows = fa.rows.filter(keep); if (!rows.length) return null;
            const big = rows.length > 9 && !only && !open[fa.id], nch = fa.rows.filter(r => r.ch).length;
            const art = fa.id === "remplissage" ? <PatternArt p={h.pattern} size={30}/> : null;
            return <div key={fa.id} style={card}>
              {head(art || fa.icon, fa.title, rows.length, nch ? <span style={{ fontSize: 10.5, fontWeight: 900, padding: "1px 7px", borderRadius: 20, color: "#fff", background: CH }}>{nch} modifié{nch > 1 ? "s" : ""}</span> : null)}
              {(big ? rows.slice(0, 8) : rows).map((r, i) => <Row key={r.k} r={r} i={i}/>)}
              {rows.length > 9 && !only && <button type="button" onClick={() => toggle(fa.id)} style={{ marginTop: 6, border: "none", background: "none", cursor: "pointer", padding: 0,
                fontSize: 12.5, fontWeight: 900, color: C }}>{open[fa.id] ? "▴ Moins" : `▾ ${rows.length - 8} de plus`}</button>}
            </div>; })}
        </div>

        {/* tout le reste, cherchable */}
        <div style={card}>
          {head("📚", "Tous les autres réglages", restShown.length, null)}
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px", height: 36, borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", marginBottom: 6 }}>
            <span style={{ opacity: 0.7 }}>🔎</span>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un réglage (nom, valeur)…" aria-label="Chercher un réglage"
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 13.5, fontWeight: 700 }}/>
            {q && <button type="button" onClick={() => setQ("")} aria-label="Effacer" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted)" }}>✕</button>}
          </div>
          {(open._rest || q.trim() || only ? restShown : restShown.slice(0, 12)).map((r, i) => <Row key={r.k} r={r} i={i}/>)}
          {!q.trim() && !only && restShown.length > 12 && <button type="button" onClick={() => toggle("_rest")} style={{ marginTop: 6, border: "none", background: "none", cursor: "pointer",
            padding: 0, fontSize: 12.5, fontWeight: 900, color: C }}>{open._rest ? "▴ Moins" : `▾ Les ${restShown.length - 12} autres`}</button>}
        </div>
      </>}
    </div>
  </FSheet>;
}
