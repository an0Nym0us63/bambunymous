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
  tz    : decalage horaire du navigateur (minutes), pour la boucle des rappels ;
  chain : {ligne de « A faire »: "plates" | "all"} (06/11/2026) un objet « d'une traite » : "plates", les plateaux d'un
          meme exemplaire se suivent (rien ne s'intercale) ; "all", tous ses plateaux de tous ses exemplaires se suivent.
          Le groupe prend la place de son premier plateau dans la file, et le jour ou celui-ci est pose.
          "soft" (« au mieux ») : regroupes autant que possible, mais les optimiseurs peuvent y intercaler un plateau
          d'un autre objet pour remplir une nuit ou charger moins de filaments ; soft_why {cle: "nuit"|"filaments"}
          dit pourquoi un plateau a ete intercale (le plateau intercale le dit sur sa carte).
  prio  : {ligne de « A faire » | "ligne:plateau": -2..2} (06/11/2026) la priorite d'un modele par rapport aux autres
          modeles, ou d'un plateau par rapport aux autres plateaux de son modele (2 urgent, 1 haute, 0 normale -- absente,
          -1 basse, -2 tres basse). Les optimiseurs la comptent ; une date limite passe avant, les figes et les jours
          figes ne bougent pas pour elle, et un modele retenu reste devant les non retenus.

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
SHIFT_MIN = 180          # un plateau « decale » : son depart a bouge d'au moins 3 h (06/11/2026)
DEFAULTS = {"gap": 15, "run": None, "launch": None, "opt_mode": "mix", "auto_new": "off", "days_off": [], "load_win": [],
            "dur_mode": "off", "dur_pct": 0, "plates": []}
# les plateaux d'impression possedes (06/11/2026) : [{kind, n, name, avoid: [matieres ou sous-types]}] ; vide, le
# planning ne s'occupe pas des plateaux (voir services/plates.py)
# les durees (06/11/2026) : tes impressions durent souvent un peu plus (ou moins) que prevu, en proportion de leur duree.
# dur_mode "off" : les durees telles quelles ; "auto" : corrigees de l'ecart mesure sur tes dernieres impressions ;
# "manual" : de dur_pct % (de -30 a +60)
# les creneaux de chargement (06/11/2026) : [{from, to}] ; vide, on charge a toute heure (de lancement). Sinon un plateau
# qui demande de charger une bobine ne part que dans l'un d'eux (« je ne change de bobine que le matin et le soir »)
# les jours particuliers (06/11/2026) : [{from, to, kind}] ; "absent" : aucun lancement ces jours-la (une impression
# lancee avant finit quand meme) ; "light" (peu dispo) : une seule heure de lancement, la premiere de la plage habituelle
# (on y lance un long qui couvre la journee ; la veille au soir, un long qui y mene)
DAY_KINDS = ("absent", "light")
# les modes d'optimisation (06/11/2026) : au mieux (couleurs et nuits, le meilleur des deux), le moins de changements de
# filament, le plus d'impressions chaque jour (les courtes d'abord), remplir les temps morts (les nuits)
MODES = ("mix", "couleurs", "debit", "nuits")


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
    for k in ("pins", "done", "plan0", "notified", "deadlines", "locked", "chain", "soft_why", "prio", "merge"):
        if not isinstance(d.get(k), dict):
            d[k] = {}
    if not isinstance(d.get("order"), list):
        d["order"] = []
    if not isinstance(d.get("undo"), list):
        d["undo"] = []
    return d


async def undo() -> dict:
    """« Annuler » : le dernier geste defait (l'ordre, les jours et heures figes, les priorites… d'avant)."""
    d = await _load()
    if not d["undo"]:
        raise PlanError("Rien à annuler")
    last = d["undo"].pop()
    for k, v in (last.get("state") or {}).items():
        if k in UNDO_KEYS:
            d[k] = v if v is not None else ([] if k == "order" else {})
    d["plan0"] = {}
    d["rev"] = int(d.get("rev") or 0) + 1
    await _save(d)
    r = await plan()
    r["undone"] = last.get("why")
    return r


# « Annuler » (06/11/2026) : ce qu'un geste change, et qu'on peut remettre comme avant
UNDO_KEYS = ("order", "pins", "locked", "chain", "prio", "done", "deadlines", "soft_why", "merge")


async def _save(d: dict, undo: str | None = None, merge: bool = False) -> None:
    """undo : le nom du geste ; l'etat d'avant (celui enregistre) est garde pour « Annuler » (les 10 derniers).
    merge : le geste continue le precedent (une priorite puis le replacement de ses plateaux) : un seul « Annuler »."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    if undo and not merge:
        prev = await _load()
        state = {k: prev.get(k) for k in UNDO_KEYS}
        if any(state[k] != d.get(k) for k in UNDO_KEYS):
            d["undo"] = ([x for x in d.get("undo") or [] if isinstance(x, dict)] + [
                {"at": datetime.utcnow().isoformat(timespec="seconds"), "why": undo, "state": state}])[-10:]
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
    if isinstance(body.get("days_off"), list):
        out = []
        for x in body["days_off"][:60]:
            try:
                a, b = str(x.get("from")), str(x.get("to") or x.get("from"))
                datetime.strptime(a, "%Y-%m-%d"); datetime.strptime(b, "%Y-%m-%d")
            except (ValueError, AttributeError, TypeError):
                raise PlanError("Jour particulier : une date invalide")
            if x.get("kind") not in DAY_KINDS:
                raise PlanError("Jour particulier : absent ou peu dispo")
            out.append({"from": min(a, b), "to": max(a, b), "kind": x["kind"], "note": str(x.get("note") or "")[:60]})
        d["days_off"] = sorted(out, key=lambda x: x["from"])
    if isinstance(body.get("plates"), list):
        from . import plates as PL
        out = []
        for x in body["plates"][:10]:
            if not isinstance(x, dict) or x.get("kind") not in PL.KINDS:
                raise PlanError("Plateau : un type inconnu")
            try:
                n = max(0, min(9, int(x.get("n") or 0)))
            except (TypeError, ValueError):
                raise PlanError("Plateau : un nombre")
            units = [{"name": str((u or {}).get("name") or "")[:30], "code": str((u or {}).get("code") or "")[:20] or None}
                     for u in (x.get("units") or [])[:n] if isinstance(u, dict)]
            out.append({"kind": x["kind"], "n": n, "name": str(x.get("name") or "")[:40], "units": units,
                        "avoid": [str(a).strip()[:30] for a in (x.get("avoid") or []) if str(a).strip()][:20]})
        d["plates"] = out
    if body.get("dur_mode") in ("off", "auto", "manual"):
        d["dur_mode"] = body["dur_mode"]
    if "dur_pct" in body:
        try:
            d["dur_pct"] = max(-30, min(60, int(body.get("dur_pct") or 0)))
        except (TypeError, ValueError):
            raise PlanError("Durées : un pourcentage")
    if isinstance(body.get("load_win"), list):
        out = []
        for w in body["load_win"][:4]:
            if not isinstance(w, dict) or not _window(w):
                raise PlanError("Un créneau de chargement : de 08:00 à 09:00")
            a, b = _window(w)
            if b - a < 15:
                raise PlanError("Un créneau de chargement d'au moins 15 minutes")
            out.append({"from": w["from"], "to": w["to"]})
        d["load_win"] = out
    if body.get("opt_mode") in MODES:
        d["opt_mode"] = body["opt_mode"]
    # les nouveaux plateaux (un modele retenu, un exemplaire de plus) : en fin de file, ou places selon un mode
    if body.get("auto_new") in ("off",) + MODES:
        d["auto_new"] = body["auto_new"]
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
        # le plateau d'impression que demande chaque plateau (06/11/2026) : dans le 3MF du profil, s'il est deja la
        beds = {}
        if d.get("plates"):
            from . import plates as PL
            prof = (m.get("profile") or {}).get("profile_id")
            for u in units:
                beds[u[0]] = PL.profile_bed(m.get("mw_id") or did.split("~")[0], prof, u[0] or 1)
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
                out.append({"key": f"{did}:{idx}:{c}", "design_id": did, "mw_id": m.get("mw_id") or did.split("~")[0],
                            "title": title, "cover": m.get("cover_url"),
                            "retained": bool(m.get("planned")),   # profil retenu dans « A faire » ; sinon celui par defaut
                            "plate": idx, "plate_name": pname, "plates_total": len(plates), "copy": c, "qty": qty,
                            "seconds": int(secs), "weight_g": wg, "fils": fl, "_obj": obj, "thumb": thumb,
                            "chain": d.get("chain", {}).get(did),
                            "prio_m": int(d.get("prio", {}).get(did) or 0), "prio_p": int(d.get("prio", {}).get(f"{did}:{idx}") or 0),
                            "bed_want": beds.get(idx), "iid": (m.get("profile") or {}).get("instance_id")})
    return out, changed


def _ordered(jobs: list, order: list, pins: dict | None = None) -> list:
    rank = {k: i for i, k in enumerate(order)}
    pos = {j["key"]: i for i, j in enumerate(jobs)}
    # les modeles retenus d'abord, ceux qui ne le sont pas apres (05/11/2026 : planifies quand meme, en priorite basse) ;
    # dans chacun, l'ordre voulu, puis les nouveaux dans l'ordre de « A faire »
    # les retenus toujours devant (06/11/2026) : un non retenu pose sur un jour (la journee couleur les prenait aussi)
    # ne passe plus devant eux ; son jour est ignore tant que son modele n'est pas retenu
    # un modele urgent (06/11/2026) passe devant les autres retenus, quoi qu'en dise l'optimiseur
    seq = sorted(jobs, key=lambda j: (not j.get("retained", True), j.get("prio_m") != 2)
                 + ((0, rank[j["key"]]) if j["key"] in rank else (1, pos[j["key"]])))
    return _chained(_plate_prio(seq, pins or {}))


def _plate_prio(seq: list, pins: dict) -> list:
    """La priorite d'un plateau (06/11/2026) ne joue qu'entre les plateaux de son modele : les places qu'ils occupent dans
    la file sont reprises dans l'ordre de leurs priorites (stable). Ceux poses sur un jour (et les figes) gardent la leur."""
    by = {}
    for i, j in enumerate(seq):
        if j["key"] not in pins:
            by.setdefault(j["design_id"], []).append(i)
    out = list(seq)
    for ix in by.values():
        grp = [seq[i] for i in ix]
        if len(grp) < 2 or not any(j.get("prio_p") for j in grp):
            continue
        for i, j in zip(ix, sorted(grp, key=lambda j: -(j.get("prio_p") or 0))):
            out[i] = j
    return out


