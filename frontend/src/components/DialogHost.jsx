import { useState, useEffect } from "react";
import { _register } from "../utils/dialog";
import TipHost from "./TipHost";

// Rend les dialogues in-app demandes via showAlert/showConfirm. Monte une seule
// fois a la racine. Resout la Promise a la fermeture (OK -> true, Annuler -> false).
export default function DialogHost() {
  const [dlg, setDlg] = useState(null);

  useEffect(() => {
    _register((opts) => new Promise((resolve) => setDlg({ ...opts, resolve })));
    return () => _register(null);
  }, []);

  useEffect(() => {
    if (!dlg) return;
    const onKey = (e) => {
      if (e.key === "Escape") close(dlg.type === "confirm" ? false : undefined);
      if (e.key === "Enter") close(dlg.type === "confirm" ? true : undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dlg]);

  // les infobulles maison vivent ici (monte une fois, sur toutes les pages)
  if (!dlg) return <TipHost/>;
  const isConfirm = dlg.type === "confirm";
  // la couleur de la boite : rouge pour une action qui detruit, bleu sinon (un simple message : neutre)
  const c = dlg.danger ? "#EF4444" : isConfirm ? "#3B82F6" : "#6366F1";
  const c2 = dlg.danger ? "#F97316" : isConfirm ? "#6366F1" : "#8B5CF6";
  const close = (val) => { dlg.resolve(val); setDlg(null); };

  return (<>
    <TipHost/>
    <div onClick={() => close(isConfirm ? false : undefined)}
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        animation: "dlgFade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} className="sheet-panel"
        style={{ width: "100%", maxWidth: 400, borderRadius: 22, padding: 0, overflow: "hidden",
          border: `1px solid color-mix(in srgb, ${c} 30%, var(--border))`, boxShadow: `0 20px 60px rgba(0,0,0,0.45), 0 0 0 4px ${c}1a` }}>
        <div style={{ padding: "18px 20px 16px", background: `radial-gradient(circle at 0% 0%, ${c}33, transparent 60%), var(--surface2)` }}>
          {dlg.title && (
            <p style={{ fontSize: 17, fontWeight: 900, color: "var(--text)", margin: "0 0 8px" }}>{dlg.title}</p>
          )}
          <p style={{ fontSize: 14.5, fontWeight: 600, color: "var(--text)", lineHeight: 1.5, margin: 0,
            whiteSpace: "pre-wrap" }}>{dlg.message}</p>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: "12px 16px 14px", borderTop: "1px solid var(--border)" }}>
          {isConfirm && (
            <button onClick={() => close(false)}
              style={{ padding: "10px 16px", borderRadius: 12, border: "1px solid var(--border)",
                background: "var(--surface2)", color: "var(--text)", fontSize: 13.5, fontWeight: 800,
                cursor: "pointer" }}>{dlg.cancelLabel || "Annuler"}</button>
          )}
          <button onClick={() => close(isConfirm ? true : undefined)} autoFocus
            style={{ padding: "10px 18px", borderRadius: 12, border: "none",
              background: `linear-gradient(135deg, ${c}, ${c2})`, boxShadow: `0 8px 18px -10px ${c}`, color: "white", fontSize: 13.5,
              fontWeight: 800, cursor: "pointer" }}>
            {dlg.confirmLabel || (isConfirm ? "Confirmer" : "OK")}
          </button>
        </div>
      </div>
    </div>
  </>);
}
