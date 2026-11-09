import React, { useState } from "react";
import { createPortal } from "react-dom";
import { showConfirm } from "../utils/dialog";
import { apiThumb, apiUrl } from "../api/client";
import { colorBg, parseColorsList, finishOf } from "../utils/colors";
import PlateRecolor from "./PlateRecolor";
import MwImg from "./MwImg";
import { LocateSheet, SpoolEdge, PlaceView, AmsMap, rootOfSpool, slotIs, useStorage } from "./Storage";
import { FSheet, fBtn } from "./FicheKit";
import { ArrowLeftRight } from "lucide-react";
import { usePrinter } from "../store/printer";
import { isExternal, slotLabel } from "../utils/ams";
import { FilamentSheetFromSpool } from "./LazySheets";

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

// les jours feries en France (06/11/2026), comme le serveur : les fixes, lundi de Paques, Ascension, lundi de Pentecote
const HOL = {};
export function frHolidays(y) {
  if (HOL[y]) return HOL[y];
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  const p2 = n => String(n).padStart(2, "0"), at = (dt, n) => { const x = new Date(dt); x.setDate(x.getDate() + n); return `${x.getFullYear()}-${p2(x.getMonth() + 1)}-${p2(x.getDate())}`; };
  const easter = new Date(y, mo - 1, da, 12);
  const out = { [`${y}-01-01`]: "Jour de l'an", [`${y}-05-01`]: "Fête du travail", [`${y}-05-08`]: "8 mai", [`${y}-07-14`]: "14 juillet",
    [`${y}-08-15`]: "Assomption", [`${y}-11-01`]: "Toussaint", [`${y}-11-11`]: "11 novembre", [`${y}-12-25`]: "Noël",
    [at(easter, 1)]: "Lundi de Pâques", [at(easter, 39)]: "Ascension", [at(easter, 50)]: "Lundi de Pentecôte" };
  HOL[y] = out;
  return out;
}
// ce qu'un jour a de particulier pour le planning (06/11/2026) : ses horaires (ceux du week-end ces jours-la), ferie,
// jour absent ou peu dispo, absences de quelques heures [[debut, fin] en minutes]
export function dayInfo(st, d) {
  if (!st || !d) return { run: null, launch: null, away: [], offIv: [] };
  const wd = new Date(`${d}T12:00`).getDay(), holiday = frHolidays(+d.slice(0, 4))[d] || null;
  const special = !!st.we?.on && (wd === 0 || wd === 6 || (st.we.holidays && !!holiday));
  const off = (st.days_off || []).find(x => x.from <= d && d <= x.to)?.kind || null;
  // ce que les periodes couvrent de ce jour (06/11/2026, heures de depart et de retour) : [[debut, fin, sorte]]
  const offIv = (st.days_off || []).filter(x => x.from <= d && d <= x.to).map(x => [x.from === d && x.from_t ? toMin(x.from_t) : 0,
    x.to === d && x.to_t ? toMin(x.to_t) : 1440, x.kind]).filter(([a, b]) => a != null && b != null && b > a);
  const away = (st.away || []).filter(x => x.date === d).map(x => [toMin(x.from), toMin(x.to)]).filter(x => x[0] != null && x[1] != null);
  return { special, holiday, off, offIv, away, run: special ? st.we.run : st.run, launch: special ? st.we.launch : st.launch };
}
const hhm0 = m => `${Math.floor(m / 60) % 24} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`;
export function DayMarks({ settings, day, full = true }) {
  const x = dayInfo(settings, day);
  const pill = (t, c, bg, tip) => <span data-tip={tip} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20,
    fontSize: 11, fontWeight: 800, color: c, background: bg, whiteSpace: "nowrap" }}>{t}</span>;
  const w = x.launch, hh = t => t === "00:00" ? "minuit" : t.replace(/^0(?=\d)/, "").replace(":", " h ").replace(/ h 00$/, " h");
  const items = [
    x.holiday && pill(`🎉 ${full ? x.holiday : "férié"}`, "#BE185D", "#FCE7F3", `Férié : ${x.holiday}`),
    x.special && pill(full ? `🏖 Horaires du week-end${w ? ` · lancement ${hh(w.from)} – ${hh(w.to)}` : ""}` : "🏖",
      "#0E7490", "#CFFAFE", "Les horaires du week-end s'appliquent ce jour-là"),
    ...(x.offIv || []).map(([a, b, k], i) => <React.Fragment key={`o${i}`}>{pill(`${k === "absent" ? "🚶 Absent" : "⏳ Peu dispo"}${a === 0 && b === 1440 ? (k === "absent" ? " toute la journée" : "") : a === 0 ? ` jusqu'à ${hhm0(b)}` : b === 1440 ? ` dès ${hhm0(a)}` : ` ${hhm0(a)} – ${hhm0(b)}`}`,
      "#B45309", "#FEF3C7", k === "absent" ? "Rien ne se lance" : "Une seule heure de lancement")}</React.Fragment>),
    ...x.away.map(([a, b], i) => <React.Fragment key={i}>{pill(`🚶 Absent ${hhm0(a)} – ${hhm0(b)}`, "#B45309", "#FEF3C7", "Rien ne se lance pendant")}</React.Fragment>),
  ].filter(Boolean);
  if (!items.length) return null;
  return <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{items}</div>;
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
  // les horaires de ce jour (06/11/2026 : ceux du week-end ces jours-la) et ses absences
  const di = dayInfo(settings, day);
  const run = spans(di.run), launch = spans(di.launch);
  const awayIv = [...(di.offIv || []).filter(x => x[2] === "absent"), ...di.away];
  const nowM = now && now.slice(0, 10) === day ? minOf(now, day) : null;
  return <div style={{ position: "relative", height: 34, marginTop: 2 }}>
    <div style={{ position: "absolute", left: 0, right: 0, top: 6, height: 18, borderRadius: 7, background: run ? "color-mix(in srgb, #94A3B8 16%, var(--surface2))" : "var(--surface2)",
      border: "1px solid var(--border)", overflow: "hidden" }}>
      {(run || []).map(([a, b], i) => <span key={`r${i}`} style={{ position: "absolute", top: 0, bottom: 0, left: pct(a), width: pct(b - a),
        background: "color-mix(in srgb, #22C55E 10%, var(--surface2))" }}/>)}
      {awayIv.map(([a, b], i) => <span key={`a${i}`} data-tip="Absent : rien ne se lance" style={{ position: "absolute", top: 0, bottom: 0, left: pct(a), width: pct(b - a),
        background: "repeating-linear-gradient(-45deg, color-mix(in srgb, #F59E0B 30%, transparent) 0 3px, transparent 3px 7px)" }}/>)}
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
// (09/11/2026) la couleur que va prendre un plateau d'un seul filament (une variante de couleur d'un echantillon : toutes
// partagent la vignette grise de MakerWorld) : sa bobine choisie, sinon rien
export const plateColor = j => { const fs = (j?.fils || []).filter(f => f.color);
  return fs.length === 1 && fs[0].multicolor_type !== "gradient" && fs[0].multicolor_type !== "coaxial" ? fs[0] : null; };
