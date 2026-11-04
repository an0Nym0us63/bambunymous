import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { Search, X, Clock } from "lucide-react";
import client, { apiUrl, apiThumb } from "../api/client";
import MwImg from "./MwImg";
import { egg } from "../eggs";

// La recherche globale (04/11/2026) : une seule barre, comme un lecteur multimedia -- les resultats par categorie
// (impressions, groupes, modeles MakerWorld, createurs, filaments, bobines, objets, guide), chacun mene a sa fiche. Ctrl+K ou « / »
// l'ouvrent de partout ; les dernieres recherches sont gardees dans ce navigateur.
const RECENT = "bn_search_recent";
const readRecent = () => { try { const v = JSON.parse(localStorage.getItem(RECENT) || "[]"); return Array.isArray(v) ? v.slice(0, 8) : []; } catch { return []; } };
const saveRecent = q => { try { localStorage.setItem(RECENT, JSON.stringify([q, ...readRecent().filter(x => x !== q)].slice(0, 8))); } catch { /* navigateur sans stockage */ } };
const clearRecent = () => { try { localStorage.removeItem(RECENT); } catch { /* idem */ } };

const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// les mots cherches, en gras dans le titre (debut de mot, sans tenir compte des accents)
function Marked({ text, words }) {
  const t = String(text || ""), n = norm(t);
  const hits = [];
  words.forEach(w => {
    const k = norm(w);
    if (!k) return;
    let i = 0;
    while ((i = n.indexOf(k, i)) >= 0) { if (i === 0 || /[^a-z0-9]/.test(n[i - 1])) hits.push([i, i + k.length]); i += k.length; }
  });
  if (!hits.length) return t;
  hits.sort((a, b) => a[0] - b[0]);
  const out = [];
  let at = 0;
  hits.forEach(([a, b], j) => { if (a < at) return; if (a > at) out.push(t.slice(at, a)); out.push(<b key={j} style={{ color: "var(--text)", fontWeight: 900 }}>{t.slice(a, b)}</b>); at = b; });
  if (at < t.length) out.push(t.slice(at));
  return out;
}