def _chained(seq: list) -> list:
    """Les objets « d'une traite » (06/11/2026) : leurs plateaux regroupes a la place du premier d'entre eux.
    "plates" : un groupe par exemplaire (le 1er reste a faire de chaque plateau, puis le 2e…) ; "all" : un seul groupe,
    exemplaire par exemplaire. Dans un groupe, l'ordre de la file (pas celui des numeros) : l'optimiseur peut ainsi
    lancer le plus long en fin de soiree. Chaque plateau groupe porte chain_g."""
    rounds, groups = {}, {}
    for j in seq:
        m = j.get("chain")
        if m not in ("plates", "all"):
            j.pop("chain_g", None)
            continue
        did = str(j["design_id"])
        n = rounds.setdefault((did, j.get("plate")), 0)
        rounds[(did, j.get("plate"))] = n + 1
        j["_round"] = n
        g = did if m == "all" else f"{did}#{n}"
        j["chain_g"] = g
        groups.setdefault(g, []).append(j)
    if not groups:
        return seq
    out, seen = [], set()
    for j in seq:
        g = j.get("chain_g")
        if g is None:
            out.append(j)
        elif g not in seen:
            seen.add(g)
            out += sorted(groups[g], key=lambda x: x["_round"])          # stable : l'ordre de la file dans un exemplaire
    return out


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
        # les jours particuliers : {"AAAA-MM-JJ": "absent" | "light"}
        self.off = {}
        for x in d.get("days_off") or []:
            try:
                a, b = datetime.strptime(x["from"], "%Y-%m-%d"), datetime.strptime(x["to"], "%Y-%m-%d")
            except (ValueError, KeyError, TypeError):
                continue
            while a <= b:
                self.off[a.date().isoformat()] = x.get("kind")
                a += timedelta(days=1)
        # des moments sans lancement (une plage, ou des jours particuliers) : les nuits et les trous se remplissent
        self.limits = bool(self.launch or self.off)
        # les creneaux de chargement
        self.load = [w for w in (_window(x) for x in d.get("load_win") or []) if w]
        self.load_txt = [f"{x.get('from')}–{x.get('to')}" for x in d.get("load_win") or []]

    def load_at(self, c: datetime) -> datetime:
        """Le premier moment, a partir de c, dans un creneau de chargement (c lui-meme s'il y est)."""
        if not self.load:
            return c
        best = None
        for w in self.load:
            for a, b in self._iv(w, c, 3):
                if b > c:
                    t = max(a, c)
                    best = t if best is None or t < best else best
                    break
        return best or c

    def in_load(self, s: datetime) -> bool:
        return not self.load or self.load_at(s) == s

    def _launch_iv(self, c: datetime, horizon: int):
        """Les plages de lancement autour de c, jours particuliers compris : un jour absent n'en a pas, un jour peu dispo
        n'en garde que la premiere heure. Sans plage reglee et sans jour particulier : None (a toute heure)."""
        if not self.launch and not self.off:
            return None
        iv = self._iv(self.launch or (0, 1440), c, horizon)
        out = []
        for a, b in iv:
            k = self.off.get(a.date().isoformat())
            if k == "absent":
                continue
            out.append((a, min(b, a + timedelta(hours=1))) if k == "light" else (a, b))
        return out

    @staticmethod
    def _iv(w, t0: datetime, days: int):
        """Les plages w de la veille de t0 a days jours apres : [(debut, fin)]."""
        d0 = datetime(t0.year, t0.month, t0.day) - timedelta(days=1)
        return [(d0 + timedelta(days=i, minutes=w[0]), d0 + timedelta(days=i, minutes=w[1])) for i in range(days + 2)]

    def earliest(self, c: datetime, secs: float, horizon: int = 30):
        """Le premier debut possible a partir de c : (debut, pourquoi pas c, trop long)."""
        dur = timedelta(seconds=secs)
        runs = self._iv(self.run, c, horizon) if self.run else None
        lnch = self._launch_iv(c, horizon)

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
        # un jour particulier entre les deux : il le dit
        k = next((rules.off.get((c + timedelta(days=i)).date().isoformat()) for i in range((s.date() - c.date()).days + 1)
                  if rules.off.get((c + timedelta(days=i)).date().isoformat())), None)
        if k == "absent":
            return f"Absent ce jour-là (jour particulier) : lancée {nxt}"
        if k == "light":
            return f"Jour peu dispo (une seule heure de lancement) : lancée {nxt}"
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
    # la fin prevue au lancement (05/11/2026) : le debut plus la duree estimee par le fichier tranche ; corrigee de
    # l'ecart habituel quand les durees le sont (06/11/2026) : l'ecart affiche est alors ce que cette impression a de plus
    f = float((d.get("_dur") or {}).get("factor") or 1.0)
    planned = (st + timedelta(seconds=int(p[4] * f))).isoformat(timespec="minutes") if st and p[4] else None
    return {"print_id": p[0], "start": st.isoformat(timespec="minutes") if st else None, "title": p[2] or p[3], "planned_end": planned,
            "planned_pct": round((f - 1) * 100) if abs(f - 1) > 0.005 else 0}


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


_SLOTS = {"n": None}


def _slots() -> int:
    """Les places du planning dans les AMS (06/11/2026) : un filament par place. Les filaments charges, plus les
    emplacements vraiment vides ; une bobine non reconnue occupe sa place (elle ne compte plus comme libre), deux
    bobines du meme filament n'en font qu'un, et la bobine externe n'en est pas une (on charge dans l'AMS). Calcule par
    _context ; sans lui, le nombre d'emplacements."""
    if _SLOTS["n"]:
        return _SLOTS["n"]
    try:
        from ..core.mqtt import get_state
        return max(1, sum(len(a.trays or []) for a in get_state().ams_list or [] if a.id < 254))
    except Exception:
        return 4


def _count_slots(ams: dict) -> int | None:
    try:
        from ..core.mqtt import get_state
        # les AMS (et AMS HT) de la config ; 254/255, les bobines externes, n'en sont pas (deux emplacements vides
        # comptaient : 20 places pour 17 sur une H2C a quatre AMS et un AMS HT)
        trays = [t for a in get_state().ams_list or [] if a.id < 254 for t in a.trays or []]
    except Exception:
        return None
    if not trays:
        return None
    empty = sum(1 for t in trays if t.empty or not (t.filament_type or t.spool_id))
    return max(1, len(ams) + empty)


