import React, { useState, useEffect, useMemo, useRef } from "react";
import { colorBg, parseColorsList, finishOf } from "../utils/colors";
import HiddenMark from "../components/HiddenMark";
import Cachettes from "../components/Cachettes";
import { useUrlTab } from "../utils/useUrlTab";
import { useNavigate } from "react-router-dom";

import { Weight, Euro, Clock, Layers, Package, AlertTriangle, CheckCircle2, ShoppingBag, TrendingUp, Tag, Filter, Droplets,
  Gauge, Activity, Timer, Target, PauseCircle } from "lucide-react";
import client from "../api/client";
import { egg } from "../eggs";
import HeaderAction from "../components/HeaderAction";
import { useTrackDetail } from "../utils/track";
import { isMoneyHidden, MONEY_MASK } from "../utils/money";
// les fiches viennent des autres pages, chargees a l'ouverture seulement (28/10/2026 : importees en dur, la page
// Stats embarquait Impressions, Objets, Filaments et Succes entieres avant son premier affichage)
import { PrintDetail, GroupBottomSheet, ObjectSheet, AccessorySheet, FilamentSheetFromSpool } from "../components/LazySheets";
import { importRetry } from "../utils/importRetry";
const Achievements = React.lazy(() => importRetry(() => import("./Achievements")));
import { FSheet, fBtn, fGrad } from "../components/FicheKit";

const fmtH = s => {
  const t = Math.round(s || 0);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60);
  return h > 0 ? `${h}h${m > 0 ? ` ${m}min` : ""}` : m > 0 ? `${m}min` : "—";
};
const fmtKg  = g => `${((g || 0) / 1000).toFixed(2)} kg`;
const fmtEur = c => isMoneyHidden() ? MONEY_MASK : `${(c || 0).toFixed(2)} €`;
// un chiffre a une decimale, virgule francaise : 4,2
const fr1 = n => String(Math.round((n || 0) * 10) / 10).replace(".", ",");
// un ecart entre deux lancements : « 2 j 4 h » au-dela d'un jour, sinon « 3h 12min »
const fmtGap = s => { const t = Math.round(s || 0); if (t < 86400) return fmtH(t);
  const d = Math.floor(t / 86400), h = Math.round((t % 86400) / 3600); return `${d} j${h > 0 ? ` ${h} h` : ""}`; };

// Tendance par rapport a la periode precedente (28/10/2026) : { text, good } ou null si rien a comparer.
// En pourcentage (« +12 % ») ou en points pour un taux (pts: true) ; invert: true quand monter est mauvais (un cout).
function deltaOf(cur, prev, { pts = false, invert = false } = {}) {
  if (prev == null || cur == null || !(prev > 0)) return null;
  const d = pts ? cur - prev : (cur - prev) / prev * 100;
  if (!isFinite(d)) return null;
  const r = Math.round(d * (pts ? 10 : 1)) / (pts ? 10 : 1);
  if (r === 0) return { text: pts ? "= 0 pt" : "= 0 %", good: null };
  const up = r > 0;
  const txt = `${up ? "▲ +" : "▼ −"}${String(Math.abs(r)).replace(".", ",")} ${pts ? "pts" : "%"}`;
  return { text: txt, good: invert ? !up : up };
}

