import React, { useEffect, useState } from "react";
import client from "../api/client";

// Parametres MakerWorld : fiches publiques des modeles (cache), compte
// (connexion, deconnexion) et diagnostic. API interne non officielle : tout
// ce qui en depend est facultatif et retombe sur le simple lien.
export default function MakerWorldSettings() {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState(null);
  const [info, setInfo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ account: "", password: "", code: "" });
  const [step, setStep] = useState("login");     // login | code | token
  const [tok, setTok] = useState("");
  const [diag, setDiag] = useState(null);

  const load = () => client.get("/makerworld/status").then(({ data }) => setSt(data)).catch(() => setSt({}));
  useEffect(() => { load(); }, []);

  const run = async (fn) => {
    setErr(null); setInfo(null); setBusy(true);
    try { await fn(); } catch (e) { setErr(e.response?.data?.detail || e.message); }
    setBusy(false);
  };
  const login = () => run(async () => {
    const { data } = await client.post("/makerworld/login",
      step === "code" ? { account: form.account, code: form.code } : { account: form.account, password: form.password });
    setForm(f => ({ ...f, password: "" }));          // jamais garde
    if (data.step === "done") { setStep("login"); setForm({ account: "", password: "", code: "" }); load(); }
    else if (data.step === "code") { setStep("code"); setInfo(data.message); }
    else if (data.step === "tfa") { setStep("token"); setInfo(data.message); }
  });
  const sendToken = () => run(async () => {
    await client.post("/makerworld/token", { token: tok }); setTok(""); setStep("login"); load();
  });
  const logout = () => run(async () => { await client.post("/makerworld/logout"); load(); });
  const refresh = () => run(async () => {
    const { data } = await client.post("/makerworld/refresh");
    setInfo(data.started ? "Relecture lancée en arrière-plan (1,5 s par modèle)." : "Une relecture tourne déjà.");
    setTimeout(load, 3000);
  });
  const debug = (name) => run(async () => { const { data } = await client.get(`/makerworld/debug/${name}`); setDiag({ name, ...data }); });

  const c = st?.cache;
  const inp = { width:"100%", boxSizing:"border-box", padding:"8px 10px", borderRadius:8, fontSize:13,
    background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)", outline:"none" };
  const btn = { padding:"7px 14px", borderRadius:9, fontSize:12, fontWeight:700, cursor:"pointer",
    background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--text)" };
  const primary = { ...btn, background:"#3b82f6", border:"none", color:"white" };
  // Ni Bitwarden ni le navigateur ne doivent remplir ces champs d'eux-memes.
  const noFill = { autoComplete: "off", "data-lpignore": "true", "data-1p-ignore": "true", "data-bwignore": "true" };

  return (
    <div className="card" style={{ padding:"16px 20px" }}>
      <h3 style={{ fontSize:14, fontWeight:700, color:"var(--text)", margin:"0 0 6px" }}>MakerWorld</h3>
      <p style={{ fontSize:12, color:"var(--muted)", margin:"0 0 12px", lineHeight:1.5 }}>
        Fiche du modèle (couverture, créateur, catégories, compteurs) sur chaque print et groupe, et recherche
        par titre, tags et catégories. Ces infos sont lues via une <b>API interne de MakerWorld, non officielle</b> :
        si elle change ou se ferme, l'appli continue de fonctionner normalement et les fiches retombent sur le
        simple lien. Lecture seule : rien n'est jamais publié, aimé ni rangé depuis l'appli.
      </p>

      {/* ── Fiches des modeles ── */}
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:14 }}>
        <span style={{ fontSize:12, color:"var(--text2)", flex:1, minWidth:200 }}>
          {c ? <>{c.ok} fiche{c.ok > 1 ? "s" : ""} sur {c.models} modèle{c.models > 1 ? "s" : ""} imprimé{c.models > 1 ? "s" : ""}
            {c.notfound > 0 && <span style={{ color:"var(--muted)" }}> · {c.notfound} introuvable{c.notfound > 1 ? "s" : ""}</span>}
            {c.error > 0 && <span style={{ color:"#f59e0b" }}> · {c.error} à réessayer</span>}
            {c.running && <span style={{ color:"#3b82f6" }}> · relecture en cours…</span>}</> : "…"}
        </span>
        <button onClick={refresh} disabled={busy} style={btn}>⟳ Relire maintenant</button>
      </div>

      {/* ── Compte ── */}
      <div style={{ padding:12, borderRadius:10, background:"var(--surface2)", border:"1px solid var(--border)" }}>
        <div style={{ fontSize:12, fontWeight:700, color:"var(--text)", marginBottom:8 }}>
          Compte — favoris et j'aime, avec « déjà imprimé » (Historique → bouton 🌐)
        </div>
        {st?.connected ? (
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {st.account?.avatar && <img src={st.account.avatar} alt="" referrerPolicy="no-referrer"
              style={{ width:28, height:28, borderRadius:"50%" }}/>}
            <span style={{ flex:1, fontSize:13, color:"var(--text)" }}>
              {st.account?.name || "Connecté"} {st.account?.handle && <span style={{ color:"var(--muted)" }}>@{st.account.handle}</span>}
            </span>
            <button onClick={logout} disabled={busy} style={btn}>Déconnecter</button>
          </div>
        ) : step === "token" ? (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <p style={{ fontSize:11.5, color:"var(--muted)", margin:0, lineHeight:1.5 }}>
              Sur makerworld.com, connecté : outils du navigateur (F12) → Application → Cookies → copie la valeur
              de <b>token</b>. Il dure environ 3 mois ; il n'est jamais réaffiché ici.
            </p>
            <input value={tok} onChange={e => setTok(e.target.value)} placeholder="Jeton" {...noFill}
              spellCheck={false} style={{ ...inp, fontFamily:"JetBrains Mono,monospace", fontSize:12 }}/>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => { setStep("login"); setInfo(null); }} style={btn}>Retour</button>
              <button onClick={sendToken} disabled={busy || !tok.trim()} style={primary}>{busy ? "…" : "Enregistrer"}</button>
            </div>
          </div>
        ) : (
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            <input value={form.account} onChange={e => setForm(f => ({ ...f, account: e.target.value }))}
              placeholder="E-mail du compte Bambu" disabled={step === "code"} {...noFill} style={inp}/>
            {step === "code" ? (
              <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                placeholder="Code reçu par e-mail" inputMode="numeric" {...noFill} style={inp}/>
            ) : (
              <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Mot de passe (jamais enregistré)" {...noFill} autoComplete="new-password" style={inp}/>
            )}
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <button onClick={login} disabled={busy || !form.account.trim() || !(step === "code" ? form.code.trim() : form.password)}
                style={primary}>{busy ? "…" : step === "code" ? "Valider le code" : "Se connecter"}</button>
              {step === "code" && <button onClick={() => { setStep("login"); setInfo(null); }} style={btn}>Annuler</button>}
              <button onClick={() => { setStep("token"); setInfo(null); }}
                style={{ ...btn, marginLeft:"auto", background:"none", border:"none", color:"var(--muted)", fontWeight:500 }}>
                Coller un jeton plutôt
              </button>
            </div>
          </div>
        )}
        {info && <p style={{ fontSize:12, color:"#3b82f6", margin:"8px 0 0" }}>{info}</p>}
        {err && <p style={{ fontSize:12, color:"#ef4444", margin:"8px 0 0" }}>{err}</p>}
      </div>

      {/* ── Diagnostic : reponse brute, pour adapter la lecture si l'API change ── */}
      {st?.connected && (
        <details style={{ marginTop:12 }}>
          <summary style={{ fontSize:12, color:"var(--muted)", cursor:"pointer" }}>Diagnostic de l'API</summary>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", margin:"8px 0" }}>
            {["profil", "favoris", "favoris_ids", "aimes", "essais_collections"].map(n => (
              <button key={n} onClick={() => debug(n)} disabled={busy} style={{ ...btn, padding:"4px 10px", fontWeight:500 }}>{n}</button>
            ))}
          </div>
          {diag && (
            <button onClick={() => {
                const t = `${diag.path} → HTTP ${diag.http}\n${diag.body ?? "(vide)"}`;
                (navigator.clipboard?.writeText(t) || Promise.reject()).then(
                  () => setInfo("Copié."), () => setInfo("Copie impossible : sélectionne le texte à la main."));
              }}
              style={{ ...btn, padding:"4px 10px", fontWeight:500, marginBottom:6 }}>📋 Copier</button>
          )}
          {diag && (
            <pre style={{ fontSize:10.5, maxHeight:240, overflow:"auto", padding:8, borderRadius:8,
              background:"var(--surface)", border:"1px solid var(--border)", color:"var(--text2)",
              whiteSpace:"pre-wrap", wordBreak:"break-all", margin:0 }}>
              {`${diag.path} → HTTP ${diag.http}\n${diag.body ?? "(vide)"}`}
            </pre>
          )}
        </details>
      )}
    </div>
  );
}
