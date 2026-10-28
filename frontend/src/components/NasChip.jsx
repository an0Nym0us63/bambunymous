import React, { useState } from "react";
import client from "../api/client";
import { openMenu } from "./ContextMenu";
import { egg } from "../eggs";

// La pastille « sur le NAS » (28/10/2026) : une impression ou un groupe dont des fichiers (timelapse, captures des
// couches, 3MF tranche, videos) ont ete vides du local par une purge et ne sont plus que sur le NAS. Un clic ouvre
// le detail : chaque fichier, sa taille, et si le NAS repond en ce moment.
const fmtSize = n => n == null ? "" : n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} Mo` : n >= 1024 ? `${Math.round(n / 1024)} Ko` : `${n} o`;

/** url : /prints/{id}/nas ou /prints/groups/{id}/nas ; count : ce que la fiche sait deja (la liste en porte le nombre) */
export default function NasChip({ count, url, what = "cette impression", style = {} }) {
  const [busy, setBusy] = useState(false);
  if (!count) return null;
  const open = async e => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const { data } = await client.get(url);
      egg("archiviste");
      // juste l'information, par type (28/10/2026 : le detail fichier par fichier etait inutile) : combien, et
      // quel poids, pour l'impression (ou toutes celles du groupe) et pour le modele MakerWorld
      const files = [...(data.files || []), ...(data.prints || []).flatMap(p => p.files),
        ...(data.model || []), ...(data.models || []).flatMap(m => m.files)];
      const TYPES = [["capture", "🎞️", "Captures des couches"], ["timelapse", "⏩", "Timelapses"], ["video", "🎬", "Vidéos"],
        ["3mf", "📐", "3MF tranchés"], ["lib", "📦", "3MF d'origine"], ["3d", "🧊", "Vues 3D"], ["doc", "📄", "Documents"], ["other", "📁", "Autres"]];
      const typeOf = f => f.kind || (f.label.startsWith("Capture") ? "capture" : f.label === "Timelapse" ? "timelapse" : f.label === "Vidéo" ? "video"
        : f.label === "3MF tranché" ? "3mf" : "other");
      const by = {};
      for (const f of files) { const t = typeOf(f); const e = by[t] || (by[t] = { n: 0, size: 0, present: 0 }); e.n += 1; e.size += f.size || 0; e.present += f.present ? 1 : 0; }
      const items = TYPES.filter(([t]) => by[t]).map(([t, icon, label]) => ({ icon, label: `${label} · ${by[t].n}`, disabled: true,
        hint: [fmtSize(by[t].size) || null, by[t].present < by[t].n ? (by[t].present ? `${by[t].n - by[t].present} ne répond${by[t].n - by[t].present > 1 ? "ent" : ""} pas` : "ne répond pas") : null].filter(Boolean).join(" · ") }));
      openMenu(e, { title: `Sur le NAS seulement · ${files.length}`, color: "#0EA5E9",
        subtitle: data.reachable === false ? "⚠️ Le NAS ne répond pas : ces fichiers sont inaccessibles pour l'instant"
          : `Vidés du local par une purge : ${what} les lit sur le NAS`,
        items });
    } catch { /* rien : la pastille reste */ }
    setBusy(false);
  };
  return (
    <span role="button" tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e); } }}
      data-tip={`${count} fichier${count > 1 ? "s" : ""} (timelapse, captures, 3MF, vue 3D…) seulement sur le NAS · touche pour le compte par type`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 20, fontSize: 11.5, fontWeight: 800,
        color: "#0EA5E9", background: "color-mix(in srgb, #0EA5E9 14%, transparent)", border: "1px solid color-mix(in srgb, #0EA5E9 35%, transparent)",
        cursor: "pointer", opacity: busy ? 0.6 : 1, ...style }}>
      🗄️ {count} sur le NAS</span>
  );
}