// Pastille couleur : dégradé sur un calque interne d'un conteneur overflow:hidden,
// anneau en box-shadow. Aucun border sur l'élément peint → pas de halo.
function Dot({ hex, colors, multicolor, finish = null, size = 12 }) {
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
      <div style={{ position: "absolute", inset: 0, ...(hex || colors ? colorBg(parseColorsList(hex, colors), multicolor, finish, { size: 140 }) : { background: bg }) }}/>
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
  const sold = stats.total_sold ?? stats.sold ?? 0;
  return (
    <>
      <StatHero color="#22C55E" icon="💶" label="Ventes encaissées" value={isMoneyHidden() ? MONEY_MASK : `${(stats.revenue || 0).toFixed(2)} €`}
        ring={stats.total ? (sold / stats.total) * 100 : null} ringLabel="vendus"
        chips={[`🎁 ${sold} vendu${sold > 1 ? "s" : ""} sur ${stats.total}`, !isMoneyHidden() && stats.margin != null && `📈 ${stats.margin >= 0 ? "+" : ""}${(stats.margin || 0).toFixed(2)} € de marge`,
          stats.available ? `🏷️ ${stats.available} à vendre` : null]}/>
      <Section title="Inventaire" isGlobal>
        <div className="kpi-grid st-kpis">
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
        <div className="kpi-grid" style={{ "--kpi-min":"280px", gap:12, marginTop:12 }}>
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
            <div style={{ ...statCard("#8B5CF6"), padding:"14px 14px" }}>
              <p style={cardTitle}>Origine</p>
              {stats.by_parent.filter(d => d.value > 0).map(d => (
                <Bar key={d.name} label={d.name} value={d.value}
                  max={Math.max(...stats.by_parent.map(x => x.value), 1)}
                  sublabel={`${d.value} objet${d.value > 1 ? "s" : ""}`} color="#8b5cf6"/>
              ))}
            </div>
          )}
        </div>
      </Section>

      {/* PC : ventes et ratios cote a cote. */}
      <div className="wide-2" style={{ gap:20 }}>
      <Section title="Ventes">
        <div className="kpi-grid st-kpis">
          <KpiCard icon={Euro} label="Chiffre d'affaires" value={fmtEur(stats.revenue)} color="#22c55e"/>
          <KpiCard icon={Euro} label="Coût des vendus" value={fmtEur(stats.cost_sold)} color="#ef4444"/>
          <KpiCard icon={TrendingUp} label="Marge" value={fmtEur(stats.margin)} color={marginColor}
            sub={stats.margin_pct ? `${stats.margin_pct} %` : null}/>
        </div>
      </Section>

      <Section title="Ratios">
        <div className="kpi-grid st-kpis">
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
      </div>

      {((stats.top_margin || []).length > 0 || (stats.top_margin_pct || []).length > 0) && (
        <Section title="Meilleures marges">
          {/* Empilees sur telephone (cote a cote, les barres etaient trop
              etroites pour se lire), cote a cote sur PC ou la place ne manque pas. */}
          <div className="wide-2" style={{ gap:12 }}>
            {(stats.top_margin || []).length > 0 && (
              <div style={{ ...statCard("#22c55e"), padding:"14px 14px" }}>
                <p style={cardTitle}>
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
              <div style={{ ...statCard("#22c55e"), padding:"14px 14px" }}>
                <p style={cardTitle}>
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
          <div className="kpi-grid st-kpis" style={{ "--kpi-min":"150px", marginBottom:12 }}>
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
              <div style={{ ...statCard("#22c55e"), padding:"14px 14px" }}>
                <p style={cardTitle}>
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
              <div style={{ ...statCard("#22c55e"), padding:"14px 14px" }}>
                <p style={cardTitle}>
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
// ── Sechage : etat des lieux des bobines actives ────────────────────────────
const fmtMonths = d => d == null ? "jamais" : d < 30 ? `${d} j`
  : `${String(Math.round(d / 30 * 10) / 10).replace(".", ",")} mois`;

// une ligne de bobine a secher, hors du composant (28/10/2026 : redefinie a chaque rendu, toutes remontees a chaque clic)
function DryRow({ s, late, onOpen }) {
return (
  <div onClick={() => onOpen(s)} role="button" tabIndex={0}
    style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 4px", cursor:"pointer",
      borderBottom:"1px dashed var(--border)" }}>
    <Dot hex={s.color} colors={s.colors_array} multicolor={s.multicolor_type} finish={finishOf(s)} size={14}/>
    <div style={{ flex:1, minWidth:0 }}>
      <div style={{ fontSize:13.5, fontWeight:800, color:"var(--text)", overflow:"hidden",
        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{s.name}</div>
      <div style={{ fontSize:11.5, fontWeight:600, color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
        {[s.brand, s.fila_type, `#${s.id}`, s.location].filter(Boolean).join(" · ")}
      </div>
    </div>
    <div style={{ textAlign:"right", flexShrink:0 }}>
      <div style={{ fontSize:12.5, fontWeight:900,
        color: late ? "#0EA5E9" : "#f59e0b" }}>
        {s.age_days == null ? "jamais séchée"
          : late ? `+${fmtMonths(-s.remaining_days)} de retard` : `dans ${fmtMonths(s.remaining_days)}`}
      </div>
      <div style={{ fontSize:11, fontWeight:600, color:"var(--muted)" }}>
        {s.age_days != null ? `séchée il y a ${fmtMonths(s.age_days)} · ` : ""}délai {fmtMonths(s.limit_days)}
      </div>
    </div>
  </div>
);
}

function DryingStats() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(null);
  const load = () => client.get("/filaments/drying/overview").then(r => setD(r.data)).catch(() => setD({ error: true }));
  useEffect(() => { load(); }, []);
  if (!d) return <p style={{ color:"var(--muted)", fontSize:13 }}>Chargement…</p>;
  if (d.error) return <p style={{ color:"#ef4444", fontSize:13 }}>Impossible de charger l'état du séchage.</p>;
  const k = d.kpis;
  const maxF = Math.max(1, ...d.families.map(f => f.count));

  const scroll = { padding:"4px 12px", maxHeight:300, overflowY:"auto" };
  const fmtKgs = g => g >= 1000 ? `${String(Math.round(g / 100) / 10).replace(".", ",")} kg` : `${g} g`;
  const loc = d.by_location;
  // Ancienneté : du bleu clair (récent) au bleu profond (ancien), rouge pour « jamais ».
  const AGE_HEX = ["#7dd3fc", "#38bdf8", "#0ea5e9", "#0369a1", "#1e3a8a", "#ef4444"];

  return (<>
    <StatHero color="#06B6D4" icon="💧" label="À sécher maintenant" value={`${k.to_dry} bobine${k.to_dry > 1 ? "s" : ""}`}
      ring={k.active ? (k.ok / k.active) * 100 : null} ringLabel="à jour"
      chips={[k.to_dry_in_ams ? `🎛 ${k.to_dry_in_ams} dans l'AMS` : null, k.soon ? `⏳ ${k.soon} bientôt` : null,
        d.to_dry_weight_g ? `⚖ ${fmtKgs(d.to_dry_weight_g)} concernés` : null]}/>
    <div className="kpi-grid st-kpis" style={{ "--kpi-min":"150px" }}>
      <KpiCard icon={Droplets} label="À sécher" value={k.to_dry} color="#0EA5E9"
        sub={k.to_dry_in_ams ? `dont ${k.to_dry_in_ams} dans l'AMS` : `sur ${k.active} bobines`}/>
      <KpiCard icon={AlertTriangle} label="Jamais séchées" value={k.never} color="#ef4444"/>
      <KpiCard icon={Clock} label={`Bientôt (${d.soon_days} j)`} value={k.soon} color="#f59e0b"/>
      <KpiCard icon={CheckCircle2} label="À jour" value={k.ok} color="#22c55e"/>
      <KpiCard icon={Layers} label="Âge moyen" value={d.avg_age_days == null ? "—" : fmtMonths(d.avg_age_days)}
        sub={d.oldest_age_days != null ? `le plus ancien : ${fmtMonths(d.oldest_age_days)}` : null} color="#8b5cf6"/>
      <KpiCard icon={Weight} label="Filament à sécher" value={fmtKgs(d.to_dry_weight_g || 0)} color="#06b6d4"
        sub="restant sur ces bobines"/>
    </div>

    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:12 }}>
      <Donut title="État des bobines" palette data={[
        { name:"À sécher", value:k.to_dry - k.never, hex:"#0EA5E9" },
        { name:"Jamais séchées", value:k.never, hex:"#ef4444" },
        { name:`Bientôt (${d.soon_days} j)`, value:k.soon, hex:"#f59e0b" },
        { name:"À jour", value:k.ok, hex:"#22c55e" },
      ].filter(x => x.value > 0)}/>
      <Donut title="Ancienneté du dernier séchage" palette
        data={d.buckets.map((b, i) => ({ name:b.label, value:b.count, hex:AGE_HEX[i] })).filter(x => x.value > 0)}/>
    </div>

    <MiniBarChart title="Séchages sur 12 mois (dernier séchage de chaque bobine)" color="#0EA5E9"
      data={d.dried_by_month}/>

    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))", gap:12 }}>
      <Donut title="À sécher : où sont-elles ?" palette data={[
        { name:`Dans l'AMS (${loc.ams.to_dry}/${loc.ams.total})`, value:loc.ams.to_dry, hex:"#0EA5E9" },
        { name:`Rangées (${loc.stored.to_dry}/${loc.stored.total})`, value:loc.stored.to_dry, hex:"#64748b" },
      ].filter(x => x.value > 0)}/>
      <Donut title="Délais appliqués" palette data={d.limits.map((l, i) => ({
        name:`${fmtMonths(l.days)}${l.days === d.default_days ? " (défaut)" : ""}`, value:l.count,
        hex:["#22c55e", "#84cc16", "#f59e0b", "#f97316", "#ef4444", "#8b5cf6"][i % 6] }))}/>
    </div>

    {/* PC : les bobines a secher a gauche, les familles a droite. */}
    <div className="wide-2" style={{ gap:20 }}>
    {(d.to_dry.length > 0 || d.soon.length > 0) && <div style={{ display:"flex", flexDirection:"column", gap:20, minWidth:0 }}>
    {d.to_dry.length > 0 && (
      <Section title={`À sécher maintenant (${d.to_dry.length})`}>
        <div style={{ ...statCard("#0EA5E9"), ...scroll }}>
          {d.to_dry.map(s => <DryRow key={s.id} s={s} late onOpen={setOpen}/>)}
        </div>
      </Section>
    )}

    {d.soon.length > 0 && (
      <Section title={`Bientôt — dans les ${d.soon_days} jours (${d.soon.length})`}>
        <div style={{ ...statCard("#f59e0b"), ...scroll }}>
          {d.soon.map(s => <DryRow key={s.id} s={s} onOpen={setOpen}/>)}
        </div>
      </Section>
    )}
    </div>}

    <Section title="Par famille">
      <div style={{ ...statCard("#22c55e"), ...scroll, padding:"8px 12px" }}>
        {d.families.map(f => (
          <Bar key={f.family} stacked label={f.family} value={f.count} max={maxF}
            color={f.to_dry ? "#0EA5E9" : "#22c55e"}
            sublabel={`${f.to_dry}/${f.count} à sécher · âge moyen ${fmtMonths(f.avg_age_days)}`}/>
        ))}
      </div>
    </Section>
    </div>

    {open && <FilamentSheetFromSpool filamentId={open.filament_id} spoolId={open.id}
      onClose={() => { setOpen(null); load(); }}/>}
  </>);
}

function GlobalBadge() {
  return (
    <span data-tip="Indépendant du filtre de période"
      style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", background: "var(--surface2)", border: "1px solid var(--border)",
        borderRadius: 20, padding: "1px 8px", lineHeight: 1.6 }}>🌐 toutes périodes</span>
  );
}

