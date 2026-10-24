import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrinter } from "../store/printer";
import { TILES, HEIGHTS, useTilesData } from "../components/HomeTiles";

// Banc d'essai des tuiles (developpement seulement) : chaque tuile dans chaque
// taille, aux largeurs reelles d'une colonne (telephone ou ordinateur). Une case
// dont le contenu deborde est cerclee de rouge et comptee en haut.
const WIDTHS = { mobile: 343, pc: 420, large: 560 };
const UNIT_H = 128;
// du contenu coupe par le bord de la carte (le decor et le texte deja elide ne comptent pas)
function clipped(card) {
  const box = card.getBoundingClientRect();
  const walk = el => {
    for (const k of el.children) {
      if (k.getAttribute("aria-hidden") === "true") continue;
      const cs = getComputedStyle(k);
      if (cs.position === "absolute" || cs.display === "none" || cs.visibility === "hidden") continue;
      const r = k.getBoundingClientRect();
      if (r.width && r.height && (r.bottom > box.bottom + 1 || r.right > box.right + 1 || r.left < box.left - 1)) return true;
      // ce qui defile ou coupe proprement (liste a defiler, bande de vignettes) n'est pas un debordement
      if (!["hidden", "auto", "scroll"].includes(cs.overflowY) && cs.overflowX !== "hidden" && walk(k)) return true;
    }
    return false;
  };
  return walk(card);
}

export default function TileBench() {
  const { status, startPolling, stopPolling } = usePrinter();
  const data = useTilesData();
  const [col, setCol] = useState(() => new URLSearchParams(location.search).get("w") || "mobile");
  const only = new URLSearchParams(location.search).get("t");
  const [bad, setBad] = useState([]);
  const root = useRef(null);
  useEffect(() => { startPolling?.(); return () => stopPolling?.(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const t = setTimeout(() => {
      const out = [];
      root.current?.querySelectorAll("[data-bench]").forEach(el => {
        const card = el.firstElementChild;
        const over = card && clipped(card);
        el.style.outline = over ? "3px solid #ef4444" : "none";
        if (over) out.push(el.dataset.bench);
      });
      setBad(b => JSON.stringify(b) === JSON.stringify(out) ? b : out);
    }, 1500);
    return () => clearTimeout(t);
  });
  const W = WIDTHS[col];
  const ids = Object.keys(TILES).filter(id => !only || only.split(",").includes(id));
  return (
    <div ref={root} style={{ padding: 16, display: "flex", flexDirection: "column", gap: 22 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ color: "var(--text)" }}>Banc des tuiles</b>
        {Object.keys(WIDTHS).map(k => <button key={k} onClick={() => setCol(k)} style={{ padding: "4px 10px", borderRadius: 8,
          background: col === k ? "#3b82f6" : "var(--surface2)", color: col === k ? "#fff" : "var(--text2)", border: "none" }}>{k} ({WIDTHS[k]} px)</button>)}
        <span id="bench-bad" style={{ color: bad.length ? "#ef4444" : "#22c55e", fontWeight: 800 }}>
          {bad.length ? `${bad.length} débordent : ${bad.join(", ")}` : "aucun débordement"}</span>
      </div>
      {ids.map(id => {
        const def = TILES[id];
        // la camera en captures : dix flux continus prendraient les six connexions du navigateur
        // ?o=cle:valeur,cle:valeur : des options imposees, pour regarder un autre affichage
        const forced = Object.fromEntries((new URLSearchParams(location.search).get("o") || "").split(",").filter(Boolean).map(x => x.split(":")));
        const o = { _title: true, ...Object.fromEntries((def.options || []).map(op => [op.key, op.def])), ...(id === "camera" ? { mode: "images" } : {}), ...forced };
        return (
          <div key={id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontWeight: 800, color: "var(--text)" }}>{def.label} <span style={{ color: "var(--muted)", fontWeight: 500 }}>({id})</span></div>
            {[1, 2].filter(w => def.w.includes(w)).map(w => (
              <div key={w} style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
                {HEIGHTS.filter(h => def.h.includes(h)).map(h => {
                  const it = { id, w, h, o };
                  const node = def.render(data, status, o, it);
                  return (
                    <div key={h} data-bench={`${id} ${w === 1 ? "½" : "1"}×${h}`} title={`${w === 1 ? "demi" : "pleine"} largeur, ${h} rangée(s)`}
                      style={{ width: w === 1 ? (W - 10) / 2 : W, height: h * UNIT_H - 10, flexShrink: 0, borderRadius: 16 }}>
                      {node || <div className="card" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
                        color: "var(--muted)", fontSize: 12 }}>(rien à montrer)</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
