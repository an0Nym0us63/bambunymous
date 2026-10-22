import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, BarChart3, ListChecks, History, Package, Flame, Droplets, Coins, Star, Users, Trophy,
         Dices, ChevronRight, Camera } from "lucide-react";
import client, { apiUrl } from "../api/client";
import { mwImg } from "./MwImg";
import { Medal, gradeOf, GradeEmblem, CARD_ORDER } from "../pages/Achievements";

// Les tuiles de l'accueil (22/10/2026). Chaque tuile est une « .card » et ses
// morceaux (mots, chiffres, pastilles, vignettes) portent data-pk : les effets
// de l'accueil peuvent les faire bouger un par un.

const ymd = d => d.toLocaleDateString("sv");
const hexCss = h => { const s = String(h || "").replace("#", ""); return s.length >= 6 ? `#${s.slice(0, 6)}` : "#888"; };
const fmtH = s => { const h = (s || 0) / 3600; return h >= 10 ? `${Math.round(h)} h` : `${h.toFixed(1).replace(".", ",")} h`; };
const fmtG = g => (g || 0) >= 1000 ? `${((g || 0) / 1000).toFixed(1).replace(".", ",")} kg` : `${Math.round(g || 0)} g`;
const fmtDur = s => { const m = Math.round((s || 0) / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; };

function W({ text }) {
  return String(text ?? "").split(/(\s+)/).map((p, i) => /\s/.test(p) || !p ? p : <span key={i} data-pk="">{p}</span>);
}

// Le gabarit commun : une pastille d'icone a la couleur de la tuile, le titre, le contenu
function Tile({ icon, color, label, onClick, wide, children }) {
  return (
    <div className="card" role={onClick ? "button" : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick}
      onKeyDown={e => { if (onClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onClick(); } }}
      style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0, cursor: onClick ? "pointer" : "default",
        gridColumn: wide ? "1 / -1" : undefined, position: "relative", overflow: "hidden" }}>
      <span aria-hidden="true" style={{ position: "absolute", right: -24, top: -24, width: 80, height: 80, borderRadius: "50%",
        background: `${color}22`, pointerEvents: "none" }}/>
      <div style={{ display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
        <span data-pk="" style={{ width: 26, height: 26, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
          background: `${color}22`, color, flexShrink: 0 }}>{icon}</span>
        <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text2)", letterSpacing: ".02em" }}><W text={label}/></span>
        {onClick && <ChevronRight size={14} style={{ marginLeft: "auto", color: "var(--muted)" }}/>}
      </div>
      <div style={{ position: "relative", minWidth: 0 }}>{children}</div>
    </div>
  );
}
const Big = ({ children, color = "var(--text)" }) =>
  <div data-pk="" style={{ fontSize: "clamp(19px, 5.4vw, 24px)", fontWeight: 900, color, lineHeight: 1.05, letterSpacing: "-.01em" }}>{children}</div>;
const Sub = ({ children }) =>
  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</div>;
