import React, { useState, useEffect, useRef } from "react";
import { Upload, Play, CheckCircle, AlertCircle, RefreshCw, Database } from "lucide-react";
import client from "../api/client";

export default function ImportSection() {
  const [status, setStatus] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadInfo, setUploadInfo] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef();
  const pollRef = useRef();

  const fetchStatus = async () => {
    try {
      const { data } = await client.get("/import/status");
      setStatus(data);
      if (!data.running) { clearInterval(pollRef.current); setImporting(false); }
    } catch {}
  };

  useEffect(() => { fetchStatus(); return () => clearInterval(pollRef.current); }, []);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true); setUploadInfo(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await client.post("/import/upload", form, { headers:{"Content-Type":"multipart/form-data"} });
      setUploadInfo(data);
      await fetchStatus();
    } catch(err) {
      setUploadInfo({ error: err.response?.data?.detail || "Erreur upload" });
    } finally { setUploading(false); fileRef.current.value = ""; }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      await client.post("/import/run");
      pollRef.current = setInterval(fetchStatus, 500);
    } catch(err) {
      setImporting(false);
      setUploadInfo({ error: err.response?.data?.detail || "Erreur import" });
    }
  };

  if (!status) return null;
  const canImport = status.uploaded && !status.running && !status.done;

  const Msg = ({ color, bg, icon: Icon, children }) => (
    <div style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12, color, background:bg, border:`1px solid ${color}33`, borderRadius:8, padding:"8px 12px" }}>
      <Icon size={14} style={{ flexShrink:0, marginTop:1 }}/>{children}
    </div>
  );

  const Btn = ({ onClick, disabled, children, primary }) => (
    <button onClick={onClick} disabled={disabled} style={{
      display:"flex", alignItems:"center", gap:6, padding:"8px 14px", borderRadius:8, fontSize:13, cursor: disabled?"not-allowed":"pointer",
      background: primary && !disabled ? "#3b82f6" : "var(--surface2)",
      color: primary && !disabled ? "white" : "var(--text2)",
      border:`1px solid ${primary && !disabled ? "#3b82f6" : "var(--border)"}`,
      opacity: disabled ? 0.5 : 1, transition:"all 0.15s",
    }}>
      {children}
    </button>
  );

  return (
    <div className="card" style={{ padding:16, display:"flex", flexDirection:"column", gap:12 }}>
      <div style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em", display:"flex", alignItems:"center", gap:6 }}>
        <Database size={13}/> Import base de données v1
      </div>

      {status.already_imported && !status.done && (
        <Msg color="#f59e0b" bg="rgba(245,158,11,0.08)" icon={AlertCircle}>
          Des données existent déjà en base. L'import est idempotent (pas de doublons).
        </Msg>
      )}
      {status.done && status.stats && (
        <Msg color="#22c55e" bg="rgba(34,197,94,0.08)" icon={CheckCircle}>
          Import terminé — {status.stats.filaments} filaments, {status.stats.spools} bobines ({status.stats.skipped} déjà présents)
        </Msg>
      )}
      {status.error && <Msg color="#ef4444" bg="rgba(239,68,68,0.08)" icon={AlertCircle}>{status.error}</Msg>}

      <div>
        <p style={{ fontSize:12, color:"var(--muted)", marginBottom:8 }}>
          Fichier <code style={{ fontFamily:"monospace", color:"var(--text2)" }}>3d_printer_logs.db</code> depuis Spoolnymous
          {status.uploaded && <span style={{ marginLeft:8, color:"#22c55e", fontSize:11 }}>✓ fichier prêt</span>}
        </p>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <Btn onClick={() => fileRef.current.click()} disabled={uploading||status.running}>
            {uploading ? <><RefreshCw size={13} style={{animation:"spin 1s linear infinite"}}/> Upload…</> : <><Upload size={13}/> {status.uploaded?"Remplacer":"Choisir"}</>}
          </Btn>
          <input ref={fileRef} type="file" accept=".db" onChange={handleUpload} style={{ display:"none" }}/>
          <Btn onClick={handleImport} disabled={!canImport||importing} primary>
            {status.running||importing ? <><RefreshCw size={13} style={{animation:"spin 1s linear infinite"}}/> En cours…</>
              : status.done ? (
                <>
                  <CheckCircle size={13}/> Réimporter
                  {status.stats && (
                    <span style={{ fontSize:10, marginLeft:6, opacity:0.8 }}>
                      ({status.stats.prints||0} prints, {status.stats.filament_usage||0} usages)
                    </span>
                  )}
                </>
              )
              : <><Play size={13}/> Lancer l'import</>}
          </Btn>
        </div>
      </div>

      {uploadInfo && !uploadInfo.error && (
        <p style={{ fontSize:11, color:"var(--muted)" }}>
          📦 {uploadInfo.filaments} filaments · {uploadInfo.spools} bobines
          {uploadInfo.prints != null && ` · ${uploadInfo.prints} prints`} · {uploadInfo.size_kb} Ko
        </p>
      )}
      {uploadInfo?.error && <p style={{ fontSize:12, color:"#ef4444" }}>{uploadInfo.error}</p>}
    </div>
  );
}

