import client from "../api/client";
import { egg } from "../eggs";
import { showAlert } from "../utils/dialog";
import { toast } from "../store/toast";

// Les gestes du planning (06/11/2026), partages par le calendrier et « A faire » : ranger, poser sur un jour, figer, d'une
// traite, date limite, priorite, optimiser. pd : le planning (GET /makerworld/plan) ; chaque geste le remplace par celui
// que rend le serveur. setSheet : ouvrir la fiche MakerWorld d'un modele ; setModelSel : la fiche du modele au planning ;
// onDayView : voir la journee d'un plateau.
export function usePlanActs({ pd, setPd, setSheet, setModelSel, onDayView }) {
  // ranger : l'ordre voulu et les jours poses partent au serveur, qui repose tout et rend le planning
  const keys = (pd?.jobs || []).map(j => j.key);
  const byKey = Object.fromEntries((pd?.jobs || []).map(j => [j.key, j]));
  const send = async (url, body, method = "put") => {
    try { const r = await client[method](url, body); setPd(r.data); return r.data || true; }
    catch (e) { showAlert(e.response?.data?.detail || e.message); return false; }
  };
  const arrange = (body, what = "planning_glisse") => send("/makerworld/plan/arrange", body).then(ok => { if (ok) egg(what); });
  const without = k => keys.filter(x => x !== k);
  const moveBefore = (k, ref) => {
    const o = without(k); o.splice(Math.max(0, o.indexOf(ref)), 0, k);
    const a = byKey[k], b = byKey[ref];
    arrange({ order: o, ...(a && b && a.day !== b.day ? { pins: { [k]: b.day } } : {}) });
  };
  const moveAfter = (k, ref) => { const o = without(k); o.splice(o.indexOf(ref) + 1, 0, k); arrange({ order: o }); };
  // poser sur un jour : le travail y va, apres ce qui y est deja
  const moveDay = (k, day) => {
    const o = without(k);
    let at = 0;
    o.forEach((x, i) => { if (byKey[x]?.day <= day) at = i + 1; });
    o.splice(at, 0, k);
    arrange({ order: o, pins: { [k]: day } });
  };
  const unpin = k => arrange({ pins: { [k]: null } });
  // le placer sur un jour (05/11/2026) : le serveur lui cherche la meilleure place de la journee, ou il finit le jour
  // meme ; le reste se decale
  const placeDay = (k, day) => send("/makerworld/plan/place-day", { key: k, day }, "post").then(ok => { if (ok) egg("planning_glisse"); });
  // un objet en tete de file (pour tenir sa date limite)
  const toFront = ks => arrange({ order: [...ks, ...keys.filter(k => !ks.includes(k))] });
  // tout un modele (06/11/2026) : ses plateaux libres (pas figes), dans leur ordre
  const modelKeys = did => (pd?.jobs || []).filter(j => j.design_id === did && !j.locked).map(j => j.key);
  const modelAct = did => {
    const ks = modelKeys(did), j0 = (pd?.jobs || []).find(j => j.design_id === did) || (pd?.blocked || []).find(j => j.design_id === did);
    return {
      // caler sur un jour : en tete de ce jour, a la suite ; ce qui n'y tient pas glisse au lendemain
      dayAll: day => arrange({ order: [...ks, ...keys.filter(k => !ks.includes(k))], pins: Object.fromEntries(ks.map(k => [k, day])) }),
      // en tete : les plateaux au jour fige y restent
      front: () => { const fr = ks.filter(k => !byKey[k]?.pinned); return arrange({ order: [...fr, ...keys.filter(k => !fr.includes(k))] }); },
      unpinAll: () => arrange({ pins: Object.fromEntries(ks.map(k => [k, null])) }),
      // a une place choisie : ses plateaux a la suite, juste apres tel plateau (ou avant le premier du jour), leur jour fige
      slotAll: (day, after) => {
        const o = keys.filter(k => !ks.includes(k));
        const firstOfDay = (pd?.jobs || []).filter(x => x.day === day && !ks.includes(x.key)).sort((a, b) => a.start.localeCompare(b.start))[0];
        const at = after ? o.indexOf(after) + 1 : firstOfDay ? o.indexOf(firstOfDay.key) : o.length;
        o.splice(Math.max(0, at), 0, ...ks);
        return arrange({ order: o, pins: Object.fromEntries(ks.map(k => [k, day])) });
      },
      // automatique : le premier a la meilleure place de la journee, les autres juste apres lui
      autoAll: async day => {
        if (!ks.length) return;
        const r = await send("/makerworld/plan/place-day", { key: ks[0], day }, "post");
        if (!r || ks.length < 2) return;
        const o = (r.jobs || []).map(x => x.key).filter(k => !ks.slice(1).includes(k));
        o.splice(o.indexOf(ks[0]) + 1, 0, ...ks.slice(1));
        return arrange({ order: o, pins: Object.fromEntries(ks.map(k => [k, day])) });
      },
      // figer tout le modele (06/11/2026) : libre, le jour, ou le jour et l'heure (ses plateaux non planifiables a part)
      freeze: async mode => {
        const all = (pd?.jobs || []).filter(j => j.design_id === did), locked = all.filter(j => j.locked).map(j => j.key);
        if (mode === "time") return send("/makerworld/plan/lock", { keys: all.map(j => j.key), lock: true }, "post").then(ok => { if (ok) egg("planning_fige"); });
        if (locked.length && !(await send("/makerworld/plan/lock", { keys: locked, lock: false }, "post"))) return;
        return arrange({ pins: Object.fromEntries(all.map(j => [j.key, mode === "day" ? j.day : null])), why: "Figer" });
      },
      pinAll: () => arrange({ pins: Object.fromEntries((pd?.jobs || []).filter(j => ks.includes(j.key) && !j.pinned && j.day).map(j => [j.key, j.day])) }),
      laterAll: () => j0 && send("/makerworld/plan/later", { key: j0.key, whole: true }, "post").then(ok => { if (ok) egg("planning_glisse"); }),
      chain: mode => send("/makerworld/plan/chain", { design_id: did, mode }, "post").then(ok => { if (ok && mode) egg("planning_traite"); }),
      due: v => setDue(did, v),
      sheet: () => setSheet(j0?.mw_id || did),
      // sa priorite parmi les modeles (06/11/2026) : ses plateaux se replacent aussitot
      prio: lv => send("/makerworld/plan/prio", { target: did, level: lv }, "post").then(ok => { if (ok) egg("planning_priorite"); }),
    };
  };
  // regrouper (06/11/2026) : des plateaux d'un meme modele imprimes ensemble ; degrouper : gid
  const merge = keys => send("/makerworld/plan/merge", { keys }, "post").then(ok => { if (ok) { egg("planning_regroupe"); toast("🧩 Regroupés au planning : à faire ensuite dans Bambu Studio", "ok", 4500); } });
  const unmerge = gid => send("/makerworld/plan/merge", { gid }, "post");
  const applyAdvice = a => a.kind === "merge" ? merge(a.action?.keys || a.keys) : a.kind === "front" ? toFront(a.keys) : a.kind === "after" ? moveAfter(a.key, a.ref) : moveBefore(a.key, a.ref);
  // le champ date se trouvait cache sous la ligne : sur ordinateur, le clic ne l'ouvrait pas (05/11/2026, showPicker) ;
  // et un message dit ce qui a ete pose
  const setDue = (did, due) => send(`/makerworld/plan/deadline/${did}`, { due }).then(d => {
    if (!d) return;
    if (!due) { toast("🎯 Date limite retirée", "info", 3500); return; }
    egg("planning_echeance");
    const x = (d.deadlines || []).find(y => String(y.design_id) === String(did));
    const day = new Date(`${due}T12:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });
    toast(x ? (x.ok ? `🎯 Fini avant le ${day} : ça tient` : `🎯 Avant le ${day} : ça déborde, voir les conseils`) : `🎯 Date limite : avant le ${day}`, x && !x.ok ? "error" : "ok", 5000);
  });
  const markDone = (key, undo = false) => send("/makerworld/plan/done", { key, undo }, "post");
  // la journee couleur : ce qui a ete pose ce jour-la, et ce qui n'y tient pas (05/11/2026 : on ne voyait rien se passer)
  const colorDay = (day, fid) => send("/makerworld/plan/color-day", { day, filament_id: fid }, "post").then(d => {
    if (!d) return;
    egg("planning_couleur");
    const cd = d.color_day || {};
    const name = (d.colors || []).find(c => c.filament_id === fid)?.name || "ce filament";
    const bits = [];
    if (cd.placed - cd.only > 0) bits.push(`${cd.placed - cd.only} avec un filament déjà chargé`);
    if (cd.no_room) bits.push(`${cd.no_room} n'y tien${cd.no_room > 1 ? "nent" : "t"} pas (restent où ils étaient)`);
    if (cd.needs_load) bits.push(`${cd.needs_load} écarté${cd.needs_load > 1 ? "s" : ""} : il${cd.needs_load > 1 ? "s" : ""} demande${cd.needs_load > 1 ? "nt" : ""} un autre filament à charger`);
    toast(`🎨 ${cd.placed || 0} plateau${cd.placed > 1 ? "x" : ""} en ${name} sur ce jour${bits.length ? ` · ${bits.join(" · ")}` : ""}`, "ok", 6000);
  });
  const optimize = day => send("/makerworld/plan/optimize", day ? { day } : {}, "post").then(ok => { if (ok) egg("planning_optimise"); });
  // toute la file, a partir d'un jour (06/11/2026) : ce qui est prevu avant ne bouge pas
  // quelques secondes de calcul (06/11/2026) : on le dit, puis ce qui a ete fait
  // l'apercu d'abord (06/11/2026) : le serveur calcule, rend les chiffres avant et apres, et l'ordre propose ; rien ne
  // change tant qu'on n'a pas touche « Appliquer » (applyOptimized). keep : bouger le moins possible
  const optimizeFrom = async (from, mode, keep, merge) => {
    toast("✨ Optimisation en cours… quelques secondes", "info", 9000);
    try {
      const r = await client.post("/makerworld/plan/optimize", { ...(from ? { from } : {}), ...(mode ? { mode } : {}), preview: true, keep: !!keep, merge: !!merge });
      toast("✨ Voilà ce que ça donnerait", "ok", 1500);
      return r.data;
    } catch (e) { showAlert(e.response?.data?.detail || e.message); return null; }
  };
  const applyOptimized = p => send("/makerworld/plan/arrange", { order: p.order, soft_why: p.soft_why, why: "Optimiser la file", ...(p.merge?.length ? { merge: p.merge } : {}) })
    .then(ok => { if (ok) { egg("planning_optimise"); toast("✨ Planning optimisé", "ok", 3000); } });
  const jobAct = j => ({
    smart: () => send("/makerworld/plan/smart", { key: j.key }, "post").then(ok => { if (ok) egg("planning_glisse"); }),
    later: () => send("/makerworld/plan/later", { key: j.key }, "post").then(ok => { if (ok) egg("planning_glisse"); }),
    laterAll: () => send("/makerworld/plan/later", { key: j.key, whole: true }, "post").then(ok => { if (ok) egg("planning_glisse"); }),
    chain: mode => send("/makerworld/plan/chain", { design_id: j.design_id, mode }, "post").then(ok => { if (ok && mode) egg("planning_traite"); }),
    lock: () => send("/makerworld/plan/lock", { key: j.key, lock: true }, "post").then(ok => { if (ok) egg("planning_fige"); }),
    unlock: () => send("/makerworld/plan/lock", { key: j.key, lock: false }, "post"),
    day: v => moveDay(j.key, v),
    dayBest: v => placeDay(j.key, v),
    unpin: () => unpin(j.key),
    pinDay: () => arrange({ pins: { [j.key]: j.day } }),
    model: () => setModelSel(j.design_id),
    unmerge: j.merge_id ? () => unmerge(j.merge_id) : null,
    // a sa place dans une journee : juste apres tel plateau (ou avant le premier du jour), son jour fige
    slot: (day, after) => {
      const o = keys.filter(x => x !== j.key);
      const firstOfDay = (pd?.jobs || []).filter(x => x.day === day && x.key !== j.key).sort((a, b) => a.start.localeCompare(b.start))[0];
      const at = after ? o.indexOf(after) + 1 : firstOfDay ? o.indexOf(firstOfDay.key) : o.length;
      o.splice(Math.max(0, at), 0, j.key);
      return arrange({ order: o, pins: { [j.key]: day } });
    },
    sheet: () => setSheet(j.mw_id || j.design_id),
    dayview: () => onDayView(j.day),
    // sa priorite parmi les plateaux de son modele (06/11/2026)
    prioPlate: lv => send("/makerworld/plan/prio", { target: `${j.design_id}:${j.plate}`, level: lv }, "post").then(ok => { if (ok) egg("planning_priorite"); }),
    due: v => setDue(j.design_id, v),
    done: () => markDone(j.key),
  });
  // « Annuler » (06/11/2026) : le dernier geste defait
  const undo = () => send("/makerworld/plan/undo", {}, "post").then(d => { if (d?.undone) toast(`↶ Annulé : ${d.undone}`, "ok", 3500); });
  // les actions de masse (06/11/2026) : sur plusieurs modeles de la file a la fois, un seul « Annuler »
  const bulk = {
    prio: (dids, lv) => send("/makerworld/plan/prio", { targets: dids, level: lv }, "post").then(ok => { if (ok) egg("planning_priorite"); }),
    freeze: async (dids, mode) => {
      const all = (pd?.jobs || []).filter(j => dids.includes(j.design_id)), locked = all.filter(j => j.locked).map(j => j.key);
      if (mode === "time") return send("/makerworld/plan/lock", { keys: all.map(j => j.key), lock: true }, "post").then(ok => { if (ok) egg("planning_fige"); });
      if (locked.length && !(await send("/makerworld/plan/lock", { keys: locked, lock: false }, "post"))) return;
      return arrange({ pins: Object.fromEntries(all.map(j => [j.key, mode === "day" ? j.day : null])), why: "Figer" });
    },
    front: dids => { const ks = keys.filter(k => dids.includes(byKey[k]?.design_id) && !byKey[k]?.pinned);
      return arrange({ order: [...ks, ...keys.filter(k => !ks.includes(k))], why: "En tête" }); },
    later: dids => { const ks = keys.filter(k => dids.includes(byKey[k]?.design_id) && !byKey[k]?.locked);
      return arrange({ order: [...keys.filter(k => !ks.includes(k)), ...ks], pins: Object.fromEntries(ks.map(k => [k, null])), why: "Plus tard" }); },
  };
  return { bulk, undo, keys, byKey, send, arrange, moveBefore, moveAfter, moveDay, unpin, placeDay, toFront, modelAct, applyAdvice, setDue, markDone, colorDay, optimize, optimizeFrom, applyOptimized, jobAct };
}
