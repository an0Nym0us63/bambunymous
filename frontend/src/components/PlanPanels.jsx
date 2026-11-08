import React, { useState } from "react";
import { createPortal } from "react-dom";
import { PlateThumb, plateTxt, jobName, doneTxt, dueTxt, hhmm, unretained, UNRET, runoutTxt, bedTxt, FilLink, FilLinks, finIc, LoadLinks, platePics } from "./PlanDay";
import Lightbox from "./Lightbox";
import { useStackZ } from "../utils/zstack";
import { useSwipeClose } from "../utils/swipeClose";

// Les fenetres du planning (05/11/2026) : une fenetre (en bas au telephone, au centre sur ordinateur), la fiche
// d'actions d'un plateau, la file regroupee par objet, les plateaux non planifiables.

const hm = s => { const m = Math.round((s || 0) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
const when = (iso, now) => {
  if (!iso) return "";
  const d = iso.slice(0, 10), today = (now || "").slice(0, 10);
  return d === today ? hhmm(iso) : `${new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} ${hhmm(iso)}`;
};

// le bouton « Annuler » (06/11/2026) : le dernier geste du planning, et il y a combien de temps
export function UndoPill({ info, onUndo, compact, style }) {
  if (!info) return null;
  const min = Math.max(0, Math.round((Date.now() - Date.parse(`${info.at}Z`)) / 60000));
  const ago = min < 1 ? "à l'instant" : min < 60 ? `il y a ${min} min` : min < 1440 ? `il y a ${Math.round(min / 60)} h` : `il y a ${Math.round(min / 1440)} j`;
  return <button type="button" onClick={onUndo} data-tip={`Annuler : ${info.why} (${ago}) ; l'ordre, les jours figés, les priorités… redeviennent comme avant`}
    aria-label={`Annuler : ${info.why}`} style={{ padding: "6px 12px", borderRadius: 20, border: "1px solid color-mix(in srgb, #F59E0B 45%, var(--border))",
      background: "color-mix(in srgb, #F59E0B 10%, var(--surface2))", color: "#B45309", fontFamily: "inherit", fontSize: 12, fontWeight: 800, cursor: "pointer",
      whiteSpace: "nowrap", ...style }}>↶{compact ? "" : ` Annuler : ${info.why}`}</button>;
}

export function PlanPopup({ title, icon, color = "#6366F1", onClose, children, wide, z: z0 = 5200 }) {
  const z = useStackZ(z0);              // au-dessus de toute fenetre deja ouverte (06/11/2026)
  const phone = typeof window !== "undefined" && window.innerWidth < 640;
  const { sheet, handle } = useSwipeClose(onClose);    // au telephone, la barre de titre glissee vers le bas ferme
  return createPortal(<div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: z, background: "rgba(2,6,23,0.55)", backdropFilter: "blur(5px)",
    display: "flex", alignItems: phone ? "flex-end" : "center", justifyContent: "center", padding: phone ? 0 : 16 }}>
    <div ref={sheet} onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: wide ? 760 : 520, maxHeight: phone ? "88dvh" : "84dvh", display: "flex", flexDirection: "column",
      background: "var(--sheet-bg)", border: "1px solid var(--border)", borderRadius: phone ? "22px 22px 0 0" : 20, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.45)" }}>
      <div {...(phone ? handle : {})} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", flexShrink: 0, ...(phone ? { touchAction: "none" } : {}),
        background: `linear-gradient(135deg, color-mix(in srgb, ${color} 18%, transparent), transparent 70%)`, borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 15.5, fontWeight: 900, color: "var(--text)" }}>{title}</span>
        <button type="button" onClick={onClose} aria-label="Fermer" style={{ width: 32, height: 32, borderRadius: 10, border: "1px solid var(--border)",
          background: "var(--surface)", color: "var(--text2)", cursor: "pointer" }}>✕</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, paddingBottom: phone ? "max(14px, env(safe-area-inset-bottom))" : 12 }}>{children}</div>
    </div>
  </div>, document.body);
}

// ce que dit un plateau : ce qu'il faut charger, une commande dont il depend, un filament qui passe sous le seuil
export function StockTags({ j }) {
  const t = (txt, c, tip) => <span data-tip={tip} style={{ fontSize: 11, fontWeight: 900, color: c, borderRadius: 7, padding: "1px 7px",
    background: `color-mix(in srgb, ${c} 13%, transparent)` }}>{txt}</span>;
  return <>
    {j.awaits_order?.length > 0 && t(`🚚 compte sur la commande : ${j.awaits_order.join(", ")}`, "#0EA5E9", "Le stock ne suffit pas : ce plateau prend sur une bobine commandée, pas encore reçue")}
    {j.low_after?.length > 0 && t(`📉 sous le seuil : ${j.low_after.join(", ")}`, "#DC2626", "Après ce plateau, il restera moins d'un quart de bobine de ce filament : penser à en racheter")}
  </>;
}

// la fiche d'actions d'un plateau : le placer au mieux, plus tard, sur un jour ; la fiche du modele ; fait ; date limite
// les lignes d'action d'une fiche : un bouton (icone, nom, explication) ou un choix de date ; close : la fiche se ferme
// apres l'action (celle d'un plateau) ou reste ouverte pour voir le resultat (celle d'un modele)
function useActRows(onDone) {
  const [busy, setBusy] = useState(null);
  const run = async (k, fn) => { setBusy(k); try { await fn(); onDone?.(); } finally { setBusy(null); } };
  const row = (k, ic, label, hint, onClick, tone = "var(--text)") => <button key={k} type="button" disabled={!!busy} onClick={onClick}
    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer",
      background: "var(--surface)", textAlign: "left", font: "inherit", opacity: busy && busy !== k ? 0.5 : 1 }}>
    <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{busy === k ? "…" : ic}</span>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 13.5, fontWeight: 900, color: tone }}>{label}</span>
      {hint && <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>{hint}</span>}
    </span></button>;
  const dateRow = (k, ic, label, hint, value, onPick, min) => <label key={k} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
    borderRadius: 12, border: "1px solid var(--border)", cursor: "pointer", background: "var(--surface)" }}>
    <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{ic}</span>
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: "block", fontSize: 13.5, fontWeight: 900, color: "var(--text)" }}>{label}</span>
      <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>{hint}</span></span>
    <input type="date" onClick={e => { try { e.currentTarget.showPicker?.(); } catch { /* rien */ } }} value={value || ""} min={min} onChange={e => run(k, () => onPick(e.target.value || null))}
      style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%" }}/></label>;
  return { busy, run, row, dateRow };
}

