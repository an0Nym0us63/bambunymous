import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import YearWrapped from "../components/YearWrapped";

// La page publique d'une annee partagee (04/11/2026) : /annee/<lien>, sans compte -- l'animation telle que la voit son
// auteur, ses chiffres figes au moment du partage. Lue par fetch (ni jeton, ni relais de copain).
export default function PublicYear() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/v1/wrapped/public/${encodeURIComponent(token || "")}`)
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(x => alive && setD(x))
      .catch(() => alive && setD({ error: true }));
    return () => { alive = false; };
  }, [token]);
  useEffect(() => { document.title = d?.year ? `Mon année ${d.year} en impressions · BambuNymous` : "BambuNymous"; }, [d?.year]);
  if (!d || d.error) return <div style={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center",
    background: "linear-gradient(160deg, #4F46E5, #EC4899)", color: "#fff", fontFamily: "inherit" }}>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <img src="/icon-192.png" alt="" style={{ width: 64, height: 64, borderRadius: 16 }}/>
      <div style={{ fontSize: 18, fontWeight: 900 }}>{!d ? "Chargement de l'année…" : "Ce lien n'existe pas ou a été retiré."}</div>
    </div>
  </div>;
  return <YearWrapped pub data={d} onClose={() => {}}/>;
}
