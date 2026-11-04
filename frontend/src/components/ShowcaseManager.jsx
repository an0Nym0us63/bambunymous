import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import client, { apiThumb } from "../api/client";
import { FSheet, FCard, fBtn } from "./FicheKit";
import { toast } from "../store/toast";
import { showConfirm } from "../utils/dialog";
import { egg } from "../eggs";

// « Ma vitrine » (04/11/2026) : le portfolio public -- choisir les pieces (impressions et groupes qui ont des photos),
// leur ordre, celles du grand carrousel (★) et un mot pour chacune ; le titre, l'accroche, la couleur, le contact, la
// boutique (objets a vendre) ; et le lien, a creer pour une duree, copier, ouvrir ou retirer.
const DUR = [[0, "sans fin"], [7, "7 jours"], [30, "30 jours"], [365, "1 an"]];

export default function ShowcaseManager({ onClose }) {
  const [cfg, setCfg] = useState(null);
  const [gal, setGal] = useState(null);
  const [q, setQ] = useState("");
  const [days, setDays] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    client.get("/showcase").then(r => setCfg(r.data)).catch(() => setCfg({ error: true }));
    client.get("/prints/gallery", { params: { kind: "photos" } }).then(r => setGal(r.data)).catch(() => setGal({ prints: [], groups: [] }));
    egg("vitrine");
  }, []);
  // les pieces possibles : groupes et impressions de la galerie (celles qui ont des photos)
  const cand = useMemo(() => {
    if (!gal) return [];
    return [...(gal.groups || []).map(g => ({ k: `g${g.id}`, title: g.name, photo: g.photos?.[0]?.url, n: g.photos?.length || 0, sub: `${g.prints} impression${g.prints > 1 ? "s" : ""}` })),
      ...(gal.prints || []).map(p => ({ k: `p${p.id}`, title: p.title, photo: p.photos?.[0]?.url, n: p.photos?.length || 0, sub: "impression" }))];
  }, [gal]);
  const byK = useMemo(() => Object.fromEntries(cand.map(c => [c.k, c])), [cand]);
  const set = patch => { setCfg(c => ({ ...c, ...patch })); setDirty(true); };
  const items = cfg?.items || [];
  const setItems = f => set({ items: f(items) });
  const move = (i, d) => setItems(a => { const b = [...a]; const j = i + d; if (j < 0 || j >= b.length) return a; [b[i], b[j]] = [b[j], b[i]]; return b; });
  const save = async () => {
    setBusy(true);
    try {
      const { title, tagline, accent, contact, show_sale, show_credit } = cfg;
      const r = await client.put("/showcase", { title, tagline, accent, contact, show_sale, show_credit, items });
      setCfg(r.data); setDirty(false); toast("Vitrine enregistrée");
    } catch (e) { toast(e?.response?.data?.detail || "La vitrine n'a pas pu être enregistrée", "error"); }
    setBusy(false);
  };
  const link = cfg?.path ? `${window.location.origin}${cfg.path}` : null;
  const makeLink = async () => {
    setBusy(true);
    try {
      if (dirty) await save();
      const r = await client.post("/showcase/link", { days });
      const u = `${window.location.origin}${r.data.path}`;
      await navigator.clipboard.writeText(u).catch(() => {});
      setCfg(c => ({ ...c, path: r.data.path, token: r.data.token }));
      toast("Lien de la vitrine copié");
      egg("vitrine_partagee");
    } catch (e) { toast(e?.response?.data?.detail || "Le lien n'a pas pu être créé", "error"); }
    setBusy(false);
  };
  const unlink = async () => {
    if (!(await showConfirm("Retirer le lien de la vitrine ? Il ne s'ouvrira plus (tu pourras en créer un nouveau).", { confirmLabel: "Retirer" }))) return;
    try { await client.delete("/showcase/link"); setCfg(c => ({ ...c, path: null, token: null, expires: null })); toast("Lien retiré"); } catch { toast("Le lien n'a pas pu être retiré", "error"); }
  };
  const ql = q.trim().toLowerCase();
  const free = cand.filter(c => !items.some(i => i.k === c.k) && (!ql || (c.title || "").toLowerCase().includes(ql))).slice(0, 60);
  const input = { width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)",
    fontSize: 14, fontFamily: "inherit" };
  const chip = on => ({ padding: "5px 11px", borderRadius: 16, cursor: "pointer", fontSize: 12, fontWeight: 800, border: `1px solid ${on ? "#C9A96E" : "var(--border)"}`,
    background: on ? "color-mix(in srgb, #C9A96E 18%, transparent)" : "var(--surface2)", color: on ? "#A1803F" : "var(--muted)" });
  return createPortal(<FSheet onClose={onClose} z={1200} bottom={<>
    <button type="button" onClick={onClose} style={{ ...fBtn, flex: 1 }}>Fermer</button>
    <button type="button" disabled={busy || !dirty} onClick={save} style={{ ...fBtn, flex: 2, color: "#fff", border: "none", opacity: busy || !dirty ? .55 : 1,
      background: "linear-gradient(135deg, #1F2937, #A1803F)" }}>{busy ? "…" : dirty ? "Enregistrer" : "Enregistré"}</button></>}>
    <div style={{ padding: "52px 16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 900, color: "var(--text)" }}>✨ Ma vitrine</div>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--muted)" }}>Un portfolio public de tes plus belles pièces, à envoyer par un lien : un grand carrousel, la collection, et ta boutique. Jamais un coût.</div>
      </div>
      {!cfg ? <div style={{ color: "var(--muted)" }}>Chargement…</div> : cfg.error ? <div style={{ color: "#ef4444" }}>La vitrine n'a pas pu être lue.</div> : <>
        <FCard t="Le lien" i="🔗" c="#A1803F">
          {link ? <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text2)", wordBreak: "break-all" }}>{link}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: cfg.expired ? "#ef4444" : "var(--muted)" }}>
              {cfg.expired ? "Expiré : il ne s'ouvre plus" : cfg.expires ? `Valable jusqu'au ${new Date(`${cfg.expires}Z`).toLocaleDateString("fr-FR")}` : "Valable sans fin"} · {cfg.views || 0} ouverture{cfg.views > 1 ? "s" : ""}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <button type="button" onClick={makeLink} disabled={busy} style={chip(false)}>📋 Copier</button>
              <a href={link} target="_blank" rel="noopener noreferrer" style={{ ...chip(false), textDecoration: "none" }}>↗ Ouvrir</a>
              <button type="button" onClick={unlink} style={{ ...chip(false), color: "#ef4444" }}>Retirer</button>
            </div>
          </div> : <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, fontWeight: 800, color: "var(--muted)" }}>Valable :
              {DUR.map(([n, l]) => <button key={n} type="button" onClick={() => setDays(n)} style={chip(days === n)}>{l}</button>)}</div>
            <button type="button" disabled={busy || !items.length} onClick={makeLink} style={{ ...fBtn, color: "#fff", border: "none", background: "linear-gradient(135deg, #1F2937, #A1803F)",
              opacity: busy || !items.length ? .55 : 1 }}>Créer et copier le lien</button>
            {!items.length && <div style={{ fontSize: 12, color: "var(--muted)" }}>Ajoute d'abord une pièce.</div>}
          </div>}
        </FCard>
        <FCard t="L'allure" i="🎨" c="#8B5CF6">
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 6 }}>
            <input value={cfg.title || ""} onChange={e => set({ title: e.target.value })} placeholder="Titre (ton atelier, ton nom…)" maxLength={80} style={input}/>
            <textarea value={cfg.tagline || ""} onChange={e => set({ tagline: e.target.value })} placeholder="Une phrase d'accroche" maxLength={160} rows={2} style={{ ...input, resize: "vertical" }}/>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--muted)" }}>Couleur :</span>
              {(cfg.accents || []).map(c => <button key={c} type="button" aria-label={c} onClick={() => set({ accent: c })} style={{ width: 26, height: 26, borderRadius: "50%",
                background: c, cursor: "pointer", border: "none", boxShadow: cfg.accent === c ? "0 0 0 2px var(--surface), 0 0 0 4px var(--text)" : "inset 0 0 0 1px rgba(0,0,0,.2)" }}/>)}
            </div>
            <input value={cfg.contact || ""} onChange={e => set({ contact: e.target.value })} placeholder="Contact (Instagram, e-mail…), facultatif" maxLength={200} style={input}/>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, fontWeight: 700, color: "var(--text2)" }}>
              <input type="checkbox" checked={!!cfg.show_sale} onChange={e => set({ show_sale: e.target.checked })} style={{ width: 18, height: 18 }}/>La boutique : mes objets disponibles avec un prix souhaité</label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, fontWeight: 700, color: "var(--text2)" }}>
              <input type="checkbox" checked={!!cfg.show_credit} onChange={e => set({ show_credit: e.target.checked })} style={{ width: 18, height: 18 }}/>Créditer le modèle MakerWorld et son créateur</label>
          </div>
        </FCard>
        <FCard t={`Les pièces · ${items.length}`} i="🖼️" c="#0EA5E9">
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", marginTop: 4 }}>★ : dans le grand carrousel (sinon, les premières). L'ordre est celui de la collection.</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {items.map((it, i) => { const c = byK[it.k];
              return <div key={it.k} style={{ display: "flex", gap: 10, padding: 8, borderRadius: 14, border: "1px solid var(--border)", background: "var(--surface)" }}>
                {c?.photo ? <img src={apiThumb(c.photo, 120)} alt="" style={{ width: 54, height: 54, borderRadius: 10, objectFit: "cover", flexShrink: 0 }}/>
                  : <span style={{ width: 54, height: 54, borderRadius: 10, background: "var(--surface2)", flexShrink: 0 }}/>}
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 800, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {c?.title || "Pièce sans photo"}</span>
                    <button type="button" onClick={() => setItems(a => a.map(x => x.k === it.k ? { ...x, featured: !x.featured } : x))} data-tip="Dans le grand carrousel"
                      style={{ border: "none", background: "none", cursor: "pointer", fontSize: 17, color: it.featured ? "#C9A96E" : "var(--muted)" }}>{it.featured ? "★" : "☆"}</button>
                    <button type="button" onClick={() => move(i, -1)} disabled={!i} aria-label="Monter" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted)", opacity: i ? 1 : .3 }}>▲</button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} aria-label="Descendre" style={{ border: "none", background: "none", cursor: "pointer", color: "var(--muted)", opacity: i < items.length - 1 ? 1 : .3 }}>▼</button>
                    <button type="button" onClick={() => setItems(a => a.filter(x => x.k !== it.k))} aria-label="Retirer" style={{ border: "none", background: "none", cursor: "pointer", color: "#ef4444" }}>✕</button>
                  </div>
                  <input value={it.note || ""} onChange={e => { const v = e.target.value; setItems(a => a.map(x => x.k === it.k ? { ...x, note: v } : x)); }}
                    placeholder="Un mot sur cette pièce (facultatif)" maxLength={400} style={{ ...input, padding: "6px 9px", fontSize: 12.5 }}/>
                </div>
              </div>; })}
            {!items.length && <div style={{ fontSize: 13, color: "var(--muted)" }}>Aucune pièce pour l'instant : choisis-en ci-dessous.</div>}
          </div>
        </FCard>
        <FCard t="Ajouter des pièces" i="➕" c="#22C55E">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Chercher dans ta galerie…" style={{ ...input, marginTop: 6 }}/>
          {!gal ? <div style={{ color: "var(--muted)", marginTop: 8 }}>Chargement de ta galerie…</div>
            : <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(104px, 1fr))", gap: 8, marginTop: 8 }}>
              {free.map(c => <button key={c.k} type="button" onClick={() => setItems(a => [...a, { k: c.k, featured: false, note: "" }])}
                style={{ padding: 0, border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden", background: "var(--surface)", cursor: "pointer", textAlign: "left" }}>
                <img src={apiThumb(c.photo, 220)} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}/>
                <div style={{ padding: "5px 7px" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 800, color: "var(--text2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)" }}>{c.sub} · {c.n} photo{c.n > 1 ? "s" : ""}</div></div>
              </button>)}
            </div>}
        </FCard>
      </>}
    </div>
  </FSheet>, document.body);
}

// la banniere de l'onglet Galerie qui ouvre « Ma vitrine »
export function ShowcaseBanner() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "12px 16px", borderRadius: 18, border: "none",
      cursor: "pointer", textAlign: "left", color: "#F5F5F4", background: "linear-gradient(120deg, #0B0B0F, #1F2937 55%, #A1803F)", boxShadow: "0 12px 30px -16px #A1803F" }}>
      <span style={{ fontSize: 24 }}>✨</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 15, fontWeight: 900, letterSpacing: ".02em" }}>Ma vitrine</span>
        <span style={{ fontSize: 12, fontWeight: 700, opacity: .8 }}>Un portfolio public de tes plus belles pièces, à partager par un lien</span>
      </span>
      <span style={{ fontSize: 13, fontWeight: 900, padding: "6px 13px", borderRadius: 20, background: "rgba(255,255,255,.15)" }}>Gérer ›</span>
    </button>
    {open && <ShowcaseManager onClose={() => setOpen(false)}/>}
  </>;
}