const Line = ({ children }) =>
  <div style={{ fontSize: 12.5, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{children}</div>;

// ── donnees ──────────────────────────────────────────────────────────────────
function useTilesData() {
  const [d, setD] = useState({});
  useEffect(() => {
    let dead = false;
    const put = (k, p) => p.then(r => { if (!dead) setD(x => ({ ...x, [k]: r })); }).catch(() => { if (!dead) setD(x => ({ ...x, [k]: null })); });
    const get = (url, params) => client.get(url, { params }).then(r => r.data);
    const load = () => {
      const now = new Date(), t = ymd(now);
      put("today", Promise.all([get("/prints/kpis", { date_from: t }), get("/prints/kpis", { date_from: t, status: "SUCCESS" })])
        .then(([all, ok]) => ({ ...all, ok: ok.count })));
      const days = [...Array(7)].map((_, i) => { const x = new Date(now); x.setDate(now.getDate() - 6 + i); return x; });
      put("week", Promise.all(days.map(x => get("/prints/kpis", { date_from: ymd(x), date_to: ymd(x) })))
        .then(rs => rs.map((r, i) => ({ day: days[i], ...r }))));
      put("last", get("/prints", { limit: 3 }).then(r => (r.prints || r.items || []).find(p => p.status !== "IN_PROGRESS") || null));
      put("spools", get("/filaments/spools", { archived: false }));
      put("dry", get("/filaments/drying/overview"));
      put("friends", get("/friends/shared/printing"));
      put("ach", get("/achievements"));
    };
    load();
    put("queue", get("/makerworld/queue"));
    put("mw", get("/makerworld/creator"));
    put("rate", get("/makerworld/to-rate"));
    const iv = setInterval(load, 120000);
    return () => { dead = true; clearInterval(iv); };
  }, []);
  return d;
}

// ── les tuiles ───────────────────────────────────────────────────────────────
function Today({ v }) {
  const rate = v?.count ? Math.round(100 * v.ok / v.count) : null;
  return (
    <Tile icon={<CalendarClock size={15}/>} color="#3B82F6" label="Aujourd'hui">
      <div style={{ display: "flex", alignItems: "baseline", gap: "4px 6px", flexWrap: "wrap" }}>
        <Big>{v ? v.count : "…"}</Big>
        <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 700 }}>impression{v?.count > 1 ? "s" : ""}</span>
        {rate != null && <span data-pk="" style={{ marginLeft: "auto", whiteSpace: "nowrap", fontSize: 11.5, fontWeight: 800, padding: "2px 8px", borderRadius: 20,
          color: rate >= 90 ? "#16a34a" : rate >= 70 ? "#d97706" : "#dc2626",
          background: rate >= 90 ? "rgba(34,197,94,0.14)" : rate >= 70 ? "rgba(245,158,11,0.14)" : "rgba(239,68,68,0.14)" }}>{rate} % ok</span>}
      </div>
      {v && <Sub><W text={`${fmtG(v.weight_g)} · ${fmtH(v.duration)} de machine`}/></Sub>}
    </Tile>
  );
}
function Week({ v }) {
  const max = Math.max(1, ...(v || []).map(x => x.duration || 0));
  const tot = (v || []).reduce((a, x) => ({ c: a.c + (x.count || 0), s: a.s + (x.duration || 0) }), { c: 0, s: 0 });
  const today = ymd(new Date());
  return (
    <Tile icon={<BarChart3 size={15}/>} color="#8B5CF6" label="7 derniers jours">
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <Big>{v ? fmtH(tot.s) : "…"}</Big>
      </div>
      {v && <Sub>{tot.c} impression{tot.c > 1 ? "s" : ""}</Sub>}
      {v && (
        <div style={{ display: "flex", gap: 5, alignItems: "flex-end", height: 44, marginTop: 8 }}>
          {v.map(x => {
            const on = ymd(x.day) === today;
            return (
              <div key={ymd(x.day)} title={`${x.day.toLocaleDateString("fr-FR", { weekday: "long" })} · ${fmtH(x.duration)} · ${x.count}`}
                style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <span data-pk="" style={{ width: "100%", maxWidth: 22, borderRadius: 5, minHeight: 3,
                  height: `${Math.round(32 * (x.duration || 0) / max)}px`, background: on ? "#8B5CF6" : "rgba(139,92,246,0.35)" }}/>
                <span style={{ fontSize: 10, color: on ? "var(--text)" : "var(--muted)", fontWeight: on ? 800 : 600 }}>
                  {x.day.toLocaleDateString("fr-FR", { weekday: "narrow" })}</span>
              </div>
            );
          })}
        </div>
      )}
    </Tile>
  );
}
function Next({ q }) {
  const nav = useNavigate();
  const models = q?.models || [];
  const ready = models.filter(m => m.status === "ready");
  const m = ready[0] || models[0];
  return (
    <Tile icon={<ListChecks size={15}/>} color="#22C55E" label="Prochaine impression" onClick={() => nav("/prints?tab=queue")}>
      {!m ? <Line><W text={q === undefined ? "…" : "Rien dans « À faire »"}/></Line> : (
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {m.cover_url ? <img data-pk="" src={mwImg(m.cover_url, 120)} alt="" style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}/>
            : <span data-pk="" style={{ width: 52, height: 52, borderRadius: 10, background: "var(--surface2)", flexShrink: 0 }}/>}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              <W text={m.title_fr || m.title}/></div>
            <Sub>{m.status === "ready" ? <span style={{ color: "#16a34a", fontWeight: 800 }}>prêt dans l'AMS</span> : "à préparer"}
              {m.seconds ? ` · ${fmtDur(m.seconds)}` : ""}{models.length > 1 ? ` · ${models.length} en file` : ""}</Sub>
          </div>
        </div>
      )}
    </Tile>
  );
}
function Last({ p }) {
  const nav = useNavigate();
  if (!p) return null;
  const ok = p.status === "SUCCESS" || p.status === "PARTIAL";
  return (
    <Tile icon={<History size={15}/>} color="#0EA5E9" label="Dernière impression" onClick={() => nav(`/prints?id=${p.id}`)}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <img data-pk="" src={apiUrl(`/prints/${p.id}/image`)} alt="" onError={e => { e.currentTarget.style.display = "none"; }}
          style={{ width: 52, height: 52, borderRadius: 10, objectFit: "cover", flexShrink: 0, background: "var(--surface2)" }}/>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <W text={p.file_name || p.translated_name || `Impression #${p.id}`}/></div>
          <Sub><span style={{ color: ok ? "#16a34a" : "#dc2626", fontWeight: 800 }}>{ok ? "réussie" : "ratée"}</span>
            {p.duration_seconds ? ` · ${fmtDur(p.duration_seconds)}` : ""}{p.total_weight_g ? ` · ${fmtG(p.total_weight_g)}` : ""}</Sub>
        </div>
        {!p.cover_photo && <span data-pk="" title="Pas encore de photo" style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11,
          fontWeight: 800, color: "#0EA5E9", padding: "4px 8px", borderRadius: 20, background: "rgba(14,165,233,0.12)" }}><Camera size={12}/>photo</span>}
      </div>
    </Tile>
  );
}
function Stock({ s }) {
  const nav = useNavigate();
  const list = Array.isArray(s) ? s : [];
  const kg = list.reduce((a, x) => a + (x.remaining_weight_g || 0), 0);
  const low = list.filter(x => x.remaining_weight_g != null).sort((a, b) => a.remaining_weight_g - b.remaining_weight_g).slice(0, 2);
  return (
    <Tile icon={<Package size={15}/>} color="#F59E0B" label="Stock" onClick={() => nav("/filaments")}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <Big>{s === undefined ? "…" : list.length}</Big>
        <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 700 }}>bobines · {fmtG(kg)}</span>
      </div>
      {low.map(x => (
        <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5, fontSize: 12, color: "var(--text2)" }}>
          <span data-pk="" style={{ width: 10, height: 10, borderRadius: "50%", background: hexCss(x.filament_color), flexShrink: 0,
            border: "1px solid var(--border)" }}/>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            <W text={x.filament_translated_name || x.filament_name}/></span>
          <span data-pk="" style={{ fontWeight: 800, color: "#d97706" }}>{Math.round(x.remaining_weight_g)} g</span>
        </div>
      ))}
    </Tile>
  );
}
function Dry({ v, status }) {
  const nav = useNavigate();
  const drying = (status?.ams_list || []).filter(a => a.is_drying && a.dry_time > 0);
  const next = v?.to_dry?.[0];
  return (
    <Tile icon={<Flame size={15}/>} color="#EF4444" label="Séchage" onClick={() => nav("/stats?tab=drying")}>
      {drying.length ? drying.map(a => (
        <Line key={a.id}><b style={{ color: "var(--text)" }}>{a.id >= 128 ? `HT-${String.fromCharCode(65 + a.id - 128)}` : `AMS-${String.fromCharCode(65 + a.id)}`}</b>
          {" "}sèche{a.dry_filament ? ` du ${a.dry_filament}` : ""} · encore {fmtDur(a.dry_time)}{a.dry_temperature ? ` à ${a.dry_temperature} °C` : ""}</Line>
      )) : <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <Big color={v?.kpis?.to_dry ? "#dc2626" : "var(--text)"}>{v ? v.kpis?.to_dry ?? 0 : "…"}</Big>
        <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 700 }}>à sécher</span></div>}
      {next && <Sub><W text={`Ensuite : ${next.name}${next.age_days != null ? ` (${next.age_days} j)` : " (jamais séchée)"}`}/></Sub>}
    </Tile>
  );
}
function Humidity({ status }) {
  const list = (status?.ams_list || []).filter(a => a.humidity > 0 && a.id !== 255 && a.id !== 254);
  if (!list.length) return null;
  const col = h => h < 30 ? "#22c55e" : h < 40 ? "#f59e0b" : "#ef4444";
  return (
    <Tile icon={<Droplets size={15}/>} color="#06B6D4" label="Humidité des AMS">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {list.map(a => (
          <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
            <span style={{ width: 48, flexShrink: 0, whiteSpace: "nowrap", color: "var(--text2)", fontWeight: 700 }}>
              {a.id >= 128 ? `HT-${String.fromCharCode(65 + a.id - 128)}` : `AMS-${String.fromCharCode(65 + a.id)}`}</span>
            <span style={{ flex: 1, height: 7, borderRadius: 7, background: "var(--surface2)", overflow: "hidden" }}>
              <span data-pk="" style={{ display: "block", height: "100%", width: `${Math.min(100, a.humidity)}%`, background: col(a.humidity), borderRadius: 7 }}/></span>
            <span data-pk="" style={{ width: 34, textAlign: "right", fontWeight: 800, color: col(a.humidity) }}>{a.humidity} %</span>
          </div>
        ))}
      </div>
    </Tile>
  );
}
function MwPoints({ c }) {
  const nav = useNavigate();
  if (!c?.profile) return null;
  const e7 = c.earned7 ?? c.earned?.["7"];
  return (
    <Tile icon={<Coins size={15}/>} color="#EAB308" label="Points MakerWorld" onClick={() => nav("/prints?tab=makerworld")}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <Big>{Math.round(c.profile.points?.total || 0)}</Big>
        <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 700 }}>en caisse</span>
      </div>
      {e7 != null && <Sub><W text={`+${Math.round(e7)} cette semaine · +${Math.round(c.earned?.["30"] || 0)} sur 30 jours`}/></Sub>}
    </Tile>
  );
}
function ToRate({ r }) {
  const nav = useNavigate();
  const items = r?.items || [];
  if (!r) return null;
  return (
    <Tile icon={<Star size={15}/>} color="#F97316" label="À évaluer" onClick={() => nav("/prints?tab=makerworld")}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <Big color={items.length ? "#ea580c" : "var(--text)"}>{items.length}</Big>
        <span style={{ fontSize: 12.5, color: "var(--text2)", fontWeight: 700 }}>modèle{items.length > 1 ? "s" : ""}</span>
      </div>
      <Sub><W text={items.length ? items.slice(0, 2).map(x => x.title || `Modèle ${x.design_id}`).join(", ") : "Tout est évalué"}/></Sub>
    </Tile>
  );
}
function Friends({ f }) {
  const p = f?.printing || [];
  const n = Object.keys(f?.states || {}).length;
  if (!f || !n) return null;
  return (
    <Tile icon={<Users size={15}/>} color="#14B8A6" label="Copains">
      {p.length ? p.slice(0, 3).map(x => (
        <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <span data-pk="" style={{ width: 22, height: 22, borderRadius: "50%", background: "#14B8A6", color: "#fff", fontSize: 11, fontWeight: 900,
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{(x.name || "?").slice(0, 1).toUpperCase()}</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <b style={{ color: "var(--text)" }}>{x.name}</b> · {x.print?.name || x.print_name || "imprime"}</span>
          <span data-pk="" style={{ fontSize: 11.5, fontWeight: 800, color: "#0d9488" }}>{Math.round(x.progress || 0)} %</span>
        </div>
      )) : <Line><W text={`Personne n'imprime (${n} copain${n > 1 ? "s" : ""})`}/></Line>}
    </Tile>
  );
}
function Ach({ a }) {
  const nav = useNavigate();
  const g = gradeOf(null, a?.score_max ? a.score / a.score_max : 0);
  const next = useMemo(() => (a?.items || []).filter(x => x.cat === "cards" && x.level < 0 && x.prog?.[1])
    .sort((x, y) => y.prog[0] / y.prog[1] - x.prog[0] / x.prog[1] || CARD_ORDER.indexOf(x.tiers[0].id) - CARD_ORDER.indexOf(y.tiers[0].id))[0], [a]);
  const lastR = a?.recent?.[0];
  const lastIt = lastR && (a.items || []).find(x => x.id === lastR.id);
  if (!a) return null;
  return (
    <Tile icon={<Trophy size={15}/>} color="#D4A017" label="Succès" wide onClick={() => nav("/stats?tab=achievements")}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span data-pk=""><GradeEmblem i={Math.max(0, g.i)} size={34} locked={g.i < 0}/></span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: "var(--text)" }}><W text={g.name || "Pas encore de grade"}/></div>
            <Sub><W text={`${a.score.toLocaleString("fr-FR")} pts${g.next ? ` · prochain : ${g.next}` : ""}`}/></Sub>
          </div>
        </div>
        {next && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 180px", minWidth: 0 }}>
            <span data-pk=""><Medal tier={next.tiers[0]} emoji={next.emoji} size={32} locked/></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <W text={`Prochaine carte : ${next.name}`}/></div>
              <div style={{ height: 6, borderRadius: 6, background: "var(--surface2)", overflow: "hidden", marginTop: 4 }}>
                <div data-pk="" style={{ height: "100%", width: `${Math.round(100 * next.prog[0] / next.prog[1])}%`, background: next.tiers[0].color }}/></div>
            </div>
            <span data-pk="" style={{ fontSize: 11.5, fontWeight: 800, color: "var(--muted)" }}>{next.prog[0]}/{next.prog[1]}</span>
          </div>
        )}
        {lastIt && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span data-pk=""><Medal tier={lastIt.tiers[lastR.tier]} emoji={lastIt.emoji} size={30}/></span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>Dernière médaille</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>
                <W text={lastIt.name}/></div>
            </div>
          </div>
        )}
      </div>
    </Tile>
  );
}
function Wheel({ a }) {
  const nav = useNavigate();
  const k = a?.keys;
  if (!k) return null;
  const spins = k.wheel?.spins || 0;
  return (
    <Tile icon={<Dices size={15}/>} color="#EC4899" label="Roue et clés">
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div><Big>{spins}</Big><Sub>tour{spins > 1 ? "s" : ""} de roue</Sub></div>
        <div><Big color="#d97706">{k.balance}</Big><Sub>clé{k.balance > 1 ? "s" : ""}</Sub></div>
        <button onClick={e => { e.stopPropagation(); nav("/stats?tab=achievements"); }} data-pk=""
          style={{ marginLeft: "auto", flexShrink: 0, padding: "8px 12px", borderRadius: 10, border: "none", fontWeight: 900, fontSize: 12.5, cursor: "pointer",
            color: "#3b2300", background: spins ? "linear-gradient(135deg, #FDE68A, #F59E0B)" : "var(--surface2)" }}>
          {spins ? "Tourner" : "Voir"}</button>
      </div>
    </Tile>
  );
}

export default function HomeTiles({ status }) {
  const d = useTilesData();
  return (
    <div className="home-tiles">
      <style>{`.home-tiles { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:10px; }`}</style>
      <Today v={d.today}/>
      <Week v={d.week}/>
      <Next q={d.queue}/>
      <Last p={d.last}/>
      <Stock s={d.spools}/>
      <Dry v={d.dry} status={status}/>
      <Humidity status={status}/>
      <Friends f={d.friends}/>
      <MwPoints c={d.mw}/>
      <ToRate r={d.rate}/>
      <Wheel a={d.ach}/>
      <Ach a={d.ach}/>
    </div>
  );
}
