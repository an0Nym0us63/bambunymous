import React, { useState, useEffect } from "react";
import client from "../api/client";

/**
 * Bouton de creation d'objets, qui porte son propre quota.
 *
 * Il annonce combien d'objets existent deja sur le total declare, et se
 * desactive quand il n'en reste aucun -- plutot que de laisser tenter une
 * creation qui sera refusee. L'information et l'action vivent au meme endroit,
 * ce qui evite d'avoir a la repeter ailleurs dans la fiche.
 *
 * refreshKey permet au parent de forcer une relecture apres une creation, sans
 * que ce composant ait a connaitre ce qui s'est passe.
 */
export default function ObjectQuotaButton({ parentType, parentId, label, onOpen, refreshKey }) {
  const [q, setQ] = useState(null);

  useEffect(() => {
    let alive = true;
    client.get("/objects/objects/quota", { params:{ parent_type:parentType, parent_id:parentId } })
      .then(r => { if (alive) setQ(r.data); })
      .catch(() => { if (alive) setQ(null); });
    return () => { alive = false; };
  }, [parentType, parentId, refreshKey]);

  const done = q && q.remaining <= 0;

  return (
    <button onClick={() => !done && onOpen()} disabled={done}
      style={{ width:"100%", padding:"10px", borderRadius:10, marginBottom:14,
        border:"1px solid " + (done ? "var(--border)" : "rgba(34,197,94,0.3)"),
        background: done ? "var(--surface2)" : "rgba(34,197,94,0.06)",
        color: done ? "var(--muted)" : "#22c55e",
        fontSize:12, fontWeight:700, cursor: done ? "default" : "pointer",
        display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
      <span>📦 {done ? "Tous les objets sont créés" : `Créer des objets ${label}`}</span>
      {q && (
        <span style={{ fontSize:10.5, fontWeight:800, padding:"2px 8px", borderRadius:20,
          background: done ? "rgba(148,163,184,0.2)" : "rgba(34,197,94,0.18)",
          fontFamily:"'JetBrains Mono',ui-monospace,monospace" }}>
          {q.used} / {q.total}
        </span>
      )}
    </button>
  );
}
