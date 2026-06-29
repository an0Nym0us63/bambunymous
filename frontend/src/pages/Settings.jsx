import React, { useState, useEffect } from "react";
import { Save, Wifi, RefreshCw, Sun, Moon } from "lucide-react";
import client from "../api/client";
import ImportSection from "../components/ImportSection";
import { useTheme } from "../useTheme";

const inp = {
  width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
  borderRadius:10, padding:"8px 12px", fontSize:14, color:"var(--text)",
  outline:"none", transition:"border-color 0.15s",
};

export default function Settings() {
  const { theme, toggle } = useTheme();
  const [form, setForm] = useState({
    PRINTER_IP:"", PRINTER_ID:"", PRINTER_ACCESS_CODE:"",
    PRINTER_NAME:"", ADMIN_USERNAME:"admin",
    ADMIN_PASSWORD:"", COST_BY_HOUR:"0",
  });
  const [accessCodeSet, setAccessCodeSet] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);

  const [version, setVersion] = useState(null);

  useEffect(() => {
    client.get("/version").then(({ data }) => setVersion(data)).catch(() => {});
    client.get("/settings").then(({ data }) => {
      setAccessCodeSet(data.PRINTER_ACCESS_CODE_SET ?? false);
      setForm(f => ({
        ...f,
        PRINTER_IP:     data.PRINTER_IP     ?? "",
        PRINTER_ID:     data.PRINTER_ID     ?? "",
        PRINTER_NAME:   data.PRINTER_NAME   ?? "",
        ADMIN_USERNAME: data.ADMIN_USERNAME ?? "admin",
        COST_BY_HOUR:   data.COST_BY_HOUR   ?? "0",
        PRINTER_ACCESS_CODE:"", ADMIN_PASSWORD:"",
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

  const Field = ({ label, name, type="text", placeholder="" }) => (
    <div>
      <label style={{ display:"block", fontSize:11, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>{label}</label>
      <input type={type} value={form[name]||""} placeholder={placeholder}
        onChange={e => setForm(f => ({...f, [name]: e.target.value}))}
        style={inp}
        onFocus={e => e.target.style.borderColor="#3b82f6"}
        onBlur={e => e.target.style.borderColor="var(--border)"}
      />
    </div>
  );

  const Section = ({ title, icon, children }) => (
    <section className="card" style={{ padding:16 }}>
      <div style={{ fontSize:11, fontWeight:600, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:16, display:"flex", alignItems:"center", gap:6 }}>
        {icon}{title}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>{children}</div>
    </section>
  );

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:200, color:"var(--muted)", fontSize:14 }}>Chargement…</div>
  );

  return (
    <div style={{ maxWidth:640, margin:"0 auto", display:"flex", flexDirection:"column", gap:16 }}>
      <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)" }}>Paramètres</h1>

      <form onSubmit={handleSave} style={{ display:"flex", flexDirection:"column", gap:16 }}>

        {/* Thème */}
        <section className="card" style={{ padding:16 }}>
          <div style={{ fontSize:11, fontWeight:600, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:16 }}>Apparence</div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:14, color:"var(--text2)" }}>Thème</span>
            <button type="button" onClick={toggle}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 16px", borderRadius:20, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)", fontSize:13, cursor:"pointer", transition:"all 0.15s" }}>
              {theme === "dark" ? <><Moon size={14}/> Sombre</> : <><Sun size={14}/> Clair</>}
            </button>
          </div>
        </section>

        {/* Imprimante */}
        <section className="card" style={{ padding:16 }}>
          <div style={{ fontSize:11, fontWeight:600, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:16, display:"flex", alignItems:"center", gap:6 }}>
            <Wifi size={13}/> Imprimante
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Field label="Adresse IP" name="PRINTER_IP" placeholder="192.168.1.xxx" />
            <Field label="Numéro de série" name="PRINTER_ID" placeholder="31B…" />
            <div>
              <label style={{ display:"block", fontSize:11, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>Code d&apos;accès</label>
              <input type="password" value={form.PRINTER_ACCESS_CODE}
                placeholder={accessCodeSet ? "Laisser vide pour conserver" : "Code LAN"}
                onChange={e => setForm(f => ({...f, PRINTER_ACCESS_CODE: e.target.value}))}
                style={inp}
                onFocus={e => e.target.style.borderColor="#3b82f6"}
                onBlur={e => e.target.style.borderColor="var(--border)"}
              />
              {accessCodeSet && !form.PRINTER_ACCESS_CODE && (
                <p style={{ fontSize:10, color:"#22c55e", marginTop:4 }}>✓ Code configuré</p>
              )}
            </div>
            <Field label="Nom affiché" name="PRINTER_NAME" placeholder="Mon H2C" />
          </div>
        </section>

        {/* Compte */}
        <section className="card" style={{ padding:16 }}>
          <div style={{ fontSize:11, fontWeight:600, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:16 }}>Compte</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <Field label="Utilisateur" name="ADMIN_USERNAME" />
            <Field label="Mot de passe" name="ADMIN_PASSWORD" type="password" placeholder="Laisser vide pour conserver" />
          </div>
        </section>

        {/* Électricité */}
        <section className="card" style={{ padding:16 }}>
          <div style={{ fontSize:11, fontWeight:600, color:"var(--muted)", textTransform:"uppercase", letterSpacing:"0.08em", marginBottom:16 }}>Électricité</div>
          <div style={{ maxWidth:200 }}>
            <Field label="Tarif (€/h)" name="COST_BY_HOUR" placeholder="0.20" />
          </div>
        </section>

        <ImportSection />

        <button type="submit" disabled={saving}
          style={{ display:"inline-flex", alignItems:"center", gap:8, background:"#3b82f6", color:"white", border:"none", padding:"10px 20px", borderRadius:12, fontSize:14, fontWeight:500, cursor:"pointer", opacity: saving ? 0.6 : 1, transition:"opacity 0.15s, background 0.15s" }}
          onMouseEnter={e => { if(!saving) e.currentTarget.style.background="#2563eb"; }}
          onMouseLeave={e => e.currentTarget.style.background="#3b82f6"}>
          {saving ? <RefreshCw size={15} style={{ animation:"spin 1s linear infinite" }} /> : <Save size={15} />}
          {saved ? "Sauvegardé ✓" : "Sauvegarder"}
        </button>
      </form>

      {/* Zone dangereuse */}
      <div style={{ marginTop:24, padding:16, borderRadius:12,
        border:"1px solid rgba(239,68,68,0.3)", background:"rgba(239,68,68,0.04)" }}>
        <p style={{ fontSize:12, fontWeight:700, color:"#ef4444", margin:"0 0 8px",
          textTransform:"uppercase", letterSpacing:"0.06em" }}>⚠ Zone dangereuse</p>
        <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 12px" }}>
          Supprime toutes les données : filaments, bobines, historique, snapshots, fichiers 3MF.
          Les paramètres (IP, token…) sont conservés.
        </p>
        {!resetConfirm ? (
          <button onClick={()=>setResetConfirm(true)}
            style={{ padding:"8px 16px", background:"none", border:"1px solid #ef4444",
              borderRadius:8, color:"#ef4444", fontSize:13, fontWeight:600, cursor:"pointer" }}>
            Vider toutes les données
          </button>
        ) : (
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
            <span style={{ fontSize:13, color:"#ef4444", fontWeight:600 }}>Confirmer la suppression ?</span>
            <button onClick={async()=>{
              setResetting(true);
              try {
                await client.delete("/settings/reset-all");
                setResetConfirm(false);
                alert("✅ Toutes les données ont été supprimées.");
                window.location.reload();
              } catch(e) {
                alert("Erreur: " + (e.response?.data?.detail || e.message));
              } finally { setResetting(false); }
            }} disabled={resetting}
              style={{ padding:"8px 16px", background:"#ef4444", border:"none",
                borderRadius:8, color:"white", fontSize:13, fontWeight:700,
                cursor:resetting?"not-allowed":"pointer", opacity:resetting?0.6:1 }}>
              {resetting ? "Suppression…" : "Oui, tout supprimer"}
            </button>
            <button onClick={()=>setResetConfirm(false)}
              style={{ padding:"8px 14px", background:"none", border:"1px solid var(--border)",
                borderRadius:8, color:"var(--muted)", fontSize:13, cursor:"pointer" }}>
              Annuler
            </button>
          </div>
        )}
      </div>

      {version && (
        <p style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace", textAlign:"center", marginTop:8 }}>
          v{version.commit?.slice(0,8) || "dev"} · {version.build_date?.slice(0,10) || "?"}
        </p>
      )}
    </div>
  );
}
