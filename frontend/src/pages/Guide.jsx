import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronRight, List, Search, X } from "lucide-react";
import client from "../api/client";
import "./guide.css";

// Le guide d'utilisation (23/10/2026), dans l'appli et a son theme. Il n'est plus servi en acces libre :
// les chapitres et les captures viennent de /api/v1/guide, reserves aux comptes de la maison.
// Organisation (pour le tenir a jour) :
// - un fichier par chapitre dans backend/guide/pages (liste et ordre : CHAPTERS ci-dessous) ;
// - dans un chapitre, chaque fonctionnalite est une <section id="..."> avec un <h2> ou un <h3> :
//   l'id sert d'ancre (#id) et le sommaire se construit tout seul a partir des titres ;
// - les captures vont dans backend/guide/img, nommees <chapitre>-<sujet>.webp, en WebP pour rester leger.
// Quand une fonctionnalite change, on modifie sa section (et sa capture) dans le meme commit.
const CHAPTERS = [
  ["premiers-pas", "Premiers pas"],
  ["accueil", "Accueil"],
  ["tuiles", "Les tuiles de l'accueil"],
  ["imprimante", "Imprimante et AMS"],
  ["impressions", "Impressions"],
  ["filaments", "Filaments"],
  ["objets", "Objets et ventes"],
  ["stats", "Statistiques"],
  ["makerworld", "MakerWorld"],
  ["notifications", "Notifications"],
  ["copains", "Copains"],
  ["succes", "Succès"],
  ["parametres", "Paramètres"],
];
// une partie compte comme lue quand on y est reste ce temps, page visible et lecteur actif
const READ_AFTER = 8, IDLE_AFTER = 90000, FLUSH_EVERY = 30000;