function Thumb({ it, color, icon }) {
  const box = { width: 44, height: 44, borderRadius: it.round ? "50%" : 12, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center",
    background: `color-mix(in srgb, ${color} 12%, var(--surface2))`, border: "1px solid var(--border)" };
  const [bad, setBad] = useState(false);
  if (it.mw && !bad) return <span style={box}><MwImg src={it.mw} w={96} style={{ width: "100%", height: "100%", objectFit: "cover" }} onError={() => setBad(true)}/></span>;
  if (it.img && !bad) return <span style={box}><img src={apiThumb(apiUrl(it.img), 128)} alt="" loading="lazy" onError={() => setBad(true)}
    style={{ width: "100%", height: "100%", objectFit: "cover" }}/></span>;
  if (it.swatch) return <span style={box}><span style={{ width: 26, height: 26, borderRadius: "50%", background: it.swatch,
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,.18), 0 3px 8px -3px rgba(0,0,0,.35)" }}/></span>;
  return <span style={{ ...box, fontSize: 20 }}>{it.icon || icon || "🔎"}</span>;
}

export function SearchSheet({ onClose }) {
  const nav = useNavigate();
  const loc = useLocation();
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);           // {q, groups}
  const [busy, setBusy] = useState(false);
  const [sel, setSel] = useState(0);              // le resultat choisi au clavier
  const [recent, setRecent] = useState(readRecent);
  const inp = useRef(null);
  const listRef = useRef(null);
  useEffect(() => { const t = setTimeout(() => inp.current?.focus(), 60); return () => clearTimeout(t); }, []);
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setRes(null); setBusy(false); return undefined; }
    setBusy(true);
    let alive = true;
    const t = setTimeout(() => {
      client.get("/search", { params: { q: s } })
        .then(r => { if (alive) { setRes(r.data); setSel(0); } })
        .catch(() => alive && setRes({ q: s, groups: [], error: true }))
        .finally(() => alive && setBusy(false));
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);
  const words = useMemo(() => q.trim().split(/\s+/).filter(Boolean), [q]);
  const flat = useMemo(() => (res?.groups || []).flatMap(g => g.items.map(it => ({ ...it, g }))), [res]);
  const go = it => {
    saveRecent(q.trim());
    egg("recherche_globale");
    onClose();
    // ?model=… s'ouvre par-dessus la page en cours
    nav(it.to.startsWith("?") ? `${loc.pathname}${it.to}` : it.to);
  };
  const onKey = e => {
    if (!flat.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(i => Math.min(flat.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(i => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (flat[sel]) go(flat[sel]); }
  };
  useEffect(() => { listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  const nTotal = (res?.groups || []).reduce((a, g) => a + (g.total || 0), 0);
  let idx = -1;
  return createPortal(
    <div onClick={onClose} data-no-pull="" style={{ position: "fixed", inset: 0, zIndex: 6500, background: "rgba(2,6,23,0.55)", backdropFilter: "blur(6px)",
      display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "max(12px, env(safe-area-inset-top)) 12px 12px", animation: "bn-fade .18s ease-out" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(720px, 100%)", maxHeight: "min(86dvh, 820px)", marginTop: "min(6vh, 60px)", display: "flex", flexDirection: "column",
        borderRadius: 24, overflow: "hidden", background: "var(--sheet-bg)", border: "1px solid var(--border)", boxShadow: "0 30px 80px rgba(0,0,0,.45)",
        animation: "bn-pop .22s cubic-bezier(.2,.8,.2,1)" }}>
        {/* le champ */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 16px", borderBottom: "1px solid var(--border)",
          background: "linear-gradient(135deg, color-mix(in srgb, #6366F1 10%, transparent), color-mix(in srgb, #EC4899 6%, transparent))" }}>
          <Search size={20} style={{ color: "#6366F1", flexShrink: 0 }}/>
          <input ref={inp} autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey} placeholder="Rechercher une impression, un modèle, une bobine…"
            aria-label="Rechercher partout" enterKeyHint="search" autoComplete="off" spellCheck={false}
            style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 17, fontWeight: 700, color: "var(--text)" }}/>
          {busy && <span aria-hidden="true" style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid color-mix(in srgb, #6366F1 30%, transparent)",
            borderTopColor: "#6366F1", animation: "spin .8s linear infinite", flexShrink: 0 }}/>}
          {q && <button type="button" onClick={() => { setQ(""); inp.current?.focus(); }} aria-label="Effacer" data-tip="Effacer"
            style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: "var(--surface2)", color: "var(--muted)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><X size={15}/></button>}
        </div>
        <div ref={listRef} style={{ overflowY: "auto", padding: "8px 10px 14px", overscrollBehavior: "contain" }}>
          {/* avant de taper : les dernieres recherches */}
          {!res && q.trim().length < 2 && (recent.length ? <div style={{ padding: "6px 6px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", margin: "4px 4px 8px" }}>
              <Clock size={13}/>Recherches récentes
              <button type="button" onClick={() => { clearRecent(); setRecent([]); }} style={{ marginLeft: "auto", border: "none", background: "none", color: "var(--muted)",
                fontSize: 11.5, fontWeight: 800, cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>Effacer</button></div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {recent.map(r => <button key={r} type="button" onClick={() => setQ(r)} style={{ padding: "7px 13px", borderRadius: 20, border: "1px solid var(--border)",
                background: "var(--surface2)", color: "var(--text2)", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>{r}</button>)}
            </div></div>
            : <div style={{ padding: "28px 12px", textAlign: "center", fontSize: 13.5, fontWeight: 700, color: "var(--muted)" }}>
              Impressions, groupes, modèles MakerWorld, créateurs, filaments, bobines, objets et pages du guide : tout se cherche d'ici.
              <div style={{ marginTop: 8, fontSize: 12 }}>Astuce : <b>Ctrl K</b> ou <b>/</b> ouvrent la recherche de n'importe où.</div></div>)}
          {res && !res.groups.length && !busy && <div style={{ padding: "28px 12px", textAlign: "center", fontSize: 14, fontWeight: 700, color: "var(--muted)" }}>
            {res.error ? "La recherche n'a pas abouti" : `Rien pour « ${res.q} »`}</div>}
          {res && res.groups.length > 0 && <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)", margin: "4px 6px 2px" }}>
            {nTotal} résultat{nTotal > 1 ? "s" : ""} · ↑ ↓ pour choisir, Entrée pour ouvrir</div>}
          {(res?.groups || []).map(g => <section key={g.key} style={{ marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px 6px" }}>
              <span style={{ fontSize: 15 }}>{g.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: g.color }}>{g.label}</span>
              <span style={{ fontSize: 11, fontWeight: 900, color: g.color, background: `color-mix(in srgb, ${g.color} 14%, transparent)`, borderRadius: 10, padding: "1px 7px" }}>{g.total}</span>
              {g.more && g.total > g.items.length && <button type="button" onClick={() => go({ to: g.more })} style={{ marginLeft: "auto", border: "none", background: "none",
                color: g.color, fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Tout voir ›</button>}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {g.items.map(it => { idx += 1; const i = idx, on = i === sel;
                return <button key={`${g.key}${it.to}`} type="button" data-i={i} onClick={() => go(it)} onMouseEnter={() => setSel(i)}
                  style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", padding: "7px 8px", borderRadius: 14, cursor: "pointer",
                    border: `1px solid ${on ? `color-mix(in srgb, ${g.color} 40%, transparent)` : "transparent"}`,
                    background: on ? `color-mix(in srgb, ${g.color} 10%, var(--surface))` : "transparent", transition: "background .12s" }}>
                  <Thumb it={it} color={g.color} icon={g.icon}/>
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <Marked text={it.title} words={words}/></span>
                    {(it.sub || it.snippet) && <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis",
                      display: "-webkit-box", WebkitLineClamp: it.snippet ? 2 : 1, WebkitBoxOrient: "vertical" }}>
                      {it.sub}{it.sub && it.snippet ? " — " : ""}{it.snippet && <Marked text={it.snippet} words={words}/>}</span>}
                  </span>
                  <span aria-hidden="true" style={{ color: on ? g.color : "var(--muted)", fontSize: 16, fontWeight: 900 }}>›</span>
                </button>; })}
            </div>
          </section>)}
        </div>
      </div>
    </div>, document.body);
}

// le bouton : une loupe ronde (en-tete du telephone), ou un faux champ (barre laterale) ; Ctrl+K et « / » partout
export default function GlobalSearch({ wide = false, mini = false }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (wide) return undefined;                    // un seul ecouteur (celui de l'en-tete, toujours monte)
    const k = e => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || "") || e.target?.isContentEditable;
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); setOpen(true); }
      else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [wide]);
  const btn = wide && !mini
    ? <button type="button" onClick={() => setOpen(true)} data-tip="Rechercher partout (Ctrl K)" aria-label="Rechercher partout"
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "8px 10px", borderRadius: 12, border: "1px solid var(--border)",
          background: "var(--surface2)", color: "var(--muted)", cursor: "pointer", fontSize: 13, fontWeight: 700 }}>
        <Search size={15}/><span style={{ flex: 1, textAlign: "left" }}>Rechercher…</span>
        <span style={{ fontSize: 10.5, fontWeight: 800, border: "1px solid var(--border)", borderRadius: 6, padding: "1px 5px" }}>Ctrl K</span></button>
    : <button type="button" onClick={() => setOpen(true)} data-tip="Rechercher partout" aria-label="Rechercher partout"
        style={{ width: wide ? 36 : 34, height: wide ? 36 : 34, borderRadius: wide ? 12 : "50%", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          border: wide ? "1px solid var(--border)" : "none", background: wide ? "var(--surface2)" : "rgba(99,102,241,0.12)", color: wide ? "var(--muted)" : "#6366F1" }}>
        <Search size={wide ? 17 : 19} strokeWidth={2.2}/></button>;
  return <>{btn}{open && <SearchSheet onClose={() => setOpen(false)}/>}</>;
}
