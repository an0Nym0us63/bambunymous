import React, { useEffect, useId, useState } from "react";
import client from "../api/client";
import MwImg, { mwImg } from "./MwImg";

// Vignette de plateau repeinte aux couleurs des filaments choisis (aperçu).
// Une seule couleur d'origine : un filtre SVG (niveaux de gris puis teinte), sans
// serveur. Plusieurs : on lit les pixels (image relayee par notre serveur, MakerWorld
// n'autorise pas la lecture directe), chaque pixel va a la couleur d'origine la plus
// proche, et prend la couleur choisie en gardant son ombrage. Un toucher sur 🎨
// montre l'original.

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

async function paint(src, pairs) {
  const key = src + "|" + pairs.map(p => p.from + ">" + p.to).join(",");
  if (CACHE.has(key)) return CACHE.get(key);
  const { data } = await client.get("/makerworld/img", { params: { u: src }, responseType: "blob" });
  const bmp = await createImageBitmap(data);
  const k = Math.min(1, 480 / Math.max(bmp.width, bmp.height));
  const W = Math.max(1, Math.round(bmp.width * k)), H = Math.max(1, Math.round(bmp.height * k));
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, W, H);
  const img = cx.getImageData(0, 0, W, H), px = img.data;
  const src3 = pairs.map(p => { const c = rgbOf(p.from); return { c, L: lumOf(c), lab: lab(c), to: rgbOf(p.to) }; });
  const memo = new Map();
  const count = new Map(src3.map(s => [s, 0]));
  let total = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 8) continue;
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const q = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3);
    let out = memo.get(q);
    if (!out) {
      // la couleur d'origine la plus proche, la clarte comptant peu (l'ombrage la fait varier)
      const P = lab([r, g, b]);
      let best = src3[0], bd = Infinity;
      for (const s of src3) {
        const d = 0.25 * (P[0] - s.lab[0]) ** 2 + (P[1] - s.lab[1]) ** 2 + (P[2] - s.lab[2]) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      out = tone(lumOf([r, g, b]), best.L, best.to);
      out.src = best;
      memo.set(q, out);
    }
    count.set(out.src, count.get(out.src) + 1);
    total++;
    px[i] = out[0]; px[i + 1] = out[1]; px[i + 2] = out[2];
  }
  cx.putImageData(img, 0, 0);
  // MakerWorld ne rend pas toujours toutes les couleurs d'un plateau (un rendu tout
  // noir pour un plateau noir et rose) : ce qui n'apparait pas ne peut pas changer.
  const absent = pairs.filter((p, j) => count.get(src3[j]) < Math.max(30, total * 0.004)).map(p => p.from);
  const res = { url: cv.toDataURL("image/png"), absent };
  CACHE.set(key, res);
  return res;
}

export default function PlateRecolor({ src, map, w = 200, style }) {
  const fid = "pk-tint-" + useId().replace(/[^a-z0-9]/gi, "");
  const pairs = (map || []).filter(p => rgbOf(p.from) && rgbOf(p.to));
  const active = pairs.some(p => !near(rgbOf(p.from), rgbOf(p.to)));
  const [orig, setOrig] = useState(false);
  const [url, setUrl] = useState(null);
  const [absent, setAbsent] = useState([]);
  const [fail, setFail] = useState(null);
  const multi = active && pairs.length > 1;
  const sig = pairs.map(p => p.from + ">" + p.to).join(",");
  useEffect(() => {
    setUrl(null); setAbsent([]); setFail(null);
    if (!multi) return undefined;
    let live = true;
    paint(src, pairs).then(res => { if (live) { setUrl(res.url); setAbsent(res.absent); } })
      .catch(e => { if (live) setFail(e?.response?.status ? `${e.response.status}` : (e?.message || "erreur")); });
    return () => { live = false; };
  }, [src, sig, multi]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!active) return <MwImg src={src} w={w} style={style}/>;
  const lost = pairs.filter(p => absent.includes(p.from) && !near(rgbOf(p.from), rgbOf(p.to)));
  const toggle = (
    <button type="button" onClick={e => { e.stopPropagation(); setOrig(o => !o); }}
      title={orig ? "Voir aux couleurs choisies" : "Voir l'original"} aria-label={orig ? "Voir aux couleurs choisies" : "Voir l'original"}
      style={{ position:"absolute", right:4, bottom:4, zIndex:1, width:24, height:24, borderRadius:"50%", padding:0, cursor:"pointer",
        border:"1.5px solid white", background: orig ? "rgba(0,0,0,0.45)" : "linear-gradient(135deg,#f472b6,#60a5fa,#34d399)",
        fontSize:12, lineHeight:"20px", boxShadow:"0 1px 4px rgba(0,0,0,.3)" }}>{orig ? "↺" : "🎨"}</button>
  );
  let body;
  if (orig || (multi && !url)) body = <MwImg src={src} w={w} style={style}/>;
  else if (multi) body = <img src={url} alt="" style={style}/>;
  else {
    // une couleur : filtre SVG (luminance -> degrade noir / couleur choisie / blanc)
    const from = rgbOf(pairs[0].from), to = rgbOf(pairs[0].to), Ls = lumOf(from);
    const N = 24, ch = j => Array.from({ length: N + 1 }, (_, i) => (tone(i / N, Ls, to)[j] / 255).toFixed(3)).join(" ");
    body = (
      <>
        <svg width="0" height="0" style={{ position:"absolute" }} aria-hidden="true">
          <filter id={fid} colorInterpolationFilters="sRGB">
            <feColorMatrix type="matrix" values="0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0.2126 0.7152 0.0722 0 0  0 0 0 1 0"/>
            <feComponentTransfer>
              <feFuncR type="table" tableValues={ch(0)}/>
              <feFuncG type="table" tableValues={ch(1)}/>
              <feFuncB type="table" tableValues={ch(2)}/>
            </feComponentTransfer>
          </filter>
        </svg>
        <img src={mwImg(src, w)} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer"
          style={{ ...style, filter: `url(#${fid})${style?.filter ? " " + style.filter : ""}` }}/>
      </>
    );
  }
  return (
    <div style={{ position:"relative" }}>{body}{toggle}
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
