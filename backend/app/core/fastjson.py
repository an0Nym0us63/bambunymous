"""
Reponse JSON directe pour les grosses listes faites de types simples (dict,
listes, nombres, textes, dates) : l'encodeur generique de FastAPI les parcourt
element par element, plusieurs fois plus lentement que json.dumps.

Memes conventions que l'encodeur de l'appli (main.py) : une date sans fuseau
est en UTC et part avec un Z.
"""
import json
from datetime import date, datetime

from fastapi.responses import Response


def _default(o):
    if isinstance(o, datetime):
        return o.strftime("%Y-%m-%dT%H:%M:%SZ") if o.tzinfo is None else o.isoformat()
    if isinstance(o, date):
        return o.isoformat()
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    if isinstance(o, bytes):
        return o.decode("utf-8", "replace")
    return str(o)


def json_response(v, status_code: int = 200) -> Response:
    return Response(json.dumps(v, ensure_ascii=False, default=_default, separators=(",", ":")).encode("utf-8"),
                    status_code=status_code, media_type="application/json")
