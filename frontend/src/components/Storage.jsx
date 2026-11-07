import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import CardHelp from "./CardHelp";
import SpoolSVG from "./SpoolSVG";
import { FSheet, fBtn } from "./FicheKit";
import { openMenu } from "./ContextMenu";
import { showAlert, showConfirm } from "../utils/dialog";
import { parseColorsList, finishOf } from "../utils/colors";

// Les rangements des bobines (07/11/2026) : le mode (un seul rangement, chaque bobine a sa place, rangement manuel),
// l'arbre des emplacements (Tiroir 1 › Colonne 1 › Ligne 3, Rack 1 › A2…), ranger une bobine, les bobines « À ranger »
// et la vue du stock par rangement. Le serveur tient tout (services/storage_places.py) ; ici, un seul chargement
// partage par toutes les vues, recharge apres chaque changement.

export const STORAGE_MODES = [
  ["single", "🗄", "Un seul rangement", "Tout ce qui sort de l'imprimante va au même endroit. C'est le mode d'origine ; donne-lui le nom que tu veux (Tiroir, Étagère, Placard…)."],
  ["assigned", "📍", "Chaque bobine a sa place", "Une bobine est dans l'imprimante ou à SA place, rien d'autre : en sortant de l'AMS, elle y retourne d'office. Une case ne prend qu'une bobine, gardée pendant qu'elle est dans l'AMS."],
  ["manual", "✋", "Je range où je veux", "Une bobine qui sort de l'AMS (ou qui arrive) passe « À ranger » et l'appli te rappelle de dire où tu l'as mise ; sa dernière place est proposée en premier."],
];

let _data = null, _loading = null, _ver = 0;
const _subs = new Set();
const _emit = () => _subs.forEach(f => f(_data));
const _set = (d, write = false) => { _data = { ...d, _v: write ? ++_ver : _ver }; _emit(); return _data; };

export function reloadStorage() {
  if (!_loading) _loading = client.get("/storage").then(r => _set(r.data)).catch(() => _data).finally(() => { _loading = null; });
  return _loading;
}

export function useStorage() {
  const [d, setD] = useState(_data);
  useEffect(() => {
    _subs.add(setD);
    if (_data) setD(_data); else reloadStorage();
    return () => { _subs.delete(setD); };
  }, []);
  return d;
}

const errMsg = e => { const d = e?.response?.data?.detail; return typeof d === "string" ? d : d?.message || e?.message || "Erreur"; };

async function write(method, url, body) {
  try {
    const { data } = await client[method](url, body);
    _set(data, true);
    return data;
  } catch (e) { showAlert(errMsg(e)); return null; }
}

// Ranger des bobines a une place ; une case prise par une autre : on propose de la deloger (elle repasse « À ranger »).
export async function assignSpools(ids, placeId) {
  try {
    const { data } = await client.post("/storage/assign", { spool_ids: ids, place_id: placeId });
    rememberPlace(placeId);
    return _set(data, true);
  } catch (e) {
    const d = e?.response?.data?.detail;
    if (e?.response?.status === 409 && d?.occupant) {
      if (!(await showConfirm(`${d.message}.\nLa déloger ? Elle repassera « À ranger ».`, { confirmLabel: "Déloger et ranger ici" }))) return null;
      try {
        const { data } = await client.post("/storage/assign", { spool_ids: ids, place_id: placeId, force: true });
        rememberPlace(placeId);
        return _set(data, true);
      } catch (e2) { showAlert(errMsg(e2)); return null; }
    }
    showAlert(errMsg(e));
    return null;
  }
}

