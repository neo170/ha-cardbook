"""DataUpdateCoordinator and CardDAV client for CardBook."""
from __future__ import annotations

import logging
import ssl
import uuid
from datetime import timedelta
from typing import Any
from urllib.parse import urlparse
from xml.etree import ElementTree

import aiohttp
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_PASSWORD,
    CONF_REFRESH_INTERVAL,
    CONF_URL,
    CONF_USERNAME,
    CONF_VERIFY_SSL,
    DEFAULT_REFRESH_INTERVAL,
    DEFAULT_VERIFY_SSL,
    DOMAIN,
)
from .vcard import build_vcard, parse_vcard

_LOGGER = logging.getLogger(__name__)

DAV_NS = "DAV:"
CARDDAV_NS = "urn:ietf:params:xml:ns:carddav"

_ADDRESSBOOK_QUERY = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">'
    "<d:prop><d:getetag/><card:address-data/></d:prop>"
    "</card:addressbook-query>"
)

_PROPFIND_BODY = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<propfind xmlns="DAV:"><prop><resourcetype/></prop></propfind>'
)


def _resolve_url(base: str, href: str) -> str:
    """Resolve a CardDAV href against the base URL."""
    if href.startswith("http://") or href.startswith("https://"):
        return href
    parsed = urlparse(base)
    root = f"{parsed.scheme}://{parsed.netloc}"
    return f"{root}{href}" if href.startswith("/") else f"{base.rstrip('/')}/{href.lstrip('/')}"


