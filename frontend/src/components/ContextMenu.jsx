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

export function useLongPress(onLong, { disabled = false } = {}) {
  const t = useRef(null);
  const start = useRef(null);
  const fired = useRef(false);
  const cb = useRef(onLong);
  cb.current = onLong;
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
        cb.current?.(ev);
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

  const list = menu.items.map((it, i) => it === "-" ? (
    <div key={i} style={{ height: 1, background: "var(--border)", margin: "4px 0" }}/>
  ) : (
    <button key={i} onClick={() => run(it)} disabled={it.disabled}
      style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", border: "none",
        background: "none", cursor: it.disabled ? "default" : "pointer", borderRadius: 8,
        padding: sheet ? "12px 12px" : "8px 10px", fontSize: sheet ? 14.5 : 13, fontWeight: 600,
        color: it.danger ? "#ef4444" : "var(--text)", opacity: it.disabled ? 0.45 : 1 }}
      onMouseEnter={e => { if (!it.disabled) e.currentTarget.style.background = "var(--surface2)"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "none"; }}>
      <span style={{ width: 20, textAlign: "center", flexShrink: 0 }}>{it.icon || ""}</span>
      <span style={{ flex: 1, minWidth: 0 }}>{it.label}
        {it.hint && <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--muted)" }}>{it.hint}</span>}
      </span>
    </button>
  ));
  const head = (menu.title || menu.subtitle) && (
    <div style={{ padding: sheet ? "4px 12px 10px" : "4px 10px 6px", borderBottom: "1px solid var(--border)", marginBottom: 4 }}>
      {menu.title && <div style={{ fontSize: sheet ? 14 : 12.5, fontWeight: 800, color: "var(--text)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{menu.title}</div>}
      {menu.subtitle && <div style={{ fontSize: 11, color: "var(--muted)" }}>{menu.subtitle}</div>}
    </div>
  );

  return (
    <div data-no-pull="" onClick={close} onContextMenu={e => { e.preventDefault(); close(); }}
      style={{ position: "fixed", inset: 0, zIndex: 8500, background: sheet ? "rgba(0,0,0,0.5)" : "transparent",
        display: sheet ? "flex" : "block", alignItems: "flex-end", justifyContent: "center" }}>
      {sheet ? (
        <div onClick={e => e.stopPropagation()} className="sheet-panel"
          style={{ width: "100%", maxWidth: 520, borderRadius: "18px 18px 0 0", padding: "8px 8px",
            paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))", border: "1px solid var(--border)",
            animation: "cmUp 0.16s ease", maxHeight: "80vh", overflowY: "auto" }}>
          <div style={{ width: 36, height: 4, borderRadius: 4, background: "var(--border)", margin: "2px auto 8px" }}/>
          {head}{list}
          <button onClick={close} style={{ width: "100%", marginTop: 6, padding: 12, borderRadius: 12,
            border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)",
            fontSize: 14, fontWeight: 700, cursor: "pointer" }}>Annuler</button>
        </div>
      ) : (
        <div ref={box} onClick={e => e.stopPropagation()} className="sheet-panel"
          style={{ position: "fixed", left: pos?.left ?? menu.at.x, top: pos?.top ?? menu.at.y,
            visibility: pos ? "visible" : "hidden", minWidth: 210, maxWidth: 300, padding: 4, borderRadius: 12,
            border: "1px solid var(--border)", boxShadow: "0 12px 36px rgba(0,0,0,0.35)" }}>
          {head}{list}
        </div>
      )}
      <style>{"@keyframes cmUp{from{transform:translateY(30px);opacity:.4}to{transform:none;opacity:1}}"}</style>
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
