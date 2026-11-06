import React, { useEffect, useState } from "react";
import client from "../api/client";
import { openMenu } from "./ContextMenu";
import { egg } from "../eggs";

// Les couleurs du createur et ce qui les remplace (28/10/2026) : la deduction de l'appli (pieces de meme nom,
// couleur notee au tranchage, couleur et poids), et, quand elle se trompe, le choix a la main parmi les filaments
// de l'impression ou du groupe -- garde sur le serveur, pour la carte comme pour la vue 3D.
const HOW = { "pièces": "trouvé par les pièces de même nom", tranchage: "même couleur notée au tranchage",
  "couleur et poids": "la bobine la plus ressemblante, en couleur et en poids", "élimination": "par élimination : la seule bobine qui restait",
  choisi: "choisi à la main" };

const Sw = ({ c, size = 14 }) => <span style={{ width: size, height: size, borderRadius: "50%", display: "inline-block", flexShrink: 0,
  border: "1px solid var(--border)", background: c ? `#${c}` : "repeating-linear-gradient(45deg, var(--surface2) 0 3px, var(--border) 3px 6px)" }}/>;

// la rangee de paires ; scope : on peut choisir (onChoose(origin, body) envoie le choix) ; plate : le choix vaut pour ce
// plateau seulement (03/11/2026 : l'assemble prend les couleurs de chaque plateau)
export function ColorPairs({ detail = [], options = [], chosen = {}, scope = null, onChoose = null, label = "Correspondance :", plate = null, todo = [] }) {
  if (!detail.length) return null;
  const ck = o => (plate != null ? `${o}@${plate}` : o);
  const pick = (e, x) => {
    if (!scope || !onChoose) return;
    // le meme filament (couleur, nom, marque et type) utilise par plusieurs impressions : une seule ligne, la plus
    // recente, avec le nombre d'impressions et le total des grammes
    const byFil = new Map();
    for (const o of options) {
      const k = `${o.color}|${o.name || ""}|${o.kind || ""}`;
      const h = byFil.get(k);
      if (h) { h.n += 1; h.grams += o.grams || 0; } else byFil.set(k, { ...o, n: 1, grams: o.grams || 0 });
    }
    const g = v => String(Math.round(v * 10) / 10).replace(".", ",");
    const items = [...byFil.values()].map(o => ({ icon: <Sw c={o.color} size={16}/>, label: `${o.name || `Filament n°${o.slot}`}${o.kind ? ` — ${o.kind}` : ""}`,
        hint: `${o.n > 1 ? `${o.n} impressions` : o.print_name}${o.grams ? ` · ${g(o.grams)} g` : ""}`,
        onClick: () => onChoose(x.from, { print: o.print, slot: o.slot }) }));
    // les filaments retenus dans « A faire » (06/11/2026) : celui prevu pour cette couleur d'abord, puis les autres
    const seenT = new Set();
    const tItems = [...todo].sort((a, b) => (b.origin === x.from) - (a.origin === x.from))
      .filter(o => { const k = `${o.fil}|${o.todo}`; if (seenT.has(k)) return false; seenT.add(k); return true; })
      .map(o => ({ icon: <Sw c={o.color} size={16}/>, label: `${o.name}${o.kind ? ` — ${o.kind}` : ""}`,
        hint: `${o.origin === x.from ? "prévu pour cette couleur · " : ""}À faire${o.label ? ` · ${o.label}` : ""}`,
        onClick: () => onChoose(x.from, { fil: o.fil, color: o.color }) }));
    const head = t => ({ label: t, disabled: true });
    openMenu(e, { title: `Couleur n°${x.e} du créateur : quelle bobine la remplace ?`, items: [
      ...(tItems.length ? [head("📋 Prévu dans « À faire »"), ...tItems, "-", head("🖨️ Déjà imprimé")] : []),
      ...items, items.length ? "-" : null,
      { icon: "🚫", label: "Aucune", hint: "Cette couleur n'a pas été imprimée", onClick: () => onChoose(x.from, { none: true }) },
      chosen?.[ck(x.from)] && !chosen[ck(x.from)].group ? { icon: "✨", label: plate != null ? "Comme les autres plateaux" : "Automatique",
        hint: plate != null ? "Retirer le choix propre à ce plateau" : "Revenir à la déduction de l'appli", onClick: () => onChoose(x.from, { auto: true }) } : null,
      chosen?.[ck(x.from)]?.group ? { icon: "👥", label: "Comme le groupe", hint: "Ce choix vient du groupe : retirer celui de cette impression", disabled: true } : null,
    ] });
  };
  return <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
    <span>{label}</span>
    {detail.map(x => {
      const tip = (x.todo ? `Filament n°${x.e} du projet → un filament retenu dans « À faire » (choisi à la main)`
        : x.to ? `Filament n°${x.e} du projet → n°${x.es} de l'impression (${HOW[x.how] || "par son numéro"})`
        : `Filament n°${x.e} : ${x.how === "choisi" ? "aucune, choisi à la main" : "aucune de ces impressions ne l'a utilisé"}`)
        + (x.other_profile ? " · impression d'un autre profil du modèle" : "") + (x.group ? " · choix fait sur le groupe" : "")
        + (x.plate != null ? ` · choisi pour le plateau ${x.plate} seulement` : "") + (scope ? " · touche pour choisir" : "");
      const hand = x.how === "choisi";
      return <span key={`${x.from}-${x.e}`} data-tip={tip} onClick={e => { e.stopPropagation(); pick(e, x); }} role={scope ? "button" : undefined}
        style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 12, cursor: scope ? "pointer" : "default",
          background: hand ? "color-mix(in srgb, #0EA5E9 14%, var(--surface2))" : "var(--surface2)",
          border: hand ? "1px solid color-mix(in srgb, #0EA5E9 45%, transparent)" : "1px solid transparent" }}>
        <Sw c={x.from}/><span>→</span><Sw c={x.to}/>{hand && <span style={{ fontSize: 10 }}>{x.group ? "👥" : "✋"}{x.plate != null ? <b style={{ fontSize: 9.5, color: "#0EA5E9" }}> P{x.plate}</b> : null}</span>}</span>;
    })}
  </div>;
}

export async function chooseColor(scope, origin, body) {
  await client.post(`/makerworld/3d/colors/set`, { scope, origin, ...body });
  egg("daltonien");
}

// La rangee sur la carte MakerWorld d'une impression ou d'un groupe : les couleurs du 3MF d'origine garde (rien
// sans lui), leur correspondance, et le choix a la main. wait : le profil se deduit encore.
export default function ColorMap({ designId, profileId = null, printId = null, usedPrints = [], scope = null, wait = false, style = {} }) {
  const [d, setD] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (wait || !designId || !usedPrints.length) return;
    let alive = true;
    client.get(`/makerworld/3d/${encodeURIComponent(designId)}/colors`, { params: { profile: profileId || "", print_id: printId || 0,
      used: usedPrints.join(","), scope: scope || "" } })
      .then(({ data }) => alive && setD(data)).catch(() => alive && setD(null));
    return () => { alive = false; };
  }, [designId, profileId, printId, wait, scope, usedPrints.join(","), tick]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d?.colors?.length || !d.detail?.length) return null;
  const onChoose = async (origin, body) => { try { await chooseColor(d.scope, origin, body); } catch { /* rien */ } setTick(t => t + 1); };
  return <div style={style} onClick={e => e.stopPropagation()}>
    <ColorPairs detail={d.detail} options={d.options} todo={d.todo || []} chosen={d.chosen} scope={d.scope} onChoose={onChoose} label="🎨 Couleurs :"/>
  </div>;
}
