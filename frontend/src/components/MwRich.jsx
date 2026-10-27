import React from "react";
import MwImg from "./MwImg";

// Un descriptif MakerWorld (modele ou profil) : du texte, avec les reperes poses par le serveur (27/10/2026) :
// [[img:URL]] et [[video:URL]] sur leur ligne, [[h:titre]], [[a:URL|texte]] dans le texte. Aucun HTML d'origine
// n'est rendu : seulement ces reperes, et seulement vers des adresses http(s).
const SAFE = /^https?:\/\/[^\s"'<>]+$/;
const LINK = /\[\[a:([^|\]]+)\|([^\]]*)\]\]/g;
const MODEL = /makerworld\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?models\/(\d+)/i;

export const richImages = text => [...String(text || "").matchAll(/\[\[img:([^\]]+)\]\]/g)].map(m => m[1]).filter(u => SAFE.test(u));

// une video YouTube integree : sa page (l'appli ne charge pas de lecteur tiers)
const videoPage = u => {
  const yt = u.match(/youtube(?:-nocookie)?\.com\/embed\/([\w-]+)/);
  return yt ? `https://www.youtube.com/watch?v=${yt[1]}` : u;
};

function Inline({ line, onModel }) {
  const out = [];
  let last = 0, k = 0;
  for (const m of line.matchAll(LINK)) {
    if (m.index > last) out.push(line.slice(last, m.index));
    const [, url, label] = m;
    if (SAFE.test(url)) {
      const did = url.match(MODEL)?.[1];
      out.push(<a key={k++} href={url} target="_blank" rel="noopener noreferrer"
        onClick={did && onModel ? e => { e.preventDefault(); onModel(did); } : undefined}
        data-tip={did && onModel ? "Ouvrir ce modèle" : url}
        style={{ color: "#3b82f6", fontWeight: 600, wordBreak: "break-word" }}>{did && onModel ? "🌐 " : ""}{label || url}</a>);
    } else out.push(label);
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export default function MwRich({ text, onImage, onModel }) {
  const lines = String(text || "").split("\n");
  const imgs = richImages(text);
  return lines.map((line, i) => {
    const t = line.trim();
    const img = t.match(/^\[\[img:([^\]]+)\]\]$/);
    if (img && SAFE.test(img[1])) {
      return <MwImg key={i} src={img[1]} w={700} alt="" onClick={() => onImage?.(imgs, imgs.indexOf(img[1]))}
        style={{ display: "block", maxWidth: "min(100%, 520px)", maxHeight: 480, objectFit: "contain", height: "auto", borderRadius: 12, margin: "6px 0", cursor: onImage ? "zoom-in" : "default",
          border: "1px solid var(--border)" }}/>;
    }
    const vid = t.match(/^\[\[video:([^\]]+)\]\]$/);
    if (vid && SAFE.test(vid[1])) {
      return <a key={i} href={videoPage(vid[1])} target="_blank" rel="noopener noreferrer" style={{ display: "flex", width: "fit-content", alignItems: "center", gap: 6,
        margin: "4px 0", padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: 800, textDecoration: "none", color: "#fff",
        background: "linear-gradient(135deg, #EF4444, #F97316)" }}>▶ Voir la vidéo</a>;
    }
    const h = t.match(/^\[\[h:([^\]]*)\]\]$/);
    if (h) {
      return <div key={i} style={{ fontWeight: 900, fontSize: "1.05em", margin: "8px 0 2px", background: "linear-gradient(135deg, #8B5CF6, #3B82F6)",
        WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{h[1]}</div>;
    }
    return <React.Fragment key={i}><Inline line={line} onModel={onModel}/>{i < lines.length - 1 ? "\n" : null}</React.Fragment>;
  });
}