// L'icone de chaque titre de section (pas de parametre a passer partout : le titre suffit)
const SECTION_ICON = {
  "Impressions": "🖨️", "Moyennes par impression": "➗", "Habitudes d'impression": "🕰️", "Perdu sur les échecs": "💥",
  "Évolution dans le temps": "📈", "Classements": "🏆", "Stock actuel": "📦", "Consommé sur la période": "🧵",
  "Cadence et précision": "🎯", "Fiabilité par filament": "🧪",
  "Répartition de la consommation": "🎨",
  "Inventaire": "🎁", "Ventes": "💶", "Ratios": "➗", "Meilleures marges": "🏅", "Accessoires": "🔩", "Par famille": "🧪",
};
function Section({ title, children, isGlobal, icon }) {
  const ic = icon || SECTION_ICON[title];
  return (
    <section>
      <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 10px", flexWrap: "wrap" }}>
        {ic && <span style={{ fontSize: 17 }}>{ic}</span>}
        <span style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>{title}</span>
        {isGlobal && <GlobalBadge/>}
      </div>
      {children}
    </section>
  );
}

// Une carte de graphique ou de liste : teintee de sa couleur, coins ronds
const statCard = (c = "#3b82f6", extra = {}) => ({ borderRadius: 18, border: `1px solid color-mix(in srgb, ${c} 26%, var(--border))`,
  background: `radial-gradient(90% 70% at 100% 0%, ${c}1c, transparent 70%), var(--surface2)`, boxShadow: `0 8px 22px -18px ${c}`,
  minWidth: 0, ...extra });
const cardTitle = { fontSize: 14, fontWeight: 900, color: "var(--text)", margin: "0 0 12px" };

