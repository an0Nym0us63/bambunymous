// L'animation d'un modele prise dans la vue 3D (08/11/2026) : les options (l'effet, le format, la duree, la qualite, le
// fond), puis l'enregistrement en tache de fond : un bandeau en bas de l'ecran le suit (il reste meme si on ferme la vue
// 3D), et l'animation part ranger avec les vues 3D de l'impression ou du groupe. WebM (MP4 la ou le navigateur ne sait
// faire que ca) : lu en boucle dans l'appli, et partage tel quel (Telegram et les autres le lisent).
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import client from "../api/client";
import { FSheet, fBtn } from "./FicheKit";
import { egg } from "../eggs";
import { BACKDROPS } from "./animBackdrops";

// les effets : [cle, icone, nom, ce qu'il fait, l'animation de son icone, ses options (voir OPTS)]
export const ANIM_STYLES = [
  ["turntable", "🎠", "Plateau tournant", "L'objet tourne sur lui-même, la lumière reste fixe : les reflets glissent sur la matière.", "bnA-spin", ["dir", "arc", "trip", "start", "ease"]],
  ["orbit", "🎥", "Tour de caméra", "On fait le tour de l'objet : chaque face passe de l'ombre à la lumière.", "bnA-orbit", ["dir", "arc", "trip", "start", "ease"]],
  ["swing", "↔️", "Balancement", "Un aller-retour : pour un objet qui a une belle face (plaque, lithophane).", "bnA-swing", ["swing", "dir", "start", "ease"]],
  ["travel", "🛤️", "Travelling", "La caméra glisse de côté en visant l'objet : du relief, de la profondeur.", "bnA-travel", ["dir", "trip", "start", "ease"]],
  ["zoom", "🔍", "Zoom", "On s'approche jusqu'aux détails, en tournant un peu.", "bnA-zoom", ["zoom", "trip", "start", "ease"]],
  ["reveal", "🎬", "Révélation", "Vu du dessus, on descend en tournant jusqu'à l'angle de départ.", "bnA-reveal", ["reveal", "dir", "trip", "start", "ease"]],
  ["spiral", "🌀", "Spirale", "Le tour en montant et en descendant, avec une respiration de zoom.", "bnA-spiral", ["dir", "arc", "start"]],
  ["drone", "🚁", "Survol", "Le tour vu de haut, comme un drone, en se rapprochant à mi-parcours.", "bnA-orbit", ["dir", "arc", "start"]],
  ["float", "🎈", "Lévitation", "L'objet flotte et ondule doucement, comme posé sur un coussin d'air.", "bnA-float", ["dir", "start"]],
  ["vertigo", "🌪️", "Effet vertigo", "La caméra recule en zoomant : l'objet garde sa taille, la perspective s'écrase (le fameux plan de cinéma).", "bnA-zoom", ["vertigo", "trip", "start", "ease"]],
  ["dive", "🦅", "Plongée", "De loin et de haut, on fond sur l'objet jusqu'au détail.", "bnA-reveal", ["dive", "dir", "trip", "start", "ease"]],
  ["crane", "🏗️", "Grue", "Du ras du sol jusqu'au-dessus de l'objet, comme une caméra sur une grue.", "bnA-reveal", ["crane", "dir", "trip", "start", "ease"]],
  ["spotlight", "🔦", "Projecteur", "L'objet ne bouge pas : un projecteur en fait le tour, les ombres et les reflets tournent.", "bnA-spin", ["dir", "arc", "trip", "start", "ease"]],
];
// les options d'un effet : [titre, [[valeur, libelle], ...], la cle reglee] ; les options « sens » propres a un effet
// reglent rev (A -> B ou B -> A) avec leurs propres mots
const OPTS = {
  dir: ["Sens", [[1, "↻ Horaire"], [-1, "↺ Anti-horaire"]], "dir"],
  arc: ["Amplitude", [[360, "Tour complet"], [180, "Demi-tour"], [90, "Quart de tour"]], "arc"],
  swing: ["Amplitude", [[60, "Petite"], [90, "Moyenne"], [180, "Grande"]], "arc"],
  trip: ["Parcours", [["loop", "🔁 Aller-retour (boucle)"], ["once", "➡️ Aller simple"]], "trip"],
  start: ["Départ", [["view", "👁 Ma vue"], ["front", "De face"], ["three", "De 3/4"], ["side", "De côté"], ["top", "De dessus"]], "start"],
  ease: ["Mouvement", [["smooth", "Adouci"], ["linear", "Constant"]], "ease"],
  zoom: ["Direction", [[false, "S'approcher"], [true, "Reculer"]], "rev"],
  reveal: ["Direction", [[false, "Du dessus vers le départ"], [true, "Du départ vers le dessus"]], "rev"],
  vertigo: ["Direction", [[false, "La caméra recule"], [true, "La caméra avance"]], "rev"],
  dive: ["Direction", [[false, "Fondre sur l'objet"], [true, "S'envoler"]], "rev"],
  crane: ["Direction", [[false, "Monter"], [true, "Descendre"]], "rev"],
};
const DEF = { style: "turntable", secs: 6, short: 720, ratio: "1:1", bg: "studio", dir: 1, arc: 360, trip: "loop", rev: false, start: "view", ease: "smooth" };
const RATIOS = [["1:1", "◻ Carré"], ["16:9", "▭ Paysage"], ["9:16", "▯ Portrait"]];
const DURS = [4, 6, 8, 12];
const SIZES = [[480, "Légère"], [720, "Nette"], [1080, "HD"]];
const BGS = BACKDROPS;
const KEY = "bn_anim3d";
const load = () => { try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { ...DEF }; } };
// ce que l'effet choisi recoit vraiment : ses options, les autres a leur valeur par defaut (une amplitude de balancement
// n'est pas un demi-tour de plateau)
export const animOpts = o => { const st = ANIM_STYLES.find(s => s[0] === o.style) || ANIM_STYLES[0], keys = st[5].map(k => OPTS[k][2]);
  const x = { ...o };
  for (const k of ["dir", "arc", "trip", "rev", "start", "ease"]) if (!keys.includes(k)) x[k] = DEF[k];
  if (st[5].includes("swing") && ![60, 90, 180].includes(x.arc)) x.arc = 90;
  if (st[5].includes("arc") && ![360, 180, 90].includes(x.arc)) x.arc = 360;
  return x; };

