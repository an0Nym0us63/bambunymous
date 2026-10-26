import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./store/auth";
import Layout from "./components/layout/Layout";
import Login from "./pages/Login";
import { importRetry } from "./utils/importRetry";
// Les pages : chargees a la demande (le premier affichage n'attend plus toute l'appli),
// puis prechargees en fond une fois l'appli au calme : changer de page reste instantane.
const PAGES = {
  home: () => import("./pages/Home"),
  prints: () => import("./pages/Prints"),
  filaments: () => import("./pages/Filaments"),
  objects: () => import("./pages/Objects"),
  stats: () => import("./pages/Stats"),
  settings: () => import("./pages/Settings"),
  notifications: () => import("./pages/Notifications"),
  logs: () => import("./pages/Logs"),
};
const page = k => React.lazy(() => importRetry(PAGES[k]));
const Home = page("home");
const Settings = page("settings");
const Logs = page("logs");
const Stats = page("stats");
const Notifications = page("notifications");
const Objects = page("objects");
const Filaments = page("filaments");
const Prints = page("prints");
function usePrefetchPages(on) {
  React.useEffect(() => {
    if (!on) return undefined;
    let t = null, idle = null;
    const go = () => Object.values(PAGES).forEach(f => f().catch(() => {}));
    t = setTimeout(() => {
      if ("requestIdleCallback" in window) idle = window.requestIdleCallback(go, { timeout: 4000 });
      else go();
    }, 2500);
    return () => { clearTimeout(t); if (idle && "cancelIdleCallback" in window) window.cancelIdleCallback(idle); };
  }, [on]);
}
// le guide d'utilisation : charge a la demande
const Guide = React.lazy(() => import("./pages/Guide"));
// le banc d'essai des tuiles : seulement en developpement
const TileBench = import.meta.env.DEV ? React.lazy(() => import("./pages/TileBench")) : null;
import DialogHost from "./components/DialogHost";
import { ContextMenuHost } from "./components/ContextMenu";
import { CreatorPageHost } from "./components/MwCreatorPage";
import { egg } from "./eggs";
import Anonymous from "./pages/Anonymous";
import HiddenPage, { isHidden } from "./hidden";
import { PrankRedirect, isPrank } from "./hidden/prankHost";

function Rewind() {
  const [pw, setPw] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // le nombre de tours : un champ, prerempli par ?n= (5 sinon)
  const [n, setN] = React.useState(() => new URLSearchParams(window.location.search).get("n") || "5");
  const go = async e => {
    e.preventDefault();
    if (!pw) { setMsg("Mot de passe requis"); return; }
    setBusy(true); setMsg("");
    try {
      const { default: client } = await import("./api/client");
      const { data } = await client.post("/achievements/wheel/extra", { n: Number(n), secret: pw });
      setMsg(`+${data.added} · ${data.spins}`); setPw("");
    } catch (err) { setMsg(err.response?.data?.detail || err.message); }
    setBusy(false);
  };
  return (
    <form onSubmit={go} style={{ maxWidth:320, margin:"60px auto", padding:"0 16px", display:"flex", flexDirection:"column", gap:10 }}>
      <input type="number" min="1" value={n} onChange={e => { setN(e.target.value); setMsg(""); }} placeholder="Nombre de tours"
        aria-label="Nombre de tours" style={{ padding:"10px 12px", borderRadius:10, border:"1px solid var(--border)", background:"var(--surface2)",
          color:"var(--text)", fontSize:14 }}/>
      <input type="password" value={pw} onChange={e => { setPw(e.target.value); setMsg(""); }} placeholder="Mot de passe"
        autoComplete="off" style={{ padding:"10px 12px", borderRadius:10, border:"1px solid var(--border)", background:"var(--surface2)",
          color:"var(--text)", fontSize:14 }}/>
      <button type="submit" disabled={busy} style={{ padding:"10px 0", borderRadius:10, border:"none", background:"#3b82f6",
        color:"#fff", fontWeight:700, cursor:"pointer" }}>{busy ? "…" : "Valider"}</button>
      {msg && <p style={{ margin:0, textAlign:"center", color:"var(--muted)", fontFamily:"monospace", fontSize:13 }}>{msg}</p>}
    </form>
  );
}

