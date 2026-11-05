import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import client from "../api/client";
import Select from "./Select";
import { FSheet, fBtn } from "./FicheKit";
import { egg } from "../eggs";
import { showAlert } from "../utils/dialog";
import { useCatalogFacts, FactsList, MeasuredHead } from "./CatalogFacts";

// Le catalogue Bambu : famille, type, recherche (nom francais, anglais, code couleur), et la liste des entrees.
// Sorti de la creation d'un filament (02/11/2026) pour servir aussi au rattachement d'un filament existant.
// near : une couleur (hex) ; les entrees les plus proches passent devant.

export function CatalogSwatch({ e, size = 28 }) {
  const cols = (e.colors || []).map(c => `#${c}`);
  let bg;
  if (e.color_type_fr === "gradient" && cols.length > 1) {
    bg = `linear-gradient(135deg, ${cols.join(",")})`;
  } else if (e.color_type_fr === "coaxial" && cols.length > 1) {
    const pct = 100 / cols.length;
    bg = `linear-gradient(90deg, ${cols.map((c, i) => `${c} ${i * pct}%, ${c} ${(i + 1) * pct}%`).join(",")})`;
  } else {
    bg = `#${e.color_hex || "888"}`;
  }
  return <div style={{ width: size, height: size, borderRadius: Math.round(size * 0.22), flexShrink: 0, background: bg }}/>;
}

const rgb = h => {
  const s = String(h || "").replace(/^#/, "");
  return s.length >= 6 ? [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16)) : null;
};
const dist = (a, b) => a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : 1e9;

const normB = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const isBambu = b => normB(b).startsWith("bambu");

