import React, { useState } from "react";

// Images MakerWorld reduites par leur CDN : une couverture PNG de 4 Mo devient
// une vignette WebP de ~15 Ko a la taille affichee (x2 pour les ecrans fins).
// Si le CDN refusait la reduction, on retombe sur l'image d'origine.
// Une couverture animee (GIF) devient une image fixe (1re image) dans les
// vignettes : des dizaines d'animations decodees en meme temps faisaient
// saccader le defilement. Avec `animate` (galerie de la fiche, commentaires,
// plein ecran), le GIF est servi tel quel : la conversion WebP du CDN le figeait.
export const isVideo = url => typeof url === "string" && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url);

export function mwImg(url, w, animate = false) {
  if (!url || typeof url !== "string") return url;
  try {
    const u = new URL(url);
    if (!/(^|\.)bblmw\.com$/.test(u.hostname) || u.search) return url;
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const px = Math.min(1600, Math.round(w * dpr));
    const gif = /\.gif$/i.test(u.pathname);
    if (gif && animate) return url;
    const still = w <= 400 && gif;
    return `${url}?x-oss-process=image/resize,w_${px}/format,${still ? "jpg" : "webp"}`;
  } catch { return url; }
}

// <img> qui apparait en fondu une fois chargee (pas de saut ni de flash).
export default function MwImg({ src, w = 300, style, eager = false, animate = false, ...rest }) {
  const [ok, setOk] = useState(false);
  if (!src) return null;
  // une video (MakerWorld en glisse parfois parmi les images) : lue en boucle, muette
  if (isVideo(src)) return (
    <video src={src} autoPlay muted loop playsInline preload="metadata" onLoadedData={() => setOk(true)}
      style={{ ...style, opacity: ok ? 1 : 0, transition: "opacity .25s ease" }} {...rest}/>
  );
  return (
    <img src={mwImg(src, w, animate)} alt="" loading={eager ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer"
      onLoad={() => setOk(true)}
      onError={e => { if (e.currentTarget.src !== src) e.currentTarget.src = src; else setOk(true); }}
      style={{ ...style, opacity: ok ? 1 : 0, transition: "opacity .25s ease" }} {...rest}/>
  );
}
