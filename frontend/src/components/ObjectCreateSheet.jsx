import React, { useState, useEffect } from "react";
import { useTrackDetail } from "../utils/track";
import client from "../api/client";
import { useKeyboardInset } from "../utils/keyboard";

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
 *
 * La fenetre a le style des fenetres des tuiles (24/10/2026) : en-tete en
 * degrade, grande icone, cases de chiffres.
 */
const C = "#22C55E";
// les etats qu'un objet peut avoir en naissant (05/11/2026), comme le selecteur de sa fiche ; « vendu » se pose avec
// son prix, depuis la fiche
const STATES = [["available", "🏷️", "À vendre", "#3b82f6"], ["personal", "🏠", "Perso", "#a855f7"],
  ["gifted", "🎁", "Offert", "#f59e0b"], ["unavailable", "⛔", "Indisponible", "#94a3b8"]];

export default function ObjectCreateSheet({ parentType, parentId, defaultName,
                                            costFabrication = 0, onDone, onClose }) {
  useTrackDetail("Objets · Nouvel objet");
  const [quota, setQuota] = useState(null);
  const [qty, setQty] = useState(1);
  const [name, setName] = useState(defaultName || "");
  const [status, setStatus] = useState("personal");
  // son groupe, des la creation (05/11/2026) : aucun, un existant ({id, name}) ou un nouveau ({fresh: nom})
  const [grp, setGrp] = useState(null);
  const [groups, setGroups] = useState([]);
  const [gq, setGq] = useState("");
  useEffect(() => { client.get("/objects/object-groups").then(r => setGroups(r.data || [])).catch(() => {}); }, []);
  const [busy, setBusy] = useState(false);
  const kb = useKeyboardInset();
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
        status,
        group_id: grp?.id || null,
        group_new: !!grp?.fresh,
        group_name: grp?.fresh || null,
      });
      onDone?.(r.data);
      onClose();
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
      setBusy(false);
    }
  };

  const inp = { width:"100%", boxSizing:"border-box", padding:"10px 12px", borderRadius:11,
    border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)",
    fontSize:14, outline:"none" };
  const narrow = typeof window !== "undefined" && window.innerWidth < 560;
  const grad = (a, b) => ({ backgroundImage:`linear-gradient(135deg, ${a}, ${b})`, WebkitBackgroundClip:"text", backgroundClip:"text", color:"transparent" });
  const lbl = { fontSize:11, fontWeight:800, letterSpacing:".06em", textTransform:"uppercase", color:"var(--muted)", display:"block", marginBottom:6 };
  // une case de chiffre, comme les fenetres des tuiles
  const stat = (l, v, a, b) => (
    <div style={{ flex:1, minWidth:0, padding:"9px 10px", borderRadius:12, background:"var(--surface2)", border:"1px solid var(--border)" }}>
      <div style={{ fontSize:10.5, fontWeight:800, color:"var(--muted)", textTransform:"uppercase", letterSpacing:".05em" }}>{l}</div>
      <div style={{ fontSize:20, fontWeight:900, ...grad(a, b) }}>{v}</div>
    </div>);
  const step = (label, on, off) => (
    <button onClick={on} disabled={off}
      style={{ width:44, height:44, borderRadius:12, border:"1px solid var(--border)", background:"var(--surface2)", color:"var(--text)",
        fontSize:20, fontWeight:800, cursor:"pointer", opacity: off ? 0.4 : 1 }}>{label}</button>);

  return (
    <div onClick={onClose}
      style={{ position:"fixed", inset:0, zIndex:6000, background:"rgba(2,6,23,0.55)", backdropFilter:"blur(6px)",
        display:"flex", alignItems: narrow ? "flex-end" : "center", justifyContent:"center", padding: narrow ? 0 : 14 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width:"100%", maxWidth:520, borderRadius: narrow ? "26px 26px 0 0" : 24, background:"var(--sheet-bg)", border:"1px solid var(--border)",
          boxShadow:"0 30px 80px rgba(0,0,0,0.45)", overflow:"hidden", display:"flex", flexDirection:"column",
          marginBottom: kb, transition:"margin-bottom 0.15s ease", maxHeight: kb > 0 ? `calc(92dvh - ${kb}px)` : "88dvh",
          animation: narrow ? "bn-sheet-up .3s cubic-bezier(.2,.8,.2,1)" : "bn-pop .24s cubic-bezier(.2,.8,.2,1)" }}>
        {/* l'en-tete : degrade vert, deux halos, grande icone */}
        <div style={{ position:"relative", padding: narrow ? "10px 16px 14px" : "16px 18px", overflow:"hidden", flexShrink:0,
          background:`linear-gradient(135deg, ${C}38, ${C}10 55%, transparent)` }}>
          <span aria-hidden="true" style={{ position:"absolute", right:-50, top:-70, width:180, height:180, borderRadius:"50%", background:`${C}30` }}/>
          <span aria-hidden="true" style={{ position:"absolute", right:90, top:-30, width:70, height:70, borderRadius:"50%", background:`${C}1c` }}/>
          {narrow && <div style={{ width:42, height:4, borderRadius:4, background:"var(--border)", margin:"0 auto 10px" }}/>}
          <div style={{ display:"flex", alignItems:"center", gap:12, position:"relative" }}>
            <span style={{ width:44, height:44, borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, fontSize:22,
              background:`linear-gradient(135deg, ${C}, ${C}bb)`, boxShadow:`0 8px 20px ${C}55` }}>📦</span>
            <span style={{ flex:1, minWidth:0 }}>
              <span style={{ display:"block", fontSize:19, fontWeight:900, color:"var(--text)" }}>Créer des objets</span>
              <span style={{ display:"block", fontSize:12, fontWeight:700, color:"var(--muted)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {defaultName || "Sans nom"}</span>
            </span>
            <button onClick={onClose} aria-label="Fermer" style={{ width:36, height:36, borderRadius:12, border:"1px solid var(--border)", background:"var(--surface)",
              color:"var(--text2)", cursor:"pointer", fontSize:15 }}>✕</button>
          </div>
        </div>

        <div style={{ flex:1, minHeight:0, overflowY:"auto", padding: narrow ? "14px 16px 6px" : "16px 18px 6px", display:"flex", flexDirection:"column", gap:16 }}>
          {quota && <div style={{ display:"flex", gap:8 }}>
            {stat("Déjà créés", quota.used, "#64748B", "#94A3B8")}
            {stat("Prévus", quota.total, "#3B82F6", "#60A5FA")}
            {stat("Restants", remaining, remaining > 0 ? "#16A34A" : "#DC2626", remaining > 0 ? "#4ADE80" : "#F87171")}
          </div>}
          {err && <p style={{ fontSize:12.5, color:"#ef4444", margin:0, fontWeight:700 }}>{err}</p>}
          {quota && remaining <= 0 && <p style={{ margin:0, fontSize:13, color:"var(--muted)" }}>Tous les objets prévus sont déjà créés.</p>}

          {remaining > 0 && <>
            <div>
              <label style={lbl}>Nom de l'objet</label>
              <input style={inp} value={name} onChange={e => setName(e.target.value)}/>
            </div>

            <div>
              <label style={lbl}>Combien en créer</label>
              {/* Boutons plutot qu'un champ libre : la borne est visible et on
                  ne peut pas saisir l'impossible. Le champ reste la pour les
                  grandes quantites. */}
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                {step("−", () => setQty(q => clamp(q - 1)), qty <= 1)}
                <input type="number" min={1} max={remaining} value={qty}
                  onChange={e => setQty(clamp(parseInt(e.target.value, 10)))}
                  style={{ ...inp, textAlign:"center", flex:1, height:44, fontSize:20, fontWeight:900, color:"#16a34a" }}/>
                {step("+", () => setQty(q => clamp(q + 1)), qty >= remaining)}
                {remaining > 1 && (
                  <button onClick={() => setQty(remaining)}
                    style={{ padding:"0 14px", height:44, borderRadius:12, border:`1px solid ${C}55`, background:`${C}14`, color:"#16a34a",
                      fontSize:12.5, fontWeight:800, cursor:"pointer", whiteSpace:"nowrap" }}>Tout ({remaining})</button>
                )}
              </div>
            </div>

            <div>
              <label style={lbl}>État</label>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                {STATES.map(([k, ic, l, c]) => {
                  const on = status === k;
                  return <button key={k} type="button" onClick={() => setStatus(k)}
                    style={{ padding:"10px 8px", borderRadius:13, cursor:"pointer", font:"inherit", fontSize:13.5, fontWeight:800,
                      border: on ? "none" : "1px solid var(--border)", color: on ? "#fff" : "var(--text)",
                      background: on ? `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 65%, #fff))` : "var(--surface2)",
                      boxShadow: on ? `0 8px 18px -10px ${c}` : "none" }}>{ic} {l}</button>;
                })}
              </div>
            </div>

            <div>
              <label style={lbl}>Groupe</label>
              {(() => {
                const needle = gq.trim().toLowerCase();
                const shown = (needle ? groups.filter(g => (g.name || "").toLowerCase().includes(needle)) : groups).slice(0, 14);
                const exact = needle && groups.some(g => (g.name || "").trim().toLowerCase() === needle);
                const chip = (key, label, on, onClick, tone = "#8B5CF6") => (
                  <button key={key} type="button" onClick={onClick}
                    style={{ padding:"7px 12px", borderRadius:20, cursor:"pointer", font:"inherit", fontSize:12.5, fontWeight:800, maxWidth:"100%",
                      overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
                      border:`1px solid ${on ? tone : "var(--border)"}`, color: on ? tone : "var(--text2)",
                      background: on ? `color-mix(in srgb, ${tone} 14%, var(--surface2))` : "var(--surface2)" }}>{label}</button>);
                return <>
                  <input style={inp} value={gq} placeholder="Chercher un groupe, ou taper un nom pour en créer un"
                    onChange={e => setGq(e.target.value)}/>
                  <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:8 }}>
                    {chip("none", "Aucun groupe", !grp, () => setGrp(null), "#64748B")}
                    {shown.map(g => chip(g.id, `📁 ${g.name}`, grp?.id === g.id, () => setGrp({ id: g.id, name: g.name })))}
                    {needle && !exact && chip("new", `＋ Créer « ${gq.trim()} »`, grp?.fresh === gq.trim(), () => setGrp({ fresh: gq.trim() }), "#16A34A")}
                    {!needle && defaultName && !groups.some(g => (g.name || "").trim().toLowerCase() === defaultName.trim().toLowerCase()) &&
                      chip("newd", `＋ Créer « ${defaultName} »`, grp?.fresh === defaultName, () => setGrp({ fresh: defaultName }), "#16A34A")}
                  </div>
                  <p style={{ margin:"6px 0 0", fontSize:11.5, fontWeight:600, color:"var(--muted)" }}>
                    {grp?.fresh ? `Un nouveau groupe « ${grp.fresh} » sera créé, ${qty > 1 ? `avec les ${qty} objets` : "avec cet objet"}.`
                      : grp ? `${qty > 1 ? `Les ${qty} objets iront` : "L'objet ira"} dans « ${grp.name} ».`
                      : "Le groupe range l'objet (une collection, un client, un lot…) ; il se change ensuite depuis sa fiche."}</p>
                </>;
              })()}
            </div>
          </>}
        </div>

        <div style={{ display:"flex", gap:8, padding: narrow ? "12px 16px max(env(safe-area-inset-bottom,14px),14px)" : "14px 18px 18px", flexShrink:0 }}>
          <button onClick={onClose}
            style={{ flex:1, padding:"12px", borderRadius:12, fontSize:13.5, fontWeight:700, border:"1px solid var(--border)",
              background:"var(--surface2)", color:"var(--text)", cursor:"pointer" }}>
            {remaining > 0 ? "Annuler" : "Fermer"}
          </button>
          {remaining > 0 && (
            <button onClick={submit} disabled={busy}
              style={{ flex:2, padding:"12px", borderRadius:12, fontSize:13.5, fontWeight:900, border:"none",
                background:`linear-gradient(135deg, #16a34a, ${C})`, color:"white", cursor:"pointer", boxShadow:`0 8px 20px ${C}44`,
                opacity: busy?0.6:1 }}>
              {busy ? "Création…" : `Créer ${qty} objet${qty>1?"s":""}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
