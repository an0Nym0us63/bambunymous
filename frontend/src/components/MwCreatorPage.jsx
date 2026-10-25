import React, { useEffect, useState } from "react";
import { useTrackDetail } from "../utils/track";
import { create } from "zustand";
import { useSearchParams } from "react-router-dom";
import client from "../api/client";
import MwImg from "./MwImg";
import MakerWorldModelSheet, { prefetchModel } from "./MakerWorldModelSheet";
import { FSheet, FTile, fChip, fBtn } from "./FicheKit";
import ShareSheet from "./ShareSheet";
import { Send } from "lucide-react";
import { useIsAdmin } from "../store/auth";
import { useFriend } from "../store/friend";

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
  const [pf, setPf] = useState("all");             // tous, deja imprimes chez moi, jamais
  const [sharing, setSharing] = useState(false);   // la page partagee sur Telegram, comme un modele
  const isAdmin = useIsAdmin();
  const friend = useFriend(s => s.friend);

  useEffect(() => {
    if (!creator) { setData(null); return; }
    let alive = true;
    setData(null); setPf("all");
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

  useTrackDetail(creator ? `Créateur MakerWorld · ${data?.creator?.name || creator.name || creator.uid}` : null);
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

  const C = "#06B6D4";
  const items = (data?.items || []).filter(x => pf === "printed" ? x.printed > 0 : pf === "new" ? !(x.printed > 0) : true);
  const nPrinted = (data?.items || []).filter(x => x.printed > 0).length;
  return (<>
    <FSheet onClose={close} z={4100} bottom={c?.url ? <>
      <a href={c.url} target="_blank" rel="noopener noreferrer"
      style={{ ...fBtn, flex: 1, textDecoration: "none", color: "#fff", border: "none",
        background: `linear-gradient(135deg, ${C}, #3B82F6)`, boxShadow: `0 8px 18px -10px ${C}` }}>🌐 Voir sur MakerWorld ↗</a>
      {/* a droite, l'avion de Telegram (celui de la fenetre de partage) */}
      {isAdmin && !friend && <button onClick={() => setSharing(true)} data-tip="Partager sur Telegram"
        style={{ ...fBtn, flex: "0 0 auto", color: "#229ED9", borderColor: "rgba(34,158,217,0.4)", background: "rgba(34,158,217,0.1)" }}><Send size={15}/>Partager</button>}</> : null}>
      {/* le createur en vedette : son avatar, son nom, ses abonnes */}
      <div style={{ padding: "52px 18px 16px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap",
        background: `radial-gradient(circle at 15% 40%, ${C}50, transparent 60%), linear-gradient(135deg, ${C}22, transparent 70%), var(--surface2)` }}>
        <span style={{ width: 88, height: 88, borderRadius: "50%", flexShrink: 0, padding: 3, background: `conic-gradient(${C}, #3B82F6, #8B5CF6, ${C})`,
          boxShadow: `0 10px 24px -10px ${C}` }}>
          {c?.avatar ? <MwImg src={c.avatar} w={192} style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover", display: "block",
              border: "3px solid var(--surface2)", boxSizing: "border-box" }}/>
            : <span style={{ width: "100%", height: "100%", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 34, fontWeight: 900, color: "#fff", background: `linear-gradient(135deg, ${C}, #6366F1)`, border: "3px solid var(--surface2)", boxSizing: "border-box" }}>
                {(c?.name || creator.name || "?").slice(0, 1).toUpperCase()}</span>}
        </span>
        <div style={{ flex: "1 1 180px", minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".06em", textTransform: "uppercase", color: C }}>👤 Créateur MakerWorld</span>
          <span style={{ fontSize: 24, fontWeight: 900, color: "var(--text)", lineHeight: 1.15, overflowWrap: "anywhere" }}>{c?.name || creator.name || "Créateur"}</span>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {c?.handle && fChip(`@${c.handle}`, C)}
            {c && fChip(`👥 ${fmt(c.fans)} abonnés`, "#8B5CF6")}
            {c && fChip(`🧩 ${fmt(c.designs ?? data.total)} modèles`, "#3B82F6")}
            {c?.contest_wins > 0 && fChip(`🏆 ${c.contest_wins} concours`, "#EAB308")}
          </div>
        </div>
      </div>

      <div style={{ padding: "14px 14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        {!data ? <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 24 }}>Lecture des modèles…</p>
          : data.error ? <p style={{ textAlign: "center", color: "#f59e0b", fontSize: 13, padding: 24 }}>{data.error}</p> : (<>
          {c && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
            <FTile label="⬇ Téléch." value={fmt(c.downloads)} c1="#3B82F6" c2="#60A5FA"/>
            <FTile label="🖨️ Impressions" value={fmt(c.prints)} c1="#8B5CF6" c2="#C084FC"/>
            <FTile label="❤ J'aime" value={fmt(c.likes)} c1="#EF4444" c2="#F87171"/>
            {c.boosts != null && <FTile label="🚀 Boosts" value={fmt(c.boosts)} c1="#6366F1" c2="#A5B4FC"/>}
          </div>}

          {/* ses modeles, deja imprimes chez moi ou non */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 16, fontWeight: 900, color: "var(--text)", flex: 1, whiteSpace: "nowrap" }}>🧩 Ses modèles</span>
            <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--border)" }}>
              {[["all", `Tous ${data.items.length}`], ["printed", `✓ Imprimés ${nPrinted}`], ["new", `Jamais ${data.items.length - nPrinted}`]].map(([k, l]) => (
                <button key={k} onClick={() => setPf(k)} style={{ padding: "5px 10px", borderRadius: 11, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 800,
                  background: pf === k ? `linear-gradient(135deg, ${C}, #3B82F6)` : "transparent", color: pf === k ? "#fff" : "var(--muted)" }}>{l}</button>))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(150px,1fr))", gap: 10 }}>
            {items.map(x => (
              <button key={x.design_id} onClick={() => setModel(x)} onPointerDown={() => prefetchModel(x.design_id)}
                style={{ padding: 0, borderRadius: 18, overflow: "hidden", cursor: "pointer", textAlign: "left", color: "var(--text)", position: "relative",
                  display: "flex", flexDirection: "column", font: "inherit",
                  border: x.printed > 0 ? "1.5px solid rgba(34,197,94,0.6)" : "1px solid var(--border)",
                  background: x.printed > 0 ? "linear-gradient(170deg, rgba(34,197,94,0.12), transparent 55%), var(--surface2)" : "var(--surface2)",
                  boxShadow: x.printed > 0 ? "0 8px 22px -16px #22c55e" : "0 8px 22px -18px rgba(0,0,0,.6)" }}>
                {x.cover_url ? <MwImg src={x.cover_url} w={260} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}/>
                  : <div style={{ width: "100%", aspectRatio: "1", background: "var(--surface)" }}/>}
                {x.printed > 0 && <span style={{ position: "absolute", top: 7, left: 7, fontSize: 10, fontWeight: 900, color: "white", padding: "2px 8px",
                  borderRadius: 20, background: "linear-gradient(135deg, #22C55E, #16A34A)", boxShadow: "0 3px 10px rgba(0,0,0,.25)" }}>✓ IMPRIMÉ</span>}
                <div style={{ padding: "8px 10px 10px", display: "flex", flexDirection: "column", gap: 3 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, lineHeight: 1.25, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {x.title_fr || x.title}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)" }}>
                    {[x.like_count != null && `❤ ${fmt(x.like_count)}`, x.print_count != null && `🖨️ ${fmt(x.print_count)}`].filter(Boolean).join(" · ")}</div>
                </div>
              </button>
            ))}
          </div>
          {items.length === 0 && <p style={{ textAlign: "center", color: "var(--muted)", fontSize: 13, padding: 16 }}>Rien dans ce filtre parmi les modèles chargés.</p>}
          {data.items.length < data.total && (
            <div style={{ display: "flex", justifyContent: "center", padding: "4px 0" }}>
              <button onClick={loadMore} disabled={more} style={{ padding: "10px 20px", borderRadius: 14, fontSize: 13, fontWeight: 800,
                cursor: "pointer", background: "var(--surface)", border: `1px solid ${C}55`, color: "var(--text)" }}>
                {more ? "…" : `⬇ Plus de modèles (${data.items.length} / ${data.total})`}</button>
            </div>
          )}
        </>)}
      </div>
    </FSheet>
    {model && <MakerWorldModelSheet designId={model.design_id} preview={model} onClose={() => setModel(null)}/>}
    {sharing && <ShareSheet kind="creator" id={creator.uid} z={4300} onClose={() => setSharing(false)}/>}
  </>);
}

// Les liens des notifications MakerWorld (24/10/2026) : « ?model=… » ouvre la fiche du modele dans l'appli
// (le bouton MakerWorld y est), « ?creator=… » la page du createur. Monte une fois, dans la mise en page.
export function MwLinkHost() {
  const [sp, setSp] = useSearchParams();
  const model = sp.get("model"), creator = sp.get("creator");
  const drop = k => { const n = new URLSearchParams(sp); n.delete(k); setSp(n, { replace: true }); };
  useEffect(() => {
    if (!creator) return;
    openCreator({ uid: creator });
    drop("creator");
  }, [creator]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!model || !/^\d+$/.test(model)) return null;
  return <MakerWorldModelSheet designId={model} onClose={() => drop("model")}/>;
}
