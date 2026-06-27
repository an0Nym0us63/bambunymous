import React, { useState, useEffect, useRef, useCallback } from "react";
import { RefreshCw, Trash2, Play, Square, Filter } from "lucide-react";
import client from "../api/client";

const LEVEL_COLOR = {
  DEBUG:    "#64748b",
  INFO:     "#3b82f6",
  WARNING:  "#f59e0b",
  ERROR:    "#ef4444",
  CRITICAL: "#dc2626",
};

const LEVEL_BG = {
  DEBUG:    "rgba(100,116,139,0.08)",
  INFO:     "rgba(59,130,246,0.06)",
  WARNING:  "rgba(245,158,11,0.10)",
  ERROR:    "rgba(239,68,68,0.10)",
  CRITICAL: "rgba(220,38,38,0.15)",
};

const LEVELS = ["DEBUG","INFO","WARNING","ERROR"];

export default function Logs() {
  const [logs, setLogs]           = useState([]);
  const [filter, setFilter]       = useState("");
  const [minLevel, setMinLevel]   = useState("DEBUG");
  const [streaming, setStreaming] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef();
  const esRef     = useRef();
  const containerRef = useRef();

  // Charger les logs existants
  const loadLogs = useCallback(async () => {
    try {
      const { data } = await client.get("/logs?limit=300");
      setLogs(data.logs);
    } catch {}
  }, []);

  useEffect(() => { loadLogs(); }, []);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior:"smooth" });
  }, [logs, autoScroll]);

  // SSE stream
  const startStream = () => {
    const token = localStorage.getItem("token");
    const es = new EventSource(`/api/v1/logs/stream?token=${token}`);
    es.onmessage = (e) => {
      if (e.data === "connected") return;
      try {
        const entry = JSON.parse(e.data);
        setLogs(prev => [...prev.slice(-499), entry]);
      } catch {}
    };
    es.onerror = () => stopStream();
    esRef.current = es;
    setStreaming(true);
  };

  const stopStream = () => {
    esRef.current?.close();
    esRef.current = null;
    setStreaming(false);
  };

  useEffect(() => () => stopStream(), []);

  // Filtrage
  const levelOrder = { DEBUG:0, INFO:1, WARNING:2, ERROR:3, CRITICAL:4 };
  const minIdx = levelOrder[minLevel] ?? 0;
  const filtered = logs.filter(l => {
    if (levelOrder[l.level] < minIdx) return false;
    if (filter) {
      const q = filter.toLowerCase();
      return l.msg.toLowerCase().includes(q) || l.name.toLowerCase().includes(q);
    }
    return true;
  });

  const btn = (onClick, children, active) => (
    <button onClick={onClick} style={{
      display:"flex", alignItems:"center", gap:6, padding:"6px 12px",
      borderRadius:8, fontSize:12, cursor:"pointer", border:"1px solid var(--border)",
      background: active ? "#3b82f6" : "var(--surface2)",
      color: active ? "white" : "var(--text2)", transition:"all 0.15s",
    }}>
      {children}
    </button>
  );

  return (
    <div style={{ maxWidth:900, margin:"0 auto", display:"flex", flexDirection:"column", gap:12, height:"calc(100dvh - 120px)" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:8 }}>
        <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)" }}>Journal</h1>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
          {btn(loadLogs, <><RefreshCw size={13}/> Actualiser</>)}
          {streaming
            ? btn(stopStream, <><Square size={13}/> Stop</>, true)
            : btn(startStream, <><Play size={13}/> Live</>)}
          {btn(() => setLogs([]), <><Trash2 size={13}/> Vider</>)}
        </div>
      </div>

      {/* Filtres */}
      <div className="card" style={{ padding:"10px 12px", display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
        <Filter size={13} style={{ color:"var(--muted)", flexShrink:0 }}/>
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filtrer par texte, module…"
          style={{ flex:1, minWidth:160, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:6, padding:"5px 10px", fontSize:12, color:"var(--text)", outline:"none" }}
        />
        <div style={{ display:"flex", gap:4 }}>
          {LEVELS.map(l => (
            <button key={l} onClick={() => setMinLevel(l)} style={{
              padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:600,
              cursor:"pointer", border:"none", transition:"all 0.15s",
              background: minLevel === l ? LEVEL_COLOR[l] : "var(--surface2)",
              color: minLevel === l ? "white" : "var(--muted)",
            }}>
              {l}
            </button>
          ))}
        </div>
        <span style={{ fontSize:11, color:"var(--muted)", flexShrink:0 }}>
          {filtered.length} / {logs.length}
        </span>
        <label style={{ display:"flex", alignItems:"center", gap:4, fontSize:11, color:"var(--muted)", cursor:"pointer" }}>
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)}/>
          Auto-scroll
        </label>
        {streaming && (
          <span style={{ fontSize:11, color:"#22c55e", display:"flex", alignItems:"center", gap:4 }}>
            <span style={{ width:6, height:6, borderRadius:"50%", backgroundColor:"#22c55e", animation:"livePulse 2s infinite", display:"inline-block" }}/>
            Live
          </span>
        )}
      </div>

      {/* Log list */}
      <div ref={containerRef} className="card" style={{ flex:1, overflowY:"auto", padding:8, fontFamily:"JetBrains Mono, monospace", fontSize:11 }}>
        {filtered.length === 0 ? (
          <p style={{ textAlign:"center", color:"var(--muted)", padding:"32px 0" }}>Aucun log</p>
        ) : (
          filtered.map((l, i) => (
            <div key={i} style={{
              display:"grid", gridTemplateColumns:"56px 72px 80px 1fr",
              gap:8, padding:"3px 6px", borderRadius:4,
              background: i % 2 === 0 ? LEVEL_BG[l.level] : "transparent",
              alignItems:"start",
            }}>
              <span style={{ color:"var(--muted)", whiteSpace:"nowrap" }}>{l.ts}</span>
              <span style={{ color: LEVEL_COLOR[l.level], fontWeight:600 }}>{l.level}</span>
              <span style={{ color:"var(--muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{l.name}</span>
              <span style={{ color:"var(--text)", wordBreak:"break-word" }}>{l.msg}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
