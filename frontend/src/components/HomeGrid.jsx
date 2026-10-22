import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight, EyeOff, Plus, RotateCcw, Check, GripVertical, Columns, Monitor, Smartphone } from "lucide-react";
import client from "../api/client";
import { toast } from "../store/toast";
import { TILES, useTilesData } from "./HomeTiles";

// La grille de l'accueil, a la carte (22/10/2026). Deux dispositions par
// compte : « dash » (PC, des colonnes, chacune coupee en deux sous-colonnes) et
// « mobile » (une colonne en deux sous-colonnes). Chaque tuile a une largeur
// (1 = moitie de sa colonne, 2 = toute la colonne) et une hauteur (rangees, ou
// « auto » : selon son contenu), parmi celles que son type accepte.

const WIDE = 1024;
const ROW = 118;                                   // hauteur d'une rangee (px)

function useWide() {
  const [w, setW] = useState(() => window.innerWidth >= WIDE);
  useEffect(() => {
    const f = () => setW(window.innerWidth >= WIDE);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return w;
}

// Disposition par defaut ; « defs » = les tuiles connues (les blocs de l'accueil + le catalogue)
function defaults(defs) {
  const it = id => ({ id, w: defs[id].w[0], h: defs[id].h[0] });
  const small = ["today", "week", "next", "last", "stock", "dry", "humidity", "friends", "mw", "rate", "wheel", "ach"].filter(id => defs[id]);
  return {
    v: 1,
    dash: { cols: 2, columns: [["printer", "ams"].filter(id => defs[id]).map(it), [...small, "attention"].filter(id => defs[id]).map(it)] },
    mobile: { items: ["printer", "ams", ...small, "attention"].filter(id => defs[id]).map(it) },
  };
}
// Remet d'aplomb une disposition gardee : tuiles inconnues retirees, tailles
// ramenees a ce que la tuile accepte ; une tuile apparue depuis attend dans « Ajouter ».
function normalize(lay, defs) {
  const base = defaults(defs);
  if (!lay || lay.v !== 1) return base;
  const fix = x => defs[x?.id] ? { id: x.id, w: defs[x.id].w.includes(x.w) ? x.w : defs[x.id].w[0],
    h: defs[x.id].h.includes(x.h) ? x.h : defs[x.id].h[0] } : null;
  const cols = Math.max(1, Math.min(4, parseInt(lay.dash?.cols) || 2));
  const columns = [...Array(cols)].map((_, i) => ((lay.dash?.columns || [])[i] || []).map(fix).filter(Boolean));
  // une colonne retiree : ses tuiles passent dans la derniere
  (lay.dash?.columns || []).slice(cols).forEach(c => columns[cols - 1].push(...(c || []).map(fix).filter(Boolean)));
  const uniq = arr => { const seen = new Set(); return arr.filter(x => !seen.has(x.id) && seen.add(x.id)); };
  const all = new Set();
  const dash = { cols, columns: columns.map(c => uniq(c).filter(x => !all.has(x.id) && all.add(x.id))) };
  const mobile = { items: uniq((lay.mobile?.items || []).map(fix).filter(Boolean)) };
  // une tuile obligatoire n'est jamais absente
  for (const [id, d] of Object.entries(defs)) {
    if (!d.required) continue;
    if (!dash.columns.some(c => c.some(x => x.id === id))) dash.columns[0].unshift({ id, w: d.w[0], h: d.h[0] });
    if (!mobile.items.some(x => x.id === id)) mobile.items.unshift({ id, w: d.w[0], h: d.h[0] });
  }
  return { v: 1, dash, mobile };
}

function Cell({ item, def, edit, children, actions, drag, selected, onSelect }) {
  const span = item.h === "auto" ? "auto" : `span ${item.h}`;
  return (
    <div className={`hg-cell${edit ? " hg-edit" : ""}`} draggable={edit && drag ? true : undefined}
      onClick={edit ? e => { e.stopPropagation(); onSelect(); } : undefined}
      onDragStart={drag?.start} onDragOver={drag?.over} onDrop={drag?.drop} onDragEnd={drag?.end}
      style={{ gridColumn: `span ${item.w}`, gridRow: span, minWidth: 0, position: "relative",
        ...(edit ? { outline: selected ? "3px solid #3b82f6" : "2px dashed rgba(59,130,246,0.55)", outlineOffset: 2, borderRadius: 16,
          cursor: "pointer",
          opacity: drag?.dragging ? 0.4 : 1 } : {}) }}>
      <div style={{ height: "100%", pointerEvents: edit ? "none" : undefined, filter: edit ? "saturate(0.85)" : undefined }}>
{children}</div>
      {edit && !selected && (
        <span style={{ position: "absolute", left: 8, top: 8, zIndex: 3, display: "inline-flex", alignItems: "center", gap: 4, maxWidth: "calc(100% - 16px)",
          padding: "3px 9px 3px 6px", borderRadius: 20, background: "rgba(15,23,42,0.82)", color: "#fff", fontSize: 11.5, fontWeight: 800,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", boxShadow: "0 4px 10px rgba(0,0,0,0.25)" }}>
          {drag && <GripVertical size={13} style={{ opacity: 0.8, flexShrink: 0 }}/>}{def.label}</span>
      )}
      {edit && selected && (
        <div onClick={e => e.stopPropagation()} style={{ position: "absolute", left: 6, right: 6, top: 6, zIndex: 4, display: "flex",
          flexDirection: "column", gap: 5, padding: "7px 8px", borderRadius: 12, background: "rgba(15,23,42,0.92)", color: "#fff",
          boxShadow: "0 8px 22px rgba(0,0,0,0.35)" }}>
          <span style={{ fontSize: 12, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{def.label}</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{actions}</div>
        </div>
      )}
    </div>
  );
}
const btn = (on = false) => ({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, minWidth: 24, height: 26,
  padding: "0 5px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 11.5, fontWeight: 800,
  color: on ? "#0f172a" : "#fff", background: on ? "#fff" : "rgba(255,255,255,0.14)" });

export default function HomeGrid({ status, blocks }) {
  const data = useTilesData();
  const wide = useWide();
  const defs = useMemo(() => ({ ...blocks, ...TILES }), [blocks]);
  const [lay, setLay] = useState(() => defaults(defs));
  const [edit, setEdit] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [sel, setSel] = useState(null);
  const saved = useRef(null);
  const view = wide ? "dash" : "mobile";

  useEffect(() => {
    client.get("/home/layout").then(({ data }) => { const l = normalize(data?.layout, defs); setLay(l); saved.current = JSON.stringify(l); })
      .catch(() => {});
    const open = () => setEdit(true);
    window.addEventListener("bn-home-edit", open);
    return () => window.removeEventListener("bn-home-edit", open);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (l, reset = false) => {
    try {
      await client.put("/home/layout", { layout: reset ? null : l });
      saved.current = JSON.stringify(l);
      toast(reset ? "Accueil remis par défaut" : "Disposition enregistrée", "success");
    } catch (e) { toast(e.response?.data?.detail || e.message, "error"); }
  };
  const done = () => { setEdit(false); setSel(null); if (JSON.stringify(lay) !== saved.current) save(lay); };
  const reset = () => { const l = defaults(defs); setLay(l); save(l, true); };

  // ── les listes de la vue en cours : [colonnes] (mobile : une seule) ──
  const cols = view === "dash" ? lay.dash.columns : [lay.mobile.items];
  const setCols = next => setLay(l => view === "dash" ? { ...l, dash: { ...l.dash, columns: next } } : { ...l, mobile: { items: next[0] } });
  const where = id => { for (let c = 0; c < cols.length; c++) { const i = cols[c].findIndex(x => x.id === id); if (i >= 0) return [c, i]; } return null; };
  const update = (id, patch) => setCols(cols.map(c => c.map(x => x.id === id ? { ...x, ...patch } : x)));
  const move = (id, dc, di) => {
    const p = where(id); if (!p) return;
    const next = cols.map(c => [...c]);
    const [it] = next[p[0]].splice(p[1], 1);
    const c = Math.max(0, Math.min(next.length - 1, p[0] + dc));
    const i = dc ? Math.min(p[1], next[c].length) : Math.max(0, Math.min(next[c].length, p[1] + di));
    next[c].splice(i, 0, it);
    setCols(next);
  };
  const dropOn = (targetId, colIdx) => {
    if (!dragId || dragId === targetId) return;
    const p = where(dragId); if (!p) return;
    const next = cols.map(c => [...c]);
    const [it] = next[p[0]].splice(p[1], 1);
    let placed = false;
    if (targetId) {
      for (let c = 0; c < next.length && !placed; c++) {
        const i = next[c].findIndex(x => x.id === targetId);
        if (i >= 0) { next[c].splice(i, 0, it); placed = true; }
      }
    }
    if (!placed) next[colIdx].push(it);
    setCols(next);
    setDragId(null);
  };
  const hide = id => setCols(cols.map(c => c.filter(x => x.id !== id)));
  const shown = new Set(cols.flat().map(x => x.id));
  const hidden = Object.keys(defs).filter(id => !shown.has(id));
  const add = id => { const next = cols.map(c => [...c]); next[next.length - 1].push({ id, w: defs[id].w[0], h: defs[id].h[0] }); setCols(next); };
  const setNCols = n => setLay(l => {
    const cur = l.dash.columns.map(c => [...c]);
    while (cur.length < n) cur.push([]);
    const keep = cur.slice(0, n);
    cur.slice(n).forEach(c => keep[n - 1].push(...c));
    return { ...l, dash: { cols: n, columns: keep } };
  });

  const renderItem = (item, ci) => {
    const def = defs[item.id];
    if (!def) return null;
    const p = where(item.id);
    const actions = <>
      {view === "dash" && cols.length > 1 && <>
        <button style={btn()} disabled={p[0] === 0} onClick={() => move(item.id, -1, 0)} aria-label="Colonne de gauche"><ArrowLeft size={13}/></button>
        <button style={btn()} disabled={p[0] === cols.length - 1} onClick={() => move(item.id, 1, 0)} aria-label="Colonne de droite"><ArrowRight size={13}/></button>
      </>}
      <button style={btn()} onClick={() => move(item.id, 0, -1)} aria-label="Monter"><ArrowUp size={13}/></button>
      <button style={btn()} onClick={() => move(item.id, 0, 1)} aria-label="Descendre"><ArrowDown size={13}/></button>
      {def.w.length > 1 && def.w.map(w => <button key={"w" + w} style={btn(item.w === w)} onClick={() => update(item.id, { w })}
        title={w === 1 ? "Demi-largeur" : "Toute la largeur"}>{w === 1 ? "½" : "1"}</button>)}
      {def.h.length > 1 && def.h.map(h => <button key={"h" + h} style={btn(item.h === h)} onClick={() => update(item.id, { h })}
        title={h === "auto" ? "Hauteur selon le contenu" : `${h} rangée${h > 1 ? "s" : ""} de haut`}>{h === "auto" ? "↕" : `${h}↕`}</button>)}
      {!def.required && <button style={btn()} onClick={() => hide(item.id)} aria-label="Masquer"><EyeOff size={13}/></button>}
    </>;
    const drag = wide ? {
      dragging: dragId === item.id,
      start: e => { setDragId(item.id); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", item.id); } catch { /* rien */ } },
      over: e => { e.preventDefault(); },
      drop: e => { e.preventDefault(); dropOn(item.id, ci); },
      end: () => setDragId(null),
    } : null;
    return (
      <Cell key={item.id} item={item} def={def} edit={edit} actions={actions} drag={edit ? drag : null}
        selected={sel === item.id} onSelect={() => setSel(s => s === item.id ? null : item.id)}>
        {def.render(data, status)}
      </Cell>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <style>{`
        .hg-cols { display:grid; gap:12px; align-items:start; }
        .hg-col { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); grid-auto-rows:minmax(${ROW}px, auto);
                  grid-auto-flow:row dense; gap:10px; min-width:0; }
        .hg-cell:not(.hg-edit):has(> div:empty) { display:none; }
        .hg-edit > div:empty { min-height:${ROW - 10}px; border-radius:16px; background:var(--surface2); display:flex;
                  align-items:flex-end; justify-content:center; padding-bottom:12px; box-sizing:border-box; }
        .hg-edit > div:empty::before { content:"Rien à montrer pour l'instant"; font-size:12px; color:var(--muted); font-weight:700; }
        .hg-col > .hg-drop { grid-column:1 / -1; min-height:44px; border:2px dashed rgba(59,130,246,0.45); border-radius:14px;
                  display:flex; align-items:center; justify-content:center; font-size:12px; color:var(--muted); font-weight:700; }
      `}</style>
      {edit && (
        <div className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10,
          border: "1px solid rgba(59,130,246,0.45)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {wide ? <Monitor size={16}/> : <Smartphone size={16}/>}
            <span style={{ fontWeight: 900, fontSize: 14, color: "var(--text)" }}>
              Personnaliser l'accueil · {wide ? "disposition PC" : "disposition mobile"}</span>
            <span style={{ flex: 1 }}/>
            <button onClick={reset} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 10px", borderRadius: 10,
              border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>
              <RotateCcw size={14}/>Par défaut</button>
            <button onClick={done} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 10,
              border: "none", background: "#3b82f6", color: "#fff", fontWeight: 800, fontSize: 12.5, cursor: "pointer" }}>
              <Check size={14}/>Terminé</button>
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
            {wide ? "Touche une tuile pour ses réglages, ou glisse-la pour la déplacer. " : "Touche une tuile pour la déplacer ou la régler. "}
            « ½ » et « 1 » règlent la largeur, « ↕ » la hauteur. L'autre disposition ({wide ? "mobile" : "PC"}) se règle depuis
            {wide ? " un téléphone" : " un ordinateur"}.</div>
          {wide && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <Columns size={15} style={{ color: "var(--muted)" }}/>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>Colonnes</span>
              {[1, 2, 3, 4].map(n => <button key={n} onClick={() => setNCols(n)} style={{ width: 32, height: 30, borderRadius: 9, cursor: "pointer",
                fontWeight: 800, border: "1px solid var(--border)", background: lay.dash.cols === n ? "#3b82f6" : "var(--surface2)",
                color: lay.dash.cols === n ? "#fff" : "var(--text2)" }}>{n}</button>)}
            </div>
          )}
          {hidden.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>Ajouter :</span>
              {hidden.map(id => <button key={id} onClick={() => add(id)} style={{ display: "inline-flex", alignItems: "center", gap: 4,
                padding: "5px 10px", borderRadius: 20, cursor: "pointer", fontSize: 12, fontWeight: 700, border: "1px dashed rgba(59,130,246,0.6)",
                background: "rgba(59,130,246,0.08)", color: "#3b82f6" }}><Plus size={13}/>{defs[id].label}</button>)}
            </div>
          )}
        </div>
      )}
      <div className="hg-cols" style={{ gridTemplateColumns: `repeat(${cols.length}, minmax(0,1fr))` }}>
        {cols.map((c, ci) => (
          <div key={ci} className="hg-col">
            {c.map(item => renderItem(item, ci))}
            {edit && wide && (
              <div className="hg-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); dropOn(null, ci); }}>
                {c.length ? "Déposer ici" : "Colonne vide · dépose une tuile"}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
