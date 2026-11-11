// La galerie d'une fiche (08/11/2026) : tout ce qu'une impression ou un groupe garde, en trois onglets -- 📸 Photos (les
// photos et videos), 🧊 3D (les vues prises dans la vue 3D, les animations), 🛠 Technique (le timelapse, les captures
// des couches). Un groupe montre d'abord les siennes, puis celles de chacune de ses impressions. Sur chaque tuile, ce
// qu'on en fait : ⭐ la couverture de la galerie (une photo ou une vue 3D ; pour un groupe, aussi celle d'une de ses
// impressions), 🧊 dans la vignette 3D (plusieurs : elles defilent), ⭐ l'animation en tete de fiche, 🗑.
import React, { useEffect, useState } from "react";
import client, { apiUrl, apiAnim } from "../api/client";
import { showAlert } from "../utils/dialog";
import { useIsAdmin } from "../store/auth";
import { currentFriend } from "../store/friend";
import Lightbox from "./Lightbox";
import PhotoAddButton from "./PhotoAddButton";
import { fBtn, lighten } from "./FicheKit";
import { ANIM_STYLES } from "./Anim3D";
import { openVue3D } from "./Vue3DPicker";
import { egg } from "../eggs";
import MediaLibrary, { saveAnim } from "./MediaLibrary";

const u = url => url ? apiUrl(String(url).replace(/^\/api\/v1/, "")) : null;
const SNAP_ORDER = ["fail", "pct100", "pct99", "pct50", "layer2", "layer1"];       // la fin d'abord, puis en remontant
const SNAP_NAMES = { layer1: "Couche 1", layer2: "Couche 2", pct50: "50 %", pct99: "99 %", pct100: "Fin", fail: "Échec" };
const snapKey = n => (n || "").replace(/^snapshot-/, "").replace(/\.[^.]+$/, "");
const snapRank = n => { const i = SNAP_ORDER.indexOf(snapKey(n)); return i < 0 ? 99 : i; };
const TABS = [["photos", "📸 Photos", "#EC4899"], ["3d", "🧊 3D", "#0EA5E9"], ["tech", "🛠 Technique", "#3B82F6"]];
const KIDS = 4;                                                                     // les impressions d'un groupe : 4, puis « les autres »
const when = d => d ? new Date(d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : "";

// une pastille ronde posee sur une tuile
const dot = (pos, on, c) => ({ position: "absolute", ...pos, minWidth: 24, height: 24, padding: 0, borderRadius: 12, border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, lineHeight: 1, color: "#fff",
  background: on ? c : "rgba(0,0,0,.55)", boxShadow: on ? `0 0 0 2px #fff, 0 4px 10px -2px ${c}` : "none" });

function Tile({ src, video, label, fit = "cover", ring = null, room = 10, onOpen, children }) {
  return <div style={{ position: "relative", aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden", background: "var(--surface2)",
    boxShadow: ring ? `0 0 0 2px ${ring}` : "0 0 0 1px var(--border)" }}>
    <div onClick={onOpen} style={{ position: "absolute", inset: 0, cursor: "zoom-in" }}>
      {video ? <video src={apiAnim(src)} muted loop autoPlay playsInline preload="metadata" style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }}/>
        : <img src={src} alt={label || ""} loading="lazy" decoding="async" onError={e => { e.currentTarget.style.opacity = "0.2"; }}
          style={{ width: "100%", height: "100%", objectFit: fit, display: "block" }}/>}
    </div>
    {label && <span style={{ position: "absolute", left: 5, bottom: 5, maxWidth: `calc(100% - ${room}px)`, fontSize: 9.5, fontWeight: 800, color: "#fff", padding: "2px 6px",
      borderRadius: 6, background: "rgba(0,0,0,.62)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none" }}>{label}</span>}
    {children}
  </div>;
}

