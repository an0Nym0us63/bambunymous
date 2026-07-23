import React, { useState, useEffect } from "react";
import client from "../api/client";

/**
 * Creation d'objets depuis un print ou un groupe de prints.
 *
 * Le serveur plafonnait deja la creation au nombre d'exemplaires declares,
 * mais en silence : on tapait une quantite dans un prompt, et on decouvrait la
 * limite en la heurtant. La feuille interroge donc le quota AVANT, annonce le
 * restant, et borne le champ.
 *
 * Au-dela d'un objet, une question que le quota ne tranche pas : des unites
 * independantes, ou un lot ? Elle est posee explicitement plutot que decidee
 * a la place de l'utilisateur.
 */
export default function ObjectCreateSheet({ parentType, parentId, defaultName,
                                            costFabrication = 0, onDone, onClose }) {
  const [quota, setQuota] = useState(null);
  const [qty, setQty] = useState(1);
  const [mode, setMode] = useState("single");   // single | grouped
  const [name, setName] = useState(defaultName || "");
  const [groupName, setGroupName] = useState(defaultName || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    client.get("/objects/objects/quota", { params:{ parent_type:parentType, parent_id:parentId } })
      .then(r => { setQuota(r.data); setQty(Math.min(1, r.data.remaining)); })
      .catch(e => setErr(e.response?.data?.detail || e.message));
  }, [parentType, parentId]);

  const remaining = quota?.remaining ?? 0;
  const clamp = (v) => Math.max(1, Math.min(remaining, v || 1));

  const submit = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await client.post("/objects/objects", {
        parent_type: parentType, parent_id: parentId,
        name: (name || "Sans nom").trim(),
        qty,
        cost_fabrication: costFabrication,
        group_new: qty > 1 && mode === "grouped",
        group_name: groupName.trim() || null,
      });
      onDone?.(r.data);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
      setBusy(false);
    }
  };

  const inp = { width:"100%", boxSizing:"border-box", padding:"9px 12px", borderRadius:9,
    border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)",
    fontSize:13, outline:"none" };

  return (
    <div onClick={onClose}
      style={{ position:"fixed", inset:0, zIndex:6000, background:"rgba(0,0,0,0.55)",
        display:"flex", alignItems:"flex-end", justifyContent:"center" }}>
      <div onClick={e => e.stopPropagation()} className="sheet-panel"
        style={{ width:"100%", maxWidth:520, borderTopLeftRadius:20, borderTopRightRadius:20,
          padding:"18px 18px max(env(safe-area-inset-bottom,20px),20px)",
          maxHeight:"85dvh", overflowY:"auto" }}>
        <div style={{ width:36, height:4, borderRadius:2, background:"var(--border)",
          margin:"0 auto 14px" }}/>
        <h3 style={{ margin:"0 0 4px", fontSize:16, fontWeight:800, color:"var(--text)" }}>
          Créer des objets
        </h3>

        {quota && (
          <p style={{ margin:"0 0 16px", fontSize:12.5, color:"var(--muted)" }}>
            {quota.used} objet{quota.used>1?"s":""} déjà créé{quota.used>1?"s":""} sur {quota.total}.
            {remaining > 0
              ? <> Il en reste <b style={{ color:"#22c55e" }}>{remaining}</b> à créer.</>
              : <> <b style={{ color:"#ef4444" }}>Aucun restant.</b></>}
          </p>
        )}

        {err && <p style={{ fontSize:12, color:"#ef4444", margin:"0 0 12px" }}>{err}</p>}

        {remaining > 0 && (
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            <div>
              <label style={{ fontSize:11, color:"var(--muted)", display:"block",
                marginBottom:5 }}>Nom de l'objet</label>
              <input style={inp} value={name} onChange={e => setName(e.target.value)}/>
            </div>

            <div>
              <label style={{ fontSize:11, color:"var(--muted)", display:"block",
                marginBottom:5 }}>Combien en créer</label>
              {/* Boutons plutot qu'un champ libre : la borne est visible et on
                  ne peut pas saisir l'impossible. Le champ reste la pour les
                  grandes quantites. */}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <button onClick={() => setQty(q => clamp(q - 1))} disabled={qty <= 1}
                  style={{ width:38, height:38, borderRadius:9, border:"1px solid var(--border)",
                    background:"var(--surface2)", color:"var(--text)", fontSize:18,
                    cursor:"pointer", opacity: qty<=1?0.4:1 }}>−</button>
                <input type="number" min={1} max={remaining} value={qty}
                  onChange={e => setQty(clamp(parseInt(e.target.value, 10)))}
                  style={{ ...inp, textAlign:"center", flex:1,
                    fontFamily:"'JetBrains Mono',ui-monospace,monospace", fontWeight:700 }}/>
                <button onClick={() => setQty(q => clamp(q + 1))} disabled={qty >= remaining}
                  style={{ width:38, height:38, borderRadius:9, border:"1px solid var(--border)",
                    background:"var(--surface2)", color:"var(--text)", fontSize:18,
                    cursor:"pointer", opacity: qty>=remaining?0.4:1 }}>+</button>
                {remaining > 1 && (
                  <button onClick={() => setQty(remaining)}
                    style={{ padding:"0 12px", height:38, borderRadius:9,
                      border:"1px solid var(--border)", background:"none",
                      color:"var(--muted)", fontSize:11.5, fontWeight:600,
                      cursor:"pointer", whiteSpace:"nowrap" }}>Tout</button>
                )}
              </div>
            </div>

            {qty > 1 && (
              <div>
                <label style={{ fontSize:11, color:"var(--muted)", display:"block",
                  marginBottom:6 }}>Comment les enregistrer</label>
                <div style={{ display:"flex", gap:8 }}>
                  {[["single","Objets individuels","Chacun se vend et se suit à part"],
                    ["grouped","Regroupés","Un lot, suivi comme un ensemble"]].map(([m,l,d]) => (
                    <button key={m} onClick={() => setMode(m)}
                      style={{ flex:1, minWidth:0, textAlign:"left", padding:"10px 12px",
                        borderRadius:10, cursor:"pointer",
                        border:"1px solid " + (mode===m ? "#3b82f6" : "var(--border)"),
                        background: mode===m ? "rgba(59,130,246,0.12)" : "transparent" }}>
                      <span style={{ display:"block", fontSize:12.5, fontWeight:700,
                        color: mode===m ? "#60a5fa" : "var(--text)" }}>{l}</span>
                      <span style={{ display:"block", fontSize:10, color:"var(--muted)",
                        marginTop:2, lineHeight:1.3 }}>{d}</span>
                    </button>
                  ))}
                </div>
                {mode === "grouped" && (
                  <input style={{ ...inp, marginTop:8 }} value={groupName}
                    placeholder="Nom du groupe d'objets"
                    onChange={e => setGroupName(e.target.value)}/>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ display:"flex", gap:8, marginTop:18 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:"11px", borderRadius:11, fontSize:13, fontWeight:600,
              border:"1px solid var(--border)", background:"transparent",
              color:"var(--text)", cursor:"pointer" }}>
            {remaining > 0 ? "Annuler" : "Fermer"}
          </button>
          {remaining > 0 && (
            <button onClick={submit} disabled={busy}
              style={{ flex:2, padding:"11px", borderRadius:11, fontSize:13, fontWeight:800,
                border:"none", background:"#22c55e", color:"white", cursor:"pointer",
                opacity: busy?0.6:1 }}>
              {busy ? "Création…" : `Créer ${qty} objet${qty>1?"s":""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
