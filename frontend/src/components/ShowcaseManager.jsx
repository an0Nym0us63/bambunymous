import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import client, { apiThumb } from "../api/client";
import { FSheet, FCard, fBtn } from "./FicheKit";
import { toast } from "../store/toast";
import { showConfirm } from "../utils/dialog";
import { egg } from "../eggs";
import { AccessLog } from "./PublicLinksCard";

// « Mes vitrines » (04/11/2026) : des portfolios publics, chacun nomme et avec son lien. Les pieces viennent de deux
// sources : celles choisies a la main (ordre, ★ du grand carrousel, un mot), et des regles (toutes mes pieces, tout
// d'un createur, d'un modele, d'une categorie, d'une annee, les groupes ou les impressions seules) qui suivent la
// galerie ; une piece amenee par une regle s'exclut ou s'epingle. L'ajout se fait en masse (selection, tout
// selectionner, filtre par createur). Le meme calcul que le serveur (routes/showcase.py, _resolve) donne l'apercu.
const DUR = [[0, "sans fin"], [7, "7 jours"], [30, "30 jours"], [365, "1 an"]];
const RULE_T = [["all", "Toutes mes pièces"], ["creator", "Un créateur"], ["model", "Un modèle"], ["category", "Une catégorie"], ["year", "Une année"], ["kind", "Un type"]];
const SOURCES = [["photos", "📷", "Avec photos", "Seulement les vraies photos"], ["photos_3d", "🧊", "Photos ou vues 3D", "Une vue 3D faute de photo"],
  ["all", "🗂️", "Toutes", "Toutes les impressions réussies ; sans photo, l'image du plateau"]];
const RULE_ICON = { all: "🌐", creator: "👤", model: "🧩", category: "🏷️", year: "📆", kind: "🗂️" };
const GOLD = "#A1803F";

function match(r, c) {
  const v = r.v || "";
  switch (r.t) {
    case "all": return true;
    case "creator": return (c.creator || "").toLowerCase() === v.toLowerCase();
    case "model": return c.design === v;
    case "category": return (c.categories || []).includes(v);
    case "year": return (c.date || "").slice(0, 4) === v;
    case "kind": return c.group === (v === "group");
    default: return false;
  }
}

function resolve(cfg, cands, byK) {
  const out = (cfg.items || []).filter(it => byK[it.k]).map(it => ({ ...it, auto: false }));
  const taken = new Set([...out.map(it => it.k), ...(cfg.exclude || [])]);
  const rules = cfg.rules || [];
  if (rules.length) for (const c of cands) if (!taken.has(c.k) && rules.some(r => match(r, c))) out.push({ k: c.k, featured: false, note: "", auto: true });
  return out;
}

const input = { width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
  fontSize: 14, fontFamily: "inherit" };
const chip = on => ({ padding: "5px 11px", borderRadius: 16, cursor: "pointer", fontSize: 12, fontWeight: 800, border: `1px solid ${on ? "#C9A96E" : "var(--border)"}`,
  background: on ? "color-mix(in srgb, #C9A96E 18%, transparent)" : "var(--surface2)", color: on ? GOLD : "var(--muted)", textDecoration: "none" });
const iconBtn = { border: "none", background: "none", cursor: "pointer", color: "var(--muted)", padding: "2px 4px", fontSize: 14 };

