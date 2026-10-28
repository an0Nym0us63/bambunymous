import React, { useState, useEffect } from "react";
import CardHelp from "../components/CardHelp";
import Cachettes from "../components/Cachettes";
import { Save, Wifi, RefreshCw, Sun, Moon, Users, KeyRound, Trash2, Activity } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useUrlTab } from "../utils/useUrlTab";
import TasksPanel from "../components/TasksPanel";
import client from "../api/client";
import { FriendsCard, FriendKeyButtons } from "../components/Friends";
import { showAlert, showConfirm } from "../utils/dialog";
import PriceReview from "../components/PriceReview";
import Select from "../components/Select";
import HeaderAction from "../components/HeaderAction";
import { useTheme } from "../useTheme";
import { useAuth, useIsAdmin, ROLE_ADMIN, ROLE_READONLY,
         ROLE_OPTIONS, ROLE_LABEL, ROLE_BADGE } from "../store/auth";
import AdminOnly from "../components/AdminOnly";
import TelegramSettings from "../components/TelegramSettings";
import MailOrdersSettings from "../components/MailOrdersSettings";
import SwitchCard from "../components/SwitchCard";
import DryRulesCard from "../components/DryRulesCard";
import SpoolTaresCard from "../components/SpoolTaresCard";
import MakerWorldSettings from "../components/MakerWorldSettings";
import RateTemplatesSettings from "../components/RateTemplatesSettings";
import NotificationsSettings from "../components/NotificationsSettings";
import MyAppNotifications from "../components/MyAppNotifications";
import AndroidApp from "../components/AndroidApp";
import PerfSheet, { perfLabel, perfMs, perfTone, perfSlow, perfBad, perfSort, perfVal } from "../components/PerfSheet";
import StorageSheet from "../components/StorageSheet";
import TwoFactorCard from "../components/TwoFactorCard";
import { useTrackDetail } from "../utils/track";
import { refreshUpdates } from "../utils/updates";
import { egg, tapper, useEggFound } from "../eggs";

const inp = {
  width:"100%", background:"var(--surface)", border:"1px solid var(--border)",
  borderRadius:12, padding:"10px 12px", fontSize:14, fontWeight:600, color:"var(--text)",
  outline:"none", transition:"border-color 0.15s", boxSizing:"border-box",
};
const lbl = {
  display:"block", fontSize:12, fontWeight:800, color:"var(--muted)", marginBottom:6,
};

// Le backend renvoie des datetime UTC *naifs* ("2026-07-18 21:24:33.123456").
// Sans le T ni le Z, Safari refuse de les parser et les autres moteurs les
// lisent en heure locale : le journal aurait affiche deux heures de decalage
// sans rien signaler.
function parseUTC(t) {
  if (!t) return null;
  const s = String(t).trim();
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  const d = new Date(s.replace(" ", "T") + (hasTz ? "" : "Z"));
  return isNaN(d.getTime()) ? null : d;
}

// Duree relative : sur une fenetre de 7 jours c'est plus parlant qu'une date.
function ago(t) {
  const d = parseUTC(t);
  if (!d) return null;
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60)    return "à l'instant";
  if (s < 3600)  return `il y a ${Math.floor(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.floor(s / 3600)} h`;
  const j = Math.floor(s / 86400);
  return j === 1 ? "hier" : `il y a ${j} j`;
}

function stamp(t) {
  const d = parseUTC(t);
  return d ? d.toLocaleString("fr-FR", { day:"2-digit", month:"2-digit",
    hour:"2-digit", minute:"2-digit" }) : "";
}
const sec = {
  display:"grid", gridTemplateColumns:"1fr 1fr", gap:12,
};
const card = { padding:16 };

// L'accueil : sa personnalisation (aussi dans le menu du compte, quand on est sur l'accueil)
function HomeDisplayCard() {
  return (
    <div className="card" style={card}>
      <div style={cardTitle}>Accueil</div>
      <CardHelp title="Accueil">
        Les tuiles, leur place et le bandeau. Aussi depuis l'accueil : ton menu de compte, « Personnaliser l'accueil ».</CardHelp>
      <button type="button" onClick={() => { window.location.href = "/?edit=1"; }}
        style={{ padding:"8px 14px", borderRadius:10, border:"1px solid var(--border)", background:"var(--surface2)",
          color:"var(--text)", fontSize:13, fontWeight:700, cursor:"pointer" }}>Personnaliser l'accueil</button>
    </div>
  );
}
const cardTitle = {
  fontSize:15.5, fontWeight:900, color:"var(--text)", marginBottom:12, display:"flex", alignItems:"center", gap:8,
};

// La disposition des AMS se regle dans la tuile AMS de l'accueil (son engrenage).
function AMSOrderSection() {
  return (
    <div className="card" style={card}>
      <p style={cardTitle}>Disposition AMS sur l'accueil</p>
      <CardHelp title="Disposition AMS sur l'accueil">
        L'organisation des AMS se règle maintenant dans la tuile AMS de l'accueil : en personnalisation,
        touche la tuile puis son engrenage.
      </CardHelp>
      <button type="button" onClick={() => { window.location.href = "/?edit=1&tile=ams"; }}
        style={{ padding:"8px 14px", borderRadius:10, border:"1px solid var(--border)", background:"var(--surface2)",
          color:"var(--text)", fontSize:13, fontWeight:700, cursor:"pointer" }}>Régler la tuile AMS</button>
    </div>
  );
}

// Sauvegarde vers le NAS et vidage du local (26/10/2026) : le dossier monte sur /nas, une sauvegarde a la
// demande ou chaque nuit (arborescence humaine : modele / date / 3MF, Photos, Videos, Timelapse, Couches), et
// le vidage des fichiers lourds (videos, timelapses, 3MF, captures des couches) au-dela de N jours, deja sur le NAS.
function ArchiveSection() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const load = () => client.get("/settings/archive").then(r => { setS(r.data); setErr(null); }).catch(e => setErr(e.response?.data?.detail || e.message));
  useEffect(() => { load(); }, []);
  // pendant une sauvegarde ou un vidage : l'avancement, relu toutes les 2 s
  useEffect(() => {
    if (!s?.running) return undefined;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [s?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const put = async body => { try { const { data } = await client.put("/settings/archive", body); setS(data); } catch (e) { showAlert(e.response?.data?.detail || e.message); } };
  const run = async (what, body) => {
    try {
      const { data } = await client.post(`/settings/archive/${what}`, body || {});
      if (what === "purge" && data?.m_files > 0) egg("grand_menage");
      setTimeout(load, 400);
    }
    catch (e) { showAlert(e.response?.data?.detail || e.message); }
  };
  const go = (n) => n >= 1073741824 ? `${(n / 1073741824).toFixed(1).replace(".", ",")} Go` : n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} Mo` : `${Math.round((n || 0) / 1024)} Ko`;
  const when = iso => iso ? new Date(iso).toLocaleString("fr-FR", { day:"numeric", month:"short", hour:"2-digit", minute:"2-digit" }) : "";
  const sw = (on, flip) => <button type="button" onClick={flip} role="switch" aria-checked={on}
    style={{ width:46, height:26, borderRadius:20, border:"none", cursor:"pointer", position:"relative", flexShrink:0,
      background: on ? "#3b82f6" : "var(--border)", transition:"background .2s" }}>
    <span style={{ position:"absolute", top:3, left: on ? 23 : 3, width:20, height:20, borderRadius:"50%", background:"#fff",
      transition:"left .2s", boxShadow:"0 1px 3px rgba(0,0,0,0.3)" }}/></button>;
  const btn = (bg, dis) => ({ display:"flex", alignItems:"center", gap:8, padding:"9px 16px", background: dis ? "var(--border)" : bg, border:"none",
    borderRadius:10, color:"white", fontSize:13, fontWeight:700, cursor: dis ? "not-allowed" : "pointer" });
  const row = { display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, fontSize:13.5, color:"var(--text2)" };
  const box = { padding:"8px 12px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)", fontSize:12, color:"var(--text2)", lineHeight:1.5 };
  const b = s?.last_backup, p = s?.last_purge, ok = s?.check?.ok;
  return (
    <SwitchCard card={card} cardTitle={cardTitle} title="Sauvegarde et NAS" on={!!s?.nightly} onToggle={s ? () => put({ nightly: !s.nightly }) : null}
      hint={s ? (s.nightly ? `chaque nuit à ${s.hour} h` : "pas de sauvegarde automatique") : null}
      help={<>Copie dans le dossier du NAS monté sur le conteneur : « Impressions », avec « Groupes » (un dossier par groupe : sa fiche, ses photos,
        ses impressions) et « Impressions seules », rangées par modèle puis par date (3MF, Photos, Vidéos, Timelapse, Couches, avec une fiche) ;
        et « Système », la base (14 dernières copies), les photos des filaments, objets, accessoires, 3MF MakerWorld et catalogue Bambu.
        Seul le nouveau est copié ; ce qui change de place ou de nom est déplacé, ce qui est supprimé dans l'appli part dans « _Supprimés ».
        L'interrupteur du titre active la sauvegarde de chaque nuit.</>}>
      {err && <p style={{ color:"#ef4444", fontSize:12.5 }}>{err}</p>}
      {s && <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <div style={{ ...box, borderColor: ok ? "rgba(34,197,94,0.4)" : "rgba(239,68,68,0.4)" }}>
          <b style={{ color: ok ? "#16a34a" : "#ef4444" }}>{ok ? "✓ Dossier prêt" : "✕ Dossier indisponible"}</b> · <code>{s.dir}</code>
          {ok && s.check.disk && <> · {go(s.check.disk.free)} libres sur {go(s.check.disk.total)}</>}
          {ok && s.check.not_mounted && <div style={{ color:"#d97706", fontWeight:700 }}>⚠ Ce dossier n'est pas monté depuis la machine (compose.yaml) : la sauvegarde resterait dans le conteneur.</div>}
          {!ok && <div>{s.check.why}</div>}
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <button onClick={() => run("backup")} disabled={!ok || !!s.running} style={btn("#3b82f6", !ok || !!s.running)}>
            {s.running === "backup" ? <RefreshCw size={14} style={{ animation:"spin 1s linear infinite" }}/> : "💾"}
            {s.running === "backup" ? `Sauvegarde… ${s.progress?.what || ""}` : "Sauvegarder maintenant"}</button>
        </div>
        {b && <div style={box}>Dernière sauvegarde ({b.trigger}) : {when(b.at)} · {b.error ? <b style={{ color:"#ef4444" }}>{b.error}</b>
          : <>{b.copied} fichier{b.copied > 1 ? "s" : ""} copié{b.copied > 1 ? "s" : ""} ({go(b.bytes)}), {b.skipped} déjà là, {b.moved ? `${b.moved} déplacé${b.moved > 1 ? "s" : ""}, ` : ""}{b.set_aside ? `${b.set_aside} mis de côté (supprimé${b.set_aside > 1 ? "s" : ""} dans l'appli), ` : ""}{b.deduped ? `${b.deduped} doublon${b.deduped > 1 ? "s" : ""} de 3MF retiré${b.deduped > 1 ? "s" : ""}, ` : ""}{b.prints} impression{b.prints > 1 ? "s" : ""} mise{b.prints > 1 ? "s" : ""} à jour{b.errors ? `, ${b.errors} erreur${b.errors > 1 ? "s" : ""}` : ""}{b.db ? " · base copiée" : ""} · {b.seconds} s</>}</div>}
        <div style={row}><span>Sauvegarder chaque nuit à</span>
          <span style={{ display:"flex", alignItems:"center", gap:8 }}>
            <select value={s.hour} onChange={e => put({ hour: Number(e.target.value) })} style={{ padding:"4px 8px", borderRadius:8, border:"1px solid var(--border)",
              background:"var(--surface2)", color:"var(--text)" }}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h} h</option>)}</select>
            {sw(s.nightly, () => put({ nightly: !s.nightly }))}</span></div>
        <div style={{ borderTop:"1px solid var(--border)", paddingTop:10, display:"flex", flexDirection:"column", gap:10 }}>
          <span style={{ fontSize:13, fontWeight:800, color:"var(--text2)", display:"flex", alignItems:"center" }}>🧹 Vider le local
            <CardHelp inline title="Vider le local">
              Retire de l'appli les vidéos, timelapses, 3MF et captures des couches des impressions plus anciennes que
              le délai, et les vues 3D, 3MF d'origine et documents des modèles dont la dernière impression est plus ancienne
              que le délai, <b>seulement s'ils sont déjà sur le NAS</b>. Les photos restent toujours. Ce qui est retiré reste
              visible : l'appli le relit sur le NAS.</CardHelp></span>
          <div style={row}><span>Plus anciennes que</span>
            <select value={s.purge_days} onChange={e => put({ purge_days: Number(e.target.value) })} style={{ padding:"4px 8px", borderRadius:8,
              border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)" }}>
              {[7, 14, 30, 60, 90, 180, 365].map(d => <option key={d} value={d}>{d} jours</option>)}</select></div>
          <div style={row}><span>Vider aussi chaque nuit, après la sauvegarde</span>{sw(s.purge_auto, () => put({ purge_auto: !s.purge_auto }))}</div>
          <button onClick={async () => { if (await showConfirm(`Vider du local les fichiers lourds des impressions de plus de ${s.purge_days} jours déjà sauvegardés sur le NAS ?`,
            { confirmLabel: "Vider" })) run("purge", { days: s.purge_days }); }} disabled={!ok || !!s.running}
            style={{ ...btn("#f97316", !ok || !!s.running), alignSelf:"flex-start" }}>
            {s.running === "purge" ? <RefreshCw size={14} style={{ animation:"spin 1s linear infinite" }}/> : "🧹"}
            {s.running === "purge" ? `Vidage… ${s.progress?.what || ""}` : "Vider le local maintenant"}</button>
          {p && <div style={box}>Dernier vidage ({p.trigger}) : {when(p.at)} · {p.error ? <b style={{ color:"#ef4444" }}>{p.error}</b>
            : <>{p.files} fichier{p.files > 1 ? "s" : ""} retiré{p.files > 1 ? "s" : ""} ({go(p.bytes)}){p.m_files ? `, ${p.m_files} fichier${p.m_files > 1 ? "s" : ""} de modèle (${go(p.m_bytes || 0)})` : ""}{p.kept_not_archived ? `, ${p.kept_not_archived} gardé${p.kept_not_archived > 1 ? "s" : ""} (pas encore sur le NAS)` : ""}</>}</div>}
        </div>
      </div>}
    </SwitchCard>
  );
}

