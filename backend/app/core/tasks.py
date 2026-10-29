"""Les taches de fond (27/10/2026), pour Parametres > Taches : ce qui tourne, quand ca repasse, la derniere erreur.

Chaque boucle attend avec sleep(id, secondes) au lieu d'asyncio.sleep : le registre sait alors si elle travaille
(« en cours ») ou attend son prochain passage (et quand), combien de passages elle a faits et combien de temps le
dernier a pris. error(id) dans son « except » garde la derniere erreur. track(id, tache) la surveille : une boucle
morte (exception sortie) se voit « arretee ». Les longs travaux lances a la demande (rattrapages, sauvegarde du
NAS…) s'y ajoutent avec leur avancement, lus chez eux (jobs()).
"""
import asyncio
import sys
import time

# id -> (libelle, ce qu'elle fait, famille)
CATALOG = {
    "mqtt":         ("Connexion à l'imprimante", "Le lien MQTT avec l'imprimante (état, AMS, impressions) : reconnecté tout seul s'il tombe.", "Impressions"),
    "reconciler":   ("Rattrapage des 3MF tranchés", "Reprend les impressions restées sans leur 3MF (5 min).", "Impressions"),
    "translate":    ("Traduction des noms", "Traduit les noms restés vides (quota d'un service atteint) : toutes les 6 h.", "Impressions"),
    "sd_card":      ("Timelapses de la carte SD", "Copie le timelapse de chaque impression terminée depuis la carte SD de l'imprimante.", "Impressions"),
    "mw_models":    ("Fiches MakerWorld", "Lit ou relit les fiches des modèles imprimés (nouvelles, en erreur, vieilles de 30 jours) : toutes les 6 h.", "MakerWorld"),
    "mw_account":   ("Compte MakerWorld", "Prépare collections, j'aime et suivis : chaque heure.", "MakerWorld"),
    "mw_watch":     ("Collections suivies", "Surveille les collections MakerWorld (ajouts, créations) pour les notifications.", "MakerWorld"),
    "mw_creator":   ("Activité de créateur", "Points, boosts, abonnés et paliers MakerWorld : toutes les 30 min.", "MakerWorld"),
    "mw_queue":     ("Liste « À faire »", "Calcule la liste « À faire » au démarrage.", "MakerWorld"),
    "mw_3d":        ("Vues 3D", "Prépare les vues 3D des 3MF d'origine pas encore converties : 90 s après le démarrage, puis toutes les 12 h.", "MakerWorld"),
    "friends":      ("Copains", "Débuts et fins d'impression des copains, pour les notifications : toutes les 5 min.", "Notifications"),
    "mw_rate":      ("Impressions à évaluer", "Rappelle les modèles MakerWorld à évaluer : toutes les 6 h.", "Notifications"),
    "notify_extra": ("Points d'attention", "Alertes, résumé de la semaine, imprimante au repos : toutes les 15 min.", "Notifications"),
    "update":       ("Nouvelle version", "Regarde si une nouvelle version de l'appli est publiée : toutes les 6 h.", "Notifications"),
    "ach_watch":    ("Relevés des succès", "Relève l'imprimante et les copains pour les succès.", "Succès"),
    "ach_warm":     ("Calcul des succès", "Prépare le gros calcul des succès au démarrage.", "Succès"),
    "db_upkeep":    ("Entretien de la base", "Statistiques au besoin, puis « PRAGMA optimize » : chaque heure.", "Serveur"),
    "loop_watch":   ("Surveillance du serveur", "Relève ce qui fige le serveur et la charge du processeur (Vitesse du serveur).", "Serveur"),
    "catalog":      ("Catalogue des filaments Bambu", "Télécharge le catalogue des filaments Bambu (codes, couleurs) : au démarrage, puis toutes les 24 h s'il a changé.", "Serveur"),
    "nas":          ("Sauvegarde de nuit", "Sauvegarde vers le NAS (et vidage du local) chaque nuit, si elle est activée ; vérifie toutes les 5 min.", "Serveur"),
}
_ST: dict = {}
_TASKS: dict = {}


def _st(i: str) -> dict:
    return _ST.setdefault(i, {"state": "starting", "since": time.time(), "runs": 0, "last_start": None, "last_end": None,
                              "last_s": None, "next_at": None, "error": None, "error_at": None})


