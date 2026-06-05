"""Constants for the CardBook integration."""

DOMAIN = "ha_cardbook"

CONF_URL = "url"
CONF_USERNAME = "username"
CONF_PASSWORD = "password"
CONF_REFRESH_INTERVAL = "refresh_interval"
CONF_VERIFY_SSL = "verify_ssl"

DEFAULT_REFRESH_INTERVAL = 300  # 5 minutes
DEFAULT_VERIFY_SSL = True

PANEL_URL = "cardbook"
STATIC_URL = "/api/cardbook/static"

DATA_PANEL_REGISTERED = f"{DOMAIN}_panel_registered"
DATA_STATIC_REGISTERED = f"{DOMAIN}_static_registered"
