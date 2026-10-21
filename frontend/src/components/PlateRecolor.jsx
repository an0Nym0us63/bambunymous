import React, { useEffect, useRef, useState } from "react";
import MwImg from "./MwImg";

// Vignette de plateau repeinte aux couleurs des filaments choisis (aperçu). On lit
// les pixels (image relayee par notre serveur, MakerWorld n'autorise pas la lecture
// directe) ; chaque pixel va a la couleur d'origine la plus proche et prend la couleur
// choisie en gardant son ombrage, la reference etant la clarte de l'objet sur le rendu
// (MakerWorld rend parfois un objet gris en blanc). Un toucher sur 🎨 montre l'original.

const rgbOf = h => {
  const s = String(h || "").replace("#", "");
  if (!/^[0-9a-f]{6}/i.test(s)) return null;
  return [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
};
const lumOf = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
// sRGB -> Lab (D65), pour comparer des couleurs comme l'oeil
const lab = ([r, g, b]) => {
  const f = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722,
    z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = v => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))];
};
const near = (a, b) => { const A = lab(a), B = lab(b); return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]) < 6; };

// Ombrage garde : une luminance L de l'image va au noir (0), a la couleur choisie
// (L de la couleur d'origine), puis au blanc (1).
const tone = (L, Ls, to) => {
  if (L <= Ls) { const t = Ls > 0 ? L / Ls : 0; return to.map(c => c * t); }
  const t = Ls < 1 ? (L - Ls) / (1 - Ls) : 0;
  return to.map(c => c + (255 - c) * t);
};

const CACHE = new Map();   // cle -> { url, absent } (plusieurs couleurs)
// Une vignette a la fois, en arriere-plan : la fiche s'ouvre d'abord.
let QUEUE = Promise.resolve();
const queued = fn => { const p = QUEUE.then(fn, fn); QUEUE = p.catch(() => {}); return p; };
const breath = () => new Promise(res => setTimeout(res, 0));
const idle = () => new Promise(res => (window.requestIdleCallback ? window.requestIdleCallback(() => res(), { timeout: 600 })
  : setTimeout(res, 250)));

async function paint(src, pairs) {
  const key = src + "|" + pairs.map(p => p.from + ">" + p.to).join(",");
  if (CACHE.has(key)) return CACHE.get(key);
  // Une simple image de la meme adresse (lisible pixel par pixel) : l'appli Android
  // abime les reponses binaires lues par requete.
  const tok = (() => { try { return localStorage.getItem("token") || ""; } catch { return ""; } })();
  // Chargement COMPLET avant de lire les pixels : sur l'appli Android, decode() rend
  // parfois la main sur une image encore partielle (seul le haut etait repeint).
  const load = () => new Promise((ok, ko) => {
    const im = new Image();
    im.onload = () => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(() => ok(im));
    im.onerror = () => ko(new Error("image illisible"));
    im.src = `/api/v1/makerworld/img?u=${encodeURIComponent(src)}&_t=${encodeURIComponent(tok)}`;
  });
  let bmp, cv, cx, W, H;
  for (let tries = 0; tries < 3; tries++) {
    bmp = await load();
    const w0 = bmp.naturalWidth || bmp.width, h0 = bmp.naturalHeight || bmp.height;
    const k = Math.min(1, 480 / Math.max(w0, h0));
    W = Math.max(1, Math.round(w0 * k)); H = Math.max(1, Math.round(h0 * k));
    cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    cx = cv.getContext("2d", { willReadFrequently: true });
    cx.drawImage(bmp, 0, 0, W, H);
    // l'image est-elle vraiment la ? (des pixels opaques en bas aussi, pas seulement en haut)
    const low = cx.getImageData(0, Math.floor(H / 2), W, H - Math.floor(H / 2)).data;
    let seen = 0;
    for (let i = 3; i < low.length; i += 16) if (low[i] > 8) { seen++; if (seen > 20) break; }
    if (seen > 20) break;
    await new Promise(r => setTimeout(r, 400));
  }
  const img = cx.getImageData(0, 0, W, H), px = img.data;
  const src3 = pairs.map(p => { const c = rgbOf(p.from); return { c, L: lumOf(c), lab: lab(c), to: rgbOf(p.to) }; });
  // 1) chaque pixel va a la couleur d'origine la plus proche (la clarte comptant peu :
  //    l'ombrage la fait varier) ; on note la clarte de chaque groupe
  const cls = new Int8Array(px.length / 4).fill(-1);
  const hist = src3.map(() => new Uint32Array(256));
  const memo = new Map();
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    if (i && i % 160000 === 0) await breath();     // par tranches : l'interface reste fluide
    if (px[i + 3] < 8) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const q = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    let c = memo.get(q);
    if (c === undefined) {
      c = 0;
      if (src3.length > 1) {
        const P = lab([r, g, b]);
        let bd = Infinity;
        src3.forEach((s, k) => {
          const d = 0.25 * (P[0] - s.lab[0]) ** 2 + (P[1] - s.lab[1]) ** 2 + (P[2] - s.lab[2]) ** 2;
          if (d < bd) { bd = d; c = k; }
        });
      }
      memo.set(q, c);
    }
    cls[j] = c;
    hist[c][Math.round(lumOf([r, g, b]) * 255)]++;
  }
  // 2) la clarte de reference d'un groupe est celle de l'objet SUR LE RENDU (sa mediane),
  //    pas celle du filament : MakerWorld rend parfois en blanc un objet gris (coques)
  const count = hist.map(h => h.reduce((a, b) => a + b, 0));
  const total = count.reduce((a, b) => a + b, 0);
  const med = hist.map((h, k) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) { acc += h[v]; if (acc * 2 >= count[k]) return Math.max(0.03, v / 255); }   // un rendu tout blanc : 1, le blanc devient la couleur
    return src3[k].L;
  });
  const memo2 = new Map();
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    if (i && i % 160000 === 0) await breath();
    const c = cls[j];
    if (c < 0) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const q = ((r >> 2) << 12 | (g >> 2) << 6 | (b >> 2)) * 16 + c;
    let out = memo2.get(q);
    if (!out) { out = tone(lumOf([r, g, b]), med[c], src3[c].to); memo2.set(q, out); }
    px[i] = out[0]; px[i + 1] = out[1]; px[i + 2] = out[2];
  }
  cx.putImageData(img, 0, 0);
  // MakerWorld ne rend pas toujours toutes les couleurs d'un plateau (un rendu tout
  // noir pour un plateau noir et rose) : ce qui n'apparait pas ne peut pas changer.
  const absent = src3.length > 1 ? pairs.filter((p, j) => count[j] < Math.max(30, total * 0.004)).map(p => p.from) : [];
  const blob = await new Promise(res => cv.toBlob(res, "image/png"));
  const res = { url: blob ? URL.createObjectURL(blob) : cv.toDataURL("image/png"), absent };
  CACHE.set(key, res);
  return res;
}

