import { useEffect, useRef, useState } from "react";

// Le zoom d'une image en grand (08/11/2026, mis en commun le 09/11 pour la camera) : pincer a deux doigts sur telephone,
// la molette sur ordinateur (vers le curseur), un double appui ou double clic pour zoomer / revenir ; zoomee, un doigt ou
// la souris la deplace. active = false la remet a sa taille. Rend { z, zoomed, gesture, bind } : bind va sur l'element
// (ref et gestes), z sur sa transformation.
export function usePinchZoom(active = true, max = 6) {
  const ref = useRef(null);
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 });
  const zr = useRef(z);
  zr.current = z;
  const g = useRef(null), tap = useRef(0);
  const zoomed = z.s > 1.01;
  useEffect(() => { if (!active) setZ({ s: 1, x: 0, y: 0 }); }, [active]);
  const clamp = (s, x, y) => {
    const el = ref.current;
    if (!el || s <= 1.01) return { s: 1, x: 0, y: 0 };
    const mx = (s - 1) * el.clientWidth / 2, my = (s - 1) * el.clientHeight / 2;
    return { s, x: Math.max(-mx, Math.min(mx, x)), y: Math.max(-my, Math.min(my, y)) };
  };
  // zoomer vers un point de l'ecran : ce point reste sous le doigt ou le curseur
  const at = (cx, cy, s2) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect(), { s, x, y } = zr.current;
    const px = cx - (r.left + r.width / 2 - x), py = cy - (r.top + r.height / 2 - y);
    s2 = Math.max(1, Math.min(max, s2));
    setZ(clamp(s2, px - (px - x) * (s2 / s), py - (py - y) * (s2 / s)));
  };
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return undefined;
    const wheel = e => { e.preventDefault(); at(e.clientX, e.clientY, zr.current.s * Math.exp(-e.deltaY * 0.0018)); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = t => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  const toggle = (cx, cy) => zr.current.s > 1.01 ? setZ({ s: 1, x: 0, y: 0 }) : at(cx, cy, 2.5);
  // la souris : glisser pour deplacer une image zoomee
  const down = e => {
    if (e.button !== 0 || zr.current.s <= 1.01) return;
    e.preventDefault();
    const x0 = e.clientX, y0 = e.clientY, tx = zr.current.x, ty = zr.current.y;
    const move = ev => setZ(clamp(zr.current.s, tx + ev.clientX - x0, ty + ev.clientY - y0));
    const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
    window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
  };
  const bind = {
    ref,
    onTouchStart: e => {
      const t = e.touches;
      if (t.length === 2) g.current = { k: "pinch", d0: dist(t), s0: zr.current.s };
      else if (t.length === 1 && zr.current.s > 1.01) g.current = { k: "pan", x0: t[0].clientX, y0: t[0].clientY, tx: zr.current.x, ty: zr.current.y };
      else g.current = null;
    },
    onTouchMove: e => {
      const t = e.touches, q = g.current;
      if (!q) return;
      if (q.k === "pinch" && t.length === 2) { const m = mid(t); at(m.x, m.y, q.s0 * dist(t) / q.d0); }
      else if (q.k === "pan" && t.length === 1) setZ(clamp(zr.current.s, q.tx + t[0].clientX - q.x0, q.ty + t[0].clientY - q.y0));
    },
    onTouchEnd: e => {
      if (e.touches.length === 0 && e.changedTouches.length === 1 && g.current?.k !== "pinch") {
        const now = Date.now(), c = e.changedTouches[0];
        if (now - tap.current < 300) { toggle(c.clientX, c.clientY); tap.current = 0; } else tap.current = now;
      }
      if (e.touches.length < 2 && g.current?.k === "pinch") g.current = null;
    },
    onMouseDown: down,
    onDoubleClick: e => { e.stopPropagation(); toggle(e.clientX, e.clientY); },
  };
  return { z, zoomed, gesture: !!g.current, bind };
}
