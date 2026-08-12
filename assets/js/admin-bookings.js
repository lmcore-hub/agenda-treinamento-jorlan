(function () {
  "use strict";

  const cfg = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const tokenKeys = ["jorlan_admin_session_token", "jorlanTrainingAdminToken"];
  const supabaseLib = window.supabase;
  let sb = null;
  let state = { slots: [] };
  let enhancementTimer = null;

  function getToken() {
    for (const key of tokenKeys) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return "";
  }

  function getClient() {
    if (!supabaseLib || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
    if (!sb) sb = supabaseLib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return sb;
  }

  async function rpc(name, payload) {
    const client = getClient();
    if (!client) throw new Error("Supabase não configurado.");
    const { data, error } = await client.rpc(name, payload || {});
    if (error) throw new Error(error.message || "Erro na comunicação com o banco.");
    return data;
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function onlyText(el) { return (el && el.textContent ? el.textContent : "").trim(); }
  function normDate(d) { return d ? String(d).slice(0, 10) : ""; }
  function normTime(t) { return t ? String(t).slice(0, 5) : ""; }
  function fmtDateBR(date) { const [y, m, d] = normDate(date).split("-"); return d && m && y ? `${d}/${m}/${y}` : String(date || ""); }
  function brToIso(dateBR) { const m = String(dateBR || "").match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; }
  function parseSlotTitle(text) { const parts = String(text || "").split("•").map((p) => p.trim()); return { date: brToIso(parts[0] || ""), time: normTime(parts[1] || "") }; }

  function bookingName(b) { return b.name || b.participant_name || b.nome || b.full_name || b.nome_completo || ""; }
  function bookingRole(b) { return b.role || b.participant_role || b.cargo || ""; }
  function bookingStore(b) { return b.store || b.loja || b.participant_store || ""; }
  function bookingCity(b) { return b.city || b.praca || b.cidade || ""; }
  function bookingEmail(b) { return b.email || b.participant_email || ""; }
  function bookingPhone(b) { return b.phone || b.telefone || b.cellphone || b.participant_phone || ""; }

  function normalizeSlot(s) {
    const bookings = s.bookings || s.participants || s.inscritos || s.registrations || [];
    const capacity = Number(s.capacity ?? s.max_capacity ?? s.vagas ?? s.total_vagas ?? 8);
    const occupied = Number(s.occupied ?? s.booked ?? s.booked_count ?? bookings.length ?? 0);
    const remaining = Number(s.remaining ?? s.available ?? s.available_count ?? Math.max(0, capacity - occupied));
    return { id: s.id || s.slot_id, date: normDate(s.date || s.slot_date || s.slotDate), time: normTime(s.time || s.slot_time || s.slotTime), blocked: Boolean(s.blocked ?? s.is_blocked ?? s.locked ?? false), capacity, occupied, remaining, bookings };
  }

  async function loadAdminState() {
    const token = getToken();
    if (!token) return null;
    const data = await rpc("training_admin_get_state", { p_session_token: token });
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    state.slots = (parsed.slots || parsed.agenda || parsed.turmas || []).map(normalizeSlot).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return state;
  }

  function findSlotByCard(card) {
    const title = onlyText(card.querySelector(".slot-title"));
    const parsed = parseSlotTitle(title);
    if (!parsed.date || !parsed.time) return null;
    return state.slots.find((s) => s.date === parsed.date && s.time === parsed.time) || null;
  }

  function injectStyles() {
    if (document.getElementById("admin-booking-manager-style")) return;
    const style = document.createElement("style");
    style.id = "admin-booking-manager-style";
    style.textContent = `
      .participant.booking-managed { grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; }
      .booking-admin-actions { display: flex; gap: 7px; flex-wrap: wrap; justify-content: flex-end; }
      .booking-admin-actions .btn { white-space: nowrap; }
      .admin-booking-modal { position: fixed; inset: 0; background: rgba(0,0,0,.38); display: none; align-items: center; justify-content: center; padding: 20px; z-index: 999; }
      .admin-booking-modal.show { display: flex; }
      .admin-booking-card { width: min(100%, 620px); max-height: 92vh; overflow: auto; background: #fff; border-radius: 24px; box-shadow: 0 18px 50px rgba(0,0,0,.18); padding: 22px; }
      .admin-booking-card h3 { margin: 0; font-size: 28px; line-height: 1; font-weight: 950; letter-spacing: -.04em; }
      .admin-booking-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
      .admin-booking-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .admin-booking-field { display: flex; flex-direction: column; gap: 7px; margin-bottom: 12px; }
      .admin-booking-field label { font-size: 13px; font-weight: 850; }
      .admin-booking-field input, .admin-booking-field select { border: 1px solid var(--line, #d9d4cc); border-radius: 14px; padding: 11px 13px; background: #fff; min-height: 44px; }
      .admin-booking-feedback { display: none; margin: 12px 0; padding: 12px 14px; border-radius: 14px; font-size: 14px; font-weight: 800; }
      .admin-booking-feedback.show { display: block; }
      .admin-booking-feedback.success { background: #e7f5ee; color: #256947; }
      .admin-booking-feedback.error { background: #f8e8e6; color: #b33a2d; }
      @media(max-width: 680px) { .participant.booking-managed { grid-template-columns: 1fr; } .booking-admin-actions { justify-content: flex-start; } .admin-booking-grid { grid-template-columns: 1fr; } }
    `;
    document.head.appendChild(style);
  }

  function ensureModal() {
    let modal = document.getElementById("adminBookingModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "adminBookingModal";
    modal.className = "admin-booking-modal";
    modal.innerHTML = `
      <div class="admin-booking-card">
        <div class="admin-booking-head"><h3>Editar agendamento</h3><button class="btn small" type="button" data-admin-booking-close>Fechar</button></div>
        <div id="adminBookingFeedback" class="admin-booking-feedback"></div>
        <form id="adminBookingForm">
          <input type="hidden" name="bookingId" />
          <div class="admin-booking-grid"><div class="admin-booking-field"><label>Nome completo</label><input name="name" required minlength="2" /></div><div class="admin-booking-field"><label>E-mail</label><input name="email" type="email" required /></div></div>
          <div class="admin-booking-grid"><div class="admin-booking-field"><label>Telefone</label><input name="phone" /></div><div class="admin-booking-field"><label>Cargo</label><input name="role" /></div></div>
          <div class="admin-booking-grid"><div class="admin-booking-field"><label>Loja</label><input name="store" /></div><div class="admin-booking-field"><label>Cidade / praça</label><input name="city" /></div></div>
          <div class="admin-booking-field"><label>Turma</label><select name="slot" required></select></div>
          <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px"><button class="btn" type="button" data-admin-booking-close>Cancelar edição</button><button class="btn dark" type="submit">Salvar alterações</button></div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => { if (event.target === modal || event.target.closest("[data-admin-booking-close]")) closeModal(); });
    modal.querySelector("#adminBookingForm").addEventListener("submit", saveBookingEdit);
    return modal;
  }

  function showModalFeedback(type, message) { const box = document.getElementById("adminBookingFeedback"); if (box) { box.className = `admin-booking-feedback show ${type}`; box.textContent = message; } }
  function closeModal() { const modal = document.getElementById("adminBookingModal"); if (modal) modal.classList.remove("show"); }

  function slotOptions(currentSlot) {
    const options = [], seen = new Set();
    state.slots.forEach((slot) => {
      const key = `${slot.date}|${slot.time}`;
      const isCurrent = currentSlot && slot.date === currentSlot.date && slot.time === currentSlot.time;
      const hasVacancy = Number(slot.remaining) > 0;
      if (!isCurrent && (slot.blocked || !hasVacancy)) return;
      if (seen.has(key)) return;
      seen.add(key);
      options.push({ value: key, label: `${fmtDateBR(slot.date)} • ${slot.time}${isCurrent ? " — turma atual" : ""}` });
    });
    return options;
  }

  function findBooking(bookingId) {
    for (const slot of state.slots) {
      const booking = (slot.bookings || []).find((b) => String(b.id) === String(bookingId));
      if (booking) return { booking, slot };
    }
    return null;
  }

  async function openEditBooking(bookingId) {
    try {
      await loadAdminState();
      const found = findBooking(bookingId);
      if (!found) throw new Error("Agendamento não encontrado no painel.");
      const { booking, slot } = found;
      const modal = ensureModal();
      const form = modal.querySelector("#adminBookingForm");
      const select = form.elements.slot;
      form.elements.bookingId.value = booking.id;
      form.elements.name.value = bookingName(booking);
      form.elements.email.value = bookingEmail(booking);
      form.elements.phone.value = bookingPhone(booking);
      form.elements.role.value = bookingRole(booking);
      form.elements.store.value = bookingStore(booking);
      form.elements.city.value = bookingCity(booking);
      select.innerHTML = slotOptions(slot).map((opt) => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.label)}</option>`).join("");
      select.value = `${slot.date}|${slot.time}`;
      showModalFeedback("success", "Altere os dados necessários e clique em salvar.");
      modal.classList.add("show");
    } catch (error) { showAgendaFeedback("error", error.message || "Não foi possível abrir a edição."); }
  }

  async function saveBookingEdit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    const [slotDate, slotTime] = String(form.elements.slot.value || "").split("|");
    submit.disabled = true;
    submit.textContent = "Salvando...";
    try {
      const result = await rpc("training_admin_update_booking", { p_session_token: getToken(), p_booking_id: form.elements.bookingId.value, p_name: form.elements.name.value.trim(), p_email: form.elements.email.value.trim(), p_phone: form.elements.phone.value.trim(), p_role: form.elements.role.value.trim(), p_store: form.elements.store.value.trim(), p_city: form.elements.city.value.trim(), p_slot_date: slotDate, p_slot_time: slotTime });
      const payload = Array.isArray(result) ? result[0] : result;
      if (payload && payload.success === false) throw new Error(payload.message || "Não foi possível editar.");
      showModalFeedback("success", "Agendamento atualizado.");
      setTimeout(() => location.reload(), 700);
    } catch (error) { showModalFeedback("error", error.message || "Erro ao salvar o agendamento."); }
    finally { submit.disabled = false; submit.textContent = "Salvar alterações"; }
  }

  async function cancelBooking(bookingId) {
    const found = findBooking(bookingId);
    const label = found ? bookingName(found.booking) : "este participante";
    if (!window.confirm(`Cancelar o agendamento de ${label}? O registro será preservado no histórico.`)) return;
    try {
      const result = await rpc("training_admin_cancel_booking", { p_session_token: getToken(), p_booking_id: bookingId });
      const payload = Array.isArray(result) ? result[0] : result;
      if (payload && payload.success === false) throw new Error(payload.message || "Não foi possível cancelar.");
      showAgendaFeedback("success", "Agendamento cancelado pelo administrador.");
      setTimeout(() => location.reload(), 700);
    } catch (error) { showAgendaFeedback("error", error.message || "Erro ao cancelar agendamento."); }
  }

  function showAgendaFeedback(type, message) {
    const box = document.getElementById("agenda-feedback");
    if (!box) { alert(message); return; }
    box.className = `feedback show ${type}`;
    box.textContent = message;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function enhancePanel() {
    const grid = document.getElementById("agenda-grid");
    if (!grid || !getToken() || !getClient()) return;
    try { await loadAdminState(); } catch (error) { console.warn("Não foi possível carregar estado administrativo para edição de agendamentos:", error); return; }
    document.querySelectorAll(".slot-card").forEach((card) => {
      const slot = findSlotByCard(card);
      if (!slot) return;
      const participants = Array.from(card.querySelectorAll(".participant"));
      participants.forEach((node, index) => {
        const booking = slot.bookings[index];
        if (!booking || !booking.id || node.dataset.bookingManaged === "true") return;
        node.dataset.bookingManaged = "true";
        node.dataset.bookingId = booking.id;
        node.classList.add("booking-managed");
        const actions = document.createElement("div");
        actions.className = "booking-admin-actions";
        actions.innerHTML = `<button class="btn small" type="button" data-admin-edit-booking="${escapeHtml(booking.id)}">Editar</button><button class="btn small danger" type="button" data-admin-cancel-booking="${escapeHtml(booking.id)}">Cancelar</button>`;
        node.appendChild(actions);
      });
    });
  }

  function installDelegates() {
    document.addEventListener("click", (event) => {
      const edit = event.target.closest("[data-admin-edit-booking]");
      if (edit) { event.preventDefault(); openEditBooking(edit.dataset.adminEditBooking); return; }
      const cancel = event.target.closest("[data-admin-cancel-booking]");
      if (cancel) { event.preventDefault(); cancelBooking(cancel.dataset.adminCancelBooking); }
    });
  }

  function observeAgenda() {
    const grid = document.getElementById("agenda-grid");
    if (!grid) return;
    const observer = new MutationObserver(() => { clearTimeout(enhancementTimer); enhancementTimer = setTimeout(enhancePanel, 200); });
    observer.observe(grid, { childList: true, subtree: true });
  }

  function init() {
    if (!document.getElementById("agenda-grid")) return;
    injectStyles();
    ensureModal();
    installDelegates();
    observeAgenda();
    setTimeout(enhancePanel, 500);
    setTimeout(enhancePanel, 1500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