export default function ShowcaseManager({ sid, onClose, onChanged }) {
  const [cfg, setCfg] = useState(null);
  const [cd, setCd] = useState(null);                 // {items, options} : les pieces possibles et les choix des regles
  const [q, setQ] = useState("");
  const [who, setWho] = useState("");                 // filtre par createur dans l'ajout
  const [pick, setPick] = useState(() => new Set());  // la selection dans l'ajout
  const [sel, setSel] = useState(null);               // la selection dans les pieces (null : mode normal)
  const [rt, setRt] = useState("");                   // la regle en cours d'ajout
  const [allAuto, setAllAuto] = useState(false);
  const [days, setDays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [log, setLog] = useState(false);              // le journal des acces du lien
  useEffect(() => {
    client.get(`/showcase/${sid}`).then(r => setCfg(r.data)).catch(() => setCfg({ error: true }));
    egg("vitrine");
  }, [sid]);
  // les pieces possibles suivent la source choisie (photos ; photos ou vues 3D ; toutes)
  const source = cfg?.source || "photos_3d";
  useEffect(() => {
    if (!cfg || cfg.error) return;
    setCd(null);
    client.get("/showcase/candidates", { params: { source } }).then(r => setCd(r.data)).catch(() => setCd({ items: [], options: {} }));
  }, [source, !!cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  const cands = cd?.items || [];
  const byK = useMemo(() => Object.fromEntries(cands.map(c => [c.k, c])), [cands]);
  const res = useMemo(() => cfg && !cfg.error ? resolve(cfg, cands, byK) : [], [cfg, cands, byK]);
  const set = patch => { setCfg(c => ({ ...c, ...patch })); setDirty(true); };
  const items = cfg?.items || [];
  const setItems = f => set({ items: f(items) });
  const move = (k, d) => setItems(a => { const b = [...a]; const i = b.findIndex(x => x.k === k), j = i + d; if (i < 0 || j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  // une piece de regle epinglee devient une piece choisie (elle passe avec les choisies, avec ★ si demande)
  const pin = (k, featured = false) => set({ items: [...items, { k, featured, note: "" }] });
  const drop = keys => {                              // retire les choisies, exclut celles des regles
    const ks = new Set(keys), auto = res.filter(it => it.auto && ks.has(it.k)).map(it => it.k);
    set({ items: items.filter(x => !ks.has(x.k)), exclude: [...new Set([...(cfg.exclude || []), ...auto])] });
  };
  const save = async () => {
    setBusy(true);
    try {
      const { title, tagline, accent, contact, show_sale, show_credit, rules, exclude } = cfg;
      const r = await client.put(`/showcase/${sid}`, { title, tagline, accent, contact, show_sale, show_credit, source, items, rules, exclude });
      setCfg(r.data); setDirty(false); toast("Vitrine enregistrée"); onChanged?.();
    } catch (e) { toast(e?.response?.data?.detail || "La vitrine n'a pas pu être enregistrée", "error"); }
    setBusy(false);
  };
  const link = cfg?.path ? `${window.location.origin}${cfg.path}` : null;
  const makeLink = async () => {
    setBusy(true);
    try {
      if (dirty) await save();
      const r = await client.post(`/showcase/${sid}/link`, { days });
      const u = `${window.location.origin}${r.data.path}`;
      await navigator.clipboard.writeText(u).catch(() => {});
      setCfg(c => ({ ...c, path: r.data.path, token: r.data.token }));
      toast("Lien de la vitrine copié"); onChanged?.();
      egg("vitrine_partagee");
    } catch (e) { toast(e?.response?.data?.detail || "Le lien n'a pas pu être créé", "error"); }
    setBusy(false);
  };
  const unlink = async () => {
    if (!(await showConfirm("Retirer le lien de cette vitrine ? Il ne s'ouvrira plus (tu pourras en créer un nouveau).", { confirmLabel: "Retirer" }))) return;
    try { await client.delete(`/showcase/${sid}/link`); setCfg(c => ({ ...c, path: null, token: null, expires: null })); toast("Lien retiré"); onChanged?.(); }
    catch { toast("Le lien n'a pas pu être retiré", "error"); }
  };
  const remove = async () => {
    if (!(await showConfirm(`Supprimer la vitrine « ${cfg.title} » ? Son lien ne s'ouvrira plus.`, { confirmLabel: "Supprimer" }))) return;
    try { await client.delete(`/showcase/${sid}`); toast("Vitrine supprimée"); onChanged?.(); onClose(); } catch { toast("La vitrine n'a pas pu être supprimée", "error"); }
  };
  const addRule = (t, v, label) => {
    const rules = cfg.rules || [];
    setRt("");
    if (rules.some(r => r.t === t && (r.v || "") === (v || ""))) return;
    set({ rules: [...rules, { t, v: v || "", label }] });
    egg("vitrine_regle");
  };
  const inShow = useMemo(() => new Set(res.map(it => it.k)), [res]);
  const ql = q.trim().toLowerCase();
  const free = cands.filter(c => !inShow.has(c.k) && (!who || c.creator === who)
    && (!ql || `${c.title} ${c.model || ""} ${c.creator || ""}`.toLowerCase().includes(ql)));
  const shown = free.slice(0, 120);
  const togglePick = k => setPick(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const addPicked = () => {
    const ks = [...pick].filter(k => !inShow.has(k));
    const ex = new Set(ks);
    set({ items: [...items, ...ks.map(k => ({ k, featured: false, note: "" }))], exclude: (cfg.exclude || []).filter(k => !ex.has(k)) });
    setPick(new Set());
    toast(`${ks.length} pièce${ks.length > 1 ? "s" : ""} ajoutée${ks.length > 1 ? "s" : ""}`);
  };
  const opts = cd?.options || {};
  const autos = res.filter(it => it.auto), manual = res.filter(it => !it.auto);
  const nEx = (cfg?.exclude || []).length;
  const row = (it, i) => {
    const c = byK[it.k], on = sel?.has(it.k);
    return <div key={it.k} onClick={sel ? () => setSel(s => { const n = new Set(s); n.has(it.k) ? n.delete(it.k) : n.add(it.k); return n; }) : undefined}
      style={{ display: "flex", gap: 10, padding: 8, borderRadius: 14, cursor: sel ? "pointer" : "default",
        border: `1px solid ${on ? "#C9A96E" : "var(--border)"}`, background: on ? "color-mix(in srgb, #C9A96E 12%, var(--surface))" : "var(--surface)" }}>
      {sel && <span style={{ alignSelf: "center", width: 20, height: 20, borderRadius: 6, flexShrink: 0, border: `2px solid ${on ? "#C9A96E" : "var(--border)"}`,
        background: on ? "#C9A96E" : "transparent", color: "#fff", fontSize: 13, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>{on ? "✓" : ""}</span>}
      {c?.photo ? <img src={apiThumb(c.photo, 120)} alt="" style={{ width: it.auto ? 42 : 54, height: it.auto ? 42 : 54, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}/>
        : <span style={{ width: 54, height: 54, borderRadius: 10, background: "var(--surface2)", flexShrink: 0 }}/>}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5, justifyContent: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {c?.title || "Pièce sans photo"}</span>
          {!sel && (it.auto ? <>
            <button type="button" onClick={() => pin(it.k, true)} data-tip="Épingler dans le grand carrousel" style={iconBtn}>☆</button>
            <button type="button" onClick={() => pin(it.k)} data-tip="Épingler : la garder avec les pièces choisies, même hors des règles" style={iconBtn}>📌</button>
            <button type="button" onClick={() => drop([it.k])} data-tip="Exclure de la vitrine" style={{ ...iconBtn, color: "#ef4444" }}>✕</button>
          </> : <>
            <button type="button" onClick={() => setItems(a => a.map(x => x.k === it.k ? { ...x, featured: !x.featured } : x))} data-tip="Dans le grand carrousel"
              style={{ ...iconBtn, fontSize: 17, color: it.featured ? "#C9A96E" : "var(--muted)" }}>{it.featured ? "★" : "☆"}</button>
            <button type="button" onClick={() => move(it.k, -1)} disabled={!i} aria-label="Monter" style={{ ...iconBtn, opacity: i ? 1 : .3 }}>▲</button>
            <button type="button" onClick={() => move(it.k, 1)} disabled={i === manual.length - 1} aria-label="Descendre" style={{ ...iconBtn, opacity: i < manual.length - 1 ? 1 : .3 }}>▼</button>
            <button type="button" onClick={() => drop([it.k])} aria-label="Retirer" style={{ ...iconBtn, color: "#ef4444" }}>✕</button>
          </>)}
        </div>
        {it.auto ? <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>par une règle{c?.creator ? ` · ${c.creator}` : ""}{c?.date ? ` · ${c.date.slice(0, 7)}` : ""}</span>
          : !sel && <input value={it.note || ""} onChange={e => { const v = e.target.value; setItems(a => a.map(x => x.k === it.k ? { ...x, note: v } : x)); }}
            placeholder="Un mot sur cette pièce (facultatif)" maxLength={400} style={{ ...input, padding: "6px 9px", fontSize: 12.5 }}/>}
      </div>
    </div>;
  };
  return createPortal(<FSheet onClose={onClose} z={1200} bottom={<>
    <button type="button" onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button>
    <button type="button" disabled={busy || !dirty} onClick={save} style={{ ...fBtn, flex: 2, color: "#fff", border: "none", opacity: busy || !dirty ? .55 : 1,
      background: `linear-gradient(135deg, #1F2937, ${GOLD})` }}>{busy ? "…" : dirty ? "Enregistrer" : "Enregistré"}</button></>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      {!cfg ? <div style={{ color: "var(--muted)" }}>Chargement…</div> : cfg.error ? <div style={{ color: "#ef4444" }}>La vitrine n'a pas pu être lue.</div> : <>
        <div>
          <input value={cfg.title || ""} onChange={e => set({ title: e.target.value })} placeholder="Nom de la vitrine" maxLength={80} aria-label="Nom de la vitrine"
            style={{ ...input, fontSize: 18, fontWeight: 900, border: "1px dashed var(--border)", background: "transparent", padding: "4px 8px" }}/>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginTop: 4 }}>Un portfolio public, à envoyer par un lien : un grand carrousel, la collection, et ta boutique. Jamais un coût.</div>
        </div>
        <FCard t="Le lien" i="🔗" c={GOLD}>
          {link ? <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", wordBreak: "break-all" }}>{link}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cfg.expired ? "#ef4444" : "var(--muted)" }}>
              {cfg.expired ? "Expiré : il ne s'ouvre plus" : cfg.expires ? `Valable jusqu'au ${new Date(`${cfg.expires}Z`).toLocaleDateString("fr-FR")}` : "Valable sans fin"} · {cfg.views || 0} ouverture{cfg.views > 1 ? "s" : ""}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" onClick={makeLink} disabled={busy} style={chip(false)}>📋 Copier</button>
              <a href={link} target="_blank" rel="noopener noreferrer" style={chip(false)}>↗ Ouvrir</a>
              <button type="button" onClick={() => setLog(true)} style={chip(false)}>👁 Accès</button>
              <button type="button" onClick={unlink} style={{ ...chip(false), color: "#ef4444" }}>Retirer</button>
            </div>
          </div> : <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, fontWeight: 800, color: "var(--muted)" }}>Valable :
              {DUR.map(([n, l]) => <button key={n} type="button" onClick={() => setDays(n)} style={chip(days === n)}>{l}</button>)}</div>
            <button type="button" disabled={busy || !res.length} onClick={makeLink} style={{ ...fBtn, color: "#fff", border: "none", background: `linear-gradient(135deg, #1F2937, ${GOLD})`,
              opacity: busy || !res.length ? .55 : 1 }}>Créer et copier le lien</button>
            {!res.length && <div style={{ fontSize: 12, color: "var(--muted)" }}>Ajoute d'abord une pièce ou une règle.</div>}
          </div>}
        </FCard>
        <FCard t="L'allure" i="🎨" c="#8B5CF6">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            <textarea value={cfg.tagline || ""} onChange={e => set({ tagline: e.target.value })} placeholder="Une phrase d'accroche" maxLength={160} rows={2} style={{ ...input, resize: "vertical" }}/>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--muted)" }}>Couleur :</span>
              {(cfg.accents || []).map(c => <button key={c} type="button" aria-label={c} onClick={() => set({ accent: c })} style={{ width: 26, height: 26, borderRadius: "50%",
                background: c, cursor: "pointer", border: "none", boxShadow: cfg.accent === c ? "0 0 0 2px var(--surface), 0 0 0 4px var(--text)" : "inset 0 0 0 1px rgba(0,0,0,.2)" }}/>)}
            </div>
            <input value={cfg.contact || ""} onChange={e => set({ contact: e.target.value })} placeholder="Contact (Instagram, e-mail…), facultatif" maxLength={200} style={input}/>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, fontWeight: 700, color: "var(--text2)" }}>
              <input type="checkbox" checked={!!cfg.show_sale} onChange={e => set({ show_sale: e.target.checked })} style={{ width: 18, height: 18 }}/>La boutique : mes objets disponibles avec un prix souhaité</label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, fontWeight: 700, color: "var(--text2)" }}>
              <input type="checkbox" checked={!!cfg.show_credit} onChange={e => set({ show_credit: e.target.checked })} style={{ width: 18, height: 18 }}/>Créditer le modèle MakerWorld et son créateur</label>
          </div>
        </FCard>
        <FCard t="La source" i="📷" c="#EC4899">
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginTop: 4 }}>Ce que la vitrine peut montrer : les règles et l'ajout piochent là-dedans.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginTop: 8 }}>
            {SOURCES.map(([v, ic, l, sub]) => { const on = source === v;
              return <button key={v} type="button" onClick={() => set({ source: v })} aria-pressed={on}
                style={{ display: "flex", flexDirection: "column", gap: 2, padding: "10px 12px", borderRadius: 14, cursor: "pointer", textAlign: "left",
                  border: `1.5px solid ${on ? "#C9A96E" : "var(--border)"}`, background: on ? "color-mix(in srgb, #C9A96E 14%, var(--surface))" : "var(--surface)",
                  boxShadow: on ? "0 8px 20px -14px #C9A96E" : "none", transition: "all .2s" }}>
                <span style={{ fontSize: 13.5, fontWeight: 900, color: on ? GOLD : "var(--text)" }}>{ic} {l}</span>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{sub}</span></button>; })}
          </div>
        </FCard>
        <FCard t="Les règles" i="✨" c="#F59E0B">
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginTop: 4 }}>Elles remplissent la vitrine toutes seules et suivent ta galerie : une nouvelle pièce qui y répond entre d'elle-même, la plus récente d'abord.</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
            {(cfg.rules || []).map((r, i) => <span key={i} style={{ ...chip(true), display: "inline-flex", alignItems: "center", gap: 6, cursor: "default" }}>
              {RULE_ICON[r.t]} {r.t === "all" ? "Toutes mes pièces" : r.label || r.v}
              <button type="button" onClick={() => set({ rules: cfg.rules.filter((_x, j) => j !== i) })} aria-label="Retirer la règle"
                style={{ border: "none", background: "none", cursor: "pointer", color: GOLD, padding: 0, fontSize: 13, fontWeight: 900 }}>✕</button></span>)}
            {!(cfg.rules || []).length && <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Aucune règle : seulement les pièces choisies à la main.</span>}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
            {RULE_T.map(([t, l]) => <button key={t} type="button" onClick={() => t === "all" ? addRule("all", "", "Toutes mes pièces") : setRt(rt === t ? "" : t)}
              style={chip(rt === t)}>{RULE_ICON[t]} {l}</button>)}
          </div>
          {rt && <select value="" onChange={e => { const o = (opts[rt] || []).find(x => x.v === e.target.value); if (o) addRule(rt, o.v, o.label); }}
            style={{ ...input, marginTop: 8 }}>
            <option value="">Choisir…</option>
            {(opts[rt] || []).map(o => <option key={o.v} value={o.v}>{o.label} ({o.n})</option>)}
          </select>}
        </FCard>
        <FCard t={`Les pièces · ${res.length}`} i="🖼️" c="#0EA5E9">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
            <span style={{ flex: 1, minWidth: 180, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>★ : dans le grand carrousel (sinon, les premières). D'abord tes pièces choisies, dans ton ordre, puis celles des règles.</span>
            {res.length > 0 && (sel ? <>
              <button type="button" onClick={() => setSel(new Set(res.map(it => it.k)))} style={chip(false)}>Tout</button>
              <button type="button" disabled={!sel.size} onClick={() => { drop([...sel]); setSel(null); }} style={{ ...chip(false), color: "#ef4444", opacity: sel.size ? 1 : .5 }}>
                Retirer {sel.size || ""}</button>
              <button type="button" onClick={() => setSel(null)} style={chip(true)}>Terminé</button>
            </> : <button type="button" onClick={() => setSel(new Set())} style={chip(false)}>☑ Sélectionner</button>)}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {manual.map(row)}
            {(allAuto ? autos : autos.slice(0, 30)).map(row)}
            {autos.length > 30 && !allAuto && <button type="button" onClick={() => setAllAuto(true)} style={chip(false)}>Voir les {autos.length - 30} autres pièces des règles</button>}
            {!res.length && <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucune pièce pour l'instant : ajoute une règle, ou choisis-en ci-dessous.</div>}
            {nEx > 0 && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
              {nEx} pièce{nEx > 1 ? "s" : ""} exclue{nEx > 1 ? "s" : ""} des règles
              <button type="button" onClick={() => set({ exclude: [] })} style={chip(false)}>Tout rétablir</button></div>}
          </div>
        </FCard>
        <FCard t="Ajouter des pièces" i="➕" c="#22C55E">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher (nom, modèle, créateur)…" style={{ ...input, flex: "2 1 200px", width: "auto" }}/>
            <select value={who} onChange={e => setWho(e.target.value)} style={{ ...input, flex: "1 1 150px", width: "auto" }}>
              <option value="">Tous les créateurs</option>
              {(opts.creator || []).map(o => <option key={o.v} value={o.v}>{o.label} ({o.n})</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
            <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>Touche les pièces à ajouter, puis valide. {free.length} disponible{free.length > 1 ? "s" : ""}.</span>
            <button type="button" onClick={() => setPick(new Set(free.map(c => c.k)))} disabled={!free.length} style={chip(false)}>Tout sélectionner</button>
            {pick.size > 0 && <button type="button" onClick={() => setPick(new Set())} style={chip(false)}>Aucune</button>}
            <button type="button" onClick={addPicked} disabled={!pick.size} style={{ ...chip(true), color: "#fff", border: "none", background: `linear-gradient(135deg, #1F2937, ${GOLD})`,
              opacity: pick.size ? 1 : .5 }}>Ajouter {pick.size || ""}</button>
          </div>
          {!cd ? <div style={{ color: "var(--muted)", marginTop: 8 }}>Chargement de ta galerie…</div>
            : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 8, marginTop: 8 }}>
              {shown.map(c => { const on = pick.has(c.k);
                return <button key={c.k} type="button" onClick={() => togglePick(c.k)} aria-pressed={on}
                  style={{ position: "relative", padding: 0, border: `2px solid ${on ? "#C9A96E" : "var(--border)"}`, borderRadius: 12, overflow: "hidden", background: "var(--surface)",
                    cursor: "pointer", textAlign: "left", transform: on ? "scale(.97)" : "none", transition: "transform .12s, border-color .12s" }}>
                  <img src={apiThumb(c.photo, 220)} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block", opacity: on ? .75 : 1 }}/>
                  <span style={{ position: "absolute", top: 6, right: 6, width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                    background: on ? "#C9A96E" : "rgba(0,0,0,.35)", border: "2px solid #fff", color: "#fff", fontSize: 12, fontWeight: 900 }}>{on ? "✓" : ""}</span>
                  <div style={{ padding: "5px 7px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c.creator || (c.group ? `${c.prints} impressions` : "impression")} · {c.n} photo{c.n > 1 ? "s" : ""}</div></div>
                </button>; })}
            </div>}
          {free.length > shown.length && <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 8 }}>
            {free.length - shown.length} autres : affine la recherche, ou « Tout sélectionner » les prend toutes.</div>}
        </FCard>
        <button type="button" onClick={remove} style={{ ...chip(false), alignSelf: "center", color: "#ef4444" }}>Supprimer cette vitrine</button>
      </>}
    </div>
    {log && cfg?.token && <AccessLog token={cfg.token} label={cfg.title} onClose={() => setLog(false)}/>}
  </FSheet>, document.body);
}

// l'entree des vitrines (onglet Galerie, un bouton rond dans la rangee de recherche : round, son style) : au clic, mes
// vitrines (a ouvrir) et « Créer une vitrine »
export function ShowcaseBanner({ round = null }) {
  const [menu, setMenu] = useState(false);
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    if (!menu) return;
    client.get("/showcase").then(r => setList(r.data?.list || [])).catch(() => setList([]));
    const out = e => { if (box.current && !box.current.contains(e.target)) setMenu(false); };
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, [menu]);
  const create = async () => {
    try {
      const n = (list || []).length;
      const r = await client.post("/showcase", { title: n ? `Ma vitrine ${n + 1}` : "Ma vitrine" });
      setMenu(false); setOpen(r.data.id);
      if (n) egg("vitrines_plusieurs");
    } catch (e) { toast(e?.response?.data?.detail || "La vitrine n'a pas pu être créée", "error"); }
  };
  const row = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 10px", border: "none", borderRadius: 12, cursor: "pointer",
    background: "transparent", color: "var(--text)", fontSize: 13.5, fontWeight: 800, textAlign: "left" };
  return <>
    <div ref={box} style={{ position: "relative", display: "flex", justifyContent: "flex-end", flexShrink: 0 }}>
      {round ? <button type="button" onClick={() => setMenu(m => !m)} aria-label="Mes vitrines" data-tip="Mes vitrines : des portfolios publics, à partager par un lien"
        style={{ ...round, fontSize: 16, color: GOLD, border: `1px solid color-mix(in srgb, ${GOLD} ${menu ? 70 : 40}%, var(--border))`,
          background: `color-mix(in srgb, ${GOLD} ${menu ? 22 : 10}%, var(--surface2))` }}>✨</button>
      : <button type="button" onClick={() => setMenu(m => !m)} data-tip="Tes vitrines : des portfolios publics, à partager par un lien"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 16, cursor: "pointer", fontSize: 12.5, fontWeight: 800,
          border: `1px solid color-mix(in srgb, ${GOLD} 40%, var(--border))`, color: "var(--text2)",
          background: `linear-gradient(120deg, color-mix(in srgb, ${GOLD} 14%, transparent), transparent), var(--surface)` }}>
        ✨ Vitrines <span style={{ fontSize: 10, opacity: .7 }}>{menu ? "▲" : "▼"}</span>
      </button>}
      {menu && <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, width: 290, maxWidth: "calc(100vw - 32px)", padding: 6, borderRadius: 16,
        background: "linear-gradient(var(--surface), var(--surface)), var(--bg)", border: "1px solid var(--border)", boxShadow: "0 16px 40px -12px rgba(0,0,0,.35)" }}>
        {list === null ? <div style={{ padding: "8px 12px", fontSize: 12.5, color: "var(--muted)" }}>Chargement…</div>
          : list.map(s => <button key={s.id} type="button" onClick={() => { setMenu(false); setOpen(s.id); }} style={row} className="sc-pick">
            {s.cover ? <img src={apiThumb(s.cover, 80)} alt="" style={{ width: 34, height: 34, borderRadius: 9, objectFit: "cover", flexShrink: 0 }}/>
              : <span style={{ width: 34, height: 34, borderRadius: 9, background: "var(--surface2)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>✨</span>}
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.title}</span>
              <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{s.count} pièce{s.count > 1 ? "s" : ""}{(s.rules || []).length ? " · règles" : ""}</span>
            </span>
            <span data-tip={s.path ? (s.expired ? "Lien expiré" : "Lien actif") : "Pas de lien"} style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: s.path ? (s.expired ? "#ef4444" : "#16a34a") : "var(--border)" }}/>
          </button>)}
        <button type="button" onClick={create} style={{ ...row, color: GOLD }} className="sc-pick">
          <span style={{ width: 34, textAlign: "center", fontSize: 18 }}>＋</span>Créer une vitrine</button>
        <style>{`.sc-pick:hover { background: var(--surface2) !important; }`}</style>
      </div>}
    </div>
    {open && <ShowcaseManager sid={open} onClose={() => setOpen(null)}/>}
  </>;
}