const RECENT = "bn_recent_places";
function rememberPlace(id) {
  if (id == null) return;
  try {
    const l = JSON.parse(localStorage.getItem(RECENT) || "[]").filter(x => x !== id);
    localStorage.setItem(RECENT, JSON.stringify([id, ...l].slice(0, 6)));
  } catch { /* indisponible */ }
}
function recentPlaces() { try { return JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch { return []; } }

export const inPrinter = loc => /^(AMS|EXTERNE|HT-)/i.test((loc || "").trim());
export const unitOf = loc => {
  const l = (loc || "").trim();
  if (/^AMS HT-/i.test(l)) return l.slice(4);
  return l.replace(/ slot \d+$/i, "");
};

function index(st) {
  const by = {}, kids = {};
  for (const p of st?.places || []) { by[p.id] = p; (kids[p.parent_id ?? "root"] ||= []).push(p); }
  return { by, kids, roots: kids.root || [] };
}

const agoTxt = iso => {
  if (!iso) return null;
  const m = Math.floor((Date.now() - new Date(String(iso).replace(" ", "T") + (/[Zz+]/.test(String(iso).slice(10)) ? "" : "Z")).getTime()) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m} min`;
  if (m < 1440) return `il y a ${Math.floor(m / 60)} h`;
  return `il y a ${Math.floor(m / 1440)} j`;
};

// une bobine en petit : sa couleur (depuis une fiche bobine du stock, ou le resume de l'arbre)
function Swatch({ s, size = 28, dim = false }) {
  const colors = parseColorsList(s.filament_color ?? s.color, s.filament_colors_array ?? s.colors_array);
  return <span style={{ display: "inline-flex", opacity: dim ? 0.4 : 1, flexShrink: 0 }}>
    <SpoolSVG colors={colors} finish={finishOf(s)} size={size} type={s.filament_multicolor_type ?? s.multicolor_type}/></span>;
}
const spoolName = s => s.filament_translated_name || s.filament_name || s.name || `Bobine #${s.id}`;

const seg = { padding: "7px 12px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)",
  fontSize: 12.5, fontWeight: 800, cursor: "pointer" };
const segOn = { background: "linear-gradient(135deg, #8B5CF6, #6366F1)", color: "#fff", border: "1px solid transparent" };
const inp = { width: "100%", boxSizing: "border-box", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 10,
  padding: "8px 10px", fontSize: 13.5, fontWeight: 700, color: "var(--text)", outline: "none" };
const small = { fontSize: 11.5, fontWeight: 700, color: "var(--muted)" };

// ── Parametres › Filaments : le mode et l'arbre ───────────────────────────────
export function StorageSettingsCard({ card, cardTitle }) {
  const st = useStorage();
  const [name, setName] = useState("");
  const [maker, setMaker] = useState(null);          // { parent } : le generateur ouvert
  const [renaming, setRenaming] = useState(null);    // { id, name }
  useEffect(() => { if (st) setName(st.name); }, [st?.name]);
  if (!st) return null;
  const { by, kids, roots } = index(st);
  const count = p => p.leaf ? p.spools.length : (kids[p.id] || []).reduce((n, c) => n + count(c), 0);
  const leaves = st.places.filter(p => p.leaf).length;

  const setMode = async m => {
    if (m === st.mode) return;
    if (m !== "single" && !leaves && !(await showConfirm("Tu n'as encore créé aucun emplacement : toutes les bobines rangées passeront « À ranger » "
      + "jusqu'à ce que tu leur en donnes un. Changer quand même ?", { confirmLabel: "Changer" }))) return;
    await write("put", "/storage/settings", { mode: m });
  };
  const rename = async (p, v) => { setRenaming(null); if (v.trim() && v.trim() !== p.name) await write("patch", `/storage/places/${p.id}`, { name: v }); };
  const del = async p => {
    const n = count(p), sub = (kids[p.id] || []).length;
    if (!(await showConfirm(`Supprimer « ${p.path} »${sub ? " et tout ce qu'il contient" : ""} ?`
      + (n ? `\n${n} bobine${n > 1 ? "s" : ""} y ${n > 1 ? "perdent" : "perd"} leur place et ${n > 1 ? "passent" : "passe"} « À ranger ».` : ""),
      { danger: true, confirmLabel: "Supprimer" }))) return;
    await write("delete", `/storage/places/${p.id}`);
  };
  const moveTo = async p => {
    const groups = st.places.filter(q => q.id !== p.id && !q.path.startsWith(p.path + " › ") && (!q.leaf || !q.spools.length));
    const items = [{ icon: "⬆", label: "À la racine", onClick: () => write("patch", `/storage/places/${p.id}`, { parent_id: null }) },
      ...groups.map(q => ({ icon: q.leaf ? "▫" : "🗂", label: q.path, onClick: () => write("patch", `/storage/places/${p.id}`, { parent_id: q.id }) }))];
    openMenu(null, { title: `Déplacer « ${p.name} »`, subtitle: "dans…", color: "#8B5CF6", items });
  };
  const menu = (e, p) => openMenu(e, {
    title: p.name, subtitle: p.path, color: "#8B5CF6",
    items: [
      { icon: "✏️", label: "Renommer", onClick: () => setRenaming({ id: p.id, name: p.name }) },
      { icon: "＋", label: p.leaf ? "Créer des emplacements dedans" : "Ajouter dedans", hint: p.leaf && p.spools.length ? "Range d'abord ses bobines ailleurs" : undefined,
        disabled: p.leaf && p.spools.length > 0, onClick: () => setMaker({ parent: p }) },
      p.leaf && { icon: p.single ? "📚" : "🔲", label: p.single ? "En faire un rangement commun" : "En faire une case (une seule bobine)",
        hint: p.single ? "Autant de bobines qu'on veut" : "Réservée à une bobine tant qu'elle ne va pas ailleurs",
        onClick: () => write("patch", `/storage/places/${p.id}`, { single: !p.single }) },
      !p.leaf && { icon: "▦", label: "Colonnes de la grille", hint: p.cols ? `${p.cols} colonnes` : "automatique", onClick: () => openMenu(null, {
        title: `Colonnes de « ${p.name} »`, subtitle: "pour afficher son contenu en grille", color: "#8B5CF6",
        items: [null, 1, 2, 3, 4, 5, 6, 8, 10, 12].map(n => ({ icon: n === (p.cols || null) ? "✓" : "▦", label: n ? `${n} colonne${n > 1 ? "s" : ""}` : "Automatique",
          onClick: () => write("patch", `/storage/places/${p.id}`, { cols: n }) })),
      }) },
      { icon: "↕", label: "Déplacer dans…", onClick: () => moveTo(p) },
      "-",
      { icon: "🗑", label: "Supprimer…", danger: true, onClick: () => del(p) },
    ],
  });

  const Row = ({ p }) => {
    const n = count(p);
    return <>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 6px", paddingLeft: 6 + p.depth * 18, borderRadius: 10,
        background: p.depth ? "transparent" : "color-mix(in srgb, #8B5CF6 6%, transparent)" }}>
        <span style={{ fontSize: 14, width: 18, textAlign: "center" }}>{p.icon || (p.leaf ? (p.single ? "🔲" : "📚") : "🗂")}</span>
        {renaming?.id === p.id
          ? <input autoFocus defaultValue={p.name} onBlur={e => rename(p, e.target.value)} onKeyDown={e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setRenaming(null); }}
            style={{ ...inp, padding: "4px 8px", flex: 1 }}/>
          : <button type="button" onClick={() => setRenaming({ id: p.id, name: p.name })} data-tip="Renommer"
            style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "text", color: "var(--text)",
              fontSize: 13.5, fontWeight: p.leaf ? 700 : 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</button>}
        <span style={{ ...small, flexShrink: 0 }}>{p.leaf ? (p.single ? (n ? "case prise" : "case libre") : `${n} bobine${n > 1 ? "s" : ""}`)
          : `${(kids[p.id] || []).length} dedans${n ? ` · ${n} bob.` : ""}`}</span>
        <button type="button" onClick={() => write("post", `/storage/places/${p.id}/move`, { d: -1 })} aria-label="Monter" style={{ ...seg, padding: "2px 7px" }}>↑</button>
        <button type="button" onClick={() => write("post", `/storage/places/${p.id}/move`, { d: 1 })} aria-label="Descendre" style={{ ...seg, padding: "2px 7px" }}>↓</button>
        <button type="button" onClick={e => menu(e, p)} aria-label="Actions" style={{ ...seg, padding: "2px 9px" }}>⋯</button>
      </div>
      {(kids[p.id] || []).map(c => <Row key={c.id} p={c}/>)}
    </>;
  };

  return (
    <div className="card" style={card}>
      <div style={cardTitle}>🗄 Rangements</div>
      <CardHelp title="Rangements">
        Où vont les bobines qui ne sont pas dans l'imprimante. Trois façons de faire : un seul rangement (le mode d'origine),
        une place pour chaque bobine, ou un rangement libre où l'appli te demande où tu as mis la bobine. Les emplacements
        se créent ici, en arbre : un groupe (Tiroir 1, Rack 1) contient des emplacements (Colonne 1 › Ligne 3, A2…). Un emplacement
        est commun (un placard : autant de bobines qu'on veut) ou une case (une seule bobine, gardée pendant qu'elle est dans l'AMS).
      </CardHelp>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8, marginBottom: 12 }}>
        {STORAGE_MODES.map(([k, ic, l, d]) => {
          const on = st.mode === k;
          return <button key={k} type="button" onClick={() => setMode(k)} style={{ textAlign: "left", padding: "10px 12px", borderRadius: 14, cursor: "pointer",
            border: on ? "2px solid #8B5CF6" : "1px solid var(--border)", background: on ? "color-mix(in srgb, #8B5CF6 10%, var(--surface))" : "var(--surface)",
            color: "var(--text)", display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 14, fontWeight: 900 }}>{ic} {l} {on && <span style={{ fontSize: 11, color: "#8B5CF6" }}>· actif</span>}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>{d}</span>
          </button>;
        })}
      </div>

      {st.mode === "single" && <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
        <label style={{ flex: 1 }}><span style={{ ...small, display: "block", marginBottom: 4 }}>Nom du rangement</span>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Tiroir" maxLength={40} style={inp}/></label>
        <button type="button" disabled={!name.trim() || name.trim() === st.name} onClick={() => write("put", "/storage/settings", { name })}
          style={{ ...seg, ...(name.trim() && name.trim() !== st.name ? segOn : {}), padding: "9px 14px" }}>Renommer</button>
      </div>}

      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 6px" }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", flex: 1 }}>Emplacements
          <span style={{ ...small, marginLeft: 6 }}>{leaves ? `${leaves} où ranger` : "aucun"}</span></span>
        <button type="button" onClick={() => setMaker({ parent: null })} style={{ ...seg, ...segOn }}>＋ Ajouter</button>
      </div>
      {st.mode === "single" && <p style={{ ...small, margin: "0 0 6px" }}>
        Inutilisés dans ce mode : prépare-les avant de passer à « Chaque bobine a sa place » ou « Je range où je veux ».</p>}
      {!roots.length && <div style={{ padding: 14, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 12, ...small }}>
        Aucun emplacement. « ＋ Ajouter » crée un placard, un tiroir à colonnes et lignes, un rack en grille (A1, A2…)…</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{roots.map(p => <Row key={p.id} p={p}/>)}</div>
      {maker && <PlaceMaker parent={maker.parent} onClose={() => setMaker(null)}/>}
    </div>
  );
}