// La chance de surprise d'un compte de la maison, reglee a la main (26/10/2026) : le compte principal et le meme
// secret que les tours en plus. Le compteur est pose pour que la prochaine ouverture ait cette chance, puis monte.
function Nudge() {
  const [rows, setRows] = React.useState(null);
  const [who, setWho] = React.useState("");
  const [pct, setPct] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [msg, setMsg] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const load = async () => {
    const { default: client } = await import("./api/client");
    const { data } = await client.get("/achievements/surprise/odds");
    setRows(data.accounts || []);
    setWho(w => w || (data.accounts || []).find(a => !a.main)?.username || (data.accounts || [])[0]?.username || "");
  };
  React.useEffect(() => { load().catch(e => setMsg(e.response?.data?.detail || e.message)); }, []);
  const fmt = p => `${(Math.round(p * 1000) / 10).toString().replace(".", ",")} %`;
  const go = async e => {
    e.preventDefault();
    if (!who || pct === "") { setMsg("Compte et pourcentage requis"); return; }
    if (!pw) { setMsg("Mot de passe requis"); return; }
    setBusy(true); setMsg("");
    try {
      const { default: client } = await import("./api/client");
      const { data } = await client.post("/achievements/surprise/set", { username: who, pct: Number(String(pct).replace(",", ".")), secret: pw });
      setMsg(`${who} · prochaine ${fmt(data.next)}${data.pending ? " · une surprise l'attend déjà" : ""}`); setPw(""); setPct("");
      await load();
    } catch (err) { setMsg(err.response?.data?.detail || err.message); }
    setBusy(false);
  };
  const field = { padding:"10px 12px", borderRadius:10, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)", fontSize:14 };
  return (
    <form onSubmit={go} style={{ maxWidth:340, margin:"60px auto", padding:"0 16px", display:"flex", flexDirection:"column", gap:10 }}>
      {rows && <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        {rows.map(r => (
          <button type="button" key={r.username} onClick={() => { setWho(r.username); setMsg(""); }} style={{ ...field, display:"flex", alignItems:"center",
            gap:8, cursor:"pointer", textAlign:"left", border:`1.5px solid ${who === r.username ? "#3b82f6" : "var(--border)"}` }}>
            <span style={{ flex:1, fontWeight:800 }}>{r.username}</span>
            <span style={{ fontFamily:"monospace", fontSize:13, color:"var(--muted)" }}>{r.pending ? "en attente" : fmt(r.next)} · {r.n}</span>
          </button>))}
      </div>}
      <input type="text" inputMode="decimal" value={pct} onChange={e => { setPct(e.target.value); setMsg(""); }} placeholder="Chance à la prochaine ouverture (%)"
        aria-label="Pourcentage" style={field}/>
      <input type="password" value={pw} onChange={e => { setPw(e.target.value); setMsg(""); }} placeholder="Mot de passe" autoComplete="off" style={field}/>
      <button type="submit" disabled={busy} style={{ padding:"10px 0", borderRadius:10, border:"none", background:"#3b82f6",
        color:"#fff", fontWeight:700, cursor:"pointer" }}>{busy ? "…" : "Valider"}</button>
      {msg && <p style={{ margin:0, textAlign:"center", color:"var(--muted)", fontFamily:"monospace", fontSize:13 }}>{msg}</p>}
    </form>
  );
}

// Adresse inconnue : une page cachee si elle existe (chargee a la demande), sinon « introuvable »
function LostOrHidden() {
  const slug = (useLocation().pathname || "/").replace(/^\/+|\/+$/g, "").toLowerCase();
  if (isPrank(slug)) return <PrankRedirect key={slug} slug={slug} fallback={<NotFound/>}/>;
  return isHidden(slug) ? <HiddenPage key={slug} slug={slug}/> : <NotFound/>;
}

