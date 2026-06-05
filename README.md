# HA CardBook

Home Assistant integration for CardDAV address books (e.g. Nextcloud Contacts).

## Features

- Browse contacts in a full-page panel in the HA sidebar
- Create, edit and delete contacts
- Upload or paste contact photos (with crop tool)
- Copy contact details (name, phone, email, address) to clipboard
- Mobile-optimised navigation with slide transitions and back button
- Auto-refresh with configurable interval

## Installation via HACS

1. Add this repository as a custom HACS repository (type: Integration)
2. Install **HA CardBook** from HACS
3. Restart Home Assistant
4. Go to **Settings → Devices & Services → Add Integration** and search for *CardBook*
5. Enter your CardDAV URL, username and password

## Configuration

| Field | Description |
|---|---|
| CardDAV URL | Full URL to your address book (e.g. `https://nextcloud.example.com/remote.php/dav/addressbooks/users/admin/contacts/`) |
| Username | CardDAV username |
| Password | CardDAV password |
| Verify SSL | Disable for self-signed certificates |
| Refresh interval | How often contacts are synced (seconds, default 300) |

## Requirements

- Home Assistant ≥ 2023.9.0
- A CardDAV-compatible server (Nextcloud, Radicale, Baikal, …)
