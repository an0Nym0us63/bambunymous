import React, { useState } from "react";
import { createPortal } from "react-dom";
import { FSheet, fBtn } from "./FicheKit";

// La vitesse du serveur en grand (26/10/2026) : chaque route avec un nom lisible, une barre (mediane pleine,
// 95e centile en trait, sur une echelle logarithmique de 10 ms a 30 s), le pire et le nombre d'appels.
export const PERF_AREA = {
  achievements: "Succès", makerworld: "MakerWorld", prints: "Impressions", filaments: "Filaments", printer: "Imprimante",
  camera: "Caméra", notify: "Notifications", settings: "Paramètres", objects: "Objets", stats: "Statistiques", friends: "Copains",
  attention: "Alertes", version: "Mise à jour", share: "Partage Telegram", guide: "Guide", users: "Comptes", home: "Accueil",
  auth: "Connexion", ams: "AMS", rfid: "RFID", spools: "Bobines", logs: "Journal", activity: "Activité",
};
// les sous-routes les plus courantes, en francais
const PERF_SUB = {
  "to-rate": "à évaluer", following: "suivis", timeline: "fil", creators: "créateurs", creator: "créateur", overview: "vue d'ensemble",
  podium: "podium des copains", "grade-fx": "fête des grades", "card-fx": "fête des cartes", news: "annonces", unseen: "non lues",
  status: "état", check: "vérification", stream: "direct", file: "fichier", photos: "photos", photo: "photo", snapshots: "captures",
  details: "détails", storage: "espace de stockage", archive: "sauvegarde NAS", perf: "vitesse", me: "mon compte", boosts: "boosts",
  model: "modèle", design: "modèle", tech: "technique", groups: "groupes", kpis: "chiffres", shared: "partagé", printing: "en cours",
  preview: "aperçu", queue: "à faire", gallery: "galerie", attention: "alertes",
};
export const perfMs = v => v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")} s` : `${Math.round(v)} ms`;
// Ce qu'on attend de chaque route (26/10/2026) : ce qui passe par Internet ou par un appareil (MakerWorld, les
// copains, la camera, le stockage de l'imprimante, Telegram) a le droit d'etre plus long qu'une lecture locale.
// [motif, vert jusqu'a, orange jusqu'a, pourquoi]
const BUDGETS = [
  [/ \/makerworld\//, 1500, 5000, "passe par MakerWorld"],
  [/ \/friends\//, 1500, 5000, "passe par le serveur d'un copain"],
  [/ \/printer\/sd\//, 2000, 8000, "lit le stockage de l'imprimante"],
  [/ \/camera\//, 1500, 4000, "ouvre la caméra"],
  [/ \/share\//, 2000, 8000, "passe par Telegram"],
  [/ \/version\/check/, 1000, 3000, "interroge GitHub"],
  [/ \/settings\/(storage|archive)/, 1500, 5000, "parcourt le disque ou le NAS"],
  [/ \/printer\/details/, 1000, 3000, "interroge l'imprimante"],
];
export function perfBudget(route = "") {
  const b = BUDGETS.find(([re]) => re.test(route));
  return b ? { ok: b[1], warn: b[2], why: b[3] } : { ok: 300, warn: 1000, why: null };
}
// la couleur d'un temps, selon ce qu'on attend de sa route
export const perfTone = (v, route) => { const b = perfBudget(route); return v >= b.warn ? "#ef4444" : v >= b.ok ? "#f59e0b" : "#16a34a"; };
// lente : son 95e centile depasse ce qu'on attend d'elle ; tres lente : au-dela du seuil orange
export const perfSlow = r => r.p95 >= perfBudget(r.route).ok;
export const perfBad = r => r.p95 >= perfBudget(r.route).warn;
export const perfSort = rows => [...rows].sort((a, b) => b.p95 / perfBudget(b.route).ok - a.p95 / perfBudget(a.route).ok);
export function perfLabel(route) {
  const [method, path = ""] = route.split(" ");
  const seg = path.split("/").filter(Boolean);
  const area = PERF_AREA[seg[0]] || seg[0] || "?";
  const rest = seg.slice(1).filter(x => !/^\{.*\}$/.test(x)).map(x => PERF_SUB[x] || x.replace(/-/g, " ")).join(" · ");
  return { title: rest ? `${area} · ${rest}` : area, method, path };
}
const pos = v => Math.max(0, Math.min(100, (Math.log10(Math.max(10, v)) - 1) / (Math.log10(30000) - 1) * 100));

// Les blocages de la boucle (26/10/2026) : le serveur ne fait qu'une chose a la fois ; quand un calcul le fige,
// toutes les requetes en cours attendent. On montre le retard de la boucle et les lignes de code qui l'ont figee.
function LoopView({ loop }) {
  const ago = t => { const m = Math.round((Date.now() / 1000 - t) / 60); return m < 1 ? "à l'instant" : m < 60 ? `il y a ${m} min` : `il y a ${Math.round(m / 60)} h`; };
  const tone = v => v >= 500 ? "#ef4444" : v >= 100 ? "#f59e0b" : "#16a34a";
  return (<>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8 }}>
      {[[loop.lag_p50, "retard habituel"], [loop.lag_p95, "retard à 95 %"], [loop.lag_max, "pire retard"]].map(([v, l]) => (
        <div key={l} style={{ padding: "8px 10px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
          <div style={{ fontSize: 17, fontWeight: 900, color: tone(v), lineHeight: 1.1 }}>{perfMs(v)}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{l}</div>
        </div>))}
    </div>
    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--muted)", lineHeight: 1.4 }}>
      Le serveur traite tout sur une seule file. Quand un calcul la fige plus de {perfMs(loop.stall_ms)}, toutes les pages en cours attendent :
      voici où il en était, du plus coûteux au moins coûteux.</p>
    {loop.stalls.map(s => (
      <div key={s.where} style={{ padding: "10px 12px", borderRadius: 14, background: "var(--surface)", border: `1px solid ${tone(s.max)}55`, display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
          <code style={{ fontSize: 12, fontWeight: 800, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.where}</code>
          <span style={{ fontSize: 15, fontWeight: 900, color: tone(s.max), whiteSpace: "nowrap" }}>{perfMs(s.total)}</span>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
          <span>{s.count} fois</span><span>pire <b style={{ color: tone(s.max) }}>{perfMs(s.max)}</b></span><span>{ago(s.last)}</span>
        </div>
        {s.stack.length > 1 && <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {s.stack.slice(1).map((l, i) => <code key={i} style={{ fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>↳ {l}</code>)}
        </div>}
      </div>))}
    {!loop.stalls.length && <p style={{ fontSize: 13, color: "#16a34a", fontWeight: 700, textAlign: "center", padding: 16 }}>Aucun blocage relevé depuis la remise à zéro.</p>}
    {/* ceux du demarrage, a part : ils ne comptent pas, mais on veut savoir ce qu'il coute */}
    {loop.boot_stalls?.length > 0 && <details style={{ padding: "8px 12px", borderRadius: 14, background: "var(--surface2)" }}>
      <summary style={{ fontSize: 12.5, fontWeight: 800, color: "var(--text2)", cursor: "pointer" }}>
        Pendant le démarrage ({loop.boot_stalls.length}) · {perfMs(loop.boot_stalls.reduce((t, s) => t + s.total, 0))} au total</summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
        {loop.boot_stalls.map(s => (
          <div key={s.where} style={{ display: "flex", gap: 8, alignItems: "baseline", minWidth: 0, fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
            <code style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text2)" }}>{s.where}</code>
            <span style={{ whiteSpace: "nowrap" }}>{s.count}× · {perfMs(s.total)}</span>
          </div>))}
      </div>
    </details>}
  </>);
}

export default function PerfSheet({ data, onClose, onReset, onReload }) {
  const [only, setOnly] = useState("slow");
  const all = perfSort((data?.routes || []).filter(r => r.count > 0));
  const slow = all.filter(perfSlow);
  const list = only === "slow" && slow.length ? slow : all;
  const loop = data?.loop, stalls = loop?.stalls || [];
  const since = data ? new Date(data.since * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  const C = "#0EA5E9";
  const seg = on => ({ flex: 1, padding: "7px 10px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 800,
    color: on ? "#fff" : "var(--text2)", background: on ? `linear-gradient(135deg, ${C}, #6366F1)` : "transparent" });
  return createPortal(
    <FSheet onClose={onClose} z={1600} bottom={<>
      <button onClick={onReset} style={{ ...fBtn, flex: 1 }}>Remettre à zéro</button>
      <button onClick={onReload} style={{ ...fBtn, flex: 1, border: "none", color: "#fff", background: `linear-gradient(135deg, ${C}, #6366F1)` }}>↻ Relire</button>
    </>}>
      <div style={{ padding: "52px 18px 14px", background: `radial-gradient(90% 70% at 0% 0%, ${C}33, transparent 70%), var(--surface2)` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 46, height: 46, borderRadius: 15, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22,
            background: `linear-gradient(135deg, ${C}, #6366F1)`, boxShadow: `0 8px 18px -8px ${C}` }}>⚡</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: C }}>Vitesse du serveur</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>depuis {since} · {data?.requests?.toLocaleString("fr-FR")} appels</div>
            {data?.warm_requests > 0 && <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
              {data.warming ? "démarrage en cours : " : ""}{data.warm_requests.toLocaleString("fr-FR")} appels des {Math.round((data.warmup_s || 180) / 60)} premières minutes mis à part</div>}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 14 }}>
          {[[all.length, "routes", "var(--text)"], [slow.length, "plus lentes qu'attendu", slow.length ? "#f59e0b" : "#16a34a"],
            [all.filter(perfBad).length, "bien trop lentes", all.some(perfBad) ? "#ef4444" : "#16a34a"]].map(([n, l, c]) => (
            <div key={l} style={{ padding: "8px 10px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)" }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: c, lineHeight: 1.1 }}>{n}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)" }}>{l}</div>
            </div>))}
        </div>
      </div>
      <div style={{ padding: "12px 14px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 4, padding: 3, borderRadius: 13, background: "var(--surface2)" }}>
          <button onClick={() => setOnly("slow")} style={seg(only === "slow")}>Lentes ({slow.length})</button>
          <button onClick={() => setOnly("all")} style={seg(only === "all")}>Toutes ({all.length})</button>
          {loop && <button onClick={() => setOnly("loop")} style={seg(only === "loop")}>Blocages ({stalls.length})</button>}
        </div>
        {only === "loop" && loop ? <LoopView loop={loop}/> : <>
        {/* la regle de l'echelle */}
        <div style={{ position: "relative", height: 14, margin: "0 2px", fontSize: 10, fontWeight: 700, color: "var(--muted)" }}>
          {[[10, "10 ms"], [100, "100 ms"], [1000, "1 s"], [10000, "10 s"]].map(([v, l]) => (
            <span key={l} style={{ position: "absolute", left: `${pos(v)}%`, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{l}</span>))}
        </div>
        {list.map(r => { const lb = perfLabel(r.route), c = perfTone(r.p95, r.route), bg = perfBudget(r.route);
          return (
            <div key={r.route} style={{ padding: "10px 12px", borderRadius: 14, background: "var(--surface)", border: `1px solid ${perfSlow(r) ? `${c}55` : "var(--border)"}`,
              display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                <span style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lb.title}</span>
                <span style={{ fontSize: 15, fontWeight: 900, color: c, whiteSpace: "nowrap" }}>{perfMs(r.p95)}</span>
              </div>
              {/* la barre : mediane pleine, 95 % en trait, le pire en point */}
              <div style={{ position: "relative", height: 8, borderRadius: 6, background: "var(--surface2)" }}>
                {/* la zone attendue pour cette route, en fond */}
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pos(bg.ok)}%`, borderRadius: 6, background: "rgba(34,197,94,.12)" }}/>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pos(r.p50)}%`, borderRadius: 6,
                  background: `linear-gradient(90deg, ${perfTone(r.p50, r.route)}88, ${perfTone(r.p50, r.route)})` }}/>
                <span style={{ position: "absolute", left: `${pos(r.p95)}%`, top: -3, width: 3, height: 14, borderRadius: 2, background: c, transform: "translateX(-50%)" }}/>
                <span style={{ position: "absolute", left: `${pos(r.max)}%`, top: 1, width: 6, height: 6, borderRadius: "50%", background: perfTone(r.max, r.route), opacity: .7, transform: "translateX(-50%)" }}/>
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                <span>médiane <b style={{ color: perfTone(r.p50, r.route) }}>{perfMs(r.p50)}</b></span>
                <span>pire <b style={{ color: perfTone(r.max, r.route) }}>{perfMs(r.max)}</b></span>
                <span>attendu <b style={{ color: "var(--text2)" }}>&lt; {perfMs(bg.ok)}</b>{bg.why ? ` (${bg.why})` : ""}</span>
                {r.cold != null && <span data-tip="Les appels des premières minutes après le démarrage du serveur (caches vides, tâches de démarrage) : mis à part, ils ne comptent pas dans les chiffres">
                  au démarrage {r.cold_n > 1 ? `${r.cold_n} appels, pire ` : ""}<b style={{ color: "var(--text2)" }}>{perfMs(r.cold)}</b> (ignoré{r.cold_n > 1 ? "s" : ""})</span>}
                <span>{r.count} appel{r.count > 1 ? "s" : ""}</span>
                <code style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{lb.method} {lb.path}</code>
              </div>
            </div>); })}
        {!list.length && <p style={{ fontSize: 13, color: "var(--muted)", textAlign: "center", padding: 16 }}>Rien de mesuré pour l'instant.</p>}
        </>}
      </div>
    </FSheet>,
    document.body);
}
