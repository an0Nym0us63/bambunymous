import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiThumb, apiUrl } from "../api/client";
import { colorBg, parseColorsList, finishOf } from "../utils/colors";
import MwImg from "./MwImg";

// Le planning des impressions (05/11/2026) : les briques du calendrier. La journee en frise (heures de fonctionnement,
// de lancement, impressions faites et prevues), ses travaux prevus a ranger, les consignes, les conseils.
// Les travaux et leurs raisons viennent du serveur (services/planner.py) : la page ne fait que les montrer et ranger.

export const hm = s => { const m = Math.round((s || 0) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
export const hhmm = iso => iso ? iso.slice(11, 16).replace(":", " h ").replace(/ h 00$/, " h").replace(/^0(?=\d)/, "") : "";
export const jobName = j => `${j.title}${j.plates_total > 1 ? ` · plateau ${j.plate}` : ""}${j.qty > 1 ? ` · ${j.copy}/${j.qty}` : ""}`;
// le plateau qui termine un objet : « 🏁 Objet terminé » (« 1 sur 2 » quand il en faut plusieurs)
// deux niveaux (06/11/2026) : 🏁 un exemplaire termine (il en reste), 🏆 le modele entierement fini (le dernier exemplaire)
export const isFinal = j => !!j.completes && j.completes >= (j.qty || 1);
export const finIc = (j, sep = "") => j.completes ? `${isFinal(j) ? "🏆" : "🏁"}${sep}` : "";
export const doneTxt = j => !j.completes ? null : isFinal(j) ? `🏆 Fini${j.qty > 1 ? ` · les ${j.qty} exemplaires` : ""}` : `🏁 Exemplaire ${j.completes}/${j.qty}`;
// les couleurs : le modele fini, franc ; un exemplaire, pale
export const finBorder = j => isFinal(j) ? "2.5px solid #059669" : "1.5px solid #10B981";
export const finBg = (j, base = "var(--surface)") => isFinal(j)
  ? `linear-gradient(135deg, color-mix(in srgb, #10B981 30%, ${base}), color-mix(in srgb, #10B981 12%, ${base}))`
  : `color-mix(in srgb, #10B981 10%, ${base})`;
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
  // un long tag passe a la ligne dans la carte (06/11/2026 : « intercale dans … » debordait)
  const tag = (txt, c, tip) => <span data-tip={tip} style={{ fontSize: 11, fontWeight: 900, maxWidth: "100%", overflowWrap: "anywhere", lineHeight: 1.35, color: c,
    borderRadius: 7, padding: "1px 7px", background: `color-mix(in srgb, ${c} 13%, transparent)` }}>{txt}</span>;
  return <div draggable={edit} onDragStart={e => { e.dataTransfer.setData("text/bn-job", j.key); e.dataTransfer.effectAllowed = "move"; onDrag?.(j.key); }}
    onDragEnd={() => onDrag?.(null)}
    onDragOver={e => { if (edit && e.dataTransfer.types.includes("text/bn-job")) { e.preventDefault(); e.stopPropagation(); setOver(true); } }}
    onDragLeave={() => setOver(false)}
    onDrop={e => { const k = e.dataTransfer.getData("text/bn-job"); setOver(false); if (k && k !== j.key) { e.preventDefault(); e.stopPropagation(); onDropBefore?.(k, j.key); } }}
    onClick={compact ? onOpen : undefined}
    style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, borderRadius: 13, cursor: compact ? "pointer" : edit ? "grab" : "default", opacity: dragging === j.key ? 0.45 : 1,
      border: `${j.locked || isFinal(j) ? 2 : 1.5}px ${j.completes || j.locked ? "solid" : "dashed"} ${j.too_long ? "#EF4444" : j.locked ? "#4F46E5" : unretained(j) ? UNRET : j.completes ? (isFinal(j) ? GOLD : "#10B981") : "color-mix(in srgb, #22C55E 50%, var(--border))"}`,
      boxShadow: over ? "0 -3px 0 0 #6366F1" : "none",
      background: j.completes ? `linear-gradient(120deg, color-mix(in srgb, ${GOLD} ${isFinal(j) ? 22 : 9}%, transparent), transparent 60%), var(--surface2)`
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
          {j.prio_m ? <span data-tip={`Priorité ${["très basse", "basse", "", "haute", "urgente"][j.prio_m + 2]}`} style={{ fontSize: 11 }}>
            {["⏬", "⬇", "", "⬆", "🔥"][j.prio_m + 2]}</span> : null}
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
    {(j.completes || j.due || j.load?.length > 0 || j.runout?.length > 0 || j.bed_change || j.bed_warn || j.merged || unretained(j) || j.locked || j.awaits_order?.length > 0 || j.low_after?.length > 0) && <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {j.awaits_order?.length > 0 && tag(`🚚 compte sur la commande : ${j.awaits_order.join(", ")}`, "#0EA5E9", "Le stock ne suffit pas : ce plateau prend sur une bobine commandée, pas encore reçue")}
      {j.low_after?.length > 0 && tag(`📉 sous le seuil : ${j.low_after.join(", ")}`, "#DC2626", "Après ce plateau, il restera moins d'un quart de bobine de ce filament")}
      {j.locked && tag(`🔒 figé à ${hhmm(j.start)}`, "#4F46E5", "Figé à ce jour et cette heure : optimiser, journée couleur, au mieux ou plus tard ne le déplacent pas")}
      {unretained(j) && tag("○ non retenu", "#64748B", "Profil par défaut, pas retenu dans « À faire » : planifié après les modèles retenus. Retiens-le depuis sa fiche (sa vignette) pour le planifier en priorité")}
      {j.completes && tag(doneTxt(j), "#047857", isFinal(j) ? "Avec ce plateau, le modèle est entièrement fini" : "Avec ce plateau, un exemplaire de l'objet est complet ; il en reste d'autres")}
      {j.intercalated && tag(`↔ intercalé dans ${j.intercalated.in}`, "#0EA5E9", { nuit: "Pour remplir la nuit", filaments: "Pour charger moins de filaments" }[j.intercalated.why]
        || "Pour optimiser le planning")}
      {j.due && tag(`🎯 avant le ${dueTxt(j.due)}`, j.due_ok ? "#16A34A" : "#EF4444", j.due_ok ? "L'objet sera fini à temps" : "Le dernier plateau de l'objet finit après cette date")}
      {j.load?.length > 0 && tag(<>🧵 À charger : <FilLinks labels={j.load} ids={j.load_ids}/>{j.free_slot && !j.unload?.length ? " (emplacement libre)" : ""}</>, "#EA580C",
        j.free_slot && !j.unload?.length ? "Pas dans l'AMS à ce moment-là ; un emplacement est libre, rien à retirer" : "Pas dans l'AMS à ce moment-là")}
      {j.merged && tag(`🧩 ${j.plate_name || "Regroupés"}`, "#6366F1", "Imprimés ensemble sur un seul plateau : regroupe-les dans Bambu Studio avant de lancer")}
      {j.bed_change && tag(bedTxt(j.bed_change), "#0369A1", j.bed_warn || "Le plateau que demande ce profil, ou un des tiens qui va à ce filament")}
      {!j.bed_change && j.bed_warn && tag(`🔲 ${j.bed_warn}`, "#B45309", "Paramètres › Imprimante › Plateaux d'impression")}
      {j.unload?.length > 0 && tag(<>↩ À retirer : <FilLinks labels={j.unload} ids={j.unload_ids}/></>, "#64748B", "Celle qui resservira le plus tard (ou plus du tout) : on la sort pour faire la place")}
      {(j.runout || []).map(r => <React.Fragment key={r.name}>{tag(<>🔄 <FilLink id={r.id} label={r.name}/>{runoutTxt(r).slice(3 + r.name.length)}</>, "#B45309", "La bobine chargée ne suffit pas : prépare-en une autre de ce filament pour cette heure-là")}</React.Fragment>)}
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
// un jour particulier (06/11/2026) : absent (rien ne se lance), peu dispo (une seule heure de lancement)
export const DAY_KIND = { absent: ["🏖", "Absent", "#0EA5E9", "Rien ne se lance ; une impression lancée avant finit quand même"],
  light: ["⏳", "Peu dispo", "#F59E0B", "Une seule heure de lancement, la première de ta plage : un long y part, un autre la veille au soir"] };
export const dayKindOf = (settings, day) => (settings?.days_off || []).find(x => x.from <= day && day <= x.to)?.kind || null;
// les signes d'un plateau prevu (06/11/2026), les memes partout dans le calendrier ; LEGEND les explique
export const PRIO_IC = { 2: "🔥", 1: "⬆", "-1": "⬇", "-2": "⏬" };
export const planIcons = j => [j.locked ? "🔒" : j.pinned ? "📌" : "", PRIO_IC[j.prio_m] || "", finIc(j), unretained(j) ? "○" : "",
  j.due && !j.due_ok ? "🎯" : "", j.intercalated ? "↔" : "", j.bed_change ? "🔲" : "", j.merged ? "🧩" : "", j.load?.length ? "🧵" : "", j.runout?.length ? "🔄" : ""].filter(Boolean).join("");
export const LEGEND = [
  ["Les impressions", [["▮", "Bloc plein, de la couleur de son état : une impression faite (réussie, échouée, annulée) ou en cours"],
    ["┆", "Bloc hachuré, bord en pointillés : un plateau prévu par le planning, libre"],
    ["▯", "Bord plein : un plateau prévu figé (jour et heure), ou qui termine un objet"],
    ["○", "Gris : un modèle pas retenu dans « À faire » (profil par défaut), prévu après les retenus"]]],
  ["Figer", [["📌", "Jour figé : il reste ce jour-là, l'heure peut bouger"], ["🔒", "Jour et heure figés : rien ne le déplace"]]],
  ["Priorité", [["🔥", "Urgent : devant tous les autres retenus"], ["⬆", "Haute"], ["⬇", "Basse"], ["⏬", "Très basse"]]],
  ["Filaments", [["🧵", "Une bobine à charger avant de le lancer"], ["↩", "La bobine à retirer pour faire la place"],
    ["🔄", "La bobine chargée se videra pendant l'impression : en préparer une autre"],
    ["🔲", "Changer de plateau d'impression avant de lancer (celui que demande le profil, ou un qui va au filament)"], ["🚚", "Compte sur une commande pas encore reçue"],
    ["📉", "Un filament passera sous le seuil (un quart de bobine)"]]],
  ["Le reste", [["🏆", "Avec ce plateau, le modèle est entièrement fini (tous ses exemplaires)"], ["🏁", "Avec ce plateau, un exemplaire est complet (il en reste d'autres)"], ["🎯", "Date limite (rouge : il finira après)"],
    ["↔", "Intercalé dans un objet « au mieux » (pour remplir une nuit, ou charger moins)"],
    ["🧩", "Plusieurs plateaux du modèle regroupés en une seule impression (à faire dans Bambu Studio)"], ["⛔", "Non planifiable : le stock et les commandes ne suffisent pas"],
    ["🏖", "Jour où tu es absent"], ["⏳", "Jour peu dispo"], ["↶", "Annuler le dernier geste"]]],
];
export function Legend() {
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {LEGEND.map(([t, rows]) => <div key={t}>
      <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#6366F1", marginBottom: 5 }}>{t}</div>
      {rows.map(([ic, txt]) => <div key={ic + txt} style={{ display: "flex", gap: 9, alignItems: "baseline", padding: "3px 0" }}>
        <span style={{ width: 22, textAlign: "center", flexShrink: 0, fontSize: 14 }}>{ic}</span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text2)", lineHeight: 1.4 }}>{txt}</span></div>)}
    </div>)}
  </div>;
}
// le tableau de bord du planning (06/11/2026) : une ligne, l'essentiel ; tout fini quand, les bobines a charger, les
// nuits perdues, les dates limites, les durees corrigees
export function PlanDashboard({ s, dur, now, onLegend, cells = false, compact = false }) {
  if (!s || !s.plates) return null;
  // en cases (06/11/2026, l'en-tete du calendrier sur ordinateur) : un chiffre et son libelle, alignes, sans pastilles
  if (cells) {
    const when = iso => { const d = new Date(iso), t = new Date(`${(now || "").slice(0, 10)}T12:00`), days = Math.round((new Date(`${iso.slice(0, 10)}T12:00`) - t) / 864e5);
      return [days === 0 ? "aujourd'hui" : days === 1 ? "demain" : d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }), hhmm(iso)]; };
    const cs = [["📋", `${s.plates}`, `plateau${s.plates > 1 ? "x" : ""} prévu${s.plates > 1 ? "s" : ""}`, null, "Les plateaux prévus"],
      s.end && ["🏁", when(s.end)[1], `tout fini ${when(s.end)[0]}`, null, "Quand le dernier plateau de la file finira"],
      ["🧵", `${s.loads}`, `bobine${s.loads > 1 ? "s" : ""} à charger`, s.loads ? "#EA580C" : null, "Les chargements de bobine que demande toute la file"],
      s.beds > 0 && ["🔲", `${s.beds}`, `changement${s.beds > 1 ? "s" : ""} de plateau`, "#0369A1", "Les changements de plateau d'impression que demande toute la file"],
      s.nights > 0 && ["🌙", `${s.nights}`, `nuit${s.nights > 1 ? "s" : ""} perdue${s.nights > 1 ? "s" : ""} · ${hm(s.idle_min * 60)}`, "#6366F1", "Les nuits où l'imprimante attend l'heure de lancement : « Optimiser » peut les remplir"],
      s.late > 0 && ["🎯", `${s.late}`, `date${s.late > 1 ? "s" : ""} limite${s.late > 1 ? "s" : ""} ratée${s.late > 1 ? "s" : ""}`, "#DC2626", "Voir les conseils"],
      dur && Math.abs((dur.factor || 1) - 1) > 0.005 && ["⏱", `${dur.factor > 1 ? "+" : ""}${Math.round((dur.factor - 1) * 100)} %`, "sur les durées", null, "Durées corrigées (Consignes › Durées)"],
    ].filter(Boolean);
    return <div style={{ display: "flex", alignItems: "stretch", minWidth: 0 }}>
      {cs.map(([ic, v, l, c, tip], i) => <div key={i} data-tip={tip} style={{ flex: compact ? "0 0 auto" : "1 1 0", minWidth: compact ? 92 : 0, padding: compact ? "1px 10px" : "2px 12px",
        borderLeft: i ? "1px solid var(--border)" : "none" }}>
        <div style={{ fontSize: compact ? 14.5 : 16, fontWeight: 900, color: c || "var(--text)", whiteSpace: "nowrap", lineHeight: 1.2 }}><span style={{ fontSize: compact ? 12 : 13, marginRight: 5 }}>{ic}</span>{v}</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l}</div>
      </div>)}
      {onLegend && <button type="button" onClick={onLegend} aria-label="Ce que disent les signes" data-tip="Ce que disent les signes et les couleurs"
        style={{ alignSelf: "center", flexShrink: 0, width: 28, height: 28, marginLeft: 8, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--surface2)",
          color: "var(--muted)", fontSize: 13, fontWeight: 900, cursor: "pointer" }}>?</button>}
    </div>;
  }
  const when = iso => { const d = new Date(iso), t = new Date(`${(now || "").slice(0, 10)}T12:00`), days = Math.round((new Date(`${iso.slice(0, 10)}T12:00`) - t) / 864e5);
    return `${days === 0 ? "aujourd'hui" : days === 1 ? "demain" : d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" })} ${hhmm(iso)}`; };
  const chip = (k, txt, tip, c = "var(--text2)") => <span key={k} data-tip={tip} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4,
    padding: "4px 10px", borderRadius: 20, border: "1px solid var(--border)", background: "var(--surface)", fontSize: 12, fontWeight: 800, color: c, whiteSpace: "nowrap" }}>{txt}</span>;
  return <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", alignItems: "center" }}>
    {chip("p", `📋 ${s.plates} plateau${s.plates > 1 ? "x" : ""}`, "Les plateaux prévus")}
    {s.end && chip("e", `🏁 tout fini ${when(s.end)}`, "Quand le dernier plateau de la file finira", "var(--text)")}
    {chip("l", `🧵 ${s.loads} bobine${s.loads > 1 ? "s" : ""} à charger`, "Les chargements de bobine que demande toute la file", s.loads ? "#EA580C" : "var(--text2)")}
    {s.beds > 0 && chip("b", `🔲 ${s.beds} changement${s.beds > 1 ? "s" : ""} de plateau`, "Les changements de plateau d'impression que demande toute la file", "#0369A1")}
    {s.nights > 0 && chip("n", `🌙 ${s.nights} nuit${s.nights > 1 ? "s" : ""} perdue${s.nights > 1 ? "s" : ""} · ${hm(s.idle_min * 60)}`, "Les nuits où l'imprimante attend l'heure de lancement : « Optimiser » peut les remplir", "#6366F1")}
    {s.late > 0 && chip("d", `🎯 ${s.late} date${s.late > 1 ? "s" : ""} limite${s.late > 1 ? "s" : ""} ratée${s.late > 1 ? "s" : ""}`, "Voir les conseils", "#DC2626")}
    {dur && Math.abs((dur.factor || 1) - 1) > 0.005 && chip("u", `⏱ durées ${dur.factor > 1 ? "+" : ""}${Math.round((dur.factor - 1) * 100)} %`, "Durées corrigées (Consignes › Durées)")}
    {onLegend && <button type="button" onClick={onLegend} aria-label="Ce que disent les signes" data-tip="Ce que disent les signes et les couleurs"
      style={{ flexShrink: 0, width: 28, height: 28, borderRadius: "50%", border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)",
        fontSize: 13, fontWeight: 900, cursor: "pointer" }}>?</button>}
  </div>;
}