# ── le planning ──────────────────────────────────────────────────────────────
def place(jobs: list, d: dict, now: datetime, busy_until: datetime | None, loaded: set, slots: int = 4) -> dict:
    """Pose les travaux sur les jours : ceux poses sur un jour d'abord (dans leur ordre), puis la suite de la file
    dans les creux. Rend {jobs (avec start, end, day, reasons, load), days, idle}."""
    rules = Rules(d)
    today = now.date()
    pins = d["pins"]
    # un non retenu n'est pose sur aucun jour : il passe apres les retenus (06/11/2026)
    if any(j.get("retained") is False and j["key"] in pins for j in jobs):
        pins = {k: v for k, v in pins.items() if not any(j["key"] == k and j.get("retained") is False for j in jobs)}
    # un objet « d'une traite » : tous ses plateaux suivent le jour ou est pose le premier (ou aucun)
    if any(j.get("chain_g") for j in jobs):
        pins, first = dict(pins), {}
        for j in jobs:
            g = j.get("chain_g")
            if not g:
                continue
            p0 = first.setdefault(g, pins.get(j["key"]))
            if p0:
                pins[j["key"]] = p0
            else:
                pins.pop(j["key"], None)
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
    # quelle bobine sortir (06/11/2026) : celle dont on se servira le plus tard (ou plus du tout), pas la plus ancienne ;
    # sortir une bobine qui resservira l'apres-midi serait bete
    import bisect
    uses = {}
    for i, x in enumerate(jobs):
        for f in x["fils"]:
            if f.get("filament_id"):
                uses.setdefault(f["filament_id"], []).append(i)
    names = dict(d.get("_names") or {})
    for x in jobs:
        for f in x["fils"]:
            if f.get("filament_id") and f.get("name"):
                names.setdefault(f["filament_id"], f["name"])

    def next_use(fid, after):
        u = uses.get(fid) or []
        i = bisect.bisect_right(u, after)
        return u[i] if i < len(u) else 10 ** 9
    # ce qui reste sur les bobines chargees (06/11/2026) : une impression qui en demande plus videra la bobine en cours
    # de route ; on dit vers quelle heure (au prorata de la duree), pour preparer la suivante. Une bobine chargee
    # ensuite : on ne sait pas laquelle, on la suppose assez pleine
    ams_g = {fid: float(v.get("g") or 0) for fid, v in (d.get("_ams") or {}).items()}
    # les plateaux d'impression (06/11/2026) : le premier de l'ordre de preference qui convient aux filaments (apres un
    # TPU passe sur le PEI texture, le PLA suivant revient sur le SuperTack prefere) ; un changement compte comme une bobine
    from . import plates as PL
    own = PL.owned(d.get("plates"))
    avoid = PL.avoid_map(d.get("plates"))
    ftype = d.get("_ftype") or {}
    bed = {"cur": (d.get("_bed_now") or {}).get("kind")}

    def bed_for(j):
        if not own:
            return None, None, None
        bad = set()
        for f in j["fils"]:
            mt, ft = ftype.get(f.get("filament_id")) or (f.get("type"), None)
            bad |= PL.bad_kinds(mt, ft, avoid)
        ok = [k for k in own if k not in bad]
        want = j.get("bed_want")
        need = ok[0] if ok else (want or bed["cur"])
        warn = None
        if not ok:
            warn = "Aucun de tes plateaux ne convient à ce filament"
        elif want and want != need:
            warn = f"Le profil est prévu pour {PL.KINDS[want]}" + (" (que tu n'as pas)" if want not in own else
                                                                   " (déconseillé pour ce filament)" if want not in ok else "")
        ch = {"from": bed["cur"], "to": need} if need and need != bed["cur"] else None
        bed["cur"] = need or bed["cur"]
        return need, ch, warn

    def put(j, s, why, c, too_long, extra=None):
        nonlocal cursor
        e = s + timedelta(seconds=j["seconds"])
        rs = [r for r in [extra, _reason(why, c, s, j["seconds"], rules, today)] if r]
        if too_long:
            rt = rules.run_txt or {}
            rs.append(f"Plus longue ({_dur(j['seconds'])}) que la plage de fonctionnement ({rt.get('from')}–{rt.get('to')}) : "
                      f"elle ne peut pas finir avant l'arrêt")
        need = [f for f in j["fils"] if f.get("filament_id") and f["filament_id"] not in have]
        mine = {f.get("filament_id") for f in j["fils"] if f.get("filament_id")}
        b_need, b_change, b_warn = bed_for(j)
        runout = []
        for f in j["fils"]:
            fid, g = f.get("filament_id"), f.get("g") or 0
            if not fid or fid not in ams_g or ams_g[fid] is None or fid in {x["filament_id"] for x in need} or not g:
                continue
            if g > ams_g[fid] + 0.5:
                left = max(0.0, ams_g[fid])
                runout.append({"name": names.get(fid) or f.get("name"), "id": fid, "left": round(left), "need": round(g),
                               "at": (s + timedelta(seconds=j["seconds"] * left / g)).isoformat(timespec="minutes")})
                ams_g[fid] = None
            else:
                ams_g[fid] -= g
        for f in need:
            ams_g[f["filament_id"]] = None
        for f in j["fils"]:
            fid = f.get("filament_id")
            if fid:
                if fid in have:
                    have.remove(fid)
                have.append(fid)
        unload, unload_ids = [], []
        here = rank.get(j["key"], 0)
        while len(have) > slots:
            out = [x for x in have if x not in mine]
            if not out:
                break
            v = max(out, key=lambda x: (next_use(x, here), -have.index(x)))
            have.remove(v)
            ams_g.pop(v, None)
            unload.append(names.get(v) or f"filament {v}")
            unload_ids.append(v)
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
                       "load": [names.get(f["filament_id"]) or f["name"] for f in need], "load_ids": [f["filament_id"] for f in need],
                       "unload": unload, "unload_ids": unload_ids, "runout": runout,
                       "free_slot": bool(need) and len(unload) < len(need),
                       "bed": b_need, "bed_change": b_change, "bed_warn": b_warn,
                       "wait_s": int((s - c).total_seconds()) if s > c else 0})
        cursor = e + rules.gap

    def place_fixed():
        fs, _, fj = fixed.pop(0)
        s = max(fs, cursor)
        extra = None if s <= fs + timedelta(minutes=1) else \
            f"Figé à {_fmt(fs)}, parti à {_fmt(s)} : l'imprimante n'était pas libre avant"
        put(fj, s, None, s, False, extra)

    def slot_for(j, c):
        """slot(), et un plateau qui demande de charger une bobine attend un creneau de chargement (06/11/2026). Rend
        (debut, pourquoi, trop long, ce qu'il en dit)."""
        if not rules.load or all(f.get("filament_id") in have for f in j["fils"] if f.get("filament_id")):
            return (*slot(c, j["seconds"]), None)
        c0 = c
        for _ in range(12):
            s, why, tl = slot(rules.load_at(c), j["seconds"])
            if rules.in_load(s) or tl:
                break
            c = s
        txt = None
        if s > c0 + timedelta(minutes=1) and not rules.in_load(c0):
            txt = f"Une bobine à charger : attend le créneau de chargement ({', '.join(rules.load_txt)})"
        return s, why, tl, txt

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
                s, why, too_long, ltxt = slot_for(j, c)
                if s.date() > day and not too_long and i < HORIZON_DAYS:
                    carry.append((j, f"Posée le {day.day}/{day.month:02d} mais n'y tient plus : reportée"))
                    continue
                put(j, s, None if ltxt else why, c, too_long, extra or ltxt)
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
            s, why, too_long, ltxt = slot_for(j, c)
            if s.date() > day and i < HORIZON_DAYS:
                full = True
                continue
            pending.pop(0)
            put(j, s, None if ltxt else why, c, too_long, ltxt)
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


def advice(placed: list, d: dict, now: datetime, dls: list | None = None, fix=None, gain=None) -> list:
    """Les petits conseils : enchainer les memes couleurs, remplir un creux, ce qu'il faut charger, ce qui ne
    peut pas respecter les consignes. Chacun peut porter une action (deplacer un travail).
    gain(action) (06/11/2026) : ce que le planning entier y gagne, selon le mode des consignes. Un deplacement n'est
    conseille que s'il gagne vraiment : sinon il defait ailleurs ce qu'il fait ici (la chaise musicale : enchainer B
    apres A laissait un trou la ou etait B, et le conseil suivant le remettait)."""
    out = []
    tries = [0]

    def good(action):
        if gain is None:
            return True
        if tries[0] >= 14:                            # le temps de la page : au-dela, on ne conseille plus
            return False
        tries[0] += 1
        return gain(action) >= 20
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
        b = next((x for x in placed[i + 2:] if _sig(x) == sa and x["load"] and x["key"] not in pinned
                  and good({"kind": "after", "key": x["key"], "ref": a["key"]})), None)
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
            if not good({"kind": "before", "key": b["key"], "ref": a["key"], "day": s.date().isoformat()}):
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


def _merge_advice(placed: list) -> list:
    """Les regroupements possibles (06/11/2026) : des plateaux d'un meme modele et profil qui tiennent ensemble sur le
    plateau d'impression, d'apres leur taille ; « Appliquer » les regroupe au planning, a faire ensuite dans Bambu Studio."""
    try:
        from .plate_merge import proposals
        out = []
        for p in proposals(placed, _slots())[:3]:
            out.append({"kind": "merge", "icon": "🧩", "conf": p["conf"],
                        "text": f"{p['title']} : les plateaux {', '.join(str(x) for x in p['plates'])} tiennent sur un seul plateau "
                                f"({p['mode']}) : {len(p['keys']) - 1} lancement{'s' if len(p['keys']) > 2 else ''} de moins, "
                                f"{_dur(p['saved_s'])} gagnées. Confiance {p['conf']}. À regrouper ensuite dans Bambu Studio.",
                        "action": {"kind": "merge", "keys": p["keys"]}})
        return out
    except Exception:
        logger.exception("[PLAN] regroupements")
        return []


def _soft_grouped(seq: list) -> list:
    """Les objets « au mieux » regroupes a la place de leur premier plateau (le point de depart des optimiseurs)."""
    groups = {}
    for j in seq:
        if j.get("chain") == "soft":
            groups.setdefault(j["design_id"], []).append(j)
    if not groups:
        return seq
    out, seen = [], set()
    for j in seq:
        if j.get("chain") != "soft":
            out.append(j)
        elif j["design_id"] not in seen:
            seen.add(j["design_id"])
            out += groups[j["design_id"]]
    return out


def optimize(jobs: list, loaded: set, keep: list | None = None, why: dict | None = None) -> list:
    """Un ordre qui enchaine les memes couleurs : a chaque pas, parmi les 8 suivants de la file, celui qui demande le
    moins de filaments a charger (a egalite, le premier de la file). La priorite de la file reste a peu pres tenue."""
    rest = list(jobs)
    have = set(loaded)
    out = []
    while rest:
        # parmi les 24 suivants (05/11/2026 : 8 avant) : un objet peut rester en suspens, le temps d'enchainer les
        # plateaux d'autres objets de memes couleurs ; les dates limites sont gardees ensuite (optimize_plan)
        win = rest[:24]
        cur = out[-1]["design_id"] if out and out[-1].get("chain") == "soft" else None
        # un objet « au mieux » en cours : son plateau suivant passe devant, sauf si un autre charge moins de filaments
        best = min(range(len(win)), key=lambda i: (len(_sig(win[i]) - have), 0 if cur and win[i]["design_id"] == cur else 1, i))
        j = rest.pop(best)
        if why is not None and cur and j["design_id"] != cur and any(x["design_id"] == cur for x in rest):
            why[j["key"]] = "filaments"
        have |= _sig(j)
        out.append(j)
    return out


def _night_waits(r: dict, rules) -> list:
    """Les nuits perdues d'un planning : [(i, attente en secondes)] pour chaque plateau i apres lequel la file attend
    l'heure de lancement (au moins 30 min)."""
    pl, out = r["jobs"], []
    for i in range(len(pl) - 1):
        a, b = pl[i], pl[i + 1]
        free = datetime.fromisoformat(a["end"]) + rules.gap
        wait = (datetime.fromisoformat(b["start"]) - free).total_seconds()
        if wait >= 1800 and rules.earliest(free, b["seconds"])[1] == "launch":
            out.append((i, wait))
    return out


# la priorite d'un modele (06/11/2026) : ce que pese une heure d'attente de chacun de ses plateaux, une normale pesant 1.
# Urgent est en plus une regle (_ordered : devant les autres retenus) ; celle d'un plateau ne joue que dans son modele
PRIO_W = {2: 60.0, 1: 25.0, 0: 1.0, -1: 0.4, -2: 0.15}
PRIOS = (-2, -1, 0, 1, 2)