// ── Le generateur d'emplacements ──────────────────────────────────────────────
const PRESETS = [
  { k: "one", ic: "📦", l: "Un emplacement", d: "Un placard, un bac, une étagère", levels: [] },
  { k: "drawer", ic: "🗄", l: "Tiroir › colonnes › lignes", d: "Tiroir 1 › Colonne 1 › Ligne 3", name: "Tiroir 1",
    levels: [{ label: "Colonne", count: 3, style: "num" }, { label: "Ligne", count: 4, style: "num" }] },
  { k: "rack", ic: "🔢", l: "Rack en grille", d: "A1, A2 … D6", name: "Rack 1", combine: true,
    levels: [{ label: "", count: 4, style: "alpha" }, { label: "", count: 6, style: "num" }] },
  { k: "shelf", ic: "📚", l: "Étagère à niveaux", d: "Étagère › Niveau 1, 2, 3", name: "Étagère", single: false,
    levels: [{ label: "Niveau", count: 3, style: "num" }] },
];
const tag = (style, i) => style === "alpha" ? (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(64 + Math.floor(i / 26))}${String.fromCharCode(65 + i % 26)}`) : String(i + 1);

function build(levels, combine, single) {
  if (!levels.length) return [];
  if (combine && levels.length === 2) {
    const [a, b] = levels, out = [];
    for (let i = 0; i < a.count; i++) for (let j = 0; j < b.count; j++)
      out.push({ name: `${a.label}${tag(a.style, i)}${b.label}${tag(b.style, j)}`.trim(), single });
    return out;
  }
  const [l, ...rest] = levels;
  return Array.from({ length: l.count }, (_, i) => {
    const kids = build(rest, false, single);
    const n = { name: `${l.label}${l.label ? " " : ""}${tag(l.style, i)}`, single };
    if (kids.length) { n.children = kids; n.single = false; if (rest.length === 1) n.cols = 1; }
    return n;
  });
}

function PlaceMaker({ parent, onClose }) {
  const [preset, setPreset] = useState(PRESETS[0]);
  const [name, setName] = useState("");
  const [levels, setLevels] = useState([]);
  const [combine, setCombine] = useState(false);
  const [single, setSingle] = useState(false);
  const [inside, setInside] = useState(!!parent);    // creer directement dans le parent, sans groupe
  const [busy, setBusy] = useState(false);
  const pick = p => { setPreset(p); setName(p.name || ""); setLevels(p.levels.map(x => ({ ...x }))); setCombine(!!p.combine); setSingle(p.k === "one" ? false : p.single !== false); };
  useEffect(() => { pick(PRESETS[0]); }, []);
  const kids = build(levels, combine, single);
  const flat = n => n.reduce((s, x) => s + 1 + flat(x.children || []), 0);
  const leafCount = n => n.reduce((s, x) => s + (x.children ? leafCount(x.children) : 1), 0);
  const total = (inside && parent && levels.length ? 0 : 1) + flat(kids);
  const cols = combine && levels.length === 2 ? levels[1].count : levels.length >= 2 ? levels[0].count : null;
  const ok = (inside && parent && levels.length) || name.trim();
  const create = async () => {
    setBusy(true);
    try {
      if (inside && parent && levels.length) {
        for (const c of kids) { const r = await write("post", "/storage/places", { ...c, parent_id: parent.id }); if (!r) return; }
        if (cols && cols !== parent.cols) await write("patch", `/storage/places/${parent.id}`, { cols });
      } else {
        const body = { name: name.trim(), single: levels.length ? false : single, parent_id: parent?.id ?? null, cols: kids.length ? cols : null, children: kids };
        if (!(await write("post", "/storage/places", body))) return;
      }
      onClose();
    } finally { setBusy(false); }
  };
  const setL = (i, k, v) => setLevels(ls => ls.map((l, j) => j === i ? { ...l, [k]: v } : l));
  // l'apercu : la grille des feuilles du premier groupe (ou de la liste)
  // l'apercu : des colonnes (un groupe et ses emplacements empiles), ou une grille de feuilles ; a trois niveaux, le premier groupe
  const sample = kids[0]?.children?.[0]?.children ? kids[0].children : kids;

  return createPortal(<FSheet onClose={onClose} z={1200} bottom={<>
    <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button>
    <button onClick={create} disabled={busy || !ok} style={{ ...fBtn, flex: 2, border: "none", color: "#fff", opacity: busy || !ok ? 0.5 : 1,
      background: "linear-gradient(135deg, #8B5CF6, #6366F1)" }}>{busy ? "…" : `Créer ${total} emplacement${total > 1 ? "s" : ""}`}</button></>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>＋ Emplacements{parent ? <span style={{ ...small, fontSize: 13 }}> dans « {parent.path} »</span> : null}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6 }}>
        {PRESETS.map(p => <button key={p.k} type="button" onClick={() => pick(p)} style={{ textAlign: "left", padding: "8px 10px", borderRadius: 12, cursor: "pointer",
          border: preset.k === p.k ? "2px solid #8B5CF6" : "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }}>
          <div style={{ fontSize: 13, fontWeight: 900 }}>{p.ic} {p.l}</div><div style={small}>{p.d}</div></button>)}
      </div>
      {parent && levels.length > 0 && <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 700, color: "var(--text2)" }}>
        <input type="checkbox" checked={inside} onChange={e => setInside(e.target.checked)}/>Directement dans « {parent.name} » (sans groupe intermédiaire)</label>}
      {!(inside && parent && levels.length) && <label><span style={{ ...small, display: "block", marginBottom: 4 }}>Nom</span>
        <input value={name} onChange={e => setName(e.target.value)} placeholder={preset.k === "one" ? "Placard, Bac du bas…" : preset.name} maxLength={60} style={inp}/></label>}
      {levels.map((l, i) => <div key={i} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ ...small, width: 56 }}>Niveau {i + 1}</span>
        <input value={l.label} onChange={e => setL(i, "label", e.target.value)} placeholder={combine ? "(rien)" : "Ligne"} style={{ ...inp, width: 110, flex: "1 1 90px" }}/>
        <input type="number" min={1} max={50} value={l.count} onChange={e => setL(i, "count", Math.max(1, Math.min(50, parseInt(e.target.value) || 1)))} style={{ ...inp, width: 64 }}/>
        <button type="button" onClick={() => setL(i, "style", l.style === "num" ? "alpha" : "num")} style={seg}>{l.style === "num" ? "1, 2, 3" : "A, B, C"}</button>
        <button type="button" onClick={() => setLevels(ls => ls.filter((_, j) => j !== i))} aria-label="Retirer ce niveau" style={seg}>✕</button>
      </div>)}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {levels.length < 3 && <button type="button" onClick={() => setLevels(ls => [...ls, { label: "", count: 4, style: ls.length ? "num" : "alpha" }])} style={seg}>＋ Un niveau</button>}
        {levels.length === 2 && <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>
          <input type="checkbox" checked={combine} onChange={e => setCombine(e.target.checked)}/>Codes combinés (A1, A2…)</label>}
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>
          <input type="checkbox" checked={single} onChange={e => setSingle(e.target.checked)}/>
          {levels.length ? "Chaque emplacement est une case (une seule bobine)" : "Une case (une seule bobine)"}</label>
      </div>
      {kids.length > 0 && <div style={{ padding: 10, borderRadius: 12, border: "1px dashed var(--border)", background: "var(--surface)" }}>
        <div style={{ ...small, marginBottom: 6 }}>Aperçu · {leafCount(kids)} {single ? "cases" : "emplacements où ranger"}
          {sample !== kids ? ` (dans ${kids[0].name}, ${kids.length > 1 ? `et pareil dans les ${kids.length - 1} autres` : ""})` : ""}</div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(sample[0]?.children ? sample.length : (combine ? levels[1].count : Math.min(sample.length, 8)), 10)}, minmax(0, 1fr))`, gap: 4 }}>
          {sample.slice(0, 60).map((c, i) => <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {c.children ? <><div style={{ ...small, textAlign: "center", fontSize: 10 }}>{c.name}</div>
              {c.children.slice(0, 8).map((x, j) => <div key={j} style={cellPrev(single)}>{x.name}</div>)}</>
              : <div style={cellPrev(single)}>{c.name}</div>}
          </div>)}
        </div>
      </div>}
    </div>
  </FSheet>, document.body);
}
const cellPrev = single => ({ padding: "4px 2px", borderRadius: 6, fontSize: 10, fontWeight: 800, textAlign: "center", color: "var(--text2)",
  border: `1px ${single ? "solid" : "dashed"} color-mix(in srgb, #8B5CF6 35%, var(--border))`, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });

