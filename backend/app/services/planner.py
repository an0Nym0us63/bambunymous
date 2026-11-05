"""
Le planning des impressions (05/11/2026) : la file « A faire », plateau par plateau, posee sur les jours a venir en
respectant les consignes de la maison, chaque decalage explique.

Consignes (reglage PRINT_PLAN, JSON) :
  gap     : minutes de pause entre deux impressions (retirer le plateau, nettoyer) ;
  run     : heures de fonctionnement {"from": "08:00", "to": "22:00"}, ou null (24 h/24) : une impression doit
            commencer ET finir dedans ;
  launch  : heures de lancement, ou null (a toute heure) : une impression ne peut commencer que dedans (quelqu'un
            doit etre la pour la lancer), elle peut finir apres.
Une plage dont la fin precede le debut passe minuit (22:00 -> 06:00) ; « 00:00 » en fin, c'est minuit.

Ce que l'on range (meme reglage) :
  order : l'ordre voulu des travaux (cles « design:plateau:exemplaire ») ; ceux qui n'y sont pas suivent, dans
          l'ordre de « A faire » ;
  pins  : {cle: "AAAA-MM-JJ"} le jour ou un travail a ete pose (glisse sur le calendrier) ;
  done  : {"design:plateau": {"n", "title"}} les plateaux marques faits a la main (imprimes hors de l'appli) ;
  plan0 : {cle: debut prevu} le planning tel qu'il etait au dernier rangement, pour dire l'avance ou le retard ;
  deadlines : {design: "AAAA-MM-JJ"} un objet a finir AVANT ce jour (« la fusee avant le 24 ») : son dernier plateau
          doit finir avant minuit la veille ; le planning previent quand il deborde, l'optimiseur ne le sacrifie pas ;
  tz    : decalage horaire du navigateur (minutes), pour la boucle des rappels.

Un travail : un plateau d'un modele (ou le modele entier quand ses plateaux ne disent pas leur duree), un
exemplaire. Ce qui reste a faire d'un plateau : le nombre d'objets voulus, moins ce qu'il a deja donne (mes
impressions reussies du profil retenu, un print qui regroupe deux plateaux comptant pour les deux, plus ceux marques
faits a la main, plus celui qui imprime). Deux objets de 7 plateaux, un plateau imprime une fois, un jamais, les autres
deux fois : il reste un plateau a faire une fois et un autre deux fois. Les plateaux de modeles differents peuvent
s'intercaler (l'optimiseur enchaine ceux de memes couleurs) ; le plateau qui termine un objet le dit.
"""
import json
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

KEY = "PRINT_PLAN"
HORIZON_DAYS = 60
DEFAULTS = {"gap": 15, "run": None, "launch": None}


class PlanError(Exception):
    pass


# ── reglage ──────────────────────────────────────────────────────────────────
async def _load() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    d = d if isinstance(d, dict) else {}
    for k, v in DEFAULTS.items():
        d.setdefault(k, v)
    for k in ("pins", "done", "plan0", "notified", "deadlines", "locked"):
        if not isinstance(d.get(k), dict):
            d[k] = {}
    if not isinstance(d.get("order"), list):
        d["order"] = []
    return d