class CardDAVCoordinator(DataUpdateCoordinator):
    """Manages CardDAV data fetching and CRUD operations."""

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.entry = entry
        self._url: str = entry.data[CONF_URL].rstrip("/")
        self._username: str = entry.data[CONF_USERNAME]
        self._password: str = entry.data[CONF_PASSWORD]
        self._verify_ssl: bool = entry.data.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL)

        interval = entry.options.get(
            CONF_REFRESH_INTERVAL,
            entry.data.get(CONF_REFRESH_INTERVAL, DEFAULT_REFRESH_INTERVAL),
        )

        super().__init__(
            hass,
            _LOGGER,
            name=DOMAIN,
            update_interval=timedelta(seconds=int(interval)),
        )

        self._contacts: dict[str, dict] = {}

    # ── Public properties ──────────────────────────────────────────────────

    @property
    def contacts(self) -> dict[str, dict]:
        return self._contacts

    # ── Internal helpers ───────────────────────────────────────────────────

    def _auth(self) -> aiohttp.BasicAuth:
        return aiohttp.BasicAuth(self._username, self._password)

    def _ssl_context(self) -> ssl.SSLContext | bool:
        if not self._verify_ssl:
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            return ctx
        return True

    def _session(self) -> aiohttp.ClientSession:
        connector = aiohttp.TCPConnector(ssl=self._ssl_context())
        return aiohttp.ClientSession(connector=connector, auth=self._auth())

    # ── DataUpdateCoordinator override ─────────────────────────────────────

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            contacts = await self._fetch_contacts()
            self._contacts = contacts
            return contacts
        except aiohttp.ClientError as err:
            raise UpdateFailed(f"CardDAV connection error: {err}") from err

    # ── CardDAV fetch ──────────────────────────────────────────────────────

    async def _fetch_contacts(self) -> dict[str, dict]:
        headers = {
            "Content-Type": "application/xml; charset=utf-8",
            "Depth": "1",
        }
        async with self._session() as session:
            async with session.request(
                "REPORT",
                self._url,
                headers=headers,
                data=_ADDRESSBOOK_QUERY.encode(),
                timeout=aiohttp.ClientTimeout(total=30),
            ) as resp:
                if resp.status not in (200, 207):
                    raise UpdateFailed(
                        f"CardDAV REPORT returned HTTP {resp.status}"
                    )
                body = await resp.text()

        return self._parse_multistatus(body)

    def _parse_multistatus(self, xml_body: str) -> dict[str, dict]:
        contacts: dict[str, dict] = {}
        try:
            root = ElementTree.fromstring(xml_body)
        except ElementTree.ParseError as err:
            _LOGGER.error("Failed to parse CardDAV response: %s", err)
            return {}

        for response_el in root.findall(f"{{{DAV_NS}}}response"):
            href_el = response_el.find(f"{{{DAV_NS}}}href")
            if href_el is None or not href_el.text:
                continue
            href = href_el.text.strip()

            propstat = response_el.find(f"{{{DAV_NS}}}propstat")
            if propstat is None:
                continue
            status_el = propstat.find(f"{{{DAV_NS}}}status")
            if status_el is None or "200" not in (status_el.text or ""):
                continue

            prop = propstat.find(f"{{{DAV_NS}}}prop")
            if prop is None:
                continue

            etag_el = prop.find(f"{{{DAV_NS}}}getetag")
            etag = (etag_el.text or "").strip('"') if etag_el is not None else ""

            addr_el = prop.find(f"{{{CARDDAV_NS}}}address-data")
            if addr_el is None or not addr_el.text:
                continue

            contact = parse_vcard(addr_el.text)
            if contact is None:
                continue

            contact["href"] = href
            contact["etag"] = etag
            if not contact["uid"]:
                contact["uid"] = href.split("/")[-1].replace(".vcf", "")
            uid = contact["uid"]
            contacts[uid] = contact

        return contacts

    # ── CRUD operations ────────────────────────────────────────────────────

    async def async_create_contact(self, data: dict) -> dict:
        """Create a new contact on the CardDAV server."""
        uid = data.get("uid") or str(uuid.uuid4())
        data["uid"] = uid
        vcard_text = build_vcard(data)
        target_url = f"{self._url}/{uid}.vcf"

        async with self._session() as session:
            async with session.put(
                target_url,
                data=vcard_text.encode("utf-8"),
                headers={"Content-Type": "text/vcard; charset=utf-8"},
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status not in (200, 201, 204):
                    raise RuntimeError(
                        f"Failed to create contact: HTTP {resp.status}"
                    )
                etag = resp.headers.get("ETag", "").strip('"')

        data["href"] = target_url
        data["etag"] = etag
        self._contacts[uid] = data
        return data

    async def async_update_contact(self, uid: str, data: dict) -> dict:
        """Update an existing contact on the CardDAV server."""
        existing = self._contacts.get(uid, {})
        href = data.get("href") or existing.get("href") or f"{self._url}/{uid}.vcf"
        etag = existing.get("etag", "")
        data["uid"] = uid

        vcard_text = build_vcard(data)
        target_url = _resolve_url(self._url, href)

        headers: dict[str, str] = {"Content-Type": "text/vcard; charset=utf-8"}
        if etag:
            headers["If-Match"] = f'"{etag}"'

        async with self._session() as session:
            async with session.put(
                target_url,
                data=vcard_text.encode("utf-8"),
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status not in (200, 201, 204):
                    raise RuntimeError(
                        f"Failed to update contact: HTTP {resp.status}"
                    )
                new_etag = resp.headers.get("ETag", "").strip('"')

        data["href"] = href
        data["etag"] = new_etag or etag
        self._contacts[uid] = data
        return data

    async def async_delete_contact(self, uid: str) -> None:
        """Delete a contact from the CardDAV server."""
        existing = self._contacts.get(uid)
        if not existing:
            raise RuntimeError(f"Contact '{uid}' not found in local cache")

        href = existing.get("href", f"{self._url}/{uid}.vcf")
        etag = existing.get("etag", "")
        target_url = _resolve_url(self._url, href)

        headers: dict[str, str] = {}
        if etag:
            headers["If-Match"] = f'"{etag}"'

        async with self._session() as session:
            async with session.delete(
                target_url,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=15),
            ) as resp:
                if resp.status not in (200, 204):
                    raise RuntimeError(
                        f"Failed to delete contact: HTTP {resp.status}"
                    )

        del self._contacts[uid]

    # ── Connection test (used by config_flow) ──────────────────────────────

    @staticmethod
    async def async_test_connection(
        url: str, username: str, password: str, verify_ssl: bool
    ) -> None:
        """Probe the CardDAV URL; raise on failure."""
        ssl_ctx: ssl.SSLContext | bool = True
        if not verify_ssl:
            ssl_ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
            ssl_ctx.check_hostname = False
            ssl_ctx.verify_mode = ssl.CERT_NONE

        auth = aiohttp.BasicAuth(username, password)
        connector = aiohttp.TCPConnector(ssl=ssl_ctx)
        async with aiohttp.ClientSession(connector=connector, auth=auth) as session:
            async with session.request(
                "PROPFIND",
                url.rstrip("/"),
                headers={
                    "Depth": "0",
                    "Content-Type": "application/xml; charset=utf-8",
                },
                data=_PROPFIND_BODY.encode(),
                timeout=aiohttp.ClientTimeout(total=10),
            ) as resp:
                if resp.status not in (200, 207, 401):
                    raise ConnectionError(f"Server returned HTTP {resp.status}")
                if resp.status == 401:
                    raise PermissionError("Invalid credentials (HTTP 401)")