// la fenetre des options ; onStart(opts, target)
export function AnimSheet({ targets, onStart, onClose }) {
  const [o, setO] = useState(load);
  const set = (k, v) => setO(x => { const n = { ...x, [k]: v }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* rien */ } return n; });
  const chip = on => ({ padding: "6px 11px", borderRadius: 20, fontSize: 12, fontWeight: 800, cursor: "pointer", fontFamily: "inherit", color: "var(--text)",
    border: on ? "1.5px solid #8B5CF6" : "1px solid var(--border)", background: on ? "color-mix(in srgb, #8B5CF6 14%, var(--surface))" : "var(--surface2)" });
  const cur = ANIM_STYLES.find(s => s[0] === o.style) || ANIM_STYLES[0], eff = animOpts(o);
  const row = (label, items) => <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span style={{ fontSize: 11, fontWeight: 900, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</span>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{items}</div></div>;
  return createPortal(<FSheet onClose={onClose} z={6000} bottom={<>
    {targets.map(t => <button key={t.kind} type="button" onClick={() => onStart(animOpts(o), t)} style={{ ...fBtn, flex: 1, border: "none", color: "#fff",
      background: t.kind === "group" ? "linear-gradient(135deg, #A78BFA, #7C3AED)" : "linear-gradient(135deg, #8B5CF6, #EC4899)" }}>
      🎬 {targets.length > 1 ? (t.kind === "group" ? "Pour le groupe" : "Pour l'impression") : "Lancer"}</button>)}
    </>}>
    <style>{`@keyframes bnA-spin{to{transform:rotateY(360deg)}}@keyframes bnA-orbit{0%{transform:translateX(-5px) scale(.9)}50%{transform:translateX(5px) scale(1.1)}100%{transform:translateX(-5px) scale(.9)}}
      @keyframes bnA-swing{0%,100%{transform:rotate(-18deg)}50%{transform:rotate(18deg)}}@keyframes bnA-travel{0%,100%{transform:translateX(-6px)}50%{transform:translateX(6px)}}
      @keyframes bnA-zoom{0%,100%{transform:scale(.8)}50%{transform:scale(1.25)}}@keyframes bnA-reveal{0%,100%{transform:translateY(-6px) scale(.85)}50%{transform:translateY(2px) scale(1.1)}}
      @keyframes bnA-spiral{to{transform:rotate(360deg) scale(1)}}@keyframes bnA-float{0%,100%{transform:translateY(3px) rotate(-6deg)}50%{transform:translateY(-4px) rotate(6deg)}}
      @media (prefers-reduced-motion:reduce){.bnA-ic{animation:none!important}}`}</style>
    <div style={{ padding: "52px 16px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>🎞 Animation de la vue</div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", lineHeight: 1.4 }}>Depuis l'angle où tu regardes, sans la grille. Elle se fait en tâche de fond :
          tu peux continuer à regarder, ou fermer la vue 3D. Elle boucle sans à-coup.</div>
      </div>
      <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 210px), 1fr))" }}>
        {ANIM_STYLES.map(([k, ic, name, desc, an]) => <button key={k} type="button" onClick={() => set("style", k)}
          style={{ display: "flex", gap: 10, alignItems: "center", padding: "9px 10px", borderRadius: 14, cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: "var(--text)",
            border: o.style === k ? "1.5px solid #8B5CF6" : "1px solid var(--border)", background: o.style === k ? "color-mix(in srgb, #8B5CF6 12%, var(--surface))" : "var(--surface2)" }}>
          <span className="bnA-ic" style={{ fontSize: 24, flexShrink: 0, width: 32, textAlign: "center", display: "inline-block", animation: o.style === k ? `${an} 2.4s ease-in-out infinite` : "none" }}>{ic}</span>
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 900 }}>{name}</span>
            <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>{desc}</span>
          </span>
        </button>)}
      </div>
      {/* les options de l'effet choisi (08/11/2026) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px", borderRadius: 14, border: "1px solid color-mix(in srgb, #8B5CF6 35%, var(--border))",
        background: "color-mix(in srgb, #8B5CF6 6%, var(--surface))" }}>
        <span style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text)" }}>{cur[1]} {cur[2]} : ses réglages</span>
        {cur[5].filter(k => !(k === "trip" && cur[5].includes("arc") && eff.arc >= 360)).map(k => { const [t, vals, key] = OPTS[k];
          return <React.Fragment key={k}>{row(t, vals.map(([v, l]) => <button key={String(v)} type="button" onClick={() => set(key, v)} style={chip(eff[key] === v)}>{l}</button>))}</React.Fragment>; })}
        {cur[5].includes("arc") && eff.arc >= 360 && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>Un tour complet boucle de lui-même ; moins d'un tour fait l'aller-retour, ou l'aller simple.</span>}
        {eff.trip === "once" && <span style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)" }}>Aller simple : du départ à l'arrivée, sans revenir (la vidéo ne boucle pas sans saut).</span>}
      </div>
      {row("Format", RATIOS.map(([k, l]) => <button key={k} type="button" onClick={() => set("ratio", k)} style={chip(o.ratio === k)}>{l}</button>))}
      {row("Durée", DURS.map(s => <button key={s} type="button" onClick={() => set("secs", s)} style={chip(o.secs === s)}>{s} s</button>))}
      {row("Qualité", SIZES.map(([s, l]) => <button key={s} type="button" onClick={() => set("short", s)} style={chip(o.short === s)}>{l} · {s} px</button>))}
      {row("Fond", BGS.map(([k, l]) => <button key={k} type="button" onClick={() => set("bg", k)} style={chip(o.bg === k)}>{l}</button>))}
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", lineHeight: 1.4 }}>
        Transparent : seulement si le navigateur sait garder la transparence dans une vidéo (c'est rare) ; sinon, studio sombre. La vue de nuit et la lumière par derrière ne sont pas reprises :
        l'animation se fait de jour. Une animation par effet : refaire le même effet remplace la sienne.</div>
    </div>
  </FSheet>, document.body);
}

// le bandeau qui suit l'enregistrement, en haut au milieu de l'ecran (08/11/2026 : en bas a gauche, on ne le voyait pas),
// hors de la vue 3D (il survit a sa fermeture) ; la vue en plein ecran : il la suit dedans
let host = null, root = null;
function Pill({ st, onClose }) {
  const [view, setView] = useState(false);
  const c = st.state === "error" ? "#EF4444" : st.state === "done" ? "#16A34A" : "#8B5CF6";
  return <>
    <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", top: "calc(12px + env(safe-area-inset-top, 0px))", zIndex: 2147483000,
      width: "min(calc(100vw - 24px), 440px)", boxSizing: "border-box",
      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 16, background: "var(--sheet-bg)", color: "var(--text)",
      border: `1.5px solid color-mix(in srgb, ${c} 50%, var(--border))`, boxShadow: "0 14px 34px rgba(0,0,0,.35)", fontSize: 13, fontWeight: 800 }}>
      <span style={{ fontSize: 18 }}>{st.state === "error" ? "⚠️" : st.state === "done" ? "✅" : "🎬"}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{st.text}</span>
        {(st.state === "render" || st.state === "upload") && <span style={{ height: 5, borderRadius: 5, background: "var(--surface2)", overflow: "hidden" }}>
          <span style={{ display: "block", height: "100%", width: `${Math.round((st.p || 0) * 100)}%`, background: `linear-gradient(90deg, #8B5CF6, #EC4899)`, transition: "width .2s" }}/></span>}
      </span>
      {st.state === "done" && st.url && <button type="button" onClick={() => setView(true)} style={{ padding: "5px 10px", borderRadius: 10, border: "none", cursor: "pointer",
        fontSize: 12, fontWeight: 900, color: "#fff", background: "linear-gradient(135deg, #8B5CF6, #EC4899)" }}>Voir</button>}
      {(st.state === "done" || st.state === "error") && <button type="button" onClick={onClose} aria-label="Fermer" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 16 }}>✕</button>}
    </div>
    {view && <AnimPlayer url={st.url} onClose={() => setView(false)}/>}
  </>;
}
const show = st => {
  if (!host) { host = document.createElement("div"); root = createRoot(host); }
  const where = document.fullscreenElement || document.body;
  if (host.parentNode !== where) where.appendChild(host);
  root.render(<Pill st={st} onClose={hide}/>);
};
const hide = () => { if (root) { root.unmount(); host.remove(); host = null; root = null; } };
// entree ou sortie du plein ecran (la vue 3D qui se ferme en sort aussi) : le bandeau change de parent avec elle
if (typeof document !== "undefined") document.addEventListener("fullscreenchange", () => {
  if (!host) return;
  const where = document.fullscreenElement || document.body;
  if (host.parentNode !== where) where.appendChild(host);
});
let busy = false;

// l'enregistrement en tache de fond : rendu (animate de la vue 3D), puis envoi ; onSaved(anim) une fois range
export async function startAnim(animate, opts, target, onSaved) {
  if (busy) { show({ state: "render", text: "Une animation est déjà en cours…", p: 0 }); return; }
  busy = true;
  const what = target.kind === "group" ? "du groupe" : "de l'impression";
  const fx = ANIM_STYLES.find(s => s[0] === opts.style)?.[2] || "Animation";
  try {
    show({ state: "render", text: `${fx} ${what} · préparation…`, p: 0 });
    let last = 0;
    const r = await animate(opts, p => { if (p - last > 0.02 || p >= 1) { last = p; show({ state: "render", text: `${fx} ${what} · ${Math.round(p * 100)} %`, p }); } });
    if (!r?.blob?.size) throw new Error("Rien d'enregistré");
    show({ state: "upload", text: `Envoi · ${(r.blob.size / 1048576).toFixed(1)} Mo`, p: 0 });
    const fd = new FormData();
    fd.append("file", r.blob, r.type.includes("mp4") ? "anim.mp4" : "anim.webm");
    fd.append("style", opts.style || "");          // une animation par effet : refaire le meme effet remplace celle-la
    const base = target.kind === "group" ? `/prints/groups/${target.id}` : `/prints/${target.id}`;
    const { data } = await client.post(`${base}/vue3d/anim`, fd, { timeout: 180000, onUploadProgress: e => e.total && show({ state: "upload", text: `Envoi · ${(r.blob.size / 1048576).toFixed(1)} Mo`, p: e.loaded / e.total }) });
    const url = data.anim ? `/api/v1${target.kind === "group" ? `/prints/groups/${target.id}/photo` : `/prints/${target.id}/file`}/${data.anim.name}?v=${data.anim.v}` : null;
    egg("animation_3d");
    show({ state: "done", text: `${fx} ${what} enregistré${r.alpha ? " (fond transparent)" : ""} · en tête de la fiche et dans 🧊 Vues 3D`, url });
    onSaved?.(data.anim);
    setTimeout(() => { if (!busy) hide(); }, 12000);
  } catch (e) {
    show({ state: "error", text: `Animation : ${e.response?.data?.detail || e.message || e}` });
  } finally { busy = false; }
}

// la lecture en grand, en boucle
export function AnimPlayer({ url, onClose }) {
  return createPortal(<div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 7100, background: "rgba(0,0,0,.82)", display: "grid", placeItems: "center", padding: 16 }}>
    <video src={url} autoPlay loop muted playsInline controls onClick={e => e.stopPropagation()}
      style={{ maxWidth: "min(96vw, 900px)", maxHeight: "86vh", borderRadius: 16, background: "repeating-conic-gradient(#2a2f3a 0 25%, #1f232c 0 50%) 0 0/24px 24px" }}/>
    <button type="button" onClick={onClose} aria-label="Fermer" style={{ position: "fixed", top: 14, right: 14, width: 40, height: 40, borderRadius: "50%", border: "none",
      cursor: "pointer", fontSize: 18, background: "rgba(255,255,255,.15)", color: "#fff" }}>✕</button>
  </div>, document.body);
}
