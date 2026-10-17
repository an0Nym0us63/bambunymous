import React, { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import client from "../api/client";

// Double authentification du compte courant (TOTP : Google Authenticator,
// Aegis, 2FAS, Bitwarden...). Chacun l'active pour SON compte : scanner le QR
// code, confirmer avec un premier code, noter les codes de secours (montres une
// seule fois). La desactivation redemande le mot de passe.
const inp = { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8,
  padding:"8px 12px", fontSize:13, color:"var(--text)", outline:"none", boxSizing:"border-box" };
const btn = (bg, color = "white") => ({ padding:"8px 16px", borderRadius:10, border:"none", background:bg,
  color, fontSize:13, fontWeight:700, cursor:"pointer" });
const err = (e) => e.response?.data?.detail || e.message;

export default function TwoFactorCard() {
  const [st, setSt] = useState(null);       // { enabled, recovery_left } | { unavailable }
  const [setup, setSetup] = useState(null); // { secret, qr }
  const [codes, setCodes] = useState(null); // codes de secours a noter
  const [code, setCode] = useState("");
  const [pwd, setPwd] = useState("");
  const [disabling, setDisabling] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => client.get("/auth/2fa").then(r => setSt(r.data))
    .catch(e => setSt({ unavailable: err(e) }));
  useEffect(() => { load(); }, []);
  const run = async (fn) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg(err(e)); } setBusy(false); };

  if (!st) return null;
  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 4px",
        display:"flex", alignItems:"center", gap:7 }}>
        <ShieldCheck size={15}/> Double authentification
        {st.enabled && <span style={{ fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:20,
          background:"rgba(34,197,94,0.12)", color:"#22c55e" }}>Active</span>}
      </h3>

      {st.unavailable ? (
        <p style={{ fontSize:12, color:"var(--muted)", margin:0 }}>{st.unavailable}</p>
      ) : codes ? (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <p style={{ fontSize:12, color:"var(--text)", margin:0, lineHeight:1.5 }}>
            <b>Note ces codes de secours maintenant</b> : ils ne seront plus affichés. Chacun permet
            une connexion si tu n'as plus ton téléphone, une seule fois.
          </p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2, max-content)", gap:"6px 18px",
            fontFamily:"JetBrains Mono, monospace", fontSize:14, fontWeight:700, color:"var(--text)",
            padding:"10px 14px", borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
            {codes.map(c => <span key={c}>{c}</span>)}
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button onClick={() => { try { navigator.clipboard?.writeText(codes.join("\n")); } catch { /* */ } }}
              style={btn("var(--surface2)", "var(--text)")}>Copier</button>
            <button onClick={() => { setCodes(null); load(); }} style={btn("#3b82f6")}>C'est noté</button>
          </div>
        </div>
      ) : setup ? (
        <div style={{ display:"flex", flexDirection:"column", gap:10, maxWidth:380 }}>
          <p style={{ fontSize:12, color:"var(--muted)", margin:0, lineHeight:1.5 }}>
            1. Scanne ce QR code avec ton application d'authentification
            (Google Authenticator, Aegis, 2FAS, Bitwarden…).
          </p>
          <img src={setup.qr} alt="QR code de double authentification"
            style={{ width:180, height:180, borderRadius:10, background:"white", padding:6, alignSelf:"flex-start" }}/>
          <p style={{ fontSize:11, color:"var(--muted)", margin:0 }}>
            Ou saisis la clé à la main :{" "}
            <span style={{ fontFamily:"JetBrains Mono, monospace", color:"var(--text)", wordBreak:"break-all" }}>
              {setup.secret.replace(/(.{4})/g, "$1 ").trim()}</span>
          </p>
          <p style={{ fontSize:12, color:"var(--muted)", margin:0 }}>2. Saisis le code à 6 chiffres affiché :</p>
          <div style={{ display:"flex", gap:8 }}>
            <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" autoComplete="one-time-code" placeholder="123456"
              style={{ ...inp, width:120, fontFamily:"JetBrains Mono, monospace", fontSize:16, letterSpacing:2 }}/>
            <button disabled={busy || code.length !== 6} style={{ ...btn("#22c55e"), opacity: code.length === 6 ? 1 : 0.5 }}
              onClick={() => run(async () => {
                const { data } = await client.post("/auth/2fa/enable", { code });
                setSetup(null); setCode(""); setCodes(data.recovery_codes);
              })}>Activer</button>
            <button onClick={() => { setSetup(null); setCode(""); }} style={btn("var(--surface2)", "var(--muted)")}>Annuler</button>
          </div>
        </div>
      ) : st.enabled ? (
        disabling ? (
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
            <input type="password" value={pwd} onChange={e => setPwd(e.target.value)} placeholder="Mot de passe"
              autoComplete="current-password" style={{ ...inp, width:200 }}/>
            <button disabled={busy || !pwd} style={btn("#ef4444")}
              onClick={() => run(async () => {
                await client.post("/auth/2fa/disable", { password: pwd });
                setPwd(""); setDisabling(false); load();
              })}>Désactiver</button>
            <button onClick={() => { setDisabling(false); setPwd(""); }} style={btn("var(--surface2)", "var(--muted)")}>Annuler</button>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
            <p style={{ fontSize:12, color:"var(--muted)", margin:0 }}>
              Un code de ton application est demandé à chaque connexion.
              {" "}{st.recovery_left} code{st.recovery_left > 1 ? "s" : ""} de secours restant{st.recovery_left > 1 ? "s" : ""}.
            </p>
            <button onClick={() => setDisabling(true)} style={{ ...btn("rgba(239,68,68,0.12)", "#ef4444"), alignSelf:"flex-start" }}>
              Désactiver…</button>
          </div>
        )
      ) : (
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <p style={{ fontSize:12, color:"var(--muted)", margin:0, lineHeight:1.5 }}>
            En plus du mot de passe, un code à 6 chiffres de ton application d'authentification
            sera demandé à la connexion.
          </p>
          <button disabled={busy} onClick={() => run(async () => setSetup((await client.post("/auth/2fa/setup")).data))}
            style={{ ...btn("#3b82f6"), alignSelf:"flex-start" }}>Activer la double authentification</button>
        </div>
      )}
      {msg && <p style={{ fontSize:12, color:"#ef4444", margin:"10px 0 0" }}>{msg}</p>}
    </div>
  );
}
