import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import { egg } from "../eggs";
import { ELEC_PALETTE, elecDefault, setElecColors } from "../utils/elecColor";

// Home Assistant (12/11/2026) : la prise de l'imprimante (etat, puissance, energie) et l'electricite reelle de chaque
// impression, au tarif de l'abonnement (configure ici, ou lu chez Home Assistant). Le jeton se colle ici, jamais reaffiche.
const inp = { width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10,
  padding:"9px 12px", fontSize:13, color:"var(--text)", outline:"none", boxSizing:"border-box" };
const lbl = { display:"block", fontSize:11, fontWeight:600, color:"var(--muted)", marginBottom:4 };
const btn = (primary, dis = false) => ({ padding:"9px 14px", borderRadius:10, fontSize:13, fontWeight:700, cursor: dis ? "not-allowed" : "pointer",
  border: primary ? "none" : "1px solid var(--border)", background: dis ? "var(--border)" : primary ? "linear-gradient(135deg, #18BCF2, #0284C7)" : "var(--surface2)",
  color: primary || dis ? "white" : "var(--text)", whiteSpace:"nowrap" });
const sub = { fontSize:12.5, fontWeight:800, color:"var(--text)", margin:"4px 0 0" };
const note = { fontSize:12, color:"var(--muted)", margin:0, lineHeight:1.45 };
const err = e => showAlert(e.response?.data?.detail || e.message);
const eur = v => v == null ? "—" : `${Number(v).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/kWh`;
const MODES = [["hour", "À l'heure, sans mesure (tarif de l'onglet Imprimante)"], ["base", "Base : un seul prix"],
  ["hchp", "Heures creuses / heures pleines"], ["tempo", "Tempo (bleu, blanc, rouge)"], ["ha", "Via Home Assistant (prix et libellé en cours)"]];
const TEMPO = [["bleu", "🔵 Bleu"], ["blanc", "⚪ Blanc"], ["rouge", "🔴 Rouge"]];
const str = v => (v == null ? "" : String(v));

function EntitySelect({ value, list, onChange, empty = "(aucune)", label, hint }) {
  const has = !value || (list || []).some(x => x.id === value);
  return <div style={{ minWidth:0 }}><span style={lbl}>{label}</span>
    <select value={value || ""} onChange={e => onChange(e.target.value)} style={inp}>
      <option value="">{empty}</option>
      {!has && <option value={value}>{value}</option>}
      {(list || []).map(x => <option key={x.id} value={x.id}>{x.name}{x.state != null ? ` · ${x.state}${x.unit ? " " + x.unit : ""}` : ""}</option>)}
    </select>
    {hint && <span style={{ ...note, fontSize:11, display:"block", marginTop:3 }}>{hint}</span>}</div>;
}