export function JobSheet({ j, now, edit, onClose, act, jobs }) {
  const { busy, run, row, dateRow } = useActRows(onClose);
  const big = (k, ic, label, tip, onClick) => <button key={k} type="button" disabled={!!busy} onClick={onClick} data-tip={tip}
    style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "10px 6px", borderRadius: 12, cursor: "pointer", font: "inherit",
      border: "1px solid var(--border)", background: "var(--surface)", opacity: busy && busy !== k ? 0.5 : 1 }}>
    <span style={{ fontSize: 20 }}>{busy === k ? "…" : ic}</span>
    <span style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text)" }}>{label}</span></button>;
  const chipBtn = (label, tip, onClick) => <button key={label} type="button" disabled={!!busy} onClick={onClick} data-tip={tip}
    style={{ padding: "6px 11px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", cursor: "pointer", font: "inherit",
      fontSize: 12, fontWeight: 800, color: "var(--text2)" }}>{label}</button>;
  const [slot, setSlot] = useState(false);            // choisir sa place dans une journee (06/11/2026)
  const [zoom, setZoom] = useState(false);            // la vignette en grand (08/11/2026), chaque plateau d'un regroupement
  const pics = platePics(j);
  if (slot) return <SlotPicker j={j} jobs={jobs || []} now={now} onClose={() => setSlot(false)}
    onPick={(day, after) => run("slot", () => act.slot(day, after))} onAuto={day => run("slot", () => act.dayBest(day))}/>;
  return <PlanPopup title={j.title} icon="🧩" color={j.why ? "#DC2626" : unretained(j) ? UNRET : j.completes ? "#059669" : "#22C55E"} onClose={onClose} z={5300}>
    <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
      <PlateThumb j={j} size={64} onClick={pics.length ? () => setZoom(true) : undefined}
        tip={j.merged_thumbs?.length > 1 ? `Voir les ${j.merged_thumbs.length} plateaux en grand` : "Voir en grand"}/>
      {zoom && <Lightbox images={pics} title={j.title} onClose={() => setZoom(false)}/>}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: "#6366F1" }}>{plateTxt(j)}{j.qty > 1 ? ` · ${j.copy}e sur ${j.qty}` : ""}</span>
        {j.start && <span style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{when(j.start, now)} → {when(j.end, now)} <span style={{ fontSize: 12, color: "var(--muted)" }}>{hm(j.seconds)}</span>
          {j.est_seconds ? <span data-tip="Durée corrigée selon tes impressions passées (Réglages › Durées)" style={{ fontSize: 11, color: "var(--muted)" }}> · {hm(j.est_seconds)} annoncé</span> : null}</span>}
        <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {j.locked ? <span style={{ fontSize: 11, fontWeight: 900, color: "#4F46E5" }}>🔒 jour et heure figés</span>
            : j.pinned && <span style={{ fontSize: 11, fontWeight: 900, color: "#7C3AED" }}>📌 jour figé</span>}
          {unretained(j) && <span style={{ fontSize: 11, fontWeight: 900, color: "#64748B" }}>○ non retenu</span>}
          {j.completes && <span style={{ fontSize: 11, fontWeight: 900, color: "#047857" }}>{doneTxt(j)}</span>}
          {j.intercalated && <span style={{ fontSize: 11, fontWeight: 900, color: "#0EA5E9" }}>{interTxt(j)}</span>}
          {j.due && <span style={{ fontSize: 11, fontWeight: 900, color: j.due_ok ? "#16A34A" : "#EF4444" }}>🎯 avant le {dueTxt(j.due)}</span>}
          {prioChip(j.prio_m)}{j.prio_p ? prioChip(j.prio_p, { opacity: 0.85 }) : null}
          {j.load?.length > 0 && <span style={{ fontSize: 11, fontWeight: 900, color: "color-mix(in srgb, #0891B2 78%, var(--text2))" }}>🧵 à charger : <LoadLinks j={j}/>{j.free_slot && !j.unload?.length ? " (emplacement libre)" : ""}</span>}
          {j.unload?.length > 0 && <span style={{ fontSize: 11, fontWeight: 900, color: "#64748B" }}>↩ à retirer : <FilLinks labels={j.unload} ids={j.unload_ids}/></span>}
          {j.bed_change && <span style={{ fontSize: 11, fontWeight: 900, color: "#0369A1" }}>{bedTxt(j.bed_change)}</span>}
          {j.bed_warn && <span style={{ fontSize: 11, fontWeight: 800, color: "#B45309" }}>🔲 {j.bed_warn}</span>}
          {(j.runout || []).map(r => <span key={r.name} style={{ fontSize: 11, fontWeight: 900, color: "#B45309" }}>🔄 <FilLink id={r.id} label={r.name}/>{runoutTxt(r).slice(3 + r.name.length)}</span>)}
          <StockTags j={j}/>
        </span>
        {(j.reasons || []).map((r, i) => <span key={i} style={{ fontSize: 11.5, color: "var(--muted)" }}>↪ {r}</span>)}
        {j.why && j.why.map((r, i) => <span key={i} style={{ fontSize: 11.5, fontWeight: 800, color: "#DC2626" }}>⛔ {r}</span>)}
      </div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {/* la fiche simplifiee (06/11/2026) : figer ; trois actions cote a cote ; l'objet entier dans sa propre fiche ; le reste
          en petits boutons. Toutes les fonctions d'avant y sont. */}
      {edit && !j.why && j.start && !unretained(j) && <FreezePick j={j} now={now} busy={busy} run={run} act={act}/>}
      {edit && !j.why && unretained(j) && <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 12,
        border: "1px dashed color-mix(in srgb, #94A3B8 60%, var(--border))", background: "var(--surface2)" }}>
        <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>○</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", lineHeight: 1.4 }}>Pas retenu : il passe après tous les plateaux retenus, et ne se pose
          sur aucun jour. Pour le placer, retiens son profil dans <b>Fiche MakerWorld</b>.</span></div>}
      {edit && !j.why && !j.locked && <div style={{ display: "grid", gridTemplateColumns: unretained(j) ? "1fr 1fr" : "1fr 1fr 1fr", gap: 6 }}>
        {big("smart", "✨", "Au mieux", "Là où il charge le moins de filaments, sans faire rater de date limite, le plus tôt possible", () => run("smart", act.smart))}
        {!unretained(j) && (act.slot && jobs
          ? big("slot", "📍", "Sur un jour…", "Le jour, puis sa place : automatique ou celle que tu touches entre les plateaux du jour", () => setSlot(true))
          : big("slot", "📍", "Sur un jour…", "À la meilleure place de la journée choisie", () => setSlot(true)))}
        {big("later", "⏭", "Plus tard", "Il quitte sa place et son jour, et passe en fin de file", () => run("later", act.later))}
      </div>}
      {edit && !j.why && j.plates_total > 1 && act.prioPlate && <PrioPick plate value={j.prio_p} busy={busy} run={run} onPick={act.prioPlate}/>}
      {/* l'objet entier : sa fiche (tout plus tard, d'une traite, date limite, tous ses plateaux sur un jour) */}
      {act.model ? row("model", "🧩", "Tout l'objet", [j.plates_total > 1 ? `${j.plates_total} plateaux` : null, j.prio_m ? `priorité ${prioOf(j.prio_m)[2].toLowerCase()}` : null, j.chain ? "d'une traite" : null,
          j.due ? `avant le ${dueTxt(j.due)}` : null].filter(Boolean).join(" · ") || "Tous ses plateaux sur un jour, plus tard, d'une traite, une date limite",
          () => { act.model(); onClose(); })
        : <>
          {edit && !j.why && !j.locked && j.plates_total > 1 && act.laterAll && row("laterall", "⏬", "Tout l'objet plus tard", "Tous les plateaux de cet objet passent en fin de file, dans leur ordre ; les figés restent", () => run("laterall", act.laterAll))}
          {edit && act.chain && (j.plates_total > 1 || j.qty > 1) && <ChainPick j={j} busy={busy} run={run} act={act}/>}
          {edit && dateRow("due", "🎯", j.due ? "Changer la date limite" : "Une date limite pour l'objet", j.due ? `Fini avant le ${dueTxt(j.due)}` : "Le planning prévient s'il déborde", j.due, v => act.due(v))}
        </>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {j.day && chipBtn("🗓 Sa journée", "Voir sa journée dans le calendrier", () => { act.dayview(); onClose(); })}
        {edit && act.unmerge && chipBtn(busy === "unmerge" ? "…" : "🧩 Dégrouper", "Ses plateaux redeviennent des impressions séparées", () => run("unmerge", act.unmerge))}
        {chipBtn("🧾 Fiche MakerWorld", "Retenir le profil, choisir les plateaux, les filaments et le nombre d'exemplaires", () => { act.sheet(); onClose(); })}
        {edit && chipBtn(busy === "done" ? "…" : "✓ Fait", "Imprimé hors de l'appli, ou pas reconnu : il compte comme fait", () => run("done", act.done))}
      </div>
    </div>
  </PlanPopup>;
}

