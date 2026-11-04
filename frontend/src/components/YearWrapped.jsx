import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, Share2, Pause, Play } from "lucide-react";
import client, { apiUrl, apiThumb } from "../api/client";
import MwImg from "./MwImg";
import { egg } from "../eggs";
import { isMoneyHidden, MONEY_MASK } from "../utils/money";
import { toast } from "../store/toast";
import { useIsAdmin } from "../store/auth";

// « Ton annee en impressions » (04/11/2026) : l'annee racontee en diapositives plein ecran, comme une story -- un
// toucher a droite avance, a gauche recule, l'appui long met en pause ; chaque diapositive avance seule au bout de 7 s.
// La derniere resume tout, a partager.
const DUR = 7000;
const nf = n => Number(n || 0).toLocaleString("fr-FR");
const hrs = s => Math.round((s || 0) / 3600);
const kg = g => (g || 0) >= 1000 ? `${(g / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} kg` : `${Math.round(g || 0)} g`;
const money = v => isMoneyHidden() ? MONEY_MASK : `${Number(v || 0).toLocaleString("fr-FR", { maximumFractionDigits: 0 })} €`;
const dur = s => { const h = Math.floor((s || 0) / 3600), m = Math.round(((s || 0) % 3600) / 60); return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`; };
const dayFr = d => new Date(`${d}T12:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

// un nombre qui monte jusqu'a sa valeur a l'apparition de la diapositive
function Count({ to, fmt = nf, ms = 1400 }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf, t0;
    const step = t => { if (!t0) t0 = t; const k = Math.min(1, (t - t0) / ms); setV(to * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, ms]);
  return fmt(Math.round(v));
}

const Big = ({ children, size = 64 }) => <div style={{ fontSize: `clamp(40px, 13vw, ${size}px)`, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.02em",
  textShadow: "0 6px 30px rgba(0,0,0,.25)" }}>{children}</div>;
const Kicker = ({ children }) => <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: ".14em", textTransform: "uppercase", opacity: .85 }}>{children}</div>;
const Line = ({ children, delay = 0 }) => <div className="yw-in" style={{ animationDelay: `${delay}ms`, fontSize: 17, fontWeight: 700, lineHeight: 1.45, opacity: .95 }}>{children}</div>;
const Spool = ({ hex, size = 46 }) => <span style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, background: `#${hex}`,
  boxShadow: `inset 0 0 0 ${size * 0.3}px rgba(255,255,255,.18), inset 0 0 0 ${size * 0.36}px rgba(0,0,0,.18), 0 8px 20px -6px rgba(0,0,0,.45)` }}/>;