async def _save(d: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        # les cles « _… » ne servent qu'au calcul (le stock du moment) : jamais enregistrees
        await set_setting(db, KEY, json.dumps({k: v for k, v in d.items() if not k.startswith("_")}, ensure_ascii=False))


def _hm(v) -> int | None:
    """« 08:30 » -> minutes depuis minuit."""
    try:
        h, m = str(v).strip().split(":")
        h, m = int(h), int(m)
    except (ValueError, AttributeError):
        return None
    if not (0 <= h <= 24 and 0 <= m < 60) or h * 60 + m > 1440:
        return None
    return h * 60 + m


def _window(w):
    """Une plage {"from", "to"} -> (debut, fin) en minutes, la fin apres le debut (passe minuit : + 1440)."""
    if not isinstance(w, dict):
        return None
    a, b = _hm(w.get("from")), _hm(w.get("to"))
    if a is None or b is None:
        return None
    if b <= a:
        b += 1440
    return (a, b)


async def set_settings(body: dict) -> dict:
    d = await _load()
    if "gap" in body:
        try:
            d["gap"] = max(0, min(24 * 60, int(body.get("gap") or 0)))
        except (TypeError, ValueError):
            raise PlanError("Pause : un nombre de minutes")
    for k in ("run", "launch"):
        if k in body:
            w = body.get(k)
            if w is None:
                d[k] = None
            else:
                if not _window(w):
                    raise PlanError("Une plage d'heures : de 08:00 à 22:00")
                a, b = _window(w)
                if b - a < 30:
                    raise PlanError("Une plage d'au moins 30 minutes")
                d[k] = {"from": w["from"], "to": w["to"]}
    d["plan0"] = {}
    d["rev"] = int(d.get("rev") or 0) + 1         # rangement a la main : la tache de fond n'y voit pas un decalage                                  # nouvelles consignes : le planning repart de la
    await _save(d)
    return {k: d[k] for k in DEFAULTS}


# ── les travaux ──────────────────────────────────────────────────────────────
def _jobs(models: list, d: dict, stock_of: dict) -> tuple[list, bool]:
    """Les travaux a planifier, dans l'ordre de « A faire » ; rend aussi si base a change (a garder)."""
    out, changed = [], False
    manual = d["done"]
    for m in models:
        did = str(m.get("design_id"))
        if m.get("error") or not m.get("profile"):
            continue
        qty = max(1, int(m.get("qty") or 1))
        title = m.get("title_fr") or m.get("title") or f"Modèle {did}"
        plates = [p for p in m.get("plates") or [] if p.get("seconds")]
        units = []
        if plates:
            for p in plates:
                units.append((p.get("index"), p.get("name") or "", p.get("seconds"), p.get("fils") or [],
                              p.get("printed") or 0, (p.get("printing_n") or 1) if p.get("printing") else 0, p.get("weight_g"), p.get("thumb")))
        elif m.get("seconds"):
            fils = [{"filament_id": (f.get("chosen") or {}).get("filament_id"), "type": f.get("type"), "color": f.get("color"),
                     "g": round((f.get("g") or 0) / qty, 1)} for f in m.get("filaments") or []]
            units.append((0, "", m["seconds"] / qty, fils, 0, 1 if m.get("printing") else 0, round((m.get("weight_g") or 0) / qty, 1), None))
        # l'objet : combien chaque plateau en a deja donne, pour savoir quel plateau en termine un
        obj = {"qty": qty, "plates": {}}
        for idx, pname, secs, fils, printed, printing, wg, thumb in units:
            bk = f"{did}:{idx}"
            mk = manual.get(bk)
            done = printed + (int(mk.get("n") or 0) if isinstance(mk, dict) else 0) + printing   # en cours : ses exemplaires
            obj["plates"][idx] = done
            for c in range(done + 1, qty + 1):
                fl = []
                for f in fils:
                    fid = f.get("filament_id")
                    s = stock_of.get(fid) or {}
                    fl.append({"filament_id": fid, "type": f.get("type"), "color": s.get("color") or f.get("color"),
                               "colors_array": s.get("colors_array"), "multicolor_type": s.get("multicolor_type"),
                               "name": s.get("name") or f"{f.get('type') or ''} {f.get('color') or ''}".strip(), "g": f.get("g")})
                out.append({"key": f"{did}:{idx}:{c}", "design_id": did, "title": title, "cover": m.get("cover_url"),
                            "retained": bool(m.get("planned")),   # profil retenu dans « A faire » ; sinon celui par defaut
                            "plate": idx, "plate_name": pname, "plates_total": len(plates), "copy": c, "qty": qty,
                            "seconds": int(secs), "weight_g": wg, "fils": fl, "_obj": obj, "thumb": thumb})
    return out, changed


def _ordered(jobs: list, order: list, pins: dict | None = None) -> list:
    rank = {k: i for i, k in enumerate(order)}
    pos = {j["key"]: i for i, j in enumerate(jobs)}
    # les modeles retenus d'abord, ceux qui ne le sont pas apres (05/11/2026 : planifies quand meme, en priorite basse) ;
    # dans chacun, l'ordre voulu, puis les nouveaux dans l'ordre de « A faire »
    # un plateau pose a la main sur un jour garde sa place parmi les retenus, meme si son modele ne l'est pas
    pins = pins or {}
    return sorted(jobs, key=lambda j: (not (j.get("retained", True) or j["key"] in pins),)
                  + ((0, rank[j["key"]]) if j["key"] in rank else (1, pos[j["key"]])))


# ── les heures ───────────────────────────────────────────────────────────────
def _fmt(t: datetime) -> str:
    return f"{t.hour} h {t.minute:02d}" if t.minute else f"{t.hour} h"


def _dur(s: float) -> str:
    m = int(round(s / 60))
    return f"{m} min" if m < 60 else f"{m // 60} h {m % 60:02d}" if m % 60 else f"{m // 60} h"


def _day_fr(t: datetime, today) -> str:
    dd = (t.date() - today).days
    if dd == 0:
        return "aujourd'hui"
    if dd == 1:
        return "demain"
    j = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"][t.weekday()]
    return f"{j} {t.day}"


class Rules:
    def __init__(self, d: dict):
        self.gap = timedelta(minutes=int(d.get("gap") or 0))
        self.run = _window(d.get("run"))
        self.launch = _window(d.get("launch"))
        self.run_txt = d.get("run")
        self.launch_txt = d.get("launch")

    @staticmethod
    def _iv(w, t0: datetime, days: int):
        """Les plages w de la veille de t0 a days jours apres : [(debut, fin)]."""
        d0 = datetime(t0.year, t0.month, t0.day) - timedelta(days=1)
        return [(d0 + timedelta(days=i, minutes=w[0]), d0 + timedelta(days=i, minutes=w[1])) for i in range(days + 2)]

    def earliest(self, c: datetime, secs: float, horizon: int = 30):
        """Le premier debut possible a partir de c : (debut, pourquoi pas c, trop long)."""
        dur = timedelta(seconds=secs)
        runs = self._iv(self.run, c, horizon) if self.run else None
        lnch = self._iv(self.launch, c, horizon) if self.launch else None

        def ok_launch(s):
            return lnch is None or any(a <= s <= b for a, b in lnch)

        def ok_run(s):
            return runs is None or any(a <= s and s + dur <= b for a, b in runs)

        if ok_launch(c) and ok_run(c):
            return c, None, False
        # pourquoi pas tout de suite
        why = None
        if not ok_launch(c):
            why = "launch"
        elif runs is not None:
            inside = next(((a, b) for a, b in runs if a <= c < b), None)
            why = ("end", inside[1]) if inside else ("off", None)
        cands = sorted({x for iv in (runs or []) + (lnch or []) for x in iv[:1] if x > c})
        for s in cands:
            if ok_launch(s) and ok_run(s):
                return s, why, False
        # plus long que toute la plage de fonctionnement : tout de suite si l'imprimante tourne et qu'on peut lancer,
        # sinon au debut de la prochaine plage ou il peut etre lance
        if ok_launch(c) and (runs is None or any(a <= c < b for a, b in runs)):
            return c, None, True
        for s in cands:
            if ok_launch(s) and (runs is None or any(a == s for a, _ in runs)):
                return s, why, True
        return c, why, True


def _reason(why, c: datetime, s: datetime, secs: float, rules: Rules, today) -> str | None:
    if not why or s <= c + timedelta(minutes=1):
        return None
    nxt = f"{_day_fr(s, today)} à {_fmt(s)}" if s.date() != c.date() else f"à {_fmt(s)}"
    if why == "launch":
        lt = rules.launch_txt or {}
        return f"Pas de lancement entre {lt.get('to')} et {lt.get('from')} : lancée {nxt}"
    kind, end = why
    if kind == "end":
        return (f"Finirait à {_fmt(c + timedelta(seconds=secs))}, après l'arrêt de {_fmt(end)} : "
                + (f"reportée au lendemain, {nxt}" if s.date() != c.date() else f"reportée {nxt}"))
    rt = rules.run_txt or {}
    return f"Imprimante à l'arrêt (fonctionne de {rt.get('from')} à {rt.get('to')}) : lancée {nxt}"


async def _live_print(d: dict) -> dict:
    """L'impression en cours dans l'historique (05/11/2026, pour la tuile « En cours ») : son numero, son nom traduit et
    son debut, a l'heure du navigateur."""
    try:
        from sqlalchemy import select
        from ..db.session import AsyncSessionLocal
        from ..models.print_history import Print
        async with AsyncSessionLocal() as db:
            p = (await db.execute(select(Print.id, Print.print_date, Print.translated_name, Print.file_name, Print.estimated_seconds)
                                  .where(Print.status == "IN_PROGRESS").order_by(Print.id.desc()).limit(1))).first()
    except Exception:
        return {}
    if not p:
        return {}
    tzm = d.get("tz") if isinstance(d.get("tz"), int) else 60
    st = p[1] + timedelta(minutes=tzm) if p[1] else None
    # la fin prevue au lancement (05/11/2026) : le debut plus la duree estimee par le fichier tranche
    planned = (st + timedelta(seconds=int(p[4]))).isoformat(timespec="minutes") if st and p[4] else None
    return {"print_id": p[0], "start": st.isoformat(timespec="minutes") if st else None, "title": p[2] or p[3], "planned_end": planned}


def _title(j) -> str:
    """Le nom d'un travail : le modele, et son plateau quand il en a plusieurs."""
    pl = f" · plateau {j['plate']}" if j.get("plates_total", 0) > 1 else ""
    return f"{j['title']}{pl}"


def _live():
    """L'impression en cours : (fin estimee en heure du navigateur, nom) ou None."""
    try:
        from ..core.mqtt import get_state
        st = get_state()
        if st and str(st.status or "").upper() in ("RUNNING", "PAUSE", "PREPARE", "SLICING"):
            return int(st.remaining_minutes or 0), (getattr(st, "print_name", None) or getattr(st, "gcode_file", None) or ""), str(st.design_id or ""), \
                str(st.status or "").upper()
    except Exception:
        pass
    return None


def _slots() -> int:
    """Les emplacements de tous les AMS (et la bobine externe)."""
    try:
        from ..core.mqtt import get_state
        return sum(len(a.trays or []) for a in get_state().ams_list or []) + 1
    except Exception:
        return 5


# ── le planning ──────────────────────────────────────────────────────────────
def place(jobs: list, d: dict, now: datetime, busy_until: datetime | None, loaded: set, slots: int = 4) -> dict:
    """Pose les travaux sur les jours : ceux poses sur un jour d'abord (dans leur ordre), puis la suite de la file
    dans les creux. Rend {jobs (avec start, end, day, reasons, load), days, idle}."""
    rules = Rules(d)
    today = now.date()
    pins = d["pins"]
    cursor = max(now, busy_until + rules.gap) if busy_until else now
    by_day, pending = {}, []
    rank = {j["key"]: i for i, j in enumerate(jobs)}
    # les plateaux figes (05/11/2026) : des rendez-vous a leur jour et leur heure ; le reste se range autour, et rien
    # (optimiser, journee couleur, au mieux, plus tard) ne les deplace. L'imprimante occupee a l'heure dite : ils
    # partent des qu'elle se libere, et le disent.
    locked = d.get("locked") or {}
    fixed = sorted([(datetime.fromisoformat(locked[j["key"]]), rank[j["key"]], j) for j in jobs if j["key"] in locked], key=lambda x: (x[0], x[1]))
    for j in jobs:
        if j["key"] in locked:
            continue
        p = pins.get(j["key"])
        if p and p >= today.isoformat():
            by_day.setdefault(p, []).append(j)
        else:
            pending.append(j)
    placed = []
    carry = []
    blocked = []
    # le stock (05/11/2026) : ce que chaque filament a en bobines, et en commande pas encore recue ; chaque plateau pose
    # le consomme. Un plateau que ni le stock ni les commandes ne couvrent n'est pas pose (« non planifiable ») ; un
    # plateau qui compte sur une commande le dit ; un filament qui passe sous le seuil (un quart de bobine) aussi.
    stock = {fid: dict(v) for fid, v in (d.get("_stock") or {}).items()}

    def short(j):
        """Ce qui manque a ce plateau, meme avec les commandes ; et les filaments qu'il prendrait a une commande."""
        miss, await_ = [], []
        for f in j["fils"]:
            st = stock.get(f.get("filament_id"))
            g = f.get("g") or 0
            if not st or not g:
                continue
            if g > st["g"] + st["ordered"] + 0.5:
                miss.append(f"{f['name']} : il faut {round(g)} g, il en reste {max(0, round(st['g']))} g"
                            + (f" (+ {round(st['ordered'])} g commandés)" if st["ordered"] > 0 else ""))
            elif g > st["g"] + 0.5:
                await_.append(f["name"])
        return miss, await_
    # ce qui est charge, le plus recemment servi en dernier : un AMS n'a que `slots` places, charger un filament
    # sort celui qui a servi il y a le plus longtemps
    have = list(loaded)
    slots = max(slots, len(have), 1)

    def put(j, s, why, c, too_long, extra=None):
        nonlocal cursor
        e = s + timedelta(seconds=j["seconds"])
        rs = [r for r in [extra, _reason(why, c, s, j["seconds"], rules, today)] if r]
        if too_long:
            rt = rules.run_txt or {}
            rs.append(f"Plus longue ({_dur(j['seconds'])}) que la plage de fonctionnement ({rt.get('from')}–{rt.get('to')}) : "
                      f"elle ne peut pas finir avant l'arrêt")
        need = [f for f in j["fils"] if f.get("filament_id") and f["filament_id"] not in have]
        for f in j["fils"]:
            fid = f.get("filament_id")
            if fid:
                if fid in have:
                    have.remove(fid)
                have.append(fid)
        del have[:max(0, len(have) - slots)]
        _, awaits = short(j)
        low, low_info = [], []
        for f in j["fils"]:
            st = stock.get(f.get("filament_id"))
            g = f.get("g") or 0
            if not st or not g:
                continue
            before = st["g"] + st["ordered"]
            take = min(max(st["g"], 0), g)
            st["g"] -= take
            st["ordered"] -= g - take
            if before >= st["low"] > st["g"] + st["ordered"]:
                low.append(f"{f['name']} (il en restera {max(0, round(st['g'] + st['ordered']))} g)")
                low_info.append({"name": f["name"], "color": f.get("color"), "colors_array": f.get("colors_array"),
                                 "multicolor_type": f.get("multicolor_type"), "left": max(0, round(st["g"] + st["ordered"])), "low": round(st["low"])})
        placed.append({**j, "awaits_order": awaits, "low_after": low, "low_info": low_info, "start": s.isoformat(timespec="minutes"), "end": e.isoformat(timespec="minutes"),
                       "day": s.date().isoformat(), "pinned": j["key"] in pins, "locked": j["key"] in locked, "reasons": rs, "too_long": too_long,
                       "load": [f["name"] for f in need], "wait_s": int((s - c).total_seconds()) if s > c else 0})
        cursor = e + rules.gap

    def place_fixed():
        fs, _, fj = fixed.pop(0)
        s = max(fs, cursor)
        extra = None if s <= fs + timedelta(minutes=1) else \
            f"Figé à {_fmt(fs)}, parti à {_fmt(s)} : l'imprimante n'était pas libre avant"
        put(fj, s, None, s, False, extra)

    def slot(c, secs):
        """Le premier debut possible a partir de c, autour des plateaux figes : un fige qui doit partir avant passe
        d'abord ; un plateau qui le chevaucherait passe apres lui."""
        while True:
            s, why, tl = rules.earliest(c, secs)
            if fixed and (fixed[0][0] <= s or s + timedelta(seconds=secs) + rules.gap > fixed[0][0]):
                place_fixed()
                c = max(c, cursor)
                continue
            return s, why, tl

    left = len(jobs) - len(fixed)
    for i in range(HORIZON_DAYS + 1):
        if not left:
            break
        day = today + timedelta(days=i)
        d0 = datetime(day.year, day.month, day.day)
        # un travail pose sur un jour commence au debut de sa journee : l'heure de lancement, sinon celle ou
        # l'imprimante se met en route, sinon 8 h (pas a minuit)
        h0 = (rules.launch or rules.run or (480, 0))[0] % 1440
        # ceux poses ce jour-la et la suite de la file, meles dans l'ordre voulu : poser un travail sur un jour ne le
        # fait pas passer devant ce qui y etait deja
        todo = sorted([x if isinstance(x, tuple) else (x, None) for x in carry + by_day.pop(day.isoformat(), [])],
                      key=lambda x: rank[x[0]["key"]])
        carry = []
        full = False                                  # la suite de la file ne tient plus ce jour : seuls les poses passent
        while todo or (pending and not full):
            if todo and (full or not pending or rank[todo[0][0]["key"]] < rank[pending[0]["key"]]):
                j, extra = todo.pop(0)
                miss, _ = short(j)
                if miss:
                    blocked.append({**j, "why": miss})
                    left -= 1
                    continue
                c = max(cursor, d0 + timedelta(minutes=h0))
                if extra is None and c > cursor + timedelta(minutes=1) and c.date() != cursor.date():
                    extra = f"Posée {_day_fr(c, today)} (glissée sur le calendrier)"
                s, why, too_long = slot(c, j["seconds"])
                if s.date() > day and not too_long and i < HORIZON_DAYS:
                    carry.append((j, f"Posée le {day.day}/{day.month:02d} mais n'y tient plus : reportée"))
                    continue
                put(j, s, why, c, too_long, extra)
                left -= 1
                continue
            j = pending[0]
            miss, _ = short(j)
            if miss:
                pending.pop(0)
                blocked.append({**j, "why": miss})
                left -= 1
                continue
            c = cursor
            s, why, too_long = slot(c, j["seconds"])
            if s.date() > day and i < HORIZON_DAYS:
                full = True
                continue
            pending.pop(0)
            put(j, s, why, c, too_long)
            left -= 1
    while fixed:                                      # les figes au-dela de la file
        place_fixed()
    placed.sort(key=lambda p: p["start"])
    days = {}
    for p in placed:
        x = days.setdefault(p["day"], {"seconds": 0, "count": 0, "keys": []})
        # les heures du jour : une impression qui passe minuit compte sur les deux jours
        s, e = datetime.fromisoformat(p["start"]), datetime.fromisoformat(p["end"])
        while s < e:
            mid = datetime(s.year, s.month, s.day) + timedelta(days=1)
            k = s.date().isoformat()
            y = days.setdefault(k, {"seconds": 0, "count": 0, "keys": []})
            y["seconds"] += int((min(e, mid) - s).total_seconds())
            s = mid
        x["count"] += 1
        x["keys"].append(p["key"])
    return {"jobs": placed, "days": days, "blocked": blocked}


def deadlines(placed: list, d: dict, now: datetime) -> list:
    """Chaque objet a date limite : son dernier plateau, la date, tient-il ? (marge ou retard, en minutes)."""
    out = []
    for did, due in (d.get("deadlines") or {}).items():
        mine = [j for j in placed if j["design_id"] == did]
        if not mine:
            continue
        try:
            limit = datetime.strptime(due, "%Y-%m-%d")
        except ValueError:
            continue
        last = max(mine, key=lambda j: j["end"])
        end = datetime.fromisoformat(last["end"])
        out.append({"design_id": did, "title": mine[0]["title"], "cover": mine[0]["cover"], "due": due,
                    "end": last["end"], "last_key": last["key"], "count": len(mine), "ok": end <= limit,
                    "margin_min": int((limit - end).total_seconds() // 60), "keys": [j["key"] for j in mine]})
    return sorted(out, key=lambda x: x["due"])


def _late(m: int) -> str:
    """Un retard en minutes, en jours au-dela de 24 h (« 1 j 11 h »)."""
    return _dur(m * 60) if m < 1440 else f"{m // 1440} j{f' {m % 1440 // 60} h' if m % 1440 >= 60 else ''}"


def _due_txt(due: str) -> str:
    t = datetime.strptime(due, "%Y-%m-%d")
    return f"{t.day} {['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][t.month - 1]}"


def mark_complete(placed: list) -> None:
    """Dans l'ordre du planning, le plateau qui termine un objet : chaque plateau de l'objet a alors ete fait une fois
    de plus que le nombre d'objets deja finis. j["completes"] = le numero de l'objet termine (1 sur 2…)."""
    seen = {}
    for j in placed:
        o = j.pop("_obj", None)
        if not o:
            continue
        st = seen.setdefault(id(o), {"n": dict(o["plates"]), "qty": o["qty"]})
        before = min(st["n"].values()) if st["n"] else 0
        st["n"][j["plate"]] = st["n"].get(j["plate"], 0) + 1
        after = min(st["n"].values())
        if after > before:
            j["completes"] = after


def _sig(j) -> frozenset:
    return frozenset(f["filament_id"] for f in j["fils"] if f.get("filament_id"))


def advice(placed: list, d: dict, now: datetime, dls: list | None = None, fix=None) -> list:
    """Les petits conseils : enchainer les memes couleurs, remplir un creux, ce qu'il faut charger, ce qui ne
    peut pas respecter les consignes. Chacun peut porter une action (deplacer un travail)."""
    out = []
    today = now.date()
    rules = Rules(d)
    pinned = d["pins"]
    title = _title
    # 1. memes couleurs : un travail plus loin qui a exactement les filaments de celui-ci, alors que le suivant
    # demande un changement
    seen = set()
    for i, a in enumerate(placed[:-1]):
        sa, nxt = _sig(a), placed[i + 1]
        if not sa or _sig(nxt) == sa or not nxt["load"]:
            continue
        b = next((x for x in placed[i + 2:] if _sig(x) == sa and x["load"] and x["key"] not in pinned), None)
        if b and b["key"] not in seen:
            seen.add(b["key"])
            out.append({"kind": "colors", "icon": "🎨",
                        "text": f"Enchaîne {title(b)} juste après {title(a)} : mêmes filaments, rien à recharger "
                                f"(au lieu de {', '.join(b['load'][:2])} à remettre le {datetime.fromisoformat(b['start']).day}).",
                        "action": {"kind": "after", "key": b["key"], "ref": a["key"]}})
        if len(seen) >= 3:
            break
    # 2. un creux : une attente d'au moins une heure qu'un travail plus loin pourrait remplir
    n = 0
    for i, a in enumerate(placed):
        if a["wait_s"] < 3600 or i == 0 or n >= 2:
            continue
        prev_end = datetime.fromisoformat(placed[i - 1]["end"]) + rules.gap
        room = (datetime.fromisoformat(a["start"]) - rules.gap - prev_end).total_seconds()
        for b in placed[i + 1:]:
            if b["key"] in pinned or b["seconds"] > room:
                continue
            s, _, too_long = rules.earliest(prev_end, b["seconds"], horizon=2)
            if too_long or s + timedelta(seconds=b["seconds"]) > datetime.fromisoformat(a["start"]) - rules.gap:
                continue
            out.append({"kind": "gap", "icon": "⏱",
                        "text": f"{title(b)} ({_dur(b['seconds'])}) tient {_day_fr(s, today)} à {_fmt(s)}, dans le creux "
                                f"avant {title(a)} : la machine ne reste pas à l'arrêt.",
                        "action": {"kind": "before", "key": b["key"], "ref": a["key"], "day": s.date().isoformat()}})
            n += 1
            break
    # 0. une date limite depassee : en tete de liste
    for x in dls or []:
        if x["ok"]:
            continue
        end = datetime.fromisoformat(x["end"])
        late = _late(-x["margin_min"])
        ok_front = fix(x["keys"]) if fix else None
        txt = (f"{x['title']} : son dernier plateau finit {_day_fr(end, today)} à {_fmt(end)}, {late} après ta date "
               f"(fini avant le {_due_txt(x['due'])}). ")
        txt += ("Passe ses plateaux en tête de file : il tient." if ok_front else
                "Même en tête de file il ne tiendrait pas : élargis les heures, ou recule la date.")
        out.insert(0, {"kind": "deadline", "icon": "🎯", "text": txt,
                       **({"action": {"kind": "front", "keys": x["keys"]}} if ok_front else {})})
    # 3. ce qu'il faut charger pour les prochaines
    for j in placed[:4]:
        if j["load"]:
            s = datetime.fromisoformat(j["start"])
            out.append({"kind": "load", "icon": "🧵",
                        "text": f"Charge {', '.join(j['load'])} avant {_day_fr(s, today)} à {_fmt(s)} pour {title(j)}."})
    # 4. ce qui ne peut pas respecter les consignes
    for j in placed:
        if j["too_long"]:
            out.append({"kind": "long", "icon": "⚠️",
                        "text": f"{title(j)} dure {_dur(j['seconds'])} : plus que la plage de fonctionnement. "
                                f"Élargis les heures, ou découpe le plateau."})
    return out


def optimize(jobs: list, loaded: set, keep: list | None = None) -> list:
    """Un ordre qui enchaine les memes couleurs : a chaque pas, parmi les 8 suivants de la file, celui qui demande le
    moins de filaments a charger (a egalite, le premier de la file). La priorite de la file reste a peu pres tenue."""
    rest = list(jobs)
    have = set(loaded)
    out = []
    while rest:
        # parmi les 24 suivants (05/11/2026 : 8 avant) : un objet peut rester en suspens, le temps d'enchainer les
        # plateaux d'autres objets de memes couleurs ; les dates limites sont gardees ensuite (optimize_plan)
        win = rest[:24]
        best = min(range(len(win)), key=lambda i: (len(_sig(win[i]) - have), i))
        j = rest.pop(best)
        have |= _sig(j)
        out.append(j)
    return out


# ── ce que la page lit ───────────────────────────────────────────────────────
async def _context(tz: int | None):
    from . import mw_queue as Q
    d = await _load()
    if tz is not None and d.get("tz") != tz:
        d["tz"] = tz
    tzm = d.get("tz") if isinstance(d.get("tz"), int) else 60
    now = (datetime.utcnow() + timedelta(minutes=tzm)).replace(second=0, microsecond=0)
    q = await Q.queue()
    stock_of = ((Q._CACHE[1] or {}).get("stock_of")) or {}
    stock_of = {int(k): v for k, v in stock_of.items() if str(k).isdigit()}
    loaded = set((await Q._ams_stock()).keys())
    jobs, changed = _jobs(q.get("models") or [], d, stock_of)
    d["_stock"] = await _stock_ledger(stock_of)
    live = _live()
    busy = now + timedelta(minutes=live[0]) if live else None
    return d, now, jobs, changed or tz is not None, loaded, live, busy


async def _stock_ledger(stock_of: dict) -> dict:
    """{filament: {g: en bobines, ordered: en commande pas recue, low: le seuil}} pour les filaments de la file. Le seuil :
    un quart d'une bobine (comme « Filaments en fin de stock »)."""
    if not stock_of:
        return {}
    try:
        from sqlalchemy import select, func
        from ..db.session import AsyncSessionLocal
        from ..models.filament import Spool, Filament
        ids = [int(k) for k in stock_of]
        async with AsyncSessionLocal() as db:
            nom = dict((await db.execute(select(Filament.id, Filament.filament_weight_g).where(Filament.id.in_(ids)))).all())
            ordered = dict((await db.execute(select(Spool.filament_id, func.count(Spool.id))
                                             .where(Spool.filament_id.in_(ids), Spool.ordered.is_(True), Spool.archived.is_(False))
                                             .group_by(Spool.filament_id))).all())
    except Exception:
        logger.exception("[PLANNING] stock")
        return {}
    out = {}
    for fid, v in stock_of.items():
        fid = int(fid)
        n = float(nom.get(fid) or 1000)
        out[fid] = {"g": float(v.get("stock_g") or 0), "ordered": float(ordered.get(fid, 0)) * n, "low": n * 0.25}
    return out


async def plan(tz: int | None = None) -> dict:
    d, now, jobs, dirty, loaded, live, busy = await _context(tz)
    jobs = _ordered(jobs, d["order"], d["pins"])
    keys = {j["key"] for j in jobs}
    # les poses de travaux sortis du planning (imprimes, retires de « A faire ») s'en vont
    for k in [k for k in d["pins"] if k not in keys]:
        d["pins"].pop(k)
        dirty = True
    for k in [k for k in d["locked"] if k not in keys]:
        d["locked"].pop(k)
        dirty = True
    r = place(jobs, d, now, busy, loaded, _slots())
    mark_complete(r["jobs"])
    # avance ou retard : chaque debut, compare a celui du dernier rangement
    p0 = d["plan0"]
    for j in r["jobs"]:
        if j["key"] not in p0:
            p0[j["key"]] = j["start"]
            dirty = True
        j["drift_min"] = int((datetime.fromisoformat(j["start"]) - datetime.fromisoformat(p0[j["key"]])).total_seconds() // 60)
    for k in [k for k in p0 if k not in keys]:
        p0.pop(k)
        dirty = True
    if dirty:
        await _save(d)
    first = r["jobs"][0] if r["jobs"] else None
    status = None
    if first:
        s = datetime.fromisoformat(first["start"])
        if not live and s <= now:
            late = int((now - datetime.fromisoformat(p0.get(first["key"], first["start"]))).total_seconds() // 60)
            status = {"state": "due", "late_min": max(0, late),
                      "text": f"À lancer maintenant : {_title(first)}" + (f" (prévu il y a {_dur(late * 60)})" if late >= 10 else "")}
        elif first["drift_min"] >= 10:
            status = {"state": "late", "late_min": first["drift_min"],
                      "text": f"{_dur(first['drift_min'] * 60)} de retard sur le planning : la suite est décalée d'autant, dans les consignes"}
        elif first["drift_min"] <= -10:
            status = {"state": "ahead", "late_min": first["drift_min"],
                      "text": f"{_dur(-first['drift_min'] * 60)} d'avance : la suite est avancée d'autant"}
        else:
            status = {"state": "ontime", "late_min": 0, "text": "Dans les temps"}
    dls = deadlines(r["jobs"], d, now)
    due_of = {x["design_id"]: x for x in dls}
    for j in r["jobs"]:
        j.pop("_obj", None)
        x = due_of.get(j["design_id"])
        if x:
            j["due"], j["due_ok"] = x["due"], x["ok"]

    def fix(ks):
        # en tete de file, cet objet tiendrait-il sa date ?
        o = ks + [j["key"] for j in jobs if j["key"] not in set(ks)]
        rr = place(_ordered(jobs, o, d["pins"]), d, now, busy, loaded, _slots())
        return all(x["ok"] for x in deadlines(rr["jobs"], d, now) if x["keys"] and x["keys"][0] in set(ks))
    return {"settings": {k: d[k] for k in DEFAULTS}, "now": now.isoformat(timespec="minutes"),
            "busy_until": busy.isoformat(timespec="minutes") if busy else None,
            "live": ({"name": live[1], "design_id": live[2], "remaining_min": live[0], **(await _live_print(d))} if live else None),
            "jobs": r["jobs"], "days": r["days"], "advice": advice(r["jobs"], d, now, dls, fix), "status": status,
            "deadlines": dls, "colors": colors(r["jobs"]), "loaded": sorted(loaded), "check": await _check_view(r["jobs"]),
            "blocked": [{k: b.get(k) for k in ("key", "design_id", "title", "cover", "thumb", "plate", "plate_name", "plates_total", "copy", "qty",
                                                "seconds", "retained", "why", "fils")} for b in r.get("blocked") or []],
            "manual_done": [{"key": k, "title": v.get("title"), "plate": k.split(":")[-1], "n": v.get("n")}
                            for k, v in d["done"].items() if isinstance(v, dict) and v.get("n")]}


async def mark_done(key: str, undo: bool = False) -> dict:
    """« ✓ Fait » : un plateau imprime hors de l'appli (ou pas reconnu) compte comme fait ; undo le retire."""
    parts = str(key).split(":")
    if len(parts) < 2:
        raise PlanError("Plateau inconnu")
    bk = f"{parts[0]}:{parts[1]}"
    d, now, jobs, _, loaded, live, busy = await _context(None)
    j = next((x for x in jobs if x["key"] == key), None)
    cur = d["done"].get(bk) if isinstance(d["done"].get(bk), dict) else {"n": 0, "title": None}
    cur["n"] = max(0, int(cur.get("n") or 0) + (-1 if undo else 1))
    if j:
        cur["title"] = _title(j)
    if cur["n"]:
        d["done"][bk] = cur
    else:
        d["done"].pop(bk, None)
    d["rev"] = int(d.get("rev") or 0) + 1
    await _save(d)
    return await plan()


def colors(placed: list) -> list:
    """Les filaments de la file, pour la journee couleur : combien de plateaux et d'heures chacun."""
    out = {}
    for j in placed:
        for f in j["fils"]:
            fid = f.get("filament_id")
            if not fid:
                continue
            x = out.setdefault(fid, {"filament_id": fid, "name": f.get("name"), "color": f.get("color"),
                                     "colors_array": f.get("colors_array"), "multicolor_type": f.get("multicolor_type"),
                                     "count": 0, "seconds": 0})
            x["count"] += 1
            x["seconds"] += j["seconds"]
    return sorted(out.values(), key=lambda x: -x["count"])


async def set_deadline(design_id: str, due) -> dict:
    """La date limite d'un objet (« fini avant le »), ou None pour la retirer."""
    d = await _load()
    did = str(design_id)
    if due:
        try:
            datetime.strptime(str(due), "%Y-%m-%d")
        except ValueError:
            raise PlanError("Date invalide")
        d["deadlines"][did] = str(due)
    else:
        d["deadlines"].pop(did, None)
    d["notified"].pop(f"due:{did}", None)
    d["rev"] = int(d.get("rev") or 0) + 1
    await _save(d)
    return await plan()


async def color_day(day: str, fid: int) -> dict:
    """La journee couleur (05/11/2026, revue) : remplir ce jour au maximum avec les plateaux qui n'utilisent QUE ce
    filament, puis, s'il reste de la place, ceux qui ne demandent en plus que des filaments deja charges dans l'AMS.
    Chacun n'est garde que s'il y tient (il commence et finit ce jour-la) ; ceux qui n'y tiennent pas restent ou ils
    etaient, au lieu de passer au lendemain. Ce qui etait prevu ce jour-la se decale derriere."""
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise PlanError("Jour invalide")
    d, now, jobs, _, loaded, live, busy = await _context(None)
    jobs = _ordered(jobs, d["order"], d["pins"])
    r = place(jobs, d, now, busy, loaded, _slots())
    # un objet a finir avant ce jour (ou ce jour meme) n'y est pas emmene : il raterait sa date
    dl = d.get("deadlines") or {}
    uses = [j for j in r["jobs"] if fid in _sig(j) and not (dl.get(j["design_id"]) and dl[j["design_id"]] <= day)
            and j["key"] not in d["locked"]]
    ok_set = {fid} | set(loaded)
    only = [j["key"] for j in uses if _sig(j) == frozenset([fid])]
    with_loaded = [j["key"] for j in uses if _sig(j) != frozenset([fid]) and _sig(j) <= ok_set]
    needs_load = [j["key"] for j in uses if not _sig(j) <= ok_set]
    if not only and not with_loaded:
        raise PlanError("Aucun plateau de la file n'utilise ce filament seul (ou avec des filaments déjà chargés)"
                        if uses else "Aucun plateau de la file n'utilise ce filament (ou ils ont une date limite avant ce jour)")
    day_of = {j["key"]: j["day"] for j in r["jobs"]}
    chosen, no_room = [], 0
    for k in (only + with_loaded)[:60]:
        trial = chosen + [k]
        rest = [j["key"] for j in r["jobs"] if j["key"] not in set(trial)]
        at = next((i for i, x in enumerate(rest) if day_of.get(x, "") >= day), len(rest))
        order = rest[:at] + trial + rest[at:]
        pins = {**d["pins"], **{x: day for x in trial}}
        rr = place(_ordered(jobs, order, pins), {**d, "pins": pins}, now, busy, loaded, _slots())
        placed = {j["key"]: j for j in rr["jobs"]}
        if all(x in placed and placed[x]["day"] == day and placed[x]["end"][:10] == day for x in trial):
            chosen = trial
        else:
            no_room += 1
    if not chosen:
        raise PlanError("Aucun de ces plateaux ne tient sur ce jour (la journée est trop courte pour eux)")
    rest = [j["key"] for j in r["jobs"] if j["key"] not in set(chosen)]
    at = next((i for i, x in enumerate(rest) if day_of.get(x, "") >= day), len(rest))
    out = await arrange({"order": rest[:at] + chosen + rest[at:], "pins": {k: day for k in chosen}})
    out["color_day"] = {"placed": len(chosen), "only": len([k for k in chosen if k in set(only)]), "no_room": no_room,
                        "needs_load": len(needs_load)}
    return out


async def arrange(body: dict) -> dict:
    """Ranger : {order: [cles] (l'ordre voulu, en entier ou le debut), pins: {cle: jour|null}}. Le planning
    repart de la (avance et retard se comptent depuis ce rangement). Un plateau fige ne se pose pas ailleurs."""
    d = await _load()
    for k, v in (body.get("pins") or {}).items():
        if str(k) in d["locked"] and v != d["pins"].get(str(k)):
            raise PlanError("Ce plateau est figé : défige-le d'abord pour le déplacer")
    if isinstance(body.get("order"), list):
        new = [str(k) for k in body["order"]][:2000]
        d["order"] = new + [k for k in d["order"] if k not in set(new)]
    for k, v in (body.get("pins") or {}).items():
        if v is None:
            d["pins"].pop(str(k), None)
        else:
            try:
                datetime.strptime(str(v), "%Y-%m-%d")
            except ValueError:
                raise PlanError("Jour invalide")
            d["pins"][str(k)] = str(v)
    d["plan0"] = {}
    d["rev"] = int(d.get("rev") or 0) + 1         # rangement a la main : la tache de fond n'y voit pas un decalage
    await _save(d)
    return await plan()


async def optimize_plan(day: str | None = None) -> dict:
    """« Optimiser » : toute la file, ou un seul jour (ses travaux remis dans un ordre qui enchaine les couleurs)."""
    d, now, jobs, _, loaded, live, busy = await _context(None)
    jobs = _ordered(jobs, d["order"], d["pins"])
    if day:
        r = place(jobs, d, now, busy, loaded, _slots())
        on = [j for j in r["jobs"] if j["day"] == day and j["key"] not in d["locked"]]
        if not on:
            return await plan()
        # ce qui etait charge avant ce jour-la : les filaments du travail qui le precede
        i0 = next(i for i, j in enumerate(r["jobs"]) if j["day"] == day)
        before = set(loaded)
        for j in r["jobs"][:i0]:
            before |= _sig(j)
        best = optimize(on, before)
        # le plus long en dernier : il imprime pendant la nuit ou la fin de journee
        if len(best) > 2:
            long_i = max(range(len(best)), key=lambda i: best[i]["seconds"])
            if best[long_i]["seconds"] >= 4 * 3600:
                best.append(best.pop(long_i))
        # le jour garde sa place dans l'ordre general : ses travaux reprennent leurs rangs, dans le nouvel ordre
        return await arrange({"order": _replace([j["key"] for j in r["jobs"]], [j["key"] for j in on], [j["key"] for j in best]),
                              "pins": {j["key"]: day for j in best}})
    free = [j for j in jobs if j["key"] not in d["pins"] and j["key"] not in d["locked"]]
    best = optimize(free, loaded)
    order = _replace([j["key"] for j in jobs], [j["key"] for j in free], [j["key"] for j in best])
    # enchainer les couleurs ne doit pas faire deborder une date limite : un objet qui ne tient pas passe en tete,
    # les dates les plus proches d'abord (s'il ne tient pas meme en tete, il y reste : c'est le plus urgent)
    for _ in range(3):
        r = place(_ordered(jobs, order, d["pins"]), d, now, busy, loaded, _slots())
        broke = [x for x in deadlines(r["jobs"], d, now) if not x["ok"] and order[:len(x["keys"])] != x["keys"]]
        if not broke:
            break
        front = [k for x in broke for k in x["keys"]]
        order = front + [k for k in order if k not in set(front)]
    return await arrange({"order": order})


def _cost(r: dict, d: dict, now: datetime, key: str) -> float:
    """Ce que coute un planning, pour choisir ou poser un plateau : une date limite ratee (enorme), un plateau non
    planifiable, chaque filament a charger, et le plateau lui-meme tard (un peu)."""
    c = 0.0
    c += 10000 * sum(1 for x in deadlines(r["jobs"], d, now) if not x["ok"])
    c += 500 * len(r.get("blocked") or [])
    c += 20 * sum(len(j.get("load") or []) for j in r["jobs"])
    me = next((j for j in r["jobs"] if j["key"] == key), None)
    if me:
        c += (datetime.fromisoformat(me["start"]) - now).total_seconds() / 3600 * 0.5
    end = max((j["end"] for j in r["jobs"]), default=None)
    if end:
        c += (datetime.fromisoformat(end) - now).total_seconds() / 3600 * 0.05
    return c


async def smart_place(key: str) -> dict:
    """« Placer au mieux » : essaie ce plateau a chaque place des 40 premieres de la file et garde celle qui charge le
    moins de filaments, ne rate aucune date limite, laisse le moins de plateaux non planifiables, et le passe tot."""
    d, now, jobs, _, loaded, live, busy = await _context(None)
    jobs = _ordered(jobs, d["order"], d["pins"])
    keys = [j["key"] for j in jobs]
    if key not in keys:
        raise PlanError("Plateau inconnu du planning")
    if key in d["locked"]:
        raise PlanError("Ce plateau est figé : défige-le d'abord pour le déplacer")
    d["pins"].pop(key, None)
    rest = [k for k in keys if k != key]
    best = None
    for i in range(0, min(len(rest), 40) + 1):
        order = rest[:i] + [key] + rest[i:]
        r = place(_ordered(jobs, order, d["pins"]), d, now, busy, loaded, _slots())
        c = _cost(r, d, now, key)
        if best is None or c < best[0]:
            best = (c, order)
    return await arrange({"order": best[1], "pins": {key: None}})


async def place_day(key: str, day: str) -> dict:
    """« Le placer sur ce jour » (05/11/2026) : le plateau est pose sur ce jour, a la meilleure place de la journee
    (le moins de filaments a charger, aucune date limite ratee), du moment qu'il y finit ; le reste se decale. Sans
    place ou il finit le jour meme (plus long que la journee), il prend la premiere."""
    try:
        datetime.strptime(day, "%Y-%m-%d")
    except ValueError:
        raise PlanError("Jour invalide")
    d, now, jobs, _, loaded, live, busy = await _context(None)
    jobs = _ordered(jobs, d["order"], d["pins"])
    keys = [j["key"] for j in jobs]
    if key not in keys:
        raise PlanError("Plateau inconnu du planning")
    if key in d["locked"]:
        raise PlanError("Ce plateau est figé : défige-le d'abord pour le déplacer")
    d["pins"][key] = day
    rest = [k for k in keys if k != key]
    base = place(_ordered(jobs, rest + [key], d["pins"]), d, now, busy, loaded, _slots())
    on = [j["key"] for j in base["jobs"] if j["day"] == day and j["key"] != key]
    # les places : avant chacun des plateaux de ce jour, et apres le dernier
    first = min((rest.index(k) for k in on), default=None)
    last = max((rest.index(k) for k in on), default=None)
    if first is None:
        at = next((i for i, k in enumerate(rest) if (next((j for j in base["jobs"] if j["key"] == k), {}).get("day") or "") > day), len(rest))
        spots = [at]
    else:
        spots = list(range(first, last + 2))
    best, fallback = None, None
    for i in spots:
        order = rest[:i] + [key] + rest[i:]
        r = place(_ordered(jobs, order, d["pins"]), d, now, busy, loaded, _slots())
        me = next((j for j in r["jobs"] if j["key"] == key), None)
        c = _cost(r, d, now, key)
        if fallback is None:
            fallback = (c, order)
        if not me or me["day"] != day or me["end"][:10] != day:
            continue                                       # il doit commencer ET finir ce jour-la
        if best is None or c < best[0]:
            best = (c, order)
    pick = best or fallback
    return await arrange({"order": pick[1], "pins": {key: day}})


async def lock(key: str, on: bool = True) -> dict:
    """Figer un plateau (05/11/2026) : il garde son jour et son heure (ceux du planning a cet instant), pose sur ce
    jour ; rien ne le deplace plus. Defiger le rend au planning (il reste pose sur son jour)."""
    r = await plan()
    j = next((x for x in r["jobs"] if x["key"] == key), None)
    d = await _load()
    if on:
        if not j:
            raise PlanError("Plateau introuvable dans le planning (non planifiable ?)")
        d["locked"][key] = j["start"]
        d["pins"][key] = j["day"]
    else:
        d["locked"].pop(key, None)
    d["plan0"] = {}
    d["rev"] = int(d.get("rev") or 0) + 1
    await _save(d)
    return await plan()


async def later(key: str, whole: bool = False) -> dict:
    """« Plus tard » : le plateau quitte sa place et son jour, et passe en fin de file (un modele retenu reste devant
    les non retenus). whole (05/11/2026) : tous les plateaux de son objet a la fois, dans leur ordre ; les figes restent."""
    d = await _load()
    if key in d["locked"]:
        raise PlanError("Ce plateau est figé : défige-le d'abord pour le déplacer")
    d0, now, jobs, _, loaded, live, busy = await _context(None)
    order = [j["key"] for j in _ordered(jobs, d["order"], d["pins"])]
    did = key.split(":")[0]
    move = [k for k in order if (k.split(":")[0] == did if whole else k == key) and k not in d["locked"]]
    if not move:
        raise PlanError("Plateau inconnu du planning")
    keep = [k for k in order if k not in set(move)]
    return await arrange({"order": keep + move, "pins": {k: None for k in move}})


def _replace(order: list, old: list, new: list) -> list:
    """Les rangs de `old` dans `order`, occupes par `new` dans son ordre."""
    it, olds = iter(new), set(old)
    return [next(it) if k in olds else k for k in order]


# ── les rappels (boucle des notifications) ───────────────────────────────────
async def tick(cfg, r: dict | None = None) -> int:
    """Toutes les 15 min : a l'heure prevue, imprimante libre, « a lancer » ; une fois en retard d'une demi-heure,
    un second rappel. Un rappel par travail."""
    from . import notify as N
    r = r or await plan()
    sent = 0
    d = await _load()
    changed = False
    for x in r.get("deadlines") or []:
        k = f"due:{x['design_id']}"
        if x["ok"]:
            if d["notified"].pop(k, None):
                changed = True
            continue
        if d["notified"].get(k):
            continue
        d["notified"][k] = 1
        changed = True
        end = datetime.fromisoformat(x["end"])
        today = datetime.fromisoformat(r["now"]).date()
        await N.notify("plan_deadline", f"🎯 {x['title']} ne sera pas fini avant le {_due_txt(x['due'])}",
                       f"Son dernier plateau finit {_day_fr(end, today)} à {_fmt(end)}, {_late(-x['margin_min'])} trop tard.\n"
                       f"Le planning propose quoi faire.", click=N.app_link(cfg, "/prints?tab=calendar"), priority=3)
        sent += 1
    if changed:
        await _save(d)
    st, j = r.get("status"), (r.get("jobs") or [None])[0]
    if not st or not j or st["state"] != "due":
        return sent
    d = await _load()
    seen = d["notified"].get(j["key"]) or 0
    step = 2 if st["late_min"] >= 30 else 1
    if seen >= step:
        return 0
    d["notified"] = {k: v for k, v in d["notified"].items() if k in {x["key"] for x in r["jobs"]} or k.startswith("due:")}
    d["notified"][j["key"]] = step
    await _save(d)
    name = _title(j)
    lines = [f"⏱ {_dur(j['seconds'])} · prévue à {_fmt(datetime.fromisoformat(r['now']) - timedelta(minutes=st['late_min']))}"]
    if j["load"]:
        lines.append(f"🧵 À charger : {', '.join(j['load'])}")
    nx = r["jobs"][1] if len(r["jobs"]) > 1 else None
    if nx:
        lines.append(f"Ensuite : {nx['title']}")
    title = f"⏰ En retard de {_dur(st['late_min'] * 60)} : {name}" if step == 2 else f"⏰ À lancer : {name}"
    await N.notify("plan_due", title, "\n".join(lines), click=N.app_link(cfg, "/prints?tab=calendar"), priority=3)
    return sent + 1


# ── la tache de fond (05/11/2026) ────────────────────────────────────────────
# Toutes les 5 minutes, et des qu'une impression commence ou finit : le planning est refait (ce qui a pris du retard
# decale la suite, dans les consignes), garde (PRINT_PLAN_SNAP : le dernier etat, ce qui a glisse et pourquoi, les
# debordements), et les rappels partent. L'ordre et les jours poses restent ceux de l'utilisateur : seuls ses
# rangements et « Optimiser » les changent ; un rangement a la main n'est pas compte comme un decalage.
SNAP_KEY = "PRINT_PLAN_SNAP"
PERIOD = 300
_KICK = [None]


def kick() -> None:
    """Une impression commence ou finit : verifier tout de suite (sans attendre les 5 minutes)."""
    ev = _KICK[0]
    if ev is not None:
        ev.set()


async def _snap_load() -> dict:
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, SNAP_KEY, "")
    try:
        d = json.loads(raw) if raw else {}
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def _snap_save(d: dict) -> None:
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    async with AsyncSessionLocal() as db:
        await set_setting(db, SNAP_KEY, json.dumps(d, ensure_ascii=False))


async def _check_view(jobs: list) -> dict | None:
    """Pour la page : la derniere verification, et sur chaque plateau decale depuis moins de 24 h, d'ou il vient."""
    snap = await _snap_load()
    if not snap.get("at"):
        return None
    moved = {m["key"]: m for m in snap.get("moved") or []}
    for j in jobs:
        m = moved.get(j["key"])
        if m:
            j["moved"] = {"from": m["from"], "at": m["at"], "why": m.get("why")}
    return {"at": snap["at"], "moved": len([m for m in moved.values() if any(j["key"] == m["key"] for j in jobs)]),
            "overflow": snap.get("overflow") or []}


async def check(cfg=None) -> dict:
    """Une verification : refaire le planning, noter ce qui a change de jour (sauf rangement a la main), les
    debordements, et envoyer les rappels (« a lancer », date limite, decalage)."""
    from . import notify as N
    if cfg is None:
        cfg = await N._load()
    d0 = await _load()
    r = await plan()
    now = r["now"]
    snap = await _snap_load()
    prev = snap.get("days") or {}
    same_rev = snap.get("rev") == int(d0.get("rev") or 0)
    today = datetime.fromisoformat(now).date()
    moved = [m for m in snap.get("moved") or []
             if (datetime.fromisoformat(now) - datetime.fromisoformat(m["at"])).total_seconds() < 86400]
    fresh = []
    if same_rev:
        for j in r["jobs"]:
            was = prev.get(j["key"])
            if was and was != j["day"]:
                # la cause d'abord, puis ce qui l'a poussee a ce jour-la (une plage d'heures, une date posee...)
                cause = ("une impression a fini plus tôt" if was > j["day"] else "l'impression en cours a pris du retard" if r.get("live")
                         else "rien n'a été lancé à l'heure prévue")
                detail = next((x for x in j.get("reasons") or [] if not x.startswith("Posée")), None)
                why = f"{cause} ; {detail[0].lower()}{detail[1:]}" if detail else cause
                m = {"key": j["key"], "title": _title(j), "from": was, "to": j["day"], "at": now, "why": why}
                moved = [x for x in moved if x["key"] != j["key"]] + [m]
                fresh.append(m)
    overflow = [{"kind": "deadline", "text": f"{x['title']} : fini après sa date (avant le {_due_txt(x['due'])})"}
                for x in r.get("deadlines") or [] if not x["ok"]]
    overflow += [{"kind": "long", "text": f"{_title(j)} : plus longue que la plage de fonctionnement"} for j in r["jobs"] if j.get("too_long")]
    last = r["jobs"][-1]["end"] if r["jobs"] else None
    await _snap_save({"at": now, "rev": int((await _load()).get("rev") or 0), "days": {j["key"]: j["day"] for j in r["jobs"]},
                      "moved": moved[-60:], "overflow": overflow, "count": len(r["jobs"]), "last_end": last})
    sent = 0
    # les rappels : a lancer, date limite (la logique d'avant, tick)
    if N.enabled_in(cfg, "plan_due") or N.enabled_in(cfg, "plan_deadline"):
        sent += await tick(cfg, r)
    # un decalage : un seul message par verification, qui dit combien et jusqu'ou
    if fresh and N.enabled_in(cfg, "plan_shift"):
        later = [m for m in fresh if m["to"] > m["from"]]
        lines = [f"• {m['title']} : {_day_fr(datetime.fromisoformat(m['from'] + 'T12:00'), today)} → "
                 f"{_day_fr(datetime.fromisoformat(m['to'] + 'T12:00'), today)} ({m['why']})" for m in fresh[:6]]
        if len(fresh) > 6:
            lines.append(f"… et {len(fresh) - 6} autre{'s' if len(fresh) > 7 else ''}")
        await N.notify("plan_shift", f"🔄 Le planning a glissé : {len(fresh)} plateau{'x' if len(fresh) > 1 else ''} "
                       f"{'repoussé' if later else 'avancé'}{'s' if len(fresh) > 1 else ''}", "\n".join(lines),
                       click=N.app_link(cfg, "/prints?tab=calendar"), priority=2)
        sent += 1
    return {"jobs": len(r["jobs"]), "moved": len(fresh), "overflow": len(overflow), "sent": sent}


async def loop(first_delay_s: int = 60):
    """La tache « Planning des impressions » : une verification toutes les 5 minutes, ou des qu'une impression
    commence ou finit (kick)."""
    import asyncio
    from ..core import tasks as _tasks
    _KICK[0] = asyncio.Event()
    await _tasks.sleep("planner", first_delay_s)
    while True:
        try:
            r = await check()
            if r["moved"]:
                logger.info(f"[PLANNING] {r['moved']} plateau(x) decale(s), {r['overflow']} debordement(s)")
        except Exception:
            _tasks.error("planner")
            logger.exception("[PLANNING] verification")
        _tasks.waiting("planner", PERIOD)
        _KICK[0].clear()
        try:
            await asyncio.wait_for(_KICK[0].wait(), PERIOD)
            await asyncio.sleep(20)                      # une impression qui commence : son etat se pose d'abord
        except asyncio.TimeoutError:
            pass
        _tasks.start("planner")

