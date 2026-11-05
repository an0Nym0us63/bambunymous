import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";
import { egg } from "../eggs";

// Le dessin d'une couche (02/11/2026) : les traces de chaque filament, lus dans le G-code du 3MF tranche, et la couche
// d'avant en fantome. Affichage seulement. Pas de « deja imprime » dans la couche : on sait l'ordre des traces, pas le
// temps que prend chacun.

// la couche : celle que l'imprimante annonce (n vide), ou une couche choisie ; relue quand la couche change
export function useLayer(enabled, n = null, nowLayer = null) {
  const [d, setD] = useState(null);
  const [ghost, setGhost] = useState(null);
  const last = useRef(null);
  useEffect(() => {
    if (!enabled) { setD(null); return; }
    let on = true;
    client.get("/live/layer", { params: n != null ? { n } : {} }).then(r => {
      if (!on) return;
      const x = r.data;
      // la couche d'avant devient le fantome (gardee ici : le serveur ne la renvoie pas)
      const prev = last.current;
      setGhost(prev && x?.ok && prev.ok && prev.layer === x.layer - 1 ? prev : null);
      if (x?.ok && (!prev || prev.layer !== x.layer)) last.current = x;
      setD(x);
    }).catch(() => { if (on) setD({ ok: false }); });
    return () => { on = false; };
    // la couche en cours : relue a chaque nouvelle couche
  }, [enabled, n, nowLayer]); // eslint-disable-line react-hooks/exhaustive-deps
  return { d, ghost };
}

// la vue 3D (05/11/2026) : le contour exterieur de chaque couche, lu une fois par impression ; colore jusqu'a la
// couche en cours, le reste en fantome. Le 3MF envoye a l'imprimante n'a pas le maillage : tout vient du G-code
const SHELLS = {};
export function useShell(enabled, printId) {
  const [s, setS] = useState(() => (printId && SHELLS[printId]) || null);
  useEffect(() => {
    if (!enabled || !printId) return;
    if (SHELLS[printId]) { setS(SHELLS[printId]); return; }
    let on = true;
    client.get("/live/shell", { params: { print_id: printId } }).then(r => { SHELLS[printId] = r.data; if (on) setS(r.data); })
      .catch(() => { if (on) setS({ ok: false }); });
    return () => { on = false; };
  }, [enabled, printId]);
  return s;
}

// 2D ou 3D : un choix garde sur cet appareil (la tuile suit celui de la vue en grand)
const MODE_KEY = "bn_layer_mode";
export function useLayerMode() {
  const [m, setM] = useState(() => { try { return localStorage.getItem(MODE_KEY) || "2d"; } catch { return "2d"; } });
  useEffect(() => {
    const f = e => { if (e.detail) setM(e.detail); };
    window.addEventListener("bn-layer-mode", f); return () => window.removeEventListener("bn-layer-mode", f);
  }, []);
  const set = v => { try { localStorage.setItem(MODE_KEY, v); } catch { /* rien */ } setM(v); window.dispatchEvent(new CustomEvent("bn-layer-mode", { detail: v })); };
  return [m, set];
}

