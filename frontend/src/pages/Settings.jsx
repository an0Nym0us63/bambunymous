import React, { useState, useEffect } from "react";
import { Save, Wifi, RefreshCw, Sun, Moon } from "lucide-react";
import client from "../api/client";
import ImportSection from "../components/ImportSection";

export default function Settings() {
  const [form, setForm] = useState({
    PRINTER_IP: "", PRINTER_ID: "",
    PRINTER_ACCESS_CODE: "",   // vide = ne pas modifier
    PRINTER_NAME: "", ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "", COST_BY_HOUR: "0",
  });
  const [accessCodeSet, setAccessCodeSet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [theme, setTheme]   = useState(() => localStorage.getItem("theme") || "dark");

  useEffect(() => {
    // Appliquer la classe sur <html>
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("theme", theme);
  }, [theme]);

  useEffect(() => {
    client.get("/settings").then(({ data }) => {
      setAccessCodeSet(data.PRINTER_ACCESS_CODE_SET ?? false);
      setForm(f => ({
        ...f,
        PRINTER_IP:   data.PRINTER_IP   ?? "",
        PRINTER_ID:   data.PRINTER_ID   ?? "",
        PRINTER_NAME: data.PRINTER_NAME ?? "",
        ADMIN_USERNAME: data.ADMIN_USERNAME ?? "admin",
        COST_BY_HOUR: data.COST_BY_HOUR ?? "0",
        PRINTER_ACCESS_CODE: "",  // toujours vide au chargement
        ADMIN_PASSWORD: "",
      }));
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
    } finally { setSaving(false); }
  };

  const Field = ({ label, name, type = "text", placeholder = "" }) => (
    <div>
      <label className="block text-xs text-t3 mb-1.5">{label}</label>
      <input type={type} value={form[name] || ""} placeholder={placeholder}
        onChange={e => setForm(f => ({ ...f, [name]: e.target.value }))}
        className="w-full card-sm px-3 py-2 text-sm text-t1 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-t4" />
    </div>
  );

  if (loading) return <div className="flex items-center justify-center h-64 text-t3 text-sm">Chargement…</div>;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <h1 className="text-lg font-bold text-t1">Paramètres</h1>
      <form onSubmit={handleSave} className="space-y-5">

        {/* Thème */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-t3 uppercase tracking-wider mb-4">Apparence</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-t2">Thème</span>
            <div className="flex gap-2 ml-auto">
              {[
                { id: "dark",  Icon: Moon, label: "Sombre",  active: "bg-blue-500/20 text-blue-400 border-blue-500/30"  },
                { id: "light", Icon: Sun,  label: "Clair",   active: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
              ].map(({ id, Icon, label, active }) => (
                <button key={id} type="button" onClick={() => setTheme(id)}
                  className={clsx(
                    "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                    theme === id ? active : "border-theme text-t3 hover:text-t1"
                  )}>
                  <Icon size={13} /> {label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Imprimante */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-t3 uppercase tracking-wider mb-4 flex items-center gap-2">
            <Wifi size={13}/> Imprimante
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Adresse IP"       name="PRINTER_IP"          placeholder="192.168.1.xxx" />
            <Field label="Numéro de série"  name="PRINTER_ID"          placeholder="31B…" />
            <div>
              <label className="block text-xs text-t3 mb-1.5">Code d'accès</label>
              <input
                type="password"
                value={form.PRINTER_ACCESS_CODE}
                placeholder={accessCodeSet ? "Laisser vide pour conserver" : "Code d'accès LAN"}
                onChange={e => setForm(f => ({ ...f, PRINTER_ACCESS_CODE: e.target.value }))}
                className="w-full card-sm px-3 py-2 text-sm text-t1 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-t4"
              />
              {accessCodeSet && !form.PRINTER_ACCESS_CODE && (
                <p className="text-[10px] text-green-500 mt-1">✓ Code configuré</p>
              )}
            </div>
            <Field label="Nom affiché"      name="PRINTER_NAME"        placeholder="Mon H2C" />
          </div>
        </section>

        {/* Compte */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-t3 uppercase tracking-wider mb-4">Compte</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Nom d'utilisateur" name="ADMIN_USERNAME" />
            <Field label="Nouveau mot de passe" name="ADMIN_PASSWORD" type="password"
              placeholder="Laisser vide pour conserver" />
          </div>
        </section>

        {/* Électricité */}
        <section className="card p-4">
          <h2 className="text-xs font-semibold text-t3 uppercase tracking-wider mb-4">Électricité</h2>
          <div className="max-w-xs">
            <Field label="Tarif (€/h)" name="COST_BY_HOUR" placeholder="0.20" />
          </div>
        </section>

        <ImportSection />

        <button type="submit" disabled={saving}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors">
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          {saved ? "Sauvegardé ✓" : "Sauvegarder"}
        </button>
      </form>
    </div>
  );
}

function clsx(...args) {
  return args.filter(Boolean).join(" ");
}
