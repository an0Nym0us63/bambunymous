"""
Matching AMS tray → bobine en DB.

Priorité :
1. RFID exact : tag_uid == spool.tag_number  → found_mode="rfid"
2. Profile ID : tray_info_idx == filament.profile_id
   → bobines actives du filament trouvé
   → si une seule : direct            → found_mode="profile"
   → si plusieurs : couleur la plus proche → found_mode="color"
3. Aucun match                         → (None, None)
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
    Retourne (spool_id, found_mode) ou (None, None).
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

        # ── 1. RFID exact ─────────────────────────────────────────────────
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

        # ── 2. Profile ID ─────────────────────────────────────────────────
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
                    logger.debug(f"[MATCH] profile={profile_id} → aucune bobine active")
                elif len(spools) == 1:
                    logger.info(f"[MATCH] profile={profile_id} → spool #{spools[0].id} (unique)")
                    return spools[0].id, "profile"
                else:
                    # Plusieurs bobines → couleur la plus proche
                    if tray_color:
                        best = min(
                            spools,
                            key=lambda s: _color_distance(
                                tray_color,
                                (s.filament.color if s.filament else "") or ""
                            )
                        )
                        dist = _color_distance(tray_color, (best.filament.color if best.filament else "") or "")
                        logger.info(f"[MATCH] profile={profile_id} couleur={tray_color} → spool #{best.id} dist={dist:.1f}")
                        return best.id, "color"
                    else:
                        # Pas de couleur → prendre la plus récente
                        logger.info(f"[MATCH] profile={profile_id} → spool #{spools[0].id} (plus récente, sans couleur)")
                        return spools[0].id, "profile"

        logger.debug(f"[MATCH] Aucun match tag={tag_uid!r} profile={profile_id!r}")
        return None, None