// vue de trois quarts : on tourne autour au doigt ou a la souris (glisser)
export function Layer3D({ s, d, now, w, h }) {
  const ref = useRef(null);
  const [az, setAz] = useState(-0.75);
  const drag = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !s?.ok || !s.box) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const [bx0, by0, bx1, by1] = s.box, cx = (bx0 + bx1) * 5, cy = (by0 + by1) * 5;     // dixiemes de mm
    const ca = Math.cos(az), sa = Math.sin(az), el = 0.6, se = Math.sin(el), ce = Math.cos(el);
    const proj = (x, y, z) => { const dx = x - cx, dy = y - cy, rx = dx * ca - dy * sa, ry = dx * sa + dy * ca; return [rx, -ry * se - z * 10 * ce]; };
    // l'echelle : les coins de la boite, en bas et en haut
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of [[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]]) for (const z of [0, s.ztop]) {
      const [X, Y] = proj(x * 10, y * 10, z); x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); }
    const pad = 10, k = Math.min((w - 2 * pad) / Math.max(1, x1 - x0), (h - 2 * pad) / Math.max(1, y1 - y0));
    const ox = (w - (x1 - x0) * k) / 2 - x0 * k, oy = (h - (y1 - y0) * k) / 2 - y0 * k;
    const muted = getComputedStyle(cv).getPropertyValue("--muted").trim() || "#94a3b8";
    const col = t => d?.colors?.[t] || "#94a3b8";
    const sk = d?.skipped || {};
    g.lineCap = "round"; g.lineJoin = "round";
    const cur = now ?? s.last;
    for (const L of s.layers) {
      const done = L.n <= cur, top = done && L.n > cur - (s.step || 1);
      for (const q of L.paths) {
        const p = unpack(q.p);
        if (p.length < 4) continue;
        const gone = q.o != null && sk[q.o] && L.n >= sk[q.o].layer;
        g.beginPath();
        let [X, Y] = proj(p[0], p[1], L.z); g.moveTo(ox + X * k, oy + Y * k);
        for (let i = 2; i < p.length; i += 2) { [X, Y] = proj(p[i], p[i + 1], L.z); g.lineTo(ox + X * k, oy + Y * k); }
        if (gone) { g.setLineDash([3, 3]); g.strokeStyle = muted; g.globalAlpha = 0.35; g.lineWidth = 1; }
        else if (!done) { g.setLineDash([]); g.strokeStyle = muted; g.globalAlpha = 0.1; g.lineWidth = 1; }
        else { g.setLineDash([]); g.strokeStyle = col(q.t); g.globalAlpha = top ? 1 : 0.8; g.lineWidth = top ? 2.2 : 1.1; }
        g.stroke();
      }
    }
    g.setLineDash([]); g.globalAlpha = 1;
  }, [s, d, now, w, h, az]);
  // au doigt (05/11/2026) : tourner ne doit ni faire defiler, ni changer d'ecran de l'accueil (data-noswipe), ni ouvrir la
  // vue en grand de la tuile au lacher (un simple toucher l'ouvre toujours)
  const moved = useRef(false);
  const down = e => { e.stopPropagation(); drag.current = { x: e.clientX, az }; moved.current = false; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const move = e => { if (!drag.current) return; e.stopPropagation(); const dx = e.clientX - drag.current.x;
    if (Math.abs(dx) > 4) moved.current = true; setAz(drag.current.az + dx / 120); };
  const up = () => { drag.current = null; };
  const click = e => { if (moved.current) { e.stopPropagation(); e.preventDefault(); moved.current = false; } };
  if (s && !s.ok) return <span style={{ fontSize: 12.5, color: "var(--muted)" }}>Pas de vue 3D pour cette impression</span>;
  if (!s) return <div style={{ width: w, height: h, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12.5, color: "var(--muted)" }}>Calcul de la vue 3D…</div>;
  return <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClickCapture={click}
    onTouchStart={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()} data-noswipe="" data-tip="Glisse pour tourner autour"
    style={{ width: w, height: h, display: "block", touchAction: "none", cursor: "grab" }}/>;
}

const unpack = p => { const out = [p[0], p[1]]; for (let k = 2; k < p.length; k += 2) out.push(out[k - 2] + p[k], out[k - 1] + p[k + 1]); return out; };

