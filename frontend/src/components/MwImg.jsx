import React, { useState } from "react";

// Images MakerWorld reduites par leur CDN : une couverture PNG de 4 Mo devient
// une vignette WebP de ~15 Ko a la taille affichee (x2 pour les ecrans fins).
// Si le CDN refusait la reduction, on retombe sur l'image d'origine.
export function mwImg(url, w) {
  if (!url || typeof url !== "string") return url;
  try {
    const u = new URL(url);
    if (!/(^|\.)bblmw\.com$/.test(u.hostname) || u.search) return url;
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const px = Math.min(1600, Math.round(w * dpr));
    return `${url}?x-oss-process=image/resize,w_${px}/format,webp`;
  } catch { return url; }
}

// <img> qui apparait en fondu une fois chargee (pas de saut ni de flash).
export default function MwImg({ src, w = 300, style, eager = false, ...rest }) {
  const [ok, setOk] = useState(false);
  if (!src) return null;
  return (
    <img src={mwImg(src, w)} alt="" loading={eager ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer"
      onLoad={() => setOk(true)}
      onError={e => { if (e.currentTarget.src !== src) e.currentTarget.src = src; else setOk(true); }}
      style={{ ...style, opacity: ok ? 1 : 0, transition: "opacity .25s ease" }} {...rest}/>
  );
}
