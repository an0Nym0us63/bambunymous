import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { FSheet, FCard } from "./FicheKit";
import MwImg from "./MwImg";
import { openCreator } from "./MwCreatorPage";

// Le detail de mon compte MakerWorld (26/10/2026), ouvert depuis la carte de createur : mes boosts a donner,
// groupes par date d'expiration (avec ce qui les a fait gagner), mes abonnes et mes abonnements.
const asDate = v => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : /^\d+$/.test(String(v)) ? Number(v) : null;
  const d = n != null ? new Date(n < 1e12 ? n * 1000 : n) : new Date(v);
  return isNaN(d) ? null : d;
};
const dayKey = d => d ? d.toISOString().slice(0, 10) : "";
const inDays = d => Math.ceil((d - new Date()) / 86400000);
const reasonLabel = r => String(r || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()).trim();

function People({ list, empty }) {
  const [all, setAll] = useState(false);
  if (!list.length) return <p style={{ fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" }}>{empty}</p>;
  const shown = all ? list : list.slice(0, 24);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 6 }}>
        {shown.map(p => (
          <button key={p.uid} onClick={() => openCreator({ uid: p.uid, name: p.name })} data-tip={p.handle ? `@${p.handle}` : undefined}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 12, border: "1px solid var(--border)",
              background: "var(--surface)", cursor: "pointer", textAlign: "left", minWidth: 0, font: "inherit", color: "inherit" }}>
            {p.avatar ? <MwImg src={p.avatar} w={64} style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0 }}/>
              : <span style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: "var(--surface2)", display: "flex",
                alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{(p.name || "?")[0]}</span>}
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {p.name || p.handle || p.uid}</span>
          </button>))}
      </div>
      {!all && list.length > 24 && <button onClick={() => setAll(true)} style={{ alignSelf: "flex-start", padding: "6px 12px", borderRadius: 10,
        border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
        Voir les {list.length - 24} autres</button>}
    </div>);
}

export default function MwAccountSheet({ profile, fans, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    client.get("/makerworld/me/details").then(r => setD(r.data)).catch(e => setErr(e.response?.data?.detail || e.message));
  }, []);
  // les boosts par jour d'expiration, le plus proche d'abord
  const groups = {};
  for (const b of d?.boosts || []) {
    const dt = asDate(b.expire_at), k = dayKey(dt);
    (groups[k] = groups[k] || { date: dt, n: 0, reasons: {} }).n += 1;
    if (b.reason) groups[k].reasons[b.reason] = (groups[k].reasons[b.reason] || 0) + 1;
  }
  const days = Object.values(groups).sort((a, b) => (a.date ? a.date.getTime() : Infinity) - (b.date ? b.date.getTime() : Infinity));
  const muted = { fontSize: 12.5, color: "var(--muted)", margin: "6px 0 0" };
  return createPortal(
    <FSheet onClose={onClose} z={1600}>
      <div style={{ padding: "52px 18px 14px", background: "radial-gradient(90% 70% at 100% 0%, rgba(245,158,11,0.18), transparent 70%), radial-gradient(70% 60% at 0% 0%, rgba(34,197,94,0.14), transparent 70%), var(--surface2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {profile?.avatar && <MwImg src={profile.avatar} w={96} eager style={{ width: 52, height: 52, borderRadius: "50%", flexShrink: 0, boxShadow: "0 0 0 2px #22C55E" }}/>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 900, color: "var(--text)", overflowWrap: "anywhere" }}>{profile?.name || "Mon compte MakerWorld"}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)" }}>@{profile?.handle}{profile?.level ? ` · niveau ${profile.level}` : ""}</div>
          </div>
        </div>
      </div>
      <div style={{ padding: "14px 14px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {err && <p style={{ fontSize: 13, fontWeight: 700, color: "#ef4444", margin: 0 }}>{err}</p>}
        {!d && !err && <p style={{ ...muted, textAlign: "center", padding: 16 }}>⏳ Lecture du compte…</p>}
        {d && <>
          <FCard t={`Boosts à donner${d.boosts ? ` · ${d.boosts.length}` : ""}`} i="⚡" c="#F59E0B">
            {d.boosts_error ? <p style={muted}>{d.boosts_error}</p>
              : !d.boosts?.length ? <p style={muted}>Aucun boost à donner pour l'instant.</p>
              : <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
                {days.map((g, i) => { const n = g.date ? inDays(g.date) : null, soon = n != null && n <= 7;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12,
                      border: `1px solid ${soon ? "rgba(239,68,68,.35)" : "var(--border)"}`, background: soon ? "rgba(239,68,68,.06)" : "var(--surface)" }}>
                      <span style={{ fontSize: 18, fontWeight: 900, minWidth: 30, textAlign: "center", backgroundImage: "linear-gradient(135deg, #F59E0B, #FBBF24)",
                        WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{g.n}</span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 800, color: soon ? "#dc2626" : "var(--text)" }}>
                          {g.date ? `Expire${g.n > 1 ? "nt" : ""} le ${g.date.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}` : "Sans date d'expiration"}</span>
                        <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 700 }}>
                          {n != null && (n <= 0 ? "aujourd'hui" : n === 1 ? "demain" : `dans ${n} jours`)}
                          {Object.keys(g.reasons).length > 0 && ` · ${Object.entries(g.reasons).map(([r, k]) => `${reasonLabel(r)}${k > 1 ? ` ×${k}` : ""}`).join(", ")}`}</span>
                      </span>
                    </div>); })}
              </div>}
          </FCard>
          <FCard t={`Abonnés · ${(fans ?? d.fans?.length ?? 0).toLocaleString("fr-FR")}`} i="👥" c="#3B82F6">
            {d.fans_error ? <p style={muted}>La liste des abonnés n'est pas disponible ({d.fans_error}).</p>
              : <People list={d.fans || []} empty="Pas encore d'abonné."/>}
            {d.fans && fans > d.fans.length && <p style={muted}>Les {d.fans.length} premiers sur {fans.toLocaleString("fr-FR")}.</p>}
          </FCard>
          <FCard t={`Abonnements · ${(d.follows?.length ?? 0).toLocaleString("fr-FR")}`} i="➕" c="#22C55E">
            {d.follows_error ? <p style={muted}>{d.follows_error}</p> : <People list={d.follows || []} empty="Tu ne suis personne pour l'instant."/>}
          </FCard>
        </>}
      </div>
    </FSheet>,
    document.body);
}