export function LayerCanvas({ d, ghost, w, h }) {
  const ref = useRef(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !d?.ok) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const box = d.box || [0, 0, 256, 256];
    const pad = 8, bw = Math.max(1, box[2] - box[0]), bh = Math.max(1, box[3] - box[1]);
    const k = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh) / 10;          // les points sont en dixiemes de mm
    const ox = (w - bw * 10 * k) / 2 - box[0] * 10 * k, oy = (h + bh * 10 * k) / 2 + box[1] * 10 * k;
    const lw = Math.max(0.8, 0.42 * 10 * k);
    const stroke = (paths, style) => {
      for (const q of paths) {
        const p = unpack(q.p);
        if (p.length < 4) continue;
        g.beginPath();
        g.moveTo(ox + p[0] * k, oy - p[1] * k);
        for (let i = 2; i < p.length; i += 2) g.lineTo(ox + p[i] * k, oy - p[i + 1] * k);
        style(q); g.stroke();
      }
    };
    g.lineCap = "round"; g.lineJoin = "round";
    const muted = getComputedStyle(cv).getPropertyValue("--muted").trim() || "#94a3b8";
    if (ghost?.ok) { g.lineWidth = lw; g.globalAlpha = 0.18; stroke(ghost.paths, () => { g.strokeStyle = muted; }); }
    const col = t => d.colors?.[t] || "#94a3b8";
    const lightCol = c => { const m = /^#?([0-9a-f]{6})/i.exec(c || ""); if (!m) return false; const n = parseInt(m[1], 16);
      return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 > 0.78; };
    // un filament clair (blanc, jade...) : un fin contour gris dessous, sinon il disparait sur le fond clair
    const pale = d.paths.filter(q => lightCol(col(q.t)));
    if (pale.length) {
      g.lineWidth = lw + 1.4;
      stroke(pale, () => { g.strokeStyle = "#64748b"; g.globalAlpha = 0.55; });
    }
    // une piece annulee (05/11/2026) : a partir de sa couche, grisee sous une zone hachuree
    const sk = d.skipped || {};
    const off = q => q.o != null && sk[q.o] && d.layer >= sk[q.o].layer;
    const gone = d.paths.filter(off), kept = gone.length ? d.paths.filter(q => !off(q)) : d.paths;
    g.lineWidth = lw;
    stroke(kept, q => { g.strokeStyle = col(q.t); g.globalAlpha = 1; });
    if (gone.length) {
      const byObj = {};
      for (const q of gone) (byObj[q.o] = byObj[q.o] || []).push(q);
      for (const qs of Object.values(byObj)) {
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const q of qs) { const p = unpack(q.p); for (let i = 0; i < p.length; i += 2) {
          const X = ox + p[i] * k, Y = oy - p[i + 1] * k; x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y); } }
        x0 -= 3; y0 -= 3; x1 += 3; y1 += 3;
        g.save();
        g.beginPath(); g.rect(x0, y0, x1 - x0, y1 - y0); g.clip();
        g.globalAlpha = 0.14; g.fillStyle = muted; g.fillRect(x0, y0, x1 - x0, y1 - y0);
        g.globalAlpha = 0.45; g.strokeStyle = muted; g.lineWidth = 1;
        g.beginPath();
        for (let s = x0 - (y1 - y0); s < x1; s += 6) { g.moveTo(s, y1); g.lineTo(s + (y1 - y0), y0); }
        g.stroke();
        g.restore();
        g.lineWidth = lw;
        stroke(qs, () => { g.strokeStyle = muted; g.globalAlpha = 0.4; });
      }
    }
    g.globalAlpha = 1;
  }, [d, ghost, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h, display: "block" }}/>;
}

