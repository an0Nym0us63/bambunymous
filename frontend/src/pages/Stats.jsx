import React, { useState, useEffect, useMemo } from "react";

import { Weight, Euro, Clock, Layers, Package, AlertTriangle, CheckCircle2, ShoppingBag, TrendingUp, Tag, Filter } from "lucide-react";
import client from "../api/client";
import HeaderAction from "../components/HeaderAction";
import { useTrackDetail } from "../utils/track";
import { isMoneyHidden, MONEY_MASK } from "../utils/money";
import { PrintDetail, GroupBottomSheet } from "./Prints";
import { ObjectSheet, AccessorySheet } from "./Objects";

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

function ObjectsStats({ stats, onOpen, onOpenObject, onOpenAccessory }) {
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
      <Section title="Inventaire" isGlobal>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 }}>
          {/* Memes couleurs que les sections de la page Objets : un etat garde
              son code visuel d'un ecran a l'autre. */}
          <KpiCard icon={ShoppingBag} label="Objets" value={stats.total} color="#64748b"/>
          <KpiCard icon={Package} label="À vendre" value={stats.available} color="#3b82f6"/>
          <KpiCard icon={Tag} label="Vendus" value={stats.total_sold ?? stats.sold} color="#22c55e"/>
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
                // La palette etait restee calee sur les anciens libelles :
                // "Disponibles" n'existe plus, donc tout retombait sur le gris
                // de repli sauf "Vendus". Memes couleurs que les sections de la
                // page Objets desormais -- un etat garde son code partout.
                hex: { "À vendre":"#3b82f6", "Vendus":"#22c55e", "Offerts":"#f59e0b",
                       "Perso":"#a855f7", "Indisponibles":"#94a3b8" }[d.name] || "#64748b",
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
          {/* Rapporte aux objets DESTINES A LA VENTE, pas au total. Un cadeau
              ou un objet garde pour soi n'a jamais ete propose : le compter
              comme une vente ratee ecrasait le taux -- 9 sur 174 affichait 5%,
              alors que sur les seuls objets proposes le chiffre a un sens. */}
          {(stats.available + stats.sold) > 0 && (
            <KpiCard icon={Tag} label="Taux de vente"
              value={`${Math.round(stats.sold / (stats.available + stats.sold) * 100)} %`}
              color="#22c55e"
              sub={`${stats.sold} vendus / ${stats.available + stats.sold} proposés`}/>
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

      {((stats.top_margin || []).length > 0 || (stats.top_margin_pct || []).length > 0) && (
        <Section title="Meilleures marges">
          {/* Empilees et non cote a cote : cote a cote, les barres etaient trop
              etroites pour se lire. */}
          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {(stats.top_margin || []).length > 0 && (
              <div className="card" style={{ padding:"14px 16px" }}>
                <p style={{ fontSize:12, fontWeight:700, color:"var(--text)", margin:"0 0 10px" }}>
                  En valeur
                </p>
                {stats.top_margin.map(o => {
                  const max = stats.top_margin[0].margin || 1;
                  return (
                    <Bar key={o.id} label={o.name}
                      value={Math.max(0, o.margin)} max={max}
                      sublabel={fmtEur(o.margin)}
                      onClick={onOpenObject ? () => onOpenObject(o.id) : undefined}
                      color={o.margin >= 0 ? "#22c55e" : "#ef4444"}/>
                  );
                })}
              </div>
            )}
            {/* Memes objets, classes par ratio marge/cout : revele les plus
                rentables proportionnellement, la ou la marge absolue favorise
                mecaniquement les gros objets chers. */}
            {(stats.top_margin_pct || []).length > 0 && (
              <div className="card" style={{ padding:"14px 16px" }}>
                <p style={{ fontSize:12, fontWeight:700, color:"var(--text)", margin:"0 0 10px" }}>
                  En pourcentage
                </p>
                {stats.top_margin_pct.map(o => {
                  const max = stats.top_margin_pct[0].margin_pct || 1;
                  return (
                    <Bar key={o.id} label={o.name}
                      value={Math.max(0, o.margin_pct)} max={max}
                      sublabel={`${o.margin_pct} %`}
                      onClick={onOpenObject ? () => onOpenObject(o.id) : undefined}
                      color={o.margin_pct >= 0 ? "#22c55e" : "#ef4444"}/>
                  );
                })}
              </div>
            )}
          </div>
        </Section>
      )}

      {acc && acc.count > 0 && (
        <Section title="Accessoires" isGlobal>
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

          <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
            {/* Ou l'argent dort : utile avant de recommander. */}
            {(acc.top_value || []).length > 0 && (
              <div className="card" style={{ padding:"14px 16px" }}>
                <p style={{ fontSize:12, fontWeight:700, color:"var(--text)", margin:"0 0 10px" }}>
                  Stock le plus immobilisant
                </p>
                {acc.top_value.map(a => (
                  <Bar key={a.id} label={a.name} value={a.value} stacked
                    max={acc.top_value[0].value || 1}
                    onClick={onOpenAccessory ? () => onOpenAccessory(a.id) : undefined}
                    sublabel={`${fmtEur(a.value)} · ${a.qty} u.`} color="#8b5cf6"/>
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
                  <Bar key={a.id} label={a.name} value={a.used} stacked
                    max={acc.top_used[0].used || 1}
                    onClick={onOpenAccessory ? () => onOpenAccessory(a.id) : undefined}
                    sublabel={`${a.used} posée${a.used>1?"s":""}`}
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

// Badge discret signalant une section GLOBALE (indep. du filtre de periode).
function GlobalBadge() {
  return (
    <span title="Indépendant du filtre de période"
      style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
        color: "var(--muted)", background: "var(--surface2)", border: "1px solid var(--border)",
        borderRadius: 5, padding: "1px 5px", lineHeight: 1.5 }}>global</span>
  );
}

function Section({ title, children, isGlobal }) {
  return (
    <section>
      <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase",
        letterSpacing: "0.08em", margin: "0 0 12px", display: "flex", alignItems: "center", gap: 8 }}>
        {title}{isGlobal && <GlobalBadge/>}
      </p>
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

function Bar({ label, value, max, color = "#3b82f6", sublabel, dot, stacked, onClick }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  const [hover, setHover] = React.useState(false);
  const clickable = typeof onClick === "function";
  const rowExtra = clickable
    ? { cursor: "pointer", background: hover ? "var(--surface2)" : "transparent",
        borderRadius: 8, transition: "background 0.12s" }
    : {};
  const handlers = clickable
    ? { onClick, role: "button", tabIndex: 0,
        onMouseEnter: () => setHover(true), onMouseLeave: () => setHover(false) }
    : {};
  // Variante 'dashboard' : nom + valeur sur une ligne, barre EN PLEINE LARGEUR
  // dessous. En ligne unique, le nom et la valeur ecrasaient la barre au point
  // qu'on ne la voyait presque plus.
  if (stacked) {
    return (
      <div {...handlers} style={{ padding: "8px 6px", borderBottom: "1px solid var(--border)", ...rowExtra }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "flex", alignItems: "center", gap: 6 }}>{dot}{label}</span>
          <span style={{ fontSize: 11, fontFamily: "JetBrains Mono,monospace", color: "var(--muted)",
            flexShrink: 0, whiteSpace: "nowrap" }}>{sublabel}</span>
        </div>
        <div style={{ height: 8, background: "var(--surface2)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4,
            transition: "width 0.5s ease" }}/>
        </div>
      </div>
    );
  }
  return (
    <div {...handlers} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px",
      borderBottom: "1px solid var(--border)", ...rowExtra }}>
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

// Couleur par statut pour le donut de repartition (aligne sur STATUS_CFG).
const STATUS_SPLIT_COLORS = {
  "Réussies": "#22c55e",
  "Partiel": "#f59e0b",
  "À refaire": "#8b5cf6",
  "Échecs": "#ef4444",
  "Annulé": "#94a3b8",
};

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

// ── Filtre de période ──────────────────────────────────────────────────────
const ISO = (d) => { const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

// Calcule {from,to,label} pour un preset. Dates locales (pas d'UTC, sinon
// decalage d'un jour selon le fuseau).
function presetRange(key) {
  const now = new Date();
  const today = ISO(now);
  const s = new Date(now);
  switch (key) {
    case "all":   return { from: null, to: null, label: "Tout" };
    case "week":  { const d = new Date(now); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return { from: ISO(d), to: today, label: "Cette semaine" }; }
    case "month": return { from: ISO(new Date(now.getFullYear(), now.getMonth(), 1)), to: today, label: "Ce mois" };
    case "year":  return { from: ISO(new Date(now.getFullYear(), 0, 1)), to: today, label: "Cette année" };
    case "prevmonth": { const a = new Date(now.getFullYear(), now.getMonth() - 1, 1); const b = new Date(now.getFullYear(), now.getMonth(), 0); return { from: ISO(a), to: ISO(b), label: "Mois dernier" }; }
    case "prevyear":  { const y = now.getFullYear() - 1; return { from: `${y}-01-01`, to: `${y}-12-31`, label: "Année dernière" }; }
    case "7d":  { s.setDate(now.getDate() - 6);  return { from: ISO(s), to: today, label: "7 jours" }; }
    case "30d": { s.setDate(now.getDate() - 29); return { from: ISO(s), to: today, label: "30 jours" }; }
    case "90d": { s.setDate(now.getDate() - 89); return { from: ISO(s), to: today, label: "90 jours" }; }
    case "12m": { s.setFullYear(now.getFullYear() - 1); s.setDate(s.getDate() + 1); return { from: ISO(s), to: today, label: "12 mois" }; }
    default: return { from: null, to: null, label: "Tout" };
  }
}

const PRESETS = [
  ["all", "Tout"], ["week", "Cette semaine"], ["month", "Ce mois"], ["year", "Cette année"],
  ["prevmonth", "Mois dernier"], ["prevyear", "Année dernière"],
  ["7d", "7 jours"], ["30d", "30 jours"], ["90d", "90 jours"], ["12m", "12 mois"],
];

function PeriodFilterSheet({ value, onApply, onClose }) {
  const [from, setFrom] = React.useState(value.from || "");
  const [to, setTo] = React.useState(value.to || "");
  const applyCustom = () => {
    if (!from && !to) { onApply({ from: null, to: null, label: "Tout" }); return; }
    const label = from && to ? `${from} → ${to}` : from ? `Depuis ${from}` : `Jusqu'au ${to}`;
    onApply({ from: from || null, to: to || null, label });
  };
  const inputStyle = { width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8,
    border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 13 };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
      zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div className="sheet-panel" onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560,
        borderRadius: "16px 16px 0 0", padding: 16, maxHeight: "85vh",
        overflowY: "auto", paddingBottom: "calc(16px + env(safe-area-inset-bottom,0px))" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Période</h3>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--muted)",
            fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 18 }}>
          {PRESETS.map(([k, lbl]) => {
            const active = value.label === lbl;
            return (
              <button key={k} onClick={() => onApply(presetRange(k))} style={{ padding: "10px 12px",
                borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer", border: "1px solid var(--border)",
                background: active ? "#3b82f6" : "var(--surface2)", color: active ? "#fff" : "var(--text)" }}>
                {lbl}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", margin: "0 0 8px",
          textTransform: "uppercase", letterSpacing: 0.4 }}>Plage personnalisée</p>
        <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
          <label style={{ flex: 1, fontSize: 11, color: "var(--muted)" }}>Début
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={inputStyle}/>
          </label>
          <label style={{ flex: 1, fontSize: 11, color: "var(--muted)" }}>Fin
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={inputStyle}/>
          </label>
        </div>
        <button onClick={applyCustom} style={{ width: "100%", padding: 12, borderRadius: 10, border: "none",
          background: "#3b82f6", color: "#fff", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          Appliquer la plage
        </button>
      </div>
    </div>
  );
}

export default function Stats() {
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState({ from: null, to: null, label: "Tout" });
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [groupPrints, setGroupPrints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("prints");     // prints | filaments | objects
  useTrackDetail(`Stats · ${ {prints:"Prints", filaments:"Filaments",
    objects:"Objets"}[tab] || tab }`);
  const [objStats, setObjStats] = useState(null);
  const [objDetail, setObjDetail] = useState(null);
  const [accId, setAccId] = useState(null);

  useEffect(() => {
    setLoading(true);
    client.get("/prints/stats/summary", { params: { date_from: period.from || undefined, date_to: period.to || undefined } })
      .then(r => { setData(r.data); setError(null); })
      .catch(e => setError(e.response?.data?.detail || e.message || "Erreur"))
      .finally(() => setLoading(false));
  }, [period]);

  // Stats objets : les VENTES suivent la periode (sold_date), l'inventaire reste global.
  const loadObjects = React.useCallback(() => {
    client.get("/objects/objects/stats", { params: { date_from: period.from || undefined, date_to: period.to || undefined } })
      .then(r => setObjStats(r.data))
      .catch(() => setObjStats(null));
  }, [period]);
  useEffect(() => { loadObjects(); }, [loadObjects]);

  // Clic sur un accessoire (histogrammes accessoires) -> ouverture de sa fiche.
  const openAccessory = (id) => setAccId(id);

  // Clic sur un objet (histogrammes de marges) -> ouverture de sa fiche sur place.
  const openObject = async (id) => {
    try {
      const r = await client.get(`/objects/objects/${id}`);
      setObjDetail(r.data);
    } catch { /* objet supprime entre-temps */ }
  };

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

  const filterBtn = () => (
    <button onClick={() => setFilterOpen(true)}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderRadius: 20,
        border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)",
        fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
      <Filter size={14}/> {period.label}
    </button>
  );

  // Mobile : le bouton part dans le header fixe (via HeaderAction), il affiche la
  // plage courante. Desktop : le header mobile n'existe pas, titre + bouton dans le flux.
  const header = (
    <>
      <HeaderAction>{filterBtn()}</HeaderAction>
      <div className="hidden-mobile" style={{ display: "none", alignItems: "center",
        justifyContent: "flex-end", gap: 10 }}>
        <h1 className="page-title" style={{ fontSize: 18, fontWeight: 700, color: "var(--text)",
          margin: 0, marginRight: "auto" }}>Statistiques</h1>
        {filterBtn()}
      </div>
      {filterOpen && (
        <PeriodFilterSheet value={period}
          onApply={(r) => { setPeriod(r); setFilterOpen(false); }}
          onClose={() => setFilterOpen(false)}/>
      )}
    </>
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

      {objDetail && (
        <ObjectSheet obj={objDetail} onClose={() => setObjDetail(null)}
          onUpdated={(updated) => { if (updated) setObjDetail(updated); loadObjects(); }}/>
      )}
      {accId && (
        <AccessorySheet accId={accId} onClose={() => setAccId(null)} onChanged={loadObjects}/>
      )}
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
              <Donut palette title="Répartition par statut"
                data={data.status_split.filter(d => d.value > 0)
                  .map(d => ({ ...d, hex: STATUS_SPLIT_COLORS[d.name] || "#94a3b8" }))}/>
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
      <Section title="Stock actuel" isGlobal>
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
        <ObjectsStats stats={objStats} onOpen={openDetail} onOpenObject={openObject} onOpenAccessory={openAccessory}/>
      )}
    </div>
  );
}
