"""
Met à jour la location des bobines selon leur emplacement AMS.

Appelee depuis core/mqtt, dans des fils qui ont chacun leur boucle asyncio,
ouverte puis refermee aussitot l'appel fini. L'ancienne version passait par
une file et une tache d'ecriture creee dans la PREMIERE boucle venue : la
boucle refermee, la tache mourait avec, et l'ecriture se faisait ou non au
hasard du minutage (une bobine retiree du support externe restait « Externe »
au lieu de repartir en Tiroir). On ecrit donc directement, dans la boucle de
l'appelant ; l'attente sur verrou SQLite (timeout de 30 s du moteur) suffit a
eviter les « database is locked ».
"""
import logging
import threading

logger = logging.getLogger(__name__)

# Derniere location ECRITE par bobine : evite de reecrire la meme a chaque
# tick MQTT. Mise a jour seulement apres une ecriture reussie, pour qu'un
# echec soit retente au passage suivant.
_ACTIVE_AMS_SPOOLS: dict[int, str] = {}
_lock = threading.Lock()


async def update_spool_location(spool_id: int, location: str):
    """Ecrit la location d'une bobine si elle a change."""
    from ..db.session import AsyncSessionLocal
    from ..models.filament import Spool
    with _lock:
        if _ACTIVE_AMS_SPOOLS.get(spool_id) == location:
            return
    try:
        async with AsyncSessionLocal() as db:
            spool = await db.get(Spool, spool_id)
            if spool is None:
                return
            from . import storage_places as _sp
            if location == _sp.STORED:
                # sortie de l'imprimante (07/11/2026) : rangee selon le mode (sa place, le rangement unique, « À ranger »)
                if spool.archived or spool.ordered or not _sp.in_printer(spool.location):
                    loc = spool.location
                else:
                    loc = await _sp.out_of_printer(db, spool)
            else:
                loc = location
                if _sp.in_printer(loc):
                    if not _sp.in_printer(spool.location):
                        await _sp.into_printer(db, spool, loc)   # sortie du stock, echange intelligent
                    spool.unstored_at = None      # revenue dans l'AMS : plus rien a ranger
            if spool.location != loc or db.is_modified(spool):
                old = spool.location or ""
                spool.location = loc
                await db.commit()
                if old != loc:
                    logger.info(f"[LOCATION] Bobine #{spool_id}: {old!r} → {loc!r}")
        with _lock:
            _ACTIVE_AMS_SPOOLS[spool_id] = location
    except Exception as e:
        logger.warning(f"[LOCATION] ecriture impossible pour la bobine #{spool_id} ({location!r}) : {e}")


# NB : le retour au rangement (STORED) n'est PAS declenche ici mais dans core/mqtt, qui compare
# les trays presents d'un tick a l'autre (cache _MATCH_CACHE). Ce module ne fait
# qu'ecrire les emplacements.
