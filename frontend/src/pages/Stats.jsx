import React, { useState, useEffect, useMemo } from "react";

import { Weight, Euro, Clock, Layers, Package, AlertTriangle, CheckCircle2, ShoppingBag, TrendingUp, Tag } from "lucide-react";
import client from "../api/client";
import { useTrackDetail } from "../utils/track";
import { isMoneyHidden, MONEY_MASK } from "../utils/money";
import { PrintDetail, GroupBottomSheet } from "./Prints";

const fmtH = s => {
  const t = Math.round(s || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ""}` : m > 0 ? `${m}min` : "—";
};
const fmtKg  = g => `${((g || 0) / 1000).toFixed(2)} kg`;
const fmtEur = c => isMoneyHidden() ? MONEY_MASK : `${(c || 0).toFixed(2)} €`;

// Pastille couleur : dégradé sur un calque interne d'un conteneur overflow:hidden,
// anneau en box-shadow. Aucun border sur l'élément peint → pas de halo.
function Dot({ hex, colors, multicolor, size = 12 }) {
  let bg = hex
    ? (String(hex).startsWith("#") ? String(hex).slice(0, 7) : `#${String(hex).slice(0, 6)}`)
    : "#888";
  const cols = colors
    ? String(colors).split(",").map(c => `#${c.trim().replace(/^#/, "").slice(0, 6)}`).filter(c => c.length === 7)
    : null;
  if (cols && cols.length > 1) {
    bg = multicolor === "gradient"
      ? `linear-gradient(135deg, ${cols.join(",")})`
      : `linear-gradient(90deg, ${cols.map((c, i, a) => `${c} ${i / a.length * 100}%, ${c} ${(i + 1) / a.length * 100}%`).join(",")})`;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", flexShrink: 0,
      position: "relative", overflow: "hidden",
      boxShadow: "inset 0 0 0 1px rgba(128,128,128,0.35)" }}>
      <div style={{ position: "absolute", inset: 0, background: bg }}/>
    </div>
  );
}

