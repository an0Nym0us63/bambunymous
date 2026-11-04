"""
La zone d'une adresse IP (04/11/2026), pour le journal des acces aux liens publics : ville, region, pays et fournisseur
d'acces, d'apres ip-api.com (gratuit, sans cle ; une requete groupee pour toutes les adresses a resoudre). Une adresse
IP ne donne jamais une adresse postale : au mieux la ville du point d'acces du fournisseur, parfois seulement le pays.
Les reponses sont gardees 30 jours (IP_GEO) ; une adresse du reseau local n'est jamais envoyee.
"""
import ipaddress
import json
import logging
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

KEY = "IP_GEO"
KEEP_DAYS = 30
URL = "http://ip-api.com/batch?fields=status,country,countryCode,regionName,city,isp,query&lang=fr"


def _local(ip: str) -> bool:
    try:
        a = ipaddress.ip_address(ip)
        return a.is_private or a.is_loopback or a.is_link_local or a.is_reserved
    except ValueError:
        return True


async def lookup(ips: list) -> dict:
    """{ip: {city, region, country, cc, isp} | {local: True} | {}}."""
    from ..db.session import AsyncSessionLocal
    from .settings_service import get_setting, set_setting
    ips = sorted({str(i) for i in ips if i})
    out = {ip: {"local": True} for ip in ips if _local(ip)}
    async with AsyncSessionLocal() as db:
        raw = await get_setting(db, KEY, "")
    try:
        cache = json.loads(raw) if raw else {}
    except ValueError:
        cache = {}
    lim = (datetime.utcnow() - timedelta(days=KEEP_DAYS)).isoformat()
    cache = {k: v for k, v in (cache if isinstance(cache, dict) else {}).items() if (v.get("at") or "") >= lim}
    todo = [ip for ip in ips if ip not in out and ip not in cache]
    if todo:
        import aiohttp
        try:
            async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=8)) as s:
                for i in range(0, len(todo), 100):
                    async with s.post(URL, json=todo[i:i + 100]) as r:
                        for g in await r.json(content_type=None):
                            if g.get("status") == "success":
                                cache[g["query"]] = {"city": g.get("city"), "region": g.get("regionName"), "country": g.get("country"),
                                                     "cc": g.get("countryCode"), "isp": g.get("isp"), "at": datetime.utcnow().isoformat()}
        except Exception as e:
            logger.info(f"[GEO] zones des adresses non lues : {e}")
        async with AsyncSessionLocal() as db:
            await set_setting(db, KEY, json.dumps(cache, ensure_ascii=False))
    for ip in ips:
        if ip not in out:
            out[ip] = {k: v for k, v in (cache.get(ip) or {}).items() if k != "at"}
    return out
