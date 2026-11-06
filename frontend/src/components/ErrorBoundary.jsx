import React from "react";
import { reloadForUpdate } from "../utils/importRetry";

// Le filet d'affichage (06/11/2026) : une erreur pendant l'affichage d'une page (ou d'une tuile) effacait toute l'appli,
// page blanche. Ici, seule la partie touchee est remplacee par un message, le reste de l'appli continue. Un morceau
// d'appli introuvable apres une mise a jour recharge l'appli (une fois), comme importRetry.
// variant : "page" (message en grand, « Recharger ») ou "tile" (une ligne discrete dans la tuile).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const msg = String(error?.message || error);
    if (/dynamically imported module|Importing a module script failed|Failed to fetch/i.test(msg) && reloadForUpdate()) return;
    // garde une trace lisible dans la console (le journal du navigateur), sans rien envoyer
    console.error(`[BN] ${this.props.where || "affichage"} :`, error, info?.componentStack || "");
  }

  componentDidUpdate(prev) {
    // une autre page (ou une autre tuile) : on retente l'affichage
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const msg = String(error?.message || error).slice(0, 200);
    if (this.props.variant === "tile") {
      return <div style={{ padding: 10, fontSize: 12, fontWeight: 700, color: "var(--muted)", lineHeight: 1.4 }}>
        ⚠️ Cette tuile n'a pas pu s'afficher.
        <button type="button" onClick={() => this.setState({ error: null })}
          style={{ marginLeft: 6, padding: "2px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface2)",
            color: "var(--text2)", fontSize: 11.5, fontWeight: 800, cursor: "pointer" }}>Réessayer</button>
      </div>;
    }
    return <div style={{ maxWidth: 520, margin: "40px auto", padding: 20, borderRadius: 18, border: "1px solid var(--border)",
      background: "var(--surface)", display: "flex", flexDirection: "column", gap: 10, textAlign: "center" }}>
      <div style={{ fontSize: 34 }}>🧩</div>
      <div style={{ fontSize: 16, fontWeight: 900, color: "var(--text)" }}>Cette page n'a pas pu s'afficher</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", lineHeight: 1.45 }}>
        Le reste de l'appli fonctionne : le menu mène aux autres pages. Recharger règle le plus souvent le problème.</div>
      <code style={{ fontSize: 11.5, color: "var(--muted)", background: "var(--surface2)", borderRadius: 8, padding: "6px 8px", wordBreak: "break-word" }}>{msg}</code>
      <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
        <button type="button" onClick={() => window.location.reload()}
          style={{ padding: "8px 16px", borderRadius: 12, border: "none", background: "#6366F1", color: "#fff", fontWeight: 900, cursor: "pointer" }}>Recharger</button>
        <button type="button" onClick={() => this.setState({ error: null })}
          style={{ padding: "8px 16px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", fontWeight: 800, cursor: "pointer" }}>Réessayer</button>
      </div>
    </div>;
  }
}
