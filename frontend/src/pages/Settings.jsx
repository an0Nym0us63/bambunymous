import React, { useState, useEffect } from "react";
import { Save, Wifi, RefreshCw, Sun, Moon } from "lucide-react";
import client from "../api/client";
import ImportSection, { ZipImportSection } from "../components/ImportSection";
import { useTheme } from "../useTheme";

const inp = {
  width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
  borderRadius:10, padding:"8px 12px", fontSize:14, color:"var(--text)",
  outline:"none", transition:"border-color 0.15s", boxSizing:"border-box",
};
const lbl = {
  display:"block", fontSize:11, color:"var(--muted)", marginBottom:6,
  textTransform:"uppercase", letterSpacing:"0.05em",
};
const sec = {
  display:"grid", gridTemplateColumns:"1fr 1fr", gap:12,
};
const card = { padding:16 };
const cardTitle = {
  fontSize:11, fontWeight:600, color:"var(--muted)", textTransform:"uppercase",
  letterSpacing:"0.08em", marginBottom:16, display:"flex", alignItems:"center", gap:6,
};

export default function Settings() {
  const { theme, toggle } = useTheme();
  const [ip,      setIp]      = useState("");
  const [serial,  setSerial]  = useState("");
  const [code,    setCode]    = useState("");
  const [pname,   setPname]   = useState("");
  const [user,    setUser]    = useState("admin");
  const [pass,    setPass]    = useState("");
  const [cost,    setCost]    = useState("0");
  const [codeSet, setCodeSet] = useState(false);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [loading, setLoading] = useState(true);
  const [resetting,    setResetting]    = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [version, setVersion] = useState(null);

  useEffect(() => {
    client.get("/version").then(({ data }) => setVersion(data)).catch(() => {});
    client.get("/settings").then(({ data }) => {
      setCodeSet(data.PRINTER_ACCESS_CODE_SET ?? false);
      setIp(data.PRINTER_IP     ?? "");
      setSerial(data.PRINTER_ID ?? "");
      setPname(data.PRINTER_NAME ?? "");
      setUser(data.ADMIN_USERNAME ?? "admin");
      setCost(data.COST_BY_HOUR ?? "0");
      setLoading(false);
    });
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {};
    if (ip)     payload.PRINTER_IP     = ip;
    if (serial) payload.PRINTER_ID     = serial;
    if (code)   payload.PRINTER_ACCESS_CODE = code;
    if (pname)  payload.PRINTER_NAME   = pname;
    if (user)   payload.ADMIN_USERNAME = user;
    if (pass)   payload.ADMIN_PASSWORD = pass;
    if (cost)   payload.COST_BY_HOUR   = cost;
    try {
      await client.patch("/settings", payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch(err) {
      alert("Erreur: " + (err.response?.data?.detail || err.message));
    } finally { setSaving(false); }
  };

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
      height:200, color:"var(--muted)", fontSize:14 }}>Chargement…</div>
  );

  const F = (label, value, set, opts={}) => (
    <div>
      <label style={lbl}>{label}</label>
      <input
        type={opts.type||"text"}
        value={value}
        placeholder={opts.placeholder||""}
        onChange={e => set(e.target.value)}
        style={inp}
        onFocus={e => e.target.style.borderColor="#3b82f6"}
        onBlur={e => e.target.style.borderColor="var(--border)"}
      />
      {opts.hint && <p style={{ fontSize:10, color:"#22c55e", marginTop:4 }}>{opts.hint}</p>}
    </div>
  );

  return (
    <div style={{ maxWidth:640, margin:"0 auto", display:"flex", flexDirection:"column", gap:16 }}>
      <h1 style={{ fontSize:18, fontWeight:700, color:"var(--text)" }}>Paramètres</h1>

      <form onSubmit={handleSave} style={{ display:"flex", flexDirection:"column", gap:16 }}>

        {/* Thème */}
        <div className="card" style={card}>
          <div style={cardTitle}>Apparence</div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
            <span style={{ fontSize:14, color:"var(--text2)" }}>Thème</span>
            <button type="button" onClick={toggle}
              style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 16px",
                borderRadius:20, border:"1px solid var(--border)", background:"var(--surface2)",
                color:"var(--text)", fontSize:13, cursor:"pointer" }}>
              {theme === "dark" ? <><Moon size={14}/> Sombre</> : <><Sun size={14}/> Clair</>}
            </button>
          </div>
        </div>

        {/* Imprimante */}
        <div className="card" style={card}>
          <div style={cardTitle}><Wifi size={13}/> Imprimante</div>
          <div style={sec}>
            {F("Adresse IP", ip, setIp, { placeholder:"192.168.1.xxx" })}
            {F("Numéro de série", serial, setSerial, { placeholder:"31B…" })}
            <div>
              <label style={lbl}>Code d&apos;accès</label>
              <input type="password" value={code}
                placeholder={codeSet ? "Laisser vide pour conserver" : "Code LAN"}
                onChange={e => setCode(e.target.value)}
                style={inp}
                onFocus={e => e.target.style.borderColor="#3b82f6"}
                onBlur={e => e.target.style.borderColor="var(--border)"}
              />
              {codeSet && !code && <p style={{ fontSize:10, color:"#22c55e", marginTop:4 }}>✓ Code configuré</p>}
            </div>
            {F("Nom affiché", pname, setPname, { placeholder:"Mon H2C" })}
          </div>
        </div>

        {/* Compte */}
        <div className="card" style={card}>
          <div style={cardTitle}>Compte</div>
          <div style={sec}>
            {F("Utilisateur", user, setUser)}
            {F("Mot de passe", pass, setPass, { type:"password", placeholder:"Laisser vide pour conserver" })}
          </div>
        </div>

        {/* Électricité */}
        <div className="card" style={card}>
          <div style={cardTitle}>Électricité</div>
          <div style={{ maxWidth:200 }}>
            {F("Tarif (€/h)", cost, setCost, { placeholder:"0.20" })}
          </div>
        </div>

        <ImportSection />
        <ZipImportSection />

        <button type="submit" disabled={saving}
          style={{ display:"inline-flex", alignItems:"center", gap:8,
            background:"#3b82f6", color:"white", border:"none",
            padding:"10px 20px", borderRadius:12, fontSize:14, fontWeight:500,
            cursor:saving?"not-allowed":"pointer", opacity:saving?0.6:1 }}
          onMouseEnter={e => { if(!saving) e.currentTarget.style.background="#2563eb"; }}
          onMouseLeave={e => e.currentTarget.style.background="#3b82f6"}>
          {saving ? <RefreshCw size={15} style={{ animation:"spin 1s linear infinite" }} /> : <Save size={15} />}
          {saved ? "Sauvegardé ✓" : "Sauvegarder"}
        </button>
      </form>

      {/* Zone dangereuse */}
      <div style={{ marginTop:8, padding:16, borderRadius:12,
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
            <span style={{ fontSize:13, color:"#ef4444", fontWeight:600 }}>Confirmer ?</span>
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
        <p style={{ fontSize:11, color:"var(--muted)", fontFamily:"monospace",
          textAlign:"center", marginTop:8 }}>
          v{version.commit?.slice(0,8) || "dev"} · {version.build_date?.slice(0,10) || "?"}
        </p>
      )}
    </div>
  );
}
