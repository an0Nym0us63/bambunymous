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

// la comparaison avec l'annee d'avant (04/11/2026) : ▲ +23 % vs 2025, en vert si ca monte, en rose sinon
function Delta({ cur, prev, year, unit = "%", delay = 600 }) {
  if (prev == null || cur == null) return null;
  let txt;
  if (unit === "pts") { const v = Math.round(cur - prev); txt = `${v >= 0 ? "+" : ""}${v} pts`; }
  else if (!prev) return null;
  else { const v = Math.round((cur - prev) / prev * 100); txt = `${v >= 0 ? "+" : ""}${v} %`; }
  const up = cur >= prev;
  return <div className="yw-in" style={{ animationDelay: `${delay}ms`, display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 20,
    fontSize: 13.5, fontWeight: 900, background: up ? "rgba(34,197,94,.25)" : "rgba(244,114,182,.25)", boxShadow: `inset 0 0 0 1px ${up ? "rgba(134,239,172,.6)" : "rgba(249,168,212,.6)"}` }}>
    {up ? "▲" : "▼"} {txt} <span style={{ opacity: .8, fontWeight: 700 }}>vs {year}</span></div>;
}

// un camembert dont les parts se dessinent l'une apres l'autre
function Pie({ parts, size = 170, hole = 0.58 }) {
  const tot = parts.reduce((a, p) => a + p.v, 0) || 1, r = 40, C = 2 * Math.PI * r;
  let acc = 0;
  return <svg viewBox="0 0 100 100" style={{ width: size, height: size, transform: "rotate(-90deg)", filter: "drop-shadow(0 10px 22px rgba(0,0,0,.35))" }}>
    {parts.map((p, i) => { const len = p.v / tot * C, off = acc; acc += len;
      return <circle key={i} cx="50" cy="50" r={r} fill="none" stroke={p.c} strokeWidth={100 * (1 - hole) / 2 + 6}
        strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} className="yw-pie" style={{ animationDelay: `${200 + i * 220}ms` }}/>; })}
  </svg>;
}

// des bobines qui tombent du haut et rebondissent (les couleurs de l'annee), une seule fois a l'arrivee sur la
// diapo : en boucle, elles restaient en travers du camembert des matieres pendant la lecture.
function Rain({ colors }) {
  const drops = useMemo(() => Array.from({ length: 22 }, (_, i) => ({ hex: colors[i % colors.length], left: 4 + (i * 37) % 92, size: 16 + (i * 7) % 18,
    delay: (i * 173) % 1800, dur: 1600 + (i * 97) % 900, spin: (i % 2 ? 1 : -1) * (180 + (i * 53) % 360) })), [colors]);
  return <div aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 0 }}>
    {drops.map((p, i) => <span key={i} className="yw-drop" style={{ position: "absolute", top: -40, left: `${p.left}%`, width: p.size, height: p.size, borderRadius: "50%",
      background: `#${p.hex}`, boxShadow: `inset 0 0 0 ${p.size * 0.3}px rgba(255,255,255,.2), inset 0 0 0 ${p.size * 0.37}px rgba(0,0,0,.2)`,
      animationDelay: `${p.delay}ms`, animationDuration: `${p.dur}ms`, "--yw-spin": `${p.spin}deg`, opacity: .9 }}/>)}
  </div>;
}

// des tours en 3D qui montent (une par annee, ou par mois)
function Towers({ items, valueOf, labelOf, hi }) {
  const max = Math.max(1, ...items.map(valueOf));
  return <div style={{ perspective: 700, width: "min(440px, 100%)", margin: "18px 0 8px" }}>
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 12, height: 190, transform: "rotateX(14deg) rotateY(-16deg)", transformStyle: "preserve-3d" }}>
      {items.map((it, i) => { const h = Math.max(6, valueOf(it) / max * 160), on = hi?.(it);
        return <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, transformStyle: "preserve-3d" }}>
          <span style={{ fontSize: 11.5, fontWeight: 900, opacity: .95 }}>{nf(valueOf(it))}</span>
          <div className="yw-tower" style={{ position: "relative", width: 34, height: h, transformStyle: "preserve-3d", animationDelay: `${150 + i * 120}ms` }}>
            <span style={{ position: "absolute", inset: 0, borderRadius: 4, background: on ? "linear-gradient(#fff, #FDE68A)" : "linear-gradient(rgba(255,255,255,.95), rgba(255,255,255,.55))" }}/>
            <span style={{ position: "absolute", top: 0, bottom: 0, left: "100%", width: 12, background: on ? "#D4A72C" : "rgba(255,255,255,.35)", transform: "skewY(-40deg)", transformOrigin: "left" }}/>
            <span style={{ position: "absolute", left: 0, right: 0, bottom: "100%", height: 10, background: on ? "#FEF3C7" : "rgba(255,255,255,.75)", transform: "skewX(-50deg)", transformOrigin: "bottom" }}/>
          </div>
          <span style={{ fontSize: 11, fontWeight: 800, opacity: .85 }}>{labelOf(it)}</span>
        </div>; })}
    </div>
  </div>;
}

