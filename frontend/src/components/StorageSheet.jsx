import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { HardDrive, RefreshCw, X } from "lucide-react";
import client from "../api/client";

// L'espace de stockage (24/10/2026) : ce que l'appli garde dans son dossier de donnees, par sorte, en
// anneau et en liste, la place du disque, et les impressions qui en prennent le plus. Onglet NAS (26/10/2026) :
// la meme lecture de ce que la sauvegarde y range, et la place du partage.
const C = "#6366F1";
export const fmtBytes = n => {
  const u = ["o", "Ko", "Mo", "Go", "To"];
  let v = n || 0, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${(v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)).toString().replace(".", ",")} ${u[i]}`;
};
const pct = (a, b) => b ? Math.round(1000 * a / b) / 10 : 0;
const pctFr = (a, b) => a > 0 && pct(a, b) < 0.1 ? "< 0,1" : String(pct(a, b)).replace(".", ",");

// l'anneau : un arc par sorte, la sorte survolee ressort ; le total au centre
function Donut({ cats, total, hi, setHi, size = 210 }) {
  const sw = 26, r = (size - sw) / 2 - 4, Cc = 2 * Math.PI * r;
  let at = 0;
  const shown = cats.find(c => c.key === hi);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Répartition de l'espace">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface2)" strokeWidth={sw}/>
      {cats.map(c => {
        const len = total ? Cc * c.bytes / total : 0;
        const gap = cats.length > 1 && len > 4 ? 2 : 0;
        const el = <circle key={c.key} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={c.color}
          strokeWidth={hi === c.key ? sw + 8 : sw} strokeDasharray={`${Math.max(0, len - gap)} ${Cc}`} strokeDashoffset={-at}
          transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ cursor: "pointer", transition: "stroke-width .15s", opacity: hi && hi !== c.key ? 0.45 : 1 }}
          onMouseEnter={() => setHi(c.key)} onMouseLeave={() => setHi(null)} onClick={() => setHi(h => h === c.key ? null : c.key)}/>;
        at += len;
        return el;
      })}
      <text x="50%" y="46%" textAnchor="middle" style={{ fontSize: 22, fontWeight: 900, fill: shown ? shown.color : "var(--text)" }}>
        {fmtBytes(shown ? shown.bytes : total)}</text>
      <text x="50%" y="58%" textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 700, fill: "var(--muted)" }}>
        {shown ? `${pctFr(shown.bytes, total)} % · ${shown.files} fichier${shown.files > 1 ? "s" : ""}` : "en tout"}</text>
    </svg>
  );
}

export default function StorageSheet({ onClose }) {
  const nav = useNavigate();
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  const [hi, setHi] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("local");
  const [nas, setNas] = useState(null);
  const narrow = typeof window !== "undefined" && window.innerWidth < 560;
  const load = (fresh, which = tab) => { setBusy(true); client.get(which === "nas" ? "/settings/storage/nas" : "/settings/storage", { params: fresh ? { fresh: true } : {} })
    .then(r => { (which === "nas" ? setNas : setV)(r.data); setErr(null); }).catch(e => setErr(e.response?.data?.detail || e.message)).finally(() => setBusy(false)); };
  useEffect(() => { load(false, "local"); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pickTab = t => { setTab(t); setHi(null); if (t === "nas" && !nas) load(false, "nas"); };
  const cur = tab === "nas" ? (nas?.ok ? nas : null) : v;
  useEffect(() => { const k = e => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cats = (cur?.cats || []).filter(c => c.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const max = Math.max(1, ...cats.map(c => c.bytes));
  const d = cur?.disk;
  const seg = on => ({ flex: 1, padding: "7px 10px", borderRadius: 10, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 800,
    color: on ? "#fff" : "var(--text2)", background: on ? `linear-gradient(135deg, ${C}, #A855F7)` : "transparent", transition: "background .15s" });
  return createPortal(
    <div data-no-pull="" onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 950, padding: narrow ? 0 : 14, background: "rgba(2,6,23,0.55)",
      backdropFilter: "blur(6px)", display: "flex", alignItems: narrow ? "flex-end" : "center", justifyContent: "center", animation: "bn-fade .2s ease-out" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: narrow ? "100%" : "min(760px, 100%)", maxHeight: narrow ? "90vh" : "88vh", display: "flex",
        flexDirection: "column", overflow: "hidden", borderRadius: narrow ? "26px 26px 0 0" : 24, background: "var(--sheet-bg)", border: "1px solid var(--border)",
        boxShadow: "0 30px 80px rgba(0,0,0,0.45)", animation: narrow ? "bn-sheet-up .3s cubic-bezier(.2,.8,.2,1)" : "bn-pop .24s cubic-bezier(.2,.8,.2,1)" }}>
        {/* l'en-tete, degrade indigo */}
        <div style={{ position: "relative", padding: narrow ? "10px 16px 14px" : "16px 18px", overflow: "hidden", flexShrink: 0,
          background: `linear-gradient(135deg, ${C}38, ${C}10 55%, transparent)` }}>
          <span aria-hidden="true" style={{ position: "absolute", right: -50, top: -70, width: 180, height: 180, borderRadius: "50%", background: `${C}30` }}/>
          {narrow && <div style={{ width: 42, height: 4, borderRadius: 4, background: "var(--border)", margin: "0 auto 10px" }}/>}
          <div style={{ display: "flex", alignItems: "center", gap: 12, position: "relative" }}>
            <span style={{ width: 44, height: 44, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              background: `linear-gradient(135deg, ${C}, ${C}bb)`, color: "#fff", boxShadow: `0 8px 20px ${C}55` }}><HardDrive size={22}/></span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 19, fontWeight: 900, color: "var(--text)" }}>Espace de stockage</span>
              {cur && <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{cur.files.toLocaleString("fr-FR")} fichiers · relevé à {new Date(cur.at * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>}
            </span>
            <button onClick={() => load(true)} disabled={busy} aria-label="Relire" data-tip="Relire maintenant"
              style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text2)",
                cursor: busy ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <RefreshCw size={16} style={{ animation: busy ? "spin 1s linear infinite" : "none" }}/></button>
            <button onClick={onClose} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid var(--border)",
              background: "var(--surface)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><X size={17}/></button>
          </div>
        </div>
        <div className="bn-zoom-body" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: narrow ? "14px 16px 22px" : "16px 18px 20px",
          display: "flex", flexDirection: "column", gap: 16 }}>
          {/* le serveur (dossier de donnees de l'appli) ou le NAS (ce que la sauvegarde y range) */}
          <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 13, background: "var(--surface2)", flexShrink: 0 }}>
            <button onClick={() => pickTab("local")} style={seg(tab === "local")}>💻 Local</button>
            <button onClick={() => pickTab("nas")} style={seg(tab === "nas")}>🗄️ NAS</button>
          </div>
          {err && <div style={{ color: "#ef4444", fontWeight: 700, fontSize: 13 }}>{err}</div>}
          {tab === "nas" && nas && !nas.ok && <div className="card-sm" style={{ padding: "12px 14px", fontSize: 12.5, color: "var(--text2)", lineHeight: 1.5 }}>
            <b style={{ color: "#ef4444" }}>✕ NAS indisponible</b> · <code>{nas.dir}</code><div>{nas.why}</div></div>}
          {!cur && !err && !(tab === "nas" && nas) && <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontWeight: 700 }}>
            {tab === "nas" ? "⏳ On fait le tour du NAS (un partage réseau, ça peut prendre un moment)…" : "⏳ On fait le tour des fichiers…"}</div>}
          {cur && <>
            {tab === "nas" && <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>
              <code>{cur.dir}</code>{cur.last_backup?.at && <> · dernière sauvegarde {new Date(cur.last_backup.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</>}
              {cur.only_nas?.files > 0 && <div><b style={{ color: "var(--text2)" }}>{fmtBytes(cur.only_nas.bytes)}</b> ({cur.only_nas.files.toLocaleString("fr-FR")} fichier{cur.only_nas.files > 1 ? "s" : ""}) vidé{cur.only_nas.files > 1 ? "s" : ""} du local : ils ne sont plus que sur le NAS.</div>}
            </div>}
            {/* l'anneau et la liste, cote a cote sur un grand ecran */}
            <div style={{ display: "flex", flexDirection: narrow ? "column" : "row", alignItems: narrow ? "center" : "flex-start", gap: narrow ? 10 : 22 }}>
              <span style={narrow ? undefined : { position: "sticky", top: 0, flexShrink: 0 }}><Donut cats={cats} total={cur.total} hi={hi} setHi={setHi} size={narrow ? 200 : 220}/></span>
              <div style={{ flex: 1, minWidth: 0, width: "100%", display: "flex", flexDirection: "column", gap: 7 }}>
                {cats.map(c => (
                  <div key={c.key} onMouseEnter={() => setHi(c.key)} onMouseLeave={() => setHi(null)} onClick={() => setHi(h => h === c.key ? null : c.key)}
                    style={{ display: "flex", flexDirection: "column", gap: 3, padding: "5px 8px", borderRadius: 10, cursor: "pointer",
                      background: hi === c.key ? `color-mix(in srgb, ${c.color} 12%, transparent)` : "transparent", transition: "background .15s" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 3, background: c.color, flexShrink: 0 }}/>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.label}</span>
                      <span style={{ fontWeight: 900, whiteSpace: "nowrap", backgroundImage: `linear-gradient(135deg, ${c.color}, color-mix(in srgb, ${c.color} 55%, #ffffff))`,
                        WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>{fmtBytes(c.bytes)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ flex: 1, height: 5, borderRadius: 5, background: "var(--surface2)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${Math.max(1.5, 100 * c.bytes / max)}%`, background: c.color, borderRadius: 5 }}/></span>
                      <span style={{ width: 92, textAlign: "right", fontSize: 10.5, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>
                        {pctFr(c.bytes, cur.total)} % · {c.files} fich.</span>
                    </div>
                    {/* les 3MF : combien d'impressions ils couvrent */}
                    {c.covers && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", paddingLeft: 18 }}>
                      couvre <b style={{ color: c.color }}>{c.covers.prints.toLocaleString("fr-FR")}</b> impression{c.covers.prints > 1 ? "s" : ""} sur {c.covers.of.toLocaleString("fr-FR")}
                      {c.key === "mw_tmf" ? " liées à MakerWorld" : ""}</div>}
                    {/* sur le NAS : de quoi sont faits les 3MF d'origine (la bibliotheque n'est qu'une partie) */}
                    {c.parts && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", paddingLeft: 18, display: "flex", flexDirection: "column", gap: 1 }}>
                      {c.parts.map(p => <span key={p.key}>{p.label} <b style={{ color: p.key === "copies" ? "#d97706" : "var(--text2)" }}>{fmtBytes(p.bytes)}</b> · {p.files} fich.
                        {p.key === "copies" && !cur.mw_swept ? " (retirées à la prochaine sauvegarde, une fois vérifiées)" : ""}</span>)}</div>}
                  </div>
                ))}
              </div>
            </div>
            {/* le disque : l'appli, le reste du disque, la place libre */}
            {d && <div className="card-sm" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text2)" }}>{tab === "nas" ? "Le partage du NAS" : "Le disque"}</span>
                <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>{fmtBytes(d.free)} libres sur {fmtBytes(d.total)}</span>
              </div>
              <div style={{ display: "flex", height: 12, borderRadius: 8, overflow: "hidden", background: "var(--surface2)" }}>
                <span data-tip={`${tab === "nas" ? "Les sauvegardes" : "L'appli"} : ${fmtBytes(cur.total)}`} style={{ width: `${pct(cur.total, d.total)}%`, minWidth: cur.total ? 3 : 0, background: `linear-gradient(90deg, ${C}, #A855F7)` }}/>
                <span data-tip={`Le reste : ${fmtBytes(Math.max(0, d.used - cur.total))}`} style={{ width: `${pct(Math.max(0, d.used - cur.total), d.total)}%`, background: "#94A3B8" }}/>
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: C, marginRight: 5 }}/>{tab === "nas" ? "Sauvegardes" : "Bambunymous"} {fmtBytes(cur.total)}</span>
                <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: "#94A3B8", marginRight: 5 }}/>Le reste {fmtBytes(Math.max(0, d.used - cur.total))}</span>
                <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 3, background: "var(--surface2)", border: "1px solid var(--border)", marginRight: 5 }}/>Libre {fmtBytes(d.free)} ({pctFr(d.free, d.total)} %)</span>
              </div>
            </div>}
            {/* les impressions qui prennent le plus de place (photos, 3MF, vignette) */}
            {tab === "local" && v.top_prints?.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text2)" }}>Les impressions les plus lourdes</span>
              {v.top_prints.map((x, i) => (
                <button key={x.id} onClick={() => { onClose(); nav(`/prints?id=${x.id}`); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px",
                  borderRadius: 11, border: "none", cursor: "pointer", textAlign: "left", font: "inherit", color: "inherit",
                  background: "color-mix(in srgb, var(--surface2) 60%, transparent)" }}>
                  <span style={{ width: 20, fontSize: 11.5, fontWeight: 900, color: "var(--muted)", textAlign: "center" }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.name}</span>
                  {x.date && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap" }}>{new Date(x.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "2-digit" })}</span>}
                  <span style={{ fontSize: 12, fontWeight: 900, color: "var(--text2)", whiteSpace: "nowrap" }}>{fmtBytes(x.bytes)}</span>
                </button>))}
            </div>}
            {tab === "local" && v.other_dirs?.length > 0 && cats.some(c => c.key === "other") && <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
              « Autres » : {v.other_dirs.map(o => `${o.dir} (${fmtBytes(o.bytes)})`).join(", ")}</div>}
          </>}
        </div>
      </div>
    </div>, document.body);
}
