import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Box, Eye, EyeOff } from "lucide-react";
import { useAuth } from "../store/auth";

export default function Login() {
  const [user, setUser] = useState("admin");
  const [pass, setPass] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try { await login(user, pass); navigate("/"); }
    catch { setError("Identifiants invalides"); }
    finally { setLoading(false); }
  };

  const inp = {
    width:"100%", background:"var(--surface2)", border:"1px solid var(--border)",
    borderRadius:10, padding:"10px 14px", fontSize:14, color:"var(--text)",
    outline:"none", transition:"border-color 0.15s",
  };

  return (
    <div style={{ minHeight:"100dvh", display:"flex", alignItems:"center", justifyContent:"center", background:"var(--bg)", padding:16 }}>
      <div style={{ width:"100%", maxWidth:360 }}>
        {/* Logo */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", marginBottom:32 }}>
          <div style={{ width:56, height:56, borderRadius:16, background:"linear-gradient(135deg,#3b82f6,#06b6d4)", display:"flex", alignItems:"center", justifyContent:"center", marginBottom:16, boxShadow:"0 8px 32px rgba(59,130,246,0.3)" }}>
            <Box size={26} color="white"/>
          </div>
          <h1 style={{ fontSize:22, fontWeight:700, color:"var(--text)" }}>BambuNymous</h1>
          <p style={{ fontSize:13, color:"var(--muted)", marginTop:4 }}>Gestionnaire de bobines</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="card" style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <div>
            <label style={{ display:"block", fontSize:11, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>Utilisateur</label>
            <input value={user} onChange={e=>setUser(e.target.value)} style={inp}
              onFocus={e=>e.target.style.borderColor="#3b82f6"}
              onBlur={e=>e.target.style.borderColor="var(--border)"}/>
          </div>
          <div>
            <label style={{ display:"block", fontSize:11, color:"var(--muted)", marginBottom:6, textTransform:"uppercase", letterSpacing:"0.05em" }}>Mot de passe</label>
            <div style={{ position:"relative" }}>
              <input type={show?"text":"password"} value={pass} onChange={e=>setPass(e.target.value)}
                style={{ ...inp, paddingRight:42 }}
                onFocus={e=>e.target.style.borderColor="#3b82f6"}
                onBlur={e=>e.target.style.borderColor="var(--border)"}/>
              <button type="button" onClick={()=>setShow(!show)}
                style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"var(--muted)" }}>
                {show ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
          </div>
          {error && <p style={{ fontSize:12, color:"#ef4444" }}>{error}</p>}
          <button type="submit" disabled={loading} style={{
            padding:"11px 0", background:"#3b82f6", color:"white", border:"none", borderRadius:10,
            fontSize:14, fontWeight:600, cursor:"pointer", opacity:loading?0.7:1, marginTop:4,
          }}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </form>
      </div>
    </div>
  );
}
