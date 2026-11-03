import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import { egg } from "../eggs";
import { useIsAdmin } from "../store/auth";
import { FSheet, FCard, fBtn } from "./FicheKit";
import { useLiveStore, refreshLive } from "../store/liveUsage";

// Suivi du filament couche par couche (02/11/2026, toujours actif depuis le 03/11/2026) : ce que chaque filament de l'impression en cours a vraiment
// consomme, lu dans le G-code a la couche annoncee par l'imprimante.
const EVERY = 15000;
const g = v => v == null ? "—" : `${Math.round(v)} g`;
const hex = c => { const m = /^#?([0-9a-f]{6})/i.exec(c || ""); return m ? `#${m[1]}` : "#94a3b8"; };

// l'etat d'une impression (print_id) ou de l'impression en cours (sans), relu toutes les 15 s tant que active
export function useLiveUsage(active, printId = null, rev = 0) {
  const [d, setD] = useState(null);
  useEffect(() => {
    if (!active) { setD(null); return; }
    let on = true;
    const load = () => client.get(printId ? `/live/${printId}` : "/live/current").then(r => { if (on) setD(r.data); }).catch(() => {});
    load();
    const id = setInterval(() => { if (document.visibilityState === "visible") load(); }, EVERY);
    return () => { on = false; clearInterval(id); };
  }, [active, printId, rev]);
  return d?.on ? d : null;
}

// la part d'une jauge qui partira encore d'ici la fin de l'impression : hachuree, de la cible (a) a maintenant (b), en
// fractions de la jauge ; a poser dans une jauge en position relative (sa partie pleine va jusqu'a maintenant)
export function LiveHatch({ a, b, r = 3 }) {
  if (a == null || b == null || b <= a) return null;
  const pc = v => `${Math.max(0, Math.min(1, v)) * 100}%`;
  return <span aria-hidden="true" style={{ position: "absolute", top: 0, bottom: 0, left: pc(a), width: `calc(${pc(b)} - ${pc(a)})`, borderRadius: `0 ${r}px ${r}px 0`,
    background: "repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 3px, transparent 3px 6px)", pointerEvents: "none" }}/>;
}

// a cote d'un « ≈ 671 g » d'une bobine qui sert a l'impression en cours : sa valeur a la fin (« → 640 g »), plus petite,
// de la couleur du poids en plus pale (02/11/2026 ; le gris ne plaisait pas) ; rien hors impression
export function LiveTo({ lv, size = "0.8em", color, style, unit = true }) {
  if (!lv || lv.target == null) return null;
  return <span data-tip={`${Math.round(lv.target)} g à la fin de l'impression en cours`}
    style={{ fontSize: size, fontWeight: 800, color: color || "inherit", opacity: .72, whiteSpace: "nowrap", ...style }}>→ {Math.round(lv.target)}{unit ? " g" : ""}</span>;
}

// la bobine qui imprime : son poids maintenant, et sa cible (son poids a la fin)
export function liveOfSpool(d, spoolId) {
  return spoolId ? (d?.items || []).find(i => i.spool_id === spoolId && i.current) || null : null;
}

// une jauge : ce qui reste maintenant, et un repere a la cible
export function LiveBar({ now, target, full, color, h = 8 }) {
  if (now == null || !full) return null;
  const w = v => `${Math.max(0, Math.min(100, (v / full) * 100))}%`;
  return <div style={{ position: "relative", height: h, borderRadius: h, background: "var(--surface2)", overflow: "hidden", boxShadow: "inset 0 0 0 1px var(--border)" }}>
    <div data-tip={target != null ? `À la fin : ${g(target)}` : undefined} style={{ position: "absolute", inset: 0, width: w(now), borderRadius: h,
      background: `linear-gradient(90deg, ${color}aa, ${color})` }}/>
    {/* la part qui partira d'ici la fin, hachuree (02/11/2026 : sans repere, le trait clair genait) */}
    {target != null && target < now && <><div style={{ position: "absolute", top: 0, bottom: 0, left: w(target), width: w(now - target), background: "repeating-linear-gradient(135deg, rgba(255,255,255,.5) 0 3px, transparent 3px 6px)" }}/></>}
  </div>;
}

function SpoolChoice({ item, printId, onClose, onDone }) {
  const [spools, setSpools] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    client.get("/filaments/spools", { params: { limit: 500, archived: false } }).then(r => setSpools(Array.isArray(r.data) ? r.data : []))
      .catch(e => { setErr(e.response?.data?.detail || e.message || "erreur"); setSpools([]); });
  }, []);
  const same = s => (s.filament_fila_type || s.filament_material || "").toUpperCase() === String(item.type || "").toUpperCase()
    && hex(s.color_hex || s.filament_color).toUpperCase() === hex(item.color).toUpperCase();
  const list = (spools || []).filter(s => s.id !== item.spool_id && !s.ordered)
    .filter(s => !q.trim() || q.trim().toLowerCase().split(/\s+/).every(w => [s.filament_translated_name, s.filament_name, s.filament_manufacturer,
      s.filament_fila_type, s.filament_material, `#${s.id}`].filter(Boolean).join(" ").toLowerCase().includes(w)))
    .sort((a, b) => same(b) - same(a) || !!b.ams_tray - !!a.ams_tray);
  const pick = async s => {
    setBusy(true);
    try {
      await client.post(`/live/${printId}/switch`, { slot: item.slot, spool_id: s.id });
      egg("bobine_relais");
      onDone();
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  return createPortal(<FSheet onClose={onClose} z={3200} bottom={<button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button>}>
    <div style={{ padding: "52px 16px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>🔁 La suite de ce filament</div>
      <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0, lineHeight: 1.45 }}>
        La bobine en cours est finie (elle passe à 0 g) ; celle que tu choisis porte la suite, {g(item.row_planned - item.row_used)} de
        l'impression, retirés de son poids. Les bobines de même matière et de même couleur d'abord.</p>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher une bobine…" autoComplete="off"
        style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14 }}/>
      {spools == null ? <span style={{ fontSize: 13, color: "var(--muted)" }}>…</span>
        : err ? <span style={{ fontSize: 13, fontWeight: 700, color: "#dc2626" }}>Liste des bobines illisible : {String(err)}</span>
        : list.length === 0 ? <span style={{ fontSize: 13, color: "var(--muted)" }}>{q.trim() ? "Aucune bobine ne correspond" : "Aucune autre bobine en stock"}</span>
        : list.slice(0, 60).map(s => <button key={s.id} disabled={busy} onClick={() => pick(s)} style={{ display: "flex", alignItems: "center", gap: 10,
          padding: "10px 12px", borderRadius: 14, cursor: "pointer", textAlign: "left", color: "var(--text)",
          background: same(s) ? "linear-gradient(135deg, rgba(34,197,94,.12), transparent 70%), var(--surface)" : "var(--surface)",
          border: `1px solid ${same(s) ? "rgba(34,197,94,.45)" : "var(--border)"}` }}>
          <span style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0, background: hex(s.color_hex || s.filament_color), border: "1px solid rgba(0,0,0,.2)" }}/>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {s.filament_translated_name || s.filament_name || `Bobine #${s.id}`}</span>
            <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{[s.filament_manufacturer, s.filament_fila_type || s.filament_material,
              s.remaining_weight_g != null && g(s.remaining_weight_g), s.ams_tray && `dans l'AMS ${s.ams_tray}`].filter(Boolean).join(" · ")}</span>
          </span>
        </button>)}
    </div>
  </FSheet>, document.body);
}

