"""REST API views for CardBook."""
from __future__ import annotations

import logging
from http import HTTPStatus

from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


def _get_first_coordinator(hass: HomeAssistant):
    """Return the first registered coordinator or None."""
    data = hass.data.get(DOMAIN, {})
    if not data:
        return None
    return next(iter(data.values()))


class CardBookContactsView(HomeAssistantView):
    """Handle /api/cardbook/contacts — list & create."""

    url = "/api/cardbook/contacts"
    name = "api:cardbook:contacts"
    requires_auth = True

    async def get(self, request):
        """Return all contacts as JSON."""
        hass: HomeAssistant = request.app["hass"]
        all_contacts: dict = {}
        for coordinator in hass.data.get(DOMAIN, {}).values():
            all_contacts.update(coordinator.contacts)
        return self.json(list(all_contacts.values()))

    async def post(self, request):
        """Create a new contact."""
        hass: HomeAssistant = request.app["hass"]
        coordinator = _get_first_coordinator(hass)
        if coordinator is None:
            return self.json_message("No CardBook integration configured", HTTPStatus.SERVICE_UNAVAILABLE)

        try:
            data = await request.json()
        except Exception:
            return self.json_message("Invalid JSON body", HTTPStatus.BAD_REQUEST)

        try:
            contact = await coordinator.async_create_contact(data)
        except Exception as err:
            _LOGGER.error("Failed to create contact: %s", err)
            return self.json_message(str(err), HTTPStatus.INTERNAL_SERVER_ERROR)

        return self.json(contact, HTTPStatus.CREATED)


class CardBookContactView(HomeAssistantView):
    """Handle /api/cardbook/contacts/{uid} — read, update, delete."""

    url = "/api/cardbook/contacts/{uid}"
    name = "api:cardbook:contact"
    requires_auth = True

    async def get(self, request, uid: str):
        """Return a single contact."""
        hass: HomeAssistant = request.app["hass"]
        for coordinator in hass.data.get(DOMAIN, {}).values():
            contact = coordinator.contacts.get(uid)
            if contact is not None:
                return self.json(contact)
        return self.json_message("Contact not found", HTTPStatus.NOT_FOUND)

    async def put(self, request, uid: str):
        """Update an existing contact."""
        hass: HomeAssistant = request.app["hass"]
        coordinator = _get_first_coordinator(hass)
        if coordinator is None:
            return self.json_message("No CardBook integration configured", HTTPStatus.SERVICE_UNAVAILABLE)

        try:
            data = await request.json()
        except Exception:
            return self.json_message("Invalid JSON body", HTTPStatus.BAD_REQUEST)

        try:
            contact = await coordinator.async_update_contact(uid, data)
        except Exception as err:
            _LOGGER.error("Failed to update contact %s: %s", uid, err)
            return self.json_message(str(err), HTTPStatus.INTERNAL_SERVER_ERROR)

        return self.json(contact)

    async def delete(self, request, uid: str):
        """Delete a contact."""
        hass: HomeAssistant = request.app["hass"]
        coordinator = _get_first_coordinator(hass)
        if coordinator is None:
            return self.json_message("No CardBook integration configured", HTTPStatus.SERVICE_UNAVAILABLE)

        try:
            await coordinator.async_delete_contact(uid)
        except Exception as err:
            _LOGGER.error("Failed to delete contact %s: %s", uid, err)
            return self.json_message(str(err), HTTPStatus.INTERNAL_SERVER_ERROR)

        return self.json_message("Contact deleted", HTTPStatus.OK)


class CardBookRefreshView(HomeAssistantView):
    """Handle POST /api/cardbook/refresh — trigger manual sync."""

    url = "/api/cardbook/refresh"
    name = "api:cardbook:refresh"
    requires_auth = True

    async def post(self, request):
        """Trigger a manual refresh of all coordinators and return updated contacts."""
        hass: HomeAssistant = request.app["hass"]
        all_contacts: dict = {}
        for coordinator in hass.data.get(DOMAIN, {}).values():
            await coordinator.async_refresh()
            all_contacts.update(coordinator.contacts)
        return self.json(list(all_contacts.values()))