// La carte SD de l'imprimante (26/10/2026) : une sonde, en lecture seule. Elle liste la racine et le dossier
// des timelapses, pour savoir si l'imprimante les ouvre avant de construire leur lecture dans l'appli.
function SdProbeSection() {
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState(null);
  const run = async () => {
    setRunning(true); setRes(null);
    try { const { data } = await client.get("/printer/sd/probe", { timeout: 120000 }); setRes(data); }
    catch (e) { setRes({ ok: false, error: e.response?.data?.detail || e.message }); }
    finally { setRunning(false); }
  };
  const mo = n => n >= 1048576 ? `${(n / 1048576).toFixed(1).replace(".", ",")} Mo` : n >= 1024 ? `${Math.round(n / 1024)} Ko` : `${n} o`;
  const LABEL = { "/": "Racine", "/timelapse": "Timelapses", "/timelapse/thumbnail": "Vignettes des timelapses" };
  return (
    <div className="card" style={card}>
      <p style={cardTitle}>Stockage de l'imprimante</p>
      <CardHelp title="Stockage de l'imprimante">
        Teste l'accès au stockage de l'imprimante (carte SD ou clé USB, par le réseau local, en lecture seule) : ce qu'il
        contient à la racine et dans le dossier des timelapses. S'il s'ouvre, on peut parcourir et regarder les timelapses dans l'appli.</CardHelp>
      <button onClick={run} disabled={running}
        style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 16px",
          background: running ? "var(--border)" : "#3b82f6", border:"none", borderRadius:10,
          color:"white", fontSize:13, fontWeight:700, cursor: running ? "not-allowed" : "pointer" }}>
        {running ? <RefreshCw size={14} style={{ animation:"spin 1s linear infinite" }}/> : "💾"}
        {running ? "Lecture du stockage…" : "Tester l'accès"}
      </button>
      {res && (
        <div style={{ marginTop:14, display:"flex", flexDirection:"column", gap:8, fontSize:12 }}>
          <p style={{ margin:0, fontWeight:800, color: res.ok ? "#16a34a" : "#ef4444" }}>
            {res.ok ? "✓ Le stockage s'ouvre" : `✕ ${res.error || "Accès impossible"}`}</p>
          {Object.entries(res.folders || {}).map(([path, f]) => (
            <div key={path} style={{ padding:"8px 12px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
              <p style={{ margin:"0 0 4px", fontWeight:800, color:"var(--text)" }}>{LABEL[path] || path}
                <span style={{ fontWeight:600, color:"var(--muted)" }}> · {f.error ? f.error : `${f.count} élément${f.count > 1 ? "s" : ""}`}</span></p>
              {(f.items || []).slice(0, 30).map(x => (
                <div key={x.name} style={{ display:"flex", gap:8, color:"var(--text2)", fontFamily:"monospace", fontSize:11.5 }}>
                  <span style={{ flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{x.dir ? "📁 " : ""}{x.name}</span>
                  {!x.dir && <span style={{ color:"var(--muted)" }}>{mo(x.size)}</span>}
                  <span style={{ color:"var(--muted)" }}>{x.when}</span>
                </div>))}
              {f.count > 30 && <p style={{ margin:"4px 0 0", color:"var(--muted)" }}>… et {f.count - 30} autres</p>}
              {f.raw?.length > 0 && <pre style={{ margin:"4px 0 0", fontSize:10.5, color:"var(--muted)", whiteSpace:"pre-wrap" }}>{f.raw.join("\n")}</pre>}
            </div>))}
        </div>
      )}
    </div>
  );
}

function EnrichFromCatalogSection() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    setRunning(true); setResult(null);
    try {
      const { data } = await client.post("/filaments/filaments/enrich-from-catalog");
      setResult(data);
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setRunning(false); }
  };

  return (
    <div className="card" style={card}>
      <p style={cardTitle}>Enrichissement catalogue Bambu</p>
      <CardHelp title="Enrichissement catalogue Bambu">
        Pour tous les filaments Bambu en base (avec Profile ID), cherche leur fiche officielle
        dans le catalogue et met à jour : nom, code couleur, type multicolore, couleurs…
      </CardHelp>
      <button onClick={run} disabled={running}
        style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 16px",
          background: running ? "var(--border)" : "#3b82f6", border:"none", borderRadius:10,
          color:"white", fontSize:13, fontWeight:700, cursor: running ? "not-allowed" : "pointer" }}>
        {running ? <RefreshCw size={14} style={{ animation:"spin 1s linear infinite" }}/> : "🔍"}
        {running ? "Recherche en cours…" : "Enrichir depuis le catalogue Bambu"}
      </button>
      {result && (
        <div style={{ marginTop:14, padding:"10px 14px", borderRadius:10,
          background:"var(--surface2)", border:"1px solid var(--border)", fontSize:12 }}>
          <p style={{ fontWeight:700, color:"var(--text)", margin:"0 0 8px" }}>
            Résultat — {result.total_bambu} filament(s) Bambu en base
          </p>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:10 }}>
            <span style={{ color:"#22c55e", fontWeight:700 }}>✓ {result.updated} mis à jour</span>
            <span style={{ color:"#f59e0b", fontWeight:700 }}>⚠ {result.not_found} introuvables dans le catalogue</span>
            <span style={{ color:"var(--muted)" }}>— {result.skipped} ignorés (sans couleur hex)</span>
          </div>
          {result.details?.updated?.length > 0 && (
            <div>
              <p style={{ color:"var(--muted)", margin:"0 0 4px", textTransform:"uppercase", fontSize:10, letterSpacing:"0.06em" }}>Mis à jour</p>
              {result.details.updated.map(f => (
                <div key={f.id} style={{ fontSize:11, color:"var(--text)", padding:"2px 0" }}>
                  #{f.id} {f.name} → {f.changes.join(", ")}
                </div>
              ))}
            </div>
          )}
          {result.details?.not_found?.length > 0 && (
            <div style={{ marginTop:8 }}>
              <p style={{ color:"var(--muted)", margin:"0 0 4px", textTransform:"uppercase", fontSize:10, letterSpacing:"0.06em" }}>Introuvables</p>
              {result.details.not_found.map(f => (
                <div key={f.id} style={{ fontSize:11, color:"#f59e0b", padding:"2px 0" }}>
                  #{f.id} {f.name} (profil {f.profile_id}, couleur #{f.color})
                </div>
              ))}
            </div>
          )}
          {result.details?.no_profile?.length > 0 && (
            <div style={{ marginTop:8 }}>
              <p style={{ color:"var(--muted)", margin:"0 0 4px", textTransform:"uppercase", fontSize:10, letterSpacing:"0.06em" }}>
                Sans Profile ID — non enrichissables
              </p>
              {result.details.no_profile.map(f => (
                <div key={f.id} style={{ fontSize:11, color:"var(--muted)", padding:"2px 0" }}>
                  #{f.id} {f.name}{f.manufacturer ? ` · ${f.manufacturer}` : ""}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


// ── Mon compte : changer son propre mot de passe (tous les roles) ──────────
function MyAccountSection() {
  const username = useAuth((s) => s.username);
  const role     = useAuth((s) => s.role);
  const [f, setF] = React.useState({ current:"", next:"", confirm:"" });
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg]   = React.useState(null);

  // les champs et libelles communs de la page (inp, lbl)
  const submit = async () => {
    setMsg(null);
    if (f.next.length < 4)      return setMsg({ err:true, t:"Mot de passe trop court (4 caractères minimum)" });
    if (f.next !== f.confirm)   return setMsg({ err:true, t:"La confirmation ne correspond pas" });
    setBusy(true);
    try {
      const r = await client.post("/auth/change-password", { current_password: f.current, new_password: f.next });
      // Le serveur ejecte toutes les sessions du compte, y compris celle-ci.
      // Il renvoie un jeton neuf pour qu'on ne se deconnecte pas soi-meme en
      // changeant son propre mot de passe -- les autres appareils, eux, tombent.
      if (r.data?.access_token) localStorage.setItem("token", r.data.access_token);
      setF({ current:"", next:"", confirm:"" });
      setMsg({ err:false, t:"Mot de passe modifié." });
    } catch(e) {
      setMsg({ err:true, t: e.response?.data?.detail || e.message });
    }
    setBusy(false);
  };

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 4px",
        display:"flex", alignItems:"center", gap:7 }}>
        <KeyRound size={15}/> Mon compte
      </h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 14px" }}>
        {username ? <b>{username}</b> : "Compte courant"}
        {" — "}
        {(ROLE_LABEL[role] || ROLE_LABEL[ROLE_ADMIN]).toLowerCase()}
      </p>
      <div style={{ display:"flex", flexDirection:"column", gap:10, maxWidth:360 }}>
        <div><label style={lbl}>Mot de passe actuel</label>
          <input style={inp} type="password" value={f.current}
            onChange={e=>setF(v=>({...v,current:e.target.value}))}/></div>
        <div><label style={lbl}>Nouveau mot de passe</label>
          <input style={inp} type="password" value={f.next}
            onChange={e=>setF(v=>({...v,next:e.target.value}))}/></div>
        <div><label style={lbl}>Confirmer</label>
          <input style={inp} type="password" value={f.confirm}
            onChange={e=>setF(v=>({...v,confirm:e.target.value}))}/></div>
        {msg && <p style={{ fontSize:12, margin:0, color: msg.err ? "#ef4444" : "#22c55e" }}>{msg.t}</p>}
        <button onClick={submit} disabled={busy || !f.current || !f.next}
          style={{ padding:"9px 18px", borderRadius:10, border:"none", background:"#3b82f6",
            color:"white", fontSize:13, fontWeight:700, alignSelf:"flex-start",
            cursor:(busy||!f.current||!f.next)?"not-allowed":"pointer",
            opacity:(busy||!f.current||!f.next)?0.6:1 }}>
          {busy ? "Modification…" : "Changer le mot de passe"}
        </button>
      </div>
    </div>
  );
}

// ── Utilisateurs (administrateurs seulement) ──────────────────────────────
// Comptes dont l'activite fait avancer les succes (journal, easter eggs). Les
// autres jouent quand meme : ils voient le bandeau, marque « non comptabilise ».
function AchievementUsersSection() {
  const [list, setList] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const load = () => client.get("/achievements/users").then(r => setList(Array.isArray(r.data) ? r.data : [])).catch(() => setList([]));
  React.useEffect(() => { load(); }, []);
  // f : "counted" (fait avancer les succes), "family" (ses propres secrets), "wheel" (peut tourner la roue)
  const toggle = async (u, f = "counted") => {
    const next = list.map(x => x.username === u ? { ...x, [f]: !x[f] } : x);
    setList(next); setBusy(true);
    try { await client.put("/achievements/users", { [f]: next.filter(x => x[f] && !(f !== "counted" && x.main)).map(x => x.username) }); }
    catch { load(); }
    setBusy(false);
  };
  const pill = (u, f, on, label, color) => (
    <button type="button" disabled={busy || u.main} onClick={() => toggle(u.username, f)}
      title={u.main ? "Le compte principal a tout" : undefined}
      style={{ padding:"3px 9px", borderRadius:20, fontSize:11.5, fontWeight:800, cursor: u.main ? "default" : "pointer",
        border:`1px solid ${on ? color : "var(--border)"}`, background: on ? `${color}22` : "transparent",
        color: on ? color : "var(--muted)", opacity: u.main ? 0.7 : 1 }}>{on ? "✓ " : ""}{label}</button>
  );
  return (
    <div className="card" style={{ padding:"14px 16px", display:"flex", flexDirection:"column", gap:10 }}>
      <div style={{ fontSize:14, fontWeight:800, color:"var(--text)" }}>🏆 Comptes qui font avancer les succès</div>
      <CardHelp title="Comptes qui font avancer les succès">
      <p style={{ margin:0 }}>
        Visites, fiches consultées, actions et easter eggs ne comptent que pour les comptes cochés. Les autres peuvent
        jouer et trouver les secrets : ils voient le succès, marqué « non comptabilisé ».</p>
      <p style={{ margin:0 }}>
        <b style={{ color:"#EC4899" }}>🥚 Ses secrets</b> : le compte cherche les easter eggs, cachettes, farces, fêtes, pages cachées et
        secrets Android pour lui-même, et voit ceux de la maison comme un copain. <b style={{ color:"#8B5CF6" }}>🎰 Roue</b> : il peut
        tourner la roue (le lot va à la maison). Clés et tickets restent au compte principal.</p>
      </CardHelp>
      {!list ? <span style={{ fontSize:12.5, color:"var(--muted)" }}>Chargement…</span>
        : list.map(u => (
          <div key={u.username} style={{ display:"flex", flexDirection:"column", gap:4, padding:"4px 0", opacity: u.active ? 1 : 0.55 }}>
          <label style={{ display:"flex", alignItems:"center", gap:10, padding:"2px 2px", cursor:"pointer" }}>
            <input type="checkbox" checked={u.counted} disabled={busy} onChange={() => toggle(u.username)}
              style={{ width:18, height:18, accentColor:"#F59E0B" }}/>
            <span style={{ flex:1, minWidth:0, fontSize:13.5, fontWeight:700, color:"var(--text)" }}>{u.username}
              <span style={{ fontWeight:500, fontSize:11.5, color:"var(--muted)" }}>
                {" "}· {u.role === "admin" ? "administrateur" : "lecture seule"}{u.friend ? " · invitation copain" : ""}
                {!u.active ? " · désactivé" : ""}</span></span>
            <span style={{ fontSize:11.5, fontWeight:800, color: u.counted ? "#22c55e" : "var(--muted)" }}>
              {u.counted ? "compte" : "ne compte pas"}</span>
          </label>
          {!u.friend && <div style={{ display:"flex", gap:6, flexWrap:"wrap", paddingLeft:30 }}>
            {u.main ? <span style={{ fontSize:11.5, fontWeight:800, color:"#8B5CF6" }}>👑 compte principal : clés, tickets et roue</span>
              : <>{pill(u, "family", u.family, "🥚 ses secrets", "#EC4899")}{pill(u, "wheel", u.wheel, "🎰 roue", "#8B5CF6")}</>}
          </div>}
          </div>
        ))}
    </div>
  );
}

function UsersSection() {
  const isAdmin = useIsAdmin();
  const meName  = useAuth((s) => s.username);
  const [list, setList]   = React.useState(null);
  const [busy, setBusy]   = React.useState(false);
  const [err, setErr]     = React.useState(null);
  const [creating, setCreating] = React.useState(false);
  const [nf, setNf] = React.useState({ username:"", password:"", role: ROLE_READONLY });
  const [confirmDel, setConfirmDel] = React.useState(null);
  const [pwdFor, setPwdFor] = React.useState(null);   // id du compte dont on change le mdp
  const [pwdVal, setPwdVal] = React.useState("");

  const load = React.useCallback(async () => {
    try { const { data } = await client.get("/users"); setList(data); setErr(null); }
    catch(e) { setList([]); setErr(e.response?.status === 403 ? null : (e.response?.data?.detail || e.message)); }
  }, []);
  React.useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);

  if (!isAdmin) return null;

  const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
    padding:"8px 12px", fontSize:13, color:"var(--text)", outline:"none", width:"100%", boxSizing:"border-box" };

  // Pastilles d'action, meme grammaire que partout ailleurs dans l'application
  // (bouton Journal du header, filtres du journal d'activite) : forme arrondie,
  // fond transparent, contour fin, couleur porteuse de sens. Les boutons
  // precedents etaient des paves opaques en var(--bg), plus lourds que le
  // contenu qu'ils accompagnaient et etrangers au reste de l'interface.
  const pill = (color, border) => ({
    padding:"4px 11px", borderRadius:20, fontSize:11, fontWeight:600,
    cursor:"pointer", background:"transparent", whiteSpace:"nowrap",
    border:`1px solid ${border || "var(--border)"}`, color,
  });

  const act = async (fn) => {
    setBusy(true); setErr(null);
    try { await fn(); await load(); }
    catch(e) { setErr(e.response?.data?.detail || e.message); }
    setBusy(false);
  };

  const create = () => act(async () => {
    await client.post("/users", { username: nf.username.trim(), password: nf.password, role: nf.role });
    setNf({ username:"", password:"", role: ROLE_READONLY }); setCreating(false);
  });

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 4px",
        display:"flex", alignItems:"center", gap:7 }}>
        <Users size={15}/> Utilisateurs
      </h3>
      <CardHelp title="Utilisateurs">
        Un compte <b>administrateur</b> a tous les droits. Un compte <b>lecture seule (avec
        prix)</b> consulte tout, montants compris, sans rien pouvoir modifier. Un compte <b>lecture seule</b> peut
        tout consulter, sans aucune modification, et les montants lui sont masqués.
      </CardHelp>

      {err && <p style={{ fontSize:12, color:"#ef4444", margin:"0 0 10px" }}>{err}</p>}

      {list === null ? (
        <p style={{ fontSize:12, color:"var(--muted)" }}>Chargement…</p>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12 }}>
          {list.map(u => (
            <div key={u.id} style={{ background:"var(--surface2)", border:"1px solid var(--border)",
              borderRadius:10, padding:"10px 12px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                <span style={{ fontSize:13, fontWeight:700, flex:1, minWidth:100 }}>
                  {u.username}{u.username === meName ? " (vous)" : ""}
                </span>
                <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
                  background: u.role === ROLE_ADMIN ? "rgba(59,130,246,0.12)" : "rgba(148,163,184,0.15)",
                  color: u.role === ROLE_ADMIN ? "#60a5fa" : "#94a3b8" }}>
                  {ROLE_BADGE[u.role] || u.role}
                </span>
                {u.protected && (
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
                    background:"rgba(245,158,11,0.12)", color:"#f59e0b" }}>Principal</span>
                )}
                {!u.active && (
                  <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
                    background:"rgba(239,68,68,0.12)", color:"#ef4444" }}>Désactivé</span>
                )}
                {u.totp_enabled && (
                  <span title="Double authentification active"
                    style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
                    background:"rgba(34,197,94,0.12)", color:"#22c55e" }}>2FA</span>
                )}
              </div>
              {/* Derniere utilisation : elle a sa place ici, aupres du compte,
                  plutot que dans une seconde liste de comptes ailleurs. */}
              <p style={{ fontSize:11, color:"var(--muted)", margin:"4px 0 0" }}>
                {u.last_seen ? `Vu ${ago(u.last_seen)} · ${stamp(u.last_seen)}` : "Jamais utilisé"}
              </p>
              <div style={{ display:"flex", gap:6, marginTop:8, flexWrap:"wrap" }}>
                {/* Le compte principal et le sien propre ne sont pas modifiables
                    (hors mot de passe) : on evite de se couper l'acces. */}
                {/* Transmettre le role de compte principal : l'ancien devient
                    un administrateur ordinaire (supprimable). */}
                {!u.protected && u.role === ROLE_ADMIN && u.active && (
                  <button disabled={busy}
                    onClick={async ()=>{ if (await showConfirm(`Faire de « ${u.username} » le compte principal ?\n\n`
                      + "Le compte principal ne peut être ni supprimé, ni désactivé, ni rétrogradé. L'actuel compte "
                      + "principal deviendra un administrateur ordinaire, que tu pourras supprimer.",
                      { confirmLabel:"Rendre principal" })) act(()=>client.post(`/users/${u.id}/primary`)); }}
                    style={pill("#f59e0b", "rgba(245,158,11,0.35)")}>
                    ★ Rendre principal
                  </button>
                )}
                {!u.protected && u.username !== meName && (<>
                {/* Avec trois roles, la bascule binaire n'a plus de sens : on
                    propose les roles autres que le sien. */}
                {ROLE_OPTIONS.filter(([r]) => r !== u.role).map(([r,l]) => (
                  <button key={r} disabled={busy}
                    onClick={()=>act(()=>client.patch(`/users/${u.id}`, { role: r }))}
                    style={pill("#60a5fa", "rgba(59,130,246,0.35)")}>
                    → {l}
                  </button>
                ))}
                {/* Droit MakerWorld : j'aime, collections, boosts, evaluations, « A faire »
                    avec le compte MakerWorld de la maison (un admin l'a d'office). */}
                {u.role !== ROLE_ADMIN && (
                  <label style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11.5, fontWeight:600,
                    color:"var(--text)", cursor: busy ? "default" : "pointer" }}
                    title="J'aime, collections, boosts, évaluations et « À faire » avec le compte MakerWorld de la maison">
                    <input type="checkbox" checked={!!u.mw_write} disabled={busy}
                      onChange={e => act(() => client.patch(`/users/${u.id}`, { mw_write: e.target.checked }))}/>
                    Actions MakerWorld
                  </label>
                )}
                {/* Succes secrets (medailles uniques) : sans cette option, ce
                    compte -- et la cle de copain qui en depend -- voit la
                    medaille, son titre et sa date, pas ce qui l'a valu. */}
                <label style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11.5, fontWeight:600,
                  color:"var(--text)", cursor: busy ? "default" : "pointer" }}
                  title="Ce qui a valu tes médailles uniques. Sans cette option : la médaille, son titre et sa date seulement (sauf celles qu'un copain a aussi gagnées).">
                  <input type="checkbox" checked={!!u.secrets_visible} disabled={busy}
                    onChange={e => act(() => client.patch(`/users/${u.id}`, { secrets_visible: e.target.checked }))}/>
                  Voit mes succès secrets
                </label>
                {/* Telephone perdu sans code de secours : un admin retire la 2FA,
                    l'utilisateur la reactivera lui-meme. */}
                {u.totp_enabled && (
                  <button disabled={busy}
                    onClick={async ()=>{ if (await showConfirm(`Retirer la double authentification de « ${u.username} » ?`,
                      { confirmLabel:"Retirer" })) act(()=>client.post(`/users/${u.id}/2fa/reset`)); }}
                    style={pill("#a78bfa", "rgba(167,139,250,0.35)")}>
                    Retirer la 2FA
                  </button>
                )}
                <button disabled={busy} onClick={()=>act(()=>client.patch(`/users/${u.id}`, { active: !u.active }))}
                  style={u.active ? pill("#f59e0b", "rgba(245,158,11,0.35)")
                                  : pill("#22c55e", "rgba(34,197,94,0.35)")}>
                  {u.active ? "Désactiver" : "Réactiver"}
                </button>
                <button disabled={busy}
                  onClick={()=> confirmDel === u.id
                    ? act(async ()=>{ await client.delete(`/users/${u.id}`); setConfirmDel(null); })
                    : setConfirmDel(u.id)}
                  style={{ ...pill("#ef4444", "rgba(239,68,68,0.35)"),
                    // Seule exception au fond transparent : une fois armee, la
                    // suppression doit se distinguer nettement du reste.
                    ...(confirmDel === u.id
                      ? { background:"#ef4444", color:"white", borderColor:"#ef4444" }
                      : {}) }}>
                  {confirmDel === u.id ? "Confirmer ?" : <Trash2 size={12}/>}
                </button>
                </>)}
                <button disabled={busy} onClick={()=>{ setPwdFor(pwdFor===u.id?null:u.id); setPwdVal(""); }}
                  style={pill("var(--muted)")}>
                  Mot de passe
                </button>
                {/* Un copain parcourt ce BambuNymous avec les droits de ce compte. */}
                {u.role !== ROLE_ADMIN && u.active && <FriendKeyButtons user={u} onChanged={load} pill={pill}/>}
              </div>
              {pwdFor === u.id && (
                <div style={{ display:"flex", gap:6, marginTop:8 }}>
                  <input style={{ ...inp, flex:1 }} type="password" placeholder="Nouveau mot de passe"
                    value={pwdVal} onChange={e=>setPwdVal(e.target.value)}/>
                  <button disabled={busy || pwdVal.length < 4}
                    onClick={()=>act(async ()=>{ await client.patch(`/users/${u.id}`, { password: pwdVal });
                      setPwdFor(null); setPwdVal(""); })}
                    style={{ padding:"8px 14px", borderRadius:8, border:"none", background:"#3b82f6",
                      color:"white", fontSize:12, fontWeight:700,
                      cursor: pwdVal.length < 4 ? "not-allowed" : "pointer",
                      opacity: pwdVal.length < 4 ? 0.6 : 1 }}>OK</button>
                </div>
              )}
            </div>
          ))}
          {list.length === 0 && (
            <p style={{ fontSize:12, color:"var(--muted)" }}>Aucun compte enregistré.</p>
          )}
        </div>
      )}

      {!creating ? (
        <button onClick={()=>setCreating(true)}
          style={{ padding:"8px 16px", borderRadius:10, border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text)", fontSize:12, fontWeight:700,
            cursor:"pointer" }}>+ Nouvel utilisateur</button>
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:8, maxWidth:360 }}>
          <input style={inp} placeholder="Nom d'utilisateur" value={nf.username}
            onChange={e=>setNf(v=>({...v,username:e.target.value}))}/>
          <input style={inp} type="password" placeholder="Mot de passe" value={nf.password}
            onChange={e=>setNf(v=>({...v,password:e.target.value}))}/>
          {/* En colonne : a trois options, les libelles ne tiennent plus cote
              a cote sur un ecran de telephone. */}
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {ROLE_OPTIONS.map(([r,l])=>(
              <button key={r} onClick={()=>setNf(v=>({...v,role:r}))}
                style={{ padding:"8px", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer",
                  textAlign:"left",
                  border:"1px solid " + (nf.role===r ? "#3b82f6" : "var(--border)"),
                  background: nf.role===r ? "rgba(59,130,246,0.12)" : "var(--surface2)",
                  color: nf.role===r ? "#60a5fa" : "var(--muted)" }}>{l}</button>
            ))}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={()=>{ setCreating(false); setErr(null); }}
              style={{ flex:1, padding:"9px", borderRadius:10, border:"1px solid var(--border)",
                background:"var(--surface2)", color:"var(--muted)", fontSize:12, cursor:"pointer" }}>Annuler</button>
            <button onClick={create} disabled={busy || !nf.username.trim() || nf.password.length < 4}
              style={{ flex:2, padding:"9px", borderRadius:10, border:"none", background:"#3b82f6",
                color:"white", fontSize:12, fontWeight:700,
                cursor:(!nf.username.trim()||nf.password.length<4)?"not-allowed":"pointer",
                opacity:(busy||!nf.username.trim()||nf.password.length<4)?0.6:1 }}>Créer</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Couleur par methode : on lit la nature de l'action avant meme son libelle.
