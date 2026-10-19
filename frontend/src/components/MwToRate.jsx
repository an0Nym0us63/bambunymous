import React, { useEffect, useState } from "react";
import client from "../api/client";
import MwImg from "./MwImg";
import Lightbox from "./Lightbox";

// « ⭐ À évaluer » : mes impressions de modèles MakerWorld pas encore évaluées,
// avec mes photos (du print, sinon de son groupe) prêtes à joindre.
// Une seule lecture partagee (gardee 5 min) : la liste, les vignettes de
// l'historique et les fiches s'en servent toutes.
let _last = null, _p = null, _t = 0;
function readToRate() {
  if (!_p || Date.now() - _t > 300000) {
    _t = Date.now();
    _p = client.get("/makerworld/to-rate").then(({ data }) => (_last = data)).catch(() => _last);
  }
  return _p;
}
export function useToRate(enabled) {
  const [data, setData] = useState(_last);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    readToRate().then(d => alive && d && setData(d));
    return () => { alive = false; };
  }, [enabled]);
  return enabled ? data : null;           // chez un copain : rien de ma liste
}
// Modeles a evaluer (ensemble d'identifiants), chez moi seulement.
export function useToRateSet(enabled = true) {
  const d = useToRate(enabled);
  return new Set((d?.items || []).map(x => String(x.design_id)));
}
export const rateUrl = (did) => `https://makerworld.com/fr/models/${did}`;

const day = d => d ? new Date(d).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "";

export function ToRateTile({ data, onClick, card }) {
  const n = data?.items?.length || 0;
  const covers = (data?.items || []).flatMap(x => x.photos?.length ? [x.photos[0]] : x.cover_url ? [x.cover_url] : []).slice(0, 4);
  return (
    <button onClick={onClick} style={{ ...card, cursor: "pointer", padding: 0, textAlign: "left", color: "var(--text)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", aspectRatio: "1", background: "var(--surface)", position: "relative" }}>
        {covers.map((u, i) => u.startsWith("/api/") ? <img key={i} src={u} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
          : <MwImg key={i} src={u} w={160} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>)}
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34,
          textShadow: "0 2px 8px rgba(0,0,0,0.6)" }}>⭐</span>
      </div>
      <div style={{ padding: "7px 8px 8px" }}>
        <div style={{ fontSize: 12.5, fontWeight: 700 }}>À évaluer</div>
        <div style={{ fontSize: 10.5, color: "var(--muted)" }}>{n} modèle{n > 1 ? "s" : ""} imprimé{n > 1 ? "s" : ""}</div>
      </div>
    </button>
  );
}

export function ToRateSheet({ data, onClose, onOpen }) {
  const [view, setView] = useState(null);
  const items = data?.items || [];
  return (
    <div data-no-pull="" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 4100, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} className="sheet-panel" style={{ width: "100%", maxWidth: 760, height: "92vh",
        borderRadius: "18px 18px 0 0", border: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px 10px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>⭐ À évaluer</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {data?.rated_known === false ? "Tes évaluations n'ont pas pu être lues : tout est listé."
                : "Imprimés, pas encore évalués. Tes photos sont prêtes à joindre."}</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 20,
            cursor: "pointer", padding: 4 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {!items.length && <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 24 }}>Rien à évaluer 🎉</p>}
          {items.map(x => (
            <div key={x.design_id} className="card" style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {x.cover_url ? <MwImg src={x.cover_url} w={110} style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}/>
                  : <span style={{ width: 48, height: 48, borderRadius: 8, background: "var(--surface2)", flexShrink: 0 }}/>}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {x.title || x.print_name || `Modèle ${x.design_id}`}</div>
                  <div style={{ fontSize: 11, color: "var(--muted)" }}>
                    {[x.creator_name && `par ${x.creator_name}`, x.printed > 0 && `imprimé ${x.printed}×`, x.last_date && `le ${day(x.last_date)}`].filter(Boolean).join(" · ")}</div>
                  {x.awaited && <div style={{ fontSize: 10.5, color: "#f59e0b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    ⏳ Attendu par MakerWorld{x.profile_title ? ` · profil « ${x.profile_title} »` : ""}</div>}
                </div>
              </div>
              {x.photos?.length > 0 ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {x.photos.map((u, i) => (
                    <img key={i} src={u} alt="" onClick={() => setView({ images: x.photos, index: i })}
                      style={{ width: 62, height: 62, borderRadius: 8, objectFit: "cover", cursor: "pointer", border: "1px solid var(--border)" }}/>
                  ))}
                  <span style={{ alignSelf: "center", fontSize: 10.5, color: "var(--muted)" }}>
                    {x.photo_source === "group" ? "photos du groupe" : "tes photos"}</span>
                </div>
              ) : <div style={{ fontSize: 11, color: "var(--muted)" }}>Pas de photo de cette impression.</div>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a href={x.url} target="_blank" rel="noopener noreferrer" style={{ padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 700,
                  background: "#f59e0b", color: "white", textDecoration: "none" }}>⭐ Évaluer sur MakerWorld ↗</a>
                <button onClick={() => onOpen?.(x)} style={{ padding: "6px 12px", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer",
                  background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }}>Fiche</button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {view && <div onClick={e => e.stopPropagation()}><Lightbox images={view.images} index={view.index} onClose={() => setView(null)}/></div>}
    </div>
  );
}
