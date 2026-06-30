"""
Matching AMS tray → bobine en DB.

Logique stricte en 3 étages (ne jamais mélanger) :
1. RFID exact (tag_uid == spool.tag_number) → found_mode="rfid".
   Si un RFID valide est présent mais qu'aucune bobine ne correspond, ON S'ARRÊTE
   LÀ — pas de repli sur la couleur (le RFID est un identifiant précis ; deviner
   par couleur quand un RFID existe risquerait un faux positif). → found_mode="notfound".
2. Sinon (aucun RFID), matching par tray_info_idx (profil Bambu) :
   bobines actives du filament dont le profil correspond, puis couleur la plus
   proche si plusieurs candidates → found_mode="auto" (un seul niveau, qu'il y
   ait eu 1 ou plusieurs candidates).
3. Sinon (profil inconnu en base, ou aucune bobine active pour ce profil)
   → found_mode="notfound".
"""
import logging
import re
from typing import Optional, Tuple

from sqlalchemy import select

from ..db.session import AsyncSessionLocal
from ..models.filament import Filament, Spool

logger = logging.getLogger(__name__)


def _hex_to_rgb(h: str) -> Optional[Tuple[int,int,int]]:
    h = h.strip().lstrip("#")
    if len(h) >= 6:
        try:
            return int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
        except ValueError:
            pass
    return None


def _color_distance(a: str, b: str) -> float:
    """Distance euclidienne RGB entre deux couleurs hex."""
    ra, rb = _hex_to_rgb(a), _hex_to_rgb(b)
    if not ra or not rb:
        return 9999.0
    return sum((x-y)**2 for x,y in zip(ra,rb)) ** 0.5


async def match_spool(
    tag_uid: str,
    tray_info_idx: str,
    tray_color: str,
) -> Tuple[Optional[int], Optional[str]]:
    """
    Retourne (spool_id, found_mode).
    found_mode ∈ {"rfid", "auto", "notfound", None}.
    None uniquement si on n'a aucune info exploitable du tout (ni RFID, ni profil) —
    le tray reste alors dans son état "manual" déjà déterminé en amont.
    """
    tag_uid       = (tag_uid or "").strip()
    tray_info_idx = (tray_info_idx or "").strip()
    tray_color    = (tray_color or "").strip().lstrip("#")

    # Nettoyer le profile_id : garder seulement ex "GFA00" depuis "A00-GFA00" ou "GFA00-Y4"
    profile_id = tray_info_idx
    m = re.search(r'([A-Z]{2,}[0-9]{2})', tray_info_idx)
    if m:
        profile_id = m.group(1)

    async with AsyncSessionLocal() as db:

        # ── 1. RFID strict — arrêt ici quoi qu'il arrive ────────────────────
        uid_valid = bool(tag_uid and tag_uid.replace("0","") and tag_uid != "0000000000000000")
        if uid_valid:
            result = await db.execute(
                select(Spool).where(
                    Spool.tag_number == tag_uid,
                    Spool.archived == False
                )
            )
            spool = result.scalar_one_or_none()
            if spool:
                logger.info(f"[MATCH] RFID {tag_uid} → spool #{spool.id}")
                return spool.id, "rfid"
            logger.info(f"[MATCH] RFID {tag_uid} présent mais aucune bobine correspondante → notfound (pas de repli couleur)")
            return None, "notfound"

        # ── 2. Pas de RFID → profil + couleur la plus proche ────────────────
        if profile_id:
            fil_result = await db.execute(
                select(Filament).where(Filament.profile_id == profile_id)
            )
            filaments = fil_result.scalars().all()

            if filaments:
                fil_ids = [f.id for f in filaments]
                spools_result = await db.execute(
                    select(Spool).where(
                        Spool.filament_id.in_(fil_ids),
                        Spool.archived == False
                    ).order_by(Spool.last_used_at.desc().nullslast(), Spool.id.desc())
                )
                spools = spools_result.scalars().all()

                if not spools:
                    logger.info(f"[MATCH] profile={profile_id} → aucune bobine active → notfound")
                    return None, "notfound"
                elif len(spools) == 1:
                    logger.info(f"[MATCH] profile={profile_id} → spool #{spools[0].id} (unique) → auto")
                    return spools[0].id, "auto"
                else:
                    if tray_color:
                        best = min(
                            spools,
                            key=lambda s: _color_distance(
                                tray_color,
                                (s.filament.color if s.filament else "") or ""
                            )
                        )
                        dist = _color_distance(tray_color, (best.filament.color if best.filament else "") or "")
                        logger.info(f"[MATCH] profile={profile_id} couleur={tray_color} → spool #{best.id} dist={dist:.1f} → auto")
                        return best.id, "auto"
                    else:
                        logger.info(f"[MATCH] profile={profile_id} → spool #{spools[0].id} (plus récente, sans couleur) → auto")
                        return spools[0].id, "auto"
            else:
                logger.info(f"[MATCH] profile={profile_id} inconnu en base (catalogue) → notfound")
                return None, "notfound"

        # ── 3. Aucune info exploitable (ni RFID, ni profil) ─────────────────
        logger.debug(f"[MATCH] Aucune info exploitable tag={tag_uid!r} profile={profile_id!r}")
        return None, None