// ── Ranger : choisir la place d'une ou plusieurs bobines ─────────────────────
export function PlacePicker({ spools, onClose, onDone, pickOnly = false, onPicked = null, title = null }) {
  const st = useStorage();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  if (!st) return null;
  const { kids, roots, by } = index(st);
  const ids = (spools || []).map(s => s.id);
  const one = ids.length === 1 ? spools[0] : null;
  const last = one && (one.place_id ?? one.last_place);
  const ql = q.trim().toLowerCase();
  const go = async pid => {
    if (pickOnly) { onPicked?.(pid); onClose(); return; }
    setBusy(true);
    const r = await assignSpools(ids, pid);
    setBusy(false);
    if (r) { onDone?.(r); onClose(); }
  };
  const unassign = async () => { setBusy(true); const r = await write("post", "/storage/assign", { spool_ids: ids, place_id: null }); setBusy(false); if (r) { onDone?.(r); onClose(); } };
  const occOf = p => p.spools.filter(x => !ids.includes(x.id));
  const Leaf = ({ p, compact }) => {
    const occ = occOf(p), taken = p.single && occ.length > 0, mine = p.spools.some(x => ids.includes(x.id));
    const off = p.single && (ids.length > 1 || (pickOnly && taken));
    return <button type="button" disabled={busy || off} onClick={() => go(p.id)} data-tip={off ? (taken ? `Prise par la bobine #${occ[0].id}` : "Une case ne prend qu'une bobine") : taken ? `Prise par la bobine #${occ[0].id} : la toucher propose de la déloger` : undefined}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: compact ? "6px 6px" : "8px 10px", borderRadius: 12, cursor: off ? "not-allowed" : "pointer",
        minWidth: 0, opacity: off ? 0.4 : 1, textAlign: "left", color: "var(--text)",
        border: mine ? "2px solid #8B5CF6" : `1px ${p.single ? "solid" : "dashed"} ${taken ? "color-mix(in srgb, #F59E0B 50%, var(--border))" : "var(--border)"}`,
        background: taken ? "color-mix(in srgb, #F59E0B 7%, var(--surface))" : "var(--surface)", flexDirection: compact ? "column" : "row", justifyContent: "center" }}>
      {taken ? <Swatch s={occ[0]} size={compact ? 22 : 26}/> : <span style={{ fontSize: compact ? 13 : 15 }}>{p.single ? "🔲" : "📚"}</span>}
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: compact ? "center" : "flex-start" }}>
        <span style={{ fontSize: compact ? 11.5 : 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{p.name}</span>
        {!compact && <span style={small}>{mine ? "ici en ce moment" : p.single ? (taken ? `prise · #${occ[0].id}` : "libre") : `${occ.length} bobine${occ.length > 1 ? "s" : ""}`}</span>}
      </span>
    </button>;
  };
  const Group = ({ p }) => {
    const ch = kids[p.id] || [];
    const allLeaves = ch.every(c => c.leaf);
    return <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: p.depth ? "6px 0 0" : 10, borderRadius: 14,
      border: p.depth ? "none" : "1px solid var(--border)", background: p.depth ? "transparent" : "color-mix(in srgb, #8B5CF6 4%, var(--surface2))" }}>
      <div style={{ fontSize: p.depth ? 12 : 13.5, fontWeight: 900, color: p.depth ? "var(--text2)" : "var(--text)" }}>{p.icon || "🗂"} {p.name}</div>
      {allLeaves
        ? <div style={{ display: "grid", gap: 5, gridTemplateColumns: p.cols ? `repeat(${p.cols}, minmax(0, 1fr))` : "repeat(auto-fill, minmax(92px, 1fr))" }}>
          {ch.map(c => <Leaf key={c.id} p={c} compact={!!p.cols && p.cols > 3}/>)}</div>
        : <div style={{ display: "grid", gap: 8, gridTemplateColumns: p.cols ? `repeat(${p.cols}, minmax(0, 1fr))` : "1fr" }}>
          {ch.map(c => c.leaf ? <Leaf key={c.id} p={c}/> : <Group key={c.id} p={c}/>)}</div>}
    </div>;
  };
  const found = ql ? st.places.filter(p => p.leaf && p.path.toLowerCase().includes(ql)) : null;
  const recents = recentPlaces().map(i => by[i]).filter(p => p && p.leaf && p.id !== last).slice(0, 4);
  const lastP = last != null ? by[last] : null;

  return createPortal(<FSheet onClose={onClose} z={1300} bottom={<>
    {!pickOnly && st.mode !== "single" && ids.length > 0 && (spools || []).some(s => s.place_id) &&
      <button onClick={unassign} disabled={busy} style={{ ...fBtn, flex: 1, color: "var(--muted)" }} data-tip="Elle n'aura plus de place : « À ranger » si elle n'est pas dans l'imprimante">Retirer sa place</button>}
    <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button></>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {one && <Swatch s={one} size={40}/>}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{title || (one ? "Où est-elle rangée ?" : `Ranger ${ids.length} bobines`)}</div>
          {one && <div style={small}>{spoolName(one)} · #{one.id}{one.location ? ` · ${one.location}` : ""}</div>}
        </div>
      </div>
      {!st.places.some(p => p.leaf)
        ? <div style={{ padding: 16, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 14, ...small }}>
          Aucun emplacement pour l'instant : crée-les dans Paramètres › Filaments › Rangements.
          <div><a href="/settings?tab=filament" style={{ color: "#8B5CF6", fontWeight: 900 }}>Créer mes emplacements</a></div></div>
        : <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un emplacement (A2, tiroir…)" style={inp}/>
          {!ql && (lastP || recents.length > 0) && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {lastP?.leaf && <button type="button" disabled={busy} onClick={() => go(lastP.id)} style={{ ...seg, ...segOn }}>↩ {one?.place_id ? "Sa place" : "Sa dernière place"} : {lastP.path}</button>}
            {recents.map(p => <button key={p.id} type="button" disabled={busy} onClick={() => go(p.id)} style={seg}>🕘 {p.path}</button>)}
          </div>}
          {found
            ? <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}>
              {found.map(p => <Leaf key={p.id} p={{ ...p, name: p.path }}/>)}
              {!found.length && <div style={small}>Aucun emplacement ne correspond.</div>}</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {roots.map(p => p.leaf ? <Leaf key={p.id} p={p}/> : <Group key={p.id} p={p}/>)}</div>}
        </>}
    </div>
  </FSheet>, document.body);
}