export default function MediaGallery({ kind, id, title = "", refreshKey = "", onCover = null, onChanged = null }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState(null);
  const [lb, setLb] = useState(null);              // { items, i }
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(null);        // la tuile dont la corbeille attend sa confirmation
  const [allKids, setAllKids] = useState(false);
  const [lib, setLib] = useState(false);           // la mediatheque (08/11/2026)
  // (11/11/2026) repliee d'office (un groupe de 9 impressions prenait tout l'ecran) ; ouverte ou non, retenu par appareil
  const [unf, setUnf] = useState(() => { try { return localStorage.getItem("bn-gal-open") === "1"; } catch { return false; } });
  const fold = v => { setUnf(v); try { localStorage.setItem("bn-gal-open", v ? "1" : "0"); } catch { /* navigation privee */ } };
  const admin = useIsAdmin() && !currentFriend();
  const group = kind === "group";
  const load = () => client.get(group ? `/prints/groups/${id}/media` : `/prints/${id}/media`).then(r => setD(r.data)).catch(() => setD(d0 => d0 || { photos: [], prints: [], failed: true }));
  useEffect(() => { if (id) load(); }, [id, refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async f => {
    if (busy) return;
    setBusy(true);
    try { await f(); await load(); onChanged?.(); window.dispatchEvent(new CustomEvent("bn-prints-changed", { detail: { kind, id } })); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); setArmed(null); }
  };
  if (!d) return <div className="card-sm" style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--muted)" }}>⏳ La galerie…</div>;
  if (d.failed) return <div className="card-sm" style={{ padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)" }}>
    <span style={{ flex: 1 }}>🖼 Galerie : pas lue pour l'instant</span>
    <button type="button" onClick={() => { setD(null); load(); }} style={{ ...fBtn, padding: "4px 10px", fontSize: 12 }}>Réessayer</button></div>;

  // ce que montre la fiche : elle-meme, puis (un groupe) chacune de ses impressions
  const ents = group
    ? [{ key: "g", title: null, own: true, base: `/prints/groups/${id}`, vkind: "group", vid: id, ref: n => n, m: d },
       ...(d.prints || []).map(k => ({ key: `p${k.id}`, title: k.name, date: k.print_date, plate: k.plate, base: `/prints/${k.id}`, vkind: "print", vid: k.id,
         pid: k.id, ref: n => `p${k.id}/${n}`, m: k }))]
    : [{ key: "s", title: null, own: true, base: `/prints/${id}`, vkind: "print", vid: id, pid: id, ref: n => n, m: d }];
  const cover = d.cover_photo || null;
  const setCover = (e, name) => act(async () => {
    const ref = e.ref(name);
    if (group) await client.post(`/prints/groups/${id}/cover`, { ref: cover === ref ? "" : ref });
    else if (cover !== ref) { await client.post(`/prints/${id}/photo/${name}/primary`); onCover?.(name); }
    if (cover !== ref) { if (/^Vue3D/.test(name)) egg("couverture_3d"); if (group && e.pid) egg("couverture_groupe"); }
  });
  const delPhoto = (e, name) => act(() => e.pid ? client.delete(`/prints/${e.pid}/upload/${name}`) : client.delete(`/prints/groups/${id}/photo/${name}`));
  const upload = f => act(async () => { const fd = new FormData(); fd.append("file", f);
    await client.post(group ? `/prints/groups/${id}/photos/upload` : `/prints/${id}/photos/upload`, fd, { headers: { "Content-Type": "multipart/form-data" } }); });

  // chaque onglet : par entite, ses tuiles { key, src, video, label, fit, ...ce qu'on en fait }
  // t : la date du fichier (la mediatheque trie par date) ; toggle / toggleTop : les gestes de la vue ou de l'animation
  const vOf = url => +((String(url).match(/[?&]v=(\d+)/) || [])[1] || 0);
  const photosOf = e => (e.m.photos || []).map(x => ({ key: `${e.key}:${x.name}`, kind: "photo", e, name: x.name, src: u(x.url), video: x.video,
    label: x.video ? "Vidéo" : null, t: x.t || 0 }));
  const d3Of = e => { const v = e.m.vue3d || {}, sel = v.sel || [];
    return [...(v.slots || []).map(s => { const on = sel.includes(s.n);
        return { key: `${e.key}:v${s.n}`, kind: "vue", e, n: s.n, name: s.n === 1 ? "Vue3D.png" : `Vue3D_${s.n}.png`, src: u(s.url), fit: "contain",
          label: `Vue ${s.n}`, sel: on, sl: sel, t: vOf(s.url), toggle: () => client.put(`${e.base}/thumb`, { slots: on ? sel.filter(x => x !== s.n) : [...sel, s.n] }) }; }),
      ...(v.anims || []).map((a, i) => ({ key: `${e.key}:${a.name}`, kind: "anim", e, name: a.name, src: u(a.url), raw: a.url, video: true,
        label: `${(ANIM_STYLES.find(s => s[0] === a.style) || [])[1] || "🎬"} ${a.label}`, top: i === 0 && !v.anim_off, t: a.v || 0,
        // en tete de fiche, ou (deja en tete) plus d'animation du tout : l'image revient (08/11/2026)
        toggleTop: () => i === 0 && !v.anim_off ? client.post(`${e.base}/vue3d/anim/none`) : client.post(`${e.base}/vue3d/anim/top`, null, { params: { name: a.name } }) }))]; };
  const techOf = e => { const t = e.m.tech || {};
    return [...(t.timelapse ? [{ key: `${e.key}:tl`, kind: "tl", e, name: "Video-Timelapse.mp4", src: u(t.timelapse), video: true, label: "🎬 Timelapse", fit: "cover", t: t.timelapse_t || 0 }] : []),
      ...[...(t.snaps || [])].sort((a, b) => snapRank(a.name) - snapRank(b.name))
        .map(s => ({ key: `${e.key}:${s.name}`, kind: "snap", e, name: s.name, src: u(s.url), label: SNAP_NAMES[snapKey(s.name)] || snapKey(s.name), t: s.t || 0 }))]; };
  const plateOf = e => e.m.plate ? [{ key: `${e.key}:plate`, kind: "plate", e, src: u(e.m.plate), fit: "contain", label: "🖼 Plateau", t: 0 }] : [];
  const allOf = e => [...photosOf(e).map(x => ({ ...x, label: x.label || "📸 Photo" })), ...d3Of(e), ...techOf(e), ...plateOf(e)];
  // supprimer une chose (sans act : la mediatheque en enchaine plusieurs dans un seul act)
  const delItem = it => it.kind === "photo" ? (it.e.pid ? client.delete(`/prints/${it.e.pid}/upload/${it.name}`) : client.delete(`/prints/groups/${id}/photo/${it.name}`))
    : it.kind === "vue" ? client.delete(`${it.e.base}/vue3d/${it.n}`)
    : it.kind === "anim" ? client.delete(`${it.e.base}/vue3d/anim`, { params: { name: it.name } })
    : it.e.pid ? client.delete(`/prints/${it.e.pid}/upload/${it.name}`) : Promise.resolve();
  const per = { photos: photosOf, "3d": d3Of, tech: techOf };
  const count = k => ents.reduce((n, e) => n + per[k](e).length, 0);
  const n = { photos: count("photos"), "3d": count("3d"), tech: count("tech") };
  const cur = tab || TABS.find(([k]) => n[k])?.[0] || "photos";
  const rows = ents.map(e => ({ e, items: per[cur](e) })).filter(r => r.items.length);
  const kids = rows.filter(r => !r.e.own), shownKids = allKids ? kids : kids.slice(0, KIDS);
  const shown = [...rows.filter(r => r.e.own), ...shownKids];
  const flat = shown.flatMap(r => r.items.map(it => ({ ...it, lbl: [it.label || (it.kind === "photo" ? "Photo" : ""), r.e.title].filter(Boolean).join(" · ") })));
  const open = it => setLb({ items: flat.map(x => ({ url: x.src, label: x.lbl })), i: flat.findIndex(x => x.key === it.key) });

  const tools = it => {
    const dl = <button type="button" onClick={ev => { ev.stopPropagation(); saveAnim(it); }} style={dot({ bottom: 5, left: 5 }, false, "#0EA5E9")}
      data-tip="La télécharger (version complète)">⬇</button>;
    if (!admin) return it.kind === "photo" || it.kind === "vue" ? (cover === it.e.ref(it.name) ? <span style={dot({ top: 5, left: 5 }, true, "#F59E0B")}>⭐</span> : null)
      : it.kind === "anim" ? dl : null;
    const isCover = (it.kind === "photo" || it.kind === "vue") && cover === it.e.ref(it.name);
    const trash = (what, run) => { const arm = armed === it.key;
      return <button type="button" disabled={busy} onClick={() => arm ? run() : setArmed(it.key)} onBlur={() => setArmed(a => a === it.key ? null : a)}
        data-tip={arm ? "Confirmer la suppression" : `Supprimer ${what}`}
        style={{ ...dot({ top: 5, right: 5 }, arm, "#ef4444"), padding: arm ? "0 8px" : 0, fontSize: arm ? 10.5 : 12, fontWeight: 800 }}>{arm ? "Supprimer ?" : "🗑"}</button>; };
    if (it.kind === "photo") return <>
      <button type="button" disabled={busy} onClick={() => setCover(it.e, it.name)} style={{ ...dot({ top: 5, left: 5 }, isCover, "#F59E0B"), filter: isCover ? "none" : "grayscale(1)" }}
        data-tip={isCover ? (group ? "La couverture de la galerie (toucher pour l'enlever)" : "La couverture de la galerie") : "En faire la couverture de la galerie"}>⭐</button>
      {trash("cette photo", () => delPhoto(it.e, it.name))}</>;
    if (it.kind === "vue") return <>
      <button type="button" disabled={busy} onClick={() => setCover(it.e, it.name)} style={{ ...dot({ top: 5, left: 5 }, isCover, "#F59E0B"), filter: isCover ? "none" : "grayscale(1)" }}
        data-tip={isCover ? "La couverture de la galerie" : "En faire la couverture de la galerie"}>⭐</button>
      <button type="button" disabled={busy} onClick={() => act(() => client.put(`${it.e.base}/thumb`, { slots: it.sel ? it.sl.filter(x => x !== it.n) : [...it.sl, it.n] }))}
        style={dot({ bottom: 5, right: 5 }, it.sel, "#0EA5E9")}
        data-tip={it.sel ? "Dans la vignette 3D : l'en retirer" : "La mettre dans la vignette 3D (plusieurs : elles défilent)"}>🧊</button>
      {trash("cette vue", () => act(() => client.delete(`${it.e.base}/vue3d/${it.n}`)))}</>;
    if (it.kind === "anim") return <>
      <button type="button" disabled={busy} onClick={() => act(() => it.toggleTop())}
        style={{ ...dot({ bottom: 5, right: 5 }, it.top, "#0EA5E9") }}
        data-tip={it.top ? "Elle tourne en haut de la fiche, à la place de l'image : toucher pour l'enlever" : "La faire tourner en haut de la fiche, à la place de l'image"}>🧊</button>
      {dl}
      {trash("cette animation", () => act(() => client.delete(`${it.e.base}/vue3d/anim`, { params: { name: it.name } })))}</>;
    if (it.kind === "snap") return trash("cette capture", () => act(() => client.delete(`/prints/${it.e.pid}/upload/${it.name}`)));
    return null;
  };
  const ringOf = it => (it.kind === "photo" || it.kind === "vue") && cover === it.e.ref(it.name) ? "#F59E0B" : it.kind === "vue" && it.sel ? "#0EA5E9"
    : it.kind === "anim" && it.top ? "#0EA5E9" : null;

  const legend = { photos: "⭐ la couverture de la galerie · 🗑 supprimer",
    "3d": "⭐ la couverture de la galerie · 🧊 sur une vue : l'image de la fiche (plusieurs : elles défilent) · 🧊 sur une animation : elle tourne en haut de la fiche",
    tech: "Le timelapse et les captures prises pendant l'impression, de la fin vers la première couche" }[cur];
  const empty = { photos: admin ? "Aucune photo : ajoute la première avec ＋." : "Aucune photo.",
    "3d": "Aucune vue 3D ni animation : prends-en avec 📸 Vignette et Animation dans la vue 3D.", tech: "Ni timelapse ni capture des couches." }[cur];

  return <div className="card-sm" style={{ display: "flex", flexDirection: "column", gap: 10, padding: "10px 12px 12px" }}>
    {lb && lb.i >= 0 && <Lightbox images={lb.items} index={lb.i} onClose={() => setLb(null)}/>}
    {/* le titre, l'ajout de photos, la mediatheque ; puis les onglets sur toute la largeur (sur telephone, a cote ils s'ecrasaient) */}
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button type="button" onClick={() => fold(!unf)} aria-expanded={unf} data-tip={unf ? "Replier la galerie" : "Déplier la galerie"}
        style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 8, padding: 0, border: "none", background: "none", cursor: "pointer", font: "inherit", textAlign: "left" }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text)" }}>🖼 Galerie</span>
        {/* repliee : ce qu'il y a dedans */}
        {!unf && <span style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {TABS.filter(([k]) => n[k]).map(([k, l]) => `${l.split(" ")[0]} ${n[k]}`).join(" · ") || "vide"}</span>}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--muted)" }}>{unf ? "▾" : "▸"}</span>
      </button>
      {unf && admin && cur === "photos" && <PhotoAddButton onPick={upload}/>}
      <button type="button" onClick={() => setLib(true)} data-tip="Tout voir en grand : trier, supprimer, choisir ce qui s'affiche"
        style={{ height: 30, padding: "0 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", cursor: "pointer",
          fontSize: 12, fontWeight: 800, whiteSpace: "nowrap", flexShrink: 0 }}>⤢ Tout voir</button>
    </div>
    {unf && <><div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, display: "flex", gap: 4, padding: 3, borderRadius: 13, background: "var(--surface2)", minWidth: 0 }}>
        {TABS.map(([k, l, c]) => { const on = cur === k;
          return <button key={k} type="button" onClick={() => setTab(k)} style={{ flex: "1 1 auto", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
            padding: "7px 5px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap",
            color: on ? "#fff" : n[k] ? "var(--text2)" : "var(--muted)", opacity: on || n[k] ? 1 : 0.6,
            background: on ? `linear-gradient(135deg, ${c}, ${lighten(c)})` : "transparent", boxShadow: on ? `0 6px 14px -8px ${c}` : "none" }}>
            {l}<span style={{ fontSize: 10.5, fontWeight: 900, padding: "0 5px", borderRadius: 8, background: on ? "rgba(255,255,255,.25)" : "var(--surface)" }}>{n[k]}</span></button>; })}
      </div>
    </div>
    </>}
    {lib && <MediaLibrary title={title || (group ? "Le groupe" : "L'impression")} group={group} admin={admin} ents={ents} allOf={allOf} cover={cover} busy={busy}
      act={act} setCover={setCover} delItem={delItem} onClose={() => setLib(false)}/>}
    {unf && <>
    {n[cur] > 0 && admin && <span style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.35 }}>{legend}</span>}
    {!n[cur] && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{empty}</span>}
    {shown.map(({ e, items }) => <div key={e.key} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {group && !!(e.title || kids.length) && <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {e.plate ? <img src={u(e.plate)} alt="" onError={ev => { ev.currentTarget.style.display = "none"; }}
          style={{ width: 28, height: 28, borderRadius: 8, objectFit: "contain", flexShrink: 0, background: "var(--surface2)", border: "1px solid var(--border)" }}/>
          : !e.title && <span style={{ fontSize: 15 }}>📁</span>}
        <span style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 900, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {e.title || "Le groupe"}{e.date && <span style={{ color: "var(--muted)", fontWeight: 700 }}> · {when(e.date)}</span>}
          <span style={{ color: "var(--muted)", fontWeight: 700 }}> · {items.length}</span></span>
        {cur === "3d" && admin && <button type="button" onClick={() => openVue3D({ kind: e.vkind, id: e.vid, onDone: load })}
          data-tip="Ses vues 3D : l'ordre où elles défilent, en remplacer une…" style={{ ...fBtn, padding: "3px 9px", fontSize: 11, borderRadius: 9 }}>Gérer</button>}
      </div>}
      {!group && cur === "3d" && admin && (e.m.vue3d?.slots || []).length > 1 && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -4 }}>
        <button type="button" onClick={() => openVue3D({ kind: "print", id, onDone: load })} data-tip="L'ordre où les vues défilent, en remplacer une…"
          style={{ ...fBtn, padding: "3px 9px", fontSize: 11, borderRadius: 9 }}>Gérer les vues</button></div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))", gap: 7 }}>
        {items.map(it => <Tile key={it.key} src={it.src} video={it.video} label={it.label} fit={it.fit} ring={ringOf(it)} room={it.kind === "vue" && admin ? 40 : 10} onOpen={() => open(it)}>
          {tools(it)}</Tile>)}
      </div>
    </div>)}
    {!allKids && kids.length > KIDS && <button type="button" onClick={() => setAllKids(true)} style={{ ...fBtn, alignSelf: "flex-start", fontSize: 12.5, padding: "6px 12px" }}>
      Voir les {kids.length - KIDS} autres impressions</button>}
    </>}
  </div>;
}
