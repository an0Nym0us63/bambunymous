import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import client from "../api/client";
import Select from "./Select";
import { FSheet, fBtn } from "./FicheKit";
import { egg } from "../eggs";
import { showAlert } from "../utils/dialog";

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
export default function CatalogPicker({ onPick, field, family0 = "", type0 = "", near = null, brand0 = "" }) {
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
  const ofd = src === "ofd";

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
    client.get("/filaments/catalog/ofd/brands").then(({ data }) => {
      const list = data.brands || [];
      setBrands(list);
      const hit = list.find(x => normB(x.name) === normB(brand0));
      if (hit) { setBrand(hit.name); setFamily(f => hit.families.includes(f) ? f : ""); setType(""); }
    }).catch(() => setBrands([]));
  }, [ofd]); // eslint-disable-line react-hooks/exhaustive-deps

  // un quart de seconde apres la derniere frappe (28/10/2026 : un appel par frappe)
  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => {
    if (ofd && !brand) { setEntries([]); setTotal(0); setLoading(brands == null); return; }
    setLoading(true);
    const params = ofd ? { brand } : { lang: "fr" };
    if (family) params.family = family;
    if (type && !ofd) params.fila_type = type;
    if (dq.trim()) params.q = dq.trim();
    client.get(ofd ? "/filaments/catalog/ofd/search" : "/filaments/catalog/search", { params })
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
  const tab = (id, label) => <button type="button" onClick={() => { if (src !== id) { setSrc(id); setFamily(""); setType(""); setEntries([]); } }}
    style={{ flex: 1, padding: "8px 10px", borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: "pointer",
      border: `1px solid ${src === id ? "#6366F1" : "var(--border)"}`, color: src === id ? "#fff" : "var(--text2)",
      background: src === id ? "linear-gradient(135deg, #3B82F6, #6366F1)" : "var(--surface)" }}>{label}</button>;
  const spoolTxt = e => !e.spool_weight_g ? "" : ` · support ${e.spool_src === "catalogue" ? "" : "≈ "}${Math.round(e.spool_weight_g)} g`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>{tab("bambu", "Bambu Lab")}{tab("ofd", "🌍 Autres marques")}</div>
      {ofd && <Select value={brand} onChange={e => { setBrand(e.target.value); setFamily(""); setType(""); }} style={field}
        options={[{ value: "", label: brands == null ? "Chargement des marques…" : "Choisis une marque" },
                  ...(brands || []).map(b => ({ value: b.name, label: `${b.name} · ${b.count}` }))]}/>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Select value={family} onChange={e => { setFamily(e.target.value); setType(""); }}
          style={{ ...field, flex: 1, minWidth: 120 }}
          options={[{ value: "", label: "Toutes familles" }, ...famList.map(f => ({ value: f, label: f }))]}/>
        <Select value={type} onChange={e => setType(e.target.value)}
          style={{ ...field, flex: 1, minWidth: 140 }}
          options={[{ value: "", label: ofd ? "Toutes gammes" : "Tous types" }, ...types.map(t => ({ value: t, label: t }))]}/>
      </div>
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
                {e.source === "ofd"
                  ? <span data-tip={e.spool_src === "catalogue" ? "Poids du support vide donné par le catalogue" : e.spool_src ? "Poids du support vide estimé (SpoolmanDB : même marque, même matière)" : undefined}>
                      {e.fila_type}{spoolTxt(e)}{e.discontinued ? " · plus fabriqué" : ""}</span>
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
// f : {id, name, color, material, fila_type}
export function CatalogLinkSheet({ f, onClose, onDone, z = 1600 }) {
  const [pick, setPick] = useState(null);
  const [saving, setSaving] = useState(false);
  const field = { width: "100%", boxSizing: "border-box", height: 42, padding: "0 12px", borderRadius: 12, fontSize: 14, fontWeight: 700,
    background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", outline: "none" };
  const hex = String(f.color || "").replace(/^#/, "");
  const save = async () => {
    setSaving(true);
    try {
      const { data } = await client.post(`/filaments/filaments/${f.id}/link-catalog`, pick.source === "ofd" ? { source: "ofd", ref: pick.ref }
        : { fila_id: pick.fila_id, fila_color_code: pick.fila_color_code });
      egg(pick.source === "ofd" ? "autre_marque" : "catalogue_rattache");
      if (data.twin) showAlert(`Le filament #${data.twin.id} (${data.twin.name}) est déjà rattaché à la même entrée : s'il s'agit d'un doublon, fusionne-les.`);
      onDone?.(data);
      onClose();
    } catch (e) { showAlert(e.response?.data?.detail || e.message); }
    finally { setSaving(false); }
  };
  const row = (l, a, b) => <div style={{ display: "flex", gap: 8, fontSize: 12.5, fontWeight: 700 }}>
    <span style={{ color: "var(--muted)", width: 92, flexShrink: 0 }}>{l}</span>
    <span style={{ color: "var(--muted)", textDecoration: a && a !== b ? "line-through" : "none" }}>{a || "—"}</span>
    {a !== b && <><span style={{ color: "var(--muted)" }}>→</span><span style={{ color: "var(--text)" }}>{b || "—"}</span></>}</div>;
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <CatalogSwatch e={pick} size={34}/>
            <div style={{ fontSize: 14, fontWeight: 900, color: "var(--text)" }}>{pick.name_fr || pick.name}</div>
          </div>
          {row("Type", f.fila_type || f.material, pick.fila_type)}
          {pick.source === "ofd" ? row("Marque", f.manufacturer, f.manufacturer || pick.brand) : row("Code couleur", f.fila_color_code, pick.fila_color_code)}
          {row("Couleur", hex ? `#${hex.slice(0, 6)}` : "", `#${(pick.color_hex || "").slice(0, 6)}`)}
          {pick.source === "ofd" && f.spool_weight_g == null && pick.spool_weight_g > 0 &&
            row("Support vide", "", `${pick.spool_src === "catalogue" ? "" : "≈ "}${Math.round(pick.spool_weight_g)} g (rangé dans les Paramètres)`)}
          <p style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", margin: "4px 0 0", lineHeight: 1.4 }}>
            {pick.source === "ofd" ? "Noms, gamme et couleurs viennent du catalogue de la marque (Open Filament Database) ; la synchro le tiendra à jour. Son profil d'impression ne change pas."
              : "Noms, type, code couleur, couleurs et profil viennent du catalogue, comme à la synchro ; la synchro le retrouvera ensuite par ce code."}
            {" "}Ses bobines, son prix et son stock ne changent pas.</p>
        </div>
        : <CatalogPicker onPick={setPick} field={field} family0={f.material || ""} type0={f.fila_type || ""} near={hex || null} brand0={f.manufacturer || ""}/>}
      </div>
    </FSheet>, document.body);
}