export default function HomeAssistantSettings({ card, cardTitle }) {
  const [s, setS] = useState(null), [url, setUrl] = useState(""), [tok, setTok] = useState(""), [busy, setBusy] = useState(false);
  const [ents, setEnts] = useState({}), [ver, setVer] = useState(null), [live, setLive] = useState(null);
  const [el, setEl] = useState(null), [days, setDays] = useState("3650");
  const poll = useRef(null);
  const take = d => { setS(d); setUrl(d.url || ""); setEl(e => e || d.elec); setElecColors(d.colors); };
  const load = () => client.get("/settings/ha").then(r => {
    take(r.data);
    clearTimeout(poll.current);
    if (r.data.backfill?.running) poll.current = setTimeout(load, 3000);
  }).catch(err);
  useEffect(() => { load(); return () => clearTimeout(poll.current); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const linked = !!(s && s.url && s.has_token);
  const loadEnts = () => Promise.all(["switch", "power", "energy", "price", "label"].map(k =>
    client.get("/settings/ha/entities", { params: { kind: k } }).then(r => [k, r.data]).catch(() => [k, []])))
    .then(rows => setEnts(Object.fromEntries(rows)));
  const loadLive = () => client.get("/settings/ha/live").then(r => setLive(r.data)).catch(() => {});
  useEffect(() => { if (linked) { loadEnts(); loadLive(); } }, [linked]); // eslint-disable-line react-hooks/exhaustive-deps

  const put = async (body) => {
    setBusy(true);
    try { const r = await client.put("/settings/ha", body); setS(r.data); setElecColors(r.data.colors); return r.data; }
    catch (e) { err(e); return null; }
    finally { setBusy(false); }
  };
  const saveConn = async (forget) => {
    const d = await put(forget ? { token: "-" } : { url, token: tok });
    if (d) { setTok(""); if (!forget) test(); }
  };
  const test = async () => {
    try { const r = await client.post("/settings/ha/test"); setVer(r.data); egg("prise_mesuree"); loadEnts(); loadLive(); }
    catch (e) { setVer(null); err(e); }
  };
  const saveElec = async () => { const d = await put({ elec: el }); if (d) { setEl(d.elec); loadLive(); } };
  const backfill = async () => {
    try { await client.post("/settings/ha/backfill", { days: Number(days) || 30 }); setTimeout(load, 800); } catch (e) { err(e); }
  };
  if (!s || !el) return <div className="card" style={card}><div style={cardTitle}>🏠 Home Assistant</div>
    <p style={note}>Chargement…</p></div>;
  const E = (k, v) => setEl(o => ({ ...o, [k]: v }));
  const num = (k, label, ph = "0,2016") => <div style={{ minWidth:0 }}><span style={lbl}>{label}</span>
    <input inputMode="decimal" value={str(el[k])} onChange={e => E(k, e.target.value)} placeholder={ph} style={inp}/></div>;
  const b = s.backfill || {};
  return (
    <div className="card" style={card}>
      <div style={cardTitle}>🏠 Home Assistant</div>
      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
        <p style={{ ...note, color:"var(--text2)", fontSize:12.5 }}>
          La prise de l'imprimante : son état et sa puissance en direct, et l'<b>électricité réelle de chaque impression</b> (les kWh entre son
          début et sa fin, lus dans l'historique de Home Assistant), au prix de ton abonnement heure par heure. Le jeton se crée dans Home Assistant
          (ton profil › Sécurité › Jetons d'accès longue durée) ; il reste sur ton serveur, jamais affiché.</p>

        {/* la connexion */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:8 }}>
          <div style={{ minWidth:0 }}><span style={lbl}>Adresse</span>
            <input value={url} onChange={e => setUrl(e.target.value)} placeholder="http://homeassistant.local:8123" style={inp}/></div>
          <div style={{ minWidth:0 }}><span style={lbl}>Jeton {s.has_token ? "(enregistré, laisser vide pour garder)" : ""}</span>
            <input type="password" value={tok} onChange={e => setTok(e.target.value)} autoComplete="new-password" placeholder={s.has_token ? "••••••••" : "eyJ…"} style={inp}/></div>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
          <button type="button" disabled={busy || (!tok.trim() && url === (s.url || ""))} onClick={() => saveConn(false)}
            style={btn(true, busy || (!tok.trim() && url === (s.url || "")))}>Enregistrer</button>
          {linked && <button type="button" disabled={busy} onClick={test} style={btn(false, busy)}>Tester</button>}
          {s.has_token && <button type="button" disabled={busy} onClick={() => saveConn(true)} style={{ ...btn(false, busy), color:"#ef4444" }}>Oublier le jeton</button>}
          {ver && <span style={{ fontSize:12.5, fontWeight:700, color:"#16a34a" }}>✓ {ver.name || "Home Assistant"} · {ver.version}</span>}
        </div>

        {linked && <>
          {/* la prise */}
          <p style={sub}>🔌 La prise</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:8 }}>
            <div style={{ minWidth:0 }}><span style={lbl}>Ce qu'elle mesure</span>
              <select value={s.meter} onChange={e => put({ meter: e.target.value })} style={inp}>
                <option value="energy">Puissance et énergie (compteur en kWh)</option>
                <option value="power">Puissance seule (les kWh sont calculés)</option>
              </select></div>
            <EntitySelect label="Statut (interrupteur)" value={s.switch} list={ents.switch} onChange={v => put({ switch: v })} empty="(aucun, facultatif)"/>
            <EntitySelect label="Puissance (W)" value={s.power} list={ents.power} onChange={v => put({ power: v })}/>
            {s.meter === "energy" && <EntitySelect label="Énergie (kWh)" value={s.energy} list={ents.energy} onChange={v => put({ energy: v })}/>}
          </div>
          {live && live.configured && <div style={{ fontSize:12.5, fontWeight:700, color:"var(--text2)", display:"flex", gap:10, flexWrap:"wrap" }}>
            {live.on != null && <span style={{ color: live.on ? "#16a34a" : "var(--muted)" }}>{live.on ? "● Allumée" : "○ Éteinte"}</span>}
            {live.power_w != null && <span>⚡ {Math.round(live.power_w)} W</span>}
            {live.energy_kwh != null && <span>🔢 {live.energy_kwh.toLocaleString("fr-FR")} kWh</span>}
            {live.price != null && <span>💶 {eur(live.price)}{live.label ? ` · ${live.label}` : ""}</span>}
            {live.error && <span style={{ color:"#ef4444" }}>{live.error}</span>}
          </div>}
        </>}

        {/* l'abonnement */}
        <p style={sub}>💶 L'abonnement</p>
        <select value={el.mode} onChange={e => E("mode", e.target.value)} style={inp}>
          {MODES.map(([v, l]) => <option key={v} value={v} disabled={v === "ha" && !linked}>{l}</option>)}
        </select>
        {el.mode === "hour" && <p style={note}>Le coût électrique d'une impression reste sa durée × le tarif à l'heure (onglet Imprimante). Les kWh sont tout de même mesurés si la prise est branchée.</p>}
        {el.mode === "base" && <div style={{ maxWidth:220 }}>{num("base", "Prix (€/kWh)")}</div>}
        {(el.mode === "hchp" || el.mode === "tempo") && <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(140px, 1fr))", gap:8 }}>
          {el.mode === "hchp" && <>{num("hc", "Heures creuses (€/kWh)", "0,1696")}{num("hp", "Heures pleines (€/kWh)", "0,2146")}</>}
          <div style={{ minWidth:0, gridColumn: el.mode === "tempo" ? "1 / -1" : undefined }}><span style={lbl}>Plages d'heures creuses</span>
            <input value={str(el.hc_ranges)} onChange={e => E("hc_ranges", e.target.value)} placeholder="22:00-06:00, 12:30-14:30" style={inp}/></div>
        </div>}
        {el.mode === "tempo" && <>
          <div style={{ display:"grid", gridTemplateColumns:"auto 1fr 1fr", gap:8, alignItems:"end" }}>
            <span/><span style={lbl}>Heures creuses (€/kWh)</span><span style={lbl}>Heures pleines (€/kWh)</span>
            {TEMPO.map(([c, l]) => <React.Fragment key={c}>
              <span style={{ fontSize:12.5, fontWeight:800, paddingBottom:10 }}>{l}</span>
              {["hc", "hp"].map(h => <input key={h} inputMode="decimal" value={str(el.tempo?.[`${c}_${h}`])} style={inp}
                onChange={e => setEl(o => ({ ...o, tempo: { ...o.tempo, [`${c}_${h}`]: e.target.value } }))}/>)}
            </React.Fragment>)}
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:8 }}>
            <div style={{ minWidth:0 }}><span style={lbl}>Couleur du jour</span>
              <select value={el.tempo_src} onChange={e => E("tempo_src", e.target.value)} style={inp}>
                <option value="api">Lue sur api-couleur-tempo.fr</option>
                <option value="ha" disabled={!linked}>Lue chez Home Assistant (une entité)</option>
              </select></div>
            {el.tempo_src === "ha" && <EntitySelect label="Entité de la couleur en cours" value={el.tempo_entity} list={ents.label} onChange={v => E("tempo_entity", v)}/>}
          </div>
        </>}
        {el.mode === "ha" && <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:8 }}>
          <EntitySelect label="Tarif en cours (€/kWh)" value={el.price_entity} list={ents.price} onChange={v => E("price_entity", v)}/>
          <EntitySelect label="Libellé en cours (recommandé)" value={el.label_entity} list={ents.label} onChange={v => E("label_entity", v)}
            hint="HC, HP, Bleu HP… : pour savoir, dans les stats, la part imprimée en heures creuses ou en jour rouge."/>
        </div>}
        <div><button type="button" disabled={busy} onClick={saveElec} style={btn(true, busy)}>Enregistrer l'abonnement</button></div>
        {el.mode !== "hour" && <p style={note}>Chaque impression mesurée est comptée par tranches de 15 minutes, chacune à son prix : une impression de 22 h à 8 h est
          comptée en partie en heures pleines, en partie en heures creuses. Changer de tarif reprend le prix de toutes les impressions déjà mesurées.</p>}

        {/* (12/11/2026) la couleur de chaque libelle : la barre de la fiche d'une impression et les stats */}
        {(s.labels || []).length > 0 && <>
          <p style={sub}>🎨 Couleurs des libellés</p>
          <p style={note}>Pour la barre des tarifs sur la fiche d'une impression et pour les stats. Les libellés viennent de l'abonnement et des impressions déjà mesurées.</p>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {s.labels.map(l => { const cur = (s.colors || {})[l] || elecDefault(l), mine = !!(s.colors || {})[l];
              return <div key={l} style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                <span style={{ display:"inline-flex", alignItems:"center", gap:6, minWidth:130, fontSize:12.5, fontWeight:800, color:"var(--text)" }}>
                  <span style={{ width:14, height:14, borderRadius:4, background:cur, flexShrink:0, boxShadow:"inset 0 0 0 1px color-mix(in srgb, var(--text) 20%, transparent)" }}/>{l}</span>
                <div role="radiogroup" aria-label={`Couleur de ${l}`} style={{ display:"grid", gridTemplateColumns:"repeat(8, 22px)", gap:4 }}>
                  {ELEC_PALETTE.map(c => { const on = mine && cur.toLowerCase() === c.toLowerCase();
                    return <button key={c} type="button" role="radio" aria-checked={on} aria-label={c} data-tip={c}
                      onClick={() => put({ colors: { [l]: c } })}
                      style={{ width:22, height:22, borderRadius:6, background:c, cursor:"pointer", padding:0,
                        border: on ? "2px solid var(--text)" : "1px solid color-mix(in srgb, var(--text) 18%, transparent)",
                        boxShadow: on ? `0 0 0 2px ${c}55` : "none" }}/>; })}
                </div>
                {mine && <button type="button" onClick={() => put({ colors: { [l]: null } })}
                  style={{ ...btn(false), padding:"4px 9px", fontSize:11.5 }}>Par défaut</button>}
              </div>; })}
          </div>
        </>}

        {/* le rattrapage */}
        {s.configured && <>
          <p style={sub}>⏪ Les impressions passées</p>
          <p style={note}>Chaque impression se mesure deux minutes après sa fin. Au premier branchement, l'appli remonte d'elle-même toutes les impressions
            passées que Home Assistant peut encore mesurer : le détail une dizaine de jours, puis ses statistiques à l'heure (sans limite pour un compteur
            d'énergie ; une impression plus courte qu'une heure en prend alors sa part, marquée « ≈ »). Une impression d'avant la prise passe.</p>
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ fontSize:12.5, color:"var(--text2)" }}>Les</span>
            <input inputMode="numeric" value={days} onChange={e => setDays(e.target.value.replace(/\D/g, ""))} style={{ ...inp, width:70 }}/>
            <span style={{ fontSize:12.5, color:"var(--text2)" }}>derniers jours</span>
            <button type="button" disabled={b.running} onClick={backfill} style={btn(false, b.running)}>{b.running ? `Mesure… ${b.done}/${b.total}` : "Rattraper"}</button>
          </div>
          {!b.running && b.at && <span style={{ ...note, fontSize:11.5 }}>Dernier rattrapage : {new Date(b.at).toLocaleString("fr-FR")} · {b.ok} mesurée{b.ok > 1 ? "s" : ""} sur {b.total}
            {b.error ? ` · ${b.error}` : ""}</span>}
        </>}
      </div>
    </div>
  );
}
