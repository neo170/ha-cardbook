"""Config flow for CardBook integration."""
from __future__ import annotations

import logging

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.core import callback

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
from .coordinator import CardDAVCoordinator

_LOGGER = logging.getLogger(__name__)

_STEP_USER_SCHEMA = vol.Schema(
    {
        vol.Required(CONF_URL): str,
        vol.Required(CONF_USERNAME): str,
        vol.Required(CONF_PASSWORD): str,
        vol.Optional(CONF_REFRESH_INTERVAL, default=DEFAULT_REFRESH_INTERVAL): vol.All(
            int, vol.Range(min=30)
        ),
        vol.Optional(CONF_VERIFY_SSL, default=DEFAULT_VERIFY_SSL): bool,
    }
)


class CardBookConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle the initial setup config flow."""

    VERSION = 1

    async def async_step_user(self, user_input=None):
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                await CardDAVCoordinator.async_test_connection(
                    url=user_input[CONF_URL],
                    username=user_input[CONF_USERNAME],
                    password=user_input[CONF_PASSWORD],
                    verify_ssl=user_input.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
                )
            except PermissionError:
                errors["base"] = "invalid_auth"
            except Exception:
                errors["base"] = "cannot_connect"
            else:
                # Avoid duplicate entries for the same server URL
                await self.async_set_unique_id(user_input[CONF_URL])
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=_entry_title(user_input[CONF_URL]),
                    data=user_input,
                )

        return self.async_show_form(
            step_id="user",
            data_schema=_STEP_USER_SCHEMA,
            errors=errors,
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry):
        return CardBookOptionsFlow(config_entry)


class CardBookOptionsFlow(config_entries.OptionsFlow):
    """Allow editing connection parameters and refresh interval."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        self.config_entry = config_entry

    async def async_step_init(self, user_input=None):
        errors: dict[str, str] = {}

        if user_input is not None:
            try:
                await CardDAVCoordinator.async_test_connection(
                    url=user_input[CONF_URL],
                    username=user_input[CONF_USERNAME],
                    password=user_input[CONF_PASSWORD],
                    verify_ssl=user_input.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
                )
            except PermissionError:
                errors["base"] = "invalid_auth"
            except Exception:
                errors["base"] = "cannot_connect"
            else:
                return self.async_create_entry(title="", data=user_input)

        cur = self.config_entry
        schema = vol.Schema(
            {
                vol.Required(CONF_URL, default=cur.data.get(CONF_URL, "")): str,
                vol.Required(
                    CONF_USERNAME, default=cur.data.get(CONF_USERNAME, "")
                ): str,
                vol.Required(CONF_PASSWORD, default=cur.data.get(CONF_PASSWORD, "")): str,
                vol.Optional(
                    CONF_REFRESH_INTERVAL,
                    default=cur.options.get(
                        CONF_REFRESH_INTERVAL,
                        cur.data.get(CONF_REFRESH_INTERVAL, DEFAULT_REFRESH_INTERVAL),
                    ),
                ): vol.All(int, vol.Range(min=30)),
                vol.Optional(
                    CONF_VERIFY_SSL,
                    default=cur.options.get(
                        CONF_VERIFY_SSL,
                        cur.data.get(CONF_VERIFY_SSL, DEFAULT_VERIFY_SSL),
                    ),
                ): bool,
            }
        )

        return self.async_show_form(
            step_id="init",
            data_schema=schema,
            errors=errors,
        )


def _entry_title(url: str) -> str:
    from urllib.parse import urlparse

    parsed = urlparse(url)
    return parsed.netloc or url
