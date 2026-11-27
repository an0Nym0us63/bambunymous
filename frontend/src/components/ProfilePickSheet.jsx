import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { FSheet, fBtn } from "./FicheKit";
import MwImg from "./MwImg";

// Choisir le profil MakerWorld d'une impression (27/11/2026) : quand le createur a remplace le profil imprime, le 3MF
// d'origine ne se retrouve plus tout seul. Les profils du modele, le plus adapte a mon imprimante en tete, chacun avec sa
// vignette, son nom, son resume et ses caracteristiques ; un toucher sur « Choisir » le retient.
// askProfile(ask) -> Promise<instance_id | null>. ask : ce que rend le serveur (design_id, title, task, gone, profiles…).

const dur = s => { if (!s) return null; const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`; };
const k = n => n == null ? null : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")} k` : String(n);
const hex = c => { const s = String(c || "").replace(/^#/, ""); return /^[0-9a-f]{6}/i.test(s) ? `#${s.slice(0, 6)}` : null; };
const badge = (txt, c, tip) => <span data-tip={tip} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 20, fontSize: 10.5,
  fontWeight: 800, color: c || "var(--text2)", border: `1px solid ${c ? `color-mix(in srgb, ${c} 45%, transparent)` : "var(--border)"}`,
  background: c ? `color-mix(in srgb, ${c} 10%, transparent)` : "var(--surface)" }}>{txt}</span>;

function Card({ p, onPick }) {
  const [more, setMore] = useState(false);
  const facts = [
    p.printer && ["🖨", p.printer],
    ["🧩", `${p.plates} plateau${p.plates > 1 ? "x" : ""}`],
    p.weight_g && ["⚖️", `${Math.round(p.weight_g)} g`],
    p.seconds && ["⏱", dur(p.seconds)],
    p.settings?.layerHeight && ["📏", `${String(p.settings.layerHeight).replace(".", ",")} mm`],
    p.settings?.sparseInfillDensity && ["▦", `remplissage ${p.settings.sparseInfillDensity}`],
    p.settings?.wallLoops && ["🧱", `${p.settings.wallLoops} parois`],
    p.print_count != null && ["⬇", `${k(p.print_count)} impressions`],
  ].filter(Boolean);
  const fils = (p.filaments || []).filter(f => hex(f.color));
  return <div style={{ borderRadius: 18, overflow: "hidden", border: p.main ? "1.5px solid rgba(99,102,241,0.5)" : "1px solid var(--border)",
    background: p.main ? "linear-gradient(160deg, rgba(99,102,241,0.12), transparent 45%), var(--surface2)" : "var(--surface2)" }}>
    <div style={{ display: "flex", gap: 12, padding: 12 }}>
      {p.cover ? <MwImg src={p.cover} w={200} style={{ width: 92, height: 92, borderRadius: 14, objectFit: "cover", flexShrink: 0,
          background: "var(--surface)", border: "1px solid var(--border)" }}/>
        : <div style={{ width: 92, height: 92, borderRadius: 14, flexShrink: 0, background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30 }}>📦</div>}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ fontSize: 14.5, fontWeight: 900, color: "var(--text)", lineHeight: 1.25, overflowWrap: "anywhere" }} data-tip={p.title_original || undefined}>
          {p.title || "Profil"}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {p.main && badge("✨ Le plus adapté", "#6366F1", "Le plus proche de ton imprimante (comme « À faire » le choisirait)")}
          {p.default && badge("★ Par défaut", "#F59E0B", "Le profil par défaut du créateur")}
          {p.fit === 2 ? badge("🖨 pour ton imprimante", "#22C55E") : p.fit === 1 ? badge("🖨 compatible", "#84CC16") : null}
          {p.by_designer ? badge("✏️ du créateur") : p.author ? badge(`par ${p.author}`) : null}
          {p.rating != null && badge(`⭐ ${p.rating.toFixed(1).replace(".", ",")}${p.rating_count ? ` (${k(p.rating_count)})` : ""}`, "#EAB308")}
        </div>
        {fils.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
          {fils.slice(0, 12).map((f, i) => <span key={i} data-tip={[f.type, f.g ? `${f.g} g` : null].filter(Boolean).join(" · ")}
            style={{ width: 16, height: 16, borderRadius: "50%", background: hex(f.color), border: "1px solid rgba(148,163,184,.6)" }}/>)}
          {fils.length > 12 && <span style={{ fontSize: 11, color: "var(--muted)" }}>+{fils.length - 12}</span>}
        </div>}
      </div>
    </div>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "0 12px 10px" }}>
      {facts.map(([i, t], n) => <span key={n} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text2)", padding: "4px 9px", borderRadius: 10,
        background: "var(--surface)", border: "1px solid var(--border)" }}>{i} {t}</span>)}
    </div>
    {p.summary && <div onClick={() => setMore(v => !v)} style={{ margin: "0 12px 10px", fontSize: 12.5, lineHeight: 1.45, color: "var(--text2)", whiteSpace: "pre-line",
      cursor: "pointer", ...(more ? {} : { display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }) }}
      data-tip={more ? "Replier" : "Lire tout le résumé"}>{p.summary}</div>}
    {p.pictures?.length > 1 && more && <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "0 12px 10px" }}>
      {p.pictures.slice(1).map(u => <MwImg key={u} src={u} w={160} style={{ width: 76, height: 76, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}/>)}
    </div>}
    <div style={{ padding: "0 12px 12px" }}>
      <button type="button" onClick={() => onPick(p.instance_id)} style={{ ...fBtn, width: "100%", color: "#fff", border: "none", fontWeight: 900,
        background: "linear-gradient(135deg, #F97316, #EF4444)" }}>Choisir ce profil</button>
    </div>
  </div>;
}

function Sheet({ ask, done }) {
  const n = ask.print_ids?.length || 1;
  return <FSheet onClose={() => done(null)} z={1200} bottom={<button type="button" onClick={() => done(null)} style={{ ...fBtn, flex: 1 }}>Annuler</button>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {ask.cover && <MwImg src={ask.cover} w={120} style={{ width: 52, height: 52, borderRadius: 12, objectFit: "cover", flexShrink: 0 }}/>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>Quel profil ?</div>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", overflowWrap: "anywhere" }}>{ask.title}</div>
        </div>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--text2)", lineHeight: 1.45, padding: "10px 12px", borderRadius: 14, background: "rgba(249,115,22,0.08)",
        border: "1px solid rgba(249,115,22,0.3)" }}>
        {ask.gone ? "Le profil imprimé n'est plus sur MakerWorld (le créateur l'a remplacé ou retiré)." : "MakerWorld ne dit pas quel profil a été imprimé."}
        {ask.task ? <> Tâche imprimée : <b>{ask.task}</b>.</> : null} Choisis celui dont le 3MF d'origine doit être repris
        {n > 1 ? ` pour ces ${n} impressions` : ""} ; il devient leur profil.
      </div>
      {(ask.profiles || []).map(p => <Card key={p.instance_id} p={p} onPick={done}/>)}
    </div>
  </FSheet>;
}

export function askProfile(ask) {
  return new Promise(resolve => {
    const host = document.createElement("div");
    (document.fullscreenElement || document.body).appendChild(host);
    const root = createRoot(host);
    const done = v => { root.unmount(); host.remove(); resolve(v || null); };
    root.render(<Sheet ask={ask} done={done}/>);
  });
}