const METHOD_STYLE = {
  POST:   ["#22c55e", "rgba(34,197,94,0.12)"],
  PUT:    ["#3b82f6", "rgba(59,130,246,0.12)"],
  PATCH:  ["#3b82f6", "rgba(59,130,246,0.12)"],
  DELETE: ["#ef4444", "rgba(239,68,68,0.12)"],
};
const ACT_PAGE = 50;
const ACT_KINDS = [["", "Tout"], ["action", "Actions"],
                   ["visite", "Pages"], ["detail", "Détails"]];
const KIND_STYLE = {
  visite: ["#a78bfa", "rgba(167,139,250,0.12)", "PAGE"],
  detail: ["#22d3ee", "rgba(34,211,238,0.12)", "VUE"],
};
// Fenetres proposees. Celles qui depassent la duree de conservation renvoyee
// par l'API sont retirees : promettre 30 jours quand la purge en garde 7
// n'aurait affiche que du vide.
const ACT_WINDOWS = [[1,"24 h"],[7,"7 jours"],[30,"30 jours"],[90,"90 jours"]];

function ActivitySection() {
  const isAdmin = useIsAdmin();
  const [days,  setDays]  = React.useState(7);
  const [who,   setWho]   = React.useState("");
  const [kind,  setKind]  = React.useState("");
  const [q,     setQ]     = React.useState("");     // saisie
  const [query, setQuery] = React.useState("");     // terme effectivement envoye
  const [items, setItems] = React.useState(null);
  const [total, setTotal] = React.useState(0);
  const [keep,  setKeep]  = React.useState(null);   // duree de conservation
  const [names, setNames] = React.useState([]);
  const [busy,  setBusy]  = React.useState(false);
  const [err,   setErr]   = React.useState(null);
  const [purge, setPurge] = React.useState(false);   // confirmation en deux temps

  const load = React.useCallback(async (offset = 0) => {
    setBusy(true); setErr(null);
    try {
      const { data } = await client.get("/users/activity", {
        params: { days, username: who || undefined, kind: kind || undefined,
                  q: query || undefined, limit: ACT_PAGE, offset },
      });
      setTotal(data.total || 0);
      if (data.retention_days) setKeep(data.retention_days);
      // offset 0 = nouveau filtre, on repart de zero ; sinon on empile.
      setItems(prev => offset === 0 ? (data.items || []) : [...(prev || []), ...(data.items || [])]);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
      if (offset === 0) setItems([]);
    }
    setBusy(false);
  }, [days, who, kind, query]);

  React.useEffect(() => { if (isAdmin) load(0); }, [isAdmin, load]);
  // Recherche differee : sans ce delai, chaque touche frappee declencherait un
  // appel et la liste sauterait sous les doigts.
  React.useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => {
    if (!isAdmin) return;
    client.get("/users")
      .then(r => setNames((r.data || []).map(u => u.username)))
      .catch(() => {});   // le filtre reste utilisable sans la liste
  }, [isAdmin]);

  if (!isAdmin) return null;

  const chip = (on) => ({
    padding:"5px 10px", borderRadius:8, fontSize:11, fontWeight:600, cursor:"pointer",
    border:"1px solid " + (on ? "#3b82f6" : "var(--border)"),
    background: on ? "rgba(59,130,246,0.12)" : "var(--surface2)",
    color: on ? "#60a5fa" : "var(--muted)",
  });

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 4px",
        display:"flex", alignItems:"center", gap:7 }}>
        <Activity size={15}/> Activité
        <CardHelp inline title="Activité">
          <b>Actions</b> : créations, modifications, suppressions. <b>Pages</b> : arrivée sur
          une page. <b>Détails</b> : onglet ouvert ou fiche consultée. Les vues ne sont
          enregistrées qu'au changement, jamais en continu.
          {keep ? ` Le journal est purgé au-delà de ${keep} jours.` : ""}</CardHelp>
        {/* Discret et a l'ecart des filtres : c'est une action irreversible,
            elle ne doit pas se trouver sous un doigt qui trie. */}
        <button disabled={busy}
          onClick={() => purge
            ? (async () => {
                setBusy(true);
                try { await client.delete("/users/activity"); setPurge(false); await load(0); }
                catch (e) { setErr(e.response?.data?.detail || e.message); }
                setBusy(false);
              })()
            : setPurge(true)}
          onBlur={() => setPurge(false)}
          style={{ marginLeft:"auto", padding:"3px 9px", borderRadius:7, fontSize:10,
            fontWeight:600, cursor:"pointer", border:"1px solid var(--border)",
            background: purge ? "#ef4444" : "transparent",
            color: purge ? "white" : "var(--muted)" }}>
          {purge ? "Confirmer ?" : "Vider"}
        </button>
      </h3>
      <div style={{ height: 10 }}/>

      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:8 }}>
        {ACT_KINDS.map(([k,l]) => (
          <button key={k} onClick={()=>setKind(k)} style={chip(kind===k)}>{l}</button>
        ))}
      </div>

      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
        {ACT_WINDOWS.filter(([d]) => !keep || d <= keep).map(([d,l]) => (
          <button key={d} onClick={()=>setDays(d)} style={chip(days===d)}>{l}</button>
        ))}
        <input value={q} onChange={e=>setQ(e.target.value)}
          placeholder="Rechercher un libellé…"
          style={{ ...inp, width:"auto", flex:"1 1 140px", minWidth:120,
            fontSize:12, padding:"5px 10px" }}/>
        <Select value={who} onChange={e=>setWho(e.target.value)}
          style={{ ...chip(!!who), marginLeft:"auto", maxWidth:150 }}
          options={[{ value:"", label:"Tous les comptes" },
                    ...names.map(n => ({ value:n, label:n }))]}/>
      </div>

      {err && <p style={{ fontSize:12, color:"#ef4444", margin:"0 0 10px" }}>{err}</p>}

      {items === null ? (
        <p style={{ fontSize:12, color:"var(--muted)" }}>Chargement…</p>
      ) : items.length === 0 ? (
        <p style={{ fontSize:12, color:"var(--muted)" }}>Aucune action sur cette période.</p>
      ) : (
        <>
          <div style={{ display:"flex", flexDirection:"column", gap:4,
            maxHeight:420, overflowY:"auto" }}>
            {items.map(it => {
              const view = it.kind === "visite" || it.kind === "detail";
              const [fg, bg, tag] = KIND_STYLE[it.kind]
                || [...(METHOD_STYLE[it.method] || ["#94a3b8","rgba(148,163,184,0.15)"]), it.method];
              const ko = it.status >= 400;
              return (
                <div key={it.id} style={{ display:"flex", alignItems:"flex-start", gap:8,
                  background:"var(--surface2)", border:"1px solid var(--border)",
                  borderRadius:10, padding:"8px 10px" }}>
                  <span style={{ fontSize:9, fontWeight:700, padding:"2px 6px", borderRadius:6,
                    background:bg, color:fg, flexShrink:0, marginTop:1 }}>{tag}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ margin:0, fontSize:12, fontWeight:600,
                      color: view ? "var(--text2)" : "var(--text)" }}>
                      {it.kind === "visite" ? `Page ${it.label}` : (it.label || it.path)}
                    </p>
                    {/* Le chemin n'apprend rien sur une vue : le libelle dit
                        deja tout, l'afficher ferait du bruit. */}
                    {!view && (
                      <p style={{ margin:"1px 0 0", fontSize:10, color:"var(--muted)",
                        overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                        {it.path}{ko ? ` · échec ${it.status}` : ""}
                      </p>
                    )}
                  </div>
                  <div style={{ textAlign:"right", flexShrink:0 }}>
                    <p style={{ margin:0, fontSize:11, fontWeight:600, color:"var(--text2)" }}>
                      {it.username}
                    </p>
                    <p style={{ margin:"1px 0 0", fontSize:10, color:"var(--muted)" }}>
                      {stamp(it.at)}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10 }}>
            <span style={{ fontSize:11, color:"var(--muted)" }}>
              {items.length} sur {total}
            </span>
            {items.length < total && (
              <button disabled={busy} onClick={()=>load(items.length)}
                style={{ marginLeft:"auto", padding:"5px 12px", borderRadius:20, fontSize:11,
                  fontWeight:600, cursor:"pointer", border:"1px solid var(--border)",
                  background:"transparent", color:"var(--muted)" }}>
                {busy ? "Chargement…" : "Charger plus"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RfidDebugSection() {
  // Visible seulement dans la coquille WebView (window.BambuScan present).
  const isWebView = typeof window !== "undefined" && !!window.BambuScan;
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(null);

  if (!isWebView) return null;

  const load = async () => {
    setLoading(true); setErr(null);
    try {
      const r = await client.get("/rfid/scan/last-debug");
      setData(r.data);
    } catch(e) {
      setErr(e.response?.status === 404
        ? "Aucun scan en mémoire. Scannez un tag d'abord (via le scanner), puis revenez ici."
        : (e.response?.data?.detail || e.message));
    } finally { setLoading(false); }
  };

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>
        Débug RFID
      </h3>
      <CardHelp title="Débug RFID">
        Affiche le détail brut du dernier tag scanné (payload, champs parsés,
        correspondance catalogue, profil résolu). Utile pour vérifier un profil
        quand un scan ouvre directement la fiche d'une bobine existante. Scannez un
        tag, puis appuyez ici.
      </CardHelp>
      <button onClick={load} disabled={loading}
        style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700, cursor:loading?"wait":"pointer",
          border:"none", background:"#3b82f6", color:"white" }}>
        {loading ? "Lecture…" : "Voir le dernier scan"}
      </button>

      {err && <p style={{ fontSize:12, color:"#ef4444", margin:"12px 0 0" }}>{err}</p>}

      {data && (
        <div style={{ marginTop:14 }}>
          {/* Résumé lisible des champs utiles */}
          <div style={{ background:"var(--surface2)", borderRadius:10, padding:"10px 12px", marginBottom:10 }}>
            {[
              ["Tag UID", data.normalized?.tray_uid],
              ["Material ID", data.normalized?.material_id],
              ["Variant ID", data.normalized?.variant_id],
              ["Profil résolu", data.resolved_filament?.profile_id],
              ["Filament", data.resolved_filament?.name],
              ["Matière", data.resolved_filament?.material],
              ["Sous-type", data.resolved_filament?.fila_type],
              ["Catalogue", data.catalog_match ? "trouvé" : "aucun"],
              ["Bobine liée", data.already_linked_spool ? `#${data.already_linked_spool.spool_id}` : "non"],
            ].map(([k,v]) => (
              <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0",
                fontSize:12, borderBottom:"1px solid var(--border)" }}>
                <span style={{ color:"var(--muted)" }}>{k}</span>
                <span style={{ color:"var(--text)", fontFamily:"monospace", textAlign:"right", maxWidth:"60%",
                  overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{v || "—"}</span>
              </div>
            ))}
          </div>
          {/* JSON brut complet, repliable */}
          <details>
            <summary style={{ fontSize:12, color:"#60a5fa", cursor:"pointer", marginBottom:8 }}>
              Données brutes (JSON)
            </summary>
            <pre style={{ fontSize:10, color:"var(--text)", background:"var(--bg)", padding:12,
              borderRadius:8, overflow:"auto", maxHeight:300, margin:0,
              fontFamily:"JetBrains Mono, monospace", whiteSpace:"pre-wrap", wordBreak:"break-all" }}>
{JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

function PriceReviewSection() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <div className="card" style={{ padding:"16px 20px" }}>
        <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>
          Révision des prix
        </h3>
        <CardHelp title="Révision des prix">
          Compare le tarif catalogue de chaque filament au prix d'achat de ses bobines,
          <b> archivées comprises</b>, et permet de corriger sur place. Utile pour repérer
          les prix manquants — qui font retomber le calcul des coûts sur 20 €/kg par
          défaut — et les écarts inhabituels.
        </CardHelp>
        <button onClick={()=>setOpen(true)}
          style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700,
            cursor:"pointer", border:"none", background:"#3b82f6", color:"white" }}>
          Ouvrir la révision
        </button>
      </div>
      {open && <PriceReview onClose={()=>setOpen(false)}/>}
    </>
  );
}

// Cle facultative d'un service de traduction : etat (posee ou non, jamais la
// cle elle-meme), saisie, retrait.
function TranslateKeyRow({ label, on, hint, placeholder, onSave }) {
  const [edit, setEdit] = React.useState(null);           // null = ferme, sinon saisie
  const btn = { padding:"5px 10px", borderRadius:8, fontSize:12, cursor:"pointer",
    background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text)" };
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", margin:"0 0 8px",
      padding:"8px 10px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
      <span style={{ fontSize:12, color:"var(--text)", flex:1, minWidth:180 }}>
        {label} {on
          ? <b style={{ color:"#22c55e" }}>posée</b>
          : <span style={{ color:"var(--muted)" }}>— facultative</span>}
        <span style={{ display:"block", fontSize:11, color:"var(--muted)", marginTop:2 }}>{hint}</span>
      </span>
      {edit == null ? (<>
        <button onClick={() => setEdit("")} style={btn}>{on ? "Changer" : "Ajouter"}</button>
        {on && <button onClick={() => onSave("")} style={{ ...btn, color:"var(--muted)" }}>Retirer</button>}
      </>) : (
        <span style={{ display:"flex", gap:6, flex:"1 1 100%" }}>
          <input value={edit} onChange={e => setEdit(e.target.value)} autoFocus
            autoComplete="off" spellCheck={false} placeholder={placeholder}
            style={{ flex:1, minWidth:0, padding:"6px 9px", borderRadius:8, fontSize:12,
              background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text)", outline:"none",
              fontFamily:"JetBrains Mono,monospace" }}/>
          <button onClick={() => setEdit(null)} style={{ ...btn, color:"var(--muted)" }}>✕</button>
          <button onClick={async () => { if (await onSave(edit.trim())) setEdit(null); }} disabled={!edit.trim()}
            style={{ ...btn, fontWeight:700, background:"#3b82f6", border:"none", color:"white" }}>OK</button>
        </span>
      )}
    </div>
  );
}

// Succes : export des paliers et de ma progression, pour revoir les seuils.
function AchievementsExportSection() {
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState(null);
  const get = async () => (await client.get("/achievements/export", { responseType: "text" })).data;
  const run = async fn => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ ok:false, text: e.response?.data?.detail || e.message }); } setBusy(false); };
  const download = () => run(async () => {
    const blob = new Blob([await get()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `succes-paliers-${new Date().toISOString().slice(0, 10)}.csv`;
    a.dispatchEvent(new MouseEvent("click"));
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setMsg({ ok:true, text:"Fichier téléchargé." });
  });
  const copy = () => run(async () => {
    await navigator.clipboard.writeText((await get()).replace(/^\ufeff/, ""));
    setMsg({ ok:true, text:"Copié : colle-le dans la conversation." });
  });
  const btn = { padding:"8px 14px", borderRadius:10, fontSize:13, fontWeight:700, cursor: busy ? "default" : "pointer",
    border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)" };
  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>🏅 Succès : paliers et progression</h3>
      <CardHelp title="🏅 Succès : paliers et progression">
        Tous les succès à paliers : ce qui compte, ta valeur actuelle, le palier atteint, le prochain seuil, et les seuils de
        Bronze à Éternel. Pour revoir les paliers.</CardHelp>
      <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
        <button onClick={download} disabled={busy} style={btn}>⬇️ Télécharger (CSV)</button>
        <button onClick={copy} disabled={busy} style={btn}>📋 Copier</button>
      </div>
      {msg && <p style={{ fontSize:12, margin:"8px 0 0", color: msg.ok ? "#22c55e" : "#ef4444" }}>{msg.text}</p>}
    </div>
  );
}