async def sleep(i: str, s: float) -> None:
    """Attendre le prochain passage de la boucle i (s secondes), en le disant au registre."""
    st = _st(i)
    now = time.time()
    if st["state"] == "running":
        st["last_end"] = now
        st["last_s"] = round(now - (st["last_start"] or now), 1)
    st.update(state="waiting", next_at=now + s)
    await asyncio.sleep(s)
    st.update(state="running", last_start=time.time(), next_at=None)
    st["runs"] += 1


def start(i: str) -> None:
    """Une tache qui ne passe qu'une fois (ou sans attente) : elle commence."""
    st = _st(i)
    st.update(state="running", last_start=time.time(), next_at=None)
    st["runs"] += 1


def waiting(i: str, s: float) -> None:
    """Une tache d'un fil a part (sans asyncio) : son passage est fini, le prochain dans s secondes."""
    st = _st(i)
    now = time.time()
    if st["state"] == "running":
        st["last_end"] = now
        st["last_s"] = round(now - (st["last_start"] or now), 1)
    st.update(state="waiting", next_at=now + s)


def finish(i: str) -> None:
    st = _st(i)
    now = time.time()
    st.update(state="done", last_end=now, last_s=round(now - (st["last_start"] or now), 1))


def error(i: str, e: BaseException | None = None) -> None:
    """La derniere erreur de la tache i (par defaut, celle qu'on est en train de traiter)."""
    e = e or sys.exc_info()[1]
    if e is None:
        return
    st = _st(i)
    st["error"] = f"{type(e).__name__}: {e}"[:300]
    st["error_at"] = time.time()


def track(i: str, task):
    """Surveiller la tache asyncio de la boucle i (rend la tache)."""
    _TASKS[i] = task
    _st(i)
    return task


def jobs() -> list:
    """Les longs travaux lances a la demande, avec leur avancement (lus chez eux)."""
    out = []

    def add(i, label, st):
        if not isinstance(st, dict):
            return
        out.append({"id": i, "label": label, "running": bool(st.get("running")), "done": st.get("done"), "total": st.get("total"),
                    "current": st.get("current") or st.get("what"), "stopped": st.get("stopped"),
                    "started": st.get("started"), "finished": st.get("finished") or st.get("finished_at")})
    try:
        from ..services import mw_source
        add("mw_source", "Rattrapage des 3MF d'origine MakerWorld", mw_source.status())
    except Exception:
        pass
    try:
        from ..services import mw_3d
        if mw_3d.WARM.get("started"):
            add("mw_3d_warm", "Préparation des vues 3D", mw_3d.WARM)
    except Exception:
        pass
    try:
        from ..services import mw_relink
        add("mw_relink", "Recherche des modèles MakerWorld manquants", mw_relink.status())
    except Exception:
        pass
    try:
        from ..services import mw_docs
        add("mw_docs", "Rattrapage des documents MakerWorld", mw_docs.status())
    except Exception:
        pass
    try:
        from ..services import archive
        r, p = archive._STATE.get("running"), archive._STATE.get("progress") or {}
        add("archive", {"backup": "Sauvegarde vers le NAS", "purge": "Vidage du local (copié sur le NAS)"}.get(r, "Sauvegarde vers le NAS"),
            {"running": bool(r), **p})
    except Exception:
        pass
    try:
        from ..services import makerworld
        add("mw_refresh", "Lecture des fiches MakerWorld", {"running": makerworld._RUNNING.get("on")})
    except Exception:
        pass
    try:
        from ..services import mw_rate
        q = mw_rate.queue_state().get("jobs") or []
        live = [j for j in q if j.get("status") in ("queued", "sending")]
        if q:
            add("mw_rate", "Publication des évaluations MakerWorld", {"running": bool(live), "total": len(q), "done": len(q) - len(live),
                                                                   "current": (live[0].get("title") if live else None)})
    except Exception:
        pass
    try:
        from ..services import mw_queue
        t = mw_queue._TASK[0]
        add("mw_queue", "Calcul de la liste « À faire »", {"running": bool(t and not t.done())})
    except Exception:
        pass
    try:
        from ..api.v1.routes.camera import _HUB
        alive = bool(_HUB.thread and _HUB.thread.is_alive())
        add("camera", "Flux de la caméra", {"running": alive, "current": f"{_HUB.subs} spectateur{'s' if _HUB.subs > 1 else ''}" if alive else None})
    except Exception:
        pass
    try:
        from ..api.v1.routes.import_zip import _JOBS as ZJ
        for k, j in list(ZJ.items())[-3:]:
            add(f"zip:{k}", "Import d'une archive ZIP", {"running": j.get("status") in ("running", "pending"), "done": j.get("done"),
                                                       "total": j.get("total"), "current": j.get("current") or j.get("status")})
    except Exception:
        pass
    return out