function slidesOf(d) {
  const S = [];
  const all = d.scope === "all", p = d.prev, py = p?.year;
  const pct = d.count ? Math.round(d.success / d.count * 100) : 0;
  const since = all && d.since ? new Date(`${d.since}T12:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : null;
  S.push({ bg: all ? ["#0F172A", "#7C3AED"] : ["#4F46E5", "#EC4899"], body: <>
    <Kicker>{all ? "Depuis le début" : `Ton année ${d.year}`}</Kicker>
    <div className="yw-in" style={{ fontSize: "clamp(26px, 7vw, 38px)", fontWeight: 900, lineHeight: 1.15 }}>{all ? "la vie de ton imprimante" : "en impressions"}</div>
    <div style={{ height: 18 }}/>
    <Big size={110}><Count to={d.count}/></Big>
    <Line delay={300}>impressions lancées, sur {nf(d.active_days)} jour{d.active_days > 1 ? "s" : ""}{all && d.days_since ? ` (en ${nf(d.days_since)} jours de vie)` : ""}.</Line>
    <Delta cur={d.count} prev={p?.count} year={py}/>
    {all ? since && <Line delay={700}>La toute première, le {since} : « {d.first?.name} ».</Line>
      : d.first && <Line delay={700}>Tout a commencé le {dayFr(d.first.date)} avec « {d.first.name} ».</Line>}
  </> });
  S.push({ bg: ["#7C3AED", "#2563EB"], body: <>
    <Kicker>La machine a tourné</Kicker>
    <Big size={96}><Count to={hrs(d.seconds)}/> h</Big>
    <Line delay={300}>soit {nf(Math.round(d.seconds / 86400))} jours pleins, nuit comprise.</Line>
    <Delta cur={d.seconds} prev={p?.seconds} year={py} delay={450}/>
    <Line delay={600}>Elle a imprimé {Math.round((d.occupation || 0) * 100)} % du temps{all ? " depuis son premier jour" : d.year === new Date().getFullYear() ? " depuis le 1er janvier" : " de l'année"}.</Line>
    {d.fav_hour?.night > 0 && <Line delay={900}>Et {nf(d.fav_hour.night)} impression{d.fav_hour.night > 1 ? "s ont" : " a"} démarré entre 22 h et 6 h : pendant que tu dormais.</Line>}
  </> });
  // la reussite : le camembert reussies / echouees / annulees
  const parts = [{ v: d.success, c: "#fff" }, { v: d.failed, c: "#FCA5A5" }, { v: d.cancelled, c: "rgba(255,255,255,.35)" }].filter(x => x.v > 0);
  S.push({ bg: ["#059669", "#0EA5E9"], body: <>
    <Kicker>Taux de réussite</Kicker>
    <div style={{ position: "relative", width: 190, height: 190, margin: "8px 0" }}>
      <Pie parts={parts} size={190}/>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><Big size={52}><Count to={pct}/> %</Big></div>
    </div>
    <div className="yw-in" style={{ animationDelay: "300ms", display: "flex", gap: 12, justifyContent: "center", fontSize: 13, fontWeight: 800 }}>
      <span>⚪ {nf(d.success)} réussies</span>{d.failed > 0 && <span style={{ color: "#FECACA" }}>● {nf(d.failed)} échouées</span>}{d.cancelled > 0 && <span style={{ opacity: .75 }}>● {nf(d.cancelled)} annulées</span>}</div>
    {p?.count > 0 && <Delta cur={pct} prev={Math.round(p.success / p.count * 100)} year={py} unit="pts"/>}
    {d.items > d.success && <Line delay={800}>Au total, {nf(d.items)} objets sortis du plateau.</Line>}
    {d.lost_g > 0 && <Line delay={1000}>{kg(d.lost_g)} de filament sont partis avec les échecs. Ça arrive aux meilleurs.</Line>}
  </> });
  if (d.weight_g) {
    const MAT = ["#FDE68A", "#93C5FD", "#F9A8D4", "#86EFAC", "#C4B5FD", "#FDBA74"];
    S.push({ bg: ["#EA580C", "#DB2777"], body: <>
      {d.colors?.length > 0 && <Rain colors={d.colors.map(c => c.hex)}/>}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
        <Kicker>Filament fondu</Kicker>
        <Big size={96}>{kg(d.weight_g)}</Big>
        <Line delay={300}>≈ {d.meters >= 1000 ? `${(d.meters / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} km` : `${nf(d.meters)} m`} de fil, mis bout à bout.</Line>
        <Delta cur={d.weight_g} prev={p?.weight_g} year={py} delay={450}/>
        {d.materials?.length > 0 && <div className="yw-in" style={{ animationDelay: "500ms", display: "flex", alignItems: "center", gap: 14, padding: "10px 14px", borderRadius: 20,
          background: "rgba(0,0,0,.18)", backdropFilter: "blur(4px)" }}>
          <Pie parts={d.materials.map((m, i) => ({ v: m.grams, c: MAT[i % MAT.length] }))} size={110}/>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, textAlign: "left" }}>
            {d.materials.map((m, i) => <span key={m.name} style={{ fontSize: 13, fontWeight: 800 }}>
              <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: MAT[i % MAT.length], marginRight: 6 }}/>{m.name} · {kg(m.grams)}</span>)}
          </div>
        </div>}
        <Line delay={900}>{nf(d.distinct_colors)} couleur{d.distinct_colors > 1 ? "s" : ""} différente{d.distinct_colors > 1 ? "s" : ""}.</Line>
      </div>
    </> });
  }
  if (d.models?.length) S.push({ bg: ["#0891B2", "#6366F1"], body: <>
    <Kicker>Tes modèles préférés</Kicker>
    <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "min(420px, 100%)", marginTop: 10, perspective: 800 }}>
      {d.models.map((m, i) => <div key={i} className="yw-flip" style={{ animationDelay: `${150 + i * 180}ms`, display: "flex", alignItems: "center", gap: 12,
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
    <Line delay={1200}>{nf(d.distinct_models)} modèles différents{all ? " en tout" : " dans l'année"}.</Line>
  </> });
  if (d.creators?.length) S.push({ bg: ["#BE185D", "#7C3AED"], body: <>
    <Kicker>{all ? "Ton créateur de toujours" : "Ton créateur de l'année"}</Kicker>
    <div className="yw-in" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, margin: "10px 0" }}>
      {d.creators[0].avatar ? <MwImg src={d.creators[0].avatar} w={200} style={{ width: 120, height: 120, borderRadius: "50%", objectFit: "cover", boxShadow: "0 0 0 5px rgba(255,255,255,.35)" }}/>
        : <span style={{ width: 120, height: 120, borderRadius: "50%", background: "rgba(255,255,255,.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 54 }}>🎨</span>}
      <div style={{ fontSize: "clamp(26px, 8vw, 40px)", fontWeight: 900 }}>{d.creators[0].name}</div>
    </div>
    <Line delay={300}>{nf(d.creators[0].count)} impression{d.creators[0].count > 1 ? "s" : ""} de {d.creators[0].models} de ses modèles.</Line>
    {d.creators.length > 1 && <Line delay={600}>Suivi de {d.creators.slice(1, 4).map(c => c.name).join(", ")}.</Line>}
    <Line delay={900}>{nf(d.distinct_creators)} créateurs t'ont fait imprimer{all ? "" : " cette année"}.</Line>
  </> });
  // les annees (depuis le debut) en tours 3D ; sinon les mois, et la courbe cumulee qui monte
  if (all && d.by_year?.length > 1) S.push({ bg: ["#1E3A8A", "#9333EA"], body: <>
    <Kicker>Année après année</Kicker>
    <Towers items={d.by_year} valueOf={y => y.count} labelOf={y => y.year} hi={y => y.count === Math.max(...d.by_year.map(z => z.count))}/>
    <Line delay={900}>{d.by_year.map(y => `${y.year} : ${nf(y.hours)} h`).join(" · ")}</Line>
  </> });
  const maxH = Math.max(1, ...(d.months || []).map(m => m.hours));
  let cum = 0;
  const totC = Math.max(1, (d.months || []).reduce((a, m) => a + m.count, 0));
  const pts = (d.months || []).map((m, i) => { cum += m.count; return `${(i + 0.5) / 12 * 100},${100 - cum / totC * 92}`; }).join(" ");
  S.push({ bg: ["#2563EB", "#14B8A6"], body: <>
    <Kicker>Ton rythme{all ? ", mois par mois" : ""}</Kicker>
    <div style={{ position: "relative", width: "min(420px, 100%)", height: 170, margin: "12px 0 6px" }}>
      <div style={{ position: "absolute", inset: "0 0 18px 0", display: "flex", alignItems: "flex-end", gap: 5 }}>
        {(d.months || []).map((m, i) => <div key={m.m} className="yw-bar" style={{ flex: 1, borderRadius: 6, height: `${Math.max(3, m.hours / maxH * 100)}%`, animationDelay: `${i * 60}ms`,
          background: m.label === d.best_month?.label ? "#fff" : "rgba(255,255,255,.4)" }}/>)}
      </div>
      {/* la courbe cumulee des impressions, qui se dessine par-dessus */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: "0 0 18px 0", width: "100%", height: "calc(100% - 18px)", overflow: "visible" }}>
        <polyline points={pts} fill="none" stroke="#FDE68A" strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pathLength="100"
          className="yw-line" style={{ filter: "drop-shadow(0 2px 6px rgba(0,0,0,.4))" }}/>
      </svg>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", gap: 5 }}>
        {(d.months || []).map(m => <span key={m.m} style={{ flex: 1, textAlign: "center", fontSize: 10.5, fontWeight: 800, opacity: .85 }}>{m.label[0].toUpperCase()}</span>)}</div>
    </div>
    <Line delay={500}>Ton mois le plus chargé : <b>{d.best_month?.label}</b>, {nf(Math.round(d.best_month?.hours))} h de machine. <span style={{ color: "#FDE68A" }}>━</span> le cumul des impressions.</Line>
  </> });
  // la semaine et l'horloge des heures
  if (d.weekdays?.length) {
    const maxW = Math.max(1, ...d.weekdays.map(w => w.count)), maxHr = Math.max(1, ...(d.hours || []));
    S.push({ bg: ["#0EA5E9", "#6D28D9"], body: <>
      <Kicker>Ta semaine, tes heures</Kicker>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 110, width: "min(360px, 100%)", marginTop: 8 }}>
        {d.weekdays.map((w, i) => <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end" }}>
          <div className="yw-bar" style={{ width: "100%", borderRadius: 8, height: `${Math.max(4, w.count / maxW * 100)}%`, animationDelay: `${i * 70}ms`,
            background: w.label === d.fav_weekday?.label ? "#fff" : "rgba(255,255,255,.4)" }}/>
          <span style={{ fontSize: 11, fontWeight: 900, opacity: .85 }}>{w.label.slice(0, 3)}</span></div>)}
      </div>
      <svg viewBox="-60 -60 120 120" style={{ width: 170, height: 170, marginTop: 6 }}>
        <circle r="18" fill="rgba(255,255,255,.12)"/>
        {(d.hours || []).map((n, h) => { const a = (h / 24) * 2 * Math.PI - Math.PI / 2, L = 20 + n / maxHr * 34;
          return <line key={h} x1={Math.cos(a) * 20} y1={Math.sin(a) * 20} x2={Math.cos(a) * L} y2={Math.sin(a) * L} strokeLinecap="round"
            stroke={h === d.fav_hour?.hour ? "#FDE68A" : "rgba(255,255,255,.75)"} strokeWidth="4.2" className="yw-ray" style={{ animationDelay: `${300 + h * 30}ms` }}/>; })}
        {[0, 6, 12, 18].map(h => { const a = (h / 24) * 2 * Math.PI - Math.PI / 2;
          return <text key={h} x={Math.cos(a) * 9} y={Math.sin(a) * 9 + 2.5} textAnchor="middle" fontSize="7" fontWeight="900" fill="#fff" opacity=".8">{h}h</text>; })}
      </svg>
      <Line delay={900}>Ton jour pour lancer : le <b>{d.fav_weekday?.label}</b>. Ton heure : <b>{d.fav_hour?.hour} h</b>.</Line>
    </> });
  }
  // face a l'annee d'avant
  if (p?.count) {
    const rows = [["Impressions", d.count, p.count, nf], ["Heures", hrs(d.seconds), hrs(p.seconds), v => `${nf(v)} h`], ["Filament", d.weight_g, p.weight_g, kg],
      ["Jours actifs", d.active_days, p.active_days, nf], ["Modèles", d.distinct_models, p.distinct_models, nf]];
    S.push({ bg: ["#334155", "#0EA5E9"], body: <>
      <Kicker>{d.year} face à {py}</Kicker>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "min(420px, 100%)", marginTop: 12 }}>
        {rows.map(([l, a, b, f], i) => { const mx = Math.max(a, b, 1);
          return <div key={l} className="yw-in" style={{ animationDelay: `${120 + i * 140}ms`, textAlign: "left" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 900, marginBottom: 4 }}>
              <span>{l}</span><span style={{ color: a >= b ? "#86EFAC" : "#F9A8D4" }}>{a >= b ? "▲" : "▼"} {b ? `${a >= b ? "+" : ""}${Math.round((a - b) / b * 100)} %` : "nouveau"}</span></div>
            {[[d.year, a, "#fff"], [py, b, "rgba(255,255,255,.4)"]].map(([yy, v, c]) => <div key={yy} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
              <span style={{ width: 34, fontSize: 11, fontWeight: 800, opacity: .85 }}>{yy}</span>
              <div style={{ flex: 1, height: 10, borderRadius: 6, background: "rgba(255,255,255,.12)", overflow: "hidden" }}>
                <div className="yw-grow" style={{ height: "100%", width: `${v / mx * 100}%`, background: c, borderRadius: 6, animationDelay: `${200 + i * 140}ms` }}/></div>
              <span style={{ width: 62, fontSize: 11.5, fontWeight: 900, textAlign: "right" }}>{f(v)}</span></div>)}
          </div>; })}
      </div>
    </> });
  }
  S.push({ bg: ["#F59E0B", "#EF4444"], body: <>
    <Kicker>{all ? "Tes records de toujours" : "Tes records"}</Kicker>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, width: "min(440px, 100%)", marginTop: 12, perspective: 900 }}>
      {[["⏱️", "La plus longue", dur(d.longest?.seconds), d.longest?.name], ["🏋️", "La plus lourde", kg(d.heaviest?.weight_g), d.heaviest?.name],
        ["🔥", "Le jour le plus chargé", `${d.busiest_day?.count} impressions`, d.busiest_day && dayFr(d.busiest_day.date)],
        ["📆", "Ta plus longue série", `${d.streak} jour${d.streak > 1 ? "s" : ""}`, "d'affilée, sans un jour sans"]].map(([ic, t, v, s], i) =>
        <div key={t} className="yw-flip" style={{ animationDelay: `${150 + i * 180}ms`, padding: 12, borderRadius: 18, background: "rgba(255,255,255,.16)", textAlign: "left", minWidth: 0 }}>
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
    <Line delay={300}>objet{d.sold > 1 ? "s" : ""} vendu{d.sold > 1 ? "s" : ""}{d.revenue != null ? `, pour ${money(d.revenue)}` : ""}.</Line>
    {d.cost != null && <Line delay={600}>Le filament {all ? "de toujours" : "de l'année"} t'a coûté {money(d.cost)}.</Line>}
  </> });
  S.push({ bg: ["#111827", "#4F46E5"], summary: true });
  return S;
}

// le resume : une carte a son propre degrade, photographiee telle qu'a l'ecran pour le partage (04/11/2026 : une image
// redessinee a part ne lui aurait jamais ressemble) ; le bouton Partager n'entre pas dans la photo
function Summary({ d, onShare, cardRef, pub = false }) {
  const tiles = [["🖨️", nf(d.count), "impressions"], ["⏱️", `${nf(hrs(d.seconds))} h`, "de machine"], ["✅", `${d.count ? Math.round(d.success / d.count * 100) : 0} %`, "de réussite"],
    ["🧵", kg(d.weight_g), "de filament"], ["🎨", nf(d.distinct_colors), "couleurs"], ["📆", `${d.streak} j`, "de série"]];
  return <div style={{ width: "min(440px, 100%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
    <div ref={cardRef} style={{ width: "100%", boxSizing: "border-box", padding: "22px 16px 20px", borderRadius: 28, display: "flex", flexDirection: "column", alignItems: "center",
      gap: 14, background: "linear-gradient(160deg, #1E1B4B, #4F46E5 55%, #9333EA)", boxShadow: "0 20px 50px -20px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.12)", color: "#fff" }}>
      <Kicker>BambuNymous · {d.scope === "all" ? `depuis ${d.since?.slice(0, 4) || ""}` : d.year}</Kicker>
      <div style={{ fontSize: "clamp(26px, 7vw, 34px)", fontWeight: 900, lineHeight: 1.1 }}>{d.scope === "all" ? "Depuis le début" : "Ton année en impressions"}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, width: "100%" }}>
        {tiles.map(([ic, v, l]) => <div key={l} style={{ padding: "12px 6px", borderRadius: 16, background: "rgba(255,255,255,.12)" }}>
          <div style={{ fontSize: 20 }}>{ic}</div><div style={{ fontSize: 19, fontWeight: 900 }}>{v}</div><div style={{ fontSize: 11, fontWeight: 700, opacity: .8 }}>{l}</div></div>)}
      </div>
      {d.models?.[0] && <div style={{ fontSize: 14, fontWeight: 700, opacity: .95 }}>
        Modèle préféré : <b>{d.models[0].title}</b>{d.creators?.[0] ? <> · créateur : <b>{d.creators[0].name}</b></> : null}</div>}
      {d.colors?.length > 0 && <div style={{ display: "flex", gap: 6 }}>{d.colors.slice(0, 6).map(c => <Spool key={c.hex} hex={c.hex} size={26}/>)}</div>}
    </div>
    {pub ? <div style={{ fontSize: 12.5, fontWeight: 800, opacity: .8 }}>Fait avec BambuNymous{d.shared_at ? ` · chiffres du ${new Date(`${d.shared_at}Z`).toLocaleDateString("fr-FR")}` : ""}</div>
    : <button type="button" onClick={e => { e.stopPropagation(); onShare(); }} style={{ marginTop: 2, display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 22px",
      borderRadius: 30, border: "none", background: "#fff", color: "#111827", fontSize: 15, fontWeight: 900, cursor: "pointer", boxShadow: "0 10px 30px -8px rgba(0,0,0,.5)" }}>
      <Share2 size={17}/>Partager</button>}
  </div>;
}

// ou partager l'image du resume : Telegram (le compte relie dans l'appli, ses destinations), une autre appli (le menu de
// partage du systeme), ou l'enregistrer
function SharePanel({ d, text: text0, shot, onClose }) {
  const isAdmin = useIsAdmin();
  const [tg, setTg] = useState(null);                 // l'etat du compte Telegram relie
  const [busy, setBusy] = useState(null);
  const [link, setLink] = useState(undefined);        // le lien public de l'animation (undefined : pas encore lu)
  const [exp, setExp] = useState(null);               // son expiration (ISO), et la duree choisie pour un nouveau lien
  const [days, setDays] = useState(0);
  useEffect(() => {
    if (!isAdmin) { setTg({}); setLink(null); return undefined; }
    let alive = true;
    client.get("/share/telegram").then(r => alive && setTg(r.data || {})).catch(() => alive && setTg({}));
    client.get(`/wrapped/share/${d.year}`, { params: { scope: d.scope || "year" } })
      .then(r => { if (alive) { setLink(r.data?.path ? `${window.location.origin}${r.data.path}` : null); setExp(r.data?.expires || null); } })
      .catch(() => alive && setLink(null));
    return () => { alive = false; };
  }, [isAdmin, d.year, d.scope]);
  // le lien de l'animation entiere : cree (ou ses chiffres refaits) a chaque partage ; un nouveau prend la duree choisie
  const makeLink = async () => {
    const r = await client.post("/wrapped/share", { year: d.year, scope: d.scope || "year", tz: -new Date().getTimezoneOffset(), ...(link ? {} : { days }) });
    const u = `${window.location.origin}${r.data.path}`;
    setLink(u);
    return u;
  };
  const withLink = async () => { try { return isAdmin ? await makeLink() : null; } catch { return null; } };
  const textWith = u => u ? `${text0}\n▶ L'animation : ${u}` : text0;
  const copyLink = async () => {
    setBusy("link");
    try {
      const u = await makeLink();
      await navigator.clipboard.writeText(u).catch(() => {});
      toast("Lien de l'animation copié");
      egg("annee_partagee");
    } catch (e) { toast(e?.response?.data?.detail || "Le lien n'a pas pu être créé", "error"); }
    setBusy(null);
  };
  const unshare = async () => {
    const tok = (link || "").split("/annee/")[1];
    if (!tok) return;
    try { await client.delete(`/wrapped/share/${tok}`); setLink(null); toast("Lien retiré : il ne s'ouvre plus"); } catch { toast("Le lien n'a pas pu être retiré", "error"); }
  };
  // les destinations Telegram cochees : d'office celles du dernier partage (le meme choix que le partage d'une impression)
  const [sel, setSel] = useState(null);
  const [note, setNote] = useState("");
  useEffect(() => {
    if (!tg?.destinations?.length || sel) return;
    const ids = tg.destinations.map(x => x.id);
    let last = []; try { last = JSON.parse(localStorage.getItem("bn-share-dests") || "[]"); } catch { /* stockage indisponible */ }
    const keep = (Array.isArray(last) ? last : []).filter(x => ids.includes(x));
    setSel(keep.length ? keep : ids.slice(0, 1));
  }, [tg]); // eslint-disable-line react-hooks/exhaustive-deps
  const sendTg = async () => {
    if (!sel?.length) return;
    setBusy("tg");
    try {
      const m = { blob: await shot(), ext: "png", type: "image/png" };
      const text = [note.trim(), textWith(await withLink())].filter(Boolean).join("\n\n");
      const fd = new FormData();
      fd.append("file", m.blob, `annee-${d.year}.${m.ext}`); fd.append("text", text); fd.append("destination_ids", sel.join(","));
      const r = await client.post("/share/image", fd, { timeout: 120000 });
      try { localStorage.setItem("bn-share-dests", JSON.stringify(sel)); } catch { /* stockage indisponible */ }
      toast(`Envoyé sur Telegram : ${r.data?.destination || ""}`);
      egg("annee_partagee");
      onClose();
    } catch (e) { toast(e?.response?.data?.detail || "L'envoi n'a pas abouti", "error"); }
    setBusy(null);
  };
  const other = async () => {
    setBusy("other");
    try {
      const m = { blob: await shot(), ext: "png", type: "image/png" };
      const text = textWith(await withLink());
      const file = new File([m.blob], `annee-${d.year}.${m.ext}`, { type: m.type });
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
      const m = { blob: await shot(), ext: "png", type: "image/png" };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(m.blob); a.download = `bambunymous-annee-${d.year}.${m.ext}`;
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
      <div style={{ fontSize: 15, fontWeight: 900, textAlign: "center", marginBottom: 4 }}>Partager ton année</div>
      {isAdmin && row("link", "🔗", link ? "Copier le lien de l'animation" : "Créer le lien de l'animation",
        "toute la story, à ouvrir sans compte · chiffres du jour, sans les montants", copyLink)}
      {isAdmin && link && <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 4px", fontSize: 11.5, fontWeight: 700, opacity: .8 }}>
        <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{link}</span>
        <span style={{ whiteSpace: "nowrap", opacity: .8 }}>{exp ? `jusqu'au ${new Date(`${exp}Z`).toLocaleDateString("fr-FR")}` : "sans fin"}</span>
        <button type="button" onClick={unshare} style={{ border: "none", background: "none", color: "#FCA5A5", fontSize: 11.5, fontWeight: 900, cursor: "pointer" }}>Retirer le lien</button></div>}
      {/* la duree d'un nouveau lien (Parametres › Liens publics les prolonge ensuite) */}
      {isAdmin && link === null && <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 4px", fontSize: 12, fontWeight: 800, flexWrap: "wrap" }}>
        <span style={{ opacity: .8 }}>Le lien vaut :</span>
        {[[0, "sans fin"], [7, "7 jours"], [30, "30 jours"], [365, "1 an"]].map(([n, l]) => <button key={n} type="button" onClick={() => setDays(n)}
          style={{ padding: "4px 10px", borderRadius: 14, cursor: "pointer", fontSize: 11.5, fontWeight: 900, color: "#fff",
            border: `1px solid ${days === n ? "rgba(255,255,255,.7)" : "rgba(255,255,255,.15)"}`, background: days === n ? "rgba(255,255,255,.18)" : "transparent" }}>{l}</button>)}
      </div>}
      {tg === null ? <div style={{ fontSize: 12.5, opacity: .7, textAlign: "center" }}>…</div>
        : dests.length ? <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, borderRadius: 16, background: "rgba(255,255,255,.06)" }}>
          <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", opacity: .8 }}>✈️ Telegram · l'image et le lien</div>
          {dests.map(x => { const on = !!sel?.includes(x.id);
            return <label key={x.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 12, cursor: "pointer",
              background: on ? "rgba(96,165,250,.18)" : "rgba(255,255,255,.05)", border: `1px solid ${on ? "rgba(96,165,250,.6)" : "transparent"}` }}>
              <input type="checkbox" checked={on} disabled={!!busy} style={{ accentColor: "#60A5FA", width: 18, height: 18 }}
                onChange={() => setSel(s => on ? (s || []).filter(y => y !== x.id) : [...(s || []), x.id])}/>
              <span style={{ fontSize: 14, fontWeight: on ? 900 : 700 }}>{x.label}</span></label>; })}
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Un mot pour accompagner (facultatif)…" disabled={!!busy}
            style={{ width: "100%", boxSizing: "border-box", marginTop: 2, padding: "8px 10px", borderRadius: 12, border: "1px solid rgba(255,255,255,.15)",
              background: "rgba(0,0,0,.25)", color: "#fff", fontSize: 13.5, fontFamily: "inherit", resize: "vertical" }}/>
          <button type="button" disabled={!!busy || !sel?.length} onClick={sendTg} style={{ padding: "11px 14px", borderRadius: 14, border: "none", cursor: "pointer",
            background: "linear-gradient(135deg, #229ED9, #60A5FA)", color: "#fff", fontSize: 14.5, fontWeight: 900, opacity: busy || !sel?.length ? .55 : 1 }}>
            {busy === "tg" ? "Envoi…" : `Envoyer sur Telegram${sel?.length ? ` (${sel.length})` : ""}`}</button>
        </div>
        : isAdmin && <div style={{ fontSize: 12, fontWeight: 700, opacity: .7, textAlign: "center", padding: "0 8px" }}>
          Telegram : relie ton compte et choisis tes destinations dans Paramètres › Partage.</div>}
      {row("other", "📤", "Une autre appli…", "le menu de partage de ton appareil", other)}
      {row("save", "⬇️", "Enregistrer l'image", `bambunymous-annee-${d.year}.png`, save)}
    </div>
  </div>;
}

// pub : la page publique d'un lien partage (les chiffres figes, deja lus ; ni annee a choisir, ni succes, ni partage
// par l'appli) -- le meme recit, a l'identique
export default function YearWrapped({ year: year0 = 0, onClose, data = null, pub = false }) {
  const [year, setYear] = useState(year0);
  const [d, setD] = useState(data);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [t, setT] = useState(0);                     // l'avancement de la diapositive en cours (0..1)
  const hold = useRef(null);
  useEffect(() => {
    if (pub) return undefined;
    let alive = true;
    setD(null); setI(0);
    // year = "all" : « Depuis le debut », toute la vie de l'imprimante
    client.get("/wrapped", { params: { year: year === "all" ? 0 : year, scope: year === "all" ? "all" : "year", tz: -new Date().getTimezoneOffset() } })
      .then(r => alive && setD(r.data)).catch(() => alive && setD({ error: true }));
    return () => { alive = false; };
  }, [year, pub]);
  useEffect(() => { if (!pub) egg("annee_impressions"); }, [pub]);
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
  const shareText = d && d.count ? `${d.scope === "all" ? `Depuis le début (${d.since?.slice(0, 4)}), mon imprimante 3D` : `Mon année ${d.year} en impressions 3D`} : ${nf(d.count)} impressions, ${nf(hrs(d.seconds))} h de machine, ${kg(d.weight_g)} de filament, `
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
      @keyframes ywPie { from { opacity: 0; transform: scale(.7) rotate(-40deg); } to { opacity: 1; transform: none; } }
      .yw-pie { transform-box: fill-box; transform-origin: center; animation: ywPie .7s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes ywDrop { 0% { top: -8%; transform: rotate(0); } 78% { top: 90%; } 86% { top: 84%; } 100% { top: 112%; transform: rotate(var(--yw-spin)); } }
      .yw-drop { animation-name: ywDrop; animation-timing-function: cubic-bezier(.45,.05,.55,.95); animation-iteration-count: 1; animation-fill-mode: both; }
      @keyframes ywTower { from { transform: scaleY(0); } to { transform: scaleY(1); } }
      .yw-tower { transform-origin: bottom; animation: ywTower .9s cubic-bezier(.2,.9,.25,1.15) both; }
      @keyframes ywFlip { from { opacity: 0; transform: rotateY(85deg) translateZ(-40px); } to { opacity: 1; transform: none; } }
      .yw-flip { backface-visibility: hidden; animation: ywFlip .75s cubic-bezier(.2,.8,.2,1) both; }
      @keyframes ywLine { from { stroke-dashoffset: 100; } to { stroke-dashoffset: 0; } }
      .yw-line { stroke-dasharray: 100; animation: ywLine 1.8s .5s cubic-bezier(.4,0,.2,1) both; }
      @keyframes ywRay { from { opacity: 0; } to { opacity: 1; } }
      .yw-ray { animation: ywRay .4s ease-out both; }
      @keyframes ywGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      .yw-grow { transform-origin: left; animation: ywGrow .9s cubic-bezier(.2,.8,.2,1) both; }
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
          {!pub && d?.years?.length ? <select value={d.scope === "all" ? "all" : d.year} onClick={e => e.stopPropagation()}
            onChange={e => setYear(e.target.value === "all" ? "all" : Number(e.target.value))} aria-label="Choisir l'année"
            style={{ background: "rgba(255,255,255,.18)", color: "#fff", border: "none", borderRadius: 12, padding: "5px 10px", fontSize: 13, fontWeight: 900 }}>
            {d.years.map(y => <option key={y} value={y} style={{ color: "#111" }}>{y}</option>)}
            <option value="all" style={{ color: "#111" }}>Depuis le début</option></select>
            : <span style={{ fontSize: 13, fontWeight: 900, opacity: .9 }}>{d?.scope === "all" ? "Depuis le début" : d?.year || ""}</span>}
          <span style={{ flex: 1 }}/>
          {slides.length > 0 && i < last && <button type="button" onClick={e => { e.stopPropagation(); setPaused(p => !p); }} aria-label={paused ? "Reprendre" : "Pause"} data-tip={paused ? "Reprendre" : "Pause"}
            style={roundBtn}>{paused ? <Play size={16}/> : <Pause size={16}/>}</button>}
          {!pub && <button type="button" onClick={e => { e.stopPropagation(); onClose(); }} aria-label="Fermer" data-tip="Fermer" style={roundBtn}><X size={18}/></button>}
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
          {s.summary ? <Summary d={d} cardRef={cardRef} pub={pub} onShare={() => { setPaused(true); setSharing(true); }}/> : s.body}
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

// l'entree des retrospectives (en tete des statistiques) : un bouton discret ; au clic, on choisit laquelle voir --
// « Depuis le debut » ou une annee qui a des impressions (avec leur nombre).
export function WrappedBanner() {
  const [open, setOpen] = useState(null);             // une annee, ou "all" : depuis le debut
  const [menu, setMenu] = useState(false);
  const [years, setYears] = useState(null);
  const box = useRef(null);
  useEffect(() => {
    if (!menu) return;
    if (years === null) client.get("/wrapped/years").then(r => setYears(r.data?.years || [])).catch(() => setYears([]));
    const out = e => { if (box.current && !box.current.contains(e.target)) setMenu(false); };
    document.addEventListener("pointerdown", out);
    return () => document.removeEventListener("pointerdown", out);
  }, [menu]);
  const pick = v => { setMenu(false); setOpen(v); };
  const row = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", border: "none", borderRadius: 12, cursor: "pointer",
    background: "transparent", color: "var(--text)", fontSize: 13.5, fontWeight: 800, textAlign: "left" };
  return <>
    <div ref={box} style={{ position: "relative", display: "flex", justifyContent: "flex-end" }}>
      <button type="button" onClick={() => setMenu(m => !m)} data-tip="Tes rétrospectives en diapositives : une année, ou depuis le début"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 16, cursor: "pointer", fontSize: 12.5, fontWeight: 800,
          border: "1px solid color-mix(in srgb, #9333EA 30%, var(--border))", color: "var(--text2)",
          background: "linear-gradient(120deg, color-mix(in srgb, #9333EA 12%, transparent), color-mix(in srgb, #EC4899 10%, transparent)), var(--surface)" }}>
        🎁 Rétrospectives <span style={{ fontSize: 10, opacity: .7 }}>{menu ? "▲" : "▼"}</span>
      </button>
      {menu && <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, width: 250, maxWidth: "calc(100vw - 32px)", padding: 6, borderRadius: 16,
        background: "linear-gradient(var(--surface), var(--surface)), var(--bg)", border: "1px solid var(--border)", boxShadow: "0 16px 40px -12px rgba(0,0,0,.35)" }}>
        <button type="button" onClick={() => pick("all")} style={row} className="yw-pick">🏛️ <span style={{ flex: 1 }}>Depuis le début</span></button>
        {years === null ? <div style={{ padding: "8px 12px", fontSize: 12.5, color: "var(--muted)" }}>Chargement…</div>
          : years.map(y => <button key={y.year} type="button" onClick={() => pick(y.year)} style={row} className="yw-pick">
            🎁 <span style={{ flex: 1, whiteSpace: "nowrap" }}>{y.year === new Date().getFullYear() ? `Mon année ${y.year}` : `Année ${y.year}`}</span>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>{y.count} impr.</span></button>)}
        <style>{`.yw-pick:hover { background: var(--surface2) !important; }`}</style>
      </div>}
    </div>
    {open !== null && <YearWrapped year={open} onClose={() => setOpen(null)}/>}
  </>;
}
