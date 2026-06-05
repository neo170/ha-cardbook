/**
 * CardBook Panel — CardDAV address book for Home Assistant
 * Custom panel element: <cardbook-panel>
 */

const EMAIL_TYPES  = ["internet", "home", "work", "other"];
const PHONE_TYPES  = ["cell", "home", "work", "voice", "fax", "pager", "other"];
const ADDRESS_TYPES = ["home", "work", "other"];

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
        <aside class="sidebar" id="sidebar">
          <div class="sidebar-toolbar">
            <div class="search-wrap">
              <span class="search-icon">&#128269;</span>
              <input id="search" type="search" placeholder="Suchen…" autocomplete="off">
            </div>
            <button class="icon-btn" id="btn-new"   title="Neuer Kontakt">&#43;</button>
            <button class="icon-btn" id="btn-refresh" title="Aktualisieren">&#8635;</button>
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
      <div class="toast" id="toast"></div>
    `;

    const root = this.shadowRoot;

    root.getElementById("search").addEventListener("input", (e) => {
      this._search = e.target.value;
      this._renderList();
    });

    root.getElementById("btn-new").addEventListener("click", () => this._newContact());
    root.getElementById("btn-refresh").addEventListener("click", () => this._fetchContacts(true));

    // Event delegation inside the contact list
    root.getElementById("contact-list").addEventListener("click", (e) => {
      const item = e.target.closest(".contact-item");
      if (item) this._selectContact(item.dataset.uid);
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
      this._edited.fn = [n.prefix, n.given, n.additional, n.family, n.suffix]
        .filter(Boolean).join(" ").trim();
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
    if (!confirm(`Kontakt "${this._selected.fn}" wirklich löschen?`)) return;
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
  }

  _newContact() {
    this._selected = null;
    this._isNew    = true;
    this._editMode = true;
    this._edited   = EMPTY_CONTACT();
    this._renderList();
    this._renderDetail();
  }

  _startEdit() {
    this._edited   = JSON.parse(JSON.stringify(this._selected));
    this._editMode = true;
    this._renderDetail();
  }

  _cancelEdit() {
    this._editMode = false;
    this._isNew    = false;
    this._edited   = null;
    if (!this._selected && !this._isNew) this._renderDetail();
    this._renderDetail();
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
            <button class="photo-btn" id="btn-photo-upload" title="Foto hochladen">&#128247;</button>
            ${c.photo ? `<button class="photo-btn photo-btn-del" id="btn-photo-remove" title="Foto entfernen">&#10005;</button>` : ""}
            <input type="file" id="photo-file" accept="image/*" style="display:none">
          ` : ""}
        </div>
        <div class="header-name">
          ${ro
            ? `<h2 class="fn-display">${_esc(c.fn || "(Kein Name)")}</h2>
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
        <!-- Name -->
        <section class="section">
          <h3 class="section-title">Name</h3>
          <div class="field-row">
            ${_field("Anrede",     "n.prefix",     c.n?.prefix     || "", ro, "text")}
            ${_field("Vorname",    "n.given",      c.n?.given      || "", ro, "text")}
            ${_field("Zweiter Vorname", "n.additional", c.n?.additional || "", ro, "text")}
            ${_field("Nachname",   "n.family",     c.n?.family     || "", ro, "text")}
            ${_field("Suffix",     "n.suffix",     c.n?.suffix     || "", ro, "text")}
          </div>
          <div class="field-row">
            ${_field("Anzeigename", "fn", c.fn || "", ro, "text", true)}
          </div>
        </section>

        <!-- Organisation -->
        <section class="section">
          <h3 class="section-title">Beruf</h3>
          <div class="field-row">
            ${_field("Organisation", "org",   c.org   || "", ro, "text", true)}
            ${_field("Titel",        "title", c.title || "", ro, "text")}
          </div>
        </section>

        <!-- Emails -->
        <section class="section" id="section-emails">
          <h3 class="section-title">
            E-Mail
            ${edit ? `<button class="add-btn" id="btn-add-email">&#43;</button>` : ""}
          </h3>
          <div id="email-list">
            ${(c.emails || []).map((e, i) => _multiField("email", i, e, ro, EMAIL_TYPES)).join("")}
          </div>
        </section>

        <!-- Phones -->
        <section class="section" id="section-phones">
          <h3 class="section-title">
            Telefon
            ${edit ? `<button class="add-btn" id="btn-add-phone">&#43;</button>` : ""}
          </h3>
          <div id="phone-list">
            ${(c.phones || []).map((p, i) => _multiField("phone", i, p, ro, PHONE_TYPES)).join("")}
          </div>
        </section>

        <!-- Addresses -->
        <section class="section" id="section-addresses">
          <h3 class="section-title">
            Adressen
            ${edit ? `<button class="add-btn" id="btn-add-address">&#43;</button>` : ""}
          </h3>
          <div id="address-list">
            ${(c.addresses || []).map((a, i) => _addressBlock(i, a, ro)).join("")}
          </div>
        </section>

        <!-- Birthday & URL -->
        <section class="section">
          <h3 class="section-title">Weiteres</h3>
          <div class="field-row">
            ${_field("Geburtstag", "bday", c.bday || "", ro, "date")}
            ${_field("Website",    "url",  c.url  || "", ro, "url",  true)}
          </div>
        </section>

        <!-- Note -->
        <section class="section">
          <h3 class="section-title">Notiz</h3>
          ${ro
            ? `<div class="note-display">${_esc(c.note || "").replace(/\n/g, "<br>")}</div>`
            : `<textarea class="field-input full-width" data-field="note" rows="4">${_esc(c.note || "")}</textarea>`
          }
        </section>

        <!-- Categories -->
        <section class="section">
          <h3 class="section-title">Kategorien</h3>
          ${_field("Kategorien (kommagetrennt)", "categories_str",
              (c.categories || []).join(", "), ro, "text", true)}
        </section>
      </div>
    `;
  }

  _attachDetailListeners(panelEl, contact) {
    const root = panelEl;

    // Read-only action buttons
    root.querySelector("#btn-edit")?.addEventListener("click", () => this._startEdit());
    root.querySelector("#btn-delete")?.addEventListener("click", () => this._deleteContact());

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
            const computed = [n.given, n.family].filter(Boolean).join(" ");
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
      if (el.dataset.subfield === "type")  ed.emails[i].type  = el.value;
    });
    root.querySelector("#email-list").addEventListener("change", (e) => {
      const el = e.target;
      const i  = parseInt(el.dataset.index, 10);
      if (el.dataset.subfield === "type")  ed.emails[i].type  = el.value;
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
      if (el.dataset.subfield === "type")  ed.phones[i].type  = el.value;
    });
    root.querySelector("#phone-list").addEventListener("change", (e) => {
      const el = e.target;
      const i  = parseInt(el.dataset.index, 10);
      if (el.dataset.subfield === "type")  ed.phones[i].type  = el.value;
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

    // Photo upload
    root.querySelector("#btn-photo-upload")?.addEventListener("click", () => {
      root.querySelector("#photo-file").click();
    });
    root.querySelector("#photo-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        ed.photo = ev.target.result;
        const preview = root.querySelector("#photo-preview");
        if (preview.tagName === "IMG") {
          preview.src = ed.photo;
        } else {
          const img = document.createElement("img");
          img.src   = ed.photo;
          img.className = "detail-photo";
          img.id    = "photo-preview";
          preview.replaceWith(img);
        }
      };
      reader.readAsDataURL(file);
    });
    root.querySelector("#btn-photo-remove")?.addEventListener("click", () => {
      ed.photo = "";
      this._renderDetail();
    });
  }

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
        height: 100%;
        overflow: hidden;
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
      .photo-btn-del {
        bottom: 28px;
        background: var(--error-color, #f44336);
      }

      .header-name { flex: 1; }
      .fn-display  { margin: 0 0 4px; font-size: 22px; font-weight: 500; }
      .header-org  { color: var(--secondary-text-color, #757575); margin-bottom: 10px; }
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
      .multi-value-display     { padding: 4px 0; font-size: 13px; }
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

      /* ── Responsive ───────────────────────────────────────────────────── */
      @media (max-width: 640px) {
        .sidebar { width: 100%; border-right: none; }
        .shell   { flex-direction: column; }
        .detail  { height: 60vh; }
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
    return `
      <div class="${cls}">
        <div class="field-label">${_esc(label)}</div>
        <div class="field-value">${_esc(value) || "&nbsp;"}</div>
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
    return `
      <div class="multi-value-display">
        <span class="multi-value-type">${_esc(item.type || "")}</span>${_esc(item.value || "")}
      </div>`;
  }
  const opts = types.map((t) =>
    `<option value="${t}"${item.type === t ? " selected" : ""}>${t}</option>`
  ).join("");
  return `
    <div class="multi-row">
      <select class="field-select" data-index="${index}" data-subfield="type">${opts}</select>
      <input class="field-input" type="${kind === "email" ? "email" : "tel"}"
             data-index="${index}" data-subfield="value" value="${_esc(item.value || "")}">
      <button class="remove-btn" data-index="${index}" title="Entfernen">&#8722;</button>
    </div>`;
}

function _addressBlock(index, addr, readOnly) {
  if (readOnly) {
    const parts = [addr.street, addr.city, addr.region, addr.zip, addr.country].filter(Boolean);
    return `
      <div class="address-block">
        <div class="multi-value-type">${_esc(addr.type || "home")}</div>
        <div class="address-display">${parts.map(_esc).join(", ")}</div>
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
