/**
 * CardBook Panel — CardDAV address book for Home Assistant
 * Custom panel element: <cardbook-panel>
 */

const EMAIL_TYPES  = ["internet", "home", "work", "other"];
const PHONE_TYPES  = ["cell", "home", "work", "voice", "fax", "pager", "other"];
const ADDRESS_TYPES = ["home", "work", "other"];
const COPY_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const EMPTY_CONTACT = () => ({
  uid: "",
  fn: "",
  n: { prefix: "", given: "", additional: "", family: "", suffix: "" },
  emails: [],
  phones: [],
  addresses: [],
  org: "",
  title: "",
  bday: "",
  url: "",
  note: "",
  categories: [],
  photo: "",
});

const AVATAR_COLORS = [
  "#1976d2","#388e3c","#f57c00","#d32f2f",
  "#7b1fa2","#0288d1","#00796b","#5d4037",
];

// ────────────────────────────────────────────────────────────────────────────
class CardBookPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass      = null;
    this._contacts  = [];       // sorted array
    this._selected  = null;     // contact object
    this._edited    = null;     // deep clone while editing
    this._editMode  = false;
    this._isNew     = false;
    this._search    = "";
    this._loading   = false;
    this._error     = "";
    this._rendered  = false;
    // Crop dialog state
    this._cropImg      = null;
    this._cropCX       = 0;
    this._cropCY       = 0;
    this._cropR        = 0;
    this._cropScale    = 1;
    this._cropDragging = false;
    this._cropDragOffX = 0;
    this._cropDragOffY = 0;
    this._cropCallback = null;
  }

  // ── HA lifecycle ──────────────────────────────────────────────────────────

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._rendered = true;
      this._buildShell();
      this._fetchContacts();
    }
  }

  // eslint-disable-next-line no-unused-vars
  set panel(_p) { /* not needed */ }

  connectedCallback() {
    if (this._hass && !this._rendered) {
      this._rendered = true;
      this._buildShell();
      this._fetchContacts();
    }
  }

  // ── Initial DOM build ─────────────────────────────────────────────────────

  _buildShell() {
    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="shell">
        <div class="header">
          <ha-icon-button id="btn-header-back" label="Zurück">
            <ha-icon icon="mdi:arrow-left"></ha-icon>
          </ha-icon-button>
          <div class="topbar-title">
            <ha-icon icon="mdi:book-account"></ha-icon>
            <span>CardBook</span>
          </div>
          <div class="header-actions">
            <ha-icon-button id="btn-new" label="Neuer Kontakt">
              <ha-icon icon="mdi:account-plus"></ha-icon>
            </ha-icon-button>
            <ha-icon-button id="btn-refresh" label="Aktualisieren">
              <ha-icon icon="mdi:refresh"></ha-icon>
            </ha-icon-button>
          </div>
        </div>
        <div class="body-layout">
          <aside class="sidebar" id="sidebar">
            <div class="sidebar-toolbar">
              <div class="search-wrap">
                <span class="search-icon">&#128269;</span>
                <input id="search" type="search" placeholder="Suchen…" autocomplete="off">
              </div>
            </div>
            <div class="contact-list" id="contact-list"></div>
          </aside>
          <main class="detail" id="detail">
            <div class="empty-state" id="empty-state">
              <div class="empty-icon">&#128100;</div>
              <p>Kontakt auswählen oder neuen anlegen</p>
            </div>
            <div id="contact-panel" style="display:none"></div>
          </main>
        </div>
      </div>
      <div class="toast" id="toast"></div>

      <!-- ── Confirm dialog ────────────────────────────────────────────── -->
      <div class="confirm-overlay" id="confirm-overlay">
        <div class="confirm-dialog">
          <div class="confirm-message" id="confirm-message"></div>
          <div class="confirm-actions">
            <button class="btn-danger"     id="btn-confirm-ok">OK</button>
            <button class="btn-secondary"  id="btn-confirm-cancel">Abbrechen</button>
          </div>
        </div>
      </div>

      <!-- ── Crop dialog ─────────────────────────────────────────────── -->
      <div class="crop-overlay" id="crop-overlay">
        <div class="crop-dialog">
          <div class="crop-title">&#9986; Foto zuschneiden</div>
          <div class="crop-hint">Kreis verschieben · Mausrad/± zum Vergrößern · Strg+V zum Ersetzen</div>
          <canvas id="crop-canvas"></canvas>
          <div class="crop-size-row">
            <button class="icon-btn" id="btn-crop-smaller" title="Kleiner">&#8722;</button>
            <span class="crop-size-label">Ausschnitt</span>
            <button class="icon-btn" id="btn-crop-larger"  title="Größer">&#43;</button>
            <button class="btn-secondary" id="btn-crop-paste" title="Bild aus Zwischenablage">&#128203; Einfügen</button>
          </div>
          <div class="crop-actions">
            <button class="btn-primary"   id="btn-crop-confirm">&#10003; Übernehmen</button>
            <button class="btn-secondary" id="btn-crop-cancel" >&#10005; Abbrechen</button>
          </div>
        </div>
      </div>
    `;

    const root = this.shadowRoot;

    root.getElementById("search").addEventListener("input", (e) => {
      this._search = e.target.value;
      this._renderList();
    });

    root.getElementById("btn-new").addEventListener("click", () => this._newContact());
    root.getElementById("btn-refresh").addEventListener("click", () => this._fetchContacts(true));
    root.getElementById("btn-header-back").addEventListener("click", () => this._backToList());

    // Event delegation inside the contact list
    root.getElementById("contact-list").addEventListener("click", (e) => {
      const item = e.target.closest(".contact-item");
      if (item) this._selectContact(item.dataset.uid);
    });

    // Global paste: replace image when crop dialog is open,
    // or open crop dialog directly when edit mode is active
    document.addEventListener("paste", (e) => {
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith("image/"));
      if (!item) return;
      const overlay = this.shadowRoot.getElementById("crop-overlay");
      if (overlay?.classList.contains("visible")) {
        // Replace current crop image
        const blob = item.getAsFile();
        if (blob) this._loadImageBlob(blob, (img) => this._initCropCanvas(img));
      } else if (this._editMode) {
        // Open crop dialog from clipboard
        const blob = item.getAsFile();
        if (blob) this._loadImageBlob(blob, (img) => {
          this._initCropCanvas(img);
          this.shadowRoot.getElementById("crop-overlay").classList.add("visible");
        });
      }
    });
  }

  // ── Data layer ────────────────────────────────────────────────────────────

  async _fetchContacts(manual = false) {
    this._loading = true;
    if (manual) this._showToast("Aktualisiere…", "info");
    try {
      const data = await this._callApi("GET", "cardbook/contacts");
      this._contacts = (Array.isArray(data) ? data : [])
        .sort((a, b) => (a.fn || "").localeCompare(b.fn || "", undefined, { sensitivity: "base" }));
      this._renderList();
      if (manual) this._showToast("Kontakte aktualisiert", "success");
    } catch (err) {
      this._showToast("Fehler beim Laden der Kontakte: " + err.message, "error");
    }
    this._loading = false;
  }

  async _saveContact() {
    if (!this._edited) return;
    // Derive FN from name components if empty
    if (!this._edited.fn) {
      const n = this._edited.n;
      this._edited.fn = [n.family, n.given].filter(Boolean).join(", ").trim();
    }
    try {
      let saved;
      if (this._isNew) {
        saved = await this._callApi("POST", "cardbook/contacts", this._edited);
        this._showToast("Kontakt erstellt", "success");
      } else {
        saved = await this._callApi("PUT", `cardbook/contacts/${this._edited.uid}`, this._edited);
        this._showToast("Kontakt gespeichert", "success");
      }
      // Update local list
      const idx = this._contacts.findIndex((c) => c.uid === saved.uid);
      if (idx >= 0) this._contacts[idx] = saved;
      else this._contacts.push(saved);
      this._contacts.sort((a, b) =>
        (a.fn || "").localeCompare(b.fn || "", undefined, { sensitivity: "base" })
      );
      this._selected = saved;
      this._editMode = false;
      this._isNew    = false;
      this._edited   = null;
      this._renderList();
      this._renderDetail();
    } catch (err) {
      this._showToast("Fehler beim Speichern: " + err.message, "error");
    }
  }

  async _deleteContact() {
    if (!this._selected) return;
    if (!await this._confirm(`Kontakt "${this._selected.fn}" wirklich löschen?`, "Löschen")) return;
    try {
      await this._callApi("DELETE", `cardbook/contacts/${this._selected.uid}`);
      this._contacts = this._contacts.filter((c) => c.uid !== this._selected.uid);
      this._selected = null;
      this._editMode = false;
      this._isNew    = false;
      this._edited   = null;
      this._showToast("Kontakt gelöscht", "success");
      this._renderList();
      this._renderDetail();
      this._backToList();
    } catch (err) {
      this._showToast("Fehler beim Löschen: " + err.message, "error");
    }
  }

  _callApi(method, path, body) {
    if (this._hass && typeof this._hass.callApi === "function") {
      return this._hass.callApi(method, path, body);
    }
    // Fallback: raw fetch with bearer token
    const opts = {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this._hass?.auth?.data?.access_token || ""}`,
      },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(`/api/${path}`, opts).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
  }

  // ── UI helpers ────────────────────────────────────────────────────────────

  _selectContact(uid) {
    this._selected = this._contacts.find((c) => c.uid === uid) || null;
    this._editMode = false;
    this._isNew    = false;
    this._edited   = null;
    this._renderList();
    this._renderDetail();
    this._openDetail();
  }

  _newContact() {
    this._selected = null;
    this._isNew    = true;
    this._editMode = true;
    this._edited   = EMPTY_CONTACT();
    this._renderList();
    this._renderDetail();
    this._openDetail();
  }

  _startEdit() {
    this._edited   = JSON.parse(JSON.stringify(this._selected));
    this._editMode = true;
    this._renderDetail();
  }

  _cancelEdit() {
    const wasNew = this._isNew;
    this._editMode = false;
    this._isNew    = false;
    this._edited   = null;
    this._renderDetail();
    if (wasNew) this._backToList();
  }

  _openDetail() {
    this.shadowRoot.querySelector(".shell")?.classList.add("detail-open");
  }

  _backToList() {
    this.shadowRoot.querySelector(".shell")?.classList.remove("detail-open");
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _renderList() {
    const list  = this.shadowRoot.getElementById("contact-list");
    const query = this._search.toLowerCase();
    const items = this._contacts.filter((c) => {
      if (!query) return true;
      return (
        (c.fn || "").toLowerCase().includes(query) ||
        (c.org || "").toLowerCase().includes(query) ||
        (c.emails || []).some((e) => e.value.toLowerCase().includes(query)) ||
        (c.phones || []).some((p) => p.value.toLowerCase().includes(query))
      );
    });

    list.innerHTML = items.length
      ? items.map((c) => this._contactItemHtml(c)).join("")
      : `<div class="no-results">Keine Kontakte gefunden</div>`;
  }

  _contactItemHtml(c) {
    const active  = this._selected?.uid === c.uid ? " active" : "";
    const initials = this._initials(c);
    const color   = this._avatarColor(c);
    const sub     = (c.emails?.[0]?.value) || (c.phones?.[0]?.value) || (c.org) || "";
    const photo   = c.photo
      ? `<img src="${_esc(c.photo)}" class="avatar-img" alt="">`
      : `<span class="avatar-text" style="background:${color}">${_esc(initials)}</span>`;

    return `
      <div class="contact-item${active}" data-uid="${_esc(c.uid)}">
        <div class="avatar">${photo}</div>
        <div class="item-info">
          <div class="item-name">${_esc(c.fn || "(Kein Name)")}</div>
          ${sub ? `<div class="item-sub">${_esc(sub)}</div>` : ""}
        </div>
      </div>`;
  }

  _renderDetail() {
    const emptyEl  = this.shadowRoot.getElementById("empty-state");
    const panelEl  = this.shadowRoot.getElementById("contact-panel");

    const contact = this._editMode ? this._edited : this._selected;

    if (!contact) {
      emptyEl.style.display  = "";
      panelEl.style.display  = "none";
      return;
    }

    emptyEl.style.display = "none";
    panelEl.style.display = "";
    panelEl.innerHTML     = this._detailHtml(contact, this._editMode);

    // Wire up all event listeners inside the panel
    this._attachDetailListeners(panelEl, contact);
  }

  _detailHtml(c, edit) {
    const ro = !edit;      // read-only shorthand
    const initials = this._initials(c);
    const color    = this._avatarColor(c);
    const photo    = c.photo
      ? `<img src="${_esc(c.photo)}" class="detail-photo" id="photo-preview" alt="Foto">`
      : `<div class="detail-photo-placeholder" id="photo-preview" style="background:${color}">${_esc(initials)}</div>`;

    return `
      <div class="detail-header">
        <div class="photo-wrap">
          ${photo}
          ${edit ? `
            <button class="photo-btn" id="btn-photo-upload" title="Foto hochladen"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button>
            <button class="photo-btn photo-btn-paste" id="btn-photo-paste" title="Aus Zwischenablage (Strg+V)"><svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            ${c.photo ? `<button class="photo-btn photo-btn-del" id="btn-photo-remove" title="Foto entfernen">&#10005;</button>` : ""}
            <input type="file" id="photo-file" accept="image/*" style="display:none">
          ` : ""}
        </div>
        <div class="header-name">
          ${ro
            ? `<div class="fn-name-row">
                 <h2 class="fn-display">${_esc(c.fn || "(Kein Name)")}</h2>
                 <button class="btn-copy-inline" data-copy-all="1" title="Alle Kontaktdaten kopieren">${COPY_ICON}</button>
               </div>
               ${c.org   ? `<div class="header-org">${_esc(c.org)}${c.title ? " · " + _esc(c.title) : ""}</div>` : ""}
               <div class="header-actions">
                 <button class="btn-primary" id="btn-edit">&#9998; Bearbeiten</button>
                 <button class="btn-danger"  id="btn-delete">&#128465; Löschen</button>
               </div>`
            : `<div class="header-actions">
                 <button class="btn-primary" id="btn-save">&#10003; Speichern</button>
                 <button class="btn-secondary" id="btn-cancel">&#10005; Abbrechen</button>
               </div>`
          }
        </div>
      </div>

      <div class="detail-body">
        <!-- Name: always visible; in read-only skip empty sub-fields -->
        <section class="section">
          <h3 class="section-title">Name</h3>
          <div class="field-row">
            ${ro && !c.n?.prefix     ? "" : _field("Anrede",          "n.prefix",     c.n?.prefix     || "", ro, "text")}
            ${ro && !c.n?.given      ? "" : _field("Vorname",         "n.given",      c.n?.given      || "", ro, "text")}
            ${ro && !c.n?.additional ? "" : _field("Zweiter Vorname", "n.additional", c.n?.additional || "", ro, "text")}
            ${ro && !c.n?.family     ? "" : _field("Nachname",        "n.family",     c.n?.family     || "", ro, "text")}
            ${ro && !c.n?.suffix     ? "" : _field("Suffix",          "n.suffix",     c.n?.suffix     || "", ro, "text")}
          </div>
          <div class="field-row">
            ${_field("Anzeigename", "fn", c.fn || "", ro, "text", true)}
          </div>
        </section>

        <!-- Beruf: nur wenn Daten vorhanden oder im Bearbeitungsmodus -->
        ${ro && !c.org && !c.title ? "" : `
        <section class="section">
          <h3 class="section-title">Beruf</h3>
          <div class="field-row">
            ${_field("Organisation", "org",   c.org   || "", ro, "text", true)}
            ${_field("Titel",        "title", c.title || "", ro, "text")}
          </div>
        </section>`}

        <!-- E-Mail -->
        ${ro && !(c.emails?.length) ? "" : `
        <section class="section" id="section-emails">
          <h3 class="section-title">
            E-Mail
            ${edit ? `<button class="add-btn" id="btn-add-email">&#43;</button>` : ""}
          </h3>
          <div id="email-list">
            ${(c.emails || []).map((e, i) => _multiField("email", i, e, ro, EMAIL_TYPES)).join("")}
          </div>
        </section>`}

        <!-- Telefon -->
        ${ro && !(c.phones?.length) ? "" : `
        <section class="section" id="section-phones">
          <h3 class="section-title">
            Telefon
            ${edit ? `<button class="add-btn" id="btn-add-phone">&#43;</button>` : ""}
          </h3>
          <div id="phone-list">
            ${(c.phones || []).map((p, i) => _multiField("phone", i, p, ro, PHONE_TYPES)).join("")}
          </div>
        </section>`}

        <!-- Adressen -->
        ${ro && !(c.addresses?.length) ? "" : `
        <section class="section" id="section-addresses">
          <h3 class="section-title">
            Adressen
            ${edit ? `<button class="add-btn" id="btn-add-address">&#43;</button>` : ""}
          </h3>
          <div id="address-list">
            ${(c.addresses || []).map((a, i) => _addressBlock(i, a, ro)).join("")}
          </div>
        </section>`}

        <!-- Geburtstag & URL -->
        ${ro && !c.bday && !c.url ? "" : `
        <section class="section">
          <h3 class="section-title">Weiteres</h3>
          <div class="field-row">
            ${ro && !c.bday ? "" : _field("Geburtstag", "bday", c.bday || "", ro, "date")}
            ${ro && !c.url  ? "" : _field("Website",    "url",  c.url  || "", ro, "url", true)}
          </div>
        </section>`}

        <!-- Notiz -->
        ${ro && !c.note ? "" : `
        <section class="section">
          <h3 class="section-title">Notiz</h3>
          ${ro
            ? `<div class="copy-wrap"><div class="note-display">${_esc(c.note || "").replace(/\n/g, "<br>")}</div><button class="btn-copy-inline" data-copy-field="note" title="Kopieren">${COPY_ICON}</button></div>`
            : `<textarea class="field-input full-width" data-field="note" rows="4">${_esc(c.note || "")}</textarea>`
          }
        </section>`}

        <!-- Kategorien -->
        ${ro && !(c.categories?.length) ? "" : `
        <section class="section">
          <h3 class="section-title">Kategorien</h3>
          ${_field("Kategorien (kommagetrennt)", "categories_str",
              (c.categories || []).join(", "), ro, "text", true)}
        </section>`}
      </div>
    `;
  }

  _attachDetailListeners(panelEl, contact) {
    const root = panelEl;

    // Read-only action buttons
    root.querySelector("#btn-edit")?.addEventListener("click", () => this._startEdit());
    root.querySelector("#btn-delete")?.addEventListener("click", () => this._deleteContact());
    if (this._copyClickHandler) root.removeEventListener("click", this._copyClickHandler);
    this._copyClickHandler = (e) => {
      const btn = e.target.closest(".btn-copy-inline");
      if (!btn) return;
      const text = btn.dataset.copyAll === "1"
        ? _formatContactText(contact)
        : btn.dataset.copyField === "note"
          ? (contact.note || "")
          : (btn.dataset.copy || "");
      if (!text) return;
      _clipboardWrite(text,
        () => this._showToast("Kopiert", "info"),
        () => this._showToast("Kopieren fehlgeschlagen", "error")
      );
    };
    root.addEventListener("click", this._copyClickHandler);

    // Edit mode action buttons
    root.querySelector("#btn-save")?.addEventListener("click", () => this._saveContact());
    root.querySelector("#btn-cancel")?.addEventListener("click", () => this._cancelEdit());

    if (!this._editMode) return;

    const ed = this._edited;

    // Generic field change (simple path)
    root.querySelectorAll("[data-field]").forEach((el) => {
      el.addEventListener("input", (e) => {
        const f = e.target.dataset.field;
        const v = e.target.value;
        _setPath(ed, f, v);
        // Keep FN in sync with n.given / n.family if fn not manually changed
        if (f === "n.given" || f === "n.family") {
          const fnEl = root.querySelector("[data-field='fn']");
          if (fnEl && !fnEl.dataset.manual) {
            const n = ed.n;
            const computed = [n.family, n.given].filter(Boolean).join(", ");
            fnEl.value = computed;
            ed.fn = computed;
          }
        }
        if (f === "fn") el.dataset.manual = "1";
        if (f === "categories_str") {
          ed.categories = v.split(",").map((s) => s.trim()).filter(Boolean);
        }
      });
    });

    // Multi-value fields: email
    root.querySelector("#btn-add-email")?.addEventListener("click", () => {
      ed.emails.push({ type: "internet", value: "", pref: false });
      this._rerenderMultiList("email-list", ed.emails, EMAIL_TYPES, "email", root);
    });
    root.querySelector("#email-list").addEventListener("click", (e) => {
      const btn = e.target.closest(".remove-btn");
      if (btn) {
        const i = parseInt(btn.dataset.index, 10);
        ed.emails.splice(i, 1);
        this._rerenderMultiList("email-list", ed.emails, EMAIL_TYPES, "email", root);
      }
    });
    root.querySelector("#email-list").addEventListener("input", (e) => {
      const el = e.target;
      const i  = parseInt(el.dataset.index, 10);
      if (el.dataset.subfield === "value") ed.emails[i].value = el.value;
      if (el.dataset.subfield === "label") ed.emails[i].label = el.value;
    });
    root.querySelector("#email-list").addEventListener("change", (e) => {
      const el = e.target;
      const i  = parseInt(el.dataset.index, 10);
      if (el.dataset.subfield === "label") ed.emails[i].label = el.value;
    });

    // Multi-value fields: phone
    root.querySelector("#btn-add-phone")?.addEventListener("click", () => {
      ed.phones.push({ type: "voice", value: "", pref: false });
      this._rerenderMultiList("phone-list", ed.phones, PHONE_TYPES, "phone", root);
    });
    root.querySelector("#phone-list").addEventListener("click", (e) => {
      const btn = e.target.closest(".remove-btn");
      if (btn) {
        const i = parseInt(btn.dataset.index, 10);
        ed.phones.splice(i, 1);
        this._rerenderMultiList("phone-list", ed.phones, PHONE_TYPES, "phone", root);
      }
    });
    root.querySelector("#phone-list").addEventListener("input", (e) => {
      const el = e.target;
      const i  = parseInt(el.dataset.index, 10);
      if (el.dataset.subfield === "value") ed.phones[i].value = el.value;
      if (el.dataset.subfield === "label") ed.phones[i].label = el.value;
    });
    root.querySelector("#phone-list").addEventListener("change", (e) => {
      const el = e.target;
      const i  = parseInt(el.dataset.index, 10);
      if (el.dataset.subfield === "label") ed.phones[i].label = el.value;
    });

    // Multi-value fields: address
    root.querySelector("#btn-add-address")?.addEventListener("click", () => {
      ed.addresses.push({ type: "home", street: "", city: "", region: "", zip: "", country: "", pobox: "", extended: "" });
      this._rerenderAddressList(root);
    });
    root.querySelector("#address-list").addEventListener("click", (e) => {
      const btn = e.target.closest(".remove-btn");
      if (btn) {
        const i = parseInt(btn.dataset.index, 10);
        ed.addresses.splice(i, 1);
        this._rerenderAddressList(root);
      }
    });
    root.querySelector("#address-list").addEventListener("input", (e) => {
      const el = e.target;
      const i  = parseInt(el.dataset.index, 10);
      const sf = el.dataset.subfield;
      if (sf && !isNaN(i)) ed.addresses[i][sf] = el.value;
    });
    root.querySelector("#address-list").addEventListener("change", (e) => {
      const el = e.target;
      const i  = parseInt(el.dataset.index, 10);
      const sf = el.dataset.subfield;
      if (sf && !isNaN(i)) ed.addresses[i][sf] = el.value;
    });

    // Photo upload → open crop dialog
    root.querySelector("#btn-photo-upload")?.addEventListener("click", () => {
      root.querySelector("#photo-file").click();
    });
    root.querySelector("#btn-photo-paste")?.addEventListener("click", () => this._pasteFromClipboard());
    root.querySelector("#photo-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Reset so same file can be selected again
      e.target.value = "";
      this._openCropDialog(file, (dataUrl) => {
        ed.photo = dataUrl;
        const preview = root.querySelector("#photo-preview");
        if (preview) {
          if (preview.tagName === "IMG") {
            preview.src = dataUrl;
          } else {
            const img = document.createElement("img");
            img.src       = dataUrl;
            img.className = "detail-photo";
            img.id        = "photo-preview";
            img.alt       = "";
            preview.replaceWith(img);
          }
        }
      });
    });
    root.querySelector("#btn-photo-remove")?.addEventListener("click", () => {
      ed.photo = "";
      this._renderDetail();
    });
  }

  // ── Crop dialog ───────────────────────────────────────────────────────────

  _openCropDialog(file, callback) {
    this._cropCallback = callback;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        this._initCropCanvas(img);
        this.shadowRoot.getElementById("crop-overlay").classList.add("visible");
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  _initCropCanvas(img) {
    const canvas  = this.shadowRoot.getElementById("crop-canvas");
    const maxW    = Math.min(640, (this.offsetWidth  || window.innerWidth)  - 80);
    const maxH    = Math.min(420, (this.offsetHeight || window.innerHeight) - 260);
    const scale   = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);

    canvas.width  = Math.round(img.naturalWidth  * scale);
    canvas.height = Math.round(img.naturalHeight * scale);

    this._cropImg   = img;
    this._cropScale = scale;
    this._cropCX    = Math.round(canvas.width  / 2);
    this._cropCY    = Math.round(canvas.height / 2);
    this._cropR     = Math.round(Math.min(canvas.width, canvas.height) * 0.4);

    // Wire canvas events (once)
    if (!canvas._cropBound) {
      canvas._cropBound = true;
      canvas.addEventListener("mousedown",  (e) => this._cropMouseDown(e));
      canvas.addEventListener("mousemove",  (e) => this._cropMouseMove(e));
      canvas.addEventListener("mouseup",   ()  => { this._cropDragging = false; });
      canvas.addEventListener("mouseleave",()  => { this._cropDragging = false; });
      canvas.addEventListener("wheel",      (e) => this._cropWheel(e),  { passive: false });
      canvas.addEventListener("touchstart", (e) => this._cropTouchStart(e), { passive: false });
      canvas.addEventListener("touchmove",  (e) => this._cropTouchMove(e),  { passive: false });
      canvas.addEventListener("touchend",   ()  => { this._cropDragging = false; });
    }

    // Wire dialog buttons (once)
    const sr = this.shadowRoot;
    if (!sr._cropDialogBound) {
      sr._cropDialogBound = true;
      sr.getElementById("btn-crop-confirm").addEventListener("click", () => this._confirmCrop());
      sr.getElementById("btn-crop-cancel" ).addEventListener("click", () => this._closeCropDialog());
      sr.getElementById("btn-crop-smaller").addEventListener("click", () => this._resizeCrop(-20));
      sr.getElementById("btn-crop-larger" ).addEventListener("click", () => this._resizeCrop(+20));
      sr.getElementById("btn-crop-paste"  ).addEventListener("click", () => this._pasteFromClipboard(true));
    }

    this._drawCrop();
  }

  _cropCanvasCoords(e) {
    const canvas = this.shadowRoot.getElementById("crop-canvas");
    const rect   = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

  _cropMouseDown(e) {
    const { x, y } = this._cropCanvasCoords(e);
    const dx = x - this._cropCX, dy = y - this._cropCY;
    if (dx * dx + dy * dy <= this._cropR * this._cropR) {
      this._cropDragging = true;
      this._cropDragOffX = dx;
      this._cropDragOffY = dy;
    }
  }

  _cropMouseMove(e) {
    if (!this._cropDragging) return;
    const canvas    = this.shadowRoot.getElementById("crop-canvas");
    const { x, y }  = this._cropCanvasCoords(e);
    const r         = this._cropR;
    this._cropCX    = Math.max(r, Math.min(canvas.width  - r, x - this._cropDragOffX));
    this._cropCY    = Math.max(r, Math.min(canvas.height - r, y - this._cropDragOffY));
    this._drawCrop();
  }

  _cropTouchStart(e) {
    e.preventDefault();
    const t = e.touches[0];
    this._cropMouseDown({ clientX: t.clientX, clientY: t.clientY });
  }

  _cropTouchMove(e) {
    e.preventDefault();
    const t = e.touches[0];
    this._cropMouseMove({ clientX: t.clientX, clientY: t.clientY });
  }

  _cropWheel(e) {
    e.preventDefault();
    this._resizeCrop(e.deltaY < 0 ? +12 : -12);
  }

  _resizeCrop(delta) {
    const canvas = this.shadowRoot.getElementById("crop-canvas");
    const maxR   = Math.min(this._cropCX, canvas.width - this._cropCX,
                            this._cropCY, canvas.height - this._cropCY);
    this._cropR  = Math.max(24, Math.min(maxR, this._cropR + delta));
    this._drawCrop();
  }

  _drawCrop() {
    const canvas = this.shadowRoot.getElementById("crop-canvas");
    const ctx    = canvas.getContext("2d");
    const cx = this._cropCX, cy = this._cropCY, r = this._cropR;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this._cropImg, 0, 0, canvas.width, canvas.height);

    // Semi-transparent overlay with circular hole (evenodd rule)
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.arc(cx, cy, r, 0, Math.PI * 2, true); // counter-clockwise = hole
    ctx.fill("evenodd");
    ctx.restore();

    // Dashed circle border
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth   = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Move-cursor hint: crosshair in center
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10); ctx.stroke();
    ctx.restore();
  }

  _confirmCrop() {
    const OUT    = 256; // output pixel size
    const off    = document.createElement("canvas");
    off.width    = OUT;
    off.height   = OUT;
    const ctx    = off.getContext("2d");

    // Clip to circle
    ctx.beginPath();
    ctx.arc(OUT / 2, OUT / 2, OUT / 2, 0, Math.PI * 2);
    ctx.clip();

    // Source rect in original image pixels
    const invScale = 1 / this._cropScale;
    const srcX     = (this._cropCX - this._cropR) * invScale;
    const srcY     = (this._cropCY - this._cropR) * invScale;
    const srcSize  = this._cropR * 2 * invScale;

    ctx.drawImage(this._cropImg, srcX, srcY, srcSize, srcSize, 0, 0, OUT, OUT);

    const dataUrl = off.toDataURL("image/jpeg", 0.92);

    if (this._cropCallback) {
      // Normal flow: callback set by file-input or explicit open
      this._cropCallback(dataUrl);
    } else if (this._editMode && this._edited) {
      // Clipboard paste flow: no callback — update edited contact directly
      this._edited.photo = dataUrl;
      this._closeCropDialog();
      this._renderDetail();   // re-render edit form with new photo
      return;
    }
    this._closeCropDialog();
  }

  _closeCropDialog() {
    this.shadowRoot.getElementById("crop-overlay").classList.remove("visible");
    this._cropImg      = null;
    this._cropCallback = null;
  }

  async _pasteFromClipboard(replaceInDialog = false) {
    // Try modern async Clipboard API
    if (navigator.clipboard?.read) {
      try {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith("image/")) {
              const blob = await item.getType(type);
              this._loadImageBlob(blob, (img) => {
                this._initCropCanvas(img);
                if (!replaceInDialog) {
                  this.shadowRoot.getElementById("crop-overlay").classList.add("visible");
                }
              });
              return;
            }
          }
        }
        this._showToast("Keine Bilddaten in der Zwischenablage", "error");
        return;
      } catch (_) {
        // Permission denied — fall through to hint
      }
    }
    // Fallback: instruct user
    this._showToast("Strg+V drücken um das Bild einzufügen", "info");
  }

  _loadImageBlob(blob, callback) {
    const url  = URL.createObjectURL(blob);
    const img  = new Image();
    img.onload  = () => { URL.revokeObjectURL(url); callback(img); };
    img.onerror = () => { URL.revokeObjectURL(url); this._showToast("Bild konnte nicht geladen werden", "error"); };
    img.src = url;
  }

  // ── Multi-field helpers ───────────────────────────────────────────────────

  _rerenderMultiList(listId, items, types, kind, root) {
    root.querySelector("#" + listId).innerHTML =
      items.map((item, i) => _multiField(kind, i, item, false, types)).join("");
  }

  _rerenderAddressList(root) {
    root.querySelector("#address-list").innerHTML =
      (this._edited?.addresses || []).map((a, i) => _addressBlock(i, a, false)).join("");
  }

  // ── Utility ───────────────────────────────────────────────────────────────

  _initials(c) {
    if (c.n?.given && c.n?.family)
      return (c.n.given[0] + c.n.family[0]).toUpperCase();
    if (c.fn) return c.fn.slice(0, 2).toUpperCase();
    return "?";
  }

  _avatarColor(c) {
    const str = c.uid || c.fn || "";
    let hash  = 0;
    for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  }

  _showToast(msg, type = "info") {
    const el = this.shadowRoot.getElementById("toast");
    el.textContent = msg;
    el.className   = `toast toast-${type} show`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      el.className = "toast";
    }, 3500);
  }

  _confirm(msg, okLabel = "OK") {
    return new Promise((resolve) => {
      const overlay = this.shadowRoot.getElementById("confirm-overlay");
      this.shadowRoot.getElementById("confirm-message").textContent = msg;
      const okBtn     = this.shadowRoot.getElementById("btn-confirm-ok");
      const cancelBtn = this.shadowRoot.getElementById("btn-confirm-cancel");
      okBtn.textContent = okLabel;
      overlay.classList.add("visible");
      const done = (result) => {
        overlay.classList.remove("visible");
        okBtn.removeEventListener("click", onOk);
        cancelBtn.removeEventListener("click", onCancel);
        resolve(result);
      };
      const onOk     = () => done(true);
      const onCancel = () => done(false);
      okBtn.addEventListener("click", onOk);
      cancelBtn.addEventListener("click", onCancel);
    });
  }

  // ── Styles ────────────────────────────────────────────────────────────────

  _styles() {
    return `
      *, *::before, *::after { box-sizing: border-box; }

      :host {
        display: block;
        height: 100%;
        background: var(--primary-background-color, #f5f5f5);
        font-family: var(--paper-font-body1_-_font-family, Roboto, sans-serif);
        font-size: 14px;
        color: var(--primary-text-color, #212121);
      }

      .shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      /* ── App header ────────────────────────────────────────────────────── */
      .header {
        display: flex;
        align-items: center;
        height: var(--header-height);
        background: var(--app-header-background-color);
        color: var(--app-header-text-color);
        border-bottom: var(--app-header-border-bottom);
        padding: 0;
        flex-shrink: 0;
        position: relative;
      }

      .header ha-icon-button {
        color: var(--app-header-text-color);
        --mdc-icon-button-size: var(--header-height);
      }

      .topbar-title {
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 1;
        min-width: 0;
        height: var(--header-height);
        font-size: var(--app-header-font-size, var(--ha-font-size-xl));
        font-weight: var(--ha-font-weight-normal);
        line-height: var(--header-height);
        gap: var(--ha-space-1, 4px);
      }

      .header-actions {
        display: flex;
        align-items: center;
      }

      /* ── Body layout (sidebar + detail) ───────────────────────────────── */
      .body-layout {
        display: flex;
        flex: 1;
        overflow: hidden;
        min-height: 0;
      }

      /* ── Sidebar ───────────────────────────────────────────────────────── */
      .sidebar {
        width: 300px;
        min-width: 240px;
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        background: var(--card-background-color, #fff);
        border-right: 1px solid var(--divider-color, #e0e0e0);
        overflow: hidden;
      }

      .sidebar-toolbar {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--divider-color, #e0e0e0);
        flex-shrink: 0;
      }

      .search-wrap {
        position: relative;
        flex: 1;
      }

      .search-icon {
        position: absolute;
        left: 8px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 13px;
        opacity: .5;
        pointer-events: none;
      }

      #search {
        width: 100%;
        padding: 6px 8px 6px 28px;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 20px;
        background: var(--primary-background-color, #f5f5f5);
        color: var(--primary-text-color, #212121);
        font-size: 13px;
        outline: none;
      }
      #search:focus { border-color: var(--primary-color, #03a9f4); }

      .icon-btn {
        width: 32px; height: 32px;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--secondary-text-color, #757575);
        cursor: pointer;
        font-size: 18px;
        display: flex; align-items: center; justify-content: center;
        transition: background .15s;
      }
      .icon-btn:hover { background: var(--secondary-background-color, #eee); }

      .contact-list {
        flex: 1;
        overflow-y: auto;
        padding: 4px 0;
      }

      .contact-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        cursor: pointer;
        border-radius: 0;
        transition: background .12s;
      }
      .contact-item:hover  { background: var(--secondary-background-color, #f5f5f5); }
      .contact-item.active { background: var(--primary-color, #03a9f4)22; }

      .avatar {
        width: 40px; height: 40px;
        border-radius: 50%;
        overflow: hidden;
        flex-shrink: 0;
      }
      .avatar-img  { width: 100%; height: 100%; object-fit: cover; }
      .avatar-text {
        width: 100%; height: 100%;
        display: flex; align-items: center; justify-content: center;
        font-weight: 600;
        font-size: 15px;
        color: #fff;
      }

      .item-info { overflow: hidden; }
      .item-name { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .item-sub  { font-size: 12px; color: var(--secondary-text-color, #757575); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .no-results { padding: 20px; text-align: center; color: var(--secondary-text-color, #757575); }

      /* ── Detail panel ─────────────────────────────────────────────────── */
      .detail {
        flex: 1;
        overflow-y: auto;
        padding: 0;
        display: flex;
        flex-direction: column;
      }

      .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        color: var(--secondary-text-color, #9e9e9e);
        user-select: none;
      }
      .empty-icon { font-size: 64px; opacity: .3; }

      #contact-panel { flex: 1; }

      /* ── Detail header ────────────────────────────────────────────────── */
      .detail-header {
        display: flex;
        align-items: flex-start;
        gap: 20px;
        padding: 24px 24px 16px;
        background: var(--card-background-color, #fff);
        border-bottom: 1px solid var(--divider-color, #e0e0e0);
      }

      .photo-wrap {
        position: relative;
        flex-shrink: 0;
      }

      .detail-photo,
      .detail-photo-placeholder {
        width: 80px; height: 80px;
        border-radius: 50%;
        object-fit: cover;
        display: flex; align-items: center; justify-content: center;
        font-size: 28px; font-weight: 700; color: #fff;
      }

      .photo-btn {
        position: absolute;
        bottom: 0; right: -4px;
        width: 26px; height: 26px;
        border-radius: 50%;
        border: 2px solid var(--card-background-color, #fff);
        background: var(--primary-color, #03a9f4);
        color: #fff;
        font-size: 13px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        padding: 0;
      }
      .photo-btn-paste {
        bottom: 0;
        left: -4px;
        right: auto;
        background: var(--primary-color, #03a9f4);
      }

      .photo-btn-del {
        top: 0;
        bottom: auto;
        background: var(--error-color, #f44336);
      }

      .header-name { flex: 1; }
      .fn-display  { margin: 0 0 4px; font-size: 22px; font-weight: 500; }
      .fn-name-row { display: flex; align-items: center; gap: 6mm; }
      .header-org  { color: var(--secondary-text-color, #757575); margin-bottom: 10px; }
      .copy-wrap { display: inline-flex; align-items: center; gap: 6mm; max-width: 100%; }
      .btn-copy-inline {
        opacity: 0; flex-shrink: 0; background: none; border: none; cursor: pointer;
        color: var(--secondary-text-color, #9e9e9e); padding: 2px; border-radius: 3px;
        display: inline-flex; align-items: center; justify-content: center;
        transition: opacity .15s, background .15s; line-height: 1;
      }
      .copy-wrap:hover .btn-copy-inline,
      .fn-name-row:hover .btn-copy-inline { opacity: 1; }
      .btn-copy-inline:hover { background: rgba(0,0,0,0.03); color: var(--primary-text-color, #212121); }
      .header-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }

      /* ── Buttons ──────────────────────────────────────────────────────── */
      .btn-primary, .btn-secondary, .btn-danger {
        padding: 7px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: filter .15s;
      }
      .btn-primary   { background: var(--primary-color, #03a9f4); color: #fff; }
      .btn-secondary { background: var(--secondary-background-color, #e0e0e0); color: var(--primary-text-color, #212121); }
      .btn-danger    { background: var(--error-color, #f44336); color: #fff; }
      .btn-primary:hover, .btn-secondary:hover, .btn-danger:hover { filter: brightness(.9); }

      .add-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px;
        border-radius: 50%;
        border: none;
        background: var(--primary-color, #03a9f4);
        color: #fff;
        font-size: 16px;
        cursor: pointer;
        margin-left: 8px;
        vertical-align: middle;
        padding: 0;
      }
      .remove-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 22px; height: 22px;
        border-radius: 50%;
        border: none;
        background: var(--error-color, #f44336);
        color: #fff;
        font-size: 14px;
        cursor: pointer;
        flex-shrink: 0;
        padding: 0;
      }

      /* ── Sections ─────────────────────────────────────────────────────── */
      .detail-body { padding: 16px 24px; display: flex; flex-direction: column; gap: 0; }

      .section {
        background: var(--card-background-color, #fff);
        border-radius: 8px;
        padding: 14px 16px;
        margin-bottom: 12px;
        box-shadow: 0 1px 3px rgba(0,0,0,.08);
      }

      .section-title {
        margin: 0 0 12px;
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: .05em;
        color: var(--secondary-text-color, #757575);
        display: flex;
        align-items: center;
      }

      /* ── Form fields ──────────────────────────────────────────────────── */
      .field-row {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-bottom: 4px;
      }

      .field-group {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 140px;
      }
      .field-group.full { flex-basis: 100%; min-width: 100%; }

      .field-label {
        font-size: 11px;
        color: var(--secondary-text-color, #9e9e9e);
        margin-bottom: 3px;
        font-weight: 500;
      }

      .field-input, .field-select {
        padding: 7px 10px;
        border: 1px solid var(--divider-color, #e0e0e0);
        border-radius: 4px;
        background: var(--primary-background-color, #fafafa);
        color: var(--primary-text-color, #212121);
        font-size: 13px;
        width: 100%;
        outline: none;
        transition: border-color .15s;
      }
      .field-input:focus, .field-select:focus { border-color: var(--primary-color, #03a9f4); }
      .field-input:read-only { background: transparent; border-color: transparent; padding-left: 0; }
      .field-input:read-only:focus { border-color: transparent; }

      .field-value {
        padding: 6px 0;
        font-size: 13px;
        min-height: 20px;
        word-break: break-word;
      }

      textarea.field-input {
        resize: vertical;
        min-height: 80px;
      }
      .full-width { width: 100%; }

      /* ── Multi-value rows ─────────────────────────────────────────────── */
      .multi-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }
      .multi-row .field-select { width: 110px; flex-shrink: 0; }
      .multi-row .field-input  { flex: 1; }
      .multi-value-display     { padding: 4px 0; font-size: 13px; display: flex; align-items: center; }
      .multi-value-type        { font-size: 11px; color: var(--secondary-text-color, #9e9e9e); text-transform: capitalize; margin-right: 6px; }

      /* ── Address block ────────────────────────────────────────────────── */
      .address-block { border: 1px solid var(--divider-color, #e0e0e0); border-radius: 6px; padding: 10px; margin-bottom: 10px; }
      .address-block-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .address-display { font-size: 13px; line-height: 1.6; }

      /* ── Note ─────────────────────────────────────────────────────────── */
      .note-display { font-size: 13px; line-height: 1.6; white-space: pre-wrap; min-height: 20px; }

      /* ── Toast notification ───────────────────────────────────────────── */
      .toast {
        position: fixed;
        bottom: 20px; left: 50%;
        transform: translateX(-50%) translateY(80px);
        background: #323232;
        color: #fff;
        padding: 10px 20px;
        border-radius: 4px;
        font-size: 13px;
        opacity: 0;
        transition: transform .3s, opacity .3s;
        z-index: 9999;
        white-space: nowrap;
        pointer-events: none;
      }
      .toast.show      { transform: translateX(-50%) translateY(0); opacity: 1; }
      .toast-success   { background: #388e3c; }
      .toast-error     { background: #d32f2f; }
      .toast-info      { background: #1976d2; }

      /* ── Crop dialog ──────────────────────────────────────────────────── */
      .crop-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.65);
        z-index: 10000;
        align-items: center;
        justify-content: center;
      }
      .crop-overlay.visible { display: flex; }

      .confirm-overlay {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.5);
        z-index: 10001;
        align-items: center;
        justify-content: center;
      }
      .confirm-overlay.visible { display: flex; }
      .confirm-dialog {
        background: var(--card-background-color, #fff);
        border-radius: 10px;
        padding: 24px 28px;
        max-width: 380px;
        width: 90%;
        box-shadow: 0 6px 28px rgba(0,0,0,0.35);
      }
      .confirm-message {
        font-size: 15px;
        line-height: 1.5;
        margin-bottom: 20px;
      }
      .confirm-actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      .crop-dialog {
        background: var(--card-background-color, #fff);
        border-radius: 12px;
        padding: 20px;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        max-width: calc(100vw - 40px);
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      }

      .crop-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--primary-text-color, #212121);
      }

      .crop-hint {
        font-size: 12px;
        color: var(--secondary-text-color, #757575);
      }

      #crop-canvas {
        border-radius: 6px;
        cursor: grab;
        max-width: 100%;
        display: block;
        touch-action: none;
      }
      #crop-canvas:active { cursor: grabbing; }

      .crop-size-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .crop-size-label {
        font-size: 12px;
        color: var(--secondary-text-color, #757575);
      }

      .crop-actions {
        display: flex;
        gap: 10px;
      }

      /* ── Responsive ───────────────────────────────────────────────────── */
      #btn-header-back { display: none; }

      @media (max-width: 640px) {
        .body-layout { position: relative; overflow: hidden; }

        .sidebar {
          width: 100%;
          min-width: 0;
          border-right: none;
          position: absolute;
          inset: 0;
          transform: translateX(0);
          transition: transform 0.3s cubic-bezier(.4,0,.2,1);
          will-change: transform;
          z-index: 2;
        }

        .detail {
          width: 100%;
          position: absolute;
          inset: 0;
          transform: translateX(100%);
          transition: transform 0.3s cubic-bezier(.4,0,.2,1);
          will-change: transform;
          background: var(--primary-background-color, #f5f5f5);
          z-index: 3;
          overflow-y: auto;
          height: 100%;
        }

        .shell.detail-open .sidebar { transform: translateX(-100%); }
        .shell.detail-open .detail  { transform: translateX(0); }

        /* Header: Back-Button nur wenn Detail geöffnet */
        .shell.detail-open #btn-header-back { display: inline-flex; }
        .shell.detail-open .topbar-title         { display: none; }
        .shell.detail-open .header > .header-actions { display: none; }
      }
    `;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Template helpers (module-level pure functions)
// ────────────────────────────────────────────────────────────────────────────

function _esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function _field(label, fieldPath, value, readOnly, type = "text", fullWidth = false) {
  const cls = `field-group${fullWidth ? " full" : ""}`;
  if (readOnly) {
    // Format YYYY-MM-DD dates to German DD.MM.YYYY for display
    let display = value;
    if (type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [y, m, d] = value.split("-");
      display = `${d}.${m}.${y}`;
    }
    return `
      <div class="${cls}">
        <div class="field-label">${_esc(label)}</div>
        ${value
          ? `<div class="copy-wrap"><div class="field-value">${_esc(display)}</div><button class="btn-copy-inline" data-copy="${_esc(display)}" title="Kopieren">${COPY_ICON}</button></div>`
          : `<div class="field-value">&nbsp;</div>`}
      </div>`;
  }
  return `
    <div class="${cls}">
      <label class="field-label">${_esc(label)}</label>
      <input class="field-input" type="${type}" data-field="${fieldPath}" value="${_esc(value)}">
    </div>`;
}

function _multiField(kind, index, item, readOnly, types) {
  if (readOnly) {
    const displayLabel = item.label != null ? item.label : (item.type || "");
    return `
      <div class="multi-value-display copy-wrap">
        <span class="multi-value-type">${_esc(displayLabel)}</span><span>${_esc(item.value || "")}</span>
        ${item.value ? `<button class="btn-copy-inline" data-copy="${_esc(item.value)}" title="Kopieren">${COPY_ICON}</button>` : ""}
      </div>`;
  }
  const labelVal = item.label != null ? item.label : (item.type || "");
  return `
    <div class="multi-row">
      <input class="field-input" type="text" style="width:110px"
             data-index="${index}" data-subfield="label"
             value="${_esc(labelVal)}" placeholder="Label">
      <input class="field-input" type="${kind === "email" ? "email" : "tel"}"
             data-index="${index}" data-subfield="value" value="${_esc(item.value || "")}">
      <button class="remove-btn" data-index="${index}" title="Entfernen">&#8722;</button>
    </div>`;
}

function _addressBlock(index, addr, readOnly) {
  if (readOnly) {
    const zipCity = [addr.zip, addr.city].filter(Boolean).join(" ");
    const parts = [addr.street, zipCity, addr.region, addr.country].filter(Boolean);
    const addrText = parts.join(", ");
    return `
      <div class="address-block">
        <div class="multi-value-type">${_esc(addr.label || addr.type || "home")}</div>
        <div class="copy-wrap"><div class="address-display">${parts.map(_esc).join(", ")}</div>${parts.length ? `<button class="btn-copy-inline" data-copy="${_esc(addrText)}" title="Kopieren">${COPY_ICON}</button>` : ""}</div>
      </div>`;
  }
  const typeOpts = ADDRESS_TYPES.map((t) =>
    `<option value="${t}"${addr.type === t ? " selected" : ""}>${t}</option>`
  ).join("");
  return `
    <div class="address-block">
      <div class="address-block-header">
        <select class="field-select" data-index="${index}" data-subfield="type" style="width:100px">${typeOpts}</select>
        <button class="remove-btn" data-index="${index}" title="Entfernen">&#8722;</button>
      </div>
      <div class="field-row">
        ${_adrInput(index, "street",   "Straße",  addr.street,   true)}
        ${_adrInput(index, "city",     "Stadt",   addr.city)}
        ${_adrInput(index, "region",   "Region",  addr.region)}
        ${_adrInput(index, "zip",      "PLZ",     addr.zip)}
        ${_adrInput(index, "country",  "Land",    addr.country)}
        ${_adrInput(index, "extended", "Adresszusatz", addr.extended)}
      </div>
    </div>`;
}

function _adrInput(index, subfield, label, value, fullWidth = false) {
  const cls = `field-group${fullWidth ? " full" : ""}`;
  return `
    <div class="${cls}">
      <label class="field-label">${_esc(label)}</label>
      <input class="field-input" type="text"
             data-index="${index}" data-subfield="${subfield}"
             value="${_esc(value || "")}">
    </div>`;
}

function _formatContactText(c) {
  const lines = [];
  if (c.fn) lines.push(c.fn);
  const orgLine = [c.org, c.title].filter(Boolean).join(" \u00b7 ");
  if (orgLine) lines.push(orgLine);
  if (lines.length) lines.push("");
  for (const p of (c.phones || [])) {
    if (!p.value) continue;
    const lbl = (p.label || p.type || "").trim();
    lines.push(lbl ? `Tel (${lbl}): ${p.value}` : `Tel: ${p.value}`);
  }
  for (const e of (c.emails || [])) {
    if (!e.value) continue;
    const lbl = (e.label || e.type || "").trim();
    lines.push(lbl ? `E-Mail (${lbl}): ${e.value}` : `E-Mail: ${e.value}`);
  }
  for (const a of (c.addresses || [])) {
    const zipCity = [a.zip, a.city].filter(Boolean).join(" ");
    const parts = [a.street, zipCity, a.region, a.country].filter(Boolean);
    if (!parts.length) continue;
    const lbl = (a.label || a.type || "").trim();
    lines.push(lbl ? `Adresse (${lbl}): ${parts.join(", ")}` : `Adresse: ${parts.join(", ")}`);
  }
  if (c.bday) {
    const bp = c.bday.split("-");
    lines.push(`Geb.: ${bp.length === 3 ? `${bp[2]}.${bp[1]}.${bp[0]}` : c.bday}`);
  }
  if (c.url)  lines.push(`Web: ${c.url}`);
  if (c.note) lines.push(`Notiz: ${c.note}`);
  if (c.categories?.length) lines.push(`Kategorien: ${c.categories.join(", ")}`);
  return lines.join("\n");
}

function _clipboardWrite(text, onSuccess, onError) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess).catch(onError);
  } else {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      Object.assign(ta.style, { position: "fixed", top: "0", left: "0", opacity: "0" });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      onSuccess();
    } catch (e) { onError(e); }
  }
}

function _setPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// ── Register custom element ──────────────────────────────────────────────────
customElements.define("cardbook-panel", CardBookPanel);
