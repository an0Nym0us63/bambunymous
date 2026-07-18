import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../store/auth";

export default function Login() {
  const [user, setUser]     = useState("");
  const [pass, setPass]     = useState("");
  const [show, setShow]     = useState(false);
  const [error, setError]   = useState("");
  const [loading, setLoading] = useState(false);
  const { login }   = useAuth();
  const navigate    = useNavigate();

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
    outline:"none", transition:"border-color 0.15s", boxSizing:"border-box",
  };

  return (
    <div style={{ minHeight:"100%", display:"flex", alignItems:"center",
      justifyContent:"center", background:"var(--bg)", padding:16 }}>
      <div style={{ width:"100%", maxWidth:360, display:"flex", flexDirection:"column", gap:0 }}>

        {/* Logo + nom */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, marginBottom:32 }}>
          <img src="/icon-192.png" alt="BambuNymous" style={{ width:80, height:80, borderRadius:18 }}/>
          <div style={{ textAlign:"center" }}>
            <h1 style={{ fontSize:26, fontWeight:800, color:"var(--text)",
              letterSpacing:"-0.02em", margin:0 }}>BambuNymous</h1>
            <p style={{ fontSize:12, color:"var(--muted)", margin:"4px 0 0",
              textTransform:"uppercase", letterSpacing:"0.08em" }}>3D Print Manager</p>
          </div>
        </div>

        {/* Formulaire */}
        <div className="card" style={{ padding:24, display:"flex", flexDirection:"column", gap:14 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <label style={{ fontSize:12, color:"var(--muted)", fontWeight:600 }}>Utilisateur</label>
            <input value={user} onChange={e=>setUser(e.target.value)}
              style={inp} autoComplete="username"/>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <label style={{ fontSize:12, color:"var(--muted)", fontWeight:600 }}>Mot de passe</label>
            <div style={{ position:"relative" }}>
              <input type={show?"text":"password"} value={pass}
                onChange={e=>setPass(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&handleSubmit(e)}
                style={{...inp, paddingRight:44}} autoComplete="current-password"/>
              <button type="button" onClick={()=>setShow(s=>!s)}
                style={{ position:"absolute", right:12, top:"50%", transform:"translateY(-50%)",
                  background:"none", border:"none", cursor:"pointer", color:"var(--muted)", padding:0 }}>
                {show ? <EyeOff size={16}/> : <Eye size={16}/>}
              </button>
            </div>
          </div>
          {error && <p style={{ fontSize:12, color:"#ef4444", margin:0 }}>{error}</p>}
          <button onClick={handleSubmit} disabled={loading}
            style={{ width:"100%", padding:"11px", background:"#3b82f6", border:"none",
              borderRadius:10, color:"white", fontSize:14, fontWeight:700,
              cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1,
              transition:"opacity 0.15s" }}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </div>
      </div>
    </div>
  );
}