// Un objet « d'une traite » (06/11/2026) : libre (d'autres objets peuvent s'intercaler), ses plateaux d'un exemplaire
// a la suite, ou tout l'objet (tous ses exemplaires) a la suite
// Figer un plateau (06/11/2026), en trois crans : libre (le planning le place ou il tient) ; le jour (il reste ce jour-la,
// l'ordre de la journee peut changer ; c'est aussi ce que fait le poser sur un jour) ; le jour et l'heure (rien ne le
// deplace plus, le reste s'organise autour)
function FreezePick({ j, now, busy, run, act }) {
  const cur = j.locked ? "time" : j.pinned ? "day" : null;
  const day = j.day ? new Date(`${j.day}T12:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) : "";
  const opts = [[null, "Libre", "Le planning le place où il tient, et les optimiseurs peuvent le déplacer"],
    ["day", "Le jour", `Il reste le ${day} ; l'heure peut bouger (l'ordre de la journée, l'optimiseur de la journée)`],
    ["time", "Jour et heure", `Il part le ${day} à ${hhmm(j.start)} : rien ne le déplace, le reste s'organise autour`]];
  const go = async k => {
    if (k === "time") return act.lock();
    if (cur === "time") await act.unlock();        // defiger l'heure garde le jour
    if (k === "day" && cur !== "day" && cur !== "time") await act.pinDay();
    if (k === null && (cur === "day" || cur === "time")) await act.unpin();
  };
  const tone = cur === "time" ? "#4F46E5" : cur === "day" ? "#7C3AED" : "var(--text)";
  return <div style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${cur ? "color-mix(in srgb, #6366F1 40%, var(--border))" : "var(--border)"}`, background: "var(--surface)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
      <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{busy === "freeze" ? "…" : cur === "time" ? "🔒" : cur === "day" ? "📌" : "🔓"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 900, color: tone }}>Figer</span>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>{(opts.find(o => o[0] === cur) || opts[0])[2]}</span></span></div>
    <div role="radiogroup" style={{ display: "flex", padding: 3, borderRadius: 11, background: "var(--surface2)", border: "1px solid var(--border)" }}>
      {opts.map(([k, l]) => <button key={l} type="button" role="radio" aria-checked={cur === k} disabled={!!busy}
        onClick={() => cur !== k && run("freeze", () => go(k))}
        style={{ flex: 1, padding: "6px 4px", borderRadius: 9, border: "none", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 900,
          color: cur === k ? "#fff" : "var(--muted)", background: cur === k ? (k === "time" ? "linear-gradient(135deg, #4F46E5, #6366F1)"
            : k === "day" ? "linear-gradient(135deg, #7C3AED, #A855F7)" : "linear-gradient(135deg, #64748B, #94A3B8)") : "transparent" }}>{l}</button>)}
    </div>
  </div>;
}

// La priorite (06/11/2026) : d'un modele par rapport aux autres modeles, d'un plateau par rapport aux autres plateaux de
// son modele. Une date limite passe avant ; les figes et les jours figes ne bougent pas pour elle.
export const PRIOS = [[2, "🔥", "Urgent", "#DC2626"], [1, "⬆", "Haute", "#EA580C"], [0, "•", "Normale", "#64748B"],
  [-1, "⬇", "Basse", "#0EA5E9"], [-2, "⏬", "Très basse", "#6366F1"]];
export const prioOf = v => PRIOS.find(p => p[0] === (v || 0)) || PRIOS[2];
const PRIO_TIP = {
  model: { 2: "Il passe devant tous les autres modèles retenus (les figés et les jours figés restent, une date limite reste tenue)",
    1: "L'optimiseur l'avance nettement : il ne le retarde que pour un vrai gain (une nuit, des bobines)",
    0: "Comme les autres", "-1": "L'optimiseur le laisse passer après les autres quand ça arrange",
    "-2": "Il passe après les autres modèles, sauf s'il a une date limite à tenir" },
  plate: { 2: "Le premier de ses plateaux à imprimer", 1: "Avant ses autres plateaux normaux", 0: "Dans l'ordre de la file",
    "-1": "Après ses autres plateaux normaux", "-2": "Le dernier de ses plateaux" } };
function PrioPick({ value, busy, run, onPick, plate }) {
  const cur = value || 0, [, ic, l, c] = prioOf(cur);
  return <div style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${cur ? `color-mix(in srgb, ${c} 40%, var(--border))` : "var(--border)"}`, background: "var(--surface)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
      <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{busy === "prio" ? "…" : cur ? ic : "⚖"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 900, color: cur ? c : "var(--text)" }}>{plate ? "Priorité dans le modèle" : "Priorité"}{cur ? ` : ${l}` : ""}</span>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>{PRIO_TIP[plate ? "plate" : "model"][cur]}</span></span></div>
    <div role="radiogroup" style={{ display: "flex", padding: 3, borderRadius: 11, background: "var(--surface2)", border: "1px solid var(--border)" }}>
      {PRIOS.map(([k, pic, pl, pc]) => <button key={k} type="button" role="radio" aria-checked={cur === k} disabled={!!busy} data-tip={pl}
        onClick={() => cur !== k && run("prio", () => onPick(k))}
        style={{ flex: 1, padding: "6px 2px", borderRadius: 9, lineHeight: 1.15, minWidth: 0, border: "none", cursor: "pointer", font: "inherit", fontSize: 11.5, fontWeight: 900,
          display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
          color: cur === k ? "#fff" : "var(--muted)", background: cur === k ? pc : "transparent" }}>
        <span style={{ fontSize: 13 }}>{pic}</span><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{pl}</span></button>)}
    </div>
  </div>;
}
export const prioChip = (v, style) => v ? <span data-tip={`Priorité ${prioOf(v)[2].toLowerCase()}`} style={{ ...chipS(prioOf(v)[3]), ...style }}>{prioOf(v)[1]} {prioOf(v)[2]}</span> : null;

