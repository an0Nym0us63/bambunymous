// La mediatheque d'une fiche (08/11/2026) : une grande fenetre avec TOUT ce que garde une impression, ou un groupe et
// chacune de ses impressions -- photos, vues 3D, animations, timelapses, captures des couches, plateaux. On y filtre
// (par sorte, par impression), on trie (par impression, par date, par sorte), on supprime (une a une, ou plusieurs
// d'un coup), et surtout on dit ce qui s'affiche : l'image de la fiche et des listes (les vues 3D choisies, qui font
// aussi la galerie des vues 3D), la couverture de la galerie (une photo ou une vue 3D), l'animation en tete de fiche.
// Les donnees et les gestes viennent de MediaGallery (la carte de la fiche) : une seule source.
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { showConfirm } from "../utils/dialog";
import Lightbox from "./Lightbox";
import { fBtn } from "./FicheKit";

const KINDS = [["all", "Tout"], ["photo", "📸 Photos"], ["vue", "🧊 Vues 3D"], ["anim", "🎞 Animations"], ["tl", "🎬 Timelapses"], ["snap", "🛠 Captures"], ["plate", "🖼 Plateaux"]];
const KIND_RANK = { photo: 0, vue: 1, anim: 2, tl: 3, snap: 4, plate: 5 };
const SORTS = [["print", "Par impression"], ["new", "Plus récentes"], ["old", "Plus anciennes"], ["kind", "Par sorte"]];
const day = t => t ? new Date(t * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" }) : "";
const C = { cover: "#F59E0B", fiche: "#0EA5E9", top: "#8B5CF6" };

function Pill({ on, c, children, onClick, tip, disabled }) {
  return <button type="button" disabled={disabled} onClick={onClick} data-tip={tip} style={{ padding: "4px 8px", borderRadius: 9, cursor: disabled ? "default" : "pointer",
    fontSize: 11, fontWeight: 800, whiteSpace: "nowrap", fontFamily: "inherit", border: on ? `1.5px solid ${c}` : "1px solid var(--border)",
    color: on ? "#fff" : "var(--text2)", background: on ? c : "var(--surface)", opacity: disabled && !on ? 0.5 : 1 }}>{children}</button>;
}

// une case « ce qui s'affiche » : son titre, ses images (ou ce qui s'affiche a defaut), ce qu'il faut toucher pour changer
function Shown({ title, c, imgs, video, empty, hint }) {
  return <div style={{ flex: "1 1 220px", minWidth: 200, display: "flex", flexDirection: "column", gap: 6, padding: "9px 11px", borderRadius: 14,
    border: `1px solid color-mix(in srgb, ${c} 45%, var(--border))`, background: `color-mix(in srgb, ${c} 7%, var(--surface2))` }}>
    <span style={{ fontSize: 12, fontWeight: 900, color: "var(--text)" }}>{title}</span>
    <div style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 54 }}>
      {imgs.length ? imgs.slice(0, 4).map(s => video
        ? <video key={s} src={s} muted loop autoPlay playsInline style={{ width: 54, height: 54, borderRadius: 10, objectFit: "cover", background: "#111" }}/>
        : <img key={s} src={s} alt="" style={{ width: 54, height: 54, borderRadius: 10, objectFit: "contain", background: "var(--surface)", border: `1.5px solid ${c}` }}/>)
        : <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{empty}</span>}
      {imgs.length > 4 && <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>+{imgs.length - 4}</span>}
    </div>
    <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>{hint}</span>
  </div>;
}

