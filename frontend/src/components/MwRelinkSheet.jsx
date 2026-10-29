import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Search, X } from "lucide-react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import MakerWorldModelSheet from "./MakerWorldModelSheet";

// Les impressions sans modele MakerWorld, regroupees par nom (29/10/2026) : une tuile par « modele ».
// Le scan cherche chacun sur MakerWorld par son nom d'origine (ou le titre lu dans son 3MF) : un resultat net
// est rattache tout seul, un doute attend qu'on choisisse parmi les candidats. Il avance un modele a la fois,
// s'arrete si MakerWorld refuse, et reprend ou il en etait.
const C = "#0EA5E9";
const ST = {
  doubt:   { label: "À choisir", icon: "🤔", color: "#F59E0B" },
  todo:    { label: "À chercher", icon: "🔎", color: "#64748B" },
  none:    { label: "Rien trouvé", icon: "∅", color: "#94A3B8" },
  linked:  { label: "Rattachés", icon: "✓", color: "#16A34A" },
  ignored: { label: "Ignorés", icon: "🚫", color: "#94A3B8" },
};
const ORDER = ["doubt", "todo", "none", "linked", "ignored"];
const pc = s => `${Math.round((s || 0) * 100)} %`;

function Thumb({ src, size = "100%" }) {
  const [bad, setBad] = useState(false);
  return (
    <div style={{ width: size, aspectRatio: "1", borderRadius: 12, overflow: "hidden", background: "var(--surface2)", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>
      {src && !bad ? <img src={src} alt="" loading="lazy" onError={() => setBad(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }}/> : "🖨"}
    </div>
  );
}

// un modele : ses candidats, a choisir ; une recherche sous un autre nom ; « aucun »
function UnitDetail({ u, onClose, onDone, narrow, z }) {
  const [cands, setCands] = useState(u.candidates || []);
  const [q, setQ] = useState(u.query || u.original || u.name);
  const [busy, setBusy] = useState(false);
  const [peek, setPeek] = useState(null);
  const call = async (path, body) => {
    setBusy(true);
    try { const r = await client.post(`/makerworld/relink/${path}`, body); return r.data; }
    catch (e) { showAlert(e.response?.data?.detail || e.message); return null; }
    finally { setBusy(false); }
  };
  const choose = async c => { if (await call("choose", { key: u.key, design_id: c.design_id })) onDone(); };
  const search = async () => { const d = q.trim() && await call("search", { key: u.key, q: q.trim() }); if (d) setCands(d.candidates || []); };
  const st = ST[u.status] || ST.todo;
  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: z + 5, padding: narrow ? 0 : 14, background: "rgba(2,6,23,0.5)",
      display: "flex", alignItems: narrow ? "flex-end" : "center", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: narrow ? "100%" : "min(640px, 100%)", maxHeight: narrow ? "88vh" : "86vh", display: "flex",
        flexDirection: "column", overflow: "hidden", borderRadius: narrow ? "24px 24px 0 0" : 22, background: "var(--sheet-bg)", border: "1px solid var(--border)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.45)", animation: narrow ? "bn-sheet-up .3s cubic-bezier(.2,.8,.2,1)" : "bn-pop .2s ease-out" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "14px 16px", borderBottom: "1px solid var(--border)" }}>
          <Thumb src={u.image} size={52}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.name}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
              {u.count} impression{u.count > 1 ? "s" : ""} · <span style={{ color: st.color }}>{st.icon} {st.label}</span>
              {u.original && u.original !== u.name && <> · nom d'origine « {u.original} »</>}</div>
          </div>
          <button onClick={onClose} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)",
            color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={17}/></button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "12px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {u.status === "linked" && <div style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(22,163,74,.10)", fontSize: 12.5, fontWeight: 700, color: "var(--text2)",
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 180 }}>✓ Rattaché {u.auto ? "automatiquement " : ""}au modèle {u.chosen}</span>
            <button onClick={() => setPeek(u.chosen)} style={btn(false)}>Voir</button>
            <button disabled={busy} onClick={async () => { if (await call("unlink", { key: u.key })) onDone(); }} style={btn(false, "#ef4444")}>Défaire</button>
          </div>}
          {/* une recherche sous un autre nom */}
          <div style={{ display: "flex", gap: 6 }}>
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") search(); }} placeholder="Chercher sur MakerWorld…"
              style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, outline: "none" }}/>
            <button disabled={busy} onClick={search} aria-label="Chercher" style={{ ...btn(true), display: "flex", alignItems: "center", gap: 6 }}>
              <Search size={15} style={{ animation: busy ? "spin 1s linear infinite" : "none" }}/>{narrow ? "" : "Chercher"}</button>
          </div>
          {!cands.length ? <div style={{ padding: 24, textAlign: "center", color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>
            {u.status === "todo" ? "Pas encore cherché : lance le scan, ou cherche ci-dessus." : "Aucun candidat : essaie un autre nom ci-dessus."}</div>
            : cands.map((c, i) => {
              const on = u.status === "linked" && String(c.design_id) === String(u.chosen);
              const col = c.score >= 0.86 ? "#16A34A" : c.score >= 0.6 ? "#F59E0B" : "#94A3B8";
              return (
                <div key={c.design_id} style={{ display: "flex", gap: 10, alignItems: "center", padding: 8, borderRadius: 14,
                  border: `1px solid ${on ? "#16A34A" : i === 0 ? `${col}66` : "var(--border)"}`, background: on ? "rgba(22,163,74,.07)" : "var(--surface)" }}>
                  <button onClick={() => setPeek(c.design_id)} data-tip="Voir la fiche" style={{ padding: 0, border: "none", background: "none", cursor: "pointer", flexShrink: 0 }}>
                    <Thumb src={c.cover_url} size={narrow ? 64 : 76}/></button>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {c.title_fr || c.title}</div>
                    {c.title_fr && c.title && c.title_fr !== c.title && <div style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div>}
                    <div style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 700, marginTop: 2 }}>
                      {c.creator_name ? `par ${c.creator_name}` : ""}{c.print_count != null ? ` · ${c.print_count.toLocaleString("fr-FR")} impressions` : ""}</div>
                    <span style={{ display: "inline-block", marginTop: 4, fontSize: 11, fontWeight: 900, color: col, padding: "1px 8px", borderRadius: 20, background: `${col}1f` }}
                      data-tip="Ressemblance des noms">{pc(c.score)}</span>
                  </div>
                  {!on && <button disabled={busy} onClick={() => choose(c)} style={{ ...btn(true), flexShrink: 0 }}>{narrow ? "✓" : "C'est celui-là"}</button>}
                </div>
              );
            })}
          {u.status !== "linked" && <button disabled={busy} onClick={async () => { if (await call("ignore", { key: u.key, on: u.status !== "ignored" })) onDone(); }}
            style={{ ...btn(false), alignSelf: "flex-start" }}>{u.status === "ignored" ? "↺ Remettre à trier" : "🚫 Aucun, il n'est pas sur MakerWorld"}</button>}
        </div>
      </div>
      {/* un portail : ses clics remontent quand meme l'arbre React jusqu'a notre voile */}
      {peek && <div onClick={e => e.stopPropagation()}><MakerWorldModelSheet designId={String(peek)} z={z + 10} onClose={() => setPeek(null)}/></div>}
    </div>, document.body);
}

