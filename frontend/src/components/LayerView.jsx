import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";

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
    g.lineWidth = lw;
    stroke(d.paths, q => { g.strokeStyle = col(q.t); g.globalAlpha = 1; });
    g.globalAlpha = 1;
  }, [d, ghost, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h, display: "block" }}/>;
}

// la fenetre en grand : la couche, un curseur pour parcourir les couches, la legende des filaments
export function LayerExplorer({ status }) {
  const [pick, setPick] = useState(null);           // une couche choisie ; null : celle de l'impression
  const now = status?.layer || null;
  const { d, ghost } = useLayer(true, pick, now);
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
  // la hauteur suit l'ecran ; la largeur prend la place qu'il y a (le dessin s'y centre)
  const size = Math.max(180, Math.min(W, 560, vh - 300));
  const wide = Math.max(180, Math.min(W, 760));
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <div ref={box} style={{ display: "flex", justifyContent: "center", borderRadius: 18, background: "var(--surface2)", border: "1px solid var(--border)", padding: 6 }}>
      {d?.ok ? <LayerCanvas d={d} ghost={ghost} w={wide - 12} h={size - 12}/> : <div style={{ height: size - 12 }}/>}
    </div>
    {d?.ok && <>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 800, color: "var(--text)" }}>
        <span style={{ whiteSpace: "nowrap" }}>Couche {d.layer} / {d.last}</span>
        <input type="range" min={d.first} max={d.last} value={pick ?? d.layer} onChange={e => setPick(Number(e.target.value))}
          aria-label="Choisir la couche" style={{ flex: 1, accentColor: "#8B5CF6" }}/>
        {pick != null && <button type="button" onClick={() => setPick(null)} style={{ border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)",
          borderRadius: 10, padding: "4px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>● En cours</button>}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12, color: "var(--text2)" }}>
        {Object.entries(d.colors || {}).map(([t, c]) => <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 12, height: 12, borderRadius: "50%", background: c, border: "1px solid rgba(0,0,0,.2)" }}/>Filament {Number(t) + 1}</span>)}
        {ghost && <span style={{ color: "var(--muted)" }}>· en gris : la couche d'avant</span>}
      </div>
    </>}
  </div>;
}