// ── Import ZIP fichiers Spoolnymous ─────────────────────────────────────────
const ZIP_TYPES = [
  { id:"prints",            label:"Prints (3MF + vignettes)",      hint:"dossier prints/" },
  { id:"uploads_prints",    label:"Snapshots prints",               hint:"uploads/prints/" },
  { id:"uploads_filaments", label:"Photos filaments",               hint:"uploads/filaments/" },
  { id:"uploads_groups",    label:"Photos groupes",                 hint:"uploads/groups/" },
];

export function ZipImportSection() {
  const [results, setResults] = useState({});
  const [loading, setLoading] = useState({});

  const handleZip = async (type, file) => {
    if (!file) return;
    setLoading(l => ({...l, [type]: true}));
    const form = new FormData();
    form.append("file", file);
    try {
      const { data } = await client.post(`/import-zip/${type}`, form,
        { headers:{"Content-Type":"multipart/form-data"} });
      setResults(r => ({...r, [type]: data.stats}));
    } catch(e) {
      setResults(r => ({...r, [type]: {error: e.response?.data?.detail || e.message}}));
    } finally {
      setLoading(l => ({...l, [type]: false}));
    }
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
      <p style={{ fontSize:11, fontWeight:700, color:"var(--muted)", textTransform:"uppercase",
        letterSpacing:"0.08em", margin:0 }}>Import fichiers Spoolnymous (.zip)</p>
      {ZIP_TYPES.map(({ id, label, hint }) => {
        const res = results[id];
        const busy = loading[id];
        return (
          <label key={id} style={{ display:"flex", alignItems:"center", gap:10,
            padding:"8px 12px", background:"var(--surface2)", borderRadius:8,
            border:"1px solid var(--border)", cursor:"pointer" }}>
            <span style={{ flex:1, fontSize:12, color:"var(--text)" }}>
              {label}
              <span style={{ fontSize:10, color:"var(--muted)", marginLeft:6 }}>{hint}</span>
            </span>
            {busy && <span style={{ fontSize:11, color:"var(--muted)" }}>Import…</span>}
            {res && !res.error && (
              <span style={{ fontSize:10, color:"#22c55e" }}>
                ✓ {Object.entries(res).map(([k,v])=>`${k}:${v}`).join(" · ")}
              </span>
            )}
            {res?.error && <span style={{ fontSize:10, color:"#ef4444" }}>⚠ {res.error}</span>}
            <input type="file" accept=".zip" style={{ display:"none" }}
              onChange={e => { handleZip(id, e.target.files?.[0]); e.target.value=""; }}/>
          </label>
        );
      })}
    </div>
  );
}