const norm = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const slug = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const scrollerOf = el => { for (let n = el?.parentElement; n; n = n.parentElement) if (/auto|scroll/.test(getComputedStyle(n).overflowY)) return n; return null; };
const idOf = h => { const s = h.closest("section"); return s && s.querySelector("h2, h3, h4") === h ? s.id : h.id; };
const useNarrow = () => {
  const q = "(max-width: 900px)";
  const [n, setN] = useState(() => typeof window !== "undefined" && window.matchMedia(q).matches);
  useEffect(() => { const m = window.matchMedia(q), f = () => setN(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return n;
};

export default function Guide() {
  const narrow = useNarrow();
  const [html, setHtml] = useState(null);
  const [tree, setTree] = useState([]);
  const [open, setOpen] = useState(() => new Set());
  const [cur, setCur] = useState(null);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const [zoom, setZoom] = useState(null);
  // la marge haute de la zone qui defile (l'en-tete de l'appli au telephone) : la barre se colle deja dessous
  // (un element colle se cale sur la zone sans sa marge), mais les sauts d'ancre doivent en tenir compte
  const [top, setTop] = useState(0);
  const content = useRef(null), index = useRef([]), curRef = useRef(null), searches = useRef(0);
  curRef.current = cur;

  // les chapitres, captures reecrites vers l'API (une image n'envoie pas d'en-tete : le jeton part en _t)
  useEffect(() => {
    let dead = false;
    const tok = encodeURIComponent(localStorage.getItem("token") || "");
    Promise.all(CHAPTERS.map(([f, t]) => client.get(`/guide/pages/${f}`, { home: true, responseType: "text", transformResponse: r => r })
      .then(r => r.data).catch(() => `<h1>${t}</h1><p>Chapitre introuvable.</p>`)))
      .then(parts => {
        if (dead) return;
        setHtml(parts.map((h, i) => `<article class="chapter" id="${CHAPTERS[i][0]}">${
          h.replace(/(<img\b[^>]*?\ssrc=")img\/([a-z0-9-]+\.(?:webp|png|jpg))"/g, `$1/api/v1/guide/img/$2?_t=${tok}"`)}</article>`).join(""));
      });
    return () => { dead = true; };
  }, []);

  const go = (id, smooth = false) => {
    const el = id && document.getElementById(id);
    if (!el) return;
    const sc = scrollerOf(content.current);
    const off = top + (narrow ? 64 : 16);
    if (sc) sc.scrollTo({ top: el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - off, behavior: smooth ? "smooth" : "auto" });
    else window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - off, behavior: smooth ? "smooth" : "auto" });
    history.replaceState(null, "", `#${id}`);
  };
  const openTo = id => setOpen(o => {
    const n = new Set(o);
    for (const c of tree) { if (c.id === id) n.add(c.id);
      for (const k of c.kids) { if (k.id === id) n.add(c.id); if (k.kids.some(x => x.id === id)) { n.add(c.id); n.add(k.id); } } }
    return n;
  });

  // le contenu pose : ancres sur les titres, sommaire, index de recherche, puis l'ancre demandee
  useLayoutEffect(() => {
    const root = content.current;
    if (!html || !root) return;
    const sc = scrollerOf(root);
    setTop(sc && sc !== document.documentElement ? parseFloat(getComputedStyle(sc).paddingTop) || 0 : 0);
    root.querySelectorAll("h2, h3, h4").forEach(h => {
      let id = h.id || h.closest("section")?.id;
      if (!id || h.closest("section")?.querySelector("h2, h3, h4") !== h) { id = h.id || slug(h.textContent); h.id = id; }
      const a = document.createElement("a"); a.className = "anchor"; a.href = `#${id}`; a.textContent = "#"; a.setAttribute("aria-label", "Lien vers cette partie");
      h.appendChild(a);
    });
    root.querySelectorAll("figure img").forEach(img => { img.loading = "lazy"; });
    const t = [], idx = [];
    root.querySelectorAll("article.chapter").forEach(ch => {
      const h1 = ch.querySelector("h1"), chap = h1 ? h1.textContent.trim() : ch.id;
      const sub = [];
      let c = null;
      ch.querySelectorAll("h2, h3").forEach(h => {
        const it = { id: idOf(h), text: h.firstChild.textContent.trim(), kids: [] };
        if (h.tagName === "H2" || !c) { c = it; sub.push(it); } else c.kids.push(it);
      });
      t.push({ id: ch.id, text: chap, kids: sub });
      // recherche : un bloc par titre, avec le texte qui le suit
      let block = { id: ch.id, title: chap, chap, text: "" };
      const push = () => { if (block.text.trim() || block.title) idx.push({ ...block, n: norm(`${block.title} ${block.text}`) }); };
      const walk = node => { for (const el of node.children) {
        if (/^H[1-4]$/.test(el.tagName)) { if (el.tagName !== "H1") { push(); block = { id: idOf(el), title: el.firstChild.textContent.trim(), chap, text: "" }; } }
        else if (el.tagName === "SECTION") walk(el);
        else block.text += ` ${el.textContent}`;
      } };
      walk(ch); push();
    });
    setTree(t);
    index.current = idx;
  }, [html]);
  useEffect(() => {
    if (!tree.length) return;
    const h = decodeURIComponent(window.location.hash.slice(1));
    if (!h) return undefined;
    openTo(h);
    // les captures au-dessus se chargent et poussent la cible : on se recale, tant qu'on n'a pas touche a la page
    let moved = false;
    const stop = () => { moved = true; };
    const evs = ["pointerdown", "wheel", "touchstart", "keydown"];
    evs.forEach(e => window.addEventListener(e, stop, { passive: true, capture: true }));
    requestAnimationFrame(() => go(h));
    const ts = [400, 1000, 2000].map(ms => setTimeout(() => { if (!moved) go(h); }, ms));
    return () => { ts.forEach(clearTimeout); evs.forEach(e => window.removeEventListener(e, stop, { capture: true })); };
  }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps

  // la partie en cours, suivie au defilement
  useEffect(() => {
    const root = content.current;
    if (!html || !root) return undefined;
    const sc = scrollerOf(root) || window;
    const heads = [...root.querySelectorAll("h1, h2, h3")];
    let tick = false;
    const f = () => { if (tick) return; tick = true; requestAnimationFrame(() => {
      tick = false;
      let c = heads[0];
      const lim = (sc === window ? 0 : sc.getBoundingClientRect().top) + top + 140;
      for (const h of heads) { if (h.getBoundingClientRect().top < lim) c = h; else break; }
      if (c) setCur(c.tagName === "H1" ? c.closest("article").id : idOf(c));
    }); };
    sc.addEventListener("scroll", f, { passive: true });
    f();
    return () => sc.removeEventListener("scroll", f);
  }, [html, top]);

  // ce qui est lu, pour les succes : le temps (page visible, lecteur actif), les parties, l'ouverture
  useEffect(() => {
    const acc = { s: 0, read: new Set() }, dwell = {};
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const evs = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"];
    evs.forEach(e => window.addEventListener(e, bump, { passive: true, capture: true }));
    const iv = setInterval(() => {
      if (document.hidden || Date.now() - last > IDLE_AFTER) return;
      acc.s += 1;
      const id = curRef.current;
      if (id) { dwell[id] = (dwell[id] || 0) + 1; if (dwell[id] === READ_AFTER) acc.read.add(id); }
    }, 1000);
    const flush = () => {
      const n = searches.current;
      if (acc.s < 1 && !acc.read.size && !n) return;
      const body = { seconds: acc.s, sections: [...acc.read], searches: n };
      acc.s = 0; acc.read = new Set(); searches.current = 0;
      client.post("/guide/read", body, { home: true }).catch(() => {});
    };
    client.post("/guide/read", { opened: true }, { home: true }).catch(() => {});
    const fl = setInterval(flush, FLUSH_EVERY);
    const vis = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(iv); clearInterval(fl); document.removeEventListener("visibilitychange", vis);
      evs.forEach(e => window.removeEventListener(e, bump, { capture: true })); flush(); };
  }, []);

  // recherche plein texte, par partie ; une recherche compte quand on s'y arrete
  const words = useMemo(() => norm(q).split(/\s+/).filter(w => w.length > 1), [q]);
  useEffect(() => {
    if (!words.length) return undefined;
    const t = setTimeout(() => { searches.current += 1; }, 1500);
    return () => clearTimeout(t);
  }, [words.join(" ")]); // eslint-disable-line react-hooks/exhaustive-deps
  const hits = useMemo(() => !words.length ? null : index.current.map(b => {
    if (!words.every(w => b.n.includes(w))) return null;
    return { b, score: words.reduce((s, w) => s + (norm(b.title).includes(w) ? 10 : 0) + Math.min(5, b.n.split(w).length - 1), 0) };
  }).filter(Boolean).sort((a, c) => c.score - a.score).slice(0, 40), [words, html]); // eslint-disable-line react-hooks/exhaustive-deps
  const mark = s => {
    if (!words.length) return s;
    const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
    return s.split(re).map((p, i) => i % 2 ? <mark key={i}>{p}</mark> : p);
  };
  const snippet = t => { const s = t.replace(/\s+/g, " "), i = Math.max(0, norm(s).indexOf(words[0]) - 60); return `${i ? "…" : ""}${s.slice(i, i + 180).trim()}…`; };
  const pick = id => { setQ(""); setMenu(false); openTo(id); requestAnimationFrame(() => go(id, true)); };

  // liens internes (#id) du contenu, captures agrandissables
  const onContent = e => {
    const img = e.target.closest("figure img");
    if (img) { setZoom({ src: img.src, cap: img.closest("figure").querySelector("figcaption")?.textContent || "" }); return; }
    const a = e.target.closest("a[href^='#']");
    if (a) { e.preventDefault(); const id = decodeURIComponent(a.getAttribute("href").slice(1)); openTo(id); go(id, true); }
  };

  const toggle = id => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const node = (it, lvl) => <li key={it.id} className={open.has(it.id) ? "open" : ""}>
    <div className="row">
      <button type="button" className={`tog${it.kids.length ? "" : " leaf"}`} aria-label="Déplier" onClick={() => toggle(it.id)}><ChevronRight size={14}/></button>
      <a href={`#${it.id}`} className={`${cur === it.id ? "cur" : ""}${lvl === 0 ? " top" : ""}`} onClick={e => { e.preventDefault(); pick(it.id); }}>{it.text}</a>
    </div>
    {it.kids.length > 0 && <ul>{it.kids.map(k => node(k, lvl + 1))}</ul>}
  </li>;
  const side = <nav className="gd-side" aria-label="Sommaire">
    <div className="gd-tools">
      <button type="button" onClick={() => setOpen(new Set(tree.flatMap(c => [c.id, ...c.kids.filter(k => k.kids.length).map(k => k.id)])))}>Tout déplier</button>
      <button type="button" onClick={() => setOpen(new Set())}>Tout replier</button>
    </div>
    <ul className="gd-tree">{tree.map(c => node(c, 0))}</ul>
  </nav>;

  return (
    <div className="bn-guide">
      <div className="gd-bar" style={{ top: 0 }}>
        <span className="gd-title"><BookOpen size={18}/>{!narrow && "Guide d'utilisation"}</span>
        <label className="gd-search">
          <Search size={15}/>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher dans le guide…" aria-label="Rechercher dans le guide" autoComplete="off"/>
          {q && <button type="button" aria-label="Effacer" onClick={() => setQ("")}><X size={14}/></button>}
        </label>
        {narrow && <button type="button" className="gd-menu" onClick={() => setMenu(true)} aria-label="Sommaire"><List size={18}/></button>}
      </div>
      <div className="gd-wrap">
        {!narrow && <div className="gd-col" style={{ top: 64 }}>{side}</div>}
        <main className="gd-main">
          {hits && <div className="gd-results">
            <h2>{hits.length ? `${hits.length} résultat${hits.length > 1 ? "s" : ""}` : "Aucun résultat"} pour « {q} »</h2>
            {hits.map(({ b }) => <a key={b.id} className="hit" href={`#${b.id}`} onClick={e => { e.preventDefault(); pick(b.id); }}>
              <small>{b.chap}</small><b>{mark(b.title)}</b><span>{mark(snippet(b.text))}</span></a>)}
          </div>}
          {html == null ? <p className="gd-loading">Chargement du guide…</p>
            : <div ref={content} className="gd-content" hidden={!!hits} onClick={onContent} dangerouslySetInnerHTML={{ __html: html }}/>}
        </main>
      </div>
      {narrow && menu && createPortal(<div className="bn-guide gd-drawer" onClick={() => setMenu(false)}>
        <div onClick={e => e.stopPropagation()}>
          <div className="gd-drawer-head"><b>Sommaire</b><button type="button" aria-label="Fermer" onClick={() => setMenu(false)}><X size={18}/></button></div>
          {side}
        </div>
      </div>, document.body)}
      {zoom && createPortal(<div className="bn-guide gd-zoom" onClick={() => setZoom(null)}><img src={zoom.src} alt=""/>{zoom.cap && <p>{zoom.cap}</p>}</div>, document.body)}
    </div>
  );
}