// ── Les bobines a ranger ─────────────────────────────────────────────────────
export function ToStoreSheet({ onClose, onDone }) {
  const st = useStorage();
  const [pick, setPick] = useState(null);
  if (!st) return null;
  const { by } = index(st);
  const list = st.to_store || [];
  return createPortal(<>
    <FSheet onClose={onClose} z={1250} bottom={<button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button>}>
      <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>📥 À ranger <span style={{ ...small, fontSize: 13 }}>{list.length} bobine{list.length > 1 ? "s" : ""}</span></div>
        <div style={small}>{st.mode === "manual" ? "Sorties de l'AMS, reçues ou ajoutées : dis où tu les as mises." : "Ces bobines n'ont pas encore de place : donne-leur la leur."}</div>
        {!list.length && <div style={{ padding: 20, textAlign: "center", ...small }}>Tout est rangé 🎉</div>}
        {list.map(s => {
          const lp = s.last_place != null ? by[s.last_place] : null;
          return <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", flexWrap: "wrap" }}>
            <Swatch s={s} size={34}/>
            <div style={{ flex: "1 1 140px", minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
              <div style={small}>#{s.id}{s.material ? ` · ${s.material}` : ""}{s.remaining_weight_g != null ? ` · ${Math.round(s.remaining_weight_g)} g` : ""}{s.unstored_at ? ` · sortie ${agoTxt(s.unstored_at)}` : ""}</div>
            </div>
            {lp?.leaf && <button type="button" onClick={async () => { if (await assignSpools([s.id], lp.id)) onDone?.(); }} style={{ ...seg, ...segOn }} data-tip="La remettre où elle était">↩ {lp.path}</button>}
            <button type="button" onClick={() => setPick(s)} style={seg}>Ranger…</button>
          </div>;
        })}
      </div>
    </FSheet>
    {pick && <PlacePicker spools={[pick]} onClose={() => setPick(null)} onDone={() => onDone?.()}/>}
  </>, document.body);
}

// le bandeau du stock : des bobines attendent
export function ToStoreBanner({ onOpen }) {
  const st = useStorage();
  const n = st?.to_store?.length || 0;
  if (!st || st.mode === "single" || !n) return null;
  const waiting = st.to_store.filter(s => s.unstored_at).length;
  return <button type="button" onClick={onOpen} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 16, cursor: "pointer",
    border: "1px solid color-mix(in srgb, #F59E0B 45%, var(--border))", background: "linear-gradient(135deg, color-mix(in srgb, #F59E0B 14%, var(--surface)), var(--surface))",
    color: "var(--text)", textAlign: "left" }}>
    <span style={{ fontSize: 22 }}>📥</span>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 14, fontWeight: 900 }}>{n} bobine{n > 1 ? "s" : ""} à ranger</span>
      <span style={small}>{waiting ? `${waiting} sortie${waiting > 1 ? "s" : ""} de l'AMS ou arrivée${waiting > 1 ? "s" : ""} : où ${waiting > 1 ? "sont-elles" : "est-elle"} ?` : "sans place pour l'instant"}</span>
    </span>
    <span style={{ ...seg, ...segOn }}>Ranger</span>
  </button>;
}