def _pw(j) -> float:
    return PRIO_W.get(j.get("prio_m") or 0, 1.0)


def prio_cost(r: dict, now: datetime) -> float:
    """Le cout des priorites d'un planning : chaque heure ou un plateau prioritaire attend sa fin coute plus, ou moins pour
    une priorite basse. Tout en normale : 0 (rien ne change pour qui ne s'en sert pas)."""
    return sum((_pw(j) - 1) * (datetime.fromisoformat(j["end"]) - now).total_seconds() / 3600
               for j in r["jobs"] if j.get("prio_m"))


def _by_prio(seq: list) -> list:
    """Le point de depart des optimiseurs : les retenus devant, puis par priorite (stable : l'ordre de la file sinon)."""
    return sorted(seq, key=lambda j: (not j.get("retained", True), -(j.get("prio_m") or 0), -(j.get("prio_p") or 0)))


def mode_score(r: dict, d: dict, now: datetime, mode: str) -> float:
    """Ce que coute un planning selon le mode (plus petit = mieux) : une date limite ratee compte toujours enorme."""
    rules = Rules(d)
    late = 100000 * sum(1 for x in deadlines(r["jobs"], d, now) if not x["ok"])
    loads = sum(len(j.get("load") or []) + (1 if j.get("bed_change") else 0) for j in r["jobs"])
    idle = sum(w for _, w in _night_waits(r, rules)) / 60 if rules.limits else 0
    # le plus d'impressions tot : la somme des heures de fin (les courtes d'abord la font baisser)
    ends = sum((datetime.fromisoformat(j["end"]) - now).total_seconds() / 3600 for j in r["jobs"]) / max(1, len(r["jobs"]))
    late += prio_cost(r, now)                         # les priorites, dans tous les modes (sous les dates limites)
    if mode == "couleurs":
        return late + 60 * loads + 0.05 * idle + ends
    if mode == "debit":
        return late + 10 * ends + 2 * loads
    if mode == "nuits":
        return late + idle + 5 * loads
    return late + idle + 30 * loads + ends