const btn = (main, color) => ({ padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap",
  border: main ? "none" : "1px solid var(--border)", color: main ? "#fff" : (color || "var(--text2)"),
  background: main ? `linear-gradient(135deg, ${C}, #6366F1)` : "var(--surface2)" });

export default function MwRelinkSheet({ onClose, onChanged, z = 950 }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const narrow = typeof window !== "undefined" && window.innerWidth < 560;
  const load = () => client.get("/makerworld/relink").then(r => { setD(r.data); setErr(null); }).catch(e => setErr(e.response?.data?.detail || e.message));
  useEffect(() => { load(); }, []);
  const run = !!d?.scan?.running;
  useEffect(() => {
    if (!run) return undefined;
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [run]);
  useEffect(() => { const k = e => { if (e.key === "Escape" && !open) onClose(); }; window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const units = d?.units || [];
  const by = {};
  units.forEach(u => { (by[u.status] = by[u.status] || []).push(u); });
  const cur = tab || ORDER.find(k => by[k]?.length) || "todo";
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = (by[cur] || []).filter(u => words.every(w => `${u.name} ${u.original}`.toLowerCase().includes(w)));
  const sc = d?.scan || {};
  const toScan = (by.todo || []).length;
  const act = (path, body) => client.post(`/makerworld/relink/${path}`, body || {}).then(load).catch(e => showAlert(e.response?.data?.detail || e.message));
  const done = () => { setOpen(null); load(); onChanged?.(); };
  const prints = units.filter(u => u.status !== "linked").reduce((n, u) => n + u.count, 0);

  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: z, padding: narrow ? 0 : 14, background: "rgba(2,6,23,0.55)",
      backdropFilter: "blur(6px)", display: "flex", alignItems: narrow ? "flex-end" : "center", justifyContent: "center", animation: "bn-fade .2s ease-out" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: narrow ? "100%" : "min(900px, 100%)", maxHeight: narrow ? "92vh" : "90vh", height: narrow ? "92vh" : "90vh",
        display: "flex", flexDirection: "column", overflow: "hidden", borderRadius: narrow ? "26px 26px 0 0" : 24, background: "var(--sheet-bg)",
        border: "1px solid var(--border)", boxShadow: "0 30px 80px rgba(0,0,0,0.45)",
        animation: narrow ? "bn-sheet-up .3s cubic-bezier(.2,.8,.2,1)" : "bn-pop .24s cubic-bezier(.2,.8,.2,1)" }}>
        <div style={{ position: "relative", padding: narrow ? "10px 16px 14px" : "16px 18px", overflow: "hidden", flexShrink: 0,
          background: `linear-gradient(135deg, ${C}38, ${C}10 55%, transparent)` }}>
          <span aria-hidden="true" style={{ position: "absolute", right: -50, top: -70, width: 180, height: 180, borderRadius: "50%", background: `${C}30` }}/>
          {narrow && <div style={{ width: 42, height: 4, borderRadius: 4, background: "var(--border)", margin: "0 auto 10px" }}/>}
          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
            <span style={{ width: 44, height: 44, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 22,
              background: `linear-gradient(135deg, ${C}, #6366F1)`, color: "#fff", boxShadow: `0 8px 20px ${C}55` }}>🌐</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: narrow ? 17 : 19, fontWeight: 900, color: "var(--text)" }}>Modèles MakerWorld manquants</span>
              {d && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
                {units.filter(u => u.status !== "linked").length} modèles · {prints} impression{prints > 1 ? "s" : ""} sans fiche</span>}
            </span>
            <button onClick={load} aria-label="Relire" data-tip="Relire" style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)",
              color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><RefreshCw size={16}/></button>
            <button onClick={onClose} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)",
              color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={17}/></button>
          </div>
        </div>

        <div className="bn-zoom-body" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: narrow ? "12px 14px 22px" : "14px 18px 20px",
          display: "flex", flexDirection: "column", gap: 12 }}>
          {err && <div style={{ color: "#ef4444", fontWeight: 700, fontSize: 13 }}>{err}</div>}
          {!d && !err && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontWeight: 700 }}>⏳ On regroupe les impressions…</div>}

          {/* le scan : avancement, arret, reprise */}
          {d && <div style={{ padding: "12px 14px", borderRadius: 14, border: `1px solid ${run ? `${C}55` : "var(--border)"}`, background: run ? `${C}0d` : "var(--surface)",
            display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 220px", fontSize: 12.5, fontWeight: 700, color: "var(--text2)", lineHeight: 1.45 }}>
                {run ? <>⏳ Recherche en cours · <b>{sc.done} / {sc.total}</b>{sc.current ? <> · « {sc.current} »</> : null}</>
                  : sc.total ? <>Dernier scan : {sc.done} / {sc.total} modèles vus{sc.done < sc.total ? " (interrompu)" : ""}</>
                  : <>Cherche chaque modèle sur MakerWorld par son nom d'origine : un résultat net est rattaché tout seul, un doute t'attend dans « À choisir ».</>}
                {(sc.total > 0) && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 5 }}>
                  {[["found", "rattachés", "#16A34A"], ["doubt", "à choisir", "#F59E0B"], ["none", "sans résultat", "#94A3B8"]].map(([k, l, c]) =>
                    <span key={k} style={{ fontSize: 11.5, fontWeight: 800, color: c, padding: "2px 8px", borderRadius: 20, background: `${c}1a` }}>{sc[k] || 0} {l}</span>)}
                </div>}
                {sc.stopped && !run && <div style={{ color: "#d97706", marginTop: 4 }}>{sc.stopped}</div>}
              </span>
              {run ? <button onClick={() => act("stop")} style={btn(false)}>■ Arrêter</button>
                : <>
                  <button disabled={!toScan} onClick={() => act("start")} style={{ ...btn(true), opacity: toScan ? 1 : 0.5 }}>
                    {sc.total && sc.done < sc.total ? `▶ Reprendre (${toScan})` : `🔎 Lancer le scan (${toScan})`}</button>
                  {(by.none || []).length > 0 && <button onClick={() => act("start", { again: true })} style={btn(false)}
                    data-tip="Recherche aussi les modèles qui n'avaient rien donné">↻ Avec les « rien trouvé »</button>}
                </>}
            </div>
            {run && sc.total > 0 && <div style={{ height: 8, borderRadius: 6, background: "var(--surface2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round(100 * sc.done / sc.total)}%`, borderRadius: 6, background: `linear-gradient(90deg, ${C}, #6366F1)`, transition: "width .4s" }}/></div>}
          </div>}

          {d && <>
            <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 13, background: "var(--surface2)", overflowX: "auto", flexShrink: 0 }}>
              {ORDER.map(k => { const on = cur === k, n = (by[k] || []).length;
                return <button key={k} onClick={() => setTab(k)} style={{ flex: "1 0 auto", padding: "7px 10px", borderRadius: 10, border: "none", cursor: "pointer",
                  fontSize: 12.5, fontWeight: 800, whiteSpace: "nowrap", color: on ? "#fff" : "var(--text2)", opacity: n || on ? 1 : 0.55,
                  background: on ? `linear-gradient(135deg, ${ST[k].color}, ${ST[k].color}cc)` : "transparent" }}>{ST[k].icon} {ST[k].label} {n}</button>; })}
            </div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrer par nom…"
              style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)",
                color: "var(--text)", fontSize: 13, outline: "none" }}/>
            {!list.length ? <div style={{ padding: 30, textAlign: "center", color: "var(--muted)", fontSize: 13, fontWeight: 700 }}>
              {cur === "doubt" ? "Rien à choisir pour l'instant." : "Aucun modèle ici."}</div>
              : <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${narrow ? 140 : 160}px, 1fr))`, gap: 10 }}>
                {list.map(u => { const top = u.candidates?.[0];
                  return (
                    <button key={u.key} onClick={() => setOpen(u)} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 16, cursor: "pointer",
                      border: "1px solid var(--border)", background: "var(--surface)", textAlign: "left", color: "var(--text)", minWidth: 0 }}>
                      <div style={{ position: "relative" }}>
                        <Thumb src={u.image}/>
                        {u.count > 1 && <span style={{ position: "absolute", top: 6, right: 6, fontSize: 11, fontWeight: 900, color: "#fff", padding: "1px 7px", borderRadius: 20,
                          background: "rgba(15,23,42,.75)" }}>×{u.count}</span>}
                        {top?.cover_url && (u.status === "doubt" || u.status === "linked") && <img src={top.cover_url} alt="" loading="lazy" data-tip="Meilleur candidat"
                          style={{ position: "absolute", bottom: -6, right: -4, width: 42, height: 42, objectFit: "cover", borderRadius: 10, border: "2px solid var(--surface)",
                            boxShadow: "0 4px 10px rgba(0,0,0,.25)" }}/>}
                      </div>
                      <span style={{ fontSize: 12.5, fontWeight: 800, lineHeight: 1.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{u.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
                        {u.status === "doubt" ? `${u.candidates.length} candidat${u.candidates.length > 1 ? "s" : ""} · ${pc(top?.score)}`
                          : u.status === "linked" ? (u.auto ? "✓ automatique" : "✓ choisi") : `${u.count} impression${u.count > 1 ? "s" : ""}`}</span>
                    </button>
                  ); })}
              </div>}
          </>}
        </div>
      </div>
      {open && <div onClick={e => e.stopPropagation()}><UnitDetail u={open} narrow={narrow} z={z} onClose={() => setOpen(null)} onDone={done}/></div>}
    </div>, document.body);
}
