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
const same = (a, b) => a !== "" && a != null && Math.abs(parseFloat(a) - parseFloat(b)) < 0.05;

// Choix du poids d'un support vide : un modele des Parametres, ou « Autre »
// et une valeur libre. value / onChange portent les grammes (chaine).
export default function TarePicker({ value, onChange, selectStyle = {}, inputStyle = {}, autoFocus = false }) {
  const tares = useSpoolTares();
  // « Autre » choisi explicitement, ou valeur qui ne correspond a aucun modele.
  const [other, setOther] = useState(false);
  // Valeur changee de l'exterieur (support corrige a la validation) : on
  // reaffiche son modele plutot que de rester sur « Autre ».
  const emitted = useRef(value);
  const emit = v => { emitted.current = v; onChange(v); };
  useEffect(() => {
    if (value !== emitted.current) { emitted.current = value; setOther(false); }
  }, [value]);
  const match = tares.find(t => same(value, t.weight_g));
  const sel = other || (!match && value !== "" && value != null) ? OTHER : match ? match.name : "";

  if (!tares.length) {
    return (
      <span style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
        <input type="number" inputMode="decimal" min="0" value={value ?? ""} autoFocus={autoFocus}
          onChange={e => onChange(e.target.value)} style={{ flex:1, minWidth:0, ...inputStyle }}/>
        <span style={{ fontSize:12, color:"var(--muted)" }}>g</span>
      </span>
    );
  }

  return (
    <span style={{ display:"flex", alignItems:"center", gap:6, flex:1, minWidth:0 }}>
      <Select value={sel} placeholder="— Choisir un support —"
        onChange={e => {
          const v = e.target.value;
          if (v === OTHER) { setOther(true); return; }
          setOther(false);
          const t = tares.find(x => x.name === v);
          if (t) emit(String(t.weight_g));
        }}
        options={[
          ...tares.map(t => ({ value: t.name, label: `${t.name} — ${Math.round(t.weight_g)} g` })),
          { value: OTHER, label: "Autre… (saisir le poids)" },
        ]}
        style={{ flex:1, minWidth:0, ...selectStyle }}/>
      {sel === OTHER && (<>
        <input type="number" inputMode="decimal" min="0" value={value ?? ""} autoFocus
          onChange={e => emit(e.target.value)} placeholder="g"
          style={{ ...inputStyle, width:90, flexShrink:0 }}/>
        <span style={{ fontSize:12, color:"var(--muted)" }}>g</span>
      </>)}
    </span>
  );
}