// Figer tout un modele (06/11/2026), comme un plateau : libre, le jour, ou le jour et l'heure. Ses plateaux dans des etats
// differents : aucun choix allume, la ligne le dit.
function ModelFreezePick({ ok, busy, run, act }) {
  const n = ok.length, nl = ok.filter(j => j.locked).length, np = ok.filter(j => j.pinned && !j.locked).length;
  const cur = nl === n ? "time" : np === n ? "day" : !nl && !np ? null : "mix";
  const opts = [[null, "Libre", "Le planning place ses plateaux où ils tiennent, et les optimiseurs peuvent les déplacer"],
    ["day", "Le jour", "Chaque plateau reste le jour où il est prévu ; l'heure peut bouger"],
    ["time", "Jour et heure", "Chaque plateau part au jour et à l'heure prévus : rien ne les déplace, le reste s'organise autour"]];
  const tip = cur === "mix" ? `En partie : ${[nl && `${nl} figé${nl > 1 ? "s" : ""} jour et heure`, np && `${np} au jour figé`, n - nl - np && `${n - nl - np} libre${n - nl - np > 1 ? "s" : ""}`].filter(Boolean).join(", ")}`
    : opts.find(o => o[0] === cur)[2];
  const tone = cur === "time" ? "#4F46E5" : cur === "day" ? "#7C3AED" : "var(--text)";
  return <div style={{ padding: "10px 12px", borderRadius: 12, border: `1px solid ${cur ? "color-mix(in srgb, #6366F1 40%, var(--border))" : "var(--border)"}`, background: "var(--surface)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
      <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{busy === "freeze" ? "…" : cur === "time" ? "🔒" : cur === "day" ? "📌" : cur === "mix" ? "◐" : "🔓"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 900, color: tone }}>Figer {n > 1 ? `ses ${n} plateaux` : "le plateau"}</span>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>{tip}</span></span></div>
    <div role="radiogroup" style={{ display: "flex", padding: 3, borderRadius: 11, background: "var(--surface2)", border: "1px solid var(--border)" }}>
      {opts.map(([k, l]) => <button key={l} type="button" role="radio" aria-checked={cur === k} disabled={!!busy}
        onClick={() => cur !== k && run("freeze", () => act.freeze(k))}
        style={{ flex: 1, padding: "6px 4px", borderRadius: 9, border: "none", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 900,
          color: cur === k ? "#fff" : "var(--muted)", background: cur === k ? (k === "time" ? "linear-gradient(135deg, #4F46E5, #6366F1)"
            : k === "day" ? "linear-gradient(135deg, #7C3AED, #A855F7)" : "linear-gradient(135deg, #64748B, #94A3B8)") : "transparent" }}>{l}</button>)}
    </div>
  </div>;
}

// 06/11/2026 : les mots disent l'objet, pas ses plateaux. Un seul exemplaire : libre ou d'une traite (les deux reglages
// reviennent au meme). Plusieurs : chaque exemplaire d'une traite (entre deux, d'autres objets passent), ou tous les
// exemplaires a la suite. Un modele d'un seul plateau : seul « tous les exemplaires » a un sens.
const chainMode = j => !j.chain ? null : j.chain === "soft" ? "soft" : (j.qty || 1) > 1 ? (j.plates_total > 1 ? j.chain : "all") : "plates";
// un plateau intercale dans un objet « au mieux » (06/11/2026) : dans lequel, et pourquoi
const WHY_TXT = { nuit: "pour remplir la nuit", filaments: "pour charger moins de filaments", optimiser: "pour optimiser" };
export const interTxt = j => j.intercalated ? `↔ intercalé dans ${j.intercalated.in} : ${WHY_TXT[j.intercalated.why] || WHY_TXT.optimiser}` : "";
export const chainTxt = j => ({ soft: "🔗 enchaîné au mieux", plates: (j.qty || 1) > 1 ? "🔗 chaque exemplaire d'une traite" : "🔗 d'une traite",
  all: (j.qty || 1) > 1 ? "🔗 tous les exemplaires à la suite" : "🔗 d'une traite" })[chainMode(j)] || "";
function ChainPick({ j, busy, run, act }) {
  const many = (j.qty || 1) > 1;
  const opts = [[null, "Libre", "D'autres objets peuvent s'intercaler entre ses plateaux (l'optimiseur enchaîne les mêmes couleurs)"],
    ["soft", "Au mieux", "Ses plateaux se suivent autant que possible ; l'optimiseur peut en intercaler un d'un autre objet pour remplir une nuit ou charger moins de filaments (le plateau intercalé le dit)"],
    !many && ["plates", "D'une traite", "Ses plateaux se suivent : commencé, il se finit sans rien entre deux"],
    many && j.plates_total > 1 && ["plates", "Chaque exemplaire", "Les plateaux d'un exemplaire se suivent ; entre deux exemplaires, d'autres objets peuvent passer"],
    many && ["all", "Tous les exemplaires", `Les ${j.qty} exemplaires à la suite${j.plates_total > 1 ? ", chacun plateau après plateau" : ""}, sans rien entre deux`]].filter(Boolean);
  const cur = chainMode(j);
  const tip = (opts.find(o => o[0] === cur) || opts[0])[2];
  return <div style={{ padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)" }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
      <span style={{ fontSize: 18, width: 24, textAlign: "center" }}>{busy === "chain" ? "…" : "🔗"}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 900, color: "var(--text)" }}>D'une traite</span>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.35 }}>{tip}</span></span></div>
    <div role="radiogroup" style={{ display: "flex", padding: 3, borderRadius: 11, background: "var(--surface2)", border: "1px solid var(--border)" }}>
      {opts.map(([k, l]) => <button key={l} type="button" role="radio" aria-checked={cur === k} disabled={!!busy}
        onClick={() => cur !== k && run("chain", () => act.chain(k))}
        style={{ flex: 1, padding: "6px 4px", borderRadius: 9, lineHeight: 1.15, minWidth: 0, border: "none", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 900,
          color: cur === k ? "#fff" : "var(--muted)", background: cur === k ? "linear-gradient(135deg, #0EA5E9, #6366F1)" : "transparent" }}>{l}</button>)}
    </div>
  </div>;
}

// La file en resume (06/11/2026) : une carte par modele, sans ses plateaux (la page en devenait illisible). Sa
// vignette, son nom, combien de plateaux et d'heures, de quand a quand, ce qui demande attention, et une frise d'un
// trait par plateau (vert : prevu ; indigo : fige ; rouge : non planifiable). La toucher ouvre sa fiche (ModelSheet).
export function poolGroups(jobs, blocked = []) {
  const groups = [], at = {};
  for (const j of [...(jobs || []), ...(blocked || []).map(b => ({ ...b, blockedWhy: b.why }))]) {
    if (!(j.design_id in at)) { at[j.design_id] = groups.length; groups.push({ id: j.design_id, jobs: [] }); }
    groups[at[j.design_id]].jobs.push(j);
  }
  return groups;
}
const gInfo = g => {
  const ok = g.jobs.filter(j => !j.blockedWhy), f = ok[0] || g.jobs[0];
  const starts = ok.map(j => j.start).filter(Boolean).sort(), ends = ok.map(j => j.end).filter(Boolean).sort();
  return { ok, f, nb: g.jobs.length - ok.length, tot: ok.reduce((a, j) => a + j.seconds, 0), first: starts[0], last: ends[ends.length - 1],
    locked: ok.filter(j => j.locked).length, pinned: ok.filter(j => j.pinned && !j.locked).length, load: ok.some(j => j.load?.length),
    merged: ok.filter(j => j.merged).length,                       // ses plateaux regroupes (06/11/2026)
    low: ok.some(j => j.low_after?.length), wait: ok.some(j => j.awaits_order?.length) };
};
// « du … au … » en bon francais (06/11/2026 : « du Aujourd'hui au Demain ») : d'aujourd'hui, de demain, du sam. 7 nov. ;
// a aujourd'hui, a demain, au sam. 7 nov. ; time : l'heure en plus
const B = ({ children }) => <b style={{ color: "var(--text)" }}>{children}</b>;
function fromTo(a, b, now, time = false) {
  const word = iso => { const t = dayOf(iso, now); return t === "Aujourd'hui" ? ["d'", "à ", "aujourd'hui"] : t === "Demain" ? ["de ", "à ", "demain"] : ["du ", "au ", t]; };
  const [de, , la] = word(a), [, au, lb] = word(b);
  return <>{de}<B>{la}{time ? ` ${hhmm(a)}` : ""}</B> {au}<B>{lb}{time ? ` ${hhmm(b)}` : ""}</B></>;
}
const smallBtn = { padding: "5px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)", cursor: "pointer", font: "inherit",
  fontSize: 12, fontWeight: 800, color: "var(--text2)" };
const chipS = c => ({ fontSize: 10.5, fontWeight: 900, color: c, background: `color-mix(in srgb, ${c} 13%, transparent)`, borderRadius: 7,
  padding: "1px 6px", whiteSpace: "nowrap" });
