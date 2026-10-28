import React, { useState } from "react";
import client from "../api/client";
import { openMenu } from "./ContextMenu";
import { egg } from "../eggs";

// La pastille « sur le NAS » (28/10/2026) : une impression ou un groupe dont des fichiers (timelapse, captures des
// couches, 3MF tranche, videos) ont ete vides du local par une purge et ne sont plus que sur le NAS. Un clic ouvre
// le detail : chaque fichier, sa taille, et si le NAS repond en ce moment.
const fmtSize = n => n == null ? "" : n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} Mo` : n >= 1024 ? `${Math.round(n / 1024)} Ko` : `${n} o`;
const dayFr = ts => ts ? new Date(ts * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : null;

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
      // les fichiers de l'impression (ou de chaque impression du groupe), puis ceux du modele MakerWorld (vue 3D,
      // 3MF d'origine, documents : lies au modele, pas a une impression)
      const files = data.files ? data.files.map(f => ({ ...f })) : (data.prints || []).flatMap(p => p.files.map(f => ({ ...f, print: p.name, pid: p.id })));
      const model = data.model ? data.model : (data.models || []).flatMap(m => m.files);
      const byPrint = !!data.prints;
      const items = [];
      let last = null;
      const row = (f, pid) => ({ icon: f.icon, label: f.label, disabled: !f.present,
        // le nom du fichier quand le libelle ne suffit pas (deux 3MF tranches, plusieurs videos)
        hint: [["3MF tranché", "Vidéo", "Photo", "3MF d'origine"].includes(f.label) ? f.name : null, fmtSize(f.size), f.at ? `copié le ${dayFr(f.at)}` : null,
          f.present ? null : "ne répond pas"].filter(Boolean).join(" · "),
        onClick: pid && f.present ? () => window.open(`/api/v1/prints/${pid}/file/${encodeURIComponent(f.name)}`, "_blank", "noopener") : undefined });
      for (const f of files) {
        if (byPrint && f.print !== last) { if (items.length) items.push("-"); items.push({ icon: "🖨️", label: f.print, disabled: true }); last = f.print; }
        items.push(row(f, f.pid ?? url.match(/\/prints\/(\d+)\/nas/)?.[1]));
      }
      if (model.length) {
        if (items.length) items.push("-");
        items.push({ icon: "📦", label: byPrint ? "Modèles MakerWorld du groupe" : "Modèle MakerWorld", hint: "repris du NAS à l'ouverture de la vue 3D ou du document", disabled: true });
        for (const f of model) items.push(row(f, null));
      }
      const n = files.length + model.length;
      openMenu(e, { title: `Sur le NAS seulement · ${n}`, color: "#0EA5E9",
        subtitle: data.reachable === false ? "⚠️ Le NAS ne répond pas : ces fichiers sont inaccessibles pour l'instant"
          : `Vidés du local par une purge, ${what} les lit sur le NAS (touche un fichier pour l'ouvrir)`,
        items });
    } catch { /* rien : la pastille reste */ }
    setBusy(false);
  };
  return (
    <span role="button" tabIndex={0} onClick={open} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(e); } }}
      data-tip={`${count} fichier${count > 1 ? "s" : ""} (timelapse, captures, 3MF…) seulement sur le NAS · touche pour le détail`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px", borderRadius: 20, fontSize: 11.5, fontWeight: 800,
        color: "#0EA5E9", background: "color-mix(in srgb, #0EA5E9 14%, transparent)", border: "1px solid color-mix(in srgb, #0EA5E9 35%, transparent)",
        cursor: "pointer", opacity: busy ? 0.6 : 1, ...style }}>
      🗄️ {count} sur le NAS</span>
  );
}
