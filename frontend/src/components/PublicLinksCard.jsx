import React, { useEffect, useState } from "react";
import client from "../api/client";
import { toast } from "../store/toast";
import { showConfirm } from "../utils/dialog";

// Les liens publics (04/11/2026) : tout ce qui s'ouvre sans compte -- « Ton annee », « Depuis le debut », la vitrine --
// avec leur creation, leur expiration et leurs ouvertures ; ouvrir, copier, changer la duree, supprimer.
const KIND = { year: ["🎁", "#9333EA"], all: ["🏛️", "#4F46E5"], showcase: ["✨", "#A1803F"] };
const DUR = [[7, "7 j"], [30, "30 j"], [365, "1 an"], [0, "sans fin"]];
const day = iso => iso ? new Date(`${iso}${iso.endsWith("Z") ? "" : "Z"}`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "";

export default function PublicLinksCard({ card, cardTitle }) {
  const [links, setLinks] = useState(null);
  const load = () => client.get("/public-links").then(r => setLinks(r.data?.links || [])).catch(() => setLinks([]));
  useEffect(() => { load(); }, []);
  const url = l => `${window.location.origin}${l.path}`;
  const copy = async l => { try { await navigator.clipboard.writeText(url(l)); toast("Lien copié"); } catch { toast(url(l)); } };
  const setDur = async (l, days) => {
    try { await client.patch(`/public-links/${l.token}`, { days }); load(); toast(days ? `Valable ${days} jours à partir d'aujourd'hui` : "Valable sans fin"); }
    catch { toast("La durée n'a pas pu être changée", "error"); }
  };
  const del = async l => {
    if (!(await showConfirm(`Supprimer le lien « ${l.label} » ? Il ne s'ouvrira plus.`, { confirmLabel: "Supprimer" }))) return;
    try { await client.delete(`/public-links/${l.token}`); load(); toast("Lien supprimé"); } catch { toast("Le lien n'a pas pu être supprimé", "error"); }
  };
  const chip = { padding: "5px 10px", borderRadius: 14, cursor: "pointer", fontSize: 12, fontWeight: 800, border: "1px solid var(--border)", background: "var(--surface2)",
    color: "var(--text2)", textDecoration: "none" };
  return <div className="card" style={card}>
    <div style={cardTitle}>🔗 Liens publics</div>
    <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginBottom: 10 }}>
      Ce qui s'ouvre sans compte : « Ton année » et « Depuis le début » (Statistiques), et ta vitrine (Impressions › Galerie). Un lien expiré ne s'ouvre plus.</div>
    {links === null ? <div style={{ color: "var(--muted)" }}>Chargement…</div>
      : !links.length ? <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucun lien public pour l'instant.</div>
      : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {links.map(l => { const [ic, c] = KIND[l.kind] || ["🔗", "#64748B"];
          return <div key={l.token} style={{ padding: 10, borderRadius: 14, border: `1px solid ${l.expired ? "color-mix(in srgb, #ef4444 40%, var(--border))" : "var(--border)"}`,
            background: `linear-gradient(135deg, color-mix(in srgb, ${c} 10%, transparent), transparent 60%), var(--surface)`, opacity: l.expired ? .8 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 22 }}>{ic}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{l.label}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                  créé le {day(l.created)} · {l.views} ouverture{l.views > 1 ? "s" : ""}{l.last_view ? ` (dernière le ${day(l.last_view)})` : ""}</span>
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 900, whiteSpace: "nowrap", color: l.expired ? "#ef4444" : l.expires ? "#d97706" : "#16a34a" }}>
                {l.expired ? "expiré" : l.expires ? `jusqu'au ${day(l.expires)}` : "sans fin"}</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
              <a href={url(l)} target="_blank" rel="noopener noreferrer" style={chip}>↗ Ouvrir</a>
              <button type="button" onClick={() => copy(l)} style={chip}>📋 Copier</button>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", marginLeft: 4 }}>{l.expired ? "Rouvrir pour" : "Durée"} :</span>
              {DUR.map(([n, lb]) => <button key={n} type="button" onClick={() => setDur(l, n)} style={chip}>{lb}</button>)}
              <button type="button" onClick={() => del(l)} style={{ ...chip, color: "#ef4444", marginLeft: "auto" }}>Supprimer</button>
            </div>
          </div>; })}
      </div>}
  </div>;
}