// la recherche « contient », sans accents ni majuscules, mot par mot
const foldTxt = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function PoolSummary({ jobs, blocked = [], now, onOpenModel, bulk }) {
  const all = poolGroups(jobs, blocked);
  // la recherche (07/11/2026) : nom du modele, de ses plateaux, ses filaments (nom, matiere) ; chaque mot doit y etre
  const [q, setQ] = useState("");
  const words = foldTxt(q).split(/\s+/).filter(Boolean);
  const groups = !words.length ? all : all.filter(g => {
    const hay = foldTxt(g.jobs.flatMap(j => [j.title, j.plate_name, ...(j.fils || []).flatMap(f => [f.name, f.type])]).join(" "));
    return words.every(w => hay.includes(w));
  });
  // les actions de masse (06/11/2026) : « Sélectionner », des cases sur les cartes, une barre d'actions
  const [picking, setPicking] = useState(false);
  const [sel, setSel] = useState([]);
  const [busyB, setBusyB] = useState(null);
  const toggle = id => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const go = async (k, fn) => { setBusyB(k); try { await fn(sel); } finally { setBusyB(null); } };
  const bb = (k, label, tip, fn, c = "#6366F1") => <button key={k} type="button" disabled={!sel.length || !!busyB} onClick={() => go(k, fn)} data-tip={tip}
    style={{ padding: "5px 10px", borderRadius: 10, border: `1px solid color-mix(in srgb, ${c} 40%, var(--border))`, background: `color-mix(in srgb, ${c} 10%, var(--surface))`,
      color: c, cursor: sel.length ? "pointer" : "default", font: "inherit", fontSize: 12, fontWeight: 900, opacity: sel.length ? 1 : 0.5, whiteSpace: "nowrap" }}>{busyB === k ? "…" : label}</button>;
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    {all.length > 3 && <div style={{ position: "relative" }}>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher un modèle, un plateau, un filament…" aria-label="Chercher dans la file"
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 34px 9px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)",
          color: "var(--text)", font: "inherit", fontSize: 13.5, fontWeight: 700, outline: "none" }}/>
      {q && <button type="button" onClick={() => setQ("")} aria-label="Effacer la recherche" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
        width: 24, height: 24, borderRadius: 12, border: "none", background: "var(--surface2)", color: "var(--muted)", cursor: "pointer", font: "inherit" }}>✕</button>}
    </div>}
    {words.length > 0 && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
      {groups.length ? `${groups.length} modèle${groups.length > 1 ? "s" : ""} sur ${all.length}` : "Aucun modèle ne correspond."}</div>}
    {bulk && <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <button type="button" onClick={() => { setPicking(v => !v); setSel([]); }} style={{ padding: "5px 11px", borderRadius: 10, cursor: "pointer", font: "inherit",
        fontSize: 12, fontWeight: 900, border: "1px solid var(--border)", background: picking ? "linear-gradient(135deg, #6366F1, #8B5CF6)" : "var(--surface2)",
        color: picking ? "#fff" : "var(--text2)" }}>{picking ? "✕ Fini" : "☑ Sélectionner"}</button>
      {picking && <>
        <button type="button" onClick={() => setSel(sel.length === groups.length ? [] : groups.map(g => g.id))}
          style={{ padding: "5px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 800, color: "var(--text2)" }}>
          {sel.length === groups.length ? "Aucun" : "Tous"}</button>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>{sel.length} modèle{sel.length > 1 ? "s" : ""}</span>
        <span style={{ width: 4 }}/>
        {PRIOS.map(([k, ic, l, c]) => bb(`p${k}`, `${ic} ${l}`, `Priorité ${l.toLowerCase()} pour les modèles choisis`, ids => bulk.prio(ids, k), c))}
        <span style={{ width: 4 }}/>
        {bb("fl", "🔓 Libres", "Leurs plateaux redeviennent libres", ids => bulk.freeze(ids, null), "#64748B")}
        {bb("fd", "📌 Le jour", "Chaque plateau garde son jour", ids => bulk.freeze(ids, "day"), "#7C3AED")}
        {bb("ft", "🔒 Jour et heure", "Chaque plateau garde son jour et son heure", ids => bulk.freeze(ids, "time"), "#4F46E5")}
        <span style={{ width: 4 }}/>
        {bb("front", "⏫ En tête", "Leurs plateaux passent avant les autres (les jours figés restent)", ids => bulk.front(ids), "#16A34A")}
        {bb("later", "⏬ Plus tard", "Leurs plateaux passent en fin de file (les figés restent)", ids => bulk.later(ids), "#EA580C")}
      </>}
    </div>}
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 8 }}>
    {groups.map(g => {
      const x = gInfo(g), f = x.f, un = unretained(f), on = sel.includes(g.id);
      const sameDay = x.first && x.last && x.first.slice(0, 10) === x.last.slice(0, 10);
      return <button key={g.id} type="button" onClick={() => picking ? toggle(g.id) : onOpenModel(g.id)}
        style={{ display: "flex", gap: 11, alignItems: "center", padding: 9, borderRadius: 14, cursor: "pointer", textAlign: "left", font: "inherit", minWidth: 0,
          border: on ? "2px solid #6366F1" : `1px solid ${x.nb ? "color-mix(in srgb, #DC2626 45%, var(--border))" : un ? "color-mix(in srgb, #94A3B8 50%, var(--border))" : "var(--border)"}`,
          background: un ? "var(--surface2)" : "linear-gradient(135deg, color-mix(in srgb, #22C55E 6%, transparent), transparent 60%), var(--surface2)" }}>
        {picking && <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          border: `2px solid ${on ? "#6366F1" : "var(--border)"}`, background: on ? "#6366F1" : "var(--surface)", color: "#fff", fontSize: 13, fontWeight: 900 }}>{on ? "✓" : ""}</span>}
        <PlateThumb j={{ ...f, thumb: null, plates_total: 1 }} size={60}/>
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 13.5, fontWeight: 900,
            color: "var(--text)", lineHeight: 1.25 }}>{un ? "○ " : ""}{f.title}</span>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
            {x.ok.length} plateau{x.ok.length > 1 ? "x" : ""} · {hm(x.tot)}
            {x.first && <> · {sameDay ? <><b style={{ color: "var(--text)" }}>{dayOf(x.first, now)}</b> {hhmm(x.first)}–{hhmm(x.last)}</>
              : fromTo(x.first, x.last, now)}</>}</span>
          {/* une frise : un trait par plateau */}
          <span style={{ display: "flex", gap: 2, height: 5 }}>
            {g.jobs.map(j => <span key={j.key} style={{ flex: 1, borderRadius: 3, background: j.blockedWhy ? "#DC2626" : j.locked ? "#4F46E5"
              : un ? UNRET : j.completes ? "#059669" : "color-mix(in srgb, #22C55E 55%, var(--border))" }}/>)}</span>
          {(x.nb || f.due || f.chain || f.prio_m || x.locked || x.pinned || x.merged || x.load || x.low || x.wait) ? <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {prioChip(f.prio_m)}
            {x.nb > 0 && <span style={chipS("#DC2626")}>⛔ {x.nb} non planifiable{x.nb > 1 ? "s" : ""}</span>}
            {f.due && <span style={chipS(f.due_ok ? "#16A34A" : "#EF4444")}>🎯 {dueTxt(f.due)}</span>}
            {f.chain && <span style={chipS("#0EA5E9")}>{chainTxt(f)}</span>}
            {x.locked > 0 && <span style={chipS("#4F46E5")}>🔒 {x.locked}</span>}
            {x.pinned > 0 && <span style={chipS("#7C3AED")} data-tip="Plateaux au jour figé">📌 {x.pinned}</span>}
            {x.merged > 0 && <span style={chipS("#6366F1")} data-tip="Plateaux regroupés : plusieurs plateaux réunis en une seule impression (à regrouper dans Bambu Studio)">🧩 {x.merged}</span>}
            {x.load && <span style={chipS("#EA580C")}>🧵</span>}
            {x.wait && <span style={chipS("#0EA5E9")}>🚚</span>}
            {x.low && <span style={chipS("#DC2626")}>📉</span>}
          </span> : null}
        </span>
      </button>;
    })}
  </div>
  </div>;
}

