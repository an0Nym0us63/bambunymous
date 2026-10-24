import React, { useEffect, useRef, useState } from "react";

// Menu contextuel commun : appui long (telephone) ou clic droit (ordinateur).
//
//   const [press, guard] = useLongPress(e => openMenu(e, { title, items }));
//   <div {...press} onClick={guard(ouvrir)} style={{ ...NO_CALLOUT, … }}>…</div>
//
// items : [{ icon, label, onClick, danger, disabled, hint }] ; null/false ignores ;
// "-" pose un separateur. Telephone : feuille en bas ; ordinateur : menu au pointeur.

let _open = null;

export function openMenu(e, menu) {
  const items = (menu.items || []).filter(Boolean);
  if (!items.some(i => i !== "-") || !_open) return;
  const p = e && "clientX" in e ? { x: e.clientX, y: e.clientY } : null;
  _open({ ...menu, items, at: p });
}

const LONG_MS = 480;
// Empeche la loupe / selection de texte d'iOS pendant l'appui long.
export const NO_CALLOUT = { WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" };

// onTouch : ce que fait l'appui long au doigt quand il differe du clic droit
// (ex. l'historique : appui long = selection, clic droit = menu).
export function useLongPress(onLong, { disabled = false, onTouch = null } = {}) {
  const t = useRef(null);
  const start = useRef(null);
  const fired = useRef(false);
  const cb = useRef(onLong);
  cb.current = onLong;
  const touch = useRef(onTouch);
  touch.current = onTouch;
  const clear = () => { if (t.current) clearTimeout(t.current); t.current = null; };
  useEffect(() => clear, []);

  const props = {
    onPointerDown: e => {
      if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
      fired.current = false;
      start.current = { x: e.clientX, y: e.clientY };
      const ev = { clientX: e.clientX, clientY: e.clientY };
      clear();
      // A la souris, le clic droit suffit : l'appui long reste pour le tactile et le stylet.
      if (e.pointerType === "mouse") return;
      t.current = setTimeout(() => {
        fired.current = true;
        if (navigator.vibrate) navigator.vibrate(15);
        (touch.current || cb.current)?.(ev);
      }, LONG_MS);
    },
    onPointerMove: e => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clear();
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    onContextMenu: e => {
      e.preventDefault();
      if (disabled) return;
      // Sur tactile, le navigateur envoie aussi « contextmenu » a l'appui long : deja traite.
      if (fired.current || t.current) return;
      e.stopPropagation();
      fired.current = true;
      cb.current?.(e);
      setTimeout(() => { fired.current = false; }, 0);
    },
  };
  // Le clic qui suit un appui long ne doit pas ouvrir l'element.
  const guard = fn => (...a) => {
    if (fired.current) { fired.current = false; return; }
    fn?.(...a);
  };
  return [props, guard];
}

export function ContextMenuHost() {
  const [menu, setMenu] = useState(null);
  const box = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => { _open = m => { setPos(null); setMenu(m); }; return () => { _open = null; }; }, []);
  useEffect(() => {
    if (!menu) return;
    const k = e => e.key === "Escape" && setMenu(null);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [menu]);
  const sheet = !menu?.at || window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 640;
  // Au pointeur : on recale le menu dans l'ecran une fois sa taille connue.
  useEffect(() => {
    if (!menu || sheet || !box.current) return;
    const r = box.current.getBoundingClientRect();
    setPos({ left: Math.max(8, Math.min(menu.at.x, window.innerWidth - r.width - 8)),
             top: Math.max(8, Math.min(menu.at.y, window.innerHeight - r.height - 8)) });
  }, [menu, sheet]);
  if (!menu) return null;
  const close = () => setMenu(null);
  const run = it => { if (it.disabled) return; close(); it.onClick?.(); };

  // Les actions en groupes (le « - » les separe), chaque groupe dans une carte arrondie ; chaque action a son
  // pictogramme dans une pastille de sa teinte (it.tone ; rouge pour une action dangereuse). 25/10/2026.
  const accent = menu.color || "#6366F1";
  const groups = [];
  for (const it of menu.items) { if (it === "-") { if (groups.length && groups[groups.length - 1].length) groups.push([]); } else { if (!groups.length) groups.push([]); groups[groups.length - 1].push(it); } }
  const item = (it, i, last) => {
    const tone = it.danger ? "#ef4444" : it.tone || "#64748B";
    return (
      <button key={i} onClick={() => run(it)} disabled={it.disabled}
        style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", border: "none",
          background: "none", cursor: it.disabled ? "default" : "pointer", font: "inherit",
          padding: sheet ? "10px 12px" : "7px 9px", color: it.danger ? "#ef4444" : "var(--text)", opacity: it.disabled ? 0.45 : 1,
          borderBottom: last ? "none" : "1px solid color-mix(in srgb, var(--border) 70%, transparent)" }}
        onMouseEnter={e => { if (!it.disabled) e.currentTarget.style.background = `color-mix(in srgb, ${tone} 9%, transparent)`; }}
        onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
        {it.img ? <img src={it.img} alt="" style={{ width: 44, height: 44, borderRadius: 10, objectFit: "cover", flexShrink: 0,
          background: "var(--surface2)", border: "1px solid var(--border)" }}/>
          : <span style={{ width: sheet ? 34 : 28, height: sheet ? 34 : 28, borderRadius: sheet ? 10 : 8, flexShrink: 0, display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: sheet ? 16 : 14, color: tone, background: `color-mix(in srgb, ${tone} 16%, transparent)` }}>{it.icon || "•"}</span>}
        <span style={{ flex: 1, minWidth: 0, fontSize: sheet ? 14.5 : 13, fontWeight: 700 }}>{it.label}
          {it.hint && <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginTop: 1,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{it.hint}</span>}
        </span>
      </button>);
  };
  const list = groups.filter(g => g.length).map((g, gi) => (
    <div key={gi} style={{ borderRadius: sheet ? 16 : 11, overflow: "hidden", background: sheet ? "var(--surface2)" : "transparent",
      border: sheet ? "1px solid var(--border)" : "none", marginTop: gi ? (sheet ? 10 : 4) : 0,
      borderTop: !sheet && gi ? "1px solid var(--border)" : undefined, paddingTop: !sheet && gi ? 4 : 0 }}>
      {g.map((it, i) => item(it, `${gi}-${i}`, i === g.length - 1))}
    </div>));
  const head = (menu.title || menu.subtitle) && (
    <div style={{ padding: sheet ? "12px 14px" : "6px 9px 8px", marginBottom: sheet ? 10 : 4, borderRadius: sheet ? 16 : 0,
      display: "flex", alignItems: "center", gap: 12, position: "relative", overflow: "hidden",
      background: sheet ? `linear-gradient(135deg, color-mix(in srgb, ${accent} 22%, transparent), transparent 70%)` : "none",
      borderBottom: sheet ? "none" : "1px solid var(--border)" }}>
      {menu.img && <img src={menu.img} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover", flexShrink: 0,
        background: "var(--surface2)", border: "1px solid var(--border)" }}/>}
      <div style={{ minWidth: 0 }}>
        {menu.title && <div style={{ fontSize: sheet ? 16 : 12.5, fontWeight: 900, color: "var(--text)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{menu.title}</div>}
        {menu.subtitle && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginTop: 1 }}>{menu.subtitle}</div>}
      </div>
    </div>
  );

  return (
    <div data-no-pull="" onClick={close} onContextMenu={e => { e.preventDefault(); close(); }}
      style={{ position: "fixed", inset: 0, zIndex: 8500, background: sheet ? "rgba(2,6,23,0.5)" : "transparent",
        backdropFilter: sheet ? "blur(4px)" : "none", display: sheet ? "flex" : "block", alignItems: "flex-end", justifyContent: "center" }}>
      {sheet ? (
        <div onClick={e => e.stopPropagation()}
          style={{ width: "100%", maxWidth: 520, borderRadius: "26px 26px 0 0", padding: "8px 12px",
            paddingBottom: "calc(12px + env(safe-area-inset-bottom, 0px))", border: "1px solid var(--border)", background: "var(--sheet-bg)",
            boxShadow: "0 -20px 60px rgba(0,0,0,0.35)", animation: "cmUp 0.2s cubic-bezier(.2,.8,.2,1)", maxHeight: "82vh", overflowY: "auto" }}>
          <div style={{ width: 42, height: 4, borderRadius: 4, background: "var(--border)", margin: "2px auto 10px" }}/>
          {head}{list}
          <button onClick={close} style={{ width: "100%", marginTop: 10, padding: 13, borderRadius: 14,
            border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)",
            fontSize: 14.5, fontWeight: 800, cursor: "pointer" }}>Annuler</button>
        </div>
      ) : (
        <div ref={box} onClick={e => e.stopPropagation()}
          style={{ position: "fixed", left: pos?.left ?? menu.at.x, top: pos?.top ?? menu.at.y,
            visibility: pos ? "visible" : "hidden", minWidth: 230, maxWidth: 320, padding: 5, borderRadius: 14,
            border: "1px solid var(--border)", background: "var(--sheet-bg)", boxShadow: "0 16px 40px rgba(0,0,0,0.35)" }}>
          {head}{list}
        </div>
      )}
      <style>{"@keyframes cmUp{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}"}</style>
    </div>
  );
}

// Element qui ouvre un menu a l'appui long / clic droit. `menu` est une fonction
// (evaluee a l'ouverture) qui rend { title, subtitle, items }.
// `onLong` remplace le menu quand l'element a deja le sien (bouton ⋯…).
export function Pressable({ as: Tag = "div", menu, onLong, onClick, style, disabled, ...rest }) {
  const [press, guard] = useLongPress(e => (onLong ? onLong(e) : openMenu(e, menu())), { disabled: disabled || !(menu || onLong) });
  // Les gestionnaires de l'appelant (prechargement au toucher…) passent aussi.
  const both = {};
  for (const k of Object.keys(press)) {
    const mine = rest[k];
    both[k] = mine ? e => { mine(e); press[k](e); } : press[k];
  }
  return <Tag {...rest} {...both} onClick={guard(onClick)} style={{ ...NO_CALLOUT, ...style }}/>;
}
