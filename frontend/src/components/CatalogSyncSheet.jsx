import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import client from "../api/client";
import { FSheet, fBtn } from "./FicheKit";
import { CatalogSwatch, CatalogLinkSheet } from "./CatalogPicker";
import { showAlert } from "../utils/dialog";
import { egg } from "../eggs";

// La synchro avec les catalogues (03/11/2026) : Bambu et autres marques, en deux temps. L'apercu (rien n'est enregistre)
// range chaque filament : mises a jour sures (cochees), correspondances devinees (a valider une a une, en choisissant
// parmi les propositions ou en cherchant soi-meme), sans correspondance (a chercher), deja a jour. « Appliquer » n'envoie
// que ce qui est coche ou valide.
const LABEL = { translated_name: "Nom", name: "Nom anglais", fila_type: "Type", material: "Famille", color: "Couleur", colors_array: "Couleurs",
  multicolor_type: "Multicolore", fila_color_code: "Code couleur", profile_id: "Profil", manufacturer: "Marque", spool_weight_g: "Support vide",
  // la fiche technique (05/11/2026)
  density: "Densité", nozzle_min: "Buse min", nozzle_max: "Buse max", bed_min: "Plateau min", bed_max: "Plateau max",
  dry_temp: "Séchage", dry_hours: "Durée de séchage", td: "Transparence (TD)", gtin: "Code-barres", buy_url: "Lien d'achat" };
const UNIT = { density: " g/cm³", nozzle_min: " °C", nozzle_max: " °C", bed_min: " °C", bed_max: " °C", dry_temp: " °C", dry_hours: " h" };
const SRC = { bambu: ["Bambu", "#0EA5E9"], boutique: ["Boutique", "#22C55E"], ofd: ["OFD", "#8B5CF6"], own: ["Nous", "#F59E0B"], fc: ["FilamentColors", "#14B8A6"] };
const val = (k, v) => v == null || v === "" ? "—" : k === "color" ? `#${String(v).replace(/^#/, "").slice(0, 6)}` : k === "spool_weight_g" ? `${Math.round(v)} g`
  : k === "buy_url" ? String(v).split("//").pop().split("/")[0] : `${String(v).replace(".", ",")}${UNIT[k] || ""}`;