// brand0 : la marque du filament ; une autre que Bambu Lab ouvre le catalogue des autres marques sur elle (02/11/2026)
// withMeasured : l'onglet « Mesurées » (toute la bibliotheque FilamentColors, Bambu compris) : le navigateur des catalogues
export default function CatalogPicker({ onPick, field, family0 = "", type0 = "", near = null, brand0 = "", withMeasured = false }) {
  const [src, setSrc] = useState(brand0 && !isBambu(brand0) ? "ofd" : "bambu");
  const [families, setFamilies] = useState([]);
  const [typesByFamily, setTypesByFamily] = useState({});
  const [brands, setBrands] = useState(null);              // catalogue des autres marques : [{name, count, families}]
  const [brand, setBrand] = useState("");
  const [family, setFamily] = useState(family0);
  const [type, setType] = useState(type0);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);            // pas de « non disponible » avant la premiere reponse
  const fcs = src === "fc";                                // FilamentColors (05/11/2026) : toute sa bibliotheque
  const ofd = src === "ofd" || fcs;                         // le meme choix de marque

  useEffect(() => {
    client.get("/filaments/catalog/types").then(({ data }) => {
      const fams = data.families || [];
      setFamilies(fams);
      setTypesByFamily(data.types || {});
      // une famille ou un type que le catalogue ne connait pas : pas de filtre (sinon, aucun resultat)
      if (!ofd) {
        setFamily(f => fams.includes(f) ? f : "");
        setType(t => Object.values(data.types || {}).flat().includes(t) ? t : "");
      }
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ofd || brands) return;
    client.get(fcs ? "/filaments/catalog/fc/brands" : "/filaments/catalog/ofd/brands").then(({ data }) => {
      const list = data.brands || [];
      setBrands(list);
      const hit = list.find(x => normB(x.name) === normB(brand0));
      if (hit) { setBrand(hit.name); setFamily(f => (hit.families || []).includes(f) ? f : ""); setType(""); }
    }).catch(() => setBrands([]));
  }, [ofd, fcs, brands == null]); // eslint-disable-line react-hooks/exhaustive-deps

  // un quart de seconde apres la derniere frappe (28/10/2026 : un appel par frappe)
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    if (ofd && !brand) { setEntries([]); setTotal(0); setLoading(brands == null); return; }
    setLoading(true);
    const params = ofd ? { brand } : { lang: "fr" };
    if (family) params.family = family;
    if (type && !ofd) params.fila_type = type;
    if (dq.trim()) params.q = dq.trim();
    client.get(fcs ? "/filaments/catalog/fc/search" : ofd ? "/filaments/catalog/ofd/search" : "/filaments/catalog/search", { params })
      .then(({ data }) => { setEntries(data.available ? data.entries || [] : []); setTotal(data.total ?? (data.entries || []).length); })
      .catch(() => { setEntries([]); setTotal(0); })
      .finally(() => setLoading(false));
  }, [src, brand, brands == null, family, ofd ? "" : type, dq]); // eslint-disable-line react-hooks/exhaustive-deps

  // autres marques : la gamme se filtre ici, parmi les resultats
  const shown = useMemo(() => {
    const ref = rgb(near);
    const list = ofd && type ? entries.filter(e => e.fila_type === type) : entries;
    return ref ? [...list].sort((a, b) => dist(rgb(a.color_hex), ref) - dist(rgb(b.color_hex), ref)) : list;
  }, [entries, near, ofd, type]);
  const cur = ofd ? (brands || []).find(x => x.name === brand) : null;
  const famList = ofd ? (cur?.families || []) : families;
  const types = ofd ? [...new Set(entries.map(e => e.fila_type).filter(Boolean))].sort()
    : family ? (typesByFamily[family] || []) : Object.values(typesByFamily).flat();
  const tab = (id, label) => <button type="button" onClick={() => { if (src !== id) { setSrc(id); setFamily(""); setType(""); setEntries([]); setBrand(""); setBrands(null); } }}
    style={{ flex: 1, padding: "8px 10px", borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: "pointer",
      border: `1px solid ${src === id ? "#6366F1" : "var(--border)"}`, color: src === id ? "#fff" : "var(--text2)",
      background: src === id ? "linear-gradient(135deg, #3B82F6, #6366F1)" : "var(--surface)" }}>{label}</button>;
  const spoolTxt = e => !e.spool_weight_g ? "" : ` · support ${e.spool_src === "catalogue" ? "" : "≈ "}${Math.round(e.spool_weight_g)} g`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>{tab("bambu", "Bambu Lab")}{tab("ofd", "🌍 Autres marques")}
        {withMeasured && tab("fc", "🔬 Mesurées")}</div>
      {ofd && <Select searchable value={brand} onChange={e => { setBrand(e.target.value); setFamily(""); setType(""); }} style={field}
        options={[{ value: "", label: brands == null ? "Chargement des marques…" : "Choisis une marque" },
                  ...(brands || []).map(b => ({ value: b.name, label: `${b.name} · ${b.count}` }))]}/>}
      {!fcs && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Select searchable value={family} onChange={e => { setFamily(e.target.value); setType(""); }}
          style={{ ...field, flex: 1, minWidth: 120 }}
          options={[{ value: "", label: "Toutes familles" }, ...famList.map(f => ({ value: f, label: f }))]}/>
        <Select searchable value={type} onChange={e => setType(e.target.value)}
          style={{ ...field, flex: 1, minWidth: 140 }}
          options={[{ value: "", label: ofd ? "Toutes gammes" : "Tous types" }, ...types.map(t => ({ value: t, label: t }))]}/>
      </div>}
      <div style={{ position: "relative" }}>
        <Search size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "var(--muted)", pointerEvents: "none" }}/>
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder={ofd ? "Rechercher une couleur ou une gamme (Black, Silk…)" : "Rechercher une couleur (Jade White, Orange, 10402…)"}
          style={{ ...field, height: 40, borderRadius: 20, padding: "0 14px 0 38px", fontWeight: 600, fontSize: 13 }}/>
      </div>
      {near && shown.length > 1 && <p style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", margin: 0 }}>
        Les plus proches de sa couleur d'abord</p>}
      {ofd && total > entries.length && <p style={{ fontSize: 11.5, fontWeight: 700, color: "#d97706", margin: 0 }}>
        {entries.length} sur {total} : choisis une famille ou cherche pour voir le reste</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {loading && <p style={{ color: "var(--muted)", fontSize: 12.5, fontWeight: 700 }}>Recherche…</p>}
        {!loading && shown.length === 0 &&
          <p style={{ color: "var(--muted)", fontSize: 12.5, fontWeight: 700 }}>
            {ofd ? (!brand ? (brands?.length === 0 ? "Catalogue des autres marques pas encore téléchargé (quelques minutes après le démarrage)" : "Choisis une marque")
              : "Aucun résultat") : families.length === 0 ? "Catalogue non disponible (démarrage en cours…)" : "Aucun résultat"}
          </p>}
        {shown.map(e => (
          <button key={`${e.fila_id}-${e.fila_color_code}`} onClick={() => onPick(e)}
            style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
              borderRadius: 14, border: "1px solid var(--border)", background: `linear-gradient(135deg, #${e.color_hex || "888888"}22, transparent 55%), var(--surface2)`,
              cursor: "pointer", textAlign: "left", opacity: e.discontinued ? 0.6 : 1 }}>
            <span style={{ borderRadius: 9, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)", display: "inline-flex" }}><CatalogSwatch e={e} size={34}/></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 1 }}>
                <p style={{ fontSize: 13.5, fontWeight: 800, color: "var(--text)", margin: 0,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name_fr && e.name_fr !== e.name ? `${e.name_fr} · ${e.name}` : e.name}</p>
                {e.color_type_fr && e.color_type_fr !== "monochrome" && (
                  <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 20, flexShrink: 0,
                    background: e.color_type_fr === "gradient" ? "rgba(139,92,246,0.15)" : "rgba(59,130,246,0.15)",
                    color: e.color_type_fr === "gradient" ? "#8b5cf6" : "#3b82f6",
                    fontWeight: 800, textTransform: "uppercase" }}>
                    {e.color_type_fr}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--muted)", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {e.source && e.source !== "bambu"
                  ? <span data-tip={e.spool_src === "catalogue" ? "Poids du support vide donné par le catalogue" : e.spool_src ? "Poids du support vide estimé (SpoolmanDB : même marque, même matière)" : undefined}>
                      {e.source === "own" && <span style={{ color: "#8B5CF6", fontWeight: 800 }}>★ notre catalogue · </span>}
                      {e.source === "fc" && <span style={{ color: "#14B8A6", fontWeight: 800 }}>🔬 mesurée{e.td != null ? ` · TD ${String(e.td).replace(".", ",")}` : ""} · </span>}
                      {e.fila_type}{fcs ? ` · ${e.brand}` : spoolTxt(e)}{e.hex_approx ? " · teinte approchée" : ""}{e.discontinued ? " · plus fabriqué" : ""}</span>
                  : <>{e.fila_type} · <span style={{ fontFamily: "monospace" }}>{e.fila_color_code}</span></>}
              </p>
            </div>
            <span style={{ fontSize: 14, color: "#22C55E", fontWeight: 900, flexShrink: 0 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// Rattacher un filament existant au catalogue (02/11/2026) : choisir l'entree, voir ce qui change, valider. Le filament
// prend ses noms, son type, son code couleur, ses couleurs et son profil, comme la synchro, qui le retrouvera ensuite.
// Chaque champ se coche ou non (03/11/2026) : ce qui n'est pas importe reste a nous (catalog_skip), et la synchro le garde.
// f : {id, name, color, material, fila_type, manufacturer, spool_weight_g, catalog_skip}
export const isOther = e => !!e?.source && e.source !== "bambu";
export function CatalogLinkSheet({ f, onClose, onDone, z = 1600 }) {
  const [pick, setPick] = useState(null);
  const [saving, setSaving] = useState(false);
  const kept0 = new Set(String(f.catalog_skip || "").split(",").filter(Boolean));
  const [imp, setImp] = useState(() => Object.fromEntries(["name", "family", "type", "color", "brand", "spool"].map(g => [g, !kept0.has(g)])));
  const field = { width: "100%", boxSizing: "border-box", height: 42, padding: "0 12px", borderRadius: 12, fontSize: 14, fontWeight: 700,
    background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", outline: "none" };
  const hex = String(f.color || "").replace(/^#/, "");
  const other = isOther(pick);
  const save = async () => {
    setSaving(true);
    try {
      const skip = Object.entries(imp).filter(([, on]) => !on).map(([g]) => g);
      const { data } = await client.post(`/filaments/filaments/${f.id}/link-catalog`, { ...(other ? { source: pick.source, ref: pick.ref }
        : { fila_id: pick.fila_id, fila_color_code: pick.fila_color_code }), skip });
      egg(other ? "autre_marque" : "catalogue_rattache");
      if (data.twin) showAlert(`Le filament #${data.twin.id} (${data.twin.name}) est déjà rattaché à la même entrée : s'il s'agit d'un doublon, fusionne-les.`);
      onDone?.(data);
      onClose();
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };
  // une ligne : la case « importer », l'avant et l'apres (barre l'avant seulement s'il est remplace)
  const row = (g, l, a, b) => {
    const on = g ? imp[g] : true, same = (a || "") === (b || "");
    return <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, cursor: g ? "pointer" : "default", minWidth: 0 }}>
      {g ? <input type="checkbox" checked={on} onChange={e => setImp(m => ({ ...m, [g]: e.target.checked }))} style={{ width: 17, height: 17, flexShrink: 0, accentColor: "#3B82F6" }}/>
        : <span style={{ width: 17, flexShrink: 0 }}/>}
      <span style={{ color: "var(--muted)", width: 86, flexShrink: 0 }}>{l}</span>
      <span style={{ minWidth: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
        <span style={{ color: on && !same ? "var(--muted)" : "var(--text)", textDecoration: on && !same && a ? "line-through" : "none" }}>{a || "—"}</span>
        {on && !same && <><span style={{ color: "var(--muted)" }}>→</span><span style={{ color: "var(--text)" }}>{b || "—"}</span></>}
        {!on && !same && <span style={{ color: "#d97706" }}>gardé</span>}</span></label>;
  };
  return createPortal(
    <FSheet onClose={onClose} z={z} bottom={pick ? <>
      <button onClick={() => setPick(null)} style={{ ...fBtn, flex: 1, color: "var(--muted)" }}>← Autre</button>
      <button onClick={save} disabled={saving} style={{ ...fBtn, flex: 2, border: "none", color: "#fff",
        background: saving ? "var(--border)" : "linear-gradient(135deg, #3B82F6, #6366F1)" }}>{saving ? "Rattachement…" : "🧷 Rattacher"}</button>
    </> : <button onClick={onClose} style={{ ...fBtn, flex: 1 }}>Annuler</button>}>
      <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#3B82F6" }}>Rattacher à un catalogue</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {hex && <span style={{ width: 30, height: 30, borderRadius: 8, background: `#${hex.slice(0, 6)}`, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)", flexShrink: 0 }}/>}
          <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)", minWidth: 0 }}>#{f.id} {f.name}</div>
        </div>
        {pick ? <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "12px 14px", borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface2)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
            <CatalogSwatch e={pick} size={34}/>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{pick.name_fr || pick.name}</div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>{pick.brand} · {pick.fila_type}{pick.source === "own" ? " · notre catalogue" : ""}</div>
            </div>
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, color: "var(--muted)" }}>Coche ce qui vient du catalogue ; le reste est gardé, et la synchro le gardera.</div>
          {row("name", "Nom", f.name, pick.name_fr || pick.name)}
          {row("family", "Famille", f.material, pick.family)}
          {row("type", "Sous-type", f.fila_type, pick.fila_type)}
          {row("color", "Couleur", hex ? `#${hex.slice(0, 6).toUpperCase()}` : "", `#${(pick.color_hex || "").slice(0, 6).toUpperCase()}${pick.hex_approx ? " (approchée)" : ""}`)}
          {other && !(f.manufacturer || "").trim() && row("brand", "Marque", "", pick.brand)}
          {other && f.spool_weight_g == null && pick.spool_weight_g > 0 &&
            row("spool", "Support vide", "", `${pick.spool_src === "catalogue" ? "" : "≈ "}${Math.round(pick.spool_weight_g)} g`)}
          {!other && row(null, "Code couleur", f.fila_color_code, pick.fila_color_code)}
          <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", margin: "4px 0 0", lineHeight: 1.4 }}>
            {other ? `Rattaché au catalogue ${pick.source === "own" ? "de l'appli" : "de la marque (Open Filament Database)"} : la synchro tiendra à jour ce qui est coché. Son profil d'impression ne change pas.`
              : "Le code couleur et le profil Bambu font le rattachement : la synchro le retrouvera par ce code."}
            {" "}Ses bobines, son prix et son stock ne changent pas{other && f.spool_weight_g == null && pick.spool_weight_g > 0 ? " ; le support vide se range dans les Paramètres" : ""}.</p>
        </div>
        : <CatalogPicker onPick={setPick} field={field} family0={f.material || ""} type0={f.fila_type || ""} near={hex || null} brand0={f.manufacturer || ""}/>}
      </div>
    </FSheet>, document.body);
}


// Parcourir les catalogues (05/11/2026, Parametres › Filaments) : Bambu Lab, les autres marques, les couleurs mesurees ;
// une entree s'ouvre sur sa fiche des catalogues (temperatures, sechage, densite, code-barres, liens d'achat...)
export function CatalogBrowser({ onClose, z = 1500 }) {
  const [pick, setPick] = useState(null);
  const field = { width: "100%", padding: "9px 12px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 };
  return createPortal(<FSheet onClose={onClose} z={z}>
    <div style={{ padding: "40px 16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: "#14B8A6" }}>📚 Les catalogues</div>
      {pick ? <EntryFacts e={pick} onBack={() => setPick(null)}/>
        : <CatalogPicker onPick={e => { setPick(e); egg("catalogues_parcourus"); }} field={field} withMeasured/>}
    </div>
  </FSheet>, document.body);
}

function EntryFacts({ e, onBack }) {
  const bambu = !e.source || e.source === "bambu";
  const params = bambu ? { fila_id: e.fila_id, code: e.fila_color_code, brand: "Bambu Lab", name: e.name, fila_type: e.fila_type, family: e.family, hex: e.color_hex }
    : { source: e.source, ref: e.ref, brand: e.brand, name: e.name, fila_type: e.fila_type, family: e.family, hex: e.color_hex };
  const d = useCatalogFacts("/filaments/catalog/facts", params, [e.source, e.ref, e.fila_id, e.fila_color_code]);
  const m = d?.measured?.[0];
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <button type="button" onClick={onBack} style={{ alignSelf: "flex-start", border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text2)",
      borderRadius: 10, padding: "5px 11px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>‹ Retour à la liste</button>
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span style={{ borderRadius: 12, boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.25)", display: "inline-flex" }}><CatalogSwatch e={e} size={52}/></span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 17, fontWeight: 900, color: "var(--text)" }}>{e.name_fr && e.name_fr !== e.name ? `${e.name_fr} · ${e.name}` : e.name}</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>{[e.brand || "Bambu Lab", e.fila_type, e.fila_color_code].filter(Boolean).join(" · ")}</div>
      </div>
    </div>
    <div style={{ padding: 12, borderRadius: 16, border: "1px solid var(--border)", background: "var(--surface2)" }}>
      {!d ? <div style={{ fontSize: 12.5, color: "var(--muted)" }}>…</div> : <>
        {m && <MeasuredHead m={m}/>}
        <FactsList facts={d.facts} ours={e.source === "fc" ? null : e.color_hex}/></>}
    </div>
  </div>;
}
