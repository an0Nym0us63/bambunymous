import React, { useState, useEffect, useRef } from "react";
import { Upload, Play, CheckCircle, AlertCircle, RefreshCw, Database } from "lucide-react";
import client from "../api/client";
import clsx from "clsx";

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
      // Stop polling si terminé
      if (!data.running) {
        clearInterval(pollRef.current);
        setImporting(false);
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    return () => clearInterval(pollRef.current);
  }, []);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadInfo(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const { data } = await client.post("/import/upload", form, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setUploadInfo(data);
      await fetchStatus();
    } catch (err) {
      setUploadInfo({ error: err.response?.data?.detail || "Erreur upload" });
    } finally {
      setUploading(false);
      fileRef.current.value = "";
    }
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      await client.post("/import/run");
      // Polling toutes les 500ms
      pollRef.current = setInterval(fetchStatus, 500);
    } catch (err) {
      setImporting(false);
      setUploadInfo({ error: err.response?.data?.detail || "Erreur import" });
    }
  };

  if (!status) return null;

  const alreadyImported = status.already_imported;
  const canImport = status.uploaded && !status.running && !status.done;

  return (
    <section className="card p-4 space-y-4">
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
        <Database size={13} /> Import base de données v1
      </h2>

      {/* État actuel */}
      {alreadyImported && !status.done && (
        <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
          <AlertCircle size={14} />
          Des données existent déjà en base. L'import est idempotent (pas de doublons).
        </div>
      )}

      {status.done && status.stats && (
        <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
          <CheckCircle size={14} />
          Import terminé — {status.stats.filaments} filaments, {status.stats.spools} bobines, {status.stats.settings} settings importés ({status.stats.skipped} déjà présents)
        </div>
      )}

      {status.error && (
        <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          <AlertCircle size={14} /> {status.error}
        </div>
      )}

      {/* Upload */}
      <div className="space-y-2">
        <p className="text-xs text-gray-500">
          Fichier <span className="mono text-gray-400">3d_printer_logs.db</span> depuis Spoolnymous
          {status.uploaded && <span className="ml-2 text-green-400 text-[10px]">✓ fichier prêt</span>}
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current.click()}
            disabled={uploading || status.running}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm border transition-all",
              "border-white/[0.08] text-gray-400 hover:text-gray-200 hover:border-white/20",
              (uploading || status.running) && "opacity-50 cursor-not-allowed"
            )}>
            {uploading
              ? <><RefreshCw size={14} className="animate-spin" /> Upload…</>
              : <><Upload size={14} /> {status.uploaded ? "Remplacer le fichier" : "Choisir le fichier"}</>
            }
          </button>
          <input ref={fileRef} type="file" accept=".db" onChange={handleUpload} className="hidden" />

          {/* Bouton Import */}
          <button
            onClick={handleImport}
            disabled={!canImport || importing}
            className={clsx(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all",
              canImport && !importing
                ? "bg-blue-600 hover:bg-blue-700 text-white"
                : "bg-white/[0.04] text-gray-600 cursor-not-allowed border border-white/[0.06]"
            )}>
            {status.running || importing
              ? <><RefreshCw size={14} className="animate-spin" /> Import en cours…</>
              : status.done
              ? <><CheckCircle size={14} /> Réimporter</>
              : <><Play size={14} /> Lancer l'import</>
            }
          </button>
        </div>
      </div>

      {/* Info fichier uploadé */}
      {uploadInfo && !uploadInfo.error && (
        <div className="text-xs text-gray-500 bg-white/[0.02] rounded-lg px-3 py-2 space-y-0.5">
          <p>📦 {uploadInfo.filaments} filaments · {uploadInfo.spools} bobines · {uploadInfo.size_kb} Ko</p>
        </div>
      )}
      {uploadInfo?.error && (
        <p className="text-xs text-red-400">{uploadInfo.error}</p>
      )}
    </section>
  );
}
