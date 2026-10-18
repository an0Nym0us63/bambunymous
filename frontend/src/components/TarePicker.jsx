import React, { useEffect, useRef, useState } from "react";
import client from "../api/client";
import Select from "./Select";

// Modeles de support vide (Parametres) : « Bambu Lab -> 250 g ». Lus une fois
// par session et partages ; reloadSpoolTares() apres une modification.
let _cache = null;
let _pending = null;
const _subs = new Set();

export function reloadSpoolTares() {
  _pending = client.get("/settings/spool-tares")
    .then(({ data }) => { _cache = data.tares || []; _subs.forEach(f => f(_cache)); return _cache; })
    .catch(() => { _cache = _cache || []; return _cache; })
    .finally(() => { _pending = null; });
  return _pending;
}

export function useSpoolTares() {
  const [tares, setTares] = useState(_cache);
  useEffect(() => {
    _subs.add(setTares);
    if (_cache == null && !_pending) reloadSpoolTares();
    return () => _subs.delete(setTares);
  }, []);
  return tares || [];
}

// Modele dont le nom ressemble a la marque (« Bambu Lab » / « bambulab »).
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function tareForBrand(tares, brand) {
  const b = norm(brand);
  if (!b) return null;
  return tares.find(t => norm(t.name) === b)
    || tares.find(t => b.includes(norm(t.name)) || norm(t.name).includes(b)) || null;
}

const OTHER = "__autre__";

// Choix du poids d'un support vide : un modele des Parametres, ou « Autre »
// et une valeur libre. value = grammes (chaine), tareName = modele lie (null =
// « Autre »). onChange(grammes, nomDuModele|null) : le filament retient le
// modele, et suit ses changements de poids.
export default function TarePicker({ value, tareName = null, onChange, selectStyle = {}, inputStyle = {}, autoFocus = false }) {
  const tares = useSpoolTares();
  // « Autre » choisi alors qu'aucun poids n'est encore saisi.
  const [other, setOther] = useState(false);
  // Valeur changee de l'exterieur (support corrige a la validation) : on
  // reaffiche son modele plutot que de rester sur « Autre ».
  const emitted = useRef(`${value}|${tareName}`);
  const emit = (v, name) => { emitted.current = `${v}|${name}`; onChange(v, name); };
  useEffect(() => {
    const k = `${value}|${tareName}`;
    if (k !== emitted.current) { emitted.current = k; setOther(false); }
  }, [value, tareName]);
  const linked = tareName ? tares.find(t => t.name.toLowerCase() === String(tareName).toLowerCase()) : null;
  const sel = linked && !other ? linked.name
    : other || (value !== "" && value != null) ? OTHER : "";

  if (!tares.length) {
    return (
      <span style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
        <input type="number" inputMode="decimal" min="0" value={value ?? ""} autoFocus={autoFocus}
          onChange={e => onChange(e.target.value, null)} style={{ flex:1, minWidth:0, ...inputStyle }}/>
        <span style={{ fontSize:12, color:"var(--muted)" }}>g</span>
      </span>
    );
  }

  return (
    <span style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
      <Select value={sel} placeholder="— Choisir un support —"
        onChange={e => {
          const v = e.target.value;
          if (v === OTHER) { setOther(true); emit(value ?? "", null); return; }
          setOther(false);
          const t = tares.find(x => x.name === v);
          if (t) emit(String(t.weight_g), t.name);
        }}
        options={[
          ...tares.map(t => ({ value: t.name, label: `${t.name} — ${Math.round(t.weight_g)} g` })),
          { value: OTHER, label: "Autre… (saisir le poids)" },
        ]}
        style={{ flex:1, minWidth:0, ...selectStyle }}/>
      {sel === OTHER && (<>
        <input type="number" inputMode="decimal" min="0" value={value ?? ""} autoFocus
          onChange={e => emit(e.target.value, null)} placeholder="g"
          style={{ ...inputStyle, width:90, flexShrink:0 }}/>
        <span style={{ fontSize:12, color:"var(--muted)" }}>g</span>
      </>)}
    </span>
  );
}
