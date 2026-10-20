import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import { useIsAdmin } from "../store/auth";
import MwImg from "./MwImg";
import { prefetchModel } from "./MakerWorldModelSheet";

// Onglet « Créateur » : mes points MakerWorld (solde, gains 7 / 30 jours,
// historique jour par jour) et mes modeles avec leurs compteurs. Les points
// sont ceux reellement verses par MakerWorld (point-bill), pas recalcules.
const fmt = (v, d = 0) => v == null ? "—" : Number(v).toLocaleString("fr-FR", { maximumFractionDigits: d });
const pts = v => fmt(v, 2);
const PERIODS = [["7", "7 jours"], ["30", "30 jours"], ["90", "90 jours"], ["365", "1 an"], ["all", "Depuis le début"]];
const TYPES = [["points", "Points", "pts"], ["downloads", "Téléchargements", "téléch."], ["prints", "Impressions", "impr."],
  ["boosts", "Boosts", "boosts"], ["likes", "J'aime", "j'aime"]];
const SHORT = { "7": "7 j", "30": "30 j", "90": "90 j", "365": "1 an", "all": "total" };

export default function MwCreator({ reload = 0, onOpen, onLoaded }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [period, setPeriod] = useState("30");
  const [type, setType] = useState("points");
  const [hist, setHist] = useState(null);        // { items, total }
  const [more, setMore] = useState(false);
  const [view, setView] = useState("models");    // models | points
  const [imported, setImported] = useState(0);   // relit la page apres un import
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const isAdmin = useIsAdmin();

  useEffect(() => {
    let alive = true;
    setErr(null);
    client.get("/makerworld/creator", { params: { period, ...(reload ? { fresh: 1 } : {}) } })
      .then(({ data }) => { if (alive) setData(data); })
      .catch(e => { if (alive) setErr(e.response?.data?.detail || e.message); })
      .finally(() => onLoaded?.());
    return () => { alive = false; };
  }, [reload, period, imported]);
  useEffect(() => {
    client.get("/makerworld/creator/points").then(({ data }) => setHist(data)).catch(() => {});
  }, [reload]);
  // Boosts que je peux donner (a depenser depuis la fiche d'un modele).
  const [myBoosts, setMyBoosts] = useState(null);
  useEffect(() => {
    client.get("/makerworld/boosts").then(({ data }) => setMyBoosts(data.available)).catch(() => {});
  }, [reload]);

  const loadMore = () => {
    setMore(true);
    client.get("/makerworld/creator/points", { params: { offset: hist.items.length } })
      .then(({ data }) => setHist(h => ({ ...h, items: [...h.items, ...(data.items || [])] })))
      .catch(() => {}).finally(() => setMore(false));
  };

  // Import unique : la reponse de la page « Vue d'ensemble » du Centre des
  // createurs (…/my/data-overview/model.json), enregistree par l'utilisateur.
  // On n'en envoie que les compteurs jour par jour.
  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(CONSOLE_SCRIPT);
      await showAlert("Script copié. " + SCRIPT_HELP);
    } catch {
      await showAlert("Copie impossible ici. " + SCRIPT_HELP + "\n\n" + CONSOLE_SCRIPT);
    }
  };
  const importFile = async (file) => {
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      let j;
      try { j = JSON.parse(text.slice(a, b + 1)); } catch { throw new Error("ce fichier n'est pas du JSON"); }
      const pp = j.pageProps || j;
      const list = (pp.statisticalData || j.statisticalData)?.dateList;
      if (!Array.isArray(list)) throw new Error("pas de « dateList » : il faut la réponse de la page Vue d'ensemble");
      const pick = l => (l || []).map(r => ({ intervalVal: r.intervalVal, download: r.download, print: r.print, boost: r.boost, like: r.like }));
      // fichier du script de console : en plus, la dateList de chaque modele
      // (seuls ses jours non nuls partent)
      const designs = j.designs && typeof j.designs === "object" ? Object.fromEntries(Object.entries(j.designs)
        .map(([id, l]) => [id, pick(l).filter(r => r.download || r.print || r.boost || r.like)])) : undefined;
      const { data: h } = await client.post("/makerworld/creator/history", {
        rows: pick(list), designs, until: String(pp.maxDateStr || "").slice(0, 10) || null,
        from_start: !!(pp.startDateStr && pp.minDateStr && pp.startDateStr <= pp.minDateStr) });
      await showAlert(`Historique importé : ${h.days} jours, du ${dayFr(h.from)} au ${dayFr(h.to)}`
        + (h.designs ? `, et ${h.designs} modèles un par un.` : ". Pour le classement par modèle, utilise le script de console."));
      setImported(n => n + 1);
    } catch (e) {
      await showAlert("Import impossible : " + (e.response?.data?.detail || e.message));
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  if (err) return <p style={msg}>MakerWorld ne répond pas comme prévu : {err}</p>;
  if (!data) return <p style={msg}>…</p>;
  const p = data.profile;
  const val = m => m.period?.[type] ?? 0;
  const models = [...data.models].sort((a, b) => val(b) - val(a) || (b[type] || 0) - (a[type] || 0));
  const typeShort = TYPES.find(t => t[0] === type)?.[2];
  // Compteurs (hors points) : releves journaliers pris par l'appli, depuis peu.
  const partial = type !== "points" && period !== "all" && data.counters_partial;
  const since = data.counters_since ? new Date(data.counters_since + "T12:00:00").toLocaleDateString("fr-FR", { day:"numeric", month:"short" }) : null;
  const typeLabel = TYPES.find(t => t[0] === type)?.[1].toLowerCase();
  const hist0 = data.history || {};
  const importLink = isAdmin && (
    <>
      <input ref={fileRef} type="file" accept=".json,.txt,application/json,text/plain" style={{ display:"none" }}
        onChange={e => importFile(e.target.files?.[0])}/>
      {" "}<button onClick={() => fileRef.current?.click()} disabled={importing} title={IMPORT_HELP}
        style={{ background:"none", border:"none", padding:0, cursor:"pointer", color:"#3b82f6", fontWeight:700,
          fontSize:"inherit", textDecoration:"underline" }}>
        {importing ? "Import…" : hist0.days ? "Réimporter l'historique" : "Importer l'historique (fichier)"}</button>
      {" · "}<button onClick={copyScript} title={SCRIPT_HELP} style={linkBtn}>Copier le script de console</button>
    </>
  );

  // historique groupe par jour de versement
  const days = [];
  for (const x of hist?.items || []) {
    const d = String(x.time || "").slice(0, 10);
    if (!days.length || days[days.length - 1].day !== d) days.push({ day: d, items: [], sum: 0 });
    days[days.length - 1].items.push(x); days[days.length - 1].sum += x.points || 0;
  }

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:12, paddingBottom:16 }}>
      <div className="card" style={{ padding:"14px 16px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          {p.avatar && <MwImg src={p.avatar} w={96} eager style={{ width:46, height:46, borderRadius:"50%", flexShrink:0 }}/>}
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:15, fontWeight:800, color:"var(--text)" }}>{p.name}
              {p.level ? <span style={{ fontSize:11, color:"var(--muted)", fontWeight:600 }}> · niveau {p.level}</span> : null}</div>
            <div style={{ fontSize:11.5, color:"var(--muted)" }}>@{p.handle}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            <div style={{ fontSize:22, fontWeight:900, color:"#f59e0b", lineHeight:1 }}>🪙 {pts(p.points.total)}</div>
            <div style={{ fontSize:10.5, color:"var(--muted)", marginTop:3 }}>
              {pts(p.points.regular)} normaux · {pts(p.points.exclusive)} exclusifs</div>
          </div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(96px,1fr))", gap:8, marginTop:12 }}>
          {[...(data.earned_total != null ? [[pts(data.earned_total), "points gagnés au total", "#f59e0b"]] : []),
            ["+" + pts(data.earned7), "points 7 j", "#22c55e"], ["+" + pts(data.earned30), "points 30 j", "#22c55e"],
            [fmt(p.fans), "abonnés"], [fmt(p.designs), "modèles"], [fmt(p.downloads), "téléchargements"],
            [fmt(p.prints), "impressions"], [fmt(p.boosts), "boosts reçus"], [fmt(p.likes), "j'aime"],
            ...(myBoosts != null ? [[`⚡ ${myBoosts}`, "boosts à donner", "#f59e0b"]] : [])].map(([v, l, c]) => (
            <div key={l} style={{ padding:"8px 10px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
              <div style={{ fontSize:15, fontWeight:800, color: c || "var(--text)" }}>{v}</div>
              <div style={{ fontSize:10.5, color:"var(--muted)" }}>{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap" }}>
        {[["models", `Mes modèles (${data.models.length})`], ["points", "Historique des points"]].map(([k, l]) => (
          <button key={k} onClick={() => setView(k)} style={pill(view === k)}>{l}</button>
        ))}
        {view === "models" && (
          <span style={{ marginLeft:"auto", display:"flex", gap:6 }}>
            <select value={type} onChange={e => setType(e.target.value)} aria-label="Type" style={sel}>
              {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <select value={period} onChange={e => setPeriod(e.target.value)} aria-label="Période" style={sel}>
              {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </span>
        )}

      </div>
      {view === "models" && type !== "points" && period !== "all" && data.account && (
        <div style={{ fontSize:12, color:"var(--text2)", margin:"-4px 0 0", display:"flex", gap:10, flexWrap:"wrap" }}>
          <span style={{ color:"var(--muted)" }}>Tout le compte, {PERIODS.find(x => x[0] === period)?.[1]} :</span>
          {[["downloads", "⬇️"], ["prints", "🖨️"], ["boosts", "⚡"], ["likes", "❤"]].map(([k, ic]) => (
            <span key={k} style={{ fontWeight: k === type ? 800 : 600, color: k === type ? "#22c55e" : "inherit" }}>
              {ic} {data.account[k] > 0 ? "+" : ""}{fmt(data.account[k])}</span>
          ))}
        </div>
      )}
      {view === "models" && partial && (
        <p style={{ fontSize:11.5, color: data.account_complete ? "var(--muted)" : "#f59e0b", margin:"-4px 0 0", lineHeight:1.45 }}>
          {data.account_complete
            ? <>Totaux du compte complets grâce à l'historique importé ({dayFr(hist0.from)} → {dayFr(hist0.to)}).
                Le classement par modèle, lui, ne compte les {typeLabel} que depuis le {since} : MakerWorld ne donne pas l'historique modèle par modèle.</>
            : <>L'appli note les compteurs de tes modèles chaque jour depuis le {since} : sur cette période, les
                {" "}{typeLabel} ne sont comptés que depuis cette date. Les points, eux, sont complets.</>}
          {importLink}
        </p>
      )}

      {view === "models" ? (
        <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {models.map(m => (
            <button key={m.design_id} onClick={() => onOpen?.({ design_id: m.design_id, title: m.title, title_fr: m.title_fr, cover_url: m.cover_url })}
              onPointerDown={() => prefetchModel(m.design_id)}
              style={{ display:"flex", alignItems:"center", gap:10, padding:8, borderRadius:12, cursor:"pointer", textAlign:"left",
                background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" }}>
              {m.cover_url ? <MwImg src={m.cover_url} w={110} style={{ width:52, height:52, borderRadius:8, objectFit:"cover", flexShrink:0 }}/>
                : <span style={{ width:52, height:52, borderRadius:8, background:"var(--surface)", flexShrink:0 }}/>}
              <span style={{ flex:1, minWidth:0 }}>
                <span style={{ display:"block", fontSize:12.5, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {m.title_fr || m.title}{m.exclusive ? <span style={{ fontSize:10, color:"#a78bfa", fontWeight:800 }}> · exclusif</span> : null}</span>
                <span style={{ display:"block", fontSize:11, color:"var(--muted)", marginTop:2 }}>
                  ⬇️ {fmt(m.downloads)} · 🖨️ {fmt(m.prints)} · ⚡ {fmt(m.boosts)} · ❤ {fmt(m.likes)}</span>
              </span>
              <span style={{ textAlign:"right", flexShrink:0 }}>
                <span style={{ display:"block", fontSize:13, fontWeight:800, color: val(m) ? "#22c55e" : "var(--muted)" }}>
                  {val(m) ? `${period === "all" ? "" : "+"}${type === "points" ? pts(val(m)) : fmt(val(m))}` : "0"}</span>
                <span style={{ display:"block", fontSize:9.5, color: partial ? "#f59e0b" : "var(--muted)" }}>
                  {typeShort} {partial && since ? `depuis le ${since}` : SHORT[period]}</span>
              </span>
            </button>
          ))}
        </div>
      ) : !hist ? <p style={msg}>…</p> : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {days.map(d => (
            <div key={d.day} className="card" style={{ padding:"10px 12px" }}>
              <div style={{ display:"flex", alignItems:"center", marginBottom:6 }}>
                <span style={{ flex:1, fontSize:12, fontWeight:800, color:"var(--text2)" }}>
                  {new Date(d.day + "T12:00:00").toLocaleDateString("fr-FR", { weekday:"short", day:"numeric", month:"short" })}</span>
                <span style={{ fontSize:12.5, fontWeight:800, color: d.sum >= 0 ? "#22c55e" : "#ef4444" }}>
                  {d.sum >= 0 ? "+" : ""}{pts(d.sum)}</span>
              </div>
              {d.items.map((x, i) => (
                <div key={i} onClick={() => x.design_id && onOpen?.({ design_id: x.design_id, title: x.title })}
                  style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 0", fontSize:11.5,
                    cursor: x.design_id ? "pointer" : "default", borderTop: i ? "1px solid var(--border)" : "none" }}>
                  <span style={{ fontSize:10, fontWeight:700, color:"var(--muted)", width:44, flexShrink:0 }}>{x.label}</span>
                  <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", color:"var(--text)" }}>
                    {x.title || "—"}{x.instance_title ? <span style={{ color:"var(--muted)" }}> · {x.instance_title}</span> : null}</span>
                  {x.exclusive_bonus && <span title="Points exclusifs" style={{ fontSize:9.5, color:"#a78bfa", fontWeight:800 }}>excl.</span>}
                  <span style={{ fontWeight:800, color: x.points >= 0 ? "#22c55e" : "#ef4444", flexShrink:0 }}>
                    {x.points >= 0 ? "+" : ""}{pts(x.points)}</span>
                </div>
              ))}
            </div>
          ))}
          {hist.items.length < hist.total && (
            <button onClick={loadMore} disabled={more} style={{ ...pill(false), alignSelf:"center", padding:"8px 18px" }}>
              {more ? "…" : `Plus anciens (${hist.items.length} / ${hist.total})`}</button>
          )}
        </div>
      )}
    </div>
  );
}

const dayFr = d => d ? new Date(d + "T12:00:00").toLocaleDateString("fr-FR", { day:"numeric", month:"short", year:"numeric" }) : "?";
const IMPORT_HELP = "Sur makerworld.com, connecté : Centre des créateurs › Vue d'ensemble, plage depuis le début. "
  + "Ouvre la requête « model.json?startDate=…&endDate=… » de cette page, enregistre la réponse, puis choisis le fichier ici. "
  + "Ou mieux : le fichier du script de console, qui contient aussi chaque modèle.";
const SCRIPT_HELP = "À coller dans la console (F12) d'un onglet makerworld.com où tu es connecté : il lit la Vue d'ensemble "
  + "du compte puis celle de chacun de tes modèles, depuis le début, et télécharge mw-historique.json à importer ici.";
const linkBtn = { background:"none", border:"none", padding:0, cursor:"pointer", color:"#3b82f6", fontWeight:700,
  fontSize:"inherit", textDecoration:"underline" };
// Script lance par l'utilisateur dans SA console MakerWorld : lectures seules,
// avec ses propres cookies, rien ne part ailleurs que dans le fichier telecharge.
export const CONSOLE_SCRIPT = `(async () => {
  const b = window.__NEXT_DATA__ && __NEXT_DATA__.buildId;
  if (!b) throw new Error("Ouvre d'abord une page makerworld.com");
  const get = async u => {
    const r = await fetch(u, { headers: { "x-nextjs-data": "1" }, credentials: "include" });
    if (!r.ok) throw new Error(r.status + " " + u);
    return (await r.json()).pageProps;
  };
  const pick = l => (l || []).map(r => ({ intervalVal: r.intervalVal, download: r.download, print: r.print, boost: r.boost, like: r.like }));
  const base = "/_next/data/" + b + "/fr/my/data-overview/model";
  const first = await get(base + ".json");
  const q = "startDate=" + first.minDateStr.slice(0, 10) + "&endDate=" + first.maxDateStr.slice(0, 10);
  const all = await get(base + ".json?" + q);
  const out = { pageProps: { minDateStr: all.minDateStr, maxDateStr: all.maxDateStr, startDateStr: all.startDateStr,
    statisticalData: { dateList: pick(all.statisticalData.dateList) } }, designs: {} };
  const list = all.statisticalList || [];
  for (const [i, d] of list.entries()) {
    const p = await get(base + "/" + d.designId + ".json?" + q + "&designId=" + d.designId);
    out.designs[d.designId] = pick(p.statisticalData && p.statisticalData.dateList);
    console.log((i + 1) + "/" + list.length, d.title);
    await new Promise(r => setTimeout(r, 400));
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: "application/json" }));
  a.download = "mw-historique.json";
  document.body.appendChild(a); a.click(); a.remove();
  console.log("Fini : mw-historique.json est téléchargé, importe-le dans BambuNymous.");
})();`;
const sel = { fontSize:12, padding:"4px 8px", borderRadius:8, background:"var(--surface2)",
  border:"1px solid var(--border)", color:"var(--text2)" };
const msg = { fontSize:13, color:"var(--muted)", padding:"20px 4px", margin:0, lineHeight:1.5 };
const pill = on => ({ padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:700, cursor:"pointer",
  background: on ? "rgba(59,130,246,0.15)" : "var(--surface2)", color: on ? "#3b82f6" : "var(--text2)",
  border: on ? "1px solid #3b82f6" : "1px solid var(--border)" });