// le changement de bobine d'un plateau (06/11/2026), en court : « Bleu ciel à la place de Silver » (la double fleche ⇄ ne disait pas
// laquelle charger ; charger l'un a la place de
// l'autre), « Bleu ciel (place libre) » ; swapLong le dit en phrase
// qui remplace qui (06/11/2026) : swap_out, aligne sur load, dit pour chacun la bobine dont il prend la place (null : une
// place libre ; les premiers charges prennent les places libres) ; l'ancien appariement par rang sinon
const outOf = (j, i) => j.swap_out ? [j.swap_out[i], j.swap_out_ids?.[i]] : [j.unload?.[i], j.unload_ids?.[i]];
const freeOf = (j, i) => j.swap_out ? j.swap_out[i] == null : !!j.free_slot;
export const swapTxt = j => !j.load?.length ? "" : j.load.map((x, i) => outOf(j, i)[0] ? `${x} à la place de ${outOf(j, i)[0]}` : `${x}${freeOf(j, i) ? " (place libre)" : ""}`).join(", ");
export const swapLong = j => !j.load?.length ? "" : j.load.map((x, i) => outOf(j, i)[0] ? `charger ${x} à la place de ${outOf(j, i)[0]}`
  : `charger ${x}${freeOf(j, i) ? " dans l'emplacement libre" : ""}`).join(", ");
