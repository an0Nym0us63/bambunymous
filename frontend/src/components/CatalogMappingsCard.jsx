import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { FSheet, fBtn } from "./FicheKit";
import CatalogNamesCard from "./CatalogNamesCard";
import TypeTranscoCard from "./TypeTranscoCard";
import FamilyMapCard from "./FamilyMapCard";

// Les correspondances des catalogues (03/11/2026), chacune dans sa fenetre (la page des Parametres restait sinon
// interminable) : les noms (traductions), les sous-types (gamme d'un catalogue -> notre sous-type), les familles
// (sous-type -> famille). Chaque fenetre : chercher, ajouter, modifier, supprimer.
const KINDS = [
  { id: "names", icon: "🔤", c: "#8B5CF6", title: "Noms des couleurs", sub: "Nom anglais du catalogue → notre nom français",
    help: "Le catalogue Bambu n'a pas traduit toutes ses couleurs, et certaines traductions ne collent pas à la boutique. Nos noms passent avant le catalogue (scan RFID, AMS, commandes, fiches filament) ; en enregistrant, les fiches qui portaient l'ancien nom sont renommées, un nom tapé à la main n'est jamais touché." },
  { id: "types", icon: "🔀", c: "#0EA5E9", title: "Sous-types des catalogues", sub: "Gamme d'une autre marque → notre sous-type",
    help: "Les gammes des autres marques sont remises d'office à la manière de Bambu (« Fil PLA » → « PLA Basic », « Matte PLA » → « PLA Matte ») ; une transco à toi passe avant. Elles valent à la création, au rattachement et à la synchro des catalogues." },
  { id: "families", icon: "🧬", c: "#16A34A", title: "Familles", sub: "Sous-type → famille (la matière)",
    help: "La famille (PLA, PETG…) se déduit du sous-type (« PLA Silk » → PLA). Quand la déduction se trompe ou ne trouve rien (« PET-G », « PEEK CF »), une famille à toi passe avant ; en enregistrant, la matière des filaments concernés suit." },
];

export default function CatalogMappingsCard({ card, cardTitle }) {
  const [open, setOpen] = useState(null);
  const [n, setN] = useState({});
  const counts = () => Promise.all([
    client.get("/filaments/catalog-names").then(r => (r.data.items || []).length).catch(() => null),
    client.get("/filaments/catalog/type-transco").then(r => (r.data.items || []).length).catch(() => null),
    client.get("/filaments/catalog/family-map").then(r => (r.data.items || []).length).catch(() => null),
  ]).then(([names, types, families]) => setN({ names, types, families }));
  useEffect(() => { counts(); }, []);
  const k = KINDS.find(x => x.id === open);
  return <div className="card" style={card}>
    <div style={{ ...cardTitle, display: "flex", alignItems: "center", gap: 6 }}>🗂️ Correspondances des catalogues</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {KINDS.map(x => <button key={x.id} type="button" onClick={() => setOpen(x.id)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%",
        textAlign: "left", padding: "10px 12px", borderRadius: 14, cursor: "pointer", border: `1px solid ${x.c}44`,
        background: `linear-gradient(135deg, ${x.c}18, transparent 70%), var(--surface)` }}>
        <span style={{ width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
          background: `${x.c}22` }}>{x.icon}</span>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{x.title}</span>
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>{x.sub}</span></span>
        {n[x.id] != null && <span style={{ fontSize: 12, fontWeight: 900, color: x.c, flexShrink: 0 }}>{n[x.id]}</span>}
        <span style={{ fontSize: 16, color: "var(--muted)", flexShrink: 0 }}>›</span>
      </button>)}
    </div>
    {k && createPortal(<FSheet onClose={() => { setOpen(null); counts(); }} z={1500}
      bottom={<button onClick={() => { setOpen(null); counts(); }} style={{ ...fBtn, flex: 1 }}>Fermer</button>}>
      <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: k.c }}>{k.icon} {k.title}</div>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45 }}>{k.help}</div>
        {open === "names" ? <CatalogNamesCard bare/> : open === "types" ? <TypeTranscoCard bare/> : <FamilyMapCard/>}
      </div>
    </FSheet>, document.body)}
  </div>;
}