// delta (28/10/2026) : la tendance par rapport a la periode precedente, voir deltaOf ; rien quand elle est nulle
function KpiCard({ icon: Icon, label, value, sub, color = "#3b82f6", delta = null }) {
  const dc = delta ? (delta.good == null ? "var(--muted)" : delta.good ? "#16a34a" : "#ef4444") : null;
  return (
    <div style={{ ...statCard(color), padding: "11px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
        <span style={{ width: 24, height: 24, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
          background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 60%, #ffffff))`, boxShadow: `0 4px 10px -5px ${color}` }}>
          <Icon size={13} style={{ color: "#fff" }}/>
        </span>
        <span style={{ fontSize: 10.5, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>{label}</span>
        {delta && <span data-tip="Par rapport à la période précédente de même longueur"
          style={{ fontSize: 10.5, fontWeight: 900, color: dc, whiteSpace: "nowrap", flexShrink: 0, padding: "1px 6px", borderRadius: 10,
            background: `color-mix(in srgb, ${dc} 12%, transparent)` }}>{delta.text}</span>}
      </div>
      <p style={{ fontSize: "clamp(17px, 5vw, 21px)", fontWeight: 900, margin: "2px 0 0", lineHeight: 1.2, whiteSpace: "nowrap",
        overflow: "hidden", textOverflow: "ellipsis", ...fGrad(color, `color-mix(in srgb, ${color} 55%, #ffffff)`) }}>{value ?? "—"}</p>
      {sub && <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</p>}
    </div>
  );
}

// L'en-tete d'un onglet : le chiffre qui compte en grand, un anneau (taux), et quelques pastilles
function StatHero({ color, icon, value, label, ring = null, ringLabel = "", chips = [] }) {
  const R = 30, C = 2 * Math.PI * R;
  return (
    <div style={{ ...statCard(color), padding: "16px 16px", display: "flex", alignItems: "center", gap: 14,
      background: `radial-gradient(circle at 12% 30%, ${color}40, transparent 60%), linear-gradient(135deg, ${color}1f, transparent 70%), var(--surface2)` }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color }}>{icon} {label}</span>
        <span style={{ fontSize: "clamp(30px, 10vw, 40px)", fontWeight: 900, lineHeight: 1.1, ...fGrad(color, `color-mix(in srgb, ${color} 55%, #ffffff)`) }}>{value}</span>
        {chips.filter(Boolean).length > 0 && <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 2 }}>
          {chips.filter(Boolean).map((c, i) => <span key={i} style={{ fontSize: 11.5, fontWeight: 800, padding: "3px 9px", borderRadius: 20,
            color: "var(--text2)", background: "color-mix(in srgb, var(--surface) 70%, transparent)", border: "1px solid var(--border)", whiteSpace: "nowrap" }}>{c}</span>)}
        </div>}
      </div>
      {ring != null && <div style={{ position: "relative", width: 84, height: 84, flexShrink: 0 }}>
        <svg width={84} height={84} viewBox="0 0 84 84" style={{ transform: "rotate(-90deg)" }}>
          <circle cx={42} cy={42} r={R} fill="none" stroke="var(--border)" strokeWidth={9}/>
          <circle cx={42} cy={42} r={R} fill="none" stroke="#22c55e" strokeWidth={9} strokeLinecap="round"
            strokeDasharray={`${C * Math.min(1, ring / 100)} ${C}`}/>
        </svg>
        <span style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <b style={{ fontSize: 16, fontWeight: 900, color: "#16a34a" }}>{Math.round(ring)}%</b>
          <span style={{ fontSize: 9.5, fontWeight: 800, color: "var(--muted)" }}>{ringLabel}</span>
        </span>
      </div>}
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
      <div {...handlers} style={{ padding: "8px 6px", borderBottom: "1px dashed var(--border)", ...rowExtra }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 8, marginBottom: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", minWidth: 0,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            display: "flex", alignItems: "center", gap: 6 }}>{dot}{label}</span>
          <span style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text2)",
            flexShrink: 0, whiteSpace: "nowrap" }}>{sublabel}</span>
        </div>
        <div style={{ height: 8, background: "var(--surface2)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 60%, #ffffff))`, borderRadius: 4,
            transition: "width 0.5s ease" }}/>
        </div>
      </div>
    );
  }
  return (
    <div {...handlers} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 6px",
      borderBottom: "1px dashed var(--border)", ...rowExtra }}>
      <div style={{ width: 130, fontSize: 12.5, color: "var(--text)", fontWeight: 800, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
        {dot}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </div>
      <div style={{ flex: 1, height: 8, background: "var(--surface2)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 60%, #ffffff))`, borderRadius: 4,
          transition: "width 0.5s ease" }}/>
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 900, color: "var(--text2)",
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
    <div style={{ ...statCard(colors[tab]), padding: "14px 14px 10px" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {[["count", "Impressions"], ["cost", "Coût"], ["weight", "Filament"], ["duration", "Durée"]]
          // Le graphe laisserait deviner les montants malgre le masquage des
          // valeurs : on retire carrement la serie pour un compte en lecture seule.
          .filter(([id]) => !(id === "cost" && isMoneyHidden()))
          .map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: "5px 12px", borderRadius: 20, fontSize: 12, fontWeight: 800, cursor: "pointer",
              border: tab === id ? "none" : "1px solid var(--border)",
              background: tab === id ? `linear-gradient(135deg, ${colors[id]}, color-mix(in srgb, ${colors[id]} 60%, #ffffff))` : "var(--surface)",
              color: tab === id ? "white" : "var(--muted)", boxShadow: tab === id ? `0 4px 12px -6px ${colors[id]}` : "none" }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 3, alignItems: "stretch", height: 130, overflowX: "auto" }}>
        {keys.map((k, i) => {
          const v = values[i];
          const cnt = data[k].count || 0;
          // Segments "non reussis" empiles depuis le bas (mode count) : echecs,
          // a refaire, partiel. Le reste de la barre = reussites.
          const segs = tab === "count" && cnt > 0
            ? [
                { v: data[k].failed || 0,  c: "#ef4444", lbl: "échec" },
                { v: data[k].to_redo || 0, c: "#8b5cf6", lbl: "à refaire" },
                { v: data[k].partial || 0, c: "#f59e0b", lbl: "partiel" },
              ].filter(s => s.v > 0)
            : [];
          const segTip = segs.map(s => `${s.v} ${s.lbl}${s.v > 1 ? "s" : ""}`).join(", ");
          return (
            <div key={k} title={`${fmtBucketLabel(k, bucket)} — ${unit(v)}${segTip ? ` (${segTip})` : ""}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center",
                flex: "0 0 auto", width: 26, height: "100%" }}>
              {/* Zone barre : c'est ELLE qui doit avoir une hauteur fixe, sinon le
                  pourcentage de la barre se calcule sur une hauteur nulle et tout
                  s'ecrase a 2px -- le bug des barres plates. */}
              <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end",
                minHeight: 0 }}>
                <div style={{ width: "100%", height: `${Math.max(3, (v / max) * 100)}%`,
                  background: `linear-gradient(180deg, color-mix(in srgb, ${colors[tab]} 60%, #ffffff), ${colors[tab]})`, borderRadius: "5px 5px 0 0", minHeight: v > 0 ? 3 : 0,
                  position: "relative", overflow: "hidden", transition: "height 0.4s ease" }}>
                  {(() => { let acc = 0; return segs.map((s, si) => {
                    const h = (s.v / cnt) * 100; const bottom = acc; acc += h;
                    return <div key={si} style={{ position: "absolute", left: 0, right: 0,
                      bottom: `${bottom}%`, height: `${h}%`, background: s.c, opacity: 0.82 }}/>;
                  }); })()}
                </div>
              </div>
              <span style={{ fontSize: 8.5, fontWeight: 700, color: "var(--muted)", transform: "rotate(-45deg)",
                transformOrigin: "top center", whiteSpace: "nowrap", marginTop: 8, flexShrink: 0 }}>
                {fmtBucketLabel(k, bucket)}
              </span>
            </div>
          );
        })}
      </div>
      {tab === "count" && (
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", flexWrap: "wrap",
          fontSize: 11, fontWeight: 700, color: "var(--muted)", margin: "10px 0 0" }}>
          {[["#ef4444", "échecs"], ["#8b5cf6", "à refaire"], ["#f59e0b", "partiel"]].map(([c, l]) => (
            <span key={l} style={{ display: "inline-flex", alignItems: "center" }}>
              <span style={{ display: "inline-block", width: 8, height: 8, background: c,
                opacity: 0.82, borderRadius: 2, marginRight: 4 }}/>{l}
            </span>
          ))}
        </div>
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
    <div style={{ ...statCard(slices[0]?.color && !/^#f[0-9a-f]{5}$/i.test(slices[0].color) ? slices[0].color : "#8B5CF6"), padding: 14 }}>
      <p style={cardTitle}>{title}</p>
      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <svg width={120} height={120} viewBox="0 0 120 120">
          {single
            ? <circle cx={cx} cy={cy} r={r} fill={slices[0].color}/>
            : slices.map((s, i) => <path key={i} d={s.path} fill={s.color} stroke="var(--surface2)" strokeWidth={2}/>)}
          {/* un liseré : une part blanche reste visible */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(148,163,184,.35)" strokeWidth={1}/>
          <circle cx={cx} cy={cy} r={26} fill="var(--surface2)"/>
        </svg>
        {/* la legende reste pres de l'anneau : sur une carte large, les pourcentages ne partent plus au bout */}
        <div style={{ flex: 1, minWidth: 140, maxWidth: 340, display: "flex", flexDirection: "column", gap: 5 }}>
          {slices.map((s, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 11, height: 11, borderRadius: "50%", background: s.color, flexShrink: 0, boxShadow: "inset 0 0 0 1px rgba(148,163,184,.5)" }}/>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", flex: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 900, color: "var(--muted)" }}>{s.pct}%</span>
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
    <div style={{ ...statCard(color), padding: "14px 14px" }}>
      <p style={cardTitle}>{title}</p>
      <div style={{ display: "flex", gap: 3, alignItems: "stretch", height: 96 }}>
        {data.map((d, i) => {
          const lab = labelKey === "hour" ? String(d.hour).padStart(2, "0") : d[labelKey];
          return (
            <div key={i} title={`${lab}${suffix} — ${d.value}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", minWidth: 0 }}>
              <div style={{ flex: 1, width: "100%", display: "flex", alignItems: "flex-end", minHeight: 0 }}>
                <div style={{ width: "100%", height: `${Math.max(2, (d.value / max) * 100)}%`,
                  background: `linear-gradient(180deg, color-mix(in srgb, ${color} 60%, #ffffff), ${color})`, borderRadius: "4px 4px 0 0",
                  opacity: d.value === max ? 1 : 0.5, transition: "height 0.4s ease" }}/>
              </div>
              <span style={{ fontSize: 9, fontWeight: 700, color: d.value === max ? color : "var(--muted)", marginTop: 5,
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
    <div style={{ ...statCard(barColor), padding: "14px 14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, gap: 8 }}>
        <p style={{ ...cardTitle, margin: 0 }}>{title}</p>
        <div style={{ display: "flex", gap: 2, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, padding: 2 }}>
          {[["prints", "Prints"], ["groups", "Groupes"]].map(([id, label]) => {
            const disabled = id === "groups" && !hasGroups;
            return (
              <button key={id} disabled={disabled} onClick={() => !disabled && setMode(id)}
                style={{ padding: "4px 11px", borderRadius: 18, fontSize: 11.5, fontWeight: 800,
                  cursor: disabled ? "default" : "pointer", border: "none",
                  background: mode === id ? `linear-gradient(135deg, ${barColor}, color-mix(in srgb, ${barColor} 60%, #ffffff))` : "transparent",
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
              <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 800, flex: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {mode === "groups" && item.nb > 1 &&
                  <span style={{ fontSize: 9, color: "var(--muted)", marginRight: 4 }}>×{item.nb}</span>}
                {item.name}
              </span>
              <span style={{ fontSize: 13, color: barColor, fontWeight: 900, flexShrink: 0 }}>
                {valueLabel(item)}
              </span>
            </div>
            <div style={{ height: 6, background: "color-mix(in srgb, var(--surface) 70%, transparent)", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${Math.max(2, (Number(item[valueKey]) || 0) / max * 100)}%`, height: "100%",
                borderRadius: 2, background: i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : i === 2 ? "#cd7f32" : barColor }}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Fiabilite par matiere (28/10/2026) : une barre empilee ok (vert) / ko (rouge) par matiere,
// « 92 % · 48 g gâchés » a droite. Les partielles et a-refaire font partie du total, ni vertes ni rouges.
function ReliabilityByMaterial({ rows }) {
  if (!rows?.length) return null;
  const max = Math.max(...rows.map(r => r.total), 1);
  return (
    <div style={{ ...statCard("#22c55e"), padding: "14px 14px" }}>
      <p style={cardTitle}>Par matière</p>
      {rows.map(r => (
        <div key={r.name} style={{ padding: "8px 6px", borderBottom: "1px dashed var(--border)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {r.name} <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>· {r.total} impression{r.total > 1 ? "s" : ""}</span>
            </span>
            <span style={{ fontSize: 12.5, fontWeight: 900, color: r.ko ? "#ef4444" : "#16a34a", flexShrink: 0, whiteSpace: "nowrap" }}>
              {fr1(r.rate)} %{r.wasted_g > 0 ? ` · ${r.wasted_g} g gâchés` : ""}
            </span>
          </div>
          <div style={{ height: 8, background: "var(--surface2)", borderRadius: 4, overflow: "hidden", display: "flex", width: `${Math.max(4, r.total / max * 100)}%` }}
            title={`${r.ok} réussie${r.ok > 1 ? "s" : ""}, ${r.ko} échec${r.ko > 1 ? "s" : ""} sur ${r.total}`}>
            <div style={{ width: `${r.ok / r.total * 100}%`, background: "linear-gradient(90deg, #22c55e, #4ade80)", transition: "width .5s ease" }}/>
            <div style={{ width: `${(r.total - r.ok - r.ko) / r.total * 100}%`, background: "#f59e0b", opacity: .7 }}/>
            <div style={{ width: `${r.ko / r.total * 100}%`, background: "linear-gradient(90deg, #ef4444, #f87171)", transition: "width .5s ease" }}/>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Filaments qui ratent le plus (28/10/2026) : pastille, nom, taux d'echec, ko/total ; touche -> fiche filament
function WorstFilaments({ rows, onOpen }) {
  if (!rows?.length) return null;
  return (
    <div style={{ ...statCard("#ef4444"), padding: "14px 14px" }}>
      <p style={cardTitle}>Filaments qui ratent le plus</p>
      {rows.map(f => (
        <div key={f.id} onClick={() => onOpen(f.id)} role="button" tabIndex={0}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", cursor: "pointer", borderBottom: "1px dashed var(--border)" }}>
          <Dot hex={f.color} colors={f.colors_array} multicolor={f.multicolor_type} finish={finishOf(f)} size={14}/>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {[f.brand, f.fila_type, f.wasted_g > 0 ? `${f.wasted_g} g gâchés` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 900, color: "#ef4444" }}>{fr1(f.fail_rate)} % d'échec</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{f.ko} sur {f.total}</div>
          </div>
        </div>
      ))}
      <p style={{ fontSize: 10, color: "var(--muted)", margin: "8px 0 0" }}>Filaments d'au moins 3 impressions sur la période. Touche une ligne pour ouvrir la fiche.</p>
    </div>
  );
}

// Les onglets de la page : cinq, chacun sa couleur ; sur petit ecran, les inactifs n'ont que leur icone
function StatTabs({ tabs, tab, setTab }) {
  return (
    <div style={{ display: "flex", gap: 4, background: "var(--surface2)", borderRadius: 16, padding: 4, border: "1px solid var(--border)" }}>
      {tabs.map(t => {
        const on = tab === t.id;
        return (
          <button key={t.id} onClick={() => setTab(t.id)} aria-label={t.label} data-tip={t.label}
            style={{ flex: on ? "1 1 auto" : "1 1 0", minWidth: 0, padding: "8px 6px", borderRadius: 12, fontWeight: 800, cursor: "pointer",
              fontSize: "clamp(11px, 3.3vw, 13px)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", border: "none",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.15s",
              background: on ? `linear-gradient(135deg, ${t.c}, color-mix(in srgb, ${t.c} 70%, #ffffff))` : "transparent",
              color: on ? "white" : "var(--muted)", boxShadow: on ? `0 6px 16px -6px ${t.c}` : "none" }}>
            <span style={{ fontSize: 15, filter: on ? "none" : "grayscale(.4)" }}>{t.ic}</span>
            <span className={on ? "" : "st-tab-l"}>{t.label}</span></button>);
      })}
      <style>{`@media (max-width: 520px) { .st-tab-l { display: none; } }`}</style>
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
  useTrackDetail("Filtre de période");
  const [from, setFrom] = React.useState(value.from || "");
  const [to, setTo] = React.useState(value.to || "");
  const applyCustom = () => {
    if (!from && !to) { onApply({ from: null, to: null, label: "Tout" }); return; }
    const label = from && to ? `${from} → ${to}` : from ? `Depuis ${from}` : `Jusqu'au ${to}`;
    onApply({ from: from || null, to: to || null, label });
  };
  const inputStyle = { width: "100%", marginTop: 5, padding: "10px 12px", borderRadius: 12, boxSizing: "border-box",
    border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 14, fontWeight: 700 };
  return (
    <FSheet onClose={onClose} z={1000} bottom={<button onClick={applyCustom} style={{ ...fBtn, flex: 1, border: "none", color: "#fff",
      background: "linear-gradient(135deg, #3B82F6, #6366F1)", boxShadow: "0 8px 18px -10px #3B82F6" }}>✓ Appliquer la plage</button>}>
      <div style={{ padding: "52px 18px 14px", background: "radial-gradient(circle at 15% 40%, rgba(59,130,246,0.32), transparent 60%), var(--surface2)" }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#3b82f6" }}>📅 Période</div>
        <div style={{ fontSize: 22, fontWeight: 900, color: "var(--text)", lineHeight: 1.15 }}>{value.label}</div>
      </div>
      <div style={{ padding: "14px 16px 18px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 8, marginBottom: 18 }}>
          {PRESETS.map(([k, lbl]) => {
            const active = value.label === lbl;
            return (
              <button key={k} onClick={() => onApply(presetRange(k))} style={{ padding: "11px 12px",
                borderRadius: 14, fontSize: 13.5, fontWeight: 800, cursor: "pointer", border: active ? "none" : "1px solid var(--border)",
                background: active ? "linear-gradient(135deg, #3B82F6, #6366F1)" : "var(--surface)", color: active ? "#fff" : "var(--text)",
                boxShadow: active ? "0 6px 14px -8px #3B82F6" : "none" }}>
                {lbl}
              </button>
            );
          })}
        </div>
        <p style={{ fontSize: 13, fontWeight: 900, color: "var(--text)", margin: "0 0 8px" }}>Plage personnalisée</p>
        <div style={{ display: "flex", gap: 10 }}>
          <label style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>Début
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} style={inputStyle}/>
          </label>
          <label style={{ flex: 1, minWidth: 0, fontSize: 12, fontWeight: 800, color: "var(--muted)" }}>Fin
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} style={inputStyle}/>
          </label>
        </div>
      </div>
    </FSheet>
  );
}

export default function Stats() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [period, setPeriod] = useState({ from: null, to: null, label: "Tout" });
  const [filterOpen, setFilterOpen] = useState(false);
  const [detail, setDetail] = useState(null);
  const [groupPrints, setGroupPrints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useUrlTab("tab", "prints", ["prints", "filaments", "drying", "objects", "achievements"]);
  useTrackDetail(`Stats · ${ {prints:"Prints", filaments:"Filaments",
    objects:"Objets"}[tab] || tab }`);
  const [objStats, setObjStats] = useState(null);
  const [objDetail, setObjDetail] = useState(null);
  const [accId, setAccId] = useState(null);

  useEffect(() => {
    setLoading(true);
    client.get("/prints/stats/summary", { params: { date_from: period.from || undefined, date_to: period.to || undefined } })
      .then(r => { setData(r.data); setError(null); if (r.data?.previous?.total_prints > 0) egg("retroviseur"); })
      .catch(e => setError(e.response?.data?.detail || e.message || "Erreur"))
      .finally(() => setLoading(false));
  }, [period]);

  // Stats objets : les VENTES suivent la periode (sold_date), l'inventaire reste global.
  const loadObjects = React.useCallback(() => {
    client.get("/objects/objects/stats", { params: { date_from: period.from || undefined, date_to: period.to || undefined } })
      .then(r => setObjStats(r.data))
      .catch(() => setObjStats(null));
  }, [period]);
  // les stats objets : lues a l'ouverture de leur onglet (28/10/2026 : au montage et a chaque periode, meme ailleurs)
  const objWanted = useRef(false);
  if (tab === "objects") objWanted.current = true;
  useEffect(() => { if (objWanted.current) loadObjects(); }, [loadObjects, tab]);

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
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 20,
        border: period.from || period.to ? "none" : "1px solid var(--border)",
        background: period.from || period.to ? "linear-gradient(135deg, #3B82F6, #6366F1)" : "var(--surface2)",
        color: period.from || period.to ? "#fff" : "var(--text)",
        fontSize: 12.5, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}>
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
          onApply={(r) => { setPeriod(p => p.from === r.from && p.to === r.to ? p : r); setFilterOpen(false); }}
          onClose={() => setFilterOpen(false)}/>
      )}
    </>
  );

  // « Chargement… » plein ecran seulement sans donnees : un changement de periode garde la page, a peine estompee
  // (28/10/2026 : les onglets Sechage et Succes etaient demontes et refaisaient leurs appels a chaque periode)
  if (loading && !data) return (
    <div className="page-wide" style={{ gap: 20 }}>
      {header}
      <p style={{ textAlign: "center", color: "var(--muted)", padding: 60 }}>Chargement…</p>
    </div>
  );

  if (error) return (
    <div className="page-wide" style={{ gap: 20 }}>
      {header}
      <div style={{ padding: "12px 16px", background: "rgba(239,68,68,0.1)",
        border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, color: "#ef4444", fontSize: 13 }}>
        ⚠ {error}
      </div>
    </div>
  );

  const tabs = [{ id:"prints", label:"Prints", ic:"🖨️", c:"#3B82F6" }, { id:"filaments", label:"Filaments", ic:"🧵", c:"#F97316" },
    { id:"drying", label:"Séchage", ic:"💧", c:"#06B6D4" }, { id:"objects", label:"Objets", ic:"🎁", c:"#8B5CF6" },
    { id:"achievements", label:"Succès", ic:"🏆", c:"#F59E0B" }];

  return (
    <div className="page-wide" style={{ gap: 20, opacity: loading ? 0.6 : 1, transition: "opacity .2s" }}>
      {header}

      {/* Onglets : chacun sa couleur ; l'icone seule sur les inactifs quand la place manque */}
      <StatTabs tabs={tabs} tab={tab} setTab={setTab}/>
      <style>{`@media (max-width: 600px) { .st-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        .st-kpis > :last-child:nth-child(odd) { grid-column: 1 / -1; } }`}</style>

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
      <StatHero color="#3B82F6" icon="🖨️" label={`Impressions · ${period.label.toLowerCase()}`} value={data.total_prints}
        ring={data.success_rate} ringLabel="réussite"
        chips={[`⏱ ${fmtH(data.total_hours * 3600)}`, `⚖ ${fmtKg(data.total_weight_g)}`, !isMoneyHidden() && `💶 ${fmtEur(data.total_cost)}`]}/>
      {/* Tendances (28/10/2026) : fleche par rapport a la periode precedente de meme longueur ; rien en mode « Tout » */}
      <Section title="Impressions">
        <div className="kpi-grid st-kpis">
          <KpiCard icon={Layers} label="Terminées" value={data.total_prints} color="#3b82f6"
            sub={`${data.failed_prints} échec${data.failed_prints > 1 ? "s" : ""}`}
            delta={deltaOf(data.total_prints, data.previous?.total_prints)}/>
          <KpiCard icon={CheckCircle2} label="Taux de réussite" value={`${data.success_rate} %`} color="#22c55e"
            sub={`${data.success_prints} réussies`}
            delta={data.previous?.total_prints > 0 ? deltaOf(data.success_rate, data.previous.success_rate, { pts: true }) : null}/>
          <KpiCard icon={Clock} label="Temps total" value={fmtH(data.total_hours * 3600)} color="#f59e0b"
            sub={data.avg_duration_h > 0 ? `moy. ${fmtH(data.avg_duration_h * 3600)}` : null}
            delta={deltaOf(data.total_hours, data.previous?.total_hours)}/>
          <KpiCard icon={Weight} label="Filament" value={fmtKg(data.total_weight_g)} color="#8b5cf6"
            sub={data.avg_weight_g > 0 ? `moy. ${data.avg_weight_g} g` : null}
            delta={deltaOf(data.total_weight_g, data.previous?.total_weight_g)}/>
          <KpiCard icon={Euro} label="Coût total" value={fmtEur(data.total_cost)} color="#ef4444"
            sub={data.avg_cost > 0 ? `moy. ${fmtEur(data.avg_cost)}` : null}
            delta={isMoneyHidden() ? null : deltaOf(data.total_cost, data.previous?.total_cost, { invert: true })}/>
        </div>
        {data.previous && data.previous.total_prints > 0 && (
          <p style={{ fontSize: 10, color: "var(--muted)", margin: "8px 0 0" }}>
            Flèches : par rapport à la période précédente ({data.previous.from} → {data.previous.to}, {data.previous.total_prints} impression{data.previous.total_prints > 1 ? "s" : ""}).
          </p>
        )}
      </Section>

      <Section title="Moyennes par impression">
        <div className="kpi-grid st-kpis">
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

      {/* Cadence et precision (28/10/2026) : l'imprimante tourne-t-elle, a quel rythme, et le trancheur dit-il vrai */}
      {data.period_days > 0 && (
        <Section title="Cadence et précision">
          <div className="kpi-grid st-kpis">
            <KpiCard icon={Gauge} label="Occupation" value={`${fr1(data.occupation_pct)} %`} color="#06b6d4"
              sub={`${Math.round(data.total_hours)} h sur ${Math.round(data.period_days)} j`}/>
            <KpiCard icon={Activity} label="Cadence" value={`${fr1(data.cadence_per_week)} / semaine`} color="#3b82f6"
              sub={`${data.total_prints} impression${data.total_prints > 1 ? "s" : ""} en ${Math.round(data.period_days)} j`}/>
            {data.median_gap_s != null && (
              <KpiCard icon={Timer} label="Entre deux lancements" value={fmtGap(data.median_gap_s)} color="#8b5cf6" sub="écart médian"/>
            )}
            {data.estimate_gap_pct != null && (
              <KpiCard icon={Target} label="Écart estimation"
                value={`${data.estimate_gap_pct > 0 ? "+" : data.estimate_gap_pct < 0 ? "−" : ""}${fr1(Math.abs(data.estimate_gap_pct))} %`}
                color={Math.abs(data.estimate_gap_pct) <= 5 ? "#22c55e" : Math.abs(data.estimate_gap_pct) <= 15 ? "#f59e0b" : "#ef4444"}
                sub={`réel ${Math.round(data.estimate_real_h)} h · estimé ${Math.round(data.estimate_est_h)} h`}/>
            )}
            {data.paused_hours > 0 && (
              <KpiCard icon={PauseCircle} label="En pause" value={fmtH(data.paused_hours * 3600)} color="#f97316"
                sub="bobine vide, erreur, pause manuelle"/>
            )}
          </div>
        </Section>
      )}

      {/* Habitudes : quand imprimes-tu ? */}
      {(data.by_weekday || data.by_hour) && (
        <Section title="Habitudes d'impression">
          <div className="kpi-grid st-kpis" style={{ marginBottom: 12 }}>
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
          <div className="kpi-grid" style={{ "--kpi-min": "280px", gap: 12 }}>
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
          <div className="kpi-grid st-kpis">
            <KpiCard icon={AlertTriangle} label="Échecs" value={data.failed_prints} color="#ef4444"/>
            <KpiCard icon={Weight} label="Filament" value={fmtKg(data.failed_weight_g)} color="#ef4444"/>
            <KpiCard icon={Euro} label="Coût" value={fmtEur(data.failed_cost)} color="#ef4444"/>
            <KpiCard icon={Clock} label="Temps" value={fmtH(data.failed_hours * 3600)} color="#ef4444"/>
          </div>
        </Section>
      )}

      {/* Fiabilite par matiere et par filament (28/10/2026) : une carte par ligne sur telephone */}
      {((data.reliability_by_material || []).length > 0 || (data.worst_filaments || []).length > 0) && (
        <Section title="Fiabilité par filament">
          <div className="kpi-grid" style={{ "--kpi-min": "280px", gap: 12 }}>
            <ReliabilityByMaterial rows={data.reliability_by_material}/>
            <WorstFilaments rows={data.worst_filaments} onOpen={id => navigate(`/filaments?id=${id}`)}/>
          </div>
        </Section>
      )}

      {Object.keys(data.timeline || data.monthly || {}).length > 0 && (
        <Section title="Évolution dans le temps">
          <TimeChart data={data.timeline || data.monthly} bucket={data.timeline_bucket || "month"}/>
        </Section>
      )}

      <Section title="Classements">
        <div className="kpi-grid" style={{ "--kpi-min": "280px", gap: 12 }}>
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
          <TopList title="🎨 Le plus de couleurs" barColor="#ec4899"
            prints={data.top_colors} groups={data.top_groups_colors}
            valueKey="n_colors" valueLabel={p => `${p.n_colors} couleurs`}
            onItemClick={openDetail}/>
        </div>
      </Section>

      </>))}

      {tab === "filaments" && (<>
      <StatHero color="#F97316" icon="🧵" label={`Consommé · ${period.label.toLowerCase()}`} value={fmtKg(data.total_weight_g)}
        chips={[!isMoneyHidden() && `💶 ${fmtEur(data.total_cost)}`, (data.materials || []).length > 0 && `🧪 ${data.materials.length} matériau${data.materials.length > 1 ? "x" : ""}`,
          data.stock?.spools > 0 && `📦 ${data.stock.spools} bobines en stock`]}/>
      {/* KPIs stock en tete */}
      <Section title="Stock actuel" isGlobal>
        <div className="kpi-grid st-kpis">
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
        <div className="kpi-grid st-kpis">
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
          <div className="kpi-grid" style={{ "--kpi-min": "280px", gap: 12 }}>
            {matData.length > 0 && <Donut data={matData} title="Par matériau"/>}
            {colorData.length > 0 && <Donut data={colorData} title="Par teinte" palette/>}

            {typeData.length > 0 && (
              <div style={{ ...statCard("#06b6d4"), padding: "14px 14px" }}>
                <p style={cardTitle}>Par type</p>
                {typeData.map(t => (
                  <Bar key={t.name} label={t.name} value={t.value} max={typeData[0].value}
                    sublabel={fmtKg(t.value)} color="#06b6d4"/>
                ))}
              </div>
            )}

            {brandData.length > 0 && (
              <div style={{ ...statCard("#8b5cf6"), padding: "14px 14px" }}>
                <p style={cardTitle}>Par marque</p>
                {brandData.map(b => (
                  <Bar key={b.name} label={b.name} value={b.value} max={brandData[0].value}
                    sublabel={fmtKg(b.value)} color="#8b5cf6"/>
                ))}
              </div>
            )}

            {(data.top_filaments || []).length > 0 && (
              <div style={{ ...statCard("#3b82f6"), padding: "14px 14px" }}>
                <p style={cardTitle}>
                  Filaments les plus utilisés
                </p>
                {data.top_filaments.map(f => (
                  <Bar key={f.id} label={f.name}
                    value={f.grams} max={data.top_filaments[0].grams}
                    sublabel={`${f.grams} g`} color="#3b82f6"
                    dot={<Dot hex={f.color} colors={f.colors_array} multicolor={f.multicolor_type} finish={finishOf(f)} size={10}/>}/>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      </>)}

      {tab === "drying" && <DryingStats/>}

      {tab === "achievements" && <React.Suspense fallback={null}><Achievements embedded/></React.Suspense>}

      {tab === "objects" && (
        <ObjectsStats stats={objStats} onOpen={openDetail} onOpenObject={openObject} onOpenAccessory={openAccessory}/>
      )}
      <HiddenMark egg="lost_sock" e="🧦" side="right"/>
      <Cachettes spot="stats"/>
    </div>
  );
}
