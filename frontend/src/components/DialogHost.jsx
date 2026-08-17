import { useState, useEffect } from "react";
import { _register } from "../utils/dialog";

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

  if (!dlg) return null;
  const isConfirm = dlg.type === "confirm";
  const close = (val) => { dlg.resolve(val); setDlg(null); };

  return (
    <div onClick={() => close(isConfirm ? false : undefined)}
      style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        animation: "dlgFade 0.12s ease" }}>
      <div onClick={(e) => e.stopPropagation()} className="sheet-panel"
        style={{ width: "100%", maxWidth: 380, borderRadius: 16, padding: 20,
          border: "1px solid var(--border)", boxShadow: "0 12px 48px rgba(0,0,0,0.4)" }}>
        {dlg.title && (
          <p style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", margin: "0 0 8px" }}>{dlg.title}</p>
        )}
        <p style={{ fontSize: 13.5, color: "var(--text)", lineHeight: 1.5, margin: "0 0 18px",
          whiteSpace: "pre-wrap" }}>{dlg.message}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          {isConfirm && (
            <button onClick={() => close(false)}
              style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid var(--border)",
                background: "var(--surface2)", color: "var(--muted)", fontSize: 13, fontWeight: 600,
                cursor: "pointer" }}>{dlg.cancelLabel || "Annuler"}</button>
          )}
          <button onClick={() => close(isConfirm ? true : undefined)} autoFocus
            style={{ padding: "9px 18px", borderRadius: 10, border: "none",
              background: dlg.danger ? "#ef4444" : "#3b82f6", color: "white", fontSize: 13,
              fontWeight: 700, cursor: "pointer" }}>
            {dlg.confirmLabel || (isConfirm ? "Confirmer" : "OK")}
          </button>
        </div>
      </div>
    </div>
  );
}
