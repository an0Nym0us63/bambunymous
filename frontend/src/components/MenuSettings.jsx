import React, { useEffect, useRef, useState } from "react";
import { ChevronUp, ChevronDown, MoreHorizontal, Lock } from "lucide-react";
import client from "../api/client";
import { useAuth, ROLE_ADMIN } from "../store/auth";
import { egg } from "../eggs";
import { showConfirm } from "../utils/dialog";
import Select from "./Select";
import { normalize, pack, placesOf, PLACES, MOBILE_SLOTS, useNavStore, loadNavMenu } from "../utils/navMenu";

// Parametres › Affichage › Menu (05/11/2026) : quelles pages, dans quel ordre, et ou (menu, « Plus », profil, masquee).
// Chacun regle le sien ; l'administrateur regle aussi celui de chaque compte. Enregistre a chaque changement.
const PLACE_C = { bar: "#3B82F6", more: "#8B5CF6", profile: "#F59E0B", hidden: "#94A3B8" };
const PLACE_TIP = {
  bar: "Dans le menu : la barre latérale, et la barre du bas au téléphone",
  more: "Dans « Plus » au téléphone ; à part sous le menu sur ordinateur",
  profile: "Dans le menu du profil (la pastille du compte)",
  hidden: "Nulle part : la page reste joignable par un lien ou la recherche",
};