// ── Le stock par rangement ───────────────────────────────────────────────────
// spools : la liste filtree de l'onglet Stock ; renderSpool(s) : la carte de bobine de la page.
export function StorageMap({ spools, onOpen, renderSpool, admin }) {
  const st = useStorage();
  const [fold, setFold] = useState(() => { try { return JSON.parse(localStorage.getItem("bn_storage_fold") || "{}"); } catch { return {}; } });
  const [fill, setFill] = useState(null);            // une case libre a remplir
  const [toStore, setToStore] = useState(false);
  const toggle = k => setFold(f => { const n = { ...f, [k]: !f[k] }; try { localStorage.setItem("bn_storage_fold", JSON.stringify(n)); } catch { /* indisponible */ } return n; });
  const byId = useMemo(() => Object.fromEntries((spools || []).map(s => [s.id, s])), [spools]);
  if (!st) return null;
  const { kids, roots } = index(st);
  const TO = st.to_store_label || "À ranger";
  const printer = spools.filter(s => !s.ordered && inPrinter(s.location));
  const units = [...new Set(printer.map(s => unitOf(s.location)))].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
  const waiting = spools.filter(s => !s.ordered && s.location === TO);
  const ordered = spools.filter(s => s.ordered);
  const storedHere = p => spools.filter(s => s.place_id === p.id && !s.ordered && !inPrinter(s.location) && s.location !== TO);
  const placed = new Set(st.mode === "single" ? [] : st.places.flatMap(p => storedHere(p).map(s => s.id)));
  const elsewhere = spools.filter(s => !s.ordered && !inPrinter(s.location) && s.location !== TO && !placed.has(s.id));
  const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(clamp(108px, 28vw, 136px),1fr))", gap: 8 };
  const countIn = p => p.leaf ? storedHere(p).length : (kids[p.id] || []).reduce((n, c) => n + countIn(c), 0);

  const Section = ({ k, icon, title, n, tone = "#8B5CF6", aside = null, children }) => <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button type="button" onClick={() => toggle(k)} style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, background: "none", border: "none",
        padding: 0, cursor: "pointer", color: "var(--text)", textAlign: "left" }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, display: "grid", placeItems: "center", fontSize: 15, flexShrink: 0,
          background: `color-mix(in srgb, ${tone} 16%, var(--surface))`, border: `1px solid color-mix(in srgb, ${tone} 35%, var(--border))` }}>{icon}</span>
        <span style={{ fontSize: 15, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
        <span style={{ ...small, flexShrink: 0 }}>{n}</span>
        <span style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12 }}>{fold[k] ? "▸" : "▾"}</span>
      </button>
      {aside}
    </div>
    {!fold[k] && children}
  </div>;

  // une case : sa bobine (ou son fantome si elle est dans l'imprimante / hors du filtre), sinon « libre »
  const Cell = ({ p }) => {
    const occ = p.spools[0], full = occ ? byId[occ.id] : null, out = occ && occ.in_printer;
    const free = !occ;
    return <button type="button" onClick={() => full ? onOpen(full) : free && admin ? setFill(p) : null}
      data-tip={occ ? `${occ.name} · #${occ.id}${out ? ` · dans l'imprimante (${occ.location}), sa case l'attend` : ""}` : admin ? "Libre : toucher pour y ranger une bobine" : "Libre"}
      style={{ position: "relative", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, minWidth: 0, minHeight: 74,
        padding: "6px 4px", borderRadius: 14, cursor: full || (free && admin) ? "pointer" : "default", color: "var(--text)",
        border: free ? "1.5px dashed var(--border)" : `1px solid color-mix(in srgb, ${out ? "#0EA5E9" : "#8B5CF6"} 35%, var(--border))`,
        background: free ? "transparent" : "var(--surface)", opacity: occ && !full && !out ? 0.55 : 1 }}>
      <span style={{ position: "absolute", top: 3, left: 6, fontSize: 9.5, fontWeight: 900, color: "var(--muted)" }}>{p.name}</span>
      {occ ? <>
        <Swatch s={full || occ} size={34} dim={out}/>
        <span style={{ fontSize: 10, fontWeight: 800, maxWidth: "100%", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--text2)" }}>
          {out ? `🖨 ${unitOf(occ.location)}` : (full ? (full.filament_translated_name || full.filament_name) : occ.name)}</span>
      </> : <span style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)", marginTop: 8 }}>libre</span>}
    </button>;
  };
  const Common = ({ p, nested }) => {
    const here = storedHere(p);
    const away = p.spools.filter(x => x.in_printer);
    return <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: nested ? 0 : 0 }}>
      {nested && <div style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text2)" }}>{p.icon || "📚"} {p.name} <span style={small}>{here.length}</span></div>}
      {here.length ? <div style={grid}>{here.map(s => renderSpool(s))}</div>
        : <div style={{ padding: 10, borderRadius: 12, border: "1.5px dashed var(--border)", textAlign: "center", ...small }}>vide</div>}
      {away.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", ...small }}>🖨 dans l'imprimante :
        {away.map(x => <span key={x.id} data-tip={`${x.name} · ${x.location}`} style={{ display: "inline-flex" }}><Swatch s={x} size={20} dim/></span>)}</div>}
    </div>;
  };
  const Group = ({ p }) => {
    const ch = kids[p.id] || [];
    const cellsOnly = ch.length && ch.every(c => c.leaf && c.single);
    return <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: p.depth ? 6 : 0, borderRadius: 14,
      border: p.depth ? "1px solid var(--border)" : "none", background: p.depth ? "color-mix(in srgb, #8B5CF6 3%, var(--surface2))" : "transparent", minWidth: 0 }}>
      {p.depth > 0 && <div style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text2)" }}>{p.icon || "🗂"} {p.name} <span style={small}>{countIn(p)}</span></div>}
      {cellsOnly
        ? <div style={{ display: "grid", gap: 6, gridTemplateColumns: p.cols ? `repeat(${p.cols}, minmax(0, 1fr))` : "repeat(auto-fill, minmax(76px, 1fr))" }}>
          {ch.map(c => <Cell key={c.id} p={c}/>)}</div>
        // des colonnes de cases (Tiroir › Colonne › Ligne) restent cote a cote jusqu'a 4, meme sur telephone
        : <div style={{ display: "grid", gap: 6, gridTemplateColumns: !p.cols ? "1fr" : p.cols <= 4 && ch.every(c => !c.leaf && (kids[c.id] || []).every(x => x.leaf && x.single))
            ? `repeat(${p.cols}, minmax(0, 1fr))` : `repeat(auto-fit, minmax(max(150px, calc(100% / ${p.cols} - 8px)), 1fr))` }}>
          {ch.map(c => c.leaf ? (c.single ? <Cell key={c.id} p={c}/> : <Common key={c.id} p={c} nested/>) : <Group key={c.id} p={c}/>)}</div>}
    </div>;
  };
  // les bobines qu'on peut mettre dans une case libre : a ranger d'abord, puis rangees sans place, puis les autres
  const candidates = () => {
    const pri = s => s.location === TO ? 0 : !s.place_id ? 1 : 2;
    return spools.filter(s => !s.ordered && !s.archived && s.place_id !== fill?.id).sort((a, b) => pri(a) - pri(b));
  };

  return <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
    {printer.length > 0 && <Section k="printer" icon="🖨" title="Dans l'imprimante" n={printer.length} tone="#0EA5E9">
      {units.map(u => <div key={u} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text2)" }}>{u}</div>
        <div style={grid}>{printer.filter(s => unitOf(s.location) === u).sort((a, b) => (a.location || "").localeCompare(b.location || "", "fr", { numeric: true })).map(s => renderSpool(s))}</div>
      </div>)}
    </Section>}
    {waiting.length > 0 && <Section k="tostore" icon="📥" title="À ranger" n={waiting.length} tone="#F59E0B"
      aside={admin && <button type="button" onClick={() => setToStore(true)} style={{ ...seg, ...segOn }}>Ranger</button>}>
      <div style={grid}>{waiting.map(s => renderSpool(s))}</div>
    </Section>}
    {st.mode === "single"
      ? (elsewhere.length > 0 && <Section k="single" icon="🗄" title={st.name} n={elsewhere.length}><div style={grid}>{elsewhere.map(s => renderSpool(s))}</div></Section>)
      : <>
        {roots.map(p => <Section key={p.id} k={`p${p.id}`} icon={p.icon || (p.leaf ? (p.single ? "🔲" : "📚") : "🗂")} title={p.name} n={countIn(p)}>
          {p.leaf ? (p.single ? <div style={{ maxWidth: 120 }}><Cell p={p}/></div> : <Common p={p}/>) : <Group p={p}/>}
        </Section>)}
        {elsewhere.length > 0 && <Section k="else" icon="❔" title="Ailleurs" n={elsewhere.length} tone="#64748B"><div style={grid}>{elsewhere.map(s => renderSpool(s))}</div></Section>}
      </>}
    {ordered.length > 0 && <Section k="ordered" icon="📬" title="En commande" n={ordered.length} tone="#0EA5E9"><div style={grid}>{ordered.map(s => renderSpool(s))}</div></Section>}
    {!spools.length && <div style={{ padding: 20, textAlign: "center", ...small }}>Aucune bobine ne correspond.</div>}
    {fill && <SpoolChooser title={`Ranger dans « ${fill.path} »`} spools={candidates()} TO={TO} onClose={() => setFill(null)}
      onPick={async s => { if (await assignSpools([s.id], fill.id)) setFill(null); }}/>}
    {toStore && <ToStoreSheet onClose={() => setToStore(false)}/>}
  </div>;
}

function SpoolChooser({ title, spools, TO, onClose, onPick }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const list = spools.filter(s => !ql || [spoolName(s), s.filament_manufacturer, s.filament_fila_type, s.filament_material, String(s.id), s.location]
    .filter(Boolean).join(" ").toLowerCase().includes(ql)).slice(0, 80);
  return createPortal(<FSheet onClose={onClose} z={1300} bottom={<button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>{title}</div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher une bobine" style={inp}/>
      {list.map(s => <button key={s.id} type="button" onClick={() => onPick(s)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
        borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", textAlign: "left", color: "var(--text)" }}>
        <Swatch s={s} size={32}/>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{spoolName(s)}</span>
          <span style={small}>#{s.id} · {s.location === TO ? "📥 à ranger" : s.location}</span>
        </span>
      </button>)}
      {!list.length && <div style={small}>Aucune bobine.</div>}
    </div>
  </FSheet>, document.body);
}