export function PlateThumb({ j, size = 52, onClick, tip }) {
  const src = j.thumb || j.cover;
  const pc = plateColor(j);
  const tint = pc && src && /^https:\/\/([a-z0-9-]+\.)*bblmw\.com\//i.test(src) && /\.(png|webp)(\?|$)/i.test(src);
  return <span onClick={onClick} data-tip={onClick ? tip || "Profil, plateaux et filaments retenus" : undefined}
    style={{ position: "relative", width: size, height: size, borderRadius: 10, flexShrink: 0, overflow: "hidden", cursor: onClick ? "pointer" : "default",
      background: "var(--surface)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
    {/* une image MakerWorld (couverture du modele ou du profil) passe par la reduction de son CDN (06/11/2026 : apiThumb ne
        reduit que les images de l'API ; la file chargeait des couvertures de plusieurs Mo pour des vignettes de 60 px) */}
    {/* repeinte de la couleur de sa bobine (le gris du rendu prend sa teinte, l'ombrage reste) */}
    {tint ? <PlateRecolor bare src={src} w={size * 2} map={[{ from: "#7a7a7a", to: `#${String(pc.color).replace("#", "").slice(0, 6)}` }]}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
      : src ? (j.thumb || !String(src).startsWith("/api/") ? <MwImg src={src} w={size * 2} style={{ width: "100%", height: "100%", objectFit: "cover" }}/>
      : <img src={apiThumb(src, size * 2)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }}
        onError={e => { e.currentTarget.style.visibility = "hidden"; }}/>) : <span style={{ fontSize: size / 3 }}>🧩</span>}
    {/* (09/11/2026) le numero du plateau est ecrit a cote (« Plateau 1/5 ») : sur une petite vignette, il la cachait ; sur une
        grande, il reste en tout petit dans le coin */}
    {j.plates_total > 1 && size >= 56 && <span style={{ position: "absolute", right: 2, bottom: 2, minWidth: 12, height: 12, padding: "0 3px", borderRadius: 6,
      background: "rgba(15,23,42,.5)", color: "#fff", fontSize: 8.5, fontWeight: 900, lineHeight: "12px", textAlign: "center" }}>{j.plate}</span>}
  </span>;
}
// les images d'un plateau, pour les voir en grand (08/11/2026) : chaque plateau d'un regroupement, puis le modele
export const platePics = j => [
  ...(j.merged_thumbs?.length ? j.merged_thumbs.map((t, i) => t && { url: t, label: `Plateau ${j.merged_plates?.[i] ?? "?"}/${j.plates_total || "?"}` })
    : [j.thumb && { url: j.thumb, label: j.plates_total > 1 ? plateTxt(j) : "Le plateau" }]),
  j.cover && j.cover !== j.thumb && { url: j.cover, label: "Le modèle" }].filter(Boolean);
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
      {j.load?.length > 0 && tag(<>🧵 À charger : <LoadLinks j={j}/>{j.free_slot && !j.unload?.length ? " (emplacement libre)" : ""}</>, "#6366F1",
        j.free_slot && !j.unload?.length ? "Pas dans l'AMS à ce moment-là ; un emplacement est libre, rien à retirer" : "Pas dans l'AMS à ce moment-là")}
      {j.merged && tag(`🧩 ${j.plate_name || "Regroupés"}`, "#6366F1", "Imprimés ensemble sur un seul plateau : regroupe-les dans Bambu Studio avant de lancer")}
      {j.merge_last && tag(`⬆ Plateau ${j.merge_last.plate} en dernier`, "#B45309", `${j.merge_last.h} mm, plus haut que la tige (${j.merge_last.rod_h} mm) : objet par objet, à imprimer en dernier`)}
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
      s.away_min > 0 && ["🚶", hm(s.away_min * 60), `temps mort en absence`, "#B45309", "L'imprimante à l'arrêt pendant tes absences : « Optimiser » y fait passer une impression lancée juste avant"],
      s.late > 0 && ["🎯", `${s.late}`, `date${s.late > 1 ? "s" : ""} limite${s.late > 1 ? "s" : ""} ratée${s.late > 1 ? "s" : ""}`, "#DC2626", "Voir les conseils"],
      dur && Math.abs((dur.factor || 1) - 1) > 0.005 && ["⏱", `${dur.factor > 1 ? "+" : ""}${Math.round((dur.factor - 1) * 100)} %`, "sur les durées", null, "Durées corrigées (Réglages › Durées)"],
    ].filter(Boolean);
    // au telephone (06/11/2026) : en grille de trois, sur plusieurs lignes, dans l'ecran (elles defilaient au-dela du bord)
    return <div style={compact ? { display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", rowGap: 8, minWidth: 0 } : { display: "flex", alignItems: "stretch", minWidth: 0 }}>
      {cs.map(([ic, v, l, c, tip], i) => <div key={i} data-tip={tip} style={{ flex: compact ? undefined : "1 1 0", minWidth: 0, padding: compact ? "1px 8px" : "2px 12px",
        borderLeft: (compact ? i % 3 : i) ? "1px solid var(--border)" : "none" }}>
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
    {dur && Math.abs((dur.factor || 1) - 1) > 0.005 && chip("u", `⏱ durées ${dur.factor > 1 ? "+" : ""}${Math.round((dur.factor - 1) * 100)} %`, "Durées corrigées (Réglages › Durées)")}
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
// (08/11/2026) la fiche s'ouvre sur place, par-dessus le planning (avant : on partait sur la page Filaments) ; celle de la
// bobine quand on sait laquelle (a charger, ou qui sort), sinon celle du filament. Hors du document (createPortal) et sans
// laisser remonter les clics : elle vit souvent dans une tuile qui s'ouvre au toucher
export function FilLink({ id, label, spool = null }) {
  const [open, setOpen] = useState(false);
  if (!id) return <>{label}</>;
  return <><span role="link" tabIndex={0} data-tip={spool ? "Ouvrir la fiche de la bobine" : "Ouvrir la fiche du filament"} onClick={e => { e.stopPropagation(); setOpen(true); }}
    style={{ cursor: "pointer", whiteSpace: "normal" }}><FilDot id={id}/><span style={{ textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: 2 }}>{label}</span></span>
    {open && createPortal(<div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      <FilamentSheetFromSpool filamentId={id} spoolId={spool} onClose={() => setOpen(false)}/></div>, document.body)}</>;
}
// la bobine qui sort (08/11/2026) : son slot dans l'imprimante, « 🖨 AMS-A slot 3 » (toucher montre l'imprimante, le slot
// clignote, quand elle y est deja) ; ou la ranger ensuite au survol (la case que libere celle qu'on charge, sa place, a ranger)
export function OutSpot({ sp }) {
  const [open, setOpen] = useState(false);
  if (!sp?.slot) return null;
  const after = !sp.where ? "" : sp.how === "swap" ? `ensuite, range-la dans la case que libère celle que tu charges : ${sp.where} (échange intelligent)`
    : sp.how === "home" ? `ensuite, range-la à sa place : ${sp.where}` : sp.how === "single" ? `ensuite, elle retourne au rangement (${sp.where})`
    : `ensuite, elle sera à ranger${sp.last ? ` (sa dernière place : ${sp.last})` : ""}`;
  const can = !!(sp.live && sp.out);
  return <><span role={can ? "button" : undefined} tabIndex={can ? 0 : undefined}
    data-tip={`Dans ${sp.slot}${sp.live ? "" : " (d'ici là)"}${after ? ` · ${after}` : ""}${can ? " — toucher pour la voir" : ""}`}
    onClick={can ? e => { e.stopPropagation(); setOpen(true); } : undefined}
    style={{ cursor: can ? "pointer" : "default", fontWeight: 800, color: "#0369A1", whiteSpace: "nowrap" }}> (🖨 {sp.slot})</span>
    {open && createPortal(<div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
      <LocateSheet spoolId={sp.out} onClose={() => setOpen(false)}/></div>, document.body)}</>;
}
// spool : la case a montrer ; out : la bobine qui sort
const outSpool = (j, i) => j.out_spots?.[i]?.out;
// le changement de bobine, en court et en pastilles : « ● X à la place de ● Y » (celle qui sort, plus pale), « ● X (place libre) »
export const SwapShort = ({ j }) => <>{(j.load || []).map((x, i) => <React.Fragment key={i}>{i ? ", " : ""}<FilLink id={j.load_ids?.[i]} label={x} spool={j.load_spots?.[i]?.spool}/><LoadSpot sp={j.load_spots?.[i]}/>
  {outOf(j, i)[0] ? <><span style={{ fontWeight: 600, opacity: 0.75 }}> à la place de </span><span style={{ opacity: 0.6 }}><FilLink id={outOf(j, i)[1]} label={outOf(j, i)[0]} spool={outSpool(j, i)}/></span><OutSpot sp={j.out_spots?.[i]}/></> : freeOf(j, i) ? " (place libre)" : ""}</React.Fragment>)}<SwapBtn j={j}/></>;
// ou prendre une bobine a charger (07/11/2026) : « 📍 Tiroir bas › Colonne 1-3 », qui ouvre son rangement (sa case clignote)
export function LoadSpot({ sp }) {
  const [open, setOpen] = useState(false);
  if (!sp?.where) return null;
  return <><span role="button" tabIndex={0} data-tip={`Bobine #${sp.spool}${sp.g != null ? ` · ${sp.g} g` : ""}${sp.others ? ` · ${sp.others} autre${sp.others > 1 ? "s" : ""} rangée${sp.others > 1 ? "s" : ""}` : ""} — toucher pour la localiser`}
    onClick={e => { e.stopPropagation(); setOpen(true); }}
    style={{ cursor: "pointer", fontWeight: 800, color: "#B45309", whiteSpace: "nowrap" }}> (📍 {sp.where})</span>
    {open && <LocateSheet spoolId={sp.spool} onClose={() => setOpen(false)}/>}</>;
}
// ── les echanges de bobines d'un plateau, en un coup d'oeil (08/11/2026) ─────────────────────────────────────────────
// « 📍 la bobine a prendre ⇄ celle qu'elle remplace 🖨 » pour chaque filament a charger ; toucher un nom la localise
// une section par rangement source (08/11/2026) : le rangement (reduit) face a l'imprimante, cote a cote meme sur un
// telephone ; ses liens seulement, deux par deux au-dela de deux
// le retour de celle qui sort (08/11/2026) : avec l'echange intelligent (« je range ou je veux »), dans la case que libere
// celle qu'on charge (le meme lien, a rebours) ; en « chaque bobine a sa place », a SA place (un lien a part, du slot a sa
// case, marquee « ↩1 », si elle est dans ce rangement) ; « a ranger » : pas de retour dessine
const SW_DUR = 1700;                              // un trajet de pastille sur son lien (ms)
function SwapSection({ title, root, ps, loose, tgtOf, grpReq, onShow, rootOf }) {
  const homeOf = p => p.os?.how === "home" && p.os.out && root != null && rootOf(p.os.out) === root ? p.os.out : null;
  const wrap = React.useRef(null);
  const [links, setLinks] = useState([]);
  // (10/11/2026) par paquets de deux seulement quand ca devient illisible (4 echanges et plus) ; chaque paquet reste le temps
  // de deux trajets complets des pastilles (retour compris), sinon il partait avant la fin de l'aller-retour
  const groups = ps.length > 3 ? Math.ceil(ps.length / 2) : 1, [grp, setGrp] = useState(0), [hold, setHold] = useState(0);
  React.useEffect(() => {
    if (groups < 2) return undefined;
    const t = setInterval(() => { if (Date.now() > hold) setGrp(g => (g + 1) % groups); }, 2 * SW_DUR + 900);
    return () => clearInterval(t);
  }, [groups, hold]);
  React.useEffect(() => { if (grpReq != null) { const k = ps.findIndex(p => p.n === grpReq.n); if (k >= 0) { setGrp(Math.floor(k / 2)); setHold(Date.now() + 9000); } } }, [grpReq]); // eslint-disable-line react-hooks/exhaustive-deps
  const inGrp = n => groups < 2 || Math.floor(ps.findIndex(p => p.n === n) / 2) === grp;
  React.useEffect(() => { onShow?.(ps.filter(p => inGrp(p.n)).map(p => p.n)); }, [grp, ps.length]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return undefined;
    const calc = () => {
      const o = el.getBoundingClientRect(), out = [];
      for (const p of ps) {
        const a = el.querySelector(`[data-swap-src="${p.n}"]`), b = el.querySelector(`[data-swap-dst="${p.n}"]`);
        if (!a || !b) continue;
        // (10/11/2026) le centre (une mise a l'echelle ne le bouge pas) et la demi-largeur sans transformation : la case qui
        // clignote grossit et retrecit, son bord bougeait et le lien sautait a chaque recalcul
        const box = x => { const r = x.getBoundingClientRect(); return { cx: r.left + r.width / 2 - o.left, cy: r.top + r.height / 2 - o.top, hw: x.offsetWidth / 2 }; };
        const A = box(a), B = box(b);
        const ax = Math.round(A.cx + A.hw - 2), ay = Math.round(A.cy), bx = Math.round(B.cx - B.hw + 2), by = Math.round(B.cy);
        const mx = (ax + bx) / 2;
        const h = homeOf(p) ? el.querySelector(`[data-swap-src="↩${p.n}"]`) : null;
        let back = null;
        if (h) {                                      // du slot a sa case : de la gauche du slot a la droite de la case
          const H = box(h), hx = Math.round(H.cx + H.hw - 2), hy = Math.round(H.cy), m2 = (hx + bx) / 2;
          back = `M${bx},${by + 4} C${m2},${by + 4} ${m2},${hy} ${hx},${hy}`;
        }
        out.push({ n: p.n, d: `M${ax},${ay} C${mx},${ay} ${mx},${by} ${bx},${by}`, a: FCOL[p.fid], b: FCOL[p.ofid],
          swap: p.os?.how === "swap", back });
      }
      setLinks(l => JSON.stringify(l) === JSON.stringify(out) ? l : out);
    };
    // la fenetre s'ouvre en glissant et l'imprimante se lit apres coup : on recale les liens tant qu'elle est ouverte
    const ts = [60, 400, 900, 1400].map(t => setTimeout(calc, t)), iv = setInterval(calc, 1000);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(calc) : null;
    ro?.observe(el);
    return () => { ts.forEach(clearTimeout); clearInterval(iv); ro?.disconnect(); };
  }, [root, ps.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const hex = c => { const l = c ? parseColorsList(c.color, c.colors_array) : null; return (l && l[0]) || "#94a3b8"; };
  // (10/11/2026) les pastilles qui voyagent sur les liens, placees a chaque image sur leur trace (getPointAtLength) :
  // l'animation SVG suivait l'horloge de la page (elle surgissait au milieu du trajet), offset-path figeait les pastilles
  // hors de leur rail sur iPhone entre deux tours. Chacune part du debut a son apparition, accelere puis ralentit, en
  // fondu aux deux bouts ; le trace qui bouge, elle le suit
  const svgRef = React.useRef(null);
  React.useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined;
    const DUR = SW_DUR;
    let raf = 0;
    const tick = now => {
      const svg = svgRef.current;
      if (svg) for (const c of svg.querySelectorAll("circle[data-path]")) {
        const p = svg.querySelector(`#${c.dataset.path}`);
        if (!p) continue;
        if (!c.dataset.born) c.dataset.born = String(now);
        const x0 = (now - Number(c.dataset.born) - Number(c.dataset.delay || 0)) / DUR;
        if (x0 < 0) { c.setAttribute("opacity", "0"); continue; }
        const x = x0 % 1, e = x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
        const pt = p.getPointAtLength((c.dataset.rev ? 1 - e : e) * p.getTotalLength());
        c.setAttribute("cx", pt.x.toFixed(1));
        c.setAttribute("cy", pt.y.toFixed(1));
        c.setAttribute("opacity", String(x < 0.1 ? x / 0.1 : x > 0.9 ? (1 - x) / 0.1 : 1));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  const head = (ic, txt) => <div style={{ fontSize: 10.5, fontWeight: 900, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ic} {txt}</div>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
    <div ref={wrap} className="bn-sw">
      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        {head("📍", title)}
        {root != null ? <PlaceView id={root} focus={[...ps.map(p => p.sp.spool), ...ps.map(homeOf).filter(Boolean)]}
            marks={Object.fromEntries([...ps.map(p => [p.sp.spool, p.n]), ...ps.filter(homeOf).map(p => [homeOf(p), `↩${p.n}`])])}/>
          : loose.map(p => <div key={p.n} data-swap-src={p.n} style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)", padding: "6px 8px", borderRadius: 10,
              background: "var(--surface2)", border: "1px solid var(--border)" }}><span className="bn-sw-n">{p.n}</span> <FilDot id={p.fid}/>{p.name}
              <span style={{ display: "block", color: "#B45309" }}>{p.sp?.where || p.where || "pas de bobine rangée connue"}</span></div>)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        {head("🖨", "Dans l'imprimante")}
        <AmsMap compact isHit={(a, t) => { const q = tgtOf(a, t); return !!q && ps.includes(q); }} mark={(a, t) => { const q = tgtOf(a, t); return q && ps.includes(q) ? q.n : null; }}/>
        {ps.some(p => p.free) && <div style={{ fontSize: 10.5, fontWeight: 700, color: ps.some(p => p.noFree) ? "#B45309" : "var(--muted)" }}>
          {ps.filter(p => p.free).map(p => p.freeAt ? `${p.n} : l'emplacement libre ${p.freeAt.label}` : p.noFree ? `${p.n} : le planning comptait une place libre, aucune n'est vide en ce moment` : `${p.n} : un emplacement libre`).join(" · ")}</div>}
      </div>
      {/* les allers-retours : la bobine a prendre part vers son slot, celle qui sort en revient */}
      <svg ref={svgRef} aria-hidden="true" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible", zIndex: 4 }}>
        <defs><linearGradient id="bnSwGrad" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#F59E0B"/><stop offset="1" stopColor="#6366F1"/></linearGradient></defs>
        {links.filter(l => inGrp(l.n)).map(l => <g key={l.n} style={{ animation: "bnSwIn .4s ease-out" }}>
          <path id={`bnSw${title}${l.n}`.replace(/\W/g, "")} className="bn-sw-link" d={l.d}/>
          {l.back && <path id={`bnSwB${title}${l.n}`.replace(/\W/g, "")} className="bn-sw-link back" d={l.back}/>}
          {/* (10/11/2026) les pastilles qui voyagent, placees image par image sur leur trace (voir plus haut) */}
          <circle className="bn-sw-ghost" r="5" fill={hex(l.a)} stroke="#fff" strokeWidth="1.5" opacity="0" data-path={`bnSw${title}${l.n}`.replace(/\W/g, "")}/>
          {l.b && l.swap && <circle className="bn-sw-ghost" r="5" fill={hex(l.b)} stroke="#fff" strokeWidth="1.5" opacity="0" data-path={`bnSw${title}${l.n}`.replace(/\W/g, "")} data-rev="1"/>}
          {l.back && l.b && <circle className="bn-sw-ghost" r="5" fill={hex(l.b)} stroke="#fff" strokeWidth="1.5" opacity="0" data-path={`bnSwB${title}${l.n}`.replace(/\W/g, "")} data-delay="700"/>}
        </g>)}
      </svg>

    </div>
  </div>;
}

export function SwapSheet({ j, onClose }) {
  const [loc, setLoc] = useState(null);                // la bobine a localiser
  const [req, setReq] = useState(null);                // une ligne du resume touchee : sa section, son groupe
  const [shown, setShown] = useState({});              // section -> les echanges dont les liens sont montres
  const st = useStorage();
  // (08/11/2026) par rangement source : une section chacun (le rangement face a l'imprimante, ses liens) ; plusieurs
  // rangements : les sections defilent de gauche a droite, des onglets au-dessus pour y aller
  const n = (j.load || []).length;
  const pairs = (j.load || []).map((x, i) => {
    const [oname, ofid] = outOf(j, i), os = j.out_spots?.[i], sp = j.load_spots?.[i];
    return { n: i + 1, name: x, fid: j.load_ids?.[i], sp, oname, ofid, os, free: freeOf(j, i) && !oname, where: j.load_where?.[String(j.load_ids?.[i])] };
  });
  const byRoot = new Map(), loose = [];
  for (const p of pairs) {
    const r = p.sp?.spool ? rootOfSpool(st, p.sp.spool) : null;
    if (r != null) { if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(p); } else loose.push(p);
  }
  const placeName = r => st?.places?.find(x => x.id === r)?.name || "Rangement";
  const sections = [...[...byRoot.entries()].map(([r, ps]) => ({ key: `r${r}`, title: placeName(r), root: r, ps })),
    ...(loose.length ? [{ key: "loose", title: "Ailleurs", root: null, ps: loose }] : [])];
  // une place libre (08/11/2026) : on montre laquelle, les emplacements vides de l'AMS dans l'ordre (le support externe
  // seulement pour ce qui va dehors) ; aucun vide maintenant : on le dit (le planning se refera a l'arrivee de l'imprimante)
  const amsList = usePrinter(s => s.status?.ams_list) || [];
  const empties = amsList.filter(a => !isExternal(a.id)).flatMap(a => (a.trays || []).filter(t => t.empty || !t.filament_type).map(t => ({ a, t })));
  pairs.filter(p => p.free && !p.where).forEach((p, k) => { const e = empties[k]; if (e) p.freeAt = { a: e.a, t: e.t, label: slotLabel(e.a.id, e.t.id) }; else p.noFree = true; });
  const tgts = pairs.filter(p => p.os?.slot || p.freeAt);
  const tgtOf = (a, t) => tgts.find(p => p.freeAt ? p.freeAt.a.id === a.id && p.freeAt.t.id === t.id
    : (p.os.live && p.os.out && t.spool_id === p.os.out) || slotIs(a, t, p.os.slot));
  const rail = React.useRef(null);
  const [cur, setCur] = useState(0);
  const [railH, setRailH] = useState(null);
  React.useLayoutEffect(() => {
    const el = rail.current?.children?.[cur];
    if (!el) return undefined;
    const fit = () => setRailH(el.offsetHeight);
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [cur, sections.length]);
  const go = k => { setCur(k); const el = rail.current?.children?.[k]; el && rail.current.scrollTo({ left: el.offsetLeft - rail.current.offsetLeft, behavior: "smooth" }); };
  const onScroll = () => { const el = rail.current; if (el) setCur(Math.round(el.scrollLeft / Math.max(1, el.clientWidth))); };
  const when = j.start ? new Date(j.start).toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  return createPortal(<div onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
    <FSheet onClose={onClose} z={1450} bottom={<button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button>}>
      <style>{`.bn-sw{position:relative;display:grid;gap:12px;grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}
        @media (min-width:760px){.bn-sw{gap:44px}}
        .bn-sw-n{display:inline-block;min-width:16px;height:16px;padding:0 4px;border-radius:8px;font-size:10px;font-weight:900;line-height:16px;text-align:center;color:#fff;background:#F59E0B}
        .bn-sw-link{fill:none;stroke:url(#bnSwGrad);stroke-width:2.5;stroke-linecap:round;stroke-dasharray:6 7;animation:bnSwDash 1.1s linear infinite;opacity:.9}
        .bn-sw-link.back{stroke:#0284C7;stroke-width:2;stroke-dasharray:3 6;opacity:.75}
        @keyframes bnSwDash{to{stroke-dashoffset:-26}}
        @keyframes bnSwIn{from{opacity:0}to{opacity:1}}
        .bn-sw-ar{animation:bnBreath 1.9s ease-in-out infinite}
        @keyframes bnBreath{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(99,102,241,.45)}50%{transform:scale(1.14);box-shadow:0 0 0 8px rgba(99,102,241,0),0 0 14px 2px rgba(14,165,233,.35)}}
        .bn-sw-rail{display:flex;align-items:flex-start;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;gap:16px;scrollbar-width:none;transition:height .3s ease}
        .bn-sw-rail::-webkit-scrollbar{display:none}
        .bn-sw-rail>*{flex:0 0 100%;scroll-snap-align:start}
        @media (prefers-reduced-motion:reduce){.bn-sw-link,.bn-sw-ar{animation:none}.bn-sw-ghost{display:none}}`}</style>
      <div style={{ padding: "52px 12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="bn-sw-ar" style={{ width: 38, height: 38, borderRadius: 12, display: "grid", placeItems: "center", flexShrink: 0, color: "#fff",
            background: "linear-gradient(135deg, #0EA5E9, #6366F1)" }}><ArrowLeftRight size={19} strokeWidth={2.4}/></span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 16, fontWeight: 900, color: "var(--text)" }}>{n > 1 ? `${n} changements de bobine` : "Changement de bobine"}</span>
            <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {jobName(j)}{when ? ` · ${when}` : ""}</span>
          </span>
        </div>
        {sections.length > 1 && <div style={{ display: "flex", gap: 6, overflowX: "auto" }}>
          {sections.map((x, k) => <button key={x.key} type="button" onClick={() => go(k)} style={{ flexShrink: 0, padding: "5px 11px", borderRadius: 20, fontSize: 12, fontWeight: 800,
            fontFamily: "inherit", cursor: "pointer", color: "var(--text)", border: k === cur ? "1.5px solid #F59E0B" : "1px solid var(--border)",
            background: k === cur ? "rgba(245,158,11,0.14)" : "var(--surface2)" }}>📍 {x.title} · {x.ps.length}</button>)}
        </div>}
        <div ref={rail} className="bn-sw-rail" onScroll={onScroll} style={{ height: sections.length > 1 && railH ? railH : undefined }}>
          {sections.map(x => <SwapSection key={x.key} title={x.title} root={x.root} ps={x.ps} rootOf={id => rootOfSpool(st, id)} loose={x.root == null ? x.ps : []} tgtOf={tgtOf}
            grpReq={req && x.ps.some(p => p.n === req.n) ? req : null} onShow={ns => setShown(m => ({ ...m, [x.key]: ns }))}/>)}
        </div>
        {/* (08/11/2026) le detail, en tuiles sous les vues : chaque echange, la source (son nom entier, son rangement et sa
            case) ⇄ la cible (son nom, son slot, ou elle va ensuite) ; toucher une tuile montre sa section et son lien */}
        <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 330px), 1fr))" }}>
          {pairs.map(p => {
            const two = loc => { const x = String(loc || ""), m = x.match(/^(.+?) slot (\d+)$/), h = x.match(/^AMS (HT-\w+)$/);
              if (m) return [m[1], `Slot ${m[2]}`];
              if (h) return ["AMS HT", h[1]];
              const q = x.split(" › "); return q.length > 1 ? [q.slice(0, -1).join(" › "), q[q.length - 1]] : [x, null]; };
            const half = (fid, name, where, tone, icon, extra, muted) => { const [w1, w2] = two(where);
              return <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 11.5, fontWeight: 900, lineHeight: 1.2, color: muted ? "var(--muted)" : "var(--text)", display: "-webkit-box", WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical", overflow: "hidden" }}>{fid ? <FilDot id={fid}/> : null}{name}</span>
                {where && <span style={{ display: "flex", flexDirection: "column", fontSize: 10.5, fontWeight: 800, color: tone, lineHeight: 1.2, minWidth: 0 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{icon} {w1}</span>
                  {w2 && <b style={{ fontWeight: 900, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{w2}</b>}</span>}
                {extra}
              </span>; };
            const on = !sections[cur] || !shown[sections[cur].key] || shown[sections[cur].key].includes(p.n);
            return <div key={p.n} role="button" tabIndex={0} onClick={() => { const k = sections.findIndex(x => x.ps.includes(p)); if (k >= 0) go(k); setReq({ n: p.n, t: Date.now() }); }}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 9px", borderRadius: 13, cursor: "pointer", minWidth: 0,
                border: `1px solid ${on ? "color-mix(in srgb, #F59E0B 40%, var(--border))" : "var(--border)"}`, background: "var(--surface2)",
                opacity: on ? 1 : 0.5, transition: "opacity .3s, border-color .3s" }}>
              <span className="bn-sw-n" style={{ flexShrink: 0 }}>{p.n}</span>
              {half(p.fid, p.name, p.sp?.where || p.where, "#B45309", "📍", null, false)}
              <ArrowLeftRight size={14} strokeWidth={2.6} style={{ flexShrink: 0, color: "#6366F1" }}/>
              {p.free ? half(null, p.freeAt ? `Emplacement libre ${p.freeAt.label}` : "Emplacement libre", p.freeAt ? p.freeAt.label : null, "#0284C7", "🖨",
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: p.noFree ? "#B45309" : "var(--muted)" }}>{p.noFree ? "aucun n'est vide en ce moment : rouvre le planning" : "rien à retirer"}</span>, true)
                : half(p.ofid, p.oname, p.os?.slot, "#0284C7", "🖨", p.os?.where && (([d1, d2]) =>
                    // ou elle va ensuite, en entier (08/11/2026) : le rangement, puis la case
                    <span data-tip={p.os.how === "swap" ? "Elle prend la case que libère l'autre" : p.os.how === "home" ? "Elle retourne à sa place" : "Ensuite"}
                      style={{ display: "flex", flexDirection: "column", fontSize: 10, fontWeight: 700, color: "var(--muted)", lineHeight: 1.2, minWidth: 0 }}>
                      <span style={{ overflowWrap: "anywhere" }}>↩ {d1}</span>{d2 && <b style={{ fontWeight: 900, color: "var(--text2)" }}>{d2}</b>}</span>)(two(p.os.where)), false)}
            </div>; })}
        </div>
      </div>
    </FSheet>
    {loc && <LocateSheet spoolId={loc} onClose={() => setLoc(null)}/>}
  </div>, document.body);
}
// le bouton qui l'ouvre, a cote de « charger ... » : « ⇄ 2 »
export function SwapBtn({ j }) {
  const [open, setOpen] = useState(false);
  const n = (j?.load || []).length;
  if (!n) return null;
  return <><span role="button" tabIndex={0} onClick={e => { e.stopPropagation(); setOpen(true); }}
    data-tip={n > 1 ? `Voir les ${n} échanges de bobines` : "Voir l'échange de bobine"}
    style={{ display: "inline-flex", alignItems: "center", gap: 3, marginLeft: 6, padding: "1px 8px", borderRadius: 20, cursor: "pointer", verticalAlign: "1px",
      fontSize: 10.5, fontWeight: 900, color: "#fff", background: "linear-gradient(135deg, #0EA5E9, #6366F1)", whiteSpace: "nowrap" }}>
    <ArrowLeftRight size={11} strokeWidth={2.8}/>{n > 1 ? ` ${n}` : " Voir"}</span>
    {open && <SwapSheet j={j} onClose={() => setOpen(false)}/>}</>;
}
// la liste a charger, chacune avec ou la prendre
export const LoadLinks = ({ j }) => <>{(j.load || []).map((l, i) => <React.Fragment key={i}>{i ? ", " : ""}<FilLink id={j.load_ids?.[i]} label={l} spool={j.load_spots?.[i]?.spool}/><LoadSpot sp={j.load_spots?.[i]}/></React.Fragment>)}<SwapBtn j={j}/></>;
export const FilLinks = ({ labels, ids }) => <>{(labels || []).map((l, i) => <React.Fragment key={i}>{i ? ", " : ""}<FilLink id={ids?.[i]} label={l}/></React.Fragment>)}</>;
// le changement de bobine en phrase, ses filaments cliquables : « charger X a la place de Y »
export const SwapLinks = ({ j }) => <>{(j.load || []).map((x, i) => <React.Fragment key={i}>{i ? ", " : ""}charger <FilLink id={j.load_ids?.[i]} label={x} spool={j.load_spots?.[i]?.spool}/><LoadSpot sp={j.load_spots?.[i]}/>
  {outOf(j, i)[0] ? <><span style={{ fontWeight: 600, opacity: 0.75 }}> à la place de </span><span style={{ opacity: 0.6 }}><FilLink id={outOf(j, i)[1]} label={outOf(j, i)[0]} spool={outSpool(j, i)}/></span><OutSpot sp={j.out_spots?.[i]}/></>
    : freeOf(j, i) ? <span style={{ fontWeight: 600, opacity: 0.75 }}> dans l'emplacement libre</span> : ""}</React.Fragment>)}<SwapBtn j={j}/></>;
// la fin de la journee (06/11/2026) : le dernier plateau prevu aujourd'hui finit vers telle heure ; combien encore
export const dayEnd = p => {
  const today = (p?.now || "").slice(0, 10), js = (p?.jobs || []).filter(j => j.day === today);
  if (!js.length) return null;
  const end = js.reduce((a, j) => j.end > a ? j.end : a, js[0].end);
  return { n: js.length, end, txt: `fin de journée vers ${hhmm(end)} · ${js.length} plateau${js.length > 1 ? "x" : ""} encore` };
};
// une bobine qui se videra en pleine impression (06/11/2026) : vers quelle heure
export const runoutTxt = r => `🔄 ${r.name} se vide vers ${+r.at.slice(11, 13)} h${r.at.slice(14, 16) !== "00" ? ` ${r.at.slice(14, 16)}` : ""} (reste ${r.left} g, il en faut ${r.need})`;
// les absences de quelques heures (06/11/2026) : un jour, de telle heure a telle heure ; jusqu'a vingt
function AwayList({ list, set }) {
  const tomorrow = (() => { const t = new Date(); t.setDate(t.getDate() + 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; })();
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    {list.map((w, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <input type="date" value={w.date} onChange={e => set(list.map((x, k) => k === i ? { ...x, date: e.target.value } : x))} style={tin}/>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>de</span>
      <input type="time" value={w.from} onChange={e => set(list.map((x, k) => k === i ? { ...x, from: e.target.value } : x))} style={tin}/>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>à</span>
      <input type="time" value={w.to} onChange={e => set(list.map((x, k) => k === i ? { ...x, to: e.target.value } : x))} style={tin}/>
      <button type="button" onClick={() => set(list.filter((_, k) => k !== i))} aria-label="Retirer" style={mini}>✕</button>
    </div>)}
    {list.length < 20 && <button type="button" onClick={() => set([...list, { date: tomorrow, from: "13:00", to: "16:00" }])} style={{ ...seg, alignSelf: "flex-start" }}>＋ Une absence</button>}
  </div>;
}
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
// les periodes (06/11/2026) : absent ou peu dispo, du jour et de l'heure de depart au jour et a l'heure de retour (les
// heures, facultatives : sans elles, des journees entieres)
function DaysOff({ list, set }) {
  const [kind, setKind] = useState("absent");
  const [a, setA] = useState(""), [b, setB] = useState(""), [at, setAt] = useState(""), [bt, setBt] = useState("");
  const fr = d => new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  const h = t => t ? ` ${t.replace(/^0(?=\d)/, "").replace(":", " h ").replace(/ h 00$/, " h")}` : "";
  const today = new Date().toISOString().slice(0, 10);
  const field = (lbl, d, setD, t, setT, min) => <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 230px", minWidth: 0 }}>
    <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)" }}>{lbl}</span>
    <div style={{ display: "flex", gap: 6 }}>
      <input type="date" value={d} min={min} onChange={e => setD(e.target.value)} style={{ ...tin, flex: 1, minWidth: 0 }}/>
      <input type="time" value={t} onChange={e => setT(e.target.value)} data-tip="L'heure (facultative : sans elle, toute la journée)" style={{ ...tin, width: 96 }}/>
    </div></div>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    {list.map((x, i) => { const [ic, l, c] = DAY_KIND[x.kind] || DAY_KIND.absent;
      return <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 12,
        border: `1px solid color-mix(in srgb, ${c} 40%, var(--border))`, background: `color-mix(in srgb, ${c} 8%, var(--surface))` }}>
        <span style={{ fontSize: 18 }}>{ic}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 900, color: c }}>{l}</span>
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>
            {x.from === x.to && !x.from_t && !x.to_t ? fr(x.from) : `du ${fr(x.from)}${h(x.from_t)} au ${fr(x.to)}${h(x.to_t)}`}</span></span>
        <button type="button" onClick={() => set(list.filter((_, k) => k !== i))} aria-label="Retirer" style={mini}>✕</button>
      </div>; })}
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 12, borderRadius: 14, border: "1px dashed color-mix(in srgb, #6366F1 30%, var(--border))",
      background: "color-mix(in srgb, #6366F1 4%, var(--surface))" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {Object.entries(DAY_KIND).map(([k, [ic, l, , tip]]) => <button key={k} type="button" data-tip={tip} onClick={() => setKind(k)}
          style={{ ...seg, ...(kind === k ? segOn : {}) }}>{ic} {l}</button>)}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {field("Départ", a, v => { setA(v); if (!b || b < v) setB(v); }, at, setAt, today)}
        {field("Retour", b, setB, bt, setBt, a || today)}
      </div>
      <button type="button" disabled={!a} onClick={() => {
        set([...list, { from: a, to: b || a, kind, ...(at ? { from_t: at } : {}), ...(bt ? { to_t: bt } : {}) }].sort((x, y) => x.from.localeCompare(y.from)));
        setA(""); setB(""); setAt(""); setBt(""); }}
        style={{ ...seg, ...(a ? segOn : { opacity: 0.5 }), alignSelf: "flex-start" }}>＋ Ajouter la période</button>
    </div>
  </div>;
}
// deux fenetres (06/11/2026) : part « global » (les consignes : horaires, week-end, durees, chargement, optimisation) ou
// « away » (absences de quelques heures, jours et periodes particuliers) ; chaque section en carte
export function PlanSettings({ s, dur, onSave, onClose, part = "global", edit = true }) {
  const [gap, setGap] = useState(String(s?.gap ?? 15));
  const [optMode, setOptMode] = useState(s?.opt_mode || "mix");
  const [autoNew, setAutoNew] = useState(s?.auto_new || "off");
  const [daysOff, setDaysOff] = useState(s?.days_off || []);
  const [run, setRun] = useState(s?.run || null);
  const [launch, setLaunch] = useState(s?.launch || null);
  const [loadWin, setLoadWin] = useState(s?.load_win || []);
  const [durMode, setDurMode] = useState(s?.dur_mode || "off");
  const [durPct, setDurPct] = useState(String(s?.dur_pct ?? 0));
  const [away, setAway] = useState(s?.away || []);
  const [we, setWe] = useState(s?.we || null);
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
  const save = async () => { setBusy(true); try { await onSave({ gap: Math.max(0, parseInt(gap) || 0), run, launch, opt_mode: optMode, auto_new: autoNew, days_off: daysOff, load_win: loadWin, dur_mode: durMode, dur_pct: parseInt(durPct) || 0, away, we }); } finally { setBusy(false); } };
  const modes = (v, set, extra) => <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
    {[...(extra ? [extra] : []), ...OPT_MODES].map(([k, ic, l, tip]) => <button key={k} type="button" data-tip={tip} onClick={() => set(k)}
      style={{ ...seg, ...(v === k ? segOn : {}) }}>{ic} {l}</button>)}</div>;
  // dans une fenetre (06/11/2026) : le titre et la croix sont ceux de la fenetre, Enregistrer reste en bas
  // sans droit (chez un copain, compte en lecture) : on lit les réglages, rien ne se touche (07/11/2026)
  return <div className="bn-sets" data-show={part} data-ro={edit ? undefined : ""} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <style>{`.bn-sets > div:not(.bn-sets-foot){padding:12px 14px;border-radius:16px;border:1px solid var(--border);
      background:linear-gradient(160deg,color-mix(in srgb,#6366F1 4%,var(--surface)),var(--surface) 60%)}
      .bn-sets[data-show=global] > [data-part=away]{display:none}
      .bn-sets[data-show=away] > div:not([data-part=away]):not(.bn-sets-foot){display:none}
      .bn-sets[data-ro] > div:not(.bn-sets-foot){pointer-events:none;user-select:text}`}</style>
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
      {/* le week-end et les jours feries (06/11/2026) : d'autres horaires, au choix */}
      <div style={lab}>🏖 Week-end et jours fériés</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => setWe(null)} style={{ ...seg, ...(we ? {} : segOn) }}>Mêmes horaires</button>
        <button type="button" onClick={() => setWe(we || { on: true, run, launch: launch ? { ...launch, from: "10:00" } : { from: "10:00", to: "00:00" }, holidays: true })}
          style={{ ...seg, ...(we ? segOn : {}) }}>D'autres horaires</button>
      </div>
      {we && <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8, padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)" }}>
        <div><div style={{ ...lab, fontSize: 12 }}>🔌 Fonctionnement le week-end</div>{range(we.run, v => setWe({ ...we, run: v }), { from: "08:00", to: "22:00" }, "24 h/24", "Une plage")}</div>
        <div><div style={{ ...lab, fontSize: 12 }}>▶ Lancement le week-end</div>{range(we.launch, v => setWe({ ...we, launch: v }), { from: "10:00", to: "00:00" }, "À toute heure", "Une plage")}</div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "var(--text2)", cursor: "pointer" }}>
          <input type="checkbox" checked={!!we.holidays} onChange={e => setWe({ ...we, holidays: e.target.checked })}/> Aussi les jours fériés</label>
      </div>}
      <div style={hint}>Le samedi et le dimanche (et les jours fériés, au choix : 1er janvier, lundi de Pâques, 1er et 8 mai, Ascension, lundi de
        Pentecôte, 14 juillet, 15 août, 1er et 11 novembre, Noël), ces heures remplacent celles de la semaine.</div>
    </div>
    <div>
      {/* les durees (06/11/2026) : l'ecart mesure, en proportion, et le choix de le corriger */}
      <div style={lab}>⏱ Durées des impressions</div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", marginBottom: 6 }}>{dur?.n
        ? <>Tes impressions durent en moyenne <b style={{ color: dur.pct > 0 ? "#EA580C" : dur.pct < 0 ? "#16A34A" : "var(--text)" }}>
          {dur.pct > 0 ? `${dur.pct} % de plus` : dur.pct < 0 ? `${-dur.pct} % de moins` : "le temps prévu"}</b>{dur.pct ? " que prévu" : ""} (sur tes {dur.n} dernières réussies{dur.from && dur.to ? `, du ${new Date(dur.from).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} au ${new Date(dur.to).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : ""}).
          {/* (09/11/2026) l'heure du calcul : la valeur bouge, lentement (une mediane sur 50) */}
          {dur.at && <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)", marginTop: 2 }}>
            Calculé à {new Date(dur.at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}, refait toutes les 30 min · une médiane : elle bouge peu d'une impression à l'autre</span>}</>
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
    <div data-part="away">
      {/* les absences de quelques heures (06/11/2026) : rien ne se lance ; elles s'effacent une fois passees */}
      <div style={lab}>🚶 Absences sur une journée</div>
      <AwayList list={away} set={setAway}/>
      <div style={hint}>« Demain de 13 h à 16 h, je ne suis pas là » : rien ne se lance pendant ; le planning et l'optimiseur y font passer une
        impression lancée avant. Une absence passée s'efface d'elle-même.</div>
    </div>
    <div data-part="away">
      <div style={lab}>📅 Jours et périodes particuliers</div>
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
    <div className="bn-sets-foot" style={{ position: "sticky", bottom: -12, margin: "0 -12px -12px", padding: "10px 12px", display: "flex", gap: 8, justifyContent: "flex-end",
      background: "var(--sheet-bg)", borderTop: "1px solid var(--border)" }}>
      {!edit && <span style={{ marginRight: "auto", alignSelf: "center", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>👀 En lecture seule</span>}
      <button type="button" onClick={onClose} style={{ ...seg, padding: "8px 14px" }}>{edit ? "Annuler" : "Fermer"}</button>
      {edit && <button type="button" disabled={busy} onClick={save} style={{ padding: "8px 16px", borderRadius: 12, border: "none", cursor: "pointer",
        background: "linear-gradient(135deg, #6366F1, #8B5CF6)", color: "#fff", fontSize: 13, fontWeight: 900 }}>{busy ? "…" : "Enregistrer"}</button>}</div>
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
            {/* les echanges de bobines en cyan doux (06/11/2026 : l'orange criait, le noir faisait bloc) */}
            {j.load?.length ? <span style={{ color: "color-mix(in srgb, #0891B2 78%, var(--text2))" }}> · 🧵 <SwapShort j={j}/></span> : ""}
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
// la carte d'un regroupement (06/11/2026) : sa vignette ouvre la galerie des plateaux concernes, « Fiche » ouvre la fiche
// MakerWorld du modele pour verifier, « Appliquer » demande confirmation (un toucher de trop regroupait pour de bon)
function MergeCard({ a, edit, onApply, onSheet, c: cc = "#6366F1" }) {
  const [gal, setGal] = useState(false);
  const m = a.m, dur = s => { const n = Math.round(s / 60); return n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${String(n % 60).padStart(2, "0")}` : ""}`; };
  const pill = (t, c, tip) => <span data-tip={tip} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 800,
    whiteSpace: "nowrap", color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>{t}</span>;
  return <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 10, borderRadius: 14,
    border: `1px solid color-mix(in srgb, ${cc} 18%, var(--border))`, background: `linear-gradient(135deg, color-mix(in srgb, ${cc} 7%, var(--surface)), var(--surface) 80%)` }}>
    <PlateThumb j={{ thumb: m.thumb }} size={46} onClick={m.items?.length ? () => setGal(true) : undefined} tip="Voir les plateaux concernés"/>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0, alignItems: "stretch" }}>
      {edit && a.action && <button type="button" data-tip="Les regroupe au planning ; à regrouper ensuite dans Bambu Studio"
        onClick={async () => {
          const what = m.same ? `${m.plates.length} × le plateau ${m.plates[0]}` : `les plateaux ${m.plates.join(", ")}`;
          if (await showConfirm(`Regrouper ${what} de « ${m.title} » sur un seul plateau ? Ils deviennent une seule impression au planning ` +
            `(à regrouper ensuite dans Bambu Studio). Le menu du plateau regroupé permet de les dégrouper.`)) onApply(a.action);
        }} style={{ ...seg, ...segOn, padding: "3px 9px" }}>Appliquer</button>}
      {onSheet && m.ref && <button type="button" onClick={() => onSheet(m.ref)} data-tip="Ouvrir la fiche MakerWorld du modèle, sur le profil planifié"
        style={{ ...seg, padding: "3px 9px" }}>🧾 Fiche</button>}
    </div>
    {gal && createPortal(<div onClick={() => setGal(false)} style={{ position: "fixed", inset: 0, zIndex: 9600, background: "rgba(15,23,42,.6)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(560px, 100%)", maxHeight: "85vh", overflowY: "auto", borderRadius: 18, padding: 14,
        background: "var(--sheet-bg, var(--surface))", border: "1px solid var(--border)", boxShadow: "0 20px 50px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 15 }}>🧩</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</span>
          <button type="button" onClick={() => setGal(false)} aria-label="Fermer" style={mini}>✕</button>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginBottom: 10 }}>
          {m.items.length} plateaux réunis sur un seul{m.last ? ` · ${m.last.label} en dernier (${m.last.h} mm)` : ""}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}>
          {m.items.map((x, i) => <div key={x.key || i} style={{ borderRadius: 14, overflow: "hidden", border: `1px solid color-mix(in srgb, ${cc} 22%, var(--border))`, background: "var(--surface)" }}>
            <div style={{ aspectRatio: "1", background: "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {x.thumb ? <MwImg src={x.thumb} w={300} style={{ width: "100%", height: "100%", objectFit: "contain" }}/> : <span style={{ fontSize: 30 }}>🧩</span>}</div>
            <div style={{ padding: "6px 8px", display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>{x.label || `Plateau ${x.plate}`}
                {(x.label ? `Plateau ${x.plate}` : x.name) ? <span style={{ color: "var(--muted)", fontWeight: 700 }}> · {x.label ? `plateau ${x.plate}` : x.name}</span> : null}</span>
              {x.fils?.length > 0 && <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{x.fils.map((f, k) => <Dot key={k} f={f}/>)}</span>}
            </div>
          </div>)}
        </div>
        {onSheet && m.ref && <button type="button" onClick={() => { setGal(false); onSheet(m.ref); }} style={{ ...seg, ...segOn, marginTop: 12, padding: "6px 12px" }}>🧾 Ouvrir la fiche MakerWorld</button>}
      </div>
    </div>, document.body)}
  </div>;
}
// chaque sorte, sa couleur (06/11/2026 : des accordeons gris et des cartes blanches)
const ADV_KINDS = [["deadline", "🎯", "Dates limites", "#EF4444"], ["merge", "🧩", "Regrouper des plateaux", "#6366F1"],
  ["colors", "🎨", "Enchaîner les mêmes couleurs", "#EC4899"], ["gap", "⏱", "Remplir un creux", "#0EA5E9"],
  ["load", "🧵", "Bobines à charger", "#0891B2"], ["long", "⚠️", "Trop longs pour les horaires", "#F59E0B"]];
export function PlanAdvice({ items, edit, onApply, onSheet, at = null }) {
  // fermees a l'ouverture (06/11/2026) : toutes les sortes se voient d'un coup d'oeil, on deplie celle qui interesse
  const [open, setOpen] = useState({});
  if (!items?.length) return null;
  const flip = k => setOpen(s => ({ ...s, [k]: !s[k] }));
  const shut = Object.fromEntries(ADV_KINDS.concat([["other"]]).map(([k]) => [k, !open[k]]));
  const known = new Set(ADV_KINDS.map(k => k[0]));
  const groups = [...ADV_KINDS, ["other", "💡", "Autres", "#64748B"]].map(([k, ic, l, c]) => [k, ic, l, c, items.filter(a => k === "other" ? !known.has(a.kind) : a.kind === k)])
    .filter(g => g[4].length);
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    {/* calcules en fond (06/11/2026) : les derniers, et quand */}
    {at && <span data-tip="Calculés en fond par la tâche du planning, et quelques secondes après chaque changement"
      style={{ alignSelf: "flex-end", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>calculés à {at.slice(11, 16).replace(":", " h ")}</span>}
    {groups.map(([k, ic, l, c, list]) => <div key={k} style={{ borderRadius: 16, overflow: "hidden", border: `1px solid color-mix(in srgb, ${c} 28%, var(--border))`,
      background: `color-mix(in srgb, ${c} 4%, var(--surface))` }}>
      <button type="button" onClick={() => flip(k)} aria-expanded={!shut[k]}
        style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
          background: `linear-gradient(100deg, color-mix(in srgb, ${c} 16%, var(--surface)), color-mix(in srgb, ${c} 4%, var(--surface)) 70%)` }}>
        <span style={{ width: 30, height: 30, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, flexShrink: 0,
          background: `color-mix(in srgb, ${c} 20%, var(--surface))`, boxShadow: `0 4px 10px -6px ${c}` }}>{ic}</span>
        <span style={{ flex: 1, fontSize: 13.5, fontWeight: 900, color: "var(--text)" }}>{l}</span>
        <span style={{ minWidth: 22, height: 22, padding: "0 7px", borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 11.5, fontWeight: 900, color: "#fff", background: c }}>{list.length}</span>
        <span style={{ color: c, fontSize: 12, transform: shut[k] ? "rotate(-90deg)" : "none", transition: "transform .15s" }}>▾</span></button>
      {!shut[k] && <div style={{ display: "flex", flexDirection: "column", gap: 7, padding: "4px 10px 10px" }}>
        {list.map((a, i) => a.m ? <MergeCard key={i} a={a} c={c} edit={edit} onApply={onApply} onSheet={onSheet}/>
          : <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "9px 10px", borderRadius: 12,
            border: `1px solid color-mix(in srgb, ${c} 18%, var(--border))`, background: `color-mix(in srgb, ${c} 6%, var(--surface))` }}>
          <span style={{ fontSize: 15 }}>{a.icon}</span>
          <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: "var(--text2)", lineHeight: 1.45 }}><AdvText t={a.text}/></span>
          {edit && a.action && <button type="button" onClick={() => onApply(a.action)} style={{ ...seg, ...segOn, padding: "3px 9px", flexShrink: 0 }}>Appliquer</button>}
        </div>)}</div>}
    </div>)}
  </div>;
}

const act = { height: 26, padding: "0 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)",
  cursor: "pointer", fontSize: 11.5, fontWeight: 800, display: "inline-flex", alignItems: "center", gap: 3, whiteSpace: "nowrap" };
const mini = { width: 26, height: 24, borderRadius: 7, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)", cursor: "pointer",
  fontSize: 12, fontWeight: 900, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 4px" };
const seg = { padding: "5px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--muted)", fontSize: 12, fontWeight: 800, cursor: "pointer" };
const segOn = { color: "#6366F1", borderColor: "color-mix(in srgb, #6366F1 45%, var(--border))", background: "color-mix(in srgb, #6366F1 10%, var(--surface2))" };
const tin = { padding: "7px 10px", borderRadius: 11, border: "1px solid color-mix(in srgb, #6366F1 22%, var(--border))", background: "var(--surface)",
  color: "var(--text)", fontSize: 13, fontWeight: 800, fontFamily: "inherit", outline: "none",
  boxShadow: "0 1px 2px rgba(15,23,42,.06), inset 0 1px 0 rgba(255,255,255,.4)", minHeight: 36 };
const lab = { fontSize: 12.5, fontWeight: 900, color: "var(--text2)", marginBottom: 6 };
const hint = { fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45, marginTop: 5 };

// les filaments du plateau (08/11/2026), meme sans rien a charger : leur pastille, et le slot de l'AMS ou chacun est
// en ce moment (« ● Marron foncé · B1 ») ; celui a charger n'a pas encore de slot
export function UsedFils({ j }) {
  const ams = usePrinter(s => s.status?.ams_list);
  const fils = (j.fils || []).filter(f => f.filament_id);
  if (!fils.length) return null;
  const slotOf = fid => { for (const a of ams || []) for (const t of a.trays || []) if (t.spool_info?.filament_id === fid) return slotLabel(a.id, t.id); return null; };
  return <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 2 }}>
    {fils.map((f, i) => { const sl = slotOf(f.filament_id);
      return <span key={i} data-tip={`${f.name || "filament"}${f.g ? ` · ${f.g} g` : ""}${sl ? ` · dans ${sl}` : " · à charger"}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "2px 8px 2px 5px", borderRadius: 20, fontSize: 11, fontWeight: 800,
          color: "var(--text2)", background: "var(--surface2)", border: "1px solid var(--border)", maxWidth: "100%", minWidth: 0 }}>
        <FilDot id={f.filament_id} size={11}/>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{f.name}</span>
        {sl && <span style={{ color: "#0284C7", fontWeight: 900, marginLeft: 3, flexShrink: 0 }}>· {sl}</span>}</span>; })}
  </div>;
}