function ObjectsStats({ stats, onOpen }) {
  if (!stats) return (
    <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>
      Chargement des statistiques objets…
    </p>
  );
  if (stats.total === 0) return (
    <p style={{ textAlign:"center", color:"var(--muted)", padding:40 }}>
      Aucun objet pour le moment.
    </p>
  );
  const marginColor = stats.margin >= 0 ? "#22c55e" : "#ef4444";
  const acc = stats.accessories;
  return (
    <>
      <Section title="Inventaire">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
          {/* Memes couleurs que les sections de la page Objets : un etat garde
              son code visuel d'un ecran a l'autre. */}
          <KpiCard icon={ShoppingBag} label="Objets" value={stats.total} color="#64748b"/>
          <KpiCard icon={Package} label="À vendre" value={stats.available} color="#3b82f6"/>
          <KpiCard icon={Tag} label="Vendus" value={stats.sold} color="#22c55e"/>
          {stats.gifted > 0 && (
            <KpiCard icon={Tag} label="Offerts" value={stats.gifted} color="#f59e0b"
              sub={stats.cost_gifted > 0 ? `${fmtEur(stats.cost_gifted)} de production` : null}/>
          )}
          {stats.personal > 0 && (
            <KpiCard icon={Package} label="Perso" value={stats.personal} color="#a855f7"
              sub={stats.cost_personal > 0 ? `${fmtEur(stats.cost_personal)} de production` : null}/>
          )}
          {stats.unavailable > 0 && (
            <KpiCard icon={Package} label="Indisponibles" value={stats.unavailable} color="#94a3b8"/>
          )}
          <KpiCard icon={Euro} label="Coût du stock" value={fmtEur(stats.stock_cost)} color="#8b5cf6"
            sub={stats.potential_value > 0 ? `désiré ${fmtEur(stats.potential_value)}` : null}/>
          {stats.avg_cost > 0 && (
            <KpiCard icon={Euro} label="Coût moyen / objet" value={fmtEur(stats.avg_cost)} color="#06b6d4"/>
          )}
        </div>

        {/* Repartition etat + origine */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",
          gap:12, marginTop:12 }}>
          {(stats.state_split || []).some(d => d.value > 0) && (
            <Donut palette title="Par état"
              data={stats.state_split.filter(d => d.value > 0).map(d => ({
                ...d,
                hex: d.name === "Vendus" ? "#f59e0b"
                   : d.name === "Disponibles" ? "#22c55e" : "#64748b",
              }))}/>
          )}
          {(stats.by_parent || []).some(d => d.value > 0) && (
            <div className="card" style={{ padding:"14px 16px" }}>
              <p style={{ fontSize:13, fontWeight:700, color:"var(--text)", margin:"0 0 8px" }}>Origine</p>
              {stats.by_parent.filter(d => d.value > 0).map(d => (
                <Bar key={d.name} label={d.name} value={d.value}
                  max={Math.max(...stats.by_parent.map(x => x.value), 1)}
                  sublabel={`${d.value} objet${d.value > 1 ? "s" : ""}`} color="#8b5cf6"/>
              ))}
            </div>
          )}
        </div>
      </Section>

      <Section title="Ventes">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
          <KpiCard icon={Euro} label="Chiffre d'affaires" value={fmtEur(stats.revenue)} color="#22c55e"/>
          <KpiCard icon={Euro} label="Coût des vendus" value={fmtEur(stats.cost_sold)} color="#ef4444"/>
          <KpiCard icon={TrendingUp} label="Marge" value={fmtEur(stats.margin)} color={marginColor}
            sub={stats.margin_pct ? `${stats.margin_pct} %` : null}/>
        </div>
      </Section>

      <Section title="Ratios">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
          {stats.total > 0 && (
            <KpiCard icon={Tag} label="Taux de vente"
              value={`${Math.round(stats.sold / stats.total * 100)} %`} color="#f59e0b"
              sub={`${stats.sold} / ${stats.total}`}/>
          )}
          {stats.sold > 0 && (
            <KpiCard icon={Euro} label="Panier moyen"
              value={fmtEur(stats.revenue / stats.sold)} color="#22c55e"/>
          )}
          {stats.sold > 0 && (
            <KpiCard icon={TrendingUp} label="Marge moyenne"
              value={fmtEur(stats.margin / stats.sold)} color={marginColor}/>
          )}
        </div>
      </Section>

      {(stats.top_margin || []).length > 0 && (
        <Section title="Meilleures marges">
          <div className="card" style={{ padding:"14px 16px" }}>
            {stats.top_margin.map(o => {
              const max = stats.top_margin[0].margin || 1;
              return (
                <Bar key={o.id} label={o.name}
                  value={Math.max(0, o.margin)} max={max}
                  sublabel={`${fmtEur(o.margin)} (vendu ${fmtEur(o.sold_price)})`}
                  color={o.margin >= 0 ? "#22c55e" : "#ef4444"}/>
              );
            })}
          </div>
        </Section>
      )}

      {acc && acc.count > 0 && (
        <Section title="Accessoires">
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",
            gap:10, marginBottom:12 }}>
            <KpiCard icon={Package} label="Références" value={acc.count} color="#3b82f6"
              sub={`${acc.stock_units} en stock`}/>
            {/* Stock et engage separes : depuis que lier un accessoire le sort
                du stock, ce sont deux realites distinctes -- ce qui reste sur
                l'etagere, et ce qui est deja parti dans des objets. */}
            <KpiCard icon={Euro} label="Valeur du stock" value={fmtEur(acc.stock_value)}
              color="#22c55e" sub={`${acc.stock_units} unité${acc.stock_units>1?"s":""}`}/>
            <KpiCard icon={Euro} label="Engagé dans les objets" value={fmtEur(acc.used_value)}
              color="#8b5cf6" sub={`${acc.used_units} unité${acc.used_units>1?"s":""}`}/>
            <KpiCard icon={TrendingUp} label="Total achete" value={fmtEur(acc.total_value)}
              color="#06b6d4" sub={`${acc.objects_with_accessories} objet${acc.objects_with_accessories>1?"s":""} équipé${acc.objects_with_accessories>1?"s":""}`}/>
            {acc.out_of_stock > 0 && (
              <KpiCard icon={Tag} label="En rupture" value={acc.out_of_stock} color="#ef4444"
                sub={acc.out_of_stock_names.slice(0,2).join(", ")}/>
            )}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",
            gap:12 }}>
            {/* Ou l'argent dort : utile avant de recommander. */}
            {(acc.top_value || []).length > 0 && (
              <div className="card" style={{ padding:"14px 16px" }}>
                <p style={{ fontSize:12, fontWeight:700, color:"var(--text)", margin:"0 0 10px" }}>
                  Stock le plus immobilisant
                </p>
                {acc.top_value.map(a => (
                  <Bar key={a.id} label={a.name} value={a.value}
                    max={acc.top_value[0].value || 1}
                    sublabel={`${fmtEur(a.value)} · ${a.qty} en stock`} color="#8b5cf6"/>
                ))}
              </div>
            )}
            {/* Les plus employes : ceux a ne jamais laisser tomber a zero. */}
            {(acc.top_used || []).length > 0 && (
              <div className="card" style={{ padding:"14px 16px" }}>
                <p style={{ fontSize:12, fontWeight:700, color:"var(--text)", margin:"0 0 10px" }}>
                  Les plus utilisés
                </p>
                {acc.top_used.map(a => (
                  <Bar key={a.id} label={a.name} value={a.used}
                    max={acc.top_used[0].used || 1}
                    sublabel={`${a.used} unité${a.used>1?"s":""} posée${a.used>1?"s":""}`}
                    color="#3b82f6"/>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}
    </>
  );
}

function Section({ title, children }) {
  return (
    <section>
      <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase",
        letterSpacing: "0.08em", margin: "0 0 12px" }}>{title}</p>
      {children}
    </section>
  );
}

