import React, { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, Trash2, Play, Square, Filter } from "lucide-react";
import client from "../api/client";

const LEVEL_COLOR = { DEBUG:"#64748b", INFO:"#3b82f6", WARNING:"#f59e0b", ERROR:"#ef4444" };
const LEVELS = ["DEBUG","INFO","WARNING","ERROR"];
const LEVEL_ORDER = { DEBUG:0, INFO:1, WARNING:2, ERROR:3 };

export default function Logs() {
  const [logs, setLogs]         = useState([]);
  const [filter, setFilter]     = useState("");
  const [minLevel, setMinLevel] = useState("INFO");
  const [live, setLive]         = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [total, setTotal]       = useState(0);
  const [status, setStatus]     = useState("");
  const bottomRef  = useRef();
  const intervalRef = useRef();

  const load = useCallback(async () => {
    try {
      const { data } = await client.get("/logs?limit=500");
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
      if (data.error) {
        setStatus("⚠ " + data.error);
      } else {
        setStatus(`${data.total ?? 0} lignes dans le fichier`);
      }
    } catch(e) {
      setStatus("⚠ Erreur: " + (e.response?.data?.detail || e.message));
    }
  }, []);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [logs, autoScroll]);

  const startLive = () => {
    setLive(true);
    intervalRef.current = setInterval(load, 1000);
  };
  const stopLive = () => {
    setLive(false);
    clearInterval(intervalRef.current);
  };
  useEffect(() => () => clearInterval(intervalRef.current), []);

  const clearLogs = async () => {
    await client.delete("/logs");
    setLogs([]); setTotal(0); setStatus("Fichier vidé");
  };

  const minIdx = LEVEL_ORDER[minLevel] ?? 0;
  const filtered = logs.filter(l => {
    if ((LEVEL_ORDER[l.level] ?? 0) < minIdx) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return l.msg?.toLowerCase().includes(q) || l.name?.toLowerCase().includes(q);
  });

  const Btn = ({ onClick, children, active }) => (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:5, padding:"6px 12px",
      borderRadius:8, fontSize:12, cursor:"pointer",
      border:"1px solid var(--border)",
      background: active ? "#3b82f6" : "var(--surface2)",
      color: active ? "white" : "var(--text2)",
    }}>
      {children}
    </button>
  );

  return (
    <div style={{ maxWidth:1000, margin:"0 auto", display:"flex", flexDirection:"column", gap:12, height:"calc(100dvh - 100px)" }}>

      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)" }}>Journal</h1>
          {status && <span style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace" }}>{status}</span>}
          {live && <span style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"#22c55e" }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:"#22c55e", display:"inline-block", animation:"livePulse 2s infinite" }}/>Live
          </span>}
        </div>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          <Btn onClick={load}><RefreshCw size={13}/> Actualiser</Btn>
          {live ? <Btn onClick={stopLive} active><Square size={13}/> Stop</Btn>
                : <Btn onClick={startLive}><Play size={13}/> Live</Btn>}
          <Btn onClick={clearLogs}><Trash2 size={13}/> Vider</Btn>
        </div>
      </div>

      <div className="card" style={{ padding:"10px 12px", display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <Filter size={13} style={{ color:"var(--muted)" }}/>
        <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Filtrer…"
          style={{ flex:1, minWidth:120, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:6, padding:"5px 10px", fontSize:12, color:"var(--text)", outline:"none" }}/>
        <div style={{ display:"flex", gap:3 }}>
          {LEVELS.map(l => (
            <button key={l} onClick={()=>setMinLevel(l)} style={{
              padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600, cursor:"pointer", border:"none",
              background: minLevel===l ? LEVEL_COLOR[l] : "var(--surface2)",
              color: minLevel===l ? "white" : "var(--muted)",
            }}>{l}</button>
          ))}
        </div>
        <span style={{ fontSize:11, color:"var(--muted)" }}>{filtered.length}/{logs.length}</span>
        <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"var(--muted)", cursor:"pointer" }}>
          <input type="checkbox" checked={autoScroll} onChange={e=>setAutoScroll(e.target.checked)}/>Auto-scroll
        </label>
      </div>

      <div className="card" style={{ flex:1, overflowY:"auto", padding:8 }}>
        {filtered.length === 0 ? (
          <p style={{ textAlign:"center", color:"var(--muted)", padding:"48px 0", fontSize:13 }}>
            {logs.length === 0 ? "Aucun log — vérifiez que le fichier /data/bambunymous.log existe" : "Aucun résultat pour ce filtre"}
          </p>
        ) : filtered.map((l, i) => (
          <div key={i} style={{
            display:"grid", gridTemplateColumns:"64px 80px 100px 1fr",
            gap:8, padding:"2px 8px", borderRadius:4,
            background: l.level==="ERROR" ? "rgba(239,68,68,0.06)" : l.level==="WARNING" ? "rgba(245,158,11,0.05)" : "transparent",
            fontFamily:"JetBrains Mono, monospace", fontSize:11, alignItems:"start",
          }}>
            <span style={{ color:"var(--muted)" }}>{l.ts}</span>
            <span style={{ color:LEVEL_COLOR[l.level]||"var(--text2)", fontWeight:600 }}>{l.level}</span>
            <span style={{ color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.name}</span>
            <span style={{ color:"var(--text)", wordBreak:"break-word" }}>{l.msg}</span>
          </div>
        ))}
        <div ref={bottomRef}/>
      </div>
    </div>
  );
}