// la fenetre en grand : la couche, un curseur pour parcourir les couches, la legende des filaments
export function LayerExplorer({ status }) {
  const [pick, setPick] = useState(null);           // une couche choisie ; null : celle de l'impression
  const now = status?.layer || null;
  const { d, ghost } = useLayer(true, pick, now);
  const [mode, setMode] = useLayerMode();
  const s3 = useShell(mode === "3d" && d?.ok, d?.print_id);
  const box = useRef(null);
  const [W, setW] = useState(320);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth)); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // le dessin laisse la place au curseur et a la legende sans defiler (02/11/2026 : carre sur toute la largeur, il
  // remplissait la fenetre et les commandes passaient sous le bord)
  const [vh, setVh] = useState(() => window.innerHeight);
  useEffect(() => { const f = () => setVh(window.innerHeight); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  if (d && !d.ok) return <span style={{ fontSize: 13, color: "var(--muted)" }}>Pas de G-code pour cette impression (il vient du 3MF tranché).</span>;
  // la hauteur suit la fenetre (min(640 px, 86 % de l'ecran), 88 % au telephone) ; la largeur prend la place qu'il y a
  // (le dessin s'y centre). 04/11/2026 : calee sur l'ecran (vh - 300), elle laissait le curseur sous le bord de la
  // fenetre ; son en-tete, ses marges, le curseur et la legende prennent pres de 220 px
  const sheet = window.innerWidth < 560 ? vh * 0.88 : Math.min(640, vh * 0.86);
  const size = Math.max(160, Math.min(W, 520, sheet - 220));
  const wide = Math.max(180, Math.min(W, 760));
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div ref={box} style={{ display: "flex", justifyContent: "center", borderRadius: 18, background: "var(--surface2)", border: "1px solid var(--border)", padding: 6 }}>
      {d?.ok ? (mode === "3d" ? <Layer3D s={s3} d={d} now={d.layer} w={wide - 12} h={size - 12}/>
        : <LayerCanvas d={d} ghost={ghost} w={wide - 12} h={size - 12}/>) : <div style={{ height: size - 12 }}/>}
    </div>
    {d?.ok && <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
        <span role="group" aria-label="Vue" style={{ display: "inline-flex", padding: 2, gap: 2, borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)" }}>
          {[["2d", "2D", "La couche seule, vue de dessus"], ["3d", "3D", "Toute l'impression de trois quarts : imprimé en couleur, le reste en fantôme"]].map(([v, l, tip]) =>
            <button key={v} type="button" onClick={() => { setMode(v); if (v === "3d") egg("couche_3d"); }} data-tip={tip} aria-pressed={mode === v}
              style={{ border: "none", borderRadius: 8, padding: "3px 9px", fontSize: 12, fontWeight: 900, cursor: "pointer",
                background: mode === v ? "#8B5CF6" : "transparent", color: mode === v ? "#fff" : "var(--text2)" }}>{l}</button>)}
        </span>
        <span style={{ whiteSpace: "nowrap" }}>Couche {d.layer} / {d.last}</span>
        <input type="range" min={d.first} max={d.last} value={pick ?? d.layer} onChange={e => setPick(Number(e.target.value))}
          aria-label="Choisir la couche" style={{ flex: 1, accentColor: "#8B5CF6" }}/>
        {pick != null && <button type="button" onClick={() => setPick(null)} style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)",
          borderRadius: 10, padding: "4px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>● En cours</button>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, color: "var(--text2)" }}>
        {Object.entries(d.colors || {}).map(([t, c]) => <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: c, border: "1px solid rgba(0,0,0,.2)" }}/>{d.names?.[t] || `Filament ${Number(t) + 1}`}</span>)}
        {ghost && mode !== "3d" && <span style={{ color: "var(--muted)" }}>· en gris : la couche d'avant</span>}
        {mode === "3d" && <span style={{ color: "var(--muted)" }}>· en couleur : imprimé ; en fantôme : à venir · glisse pour tourner</span>}
        {Object.entries(d.skipped || {}).map(([o, x]) => <span key={o} data-tip="Annulée pendant l'impression : ce qu'elle n'a pas imprimé revient aux bobines à la fin"
          style={{ display: "inline-flex", alignItems: "center", gap: 5, color: "var(--muted)" }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, border: "1px solid var(--muted)",
            background: "repeating-linear-gradient(45deg, var(--muted) 0 1.5px, transparent 1.5px 5px)", opacity: 0.7 }}/>
          {x.name || `Pièce ${o}`} : annulée à la couche {x.layer}</span>)}
      </div>
    </>}
  </div>;
}
