import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import client, { apiUrl } from "../api/client";
import { showAlert, showConfirm } from "../utils/dialog";
import { AnimPlayer, ANIM_STYLES } from "./Anim3D";

// Les vues 3D d'une impression ou d'un groupe (30/10/2026) : jusqu'a 4, prises dans la vue 3D (un plateau, l'assemblage,
// de jour, de nuit, eclairee par derriere…). On en choisit une comme vignette, ou la vignette par defaut ; on en supprime ;
// et une vue qui vient d'etre prise (shot) s'ajoute ou en remplace une.
function Picker({ kind, id, shot, onDone, close }) {
  const base = kind === "group" ? `/prints/groups/${id}` : `/prints/${id}`;
  const [d, setD] = useState(null), [busy, setBusy] = useState(false), [sure, setSure] = useState(0), [saved, setSaved] = useState(!shot);
  const [play, setPlay] = useState(null);               // l'animation lue en grand (son adresse) (08/11/2026)
  const load = async () => { try { setD((await client.get(`${base}/vue3d`)).data); } catch (e) { showAlert(e.response?.data?.detail || e.message); close(); } };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const act = async f => {
    setBusy(true);
    // la liste ne relit que cette impression ou ce groupe (31/10/2026 : elle repartait en haut de page)
    try { await f(); await load(); onDone?.(); window.dispatchEvent(new CustomEvent("bn-prints-changed", { detail: { kind, id } })); }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };
  const put = slot => act(async () => {
    const fd = new FormData(); fd.append("file", shot.blob, "Vue3D.png"); if (slot) fd.append("slot", String(slot));
    const r = await client.post(`${base}/vue3d`, fd);
    setSaved(r.data.n);
    // la vue prise devient la vignette (30/10/2026 : elle ne l'etait pas, il fallait la choisir) ; d'autres deja
    // choisies : elle s'y ajoute (elles defilent)
    const cur = d?.sel || [];
    if (r.data.n && !cur.includes(r.data.n)) await client.put(`${base}/thumb`, { slots: [...cur, r.data.n] });
  });
  // plusieurs vues choisies : la vignette en fait une mosaique (30/10/2026) ; aucune : la vignette par defaut
  const sel = d?.sel || [];
  const toggle = n => act(() => client.put(`${base}/thumb`, { slots: sel.includes(n) ? sel.filter(x => x !== n) : [...sel, n] }));
  const none = () => act(() => client.put(`${base}/thumb`, { slots: [] }));
  // changer une vue de place (07/11/2026) : l'ordre est celui ou les vues choisies defilent, la premiere sert d'image seule
  const swap = (a, b) => act(() => client.post(`${base}/vue3d/${a}/swap/${b}`));
  const drop = n => { if (sure !== n) { setSure(n); setTimeout(() => setSure(0), 4000); return; } setSure(0); act(() => client.delete(`${base}/vue3d/${n}`)); };
  const full = d && d.slots.length >= d.max;
  // la vue prise est gardee d'office (31/10/2026 : « ＋ La garder » etait une etape de trop ; ici on la retire, la
  // change de vignette ou la supprime) ; seulement 4 vues deja : on choisit celle qu'elle remplace
  const autoPut = React.useRef(false);
  useEffect(() => {
    if (shot && d && !saved && !full && !autoPut.current) { autoPut.current = true; put(0); }
  }, [d, shot, saved, full]); // eslint-disable-line react-hooks/exhaustive-deps
  const tile = { position: "relative", width: 112, display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch" };
  const img = on => ({ width: 112, height: 112, objectFit: "contain", borderRadius: 12, background: "var(--surface2)",
    border: on ? "2px solid #0EA5E9" : "1px solid var(--border)", boxSizing: "border-box" });
  const btn = (main, extra = {}) => ({ height: 28, borderRadius: 9, border: main ? "none" : "1px solid var(--border)", cursor: "pointer", fontSize: 11.5, fontWeight: 800,
    color: main ? "#fff" : "var(--text2)", background: main ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "var(--surface)",
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", padding: "0 6px", ...extra });
  const def = kind === "group" ? "Mosaïque des impressions" : "Image du plateau";
  // la vue qui vient d'etre prise (01/11/2026) : une fois rangee, rien ne la distinguait des autres ; elle porte un
  // badge, un cadre vert, et on l'amene sous les yeux
  const fresh = shot && typeof saved === "number" ? saved : 0;
  const freshRef = React.useRef(null);
  useEffect(() => { if (fresh) freshRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [fresh, d]);
  return <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(2,6,23,.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
    <div onClick={e => e.stopPropagation()} style={{ width: "min(560px, calc(100% - 32px))", maxHeight: "calc(100% - 40px)", overflowY: "auto", padding: "16px 18px",
      borderRadius: 16, background: "var(--sheet-bg)", border: "1px solid var(--border)", boxShadow: "0 20px 60px rgba(0,0,0,.4)", color: "var(--text2)",
      display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <b style={{ flex: 1, fontSize: 16, color: "var(--text)" }}>🧊 Vues 3D {kind === "group" ? "du groupe" : "de l'impression"}</b>
        <button type="button" onClick={close} aria-label="Fermer" style={{ border: "none", background: "none", color: "var(--muted)", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      {shot && !saved && <div style={{ display: "flex", gap: 12, alignItems: "center", padding: 10, borderRadius: 12, border: "1px dashed #0EA5E9" }}>
        <img src={shot.url} alt="" style={img(false)}/>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 700 }}>
          <span>La vue que tu viens de prendre</span>
          {d && !full ? <span style={{ color: "var(--muted)", fontWeight: 600 }}>Enregistrement…</span>
            : d && <span style={{ color: "var(--muted)", fontWeight: 600 }}>Déjà {d.max} vues : touche « ↻ Remplacer » sous celle à écraser.</span>}
        </div>
      </div>}
      {fresh > 0 && <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "8px 12px", borderRadius: 12, fontSize: 12.5, fontWeight: 700,
          background: "rgba(34,197,94,.12)", border: "1px solid rgba(34,197,94,.45)", color: "var(--text)" }}>
        <span>✓</span><span>Ta vue est gardée{sel.includes(fresh) ? " et ajoutée à la vignette" : ""} : c'est celle marquée <b style={{ color: "#16a34a" }}>✨ Nouvelle</b>.</span>
      </div>}
      {!d ? <span>…</span> : <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        <div style={tile}>
          <div style={{ ...img(!sel.length), display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 8, fontSize: 12, fontWeight: 800 }}>
            {kind === "group" ? "🧩" : "🖼"}<br/>{def}</div>
          {sel.length ? <button type="button" disabled={busy} onClick={none} style={btn(false)}>Par défaut</button>
            : <span style={{ fontSize: 11.5, fontWeight: 800, color: "#0EA5E9", textAlign: "center" }}>★ Vignette</span>}
        </div>
        {d.slots.map((s, i) => <div key={s.n} ref={fresh === s.n ? freshRef : null} style={tile}>
          <img src={apiUrl(s.url.replace(/^\/api\/v1/, ""))} alt="" style={fresh === s.n
            ? { ...img(false), border: "2px solid #22c55e", boxShadow: "0 0 0 4px rgba(34,197,94,.22)", animation: "bn-pop .35s ease-out" } : img(sel.includes(s.n))}/>
          {fresh === s.n && <span style={{ position: "absolute", top: 6, left: 6, padding: "2px 8px", borderRadius: 999, fontSize: 10.5, fontWeight: 800,
            color: "#fff", background: "linear-gradient(135deg, #22c55e, #0EA5E9)", boxShadow: "0 2px 8px rgba(0,0,0,.2)", pointerEvents: "none" }}>✨ Nouvelle</span>}
          {sel.includes(s.n) ? <button type="button" disabled={busy} onClick={() => toggle(s.n)} data-tip="Elle est dans la vignette : la retirer"
              style={btn(false, { color: "#0EA5E9", borderColor: "#0EA5E9" })}>★ Choisie</button>
            : <button type="button" disabled={busy} onClick={() => toggle(s.n)} data-tip="L'ajouter à la vignette (plusieurs : elles défilent l'une après l'autre)" style={btn(true)}>⭐ Vignette</button>}
          {shot && !saved && <button type="button" disabled={busy} onClick={() => put(s.n)} style={btn(false)}>↻ Remplacer</button>}
          {d.slots.length > 1 && <div style={{ display: "flex", gap: 6 }}>
            <button type="button" disabled={busy || i === 0} onClick={() => swap(s.n, d.slots[i - 1].n)} aria-label="Avancer"
              data-tip="Avancer cette vue (la première sert d'image seule ; les vues choisies défilent dans cet ordre)"
              style={btn(false, { flex: 1, opacity: i === 0 ? 0.35 : 1 })}>◀</button>
            <button type="button" disabled={busy || i === d.slots.length - 1} onClick={() => swap(s.n, d.slots[i + 1].n)} aria-label="Reculer"
              data-tip="Reculer cette vue" style={btn(false, { flex: 1, opacity: i === d.slots.length - 1 ? 0.35 : 1 })}>▶</button>
          </div>}
          <button type="button" disabled={busy} onClick={() => drop(s.n)} style={sure === s.n ? btn(false, { color: "#fff", background: "#991b1b", borderColor: "#991b1b", boxShadow: "0 4px 12px -4px #991b1b" })
            : btn(false, { color: "#ef4444" })}>{sure === s.n ? "⚠ Confirmer" : "🗑 Supprimer"}</button>
        </div>)}
      </div>}
      {d?.cover && sel.length > 1 && <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, fontWeight: 700 }}>
        <img src={(u => `${u}${u.includes("?") ? "&" : "?"}v=${d.cover.v}`)(apiUrl(`${kind === "group" ? `/prints/groups/${id}/photo` : `/prints/${id}/file`}/${d.cover.name}`))} alt="" style={{ ...img(true), width: 72, height: 72 }}/>
        <span>La vignette : les {sel.length} vues choisies défilent l'une après l'autre</span>
      </div>}
      {d && !d.slots.length && !shot && <span style={{ fontSize: 12.5 }}>Aucune vue : prends-en une avec 📸 dans la vue 3D.</span>}
      {/* les animations (08/11/2026) : une par effet, en boucle ici, en grand au toucher ; la premiere tourne en tete de fiche */}
      {!!d?.anims?.length && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 900 }}>🎞 {d.anims.length > 1 ? `Les animations (${d.anims.length})` : "L'animation"}
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}> · une par effet ; la première tourne en tête de la fiche</span></span>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {d.anims.map((a, i) => { const u = apiUrl(a.url.replace(/^\/api\/v1/, ""));
            const mini = { padding: "4px 8px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, fontSize: 11.5, cursor: "pointer" };
            return <div key={a.name} style={tile}>
              <video src={u} autoPlay loop muted playsInline onClick={() => setPlay(u)} data-tip="La lire en grand"
                style={{ ...img(i === 0), width: 112, height: 112, objectFit: "cover", cursor: "pointer", background: "#111" }}/>
              <span style={{ fontSize: 11.5, fontWeight: 900, textAlign: "center", lineHeight: 1.2 }}>{(ANIM_STYLES.find(s => s[0] === a.style) || [])[1] || "🎞"} {a.label}</span>
              {i === 0 ? <span style={{ ...mini, cursor: "default", color: "#0EA5E9", borderColor: "#0EA5E9", textAlign: "center" }}>★ En tête</span>
                : <button type="button" disabled={busy} onClick={() => act(() => client.post(`${base}/vue3d/anim/top`, null, { params: { name: a.name } }))}
                    data-tip="La faire tourner en tête de la fiche" style={mini}>⭐ En tête</button>}
              <button type="button" disabled={busy} onClick={async () => { if (await showConfirm(`Supprimer l'animation « ${a.label} » ?`, { danger: true, confirmLabel: "Supprimer" })) act(() => client.delete(`${base}/vue3d/anim`, { params: { name: a.name } })); }}
                style={{ ...mini, background: "transparent", color: "#ef4444", borderColor: "color-mix(in srgb, #ef4444 40%, var(--border))" }}>🗑 Supprimer</button>
            </div>; })}
        </div>
        <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Faites avec 🎞 dans la vue 3D ; refaire le même effet remplace la sienne.</span>
        {play && <AnimPlayer url={play} onClose={() => setPlay(null)}/>}
      </div>}
      <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Jusqu'à {d?.max || 4} vues, prises avec 📸 dans la vue 3D : un plateau ou l'assemblage, de jour, de nuit ou éclairé par derrière, telle qu'affichée. Plusieurs choisies : elles défilent l'une après l'autre sur la vignette.</span>
    </div>
  </div>;
}

export function openVue3D(opts) {
  const host = document.createElement("div");
  (document.fullscreenElement || document.body).appendChild(host);
  const root = createRoot(host);
  const close = () => { root.unmount(); host.remove(); };
  root.render(<Picker {...opts} close={close}/>);
  return close;
}