function TranslateNamesSection() {
  const [running, setRunning] = React.useState(null);   // null = pas encore su
  const [err, setErr] = React.useState(null);
  const [last, setLast] = React.useState(null);          // bilan du dernier rattrapage
  const [keysOn, setKeysOn] = React.useState({});        // { gcloud, deepl } : cle posee (jamais la cle)
  const [retrySame, setRetrySame] = React.useState(false);

  // L'etat vit sur le serveur, pas ici : c'est lui qui fait tourner le thread.
  // On l'interroge en arrivant, puis toutes les 5 s tant qu'il tourne. Quitter
  // la page, y revenir ou recharger l'application retrouve donc toujours
  // l'etat reel -- ce qu'une boucle cliente ne permettait pas.
  const poll = React.useCallback(async () => {
    try {
      const { data } = await client.get("/prints/translate-missing");
      setRunning(!!data.running);
      setLast(data.last || null);
      setKeysOn({ gcloud: !!data.gcloud, deepl: !!data.deepl });
      return !!data.running;
    } catch { setRunning(false); return false; }
  }, []);

  React.useEffect(() => {
    let alive = true, timer = null;
    const tick = async () => {
      const on = await poll();
      if (alive && on) timer = setTimeout(tick, 5000);
    };
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, [poll]);

  const act = async (stop) => {
    setErr(null);
    try {
      await client.post("/prints/translate-missing", null,
        { params: stop ? { stop } : { retry_same: retrySame } });
      setRunning(!stop);
      if (!stop) setTimeout(poll, 5000);
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
  };

  const saveKey = async (service, key) => {
    setErr(null);
    try {
      const { data } = await client.put("/prints/translate-key", { service, key });
      setKeysOn(k => ({ ...k, [service]: !!data[service] }));
      return true;
    } catch (e) { setErr(e.response?.data?.detail || e.message); return false; }
  };

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>
        Traduire les noms de prints
      </h3>
      <CardHelp title="Traduire les noms de prints">
        Les prints arrivent nommés en anglais ou en chinois : ce rattrapage leur ajoute
        un nom français, utilisé <b>uniquement pour la recherche</b> — le nom d'origine
        reste affiché. Les noms saisis à la main ne sont jamais écrasés. Les nouveaux
        prints sont traduits automatiquement ; ceux qu'un service saturé n'a pas pu
        traduire sont repris seuls toutes les 6 h.
      </CardHelp>

      {/* Ordre : Google Cloud (cle, gratuit jusqu'a 500 000 car./mois,
          renouvele), Google public, DeepL (cle, credit gratuit qui ne se
          renouvelle pas), puis MyMemory en dernier. */}
      <TranslateKeyRow label="Clé Google Cloud Translation" on={keysOn.gcloud}
        hint="Essayée en premier. 500 000 caractères gratuits par mois ; pose un plafond par jour dans la console pour ne jamais payer."
        placeholder="AIza…" onSave={k => saveKey("gcloud", k)}/>
      <TranslateKeyRow label="Clé DeepL" on={keysOn.deepl}
        hint="Après Google, avant MyMemory. Son crédit gratuit ne se renouvelle pas : une fois épuisé, MyMemory prend le relais."
        placeholder="xxxxxxxx-xxxx-…:fx" onSave={k => saveKey("deepl", k)}/>

      <label style={{ display:"flex", alignItems:"center", gap:8, fontSize:12, color:"var(--text2)",
        margin:"12px 0", cursor:"pointer" }}>
        <input type="checkbox" checked={retrySame} onChange={e => setRetrySame(e.target.checked)}/>
        Reprendre aussi les noms restés identiques à l'original (non traduits faute de quota)
      </label>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <button onClick={() => act(running)} disabled={running === null}
          style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700,
            cursor: running === null ? "wait" : "pointer", border:"none",
            background: running ? "var(--border)" : "#3b82f6",
            color: running ? "var(--text)" : "white" }}>
          {running ? "Arrêter" : "⟳ Traduire les noms manquants"}
        </button>
        {running && (
          <span style={{ display:"flex", alignItems:"center", gap:7, fontSize:12,
            color:"#3b82f6", fontWeight:600 }}>
            {/* Le rattrapage dure plusieurs minutes sans rien afficher : il
                faut un signe de vie, sinon on le croit bloque. */}
            <span style={{ width:8, height:8, borderRadius:"50%", background:"#3b82f6",
              animation:"pulse 1.2s ease-in-out infinite" }}/>
            Traduction en cours…
          </span>
        )}
        {err && <span style={{ fontSize:12, color:"#ef4444" }}>{err}</span>}
      </div>
      {!running && last && (
        <p style={{ fontSize:11.5, color:"var(--muted)", margin:"10px 0 0" }}>
          Dernier passage : {last.translated} traduit{last.translated > 1 ? "s" : ""},
          {" "}{last.skipped} déjà en français
          {last.failed > 0 && <span style={{ color:"#f59e0b" }}>, {last.failed} en attente (services saturés, repris dans 6 h)</span>}
        </p>
      )}
    </div>
  );
}

