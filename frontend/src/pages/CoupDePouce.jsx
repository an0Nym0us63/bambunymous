import React, { useEffect, useMemo, useState } from "react";
import client from "../api/client";
import { egg } from "../eggs";
import { useTrackDetail } from "../utils/track";

// Le coup de pouce (28/10/2026) : une seule page, a la place de « rembobiner » (tours de roue) et de l'ancien
// « coup de pouce » (chance de surprise). On choisit a qui, quoi et combien, plusieurs cadeaux et plusieurs
// comptes a la fois, et tout part en un envoi (meme secret qu'avant : le mot de passe).
const KINDS = [
  { k: "spins",   e: "🎡", label: "Tours de roue",      hint: "la maison, ou un compte de la famille qui a sa roue", unit: n => `tour${n > 1 ? "s" : ""}` },
  { k: "keys",    e: "🔑", label: "Clés",               hint: "la maison seulement", unit: n => `clé${n > 1 ? "s" : ""}` },
  { k: "tickets", e: "🎟️", label: "Tickets de palier", hint: "la maison seulement", unit: n => `ticket${n > 1 ? "s" : ""}` },
  { k: "loupes",  e: "🔎", label: "Loupes",             hint: "tous les comptes", unit: n => `loupe${n > 1 ? "s" : ""}` },
];
const can = (a, k) => k === "loupes" || k === "surprise" ? true : k === "spins" ? !!a.wheel : !!a.main;
const pct = p => p == null ? "—" : `${(Math.round(p * 1000) / 10).toString().replace(".", ",")} %`;
const ago = l => { if (!l) return "jamais comptée"; const m = Math.max(0, Math.round((Date.now() - new Date(/Z|[+-]\d\d:\d\d$/.test(l) ? l : l + "Z")) / 60000));
  return m < 60 ? `il y a ${m} min` : m < 1440 ? `il y a ${Math.floor(m / 60)} h` : `il y a ${Math.floor(m / 1440)} j`; };
