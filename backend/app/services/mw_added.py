"""Qui a range quel modele dans quelle collection MakerWorld, depuis BambuNymous (23/10/2026).

MakerWorld ne garde que le compte proprietaire des collections : quand plusieurs
personnes de la maison rangent des modeles, on ne sait plus qui a ajoute quoi.
On le retient ici, au moment de l'ajout ; un retrait efface la marque. Ce qui a
ete range ailleurs (site ou appli MakerWorld) n'a pas de marque.
Une ligne JSON en reglage : {"<collection>:<modele>": {"by": nom, "at": date}}.
"""
import asyncio
import json
from datetime import datetime

KEY = "MW_COLLECTION_ADDED"
MAX = 5000
_LOCK = asyncio.Lock()


async def _read(db) -> dict:
    from .settings_service import get_setting
    try:
        d = json.loads(await get_setting(db, KEY, "") or "{}")
    except ValueError:
        d = {}
    return d if isinstance(d, dict) else {}


async def record(design_id: str, added: list, removed: list, username: str) -> None:
    """Un modele vient d'etre range dans « added » et retire de « removed »."""
    if not added and not removed:
        return
    from ..db.session import AsyncSessionLocal
    from .settings_service import set_setting
    now = datetime.utcnow().isoformat()
    async with _LOCK:
        async with AsyncSessionLocal() as db:
            d = await _read(db)
            for c in removed:
                d.pop(f"{c}:{design_id}", None)
            for c in added:
                d[f"{c}:{design_id}"] = {"by": username, "at": now}
            if len(d) > MAX:                    # les plus anciennes marques s'en vont
                d = dict(sorted(d.items(), key=lambda kv: kv[1].get("at") or "")[-MAX:])
            await set_setting(db, KEY, json.dumps(d))


async def of_design(design_id: str) -> set:
    """Les collections ou ce modele a deja une marque."""
    from ..db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        d = await _read(db)
    suf = f":{design_id}"
    return {k[:-len(suf)] for k in d if k.endswith(suf)}


async def of_collection(cid: str) -> dict:
    """{modele: {"by", "at"}} pour une collection."""
    from ..db.session import AsyncSessionLocal
    async with AsyncSessionLocal() as db:
        d = await _read(db)
    pre = f"{cid}:"
    return {k[len(pre):]: v for k, v in d.items() if k.startswith(pre)}
