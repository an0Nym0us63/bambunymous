import React, { useState, useEffect, useRef, useCallback } from "react";
import HiddenMark from "../components/HiddenMark";
import { RefreshCw, Trash2, Play, Square, Search } from "lucide-react";
import client from "../api/client";
import { showConfirm } from "../utils/dialog";


const LEVEL_COLOR = { DEBUG:"#64748b", INFO:"#3b82f6", WARNING:"#f59e0b", ERROR:"#ef4444", CRITICAL:"#dc2626" };
const LEVELS = ["DEBUG","INFO","WARNING","ERROR"];
const chipSt = c => ({ fontSize:11.5, fontWeight:800, padding:"3px 10px", borderRadius:20, color:c, background:`${c}1f`, border:`1px solid ${c}33`, whiteSpace:"nowrap" });
const panel = c => ({ borderRadius:18, border:`1px solid color-mix(in srgb, ${c} 26%, var(--border))`,
  background:`radial-gradient(90% 60% at 100% 0%, ${c}14, transparent 70%), var(--surface2)` });
const LEVEL_ORDER = { DEBUG:0, INFO:1, WARNING:2, ERROR:3, CRITICAL:4 };

/** Surligne le terme recherché — sans lui, on relit la ligne à la main. */
function Highlight({ text, q }) {
  const needle = (q || "").trim();
  if (!needle) return text;
  const i = String(text).toLowerCase().indexOf(needle.toLowerCase());
  if (i < 0) return text;
  const s = String(text);
  return (<>
    {s.slice(0, i)}
    <mark style={{ background:"rgba(245,158,11,0.35)", color:"inherit",
      borderRadius:2, padding:"0 1px" }}>{s.slice(i, i + needle.length)}</mark>
    {s.slice(i + needle.length)}
  </>);
}

