import React from "react";
import { useEggFound } from "../eggs";

// Une petite chose cachee au bas d'une page (24/10/2026) : presque invisible, elle ne fait rien d'autre
// que d'etre trouvee (le guetteur commun des secrets lit data-egg, voir eggs.js).
export default function HiddenMark({ egg, e, n = 1, side = "right" }) {
  // trouvee : elle n'a plus rien a faire la
  if (useEggFound(egg)) return null;
  return (
    <div aria-hidden="true" style={{ textAlign: side, lineHeight: 1, padding: "6px 4px 0", pointerEvents: "none" }}>
      <span data-egg={egg} data-egg-n={n} style={{ display: "inline-block", fontSize: 9, opacity: 0.16, cursor: "default",
        userSelect: "none", WebkitUserSelect: "none", pointerEvents: "auto", padding: 4 }}>{e}</span>
    </div>
  );
}
