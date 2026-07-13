import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import client from "../api/client";
import { colorBg, parseColorsList } from "../utils/colors";

/** Pastille : dégradé sur un calque interne, anneau en inset box-shadow. */
function Dot({ a, size = 26 }) {
  const cols = parseColorsList(a.color, a.colors_array);
  return (
    <div style={{ width:size, height:size, borderRadius:8, flexShrink:0,
      position:"relative", overflow:"hidden",
      boxShadow:"inset 0 0 0 1px rgba(128,128,128,0.30)" }}>
      <div style={{ position:"absolute", inset:0, ...colorBg(cols, a.multicolor_type) }}/>
    </div>
  );
}

const Chip = ({ children }) => (
  <span style={{ fontSize:10, color:"var(--muted)", background:"var(--surface2)",
    padding:"1px 6px", borderRadius:5, whiteSpace:"nowrap" }}>{children}</span>
);

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
  const [err, setErr]   = useState(null);
  const [menu, setMenu] = useState(null);   // alerte dont le menu est ouvert

  const load = () => {
    client.get("/attention")
      .then(r => {
        setCats(r.data?.categories || []);
        const es = r.data?.errors || [];
        setErr(es.length
          ? es.map(e => `${e.label} : ${e.error}`).join("\n")
          : null);
      })
      .catch(e => {
        // Se taire sur une erreur rendait la section invisible et le probleme
        // indebuggable : on l'affiche.
        setCats([]);
        setErr(e.response?.status
          ? `${e.response.status} — ${e.response.data?.detail || "erreur serveur"}`
          : e.message);
      });
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

  const errBox = err && (
    <div style={{ marginBottom:10, padding:"10px 12px", borderRadius:10,
      background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)" }}>
      <p style={{ margin:0, fontSize:12, fontWeight:700, color:"#ef4444" }}>
        Certaines vérifications ont échoué
      </p>
      <pre style={{ margin:"4px 0 0", fontSize:10, color:"var(--muted)",
        fontFamily:"JetBrains Mono,monospace", whiteSpace:"pre-wrap" }}>{err}</pre>
    </div>
  );

  if (!cats) return null;                      // premier chargement
  if (!cats.length) {
    if (err) return <div className="card" style={{ padding:14 }}>{errBox}</div>;
    // Etat explicite : "rien a signaler" n'est pas la meme chose que "ca n'a pas
    // charge", et on ne pouvait pas les distinguer.
    return (
      <div className="card" style={{ padding:14 }}>
        <p style={{ fontSize:10, color:"var(--muted)", textTransform:"uppercase",
          letterSpacing:"0.08em", margin:"0 0 10px" }}>Points d'attention</p>
        <div style={{ padding:"10px 12px", borderRadius:10, background:"var(--surface2)",
          display:"flex", alignItems:"center", gap:8 }}>
          <span>✅</span>
          <span style={{ fontSize:12, color:"var(--muted)" }}>Rien à signaler.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="card" style={{ padding: 14 }}>
      <p style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase",
        letterSpacing: "0.08em", margin: "0 0 10px" }}>
        Points d'attention
      </p>
      {errBox}

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {cats.map(c => (
          <div key={c.category}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 12 }}>{c.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text)" }}>
                {c.label}
              </span>
              <span style={{ fontSize: 10, color: "var(--muted)", background: "var(--surface2)",
                padding: "1px 6px", borderRadius: 8 }}>
                {c.total > c.alerts.length ? `${c.alerts.length} / ${c.total}` : c.total}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {c.alerts.map(a => (
                <div key={a.key}
                  onClick={() => a.link && navigate(a.link)}
                  style={{ display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 10px", borderRadius: 10,
                    background: "var(--surface2)",
                    cursor: a.link ? "pointer" : "default" }}>

                  <Dot a={a}/>

                  {/* minWidth:0 est indispensable : sans lui, un flex enfant refuse
                      de retrecir sous sa largeur de contenu et pousse la metrique
                      hors de l'ecran. */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "var(--text)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {a.title}
                    </p>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2,
                      overflow: "hidden" }}>
                      {a.brand && <Chip>{a.brand}</Chip>}
                      {a.material && <Chip>{a.material}</Chip>}
                      {a.detail && (
                        <span style={{ fontSize: 11, color: "var(--muted)",
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.detail}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* La metrique (poids restant...) est l'info la plus utile de
                      l'alerte : flexShrink 0, elle ne peut PAS etre tronquee.
                      Noyee dans le texte, elle disparaissait sur mobile. */}
                  {a.value && (
                    <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700,
                      fontFamily: "JetBrains Mono, monospace", whiteSpace: "nowrap",
                      color: a.severity === "warn" ? "#f59e0b" : "var(--muted)" }}>
                      {a.value}
                    </span>
                  )}

                  <button onClick={e => { e.stopPropagation(); setMenu(a); }}
                    aria-label="Options"
                    style={{ background: "none", border: "none", cursor: "pointer",
                      color: "var(--muted)", fontSize: 15, padding: "0 2px", flexShrink: 0 }}>
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
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
              <Dot a={menu} size={34}/>
              <div style={{ minWidth:0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
                  {menu.title}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--muted)" }}>
                  {[menu.brand, menu.material, menu.detail, menu.value]
                    .filter(Boolean).join(" · ")}
                </p>
              </div>
            </div>
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