def auto_insert(jobs: list, d: dict, now: datetime, busy, loaded: set, new: list, mode: str, fair: bool = False) -> list:
    """Les nouveaux plateaux places selon le mode (06/11/2026), sans toucher a l'ordre des autres. Chacun cherche en deux
    temps : une place sur vingt dans toute la file, puis toutes les places autour de la meilleure (une quarantaine
    d'essais : un modele de 13 plateaux ne fait pas attendre la page). Rend l'ordre."""
    import time as _t
    t_end = _t.monotonic() + 6
    order = [j["key"] for j in _ordered(jobs, d["order"], d["pins"])]
    for k in new:
        if k not in order or k in d["locked"] or k in d["pins"]:
            continue
        rest = [x for x in order if x != k]
        tried = {}

        def at(i):
            if i in tried or i < 0 or i > len(rest):
                return
            o = rest[:i] + [k] + rest[i:]
            r = place(_ordered(jobs, o, d["pins"]), d, now, busy, loaded, _slots())
            # fair (06/11/2026, un nouveau venu) : chaque plateau deja prevu qu'il double coute ; il ne passe devant que pour
            # un vrai gain (une bobine, une nuit). Sinon un modele court se mettait en tete (la fin moyenne de la file avancait)
            tried[i] = (mode_score(r, d, now, mode) + (6 * (len(rest) - i) if fair else 0)) if any(j["key"] == k for j in r["jobs"]) else None
        step = max(1, len(rest) // 20)
        for i in list(range(0, len(rest) + 1, step)) + [len(rest)]:
            at(i)
        ok = {i: v for i, v in tried.items() if v is not None}
        if ok and _t.monotonic() < t_end:
            b = min(ok, key=ok.get)
            for i in range(b - step + 1, b + step):
                at(i)
        ok = {i: v for i, v in tried.items() if v is not None}
        if ok:
            b = min(ok, key=ok.get)
            order = rest[:b] + [k] + rest[b:]
    return order


def night_fill(jobs: list, order: list, d: dict, now: datetime, busy, loaded: set, movable: set, rounds: int = 40,
               why: dict | None = None, budget: float | None = None) -> list:
    """Remplir les nuits (06/11/2026). Avec des heures de lancement (on lance de 8 h a 00 h 30) et l'imprimante qui a le
    droit de tourner apres, le dernier plateau lance avant la coupure doit finir au plus pres de la prochaine heure de
    lancement, moins la pause : il imprime la nuit et le suivant part a 8 h pile.
    Pour chaque nuit perdue, dans l'ordre, on essaie (deplacables seulement : ni figes ni au jour fige) :
      - dans l'objet du dernier lance (« d'une traite » : il reste groupe), un autre de ses plateaux a sa place ;
      - un long plateau d'un autre objet (libre), avance juste avant l'objet du dernier lance (ou avant lui) ;
    chaque essai est simule sur tout le planning ; on garde celui qui reduit le plus le temps mort de toutes les nuits
    (au moins 20 min). Les dates limites sont rattrapees ensuite (optimize_plan)."""
    rules = Rules(d)
    if not rules.limits:
        return order
    order = list(order)
    def sim(o):
        return place(_ordered(jobs, o, d["pins"]), d, now, busy, loaded, _slots())
    def total(r):
        # d'abord le temps mort de toutes les nuits (le travail fini au plus tot) ; a egalite, les nuits proches
        # comptent plus : remplir mieux une nuit decale la suite et le temps gagne reapparait souvent la nuit d'apres
        # les priorites comptent avec (06/11/2026) : remplir une nuit ne fait pas reculer un urgent
        ws = [w for _, w in _night_waits(r, rules)]
        pc = 60 * prio_cost(r, now)
        return (sum(ws) + pc, sum(w * 0.85 ** k for k, w in enumerate(ws)) + pc)
    r = sim(order)
    cur = total(r)
    seen = set()
    import time as _t
    t_end = _t.monotonic() + budget if budget else None
    for _ in range(rounds):
        if t_end and _t.monotonic() > t_end:
            break                                     # le temps imparti (le mode intelligent en fait plusieurs)
        pl = r["jobs"]
        pos = set(order)
        night = next(((i, w) for i, w in _night_waits(r, rules) if pl[i]["day"] not in seen), None)
        if not night:
            break
        i, _w = night
        a = pl[i]
        a_s = datetime.fromisoformat(a["start"])
        target = rules.earliest(datetime.fromisoformat(a["end"]) + rules.gap, 60)[0] - rules.gap
        want = (target - a_s).total_seconds()             # la duree ideale du dernier lancement
        ga = a.get("chain_g")
        # ou inserer un plateau d'un autre objet : avant le debut de l'objet du dernier lance, sinon avant lui
        head = next((x["key"] for x in pl if ga and x.get("chain_g") == ga), a["key"])
        tries = []
        # un long plateau de l'objet en cours (ou libre, si le dernier lance l'est), pose apres le dernier lance puis
        # apres 1, 2… des suivants : les petits passent devant dans la soiree et le long part au plus tard, juste avant
        # la coupure (echanger deux plateaux ne changeait rien : la soiree finissait a la meme heure)
        if a["key"] in movable and a["key"] in pos:
            same = [x for x in pl if x["key"] != a["key"] and x["key"] in movable and x["key"] in pos
                    and x.get("chain_g") == ga and x["seconds"] > a["seconds"] + 1800
                    and (x.get("retained", True) or not a.get("retained", True))]
            same.sort(key=lambda x: abs(x["seconds"] - want))
            follow = [y["key"] for y in pl[i:i + 8] if y.get("chain_g") == ga and y["key"] in pos]
            for x in same[:5]:
                tries += [("after", x["key"], f) for f in follow if f != x["key"]]
                tries.append(("swap", x["key"], a["key"]))
        others = [x for x in pl[i + 1:] if not x.get("chain_g") and x["key"] in movable and x["key"] in pos
                  and x["seconds"] > a["seconds"] + 1800 and (x.get("retained", True) or not a.get("retained", True))]
        others.sort(key=lambda x: abs(x["seconds"] - want))
        if ga and head in pos:
            tries += [("before", x["key"], head) for x in others[:6]]
        best = None
        for how, k, ref in tries:
            if how == "swap":
                o = list(order)
                ia, ib = o.index(k), o.index(ref)
                o[ia], o[ib] = o[ib], o[ia]
            else:
                o = [x for x in order if x != k]
                o.insert(o.index(ref) + (1 if how == "after" else 0), k)
            rr = sim(o)
            t = total(rr)
            if (t[0] + 1200 < cur[0] or (t[0] <= cur[0] and t[1] + 1200 < cur[1])) and (best is None or t < best[0]):
                best = (t, o, rr, k)
        if best:
            cur, order, r = best[0], best[1], best[2]       # cette nuit peut encore s'ameliorer : on y revient
            if why is not None:
                why[best[3]] = "nuit"
        else:
            seen.add(a["day"])
    return order


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
    ams = await Q._ams_stock()
    loaded = set(ams.keys())
    d["_ams"] = ams
    _SLOTS["n"] = _count_slots(ams)
    # les filaments de la file et ceux charges (06/11/2026) : leur nom complet (« TPU 95A Bambu · Noir », pour les cartes et
    # les notifications) et leur sous-type (les plateaux d'impression)
    d["_names"] = {int(k): v.get("name") for k, v in stock_of.items() if v.get("name")}
    d["_ftype"] = {}
    try:
        from sqlalchemy import select
        from ..db.session import AsyncSessionLocal
        from ..models.filament import Filament
        ids = list({int(k) for k in stock_of} | {int(f) for f in loaded})
        if ids:
            async with AsyncSessionLocal() as db:
                for fid, nm, mt, ft, br, col, arr, mct, fin in (await db.execute(select(
                        Filament.id, Filament.name, Filament.material, Filament.fila_type, Filament.manufacturer, Filament.color,
                        Filament.colors_array, Filament.multicolor_type, Filament.fila_finish).where(Filament.id.in_(ids)))).all():
                    d["_names"][int(fid)] = fil_label(nm, mt, ft, br)
                    d["_ftype"][int(fid)] = (mt, ft)
                    # sa pastille (06/11/2026) : couleurs, multicolore, finition
                    d.setdefault("_fcol", {})[int(fid)] = {"color": col, "colors_array": arr, "multicolor_type": mct, "fila_finish": fin,
                                                          "name": nm, "fila_type": ft}
    except Exception:
        logger.exception("[PLANNING] noms des filaments")
    jobs, changed = _jobs(q.get("models") or [], d, stock_of)
    # les durees corrigees (06/11/2026) : en proportion de la duree de chaque plateau
    st = await duration_stats()
    f = dur_factor(d, st)
    d["_dur"] = {**st, "mode": d.get("dur_mode") or "off", "factor": round(f, 3)}
    if abs(f - 1) > 0.005:
        for j in jobs:
            j["est_seconds"] = j["seconds"]
            j["seconds"] = int(j["seconds"] * f)
    jobs = _merged(jobs, d)
    if d.get("plates"):
        from . import plates as PL
        d["_bed_now"] = await PL.mounted(d.get("plates"))
    d["_stock"] = await _stock_ledger(stock_of)
    live = _live()
    busy = now + timedelta(minutes=live[0]) if live else None
    return d, now, jobs, changed or tz is not None, loaded, live, busy


_DUR = {"at": None, "v": None}


async def duration_stats() -> dict:
    """L'ecart entre la duree prevue et la duree reelle (06/11/2026), sur les 40 dernieres impressions reussies d'au
    moins 20 min : la mediane du rapport (reelle, pauses deduites / prevue). Gardee une demi-heure."""
    now = datetime.utcnow()
    if _DUR["at"] and (now - _DUR["at"]).total_seconds() < 1800:
        return _DUR["v"]
    v = {"ratio": 1.0, "n": 0, "pct": 0}
    try:
        from sqlalchemy import select
        from ..db.session import AsyncSessionLocal
        from ..models.print_history import Print
        async with AsyncSessionLocal() as db:
            rows = (await db.execute(select(Print.estimated_seconds, Print.duration_seconds, Print.paused_seconds)
                                     .where(Print.status == "SUCCESS", Print.estimated_seconds > 1200, Print.duration_seconds > 1200)
                                     .order_by(Print.print_date.desc()).limit(40))).all()
        rs = sorted(r for r in ((float(dur) - float(pz or 0)) / float(est) for est, dur, pz in rows) if 0.5 < r < 2.5)
        if len(rs) >= 5:
            m = rs[len(rs) // 2] if len(rs) % 2 else (rs[len(rs) // 2 - 1] + rs[len(rs) // 2]) / 2
            v = {"ratio": round(m, 3), "n": len(rs), "pct": round((m - 1) * 100)}
    except Exception:
        logger.exception("[PLANNING] durees")
    _DUR.update(at=now, v=v)
    return v


def dur_factor(d: dict, st: dict) -> float:
    if d.get("dur_mode") == "auto":
        return float(st.get("ratio") or 1.0)
    if d.get("dur_mode") == "manual":
        return 1 + int(d.get("dur_pct") or 0) / 100
    return 1.0


def fil_label(name, material=None, fila_type=None, brand=None) -> str:
    """Le nom complet d'un filament (06/11/2026) : « TPU 95A Bambu · Noir », « PLA Matte Sunlu · Blanc »."""
    n = str(name or "").strip()
    t = str(fila_type or material or "").strip()
    b = str(brand or "").strip().replace("Bambu Lab", "Bambu")
    if t and n.lower().startswith(t.lower()):
        t = ""
    head = " ".join(x for x in (t, b) if x)
    return f"{head} · {n}" if head and n else head or n or "?"


def _merged(jobs: list, d: dict) -> list:
    """Les plateaux regroupes (06/11/2026, d["merge"] : {id: [cles]}) : un seul travail, a la place du premier, pour
    tous ; sa duree, celle de ses plateaux moins un lancement par plateau regroupe ; ses filaments, ceux de tous. Un
    regroupement dont il ne reste qu'un plateau (les autres imprimes, ou sortis de la file) s'efface."""
    from .plate_merge import PREP_S
    if not d.get("merge"):
        return jobs
    by = {j["key"]: j for j in jobs}
    gone, drop = set(), []
    for gid, keys in list(d["merge"].items()):
        there = [k for k in keys if k in by and k not in gone]
        if len(there) < 2:
            drop.append(gid)
            continue
        ms = [by[k] for k in there]
        head = dict(ms[0])
        fl = {}
        for x in ms:
            for f in x["fils"]:
                k = f.get("filament_id") or f.get("name")
                if k in fl:
                    fl[k] = {**fl[k], "g": round((fl[k].get("g") or 0) + (f.get("g") or 0), 1)}
                else:
                    fl[k] = dict(f)
        head.update(seconds=max(60, sum(x["seconds"] for x in ms) - PREP_S * (len(ms) - 1)), fils=list(fl.values()),
                    merged=there, merged_plates=[x["plate"] for x in ms], merge_id=gid,
                    plate_name=f"Regroupés : plateaux {', '.join(str(x['plate']) for x in ms)}",
                    weight_g=round(sum(x.get("weight_g") or 0 for x in ms), 1))
        by[there[0]] = head
        gone.update(there[1:])
    for gid in drop:
        d["merge"].pop(gid, None)
    return [by[j["key"]] for j in jobs if j["key"] not in gone]


async def merge(keys: list | None = None, gid: str | None = None) -> dict:
    """Regrouper ces plateaux (06/11/2026 : imprimes ensemble, un seul lancement), ou defaire le regroupement gid."""
    d = await _load()
    if gid:
        d["merge"].pop(str(gid), None)
        d["plan0"] = {}
        await _save(d, "Dégrouper")
        return await plan()
    ks = [str(k) for k in (keys or [])][:12]
    if len(ks) < 2:
        raise PlanError("Il faut au moins deux plateaux")
    taken = {k for v in d["merge"].values() for k in v}
    if any(k in taken for k in ks):
        raise PlanError("Un de ces plateaux est déjà regroupé")
    n = 1
    while f"m{n}" in d["merge"]:
        n += 1
    d["merge"][f"m{n}"] = ks
    d["plan0"] = {}
    d["rev"] = int(d.get("rev") or 0) + 1
    await _save(d, "Regrouper")
    return await plan()


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
    # le plateau fige qu'on vient de lancer (06/11/2026) : une impression de ce modele a demarre et un de ses plateaux
    # etait fige dans les 3 h -- c'est lui (lance un peu en avance ou en retard). Son figeage tombe : il restait fige,
    # repousse apres l'impression en cours. Le compte des plateaux, lui, suit deja l'impression en cours
    if live and live[2]:
        for k, at in list(d["locked"].items()):
            if k.split(":")[0].split("~")[0] == str(live[2]) and abs((datetime.fromisoformat(at) - now).total_seconds()) <= 3 * 3600:
                d["locked"].pop(k, None)
                d["pins"].pop(k, None)
                dirty = True
                logger.info(f"[PLAN] {k} : fige a {at}, l'impression en cours de ce modele l'a lance : defige")
                break
    # les nouveaux plateaux (06/11/2026) : places selon le mode choisi dans les consignes, sans toucher aux autres ;
    # « known » garde ceux deja vus (la premiere fois, tous le sont : rien ne bouge)
    known = d.get("known")
    cur = [j["key"] for j in jobs]
    if not isinstance(known, list):
        d["known"] = cur
        dirty = True
    else:
        ks = set(known)
        new = [k for k in cur if k not in ks]
        if new and d.get("auto_new") in MODES:
            try:
                d["order"] = auto_insert(jobs, d, now, busy, loaded, new, d["auto_new"], fair=True)
                d["rev"] = int(d.get("rev") or 0) + 1
                jobs = _ordered(jobs, d["order"], d["pins"])
                logger.info(f"[PLAN] {len(new)} nouveau(x) plateau(x) place(s) en mode {d['auto_new']}")
            except Exception:
                logger.exception("[PLAN] placement des nouveaux plateaux")
        if new or len(ks) != len(cur):
            d["known"] = cur
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
    # un objet « au mieux » coupe : les plateaux places entre deux de ses morceaux disent qu'ils y sont intercales
    soft = {}
    seq = sorted(r["jobs"], key=lambda x: x["start"])
    for i, j in enumerate(seq):
        if j.get("chain") == "soft":
            soft.setdefault(j["design_id"], []).append(i)
    for did, ix in soft.items():
        for x in seq[ix[0]:ix[-1] + 1]:
            # un plateau d'un autre objet « au mieux » qui ne fait que continuer le sien ne s'annonce pas
            why = d["soft_why"].get(x["key"]) or (None if x.get("chain") == "soft" else "optimiser")
            if x["design_id"] != did and why and not x.get("intercalated"):
                x["intercalated"] = {"in": seq[ix[0]]["title"], "why": why}
    dls = deadlines(r["jobs"], d, now)
    due_of = {x["design_id"]: x for x in dls}
    for j in r["jobs"]:
        j.pop("_obj", None)
        j.pop("_round", None)
        x = due_of.get(j["design_id"])
        if x:
            j["due"], j["due_ok"] = x["due"], x["ok"]

    # ce qu'un conseil fait gagner au planning entier (06/11/2026), selon le mode des consignes : le deplacement simule
    mode = d.get("opt_mode") if d.get("opt_mode") in MODES else "mix"
    cur_keys = [j["key"] for j in sorted(r["jobs"], key=lambda x: x["start"])]
    base_score = [None]

    def gain(a):
        k, ref = a["key"], a["ref"]
        if k not in cur_keys or ref not in cur_keys:
            return 0
        o = [x for x in cur_keys if x != k]
        o.insert(o.index(ref) + (1 if a["kind"] == "after" else 0), k)
        pins = dict(d["pins"])
        rj = next((x for x in r["jobs"] if x["key"] == ref), None)
        if a["kind"] == "before" and rj and a.get("day") and a["day"] != next((x["day"] for x in r["jobs"] if x["key"] == k), None):
            pins[k] = rj["day"]
        dd = {**d, "pins": pins}
        if base_score[0] is None:
            base_score[0] = mode_score(place(_ordered(jobs, cur_keys, d["pins"]), d, now, busy, loaded, _slots()), d, now, mode)
        return base_score[0] - mode_score(place(_ordered(jobs, o, pins), dd, now, busy, loaded, _slots()), dd, now, mode)

    def fix(ks):
        # en tete de file, cet objet tiendrait-il sa date ?
        o = ks + [j["key"] for j in jobs if j["key"] not in set(ks)]
        rr = place(_ordered(jobs, o, d["pins"]), d, now, busy, loaded, _slots())
        return all(x["ok"] for x in deadlines(rr["jobs"], d, now) if x["keys"] and x["keys"][0] in set(ks))
    return {"settings": {k: d[k] for k in DEFAULTS}, "now": now.isoformat(timespec="minutes"),
            "busy_until": busy.isoformat(timespec="minutes") if busy else None,
            "live": ({"name": live[1], "design_id": live[2], "remaining_min": live[0], **(await _live_print(d))} if live else None),
            "dur": d.get("_dur"), "summary": plan_metrics(r, d, now), "bed_now": d.get("_bed_now"), "fcolors": d.get("_fcol") or {},
            "undo": ({"why": d["undo"][-1].get("why"), "at": d["undo"][-1].get("at")} if d["undo"] else None),
            "prio": d["prio"], "jobs": r["jobs"], "days": r["days"], "advice": advice(r["jobs"], d, now, dls, fix, gain) + _merge_advice(r["jobs"]),
            "status": status,
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
    await _save(d, "Fait" if not undo else "Retiré des faits")
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
    await _save(d, "Date limite")
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
            and j["key"] not in d["locked"] and j.get("retained", True)                 # les retenus seulement (06/11/2026)
            and d["pins"].get(j["key"], day) == day]                                   # ni un jour fige ailleurs
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
    out = await arrange({"order": rest[:at] + chosen + rest[at:], "pins": {k: day for k in chosen}}, "Journée couleur")
    out["color_day"] = {"placed": len(chosen), "only": len([k for k in chosen if k in set(only)]), "no_room": no_room,
                        "needs_load": len(needs_load)}
    return out


async def arrange(body: dict, why: str = "Rangement", merge: bool = False) -> dict:
    """Ranger : {order: [cles] (l'ordre voulu, en entier ou le debut), pins: {cle: jour|null}}. Le planning
    repart de la (avance et retard se comptent depuis ce rangement). Un plateau fige ne se pose pas ailleurs."""
    d = await _load()
    for k, v in (body.get("pins") or {}).items():
        if str(k) in d["locked"] and v != d["pins"].get(str(k)):
            raise PlanError("Ce plateau est figé : défige-le d'abord pour le déplacer")
    if isinstance(body.get("soft_why"), dict):
        d["soft_why"] = {str(k): str(v)[:20] for k, v in body["soft_why"].items()}
    # les regroupements de l'apercu de l'optimiseur (06/11/2026), appliques avec son ordre
    for ks in (body.get("merge") or [])[:20]:
        ks = [str(k) for k in ks][:12] if isinstance(ks, list) else []
        taken = {k for v in d["merge"].values() for k in v}
        if len(ks) >= 2 and not any(k in taken for k in ks):
            n = 1
            while f"m{n}" in d["merge"]:
                n += 1
            d["merge"][f"m{n}"] = ks
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
    await _save(d, why, merge)
    return await plan()


def plan_metrics(r: dict, d: dict, now: datetime) -> dict:
    """Les chiffres d'un planning (06/11/2026), pour comparer avant et apres : bobines a charger, nuits perdues et leur
    temps mort, dates limites ratees, quand tout est fini, et la fin moyenne (en heures d'ici)."""
    rules = Rules(d)
    w = _night_waits(r, rules) if rules.limits else []
    js = r["jobs"]
    return {"loads": sum(len(j.get("load") or []) for j in js), "beds": sum(1 for j in js if j.get("bed_change")), "nights": len(w), "idle_min": int(sum(x for _, x in w) // 60),
            "late": sum(1 for x in deadlines(js, d, now) if not x["ok"]), "end": max((j["end"] for j in js), default=None),
            "avg_h": round(sum((datetime.fromisoformat(j["end"]) - now).total_seconds() / 3600 for j in js) / max(1, len(js)), 1),
            "plates": len(js)}


async def optimize_plan(day: str | None = None, start: str | None = None, mode: str | None = None,
                        preview: bool = False, keep: bool = False, merge_ok: bool = False) -> dict:
    """« Optimiser » : toute la file, ou un seul jour (ses travaux remis dans un ordre qui enchaine les couleurs).
    start (06/11/2026) : « a partir de » ce jour ; ce qui est prevu avant reste a sa place, dans son ordre, et seule la
    suite est reordonnee (couleurs, nuits, dates limites)."""
    # regrouper d'office (06/11/2026, au choix) : les regroupements surs (confiance haute) d'abord ; en apercu, l'ordre
    # rendu les suppose faits (« Appliquer » les enregistre)
    merged_new = []
    if merge_ok and not day:
        from .plate_merge import proposals
        r0 = await plan()
        merged_new = [p["keys"] for p in proposals(r0["jobs"], _slots()) if p["conf"] == "haute"]
        if merged_new and not preview:
            for ks in merged_new:
                try:
                    await merge(ks)
                except PlanError:
                    pass
    d, now, jobs, _, loaded, live, busy = await _context(None)
    if merged_new and preview:
        n0 = len(d["merge"])
        for i_, ks in enumerate(merged_new):
            d["merge"][f"p{i_}"] = ks
        jobs = _merged(jobs, d)
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
        sw = {}
        best = optimize(_soft_grouped(on), before, why=sw)
        # sans heures de lancement : le plus long en dernier, il imprime pendant la nuit ou la fin de journee
        if len(best) > 2 and not Rules(d).limits:
            long_i = max(range(len(best)), key=lambda i: best[i]["seconds"])
            if best[long_i]["seconds"] >= 4 * 3600:
                best.append(best.pop(long_i))
        # le jour garde sa place dans l'ordre general : ses travaux reprennent leurs rangs, dans le nouvel ordre
        order = _replace([j["key"] for j in r["jobs"]], [j["key"] for j in on], [j["key"] for j in best])
        # avec des heures de lancement : le dernier de la soiree finit au plus pres de l'heure ou l'on relance
        if Rules(d).limits:
            pins = {**d["pins"], **{j["key"]: day for j in best}}
            order = night_fill(jobs, order, {**d, "pins": pins}, now, busy, loaded, {j["key"] for j in best}, why=sw)
        keep = {k: v for k, v in d["soft_why"].items() if k not in {j["key"] for j in on}}
        return await arrange({"order": order, "pins": {j["key"]: day for j in best}, "soft_why": {**keep, **sw}}, "Optimiser la journée")
    # a partir d'un jour : les plateaux prevus avant, dans leur ordre, en tete, et intouchables
    head, start_loaded = [], set(loaded)
    if start:
        try:
            datetime.strptime(start, "%Y-%m-%d")
        except ValueError:
            raise PlanError("Jour invalide")
        r0 = place(jobs, d, now, busy, loaded, _slots())
        head = [j["key"] for j in sorted(r0["jobs"], key=lambda x: x["start"]) if j["day"] < start]
        for j in r0["jobs"]:
            if j["key"] in set(head):
                start_loaded |= _sig(j)
    hs = set(head)
    base = head + [j["key"] for j in jobs if j["key"] not in hs]
    free = [j for j in jobs if j["key"] not in d["pins"] and j["key"] not in d["locked"] and j["key"] not in hs]
    mode = mode if mode in MODES else (d.get("opt_mode") if d.get("opt_mode") in MODES else "mix")
    sw = {}
    if mode == "debit":
        # le plus d'impressions chaque jour : les plus courtes d'abord (dans l'ordre de priorite des retenus)
        best = sorted(_soft_grouped(free), key=lambda j: (not j.get("retained", True), -(j.get("prio_m") or 0), j["seconds"]))
    elif mode == "nuits":
        best = _soft_grouped(_by_prio(free))          # l'ordre actuel ; les nuits se remplissent ensuite
    else:
        best = optimize(_soft_grouped(_by_prio(free)), start_loaded, why=sw)
    order = _replace(base, [j["key"] for j in free], [j["key"] for j in best])
    # les nuits remplies (06/11/2026) : avant la coupure des lancements, le plateau qui finit au plus pres de la reprise ;
    # les plateaux au jour fige peuvent changer d'heure dans leur journee (leur jour, place() le garde)
    movable = {j["key"] for j in jobs if j["key"] not in d["locked"] and j["key"] not in hs}
    if mode not in ("couleurs", "mix"):               # le moins de changements : on ne remplit pas les nuits a leur prix ;
        order = night_fill(jobs, order, d, now, busy, loaded, movable, why=sw, budget=3)   # l'intelligent le fait plus bas
    # enchainer les couleurs peut gacher les nuits plus que le remplissage ne rattrape : on compare avec l'ordre de
    # depart, nuits remplies aussi, au temps mort des nuits plus 30 min par filament a charger, et on garde le meilleur
    # chaque mode est juge sur son critere ; l'intelligent sur l'ensemble (aucune date limite ratee, le moins de temps
    # mort, le moins de bobines a changer, le travail fini tot)
    import time as _t
    t0 = _t.monotonic()

    # « bouger le moins possible » (06/11/2026, au choix quand on optimise a la main) : chaque plateau qui change de
    # place de plus de deux rangs coute ; seul ce qui rapporte vraiment bouge
    pos0 = {k: i for i, k in enumerate(j["key"] for j in jobs)}

    def moved(o):
        return sum(1 for i, k in enumerate(o) if abs(pos0.get(k, i) - i) > 2)

    def score(o):
        return mode_score(place(_ordered(jobs, o, d["pins"]), d, now, busy, loaded, _slots()), d, now, mode) + (25 * moved(o) if keep else 0)
    if keep:
        order = [j["key"] for j in jobs]               # on part de ton ordre, les retouches ne gardent que ce qui gagne
    cur = score(order)
    if mode == "mix" and not keep:
        # le mode intelligent (06/11/2026) : plusieurs departs (les couleurs enchainees, l'ordre actuel, les plus courtes
        # d'abord) ; les departs bruts se comparent vite, le remplissage des nuits (le plus long) se fait sur le meilleur
        o0 = head + [j["key"] for j in _soft_grouped(jobs) if j["key"] not in hs]
        spt = sorted(_soft_grouped(free), key=lambda j: (not j.get("retained", True), -(j.get("prio_m") or 0), j["seconds"]))
        o1 = _replace(base, [j["key"] for j in free], [j["key"] for j in spt])
        # avec des priorites : aussi l'ordre de la file trie par priorite
        o2 = _replace(base, [j["key"] for j in free], [j["key"] for j in _soft_grouped(_by_prio(free))])
        cands = [(cur, order)] + [(score(o), o) for o in (o0, o1) + ((o2,) if any(j.get("prio_m") or j.get("prio_p") for j in free) else ())]
        cur, order = min(cands, key=lambda c: c[0])
        if Rules(d).limits:
            nf = night_fill(jobs, order, d, now, busy, loaded, movable, why=sw, budget=4)
            sc = score(nf)
            if sc < cur:
                cur, order = sc, nf
    # les retouches, tous modes (06/11/2026) : chaque plateau deplacable essaie 1 a 3 places plus tot ou plus tard, ce
    # qui fait gagner reste ; dans un temps borne (le bouton attend)
    mv = [k for k in order if k in movable and k not in d["pins"]]
    for _pass in range(2):
        better = False
        for k in mv:
            if _t.monotonic() - t0 > (7 if mode == "mix" else 4):
                break
            i = order.index(k)
            for dlt in (-3, -2, -1, 1, 2, 3):
                jx = i + dlt
                if jx < len(head) or jx >= len(order):
                    continue
                o = order[:i] + order[i + 1:]
                o.insert(jx, k)
                sc = score(o)
                if sc + 1 < cur:
                    cur, order, better = sc, o, True
                    break
        if not better:
            break
    # enchainer les couleurs ne doit pas faire deborder une date limite : un objet qui ne tient pas passe en tete,
    # les dates les plus proches d'abord (s'il ne tient pas meme en tete, il y reste : c'est le plus urgent)
    for _ in range(3):
        r = place(_ordered(jobs, order, d["pins"]), d, now, busy, loaded, _slots())
        broke = [x for x in deadlines(r["jobs"], d, now) if not x["ok"]
                 and order[len(head):len(head) + len(x["keys"])] != x["keys"]]
        if not broke:
            break
        front = [k for x in broke for k in x["keys"] if k not in hs]
        order = head + front + [k for k in order if k not in set(front) and k not in hs]
    if preview:
        # l'apercu (06/11/2026) : les chiffres avant et apres ; rien n'est enregistre, « Appliquer » envoie l'ordre
        before = plan_metrics(place(jobs, d, now, busy, loaded, _slots()), d, now)
        after_r = place(_ordered(jobs, order, d["pins"]), d, now, busy, loaded, _slots())
        return {"merge": merged_new, "preview": {"before": before, "after": plan_metrics(after_r, d, now), "mode": mode, "merged": len(merged_new),
                            "moved": moved(order)},              # ceux qui changent de plus de deux rangs
                "order": order, "soft_why": sw}
    return await arrange({"order": order, "soft_why": sw}, "Optimiser la file")


def _cost(r: dict, d: dict, now: datetime, key: str) -> float:
    """Ce que coute un planning, pour choisir ou poser un plateau : une date limite ratee (enorme), un plateau non
    planifiable, chaque filament a charger, et le plateau lui-meme tard (un peu)."""
    c = 0.0
    c += 10000 * sum(1 for x in deadlines(r["jobs"], d, now) if not x["ok"])
    c += 500 * len(r.get("blocked") or [])
    c += 20 * sum(len(j.get("load") or []) for j in r["jobs"])
    c += 0.3 * prio_cost(r, now)
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
    return await arrange({"order": best[1], "pins": {key: None}}, "Au mieux")


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
    return await arrange({"order": pick[1], "pins": {key: day}}, "Sur un jour")


def _rid_ok(rid: str) -> bool:
    """Une ligne de « A faire » : modele, modele~profil, modele~profil~variante (06/11/2026)."""
    parts = str(rid or "").split("~")
    return 1 <= len(parts) <= 3 and all(x.isdigit() for x in parts)


async def set_chain(rid: str, mode) -> dict:
    """Un objet « d'une traite » (06/11/2026) : "plates" (les plateaux d'un exemplaire se suivent), "all" (tous ses
    plateaux, de tous ses exemplaires), ou None (libre, des plateaux d'autres objets peuvent s'intercaler)."""
    d = await _load()
    rid = str(rid or "").strip()
    if not _rid_ok(rid):
        raise PlanError("Objet inconnu")
    if mode in ("plates", "all", "soft"):
        d["chain"][rid] = mode
    elif mode in (None, "", "free"):
        d["chain"].pop(rid, None)
    else:
        raise PlanError("Choix inconnu")
    d["plan0"] = {}
    d["rev"] = int(d.get("rev") or 0) + 1
    await _save(d, "D'une traite")
    r = await plan()
    if mode == "soft":
        # au mieux : ses plateaux regroupes tout de suite, a la place du premier ; les optimiseurs feront le reste
        seq = sorted(r["jobs"], key=lambda x: x["start"])
        keys = [j["key"] for j in _soft_grouped(seq)]
        if keys != [j["key"] for j in seq]:
            return await arrange({"order": keys}, merge=True)
    return r


async def set_prio(target: str, level, targets: list | None = None) -> dict:
    """La priorite (06/11/2026) d'un modele ("ligne") ou d'un plateau ("ligne:plateau") : -2 a 2, 0 la retire. Un modele
    haut, bas ou tres bas : ses plateaux sont aussitot replaces selon le mode d'optimisation des consignes, un par un, sans
    toucher a l'ordre des autres. Urgent, ou un plateau dans son modele : la regle de l'ordre s'en charge. Les figes et ceux
    au jour fige restent ou ils sont. targets (06/11/2026, actions de masse) : plusieurs modeles a la fois, un seul
    replacement."""
    d = await _load()
    ts = [str(x).strip() for x in (targets or [target])][:200]
    for t in ts:
        rid, _, plate = t.partition(":")
        if not _rid_ok(rid) or (plate and not plate.lstrip("-").isdigit()):
            raise PlanError("Objet inconnu")
    try:
        lv = int(level or 0)
    except (TypeError, ValueError):
        raise PlanError("Priorité inconnue")
    if lv not in PRIOS:
        raise PlanError("Priorité inconnue")
    for t in ts:
        if lv:
            d["prio"][t] = lv
        else:
            d["prio"].pop(t, None)
    await _save(d, "Priorité")
    d, now, jobs, _, loaded, live, busy = await _context(None)
    if any(":" in t for t in ts) or lv == 2:
        return await arrange({}, merge=True)        # l'ordre des plateaux du modele, ou urgent : _ordered s'en charge
    rids = {t for t in ts}
    mine = [j["key"] for j in _ordered(jobs, d["order"], d["pins"]) if j["design_id"] in rids]
    mode = d.get("opt_mode") if d.get("opt_mode") in MODES else "mix"
    try:
        order = auto_insert(jobs, d, now, busy, loaded, mine, mode)
    except Exception:
        logger.exception("[PLAN] priorite : replacement")
        return await plan()
    return await arrange({"order": order}, merge=True)


async def lock(key: str, on: bool = True, keys: list | None = None, at: str | None = None) -> dict:
    """Figer un plateau (05/11/2026) : il garde son jour et son heure (ceux du planning a cet instant), pose sur ce
    jour ; rien ne le deplace plus. Defiger le rend au planning (il reste pose sur son jour). keys (06/11/2026) :
    plusieurs a la fois (tout un modele) ; ceux absents du planning sont passes. at (06/11/2026, glisse a une heure dans
    la semaine) : fige a ce jour et cette heure-la plutot qu'a ceux du planning."""
    if at:
        try:
            t = datetime.strptime(str(at)[:16], "%Y-%m-%dT%H:%M")
        except ValueError:
            raise PlanError("Heure invalide")
        d = await _load()
        d["locked"][key] = t.isoformat(timespec="minutes")
        d["pins"][key] = t.date().isoformat()
        d["plan0"] = {}
        d["rev"] = int(d.get("rev") or 0) + 1
        await _save(d, "Glissé à une heure")
        return await plan()
    r = await plan()
    by = {x["key"]: x for x in r["jobs"]}
    d = await _load()
    for k in [str(x) for x in keys][:500] if keys else [key]:
        j = by.get(k)
        if on:
            if not j:
                if keys:
                    continue
                raise PlanError("Plateau introuvable dans le planning (non planifiable ?)")
            d["locked"][k] = j["start"]
            d["pins"][k] = j["day"]
        else:
            d["locked"].pop(k, None)
    d["plan0"] = {}
    d["rev"] = int(d.get("rev") or 0) + 1
    await _save(d, "Figer")
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
    move = [k for k in order if (k.split(":")[0] == did if whole else k == key) and k not in d["locked"]
            and (not whole or k not in d["pins"] or k == key)]       # tout l'objet : les jours figes restent
    if not move:
        raise PlanError("Plateau inconnu du planning")
    keep = [k for k in order if k not in set(move)]
    return await arrange({"order": keep + move, "pins": {k: None for k in move}}, "Plus tard")


def _replace(order: list, old: list, new: list) -> list:
    """Les rangs de `old` dans `order`, occupes par `new` dans son ordre."""
    it, olds = iter(new), set(old)
    return [next(it) if k in olds else k for k in order]


# ── les rappels (boucle des notifications) ───────────────────────────────────
def _bed_name(k) -> str:
    from . import plates as PL
    return PL.KINDS.get(k, k or "?")


def _bed_txt(ch: dict) -> str:
    """« Mets le PEI texturé (à la place du SuperTack) »."""
    return f"🔲 Mets le plateau {_bed_name(ch['to'])}" + (f" (à la place du {_bed_name(ch['from'])})" if ch.get("from") else "")
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
    # le filament a charger (06/11/2026) : un peu avant chaque plateau qui en demande un, lequel, pour quoi, a quelle heure
    if N.enabled_in(cfg, "plan_load"):
        mins = N.options_of(cfg, "plan_load")["minutes"]
        nowt = datetime.fromisoformat(r["now"])
        today = nowt.date()
        for j in (r.get("jobs") or [])[:8]:
            s = datetime.fromisoformat(j["start"])
            if s - nowt > timedelta(minutes=mins):
                break
            k = f"load:{j['key']}"
            if not (j.get("load") or j.get("bed_change")) or d["notified"].get(k):
                continue
            d["notified"][k] = 1
            changed = True
            left = int((s - nowt).total_seconds() // 60)
            when = f"{_day_fr(s, today)} à {_fmt(s)}" + (f", dans {_dur(left * 60)}" if left > 0 else ", maintenant")
            kept = [f.get("name") for f in j.get("fils") or [] if f.get("name") and f.get("name") not in j["load"]]
            body = f"Pour {_title(j)} ({_dur(j['seconds'])}), prévue {when}."
            if j.get("unload"):
                body += f"\nÀ retirer : {', '.join(j['unload'])} (elle ne resservira pas de sitôt)"
            elif j.get("free_slot"):
                body += "\nUn emplacement est libre : rien à retirer"
            if kept:
                body += f"\nDéjà dans l'AMS : {', '.join(dict.fromkeys(kept))}"
            if j.get("bed_change"):
                body += "\n" + _bed_txt(j["bed_change"])
            head = f"🧵 À charger pour {_fmt(s)} : {', '.join(j['load'])}" if j.get("load") else \
                f"🔲 Plateau à changer pour {_fmt(s)} : {_bed_name(j['bed_change']['to'])}"
            # la toucher ouvre la fiche du filament a charger (06/11/2026), sinon le calendrier
            await N.notify("plan_load", head, body,
                           click=N.app_link(cfg, f"/filaments?id={j['load_ids'][0]}" if j.get("load_ids") else "/prints?tab=calendar"), priority=3)
            sent += 1
        # une bobine qui se videra en pleine impression (06/11/2026) : un peu avant, laquelle et vers quelle heure
        for j in (r.get("jobs") or [])[:12]:
            for ro in j.get("runout") or []:
                at = datetime.fromisoformat(ro["at"])
                k = f"runout|{j['key']}|{ro['name']}"
                if at - nowt > timedelta(minutes=mins) or at < nowt - timedelta(minutes=10) or d["notified"].get(k):
                    continue
                d["notified"][k] = 1
                changed = True
                await N.notify("plan_load", f"🔄 Bobine bientôt vide : {ro['name']} vers {_fmt(at)}",
                               f"Pendant {_title(j)} : il reste {ro['left']} g, il en faut {ro['need']} g.\n"
                               f"Prépare une autre bobine de {ro['name']} pour {_day_fr(at, today)} à {_fmt(at)}.",
                               click=N.app_link(cfg, f"/filaments?id={ro['id']}" if ro.get("id") else "/prints?tab=calendar"), priority=3)
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
    ks = {x["key"] for x in r["jobs"]}
    d["notified"] = {k: v for k, v in d["notified"].items() if k in ks or k.startswith("due:") or (k.startswith("load:") and k[5:] in ks)
                   or (k.startswith("runout|") and k.split("|")[1] in ks)}
    d["notified"][j["key"]] = step
    await _save(d)
    name = _title(j)
    lines = [f"⏱ {_dur(j['seconds'])} · prévue à {_fmt(datetime.fromisoformat(r['now']) - timedelta(minutes=st['late_min']))}"]
    if j["load"]:
        lines.append(f"🧵 À charger : {', '.join(j['load'])}")
        if j.get("unload"):
            lines.append(f"↩ À retirer : {', '.join(j['unload'])}")
        elif j.get("free_slot"):
            lines.append("Un emplacement est libre : rien à retirer")
    if j.get("bed_change"):
        lines.append(_bed_txt(j["bed_change"]))
    for ro in j.get("runout") or []:
        lines.append(f"🔄 {ro['name']} se videra vers {_fmt(datetime.fromisoformat(ro['at']))} (reste {ro['left']} g, il en faut {ro['need']}) : prépare une autre bobine")
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
    prev_s = snap.get("starts") or {}
    same_rev = snap.get("rev") == int(d0.get("rev") or 0)
    today = datetime.fromisoformat(now).date()
    moved = [m for m in snap.get("moved") or []
             if (datetime.fromisoformat(now) - datetime.fromisoformat(m["at"])).total_seconds() < 86400]
    fresh = []
    if same_rev:
        for j in r["jobs"]:
            was = prev.get(j["key"])
            # decale : son heure de depart a bouge d'au moins SHIFT_MIN (06/11/2026). Changer de jour ne suffit plus :
            # 5 minutes de retard faisaient passer le dernier plateau de chaque soiree au lendemain matin, et la moitie
            # du planning « glissait »
            s0 = prev_s.get(j["key"])
            big = s0 and abs((datetime.fromisoformat(j["start"]) - datetime.fromisoformat(s0)).total_seconds()) >= SHIFT_MIN * 60
            if big:
                was = was or s0[:10]
                # la cause d'abord, puis ce qui l'a poussee a ce jour-la (une plage d'heures, une date posee...)
                cause = ("une impression a fini plus tôt" if s0 > j["start"] else "l'impression en cours a pris du retard" if r.get("live")
                         else "rien n'a été lancé à l'heure prévue")
                detail = next((x for x in j.get("reasons") or [] if not x.startswith("Posée")), None)
                why = f"{cause} ; {detail[0].lower()}{detail[1:]}" if detail else cause
                m = {"key": j["key"], "title": _title(j), "from": was, "to": j["day"], "at": now, "why": why,
                     "from_s": s0, "to_s": j["start"]}
                moved = [x for x in moved if x["key"] != j["key"]] + [m]
                fresh.append(m)
    # la cause : de combien l'imprimante se libere plus tard (la fin de l'impression en cours), sinon de combien le
    # premier plateau part plus tard. Quelques minutes, ce n'est qu'un glissement, meme si un plateau passe la coupure du
    # soir et part le lendemain matin (8 h plus tard) : ni message ni « decale »
    if fresh:
        bu, bu0 = r.get("busy_until"), snap.get("busy")
        if bu and bu0:
            root = abs((datetime.fromisoformat(bu) - datetime.fromisoformat(bu0)).total_seconds())
        else:
            first = min(r["jobs"], key=lambda x: x["start"])
            root = abs((datetime.fromisoformat(first["start"]) - datetime.fromisoformat(prev_s.get(first["key"], first["start"]))).total_seconds())
        if root < SHIFT_MIN * 60:
            keys = {m["key"] for m in fresh}
            moved = [x for x in moved if x["key"] not in keys or x["at"] != now]
            fresh = []
    overflow = [{"kind": "deadline", "text": f"{x['title']} : fini après sa date (avant le {_due_txt(x['due'])})"}
                for x in r.get("deadlines") or [] if not x["ok"]]
    overflow += [{"kind": "long", "text": f"{_title(j)} : plus longue que la plage de fonctionnement"} for j in r["jobs"] if j.get("too_long")]
    last = r["jobs"][-1]["end"] if r["jobs"] else None
    await _snap_save({"at": now, "rev": int((await _load()).get("rev") or 0), "days": {j["key"]: j["day"] for j in r["jobs"]},
                      "starts": {j["key"]: j["start"] for j in r["jobs"]}, "busy": r.get("busy_until"),
                      "moved": moved[-60:], "overflow": overflow, "count": len(r["jobs"]), "last_end": last})
    sent = 0
    # les rappels : a lancer, date limite (la logique d'avant, tick)
    if N.enabled_in(cfg, "plan_due") or N.enabled_in(cfg, "plan_deadline") or N.enabled_in(cfg, "plan_load"):
        sent += await tick(cfg, r)
    # un decalage de plusieurs heures : un seul message, qui dit le premier plateau decale, de quand a quand, et
    # pourquoi ; la suite le suit (le nombre de plateaux ne disait rien)
    if fresh and N.enabled_in(cfg, "plan_shift"):
        m = min(fresh, key=lambda x: x["to_s"])
        a, b = datetime.fromisoformat(m["from_s"]), datetime.fromisoformat(m["to_s"])
        body = f"{m['title']} : {_day_fr(a, today)} à {_fmt(a)} → {_day_fr(b, today)} à {_fmt(b)} ({m['why']})"
        if len(fresh) > 1:
            body += "\nLa suite suit."
        await N.notify("plan_shift", f"🔄 Le planning a {'reculé' if b > a else 'avancé'} de {_dur(abs((b - a).total_seconds()))}", body,
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