function KpiCard({ icon: Icon, label, value, sub, color = "#3b82f6" }) {
  return (
    <div className="card" style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: `${color}20`,
          display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Icon size={14} style={{ color }}/>
        </div>
        <span style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
      </div>
      <p style={{ fontSize: 20, fontWeight: 800, fontFamily: "JetBrains Mono,monospace",
        color: "var(--text)", margin: 0, lineHeight: 1 }}>{value ?? "—"}</p>
      {sub && <p style={{ fontSize: 10, color: "var(--muted)", margin: 0 }}>{sub}</p>}
    </div>
  );
}

function Bar({ label, value, max, color = "#3b82f6", sublabel, dot }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0",
      borderBottom: "1px solid var(--border)" }}>
      <div style={{ width: 130, fontSize: 11, color: "var(--text)", fontWeight: 600, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
        {dot}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      <div style={{ flex: 1, height: 8, background: "var(--surface2)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4,
          transition: "width 0.5s ease" }}/>
      </div>
      <span style={{ fontSize: 11, fontFamily: "JetBrains Mono,monospace", color: "var(--muted)",
        minWidth: 64, textAlign: "right", flexShrink: 0 }}>{sublabel}</span>
    </div>
  );
}

// ── Évolution mensuelle
// Etiquette d'axe adaptee au grain : jour -> "07/16", semaine -> "S29",
// mois -> "07/26".
function fmtBucketLabel(k, bucket) {
  if (bucket === "day") {        // YYYY-MM-DD
    const [, mo, da] = k.split("-");
    return `${da}/${mo}`;
  }
  if (bucket === "week") {       // YYYY-Www
    return "S" + k.split("-W")[1];
  }
  const [y, mo] = k.split("-");  // YYYY-MM
  return `${mo}/${(y || "").slice(2)}`;
}

