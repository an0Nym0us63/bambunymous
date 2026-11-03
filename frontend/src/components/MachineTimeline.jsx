import React, { useEffect, useMemo, useRef, useState } from "react";
import { timeTicks, fmtTick } from "./SensorChart";

// La chronologie de la machine (03/11/2026), en tete de Stats › Machine : ce qui s'est passe sur la fenetre regardee.
// En haut une frise (les impressions en bandes, une pastille par evenement a son heure, les pastilles trop proches
// reunies en une avec leur nombre), dessous la liste par jour, filtrable par sorte. Toucher un evenement le montre dans
// les deux, et son heure sur les courbes (onPick).
export const KINDS = {
  prepare:     ["⏳", "#60A5FA", "print"], print_start: ["▶️", "#3B82F6", "print"], pause: ["⏸️", "#F59E0B", "print"],
  resume:      ["⏯️", "#3B82F6", "print"], finish: ["✅", "#22C55E", "print"], fail: ["❌", "#EF4444", "print"],
  filament:    ["🧵", "#F97316", "filament"],
  nozzle:      ["🔀", "#A855F7", "hard"], switch: ["🛤️", "#8B5CF6", "hard"], rack: ["🔧", "#EC4899", "hard"],
  hms:         ["⚠️", "#EF4444", "alert"],
  door:        ["🚪", "#64748B", "door"],
  dry_start:   ["🔥", "#06B6D4", "dry"], dry_end: ["💧", "#06B6D4", "dry"],
  offline:     ["📴", "#94A3B8", "link"], online: ["📶", "#22C55E", "link"],
};
const CATS = [["all", "Tout"], ["print", "Impressions"], ["filament", "Filament"], ["hard", "Matériel"], ["alert", "Alertes"],
  ["door", "Porte"], ["dry", "Séchage"], ["link", "Connexion"]];
