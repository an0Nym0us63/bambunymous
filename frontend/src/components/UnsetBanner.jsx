import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import MwImg from "./MwImg";
import { currentFriend } from "../store/friend";

// (11/11/2026) Les modeles de « A faire » sans plan retenu (profil, plateaux, couleurs) : le planning les place avec le
// profil par defaut et les filaments les plus proches, a verifier avant de lancer. Le bandeau les compte, en haut
// d'« A faire » (avec `items` et `onShow` : filtre la liste) et du Calendrier (lus sur /makerworld/queue/unset).
export default function UnsetBanner({ items: given = null, onShow = null, active = false }) {
  const nav = useNavigate();
  const [fetched, setFetched] = useState(null);
  useEffect(() => {
    if (given || currentFriend()) return;
    client.get("/makerworld/queue/unset").then(({ data }) => setFetched(data.items || [])).catch(() => setFetched([]));
  }, [given]);
  const items = given || fetched || [];
  if (!items.length) return null;
  const n = items.length;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 8px 10px", borderRadius: 14, fontSize: 12.5, fontWeight: 800, color: "#B45309",
      background: "radial-gradient(90% 90% at 0% 0%, rgba(245,158,11,0.18), transparent 70%), var(--surface2)", border: "1px dashed rgba(245,158,11,0.6)" }}>
      <span style={{ display: "flex", flexShrink: 0 }}>
        {items.slice(0, 3).map((x, i) => x.cover_url && <MwImg key={x.design_id} src={x.cover_url} alt=""
          style={{ width: 26, height: 26, borderRadius: 7, objectFit: "cover", marginLeft: i ? -9 : 0, border: "2px solid var(--surface2)" }}/>)}
      </span>
      <span style={{ flex: 1, minWidth: 0 }} data-tip={items.slice(0, 12).map(x => x.title_fr || x.title).join(" · ")}>
        📌 {n} modèle{n > 1 ? "s" : ""} à régler : profil et couleurs pas encore choisis</span>
      <button onClick={() => (onShow ? onShow() : nav("/prints?tab=queue&filter=unset"))}
        style={{ padding: "5px 12px", borderRadius: 20, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 900, color: "#fff", whiteSpace: "nowrap",
          background: active ? "linear-gradient(135deg, #64748B, #475569)" : "linear-gradient(135deg, #F59E0B, #EA580C)" }}>
        {active ? "Tout voir" : "Les voir"}</button>
    </div>
  );
}