function TimeChart({ data, bucket = "month" }) {
  const [tab, setTab] = useState("count");
  // Jour : on affiche plus de barres (un mois ~30) ; sinon 18 suffisent.
  const keys = Object.keys(data || {}).slice(bucket === "day" ? -45 : -18);
  if (!keys.length) return null;

  const pick = (k) => {
    const d = data[k];
    switch (tab) {
      case "cost":     return d.cost;
      case "weight":   return (d.weight_g || 0) / 1000;
      case "duration": return (d.duration_s || 0) / 3600;
      default:         return d.count;
    }
  };
  const values = keys.map(pick);
  const max = Math.max(...values, 1);
  const colors = { count: "#3b82f6", cost: "#22c55e", weight: "#8b5cf6", duration: "#f59e0b" };
  const unit = v => tab === "count" ? `${v} prints`
    : tab === "cost" ? `${v.toFixed(2)}€`
    : tab === "weight" ? `${v.toFixed(2)}kg`
    : fmtH(v * 3600);

  return (
    <div className="card" style={{ padding: "16px 16px 10px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[["count", "Impressions"], ["cost", "Coût"], ["weight", "Filament"], ["duration", "Durée"]]
          // Le graphe laisserait deviner les montants malgre le masquage des
          // valeurs : on retire carrement la serie pour un compte en lecture seule.
          .filter(([id]) => !(id === "cost" && isMoneyHidden()))
          .map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: "4px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600, cursor: "pointer", border: "none",
              background: tab === id ? colors[id] : "var(--surface2)", color: tab === id ? "white" : "var(--muted)" }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 3, alignItems: "stretch", height: 130, overflowX: "auto" }}>
        {keys.map((k, i) => {
          const v = values[i];
          const failed = data[k].failed || 0;
          const failPct = tab === "count" && data[k].count > 0 ? (failed / data[k].count) * 100 : 0;
          return (
            <div key={k} title={`${fmtBucketLabel(k, bucket)} — ${unit(v)}${failed ? ` (${failed} échec${failed > 1 ? "s" : ""})` : ""}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center",
                flex: "0 0 auto", width: 26, height: "100%" }}>
              {/* Zone barre : c'est ELLE qui doit avoir une hauteur fixe, sinon le
                  pourcentage de la barre se calcule sur une hauteur nulle et tout
                  s'ecrase a 2px -- le bug des barres plates. */}
              <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end",
                minHeight: 0 }}>
                <div style={{ width: "100%", height: `${Math.max(3, (v / max) * 100)}%`,
                  background: colors[tab], borderRadius: "3px 3px 0 0", minHeight: v > 0 ? 3 : 0,
                  position: "relative", overflow: "hidden", transition: "height 0.4s ease" }}>
                  {failPct > 0 && (
                    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0,
                      height: `${failPct}%`, background: "#ef4444", opacity: 0.75 }}/>
                  )}
                </div>
              </div>
              <span style={{ fontSize: 7, color: "var(--muted)", transform: "rotate(-45deg)",
                transformOrigin: "top center", whiteSpace: "nowrap", marginTop: 8, flexShrink: 0 }}>
                {fmtBucketLabel(k, bucket)}
              </span>
            </div>
          );
        })}
      </div>
      {tab === "count" && (
        <p style={{ fontSize: 9, color: "var(--muted)", margin: "10px 0 0", textAlign: "right" }}>
          <span style={{ display: "inline-block", width: 8, height: 8, background: "#ef4444",
            opacity: 0.75, borderRadius: 2, marginRight: 4 }}/>
          part d'échecs
        </p>
      )}
    </div>
  );
}

// ── Donut
function Donut({ data, title, palette }) {
  const total = (data || []).reduce((s, d) => s + d.value, 0);
  if (!total) return null;
  const COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#f97316", "#06b6d4", "#84cc16", "#ec4899", "#a78bfa"];
  const items = data.slice(0, 10);
  const r = 45, cx = 60, cy = 60;

  let cum = 0;
  const slices = items.map((d, i) => {
    const pct = d.value / total;
    const start = cum; cum += pct;
    const a1 = start * 2 * Math.PI - Math.PI / 2;
    const a2 = cum * 2 * Math.PI - Math.PI / 2;
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
    return {
      path: `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${pct > 0.5 ? 1 : 0},1 ${x2},${y2} Z`,
      color: (palette && d.hex) || COLORS[i % COLORS.length],
      label: d.name, pct: Math.round(pct * 100),
    };
  });
  // Une seule part = cercle complet : l'arc SVG dégénère (départ == arrivée)
  const single = items.length === 1;

  return (
    <div className="card" style={{ padding: 16 }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 12px" }}>{title}</p>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <svg width={120} height={120} viewBox="0 0 120 120">
          {single
            ? <circle cx={cx} cy={cy} r={r} fill={slices[0].color}/>
            : slices.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="var(--bg)" strokeWidth={1.5}/>)}
          <circle cx={cx} cy={cy} r={22} fill="var(--bg)"/>
        </svg>
        <div style={{ flex: 1, minWidth: 140, display: "flex", flexDirection: "column", gap: 5 }}>
          {slices.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: s.color, flexShrink: 0 }}/>
              <span style={{ fontSize: 11, color: "var(--text)", flex: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
              <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "monospace" }}>{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Classement prints / groupes
function MiniBarChart({ data, title, color = "#3b82f6", labelKey = "name", suffix = "" }) {
  const max = Math.max(...data.map(d => d.value), 1);
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return null;
  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 12px" }}>{title}</p>
      <div style={{ display: "flex", gap: 3, alignItems: "stretch", height: 96 }}>
        {data.map((d, i) => {
          const lab = labelKey === "hour" ? String(d.hour).padStart(2, "0") : d[labelKey];
          return (
            <div key={i} title={`${lab}${suffix} — ${d.value}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
              <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", minHeight: 0 }}>
                <div style={{ width: "100%", height: `${Math.max(2, (d.value / max) * 100)}%`,
                  background: color, borderRadius: "3px 3px 0 0",
                  opacity: d.value === max ? 1 : 0.55, transition: "height 0.4s ease" }}/>
              </div>
              <span style={{ fontSize: 8, color: "var(--muted)", marginTop: 5,
                whiteSpace: "nowrap", overflow: "hidden" }}>{lab}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopList({ title, prints, groups, valueKey, valueLabel, barColor = "#3b82f6", onItemClick }) {
  const [mode, setMode] = useState("prints");
  const hasGroups = (groups || []).length > 0;
  const items = mode === "groups" ? (groups || []) : (prints || []);
  if (!prints?.length && !hasGroups) return null;
  const max = Math.max(...items.map(i => Number(i[valueKey]) || 0), 1);
  const MEDAL = ["🥇", "🥈", "🥉"];

  return (
    <div className="card" style={{ padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: 0 }}>{title}</p>
        <div style={{ display: "flex", gap: 2, background: "var(--surface2)", borderRadius: 20, padding: 2 }}>
          {[["prints", "Prints"], ["groups", "Groupes"]].map(([id, label]) => {
            const disabled = id === "groups" && !hasGroups;
            return (
              <button key={id} disabled={disabled} onClick={() => !disabled && setMode(id)}
                style={{ padding: "3px 10px", borderRadius: 18, fontSize: 10, fontWeight: 600,
                  cursor: disabled ? "default" : "pointer", border: "none",
                  background: mode === id ? "#3b82f6" : "transparent",
                  color: mode === id ? "white" : "var(--muted)", opacity: disabled ? 0.4 : 1 }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div style={{ overflowY: "auto", maxHeight: 260, overscrollBehavior: "contain" }}>
        {items.map((item, i) => (
          <div key={`${mode}-${item.id}`} style={{ marginBottom: 10, cursor: "pointer" }}
            onClick={() => onItemClick?.(item, mode)}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <span style={{ fontSize: 12, flexShrink: 0, width: 16 }}>{MEDAL[i] || `${i + 1}`}</span>
              <span style={{ fontSize: 11, color: "var(--text)", fontWeight: 600, flex: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {mode === "groups" && item.nb > 1 &&
                  <span style={{ fontSize: 9, color: "var(--muted)", marginRight: 4 }}>×{item.nb}</span>}
                {item.name}
              </span>
              <span style={{ fontSize: 11, fontFamily: "JetBrains Mono,monospace",
                color: barColor, fontWeight: 700, flexShrink: 0 }}>
                {valueLabel(item)}
              </span>
            </div>
            <div style={{ height: 4, background: "var(--surface2)", borderRadius: 2, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(2, (Number(item[valueKey]) || 0) / max * 100)}%`, height: "100%",
                borderRadius: 2, background: i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : i === 2 ? "#cd7f32" : barColor }}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const PERIODS = [[0, "Tout"], [365, "12 mois"], [90, "90 j"], [30, "30 j"]];

export default function Stats() {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(0);
  const [detail, setDetail] = useState(null);
  const [groupPrints, setGroupPrints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("prints");     // prints | filaments | objects
  useTrackDetail(`Stats · ${ {prints:"Prints", filaments:"Filaments",
    objects:"Objets"}[tab] || tab }`);
  const [objStats, setObjStats] = useState(null);

  useEffect(() => {
    setLoading(true);
    client.get("/prints/stats/summary", { params: { days } })
      .then(r => { setData(r.data); setError(null); })
      .catch(e => setError(e.response?.data?.detail || e.message || "Erreur"))
      .finally(() => setLoading(false));
  }, [days]);

  // Stats objets (independantes de la periode).
  useEffect(() => {
    client.get("/objects/objects/stats")
      .then(r => setObjStats(r.data))
      .catch(() => setObjStats(null));
  }, []);

  const openDetail = async (item, mode) => {
    if (mode === "groups") {
      try {
        const r = await client.get("/prints", { params: { group_id: item.id, limit: 200 } });
        // L'API renvoie { total, prints } — et non { items }
        setGroupPrints(r.data?.prints || []);
      } catch { setGroupPrints([]); }
      setDetail({ type: "group", data: item });
    } else {
      try {
        const r = await client.get(`/prints/${item.id}`);
        setDetail({ type: "print", data: r.data });
      } catch { /* print supprimé entre-temps */ }
    }
  };

  const matData   = useMemo(() => (data?.materials  || []).map(m => ({ name: m.name, value: m.grams })), [data]);
  const brandData = useMemo(() => (data?.brands     || []).map(b => ({ name: b.name, value: b.grams })), [data]);
  const typeData  = useMemo(() => (data?.fila_types || []).map(t => ({ name: t.name, value: t.grams })), [data]);
  const colorData = useMemo(() => (data?.colors     || []).map(c => ({ name: c.name, value: c.grams, hex: c.hex })), [data]);

  const periodSel = (
    <div style={{ display: "flex", gap: 2, background: "var(--surface2)", borderRadius: 20, padding: 2 }}>
      {PERIODS.map(([d, label]) => (
        <button key={d} onClick={() => setDays(d)}
          style={{ padding: "4px 10px", borderRadius: 18, fontSize: 10, fontWeight: 600, cursor: "pointer",
            border: "none", background: days === d ? "#3b82f6" : "transparent",
            color: days === d ? "white" : "var(--muted)" }}>
          {label}
        </button>
      ))}
    </div>
  );

  const header = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
      <h1 className="page-title" style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0, marginRight: "auto" }}>Statistiques</h1>
      {periodSel}
    </div>
  );

  if (loading) return (
    <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      {header}
      <p style={{ textAlign: "center", color: "var(--muted)", padding: 60 }}>Chargement…</p>
    </div>
  );

  if (error) return (
    <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      {header}
      <div style={{ padding: "12px 16px", background: "rgba(239,68,68,0.1)",
        border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, color: "#ef4444", fontSize: 13 }}>
        ⚠ {error}
      </div>
    </div>
  );

  const tabs = [["prints","Prints"],["filaments","Filaments"],["objects","Objets"]];

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
      {header}

      {/* Onglets */}
      <div style={{ display:"flex", gap:4, background:"var(--surface2)", borderRadius:12,
        padding:4, border:"1px solid var(--border)" }}>
        {tabs.map(([id,label]) => (
          <button key={id} onClick={()=>setTab(id)} style={{
            flex:1, padding:"8px 12px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
            background: tab===id ? "#3b82f6" : "transparent",
            color: tab===id ? "white" : "var(--muted)",
            border:"none", transition:"all 0.15s" }}>
            {label}
          </button>
        ))}
      </div>

      {detail?.type === "print" && detail.data?.id && (
        <PrintDetail p={detail.data} onClose={() => setDetail(null)}
          onDelete={() => setDetail(null)} onChanged={() => {}}/>
      )}
      {detail?.type === "group" && (
        <GroupBottomSheet
          groupId={detail.data.id}
          name={detail.data.name}
          prints={groupPrints}
          latestDate={null}
          number_of_items={detail.data.nb || 1}
          onClose={() => setDetail(null)}
          onSelectPrint={() => {}}
          onDelete={() => {}}
          onUngroup={() => {}}
        />
      )}

      {tab === "prints" && (!data || !data.total_prints ? (
        <p style={{ textAlign:"center", color:"var(--muted)", padding:60 }}>
          Aucune impression terminée sur cette période.
        </p>
      ) : (<>
      <Section title="Impressions">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
          <KpiCard icon={Layers} label="Terminées" value={data.total_prints} color="#3b82f6"
            sub={`${data.failed_prints} échec${data.failed_prints > 1 ? "s" : ""}`}/>
          <KpiCard icon={CheckCircle2} label="Taux de réussite" value={`${data.success_rate} %`} color="#22c55e"
            sub={`${data.success_prints} réussies`}/>
          <KpiCard icon={Clock} label="Temps total" value={fmtH(data.total_hours * 3600)} color="#f59e0b"
            sub={data.avg_duration_h > 0 ? `moy. ${fmtH(data.avg_duration_h * 3600)}` : null}/>
          <KpiCard icon={Weight} label="Filament" value={fmtKg(data.total_weight_g)} color="#8b5cf6"
            sub={data.avg_weight_g > 0 ? `moy. ${data.avg_weight_g} g` : null}/>
          <KpiCard icon={Euro} label="Coût total" value={fmtEur(data.total_cost)} color="#ef4444"
            sub={data.avg_cost > 0 ? `moy. ${fmtEur(data.avg_cost)}` : null}/>
        </div>
      </Section>

      <Section title="Moyennes par impression">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
          <KpiCard icon={Euro} label="Coût moyen" value={fmtEur(data.avg_cost)} color="#ef4444"/>
          <KpiCard icon={Clock} label="Durée moyenne" value={fmtH(data.avg_duration_h * 3600)} color="#f59e0b"/>
          <KpiCard icon={Weight} label="Poids moyen" value={`${data.avg_weight_g} g`} color="#8b5cf6"/>
          {data.total_weight_g > 0 && (
            <KpiCard icon={Euro} label="Coût / kg"
              value={fmtEur((data.total_cost || 0) / (data.total_weight_g / 1000))} color="#06b6d4"/>
          )}
          {data.total_hours > 0 && (
            <KpiCard icon={Euro} label="Coût / heure"
              value={fmtEur((data.total_cost || 0) / data.total_hours)} color="#a78bfa"/>
          )}
        </div>
      </Section>

      {/* Habitudes : quand imprimes-tu ? */}
      {(data.by_weekday || data.by_hour) && (
        <Section title="Habitudes d'impression">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))",
            gap: 10, marginBottom: 12 }}>
            {data.peak_hour != null && (
              <KpiCard icon={Clock} label="Heure de pointe"
                value={`${String(data.peak_hour).padStart(2,"0")}h`} color="#f59e0b"/>
            )}
            {data.best_day && (
              <KpiCard icon={Layers} label="Meilleure journée"
                value={`${data.best_day.count} prints`} color="#22c55e"
                sub={data.best_day.date}/>
            )}
            <KpiCard icon={CheckCircle2} label="Taux de réussite"
              value={`${data.success_rate} %`} color="#22c55e"/>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
            {(data.by_weekday || []).length > 0 && (
              <MiniBarChart data={data.by_weekday} title="Par jour de la semaine" color="#3b82f6"/>
            )}
            {(data.by_hour || []).length > 0 && (
              <MiniBarChart data={data.by_hour} title="Par heure de lancement"
                color="#f59e0b" labelKey="hour" suffix="h"/>
            )}
            {(data.status_split || []).some(d => d.value > 0) && (
              <Donut palette title="Réussites / échecs"
                data={data.status_split.filter(d => d.value > 0)
                  .map(d => ({ ...d, hex: d.name === "Échecs" ? "#ef4444" : "#22c55e" }))}/>
            )}
          </div>
        </Section>
      )}

      {data.failed_prints > 0 && (
        <Section title="Perdu sur les échecs">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
            <KpiCard icon={AlertTriangle} label="Échecs" value={data.failed_prints} color="#ef4444"/>
            <KpiCard icon={Weight} label="Filament" value={fmtKg(data.failed_weight_g)} color="#ef4444"/>
            <KpiCard icon={Euro} label="Coût" value={fmtEur(data.failed_cost)} color="#ef4444"/>
            <KpiCard icon={Clock} label="Temps" value={fmtH(data.failed_hours * 3600)} color="#ef4444"/>
          </div>
        </Section>
      )}

      {Object.keys(data.timeline || data.monthly || {}).length > 0 && (
        <Section title="Évolution dans le temps">
          <TimeChart data={data.timeline || data.monthly} bucket={data.timeline_bucket || "month"}/>
        </Section>
      )}

      <Section title="Classements">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
          <TopList title="⏱ Les plus longs" barColor="#f59e0b"
            prints={data.top_duration} groups={data.top_groups_duration}
            valueKey="duration_s" valueLabel={p => fmtH(p.duration_s)}
            onItemClick={openDetail}/>
          {!isMoneyHidden() && (
            <TopList title="💰 Les plus chers" barColor="#22c55e"
              prints={data.top_cost} groups={data.top_groups_cost}
              valueKey="cost" valueLabel={p => fmtEur(p.cost)}
              onItemClick={openDetail}/>
          )}
          <TopList title="⚖ Les plus lourds" barColor="#8b5cf6"
            prints={data.top_weight} groups={data.top_groups_weight}
            valueKey="weight_g" valueLabel={p => `${Math.round(p.weight_g)} g`}
            onItemClick={openDetail}/>
        </div>
      </Section>

      </>))}

      {tab === "filaments" && (<>
      {/* KPIs stock en tete */}
      <Section title="Stock actuel">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
          <KpiCard icon={Package} label="Références" value={data.stock?.references} color="#3b82f6"/>
          <KpiCard icon={Package} label="Bobines actives" value={data.stock?.spools} color="#22c55e"/>
          <KpiCard icon={Weight} label="Poids en stock" value={fmtKg(data.stock?.weight_g)} color="#f59e0b"/>
          <KpiCard icon={Euro} label="Valeur du stock" value={fmtEur(data.stock?.value)} color="#8b5cf6"/>
          {data.stock?.spools > 0 && (
            <KpiCard icon={Euro} label="Valeur / bobine"
              value={fmtEur((data.stock?.value || 0) / data.stock.spools)} color="#06b6d4"/>
          )}
          {data.stock?.weight_g > 0 && (
            <KpiCard icon={Weight} label="Poids / bobine"
              value={`${Math.round((data.stock?.weight_g || 0) / data.stock.spools)} g`} color="#a78bfa"/>
          )}
        </div>
        <p style={{ fontSize: 10, color: "var(--muted)", margin: "8px 0 0" }}>
          Le stock ne dépend pas de la période sélectionnée.
        </p>
      </Section>

      {/* Consommation sur la periode */}
      <Section title="Consommé sur la période">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(140px,1fr))", gap: 10 }}>
          <KpiCard icon={Weight} label="Filament utilisé" value={fmtKg(data.total_weight_g)} color="#8b5cf6"/>
          <KpiCard icon={Euro} label="Coût filament" value={fmtEur(data.total_cost)} color="#ef4444"/>
          {data.total_weight_g > 0 && (
            <KpiCard icon={Euro} label="Coût moyen / kg"
              value={fmtEur((data.total_cost || 0) / (data.total_weight_g / 1000))} color="#f59e0b"/>
          )}
          {(data.materials || []).length > 0 && (
            <KpiCard icon={Layers} label="Matériaux utilisés" value={data.materials.length} color="#3b82f6"/>
          )}
        </div>
      </Section>

      {(matData.length > 0 || colorData.length > 0) && (
        <Section title="Répartition de la consommation">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 12 }}>
            {matData.length > 0 && <Donut data={matData} title="Par matériau"/>}
            {colorData.length > 0 && <Donut data={colorData} title="Par teinte" palette/>}

            {typeData.length > 0 && (
              <div className="card" style={{ padding: "14px 16px" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>Par type</p>
                {typeData.map(t => (
                  <Bar key={t.name} label={t.name} value={t.value} max={typeData[0].value}
                    sublabel={fmtKg(t.value)} color="#06b6d4"/>
                ))}
              </div>
            )}

            {brandData.length > 0 && (
              <div className="card" style={{ padding: "14px 16px" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>Par marque</p>
                {brandData.map(b => (
                  <Bar key={b.name} label={b.name} value={b.value} max={brandData[0].value}
                    sublabel={fmtKg(b.value)} color="#8b5cf6"/>
                ))}
              </div>
            )}

            {(data.top_filaments || []).length > 0 && (
              <div className="card" style={{ padding: "14px 16px" }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", margin: "0 0 8px" }}>
                  Filaments les plus utilisés
                </p>
                {data.top_filaments.map(f => (
                  <Bar key={f.id} label={f.name}
                    value={f.grams} max={data.top_filaments[0].grams}
                    sublabel={`${f.grams} g`} color="#3b82f6"
                    dot={<Dot hex={f.color} colors={f.colors_array} multicolor={f.multicolor_type} size={10}/>}/>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      </>)}

      {tab === "objects" && (
        <ObjectsStats stats={objStats} onOpen={openDetail}/>
      )}
    </div>
  );
}
