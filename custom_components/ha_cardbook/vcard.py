"""vCard parsing and building utilities for CardBook."""
from __future__ import annotations

import re
import uuid


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_vcard(text: str) -> dict | None:
    """Parse a vCard string into a contact dictionary."""
    if not text or "BEGIN:VCARD" not in text:
        return None

    contact: dict = {
        "uid": "",
        "fn": "",
        "n": {
            "prefix": "",
            "given": "",
            "additional": "",
            "family": "",
            "suffix": "",
        },
        "emails": [],
        "phones": [],
        "addresses": [],
        "org": "",
        "title": "",
        "bday": "",
        "url": "",
        "note": "",
        "categories": [],
        "photo": "",
    }

    # Unfold continuation lines (RFC 6350 §3.2)
    text = re.sub(r"\r\n([ \t])", r"\1", text)
    text = re.sub(r"\n([ \t])", r"\1", text)

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\r")
        if not line or ":" not in line:
            continue

        # Split property name (+ params) from value at first colon
        colon_idx = line.index(":")
        prop_full = line[:colon_idx]
        value = line[colon_idx + 1:]

        parts = prop_full.split(";")
        prop_name = parts[0].upper()

        # Collect parameters into a dict
        params: dict[str, str] = {}
        for p in parts[1:]:
            if "=" in p:
                k, v = p.split("=", 1)
                params[k.upper()] = v
            else:
                params[p.upper()] = p.upper()

        # ── Property handlers ──────────────────────────────────────────────
        if prop_name == "UID":
            contact["uid"] = value.strip()

        elif prop_name == "FN":
            contact["fn"] = _decode(value)

        elif prop_name == "N":
            seg = value.split(";")
            contact["n"] = {
                "family":     _decode(seg[0]) if len(seg) > 0 else "",
                "given":      _decode(seg[1]) if len(seg) > 1 else "",
                "additional": _decode(seg[2]) if len(seg) > 2 else "",
                "prefix":     _decode(seg[3]) if len(seg) > 3 else "",
                "suffix":     _decode(seg[4]) if len(seg) > 4 else "",
            }

        elif prop_name == "EMAIL":
            raw_type = params.get("TYPE", "internet")
            pref = "PREF" in raw_type.upper() or params.get("PREF") == "1"
            contact["emails"].append({
                "type": raw_type.split(",")[0].lower().replace("pref", "").strip(",") or "internet",
                "value": value.strip(),
                "pref": pref,
            })

        elif prop_name == "TEL":
            raw_type = params.get("TYPE", "voice")
            pref = "PREF" in raw_type.upper() or params.get("PREF") == "1"
            contact["phones"].append({
                "type": raw_type.split(",")[0].lower().replace("pref", "").strip(",") or "voice",
                "value": value.strip(),
                "pref": pref,
            })

        elif prop_name == "ADR":
            raw_type = params.get("TYPE", "home")
            seg = value.split(";")
            contact["addresses"].append({
                "type":     raw_type.lower(),
                "pobox":    _decode(seg[0]) if len(seg) > 0 else "",
                "extended": _decode(seg[1]) if len(seg) > 1 else "",
                "street":   _decode(seg[2]) if len(seg) > 2 else "",
                "city":     _decode(seg[3]) if len(seg) > 3 else "",
                "region":   _decode(seg[4]) if len(seg) > 4 else "",
                "zip":      _decode(seg[5]) if len(seg) > 5 else "",
                "country":  _decode(seg[6]) if len(seg) > 6 else "",
            })

        elif prop_name == "ORG":
            contact["org"] = _decode(value.split(";")[0])

        elif prop_name == "TITLE":
            contact["title"] = _decode(value)

        elif prop_name == "BDAY":
            contact["bday"] = _normalize_bday(value.strip())

        elif prop_name == "URL":
            contact["url"] = _decode(value)

        elif prop_name == "NOTE":
            contact["note"] = _decode(value)

        elif prop_name == "CATEGORIES":
            contact["categories"] = [c.strip() for c in value.split(",") if c.strip()]

        elif prop_name == "PHOTO":
            encoding = params.get("ENCODING", "").upper()
            media_type = params.get("TYPE", "jpeg").lower()
            if encoding in ("B", "BASE64", "b", "base64"):
                contact["photo"] = f"data:image/{media_type};base64,{value.strip()}"
            elif value.startswith("data:") or value.startswith("http"):
                contact["photo"] = value.strip()
            elif value.strip():
                # Raw base64 without explicit ENCODING param
                contact["photo"] = f"data:image/{media_type};base64,{value.strip()}"

    # Derive FN from N if missing
    if not contact["fn"]:
        n = contact["n"]
        contact["fn"] = " ".join(
            p for p in [n["prefix"], n["given"], n["additional"], n["family"], n["suffix"]] if p
        ).strip()

    return contact