// le plateau d'impression (06/11/2026) : son nom, et le changement a faire avant un plateau du planning
export const BED_NAMES = { textured: "PEI texturé", supertack: "SuperTack", cool: "Cool Plate", hot: "PEI lisse", eng: "Engineering" };
export const bedTxt = ch => ch ? `🔲 Mets le ${BED_NAMES[ch.to] || ch.to}${ch.from ? ` (à la place du ${BED_NAMES[ch.from] || ch.from})` : ""}` : "";
// les couleurs des filaments du planning (06/11/2026), rendues par le serveur avec le planning : chaque page qui le lit
// les donne (setFilColors) ; FilLink y prend la pastille
const FCOL = {};
export const setFilColors = m => { if (m) Object.assign(FCOL, m); };
export function FilDot({ id, size = 10 }) {
  const c = FCOL[id];
  if (!c) return null;
  return <span aria-hidden="true" style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", verticalAlign: "-1px", marginRight: 4, flexShrink: 0,
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,.18)", ...colorBg(parseColorsList(c.color, c.colors_array), c.multicolor_type, finishOf(c), { size }) }}/>;
}
// un filament nomme en entier (« TPU 95A Bambu · Noir »), avec sa pastille, qui ouvre sa fiche (06/11/2026)
export function FilLink({ id, label }) {
  const nav = useNavigate();
  if (!id) return <>{label}</>;
  return <span role="link" tabIndex={0} data-tip="Ouvrir la fiche du filament" onClick={e => { e.stopPropagation(); nav(`/filaments?id=${id}`); }}
    style={{ cursor: "pointer", whiteSpace: "normal" }}><FilDot id={id}/><span style={{ textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}>{label}</span></span>;
}
// le changement de bobine, en court et en pastilles : « ● X à la place de ● Y » (celle qui sort, plus pale), « ● X (place libre) »
export const SwapShort = ({ j }) => <>{(j.load || []).map((x, i) => <React.Fragment key={i}>{i ? ", " : ""}<FilLink id={j.load_ids?.[i]} label={x}/>
  {outOf(j, i)[0] ? <><span style={{ fontWeight: 600, opacity: 0.75 }}> à la place de </span><span style={{ opacity: 0.7 }}><FilLink id={outOf(j, i)[1]} label={outOf(j, i)[0]}/></span></> : freeOf(j, i) ? " (place libre)" : ""}</React.Fragment>)}</>;
export const FilLinks = ({ labels, ids }) => <>{(labels || []).map((l, i) => <React.Fragment key={i}>{i ? ", " : ""}<FilLink id={ids?.[i]} label={l}/></React.Fragment>)}</>;
// le changement de bobine en phrase, ses filaments cliquables : « charger X a la place de Y »
export const SwapLinks = ({ j }) => <>{(j.load || []).map((x, i) => <React.Fragment key={i}>{i ? ", " : ""}charger <FilLink id={j.load_ids?.[i]} label={x}/>
  {outOf(j, i)[0] ? <> à la place de <FilLink id={outOf(j, i)[1]} label={outOf(j, i)[0]}/></> : freeOf(j, i) ? " dans l'emplacement libre" : ""}</React.Fragment>)}</>;
// la fin de la journee (06/11/2026) : le dernier plateau prevu aujourd'hui finit vers telle heure ; combien encore
export const dayEnd = p => {
  const today = (p?.now || "").slice(0, 10), js = (p?.jobs || []).filter(j => j.day === today);
  if (!js.length) return null;
  const end = js.reduce((a, j) => j.end > a ? j.end : a, js[0].end);
  return { n: js.length, end, txt: `fin de journée vers ${hhmm(end)} · ${js.length} plateau${js.length > 1 ? "x" : ""} encore` };
};
// une bobine qui se videra en pleine impression (06/11/2026) : vers quelle heure
export const runoutTxt = r => `🔄 ${r.name} se vide vers ${+r.at.slice(11, 13)} h${r.at.slice(14, 16) !== "00" ? ` ${r.at.slice(14, 16)}` : ""} (reste ${r.left} g, il en faut ${r.need})`;
// les creneaux de chargement (06/11/2026) : jusqu'a quatre plages
function LoadWins({ list, set }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {list.map((w, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>de</span>
      <input type="time" value={w.from} onChange={e => set(list.map((x, k) => k === i ? { ...x, from: e.target.value } : x))} style={tin}/>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>à</span>
      <input type="time" value={w.to} onChange={e => set(list.map((x, k) => k === i ? { ...x, to: e.target.value } : x))} style={tin}/>
      <button type="button" onClick={() => set(list.filter((_, k) => k !== i))} aria-label="Retirer" style={mini}>✕</button>
    </div>)}
    {list.length < 4 && <button type="button" onClick={() => set([...list, list.length ? { from: "19:00", to: "23:00" } : { from: "08:00", to: "09:00" }])}
      style={{ ...seg, alignSelf: "flex-start" }}>＋ {list.length ? "Un autre créneau" : "Un créneau"}</button>}
  </div>;
}
function DaysOff({ list, set }) {
  const [kind, setKind] = useState("absent");
  const [a, setA] = useState(""), [b, setB] = useState("");
  const fr = d => new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  const today = new Date().toISOString().slice(0, 10);
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {list.map((x, i) => { const [ic, l, c] = DAY_KIND[x.kind] || DAY_KIND.absent;
      return <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderRadius: 10,
        border: `1px solid color-mix(in srgb, ${c} 40%, var(--border))`, background: `color-mix(in srgb, ${c} 8%, var(--surface2))` }}>
        <span style={{ fontSize: 15 }}>{ic}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>{l} · {x.from === x.to ? fr(x.from) : `du ${fr(x.from)} au ${fr(x.to)}`}</span>
        <button type="button" onClick={() => set(list.filter((_, k) => k !== i))} aria-label="Retirer" style={mini}>✕</button>
      </div>; })}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {Object.entries(DAY_KIND).map(([k, [ic, l, , tip]]) => <button key={k} type="button" data-tip={tip} onClick={() => setKind(k)}
        style={{ ...seg, ...(kind === k ? segOn : {}) }}>{ic} {l}</button>)}
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>du</span>
      <input type="date" value={a} min={today} onChange={e => { setA(e.target.value); if (!b || b < e.target.value) setB(e.target.value); }} style={tin}/>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>au</span>
      <input type="date" value={b} min={a || today} onChange={e => setB(e.target.value)} style={tin}/>
      <button type="button" disabled={!a} onClick={() => { set([...list, { from: a, to: b || a, kind }].sort((x, y) => x.from.localeCompare(y.from))); setA(""); setB(""); }}
        style={{ ...seg, ...(a ? segOn : { opacity: 0.5 }) }}>＋ Ajouter</button>
    </div>
  </div>;
}
export function PlanSettings({ s, dur, onSave, onClose }) {
  const [gap, setGap] = useState(String(s?.gap ?? 15));
  const [optMode, setOptMode] = useState(s?.opt_mode || "mix");
  const [autoNew, setAutoNew] = useState(s?.auto_new || "off");
  const [daysOff, setDaysOff] = useState(s?.days_off || []);
  const [run, setRun] = useState(s?.run || null);
  const [launch, setLaunch] = useState(s?.launch || null);
  const [loadWin, setLoadWin] = useState(s?.load_win || []);
  const [durMode, setDurMode] = useState(s?.dur_mode || "off");
  const [durPct, setDurPct] = useState(String(s?.dur_pct ?? 0));
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
  const save = async () => { setBusy(true); try { await onSave({ gap: Math.max(0, parseInt(gap) || 0), run, launch, opt_mode: optMode, auto_new: autoNew, days_off: daysOff, load_win: loadWin, dur_mode: durMode, dur_pct: parseInt(durPct) || 0 }); } finally { setBusy(false); } };
  const modes = (v, set, extra) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {[...(extra ? [extra] : []), ...OPT_MODES].map(([k, ic, l, tip]) => <button key={k} type="button" data-tip={tip} onClick={() => set(k)}
      style={{ ...seg, ...(v === k ? segOn : {}) }}>{ic} {l}</button>)}</div>;
  // dans une fenetre (06/11/2026) : le titre et la croix sont ceux de la fenetre, Enregistrer reste en bas
  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
      {/* les durees (06/11/2026) : l'ecart mesure, en proportion, et le choix de le corriger */}
      <div style={lab}>⏱ Durées des impressions</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", marginBottom: 6 }}>{dur?.n
        ? <>Tes impressions durent en moyenne <b style={{ color: dur.pct > 0 ? "#EA580C" : dur.pct < 0 ? "#16A34A" : "var(--text)" }}>
          {dur.pct > 0 ? `${dur.pct} % de plus` : dur.pct < 0 ? `${-dur.pct} % de moins` : "le temps prévu"}</b>{dur.pct ? " que prévu" : ""} (sur tes {dur.n} dernières réussies).</>
        : "Pas encore assez d'impressions réussies pour mesurer l'écart."}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {[["off", "Telles quelles"], ["auto", `Corrigées${dur?.n ? ` (${dur.pct > 0 ? "+" : ""}${dur.pct} %)` : ""}`], ["manual", "À la main"]].map(([k, l]) =>
          <button key={k} type="button" disabled={k === "auto" && !dur?.n} onClick={() => setDurMode(k)} style={{ ...seg, ...(durMode === k ? segOn : {}), ...(k === "auto" && !dur?.n ? { opacity: 0.5 } : {}) }}>{l}</button>)}
        {durMode === "manual" && <><input inputMode="numeric" value={durPct} onChange={e => setDurPct(e.target.value.replace(/[^-\d]/g, "").slice(0, 3))} style={{ ...tin, width: 60 }}/>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>%</span></>}
      </div>
      <div style={hint}>En proportion de la durée : +5 %, c'est 3 min sur une heure et 30 min sur 10 h. Corrigées, chaque plateau prévu dure d'autant plus
        (ou moins), et le planning tombe plus juste. L'impression en cours suit toujours l'imprimante.</div>
    </div>
    <div>
      <div style={lab}>🧵 Créneaux de chargement</div>
      <LoadWins list={loadWin} set={setLoadWin}/>
      <div style={hint}>Quand tu peux changer une bobine. Sans créneau : à toute heure de lancement. Avec « 8 h – 9 h » et « 19 h – 23 h », un plateau qui
        demande une bobine à charger attend l'un d'eux ; les autres partent à toute heure. L'optimiseur en tient compte.</div>
    </div>
    <div>
      <div style={lab}>📅 Jours particuliers</div>
      <DaysOff list={daysOff} set={setDaysOff}/>
      <div style={hint}><b>Absent</b> : rien ne se lance (une impression lancée avant finit quand même). <b>Peu dispo</b> : une seule heure de
        lancement, la première de ta plage ; le planning y lance un long qui couvre la journée, et un long la veille au soir.</div>
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
    <div style={{ position: "sticky", bottom: -12, margin: "0 -12px -12px", padding: "10px 12px", display: "flex", gap: 8, justifyContent: "flex-end",
      background: "var(--sheet-bg)", borderTop: "1px solid var(--border)" }}>
      <button type="button" onClick={onClose} style={{ ...seg, padding: "8px 14px" }}>Annuler</button>
      <button type="button" disabled={busy} onClick={save} style={{ padding: "8px 16px", borderRadius: 12, border: "none", cursor: "pointer",
        background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#fff", fontSize: 13, fontWeight: 900 }}>{busy ? "…" : "Enregistrer"}</button></div>
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
            <span data-tip={live.planned_pct ? `Durée annoncée par le fichier, corrigée de ton écart habituel (${live.planned_pct > 0 ? "+" : ""}${live.planned_pct} %)` : "Durée annoncée par le fichier"}>
              prévue au lancement{live.planned_pct ? ` (${live.planned_pct > 0 ? "+" : ""}${live.planned_pct} %)` : ""} :</span> <b style={{ color: "var(--text2)" }}>{whenTxt(live.planned_end, now)}</b>
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
            {finIc(j, " ")}{unretained(j) ? "○ " : ""}{j.title}<span style={{ color: "#6366F1" }}>{j.plates_total > 1 ? ` · ${j.plate}/${j.plates_total}` : ""}</span></span>
          <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: "var(--text2)" }}>{whenTxt(j.start, now)} → {whenTxt(j.end, now)}</span> · {hm(j.seconds)}
            {j.bed_change ? <span style={{ color: "#0369A1" }}> · 🔲 {BED_NAMES[j.bed_change.to] || j.bed_change.to}</span> : ""}
            {j.load?.length ? <span style={{ color: "#EA580C" }}> · 🧵 <SwapShort j={j}/></span> : ""}
            {j.runout?.length ? <span style={{ color: "#B45309" }}> · 🔄 {j.runout.map(r => r.name).join(", ")}</span> : ""}</span>
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

