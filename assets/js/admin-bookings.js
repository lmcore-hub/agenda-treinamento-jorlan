(function () {
  "use strict";

  const cfg = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const tokenKeys = ["jorlan_admin_session_token", "jorlanTrainingAdminToken"];
  const supabaseLib = window.supabase;
  let sb = null;
  let state = { slots: [] };
  let enhancementTimer = null;
  let delegatesInstalled = false;

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
  function managerName(b) { return b.managerName || b.manager_name || ""; }
  function managerPhone(b) { return b.managerPhone || b.manager_phone || ""; }
  function managerPhoneDigits(b) { return b.managerPhoneDigits || b.manager_phone_digits || digitsOnly(managerPhone(b)); }
  function managerEmail(b) { return b.managerEmail || b.manager_email || ""; }
  function attendanceToken(b) { return b.attendanceToken || b.attendance_token || ""; }
  function attendanceStatus(b) { return b.attendanceStatus || b.attendance_status || "pending"; }

  function digitsOnly(value) { return String(value || "").replace(/\D/g, ""); }
  function brazilPhoneDigits(value) {
    let digits = digitsOnly(value);
    if (!digits) return "";
    if (digits.startsWith("55") && digits.length >= 12) return digits;
    if (digits.length >= 10 && digits.length <= 11) return "55" + digits;
    return digits;
  }

  function statusLabel(status) {
    return ({ pending: "Pendente", confirmed: "Confirmou", present: "Presente", absent: "Faltou" })[String(status || "pending")] || status;
  }

  function statusClass(status) {
    status = String(status || "pending");
    if (status === "present" || status === "confirmed") return "success";
    if (status === "absent") return "danger";
    return "pending";
  }

  function presenceUrl(booking) {
    const token = attendanceToken(booking);
    if (!token) return "";
    return `${location.origin}${location.pathname.replace(/painel-administrador\.html$/, "presenca.html")}?token=${encodeURIComponent(token)}`;
  }

  function whatsappPresenceText(booking, slot) {
    const url = presenceUrl(booking);
    return `Olá, ${bookingName(booking)}. Tudo bem?\n\nLembrete do treinamento de Seminovos:\nData: ${fmtDateBR(slot.date)}\nHorário: ${slot.time}\nLoja: ${bookingStore(booking)}\n\nConfirme sua presença neste link:\n${url}\n\nObrigado.`;
  }

  function normalizeSlot(s) {
    const bookings = s.bookings || s.participants || s.inscritos || s.registrations || [];
    const capacity = Number(s.capacity ?? s.max_capacity ?? s.vagas ?? s.total_vagas ?? 8);
    const occupied = Number(s.occupied ?? s.booked ?? s.booked_count ?? bookings.length ?? 0);
    const remaining = Number(s.remaining ?? s.available ?? s.available_count ?? Math.max(0, capacity - occupied));
    return {
      id: s.id || s.slot_id,
      date: normDate(s.date || s.slot_date || s.slotDate),
      time: normTime(s.time || s.slot_time || s.slotTime),
      blocked: Boolean(s.blocked ?? s.is_blocked ?? s.locked ?? false),
      capacity, occupied, remaining, bookings
    };
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
      .participant.booking-managed { grid-template-columns:minmax(0,1fr); align-items:start; gap:10px; }
      .booking-admin-box { margin-top:8px; display:flex; flex-direction:column; gap:8px; }
      .manager-contact { display:flex; gap:8px; flex-wrap:wrap; align-items:center; background:var(--soft,#f6f3ef); border:1px solid #eee8df; border-radius:14px; padding:9px 10px; font-size:13px; color:#565960; font-weight:750; }
      .manager-contact strong { color:var(--ink,#121314); }
      .manager-contact a { color:inherit; text-decoration:none; }
      .attendance-chip { display:inline-flex; align-items:center; border-radius:999px; padding:5px 9px; font-size:12px; font-weight:900; }
      .attendance-chip.success { background:#e7f5ee; color:#256947; }
      .attendance-chip.danger { background:#f8e8e6; color:#b33a2d; }
      .attendance-chip.pending { background:#fff8dd; color:#7c5c14; }
      .booking-admin-actions { display:flex; gap:7px; flex-wrap:wrap; justify-content:flex-start; }
      .booking-admin-actions .btn { white-space:nowrap; }
      .admin-booking-modal { position:fixed; inset:0; background:rgba(0,0,0,.38); display:none; align-items:center; justify-content:center; padding:20px; z-index:999; }
      .admin-booking-modal.show { display:flex; }
      .admin-booking-card { width:min(100%,620px); max-height:92vh; overflow:auto; background:#fff; border-radius:24px; box-shadow:0 18px 50px rgba(0,0,0,.18); padding:22px; }
      .admin-booking-card h3 { margin:0; font-size:28px; line-height:1; font-weight:950; letter-spacing:-.04em; }
      .admin-booking-head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:16px; }
      .admin-booking-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
      .admin-booking-field { display:flex; flex-direction:column; gap:7px; margin-bottom:12px; }
      .admin-booking-field label { font-size:13px; font-weight:850; }
      .admin-booking-field input, .admin-booking-field select { border:1px solid var(--line,#d9d4cc); border-radius:14px; padding:11px 13px; background:#fff; min-height:44px; }
      .admin-booking-feedback { display:none; margin:12px 0; padding:12px 14px; border-radius:14px; font-size:14px; font-weight:800; }
      .admin-booking-feedback.show { display:block; }
      .admin-booking-feedback.success { background:#e7f5ee; color:#256947; }
      .admin-booking-feedback.error { background:#f8e8e6; color:#b33a2d; }
      @media(max-width:680px){ .admin-booking-grid{grid-template-columns:1fr;} .booking-admin-actions{justify-content:flex-start;} }
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

  function showModalFeedback(type, message) {
    const box = document.getElementById("adminBookingFeedback");
    if (box) { box.className = `admin-booking-feedback show ${type}`; box.textContent = message; }
  }
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
      showModalFeedback("success", "Ao salvar, o gerente será recalculado pela loja do inscrito.");
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
      const result = await rpc("training_admin_update_booking", {
        p_session_token: getToken(),
        p_booking_id: form.elements.bookingId.value,
        p_name: form.elements.name.value.trim(),
        p_email: form.elements.email.value.trim(),
        p_phone: form.elements.phone.value.trim(),
        p_role: form.elements.role.value.trim(),
        p_store: form.elements.store.value.trim(),
        p_city: form.elements.city.value.trim(),
        p_slot_date: slotDate,
        p_slot_time: slotTime
      });
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

  async function syncManagers() {
    try {
      const result = await rpc("training_admin_sync_booking_managers", { p_session_token: getToken() });
      const payload = Array.isArray(result) ? result[0] : result;
      showAgendaFeedback("success", `Gerentes atualizados. ${payload?.updated ?? 0} inscrição(ões) revisada(s).`);
      setTimeout(() => location.reload(), 700);
    } catch (error) {
      showAgendaFeedback("error", error.message || "Não foi possível atualizar gerentes.");
    }
  }

  async function markAttendance(bookingId, status) {
    try {
      await rpc("training_admin_mark_attendance", { p_session_token: getToken(), p_booking_id: bookingId, p_attendance_status: status });
      showAgendaFeedback("success", status === "present" ? "Presença marcada." : status === "absent" ? "Falta marcada." : "Presença atualizada.");
      setTimeout(enhancePanel, 300);
      setTimeout(() => location.reload(), 650);
    } catch (error) {
      showAgendaFeedback("error", error.message || "Não foi possível atualizar presença.");
    }
  }

  function openWhatsAppPresence(bookingId) {
    const found = findBooking(bookingId);
    if (!found) return showAgendaFeedback("error", "Inscrição não encontrada para gerar WhatsApp.");
    const { booking, slot } = found;
    const phone = brazilPhoneDigits(bookingPhone(booking));
    if (!phone) return showAgendaFeedback("error", "Telefone do candidato inválido ou ausente.");
    const msg = whatsappPresenceText(booking, slot);
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
  }

  function showAgendaFeedback(type, message) {
    const box = document.getElementById("agenda-feedback");
    if (!box) { alert(message); return; }
    box.className = `feedback show ${type}`;
    box.textContent = message;
    box.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function managerHtml(booking) {
    const name = managerName(booking);
    if (!name) return `<div class="manager-contact"><strong>Gerente:</strong> não localizado pela loja informada</div>`;
    const displayPhone = managerPhone(booking);
    const digits = brazilPhoneDigits(managerPhoneDigits(booking));
    const tel = digits ? `<a class="btn small" href="tel:+${digits}">Ligar gerente</a>` : "";
    const wa = digits ? `<a class="btn small" href="https://wa.me/${digits}" target="_blank" rel="noopener">WhatsApp gerente</a>` : "";
    const email = managerEmail(booking) ? ` • ${escapeHtml(managerEmail(booking))}` : "";
    return `<div class="manager-contact"><span><strong>Gerente:</strong> ${escapeHtml(name)}${displayPhone ? " • " + escapeHtml(displayPhone) : ""}${email}</span>${tel}${wa}</div>`;
  }

  function attendanceHtml(booking) {
    const status = attendanceStatus(booking);
    return `<span class="attendance-chip ${statusClass(status)}">Presença: ${escapeHtml(statusLabel(status))}</span>`;
  }

  function addRefreshManagersButton() {
    if (document.getElementById("sync-managers")) return;
    const toolbar = document.querySelector("#panel-agenda .toolbar-left") || document.querySelector("#panel-agenda .toolbar");
    if (!toolbar) return;
    const btn = document.createElement("button");
    btn.id = "sync-managers";
    btn.className = "btn";
    btn.type = "button";
    btn.textContent = "Atualizar gerentes";
    btn.addEventListener("click", syncManagers);
    toolbar.appendChild(btn);
  }

  async function enhancePanel() {
    const grid = document.getElementById("agenda-grid");
    if (!grid || !getToken() || !getClient()) return;
    addRefreshManagersButton();
    try { await loadAdminState(); } catch (error) { console.warn("Não foi possível carregar estado administrativo para edição de agendamentos:", error); return; }

    document.querySelectorAll(".slot-card").forEach((card) => {
      const slot = findSlotByCard(card);
      if (!slot) return;
      const participants = Array.from(card.querySelectorAll(".participant"));
      participants.forEach((node, index) => {
        const booking = slot.bookings[index];
        if (!booking || !booking.id) return;

        node.dataset.bookingId = booking.id;
        node.classList.add("booking-managed");

        let box = node.querySelector(".booking-admin-box");
        if (!box) {
          box = document.createElement("div");
          box.className = "booking-admin-box";
          node.appendChild(box);
        }

        box.innerHTML = `
          ${managerHtml(booking)}
          <div class="booking-admin-actions">
            ${attendanceHtml(booking)}
            <button class="btn small" type="button" data-admin-wa-presence="${escapeHtml(booking.id)}">WhatsApp presença</button>
            <button class="btn small success" type="button" data-admin-attendance="${escapeHtml(booking.id)}" data-status="present">Presente</button>
            <button class="btn small danger" type="button" data-admin-attendance="${escapeHtml(booking.id)}" data-status="absent">Faltou</button>
            <button class="btn small" type="button" data-admin-edit-booking="${escapeHtml(booking.id)}">Editar</button>
            <button class="btn small danger" type="button" data-admin-cancel-booking="${escapeHtml(booking.id)}">Cancelar</button>
          </div>`;
      });
    });
  }

  function installDelegates() {
    if (delegatesInstalled) return;
    delegatesInstalled = true;
    document.addEventListener("click", (event) => {
      const edit = event.target.closest("[data-admin-edit-booking]");
      if (edit) { event.preventDefault(); openEditBooking(edit.dataset.adminEditBooking); return; }
      const cancel = event.target.closest("[data-admin-cancel-booking]");
      if (cancel) { event.preventDefault(); cancelBooking(cancel.dataset.adminCancelBooking); return; }
      const attendance = event.target.closest("[data-admin-attendance]");
      if (attendance) { event.preventDefault(); markAttendance(attendance.dataset.adminAttendance, attendance.dataset.status); return; }
      const wa = event.target.closest("[data-admin-wa-presence]");
      if (wa) { event.preventDefault(); openWhatsAppPresence(wa.dataset.adminWaPresence); }
    });
  }

  function observeAgenda() {
    const grid = document.getElementById("agenda-grid");
    if (!grid || grid.dataset.adminBookingsObserved === "true") return;
    grid.dataset.adminBookingsObserved = "true";
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
    setTimeout(enhancePanel, 3000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();