export default function MenuSettings() {
  const me = useAuth(s => s.username);
  const isAdmin = useAuth(s => s.role) === ROLE_ADMIN;
  const [who, setWho] = useState("");                 // "" : mon menu ; sinon le compte regle par l'administrateur
  const [accounts, setAccounts] = useState([]);
  const [saved, setSaved] = useState(undefined);      // le reglage lu (null : le menu par defaut)
  const [state, setState] = useState("");
  const timer = useRef(null);
  const mine = useNavStore(s => s.saved), mineLoaded = useNavStore(s => s.loaded);

  useEffect(() => {
    if (isAdmin) client.get("/home/menu/accounts").then(r => setAccounts(r.data.accounts || [])).catch(() => setAccounts([]));
  }, [isAdmin]);
  useEffect(() => {
    if (!who) { if (!mineLoaded) loadNavMenu(); setSaved(mine); return; }
    setSaved(undefined);
    client.get(`/home/menu/of/${encodeURIComponent(who)}`).then(r => setSaved(r.data.menu || null)).catch(() => setSaved(null));
  }, [who, mine, mineLoaded]);

  const role = who ? (accounts.find(a => a.username === who)?.role) : (isAdmin ? ROLE_ADMIN : "");
  const list = normalize(saved, role === ROLE_ADMIN);
  const put = async next => {
    const menu = next ? pack(next) : null;
    setSaved(menu);
    if (!who) useNavStore.getState().set(menu);       // mon menu change tout de suite
    clearTimeout(timer.current);
    setState("…");
    timer.current = setTimeout(async () => {
      try {
        if (who) await client.put(`/home/menu/of/${encodeURIComponent(who)}`, { menu });
        else await client.put("/home/menu", { menu });
        setState("Enregistré");
        if (menu) egg("menu_perso");
      } catch (e) { setState("Erreur : " + (e.response?.data?.detail || e.message)); }
    }, 450);
  };
  const move = (i, d) => {
    const j = i + d;
    if (j < 1 || j >= list.length || i < 1) return;      // Accueil reste en tete
    const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; put(next);
  };
  const place = (i, p) => { const next = list.map((x, k) => k === i ? { ...x, place: p } : x); put(next); };
  const reset = async () => {
    if (!await showConfirm(who ? `Remettre le menu par défaut pour ${who} ?` : "Remettre le menu par défaut ?")) return;
    put(null);
  };

  // l'apercu de la barre du bas au telephone
  const bar = list.filter(x => x.place === "bar"), more = list.filter(x => x.place === "more");
  const needMore = more.length > 0 || bar.length > MOBILE_SLOTS;
  const bottom = needMore ? bar.slice(0, MOBILE_SLOTS - 1) : bar;
  const inMore = needMore ? [...bar.slice(MOBILE_SLOTS - 1), ...more] : [];
  const prof = list.filter(x => x.place === "profile");

  return <div className="card" style={{ padding: 16 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
      <div style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", flex: 1, minWidth: 120 }}>Menu</div>
      {isAdmin && accounts.length > 0 && <div style={{ minWidth: 170 }}>
        <Select value={who} onChange={setWho} options={[{ value: "", label: `Mon menu (${me})` },
          ...accounts.map(a => ({ value: a.username, label: `${a.username}${a.own ? "" : " · par défaut"}` }))]}/></div>}
      {state && <span style={{ fontSize: 11.5, fontWeight: 700, color: state.startsWith("Erreur") ? "#EF4444" : "var(--muted)" }}>{state}</span>}
    </div>
    <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.45 }}>
      {who ? `Le menu de ${who} : ses pages, leur ordre, et où les trouver.` : "Tes pages, leur ordre, et où les trouver."} Accueil reste toujours en tête du menu ;
      Paramètres va dans le menu ou dans le profil. Une page masquée reste joignable par un lien ou la recherche.</p>

    {/* l'apercu : la barre du bas du telephone, « Plus » et le profil */}
    {saved !== undefined && <div style={{ marginBottom: 12, padding: 10, borderRadius: 14, background: "var(--surface2)", border: "1px solid var(--border)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>Au téléphone</div>
      <div style={{ display: "flex", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--border)", padding: "6px 2px" }}>
        {[...bottom, ...(needMore ? [{ k: "_more", icon: MoreHorizontal, label: "Plus", c: "#64748B" }] : [])].map(it => { const Icon = it.icon;
          return <span key={it.k} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, color: it.c, fontSize: 9.5, fontWeight: 800 }}>
            <Icon size={16}/><span style={{ maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text2)" }}>{it.short || it.label}</span></span>; })}
      </div>
      {inMore.length > 0 && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
        <b style={{ color: PLACE_C.more }}>Plus</b> : {inMore.map(x => x.short || x.label).join(", ")}</div>}
      {prof.length > 0 && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
        <b style={{ color: PLACE_C.profile }}>Profil</b> : {prof.map(x => x.short || x.label).join(", ")}</div>}
    </div>}

    {saved === undefined ? <div style={{ fontSize: 12.5, color: "var(--muted)" }}>…</div>
      : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {list.map((it, i) => { const Icon = it.icon, ok = placesOf(it.k), locked = it.k === "home";
        return <div key={it.k} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "7px 8px", borderRadius: 12,
          border: "1px solid var(--border)", background: it.place === "hidden" ? "transparent" : "var(--surface)", opacity: it.place === "hidden" ? 0.65 : 1 }}>
          <span style={{ display: "flex", flexDirection: "column" }}>
            <button type="button" aria-label="Monter" disabled={locked || i <= 1} onClick={() => move(i, -1)}
              style={{ border: "none", background: "none", padding: 0, height: 15, cursor: locked || i <= 1 ? "default" : "pointer", color: "var(--muted)", opacity: locked || i <= 1 ? 0.25 : 1 }}><ChevronUp size={15}/></button>
            <button type="button" aria-label="Descendre" disabled={locked || i >= list.length - 1} onClick={() => move(i, 1)}
              style={{ border: "none", background: "none", padding: 0, height: 15, cursor: locked || i >= list.length - 1 ? "default" : "pointer", color: "var(--muted)", opacity: locked || i >= list.length - 1 ? 0.25 : 1 }}><ChevronDown size={15}/></button>
          </span>
          <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: `color-mix(in srgb, ${it.c} 16%, transparent)`, color: it.c }}><Icon size={16}/></span>
          <span style={{ flex: "1 1 110px", minWidth: 0, fontSize: 13.5, fontWeight: 800, color: "var(--text)" }}>{it.label}
            {locked && <Lock size={12} style={{ marginLeft: 6, verticalAlign: -1, color: "var(--muted)" }}/>}</span>
          <span role="radiogroup" aria-label={`Place de ${it.label}`} style={{ display: "flex", gap: 2, padding: 2, borderRadius: 10, background: "var(--surface2)", border: "1px solid var(--border)" }}>
            {PLACES.filter(([p]) => ok.includes(p)).map(([p, l]) => { const on = it.place === p;
              return <button key={p} type="button" role="radio" aria-checked={on} onClick={() => !on && place(i, p)} data-tip={PLACE_TIP[p]}
                style={{ border: "none", borderRadius: 8, padding: "4px 9px", fontSize: 11.5, fontWeight: 800, cursor: on ? "default" : "pointer",
                  background: on ? PLACE_C[p] : "transparent", color: on ? "#fff" : "var(--text2)" }}>{l}</button>; })}
          </span>
        </div>; })}
    </div>}
    {saved && <button type="button" onClick={reset} style={{ marginTop: 10, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)",
      borderRadius: 10, padding: "7px 12px", fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>↺ Menu par défaut</button>}
  </div>;
}
