"""
Les sechages du planning (11/11/2026) : secher une bobine AVANT qu'une impression s'en serve, si possible sans perdre de
temps d'impression (pendant d'autres impressions, dans un AMS qui ne sert pas).

Deux sortes de propositions :
- « avant » : une bobine que le planning va charger (ou qui est deja chargee) et qu'il vaut mieux secher d'abord. Le
  TPU et les filaments techniques vont de preference dans l'AMS HT (85 °C) : on l'y insere, il seche, et il y reste pour
  l'impression. Les autres sont posees (pas inserees, l'AMS les fait tourner) dans un emplacement libre d'un AMS qui
  seche (AMS 2 Pro, HT) dont toutes les bobines supportent la meme temperature ; une bobine deja chargee seche sur place
  si ses voisines le supportent.
- « opportunite » : un AMS dont toutes les bobines sont de meme nature (meme temperature de sechage), qui ne sert pas
  pendant quelques heures, et dont une bobine commence a dater : le secher pendant que les autres impriment.

Temperature et duree : celles du profil Bambu du filament (filament_dev_ams_drying_*, rapatriees dans dry_temp /
dry_hours), sinon une valeur usuelle par matiere ; bornees par ce que l'unite sait faire (65 °C pour un AMS 2 Pro, 85 °C
pour un HT).

Quand : le plus tard possible avant l'impression (la bobine est fraiche), a un moment ou l'on est la pour poser la
bobine (heures de lancement, creneaux de chargement, absences), dans une fenetre ou l'unite ne sert pas. Rien n'est
envoye a l'imprimante : on dit quoi faire et quand ; l'AMS qui seche date lui-meme les bobines (core/mqtt.py), et une
bobine posee via « Je la pose » est datee aussi (drying_slots).

Le coeur (build) est pur : tout ce qu'il lit lui est passe, pour s'eprouver sans imprimante ni base.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# les reglages par defaut du planning (cle « dry » des consignes)
#  mode : "off" (rien), "sensitive" (pas le PLA : il ne craint presque rien), "all" (le PLA aussi, a son delai general)
#  fresh : secher avant de s'en servir si le dernier sechage date de plus de N jours (par matiere) ; une matiere absente
#          suit seulement le delai general des bobines (Parametres › Sechage)
DEFAULT = {"mode": "sensitive",
           "fresh": {"TPU": 3, "PA": 3, "PAHT": 3, "PA6": 3, "PPA": 3, "PC": 3, "PET": 3, "PPS": 3, "PVA": 2, "BVOH": 2,
                     "PETG": 30, "ABS": 60, "ASA": 60}}
# des valeurs usuelles quand le profil n'en donne pas (°C, h), pour un AMS 2 Pro ; le HT monte plus haut
USUAL = {"PLA": (50, 8), "PETG": (65, 8), "PET": (65, 8), "TPU": (65, 8), "ABS": (65, 8), "ASA": (65, 8), "PC": (65, 8),
         "PA": (65, 12), "PAHT": (65, 12), "PA6": (65, 12), "PPA": (65, 12), "PPS": (65, 12), "PVA": (55, 8), "BVOH": (55, 8),
         "HIPS": (60, 8)}
USUAL_HT = {"ABS": 80, "ASA": 80, "PC": 80, "PA": 85, "PAHT": 85, "PA6": 85, "PPA": 85, "PPS": 85, "TPU": 70}
# ce qui va de preference dans l'AMS HT
TECH = {"TPU", "PA", "PAHT", "PA6", "PPA", "PC", "PPS", "ABS", "ASA", "PET"}
MAX_T = {"ams": 65, "ht": 85}
HORIZON = timedelta(days=3)            # on prepare les sechages des trois prochains jours
OPP_WINDOW = timedelta(hours=48)


def family(material, fila_type=None) -> str:
    """« PLA-CF » -> « PLA » (la fibre ne change pas la temperature), « PETG HF » -> « PETG », « PA6-CF » -> « PA6 »."""
    m = str(material or fila_type or "").upper().replace("_", "-").strip()
    for sep in ("-", " ", "+"):
        m = m.split(sep)[0]
    return m or "?"


def clean_settings(v) -> dict:
    out = {"mode": DEFAULT["mode"], "fresh": dict(DEFAULT["fresh"])}
    if not isinstance(v, dict):
        return out
    if v.get("mode") in ("off", "sensitive", "all"):
        out["mode"] = v["mode"]
    if isinstance(v.get("fresh"), dict):
        fr = {}
        for k, n in list(v["fresh"].items())[:40]:
            k = family(k)
            try:
                n = int(n)
            except (TypeError, ValueError):
                continue
            if k != "?" and 0 < n <= 365:
                fr[k] = n
        out["fresh"] = fr
    return out


def recipe(f: dict, ht: bool) -> tuple[int, float, str]:
    """(°C, heures, d'ou ca vient) pour ce filament dans cette unite."""
    fam = f.get("family") or "?"
    t, h = f.get("dry_t"), f.get("dry_h")
    src = "profil Bambu"
    if not t or not h:
        ut, uh = USUAL.get(fam, (55, 8))
        if ht and fam in USUAL_HT:
            ut = USUAL_HT[fam]
        t, h, src = t or ut, h or uh, "valeur usuelle"
    t = int(min(int(t), MAX_T["ht" if ht else "ams"]))
    return t, float(h), src


def _age_days(last, now) -> float | None:
    return None if last is None else (now - last).total_seconds() / 86400


SOON_DAYS = 30            # « bientot a secher » : comme la fiche et les statistiques, borne au tiers d'un delai court


def urgency(sp: dict, cfg: dict, at: datetime) -> tuple[float, str | None]:
    """(urgence, pourquoi) pour cette bobine a l'heure at. Le but (11/11/2026) : le plus de stock sec possible, donc on
    seche AVANT l'echeance, pas apres. Delai frais de la matiere (consignes du planning) : a sa moitie deja ; sinon le
    delai general (Parametres › Sechage) : des qu'il entre dans ses 30 derniers jours. urgence >= 1 : a proposer (plus
    elle est grande, plus c'est presse) ; jamais sechee : 9."""
    fam = sp.get("family") or "?"
    age = _age_days(sp.get("last"), at)
    if age is None:
        return 9.0, "jamais séchée"
    n = cfg["fresh"].get(fam)
    if n is not None:
        thr, lim, what = n / 2, n, f"le délai de {n} j du {fam}"
    else:
        lim = sp.get("limit_days") or 180
        thr, what = max(1.0, lim - min(SOON_DAYS, lim / 3)), f"son délai de {lim} j"
    if age < thr:
        return age / thr, None
    left = lim - age
    why = (f"séchée il y a {int(age)} j : {what} est dépassé" if left <= 0 else
           f"séchée il y a {int(age)} j : {what} tombe dans {max(1, round(left))} j")
    return 1.0 + age / max(lim, 1), why


def wants(sp: dict, cfg: dict, at: datetime, pla: bool = False) -> str | None:
    """Pourquoi secher cette bobine avant at (None : pas la peine). Le PLA seulement en mode « tout », ou pla (le temps
    libre d'un AMS : le stock sec, toutes matieres)."""
    if cfg["mode"] == "off":
        return None
    if (sp.get("family") or "?") == "PLA" and cfg["mode"] != "all" and not pla:
        return None
    return urgency(sp, cfg, at)[1]


def _fmt(t: datetime) -> str:
    return f"{t.hour} h {t.minute:02d}" if t.minute else f"{t.hour} h"


def build(jobs: list, units: list, spools: dict, cfg: dict, now: datetime, present=None) -> dict:
    """jobs : le planning pose (start, end, key, title, fils, load_ids, load_spots, load_where), dans l'ordre.
    units : [{id, label, ht, can (sait secher), drying (seche en ce moment), trays: [{tray, sid, fid, empty, posed}]}].
    spools : {sid: {fid, name, family, last, needs, dry_t, dry_h}} (bobines chargees, posees, et celles a charger).
    present(t) -> bool : est-on la pour poser une bobine a cette heure (None : toujours).
    Rend {"items": [...], "by_job": {key: [index...]}}."""
    cfg = clean_settings(cfg)
    if cfg["mode"] == "off" or not units:
        return {"items": [], "by_job": {}}
    present = present or (lambda t: True)
    end_h = now + HORIZON
    seq = [j for j in jobs if j.get("start")]
    for j in seq:
        j["_s"], j["_e"] = datetime.fromisoformat(j["start"]), datetime.fromisoformat(j["end"])
    uses = {}                                         # fid -> [(debut, fin)] des impressions qui s'en servent
    for j in seq:
        for f in j.get("fils") or []:
            if f.get("filament_id"):
                uses.setdefault(f["filament_id"], []).append((j["_s"], j["_e"]))
    unit_of = {}                                      # sid charge ou pose -> unite
    for u in units:
        for t in u["trays"]:
            for sid in (t.get("sid"), t.get("posed")):
                if sid:
                    unit_of[sid] = u
    # les bobines a charger : la premiere fois que le planning les charge
    first_load = {}
    for j in seq:
        for i, fid in enumerate(j.get("load_ids") or []):
            sp = (j.get("load_spots") or [None] * 99)[i] if i < len(j.get("load_spots") or []) else None
            sid = (sp or {}).get("spool")
            if sid and sid not in first_load:
                first_load[sid] = (j, (j.get("load_where") or {}).get(str(fid)))
    # les bobines chargees qui serviront bientot : leur premiere impression
    first_use = {}
    for u in units:
        for t in u["trays"]:
            sid = t.get("sid")
            if sid and sid in spools:
                j = next((j for j in seq if any(f.get("filament_id") == spools[sid]["fid"] for f in j.get("fils") or [])), None)
                if j:
                    first_use[sid] = j

    def busy(fids, a, b):
        """Une impression qui se sert de ces filaments entre a et b : la fin de la derniere (None : aucune)."""
        last = None
        for fid in fids:
            for s, e in uses.get(fid, ()):
                if s < b and e > a:
                    last = e if last is None or e > last else last
        return last

    def temps_ok(u, t, skip=()):
        """Toutes les bobines de l'unite (chargees, posees) supportent t."""
        for x in u["trays"]:
            for sid in (x.get("sid"), x.get("posed")):
                if sid and sid not in skip and sid in spools:
                    tt, _, _ = recipe(spools[sid], u["ht"])
                    if tt + 2 < t:
                        return False
        return True

    def u_fids(u, skip=()):
        return {spools[s]["fid"] for x in u["trays"] for s in (x.get("sid"), x.get("posed")) if s and s not in skip and s in spools}

    def latest_start(need_by, hours, fids, earliest=None):
        """Le debut le plus tard (pas avant maintenant) pour finir avant need_by, a un moment ou l'on est la, et sans que
        ces filaments servent pendant. Rend (debut, heures possibles)."""
        dur = timedelta(hours=hours)
        t = need_by - dur
        lo = max(now, earliest or now)
        step = timedelta(minutes=15)
        while t >= lo:
            if present(t) and busy(fids, t, need_by) is None:
                return t, hours
            t -= step
        # pas le temps de tout faire : le plus tot possible, ecourte
        t = lo
        stop = need_by - timedelta(hours=1)
        while t <= stop:
            b = busy(fids, t, need_by)
            if b is not None:
                t = max(t + step, b)
                continue
            if present(t):
                return t, round((need_by - t).total_seconds() / 3600, 1)
            t += step
        return None, 0

    items, by_job, done_sids, used_units = [], {}, set(), {}
    it_when = lambda t: when(t, now).replace("à ", "", 1) if t.date() == now.date() else when(t, now)

    def add(it, j=None):
        items.append(it)
        if j is not None:
            by_job.setdefault(j["key"], []).append(len(items) - 1)

    # ── avant une impression ──
    cands = [(j, sid, "load", where) for sid, (j, where) in first_load.items()] + \
            [(j, sid, "loaded", None) for sid, j in first_use.items() if sid not in first_load]
    cands.sort(key=lambda x: x[0]["_s"])
    ht_units = [u for u in units if u["ht"] and u["can"]]
    for j, sid, how, where in cands:
        if j["_s"] > end_h or sid in done_sids:
            continue
        sp = spools.get(sid)
        if not sp:
            continue
        why = wants(sp, cfg, j["_s"])               # son age le jour de l'impression
        if not why:
            continue
        done_sids.add(sid)
        fam = sp.get("family") or "?"
        need_by = j["_s"]
        base = {"kind": "before", "spool": sid, "fid": sp["fid"], "name": sp.get("name"), "family": fam, "why": why,
                "for_key": j["key"], "for_title": j.get("title"), "for_start": j["start"]}
        plan = None
        # 1. deja chargee : sur place, si ses voisines supportent la temperature et que l'unite sait secher
        u0 = unit_of.get(sid)
        if how == "loaded" and u0 and u0["can"] and not u0.get("drying"):
            t, h, src = recipe(sp, u0["ht"])
            if temps_ok(u0, t, skip=(sid,)):
                s, hh = latest_start(need_by, h, u_fids(u0))
                if s:
                    plan = {"unit": u0, "mode": "inplace", "t": t, "h": hh, "full_h": h, "src": src, "start": s}
        # 2. le TPU et les techniques : l'AMS HT, inseree (elle y reste pour imprimer)
        if plan is None and ht_units and (fam in TECH or where):
            for u in ht_units:
                if u.get("drying"):
                    continue
                t, h, src = recipe(sp, True)
                occ = u_fids(u, skip=(sid,))
                s, hh = latest_start(need_by, h, occ, earliest=used_units.get(u["id"]))
                if s:
                    plan = {"unit": u, "mode": "ht", "t": t, "h": hh, "full_h": h, "src": src, "start": s,
                            "out": [x.get("sid") for x in u["trays"] if x.get("sid") and x.get("sid") != sid]}
                    break
        # 3. posee dans un emplacement libre d'un AMS qui seche, voisines compatibles, unite qui ne sert pas pendant
        if plan is None:
            best = None
            for u in units:
                if not u["can"] or u.get("drying") or u["ht"]:
                    continue
                free = [x for x in u["trays"] if x.get("empty") and not x.get("posed")]
                if not free:
                    continue
                t, h, src = recipe(sp, False)
                if not temps_ok(u, t):
                    continue
                s, hh = latest_start(need_by, h, set(), earliest=used_units.get(u["id"]))
                if not s:
                    continue
                printing = busy(u_fids(u), s, s + timedelta(hours=hh)) is not None
                score = (hh < h, printing, -s.timestamp())
                if best is None or score < best[0]:
                    best = (score, {"unit": u, "mode": "posed", "tray": free[0]["tray"], "t": t, "h": hh, "full_h": h, "src": src,
                                    "start": s, "printing": printing})
            plan = best[1] if best else None
        # 4. le HT pour un autre filament, s'il est libre a ce moment-la
        if plan is None and ht_units:
            for u in ht_units:
                if u.get("drying"):
                    continue
                t, h, src = recipe(sp, True)
                s, hh = latest_start(need_by, h, u_fids(u, skip=(sid,)), earliest=used_units.get(u["id"]))
                if s:
                    plan = {"unit": u, "mode": "ht", "t": t, "h": hh, "full_h": h, "src": src, "start": s,
                            "out": [x.get("sid") for x in u["trays"] if x.get("sid") and x.get("sid") != sid], "back": True}
                    break
        if plan is None:
            t, h, src = recipe(sp, False)
            add({**base, "mode": "none", "t": t, "h": h, "src": src,
                 "text": f"aucun AMS libre qui supporte {t} °C avant {it_when(need_by)} : sèche-la à part (sécheur) ou libère un AMS"}, j)
            continue
        u, s = plan["unit"], plan["start"]
        e = s + timedelta(hours=plan["h"])
        used_units[u["id"]] = e
        it = {**base, "mode": plan["mode"], "unit": u["id"], "unit_label": u["label"], "tray": plan.get("tray"),
              "t": plan["t"], "h": plan["h"], "full_h": plan["full_h"], "src": plan["src"],
              "start": s.isoformat(timespec="minutes"), "end": e.isoformat(timespec="minutes"),
              "short": plan["h"] + 0.05 < plan["full_h"], "printing": bool(plan.get("printing")),
              "out": [spools[x]["name"] for x in plan.get("out") or [] if x in spools]}
        add(it, j)

    # ── le temps libre d'un AMS (11/11/2026, le stock sec d'abord) : un AMS qui sait secher et ne sert pas pendant
    # quelques heures seche ses bobines (si elles supportent la meme temperature), et on remplit ses places libres de
    # bobines du stock qui approchent de leur delai, les plus pressees d'abord, de meme temperature. Le PLA compte ici
    # (sauf « pas de sechage ») : c'est du temps gratuit.
    taken = set(done_sids)
    stock = sorted(((urgency(sp, cfg, now)[0], sid) for sid, sp in spools.items() if sp.get("stored") and sid not in taken),
                   reverse=True)
    for u in sorted(units, key=lambda u: (not u["ht"], u["id"])):
        if not u["can"] or u.get("drying") or u["id"] in used_units:
            continue
        inside = [x for t in u["trays"] for x in (t.get("sid"), t.get("posed")) if x and x in spools]
        if any(x in taken for x in inside):
            continue
        free = [t["tray"] for t in u["trays"] if t.get("empty") and not t.get("posed")]
        rs = {x: recipe(spools[x], u["ht"]) for x in inside}
        ts = [r[0] for r in rs.values()]
        if ts and max(ts) - min(ts) > 5:               # pas de meme nature : la plus fragile empeche les autres
            continue
        T = min(ts) if ts else None
        pose = []
        for urg, sid in stock:
            if len(pose) >= len(free):
                break
            if urg < 1 or sid in taken:
                continue
            sp = spools[sid]
            if (sp.get("family") or "?") in TECH and not u["ht"] and any(h["can"] for h in units if h["ht"]):
                continue                              # le technique attend le HT
            t, h, src = recipe(sp, u["ht"])
            if T is None:
                T = t
            if abs(t - T) > 5:
                continue
            pose.append(sid)
            rs[sid] = (t, h, src)
        due = [x for x in inside if wants(spools[x], cfg, now, pla=True)] + pose
        if not due:
            continue
        T = min(r[0] for r in rs.values())
        h = max(r[1] for r in rs.values())
        fids = u_fids(u)
        tt, best = now, None
        stop = now + OPP_WINDOW
        while tt <= stop:
            b = busy(fids, tt, tt + timedelta(hours=h))
            if b is not None:
                tt = max(tt + timedelta(minutes=15), b)
                continue
            if present(tt):
                best = tt
                break
            tt += timedelta(minutes=15)
        if best is None:
            continue
        taken |= set(inside) | set(pose)
        used_units[u["id"]] = best + timedelta(hours=h)
        e = best + timedelta(hours=h)
        others = any(a < e and b > best for j in seq for a, b in [(j["_s"], j["_e"])])
        fams = {spools[x].get("family") for x in list(inside) + pose}
        add({"kind": "opportunity", "unit": u["id"], "unit_label": u["label"], "t": T, "h": h,
             "src": "profil Bambu" if all(r[2] == "profil Bambu" for r in rs.values()) else "valeur usuelle",
             "start": best.isoformat(timespec="minutes"), "end": e.isoformat(timespec="minutes"),
             "family": "/".join(sorted(f for f in fams if f)),
             "pose": [{"spool": x, "fid": spools[x]["fid"], "name": spools[x].get("name"), "tray": tr, "where": spools[x].get("where"),
                       "why": urgency(spools[x], cfg, now)[1]} for x, tr in zip(pose, free)],
             "with": [spools[x].get("name") for x in inside],
             "due": [spools[x].get("name") for x in due], "printing_others": others})
    for j in seq:
        j.pop("_s", None)
        j.pop("_e", None)
    items_sorted = sorted(range(len(items)), key=lambda i: items[i].get("start") or "9")
    remap = {old: new for new, old in enumerate(items_sorted)}
    return {"items": [items[i] for i in items_sorted], "by_job": {k: sorted(remap[i] for i in v) for k, v in by_job.items()}}


_WD = ("lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche")


def when(t: datetime, ref: datetime | None) -> str:
    """« à 15 h », « demain à 6 h », « jeudi 13 à 9 h » (par rapport a ref)."""
    if ref is None or t.date() == ref.date():
        return f"à {_fmt(t)}"
    if t.date() == (ref + timedelta(days=1)).date():
        return f"demain à {_fmt(t)}"
    return f"{_WD[t.weekday()]} {t.day} à {_fmt(t)}"


def text(it: dict, now: datetime | None = None) -> str:
    """La consigne en une phrase (notifications, fiche du plateau)."""
    if it.get("mode") == "none":
        return f"♨ {it.get('name')} : {it.get('text')}"
    s = datetime.fromisoformat(it["start"])
    h = it["h"]
    hh = f"{int(h)} h" if float(h).is_integer() else f"{h:.1f} h".replace(".", ",")
    rec = f"{it['t']} °C · {hh}"
    if it["kind"] == "opportunity":
        bits = []
        if it.get("pose"):
            bits.append("pose sans les insérer " + ", ".join(
                f"{x['name']}" + (f" (📍 {x['where']})" if x.get("where") else "") + f" slot {int(x['tray']) + 1}" for x in it["pose"]))
        if it.get("with"):
            bits.append(("avec " if it.get("pose") else "") + ", ".join(it["with"]) + (" déjà dedans" if it.get("pose") else ""))
        return (f"♨ Sécher {it['unit_label']} {when(s, now)} : {rec}" + (f" ; {' ; '.join(bits)}" if bits else "")
                + " (il ne sert pas pendant" + (", les autres AMS impriment)" if it.get("printing_others") else ")"))
    if it["mode"] == "inplace":
        how = f"sèche-la sur place dans {it['unit_label']}"
    elif it["mode"] == "ht":
        how = f"insère-la dans {it['unit_label']}" + (f" (sors {', '.join(it['out'])})" if it.get("out") else "") + \
              ("" if it.get("back") else ", elle y restera pour l'impression")
    else:
        how = f"pose-la sans l'insérer dans {it['unit_label']}" + (f" slot {int(it['tray']) + 1}" if it.get("tray") is not None else "") + " (rotation)"
    tail = f" (écourté : {it['full_h']:g} h conseillées)" if it.get("short") else ""
    return f"♨ {it.get('name')} {when(s, now)} : {how}, {rec}{tail}, pour {it.get('for_title')} {when(datetime.fromisoformat(it['for_start']), s)}"


# ── ce que lit le planning ──────────────────────────────────────────────────
def _units_now() -> list:
    from ..core.mqtt import get_state, is_ht, ams_label
    from . import drying_slots as DS
    out = []
    for a in get_state().ams_list or []:
        if a.id >= 254:
            continue
        ht = is_ht(a.id)
        trays = []
        for t in a.trays or []:
            trays.append({"tray": t.id, "sid": int(t.spool_id) if getattr(t, "spool_id", None) else None,
                          "empty": bool(t.empty), "posed": DS.spool_at(a.id, t.id) or DS.spool_at(a.id, t.id, "suite")})
        # un AMS qui seche : le HT, l'AMS 2 Pro (son modele dans « info », bits 0-3 : 3 ou 4) ; l'AMS d'origine (1) et
        # l'AMS lite (2) non, meme s'ils envoient « info » eux aussi
        out.append({"id": a.id, "label": ams_label(a.id), "ht": ht, "can": ht or getattr(a, "ams_type", 0) in (3, 4),
                    "drying": (getattr(a, "dry_time", 0) or 0) > 0, "trays": trays})
    return out


async def annotate(jobs: list, d: dict, now: datetime, present=None) -> dict:
    """Le plan de sechage du planning : lit l'etat des AMS et les bobines, puis build. Ne fait jamais tomber le planning."""
    cfg = clean_settings(d.get("dry"))
    if cfg["mode"] == "off":
        return {"items": [], "by_job": {}}
    try:
        units = _units_now()
    except Exception:
        logger.exception("[SECHAGE] etat des AMS")
        return {"items": [], "by_job": {}}
    if not units:
        return {"items": [], "by_job": {}}
    sids = {x for u in units for t in u["trays"] for x in (t.get("sid"), t.get("posed")) if x}
    sids |= {(sp or {}).get("spool") for j in jobs for sp in (j.get("load_spots") or []) if (sp or {}).get("spool")}
    spools = {}
    try:
        from sqlalchemy import select, or_
        from ..db.session import AsyncSessionLocal
        from ..models.filament import Filament, Spool
        from . import drying as DR
        from .planner import fil_label
        from .storage_places import in_printer
        async with AsyncSessionLocal() as db:
            await DR.load(db)
            rows = (await db.execute(select(Spool, Filament).join(Filament, Filament.id == Spool.filament_id)
                                     .where(Spool.id.in_([int(x) for x in sids if x])))).all()
            # le stock (11/11/2026) : les bobines rangees, a secher dans le temps libre d'un AMS
            rows += [(sp, f, True) for sp, f in (await db.execute(
                select(Spool, Filament).join(Filament, Filament.id == Spool.filament_id)
                .where(Spool.archived.is_(False), Spool.ordered.is_(False),
                       or_(Spool.remaining_weight_g.is_(None), Spool.remaining_weight_g > 50)))).all()
                     if not in_printer(sp.location) and int(sp.id) not in sids]
        for row in rows:
            sp, f = row[0], row[1]
            spools[int(sp.id)] = {"stored": len(row) > 2, "where": sp.location if len(row) > 2 else None,"fid": int(f.id), "name": fil_label(f.name, f.material, f.fila_type, f.manufacturer),
                                  "family": family(f.material, f.fila_type), "last": DR.dry_reference(sp),
                                  "needs": DR.needs_drying(sp, f), "limit_days": DR.days_for(f),
                                  "dry_t": getattr(f, "dry_temp", None), "dry_h": getattr(f, "dry_hours", None)}
    except Exception:
        logger.exception("[SECHAGE] bobines")
        return {"items": [], "by_job": {}}
    return build(jobs, units, spools, cfg, now, present)