const field = { padding: "10px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontSize: 14 };

// − n + : un compteur a deux boutons, le chiffre editable au milieu
function Stepper({ value, onChange, step = 1, min = 0, max = 100, suffix = "" }) {
  const b = { width: 34, height: 34, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
    fontSize: 18, fontWeight: 800, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" };
  const set = v => onChange(Math.max(min, Math.min(max, v)));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <button type="button" aria-label="Moins" onClick={() => set(value - step)} style={b}>−</button>
      <input type="text" inputMode="numeric" value={value} aria-label="Quantité"
        onChange={e => { const v = parseInt(String(e.target.value).replace(/\D/g, ""), 10); set(Number.isFinite(v) ? v : 0); }}
        style={{ ...field, width: 54, textAlign: "center", padding: "7px 4px", fontWeight: 800, fontVariantNumeric: "tabular-nums" }}/>
      {suffix && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{suffix}</span>}
      <button type="button" aria-label="Plus" onClick={() => set(value + step)} style={b}>+</button>
    </div>
  );
}

export default function CoupDePouce() {
  useTrackDetail("Coup de pouce");
  const [accs, setAccs] = useState(null);
  const [sel, setSel] = useState(() => new Set());
  const [qty, setQty] = useState({ spins: 0, keys: 0, tickets: 0, loupes: 0 });
  const [surprise, setSurprise] = useState("");       // "" = pas touche
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);

  const load = async () => {
    const { data } = await client.get("/achievements/gift/accounts");
    setAccs(data.accounts || []);
    setSel(s => s.size ? s : new Set((data.accounts || []).slice(0, 1).map(a => a.username)));
  };
  useEffect(() => { load().catch(e => setErr(e.response?.data?.detail || e.message)); }, []);

  const toggle = u => { setSel(s => { const n = new Set(s); n.has(u) ? n.delete(u) : n.add(u); return n; }); setErr(""); setResult(null); };
  const chosen = (accs || []).filter(a => sel.has(a.username));
  const surpriseN = surprise === "" ? null : Math.max(0, Math.min(100, Number(String(surprise).replace(",", ".")) || 0));

  // ce qui partira : un cadeau par (compte, chose), seulement la ou il a un sens
  const gifts = useMemo(() => {
    const out = [];
    for (const a of chosen) {
      for (const { k } of KINDS) if (qty[k] > 0 && can(a, k)) out.push({ to: a.username, kind: k, n: qty[k] });
      if (surpriseN != null) out.push({ to: a.username, kind: "surprise", n: surpriseN });
    }
    return out;
  }, [chosen, qty, surpriseN]);
  const skipped = useMemo(() => chosen.flatMap(a => KINDS.filter(({ k }) => qty[k] > 0 && !can(a, k)).map(({ label }) => `${label.toLowerCase()} pour ${a.username}`)), [chosen, qty]);

  const summary = chosen.map(a => {
    const parts = KINDS.filter(({ k }) => qty[k] > 0 && can(a, k)).map(({ k, unit }) => `${qty[k]} ${unit(qty[k])}`);
    if (surpriseN != null) parts.push(`${String(surpriseN).replace(".", ",")} % de chance de surprise`);
    return parts.length ? `${a.main ? "La maison" : a.username} : ${parts.join(", ")}` : null;
  }).filter(Boolean);

  const go = async e => {
    e.preventDefault();
    if (!gifts.length) { setErr(chosen.length ? "Choisis quoi offrir" : "Choisis à qui offrir"); return; }
    if (!pw) { setErr("Mot de passe requis"); return; }
    setBusy(true); setErr(""); setResult(null);
    try {
      const { data } = await client.post("/achievements/gift", { secret: pw, gifts });
      setResult(data);
      setPw(""); setQty({ spins: 0, keys: 0, tickets: 0, loupes: 0 }); setSurprise("");
      if ((data.done || []).length >= 2) egg("mecene");
      await load();
    } catch (e2) { setErr(e2.response?.data?.detail || e2.message); }
    setBusy(false);
  };

  const step = (n, t) => <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "4px 0 2px" }}>
    <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#3b82f6", color: "#fff", fontSize: 12.5, fontWeight: 900,
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</span>
    <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)" }}>{t}</span></div>;

  return (
    <form onSubmit={go} style={{ maxWidth: 560, margin: "28px auto", padding: "0 16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40 }}>🎁</div>
        <h2 style={{ margin: "4px 0 2px", color: "var(--text)" }}>Coup de pouce</h2>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 13.5 }}>Des tours, des clés, des tickets, des loupes ou une surprise : à qui tu veux, tout d'un coup.</p>
      </div>

      {step(1, "À qui ?")}
      {!accs && !err && <p style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>Je regarde qui est à la maison…</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {(accs || []).map(a => { const on = sel.has(a.username); return (
          <button type="button" key={a.username} onClick={() => toggle(a.username)} aria-pressed={on}
            style={{ ...field, textAlign: "left", cursor: "pointer", display: "flex", flexDirection: "column", gap: 4, padding: "10px 12px",
              border: `2px solid ${on ? "#3b82f6" : "var(--border)"}`, background: on ? "color-mix(in srgb, #3b82f6 10%, var(--surface2))" : "var(--surface2)" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", background: a.main ? "#f59e0b" : "#8b5cf6", color: "#fff", fontWeight: 900,
                fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{(a.username || "?")[0].toUpperCase()}</span>
              <span style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.username}</span>
              {on && <span style={{ marginLeft: "auto", color: "#3b82f6", fontWeight: 900 }}>✓</span>}
            </span>
            <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700 }}>{a.main ? "la maison" : a.wheel ? "famille, sa roue" : "compte"}</span>
            <span style={{ fontSize: 12, color: "var(--text2)", fontWeight: 700, display: "flex", flexWrap: "wrap", gap: "2px 8px", fontVariantNumeric: "tabular-nums" }}>
              {a.wheel && <span data-tip="Tours de roue">🎡 {a.spins ?? 0}</span>}
              {a.main && <span data-tip="Clés">🔑 {a.keys ?? 0}</span>}
              {a.main && <span data-tip="Tickets de palier">🎟️ {a.tickets ?? 0}</span>}
              <span data-tip="Loupes">🔎 {a.loupes ?? 0}</span>
              <span data-tip={`Chance de surprise à la prochaine ouverture · dernière ouverture ${ago(a.last)}`}>✨ {a.pending ? "en attente" : pct(a.surprise)}</span>
            </span>
          </button>); })}
      </div>

      {step(2, "Quoi, et combien ?")}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 8 }}>
        {KINDS.map(({ k, e, label, hint }) => { const ok = chosen.some(a => can(a, k)); return (
          <div key={k} style={{ ...field, display: "flex", flexDirection: "column", gap: 8, opacity: chosen.length && !ok ? 0.45 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 22 }}>{e}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800 }}>{label}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700 }}>{hint}</div>
              </div>
            </div>
            <Stepper value={qty[k]} onChange={v => { setQty(q => ({ ...q, [k]: v })); setErr(""); setResult(null); }}/>
          </div>); })}
        <div style={{ ...field, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>✨</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800 }}>Chance de surprise</div>
              <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 700 }}>à la prochaine ouverture de l'appli, puis ça remonte comme d'habitude</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <Stepper value={surprise === "" ? 0 : Math.round(surpriseN)} step={10} max={100} suffix="%"
              onChange={v => { setSurprise(String(v)); setErr(""); setResult(null); }}/>
            {surprise !== "" && <button type="button" onClick={() => setSurprise("")} style={{ border: "none", background: "none", color: "var(--muted)",
              fontSize: 12, fontWeight: 700, cursor: "pointer" }}>ne pas toucher</button>}
          </div>
        </div>
      </div>

      {step(3, "C'est parti")}
      <div style={{ ...field, display: "flex", flexDirection: "column", gap: 8 }}>
        {summary.length ? summary.map(t => <div key={t} style={{ fontSize: 13.5, fontWeight: 700 }}>{t}</div>)
          : <div style={{ fontSize: 13, color: "var(--muted)", fontWeight: 700 }}>{chosen.length ? "Choisis quoi offrir au-dessus." : "Choisis d'abord à qui."}</div>}
        {skipped.length > 0 && <div style={{ fontSize: 12, color: "#f59e0b", fontWeight: 700 }}>Pas possible : {skipped.join(", ")}.</div>}
      </div>
      <input type="password" value={pw} onChange={e => { setPw(e.target.value); setErr(""); }} placeholder="Mot de passe" autoComplete="off" style={field}/>
      <button type="submit" disabled={busy || !gifts.length} style={{ padding: "12px 0", borderRadius: 12, border: "none", fontSize: 15,
        background: gifts.length ? "linear-gradient(135deg, #3b82f6, #8b5cf6)" : "var(--surface2)", color: gifts.length ? "#fff" : "var(--muted)",
        fontWeight: 800, cursor: gifts.length ? "pointer" : "default" }}>
        {busy ? "…" : gifts.length > 1 ? `Offrir ces ${gifts.length} cadeaux 🎁` : "Offrir 🎁"}</button>
      {err && <p style={{ margin: 0, textAlign: "center", color: "#ef4444", fontSize: 13, fontWeight: 700 }}>{err}</p>}
      {result && <div style={{ ...field, background: "color-mix(in srgb, #22c55e 10%, var(--surface2))", border: "1px solid color-mix(in srgb, #22c55e 40%, transparent)",
        display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 700 }}>
        {(result.done || []).map((d, i) => { const K = KINDS.find(x => x.k === d.kind); return (
          <div key={i}>{K ? `${K.e} ${d.to} : +${d.n} ${K.unit(d.n)} → ${d.now}` : `✨ ${d.to} : ${d.pending ? "une surprise l'attend déjà" : `prochaine ouverture à ${pct(d.now)}`}`}</div>); })}
        {(result.errors || []).map((d, i) => <div key={`e${i}`} style={{ color: "#ef4444" }}>{d.to} · {d.error}</div>)}
      </div>}
    </form>
  );
}