# ---------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------

def build_vcard(contact: dict) -> str:
    """Serialise a contact dictionary to a vCard 3.0 string."""
    lines = ["BEGIN:VCARD", "VERSION:3.0"]

    uid = contact.get("uid") or str(uuid.uuid4())
    lines.append(f"UID:{uid}")

    n = contact.get("n", {})
    family     = _encode(n.get("family", ""))
    given      = _encode(n.get("given", ""))
    additional = _encode(n.get("additional", ""))
    prefix     = _encode(n.get("prefix", ""))
    suffix     = _encode(n.get("suffix", ""))
    lines.append(f"N:{family};{given};{additional};{prefix};{suffix}")

    fn = _encode(contact.get("fn") or f"{n.get('given', '')} {n.get('family', '')}".strip())
    lines.append(f"FN:{fn}")

    if contact.get("org"):
        lines.append(f"ORG:{_encode(contact['org'])}")

    if contact.get("title"):
        lines.append(f"TITLE:{_encode(contact['title'])}")

    for email in contact.get("emails", []):
        if not email.get("value"):
            continue
        t = email.get("type", "internet").upper()
        pref = ";PREF" if email.get("pref") else ""
        lines.append(f"EMAIL;TYPE={t}{pref}:{email['value']}")

    for phone in contact.get("phones", []):
        if not phone.get("value"):
            continue
        t = phone.get("type", "voice").upper()
        pref = ";PREF" if phone.get("pref") else ""
        lines.append(f"TEL;TYPE={t}{pref}:{phone['value']}")

    for addr in contact.get("addresses", []):
        t = addr.get("type", "home").upper()
        seg = ";".join([
            _encode(addr.get("pobox", "")),
            _encode(addr.get("extended", "")),
            _encode(addr.get("street", "")),
            _encode(addr.get("city", "")),
            _encode(addr.get("region", "")),
            _encode(addr.get("zip", "")),
            _encode(addr.get("country", "")),
        ])
        lines.append(f"ADR;TYPE={t}:{seg}")

    if contact.get("bday"):
        # Write YYYYMMDD for vCard 3.0 server compatibility
        bday_out = contact["bday"].replace("-", "")
        lines.append(f"BDAY:{bday_out}")

    if contact.get("url"):
        lines.append(f"URL:{_encode(contact['url'])}")

    if contact.get("note"):
        lines.append(f"NOTE:{_encode(contact['note'])}")

    if contact.get("categories"):
        cats = ",".join(str(c) for c in contact["categories"] if c)
        if cats:
            lines.append(f"CATEGORIES:{cats}")

    if contact.get("photo"):
        photo = contact["photo"]
        if photo.startswith("data:"):
            m = re.match(r"data:image/(\w+);base64,(.+)", photo, re.DOTALL)
            if m:
                media_type = m.group(1).upper()
                b64 = m.group(2).strip()
                lines.append(f"PHOTO;ENCODING=b;TYPE={media_type}:{b64}")
        elif photo.startswith("http"):
            lines.append(f"PHOTO;VALUE=URI:{photo}")

    lines.append("END:VCARD")
    return "\r\n".join(lines) + "\r\n"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _decode(value: str) -> str:
    """Unescape vCard escaped characters."""
    return (
        value
        .replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
    )


def _normalize_bday(raw: str) -> str:
    """Normalise BDAY value to YYYY-MM-DD for HTML date inputs.

    Handles:
      19930602        -> 1993-06-02  (vCard 3.0 compact)
      1993-06-02      -> 1993-06-02  (already ISO)
      --0602          -> (kept as-is, year unknown)
    """
    # Strip time component if present (e.g. 19930602T000000Z)
    raw = raw.split("T")[0].strip()
    # YYYYMMDD compact
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:]}"
    # Already YYYY-MM-DD
    if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
        return raw
    return raw


def _encode(value: str) -> str:
    """Escape special characters for vCard."""
    if not value:
        return ""
    return (
        value
        .replace("\\", "\\\\")
        .replace("\n", "\\n")
        .replace(",", "\\,")
        .replace(";", "\\;")
    )
