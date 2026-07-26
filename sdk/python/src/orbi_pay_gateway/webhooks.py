from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any


def verify_webhook_signature(
    *,
    raw_body: bytes | str,
    signature_header: str,
    timestamp_header: str,
    secret: str,
    tolerance_seconds: int = 300,
    now_seconds: int | None = None,
) -> dict[str, Any]:
    if not signature_header:
        return {"ok": False, "reason": "missing_signature"}
    if timestamp_header in (None, ""):
        return {"ok": False, "reason": "missing_timestamp"}
    try:
        timestamp = int(timestamp_header)
    except ValueError:
        return {"ok": False, "reason": "invalid_timestamp"}
    now = now_seconds if now_seconds is not None else int(time.time())
    if abs(now - timestamp) > tolerance_seconds:
        return {"ok": False, "reason": "stale_timestamp"}
    signature = signature_header.removeprefix("sha256=").strip()
    if len(signature) != 64:
        return {"ok": False, "reason": "signature_mismatch"}
    body = raw_body.decode("utf-8") if isinstance(raw_body, bytes) else raw_body
    expected = hmac.new(secret.encode("utf-8"), f"{timestamp}.{body}".encode("utf-8"), hashlib.sha256).hexdigest()
    return {"ok": True} if hmac.compare_digest(signature, expected) else {"ok": False, "reason": "signature_mismatch"}


def verify_and_parse_webhook(
    *,
    raw_body: bytes | str,
    signature_header: str,
    timestamp_header: str,
    secret: str,
    tolerance_seconds: int = 300,
    now_seconds: int | None = None,
) -> dict[str, Any]:
    verified = verify_webhook_signature(
        raw_body=raw_body,
        signature_header=signature_header,
        timestamp_header=timestamp_header,
        secret=secret,
        tolerance_seconds=tolerance_seconds,
        now_seconds=now_seconds,
    )
    if not verified["ok"]:
        return verified
    body = raw_body.decode("utf-8") if isinstance(raw_body, bytes) else raw_body
    try:
        event = json.loads(body)
    except json.JSONDecodeError:
        return {"ok": False, "reason": "invalid_json"}
    if not isinstance(event, dict) or not isinstance(event.get("eventId"), str) or not isinstance(event.get("eventType"), str):
        return {"ok": False, "reason": "invalid_event"}
    return {"ok": True, "event": event}
