import React, { useState } from "react";
import { apiThumb } from "../api/client";
import { colorBg, parseColorsList } from "../utils/colors";

// Le planning des impressions (05/11/2026) : les briques du calendrier. La journee en frise (heures de fonctionnement,
// de lancement, impressions faites et prevues), ses travaux prevus a ranger, les consignes, les conseils.
// Les travaux et leurs raisons viennent du serveur (services/planner.py) : la page ne fait que les montrer et ranger.

export const hm = s => { const m = Math.round((s || 0) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
const hhmm = iso => iso ? iso.slice(11, 16).replace(":", " h ").replace(/ h 00$/, " h").replace(/^0(?=\d)/, "") : "";
export const jobName = j => `${j.title}${j.plates_total > 1 ? ` · plateau ${j.plate}` : ""}${j.qty > 1 ? ` · ${j.copy}/${j.qty}` : ""}`;
// le plateau qui termine un objet : « 🏁 Objet terminé » (« 1 sur 2 » quand il en faut plusieurs)
export const doneTxt = j => j.completes ? `🏁 Objet terminé${j.qty > 1 ? ` · ${j.completes} sur ${j.qty}` : ""}` : null;
const GOLD = "#EAB308";
const toMin = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ""); return m ? +m[1] * 60 + +m[2] : null; };

// une plage d'heures sur la frise : [debut, fin] en minutes du jour, coupee a minuit
function spans(w) {
  if (!w) return null;
  const a = toMin(w.from), b0 = toMin(w.to);
  if (a == null || b0 == null) return null;
  const b = b0 <= a ? b0 + 1440 : b0;
  return b > 1440 ? [[a, 1440], [0, b - 1440]] : [[a, b]];
}