function RecalculateSection() {
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const run = async () => {
    setLoading(true); setDone(false);
    try {
      await client.post("/prints/recalculate-all");
      setDone(true);
      setTimeout(() => setDone(false), 5000);
    } catch(e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>
        Recalculer les coûts
      </h3>
      <CardHelp title="Recalculer les coûts">
        Recalcule les coûts filament et électricité de tous les prints (utile après changement de prix ou d'import). Les groupes se mettent à jour automatiquement.
      </CardHelp>
      <button onClick={run} disabled={loading}
        style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700, cursor:loading?"wait":"pointer",
          border:"none", background: done ? "#22c55e" : loading ? "var(--border)" : "#3b82f6",
          color:"white", display:"flex", alignItems:"center", gap:8 }}>
        {loading ? "Recalcul en cours…" : done ? "✓ Recalcul lancé" : "⟳ Recalculer tous les prints"}
      </button>
    </div>
  );
}
// Export de diagnostic : les impressions recentes telles qu'en base (dates, durees, pauses, statut)
// et le calcul jour par jour, dans un fichier a transmettre quand un chiffre parait faux.
// L'espace de stockage : un bouton, et la fenetre (anneau par sorte de fichiers, disque, impressions lourdes)
// La vitesse du serveur (26/10/2026) : pour chaque route de l'API, le delai de reponse (jusqu'au premier
// octet) depuis le demarrage, les plus lentes d'abord. Sert a optimiser ce qui est lent pour de vrai.
function PerfSection() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState(false);
  const load = () => client.get("/settings/perf").then(r => setD(r.data)).catch(() => {});
  useEffect(() => { load(); }, []);
  const reset = () => client.post("/settings/perf/reset").then(r => setD(r.data)).catch(e => showAlert(e.response?.data?.detail || e.message));
  const rows = perfSort((d?.routes || []).filter(r => r.count > 0));
  const slow = rows.filter(perfSlow).length, bad = rows.filter(perfBad).length;
  const since = d ? new Date(d.since * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <div className="card" style={card}>
      <p style={cardTitle}>Vitesse du serveur</p>
      <CardHelp title="Vitesse du serveur">
        Le temps que met le serveur à répondre, depuis {since || "le démarrage"}{d ? ` (${d.requests.toLocaleString("fr-FR")} appels)` : ""}.
        Chaque chiffre est une moyenne qui laisse de côté les 5 % d'appels les plus lents : un appel lent isolé ne fait pas
        passer une route à l'orange. En tête, l'ensemble ; dessous, les plus lentes d'abord.</CardHelp>
      {d && <>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:10 }}>
          {[[d.t95_all != null ? perfMs(d.t95_all) : "—", "par appel en moyenne", d.t95_all == null ? "var(--text)" : perfTone(d.t95_all, "")],
            [slow, "plus lentes qu'attendu", slow ? "#f59e0b" : "#16a34a"],
            [bad, "bien trop lentes", bad ? "#ef4444" : "#16a34a"]].map(([n, l, c]) => (
            <span key={l} style={{ flex:"1 1 90px", padding:"7px 10px", borderRadius:12, background:"var(--surface2)" }}>
              <b style={{ display:"block", fontSize:18, fontWeight:900, color:c, lineHeight:1.1 }}>{n}</b>
              <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)" }}>{l}</span></span>))}
        </div>
        {rows.slice(0, 3).map(r => { const lb = perfLabel(r.route);
          return <div key={r.route} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px", borderRadius:10, background:"var(--surface2)", marginBottom:4, fontSize:12.5 }}>
            <span style={{ width:8, height:8, borderRadius:"50%", flexShrink:0, background:perfTone(perfVal(r), r.route) }}/>
            <span style={{ flex:1, minWidth:0, fontWeight:700, color:"var(--text2)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{lb.title}</span>
            <b style={{ color:perfTone(perfVal(r), r.route) }}>{perfMs(perfVal(r))}</b></div>; })}
        <button onClick={() => { load(); setOpen(true); }} style={{ marginTop:8, padding:"8px 16px", borderRadius:10, border:"none", cursor:"pointer",
          fontSize:13, fontWeight:700, color:"#fff", background:"linear-gradient(135deg, #0EA5E9, #6366F1)" }}>⚡ Voir le détail</button>
      </>}
      {open && <PerfSheet data={d} onClose={() => setOpen(false)} onReload={load} onReset={reset}/>}
    </div>
  );
}

function StorageSection() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>Espace de stockage</h3>
      <CardHelp title="Espace de stockage">
        Ce que l'appli garde sur le serveur, par sorte : photos automatiques et ajoutées, vignettes, 3MF, vidéos, photos de
        groupes, d'objets et d'accessoires, base de données… avec la place du disque et les impressions les plus lourdes.
        L'onglet NAS fait de même pour ce que la sauvegarde y range.
      </CardHelp>
      <button onClick={() => setOpen(true)} style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer",
        border:"none", background:"#6366F1", color:"white" }}>💾 Voir l'espace de stockage</button>
      {open && <StorageSheet onClose={() => setOpen(false)}/>}
    </div>
  );
}
// Le rattrapage des 3MF d'origine MakerWorld : tourne sur le serveur ; la carte relit son avancement
// (toutes les 2 s tant qu'il tourne), on peut quitter la page et revenir
// Les documents joints des modeles (27/10/2026) : notices, nomenclatures, solutions… gardes ici pour chaque modele
// imprime ; le rattrapage relit les fiches deja connues (sans compte : ces documents sont publics).
function MwDocsSection() {
  const [st, setSt] = React.useState(null);
  const load = () => client.get("/makerworld/docs/status").then(r => setSt(r.data)).catch(() => {});
  React.useEffect(() => { load(); }, []);
  React.useEffect(() => {
    if (!st?.running) return undefined;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [st?.running]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => client.post("/makerworld/docs/backfill").then(r => setSt(r.data)).catch(e => showAlert(e.response?.data?.detail || e.message));
  const stop = () => client.post("/makerworld/docs/stop").then(r => setSt(r.data)).catch(() => {});
  const run = !!st?.running, sm = st?.summary, has = st && st.total != null;
  const mo = b => `${((b || 0) / 1048576).toFixed(1).replace(".", ",")} Mo`;
  const hm = t => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const big = (n, l, c) => <div style={{ flex:"1 1 90px", padding:"8px 10px", borderRadius:12, background:"var(--surface2)", display:"flex", flexDirection:"column", gap:1 }}>
    <span style={{ fontSize:20, fontWeight:900, backgroundImage:`linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 55%, #ffffff))`, WebkitBackgroundClip:"text",
      backgroundClip:"text", color:"transparent" }}>{n}</span>
    <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)" }}>{l}</span></div>;
  const pct = sm?.designs ? Math.round(100 * sm.read / sm.designs) : 0;
  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>Documents joints MakerWorld</h3>
      <CardHelp title="Documents joints MakerWorld">
        Notices d'assemblage, nomenclatures, solutions et autres documents que les créateurs joignent à leurs modèles. Ils sont
        gardés ici pour chaque modèle imprimé (lisibles même si le créateur les retire, et rangés avec le modèle sur le NAS). C'est
        fait à chaque relecture d'une fiche ; ce bouton rattrape les modèles déjà imprimés, un à la fois. Sans compte MakerWorld :
        ces documents sont publics, et ne comptent pas comme des téléchargements.
      </CardHelp>
      {sm && <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {big(sm.kept, `gardé${sm.kept > 1 ? "s" : ""} sur ${sm.docs} documents`, "#16a34a")}
          {big(sm.with_docs, `modèle${sm.with_docs > 1 ? "s" : ""} en ont`, "#0EA5E9")}
          {big(sm.unread, "fiches à relire", sm.unread ? "#F97316" : "#64748B")}
        </div>
        <div style={{ fontSize:11.5, fontWeight:700, color:"var(--muted)" }}>{sm.read} fiches relues sur {sm.designs} modèles imprimés</div>
        <div style={{ height:8, borderRadius:6, background:"var(--surface2)", overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, borderRadius:6, background:"linear-gradient(90deg, #0EA5E9, #6366F1)", transition:"width .4s" }}/></div>
      </div>}
      {has && (
        <div style={{ display:"flex", flexDirection:"column", gap:4, marginBottom:12, padding:"10px 12px", borderRadius:12, fontSize:12, fontWeight:700, color:"var(--text2)",
          border:`1px solid ${run ? "rgba(14,165,233,.35)" : "var(--border)"}`, background: run ? "rgba(14,165,233,.06)" : "transparent" }}>
          <span style={{ fontWeight:800 }}>{run ? `⏳ En cours · ${st.done} / ${st.total}` : `Dernier passage${st.finished_at ? ` · ${hm(st.finished_at)}` : ""}`}</span>
          <span>{st.read} fiche{st.read > 1 ? "s" : ""} relue{st.read > 1 ? "s" : ""} · {st.fetched} document{st.fetched > 1 ? "s" : ""} récupéré{st.fetched > 1 ? "s" : ""} ({mo(st.bytes)}){st.failed ? ` · ${st.failed} en échec` : ""}</span>
          {st.stopped && <span style={{ color:"#d97706" }}>{st.stopped}</span>}
          {st.error && <span style={{ color:"#ef4444" }}>{st.error}</span>}
        </div>
      )}
      <div style={{ display:"flex", gap:8 }}>
        {run ? <button onClick={stop} style={{ padding:"8px 16px", borderRadius:10, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text2)",
            fontSize:13, fontWeight:700, cursor:"pointer" }}>■ Arrêter</button>
          : <button onClick={start} style={{ padding:"8px 16px", borderRadius:10, border:"none", cursor:"pointer", fontSize:13, fontWeight:700, color:"#fff",
            background:"linear-gradient(135deg, #0EA5E9, #6366F1)" }}>⇣ Tout récupérer</button>}
      </div>
    </div>
  );
}

function SourceBackfillSection() {
  const [st, setSt] = React.useState(null);
  const load = () => client.get("/makerworld/source3mf/status").then(r => setSt(r.data)).catch(() => {});
  React.useEffect(() => { load(); }, []);
  React.useEffect(() => {
    if (!st?.running && !st?.resume_at) return undefined;
    const t = setInterval(load, st?.running ? 2000 : 30000);   // une reprise prevue : toutes les 30 s suffisent
    return () => clearInterval(t);
  }, [st?.running, st?.resume_at]); // eslint-disable-line react-hooks/exhaustive-deps
  const start = () => client.post("/makerworld/source3mf/backfill").then(r => setSt(r.data)).catch(e => showAlert(e.response?.data?.detail || e.message));
  const stop = () => client.post("/makerworld/source3mf/stop").then(r => setSt(r.data)).catch(() => {});
  const run = !!st?.running, sm = st?.summary, has = st && st.total != null;
  const mo = b => `${((b || 0) / 1048576).toFixed(1).replace(".", ",")} Mo`;
  const txt = t => String(t || "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const hm = t => new Date(t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  const chip = (n, l, c) => <span style={{ fontSize:11.5, fontWeight:800, color:c, padding:"2px 8px", borderRadius:20, background:`${c}1a` }}>{n} {l}</span>;
  const big = (n, l, c) => <div style={{ flex:"1 1 90px", padding:"8px 10px", borderRadius:12, background:"var(--surface2)", display:"flex", flexDirection:"column", gap:1 }}>
    <span style={{ fontSize:20, fontWeight:900, backgroundImage:`linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 55%, #ffffff))`, WebkitBackgroundClip:"text",
      backgroundClip:"text", color:"transparent" }}>{n}</span>
    <span style={{ fontSize:11, fontWeight:700, color:"var(--muted)" }}>{l}</span></div>;
  const pct = sm?.pairs ? Math.round(100 * sm.have / sm.pairs) : 0;
  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>3MF d'origine MakerWorld</h3>
      <CardHelp title="3MF d'origine MakerWorld">
        Pour chaque modèle MakerWorld imprimé, garde le projet de son profil (à retrancher, ou à garder si le modèle disparaît).
        C'est fait dès le lancement d'une impression ; ce bouton rattrape les anciennes. Un fichier par profil ; sans profil connu,
        celui du modèle le plus proche de ton imprimante. Chaque récupération compte comme un téléchargement sur MakerWorld,
        et il faut le compte MakerWorld connecté.
      </CardHelp>
      {/* le bilan, toujours a jour : ce qui est garde, ce qui reste */}
      {sm && <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:12 }}>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {big(sm.have, `gardé${sm.have > 1 ? "s" : ""} sur ${sm.pairs} profils`, "#16a34a")}
          {big(sm.missing, "à récupérer", sm.missing ? "#F97316" : "#64748B")}
          {big(sm.models, "modèles imprimés", "#6366F1")}
        </div>
        <div style={{ height:8, borderRadius:6, background:"var(--surface2)", overflow:"hidden" }}>
          <div style={{ height:"100%", width:`${pct}%`, borderRadius:6, background:"linear-gradient(90deg, #16a34a, #4ADE80)", transition:"width .4s" }}/></div>
      </div>}
      {/* le passage en cours, ou le dernier */}
      {has && (
        <div style={{ display:"flex", flexDirection:"column", gap:6, marginBottom:12, padding:"10px 12px", borderRadius:12,
          border:`1px solid ${run ? "rgba(249,115,22,.35)" : "var(--border)"}`, background: run ? "rgba(249,115,22,.06)" : "transparent" }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:12.5, fontWeight:800, color:"var(--text2)" }}>
            {run ? "⏳ En cours" : `Dernier passage${st.finished ? ` · ${hm(st.finished)}` : ""}`}
            <span style={{ marginLeft:"auto", color:"var(--muted)" }}>{st.done} / {st.total}</span></div>
          {run && st.current && <div style={{ fontSize:12, color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{txt(st.current)}</div>}
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            {chip(st.ok, `récupéré${st.ok > 1 ? "s" : ""} (${mo(st.bytes)})`, "#16a34a")}
            {st.already > 0 && chip(st.already, "déjà là", "#64748B")}
            {st.guessed > 0 && chip(st.guessed, "par le profil le plus proche", "#6366F1")}
            {st.skipped > 0 && chip(st.skipped, "introuvable" + (st.skipped > 1 ? "s" : "") + " sur MakerWorld", "#d97706")}
            {st.failed > 0 && chip(st.failed, "en échec", "#dc2626")}
          </div>
          {/* les blocages de MakerWorld : quand, et apres combien de fichiers recuperes (de quoi juger le rythme) */}
          <div style={{ fontSize:11.5, fontWeight:700, color: st.blocks?.length ? "#d97706" : "#16a34a" }}>
            {st.blocks?.length
              ? `🛑 Bloqué ${st.blocks.length} fois par MakerWorld : ${st.blocks.map(b => `à ${hm(b.at)} (après ${b.ok} fichier${b.ok > 1 ? "s" : ""}${b.daily ? ", limite du jour" : ""})`).join(", ")}`
              : st.ok > 0 ? "✓ Aucun blocage de MakerWorld pendant ce passage" : null}</div>
          {!run && st.resume_at && st.daily && (
            <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"10px 12px", borderRadius:10, background:"rgba(99,102,241,.10)",
              border:"1px solid rgba(99,102,241,.40)" }}>
              <div style={{ fontSize:12.5, fontWeight:800, color:"#6366F1" }}>{st.budget ? `📅 Quota du jour pris (${st.quota?.cap} par 24 h)` : "📅 Limite du jour atteinte sur MakerWorld"}</div>
              <div style={{ fontSize:12, color:"var(--text2)" }}>{st.budget
                ? "Le reste de la limite MakerWorld est gardé pour lancer tes impressions. Le rattrapage reprend tout seul"
                : "MakerWorld limite les téléchargements par jour. Le rattrapage reprend tout seul"}
                {" "}{new Date(st.resume_at * 1000).toLocaleDateString("fr-FR", { weekday:"long" })} vers {hm(st.resume_at)} ; tu peux aussi relancer à la main plus tôt.</div>
            </div>)}
          {!run && st.resume_at && !st.daily && !st.captcha && <div style={{ fontSize:12, fontWeight:700, color:"#6366F1" }}>
            ↻ Le serveur a redémarré pendant le rattrapage : il reprend tout seul vers {hm(st.resume_at)}.</div>}
          {!run && st.resume_at && st.captcha && (
            <div style={{ display:"flex", flexDirection:"column", gap:6, padding:"10px 12px", borderRadius:10, background:"rgba(245,158,11,.12)",
              border:"1px solid rgba(245,158,11,.45)" }}>
              <div style={{ fontSize:12.5, fontWeight:800, color:"#d97706" }}>🤖 MakerWorld demande de vérifier que tu n'es pas un robot</div>
              <div style={{ fontSize:12, color:"var(--text2)" }}>Le rattrapage se calme et réessaie tout seul vers {hm(st.resume_at)}. Pour aller plus vite :
                ouvre makerworld.com (même réseau, même compte), fais le captcha, puis « Reprendre ».</div>
            </div>)}
          {!run && !st.resume_at && st.captcha && (
            <div style={{ display:"flex", flexDirection:"column", gap:8, padding:"10px 12px", borderRadius:10, background:"rgba(245,158,11,.12)",
              border:"1px solid rgba(245,158,11,.45)" }}>
              <div style={{ fontSize:12.5, fontWeight:800, color:"#d97706" }}>🤖 MakerWorld demande de vérifier que tu n'es pas un robot</div>
              <div style={{ fontSize:12, color:"var(--text2)" }}>Ouvre makerworld.com (même réseau, même compte), fais le captcha, puis reviens appuyer sur « Reprendre » :
                il repart d'où il en était.</div>
              <a href="https://makerworld.com/fr" target="_blank" rel="noopener noreferrer" style={{ alignSelf:"flex-start", padding:"6px 12px",
                borderRadius:9, fontSize:12.5, fontWeight:800, color:"#fff", background:"#d97706", textDecoration:"none" }}>Ouvrir makerworld.com ↗</a>
            </div>)}
          {!run && !st.resume_at && !st.captcha && !st.daily && st.stopped && <div style={{ fontSize:12, fontWeight:700, color:"#d97706" }}>{st.stopped}</div>}
          {st.errors?.length > 0 && <details style={{ fontSize:11.5, color:"var(--muted)" }}>
            <summary style={{ cursor:"pointer", fontWeight:700 }}>Dernières erreurs</summary>
            {st.errors.map((e, i) => <div key={i}>• {txt(e)}</div>)}</details>}
        </div>
      )}
      {/* le quota du rattrapage : la limite MakerWorld vaut pour tout le compte, il en faut pour imprimer */}
      {st?.quota && <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:12, color:"var(--muted)", marginBottom:10 }}>
        <span>Au plus</span>
        <select value={st.quota.cap} onChange={e => client.post("/makerworld/source3mf/budget", { n: +e.target.value }).then(load).catch(() => {})}
          style={{ height:30, borderRadius:9, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)", fontWeight:700, fontSize:12.5, padding:"0 6px" }}>
          {[5, 10, 15, 20, 30, 40, 50, 0].map(n => <option key={n} value={n}>{n ? `${n} fichiers` : "sans limite"}</option>)}
        </select>
        <span>par 24 h, pour garder de quoi imprimer depuis MakerWorld · {st.quota.used} pris ces dernières 24 h</span>
      </div>}
      {!run && st?.resume_at && <button onClick={stop} style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer",
        border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)", marginRight:8 }}>Annuler la reprise</button>}
      {run
        ? <button onClick={stop} style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer", border:"1px solid var(--border)",
            background:"var(--surface2)", color:"var(--text)" }}>■ Arrêter</button>
        : sm && !sm.missing
        ? <span style={{ fontSize:13, fontWeight:800, color:"#16a34a" }}>✓ Tout est gardé</span>
        : <button onClick={start} style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700, cursor:"pointer", border:"none",
            background:"#F97316", color:"white" }}>⇣ {has ? "Reprendre" : "Tout récupérer"}{sm ? ` (${sm.missing} restant${sm.missing > 1 ? "s" : ""})` : ""}</button>}
    </div>
  );
}
function DiagExportSection() {
  const [days, setDays] = React.useState(14);
  const [loading, setLoading] = React.useState(false);
  const run = async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/prints/diag/export", { params: { days, tz: -new Date().getTimezoneOffset() } });
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = `bambunymous-diagnostic-${new Date().toISOString().slice(0, 10)}.json`;
      a.dispatchEvent(new MouseEvent("click"));
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setLoading(false); }
  };
  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>Exporter pour diagnostic</h3>
      <CardHelp title="Exporter pour diagnostic">
        Télécharge les impressions des derniers jours telles qu'enregistrées (dates, durées, pauses, statut, poids, coût)
        et le calcul jour par jour des tuiles. Aucune bobine, aucun compte, aucun réglage.
      </CardHelp>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <select value={days} onChange={e => setDays(+e.target.value)} style={{ height:34, borderRadius:10, border:"1px solid var(--border)",
          background:"var(--surface2)", color:"var(--text)", fontWeight:700, fontSize:13, padding:"0 8px" }}>
          {[7, 14, 30, 60].map(n => <option key={n} value={n}>{n} derniers jours</option>)}
        </select>
        <button onClick={run} disabled={loading}
          style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:700, cursor:loading?"wait":"pointer",
            border:"none", background: loading ? "var(--border)" : "#3b82f6", color:"white" }}>
          {loading ? "Préparation…" : "⤓ Télécharger le fichier"}
        </button>
      </div>
    </div>
  );
}
// Pastille couleur — degrade sur un calque interne d'un conteneur overflow:hidden
// et anneau en box-shadow : un border sur un element peint laisse transparaitre
// le fond et cree un halo.
function ColorDot({ f, size = 14 }) {
  const cols = (f.colors_array || "")
    .split(",").map(c => `#${c.trim().replace(/^#/, "").slice(0, 6)}`)
    .filter(c => c.length === 7);
  let bg = f.color
    ? (String(f.color).startsWith("#") ? String(f.color).slice(0, 7) : `#${String(f.color).slice(0, 6)}`)
    : "#888";
  if (cols.length > 1) {
    bg = f.multicolor_type === "gradient"
      ? `linear-gradient(135deg, ${cols.join(",")})`
      : `linear-gradient(90deg, ${cols.map((c, i, a) =>
          `${c} ${i / a.length * 100}%, ${c} ${(i + 1) / a.length * 100}%`).join(",")})`;
  }
  return (
    <div style={{ width:size, height:size, borderRadius:"50%", flexShrink:0,
      position:"relative", overflow:"hidden",
      boxShadow:"inset 0 0 0 1px rgba(128,128,128,0.35)" }}>
      <div style={{ position:"absolute", inset:0, background:bg }}/>
    </div>
  );
}