export default function PlateRecolor({ src, map, w = 200, style }) {
  const pairs = (map || []).filter(p => rgbOf(p.from) && rgbOf(p.to));
  const active = pairs.some(p => !near(rgbOf(p.from), rgbOf(p.to)));
  const [orig, setOrig] = useState(false);
  const [url, setUrl] = useState(null);
  const [absent, setAbsent] = useState([]);
  const [fail, setFail] = useState(null);
  const multi = active;            // une ou plusieurs couleurs : repeinte d'apres les pixels du rendu
  const sig = pairs.map(p => p.from + ">" + p.to).join(",");
  // repeinte seulement une fois la vignette a l'ecran, quand le navigateur souffle
  const box = useRef(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !multi || !box.current) return undefined;
    if (!window.IntersectionObserver) { setSeen(true); return undefined; }
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { setSeen(true); io.disconnect(); } },
      { rootMargin: "200px" });
    io.observe(box.current);
    return () => io.disconnect();
  }, [multi, seen]);
  useEffect(() => {
    setUrl(null); setAbsent([]); setFail(null);
    if (!multi || !seen) return undefined;
    let live = true;
    const key = src + "|" + sig;
    const hit = CACHE.get(key);
    if (hit) { setUrl(hit.url); setAbsent(hit.absent); return undefined; }
    queued(async () => { if (!live) return null; await idle(); return live ? paint(src, pairs) : null; })
      .then(res => { if (live && res) { setUrl(res.url); setAbsent(res.absent); } })
      .catch(e => { if (live) setFail(e?.response?.status ? `${e.response.status}` : (e?.message || "erreur")); });
    return () => { live = false; };
  }, [src, sig, multi, seen]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!active) return <MwImg src={src} w={w} style={style}/>;
  const lost = pairs.filter(p => absent.includes(p.from) && !near(rgbOf(p.from), rgbOf(p.to)));
  const toggle = (
    <button type="button" onClick={e => { e.stopPropagation(); setOrig(o => !o); }}
      title={orig ? "Voir aux couleurs choisies" : "Voir l'original"} aria-label={orig ? "Voir aux couleurs choisies" : "Voir l'original"}
      style={{ position:"absolute", right:4, bottom:4, zIndex:1, width:24, height:24, borderRadius:"50%", padding:0, cursor:"pointer",
        border:"1.5px solid white", background: orig ? "rgba(0,0,0,0.45)" : "linear-gradient(135deg,#f472b6,#60a5fa,#34d399)",
        fontSize:12, lineHeight:"20px", boxShadow:"0 1px 4px rgba(0,0,0,.3)" }}>{orig ? "↺" : "🎨"}</button>
  );
  // en attendant la version repeinte (ou pour voir l'original) : la vignette telle quelle
  const body = orig || !url ? <MwImg src={src} w={w} style={style}/> : <img src={url} alt="" style={style}/>;
  return (
    <div ref={box} style={{ position:"relative" }}>{body}{toggle}
      {!orig && fail && (
        <span title={`L'image n'a pas pu être lue pour être repeinte (${fail})`}
          style={{ position:"absolute", left:4, bottom:4, zIndex:1, padding:"1px 6px", borderRadius:10,
            background:"rgba(0,0,0,0.6)", color:"#fca5a5", fontSize:9, fontWeight:800 }}>aperçu impossible · {fail}</span>
      )}
      {!orig && lost.length > 0 && (
        <span title="MakerWorld n'a pas rendu cette couleur sur la vignette : elle ne peut pas y changer"
          style={{ position:"absolute", left:4, bottom:4, zIndex:1, display:"flex", alignItems:"center", gap:3, padding:"1px 6px 1px 3px",
            borderRadius:10, background:"rgba(0,0,0,0.6)", color:"#fde68a", fontSize:9, fontWeight:800 }}>
          {lost.map(p => <span key={p.from} style={{ width:9, height:9, borderRadius:"50%", background:p.from,
            border:"1px solid rgba(255,255,255,.6)" }}/>)}
          absent de l'image</span>
      )}
    </div>
  );
}