// les conseils, chacun avec son « Appliquer » quand il deplace un travail ; ranges par sorte (06/11/2026), chaque
// section se replie (garde dans ce navigateur) ; tous, plus seulement les six premiers
// un conseil en phrase : son debut (jusqu'aux deux-points) en gras, le reste en plus doux
const AdvText = ({ t }) => { const i = String(t || "").indexOf(" : ");
  return i > 0 && i < 90 ? <><b style={{ color: "var(--text)", fontWeight: 800 }}>{t.slice(0, i)}</b><span style={{ color: "var(--muted)" }}> · {t.slice(i + 3)}</span></> : t; };
// un regroupement en carte (06/11/2026 : la phrase entiere etait indigeste) : la vignette, le modele, quels plateaux,
// et en pastilles ce qu'on y gagne, comment, et l'objet a imprimer en dernier
function MergeCard({ a, edit, onApply }) {
  const m = a.m, dur = s => { const n = Math.round(s / 60); return n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${String(n % 60).padStart(2, "0")}` : ""}`; };
  const pill = (t, c, tip) => <span data-tip={tip} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 800,
    whiteSpace: "nowrap", color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>{t}</span>;
  return <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: 8, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }}>
    <PlateThumb j={{ thumb: m.thumb }} size={42}/>
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{m.title}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)" }}>
        {m.same ? `${m.plates.length} × le plateau ${m.plates[0]}` : `Plateaux ${m.plates.join(", ")}`} sur un seul plateau{m.colors ? ", couleurs différentes" : ""}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {pill(`⏱ ${dur(m.saved_s)} gagnées`, "#16A34A", "Une chauffe, une calibration, une purge par lancement en moins")}
        {pill(`🚀 ${m.launches} lancement${m.launches > 1 ? "s" : ""} de moins`, "#6366F1")}
        {pill(m.mode === "objet par objet" ? "▦ objet par objet" : "☰ couche par couche", "#0EA5E9",
          m.mode === "objet par objet" ? "Chaque objet imprimé en entier, l'un après l'autre : pas de changement de filament à chaque couche" : "Un seul filament : toutes les couches ensemble")}
        {a.conf && pill(a.conf === "haute" ? "✓ sûr" : "≈ ça tient juste", a.conf === "haute" ? "#16A34A" : "#D97706", `Confiance ${a.conf}`)}
        {m.last && pill(`⬆ ${m.last.label} en dernier`, "#B45309", `${m.last.h} mm, plus haut que la tige (${m.last.rod_h} mm) : à imprimer en dernier`)}
      </div>
    </div>
    {edit && a.action && <button type="button" onClick={() => onApply(a.action)} data-tip="Les regroupe au planning ; à regrouper ensuite dans Bambu Studio"
      style={{ ...seg, ...segOn, padding: "3px 9px", flexShrink: 0 }}>Appliquer</button>}
  </div>;
}
const ADV_KINDS = [["deadline", "🎯", "Dates limites"], ["merge", "🧩", "Regrouper des plateaux"], ["colors", "🎨", "Enchaîner les mêmes couleurs"],
  ["gap", "⏱", "Remplir un creux"], ["load", "🧵", "Bobines à charger"], ["long", "⚠️", "Trop longs pour les horaires"]];