const meta = e => KINDS[e.kind] || ["•", "#64748B", "other"];
const hm = t => new Date(t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayOf = t => {
  const d = new Date(t), today = new Date(); today.setHours(0, 0, 0, 0);
  const d0 = new Date(d); d0.setHours(0, 0, 0, 0);
  const n = Math.round((today - d0) / 86400000);
  return n === 0 ? "Aujourd'hui" : n === 1 ? "Hier" : d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
};
const colorOf = e => (e.kind === "filament" || e.kind === "rack") && /^#?[0-9a-f]{6}/i.test(e.color || "") ? `#${e.color.replace("#", "").slice(0, 6)}` : meta(e)[1];

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// une pastille de la frise : l'icone sur un rond a la couleur de l'evenement
const Dot = ({ e, size = 26, on }) => {
  const [ic] = meta(e), c = colorOf(e);
  return <span style={{ width: size, height: size, borderRadius: "50%", display: "inline-flex", alignItems: "center", justifyContent: "center",
    fontSize: size * 0.5, lineHeight: 1, background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${c} 35%, #fff), ${c})`,
    boxShadow: on ? `0 0 0 3px var(--surface), 0 0 0 5px ${c}, 0 6px 14px -4px ${c}` : `0 0 0 2px var(--surface), 0 4px 10px -4px ${c}`,
    transform: on ? "scale(1.15)" : "none", transition: "transform .15s, box-shadow .15s" }}>{ic}</span>;
};

// une fiche a ouvrir : l'impression, ou la bobine d'un filament
export const linkOf = e => (e.print_id ? "print" : e.spool_id && e.filament_id ? "spool" : null);

export default function MachineTimeline({ events, points, hours, end, pick, onPick, onZoom, onOpen }) {
  const [cat, setCat] = useState("all");
  const [more, setMore] = useState(false);
  const [ref, W] = useWidth();
  const listRef = useRef(null);
  const to = end || Date.now(), from = to - hours * 3600000;
  const evs = useMemo(() => (events || []).map((e, i) => ({ ...e, i, ms: Date.parse(e.t) })).filter(e => e.ms >= from && e.ms <= to), [events, from, to]);
  // les impressions, d'apres les releves : des bandes, avec le nom de l'impression lancee dedans
  const bands = useMemo(() => {
    const out = [];
    let s = null, last = null;
    for (const p of points || []) {
      const t = Date.parse(p.t);
      if (p.printing && s == null) s = t;
      if ((!p.printing || (last && t - last > 20 * 60000)) && s != null) { out.push([s, last ?? t]); s = p.printing ? t : null; }
      last = t;
    }
    if (s != null) out.push([s, last]);
    // le nom : celui de son lancement, sinon d'un autre evenement de l'impression (lancee avant la fenetre)
    const nameIn = (a, b) => (evs.find(e => e.kind === "print_start" && e.ms >= a - 15 * 60000 && e.ms <= b)
      || evs.find(e => meta(e)[2] === "print" && e.detail && e.ms >= a - 15 * 60000 && e.ms <= b + 15 * 60000) || {}).detail || "";
    return out.map(([a, b]) => ({ a, b, name: nameIn(a, b) }));
  }, [points, evs]);
  const x = t => ((t - from) / (to - from)) * 100;
  // les pastilles trop proches (moins de 28 px) se reunissent
  const clusters = useMemo(() => {
    const out = [], gap = W ? (28 / W) * (to - from) : (to - from) / 30;
    for (const e of evs) {
      const c = out[out.length - 1];
      if (c && e.ms - c.last < gap) { c.list.push(e); c.last = e.ms; }
      else out.push({ list: [e], last: e.ms });
    }
    return out.map(c => ({ ...c, ms: c.list.reduce((s, e) => s + e.ms, 0) / c.list.length }));
  }, [evs, W, from, to]);
  const counts = useMemo(() => { const n = { all: evs.length }; for (const e of evs) n[meta(e)[2]] = (n[meta(e)[2]] || 0) + 1; return n; }, [evs]);
  const shown = useMemo(() => evs.filter(e => cat === "all" || meta(e)[2] === cat).slice().reverse(), [evs, cat]);
  const LIMIT = 12, list = more ? shown : shown.slice(0, LIMIT);
  const days = [];
  for (const e of list) { const d = dayOf(e.ms); if (!days.length || days[days.length - 1].d !== d) days.push({ d, list: [] }); days[days.length - 1].list.push(e); }
  const sel = pick != null ? evs.find(e => e.ms === pick) : null;
  const choose = e => {
    onPick?.(pick === e.ms ? null : e.ms);
    if (pick !== e.ms && listRef.current) {
      const k = shown.indexOf(e);
      if (k >= LIMIT && !more) setMore(true);
      setTimeout(() => listRef.current?.querySelector(`[data-ev="${e.i}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 30);
    }
  };
  const ticks = timeTicks(from, to, hours);
  const H = 96, LANE = 52;

  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {/* la frise */}
    <div ref={ref} style={{ position: "relative", height: H, userSelect: "none" }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 8, height: LANE, borderRadius: 14,
        background: "linear-gradient(180deg, color-mix(in srgb, var(--surface2) 80%, transparent), var(--surface2))", border: "1px solid var(--border)" }}/>
      {/* l'axe du temps, au milieu de la bande */}
      <div style={{ position: "absolute", left: 10, right: 10, top: 8 + LANE / 2, height: 2, borderRadius: 2,
        background: "linear-gradient(90deg, transparent, var(--border) 6%, var(--border) 94%, transparent)" }}/>
      {bands.filter(b => b.b > from && b.a < to).map((b, i) => { const l = Math.max(0, x(b.a)), r = Math.min(100, x(b.b)), wpx = (r - l) / 100 * W;
        return <div key={i} data-tip={b.name ? `${b.name} · ${hm(b.a)} → ${hm(b.b)}` : `Impression · ${hm(b.a)} → ${hm(b.b)}`}
          style={{ position: "absolute", left: `${l}%`, width: `${Math.max(0.6, r - l)}%`, top: 8, height: LANE, borderRadius: 12,
            background: "linear-gradient(180deg, rgba(59,130,246,.28), rgba(99,102,241,.14))", border: "1px solid rgba(59,130,246,.35)", overflow: "hidden" }}>
          {wpx > 70 && b.name && <span style={{ position: "absolute", left: 8, right: 6, bottom: 3, fontSize: 10.5, fontWeight: 800, color: "#3B82F6",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>🖨️ {b.name}</span>}
        </div>; })}
      {clusters.map((c, k) => { const one = c.list.length === 1, e = c.list[0], on = c.list.some(z => z.ms === pick);
        // plusieurs reunis : la fenetre se resserre autour d'eux (ils s'y separent) ; deja au plus serre, le dernier
        const zoom = !one && onZoom && hours > 3;
        return <button key={k} type="button" onClick={() => (zoom ? onZoom(c.list[0].ms, c.last) : choose(one ? e : c.list[c.list.length - 1]))}
          data-tip={one ? `${hm(e.ms)} · ${e.title}${e.detail ? ` · ${e.detail}` : ""}` : `${c.list.length} événements · ${hm(c.list[0].ms)} → ${hm(c.last)}${zoom ? " · toucher pour les voir de plus près" : ""}`}
          style={{ position: "absolute", left: W ? Math.min(W - 16, Math.max(16, x(c.ms) / 100 * W)) : `${x(c.ms)}%`, top: 8 + LANE / 2, transform: "translate(-50%, -50%)", padding: 0, border: "none",
            background: "none", cursor: "pointer", zIndex: on ? 3 : 2 }}>
          {one ? <Dot e={e} on={on}/> : <span style={{ position: "relative", display: "inline-flex" }}>
            <Dot e={c.list[c.list.length - 1]} on={on}/>
            <span style={{ position: "absolute", right: -7, top: -7, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 10, fontSize: 10, fontWeight: 900,
              color: "#fff", background: "linear-gradient(135deg, #F43F5E, #EC4899)", display: "inline-flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 0 2px var(--surface)" }}>{c.list.length}</span></span>}
        </button>; })}
      {ticks.map(t => <span key={t} style={{ position: "absolute", bottom: 4, left: `${x(t)}%`, transform: "translateX(-50%)", fontSize: 9.5, fontWeight: 800,
        color: "var(--muted)", whiteSpace: "nowrap" }}>{fmtTick(t, hours)}</span>)}
      {!evs.length && <span style={{ position: "absolute", left: 0, right: 0, top: 8 + LANE / 2 - 9, textAlign: "center", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>
        Rien de notable sur cette période</span>}
    </div>

    {/* l'evenement choisi */}
    {sel && <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 16,
      background: `linear-gradient(135deg, color-mix(in srgb, ${colorOf(sel)} 16%, transparent), transparent 70%), var(--surface2)`,
      border: `1px solid color-mix(in srgb, ${colorOf(sel)} 35%, transparent)` }}>
      <Dot e={sel} size={34}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{sel.title}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis" }}>
          {dayOf(sel.ms)} à {hm(sel.ms)}{sel.before ? ` · avant : ${sel.before}` : ""}{sel.detail ? ` · ${sel.detail}` : ""}</div>
      </div>
      {linkOf(sel) && onOpen && <button type="button" onClick={() => onOpen(sel)} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 20, border: "none",
        cursor: "pointer", fontSize: 12, fontWeight: 900, color: "#fff", background: `linear-gradient(135deg, ${colorOf(sel)}, color-mix(in srgb, ${colorOf(sel)} 60%, #6366F1))`,
        boxShadow: `0 6px 14px -8px ${colorOf(sel)}`, whiteSpace: "nowrap" }}>{linkOf(sel) === "print" ? "Fiche de l'impression ›" : "Fiche de la bobine ›"}</button>}
      <button type="button" onClick={() => onPick?.(null)} aria-label="Fermer" style={{ border: "none", background: "none", color: "var(--muted)", fontSize: 18, cursor: "pointer" }}>×</button>
    </div>}

    {/* les sortes */}
    {evs.length > 0 && <div style={{ display: "flex", gap: 6, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
      {CATS.filter(([k]) => k === "all" || counts[k]).map(([k, l]) => { const on = cat === k;
        return <button key={k} type="button" onClick={() => { setCat(k); setMore(false); }} style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0,
          padding: "5px 11px", borderRadius: 20, fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap",
          border: on ? "none" : "1px solid var(--border)", color: on ? "#fff" : "var(--text2)",
          background: on ? "linear-gradient(135deg, #F43F5E, #8B5CF6)" : "var(--surface)" }}>{l}
          <span style={{ fontSize: 10.5, fontWeight: 900, padding: "0 6px", borderRadius: 10, background: on ? "rgba(255,255,255,.25)" : "var(--surface2)",
            color: on ? "#fff" : "var(--muted)" }}>{counts[k]}</span></button>; })}
    </div>}

    {/* la liste, par jour, la plus recente d'abord : une ligne de temps verticale */}
    <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {days.map(({ d, list: l }) => <div key={d} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", padding: "0 2px" }}>{d}</div>
        <div style={{ position: "relative", display: "flex", flexDirection: "column" }}>
          <span aria-hidden="true" style={{ position: "absolute", left: 58, top: 10, bottom: 10, width: 2, borderRadius: 2, background: "var(--border)" }}/>
          {l.map(e => { const c = colorOf(e), on = e.ms === pick;
            return <button key={e.i} data-ev={e.i} type="button" onClick={() => choose(e)} style={{ position: "relative", display: "flex", alignItems: "center", gap: 10,
              padding: "6px 8px", border: "none", borderRadius: 12, textAlign: "left", cursor: "pointer", color: "var(--text)",
              background: on ? `color-mix(in srgb, ${c} 14%, transparent)` : "transparent" }}>
              <span style={{ width: 40, flexShrink: 0, fontSize: 12, fontWeight: 800, color: on ? c : "var(--muted)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{hm(e.ms)}</span>
              <span style={{ position: "relative", zIndex: 1, flexShrink: 0, display: "inline-flex" }}><Dot e={e} size={22} on={on}/></span>
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
                <span style={{ fontSize: 13, fontWeight: 900, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
                {(e.detail || e.before) && <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {e.kind === "filament" && e.color && <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: c, marginRight: 5, verticalAlign: "-1px" }}/>}
                  {e.detail}{e.before ? `${e.detail ? " · " : ""}avant : ${e.before}` : ""}</span>}
              </span>
              {/* la fiche, d'un toucher */}
              {linkOf(e) && onOpen && <span role="button" tabIndex={0} onClick={ev => { ev.stopPropagation(); onOpen(e); }}
                onKeyDown={ev => { if (ev.key === "Enter") { ev.stopPropagation(); onOpen(e); } }}
                data-tip={linkOf(e) === "print" ? "Ouvrir la fiche de l'impression" : "Ouvrir la fiche de la bobine"}
                style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 10px", borderRadius: 20, fontSize: 11.5, fontWeight: 900,
                  color: c, background: `color-mix(in srgb, ${c} 13%, transparent)`, cursor: "pointer", whiteSpace: "nowrap" }}>Fiche ›</span>}
            </button>; })}
        </div>
      </div>)}
      {shown.length > LIMIT && <button type="button" onClick={() => setMore(m => !m)} style={{ alignSelf: "center", padding: "7px 16px", borderRadius: 20,
        border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>
        {more ? "Moins" : `Voir les ${shown.length - LIMIT} autres`}</button>}
    </div>
  </div>;
}
