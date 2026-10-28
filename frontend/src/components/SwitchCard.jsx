import React, { useState } from "react";
import CardHelp from "./CardHelp";

// Une carte des Parametres qui s'active d'un interrupteur (28/10/2026) : l'interrupteur est dans le titre, et sur
// telephone la carte est repliee (on la deplie pour regler) ; sur ordinateur elle reste ouverte.
export const phoneWidth = () => typeof window !== "undefined" && window.innerWidth < 700;

export function Switch({ on, onToggle, label = "Activer" }) {
  return <button type="button" onClick={e => { e.stopPropagation(); onToggle(); }} role="switch" aria-checked={!!on} aria-label={label}
    style={{ width:46, height:26, borderRadius:20, border:"none", cursor:"pointer", position:"relative", flexShrink:0,
      background: on ? "#3b82f6" : "var(--border)", transition:"background .2s" }}>
    <span style={{ position:"absolute", top:3, left: on ? 23 : 3, width:20, height:20, borderRadius:"50%", background:"#fff",
      transition:"left .2s", boxShadow:"0 1px 3px rgba(0,0,0,0.3)" }}/></button>;
}

export default function SwitchCard({ title, on, onToggle, hint = null, help = null, helpTitle = null, card, cardTitle, children }) {
  const phone = phoneWidth();
  const [open, setOpen] = useState(!phone);
  return (
    <div className="card" style={card}>
      <div role={phone ? "button" : undefined} tabIndex={phone ? 0 : undefined} onClick={() => phone && setOpen(v => !v)}
        onKeyDown={e => { if (phone && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen(v => !v); } }}
        style={{ ...cardTitle, display:"flex", alignItems:"center", gap:8, cursor: phone ? "pointer" : "default", marginBottom: open ? (cardTitle?.marginBottom ?? 10) : 0 }}>
        <span style={{ flex:1, minWidth:0, display:"flex", alignItems:"center", flexWrap:"wrap", gap:4 }}>{title}
          {help && <CardHelp inline title={helpTitle || (typeof title === "string" ? title : "")}>{help}</CardHelp>}</span>
        {hint && <span style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)", whiteSpace:"nowrap" }}>{hint}</span>}
        {onToggle && <Switch on={on} onToggle={onToggle}/>}
        {phone && <span aria-hidden="true" style={{ fontSize:12, color:"var(--muted)" }}>{open ? "▴" : "▾"}</span>}
      </div>
      {open && children}
    </div>
  );
}