// ── Points d'attention ─────────────────────────────────────────────────────
/**
 * Une seule carte pour les trois écrans liés aux alertes : ils étaient éclatés
 * en trois cartes distinctes alors qu'ils traitent du même sujet.
 */
function AttentionCard({ card, cardTitle }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="card" style={card}>
      <div style={cardTitle}>Points d'attention</div>
      <CardHelp title="Points d'attention">
        Choisis l'ordre des catégories sur l'accueil, et masque celles qui ne
        t'intéressent pas. La liste des alertes, elle, s'ouvre depuis l'accueil.
      </CardHelp>
      <button type="button" onClick={() => setOpen(true)}
        style={{ padding:"9px 14px", borderRadius:8, border:"none", cursor:"pointer",
          background:"#3b82f6", color:"white", fontSize:12, fontWeight:700 }}>
        Organiser les catégories…
      </button>

      {open && <CategoriesModal onClose={() => setOpen(false)}/>}
    </div>
  );
}


/**
 * Ordre et masquage des catégories.
 *
 * Glisser-déposer via les POINTER EVENTS, et non l'API drag-and-drop HTML5 :
 * cette dernière ne fonctionne tout simplement pas au tactile. Elle aurait été
 * inutilisable sur mobile, là où l'appli sert le plus.
 */
function CategoriesModal({ onClose }) {
  useTrackDetail("Objets · Catégories");
  const [rows, setRows]   = React.useState(null);
  const [dirty, setDirty] = React.useState(false);
  const [busy, setBusy]   = React.useState(false);
  const [err, setErr]     = React.useState(null);
  const [dragIdx, setDragIdx] = React.useState(null);

  const listRef = React.useRef(null);
  const dragRef = React.useRef(null);   // index en cours de deplacement
  const rowsRef = React.useRef(null);   // dernier etat, lisible depuis les listeners

  React.useEffect(() => {
    client.get("/attention/categories")
      .then(r => setRows(r.data?.categories || []))
      .catch(e => setErr(e.response?.data?.detail || e.message));
  }, []);
  React.useEffect(() => { rowsRef.current = rows; }, [rows]);

  /**
   * Reordonnancement au pointeur.
   *
   * Deux pieges evites ici :
   *  - les listeners sont poses sur le DOCUMENT, pas sur la liste : pendant le
   *    geste, React reordonne les noeuds, et un handler attache a la ligne
   *    deplacee peut cesser de recevoir les evenements.
   *  - la cible est calculee a partir des rectangles REELS de chaque ligne, pas
   *    d'une hauteur supposee uniforme : les libelles passent a la ligne, donc
   *    les hauteurs different.
   */
  const startDrag = (clientY0, i) => {
    dragRef.current = i;
    setDragIdx(i);

    const moveTo = (y) => {
      const from = dragRef.current;
      const list = listRef.current;
      const cur = rowsRef.current;
      if (from == null || !list || !cur) return;

      let to = from;
      const n = list.children.length;
      for (let k = 0; k < n; k++) {
        const r = list.children[k].getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) { to = k; break; }
        if (k === 0 && y < r.top) { to = 0; break; }
        if (k === n - 1 && y > r.bottom) { to = k; break; }
      }
      if (to === from) return;

      const next = [...cur];
      const [it] = next.splice(from, 1);
      next.splice(to, 0, it);
      rowsRef.current = next;
      setRows(next);
      dragRef.current = to;
      setDragIdx(to);
      setDirty(true);
    };

    const onPointerMove = (ev) => moveTo(ev.clientY);

    // Le tactile est traite EN PLUS des pointer events. Sur mobile, le navigateur
    // demarre un defilement des que le doigt bouge et emet alors un pointercancel :
    // le drag mourait aussitot. touchAction:none ne suffisait pas. Ici on ecoute
    // touchmove en NON PASSIF pour pouvoir appeler preventDefault() et empecher
    // reellement le defilement pendant le geste.
    const onTouchMove = (ev) => {
      if (ev.cancelable) ev.preventDefault();
      const t = ev.touches[0];
      if (t) moveTo(t.clientY);
    };

    const stop = () => {
      dragRef.current = null;
      setDragIdx(null);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", stop);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchend", stop);
      document.removeEventListener("touchcancel", stop);
      document.body.style.overflow = prevOverflow;
    };

    // Verrouiller le defilement de la page pendant le geste
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", stop);
    document.addEventListener("touchmove", onTouchMove, { passive: false });
    document.addEventListener("touchend", stop);
    document.addEventListener("touchcancel", stop);

    if (clientY0 != null) moveTo(clientY0);
  };

  const toggleHidden = (cat) => {
    setRows(rs => rs.map(r => r.category === cat ? { ...r, hidden: !r.hidden } : r));
    setDirty(true);
  };

  const move = (i, dir) => {
    const j = i + dir;
    if (!rows || j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    setRows(next);
    setDirty(true);
  };

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await client.put("/attention/categories", {
        order:  rows.map(r => r.category),
        hidden: rows.filter(r => r.hidden).map(r => r.category),
      });
      setDirty(false);
      onClose();
    } catch (e) { setErr(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:9999,
      background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center",
      justifyContent:"center", padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:480,
        maxHeight:"86vh", display:"flex", flexDirection:"column",
        background:"var(--sheet-bg)", borderRadius:22, overflow:"hidden", boxShadow:"0 30px 80px rgba(0,0,0,0.45)" }}>

        <div style={{ padding:"16px 16px 12px", display:"flex", alignItems:"center", gap:12,
          background:"radial-gradient(circle at 12% 30%, #EC489955, transparent 60%), linear-gradient(135deg, #EC489922, transparent 70%), var(--surface2)" }}>
          <span style={{ width:42, height:42, borderRadius:14, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20,
            background:"linear-gradient(135deg, #EC4899, #F472B6)", boxShadow:"0 8px 18px -8px #EC4899" }}>🗂️</span>
          <p style={{ fontSize:17, fontWeight:900, color:"var(--text)", margin:0, flex:1 }}>
            Catégories de l'accueil
            <CardHelp inline title="Catégories de l'accueil" color="#EC4899">
              Fais glisser la poignée (ou utilise les flèches) pour réordonner. L'œil masque une catégorie de l'accueil — elle reste
              consultable dans la liste des alertes.</CardHelp>
          </p>
          <button type="button" onClick={onClose} aria-label="Fermer"
            style={{ width:34, height:34, borderRadius:"50%", border:"1px solid var(--border)", background:"var(--surface)",
              color:"var(--text2)", fontSize:15, cursor:"pointer", flexShrink:0 }}>✕</button>
        </div>


        {err && <p style={{ margin:0, padding:"0 16px 8px", fontSize:12, color:"#ef4444" }}>⚠ {err}</p>}

        <div ref={listRef} style={{ flex:1, overflowY:"auto", padding:"0 12px 8px" }}>
          {!rows ? (
            <p style={{ fontSize:12, color:"var(--muted)", padding:12, margin:0 }}>Chargement…</p>
          ) : rows.map((r, i) => (
            <div key={r.category}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 8px",
                borderRadius:8, marginBottom:4,
                background: dragIdx === i ? "rgba(59,130,246,0.18)" : "var(--surface2)",
                opacity: r.hidden ? 0.45 : 1,
                boxShadow: dragIdx === i ? "0 4px 14px rgba(0,0,0,0.28)" : "none" }}>

              {/* touchAction:none est indispensable : sans lui le navigateur
                  interprete le geste comme un defilement et le drag ne demarre
                  jamais au doigt. */}
              {/* Poignee : on ecoute le pointeur ET le tactile. Le pointercancel
                  emis par le navigateur au demarrage d'un defilement tuait le
                  drag sur mobile ; le chemin tactile, lui, bloque le defilement.
                  Zone de touche elargie (padding) pour etre attrapable au doigt. */}
              <span
                onPointerDown={e => { if (e.pointerType !== "touch") startDrag(e.clientY, i); }}
                onTouchStart={e => startDrag(e.touches[0]?.clientY, i)}
                style={{ cursor:"grab", touchAction:"none", color:"var(--muted)",
                  fontSize:16, flexShrink:0, padding:"6px 8px", margin:"-6px 0",
                  userSelect:"none", WebkitUserSelect:"none",
                  WebkitTouchCallout:"none" }}>⠿</span>

              <span style={{ fontSize:13, flexShrink:0 }}>{r.icon}</span>

              {/* Libelle jamais tronque : c'est la seule chose qui dit ce qu'on deplace. */}
              <span style={{ flex:1, fontSize:12, fontWeight:600, color:"var(--text)",
                whiteSpace:"normal", wordBreak:"break-word", lineHeight:1.3 }}>
                {r.label}
              </span>

              {/* Fleches conservees : sur certains navigateurs mobiles le drag
                  reste capricieux, et il faut toujours un moyen sur d'y arriver. */}
              <div style={{ display:"flex", flexDirection:"column", flexShrink:0 }}>
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                  style={{ background:"none", border:"none", cursor: i === 0 ? "default" : "pointer",
                    color: i === 0 ? "var(--border)" : "var(--muted)", fontSize:9,
                    lineHeight:1, padding:"1px 3px" }}>▲</button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                  style={{ background:"none", border:"none",
                    cursor: i === rows.length - 1 ? "default" : "pointer",
                    color: i === rows.length - 1 ? "var(--border)" : "var(--muted)", fontSize:9,
                    lineHeight:1, padding:"1px 3px" }}>▼</button>
              </div>

              <button type="button" onClick={() => toggleHidden(r.category)}
                title={r.hidden ? "Afficher sur l'accueil" : "Masquer de l'accueil"}
                style={{ flexShrink:0, background:"none", border:"none", cursor:"pointer",
                  fontSize:14, padding:"0 2px" }}>
                {r.hidden ? "🚫" : "👁"}
              </button>
            </div>
          ))}
        </div>

        <div style={{ padding:"12px 16px", display:"flex", gap:8, borderTop:"1px solid var(--border)" }}>
          <button type="button" onClick={onClose}
            style={{ flex:1, padding:"11px", borderRadius:12, border:"1px solid var(--border)",
              background:"var(--surface2)", color:"var(--text)", fontSize:13.5, fontWeight:800, cursor:"pointer" }}>
            Annuler
          </button>
          <button type="button" onClick={save} disabled={!dirty || busy}
            style={{ flex:2, padding:"11px", borderRadius:12, border:"none",
              background: dirty ? "linear-gradient(135deg, #EC4899, #8B5CF6)" : "var(--border)",
              boxShadow: dirty ? "0 8px 18px -10px #EC4899" : "none",
              color: dirty ? "white" : "var(--muted)", fontSize:13.5, fontWeight:800,
              cursor: dirty ? "pointer" : "default" }}>
            {busy ? "…" : "✓ Enregistrer"}
          </button>
        </div>
      </div>
    </div>
  );
}



