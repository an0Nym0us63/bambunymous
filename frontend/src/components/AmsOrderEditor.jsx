import React, { useState, useEffect } from "react";
import { Save, RefreshCw } from "lucide-react";
import client from "../api/client";
import { showAlert } from "../utils/dialog";
import Select from "./Select";
import { usePrinter } from "../store/printer";
import { amsName, slotCount, lireDisposition, dispositionParDefaut, MAX_LIGNES, MAX_COLONNES } from "../utils/ams";

// L'organisation des AMS sur la tuile AMS de l'accueil (dans les reglages de la
// tuile, l'engrenage) : la forme de la grille et la case de chaque unite.
const inp = {
  width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
  borderRadius:10, padding:"8px 12px", fontSize:14, color:"var(--text)",
  outline:"none", transition:"border-color 0.15s", boxSizing:"border-box",
};
const lbl = {
  display:"block", fontSize:11, color:"var(--muted)", marginBottom:6,
  textTransform:"uppercase", letterSpacing:"0.05em",
};

// La grille a les dimensions qu'on choisit (lignes x colonnes) et chaque unite
// y est rangee par sa case. Format et regles dans utils/ams.
export default function AmsOrderEditor() {
  const storeStatus = usePrinter(s => s.status);
  // L'etat de l'imprimante n'est interroge que par l'accueil : en ouvrant les
  // reglages directement (rechargement, lien), il est vide et toutes les
  // unites paraissent absentes. On le lit une fois ici dans ce cas.
  const [ownStatus, setOwnStatus] = useState(null);
  useEffect(() => {
    if (storeStatus?.ams_list?.length) return;
    client.get("/printer/status").then(({ data }) => setOwnStatus(data)).catch(() => {});
  }, []);
  const status = storeStatus?.ams_list?.length ? storeStatus : ownStatus;
  const available = [...new Map((status?.ams_list || []).map(a => [a.id, a])).values()]
    .sort((a,b) => a.id - b.id);
  const availableIds = available.map(a => a.id);

  const [rows, setRows] = useState(null);
  const [cols, setCols] = useState(null);
  const [cells, setCells] = useState([]);   // [{id, row, col}]
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Choix au toucher : le glisser-deposer HTML ne marche pas sur mobile. On
  // touche une unite, puis la case ou la poser.
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    client.get("/settings/ams-order").then(({ data }) => {
      const d = lireDisposition(data.order);
      if (d) { setRows(d.rows); setCols(d.cols); setCells(d.cells); }
    }).finally(() => setLoading(false));
  }, []);
  // Rien d'enregistre : on part de ce que l'accueil affiche deja (une rangee
  // jusqu'a quatre unites), une fois les unites connues.
  useEffect(() => {
    if (loading || rows != null || !availableIds.length) return;
    const d = dispositionParDefaut(availableIds.length);
    setRows(d.rows); setCols(d.cols);
  }, [loading, rows, availableIds.length]);

  const R = rows ?? 1, C = cols ?? 2;
  const at = (r, c) => cells.find(x => x.row === r && x.col === c)?.id ?? null;
  const placedIds = new Set(cells.map(x => x.id));
  const unplaced = availableIds.filter(id => !placedIds.has(id));
  const capacite = R * C;
  const tropPetit = availableIds.length > capacite;

  // Reduire la grille ne perd rien : les unites hors de la nouvelle grille
  // repassent dans les non placees.
  const redimensionner = (r, c) => {
    setRows(r); setCols(c);
    setCells(prev => prev.filter(x => x.row < r && x.col < c));
  };

  const placeAt = (r, c, amsId) => {
    setCells(prev => {
      const from = prev.find(x => x.id === amsId);
      const occupant = prev.find(x => x.row === r && x.col === c);
      let next = prev.filter(x => x.id !== amsId && x !== occupant);
      next.push({ id: amsId, row: r, col: c });
      // Deposer sur une case occupee echange les deux unites, plutot que de
      // renvoyer l'occupant dans les "non placees".
      if (occupant && occupant.id !== amsId && from) next.push({ id: occupant.id, row: from.row, col: from.col });
      return next;
    });
    setPicked(null);
  };
  const clearCell = (r, c) => setCells(prev => prev.filter(x => !(x.row === r && x.col === c)));

  const save = async () => {
    setSaving(true);
    try {
      await client.post("/settings/ams-order", { order: { rows: R, cols: C, cells } });
      // la tuile AMS de l'accueil relit la disposition
      window.dispatchEvent(new Event("bn-ams-order"));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch(e) {
      showAlert("Erreur: " + (e.response?.data?.detail || e.message));
    } finally { setSaving(false); }
  };

  const chipStyle = (id) => ({
    display:"flex", alignItems:"center", gap:6, padding:"8px 12px", borderRadius:10,
    background:"var(--surface2)", fontSize:13, fontWeight:700, minWidth:0,
    border: picked === id ? "1px solid #3b82f6" : "1px solid var(--border)",
    boxShadow: picked === id ? "0 0 0 2px rgba(59,130,246,0.25)" : "none",
    color:"var(--text)", cursor:"grab", userSelect:"none",
  });
  // Nombre de slots en clair : c'est ce qui distingue un HT d'un AMS au
  // premier coup d'oeil, et ce qui decide de sa largeur sur l'accueil. Une
  // unite enregistree mais plus detectee est dite "absente" : on peut la
  // retirer, et elle ne laisse qu'une case vide sur l'accueil.
  const chipLabel = (id) => {
    const a = available.find(x => x.id === id);
    const n = a ? slotCount(a) : 0;
    return (
      <span style={{ display:"flex", flexDirection:"column", minWidth:0, lineHeight:1.2 }}>
        <span style={{ overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{amsName(id)}</span>
        <span style={{ fontSize:10, fontWeight:500, color:"var(--muted)", whiteSpace:"nowrap" }}>
          {a ? `${n} slot${n > 1 ? "s" : ""}` : "absente"}
        </span>
      </span>
    );
  };
  const onChipClick = (id) => (e) => { e.stopPropagation(); setPicked(p => (p === id ? null : id)); };
  const nombres = (max) => Array.from({ length: max }, (_, i) => ({ value: i + 1, label: String(i + 1) }));

  if (loading) return null;

  return (
    <div>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 12px", lineHeight:1.45 }}>
        Choisis la forme de la grille, puis glisse-dépose chaque unité dans sa case — ou touche-la,
        puis touche la case. Le rack Vortek a son propre bouton sur la tuile, il n'occupe pas de case.
      </p>

      <div style={{ display:"flex", gap:12, alignItems:"flex-end", flexWrap:"wrap", marginBottom:14 }}>
        <div style={{ width:110 }}>
          <label style={lbl}>Lignes</label>
          <Select value={R} onChange={e => redimensionner(Number(e.target.value), C)} options={nombres(MAX_LIGNES)} style={inp}/>
        </div>
        <div style={{ width:110 }}>
          <label style={lbl}>Colonnes</label>
          <Select value={C} onChange={e => redimensionner(R, Number(e.target.value))} options={nombres(MAX_COLONNES)} style={inp}/>
        </div>
        <span style={{ fontSize:12, color: tropPetit ? "#ef4444" : "var(--muted)", paddingBottom:9 }}>
          {tropPetit
            ? `${availableIds.length} unités pour ${capacite} case${capacite > 1 ? "s" : ""} : agrandis la grille.`
            : `${capacite} case${capacite > 1 ? "s" : ""} pour ${availableIds.length} unité${availableIds.length > 1 ? "s" : ""}.`}
        </span>
      </div>

      <div style={{ overflowX:"auto", marginBottom:16 }}>
        <div style={{ display:"grid", gridTemplateColumns:`repeat(${C}, minmax(96px, 1fr))`, gap:10 }}>
          {Array.from({ length: R * C }, (_, i) => {
            const r = Math.floor(i / C), c = i % C;
            const amsId = at(r, c);
            return (
              <div key={`${r}-${c}`}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const id = Number(e.dataTransfer.getData("text/plain")); if (!isNaN(id)) placeAt(r, c, id); }}
                onClick={() => { if (picked != null) placeAt(r, c, picked); }}
                style={{ minHeight:64, borderRadius:12, minWidth:0,
                  border:`2px dashed ${picked != null ? "rgba(59,130,246,0.5)" : "var(--border)"}`,
                  cursor: picked != null ? "pointer" : "default",
                  background:"var(--surface)", padding:10, display:"flex", flexDirection:"column", gap:6 }}>
                <span style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.04em" }}>
                  {R > 1 ? `Ligne ${r + 1} · ` : ""}Colonne {c + 1}
                </span>
                {amsId != null ? (
                  <div draggable onDragStart={e => e.dataTransfer.setData("text/plain", String(amsId))}
                    onClick={onChipClick(amsId)} style={chipStyle(amsId)}>
                    {chipLabel(amsId)}
                    <button onClick={(e) => { e.stopPropagation(); clearCell(r, c); }} style={{ marginLeft:"auto", background:"none",
                      border:"none", color:"var(--muted)", cursor:"pointer", fontSize:13 }}>✕</button>
                  </div>
                ) : (
                  <span style={{ fontSize:11, color:"var(--muted)", opacity:0.6 }}>Vide</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {unplaced.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <p style={{ fontSize:11, color:"var(--muted)", marginBottom:8 }}>
            Unités non placées — affichées à la suite sur l'accueil tant qu'elles ne sont pas rangées
          </p>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {unplaced.map(id => (
              <div key={id} draggable onDragStart={e => e.dataTransfer.setData("text/plain", String(id))}
                onClick={onChipClick(id)} style={chipStyle(id)}>
                {chipLabel(id)}
              </div>
            ))}
          </div>
        </div>
      )}

      {!availableIds.length && (
        <p style={{ fontSize:12, color:"var(--muted)" }}>
          Aucun AMS détecté pour l'instant — connecte-toi à l'imprimante pour les voir apparaître ici.
        </p>
      )}

      <button onClick={save} disabled={saving || tropPetit}
        title={tropPetit ? "La grille n'a pas assez de cases pour toutes les unités" : ""}
        style={{ display:"flex", alignItems:"center", gap:8, padding:"9px 16px",
          background:"#3b82f6", border:"none", borderRadius:10, color:"white",
          fontSize:13, fontWeight:700, cursor: (saving || tropPetit) ? "not-allowed" : "pointer",
          opacity: (saving || tropPetit) ? 0.6 : 1 }}>
        {saving ? <RefreshCw size={14} style={{ animation:"spin 1s linear infinite" }}/> : <Save size={14}/>}
        {saved ? "Sauvegardé ✓" : "Sauvegarder la disposition"}
      </button>
    </div>
  );
}
