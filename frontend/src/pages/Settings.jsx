import React, { useState, useEffect } from "react";
import { Save, Wifi, RefreshCw, Sun, Moon } from "lucide-react";
import client from "../api/client";

export default function Settings() {
  const [form, setForm] = useState({
    PRINTER_IP: "", PRINTER_ID: "", PRINTER_ACCESS_CODE: "",
    PRINTER_NAME: "", ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "", COST_BY_HOUR: "0",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // Thème
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    document.documentElement.classList.toggle("light-theme", theme === "light");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    client.get("/settings").then(({ data }) => {
      setForm(f => ({ ...f, ...data, ADMIN_PASSWORD: "" }));
      setLoading(false);
    });
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = { ...form };
    if (!payload.ADMIN_PASSWORD) delete payload.ADMIN_PASSWORD;
    try {
      await client.patch("/settings", payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const Field = ({ label, name, type = "text", placeholder = "" }) => (
    <div>
      <label className="block text-xs text-gray-500 mb-1.5">{label}</label>
      <input
        type={type} value={form[name] || ""}
        placeholder={placeholder}
        onChange={(e) => setForm(f => ({ ...f, [name]: e.target.value }))}
        className="w-full bg-white/[0.04] border border-white/[0.08] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-gray-700"
      />
    </div>
  );

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-gray-600 text-sm">Chargement…</div>
  );

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-lg font-bold">Paramètres</h1>

      <form onSubmit={handleSave} className="space-y-5">

        {/* Apparence */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Apparence</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">Thème</span>
            <div className="flex gap-2 ml-auto">
              <button type="button"
                onClick={() => setTheme("dark")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  theme === "dark"
                    ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                    : "border border-white/[0.08] text-gray-500 hover:text-gray-300"
                }`}>
                <Moon size={14} /> Sombre
              </button>
              <button type="button"
                onClick={() => setTheme("light")}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  theme === "light"
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : "border border-white/[0.08] text-gray-500 hover:text-gray-300"
                }`}>
                <Sun size={14} /> Clair
              </button>
            </div>
          </div>
        </section>

        {/* Imprimante */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Wifi size={13} /> Imprimante
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Adresse IP" name="PRINTER_IP" placeholder="192.168.1.xxx" />
            <Field label="Numéro de série" name="PRINTER_ID" placeholder="31B…" />
            <Field label="Code d'accès" name="PRINTER_ACCESS_CODE" placeholder="••••••••" />
            <Field label="Nom affiché" name="PRINTER_NAME" placeholder="Mon H2C" />
          </div>
        </section>

        {/* Compte */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Compte</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nom d'utilisateur" name="ADMIN_USERNAME" />
            <Field label="Nouveau mot de passe" name="ADMIN_PASSWORD" type="password"
              placeholder="Laisser vide pour ne pas changer" />
          </div>
        </section>

        {/* Coûts */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Électricité</h2>
          <div className="max-w-xs">
            <Field label="Tarif (€/h)" name="COST_BY_HOUR" placeholder="0.20" />
          </div>
        </section>

        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          {saved ? "Sauvegardé ✓" : "Sauvegarder"}
        </button>
      </form>
    </div>
  );
}