// La fiche d'un modele du planning (06/11/2026) : en haut ce qui vaut pour tout le modele (caler tous ses plateaux
// sur un jour, en tete, plus tard, d'une traite, date limite…), dessous chacun de ses plateaux, a toucher pour ses
// actions a lui. Elle reste ouverte apres une action : on voit les plateaux bouger.
export function ModelSheet({ g: g0, now, edit, onClose, onPick, act: act0, jobs, done = null, since = null }) {
  const { busy, run, row, dateRow } = useActRows(null);
  const [slot, setSlot] = useState(false);            // caler tout le modele dans une journee (06/11/2026)
  // ses variantes de couleur (06/11/2026 : caler 11 echantillons sur un jour se faisait un par un) : le meme modele et le
  // meme profil, d'autres couleurs ; « avec ses variantes » les traite d'un coup (par defaut)
  const [withVar, setWithVar] = useState(true);
  if (!g0) return null;
  const f0 = g0.jobs[0] || {};
  const sibs = (jobs || []).filter(j => j.design_id !== g0.id && f0.iid && j.iid === f0.iid && (j.mw_id || String(j.design_id).split("~")[0]) === (f0.mw_id || String(g0.id).split("~")[0]));
  const vdids = [...new Set(sibs.map(j => j.design_id))];
  const on = withVar && vdids.length > 0;
  const g = on ? { ...g0, jobs: [...g0.jobs, ...sibs] } : g0;
  const act = on && act0.forDids ? act0.forDids([g0.id, ...vdids]) : act0;
  const x = gInfo(g), f = x.f, un = unretained(f), free = x.ok.filter(j => !j.locked);
  if (slot && jobs) return <SlotPicker j={f} jobs={jobs} now={now} own={g.jobs.map(j => j.key)} onClose={() => setSlot(false)}
    title={`Placer ${free.length > 1 ? `ses ${free.length} plateaux` : "le plateau"}`}
    onPick={(day, after) => run("dayall", async () => { await act.slotAll(day, after); setSlot(false); })}
    onAuto={day => run("dayall", async () => { await act.autoAll(day); setSlot(false); })}/>;
  const today = new Date().toISOString().slice(0, 10);
  const sec = t => <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#16A34A", margin: "6px 0 2px" }}>{t}</div>;
  return <PlanPopup title={f.title} icon="🧩" color={un ? UNRET : "#22C55E"} onClose={onClose} z={5250}>
    <div style={{ display: "flex", gap: 11, alignItems: "center", marginBottom: 10 }}>
      <PlateThumb j={{ ...f, thumb: null, plates_total: 1 }} size={72}/>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>
        <span><b style={{ color: "var(--text)" }}>{x.ok.length} plateau{x.ok.length > 1 ? "x" : ""}</b> à faire · {hm(x.tot)}{f.qty > 1 ? ` · ${f.qty} exemplaires voulus` : ""}</span>
        {x.first && <span>{x.first.slice(0, 10) === x.last.slice(0, 10)
          ? <><B>{dayOf(x.first, now)}</B> de {hhmm(x.first)} à {hhmm(x.last)}</> : fromTo(x.first, x.last, now, true)}</span>}
        <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {un && <span style={chipS("#64748B")}>○ non retenu</span>}
          {x.nb > 0 && <span style={chipS("#DC2626")}>⛔ {x.nb} non planifiable{x.nb > 1 ? "s" : ""}</span>}
          {f.due && <span style={chipS(f.due_ok ? "#16A34A" : "#EF4444")}>🎯 avant le {dueTxt(f.due)}</span>}
          {f.chain && <span style={chipS("#0EA5E9")}>{chainTxt(f)}</span>}
          {prioChip(f.prio_m)}
        </span>
        {/* sous le modele (06/11/2026), en petits boutons comme dans la fiche d'un plateau : sa fiche MakerWorld, le calendrier */}
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 3 }}>
          <button type="button" onClick={() => { act.sheet(); onClose(); }} data-tip="Retenir le profil, choisir les plateaux, les filaments et le nombre d'exemplaires" style={smallBtn}>🧾 Fiche MakerWorld</button>
          {act.calendar && <button type="button" onClick={() => { act.calendar(); onClose(); }} data-tip="Le calendrier, sur ce modèle" style={smallBtn}>🗓 Voir au calendrier</button>}
        </span>
      </div>
    </div>
    {edit && <>
      {sec("Tout le modèle")}
      {vdids.length > 0 && <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 11, marginBottom: 6, cursor: "pointer",
        border: `1px solid ${withVar ? "color-mix(in srgb, #8B5CF6 40%, var(--border))" : "var(--border)"}`, background: withVar ? "color-mix(in srgb, #8B5CF6 8%, var(--surface))" : "var(--surface)" }}>
        <input type="checkbox" checked={withVar} onChange={e => setWithVar(e.target.checked)}/>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text)" }}>🎨 Avec ses {vdids.length} autre{vdids.length > 1 ? "s" : ""} variante{vdids.length > 1 ? "s" : ""} de couleur</span>
        <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)" }}>· placer, figer, en tête… pour toutes d'un coup</span></label>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {un ? <div style={{ padding: "10px 12px", borderRadius: 12, border: "1px dashed color-mix(in srgb, #94A3B8 60%, var(--border))", background: "var(--surface2)",
            fontSize: 12, fontWeight: 700, color: "var(--text2)", lineHeight: 1.4 }}>○ Pas retenu : ses plateaux passent après tous les plateaux retenus, sans jour.
            Pour les placer, retiens son profil dans <b>Fiche MakerWorld</b>.</div>
          : free.length > 0 && <>
            {jobs && act.slotAll ? row("dayall", "📍", `Placer ${free.length > 1 ? `les ${free.length} plateaux` : "le plateau"} sur un jour`,
              `Le jour, puis leur place : automatique (la meilleure de la journée${free.length > 1 ? ", les autres à la suite" : ""}) ou celle que tu touches ; ce qui n'y tient pas passe au lendemain`,
              () => setSlot(true))
              : dateRow("dayall", "📌", `Caler ${free.length > 1 ? `les ${free.length} plateaux` : "le plateau"} sur un jour`,
              "Ils prennent la tête de ce jour, à la suite ; ce qui n'y tient pas passe au lendemain, puis au jour d'après", f.day, v => v && act.dayAll(v), today)}
            {row("front", "⏫", "Tout en tête de file", "Ses plateaux passent avant tous les autres (ceux posés sur un jour y retournent à la file)", () => run("front", act.front))}
            {row("later", "⏬", "Tout plus tard", "Ses plateaux passent en fin de file, dans leur ordre (un modèle retenu reste devant les non retenus)", () => run("later", act.laterAll))}
            {/* ses regroupements (06/11/2026 : « Dégrouper » n'etait que dans la fiche du plateau regroupe) */}
            {act.unmerge && x.ok.filter(j => j.merged && j.merge_id).map(j => row(`unm${j.merge_id}`, "🧩", `Dégrouper : ${j.plate_name || "plateaux regroupés"}`,
              "Ses plateaux redeviennent des impressions séparées", () => run(`unm${j.merge_id}`, () => act.unmerge(j.merge_id)), "#6366F1"))}
          </>}
        {!un && x.ok.length > 0 && act.freeze && <ModelFreezePick ok={x.ok} busy={busy} run={run} act={act}/>}
        {act.prio && <PrioPick value={f.prio_m} busy={busy} run={run} onPick={act.prio}/>}
        {act.chain && (f.plates_total > 1 || f.qty > 1) && <ChainPick j={f} busy={busy} run={run} act={act}/>}
        {dateRow("due", "🎯", f.due ? "Changer la date limite" : "Une date limite", f.due ? `Fini avant le ${dueTxt(f.due)} (son dernier plateau)` : "Son dernier plateau fini avant ce jour ; le planning prévient s'il déborde", f.due, v => act.due(v))}
      </div>
    </>}
    {/* les plateaux deja faits (07/11/2026), a leur rang parmi ceux qui restent : imprimes, marques faits, en cours */}
    {(() => { const dl = [g0.id, ...(on ? vdids : [])].flatMap(id => (done || {})[id] || []);
      const nd = dl.filter(p => p.done >= p.qty).length;
      return sec(`Plateau par plateau (${g.jobs.length} à faire${nd ? ` · ${nd} fait${nd > 1 ? "s" : ""}` : ""})`); })()}
    {/* reparti a zero (08/11/2026) : le passe ne compte plus, il reste dit */}
    {since?.[g0.id] && (!since[g0.id].auto || since[g0.id].before > 0) && <div style={{ fontSize: 12, fontWeight: 700, color: "#0369A1", padding: "6px 10px", borderRadius: 10, background: "rgba(14,165,233,0.1)" }}>
      {since[g0.id].auto ? "➕ Ajouté à la liste" : "↺ Reparti à zéro"} le {new Date(`${since[g0.id].since}Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} : seules les impressions faites depuis comptent
      {since[g0.id].before ? ` (${since[g0.id].before} plateau${since[g0.id].before > 1 ? "x" : ""} imprimé${since[g0.id].before > 1 ? "s" : ""} avant)` : ""}.</div>}
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {[...g.jobs.map(j => ({ j })), ...[g0.id, ...(on ? vdids : [])].flatMap(id => (done || {})[id] || []).filter(p => p.done >= p.qty).map(p => ({ p }))]
        .sort((a, b) => ((a.j || a.p).plate ?? 0) - ((b.j || b.p).plate ?? 0) || (a.p ? -1 : 0) - (b.p ? -1 : 0)).map(({ j, p }) => {
        if (p) return <div key={`done${p.key}`} data-tip={p.printing ? "En cours d'impression" : p.manual && !p.printed ? "Marqué fait à la main" : "Imprimé"}
          style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 10px 5px 5px", borderRadius: 12, opacity: 0.75,
            border: "1.5px solid color-mix(in srgb, #10B981 45%, var(--border))", background: "color-mix(in srgb, #10B981 7%, var(--surface))" }}>
          <PlateThumb j={{ thumb: p.thumb, plate: p.plate, plates_total: p.plates_total }} size={38}/>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: "#059669", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {plateTxt({ ...p, copy: 1, qty: 1 })}</span>
            <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)" }}>{p.printing ? "🖨 en cours" : p.manual && !p.printed ? "✓ marqué fait" : "✅ fait"}
              {p.qty > 1 ? ` · ${p.done}/${p.qty} exemplaires` : ""} <span style={{ fontWeight: 700, color: "var(--muted)" }}>· {hm(p.seconds)}</span></span>
          </span>
        </div>;
        const bad = !!j.blockedWhy;
        const c = bad ? "#DC2626" : j.locked ? "#4F46E5" : un ? UNRET : j.completes ? "#059669" : "color-mix(in srgb, #22C55E 50%, var(--border))";
        return <button key={j.key} type="button" onClick={() => onPick(bad ? { ...j, why: j.blockedWhy } : j)}
          style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 10px 5px 5px", borderRadius: 12, cursor: "pointer", font: "inherit", textAlign: "left",
            border: `1.5px ${j.completes || bad || j.locked ? "solid" : "dashed"} ${c}`, background: bad ? "color-mix(in srgb, #DC2626 8%, var(--surface))" : "var(--surface)" }}>
          <PlateThumb j={j} size={38}/>
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontSize: 12, fontWeight: 900, color: bad ? "#DC2626" : "#6366F1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {j.locked ? "🔒 " : ""}{j.pinned && !j.locked ? "📌 " : ""}{j.merged ? "🧩 " : ""}{finIc(j, " ")}{plateTxt(j)}{j.qty > 1 ? ` · ${j.copy}e/${j.qty}` : ""}
              {j.load?.length ? " 🧵" : ""}{j.runout?.length ? " 🔄" : ""}{j.awaits_order?.length ? " 🚚" : ""}{j.low_after?.length ? " 📉" : ""}{j.intercalated ? " ↔" : ""}
              {j.prio_p ? ` ${prioOf(j.prio_p)[1]}` : ""}</span>
            {bad ? <span style={{ fontSize: 11.5, fontWeight: 800, color: "#DC2626" }}>⛔ non planifiable · {(j.blockedWhy || []).join(" · ")}</span>
              : <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>{dayOf(j.start, now)} <span style={{ fontWeight: 700, color: "var(--muted)" }}>
                {hhmm(j.start)} → {hhmm(j.end)} · {hm(j.seconds)}</span></span>}
          </span>
          <span style={{ color: "var(--muted)", fontSize: 13 }}>›</span>
        </button>;
      })}
    </div>
  </PlanPopup>;
}

// Choisir la place d'un plateau dans une journee (06/11/2026) : le jour, ses plateaux dans l'ordre (figes, enchaines,
// poses), et entre eux des « ici » : en premier, apres tel plateau, en dernier. Pas au milieu d'un objet « d'une traite »
// strict (il resterait groupe) ; apres un fige, il part des que le fige est fini.
function SlotPicker({ j, jobs, now, onClose, onPick, onAuto, own, title }) {
  const [day, setDay] = useState(j.day || (now || "").slice(0, 10));
  const mine = new Set(own || [j.key]);
  const list = jobs.filter(x => !mine.has(x.key) && x.day === day && !unretained(x)).sort((a, b) => a.start.localeCompare(b.start));
  const strict = (a, b) => a && b && a.chain_g && a.chain_g === b.chain_g && a.chain !== "soft";
  const here = (after, label) => <button key={`h${after || "0"}`} type="button" onClick={() => onPick(day, after)}
    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 10px", borderRadius: 10, cursor: "pointer", font: "inherit",
      border: "1.5px dashed color-mix(in srgb, #6366F1 55%, var(--border))", background: "color-mix(in srgb, #6366F1 7%, transparent)",
      color: "#6366F1", fontSize: 12.5, fontWeight: 900 }}>📍 {label}</button>;
  return <PlanPopup title={title || `Placer ${plateTxt(j)}`} icon="📍" color="#6366F1" onClose={onClose} z={5320}>
    <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, fontWeight: 800, color: "var(--text2)" }}>
      Jour
      <input type="date" value={day} min={(now || "").slice(0, 10)} onChange={e => e.target.value && setDay(e.target.value)}
        onClick={e => { try { e.currentTarget.showPicker?.(); } catch { /* rien */ } }}
        style={{ flex: 1, padding: "6px 8px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", font: "inherit" }}/>
    </label>
    {/* automatique : le systeme choisit (le moins de filaments a charger, aucune date limite ratee, il y finit) */}
    <button type="button" onClick={() => onAuto(day)} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 12px",
      marginBottom: 10, borderRadius: 12, border: "none", cursor: "pointer", font: "inherit", textAlign: "left", color: "#fff",
      background: "linear-gradient(135deg, #6366F1, #8B5CF6)", boxShadow: "0 8px 18px -10px #6366F1" }}>
      <span style={{ fontSize: 18 }}>✨</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 900 }}>Automatique</span>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, opacity: 0.9, lineHeight: 1.35 }}>La meilleure place de la journée : le moins de filaments
          à charger, aucune date limite ratée, du moment qu'il y finit</span></span></button>
    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#6366F1", margin: "0 0 5px" }}>Ou à la main</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {here(null, list.length ? "En premier" : "Ce jour-là")}
      {list.map((x, i) => <React.Fragment key={x.key}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 4px 4px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface2)" }}>
          <PlateThumb j={x} size={30}/>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 12, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {x.locked ? "🔒 " : x.pinned ? "📌 " : ""}{x.chain_g ? "🔗 " : ""}{x.title}</span>
            <span style={{ display: "block", fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{hhmm(x.start)} → {hhmm(x.end)} · {plateTxt(x)}</span>
          </span>
        </div>
        {!strict(x, list[i + 1]) && here(x.key, i === list.length - 1 ? `En dernier, après celui de ${hhmm(x.start)} (fini à ${hhmm(x.end)})`
          : `Après celui de ${hhmm(x.start)} (fini à ${hhmm(x.end)})`)}
      </React.Fragment>)}
    </div>
    <div style={{ marginTop: 8, fontSize: 11.5, fontWeight: 600, color: "var(--muted)", lineHeight: 1.4 }}>
      Son jour est figé ; ce qui suit se décale. Après un plateau figé 🔒, il part dès qu'il est fini.</div>
  </PlanPopup>;
}

// la file, regroupee par objet : son en-tete (vignette, nom, combien de plateaux, combien d'heures, le prochain),
// puis ses plateaux (a glisser sur un jour sur ordinateur, a toucher partout). Chaque pastille dit son jour en clair
// (gras) et son heure ; les plateaux non planifiables (stock) y sont aussi, en rouge, a leur place dans leur objet.
const dayOf = (iso, now) => {
  if (!iso) return "";
  const d = iso.slice(0, 10), today = (now || "").slice(0, 10);
  const t = new Date(`${today}T12:00`); t.setDate(t.getDate() + 1);
  const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return d === today ? "Aujourd'hui" : d === tomorrow ? "Demain" : new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
};
export function PoolGrouped({ jobs, blocked = [], now, edit, drag, onDrag, onOpen }) {
  const groups = [];
  const at = {};
  for (const j of [...jobs, ...blocked.map(b => ({ ...b, blockedWhy: b.why }))]) {
    if (!(j.design_id in at)) { at[j.design_id] = groups.length; groups.push({ id: j.design_id, jobs: [] }); }
    groups[at[j.design_id]].jobs.push(j);
  }
  // en cartes sur une grille (06/11/2026) : une seule colonne au telephone, autant qu'il en tient sur un grand ecran
  // (avant : une rangee pleine largeur par objet, presque vide)
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 330px), 1fr))", gap: 8, alignItems: "start" }}>
    {groups.map(g => {
      const okJobs = g.jobs.filter(j => !j.blockedWhy), nb = g.jobs.length - okJobs.length;
      const f = okJobs[0] || g.jobs[0], un = unretained(f), tot = okJobs.reduce((a, j) => a + j.seconds, 0);
      return <div key={g.id} style={{ borderRadius: 14, border: `1px solid ${nb ? "color-mix(in srgb, #DC2626 45%, var(--border))" : un ? "color-mix(in srgb, #94A3B8 50%, var(--border))" : "var(--border)"}`,
        background: un ? "var(--surface2)" : "linear-gradient(135deg, color-mix(in srgb, #22C55E 6%, transparent), transparent 60%), var(--surface2)", padding: 9,
        height: "100%", boxSizing: "border-box" }}>
        <button type="button" onClick={() => onOpen(f)} style={{ display: "flex", gap: 11, alignItems: "center", width: "100%", border: "none", background: "none", padding: 0,
          cursor: "pointer", textAlign: "left", font: "inherit" }}>
          <PlateThumb j={{ ...f, thumb: null, plates_total: 1 }} size={64}/>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 13.5, fontWeight: 900,
              color: "var(--text)", lineHeight: 1.25 }} data-tip={f.title}>
              {un ? "○ " : ""}{f.title}</span>
            <span style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginTop: 2 }}>
              {okJobs.length} plateau{okJobs.length > 1 ? "x" : ""} · {hm(tot)}
              {okJobs[0]?.start && <> · dès <b style={{ color: "var(--text)" }}>{dayOf(okJobs[0].start, now)}</b> {hhmm(okJobs[0].start)}</>}
              {nb > 0 && <b style={{ color: "#DC2626" }}> · ⛔ {nb} non planifiable{nb > 1 ? "s" : ""}</b>}
              {f.due && <span style={{ color: f.due_ok ? "#16A34A" : "#EF4444", fontWeight: 900 }}> · 🎯 {dueTxt(f.due)}</span>}
              {f.chain && <span style={{ color: "#0EA5E9", fontWeight: 900 }}> · {chainTxt(f)}</span>}</span>
          </span>
        </button>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(172px, 1fr))", gap: 5, marginTop: 8 }}>
          {g.jobs.map(j => {
            const bad = !!j.blockedWhy;
            const c = bad ? "#DC2626" : j.too_long ? "#EF4444" : j.locked ? "#4F46E5" : un ? UNRET : j.completes ? "#059669" : "color-mix(in srgb, #22C55E 50%, var(--border))";
            const lbl = j.plates_total > 1 ? `P${j.plate}${j.qty > 1 ? `·${j.copy}` : ""}` : j.qty > 1 ? `${j.copy}/${j.qty}` : "";
            return <button key={j.key} type="button" draggable={edit && drag && !bad} onDragStart={e => { e.dataTransfer.setData("text/bn-job", j.key); onDrag?.(j.key); }}
              onDragEnd={() => onDrag?.(null)} onClick={() => onOpen(bad ? { ...j, why: j.blockedWhy } : j)}
              data-tip={bad ? `${jobName(j)} : non planifiable · ${(j.blockedWhy || []).join(" · ")}` : `${jobName(j)} · ${when(j.start, now)} → ${when(j.end, now)}`}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 7px 3px 3px", borderRadius: 10, cursor: edit && drag && !bad ? "grab" : "pointer", font: "inherit", minWidth: 0,
                border: `1.5px ${j.completes || bad || j.locked ? "solid" : "dashed"} ${c}`, textAlign: "left",
                background: bad ? "color-mix(in srgb, #DC2626 9%, var(--surface))" : "var(--surface)" }}>
              <PlateThumb j={j} size={28}/>
              <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15, minWidth: 0, overflow: "hidden" }}>
                <span style={{ fontSize: 11, fontWeight: 900, color: bad ? "#DC2626" : "#6366F1", whiteSpace: "nowrap" }}>
                  {j.locked ? "🔒 " : ""}{finIc(j, " ")}{lbl || "Plateau"}{j.load?.length ? " 🧵" : ""}{j.awaits_order?.length ? " 🚚" : ""}{j.low_after?.length ? " 📉" : ""}</span>
                {bad ? <span style={{ fontSize: 11.5, fontWeight: 900, color: "#DC2626", whiteSpace: "nowrap" }}>⛔ non planifiable</span>
                  : <span style={{ fontSize: 12, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{dayOf(j.start, now)}
                    <span style={{ fontWeight: 700, color: "var(--muted)" }}> {hhmm(j.start)}</span></span>}
              </span>
            </button>;
          })}
        </div>
      </div>;
    })}
  </div>;
}

// l'alerte du seuil (05/11/2026) : quel filament passera sous un quart de bobine, quel jour, pendant quel plateau
export function LowStockBanner({ jobs, now, onOpen, inPopup = false }) {
  const [all, setAll] = useState(inPopup);
  const alerts = (jobs || []).flatMap(j => (j.low_info || []).map(x => ({ ...x, j })));
  if (!alerts.length) return null;
  const shown = all ? alerts : alerts.slice(0, 3);
  const dayTxt = iso => {
    const d = iso.slice(0, 10), today = (now || "").slice(0, 10);
    const t = new Date(`${today}T12:00`); t.setDate(t.getDate() + 1);
    const tomorrow = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    return d === today ? "aujourd'hui" : d === tomorrow ? "demain" : new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric" });
  };
  return <div style={{ borderRadius: 14, border: "1px solid color-mix(in srgb, #DC2626 40%, var(--border))", padding: "9px 12px", display: "flex", flexDirection: "column", gap: 5,
    background: "linear-gradient(135deg, color-mix(in srgb, #DC2626 10%, transparent), transparent 70%), var(--surface)" }}>
    <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#DC2626" }}>
      📉 Sous le seuil · {alerts.length} filament{alerts.length > 1 ? "s" : ""}</div>
    {shown.map((a, i) => <button key={i} type="button" onClick={() => onOpen(a.j)} style={{ display: "flex", alignItems: "center", gap: 8, border: "none", background: "none",
      padding: 0, cursor: "pointer", textAlign: "left", font: "inherit" }}>
      <span style={{ width: 12, height: 12, borderRadius: "50%", flexShrink: 0, background: a.color || "#94A3B8", border: "1px solid rgba(0,0,0,.2)" }}/>
      <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", lineHeight: 1.35 }}>
        <b>{a.name}</b> passera sous le seuil <b>{dayTxt(a.j.start)}</b> vers {hhmm(a.j.end)}, pendant <b>{a.j.title}</b>
        {a.j.plates_total > 1 ? ` · plateau ${a.j.plate}` : ""} <span style={{ color: "var(--muted)" }}>(il en restera {a.left} g, seuil {a.low} g)</span></span>
    </button>)}
    {alerts.length > 3 && <button type="button" onClick={() => setAll(v => !v)} style={{ alignSelf: "flex-start", border: "none", background: "none", padding: 0, cursor: "pointer",
      fontSize: 12, fontWeight: 800, color: "#DC2626" }}>{all ? "Moins" : `+ ${alerts.length - 3} autre${alerts.length > 4 ? "s" : ""}`}</button>}
  </div>;
}

// les plateaux que le stock ne permet pas de poser
export function BlockedList({ items, onOpen }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45 }}>
      Ni le stock ni les commandes en route n'ont assez de filament : ces plateaux ne sont pas posés. Change de filament dans la fiche du modèle, ou commande-en.</div>
    {items.map(b => <button key={b.key} type="button" onClick={() => onOpen(b)} style={{ display: "flex", gap: 9, alignItems: "center", padding: 8, borderRadius: 12,
      border: "1px solid color-mix(in srgb, #DC2626 35%, var(--border))", background: "color-mix(in srgb, #DC2626 5%, var(--surface))", cursor: "pointer", textAlign: "left", font: "inherit" }}>
      <PlateThumb j={b} size={40}/>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.title}</span>
        <span style={{ display: "block", fontSize: 11.5, fontWeight: 800, color: "#6366F1" }}>{plateTxt(b)}{b.qty > 1 ? ` · ${b.copy}/${b.qty}` : ""} · {hm(b.seconds)}</span>
        {(b.why || []).map((w, i) => <span key={i} style={{ display: "block", fontSize: 11.5, fontWeight: 700, color: "#DC2626" }}>⛔ {w}</span>)}
      </span>
    </button>)}
  </div>;
}