def _mqtt() -> dict:
    """La connexion a l'imprimante, lue sur le gestionnaire MQTT."""
    try:
        from .mqtt import mqtt_manager as M
        if not M._ip:
            return {"state": "off"}
        alive = bool(M._thread and M._thread.is_alive())
        return {"state": "connected" if M._connected else ("offline" if alive else "stopped")}
    except Exception:
        return {"state": "unknown"}


def _next_daily(hour: int, now_local) -> float:
    """Dans combien de secondes revient l'heure « hour » (heure locale)."""
    from datetime import timedelta
    t = now_local.replace(hour=hour, minute=0, second=0, microsecond=0)
    if t <= now_local:
        t += timedelta(days=1)
    return (t - now_local).total_seconds()


async def planned() -> list:
    """Ce qui est programme a une heure donnee : la sauvegarde de nuit (et le vidage), le resume de la semaine, la
    reprise d'un rattrapage arrete par la limite de MakerWorld."""
    from datetime import datetime, timedelta
    out = []
    now = time.time()
    try:
        from ..services import archive
        s = await archive.settings_get()
        nl = archive._local(datetime.utcnow())
        last = s.get("last_backup") or {}
        lp = s.get("last_purge") or {}
        desc = f"Chaque nuit à {s['hour']} h, vers {s['dir']}" + (f" ; puis vidage du local de ce qui a plus de {s['purge_days']} jours (copié sur le NAS)" if s["purge_auto"] else "")
        out.append({"id": "nas_backup", "label": "Sauvegarde vers le NAS", "desc": desc, "enabled": s["nightly"],
                    "next_at": now + _next_daily(s["hour"], nl) if s["nightly"] else None,
                    "last": {"at": last.get("at"), "trigger": last.get("trigger"), "error": last.get("error"), "seconds": last.get("seconds")} if last else None,
                    "last_purge": {"at": lp.get("at"), "trigger": lp.get("trigger"), "error": lp.get("error")} if lp else None,
                    "running": archive._STATE.get("running")})
    except Exception:
        pass
    try:
        from ..services import notify as N
        cfg = await N._load()                          # la config brute, comme la boucle qui l'envoie
        on = N.enabled_in(cfg, "weekly_summary")
        o = N.options_of(cfg, "weekly_summary")
        days = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
        nl = datetime.now()
        t = nl.replace(hour=int(o["hour"]), minute=0, second=0, microsecond=0) + timedelta(days=(int(o["day"]) - nl.weekday()) % 7)
        if t <= nl:
            t += timedelta(days=7)
        out.append({"id": "weekly", "label": "Résumé de la semaine", "desc": f"Chaque {days[int(o['day'])]} à {o['hour']} h (Telegram, ntfy et appli)",
                    "enabled": on, "next_at": now + (t - nl).total_seconds() if on else None})
    except Exception:
        pass
    try:
        from ..services import mw_source
        j = mw_source.status()
        if j.get("resume_at") and not j.get("running"):
            out.append({"id": "mw_source_resume", "label": "Reprise du rattrapage des 3MF d'origine",
                        "desc": "Arrêté par la limite de téléchargements du jour de MakerWorld : il reprend tout seul.",
                        "enabled": True, "next_at": float(j["resume_at"])})
    except Exception:
        pass
    return out


def snapshot() -> dict:
    now = time.time()
    loops = []
    for i, (label, desc, family) in CATALOG.items():
        st = dict(_ST.get(i) or {})
        t = _TASKS.get(i)
        state = st.get("state") or "unknown"
        if t is not None and t.done():
            state = "stopped" if state != "done" else "done"
            if not t.cancelled() and t.exception() is not None and not st.get("error"):
                e = t.exception()
                st["error"], st["error_at"] = f"{type(e).__name__}: {e}"[:300], st.get("last_end") or now
        if not st and t is None:
            state = "unknown"
        if i == "mqtt":
            state = _mqtt()["state"]
        loops.append({"id": i, "label": label, "desc": desc, "family": family, "state": state, "runs": st.get("runs", 0),
                      "since": st.get("since"), "last_start": st.get("last_start"), "last_end": st.get("last_end"),
                      "last_s": st.get("last_s"), "next_at": st.get("next_at"), "error": st.get("error"), "error_at": st.get("error_at")})
    return {"now": now, "loops": loops, "jobs": jobs()}
