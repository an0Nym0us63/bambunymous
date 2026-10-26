import React, { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { GRADES, ROMAN, GRADE_METAL, GradeEmblem } from "./medals";
import { sGrade } from "./cardSounds";

// La fete, plus discrete, des titres de section (26/10/2026) : Imprimeur II, Coloriste I… Une carte au centre,
// l'ecusson qui jaillit sur une petite onde, le titre et ses etoiles ; plusieurs sections a la fois s'empilent
// dans la meme carte. Se ferme seule, ou d'un toucher.
export const sectionName = (cat, l) => {
  if (l < 0) return null;
  const names = GRADES[cat] || GRADES.other;
  return `${names[Math.floor(l / 3)]} ${ROMAN[l % 3]}`;
};
const CSS = `
@keyframes sfx-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes sfx-card { 0% { transform: translateY(30px) scale(.9); opacity: 0 } 70% { transform: translateY(-4px) scale(1.02); opacity: 1 } 100% { transform: none } }
@keyframes sfx-pop { 0% { transform: scale(.2) rotate(-25deg); opacity: 0 } 65% { transform: scale(1.2) rotate(6deg); opacity: 1 } 100% { transform: none } }
@keyframes sfx-ring { from { transform: translate(-50%,-50%) scale(.3); opacity: .9 } to { transform: translate(-50%,-50%) scale(2.4); opacity: 0 } }
@keyframes sfx-rays { to { transform: translate(-50%,-50%) rotate(360deg) } }
@keyframes sfx-star { 0% { transform: scale(0); opacity: 0 } 70% { transform: scale(1.35); opacity: 1 } 100% { transform: none } }
@keyframes sfx-up { from { transform: translateY(8px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes bn-grade-sweep { 0%, 55% { transform: translateX(0) skewX(-20deg) } 100% { transform: translateX(80px) skewX(-20deg) } }
@media (prefers-reduced-motion: reduce) { .sfx * { animation-duration: .01s !important; animation-iteration-count: 1 !important } }
`;

export default function SectionFxShow({ sections, onClose }) {
  const list = sections.slice(0, 4);
  const top = useMemo(() => list.reduce((a, b) => (b.to > a.to ? b : a), list[0]), [list]);
  const m = GRADE_METAL[Math.floor(top.to / 3)];
  useEffect(() => {
    sGrade(false);
    const t = setTimeout(onClose, 5500 + list.length * 900);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return createPortal(
    <div className="sfx" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2900, display: "flex", alignItems: "center", justifyContent: "center",
      padding: 16, background: "rgba(2,6,23,.45)", backdropFilter: "blur(2px)", animation: "sfx-in .3s ease-out", cursor: "pointer" }}>
      <style>{CSS}</style>
      <div style={{ position: "relative", width: "min(380px, 100%)", borderRadius: 22, padding: "18px 18px 16px", overflow: "hidden",
        background: `radial-gradient(90% 70% at 50% 0%, ${m.a}55, transparent 70%), var(--sheet-bg, #fff)`,
        border: `1.5px solid ${m.b}88`, boxShadow: `0 24px 60px -20px ${m.b}aa, 0 0 0 4px ${m.a}22`, animation: "sfx-card .55s cubic-bezier(.2,.8,.2,1) both" }}>
        <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: ".14em", textAlign: "center", color: m.ink, marginBottom: 10 }}>
          {list.length > 1 ? "NOUVEAUX TITRES" : Math.floor(top.from / 3) < Math.floor(top.to / 3) ? "NOUVEAU TITRE" : "NOUVEL ÉCHELON"}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {list.map((s, k) => {
            const i = Math.floor(s.to / 3), sub = s.to % 3, mm = GRADE_METAL[i], newTitle = Math.floor(s.from / 3) < i;
            const d = 0.15 + k * 0.35;
            return (
              <div key={s.cat} style={{ display: "flex", alignItems: "center", gap: 12, animation: `sfx-up .45s ease-out ${d}s both` }}>
                <span style={{ position: "relative", width: 64, height: 70, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: 120, height: 120, borderRadius: "50%",
                    transform: "translate(-50%,-50%)", opacity: .45, animation: "sfx-rays 12s linear infinite",
                    background: `repeating-conic-gradient(${mm.a}cc 0deg 7deg, transparent 7deg 20deg)`,
                    WebkitMask: "radial-gradient(circle, #000 20%, transparent 68%)", mask: "radial-gradient(circle, #000 20%, transparent 68%)" }}/>
                  <span aria-hidden="true" style={{ position: "absolute", left: "50%", top: "50%", width: 70, height: 70, borderRadius: "50%",
                    border: `3px solid ${mm.a}`, animation: `sfx-ring .9s ease-out ${d + 0.1}s both` }}/>
                  <span style={{ position: "relative", animation: `sfx-pop .6s cubic-bezier(.2,.8,.2,1) ${d}s both`, filter: `drop-shadow(0 0 10px ${mm.a})` }}>
                    <GradeEmblem i={i} size={52}/></span>
                </span>
                <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{s.emoji} {s.label}{newTitle ? " · nouveau titre" : ""}</span>
                  <span style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.15, backgroundImage: `linear-gradient(135deg, ${mm.ink}, ${mm.b})`,
                    WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{sectionName(s.cat, s.to)}</span>
                  <span style={{ display: "flex", gap: 3 }}>
                    {[0, 1, 2].map(j => <span key={j} style={{ fontSize: 15, lineHeight: 1, color: j <= sub ? mm.b : "var(--border)",
                      animation: j <= sub ? `sfx-star .4s ease-out ${d + 0.35 + j * 0.15}s both` : undefined }}>★</span>)}
                  </span>
                </span>
              </div>);
          })}
        </div>
        {sections.length > list.length && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", textAlign: "center", marginTop: 8 }}>
          et {sections.length - list.length} autre{sections.length - list.length > 1 ? "s" : ""}</div>}
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", textAlign: "center", marginTop: 12 }}>Touche pour fermer</div>
      </div>
    </div>,
    document.body);
}