export function PlanAdvice({ items, edit, onApply, at = null }) {
  // fermees a l'ouverture (06/11/2026) : toutes les sortes se voient d'un coup d'oeil, on deplie celle qui interesse
  const [open, setOpen] = useState({});
  if (!items?.length) return null;
  const flip = k => setOpen(s => ({ ...s, [k]: !s[k] }));
  const shut = Object.fromEntries(ADV_KINDS.concat([["other"]]).map(([k]) => [k, !open[k]]));
  const known = new Set(ADV_KINDS.map(k => k[0]));
  const groups = [...ADV_KINDS, ["other", "💡", "Autres"]].map(([k, ic, l]) => [k, ic, l, items.filter(a => k === "other" ? !known.has(a.kind) : a.kind === k)])
    .filter(g => g[3].length);
  return <div style={{ borderRadius: 16, border: "1px solid color-mix(in srgb, #F59E0B 35%, var(--border))", padding: 10, display: "flex", flexDirection: "column", gap: 8,
    background: "linear-gradient(150deg, color-mix(in srgb, #F59E0B 9%, transparent), transparent 70%), var(--surface)" }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#D97706" }}>💡 Conseils</span>
      {/* calcules en fond (06/11/2026) : les derniers, et quand */}
      {at && <span data-tip="Calculés en fond par la tâche du planning, et quelques secondes après chaque changement" style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>
        calculés à {at.slice(11, 16).replace(":", " h ")}</span>}
    </div>
    {groups.map(([k, ic, l, list]) => <div key={k} style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <button type="button" onClick={() => flip(k)} aria-expanded={!shut[k]}
        style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)",
          color: "var(--text)", cursor: "pointer", fontSize: 12.5, fontWeight: 900, textAlign: "left" }}>
        <span>{ic}</span><span style={{ flex: 1 }}>{l}</span>
        <span style={{ fontSize: 11, fontWeight: 900, color: "#D97706", background: "color-mix(in srgb, #F59E0B 14%, transparent)", borderRadius: 20, padding: "1px 7px" }}>{list.length}</span>
        <span style={{ color: "var(--muted)", transform: shut[k] ? "rotate(-90deg)" : "none", transition: "transform .15s" }}>▾</span></button>
      {!shut[k] && list.map((a, i) => a.m ? <MergeCard key={i} a={a} edit={edit} onApply={onApply}/>
        : <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", paddingLeft: 4 }}>
        <span style={{ fontSize: 14 }}>{a.icon}</span>
        <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "var(--text2)", lineHeight: 1.4 }}><AdvText t={a.text}/></span>
        {edit && a.action && <button type="button" onClick={() => onApply(a.action)} style={{ ...seg, ...segOn, padding: "3px 9px", flexShrink: 0 }}>Appliquer</button>}
      </div>)}
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
