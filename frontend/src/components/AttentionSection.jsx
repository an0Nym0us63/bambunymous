import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";

/**
 * Points d'attention.
 *
 * Le back renvoie des catégories, chacune avec un échantillon ALÉATOIRE de ses
 * alertes et le total réel. L'aléatoire est voulu : avec 40 filaments sans
 * bobine, un tri fixe montrerait éternellement les 3 mêmes.
 *
 * Chaque alerte porte une clé stable ; on peut la mettre en sourdine 7 jours ou
 * définitivement (un filament qu'on ne compte pas racheter). La mise en sourdine
 * retire l'alerte tout de suite en local — inutile d'attendre un aller-retour.
 */
export default function AttentionSection() {
  const navigate = useNavigate();
  const [cats, setCats] = useState(null);
  const [menu, setMenu] = useState(null);   // alerte dont le menu est ouvert

  const load = () => {
    client.get("/attention")
      .then(r => setCats(r.data?.categories || []))
      .catch(() => setCats([]));
  };
  useEffect(load, []);

  const dismiss = async (alert, days) => {
    setMenu(null);
    // Retrait optimiste : la liste est de toute facon recalculee au prochain chargement.
    setCats(cs => cs
      .map(c => ({ ...c,
        alerts: c.alerts.filter(a => a.key !== alert.key),
        total: c.total - 1 }))
      .filter(c => c.alerts.length));
    try {
      await client.post("/attention/dismiss", { key: alert.key, days: days ?? null });
    } catch {
      load();   // echec -> on remet la verite du serveur
    }
  };

  if (!cats || !cats.length) return null;

  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase",
        letterSpacing: "0.08em", margin: "0 0 8px" }}>
        Points d'attention
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {cats.map(c => (
          <div key={c.category}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 13 }}>{c.icon}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>
                {c.label}
              </span>
              {c.total > c.alerts.length && (
                <span style={{ fontSize: 10, color: "var(--muted)" }}>
                  {c.alerts.length} sur {c.total}
                </span>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {c.alerts.map(a => (
                <div key={a.key}
                  style={{ display: "flex", alignItems: "center", gap: 10,
                    padding: "9px 12px", borderRadius: 10,
                    background: "var(--surface2)",
                    borderLeft: `3px solid ${a.severity === "warn" ? "#f59e0b" : "#3b82f6"}` }}>

                  <div onClick={() => a.link && navigate(a.link)}
                    style={{ flex: 1, minWidth: 0, cursor: a.link ? "pointer" : "default" }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.title}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: "var(--muted)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.detail}
                    </p>
                  </div>

                  <button onClick={() => setMenu(menu?.key === a.key ? null : a)}
                    aria-label="Ignorer"
                    style={{ background: "none", border: "none", cursor: "pointer",
                      color: "var(--muted)", fontSize: 16, padding: "0 4px", flexShrink: 0 }}>
                    ⋯
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {menu && (
        <div onClick={() => setMenu(null)}
          style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(0,0,0,0.5)" }}>
          <div onClick={e => e.stopPropagation()}
            style={{ position: "absolute", bottom: 0, left: 0, right: 0,
              background: "var(--sheet-bg)", borderRadius: "20px 20px 0 0",
              padding: "20px 16px 32px" }}>
            <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
              {menu.title}
            </p>
            <p style={{ margin: "0 0 16px", fontSize: 11, color: "var(--muted)" }}>
              {menu.detail}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {menu.link && (
                <button onClick={() => { const l = menu.link; setMenu(null); navigate(l); }}
                  style={{ padding: 12, borderRadius: 10, border: "none", cursor: "pointer",
                    background: "#3b82f6", color: "white", fontSize: 14, fontWeight: 700 }}>
                  Voir
                </button>
              )}
              <button onClick={() => dismiss(menu, 7)}
                style={{ padding: 12, borderRadius: 10, border: "none", cursor: "pointer",
                  background: "var(--surface2)", color: "var(--text)", fontSize: 14 }}>
                Ignorer 7 jours
              </button>
              <button onClick={() => dismiss(menu, null)}
                style={{ padding: 12, borderRadius: 10, border: "none", cursor: "pointer",
                  background: "rgba(239,68,68,0.12)", color: "#ef4444", fontSize: 14, fontWeight: 700 }}>
                Ne plus jamais afficher
              </button>
              <button onClick={() => setMenu(null)}
                style={{ padding: 12, borderRadius: 10, border: "1px solid var(--border)",
                  cursor: "pointer", background: "none", color: "var(--muted)", fontSize: 13 }}>
                Annuler
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
