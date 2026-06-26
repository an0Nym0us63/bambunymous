import React, { useState, useEffect, useCallback } from "react";
import { Plus, Search, Package, Archive, ChevronRight, X, Save, RefreshCw } from "lucide-react";
import client from "../api/client";
import clsx from "clsx";

const MATERIALS = ["PLA", "PETG", "ABS", "ASA", "PA", "PC", "TPU", "PVA", "BVOH", "PLA-CF", "PETG-CF", "PA-CF", "PPS"];

function ColorDot({ color, size = 16 }) {
  return (
    <div className="rounded-md ring-1 ring-white/10 shrink-0"
      style={{ width: size, height: size, backgroundColor: color ? `#${color}` : "#374151" }} />
  );
}

function SpoolBar({ remaining, total = 1000 }) {
  if (remaining == null) return null;
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  const color = pct > 30 ? "#3b82f6" : pct > 15 ? "#f59e0b" : "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[10px] mono text-gray-600 shrink-0">{Math.round(remaining)}g</span>
    </div>
  );
}

// Modal ajout bobine
function AddSpoolModal({ filaments, onSave, onClose }) {
  const [form, setForm] = useState({
    filament_id: "", remaining_weight_g: "", price_override: "",
    location: "", tag_number: "", comment: ""
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.filament_id) return;
    setSaving(true);
    try {
      await client.post("/filaments/spools", {
        filament_id: parseInt(form.filament_id),
        remaining_weight_g: form.remaining_weight_g ? parseFloat(form.remaining_weight_g) : null,
        price_override: form.price_override ? parseFloat(form.price_override) : null,
        location: form.location || null,
        tag_number: form.tag_number || null,
        comment: form.comment || null,
      });
      onSave();
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, name, type = "text", placeholder }) => (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {name === "filament_id" ? (
        <select value={form[name]}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50">
          <option value="">— Choisir un filament —</option>
          {filaments.map(f => (
            <option key={f.id} value={f.id}>
              {f.manufacturer} — {f.name} ({f.material})
            </option>
          ))}
        </select>
      ) : (
        <input type={type} value={form[name] || ""}
          placeholder={placeholder}
          onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50" />
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="card w-full max-w-md p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Nouvelle bobine</h2>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300"><X size={18} /></button>
        </div>
        <Field label="Filament *" name="filament_id" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reste (g)" name="remaining_weight_g" type="number" placeholder="1000" />
          <Field label="Prix (€)" name="price_override" type="number" placeholder="" />
        </div>
        <Field label="Emplacement" name="location" placeholder="AMS 1, Tiroir..." />
        <Field label="Tag NFC" name="tag_number" placeholder="UUID" />
        <Field label="Commentaire" name="comment" placeholder="" />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-300">Annuler</button>
          <button onClick={handleSave} disabled={saving || !form.filament_id}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm">
            {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
}

// Vue Bobines
function SpoolsView({ filaments, showArchived }) {
  const [spools, setSpools] = useState([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/filaments/spools", {
        params: { archived: showArchived, q: q || undefined }
      });
      setSpools(data);
    } finally {
      setLoading(false);
    }
  }, [showArchived, q]);

  useEffect(() => { load(); }, [load]);

  const archive = async (id) => {
    await client.delete(`/filaments/spools/${id}`);
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher…"
            className="w-full bg-white/[0.03] border border-white/[0.07] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500/50" />
        </div>
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm shrink-0">
          <Plus size={15} /> Bobine
        </button>
      </div>

      {loading ? (
        <div className="text-center text-gray-600 py-8 text-sm">Chargement…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {spools.map(s => (
            <div key={s.id} className="card-sm p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <ColorDot color={s.filament_color} size={18} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{s.filament_name}</p>
                  <p className="text-xs text-gray-500">{s.filament_material}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {s.location && (
                    <span className="text-[10px] bg-white/[0.05] px-1.5 py-0.5 rounded text-gray-500">{s.location}</span>
                  )}
                  {!showArchived && (
                    <button onClick={() => archive(s.id)}
                      className="text-gray-700 hover:text-red-400 transition-colors">
                      <Archive size={13} />
                    </button>
                  )}
                </div>
              </div>
              <SpoolBar remaining={s.remaining_weight_g} />
              {s.comment && <p className="text-[10px] text-gray-600 truncate">{s.comment}</p>}
            </div>
          ))}
          {!spools.length && (
            <p className="col-span-2 text-center text-gray-600 py-8 text-sm">Aucune bobine</p>
          )}
        </div>
      )}

      {showAdd && (
        <AddSpoolModal
          filaments={filaments}
          onSave={() => { setShowAdd(false); load(); }}
          onClose={() => setShowAdd(false)}
        />
      )}
    </div>
  );
}

// Vue Filaments
function FilamentsView() {
  const [filaments, setFilaments] = useState([]);
  const [q, setQ] = useState("");
  const [material, setMaterial] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await client.get("/filaments/filaments", {
        params: { q: q || undefined, material: material || undefined }
      });
      setFilaments(data);
    } finally {
      setLoading(false);
    }
  }, [q, material]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Nom, fabricant…"
            className="w-full bg-white/[0.03] border border-white/[0.07] rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-blue-500/50" />
        </div>
        <select value={material} onChange={e => setMaterial(e.target.value)}
          className="bg-white/[0.03] border border-white/[0.07] rounded-lg px-3 py-2 text-sm focus:outline-none">
          <option value="">Tous matériaux</option>
          {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="text-center text-gray-600 py-8 text-sm">Chargement…</div>
      ) : (
        <div className="space-y-1">
          {filaments.map(f => (
            <div key={f.id} className="card-sm px-3 py-2.5 flex items-center gap-3">
              <ColorDot color={f.color} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{f.name}</p>
                <p className="text-xs text-gray-500">{f.manufacturer} · {f.material}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={clsx(
                  "text-[10px] px-1.5 py-0.5 rounded font-medium",
                  f.active_spool_count > 0
                    ? "bg-green-500/15 text-green-400"
                    : "bg-white/[0.05] text-gray-600"
                )}>
                  {f.active_spool_count} bobine{f.active_spool_count !== 1 ? "s" : ""}
                </span>
                {f.price && <span className="text-[10px] text-gray-600 mono">{f.price}€</span>}
              </div>
            </div>
          ))}
          {!filaments.length && (
            <p className="text-center text-gray-600 py-8 text-sm">Aucun filament</p>
          )}
        </div>
      )}
    </div>
  );
}

// Page principale
export default function Filaments() {
  const [tab, setTab] = useState("spools");
  const [showArchived, setShowArchived] = useState(false);
  const [filaments, setFilaments] = useState([]);

  useEffect(() => {
    client.get("/filaments/filaments").then(({ data }) => setFilaments(data));
  }, []);

  const tabs = [
    { id: "spools",   label: "Bobines actives" },
    { id: "archived", label: "Archivées" },
    { id: "catalog",  label: "Catalogue" },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-lg font-bold">Filaments</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-white/[0.03] rounded-xl p-1 border border-white/[0.06]">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={clsx("flex-1 py-2 rounded-lg text-xs font-medium transition-all",
              tab === t.id
                ? "bg-blue-600 text-white"
                : "text-gray-500 hover:text-gray-300"
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "catalog" ? (
        <FilamentsView />
      ) : (
        <SpoolsView filaments={filaments} showArchived={tab === "archived"} />
      )}
    </div>
  );
}