export default function Logs({ embedded = false }) {
  const [logs, setLogs]         = useState([]);
  const [filter, setFilter]     = useState("");
  const [minLevel, setMinLevel] = useState("INFO");
  const [live, setLive]         = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [status, setStatus]     = useState("");
  const [searching, setSearching] = useState(false);
  const [fileMb, setFileMb]     = useState(null);
  const [scannedMb, setScannedMb] = useState(null);
  // Curseur : offset (en octets) du debut de la plus ancienne ligne affichee.
  // "Lire plus loin" repart de la, donc ni doublon ni trou.
  const [cursor, setCursor]     = useState(0);
  const [hasMore, setHasMore]   = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const skipScrollRef = useRef(false);   // ne pas sauter en bas apres un "lire plus loin"
  const bottomRef   = useRef();
  const intervalRef = useRef();
  const debounceRef = useRef();

  const load = useCallback(async (q = filter, level = minLevel) => {
    try {
      if (q.trim()) setSearching(true);
      const { data } = await client.get("/logs", { params: { limit:500, q: q.trim(), min_level: level } });
      setLogs(data.logs ?? []);
      setFileMb(data.file_mb);
      setScannedMb(data.scanned_mb ?? null);
      setCursor(data.next_offset ?? 0);
      setHasMore(!!data.has_more);
      if (data.error) setStatus("⚠ " + data.error);
      else setStatus(`${data.total ?? 0} entrée${(data.total??0)!==1?"s":""}`);
    } catch(e) {
      setStatus("⚠ " + (e.response?.data?.detail || e.message));
    } finally {
      setSearching(false);
    }
  }, [filter, minLevel]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    setLoadingMore(true);
    try {
      const { data } = await client.get("/logs", { params: {
        limit: 500, q: filter.trim(), min_level: minLevel, before: cursor,
      }});
      // Les lignes remontees sont PLUS ANCIENNES : elles vont en tete.
      skipScrollRef.current = true;
      setLogs(prev => [...(data.logs ?? []), ...prev]);
      setCursor(data.next_offset ?? 0);
      setHasMore(!!data.has_more);
      setScannedMb(data.scanned_mb ?? null);
    } catch (e) {
      setStatus("⚠ " + (e.response?.data?.detail || e.message));
    } finally { setLoadingMore(false); }
  };

  // Chargement initial
  useEffect(() => { load("", minLevel); }, []);

  // Debounce sur la recherche
  useEffect(() => {
    clearTimeout(debounceRef.current);
    // 600 ms se justifiaient quand chaque recherche relisait tout le fichier.
    // Le scan a rebours repond en quelques ms : on peut etre bien plus reactif.
    debounceRef.current = setTimeout(() => load(filter, minLevel), filter ? 200 : 0);
    return () => clearTimeout(debounceRef.current);
  }, [filter, minLevel]);

  useEffect(() => {
    // On ajoute des lignes PLUS ANCIENNES en tete : sauter en bas ferait perdre
    // la position de lecture, exactement ce qu'on venait chercher.
    if (skipScrollRef.current) { skipScrollRef.current = false; return; }
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [logs, autoScroll]);

  const startLive = () => { setLive(true); intervalRef.current = setInterval(() => load(filter, minLevel), 3000); };
  const stopLive  = () => { setLive(false); clearInterval(intervalRef.current); };
  useEffect(() => () => clearInterval(intervalRef.current), []);

  const clearLogs = async () => {
    await client.delete("/logs");
    setLogs([]); setStatus("Vidé"); setFileMb(0);
  };

  // Vider efface le fichier pour de bon : on demande d'abord
  const askClear = async () => {
    if (await showConfirm("Vider le journal ? Toutes les lignes du fichier sont effacées.", { confirmLabel: "🗑 Vider", danger: true })) clearLogs();
  };

  const Btn = ({ onClick, children, active, c = "#3b82f6", tone }) => (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:6, padding:"7px 13px",
      borderRadius:20, fontSize:12.5, fontWeight:800, cursor:"pointer",
      border: active ? "none" : `1px solid ${tone ? `color-mix(in srgb, ${tone} 40%, var(--border))` : "var(--border)"}`,
      background: active ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 65%, #ffffff))` : "var(--surface2)",
      boxShadow: active ? `0 6px 14px -8px ${c}` : "none",
      color: active ? "white" : (tone || "var(--text2)"),
    }}>{children}</button>
  );
  const nErr = logs.filter(l => l.level === "ERROR" || l.level === "CRITICAL").length;
  const nWarn = logs.filter(l => l.level === "WARNING").length;

  return (
    <div className="page-wide" style={{ "--page-max":"1000px", gap:12, height:"calc(100dvh - 100px)" }}>
      <style>{`.log-row { display:flex; gap:4px 10px; flex-wrap:wrap; align-items:baseline; }
        .log-msg { flex: 1 1 340px; min-width: 0; }`}</style>

      {/* En-tete : le titre, ce que contient le fichier, les actions */}
      {!embedded && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:10 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", minWidth:0 }}>
            <h1 className="page-title" style={{ fontSize:18, fontWeight:900, color:"var(--text)", margin:0 }}>📋 Journal</h1>
            <span style={chipSt("#64748b")}>{status}{fileMb != null ? ` · ${fileMb} Mo` : ""}
              {scannedMb != null && scannedMb > 0 && <span style={{ opacity:0.75 }}> · {scannedMb} Mo lus</span>}</span>
            {nErr > 0 && <span style={chipSt("#ef4444")}>⛔ {nErr} erreur{nErr > 1 ? "s" : ""}</span>}
            {nWarn > 0 && <span style={chipSt("#f59e0b")}>⚠ {nWarn} alerte{nWarn > 1 ? "s" : ""}</span>}
            {live && <span style={{ ...chipSt("#22c55e"), display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ width:7, height:7, borderRadius:"50%", background:"#22c55e", display:"inline-block", animation:"livePulse 2s infinite" }}/> En direct
            </span>}
          </div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            <Btn onClick={() => load(filter, minLevel)}><RefreshCw size={13}/> Actualiser</Btn>
            {live ? <Btn onClick={stopLive} active c="#22c55e"><Square size={13}/> Arrêter</Btn>
                  : <Btn onClick={startLive} tone="#16a34a"><Play size={13}/> En direct</Btn>}
            <Btn onClick={askClear} tone="#ef4444"><Trash2 size={13}/> Vider</Btn>
          </div>
        </div>
      )}

      {/* Filtres : recherche en pilule, niveau minimum en pastilles */}
      <div style={{ ...panel("#3b82f6"), padding:"10px 12px", display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <div style={{ position:"relative", flex:"1 1 200px", minWidth:0 }}>
          <Search size={15} style={{ position:"absolute", left:13, top:"50%", transform:"translateY(-50%)", color:"var(--muted)", pointerEvents:"none" }}/>
          <input value={filter} onChange={e=>setFilter(e.target.value)}
            placeholder="Rechercher dans tout le fichier…"
            style={{ width:"100%", height:38, background:"var(--surface)", border:"1px solid var(--border)", borderRadius:20,
              padding:"0 34px 0 36px", fontSize:13, color:"var(--text)", outline:"none", boxSizing:"border-box" }}/>
          <div style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", display:"flex" }}>
            {searching && <RefreshCw size={13} style={{ color:"var(--muted)", animation:"spin 1s linear infinite" }}/>}
          </div>
        </div>
        <div style={{ display:"flex", gap:3, padding:3, borderRadius:14, background:"var(--surface)", border:"1px solid var(--border)" }}>
          {LEVELS.map(l => { const on = minLevel === l, c = LEVEL_COLOR[l];
            return (
            <button key={l} onClick={()=>setMinLevel(l)} data-tip={`À partir de ${l}`} style={{
              padding:"5px 10px", borderRadius:11, fontSize:11.5, fontWeight:800, cursor:"pointer", border:"none",
              background: on ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 65%, #ffffff))` : "transparent",
              color: on ? "white" : c,
            }}>{l}</button>); })}
        </div>
        <span style={{ fontSize:12, fontWeight:800, color:"var(--muted)", flexShrink:0 }}>{logs.length} ligne{logs.length > 1 ? "s" : ""}</span>
        {hasMore && (
          <span data-tip="La recherche s'est arrêtée avant le début du fichier — utilise « Lire plus loin »."
            style={{ ...chipSt("#f59e0b"), flexShrink:0 }}>
            ⚠ partielle
          </span>
        )}
        <label style={{ display:"flex", alignItems:"center", gap:5, fontSize:12, fontWeight:700, color:"var(--muted)", cursor:"pointer", flexShrink:0 }}>
          <input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)}/>Suivre la fin
        </label>
      </div>

      {/* Les lignes */}
      <div style={{ ...panel(nErr ? "#ef4444" : "#64748b"), flex:1, overflowY:"auto", padding:8, fontFamily:"JetBrains Mono, monospace", fontSize:11.5 }}>
        {hasMore && (
          <button onClick={loadMore} disabled={loadingMore}
            style={{ width:"100%", padding:"9px", marginBottom:8, borderRadius:12,
              border:"1px dashed var(--border)", background:"var(--surface)",
              color:"var(--text2)", fontWeight:800, cursor: loadingMore ? "default" : "pointer",
              fontSize:12, fontFamily:"inherit" }}>
            {loadingMore ? "Lecture…" : "↑ Lire plus loin dans le journal"}
          </button>
        )}
        {logs.length === 0
          ? <p style={{ textAlign:"center", color:"var(--muted)", padding:"48px 0", fontSize:13, fontFamily:"inherit" }}>
              {searching ? "Recherche…" : "📭 Aucune ligne"}
            </p>
          : logs.map((l, i) => { const c = LEVEL_COLOR[l.level] || "#94a3b8";
            return (
            <div key={i} className="log-row" style={{
              padding:"5px 8px", borderRadius:8, marginBottom:2,
              background: l.level==="ERROR"||l.level==="CRITICAL" ? "rgba(239,68,68,0.09)"
                        : l.level==="WARNING" ? "rgba(245,158,11,0.08)" : "transparent",
              borderLeft: `3px solid ${c}`,
            }}>
              <span style={{ display:"flex", gap:8, alignItems:"baseline", flexShrink:0 }}>
                <span style={{ color:"var(--muted)", minWidth:58 }}>{l.ts}</span>
                <span style={{ color:c, fontWeight:900, fontSize:10, padding:"1px 6px", borderRadius:6, background:`${c}1f`, minWidth:44, textAlign:"center" }}>{l.level}</span>
                <span style={{ color:"var(--muted)", maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.name}</span>
              </span>
              <span className="log-msg" style={{ color:"var(--text)", wordBreak:"break-word", lineHeight:1.5 }}>
                <Highlight text={l.msg} q={filter}/>
              </span>
            </div>); })
        }
        <div ref={bottomRef}/>
      </div>
      <HiddenMark egg="ladybug" e="🐞" side="right"/>
    </div>
  );
}