// la journee en frise : 0 h a 24 h, la plage de fonctionnement en vert pale, celle de lancement soulignee, les
// impressions faites en violet, les prevues hachurees de leur couleur
export function DayStrip({ day, done = [], jobs = [], settings, now }) {
  const pct = m => `${(m / 1440) * 100}%`;
  const minOf = (iso, d) => { if (!iso) return 0; if (iso.slice(0, 10) < d) return 0; if (iso.slice(0, 10) > d) return 1440;
    return +iso.slice(11, 13) * 60 + +iso.slice(14, 16); };
  const run = spans(settings?.run), launch = spans(settings?.launch);
  const nowM = now && now.slice(0, 10) === day ? minOf(now, day) : null;
  return <div style={{ position: "relative", height: 34, marginTop: 2 }}>
    <div style={{ position: "absolute", left: 0, right: 0, top: 6, height: 18, borderRadius: 7, background: run ? "color-mix(in srgb, #94A3B8 16%, var(--surface2))" : "var(--surface2)",
      border: "1px solid var(--border)", overflow: "hidden" }}>
      {(run || []).map(([a, b], i) => <span key={`r${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: pct(a), width: pct(b - a),
        background: "color-mix(in srgb, #22C55E 10%, var(--surface2))" }}/>)}
      {done.map((it, i) => { const a = minOf(it.start, day), b = Math.min(1440, a + (it.seconds || 0) / 60);
        return <span key={`d${i}`} data-tip={`${it.title || it.name} · ${hm(it.seconds)}`} style={{ position: "absolute", top: 2, bottom: 2, left: pct(a), width: pct(Math.max(4, b - a)),
          borderRadius: 4, background: "linear-gradient(90deg, #8B5CF6, #EC4899)" }}/>; })}
      {jobs.map(j => { const a = minOf(j.start, day), b = minOf(j.end, day);
        const c = j.fils?.[0]?.color || "#22C55E";
        return <span key={j.key} data-tip={`${jobName(j)} · ${hhmm(j.start)} → ${hhmm(j.end)}`} style={{ position: "absolute", top: 2, bottom: 2, left: pct(a), width: pct(Math.max(4, b - a)),
          borderRadius: 4, border: `1.5px dashed ${j.too_long ? "#EF4444" : "#22C55E"}`, boxSizing: "border-box",
          background: `repeating-linear-gradient(135deg, color-mix(in srgb, ${c} 55%, transparent) 0 4px, transparent 4px 8px)` }}/>; })}
      {nowM != null && <span style={{ position: "absolute", top: 0, bottom: 0, left: pct(nowM), width: 2, background: "#EF4444" }}/>}
    </div>
    {(launch || []).map(([a, b], i) => <span key={`l${i}`} data-tip="Heures de lancement" style={{ position: "absolute", top: 27, height: 3, borderRadius: 2,
      left: pct(a), width: pct(b - a), background: "#6366F1", opacity: 0.6 }}/>)}
    {[0, 6, 12, 18, 24].map(h => <span key={h} style={{ position: "absolute", top: -5, left: pct(h * 60), transform: h === 24 ? "translateX(-100%)" : h ? "translateX(-50%)" : "none",
      fontSize: 8.5, fontWeight: 800, color: "var(--muted)" }}>{h} h</span>)}
  </div>;
}

// un filament : sa pastille de couleur
const Dot = ({ f }) => <span data-tip={f.name} style={{ width: 11, height: 11, borderRadius: "50%", flexShrink: 0, border: "1px solid rgba(0,0,0,0.2)",
  ...(colorBg(parseColorsList(f.color, f.colors_array), f.multicolor_type, null, { size: 11 }) || { background: f.color || "#94A3B8" }) }}/>;

// un travail prevu : vignette, nom, heures, filaments (ceux a charger en orange), pourquoi il est la ; on le range
// en le glissant (ordinateur) ou avec ses boutons (telephone)
export const dueTxt = d => new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
export function JobCard({ j, edit, onDrag, onDropBefore, onUp, onDown, onDay, onUnpin, onOpen, onDue, onDone, dragging }) {
  const [over, setOver] = useState(false);
  const drift = j.drift_min;
  return <div draggable={edit} onDragStart={e => { e.dataTransfer.setData("text/bn-job", j.key); e.dataTransfer.effectAllowed = "move"; onDrag?.(j.key); }}
    onDragEnd={() => onDrag?.(null)}
    onDragOver={e => { if (edit && e.dataTransfer.types.includes("text/bn-job")) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
    onDragLeave={() => setOver(false)}
    onDrop={e => { const k = e.dataTransfer.getData("text/bn-job"); setOver(false); if (k && k !== j.key) { e.preventDefault(); e.stopPropagation(); onDropBefore?.(k, j.key); } }}
    style={{ display: "flex", gap: 9, padding: 7, borderRadius: 12, cursor: edit ? "grab" : "default", opacity: dragging === j.key ? 0.45 : 1,
      border: `1.5px ${j.completes ? "solid" : "dashed"} ${j.too_long ? "#EF4444" : j.completes ? GOLD : "color-mix(in srgb, #22C55E 50%, var(--border))"}`,
      boxShadow: over ? "0 -3px 0 0 #6366F1" : "none",
      background: j.completes ? `linear-gradient(120deg, color-mix(in srgb, ${GOLD} 14%, transparent), transparent 60%), var(--surface2)` : "color-mix(in srgb, #22C55E 5%, var(--surface2))" }}>
    <span onClick={onOpen} data-tip="Profil, plateaux et filaments retenus" style={{ width: 46, height: 46, borderRadius: 10, flexShrink: 0, overflow: "hidden", cursor: "pointer",
      background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {j.cover ? <img src={apiThumb(j.cover, 96)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onError={e => { e.currentTarget.style.visibility = "hidden"; }}/> : "✅"}</span>
    <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {j.pinned && <span data-tip="Posée sur ce jour" style={{ marginRight: 4 }}>📌</span>}{jobName(j)}</span>
      <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ whiteSpace: "nowrap" }}>{hhmm(j.start)} → {j.end.slice(0, 10) !== j.start.slice(0, 10) ? "lendemain " : ""}{hhmm(j.end)} · {hm(j.seconds)}</span>
        {Math.abs(drift) >= 10 && <span style={{ fontWeight: 900, color: drift > 0 ? "#F97316" : "#22C55E" }}>{drift > 0 ? `+${hm(drift * 60)}` : `−${hm(-drift * 60)}`}</span>}
        <span style={{ display: "inline-flex", gap: 3 }}>{(j.fils || []).slice(0, 8).map((f, i) => <Dot key={i} f={f}/>)}</span>
        {j.due && <span data-tip={j.due_ok ? "L'objet sera fini à temps" : "Le dernier plateau de l'objet finit après cette date"}
          style={{ fontWeight: 900, whiteSpace: "nowrap", color: j.due_ok ? "#16A34A" : "#EF4444" }}>🎯 avant le {dueTxt(j.due)}</span>}
      </span>
      {j.completes && <span data-tip="Avec ce plateau, tous ceux de l'objet sont faits" style={{ alignSelf: "flex-start", fontSize: 11.5, fontWeight: 900, color: "#A16207",
        background: `color-mix(in srgb, ${GOLD} 22%, transparent)`, borderRadius: 8, padding: "1px 8px" }}>{doneTxt(j)}</span>}
      {j.load?.length > 0 && <span style={{ fontSize: 11.5, fontWeight: 800, color: "#F97316" }}>🧵 À charger : {j.load.join(", ")}</span>}
      {(j.reasons || []).map((r, i) => <span key={i} style={{ fontSize: 11.5, fontWeight: 600, color: j.too_long && i === j.reasons.length - 1 ? "#EF4444" : "var(--text2)",
        lineHeight: 1.35 }}>↪ {r}</span>)}
    </span>
    {edit && <span style={{ display: "flex", flexDirection: "column", gap: 3, flexShrink: 0 }}>
      <span style={{ display: "flex", gap: 3 }}>
        <button type="button" onClick={onUp} disabled={!onUp} aria-label="Plus tôt" data-tip="Plus tôt" style={mini}>↑</button>
        <button type="button" onClick={onDown} disabled={!onDown} aria-label="Plus tard" data-tip="Plus tard" style={mini}>↓</button>
      </span>
      <label data-tip="La poser sur un autre jour" style={{ ...mini, position: "relative", width: "auto" }}>📅
        <input type="date" value={j.day} min={new Date().toISOString().slice(0, 10)} onChange={e => e.target.value && onDay(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}/></label>
      <label data-tip={j.due ? "Changer la date limite de l'objet" : "Une date limite pour l'objet : fini avant ce jour"} style={{ ...mini, position: "relative", width: "auto" }}>🎯
        <input type="date" value={j.due || ""} onChange={e => onDue(e.target.value || null)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}/></label>
      <button type="button" onClick={onDone} data-tip="Imprimé hors de l'appli, ou pas reconnu : le compter comme fait" aria-label="Fait" style={mini}>✓</button>
      {j.pinned && <button type="button" onClick={onUnpin} data-tip="Le rendre à la file : il se place où il tient" style={mini}>✕</button>}
    </span>}
  </div>;
}

// les consignes de la maison
export function PlanSettings({ s, onSave, onClose }) {
  const [gap, setGap] = useState(String(s?.gap ?? 15));
  const [run, setRun] = useState(s?.run || null);
  const [launch, setLaunch] = useState(s?.launch || null);
  const [busy, setBusy] = useState(false);
  const range = (v, set, def, offTxt, onTxt) => <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <button type="button" onClick={() => set(null)} style={{ ...seg, ...(v ? {} : segOn) }}>{offTxt}</button>
      <button type="button" onClick={() => set(v || def)} style={{ ...seg, ...(v ? segOn : {}) }}>{onTxt}</button>
    </div>
    {v && <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "var(--text2)" }}>
      de <input type="time" value={v.from} onChange={e => set({ ...v, from: e.target.value })} style={tin}/>
      à <input type="time" value={v.to} onChange={e => set({ ...v, to: e.target.value })} style={tin}/></div>}
  </div>;
  const save = async () => { setBusy(true); try { await onSave({ gap: Math.max(0, parseInt(gap) || 0), run, launch }); } finally { setBusy(false); } };
  return <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 14.5, fontWeight: 900, color: "var(--text)", flex: 1 }}>⚙ Les consignes du planning</span>
      <button type="button" onClick={onClose} aria-label="Fermer" style={mini}>✕</button></div>
    <div>
      <div style={lab}>⏸ Pause entre deux impressions</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input inputMode="numeric" value={gap} onChange={e => setGap(e.target.value.replace(/\D/g, ""))} style={{ ...tin, width: 70 }}/>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>minutes</span></div>
      <div style={hint}>Le temps de retirer le plateau et de relancer. Une heure de pause : quatre impressions de 6 h tiennent sur deux jours.</div>
    </div>
    <div>
      <div style={lab}>🔌 Heures de fonctionnement</div>
      {range(run, setRun, { from: "08:00", to: "22:00" }, "24 h/24", "Une plage")}
      <div style={hint}>Une impression doit <b>finir</b> dans la plage : avec 8 h – 22 h, une impression de 6 h ne part plus après 16 h, elle passe au lendemain.</div>
    </div>
    <div>
      <div style={lab}>▶ Heures de lancement</div>
      {range(launch, setLaunch, { from: "08:00", to: "00:00" }, "À toute heure", "Une plage")}
      <div style={hint}>Quand quelqu'un est là pour lancer. Avec 8 h – minuit, une impression peut finir à 2 h du matin, mais la suivante attend 8 h.</div>
    </div>
    <button type="button" disabled={busy} onClick={save} style={{ alignSelf: "flex-end", padding: "8px 16px", borderRadius: 12, border: "none", cursor: "pointer",
      background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#fff", fontSize: 13, fontWeight: 900 }}>{busy ? "…" : "Enregistrer"}</button>
  </div>;
}

// les objets a finir avant une date : tiennent-ils ? (« la fusee avant le 24 »)
export function PlanDeadlines({ items, edit, onDue }) {
  if (!items?.length) return null;
  const late = m => { m = Math.abs(m); return m < 1440 ? hm(m * 60) : `${Math.floor(m / 1440)} j${m % 1440 >= 60 ? ` ${Math.floor(m % 1440 / 60)} h` : ""}`; };
  return <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", padding: 10, display: "flex", flexDirection: "column", gap: 7 }}>
    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#EF4444" }}>🎯 Dates limites</div>
    {items.map(x => <div key={x.design_id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ fontSize: 15 }}>{x.ok ? "✅" : "⚠️"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {x.title} · avant le {dueTxt(x.due)}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: x.ok ? "#16A34A" : "#EF4444" }}>
          {x.count} plateau{x.count > 1 ? "x" : ""} · fini le {dueTxt(x.end.slice(0, 10))} à {x.end.slice(11, 16).replace(":", " h ")}
          {x.ok ? ` · ${late(x.margin_min)} de marge` : ` · ${late(x.margin_min)} trop tard`}</span>
      </span>
      {edit && <button type="button" onClick={() => onDue(x.design_id, null)} data-tip="Retirer la date limite" style={mini}>✕</button>}
    </div>)}
  </div>;
}

// la journee couleur : tous les plateaux d'un filament, de tous les objets, sur ce jour
export function ColorDay({ colors, onPick }) {
  const [open, setOpen] = useState(false);
  if (!colors?.length) return null;
  return <div style={{ position: "relative" }}>
    <button type="button" onClick={() => setOpen(v => !v)} data-tip="Poser sur ce jour tous les plateaux d'un même filament, de tous les objets"
      style={{ ...seg, padding: "4px 10px", color: "#EC4899" }}>🎨 Journée couleur</button>
    {open && <div style={{ position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 20, width: 250, maxHeight: 300, overflowY: "auto", padding: 6,
      borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", boxShadow: "0 10px 30px rgba(0,0,0,.25)" }}>
      {colors.map(c => <button key={c.filament_id} type="button" onClick={() => { setOpen(false); onPick(c.filament_id); }}
        style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 8px", borderRadius: 9, border: "none", background: "transparent",
          cursor: "pointer", textAlign: "left" }}>
        <Dot f={c}/>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>{c.count} plateau{c.count > 1 ? "x" : ""} · {hm(c.seconds)}</span>
      </button>)}
    </div>}
  </div>;
}

// les plateaux marques faits a la main, a retirer si c'etait une erreur
export function ManualDone({ items, edit, onUndo }) {
  if (!items?.length) return null;
  return <div style={{ borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", padding: 10, display: "flex", flexDirection: "column", gap: 5 }}>
    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)" }}>✓ Marqués faits à la main</div>
    {items.map(x => <div key={x.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>
      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.title || `Plateau ${x.plate}`}{x.n > 1 ? ` ×${x.n}` : ""}</span>
      {edit && <button type="button" onClick={() => onUndo(x.key)} data-tip="Retirer une fois : il redevient à faire" style={mini}>−</button>}
    </div>)}
  </div>;
}

// les conseils, chacun avec son « Appliquer » quand il deplace un travail
export function PlanAdvice({ items, edit, onApply }) {
  if (!items?.length) return null;
  return <div style={{ borderRadius: 16, border: "1px solid color-mix(in srgb, #F59E0B 35%, var(--border))", padding: 10, display: "flex", flexDirection: "column", gap: 7,
    background: "linear-gradient(150deg, color-mix(in srgb, #F59E0B 9%, transparent), transparent 70%), var(--surface)" }}>
    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#D97706" }}>💡 Conseils</div>
    {items.slice(0, 6).map((a, i) => <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      <span style={{ fontSize: 14 }}>{a.icon}</span>
      <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "var(--text2)", lineHeight: 1.4 }}>{a.text}</span>
      {edit && a.action && <button type="button" onClick={() => onApply(a.action)} style={{ ...seg, ...segOn, padding: "3px 9px", flexShrink: 0 }}>Appliquer</button>}
    </div>)}
  </div>;
}

const mini = { width: 26, height: 24, borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)", cursor: "pointer",
  fontSize: 12, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px" };
const seg = { padding: "5px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", fontSize: 12, fontWeight: 800, cursor: "pointer" };
const segOn = { color: "#6366F1", borderColor: "color-mix(in srgb, #6366F1 45%, var(--border))", background: "color-mix(in srgb, #6366F1 10%, var(--surface2))" };
const tin = { padding: "5px 8px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, fontWeight: 700 };
const lab = { fontSize: 12.5, fontWeight: 900, color: "var(--text2)", marginBottom: 6 };
const hint = { fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45, marginTop: 5 };
