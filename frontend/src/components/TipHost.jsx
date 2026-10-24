import { useEffect, useLayoutEffect, useRef, useState } from "react";

// Les infobulles de l'appli (24/10/2026) : toute bulle « title » du navigateur (petit rectangle
// gris du systeme) est remplacee par la notre, a nos couleurs. Rien a changer dans les pages :
// au survol, le texte du title passe dans data-tip (le navigateur n'a plus rien a montrer) et
// s'affiche ici. Un texte sur plusieurs lignes (\n) : la premiere en gras, comme un titre.
// A la souris seulement (au doigt, le navigateur n'en montre pas non plus).
const DELAY = 350;

export default function TipHost() {
  const [tip, setTip] = useState(null);       // { text, x, y, below }
  const timer = useRef(null);
  const cur = useRef(null);
  const box = useRef(null);
  const [dx, setDx] = useState(0);              // decalage pour rester dans l'ecran (pres d'un bord)

  useEffect(() => {
    const hide = () => { clearTimeout(timer.current); cur.current = null; setTip(null); };
    const over = e => {
      if (e.pointerType && e.pointerType !== "mouse") return;
      const el = e.target?.closest?.("[title], [data-tip]");
      if (!el || el === cur.current) return;
      // le texte : celui du title (que l'on retire, pour que le navigateur ne montre pas le sien)
      const t = el.getAttribute("title");
      if (t != null) { el.setAttribute("data-tip", t); el.removeAttribute("title"); }
      const text = (el.getAttribute("data-tip") || "").trim();
      clearTimeout(timer.current);
      cur.current = el;
      if (!text) { setTip(null); return; }
      timer.current = setTimeout(() => {
        if (cur.current !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        const below = r.top < 90;
        setTip({ text, x: r.left + r.width / 2, y: below ? r.bottom + 8 : r.top - 8, below });
      }, DELAY);
    };
    const out = e => {
      const el = cur.current;
      if (!el) return;
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      hide();
    };
    document.addEventListener("pointerover", over, true);
    document.addEventListener("pointerout", out, true);
    document.addEventListener("pointerdown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      document.removeEventListener("pointerover", over, true);
      document.removeEventListener("pointerout", out, true);
      document.removeEventListener("pointerdown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
      clearTimeout(timer.current);
    };
  }, []);

  useLayoutEffect(() => {
    if (!tip || !box.current) { setDx(0); return; }
    const r = box.current.getBoundingClientRect(), m = 8;
    const left = r.left - dx;
    setDx(left < m ? m - left : left + r.width > window.innerWidth - m ? window.innerWidth - m - (left + r.width) : 0);
  }, [tip]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tip) return null;
  const [head, ...rest] = tip.text.split("\n");
  return (
    <div ref={box} role="tooltip" style={{ position: "fixed", left: tip.x + dx, top: tip.y, zIndex: 10000, pointerEvents: "none",
      transform: `translate(-50%, ${tip.below ? "0" : "-100%"})`, maxWidth: "min(300px, calc(100vw - 24px))",
      padding: "7px 10px", borderRadius: 10, background: "rgba(15,23,42,0.94)", color: "#f8fafc",
      border: "1px solid rgba(255,255,255,0.12)", boxShadow: "0 10px 28px rgba(0,0,0,0.35)", backdropFilter: "blur(6px)",
      fontSize: 12, lineHeight: 1.45, fontWeight: 600, animation: "bnTipIn .12s ease-out" }}>
      <style>{"@keyframes bnTipIn{from{opacity:0;transform:translate(-50%," + (tip.below ? "-4px" : "calc(-100% + 4px)") + ")}}"}</style>
      <div style={{ fontWeight: rest.length ? 800 : 600 }}>{head}</div>
      {rest.length > 0 && <div style={{ marginTop: 2, color: "#cbd5e1", fontWeight: 500, whiteSpace: "pre-line" }}>{rest.join("\n")}</div>}
    </div>
  );
}
