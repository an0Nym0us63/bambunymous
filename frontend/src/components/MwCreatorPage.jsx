import React, { useEffect, useState } from "react";
import { create } from "zustand";
import client from "../api/client";
import MwImg from "./MwImg";
import MakerWorldModelSheet, { prefetchModel } from "./MakerWorldModelSheet";

// Page d'un createur MakerWorld : son profil et TOUS ses modeles. S'ouvre de
// partout (« par … » d'une fiche ou d'une tuile, createurs suivis) ; une seule
// instance, montee a la racine.
export const useCreatorPage = create((set) => ({
  creator: null,                                   // { uid, name }
  open: (c) => c?.uid && set({ creator: { uid: String(c.uid), name: c.name || "" } }),
  close: () => set({ creator: null }),
}));
export const openCreator = (c) => useCreatorPage.getState().open(c);

const fmt = n => n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(".", ",")} k` : String(n);

export function CreatorPageHost() {
  const creator = useCreatorPage(s => s.creator);
  const close = useCreatorPage(s => s.close);
  const [data, setData] = useState(null);
  const [more, setMore] = useState(false);
  const [model, setModel] = useState(null);

  useEffect(() => {
    if (!creator) { setData(null); return; }
    let alive = true;
    setData(null);
    client.get(`/makerworld/creators/${creator.uid}`)
      .then(({ data }) => alive && setData(data))
      .catch(e => alive && setData({ error: e.response?.data?.detail || e.message }));
    return () => { alive = false; };
  }, [creator?.uid]);
  useEffect(() => {
    if (!creator) return;
    const k = e => e.key === "Escape" && !model && close();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [creator, model]);

  if (!creator) return null;
  const c = data?.creator;
  const loadMore = async () => {
    setMore(true);
    try {
      const { data: d } = await client.get(`/makerworld/creators/${creator.uid}`, { params: { offset: data.next_offset } });
      setData(x => ({ ...x, items: [...x.items, ...(d.items || [])], next_offset: d.next_offset }));
    } catch { /* on garde ce qui est affiche */ }
    setMore(false);
  };

  return (
    <div data-no-pull="" onClick={close} style={{ position: "fixed", inset: 0, zIndex: 4100, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} className="sheet-panel" style={{ width: "100%", maxWidth: 820, height: "92vh",
        borderRadius: "18px 18px 0 0", border: "1px solid var(--border)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px 10px", borderBottom: "1px solid var(--border)" }}>
          {c?.avatar ? <MwImg src={c.avatar} w={96} style={{ width: 46, height: 46, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}/>
            : <span style={{ width: 46, height: 46, borderRadius: "50%", background: "var(--surface2)", flexShrink: 0 }}/>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c?.name || creator.name || "Créateur"}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
              {c ? [c.handle && `@${c.handle}`, `${fmt(c.fans)} abonnés`, `${fmt(c.designs ?? data.total)} modèles`].filter(Boolean).join(" · ") : "…"}</div>
          </div>
          {c?.url && <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11.5, fontWeight: 600, color: "#3b82f6",
            whiteSpace: "nowrap" }}>MakerWorld ↗</a>}
          <button onClick={close} aria-label="Fermer" style={{ background: "none", border: "none", color: "var(--muted)", fontSize: 20,
            cursor: "pointer", padding: 4 }}>✕</button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
          {!data ? <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 24 }}>Lecture des modèles…</p>
            : data.error ? <p style={{ textAlign: "center", color: "#f59e0b", fontSize: 13, padding: 24 }}>{data.error}</p> : (<>
            {c && (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, color: "var(--muted)", marginBottom: 10 }}>
                <span>⬇ {fmt(c.downloads)} téléchargements</span><span>🖨️ {fmt(c.prints)} impressions</span>
                <span>❤ {fmt(c.likes)} j'aime</span>{c.boosts != null && <span>⚡ {fmt(c.boosts)} boosts</span>}
                {c.contest_wins > 0 && <span>🏆 {c.contest_wins} concours gagnés</span>}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(130px,1fr))", gap: 8 }}>
              {data.items.map(x => (
                <button key={x.design_id} onClick={() => setModel(x)} onPointerDown={() => prefetchModel(x.design_id)}
                  style={{ padding: 0, border: x.printed > 0 ? "1.5px solid #22c55e" : "1px solid var(--border)", borderRadius: 10,
                    overflow: "hidden", cursor: "pointer", background: "var(--surface2)", textAlign: "left", color: "var(--text)", position: "relative" }}>
                  {x.cover_url ? <MwImg src={x.cover_url} w={260} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}/>
                    : <div style={{ width: "100%", aspectRatio: "1" }}/>}
                  {x.printed > 0 && <span style={{ position: "absolute", top: 5, right: 5, fontSize: 9.5, fontWeight: 800, color: "white",
                    background: "#22c55e", borderRadius: 10, padding: "1px 6px" }}>✓ IMPRIMÉ</span>}
                  <div style={{ padding: "5px 7px 6px" }}>
                    <div style={{ fontSize: 11.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {x.title_fr || x.title}</div>
                    <div style={{ fontSize: 10, color: "var(--muted)" }}>
                      {[x.like_count != null && `❤ ${fmt(x.like_count)}`, x.print_count != null && `🖨️ ${fmt(x.print_count)}`].filter(Boolean).join(" · ")}</div>
                  </div>
                </button>
              ))}
            </div>
            {data.items.length < data.total && (
              <div style={{ display: "flex", justifyContent: "center", padding: "14px 0" }}>
                <button onClick={loadMore} disabled={more} style={{ padding: "8px 18px", borderRadius: 10, fontSize: 12, fontWeight: 700,
                  cursor: "pointer", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text)" }}>
                  {more ? "…" : `Plus de modèles (${data.items.length} / ${data.total})`}</button>
              </div>
            )}
          </>)}
        </div>
      </div>
      {model && <div onClick={e => e.stopPropagation()}>
        <MakerWorldModelSheet designId={model.design_id} preview={model} onClose={() => setModel(null)}/></div>}
    </div>
  );
}
