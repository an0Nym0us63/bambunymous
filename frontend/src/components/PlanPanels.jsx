import React, { useState } from "react";
import { createPortal } from "react-dom";
import { PlateThumb, plateTxt, jobName, doneTxt, dueTxt, hhmm, unretained, UNRET } from "./PlanDay";

// Les fenetres du planning (05/11/2026) : une fenetre (en bas au telephone, au centre sur ordinateur), la fiche
// d'actions d'un plateau, la file regroupee par objet, les plateaux non planifiables.

const hm = s => { const m = Math.round((s || 0) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, "0")}` : ""}`; };
const when = (iso, now) => {
  if (!iso) return "";
  const d = iso.slice(0, 10), today = (now || "").slice(0, 10);
  return d === today ? hhmm(iso) : `${new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric" })} ${hhmm(iso)}`;
};

export function PlanPopup({ title, icon, color = "#6366F1", onClose, children, wide, z = 5200 }) {
  const phone = typeof window !== "undefined" && window.innerWidth < 640;
  return createPortal(<div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: z, background: "rgba(2,6,23,0.55)", backdropFilter: "blur(5px)",
    display: "flex", alignItems: phone ? "flex-end" : "center", justifyContent: "center", padding: phone ? 0 : 16 }}>
    <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth: wide ? 760 : 520, maxHeight: phone ? "88dvh" : "84dvh", display: "flex", flexDirection: "column",
      background: "var(--sheet-bg)", border: "1px solid var(--border)", borderRadius: phone ? "22px 22px 0 0" : 20, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.45)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", flexShrink: 0,
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
export function JobSheet({ j, now, edit, onClose, act }) {
  const [busy, setBusy] = useState(null);
  const run = async (k, fn) => { setBusy(k); try { await fn(); onClose(); } finally { setBusy(null); } };
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
  return <PlanPopup title={j.title} icon="🧩" color={j.why ? "#DC2626" : unretained(j) ? UNRET : j.completes ? "#059669" : "#22C55E"} onClose={onClose} z={5300}>
    <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
      <PlateThumb j={j} size={64}/>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 13, fontWeight: 900, color: "#6366F1" }}>{plateTxt(j)}{j.qty > 1 ? ` · ${j.copy}e sur ${j.qty}` : ""}</span>
        {j.start && <span style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{when(j.start, now)} → {when(j.end, now)} <span style={{ fontSize: 12, color: "var(--muted)" }}>{hm(j.seconds)}</span></span>}
        <span style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {j.locked && <span style={{ fontSize: 11, fontWeight: 900, color: "#4F46E5" }}>🔒 figé</span>}
          {unretained(j) && <span style={{ fontSize: 11, fontWeight: 900, color: "#64748B" }}>○ non retenu</span>}
          {j.completes && <span style={{ fontSize: 11, fontWeight: 900, color: "#047857" }}>{doneTxt(j)}</span>}
          {j.due && <span style={{ fontSize: 11, fontWeight: 900, color: j.due_ok ? "#16A34A" : "#EF4444" }}>🎯 avant le {dueTxt(j.due)}</span>}
          {j.load?.length > 0 && <span style={{ fontSize: 11, fontWeight: 900, color: "#EA580C" }}>🧵 à charger : {j.load.join(", ")}</span>}
          <StockTags j={j}/>
        </span>
        {(j.reasons || []).map((r, i) => <span key={i} style={{ fontSize: 11.5, color: "var(--muted)" }}>↪ {r}</span>)}
        {j.why && j.why.map((r, i) => <span key={i} style={{ fontSize: 11.5, fontWeight: 800, color: "#DC2626" }}>⛔ {r}</span>)}
      </div>
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {edit && !j.why && j.start && (j.locked
        ? row("unlock", "🔓", "Défiger", "Il redevient libre : le planning, les optimiseurs et la journée couleur peuvent le déplacer", () => run("unlock", act.unlock), "#4F46E5")
        : row("lock", "🔒", `Figer ici (${when(j.start, now)})`, "Il garde ce jour et cette heure : rien ne le déplacera (optimiser, journée couleur, au mieux, plus tard), le reste s'organise autour", () => run("lock", act.lock), "#4F46E5"))}
      {edit && !j.why && !j.locked && row("smart", "✨", "Placer au mieux", "Là où il charge le moins de filaments, sans faire rater de date limite, le plus tôt possible", () => run("smart", act.smart))}
      {edit && !j.why && !j.locked && j.plates_total > 1 && act.laterAll && row("laterall", "⏬", "Tout l'objet plus tard", "Tous les plateaux de cet objet passent en fin de file, dans leur ordre (un objet retenu reste devant les non retenus) ; les figés restent", () => run("laterall", act.laterAll))}
      {edit && !j.why && !j.locked && row("later", "⏭", "Plus tard", "Il quitte sa place et son jour, et passe en fin de file", () => run("later", act.later))}
      {edit && !j.why && !j.locked && dateRow("daybest", "📌", "Le placer sur un jour", "À la meilleure place de la journée (le moins de filaments à charger), du moment qu'il y finit ; le reste se décale", j.day, v => v && act.dayBest(v), new Date().toISOString().slice(0, 10))}
      {edit && !j.why && !j.locked && dateRow("day", "📅", "Le poser sur un jour, après le reste", "Il y va après ce qui y est déjà", j.day, v => v && act.day(v), new Date().toISOString().slice(0, 10))}
      {edit && j.pinned && !j.locked && row("unpin", "📌", "Le rendre à la file", "Il n'est plus posé sur ce jour : il se place où il tient", () => run("unpin", act.unpin))}
      {row("sheet", "🧾", "Fiche du modèle", "Retenir le profil, choisir les plateaux et les filaments de chaque couleur", () => { act.sheet(); onClose(); })}
      {j.day && row("dayview", "🗓", "Voir sa journée", null, () => { act.dayview(); onClose(); })}
      {edit && dateRow("due", "🎯", j.due ? "Changer la date limite" : "Une date limite pour l'objet", j.due ? `Fini avant le ${dueTxt(j.due)}` : "Le planning prévient s'il déborde", j.due, v => act.due(v))}
      {edit && row("done", "✓", "Marquer fait", "Imprimé hors de l'appli, ou pas reconnu : il compte comme fait", () => run("done", act.done))}
    </div>
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
              {f.due && <span style={{ color: f.due_ok ? "#16A34A" : "#EF4444", fontWeight: 900 }}> · 🎯 {dueTxt(f.due)}</span>}</span>
          </span>
        </button>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(124px, 1fr))", gap: 5, marginTop: 8 }}>
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
                  {j.locked ? "🔒 " : ""}{j.completes ? "🏁 " : ""}{lbl || "Plateau"}{j.load?.length ? " 🧵" : ""}{j.awaits_order?.length ? " 🚚" : ""}{j.low_after?.length ? " 📉" : ""}</span>
                {bad ? <span style={{ fontSize: 11.5, fontWeight: 900, color: "#DC2626", whiteSpace: "nowrap" }}>⛔ non planifiable</span>
                  : <span style={{ fontSize: 12, fontWeight: 900, color: "var(--text)", whiteSpace: "nowrap" }}>{dayOf(j.start, now)}
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
