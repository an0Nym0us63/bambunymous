import React, { useEffect, useState } from "react";
import client from "../api/client";
import { FSheet } from "./FicheKit";
import { egg } from "../eggs";

// (13/11/2026) « Detail des reglages » d'une impression : ce que Bambu Studio a regle dans son 3MF, en clair. Les buses
// (gauche / droite sur une imprimante a deux buses) avec leur diametre, leur debit, la retraction et les vitesses ; les
// filaments utilises avec leur buse, leurs temperatures (buse et plateau) ; puis les reglages du profil par theme.
const C = "#6366F1";
const v = (x, u = "") => x === null || x === undefined || x === "" ? "—" : `${x}${u}`;

export default function SliceSettingsSheet({ printId, title, onClose }) {
  const [d, setD] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    client.get(`/prints/${printId}/settings3mf`, { timeout: 120000 })
      .then(r => { setD(r.data); egg("reglages_lus"); })
      .catch(e => setErr(e.response?.data?.detail || e.message));
  }, [printId]);
  const card = { borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface2)", padding: "10px 12px" };
  const head = { fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: C, marginBottom: 6 };
  const row = (k, val, i) => <div key={k + i} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "4px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>{k}</span>
    <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{val}</span></div>;
  const usedNoz = (d?.nozzles || []).filter(n => n.used);
  return <FSheet onClose={onClose} z={2100}>
    <div style={{ padding: "20px 16px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)" }}>⚙️ Détail des réglages</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}{d ? ` · ${d.from === "sliced" ? "3MF tranché" : "3MF d'origine"}${d.plate ? ` · plateau ${d.plate}` : ""}` : ""}</div>
      </div>
      {!d && !err && <div style={{ fontSize: 13, color: "var(--muted)", display: "flex", gap: 8, alignItems: "center" }}><span className="mw-spin" style={{ width: 14, height: 14 }}/> Lecture du 3MF…</div>}
      {err && <div style={{ fontSize: 13, color: "#DC2626", fontWeight: 700 }}>{err}</div>}
      {d && <>
        {/* les buses */}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(1, d.nozzles.length)}, minmax(0, 1fr))`, gap: 8 }}>
          {d.nozzles.map(n => <div key={n.side} style={{ ...card, opacity: n.used ? 1 : 0.55, ...(n.used ? { borderColor: `${C}66`, background: `radial-gradient(90% 90% at 0% 0%, ${C}1f, transparent 70%), var(--surface2)` } : null) }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{d.two ? (n.side === "Gauche" ? "◀ " : "▶ ") : ""}{n.side}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: n.used ? "#16A34A" : "var(--muted)" }}>{n.used ? "utilisée" : "pas utilisée"}</span></div>
            <div style={{ fontSize: 18, fontWeight: 900, color: C, lineHeight: 1.2 }}>{v(n.diameter, " mm")}</div>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{[n.flow === "High Flow" ? "Haut débit" : n.flow === "Standard" ? "Débit standard" : n.flow, n.type].filter(Boolean).join(" · ")}</div>
            {n.used && <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text2)", marginTop: 4, lineHeight: 1.5 }}>
              Rétraction {v(n.retract, " mm")}{n.retract_speed ? ` à ${n.retract_speed} mm/s` : ""} · saut Z {v(n.z_hop, " mm")}</div>}
          </div>)}
        </div>
        {/* les filaments */}
        {d.filaments.length > 0 && <div style={card}>
          <div style={head}>Filaments ({d.filaments.length})</div>
          {d.filaments.map((f, i) => <div key={f.id} style={{ display: "flex", gap: 10, alignItems: "center", padding: "7px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
            <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, background: f.color || "#94A3B8", border: "1px solid var(--border)" }}/>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 13, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.name || f.type}</span>
              <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", lineHeight: 1.45 }}>
                {[d.two && `buse ${f.side.toLowerCase()}`, f.g != null && `${f.g} g`, f.support && !f.object ? "supports seulement" : f.support ? "objet et supports" : null].filter(Boolean).join(" · ")}</span>
              <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--text2)", lineHeight: 1.45 }}>
                🔥 {v(f.temp, " °C")}{f.temp_first && f.temp_first !== f.temp ? ` (1re couche ${f.temp_first} °C)` : ""} · plateau {v(f.bed, " °C")}{f.bed_first && f.bed_first !== f.bed ? ` (1re ${f.bed_first} °C)` : ""}
                {f.retract != null ? ` · rétraction du filament ${f.retract} mm` : ""}{f.max_vol ? ` · ${f.max_vol} mm³/s max` : ""}</span>
            </span></div>)}
        </div>}
        {/* les vitesses, par buse utilisee */}
        {usedNoz.length > 0 && <div style={card}>
          <div style={head}>Vitesses</div>
          {[["Paroi extérieure", "outer"], ["Paroi intérieure", "inner"], ["Remplissage", "infill"], ["Surface du dessus", "top"], ["Première couche", "first"], ["Déplacement", "travel"]]
            .filter(([, k]) => usedNoz.some(n => n[k] != null))
            .map(([l, k], i) => row(l, usedNoz.map(n => `${v(n[k], " mm/s")}${usedNoz.length > 1 ? ` (${n.side.toLowerCase()})` : ""}`).join(" · "), i))}
        </div>}
        {/* le profil, par theme */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
          {d.sections.map(([t, rows]) => <div key={t} style={card}>
            <div style={head}>{t}</div>
            {rows.map(([k, val], i) => row(k, String(val), i))}
          </div>)}
        </div>
      </>}
    </div>
  </FSheet>;
}
