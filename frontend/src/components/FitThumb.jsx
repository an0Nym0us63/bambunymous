import React, { useEffect, useState } from "react";

/**
 * Une vignette cadree sur son sujet (30/10/2026) : les images de MakerWorld et les vues 3D laissent souvent beaucoup de
 * fond autour de l'objet, qui paraissait petit et noye dans sa tuile. Au chargement, l'image est lue en petit (64 px)
 * pour trouver la boite de ce qui n'est pas le fond (la couleur des coins, ou la transparence), puis agrandie pour que
 * l'objet occupe sa case, entier (jamais rogne), centre. Une photo sans fond uni reste entiere, comme avant. Un leger
 * contraste en plus leve le voile des rendus pales.
 * Le calcul est garde par adresse : une tuile qui revient ne relit pas son image.
 */
const fits = new Map();

function measure(img) {
  const N = 64, c = document.createElement("canvas");
  c.width = N; c.height = N;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0, N, N);
  const d = x.getImageData(0, 0, N, N).data;
  const at = (i, j) => (j * N + i) * 4;
  const corners = [at(0, 0), at(N - 1, 0), at(0, N - 1), at(N - 1, N - 1)];
  const alpha = corners.every(k => d[k + 3] < 40);
  const bg = [0, 1, 2].map(ch => corners.reduce((s, k) => s + d[k + ch], 0) / 4);
  // un fond uni : les quatre coins de la meme couleur ; sinon (une photo), rien a recadrer
  if (!alpha && corners.some(k => Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 36)) return null;
  let x0 = N, y0 = N, x1 = -1, y1 = -1;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = at(i, j);
    const on = alpha ? d[k + 3] > 40 : d[k + 3] > 40 && Math.abs(d[k] - bg[0]) + Math.abs(d[k + 1] - bg[1]) + Math.abs(d[k + 2] - bg[2]) > 30;
    if (on) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  }
  if (x1 < 0) return null;
  return [x0 / N, y0 / N, (x1 + 1) / N, (y1 + 1) / N];
}

// la place de l'image (en % de la case) pour que la boite de l'objet, avec un peu d'air, tienne entiere au centre
function placeFor(box, iw, ih, cw, ch) {
  const pad = 0.06, [x0, y0, x1, y1] = box;
  const bw = (x1 - x0) * iw, bh = (y1 - y0) * ih;
  const contain = Math.min(cw / iw, ch / ih);
  // au plus 2,4 fois la taille « entiere » : une vignette de 384 px agrandie davantage deviendrait floue
  const k = Math.min(cw * (1 - 2 * pad) / bw, ch * (1 - 2 * pad) / bh, contain * 2.4);
  if (k <= contain * 1.04) return null;                       // presque rien a gagner : l'image entiere
  const w = iw * k, h = ih * k, cx = (x0 + x1) / 2 * w, cy = (y0 + y1) / 2 * h;
  return { width: `${w / cw * 100}%`, height: `${h / ch * 100}%`, left: `${(cw / 2 - cx) / cw * 100}%`, top: `${(ch / 2 - cy) / ch * 100}%` };
}

// photoFit : une photo (sans fond uni) remplit la case (« cover », les petites cases d'une mosaique) ou y tient entiere
export default function FitThumb({ src, style = {}, onError, photoFit = "contain", ...rest }) {
  const [place, setPlace] = useState(() => fits.get(src)?.place || null);
  useEffect(() => { setPlace(fits.get(src)?.place || null); }, [src]);     // une autre image dans la meme case
  const onLoad = e => {
    const img = e.currentTarget, box = img.parentElement;
    if (!box?.clientWidth || !img.naturalWidth) return;
    let f = fits.get(src);
    if (!f) {
      let m = null;
      try { m = measure(img); } catch { /* image d'un autre site : on la laisse entiere */ }
      f = { m };
      fits.set(src, f);
    }
    const p = f.m && placeFor(f.m, img.naturalWidth, img.naturalHeight, box.clientWidth, box.clientHeight);
    f.place = p;
    setPlace(p);
  };
  const look = { filter: "contrast(1.05) saturate(1.05)" };    // un poil seulement : plus, les couleurs criaient
  return <img src={src} alt="" {...rest} onLoad={onLoad} onError={onError}
    style={place ? { ...style, ...look, position: "absolute", inset: "auto", objectFit: "fill", maxWidth: "none", ...place }
      : { ...style, ...look, objectFit: photoFit }}/>;
}
