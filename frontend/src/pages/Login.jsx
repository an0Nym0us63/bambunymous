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
  // Double authentification : le champ apparait quand le serveur le demande.
  const [needOtp, setNeedOtp] = useState(false);
  const [otp, setOtp]         = useState("");
  const { login }   = useAuth();
  const navigate    = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try { await login(user, pass, needOtp ? otp : undefined); navigate("/"); }
    catch (err) {
      const detail = err.response?.data?.detail;
      if (detail === "2FA_REQUIRED") { setNeedOtp(true); setError(""); }
      else setError(needOtp && detail ? detail : "Identifiants invalides");
    }
    finally { setLoading(false); }
  };

  const inp = {
    width:"100%", background:"var(--surface)", border:"1px solid var(--border)",
    borderRadius:14, padding:"12px 14px", fontSize:15, fontWeight:600, color:"var(--text)",
    outline:"none", transition:"border-color 0.15s", boxSizing:"border-box",
  };

  return (
    <div style={{ minHeight:"100%", display:"flex", alignItems:"center",
      justifyContent:"center", padding:16,
      background:"radial-gradient(60% 45% at 15% 10%, rgba(99,102,241,0.30), transparent 70%), radial-gradient(55% 40% at 90% 90%, rgba(236,72,153,0.22), transparent 70%), var(--bg)" }}>
      <div style={{ width:"100%", maxWidth:360, display:"flex", flexDirection:"column", gap:0 }}>

        {/* Logo + nom */}
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:12, marginBottom:32 }}>
          <img src="/icon-192.png" alt="BambuNymous" style={{ width:84, height:84, borderRadius:24, boxShadow:"0 16px 36px -14px #6366F1" }}/>
          <div style={{ textAlign:"center" }}>
            <h1 style={{ fontSize:30, fontWeight:900, letterSpacing:"-0.02em", margin:0, lineHeight:1.2,
              backgroundImage:"linear-gradient(135deg, #6366F1, #EC4899)", WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" }}>BambuNymous</h1>
            <p style={{ fontSize:12, color:"var(--muted)", margin:"4px 0 0",
              textTransform:"uppercase", letterSpacing:"0.08em" }}>3D Print Manager</p>
          </div>
        </div>

        {/* Formulaire */}
        <div style={{ padding:24, display:"flex", flexDirection:"column", gap:14, borderRadius:24,
          border:"1px solid color-mix(in srgb, #6366F1 26%, var(--border))",
          background:"radial-gradient(90% 60% at 100% 0%, rgba(99,102,241,0.14), transparent 70%), var(--surface2)",
          boxShadow:"0 20px 50px -30px #6366F1" }}>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <label style={{ fontSize:12.5, color:"var(--muted)", fontWeight:800 }}>Utilisateur</label>
            <input value={user} onChange={e=>setUser(e.target.value)}
              style={inp} autoComplete="username"/>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            <label style={{ fontSize:12.5, color:"var(--muted)", fontWeight:800 }}>Mot de passe</label>
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
          {needOtp && (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              <label style={{ fontSize:12, color:"var(--muted)", fontWeight:600 }}>
                Code de vérification
              </label>
              <input value={otp} onChange={e=>setOtp(e.target.value.trim())} autoFocus
                onKeyDown={e=>e.key==="Enter"&&handleSubmit(e)}
                inputMode="text" autoComplete="one-time-code" placeholder="123456"
                style={{ ...inp, fontFamily:"JetBrains Mono, monospace", fontSize:18, letterSpacing:3 }}/>
              <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>
                Code à 6 chiffres de ton application d'authentification, ou un code de secours.
              </p>
            </div>
          )}
          {error && <p style={{ fontSize:13, fontWeight:700, color:"#ef4444", margin:0 }}>⚠ {error}</p>}
          <button onClick={handleSubmit} disabled={loading}
            style={{ width:"100%", padding:"13px", background:"linear-gradient(135deg, #6366F1, #8B5CF6)", border:"none",
              borderRadius:14, color:"white", fontSize:15, fontWeight:800, boxShadow:"0 10px 22px -12px #6366F1",
              cursor:loading?"not-allowed":"pointer", opacity:loading?0.7:1,
              transition:"opacity 0.15s" }}>
            {loading ? "Connexion…" : "Se connecter"}
          </button>
        </div>
      </div>
    </div>
  );
}
