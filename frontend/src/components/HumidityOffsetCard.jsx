import React, { useEffect, useState } from "react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import { egg } from "../eggs";
import { amsName } from "./SensorChart";

// Parametres › Imprimante : le decalage d'humidite de chaque AMS (03/11/2026). Un capteur qui lit trop haut ou trop
// bas se corrige ici ; l'appli entiere voit la valeur corrigee (tuiles, alertes, sechage, releves). Enregistre tout
// de suite, hors du formulaire.
export default function HumidityOffsetCard({ card, cardTitle }) {
  const [ams, setAms] = useState(null);
  const [off, setOff] = useState({});
  const [saved, setSaved] = useState({});
  const [busy, setBusy] = useState(false);
  // ce que lit chaque capteur : l'humidite affichee moins le decalage en place, a l'ouverture (ensuite, l'etat de
  // l'imprimante suit le nouveau decalage a son prochain message ; on ne le relit pas)
  useEffect(() => {
    Promise.all([client.get("/printer/status").then(r => r.data).catch(() => null),
                 client.get("/sensors/humidity-offsets").then(r => r.data?.offsets || {}).catch(() => ({}))])
      .then(([st, o]) => {
        setOff(o); setSaved(o);
        setAms((st?.ams_list || []).filter(a => a.id !== 255 && a.id !== 254)
          .map(a => ({ id: a.id, raw: a.humidity ? Math.max(1, a.humidity - (o[String(a.id)] || 0)) : null })));
      });
  }, []);
  const ids = [...new Set([...(ams || []).map(a => String(a.id)), ...Object.keys(off)])].sort((a, b) => Number(a) - Number(b));
  const dirty = JSON.stringify(off) !== JSON.stringify(saved);
  const set = (id, v) => setOff(o => { const n = { ...o }; const x = Math.max(-50, Math.min(50, Math.round(Number(v) || 0)));
    if (x) n[id] = x; else delete n[id]; return n; });
  const save = async () => {
    setBusy(true);
    try {
      const { data } = await client.put("/sensors/humidity-offsets", { offsets: off });
      setOff(data.offsets || {}); setSaved(data.offsets || {});
      if (Object.keys(data.offsets || {}).length) egg("hygro_cale");
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  const step = { width: 30, height: 30, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)",
    fontSize: 16, fontWeight: 900, cursor: "pointer", lineHeight: 1 };
  return <div className="card" style={card}>
    <div style={cardTitle}>💧 Humidité des AMS : décalage</div>
    <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "0 0 10px", lineHeight: 1.45 }}>
      Un capteur qui lit trop haut ou trop bas (comparé à un hygromètre) se corrige ici, AMS par AMS. Toute l'appli voit la valeur corrigée :
      tuiles, alertes, séchage, relevés.</p>
    {ams == null ? <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Lecture des AMS…</span>
      : !ids.length ? <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Pas d'AMS en vue (imprimante injoignable ?)</span>
      : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {ids.map(id => { const a = (ams || []).find(x => String(x.id) === id), d = off[id] || 0, raw = a?.raw ?? null;
          return <div key={id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 14, background: "var(--surface2)", flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 900, color: "var(--text)", minWidth: 70 }}>{amsName(id)}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <button type="button" style={step} onClick={() => set(id, d - 1)} aria-label="Moins">−</button>
              <span style={{ minWidth: 54, textAlign: "center", fontSize: 14, fontWeight: 900, color: d ? (d < 0 ? "#0891B2" : "#EA580C") : "var(--muted)" }}>
                {d > 0 ? "+" : ""}{d} %</span>
              <button type="button" style={step} onClick={() => set(id, d + 1)} aria-label="Plus">+</button>
            </span>
            {raw != null && <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}
              data-tip="Ce que lit le capteur, et ce que l'appli affichera">
              capteur {raw} % → <b style={{ color: "var(--text)" }}>{Math.max(1, Math.min(100, raw + d))} %</b></span>}
          </div>; })}
        <button type="button" onClick={save} disabled={!dirty || busy}
          style={{ alignSelf: "flex-start", marginTop: 4, padding: "10px 18px", borderRadius: 12, border: "none", fontSize: 13.5, fontWeight: 800,
            cursor: dirty ? "pointer" : "default", color: "#fff", opacity: dirty ? 1 : 0.5,
            background: "linear-gradient(135deg, #06B6D4, #3B82F6)", boxShadow: dirty ? "0 8px 18px -10px #06B6D4" : "none" }}>
          {busy ? "…" : dirty ? "Enregistrer" : "Enregistré ✓"}</button>
      </div>}
  </div>;
}
