"""CardBook integration setup."""
from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .api import CardBookContactsView, CardBookContactView, CardBookRefreshView
from .const import (
    DATA_PANEL_REGISTERED,
    DATA_STATIC_REGISTERED,
    DOMAIN,
    PANEL_URL,
    STATIC_URL,
)
from .coordinator import CardDAVCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up a CardBook config entry."""
    coordinator = CardDAVCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator

    # ── Register static file path (once per HA lifetime) ──────────────────
    if not hass.data.get(DATA_STATIC_REGISTERED):
        www_path = str(Path(__file__).parent / "www")
        try:
            from homeassistant.components.http import StaticPathConfig  # HA ≥ 2023.9

            await hass.http.async_register_static_paths(
                [StaticPathConfig(STATIC_URL, www_path, False)]
            )
        except (ImportError, AttributeError):
            # Fallback for older HA versions
            hass.http.register_static_path(STATIC_URL, www_path, cache_headers=False)
        hass.data[DATA_STATIC_REGISTERED] = True

    # ── Register panel (once per HA lifetime) ─────────────────────────────
    if not hass.data.get(DATA_PANEL_REGISTERED):
        from homeassistant.components.frontend import async_register_built_in_panel

        async_register_built_in_panel(
            hass,
            component_name="custom",
            sidebar_title="HA CardBook",
            sidebar_icon="mdi:address-book",
            frontend_url_path=PANEL_URL,
            config={
                "_panel_custom": {
                    "name": "cardbook-panel",
                    "js_url": f"{STATIC_URL}/cardbook-panel.js",
                    "embed_iframe": False,
                    "trust_external_script": True,
                }
            },
            require_admin=False,
        )
        hass.data[DATA_PANEL_REGISTERED] = True

    # ── Register REST API views ────────────────────────────────────────────
    # Views are idempotent — re-registering the same class is harmless.
    hass.http.register_view(CardBookContactsView)
    hass.http.register_view(CardBookContactView)
    hass.http.register_view(CardBookRefreshView)

    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    return True


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Reload entry when options change."""
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    hass.data[DOMAIN].pop(entry.entry_id, None)

    # Remove panel only when the last entry is removed
    if not hass.data.get(DOMAIN):
        from homeassistant.components.frontend import async_remove_panel

        try:
            async_remove_panel(hass, PANEL_URL)
        except Exception:
            pass

        hass.data.pop(DATA_PANEL_REGISTERED, None)
        hass.data.pop(DATA_STATIC_REGISTERED, None)

    return True
