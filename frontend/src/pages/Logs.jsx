import React, { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, Trash2, Play, Square, Filter, Search } from "lucide-react";
import client from "../api/client";

const LEVEL_COLOR = { DEBUG:"#64748b", INFO:"#3b82f6", WARNING:"#f59e0b", ERROR:"#ef4444", CRITICAL:"#dc2626" };
const LEVELS = ["DEBUG","INFO","WARNING","ERROR"];
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
  const [truncated, setTruncated] = useState(false);
  const [scannedMb, setScannedMb] = useState(null);
  const bottomRef   = useRef();
  const intervalRef = useRef();
  const debounceRef = useRef();

  const load = useCallback(async (q = filter, level = minLevel) => {
    try {
      if (q.trim()) setSearching(true);
      const { data } = await client.get("/logs", { params: { limit:500, q: q.trim(), min_level: level } });
      setLogs(data.logs ?? []);
      setFileMb(data.file_mb);
      setTruncated(data.truncated ?? false);
      setScannedMb(data.scanned_mb ?? null);
      if (data.error) setStatus("⚠ " + data.error);
      else setStatus(`${data.total ?? 0} entrée${(data.total??0)!==1?"s":""}`);
    } catch(e) {
      setStatus("⚠ " + (e.response?.data?.detail || e.message));
    } finally {
      setSearching(false);
    }
  }, [filter, minLevel]);

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
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [logs, autoScroll]);

  const startLive = () => { setLive(true); intervalRef.current = setInterval(() => load(filter, minLevel), 3000); };
  const stopLive  = () => { setLive(false); clearInterval(intervalRef.current); };
  useEffect(() => () => clearInterval(intervalRef.current), []);

  const clearLogs = async () => {
    await client.delete("/logs");
    setLogs([]); setStatus("Vidé"); setFileMb(0);
  };

  const Btn = ({ onClick, children, active }) => (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:5, padding:"6px 12px",
      borderRadius:8, fontSize:12, cursor:"pointer",
      border:"1px solid var(--border)",
      background: active ? "#3b82f6" : "var(--surface2)",
      color: active ? "white" : "var(--text2)",
    }}>{children}</button>
  );

  return (
    <div style={{ maxWidth:1000, margin:"0 auto", display:"flex", flexDirection:"column", gap:12, height:"calc(100dvh - 100px)" }}>

      {/* Header */}
      {!embedded && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <h1 className="page-title" style={{ fontSize:18, fontWeight:700, color:"var(--text)" }}>Journal</h1>
            <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>
              {status}{fileMb != null ? ` · ${fileMb} Mo` : ""}
              {scannedMb != null && scannedMb > 0 && (
                <span style={{ marginLeft:6, opacity:0.7 }}>· {scannedMb} Mo lus</span>
              )}
            </span>
            {live && <span style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"#22c55e" }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:"#22c55e", display:"inline-block", animation:"livePulse 2s infinite" }}/> Live
            </span>}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            <Btn onClick={() => load(filter, minLevel)}><RefreshCw size={13}/> Actualiser</Btn>
            {live ? <Btn onClick={stopLive} active><Square size={13}/> Stop</Btn>
                  : <Btn onClick={startLive}><Play size={13}/> Live</Btn>}
            <Btn onClick={clearLogs}><Trash2 size={13}/> Vider</Btn>
          </div>
        </div>
      )}

      {/* Filtres */}
      <div className="card" style={{ padding:"10px 12px", display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <Filter size={13} style={{ color:"var(--muted)", flexShrink:0 }}/>
        <div style={{ position:"relative", flex:1, minWidth:120 }}>
          <input value={filter} onChange={e=>setFilter(e.target.value)}
            placeholder="Rechercher dans tout le fichier…"
            style={{ width:"100%", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:6,
              padding:"5px 32px 5px 10px", fontSize:12, color:"var(--text)", outline:"none", boxSizing:"border-box" }}/>
          <div style={{ position:"absolute", right:8, top:"50%", transform:"translateY(-50%)" }}>
            {searching
              ? <RefreshCw size={11} style={{ color:"var(--muted)", animation:"spin 1s linear infinite" }}/>
              : <Search size={11} style={{ color:"var(--muted)" }}/>}
          </div>
        </div>
        <div style={{ display:"flex", gap:3 }}>
          {LEVELS.map(l => (
            <button key={l} onClick={()=>setMinLevel(l)} style={{
              padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:"none",
              background: minLevel===l ? LEVEL_COLOR[l] : "var(--surface2)",
              color: minLevel===l ? "white" : "var(--muted)",
            }}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize:11, color:"var(--muted)", flexShrink:0 }}>{logs.length}</span>
        {truncated && (
          <span title="Le journal est trop volumineux : la recherche s'est arrêtée avant le début du fichier."
            style={{ fontSize:10, color:"#f59e0b", fontWeight:600, flexShrink:0 }}>
            ⚠ recherche partielle
          </span>
        )}
        <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"var(--muted)", cursor:"pointer", flexShrink:0 }}>
          <input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)}/>Auto-scroll
        </label>
      </div>

      {/* Logs */}
      <div className="card" style={{ flex:1, overflowY:"auto", padding:8, fontFamily:"JetBrains Mono, monospace", fontSize:11 }}>
        {logs.length === 0
          ? <p style={{ textAlign:"center", color:"var(--muted)", padding:"48px 0", fontSize:13 }}>
              {searching ? "Recherche…" : "Aucun log"}
            </p>
          : logs.map((l, i) => (
            <div key={i} style={{
              display:"flex", gap:8, padding:"3px 6px", borderRadius:4, alignItems:"baseline",
              background: l.level==="ERROR"||l.level==="CRITICAL" ? "rgba(239,68,68,0.07)"
                        : l.level==="WARNING" ? "rgba(245,158,11,0.06)" : "transparent",
              borderLeft: `2px solid ${LEVEL_COLOR[l.level]||"transparent"}`,
              marginBottom:1,
            }}>
              <span style={{ color:"var(--muted)", flexShrink:0, minWidth:60 }}>{l.ts}</span>
              <span style={{ color:LEVEL_COLOR[l.level]||"var(--text2)", fontWeight:700, flexShrink:0, minWidth:56 }}>{l.level}</span>
              <span style={{ color:"var(--muted)", flexShrink:0, minWidth:64, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.name}</span>
              <span style={{ color:"var(--text)", flex:1, wordBreak:"break-word", lineHeight:1.5 }}>
                <Highlight text={l.msg} q={filter}/>
              </span>
            </div>
          ))
        }
        <div ref={bottomRef}/>
      </div>
    </div>
  );
}