function slidesOf(d) {
  const S = [];
  const pct = d.count ? Math.round(d.success / d.count * 100) : 0;
  S.push({ bg: ["#4F46E5", "#EC4899"], body: <>
    <Kicker>Ton année {d.year}</Kicker>
    <div className="yw-in" style={{ fontSize: "clamp(26px, 7vw, 38px)", fontWeight: 900, lineHeight: 1.15 }}>en impressions</div>
    <div style={{ height: 18 }}/>
    <Big size={110}><Count to={d.count}/></Big>
    <Line delay={300}>impressions lancées, sur {d.active_days} jour{d.active_days > 1 ? "s" : ""}.</Line>
    {d.first && <Line delay={600}>Tout a commencé le {dayFr(d.first.date)} avec « {d.first.name} ».</Line>}
  </> });
  S.push({ bg: ["#7C3AED", "#2563EB"], body: <>
    <Kicker>La machine a tourné</Kicker>
    <Big size={96}><Count to={hrs(d.seconds)}/> h</Big>
    <Line delay={300}>soit {nf(Math.round(d.seconds / 86400))} jours pleins, nuit comprise.</Line>
    <Line delay={600}>Elle a imprimé {Math.round((d.occupation || 0) * 100)} % du temps{d.year === new Date().getFullYear() ? " depuis le 1er janvier" : " de l'année"}.</Line>
    {d.fav_hour?.night > 0 && <Line delay={900}>Et {d.fav_hour.night} impression{d.fav_hour.night > 1 ? "s ont" : " a"} démarré entre 22 h et 6 h : pendant que tu dormais.</Line>}
  </> });
  S.push({ bg: ["#059669", "#0EA5E9"], body: <>
    <Kicker>Taux de réussite</Kicker>
    <div style={{ position: "relative", width: 190, height: 190, margin: "8px 0" }}>
      <svg viewBox="0 0 100 100" style={{ width: "100%", height: "100%", transform: "rotate(-90deg)" }}>
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,.2)" strokeWidth="10"/>
        <circle className="yw-ring" cx="50" cy="50" r="42" fill="none" stroke="#fff" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${2 * Math.PI * 42}`} style={{ "--yw-off": `${2 * Math.PI * 42 * (1 - pct / 100)}` }}/>
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><Big size={52}><Count to={pct}/> %</Big></div>
    </div>
    <Line delay={300}>{nf(d.success)} réussie{d.success > 1 ? "s" : ""}{d.failed ? `, ${nf(d.failed)} échouée${d.failed > 1 ? "s" : ""}` : ""}{d.cancelled ? `, ${nf(d.cancelled)} annulée${d.cancelled > 1 ? "s" : ""}` : ""}.</Line>
    {d.items > d.success && <Line delay={600}>Au total, {nf(d.items)} objets sortis du plateau.</Line>}
    {d.lost_g > 0 && <Line delay={900}>{kg(d.lost_g)} de filament sont partis avec les échecs. Ça arrive aux meilleurs.</Line>}
  </> });
  if (d.weight_g) S.push({ bg: ["#EA580C", "#DB2777"], body: <>
    <Kicker>Filament fondu</Kicker>
    <Big size={96}>{kg(d.weight_g)}</Big>
    <Line delay={300}>≈ {d.meters >= 1000 ? `${(d.meters / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km` : `${nf(d.meters)} m`} de fil, mis bout à bout.</Line>
    {d.colors?.length > 0 && <div className="yw-in" style={{ animationDelay: "500ms", display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", margin: "14px 0 4px" }}>
      {d.colors.slice(0, 6).map((c, i) => <div key={c.hex} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <Spool hex={c.hex} size={i === 0 ? 62 : 46}/><span style={{ fontSize: 11.5, fontWeight: 800, opacity: .9 }}>{kg(c.grams)}</span></div>)}
    </div>}
    <Line delay={800}>{d.distinct_colors} couleur{d.distinct_colors > 1 ? "s" : ""} différente{d.distinct_colors > 1 ? "s" : ""}{d.materials?.[0] ? `, surtout du ${d.materials[0].name}` : ""}.</Line>
  </> });
  if (d.models?.length) S.push({ bg: ["#0891B2", "#6366F1"], body: <>
    <Kicker>Tes modèles préférés</Kicker>
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "min(420px, 100%)", marginTop: 10 }}>
      {d.models.map((m, i) => <div key={i} className="yw-in" style={{ animationDelay: `${150 + i * 180}ms`, display: "flex", alignItems: "center", gap: 12,
        padding: 8, borderRadius: 18, background: "rgba(255,255,255,.14)", backdropFilter: "blur(6px)" }}>
        <span style={{ width: 28, fontSize: 22, fontWeight: 900, textAlign: "center" }}>{i + 1}</span>
        {m.cover ? <MwImg src={m.cover} w={120} style={{ width: 54, height: 54, borderRadius: 13, objectFit: "cover", flexShrink: 0 }}/>
          : <img src={apiThumb(apiUrl(`/prints/${m.print_id}/image`), 120)} alt="" style={{ width: 54, height: 54, borderRadius: 13, objectFit: "cover", flexShrink: 0, background: "rgba(255,255,255,.2)" }}/>}
        <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
          <span style={{ display: "block", fontSize: 15.5, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.title}</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, opacity: .85 }}>{m.count} fois{m.creator ? ` · ${m.creator}` : ""}</span>
        </span>
      </div>)}
    </div>
    <Line delay={1200}>{nf(d.distinct_models)} modèles différents dans l'année.</Line>
  </> });
  if (d.creators?.length) S.push({ bg: ["#BE185D", "#7C3AED"], body: <>
    <Kicker>Ton créateur de l'année</Kicker>
    <div className="yw-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, margin: "10px 0" }}>
      {d.creators[0].avatar ? <MwImg src={d.creators[0].avatar} w={200} style={{ width: 120, height: 120, borderRadius: "50%", objectFit: "cover", boxShadow: "0 0 0 5px rgba(255,255,255,.35)" }}/>
        : <span style={{ width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 54 }}>🎨</span>}
      <div style={{ fontSize: "clamp(26px, 8vw, 40px)", fontWeight: 900 }}>{d.creators[0].name}</div>
    </div>
    <Line delay={300}>{d.creators[0].count} impression{d.creators[0].count > 1 ? "s" : ""} de {d.creators[0].models} de ses modèles.</Line>
    {d.creators.length > 1 && <Line delay={600}>Suivi de {d.creators.slice(1, 4).map(c => c.name).join(", ")}.</Line>}
    <Line delay={900}>{d.distinct_creators} créateurs t'ont fait imprimer cette année.</Line>
  </> });
  const maxH = Math.max(1, ...(d.months || []).map(m => m.hours));
  S.push({ bg: ["#2563EB", "#14B8A6"], body: <>
    <Kicker>Ton rythme</Kicker>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 5, height: 150, width: "min(420px, 100%)", margin: "12px 0 6px" }}>
      {(d.months || []).map((m, i) => <div key={m.m} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
        <div className="yw-bar" style={{ width: "100%", borderRadius: 6, height: `${Math.max(3, m.hours / maxH * 100)}%`, animationDelay: `${i * 60}ms`,
          background: m.label === d.best_month?.label ? "#fff" : "rgba(255,255,255,.45)" }}/>
        <span style={{ fontSize: 10.5, fontWeight: 800, opacity: .85 }}>{m.label[0].toUpperCase()}</span>
      </div>)}
    </div>
    <Line delay={500}>Ton mois le plus chargé : <b>{d.best_month?.label}</b>, {nf(Math.round(d.best_month?.hours))} h de machine.</Line>
    <Line delay={800}>Ton jour préféré pour lancer : le <b>{d.fav_weekday?.label}</b>. Ton heure : <b>{d.fav_hour?.hour} h</b>.</Line>
  </> });
  S.push({ bg: ["#F59E0B", "#EF4444"], body: <>
    <Kicker>Tes records</Kicker>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, width: "min(440px, 100%)", marginTop: 12 }}>
      {[["⏱️", "La plus longue", dur(d.longest?.seconds), d.longest?.name], ["🏋️", "La plus lourde", kg(d.heaviest?.weight_g), d.heaviest?.name],
        ["🔥", "Le jour le plus chargé", `${d.busiest_day?.count} impressions`, d.busiest_day && dayFr(d.busiest_day.date)],
        ["📆", "Ta plus longue série", `${d.streak} jour${d.streak > 1 ? "s" : ""}`, "d'affilée, sans un jour sans"]].map(([ic, t, v, s], i) =>
        <div key={t} className="yw-in" style={{ animationDelay: `${150 + i * 160}ms`, padding: 12, borderRadius: 18, background: "rgba(255,255,255,.16)", textAlign: "left", minWidth: 0 }}>
          <div style={{ fontSize: 24 }}>{ic}</div>
          <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", opacity: .85 }}>{t}</div>
          <div style={{ fontSize: 22, fontWeight: 900 }}>{v}</div>
          <div style={{ fontSize: 12, fontWeight: 700, opacity: .85, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s}</div>
        </div>)}
    </div>
  </> });
  if (d.sold) S.push({ bg: ["#16A34A", "#065F46"], body: <>
    <Kicker>Tes ventes</Kicker>
    <Big size={96}><Count to={d.sold}/></Big>
    <Line delay={300}>objet{d.sold > 1 ? "s" : ""} vendu{d.sold > 1 ? "s" : ""}, pour {money(d.revenue)}.</Line>
    <Line delay={600}>Le filament de l'année t'a coûté {money(d.cost)}.</Line>
  </> });
  S.push({ bg: ["#111827", "#4F46E5"], summary: true });
  return S;
}

// le resume : une carte a son propre degrade, photographiee telle qu'a l'ecran pour le partage (04/11/2026 : une image
// redessinee a part ne lui aurait jamais ressemble) ; le bouton Partager n'entre pas dans la photo
function Summary({ d, onShare, cardRef }) {
  const tiles = [["🖨️", nf(d.count), "impressions"], ["⏱️", `${nf(hrs(d.seconds))} h`, "de machine"], ["✅", `${d.count ? Math.round(d.success / d.count * 100) : 0} %`, "de réussite"],
    ["🧵", kg(d.weight_g), "de filament"], ["🎨", nf(d.distinct_colors), "couleurs"], ["📆", `${d.streak} j`, "de série"]];
  return <div style={{ width: "min(440px, 100%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
    <div ref={cardRef} style={{ width: "100%", boxSizing: "border-box", padding: "22px 16px 20px", borderRadius: 28, display: "flex", flexDirection: "column", alignItems: "center",
      gap: 14, background: "linear-gradient(160deg, #1E1B4B, #4F46E5 55%, #9333EA)", boxShadow: "0 20px 50px -20px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.12)", color: "#fff" }}>
      <Kicker>BambuNymous · {d.year}</Kicker>
      <div style={{ fontSize: "clamp(26px, 7vw, 34px)", fontWeight: 900, lineHeight: 1.1 }}>Ton année en impressions</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, width: "100%" }}>
        {tiles.map(([ic, v, l]) => <div key={l} style={{ padding: "12px 6px", borderRadius: 16, background: "rgba(255,255,255,.12)" }}>
          <div style={{ fontSize: 20 }}>{ic}</div><div style={{ fontSize: 19, fontWeight: 900 }}>{v}</div><div style={{ fontSize: 11, fontWeight: 700, opacity: .8 }}>{l}</div></div>)}
      </div>
      {d.models?.[0] && <div style={{ fontSize: 14, fontWeight: 700, opacity: .95 }}>
        Modèle préféré : <b>{d.models[0].title}</b>{d.creators?.[0] ? <> · créateur : <b>{d.creators[0].name}</b></> : null}</div>}
      {d.colors?.length > 0 && <div style={{ display: "flex", gap: 6 }}>{d.colors.slice(0, 6).map(c => <Spool key={c.hex} hex={c.hex} size={26}/>)}</div>}
    </div>
    <button type="button" onClick={e => { e.stopPropagation(); onShare(); }} style={{ marginTop: 2, display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 22px",
      borderRadius: 30, border: "none", background: "#fff", color: "#111827", fontSize: 15, fontWeight: 900, cursor: "pointer", boxShadow: "0 10px 30px -8px rgba(0,0,0,.5)" }}>
      <Share2 size={17}/>Partager</button>
  </div>;
}

// ou partager l'image du resume : Telegram (le compte relie dans l'appli, ses destinations), une autre appli (le menu de
// partage du systeme), ou l'enregistrer
function SharePanel({ d, text, shot, onClose }) {
  const isAdmin = useIsAdmin();
  const [tg, setTg] = useState(null);                 // l'etat du compte Telegram relie
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    if (!isAdmin) { setTg({}); return undefined; }
    let alive = true;
    client.get("/share/telegram").then(r => alive && setTg(r.data || {})).catch(() => alive && setTg({}));
    return () => { alive = false; };
  }, [isAdmin]);
  const sendTg = async dest => {
    setBusy(dest.id);
    try {
      const blob = await shot();
      const fd = new FormData();
      fd.append("file", blob, `annee-${d.year}.png`); fd.append("text", text); fd.append("destination_ids", dest.id);
      const r = await client.post("/share/image", fd, { timeout: 120000 });
      toast(`Envoyé sur Telegram : ${r.data?.destination || dest.label}`);
      egg("annee_partagee");
      onClose();
    } catch (e) { toast(e?.response?.data?.detail || "L'envoi n'a pas abouti", "error"); }
    setBusy(null);
  };
  const other = async () => {
    setBusy("other");
    try {
      const blob = await shot();
      const file = new File([blob], `annee-${d.year}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], text, title: `Mon année ${d.year} en impressions` });
      else if (navigator.share) await navigator.share({ text, title: `Mon année ${d.year} en impressions` });
      else { await navigator.clipboard.writeText(text); toast("Texte copié : colle-le où tu veux"); }
      egg("annee_partagee");
    } catch { /* partage annule */ }
    setBusy(null);
  };
  const save = async () => {
    setBusy("save");
    try {
      const blob = await shot();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `bambunymous-annee-${d.year}.png`;
      document.body.appendChild(a); a.dispatchEvent(new MouseEvent("click")); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { toast("L'image n'a pas pu être préparée", "error"); }
    setBusy(null);
  };
  const dests = tg?.connected ? (tg.destinations || []) : [];
  const row = (key, ic, label, sub, onClick) => <button key={key} type="button" disabled={!!busy} onClick={onClick}
    style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 12px", borderRadius: 14, border: "none", cursor: busy ? "default" : "pointer",
      background: "rgba(255,255,255,.1)", color: "#fff", textAlign: "left", opacity: busy && busy !== key ? .5 : 1 }}>
    <span style={{ fontSize: 22, width: 28, textAlign: "center" }}>{busy === key ? "⏳" : ic}</span>
    <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 14.5, fontWeight: 900 }}>{label}</span>
      {sub && <span style={{ fontSize: 12, fontWeight: 700, opacity: .75 }}>{sub}</span>}</span></button>;
  return <div onClick={e => { e.stopPropagation(); if (!busy) onClose(); }} style={{ position: "absolute", inset: 0, zIndex: 5, background: "rgba(0,0,0,.5)",
    display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
    <div onClick={e => e.stopPropagation()} style={{ width: "100%", padding: "16px 14px max(18px, env(safe-area-inset-bottom))", borderRadius: "24px 24px 0 0",
      background: "linear-gradient(180deg, #1F2937, #111827)", display: "flex", flexDirection: "column", gap: 8, animation: "ywIn .3s cubic-bezier(.2,.8,.2,1) both" }}>
      <div style={{ fontSize: 15, fontWeight: 900, textAlign: "center", marginBottom: 4 }}>Partager l'image de ton année</div>
      {tg === null ? <div style={{ fontSize: 12.5, opacity: .7, textAlign: "center" }}>…</div>
        : dests.length ? dests.map(x => row(x.id, "✈️", `Telegram · ${x.label}`, "avec ton compte relié dans BambuNymous", () => sendTg(x)))
        : isAdmin && <div style={{ fontSize: 12, fontWeight: 700, opacity: .7, textAlign: "center", padding: "0 8px" }}>
          Telegram : relie ton compte et choisis tes destinations dans Paramètres › Partage.</div>}
      {row("other", "📤", "Une autre appli…", "le menu de partage de ton appareil", other)}
      {row("save", "⬇️", "Enregistrer l'image", `bambunymous-annee-${d.year}.png`, save)}
    </div>
  </div>;
}

export default function YearWrapped({ year: year0 = 0, onClose }) {
  const [year, setYear] = useState(year0);
  const [d, setD] = useState(null);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [t, setT] = useState(0);                     // l'avancement de la diapositive en cours (0..1)
  const hold = useRef(null);
  useEffect(() => {
    let alive = true;
    setD(null); setI(0);
    client.get("/wrapped", { params: { year, tz: -new Date().getTimezoneOffset() } }).then(r => alive && setD(r.data)).catch(() => alive && setD({ error: true }));
    return () => { alive = false; };
  }, [year]);
  useEffect(() => { egg("annee_impressions"); }, []);
  const slides = useMemo(() => d && d.count ? slidesOf(d) : [], [d]);
  const last = slides.length - 1;
  // l'avancement : 7 s par diapositive, sauf la derniere (le resume reste)
  useEffect(() => {
    if (!slides.length || paused || i >= last) return undefined;
    let raf, t0 = performance.now() - t * DUR;
    const step = now => { const k = (now - t0) / DUR; if (k >= 1) { setT(0); setI(n => Math.min(last, n + 1)); } else { setT(k); raf = requestAnimationFrame(step); } };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [i, paused, slides.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight") go(1); else if (e.key === "ArrowLeft") go(-1); else if (e.key === " ") setPaused(p => !p); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });
  const go = n => { setT(0); setI(x => Math.max(0, Math.min(last, x + n))); };
  // le texte qui accompagne l'image, et la photo du resume (au double de sa taille, nette sur un telephone)
  const shareText = d && d.count ? `Mon année ${d.year} en impressions 3D : ${nf(d.count)} impressions, ${nf(hrs(d.seconds))} h de machine, ${kg(d.weight_g)} de filament, `
    + `${Math.round(d.success / d.count * 100)} % de réussite${d.models?.[0] ? `, modèle préféré : ${d.models[0].title}` : ""}. #BambuNymous` : "";
  const cardRef = useRef(null);
  const [sharing, setSharing] = useState(false);
  const shot = async () => {
    const { toBlob } = await import("html-to-image");
    const el = cardRef.current;
    const b = await toBlob(el, { pixelRatio: 2.5, cacheBust: true, style: { margin: "0", transform: "none" } });
    if (!b) throw new Error("image vide");
    return b;
  };
  const s = slides[i];
  const tap = e => {
    const r = e.currentTarget.getBoundingClientRect();
    go((e.clientX - r.left) < r.width * 0.33 ? -1 : 1);
  };
  return createPortal(<div data-no-pull="" style={{ position: "fixed", inset: 0, zIndex: 8000, background: "#000", display: "flex", justifyContent: "center", color: "#fff" }}>
    <style>{`
      @keyframes ywIn { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: none; } }
      .yw-in { animation: ywIn .6s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes ywBar { from { transform: scaleY(0); } to { transform: scaleY(1); } }
      .yw-bar { transform-origin: bottom; animation: ywBar .8s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes ywRing { from { stroke-dashoffset: ${2 * Math.PI * 42}; } to { stroke-dashoffset: var(--yw-off); } }
      .yw-ring { animation: ywRing 1.4s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes ywBlob { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(6%, -4%) scale(1.12); } }
    `}</style>
    <div style={{ position: "relative", width: "min(520px, 100%)", height: "100%", overflow: "hidden",
      background: s ? `linear-gradient(160deg, ${s.bg[0]}, ${s.bg[1]})` : "linear-gradient(160deg, #4F46E5, #EC4899)", transition: "background .6s" }}>
      {/* des taches de lumiere qui bougent doucement */}
      <span aria-hidden="true" style={{ position: "absolute", width: "80%", height: "50%", top: "-10%", left: "-20%", borderRadius: "50%", background: "rgba(255,255,255,.18)", filter: "blur(60px)", animation: "ywBlob 9s ease-in-out infinite" }}/>
      <span aria-hidden="true" style={{ position: "absolute", width: "70%", height: "45%", bottom: "-8%", right: "-20%", borderRadius: "50%", background: "rgba(0,0,0,.22)", filter: "blur(70px)", animation: "ywBlob 12s ease-in-out infinite reverse" }}/>
      {/* les segments d'avancement, l'annee, fermer */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, padding: "max(10px, env(safe-area-inset-top)) 12px 0", zIndex: 3 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {slides.map((_, k) => <span key={k} style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,.3)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", background: "#fff", width: `${k < i ? 100 : k === i ? (k === last ? 100 : t * 100) : 0}%` }}/></span>)}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
          {d?.years?.length > 1 ? <select value={d.year} onClick={e => e.stopPropagation()} onChange={e => setYear(Number(e.target.value))} aria-label="Choisir l'année"
            style={{ background: "rgba(255,255,255,.18)", color: "#fff", border: "none", borderRadius: 12, padding: "5px 10px", fontSize: 13, fontWeight: 900 }}>
            {d.years.map(y => <option key={y} value={y} style={{ color: "#111" }}>{y}</option>)}</select>
            : <span style={{ fontSize: 13, fontWeight: 900, opacity: .9 }}>{d?.year || ""}</span>}
          <span style={{ flex: 1 }}/>
          {slides.length > 0 && i < last && <button type="button" onClick={e => { e.stopPropagation(); setPaused(p => !p); }} aria-label={paused ? "Reprendre" : "Pause"} data-tip={paused ? "Reprendre" : "Pause"}
            style={roundBtn}>{paused ? <Play size={16}/> : <Pause size={16}/>}</button>}
          <button type="button" onClick={e => { e.stopPropagation(); onClose(); }} aria-label="Fermer" data-tip="Fermer" style={roundBtn}><X size={18}/></button>
        </div>
      </div>
      {/* la diapositive : toucher a gauche recule, ailleurs avance ; l'appui long met en pause */}
      <div onClick={tap} onPointerDown={() => { hold.current = setTimeout(() => setPaused(true), 350); }}
        onPointerUp={() => { clearTimeout(hold.current); }} onPointerLeave={() => clearTimeout(hold.current)}
        style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center",
          padding: "90px 26px 70px", zIndex: 2, cursor: "pointer", userSelect: "none" }}>
        {!d && <div style={{ fontSize: 16, fontWeight: 800 }}>On rassemble ton année…</div>}
        {d?.error && <div style={{ fontSize: 16, fontWeight: 800 }}>Le récapitulatif n'a pas pu être préparé.</div>}
        {d && !d.error && !d.count && <div style={{ fontSize: 17, fontWeight: 800, maxWidth: 340 }}>Pas encore d'impression en {d.year} : reviens après tes premières !</div>}
        {s && <div key={`${d.year}-${i}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "100%" }}>
          {s.summary ? <Summary d={d} cardRef={cardRef} onShare={() => { setPaused(true); setSharing(true); }}/> : s.body}
        </div>}
      </div>
      {sharing && d && <SharePanel d={d} text={shareText} shot={shot} onClose={() => setSharing(false)}/>}
      {slides.length > 0 && <>
        {i > 0 && <button type="button" onClick={e => { e.stopPropagation(); go(-1); }} aria-label="Précédente" style={{ ...navArrow, left: 8 }}><ChevronLeft size={22}/></button>}
        {i < last && <button type="button" onClick={e => { e.stopPropagation(); go(1); }} aria-label="Suivante" style={{ ...navArrow, right: 8 }}><ChevronRight size={22}/></button>}
      </>}
    </div>
  </div>, document.body);
}

const roundBtn = { width: 34, height: 34, borderRadius: "50%", border: "none", background: "rgba(255,255,255,.18)", color: "#fff", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", backdropFilter: "blur(6px)" };
const navArrow = { position: "absolute", top: "50%", transform: "translateY(-50%)", zIndex: 3, width: 38, height: 38, borderRadius: "50%", border: "none",
  background: "rgba(255,255,255,.14)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };

// la banniere qui l'ouvre (en tete des statistiques)
export function WrappedBanner() {
  const [open, setOpen] = useState(false);
  const y = new Date().getFullYear();
  return <>
    <button type="button" onClick={() => setOpen(true)} style={{ position: "relative", overflow: "hidden", display: "flex", alignItems: "center", gap: 14, width: "100%",
      padding: "14px 16px", borderRadius: 20, border: "none", cursor: "pointer", textAlign: "left", color: "#fff",
      background: "linear-gradient(120deg, #4F46E5, #9333EA 45%, #EC4899)", boxShadow: "0 12px 30px -14px #9333EA" }}>
      <span aria-hidden="true" style={{ position: "absolute", right: -30, top: -40, width: 160, height: 160, borderRadius: "50%", background: "rgba(255,255,255,.15)", filter: "blur(20px)" }}/>
      <span style={{ fontSize: 30 }}>🎁</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 16, fontWeight: 900 }}>Ton année {y} en impressions</span>
        <span style={{ fontSize: 12.5, fontWeight: 700, opacity: .9 }}>Tes chiffres, tes couleurs, tes modèles et tes records, en diapositives</span>
      </span>
      <span style={{ fontSize: 13, fontWeight: 900, padding: "7px 14px", borderRadius: 20, background: "rgba(255,255,255,.22)", whiteSpace: "nowrap" }}>Voir ›</span>
    </button>
    {open && <YearWrapped year={0} onClose={() => setOpen(false)}/>}
  </>;
}
