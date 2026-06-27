import React, { useState, useEffect } from "react";
import { Save, Wifi, RefreshCw } from "lucide-react";
import client from "../api/client";
import ImportSection from "../components/ImportSection";

export default function Settings() {
  const [form, setForm] = useState({
    PRINTER_IP: "", PRINTER_ID: "",
    PRINTER_ACCESS_CODE: "",
    PRINTER_NAME: "", ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "", COST_BY_HOUR: "0",
  });
  const [accessCodeSet, setAccessCodeSet] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [saved,  setSaved]    = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    client.get("/settings").then(({ data }) => {
      setAccessCodeSet(data.PRINTER_ACCESS_CODE_SET ?? false);
      setForm(f => ({
        ...f,
        PRINTER_IP:     data.PRINTER_IP     ?? "",
        PRINTER_ID:     data.PRINTER_ID     ?? "",
        PRINTER_NAME:   data.PRINTER_NAME   ?? "",
        ADMIN_USERNAME: data.ADMIN_USERNAME ?? "admin",
        COST_BY_HOUR:   data.COST_BY_HOUR   ?? "0",
        PRINTER_ACCESS_CODE: "",
        ADMIN_PASSWORD: "",
      }));
      setLoading(false);
    });
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {};
    Object.entries(form).forEach(([k, v]) => {
      if (v !== "" && k !== "ADMIN_PASSWORD") payload[k] = v;
    });
    if (form.ADMIN_PASSWORD) payload.ADMIN_PASSWORD = form.ADMIN_PASSWORD;
    try {
      await client.patch("/settings", payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch(err) {
      alert("Erreur: " + (err.response?.data?.detail || err.message));
    } finally { setSaving(false); }
  };

  const Field = ({ label, name, type = "text", placeholder = "" }) => (
    <div>
      <label className="block text-xs text-gray-500 mb-1.5">{label}</label>
      <input
        type={type} value={form[name] || ""} placeholder={placeholder}
        onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500/60 transition-colors placeholder:text-gray-600"
      />
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Chargement…</div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-lg font-bold">Paramètres</h1>
      <form onSubmit={handleSave} className="space-y-5">

        {/* Imprimante */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Wifi size={13}/> Imprimante
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Adresse IP"      name="PRINTER_IP"   placeholder="192.168.1.xxx" />
            <Field label="Numéro de série" name="PRINTER_ID"   placeholder="31B…" />
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Code d&apos;accès</label>
              <input
                type="password" value={form.PRINTER_ACCESS_CODE}
                placeholder={accessCodeSet ? "Laisser vide pour conserver" : "Code d'accès LAN"}
                onChange={e => setForm(f => ({ ...f, PRINTER_ACCESS_CODE: e.target.value }))}
                className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500/60 transition-colors placeholder:text-gray-600"
              />
              {accessCodeSet && !form.PRINTER_ACCESS_CODE && (
                <p className="text-[10px] text-green-500 mt-1">✓ Code configuré</p>
              )}
            </div>
            <Field label="Nom affiché" name="PRINTER_NAME" placeholder="Mon H2C" />
          </div>
        </section>

        {/* Compte */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Compte</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nom d'utilisateur" name="ADMIN_USERNAME" />
            <Field label="Nouveau mot de passe" name="ADMIN_PASSWORD" type="password"
              placeholder="Laisser vide pour conserver" />
          </div>
        </section>

        {/* Électricité */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Électricité</h2>
          <div className="max-w-xs">
            <Field label="Tarif (€/h)" name="COST_BY_HOUR" placeholder="0.20" />
          </div>
        </section>

        <ImportSection />

        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors">
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          {saved ? "Sauvegardé ✓" : "Sauvegarder"}
        </button>
      </form>
    </div>
  );
}