// 418 : la blague des serveurs, et un petit secret pour qui la connait
function Teapot() {
  React.useEffect(() => { egg("teapot"); }, []);
  return (
    <div style={{ padding:"60px 16px", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
      <div style={{ fontSize:64, animation:"bn-jiggle 1.2s ease-in-out infinite" }}>🫖</div>
      <h2 style={{ margin:0, color:"var(--text)" }}>418 · Je suis une théière</h2>
      <p style={{ margin:0, color:"var(--muted)", fontSize:14 }}>On ne fait pas de café ici. Du PLA, à la rigueur.</p>
      <a href="/" style={{ marginTop:8, color:"#3b82f6", fontWeight:700, fontSize:14 }}>Retour à l'accueil</a>
    </div>
  );
}

// Adresse inconnue : une page qui le dit (et un petit secret pour qui s'y perd)
function NotFound() {
  React.useEffect(() => { egg("lost"); }, []);
  return (
    <div style={{ padding:"60px 16px", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
      <div style={{ fontSize:52 }}>🧭</div>
      <h2 style={{ margin:0, color:"var(--text)" }}>Page introuvable</h2>
      <p style={{ margin:0, color:"var(--muted)", fontSize:14 }}>Il n'y a rien ici… ou presque.</p>
      <a href="/" style={{ marginTop:8, color:"#3b82f6", fontWeight:700, fontSize:14 }}>Retour à l'accueil</a>
    </div>
  );
}

function PrivateRoute({ children }) {
  const { isAuthenticated } = useAuth();
  const refreshMe = useAuth((s) => s.refreshMe);

  // A l'ouverture d'une session authentifiee, on resynchronise identite et role
  // depuis le serveur : le role a pu changer, ou la session dater d'avant
  // l'introduction des roles.
  React.useEffect(() => { if (isAuthenticated) refreshMe?.(); }, [isAuthenticated, refreshMe]);

  return isAuthenticated ? children : <Navigate to="/login" replace />;
}

export default function App() {
  usePrefetchPages(useAuth(s => s.isAuthenticated));
  return (
    <>
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={
        <PrivateRoute>
          <Layout />
        </PrivateRoute>
      }>
        <Route index element={<Home />} />
        <Route path="filaments" element={<Filaments />} />
        <Route path="settings" element={<Settings />} />
        <Route path="logs" element={<Logs />} />
        <Route path="prints" element={<Prints />} />
        <Route path="objects" element={<Objects />} />
        <Route path="stats" element={<Stats />} />
        <Route path="notifications" element={<Notifications />} />
        {/* ancienne adresse des succes (liens deja envoyes) : onglet des statistiques */}
        <Route path="achievements" element={<AchievementsRedirect />} />
        <Route path="anonymous" element={<Anonymous />} />
        <Route path="rembobiner" element={<Rewind />} />
        <Route path="coup-de-pouce" element={<Nudge />} />
        <Route path="teapot" element={<Teapot />} />
        <Route path="guide" element={<React.Suspense fallback={null}><Guide /></React.Suspense>} />
        {/* l'ancienne adresse du guide (fichiers statiques, ouverts a tous jusqu'au 23/10/2026) */}
        <Route path="doc/*" element={<Navigate to="/guide" replace />} />
        {TileBench && <Route path="banc-tuiles" element={<React.Suspense fallback={null}><TileBench /></React.Suspense>} />}
        <Route path="*" element={<LostOrHidden />} />
      </Route>
    </Routes>
    <DialogHost />
    <ContextMenuHost />
    <CreatorPageHost />
    </>
  );
}

// ── Swipe-to-close global pour tous les bottom sheets ──────────────────────


function AchievementsRedirect() {
  const { search } = useLocation();
  const p = new URLSearchParams(search);
  p.set("tab", "achievements");
  return <Navigate to={`/stats?${p}`} replace />;
}