const sw = (hex, size = 26) => <span style={{ width: size, height: size, borderRadius: Math.round(size * 0.28), flexShrink: 0,
  background: hex ? `#${String(hex).replace(/^#/, "").slice(0, 6)}` : "repeating-linear-gradient(135deg, var(--border) 0 3px, transparent 3px 6px)",
  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.22)" }}/>;
const other = p => p.source && p.source !== "bambu";
const keyOf = p => other(p) ? `${p.source}:${p.ref}` : `b:${p.fila_id}:${p.fila_color_code}`;
const bodyOf = p => other(p) ? { source: p.source, ref: p.ref } : { fila_id: p.fila_id, fila_color_code: p.fila_color_code };

export default function CatalogSyncSheet({ onClose, onDone, z = 1500 }) {
  const [d, setD] = useState(null);
  const [on, setOn] = useState({});             // id -> true : mise a jour sure cochee
  const [off, setOff] = useState({});           // id -> {champ: true} : les champs decoches (05/11/2026)
  const [pick, setPick] = useState({});         // id -> proposition choisie (cle) ; validee si dans ok
  const [ok, setOk] = useState({});             // id -> true : correspondance devinee validee
  const [linked, setLinked] = useState({});     // id -> nom : rattache a la main depuis cette fenetre
  const [find, setFind] = useState(null);       // le filament a chercher soi-meme
  const [busy, setBusy] = useState(false);
  const [showOk, setShowOk] = useState(false);
  const load = () => client.get("/filaments/filaments/enrich/preview").then(r => {
    setD(r.data);
    setOn(Object.fromEntries(r.data.items.filter(x => x.status === "sure").map(x => [x.id, true])));
    setPick(Object.fromEntries(r.data.items.filter(x => x.status === "guess").map(x => [x.id, keyOf(x.proposals[0])])));
  }).catch(e => { showAlert(e.response?.data?.detail || e.message); onClose(); });
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const g = useMemo(() => {
    const by = s => (d?.items || []).filter(x => x.status === s && !linked[x.id]);
    return { sure: by("sure"), guess: by("guess"), none: by("none"), ok: by("ok") };
  }, [d, linked]);
  const kept = x => x.changes.filter(c => !off[x.id]?.[c.f]);
  const n = g.sure.filter(x => on[x.id] && kept(x).length).length + g.guess.filter(x => ok[x.id]).length;
  const strong = g.guess.filter(x => x.strong);
  const apply = async () => {
    const items = [
      ...g.sure.filter(x => on[x.id] && kept(x).length).map(x => ({ id: x.id, ...(x.tech_only ? { tech_only: true } : bodyOf(x.proposals[0])), link: false,
        fields: kept(x).map(c => c.f) })),
      ...g.guess.filter(x => ok[x.id]).map(x => ({ id: x.id, ...bodyOf(x.proposals.find(p => keyOf(p) === pick[x.id]) || x.proposals[0]), link: true })),
    ];
    setBusy(true);
    try {
      const { data } = await client.post("/filaments/filaments/enrich/apply", { items });
      if (data.errors?.length) showAlert(`${data.errors.length} non appliqué${data.errors.length > 1 ? "s" : ""} : ${data.errors.map(e => `#${e.id} ${e.error}`).join(" ; ")}`);
      if (items.some(x => x.link)) egg("catalogue_rattache");
      onDone?.({ updated: data.updated + Object.keys(linked).length, errors: data.errors?.length || 0 });
      onClose();
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setBusy(false); }
  };

  const head = (t, c, count, extra = null) => <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
    <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: c }}>{t} · {count}</span>
    <span style={{ flex: 1, height: 1, background: "var(--border)" }}/>{extra}</div>;
  const who = x => <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, flex: 1 }}>
    {sw(x.color)}
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>#{x.id} {x.name}</div>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {[x.manufacturer || "sans marque", x.fila_type || x.material].filter(Boolean).join(" · ")}</div>
    </div></div>;
  const card = (c, children) => <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 14,
    border: `1px solid color-mix(in srgb, ${c} 30%, var(--border))`, background: `linear-gradient(135deg, ${c}10, transparent 60%), var(--surface2)` }}>{children}</div>;
  const toggle = (state, label, onClick, c) => <button type="button" onClick={onClick} aria-pressed={state}
    style={{ padding: "5px 11px", borderRadius: 20, fontSize: 12, fontWeight: 900, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
      border: state ? "none" : "1px solid var(--border)", color: state ? "#fff" : "var(--text2)",
      background: state ? `linear-gradient(135deg, ${c}, ${c}cc)` : "var(--surface)" }}>{label}</button>;
  const search = x => <button type="button" onClick={() => setFind(x)} style={{ padding: "5px 11px", borderRadius: 20, fontSize: 12, fontWeight: 800,
    cursor: "pointer", whiteSpace: "nowrap", border: "1px solid var(--border)", background: "var(--surface)", color: "#6366F1" }}>🔍 Chercher…</button>;

  return createPortal(<>
    <FSheet onClose={onClose} z={z} bottom={<>
      <button onClick={onClose} style={{ ...fBtn, flex: 1, color: "var(--muted)" }}>Annuler</button>
      <button onClick={apply} disabled={busy || !d || (!n && !Object.keys(linked).length)} style={{ ...fBtn, flex: 2, border: "none", color: "#fff",
        background: busy || !n ? "var(--border)" : "linear-gradient(135deg, #3B82F6, #6366F1)" }}>
        {busy ? "Application…" : n ? `Appliquer (${n})` : Object.keys(linked).length ? "Terminer" : "Rien à appliquer"}</button></>}>
      <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#3B82F6" }}>Synchro des catalogues</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45 }}>
          Bambu Lab et autres marques. Rien n'est encore enregistré : coche ou valide ce qui doit l'être, puis « Appliquer ».</div>
        {!d ? <p style={{ fontSize: 13, fontWeight: 700, color: "var(--muted)" }}>Comparaison avec les catalogues…</p> : <>
          {(!d.bambu_ready || !d.others_ready) && <p style={{ fontSize: 12, fontWeight: 700, color: "#d97706", margin: 0 }}>
            {!d.bambu_ready ? "Catalogue Bambu pas encore téléchargé. " : ""}{!d.others_ready ? "Catalogue des autres marques pas encore téléchargé (une minute après le démarrage)." : ""}</p>}

          {g.sure.length > 0 && <>{head("Mises à jour", "#16a34a", g.sure.length,
            toggle(g.sure.every(x => on[x.id]), g.sure.every(x => on[x.id]) ? "Tout décocher" : "Tout cocher",
              () => { const all = g.sure.every(x => on[x.id]); setOn(Object.fromEntries(g.sure.map(x => [x.id, !all]))); }, "#16a34a"))}
            {g.sure.map(x => <React.Fragment key={x.id}>{card("#16a34a", <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{who(x)}
                {toggle(!!on[x.id], on[x.id] ? "✓ Oui" : "Non", () => setOn(m => ({ ...m, [x.id]: !m[x.id] })), "#16a34a")}</div>
              {/* chaque champ se coche ou non (05/11/2026) : decoche, il garde sa valeur */}
              <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 35, opacity: on[x.id] ? 1 : 0.5 }}>
                {x.changes.map(c => { const sel = !off[x.id]?.[c.f];
                  return <label key={c.f} style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text2)", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", cursor: "pointer" }}>
                    <input type="checkbox" checked={sel && !!on[x.id]} disabled={!on[x.id]} style={{ accentColor: "#16a34a", margin: 0 }}
                      onChange={() => setOff(m => ({ ...m, [x.id]: { ...(m[x.id] || {}), [c.f]: sel } }))}/>
                    <span style={{ color: "var(--muted)", minWidth: 96 }}>{LABEL[c.f] || c.f}</span>
                    <span style={{ color: "var(--muted)", textDecoration: "line-through" }}>{val(c.f, c.a)}</span><span>→ {val(c.f, c.b)}</span>
                    {c.src && SRC[c.src] && <span style={{ fontSize: 9.5, fontWeight: 900, padding: "0 6px", borderRadius: 20, color: SRC[c.src][1],
                      background: `color-mix(in srgb, ${SRC[c.src][1]} 14%, transparent)` }}>{SRC[c.src][0]}</span>}</label>; })}</div>
            </>)}</React.Fragment>)}</>}

          {g.guess.length > 0 && <>{head("À confirmer", "#F59E0B", g.guess.length,
            strong.length > 0 && toggle(strong.every(x => ok[x.id]), `Valider les ${strong.length} sûres`,
              () => { const all = strong.every(x => ok[x.id]); setOk(m => ({ ...m, ...Object.fromEntries(strong.map(x => [x.id, !all])) })); }, "#F59E0B"))}
            {g.guess.map(x => <React.Fragment key={x.id}>{card("#F59E0B", <>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{who(x)}
                {toggle(!!ok[x.id], ok[x.id] ? "✓ Validé" : "Valider", () => setOk(m => ({ ...m, [x.id]: !m[x.id] })), "#F59E0B")}</div>
              <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 2 }}>
                {x.proposals.map((p, k) => { const sel = pick[x.id] === keyOf(p);
                  return <button key={keyOf(p)} type="button" onClick={() => { setPick(m => ({ ...m, [x.id]: keyOf(p) })); setOk(m => ({ ...m, [x.id]: true })); }}
                    data-tip={`${p.brand} · ${p.fila_type}${p.source === "own" ? " · notre catalogue" : ""}${other(p) && p.spool_weight_g ? ` · support ${Math.round(p.spool_weight_g)} g` : p.fila_color_code ? ` · ${p.fila_color_code}` : ""}${p.hex_approx ? " · teinte approchée" : ""}`}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 9px", borderRadius: 12, cursor: "pointer", flexShrink: 0, maxWidth: 210, textAlign: "left",
                      border: sel ? "2px solid #F59E0B" : "1px solid var(--border)", background: sel ? "color-mix(in srgb, #F59E0B 12%, var(--surface))" : "var(--surface)" }}>
                    <CatalogSwatch e={p} size={24}/>
                    <span style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                      <span style={{ fontSize: 12, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {k === 0 ? "★ " : ""}{p.name_fr && p.name_fr !== p.name ? p.name_fr : p.name}</span>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {p.fila_type}{p.source === "bambu" ? ` · ${p.fila_color_code}` : ""}</span></span></button>; })}
                {search(x)}</div>
              {!x.strong && <span style={{ fontSize: 11, fontWeight: 700, color: "#d97706" }}>Ressemblance faible : vérifie la couleur et la gamme.</span>}
            </>)}</React.Fragment>)}</>}

          {g.none.length > 0 && <>{head("Sans correspondance", "#64748B", g.none.length)}
            {g.none.map(x => <React.Fragment key={x.id}>{card("#64748B", <div style={{ display: "flex", alignItems: "center", gap: 8 }}>{who(x)}{search(x)}</div>)}
              {x.reason && <span style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginTop: -4, paddingLeft: 12 }}>{x.reason}</span>}</React.Fragment>)}</>}

          {Object.keys(linked).length > 0 && <>{head("Rattachés à la main", "#6366F1", Object.keys(linked).length)}
            {Object.entries(linked).map(([id, nm]) => <span key={id} style={{ fontSize: 12.5, fontWeight: 700, color: "#16a34a" }}>#{id} → {nm} ✓</span>)}</>}

          {g.ok.length > 0 && <>{head("Déjà à jour", "#94A3B8", g.ok.length,
            <button type="button" onClick={() => setShowOk(v => !v)} style={{ border: "none", background: "none", color: "var(--muted)", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
              {showOk ? "Masquer" : "Voir"}</button>)}
            {showOk && g.ok.map(x => <div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px" }}>{who(x)}</div>)}</>}
          {!d.items.length && <p style={{ fontSize: 13, color: "var(--muted)" }}>Aucun filament.</p>}
        </>}
      </div>
    </FSheet>
    {find && <CatalogLinkSheet f={{ ...find, name: find.name, color: find.color }} z={z + 10} onClose={() => setFind(null)}
      onDone={r => setLinked(m => ({ ...m, [find.id]: r.name }))}/>}
  </>, document.body);
}