export default function MediaLibrary({ title, group, admin, ents, allOf, cover, busy, act, setCover, delItem, onClose }) {
  const [kind, setKind] = useState("all");
  const [from, setFrom] = useState("all");
  const [sort, setSort] = useState("print");
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [lb, setLb] = useState(null);

  const all = useMemo(() => ents.flatMap(e => allOf(e)), [ents, allOf]);
  const counts = useMemo(() => { const n = { all: 0 }; all.forEach(it => { n[it.kind] = (n[it.kind] || 0) + 1; n.all++; }); return n; }, [all]);
  const list = all.filter(it => (kind === "all" || it.kind === kind) && (from === "all" || it.e.key === from));
  const sorted = [...list].sort((a, b) => sort === "new" ? (b.t || 0) - (a.t || 0) : sort === "old" ? (a.t || 0) - (b.t || 0)
    : sort === "kind" ? KIND_RANK[a.kind] - KIND_RANK[b.kind] || ents.indexOf(a.e) - ents.indexOf(b.e) : 0);
  // par impression : une section par entite (le groupe, puis ses impressions) ; sinon une seule grille
  const sections = sort === "print"
    ? ents.map(e => ({ e, items: sorted.filter(it => it.e === e) })).filter(s => s.items.length)
    : [{ e: null, items: sorted }];
  const flat = sections.flatMap(s => s.items);
  const open = it => setLb({ items: flat.map(x => ({ url: x.src, label: [x.label, x.e.title].filter(Boolean).join(" · ") })), i: flat.findIndex(x => x.key === it.key) });
  const toggleSel = it => setSel(s => { const n = new Set(s); n.has(it.key) ? n.delete(it.key) : n.add(it.key); return n; });
  const deletable = it => it.kind !== "plate";
  const bulk = async () => {
    const items = flat.filter(it => sel.has(it.key) && deletable(it));
    if (!items.length || !await showConfirm("Ils partent pour de bon (la sauvegarde du NAS garde ce qu'elle a déjà copié).",
      { title: `Supprimer ${items.length} élément${items.length > 1 ? "s" : ""} ?`, danger: true, confirmLabel: "Supprimer" })) return;
    // les vues d'abord par numero decroissant : une vue retiree ne decale pas les suivantes sous nos pieds
    const order = [...items].sort((a, b) => (b.n || 0) - (a.n || 0));
    await act(async () => { for (const it of order) await delItem(it); });
    setSel(new Set()); setPicking(false);
  };

  // ce qui s'affiche, pour la fiche elle-meme (l'impression, ou le groupe)
  const me = ents[0], mine = allOf(me);
  const ficheVues = mine.filter(it => it.kind === "vue" && it.sel).map(it => it.src);
  const coverIt = all.find(it => (it.kind === "photo" || it.kind === "vue") && cover && cover === it.e.ref(it.name));
  const topAnim = mine.find(it => it.kind === "anim" && it.top);
  const plateSrc = mine.find(it => it.kind === "plate")?.src;

  const roles = it => {
    if (it.kind === "photo" || it.kind === "vue") {
      const isCover = cover === it.e.ref(it.name);
      return <>
        <Pill on={isCover} c={C.cover} disabled={!admin || busy || (isCover && !group)} onClick={() => setCover(it.e, it.name)}
          tip={isCover ? "La couverture de la galerie" : "En faire la couverture de la galerie"}>⭐ Galerie</Pill>
        {it.kind === "vue" && <Pill on={it.sel} c={C.fiche} disabled={!admin || busy} onClick={() => act(() => it.toggle())}
          tip={it.sel ? "Dans l'image de la fiche, des listes et de la galerie des vues 3D : l'en retirer" : "La mettre dans l'image de la fiche, des listes et de la galerie des vues 3D (plusieurs : elles défilent)"}>
          🧊 Fiche{group && it.e.pid ? " de l'impr." : ""}</Pill>}
      </>;
    }
    if (it.kind === "anim") return <Pill on={it.top} c={C.top} disabled={!admin || busy || it.top} onClick={() => act(() => it.makeTop())}
      tip={it.top ? "Elle tourne en tête de la fiche" : "La faire tourner en tête de la fiche"}>🎞 En tête{group && it.e.pid ? " de l'impr." : ""}</Pill>;
    return null;
  };
  const ring = it => (it.kind === "photo" || it.kind === "vue") && cover && cover === it.e.ref(it.name) ? C.cover : it.kind === "vue" && it.sel ? C.fiche
    : it.kind === "anim" && it.top ? C.top : null;

  const sel_ = { padding: "6px 9px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit" };
  return createPortal(<div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 6500, background: "rgba(2,6,23,.55)", display: "flex", alignItems: "center", justifyContent: "center" }}>
    {lb && lb.i >= 0 && <Lightbox images={lb.items} index={lb.i} onClose={() => setLb(null)}/>}
    <div onClick={e => e.stopPropagation()} style={{ width: "min(1240px, 100%)", height: "min(100%, 94vh)", maxHeight: "100dvh", display: "flex", flexDirection: "column",
      background: "var(--sheet-bg)", borderRadius: "min(18px, 2.5vw)", border: "1px solid var(--border)", boxShadow: "0 24px 70px rgba(0,0,0,.45)", overflow: "hidden", color: "var(--text2)" }}>
      {/* en-tete : le titre, ce qui s'affiche, les filtres */}
      <div style={{ padding: "12px 14px 10px", display: "flex", flexDirection: "column", gap: 10, borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 17, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            🗂 Médiathèque <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 13 }}>· {title} · {counts.all}</span></span>
          <button type="button" onClick={onClose} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--surface2)",
            color: "var(--text)", cursor: "pointer", fontSize: 15, flexShrink: 0 }}>✕</button>
        </div>
        <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
          <Shown title={group ? "🧊 Image du groupe (fiche, listes, galerie 3D)" : "🧊 Image de la fiche (listes, galerie 3D)"} c={C.fiche} imgs={ficheVues}
            empty={group ? "La mosaïque des impressions" : plateSrc ? <span style={{ display: "flex", alignItems: "center", gap: 6 }}><img src={plateSrc} alt="" style={{ width: 54, height: 54, borderRadius: 10, objectFit: "contain", background: "var(--surface)" }}/>L'image du plateau</span> : "L'image du plateau"}
            hint="🧊 Fiche sur une vue 3D ; plusieurs : elles défilent."/>
          <Shown title="⭐ Couverture de la galerie" c={C.cover} imgs={coverIt ? [coverIt.src] : []} empty="La première photo"
            hint={group ? "⭐ Galerie sur une photo ou une vue 3D, du groupe ou d'une de ses impressions." : "⭐ Galerie sur une photo ou une vue 3D."}/>
          <Shown title="🎞 Animation en tête de fiche" c={C.top} imgs={topAnim ? [topAnim.src] : []} video empty="Aucune : l'image de la fiche"
            hint="🎞 En tête sur une animation ; d'office la dernière faite."/>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {KINDS.filter(([k]) => k === "all" || counts[k]).map(([k, l]) => <Pill key={k} on={kind === k} c="#6366F1" onClick={() => setKind(k)}>{l} {counts[k] || 0}</Pill>)}
          <span style={{ flex: 1 }}/>
          {group && <select value={from} onChange={e => setFrom(e.target.value)} style={sel_} aria-label="D'où">
            <option value="all">Le groupe et ses impressions</option>
            {ents.map(e => <option key={e.key} value={e.key}>{e.title || "Le groupe seul"}</option>)}
          </select>}
          <select value={sort} onChange={e => setSort(e.target.value)} style={sel_} aria-label="Trier">
            {SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {admin && <Pill on={picking} c="#ef4444" onClick={() => { setPicking(p => !p); setSel(new Set()); }}>☑ Sélectionner</Pill>}
        </div>
        {picking && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 800 }}>{sel.size} choisi{sel.size > 1 ? "s" : ""}</span>
          <button type="button" onClick={() => setSel(new Set(flat.filter(deletable).map(it => it.key)))} style={{ ...fBtn, padding: "4px 10px", fontSize: 12 }}>Tout ce qui est affiché</button>
          <button type="button" onClick={() => setSel(new Set())} style={{ ...fBtn, padding: "4px 10px", fontSize: 12 }}>Aucun</button>
          <button type="button" disabled={!sel.size || busy} onClick={bulk} style={{ ...fBtn, padding: "4px 12px", fontSize: 12, border: "none", color: "#fff",
            background: sel.size ? "#ef4444" : "var(--surface2)" }}>🗑 Supprimer{sel.size ? ` (${sel.size})` : ""}</button>
        </div>}
      </div>
      {/* la grille */}
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
        {!flat.length && <span style={{ fontSize: 13, color: "var(--muted)" }}>Rien ici avec ces filtres.</span>}
        {sections.map(({ e, items }) => <div key={e ? e.key : "all"} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {e && group && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 900, color: "var(--text)" }}>
            {e.plate ? <img src={e.plate} alt="" style={{ width: 26, height: 26, borderRadius: 7, objectFit: "contain", background: "var(--surface2)" }}/> : <span>📁</span>}
            {e.title || "Le groupe"}{e.date && <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 12 }}>· {new Date(e.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span>}
            <span style={{ color: "var(--muted)", fontWeight: 700, fontSize: 12 }}>· {items.length}</span></div>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(46%, 150px), 1fr))", gap: 10 }}>
            {items.map(it => { const r = ring(it), on = sel.has(it.key);
              return <div key={it.key} style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                <div onClick={() => picking ? (deletable(it) && toggleSel(it)) : open(it)} style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 13, overflow: "hidden",
                  cursor: picking ? "pointer" : "zoom-in", background: it.fit === "contain" ? "var(--surface2)" : "#111",
                  boxShadow: on ? "0 0 0 3px #ef4444" : r ? `0 0 0 2px ${r}` : "0 0 0 1px var(--border)" }}>
                  {it.video ? <video src={it.src} muted loop autoPlay playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: it.fit || "cover", display: "block" }}/>
                    : <img src={it.src} alt="" loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: it.fit || "cover", display: "block" }}/>}
                  {picking && deletable(it) && <span style={{ position: "absolute", top: 6, left: 6, width: 22, height: 22, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                    background: on ? "#ef4444" : "rgba(0,0,0,.5)", color: "#fff", fontSize: 13, fontWeight: 900, border: "1.5px solid #fff" }}>{on ? "✓" : ""}</span>}
                  {!picking && admin && deletable(it) && <button type="button" disabled={busy} data-tip="Supprimer"
                    onClick={async ev => { ev.stopPropagation(); if (await showConfirm(`Supprimer « ${it.label}${it.e.title ? ` · ${it.e.title}` : ""} » ?`, { danger: true, confirmLabel: "Supprimer" })) act(() => delItem(it)); }}
                    style={{ position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: "50%", border: "none", cursor: "pointer", background: "rgba(0,0,0,.55)", color: "#fff", fontSize: 12 }}>🗑</button>}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.label}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {[sort !== "print" || !group ? (it.e.title || (group ? "Le groupe" : null)) : null, day(it.t)].filter(Boolean).join(" · ")}</span>
                </div>
                {!picking && <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{roles(it)}</div>}
              </div>; })}
          </div>
        </div>)}
      </div>
    </div>
  </div>, document.body);
}