// la carte de la fiche d'une impression en cours : un filament par ligne (consomme / prevu), et chaque bobine qui a
// servi (maintenant -> a la fin) ; « Bobine finie ? » pour dire quelle bobine prend la suite
export function LiveUsageCard({ printId }) {
  const isAdmin = useIsAdmin();
  const [tick, setTick] = useState(0);
  const d = useLiveUsage(true, printId, tick);
  const [choose, setChoose] = useState(null);
  if (!d || !(d.items || []).length) return null;
  const slots = [...new Set(d.items.map(i => i.slot))];
  return <FCard t="Suivi du filament" i="🧵" c="#8B5CF6">
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 6 }}>
      {d.layer ? <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Couche {d.layer} · {Math.round(d.pct || 0)} % — relu toutes les 15 s</span> : null}
      {slots.map(slot => {
        const rows = d.items.filter(i => i.slot === slot), f = rows[0], cur = rows[rows.length - 1], c = hex(f.color);
        return <div key={slot} style={{ display: "flex", flexDirection: "column", gap: 5, padding: "10px 12px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
            <span style={{ width: 14, height: 14, borderRadius: "50%", background: c, border: "1px solid rgba(0,0,0,.2)", flexShrink: 0 }}/>
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cur.name || f.type || `Filament ${slot}`}</span>
            <span data-tip={f.source === "gcode" ? "Lu dans le G-code, couche par couche" : "Estimation : grammes prévus × avancement (G-code illisible)"}
              style={{ whiteSpace: "nowrap" }}>{f.source === "gcode" ? "" : "≈ "}{g(f.used)} / {g(f.planned)}</span>
          </div>
          <LiveBar now={f.used} full={f.planned} color={c} h={6}/>
          {rows.map(r => <div key={r.row} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text2)", flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700 }}>{r.current ? "Bobine" : "Bobine finie"}{r.spool_id ? ` #${r.spool_id}` : " (non associée)"}</span>
              {r.now != null && <span>≈ {g(r.now)} maintenant <span style={{ color: "var(--muted)" }}>→ {g(r.target)} à la fin</span></span>}</div>
            {/* la bobine : ce qui reste maintenant, et le repere de ce qui restera a la fin */}
            {r.current && r.now > 0 && <LiveBar now={r.now} target={r.target} full={Math.max(r.now, r.spool_full || 0) || r.now} color={c} h={5}/>}
          </div>)}
          {isAdmin && cur.current && cur.row_used < cur.row_planned - 0.5 && <button onClick={() => setChoose(cur)}
            data-tip="La bobine est vide ou tu en as mis une autre : choisis celle qui porte la suite"
            style={{ ...fBtn, alignSelf: "flex-start", padding: "6px 10px", fontSize: 12 }}>🔁 Bobine finie ? Choisir la suite</button>}
        </div>;
      })}
    </div>
    {choose && <SpoolChoice item={choose} printId={printId} onClose={() => setChoose(null)} onDone={() => { setChoose(null); setTick(t => t + 1); refreshLive(); }}/>}
  </FCard>;
}

// « Bobine finie ? » ailleurs que sur la fiche de l'impression (03/11/2026) : l'emplacement de l'AMS et la tuile
// « Filament en cours ». lv : la bobine telle que useLiveSpool la rend (elle sert maintenant a l'impression en cours).
export function LiveSwitchButton({ lv, style }) {
  const isAdmin = useIsAdmin();
  const printId = useLiveStore(s => s.d?.print_id);
  const [open, setOpen] = useState(false);
  if (!isAdmin || !lv || !printId || !(lv.row_used < lv.row_planned - 0.5)) return null;
  return <>
    <button type="button" onClick={e => { e.stopPropagation(); setOpen(true); }}
      data-tip="La bobine est vide ou tu en as mis une autre : choisis celle qui porte la suite de l'impression"
      style={{ ...fBtn, padding: "6px 10px", fontSize: 12, ...style }}>🔁 Bobine finie ? Choisir la suite</button>
    {open && <SpoolChoice item={lv} printId={printId} onClose={() => setOpen(false)} onDone={() => { setOpen(false); refreshLive(); }}/>}
  </>;
}