// ── Étiquettes filaments (PDF) ─────────────────────────────────────────────
function LabelsCard({ card, cardTitle }) {
  const [open, setOpen] = React.useState(false);
  const [fils, setFils] = React.useState([]);
  const [sel, setSel] = React.useState(new Set());
  const [q, setQ] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState(null);

  // Filaments en place dans l'AMS : ce sont eux qu'on peut imprimer tout de
  // suite, la bobine est deja chargee. Lu a l'ouverture ; une imprimante
  // injoignable n'empeche pas la fenetre de servir.
  const [enPlace, setEnPlace] = React.useState(new Set());
  const [ignores, setIgnores] = React.useState(new Set());

  React.useEffect(() => {
    if (!open) return;
    // Filaments dont l'alerte « sans échantillon » a ete ignoree dans les points
    // d'attention : on ne veut pas les imprimer, ils passent dans leur propre
    // section, non coches. Lus EN MEME TEMPS que les filaments : sinon, selon
    // l'ordre d'arrivee, la selection par defaut recochait les ignores.
    // Points d'attention injoignables : rien n'est ignore, la fenetre sert.
    const ignoresP = client.get("/attention/dismissed")
      .then(({ data }) => new Set((data?.dismissed || [])
        .filter(d => d.category === "fil_no_swatch" && !d.expired && d.entity_id != null)
        .map(d => d.entity_id)))
      .catch(() => new Set());
    Promise.all([client.get("/filaments/filaments"), ignoresP])
      .then(([r, ign]) => {
        const list = r.data || [];
        setFils(list);
        setIgnores(ign);
        // Ce qu'on vient chercher ici, c'est surtout l'etiquette des
        // echantillons qu'on n'a pas encore : coches par defaut quand il y en
        // a, tout sinon.
        // Coches par defaut : ce qui n'a pas encore d'etiquette -- l'echantillon
        // fait a etiqueter, et le sans echantillon non ignore. Tout s'il n'y a rien.
        const a_faire = list.filter(f => !f.label_printed && (f.swatch || !ign.has(f.id)));
        setSel(new Set((a_faire.length ? a_faire : list).map(f => f.id)));
      })
      .catch(() => setErr("Chargement impossible"));
    client.get("/printer/status")
      .then(({ data }) => setEnPlace(new Set((data?.ams_list || [])
        .flatMap(a => a.trays || [])
        .map(t => t.spool_info?.filament_id)
        .filter(id => id != null))))
      .catch(() => {});
  }, [open]);

  const shown = fils.filter(f => {
    if (!q.trim()) return true;
    const hay = [String(f.id), f.translated_name, f.name, f.manufacturer,
                 f.material, f.fila_type, f.color_bucket]
      .filter(Boolean).join(" ").toLowerCase();
    return q.trim().toLowerCase().split(/\s+/).every(w => hay.includes(w));
  });

  // Sans echantillon d'abord, et parmi eux ceux en place dans l'AMS.
  // et ceux dont on a une bobine avant ceux qu'on n'a plus.
  const aBobine = (f) => (f.active_spool_count || 0) > 0;
  const ordre = (a, b) => (enPlace.has(b.id) - enPlace.has(a.id))
    || (aBobine(b) - aBobine(a)) || (a.id - b.id);
  // Etiquette deja imprimee : en bas, quoi qu'il en soit de l'echantillon.
  // Au-dessus, l'echantillon fait qui n'attend que son etiquette, puis les
  // sans echantillon (non ignores, puis ignores).
  const aEtiqueter = shown.filter(f => !f.label_printed && f.swatch).sort(ordre);
  const sansEch = shown.filter(f => !f.label_printed && !f.swatch && !ignores.has(f.id)).sort(ordre);
  const sansEchIgnores = shown.filter(f => !f.label_printed && !f.swatch && ignores.has(f.id)).sort(ordre);
  const etiquetes = shown.filter(f => f.label_printed);
  const cocherListe = (liste, oui) => setSel(prev => {
    const n = new Set(prev);
    liste.forEach(f => (oui ? n.add(f.id) : n.delete(f.id)));
    return n;
  });

  const toggle = (id) => setSel(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const download = async (ids) => {
    setBusy(true); setErr(null);
    try {
      // responseType blob : sans ca axios renvoie une chaine et le PDF est corrompu
      // NB : le routeur a le prefixe /filaments ET la route est declaree
      // "/filaments/labels/pdf" -> le doublon est normal (cf. /filaments/filaments).
      const r = await client.post("/filaments/filaments/labels/pdf", { ids: ids || null },
        { responseType: "blob" });
      const blob = new Blob([r.data], { type: "application/pdf" });
      const fileName = "etiquettes-filaments.pdf";

      // Dans la WebView Android, le telechargement d'une blob: URL echoue (le
      // DownloadManager ne sait pas les traiter). On passe alors le PDF au pont
      // natif, qui l'enregistre dans les Telechargements et l'ouvre. En navigateur
      // classique, window.BambuScan n'existe pas -> comportement standard inchange.
      if (window.BambuScan?.savePdf) {
        const b64 = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        window.BambuScan.savePdf(b64, fileName);
        setOpen(false);
        return;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      setOpen(false);
    } catch {
      setErr("Génération impossible");
    } finally { setBusy(false); }
  };

  const btn = (bg) => ({ padding:"8px 14px", borderRadius:8, border:"none", cursor:"pointer",
    background:bg, color:"white", fontSize:12, fontWeight:700 });

  return (
    <div className="card" style={card}>
      <div style={cardTitle}>Étiquettes filaments</div>
      <CardHelp title="Étiquettes filaments">
        Planche d'étiquettes à coller sur les échantillons : un QR code de 9 × 9 mm
        encodant l'ID du filament, et l'ID en clair juste en dessous pour pouvoir
        le saisir à la main. C'est ce QR que lit le bouton Scanner.
      </CardHelp>
      <button type="button" onClick={() => setOpen(true)} style={btn("#3b82f6")}>
        Générer les étiquettes…
      </button>
      {err && <p style={{ fontSize:12, color:"#ef4444", margin:"8px 0 0" }}>⚠ {err}</p>}

      {open && (
        <div onClick={() => setOpen(false)} style={{ position:"fixed", inset:0, zIndex:9999,
          background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center",
          justifyContent:"center", padding:16 }}>
          <div onClick={e => e.stopPropagation()} style={{ width:"100%", maxWidth:520,
            maxHeight:"84vh", display:"flex", flexDirection:"column",
            background:"var(--sheet-bg)", borderRadius:22, overflow:"hidden", boxShadow:"0 30px 80px rgba(0,0,0,0.45)" }}>

            <div style={{ padding:"16px 16px 12px", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap",
              background:"radial-gradient(circle at 12% 30%, #F9731655, transparent 60%), linear-gradient(135deg, #F9731622, transparent 70%), var(--surface2)" }}>
              <span style={{ width:42, height:42, borderRadius:14, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20,
                background:"linear-gradient(135deg, #F97316, #FBBF24)", boxShadow:"0 8px 18px -8px #F97316" }}>🏷️</span>
              <p style={{ fontSize:17, fontWeight:900, color:"var(--text)", margin:0, flex:1, whiteSpace:"nowrap" }}>
                Étiquettes <span style={{ fontSize:13, fontWeight:800, color:"#F97316" }}>{sel.size} / {fils.length}</span>
              </p>
              <button type="button" onClick={() => setSel(new Set(fils.map(f => f.id)))}
                style={{ ...btn("var(--surface2)"), color:"var(--muted)" }}>Tout cocher</button>
              <button type="button" onClick={() => setSel(new Set())}
                style={{ ...btn("var(--surface2)"), color:"var(--muted)" }}>Tout décocher</button>
            </div>

            <div style={{ padding:"10px 16px 8px" }}>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrer : nom, marque, matière, teinte…"
                style={{ width:"100%", boxSizing:"border-box", height:40, padding:"0 14px", borderRadius:20,
                  border:"1px solid var(--border)", background:"var(--surface2)",
                  color:"var(--text)", fontSize:13.5, outline:"none" }}/>
            </div>

            <div style={{ flex:1, overflowY:"auto", padding:"0 8px" }}>
              {[["Échantillon sans étiquette", aEtiqueter, "#3b82f6"],
                ["Sans échantillon", sansEch, "#F59E0B"],
                ["Sans échantillon, ignorés", sansEchIgnores, "var(--muted)"],
                ["Étiquette déjà imprimée", etiquetes, "var(--muted)"]]
                .filter(([, liste]) => liste.length)
                .map(([titre, liste, teinte]) => {
                  const toutes = liste.every(f => sel.has(f.id));
                  return (
                    <div key={titre} style={{ marginBottom:8 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 8px 4px",
                        position:"sticky", top:0, background:"var(--sheet-bg)", zIndex:1 }}>
                        <span style={{ fontSize:11, fontWeight:700, textTransform:"uppercase",
                          letterSpacing:"0.06em", color:teinte }}>{titre} · {liste.length}</span>
                        <button type="button" onClick={() => cocherListe(liste, !toutes)}
                          style={{ marginLeft:"auto", background:"none", border:"none", cursor:"pointer",
                            fontSize:11, color:"#60a5fa", padding:0 }}>
                          {toutes ? "Décocher la section" : "Cocher la section"}
                        </button>
                      </div>
                      {liste.map(f => (
                <label key={f.id} style={{ display:"flex", alignItems:"center", gap:10,
                  padding:"7px 8px", borderRadius:8, cursor:"pointer" }}>
                  <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id)}/>
                  <ColorDot f={f}/>
                  <span style={{ fontFamily:"JetBrains Mono,monospace", fontWeight:800,
                    fontSize:12, color:"#60a5fa", minWidth:34 }}>#{f.id}</span>
                  <span style={{ flex:1, minWidth:0, fontSize:12, color:"var(--text)",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    {f.translated_name || f.name}
                    <span style={{ color:"var(--muted)" }}>
                      {" · "}{[f.manufacturer, f.material].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {/* Bobines en stock : sans bobine, l'echantillon ne
                      s'imprime pas sans en racheter une. */}
                  <span title={aBobine(f) ? "Bobines actives en stock" : "Aucune bobine active"}
                    style={{ flexShrink:0, fontSize:10, fontWeight:600, whiteSpace:"nowrap",
                      color: aBobine(f) ? "var(--text2, var(--muted))" : "var(--muted)",
                      opacity: aBobine(f) ? 1 : 0.6 }}>
                    {aBobine(f)
                      ? `${f.active_spool_count} bobine${f.active_spool_count > 1 ? "s" : ""}`
                      : "pas de bobine"}
                  </span>
                  {!f.swatch && enPlace.has(f.id) && (
                    <span title="Bobine en place dans l'AMS : l'échantillon peut s'imprimer tout de suite"
                      style={{ flexShrink:0, padding:"1px 7px", borderRadius:20, fontSize:10, fontWeight:700,
                        color:"#F59E0B", background:"rgba(245,158,11,0.12)",
                        border:"1px solid rgba(245,158,11,0.35)", whiteSpace:"nowrap" }}>
                      Dans l'AMS
                    </span>
                  )}
                </label>
                      ))}
                    </div>
                  );
                })}
              {!shown.length && (
                <p style={{ fontSize:12, color:"var(--muted)", padding:12, margin:0 }}>
                  Aucun filament.
                </p>
              )}
            </div>

            <div style={{ padding:"12px 16px", display:"flex", gap:8 }}>
              <button type="button" onClick={() => setOpen(false)}
                style={{ ...btn("var(--surface2)"), color:"var(--muted)", flex:1 }}>Annuler</button>
              <button type="button" disabled={!sel.size || busy}
                onClick={() => download([...sel])}
                style={{ ...btn(sel.size ? "#3b82f6" : "var(--border)"), flex:2 }}>
                {busy ? "Génération…" : `Générer (${sel.size})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Onglets de la page. `admin` marque ceux dont tout le contenu est reserve aux
// administrateurs : les afficher a un compte en lecture seule reviendrait a lui
// proposer des onglets vides.
// Un onglet par sujet : l'imprimante, les filaments, l'affichage, les comptes
// (et services connectes), les notifications, puis les outils de maintenance.
const SET_TABS = [
  { id:"printer",  label:"🖨️ Imprimante", admin:true,  c:"#3B82F6" },
  { id:"filament", label:"🧵 Filaments",  admin:true,  c:"#F97316" },
  { id:"display",  label:"🎨 Affichage",  admin:false, c:"#EC4899" },
  { id:"accounts", label:"👤 Comptes",    admin:false, c:"#8B5CF6" },
  { id:"links",    label:"🔗 Connexions", admin:true,  c:"#06B6D4" },   // MakerWorld, Telegram, messages types : administrateur
  { id:"notify",   label:"🔔 Notifs",     admin:false, c:"#F59E0B" },
  { id:"share",    label:"📤 Partage",    admin:true,  c:"#0EA5E9" },
  { id:"android",  label:"📱 Appli Android", admin:false, c:"#22C55E" },
  { id:"tools",    label:"🛠️ Outils",     admin:true,  c:"#64748B" },
  { id:"tasks",    label:"⏱️ Tâches",     admin:true,  c:"#0EA5E9" },   // les taches de fond du serveur
];

export default function Settings() {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [ip,      setIp]      = useState("");
  const [serial,  setSerial]  = useState("");
  const [code,    setCode]    = useState("");
  const [pname,   setPname]   = useState("");
  const [pmodel,  setPmodel]  = useState("");
  const [pmodels, setPmodels] = useState([]);
  const [pauto,   setPauto]   = useState("");
  const [user,    setUser]    = useState("admin");
  const [pass,    setPass]    = useState("");
  const [cost,    setCost]    = useState("0");
  const [codeSet, setCodeSet] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [resetting,    setResetting]    = useState(false);
  const [version, setVersion] = useState(null);

  useEffect(() => {
    client.get("/version").then(({ data }) => setVersion(data)).catch(() => {});
    client.get("/settings").then(({ data }) => {
      setCodeSet(data.PRINTER_ACCESS_CODE_SET ?? false);
      setIp(data.PRINTER_IP     ?? "");
      setSerial(data.PRINTER_ID ?? "");
      setPname(data.PRINTER_NAME ?? "");
      setPmodel(data.PRINTER_MODEL ?? "");
      setPmodels(data.PRINTER_MODELS ?? []);
      setPauto(data.PRINTER_MODEL_AUTO ?? "");
      setUser(data.ADMIN_USERNAME ?? "admin");
      setCost(data.COST_BY_HOUR ?? "0");
      setLoading(false);
    });
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {};
    if (ip)     payload.PRINTER_IP     = ip;
    if (serial) payload.PRINTER_ID     = serial;
    if (code)   payload.PRINTER_ACCESS_CODE = code;
    if (pname)  payload.PRINTER_NAME   = pname;
    payload.PRINTER_MODEL = pmodel;     // vide = automatique
    // Les identifiants ne sont plus geres ici : voir "Mon compte" et "Utilisateurs".
    if (cost)   payload.COST_BY_HOUR   = cost;
    try {
      await client.patch("/settings", payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch(err) {
      showAlert("Erreur: " + (err.response?.data?.detail || err.message));
    } finally { setSaving(false); }
  };

  const isAdmin = useIsAdmin();
  const tabs = SET_TABS.filter(t => isAdmin || !t.admin);
  // Dernier onglet ouvert (ce navigateur) ; sinon selon le role : « Imprimante »
  // n'existe pas pour un compte en lecture seule, il atterrit sur « Affichage ».
  // L'adresse (?tab=…) d'abord : rafraichir ou changer de maison garde l'onglet.
  // Sans elle, le dernier onglet ouvert sur ce navigateur.
  const [defTab] = React.useState(() => {
    let t = null;
    try { t = localStorage.getItem("settingsTab"); } catch { /* indisponible */ }
    return SET_TABS.some(x => x.id === t && (isAdmin || !x.admin)) ? t : (isAdmin ? "printer" : "display");
  });
  const [tab, setUrlTab] = useUrlTab("tab", defTab, tabs.map(t => t.id));
  const setTab = t => { setUrlTab(t); try { localStorage.setItem("settingsTab", t); } catch { /* indisponible */ } };
  useTrackDetail(`Paramètres · ${tabs.find(t => t.id === tab)?.label || tab}`);

  // Tous les hooks sont declares AVANT ce retour anticipe. Les placer apres
  // aurait fait varier leur nombre entre le rendu "chargement" et le suivant,
  // ce que React refuse ("Rendered more hooks than during the previous
  // render") -- l'ecran des parametres serait devenu blanc au chargement.
  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:200, color:"var(--muted)", fontSize:14 }}>Chargement…</div>
  );

  const F = (label, value, set, opts={}) => (
    <div>
      <label style={lbl}>{label}</label>
      <input
        type={opts.type||"text"}
        value={value}
        placeholder={opts.placeholder||""}
        onChange={e => set(e.target.value)}
        style={inp}
        onFocus={e => e.target.style.borderColor="#3b82f6"}
        onBlur={e => e.target.style.borderColor="var(--border)"}
      />
      {opts.hint && <p style={{ fontSize:10, color:"#22c55e", marginTop:4 }}>{opts.hint}</p>}
    </div>
  );

  const tc = (SET_TABS.find(t => t.id === tab) || SET_TABS[0]).c;
  const pill = { padding:"6px 13px", borderRadius:20, border:"1px solid var(--border)", background:"var(--surface2)", cursor:"pointer",
    display:"flex", alignItems:"center", gap:6, color:"var(--text2)", fontSize:12.5, fontWeight:800, textDecoration:"none" };
  return (
    <div className="page-wide set-page" style={{ "--page-max":"640px", "--set-c": tc }}>
      {/* Toutes les cartes de la page (y compris celles des reglages fournis par d'autres composants) prennent
          la couleur de l'onglet ; les boutons principaux bleus passent en degrade. */}
      <style>{SET_CSS}</style>
      {/* Mobile : le bouton part dans le header (une ligne de gagnee).
          Desktop : le header mobile n'existe pas, on le garde dans le flux. */}
      <HeaderAction>
        {/* le guide d'utilisation (une page de l'appli) */}
        <a href="/guide" onClick={e => { e.preventDefault(); navigate("/guide"); }} aria-label="Guide d'utilisation" data-tip="Guide d'utilisation"
          style={{ ...pill, padding:"5px 10px" }}>
          📖
        </a>
        <AdminOnly><button onClick={() => navigate("/logs")} aria-label="Journal" style={{ ...pill, padding:"5px 12px" }}>
          📋 Journal
        </button></AdminOnly>
      </HeaderAction>

      <div className="hidden-mobile" style={{ display:"none", alignItems:"center", justifyContent:"flex-end" }}>
        <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)", margin:0, marginRight:"auto" }}>Paramètres</h1>
        <a href="/guide" onClick={e => { e.preventDefault(); navigate("/guide"); }} style={{ ...pill, marginRight:8 }}>
          📖 Guide d'utilisation
        </a>
        <AdminOnly><button onClick={() => navigate("/logs")} style={pill}>
          📋 Journal
        </button></AdminOnly>
      </div>

      {/* Meme composant visuel que Filaments / Historique / Objets. */}
      {/* Six onglets : une ligne sur ordinateur, deux lignes de trois sur telephone. */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(118px, 1fr))", gap:4,
        background:"var(--surface2)", borderRadius:16, padding:4, border:"1px solid var(--border)" }}>
        {tabs.map(t => { const on = tab === t.id;
          return (
          <button key={t.id} onClick={()=>setTab(t.id)} style={{
            minWidth:0, padding:"9px 4px", borderRadius:12, fontSize:12.5, fontWeight:800,
            whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis",
            cursor:"pointer", border:"none", transition:"all 0.15s",
            background: on ? `linear-gradient(135deg, ${t.c}, color-mix(in srgb, ${t.c} 70%, #ffffff))` : "transparent",
            boxShadow: on ? `0 6px 16px -6px ${t.c}` : "none",
            color: on ? "white" : "var(--muted)" }}>
            {t.label}
          </button>); })}
      </div>

      {/* ── Affichage ─────────────────────────────────────────────── */}
      {/* Sur PC, les cartes de chaque onglet se rangent en colonnes qui se remplissent (.wide-flow). */}
      {tab === "display" && (<div className="wide-flow">
      <div className="card" style={card}>
        <div style={cardTitle}>Apparence</div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12 }}>
          <span style={{ fontSize:14, fontWeight:700, color:"var(--text2)" }}>Thème</span>
          <div role="radiogroup" aria-label="Thème" style={{ display:"flex", gap:3, padding:3, borderRadius:14, background:"var(--surface)", border:"1px solid var(--border)" }}>
            {[["light", <Sun size={14}/>, "Clair", "#F59E0B"], ["dark", <Moon size={14}/>, "Sombre", "#6366F1"]].map(([v, ic, l, c]) => { const on = (theme === "dark") === (v === "dark");
              return <button key={v} type="button" role="radio" aria-checked={on} onClick={() => { if (!on) toggle(); }}
                style={{ display:"flex", alignItems:"center", gap:6, padding:"7px 13px", borderRadius:11, border:"none", cursor:"pointer",
                  fontSize:13, fontWeight:800, color: on ? "#fff" : "var(--muted)",
                  background: on ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 65%, #ffffff))` : "transparent" }}>{ic} {l}</button>; })}
          </div>
        </div>
      </div>
      <HomeDisplayCard/>
      <AdminOnly>
        <AMSOrderSection/>
        <AttentionCard card={card} cardTitle={cardTitle}/>
      </AdminOnly>
      </div>)}

      {/* ── Filaments ─────────────────────────────────────────────── */}
      {tab === "filament" && (
      <AdminOnly><div className="wide-flow">
        <DryRulesCard card={card} cardTitle={cardTitle}/>
        <SpoolTaresCard card={card} cardTitle={cardTitle}/>
        <LabelsCard card={card} cardTitle={cardTitle}/>
        <PriceReviewSection/>
      </div></AdminOnly>
      )}

      {/* ── Imprimante ────────────────────────────────────────────── */}
      {tab === "printer" && (
      <AdminOnly><div>
      <form onSubmit={handleSave} className="printer-form" style={{ display:"flex", flexDirection:"column", gap:16 }}>

        {/* Imprimante */}
        <div className="card" style={card}>
          <div style={cardTitle}><Wifi size={13}/> Imprimante</div>
          <div style={sec}>
            {F("Adresse IP", ip, setIp, { placeholder:"192.168.1.xxx" })}
            {F("Numéro de série", serial, setSerial, { placeholder:"31B…" })}
            <div>
              <label style={lbl}>Code d&apos;accès</label>
              <input type="password" value={code}
                placeholder={codeSet ? "Laisser vide pour conserver" : "Code LAN"}
                onChange={e => setCode(e.target.value)}
                style={inp}
                onFocus={e => e.target.style.borderColor="#3b82f6"}
                onBlur={e => e.target.style.borderColor="var(--border)"}
              />
              {codeSet && !code && <p style={{ fontSize:10, color:"#22c55e", marginTop:4 }}>✓ Code configuré</p>}
            </div>
            <div>
              <label style={lbl}>Modèle<CardHelp inline title="Modèle d'imprimante">
                Sert à MakerWorld (profil fait pour ton imprimante, compatibilité, fichier ouvert dans Studio) et à la vue 3D (la taille du plateau).
                Automatique : déduit du numéro de série.</CardHelp></label>
              <select value={pmodel} onChange={e => setPmodel(e.target.value)} style={inp}>
                <option value="">Automatique{pauto ? ` (${pauto}, d'après le n° de série)` : ""}</option>
                {pmodels.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            {F("Nom affiché", pname, setPname, { placeholder:"Mon imprimante" })}
          </div>
        </div>

        {/* Électricité */}
        <div className="card" style={card}>
          <div style={cardTitle}>Électricité</div>
          <div style={{ maxWidth:200 }}>
            {F("Tarif (€/h)", cost, setCost, { placeholder:"0.20" })}
          </div>
        </div>


        <button type="submit" disabled={saving}
          style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", gap:8,
            background:"linear-gradient(135deg, #3B82F6, #6366F1)", color:"white", border:"none",
            padding:"12px 20px", borderRadius:14, fontSize:14.5, fontWeight:800, boxShadow:"0 8px 18px -10px #3B82F6",
            cursor:saving?"not-allowed":"pointer", opacity:saving?0.6:1 }}>
          {saving ? <RefreshCw size={15} style={{ animation:"spin 1s linear infinite" }} /> : <Save size={15} />}
          {saved ? "Sauvegardé ✓" : "Sauvegarder"}
        </button>
      </form>
      </div></AdminOnly>
      )}

      {/* ── Comptes : moi, la securite, les utilisateurs, leur activite ── */}
      {tab === "accounts" && (<div className="wide-flow">
      <MyAccountSection/>
      <TwoFactorCard/>
      <UsersSection/>
      <AdminOnly><AchievementUsersSection/></AdminOnly>
      <ActivitySection/>
      </div>)}

      {/* ── Connexions : MakerWorld et les BambuNymous des copains ──────── */}
      {tab === "links" && (<div className="wide-flow">
      <AdminOnly><MakerWorldSettings/></AdminOnly>
      <AdminOnly home mw><RateTemplatesSettings/></AdminOnly>
      {/* la boite mail (commandes Bambu Lab) : un lien avec l'exterieur, comme MakerWorld (28/10/2026) */}
      <AdminOnly><MailOrdersSettings card={card} cardTitle={cardTitle}/></AdminOnly>
      <FriendsCard/>
      </div>)}

      {/* ── Tâches de fond du serveur ─────────────────────────────── */}
      {tab === "tasks" && <AdminOnly><TasksPanel/></AdminOnly>}

      {/* ── Outils (maintenance) ──────────────────────────────────── */}
      {tab === "tools" && (
      <AdminOnly><div className="wide-flow">
        <StorageSection/>
        <PerfSection/>
        <ArchiveSection/>
        <SdProbeSection/>
        <SourceBackfillSection/>
        <MwDocsSection/>
        <EnrichFromCatalogSection/>
        <RecalculateSection/>
        <DiagExportSection/>
        <TranslateNamesSection/>
        <RfidDebugSection/>
        <AchievementsExportSection/>
      </div></AdminOnly>
      )}

      {/* ── Appli Android (telechargement, reglages de l'appli) ──────── */}
      {tab === "android" && <div className="wide-flow"><AndroidApp card={card} cardTitle={cardTitle}/></div>}

      {/* ── Partage (Telegram) ─────────────────────────────────────── */}
      {tab === "share" && (
      <AdminOnly><div className="wide-flow">
        <TelegramSettings card={card} cardTitle={cardTitle}/>
      </div></AdminOnly>
      )}

      {/* ── Notifications ─────────────────────────────────────────── */}
      {tab === "notify" && (isAdmin ? (
        <>
          <NotificationsSettings/>
        </>
      ) : (
        // Les autres comptes : leurs telephones et leurs choix (appli Android)
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}><MyAppNotifications/></div>
      ))}




      {version && <VersionLine version={version}/>}
    </div>
  );
}

// L'habillage commun des cartes de la page : la couleur de l'onglet (--set-c) teinte chaque carte, une carte
// dans une carte reste sobre ; les champs s'arrondissent ; un bouton principal bleu (ecrit en dur dans les
// reglages des autres composants) prend le degrade des autres pages.
const SET_CSS = `
.set-page .card { border-radius: 20px !important; border: 1px solid color-mix(in srgb, var(--set-c) 24%, var(--border)) !important;
  background: radial-gradient(90% 60% at 100% 0%, color-mix(in srgb, var(--set-c) 13%, transparent), transparent 70%), var(--surface2) !important;
  box-shadow: 0 10px 24px -20px var(--set-c); }
.set-page .card { position: relative; }
.set-page .card .card { background: var(--surface) !important; box-shadow: none; border-color: var(--border) !important; border-radius: 16px !important; }
.set-page input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), .set-page select, .set-page textarea { border-radius: 12px; }
.set-page button[style*="background: rgb(59, 130, 246)"], .set-page button[style*="background: rgb(59,130,246)"] {
  background: linear-gradient(135deg, #3B82F6, #6366F1) !important; border-color: transparent !important; box-shadow: 0 8px 18px -10px #3B82F6;
  border-radius: 12px !important; font-weight: 800 !important; }
`;

// Version en service, comparee a master sur GitHub : « a jour », ou les
// nouveautes en attente (depliables).
function VersionLine({ version }) {
  const [chk, setChk] = React.useState(null);
  const devTap = React.useMemo(() => tapper(5, 3000, () => egg("developer")), []);
  const [open, setOpen] = React.useState(false);
  const microFound = useEggFound("micro_benchy");   // le petit bateau, une fois trouve, s'en va
  React.useEffect(() => { client.get("/version/check").then(({ data }) => { setChk(data); refreshUpdates(); }).catch(() => {}); }, []);
  const n = chk?.behind || 0;
  return (
    <div style={{ textAlign:"center", marginTop:8, position:"relative" }}>
      {/* un tout petit bateau, presque invisible, au bout de la page */}
      {!microFound && <span data-egg="micro_benchy" aria-hidden="true" style={{ position:"absolute", right:4, bottom:-2, fontSize:9, opacity:.16, cursor:"default", userSelect:"none" }}>⛵</span>}
      <Cachettes spot="settings" side="left"/>
      <p style={{ display:"inline-block", fontSize:11.5, fontWeight:700, color:"var(--muted)", fontFamily:"monospace", margin:0, padding:"5px 12px",
        borderRadius:20, background:"var(--surface2)", border:"1px solid var(--border)" }}>
        <span onClick={devTap} style={{ cursor:"default", userSelect:"none" }}>v{version.commit?.slice(0,8) || "dev"}</span> · {version.build_date?.slice(0,10) || "?"}
        {chk && !chk.dev && !chk.error && (n
          ? <> · <button onClick={() => setOpen(o => !o)} style={{ background:"none", border:"none", padding:0, cursor:"pointer",
              fontFamily:"inherit", fontSize:11, fontWeight:700, color:"#f59e0b" }}>
              ⬆ {n} nouveauté{n > 1 ? "s" : ""} disponible{n > 1 ? "s" : ""} {open ? "▴" : "▾"}</button></>
          : <span style={{ color:"#22c55e", fontWeight:700 }}> · ✓ à jour</span>)}
      </p>
      {open && n > 0 && (
        <div className="card" style={{ maxWidth:520, margin:"8px auto 0", padding:"10px 14px", textAlign:"left" }}>
          <div style={{ fontSize:12, color:"var(--muted)", marginBottom:6 }}>
            Mets à jour l'image Docker (Portainer, docker compose pull) pour en profiter.</div>
          {(chk.commits || []).map((c, i) => (
            <div key={i} style={{ fontSize:12, color:"var(--text2)", padding:"3px 0", borderTop: i ? "1px solid var(--border)" : "none" }}>
              • {c}</div>
          ))}
          {n > (chk.commits || []).length && (
            <div style={{ fontSize:11.5, color:"var(--muted)", marginTop:4 }}>… et {n - chk.commits.length} autre(s)</div>
          )}
        </div>
      )}
    </div>
  );
}

