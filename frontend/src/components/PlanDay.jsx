import React, { useState } from "react";
import { apiThumb, apiUrl } from "../api/client";
import { colorBg, parseColorsList } from "../utils/colors";
import MwImg from "./MwImg";

// Le planning des impressions (05/11/2026) : les briques du calendrier. La journee en frise (heures de fonctionnement,
// de lancement, impressions faites et prevues), ses travaux prevus a ranger, les consignes, les conseils.
// Les travaux et leurs raisons viennent du serveur (services/planner.py) : la page ne fait que les montrer et ranger.

export const hm = s => { const m = Math.round((s || 0) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
export const hhmm = iso => iso ? iso.slice(11, 16).replace(":", " h ").replace(/ h 00$/, " h").replace(/^0(?=\d)/, "") : "";
export const jobName = j => `${j.title}${j.plates_total > 1 ? ` · plateau ${j.plate}` : ""}${j.qty > 1 ? ` · ${j.copy}/${j.qty}` : ""}`;
// le plateau qui termine un objet : « 🏁 Objet terminé » (« 1 sur 2 » quand il en faut plusieurs)
export const doneTxt = j => j.completes ? `🏁 Objet terminé${j.qty > 1 ? ` · ${j.completes} sur ${j.qty}` : ""}` : null;
// le plateau qui termine un objet : vert profond, plein (05/11/2026 : en dore, il faisait penser a un avertissement)
const GOLD = "#059669";
const toMin = v => { const m = /^(\d{1,2}):(\d{2})$/.exec(v || ""); return m ? +m[1] * 60 + +m[2] : null; };

// une plage d'heures sur la frise : [debut, fin] en minutes du jour, coupee a minuit
export function spans(w) {
  if (!w) return null;
  const a = toMin(w.from), b0 = toMin(w.to);
  if (a == null || b0 == null) return null;
  const b = b0 <= a ? b0 + 1440 : b0;
  return b > 1440 ? [[a, 1440], [0, b - 1440]] : [[a, b]];
}

// la journee en frise : 0 h a 24 h, la plage de fonctionnement en vert pale, celle de lancement soulignee, les
// impressions faites en violet, les prevues hachurees de leur couleur
// un plateau sur ce jour : commence ce jour-la, ou commence avant et deborde dessus (06/11/2026 : lance a 22 h 54 et fini
// a 2 h, il ne se voyait pas au debut du lendemain)
export const onDay = (j, d) => j.day === d || (!!j.start && !!j.end && j.start.slice(0, 10) < d && j.end > `${d}T00:00`);
export function DayStrip({ day, done = [], jobs = [], settings, now, live = null }) {
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
      {/* l'impression en cours : ce qu'il lui reste, jusqu'a sa fin estimee (05/11/2026) */}
      {live?.end && live.now && live.now.slice(0, 10) <= day && live.end.slice(0, 10) >= day && (() => {
        const a = live.now.slice(0, 10) < day ? 0 : minOf(live.now, day), b = live.end.slice(0, 10) > day ? 1440 : minOf(live.end, day);
        return b > a ? <span data-tip={`${live.name || "Impression en cours"} : fin estimée vers ${hhmm(live.end)}`} style={{ position: "absolute", top: 2, bottom: 2,
          left: pct(a), width: pct(Math.max(4, b - a)), borderRadius: 4, border: "1.5px dashed #3B82F6", boxSizing: "border-box",
          background: "repeating-linear-gradient(135deg, color-mix(in srgb, #3B82F6 35%, transparent) 0 4px, transparent 4px 8px)" }}/> : null;
      })()}
      {live?.planned && live.planned.slice(0, 10) === day && <span data-tip={`Fin prévue au lancement : ${hhmm(live.planned)}`} style={{ position: "absolute", top: -2, bottom: -2,
        left: pct(minOf(live.planned, day)), width: 0, borderLeft: "2px dashed #8B5CF6" }}/>}
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

// un plateau prevu (05/11/2026, revu) : la vignette DU PLATEAU (celle du modele en attendant), le modele, le plateau
// en clair (« Plateau 3/7 · Couvercle »), ses heures, ses filaments, ce qu'il faut charger, pourquoi il est la ; les
// boutons en bas, sur toute la largeur, pour que le texte respire. On le range en le glissant (ordinateur) ou avec ses
// boutons (telephone).
export const dueTxt = d => new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
export function PlateThumb({ j, size = 52, onClick }) {
  const src = j.thumb || j.cover;
  return <span onClick={onClick} data-tip={onClick ? "Profil, plateaux et filaments retenus" : undefined}
    style={{ position: "relative", width: size, height: size, borderRadius: 10, flexShrink: 0, overflow: "hidden", cursor: onClick ? "pointer" : "default",
      background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
    {/* une image MakerWorld (couverture du modele ou du profil) passe par la reduction de son CDN (06/11/2026 : apiThumb ne
        reduit que les images de l'API ; la file chargeait des couvertures de plusieurs Mo pour des vignettes de 60 px) */}
    {src ? (j.thumb || !String(src).startsWith("/api/") ? <MwImg src={src} w={size * 2} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
      : <img src={apiThumb(src, size * 2)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>) : <span style={{ fontSize: size / 3 }}>🧩</span>}
    {j.plates_total > 1 && <span style={{ position: "absolute", left: 2, bottom: 2, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8,
      background: "rgba(15,23,42,.78)", color: "#fff", fontSize: 10, fontWeight: 900, lineHeight: "16px", textAlign: "center" }}>{j.plate}</span>}
  </span>;
}
// le nom d'un plateau quand il dit autre chose que « Plateau 2 » (sinon « Plateau 2/4 · Plateau 2 »)
const pname = j => j.plate_name && !/^(plateau|plate)\s*\d+$/i.test(j.plate_name.trim()) ? j.plate_name : "";
// un modele pas retenu dans « A faire » (05/11/2026) : planifie quand meme, apres les retenus, en gris
export const UNRET = "#94A3B8";
export const unretained = j => j && j.retained === false;
export const plateTxt = j => j.plates_total > 1 ? `Plateau ${j.plate}/${j.plates_total}${pname(j) ? ` · ${pname(j)}` : ""}`
  : pname(j) || "Plateau unique";
export function JobCard({ j, edit, onDrag, onDropBefore, onUp, onDown, onDay, onUnpin, onOpen, onDue, onDone, dragging, compact = false }) {
  const [over, setOver] = useState(false);
  const drift = j.drift_min;
  const tag = (txt, c, tip) => <span data-tip={tip} style={{ fontSize: 11, fontWeight: 900, whiteSpace: "nowrap", color: c, borderRadius: 7, padding: "1px 7px",
    background: `color-mix(in srgb, ${c} 13%, transparent)` }}>{txt}</span>;
  return <div draggable={edit} onDragStart={e => { e.dataTransfer.setData("text/bn-job", j.key); e.dataTransfer.effectAllowed = "move"; onDrag?.(j.key); }}
    onDragEnd={() => onDrag?.(null)}
    onDragOver={e => { if (edit && e.dataTransfer.types.includes("text/bn-job")) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
    onDragLeave={() => setOver(false)}
    onDrop={e => { const k = e.dataTransfer.getData("text/bn-job"); setOver(false); if (k && k !== j.key) { e.preventDefault(); e.stopPropagation(); onDropBefore?.(k, j.key); } }}
    onClick={compact ? onOpen : undefined}
    style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 13, cursor: compact ? "pointer" : edit ? "grab" : "default", opacity: dragging === j.key ? 0.45 : 1,
      border: `${j.locked ? 2 : 1.5}px ${j.completes || j.locked ? "solid" : "dashed"} ${j.too_long ? "#EF4444" : j.locked ? "#4F46E5" : unretained(j) ? UNRET : j.completes ? GOLD : "color-mix(in srgb, #22C55E 50%, var(--border))"}`,
      boxShadow: over ? "0 -3px 0 0 #6366F1" : "none",
      background: j.completes ? `linear-gradient(120deg, color-mix(in srgb, ${GOLD} 14%, transparent), transparent 60%), var(--surface2)`
        : unretained(j) ? "var(--surface2)" : "color-mix(in srgb, #22C55E 5%, var(--surface2))" }}>
    <div style={{ display: "flex", gap: 9, minWidth: 0 }}>
      <PlateThumb j={j} onClick={onOpen}/>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {/* l'heure d'abord : c'est ce qu'on cherche dans une journee */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" }}>
            {hhmm(j.start)} → {j.end.slice(0, 10) !== j.start.slice(0, 10) ? "lendemain " : ""}{hhmm(j.end)}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>{hm(j.seconds)}</span>
          {Math.abs(drift) >= 10 && <span style={{ fontSize: 11.5, fontWeight: 900, color: drift > 0 ? "#F97316" : "#22C55E" }}>{drift > 0 ? `+${hm(drift * 60)}` : `−${hm(-drift * 60)}`}</span>}
          {j.locked ? <span data-tip="Figé : rien ne le déplace (optimiser, journée couleur…)" style={{ fontSize: 11 }}>🔒</span>
            : j.pinned && <span data-tip="Jour figé : il reste ce jour-là" style={{ fontSize: 11 }}>📌</span>}
        </div>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text2)", lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
          overflow: "hidden" }}>{j.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: "#6366F1", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
            {plateTxt(j)}{j.qty > 1 ? ` · ${j.copy}e fois sur ${j.qty}` : ""}</span>
          <span style={{ display: "inline-flex", gap: 3 }}>{(j.fils || []).slice(0, 8).map((f, i) => <Dot key={i} f={f}/>)}</span>
        </div>
      </div>
    </div>
    {(j.completes || j.due || j.load?.length > 0 || unretained(j) || j.locked || j.awaits_order?.length > 0 || j.low_after?.length > 0) && <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {j.awaits_order?.length > 0 && tag(`🚚 compte sur la commande : ${j.awaits_order.join(", ")}`, "#0EA5E9", "Le stock ne suffit pas : ce plateau prend sur une bobine commandée, pas encore reçue")}
      {j.low_after?.length > 0 && tag(`📉 sous le seuil : ${j.low_after.join(", ")}`, "#DC2626", "Après ce plateau, il restera moins d'un quart de bobine de ce filament")}
      {j.locked && tag(`🔒 figé à ${hhmm(j.start)}`, "#4F46E5", "Figé à ce jour et cette heure : optimiser, journée couleur, au mieux ou plus tard ne le déplacent pas")}
      {unretained(j) && tag("○ non retenu", "#64748B", "Profil par défaut, pas retenu dans « À faire » : planifié après les modèles retenus. Retiens-le depuis sa fiche (sa vignette) pour le planifier en priorité")}
      {j.completes && tag(doneTxt(j), "#047857", "Avec ce plateau, tous ceux de l'objet sont faits")}
      {j.intercalated && tag(`↔ intercalé dans ${j.intercalated.in}`, "#0EA5E9", { nuit: "Pour remplir la nuit", filaments: "Pour charger moins de filaments" }[j.intercalated.why]
        || "Pour optimiser le planning")}
      {j.due && tag(`🎯 avant le ${dueTxt(j.due)}`, j.due_ok ? "#16A34A" : "#EF4444", j.due_ok ? "L'objet sera fini à temps" : "Le dernier plateau de l'objet finit après cette date")}
      {j.load?.length > 0 && tag(`🧵 À charger : ${j.load.join(", ")}`, "#EA580C", "Pas dans l'AMS à ce moment-là")}
    </div>}
    {/* decale par la tache de fond (pas par un rangement) : d'ou il vient, quand, pourquoi */}
    {j.moved && <div style={{ fontSize: 11.5, fontWeight: 700, lineHeight: 1.35, color: "#0EA5E9" }}>
      🔄 Décalé {j.moved.from < j.day ? "depuis" : "avancé du"} {dueTxt(j.moved.from)} à {hhmm(j.moved.at)} : {j.moved.why}</div>}
    {(j.reasons || []).map((r, i) => <div key={i} style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.35,
      color: j.too_long && i === j.reasons.length - 1 ? "#EF4444" : "var(--muted)" }}>↪ {r}</div>)}
    {edit && !compact && <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap", borderTop: "1px dashed var(--border)", paddingTop: 6 }}>
      <button type="button" onClick={onUp} disabled={!onUp} aria-label="Plus tôt" data-tip="Plus tôt" style={act}>↑</button>
      <button type="button" onClick={onDown} disabled={!onDown} aria-label="Plus tard" data-tip="Plus tard" style={act}>↓</button>
      <label data-tip="Le poser sur un autre jour" style={{ ...act, position: "relative" }}>📅 Jour
        <input type="date" onClick={e => { try { e.currentTarget.showPicker?.(); } catch { /* rien */ } }} value={j.day} min={new Date().toISOString().slice(0, 10)} onChange={e => e.target.value && onDay(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}/></label>
      <label data-tip={j.due ? "Changer la date limite de l'objet" : "Une date limite pour l'objet : fini avant ce jour"} style={{ ...act, position: "relative" }}>🎯 Date
        <input type="date" onClick={e => { try { e.currentTarget.showPicker?.(); } catch { /* rien */ } }} value={j.due || ""} onChange={e => onDue(e.target.value || null)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}/></label>
      <button type="button" onClick={onDone} data-tip="Imprimé hors de l'appli, ou pas reconnu : le compter comme fait" style={act}>✓ Fait</button>
      {j.pinned && <button type="button" onClick={onUnpin} data-tip="Défiger le jour : il se place où il tient" style={act}>✕</button>}
    </div>}
  </div>;
}

// les consignes de la maison
// les modes d'optimisation (06/11/2026)
export const OPT_MODES = [["mix", "🧠", "Intelligent", "Essaie plusieurs plannings et garde le meilleur sur l'ensemble : aucune date limite ratée, les nuits remplies, le moins de bobines à changer, le travail fini tôt"],
  ["couleurs", "🎨", "Le moins de filaments", "Enchaîner les mêmes couleurs : le moins de bobines à changer"],
  ["debit", "⚡", "Le plus d'impressions", "Les plus courtes d'abord : le plus d'impressions finies chaque jour"],
  ["nuits", "🌙", "Remplir les temps morts", "Le long du soir finit au plus près de la reprise : l'imprimante tourne la nuit"]];
export function PlanSettings({ s, onSave, onClose }) {
  const [gap, setGap] = useState(String(s?.gap ?? 15));
  const [optMode, setOptMode] = useState(s?.opt_mode || "mix");
  const [autoNew, setAutoNew] = useState(s?.auto_new || "off");
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
  const save = async () => { setBusy(true); try { await onSave({ gap: Math.max(0, parseInt(gap) || 0), run, launch, opt_mode: optMode, auto_new: autoNew }); } finally { setBusy(false); } };
  const modes = (v, set, extra) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {[...(extra ? [extra] : []), ...OPT_MODES].map(([k, ic, l, tip]) => <button key={k} type="button" data-tip={tip} onClick={() => set(k)}
      style={{ ...seg, ...(v === k ? segOn : {}) }}>{ic} {l}</button>)}</div>;
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
    <div>
      <div style={lab}>✨ Mode d'optimisation proposé</div>
      {modes(optMode, setOptMode)}
      <div style={hint}>Celui que « Optimiser la file » propose d'office ; tu peux en choisir un autre à chaque fois.</div>
    </div>
    <div>
      <div style={lab}>➕ Nouveaux plateaux</div>
      {modes(autoNew, setAutoNew, ["off", "⏬", "En fin de file", "Comme avant : après les autres retenus"])}
      <div style={hint}>Un modèle que tu retiens, un exemplaire de plus : ses plateaux vont en fin de file, ou se placent tout seuls à la
        meilleure place selon ce mode. Rien d'autre ne bouge : ce que tu as rangé ou optimisé reste tel quel.</div>
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

// la journee couleur : tous les plateaux d'un filament, de tous les objets, sur ce jour. La liste s'ouvre DANS le
// cadre, sur toute sa largeur (05/11/2026 : en menu flottant, elle debordait de la colonne et coupait les noms)
export function ColorDay({ colors, onPick }) {
  const [open, setOpen] = useState(false);
  if (!colors?.length) return null;
  return <>
    <button type="button" onClick={() => setOpen(v => !v)} data-tip="Poser sur ce jour tous les plateaux d'un même filament, de tous les objets"
      style={{ ...seg, padding: "4px 10px", color: "#EC4899", ...(open ? { background: "color-mix(in srgb, #EC4899 10%, var(--surface2))" } : {}) }}>
      🎨 Journée couleur {open ? "▴" : "▾"}</button>
    {open && <div style={{ flex: "1 0 100%", display: "flex", flexDirection: "column", gap: 2, padding: 4, borderRadius: 12,
      border: "1px solid color-mix(in srgb, #EC4899 30%, var(--border))", background: "var(--surface)", maxHeight: 320, overflowY: "auto" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", padding: "4px 6px" }}>
        Les plateaux qui n'utilisent que ce filament remplissent ce jour au maximum, puis ceux qui ne demandent en plus qu'un filament déjà chargé ; ceux qui n'y tiennent pas restent où ils étaient.</div>
      {colors.map(c => <button key={c.filament_id} type="button" onClick={() => { setOpen(false); onPick(c.filament_id); }}
        style={{ display: "grid", gridTemplateColumns: "14px minmax(0, 1fr)", columnGap: 8, rowGap: 1, alignItems: "center", width: "100%", padding: "6px 8px",
          borderRadius: 9, border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}>
        <Dot f={c}/>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text2)", lineHeight: 1.25 }}>{c.name}</span>
        <span/>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{c.count} plateau{c.count > 1 ? "x" : ""} · {hm(c.seconds)}</span>
      </button>)}
    </div>}
  </>;
}

// l'ecart entre la fin prevue au lancement et celle estimee maintenant (05/11/2026) : « +21 min » en orange (en retard),
// « −8 min » en vert (en avance)
export function endDrift(planned, end) {
  if (!planned || !end) return null;
  const m = Math.round((new Date(end) - new Date(planned)) / 60000);
  if (Math.abs(m) < 2) return { m: 0, txt: "à l'heure", c: "#16A34A" };
  const a = Math.abs(m), t = a < 60 ? `${a} min` : `${Math.floor(a / 60)} h${a % 60 ? ` ${String(a % 60).padStart(2, "0")}` : ""}`;
  return { m, txt: m > 0 ? `+${t}` : `−${t}`, c: m > 0 ? "#EA580C" : "#16A34A" };
}
// les deux tuiles du haut du calendrier (05/11/2026) : l'impression en cours (debut, fin estimee, avancement) et les
// prochains plateaux du planning (debut -> fin)
const whenTxt = (isoStr, now) => {
  if (!isoStr) return "";
  const d = isoStr.slice(0, 10), t = hhmm(isoStr), today = (now || "").slice(0, 10);
  if (d === today) return t;
  const tm = new Date(`${today}T12:00`); tm.setDate(tm.getDate() + 1);
  const tomorrow = `${tm.getFullYear()}-${String(tm.getMonth() + 1).padStart(2, "0")}-${String(tm.getDate()).padStart(2, "0")}`;
  return d === tomorrow ? `demain ${t}` : `${new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} ${t}`;
};
export function NowNextTiles({ pd, onOpenPrint, onPickJob, wide }) {
  const live = pd?.live, now = pd?.now;
  const next = (pd?.jobs || []).slice(0, wide ? 4 : 3);
  const card = { flex: "1 1 280px", minWidth: 0, borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface)", padding: 10,
    display: "flex", flexDirection: "column", gap: 7 };
  const head = (ic, t, c) => <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: c }}>{ic} {t}</div>;
  let pct = null;
  if (live?.start && pd?.busy_until) {
    const a = new Date(live.start).getTime(), b = new Date(pd.busy_until).getTime(), n = new Date(now).getTime();
    if (b > a) pct = Math.max(0, Math.min(1, (n - a) / (b - a)));
  }
  return <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
    <div style={{ ...card, borderColor: live ? "color-mix(in srgb, #3B82F6 40%, var(--border))" : "var(--border)" }}>
      {head("⏳", "En cours", "#3B82F6")}
      {live ? <button type="button" onClick={() => live.print_id && onOpenPrint({ id: live.print_id })}
        style={{ display: "flex", gap: 10, alignItems: "center", border: "none", background: "none", padding: 0, cursor: live.print_id ? "pointer" : "default",
          textAlign: "left", font: "inherit", minWidth: 0 }}>
        {live.print_id && <img src={apiThumb(apiUrl(`/prints/${live.print_id}/image`), 96)} alt="" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover",
          flexShrink: 0, background: "var(--surface2)" }} onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>}
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ fontSize: 13.5, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{live.title || live.name}</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)" }}>
            {live.start ? `${whenTxt(live.start, now)} → ` : ""}<span style={{ color: "#2563EB" }}>fin vers {whenTxt(pd.busy_until, now)}</span>
            <span style={{ color: "var(--muted)", fontWeight: 700 }}> · encore {hm(live.remaining_min * 60)}</span></span>
          {live.planned_end && (() => { const dr = endDrift(live.planned_end, pd.busy_until); return dr && <span style={{ display: "flex", alignItems: "center", gap: 6,
            fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
            prévue au lancement : <b style={{ color: "var(--text2)" }}>{whenTxt(live.planned_end, now)}</b>
            <span style={{ fontWeight: 900, color: dr.c, background: `color-mix(in srgb, ${dr.c} 14%, transparent)`, borderRadius: 7, padding: "0 6px" }}>{dr.txt}</span></span>; })()}
          {pct != null && <span style={{ height: 6, borderRadius: 4, background: "var(--surface2)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${pct * 100}%`, background: "linear-gradient(90deg, #3B82F6, #60A5FA)" }}/></span>}
        </span>
      </button> : <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>Rien n'imprime en ce moment.</span>}
    </div>
    <div style={card}>
      {head("⏭", "Prochaines", "#16A34A")}
      {!next.length && <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>Rien de prévu.</span>}
      {next.map(j => <button key={j.key} type="button" onClick={() => onPickJob(j)}
        style={{ display: "flex", gap: 8, alignItems: "center", border: "none", background: "none", padding: 0, cursor: "pointer", textAlign: "left", font: "inherit", minWidth: 0 }}>
        <PlateThumb j={j} size={34}/>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {j.completes ? "🏁 " : ""}{unretained(j) ? "○ " : ""}{j.title}<span style={{ color: "#6366F1" }}>{j.plates_total > 1 ? ` · ${j.plate}/${j.plates_total}` : ""}</span></span>
          <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: "var(--text2)" }}>{whenTxt(j.start, now)} → {whenTxt(j.end, now)}</span> · {hm(j.seconds)}
            {j.load?.length ? <span style={{ color: "#EA580C" }}> · 🧵 {j.load.join(", ")}</span> : ""}</span>
        </span>
      </button>)}
    </div>
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

const act = { height: 26, padding: "0 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)",
  cursor: "pointer", fontSize: 11.5, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" };
const mini = { width: 26, height: 24, borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)", cursor: "pointer",
  fontSize: 12, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px" };
const seg = { padding: "5px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", fontSize: 12, fontWeight: 800, cursor: "pointer" };
const segOn = { color: "#6366F1", borderColor: "color-mix(in srgb, #6366F1 45%, var(--border))", background: "color-mix(in srgb, #6366F1 10%, var(--surface2))" };
const tin = { padding: "5px 8px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13, fontWeight: 700 };
const lab = { fontSize: 12.5, fontWeight: 900, color: "var(--text2)", marginBottom: 6 };
const hint = { fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45, marginTop: 5 };
