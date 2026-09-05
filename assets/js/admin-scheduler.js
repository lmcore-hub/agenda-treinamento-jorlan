(function () {
  'use strict';

  const CONFIG = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const TOKEN_KEYS = ['jorlan_admin_session_token', 'jorlanTrainingAdminToken'];
  let sb = null;
  let state = { view: 'future', slots: [], expanded: new Set(), loaded: false };

  function $(id) { return document.getElementById(id); }
  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function token() {
    for (const key of TOKEN_KEYS) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }

  function client() {
    if (!window.supabase || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return null;
    if (!sb) sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return sb;
  }

  async function rpc(name, params) {
    const c = client();
    if (!c) throw new Error('Supabase não configurado.');
    const { data, error } = await c.rpc(name, params || {});
    if (error) throw new Error(error.message || 'Erro na comunicação com o banco.');
    return typeof data === 'string' ? JSON.parse(data) : data;
  }

  function esc(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function fmtDateBR(date) {
    const [y, m, d] = String(date || '').slice(0, 10).split('-');
    return d && m && y ? `${d}/${m}/${y}` : String(date || '');
  }

  function normDate(date) { return String(date || '').slice(0, 10); }
  function normTime(time) { return String(time || '').slice(0, 5); }
  function digitsOnly(value) { return String(value || '').replace(/\D/g, ''); }
  function phoneBR(value) {
    let d = digitsOnly(value);
    if (!d) return '';
    if (d.startsWith('55') && d.length >= 12) return d;
    if (d.length >= 10 && d.length <= 11) return '55' + d;
    if (d.length === 8 || d.length === 9) return d;
    return d;
  }

  function bookingName(b) { return b.name || b.participant_name || b.nome || b.full_name || b.nome_completo || '-'; }
  function bookingRole(b) { return b.role || b.participant_role || b.cargo || '-'; }
  function bookingStore(b) { return b.store || b.loja || b.participant_store || '-'; }
  function bookingCity(b) { return b.city || b.praca || b.cidade || '-'; }
  function bookingEmail(b) { return b.email || b.participant_email || ''; }
  function bookingPhone(b) { return b.phone || b.participant_phone || b.telefone || b.cellphone || ''; }
  function managerName(b) { return b.managerName || b.manager_name || ''; }
  function managerPhone(b) { return b.managerPhone || b.manager_phone || ''; }
  function managerPhoneDigits(b) { return b.managerPhoneDigits || b.manager_phone_digits || digitsOnly(managerPhone(b)); }
  function attendanceToken(b) { return b.attendanceToken || b.attendance_token || ''; }
  function attendanceStatus(b) { return b.attendanceStatus || b.attendance_status || 'pending'; }

  function statusLabel(status) {
    return ({ pending: 'Pendente', confirmed: 'Confirmou', present: 'Presente', absent: 'Faltou' })[String(status || 'pending')] || status;
  }

  function statusClass(status) {
    status = String(status || 'pending');
    if (status === 'confirmed' || status === 'present') return 'ok';
    if (status === 'absent') return 'bad';
    return 'wait';
  }

  function presenceUrl(booking) {
    const t = attendanceToken(booking);
    if (!t) return '';
    return `${location.origin}${location.pathname.replace(/painel-administrador\.html$/, 'presenca.html')}?token=${encodeURIComponent(t)}`;
  }

  function presenceText(booking, slot) {
    const url = presenceUrl(booking);
    return `Olá, ${bookingName(booking)}! Tudo bem?\n\nSeu treinamento está agendado para ${fmtDateBR(slot.date)} às ${slot.time}.\n\nConfirme sua presença pelo link abaixo:\n${url}\n\nGrupo Jorlan`;
  }

  function normalizeSlot(raw) {
    const bookings = raw.bookings || raw.participants || raw.inscritos || raw.registrations || [];
    const capacity = Number(raw.capacity ?? raw.max_capacity ?? raw.vagas ?? raw.total_vagas ?? 8);
    const occupied = Number(raw.occupied ?? raw.booked ?? raw.booked_count ?? bookings.length ?? 0);
    const remaining = Number(raw.remaining ?? raw.available ?? raw.available_count ?? Math.max(0, capacity - occupied));
    return {
      id: raw.id || raw.slot_id,
      date: normDate(raw.date || raw.slot_date || raw.slotDate),
      time: normTime(raw.time || raw.slot_time || raw.slotTime),
      blocked: Boolean(raw.blocked ?? raw.is_blocked ?? raw.locked ?? false),
      capacity,
      occupied,
      remaining,
      bookings
    };
  }

  function injectStyles() {
    if ($('schedulerOperationalStyles')) return;
    const style = document.createElement('style');
    style.id = 'schedulerOperationalStyles';
    style.textContent = `
      #panel-agenda .stats,#panel-agenda .toolbar,#panel-agenda #agenda-grid,#panel-agenda #agenda-warning{display:none!important}
      .op-card{background:#fff;border-radius:22px;box-shadow:0 10px 32px rgba(0,0,0,.06);padding:16px;margin-bottom:14px}
      .op-top{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
      .op-top h2{margin:0;font-size:25px;line-height:1;font-weight:950;letter-spacing:-.04em}
      .op-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}
      .op-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line,#d9d4cc);background:#fff;color:var(--ink,#121314);border-radius:12px;padding:7px 10px;font-size:12px;font-weight:850;cursor:pointer;text-decoration:none;min-height:34px;white-space:nowrap}
      .op-btn.dark{background:#0a0a0b;color:#fff;border-color:#0a0a0b}
      .op-btn.danger{background:#fff7f6;color:#b33a2d;border-color:#ebcdc8}
      .op-btn.success{background:#f0fbf4;color:#256947;border-color:#cae7d7}
      .op-btn.active{background:#0a0a0b;color:#fff;border-color:#0a0a0b}
      .op-field{display:flex;flex-direction:column;gap:4px}
      .op-field label{font-size:10px;font-weight:900;color:#565960;text-transform:uppercase;letter-spacing:.05em}
      .op-field input,.op-field select{border:1px solid var(--line,#d9d4cc);border-radius:12px;padding:7px 10px;min-height:34px;background:#fff;font-size:12px}
      .op-table-wrap{overflow:auto;border:1px solid #ece7e0;border-radius:18px;background:#fff}
      .op-table{width:100%;border-collapse:collapse;min-width:1180px;background:#fff}
      .op-table th{text-align:left;padding:10px 9px;background:#f7f4f0;color:#565960;font-size:10px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
      .op-table td{padding:9px;border-top:1px solid #efebe5;vertical-align:middle;font-size:12px;line-height:1.25}
      .op-slot-row td{background:#fff}
      .op-slot-row strong{font-size:14px}
      .op-booking-row td{background:#fcfbfa}
      .op-booking-line{display:grid;grid-template-columns:minmax(170px,1.2fr) 90px minmax(160px,1fr) minmax(170px,1.1fr) minmax(150px,.9fr) 96px minmax(360px,1.6fr);gap:10px;align-items:center;width:100%}
      .op-booking-line b{display:block;font-size:13px}.op-booking-line span{display:block;color:#6e727a;font-size:11px;margin-top:1px}.op-phone{font-weight:850;color:#121314!important}
      .op-chip{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:5px 8px;font-size:11px;font-weight:900;white-space:nowrap}
      .op-chip.ok{background:#e7f5ee;color:#256947}.op-chip.bad{background:#f8e8e6;color:#b33a2d}.op-chip.wait{background:#fff8dd;color:#7c5c14}.op-chip.closed{background:#f8e8e6;color:#b33a2d}.op-chip.open{background:#e7f5ee;color:#256947}
      .op-empty{padding:18px;color:#6e727a;font-weight:750}
      .op-feedback{display:none;margin-bottom:12px;border-radius:14px;padding:11px 13px;font-size:13px;font-weight:800}.op-feedback.show{display:block}.op-feedback.success{background:#e7f5ee;color:#256947}.op-feedback.error{background:#f8e8e6;color:#b33a2d}
      .op-modal{position:fixed;inset:0;background:rgba(0,0,0,.38);display:none;align-items:center;justify-content:center;padding:18px;z-index:999}.op-modal.show{display:flex}.op-modal-card{width:min(100%,620px);background:#fff;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,.18);padding:22px}.op-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.op-modal-head h3{margin:0;font-size:28px;line-height:1;font-weight:950;letter-spacing:-.04em}.op-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      .op-xlsx-controls{display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-top:8px}
      @media(max-width:760px){.op-table{min-width:1050px}.op-booking-line{grid-template-columns:1fr}.op-grid{grid-template-columns:1fr}}
    `;
    document.head.appendChild(style);
  }

  function ensureRoot() {
    const panel = $('panel-agenda');
    if (!panel) return null;
    let root = $('operationalAgenda');
    if (!root) {
      root = document.createElement('div');
      root.id = 'operationalAgenda';
      panel.prepend(root);
    }
    return root;
  }

  function feedback(type, message) {
    const box = $('opFeedback');
    if (!box) { alert(message); return; }
    box.className = 'op-feedback show ' + (type === 'success' ? 'success' : 'error');
    box.textContent = message;
  }

  async function load() {
    const data = await rpc('training_admin_get_state', { p_session_token: token() });
    state.slots = (data.slots || data.agenda || data.turmas || []).map(normalizeSlot).sort((a,b) => (a.date + a.time).localeCompare(b.date + b.time));
    state.loaded = true;
  }

  function visibleSlots() {
    const today = todayISO();
    let list = state.slots.filter(slot => {
      if (state.view === 'future') return slot.date >= today;
      return slot.date < today && Number(slot.occupied || 0) > 0;
    });
    if (state.view === 'past') list = list.sort((a,b) => (b.date + b.time).localeCompare(a.date + a.time));
    else list = list.sort((a,b) => (a.date + a.time).localeCompare(b.date + b.time));
    return list;
  }

  function storeOptions() {
    const stores = new Set();
    state.slots.forEach(s => (s.bookings || []).forEach(b => { const store = bookingStore(b); if (store && store !== '-') stores.add(store); }));
    return Array.from(stores).sort();
  }

  function render() {
    const root = ensureRoot();
    if (!root) return;
    const slots = visibleSlots();
    const next = state.slots.filter(s => s.date >= todayISO()).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))[0];
    root.innerHTML = `
      <div id="opFeedback" class="op-feedback"></div>
      <section class="op-card">
        <div class="op-top">
          <div>
            <h2>Agenda de turmas</h2>
            <div style="color:#6e727a;font-size:13px;font-weight:750;margin-top:4px">${next ? `Próxima turma: ${fmtDateBR(next.date)} às ${next.time}` : 'Nenhuma turma futura cadastrada.'}</div>
          </div>
          <div class="op-actions">
            <button class="op-btn ${state.view === 'future' ? 'active' : ''}" id="opFuture" type="button">Futuras</button>
            <button class="op-btn ${state.view === 'past' ? 'active' : ''}" id="opPast" type="button">Finalizadas</button>
            <button class="op-btn dark" id="opNew" type="button">+ Nova turma</button>
            <button class="op-btn" id="opRefresh" type="button">Atualizar</button>
          </div>
        </div>
        <div class="op-xlsx-controls">
          <div class="op-field"><label>Início</label><input id="xlsxStart" type="date"></div>
          <div class="op-field"><label>Fim</label><input id="xlsxEnd" type="date"></div>
          <div class="op-field"><label>Loja</label><select id="xlsxStore"><option value="">Todas</option>${storeOptions().map(s => `<option>${esc(s)}</option>`).join('')}</select></div>
          <button class="op-btn success" id="opExcel" type="button">Exportar Excel</button>
        </div>
      </section>
      <section class="op-card">
        <div class="op-table-wrap">
          <table class="op-table">
            <thead><tr><th>Turma</th><th>Status</th><th>Vagas</th><th>Inscritos</th><th>Ações</th></tr></thead>
            <tbody>${slots.map(renderSlotRow).join('') || `<tr><td colspan="5"><div class="op-empty">Nenhuma turma ${state.view === 'future' ? 'futura' : 'finalizada com inscritos'} encontrada.</div></td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
    bind();
  }

  function renderSlotRow(slot) {
    const expanded = state.expanded.has(slot.id);
    const rows = [`
      <tr class="op-slot-row">
        <td><strong>${fmtDateBR(slot.date)} • ${esc(slot.time)}</strong><div style="color:#6e727a;font-size:11px;margin-top:2px">ID ${esc(String(slot.id).slice(0,8))}</div></td>
        <td><span class="op-chip ${slot.blocked ? 'closed' : 'open'}">${slot.blocked ? 'Fechada' : 'Aberta'}</span></td>
        <td>${slot.occupied}/${slot.capacity} inscritos • ${slot.remaining} vagas</td>
        <td>${slot.occupied}</td>
        <td><div class="op-actions"><button class="op-btn" data-toggle="${esc(slot.id)}">${expanded ? 'Ocultar' : 'Inscritos'}</button><button class="op-btn" data-edit-slot="${esc(slot.id)}">Editar</button><button class="op-btn ${slot.blocked ? 'success' : 'danger'}" data-close-slot="${esc(slot.id)}">${slot.blocked ? 'Reabrir' : 'Fechar'}</button><button class="op-btn" data-send-presence="${esc(slot.id)}">Enviar confirmação</button></div></td>
      </tr>`];
    if (expanded) {
      if (!slot.bookings.length) {
        rows.push(`<tr class="op-booking-row"><td colspan="5"><div class="op-empty">Sem inscritos nesta turma.</div></td></tr>`);
      } else {
        slot.bookings.forEach(b => rows.push(`<tr class="op-booking-row"><td colspan="5">${renderBookingLine(slot, b)}</td></tr>`));
      }
    }
    return rows.join('');
  }

  function renderBookingLine(slot, booking) {
    const phone = bookingPhone(booking);
    const manager = managerName(booking) || 'Gerente não localizado';
    const managerPhoneText = managerPhone(booking);
    return `<div class="op-booking-line">
      <div><b>${esc(bookingName(booking))}</b><span>${esc(bookingRole(booking))}</span></div>
      <div><span class="op-phone">${esc(phone || '-')}</span><span>${esc(bookingEmail(booking) || '')}</span></div>
      <div><b>${esc(bookingStore(booking))}</b><span>${esc(bookingCity(booking))}</span></div>
      <div><b>${esc(manager)}</b><span>${esc(managerPhoneText || '')}</span></div>
      <div><span class="op-chip ${statusClass(attendanceStatus(booking))}">${statusLabel(attendanceStatus(booking))}</span></div>
      <div class="op-actions"><a class="op-btn" href="tel:${esc(phoneBR(phone))}">Ligar</a>${managerPhoneText ? `<a class="op-btn" href="tel:${esc(phoneBR(managerPhoneDigits(booking)))}">Gerente</a>` : ''}</div>
      <div class="op-actions"><button class="op-btn" data-wa-presence="${esc(booking.id)}">WhatsApp presença</button><button class="op-btn success" data-attendance="${esc(booking.id)}" data-status="present">Presente</button><button class="op-btn danger" data-attendance="${esc(booking.id)}" data-status="absent">Faltou</button><button class="op-btn" data-edit-booking="${esc(booking.id)}">Editar</button><button class="op-btn danger" data-cancel-booking="${esc(booking.id)}">Cancelar</button></div>
    </div>`;
  }

  function bind() {
    $('opFuture')?.addEventListener('click', () => { state.view = 'future'; render(); });
    $('opPast')?.addEventListener('click', () => { state.view = 'past'; render(); });
    $('opRefresh')?.addEventListener('click', refresh);
    $('opNew')?.addEventListener('click', () => openSlotModal());
    $('opExcel')?.addEventListener('click', exportExcel);
    qsa('[data-toggle]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.toggle; state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); render(); }));
    qsa('[data-edit-slot]').forEach(b => b.addEventListener('click', () => openSlotModal(findSlot(b.dataset.editSlot))));
    qsa('[data-close-slot]').forEach(b => b.addEventListener('click', () => toggleSlot(findSlot(b.dataset.closeSlot))));
    qsa('[data-send-presence]').forEach(b => b.addEventListener('click', () => sendPresenceToSlot(findSlot(b.dataset.sendPresence))));
    qsa('[data-wa-presence]').forEach(b => b.addEventListener('click', () => sendPresenceOne(b.dataset.waPresence)));
    qsa('[data-attendance]').forEach(b => b.addEventListener('click', () => markAttendance(b.dataset.attendance, b.dataset.status)));
    qsa('[data-cancel-booking]').forEach(b => b.addEventListener('click', () => cancelBooking(b.dataset.cancelBooking)));
    qsa('[data-edit-booking]').forEach(b => b.addEventListener('click', () => alert('Edição do inscrito continua disponível pela versão anterior. Use o botão Editar se aparecer no bloco antigo ou me peça para migrar o modal para esta lista.')));
  }

  function findSlot(id) { return state.slots.find(s => String(s.id) === String(id)); }
  function findBooking(id) { for (const s of state.slots) { const b = (s.bookings || []).find(x => String(x.id) === String(id)); if (b) return { slot: s, booking: b }; } return null; }

  async function refresh() { try { await load(); render(); } catch (e) { feedback('error', e.message); } }

  function ensureModal() {
    if ($('opSlotModal')) return;
    const modal = document.createElement('div');
    modal.id = 'opSlotModal';
    modal.className = 'op-modal';
    modal.innerHTML = `<div class="op-modal-card"><div class="op-modal-head"><h3 id="opModalTitle">Nova turma</h3><button class="op-btn" id="opModalClose" type="button">Fechar</button></div><form id="opSlotForm"><input id="opSlotId" type="hidden"><div class="op-grid"><div class="op-field"><label>Data</label><input id="opSlotDate" type="date" required></div><div class="op-field"><label>Horário</label><input id="opSlotTime" type="time" required></div><div class="op-field"><label>Vagas</label><input id="opSlotCapacity" type="number" min="1" max="99" required></div><div class="op-field"><label>Status</label><select id="opSlotOpen"><option value="true">Aberta</option><option value="false">Fechada</option></select></div></div><div class="op-actions" style="margin-top:14px"><button class="op-btn dark" type="submit">Salvar</button><button class="op-btn" type="button" id="opSlotCancel">Cancelar</button></div></form></div>`;
    document.body.appendChild(modal);
    $('opModalClose').addEventListener('click', closeModal);
    $('opSlotCancel').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    $('opSlotForm').addEventListener('submit', saveSlot);
  }

  function openSlotModal(slot) {
    ensureModal();
    $('opModalTitle').textContent = slot ? 'Editar turma' : 'Nova turma';
    $('opSlotId').value = slot?.id || '';
    $('opSlotDate').value = slot?.date || todayISO();
    $('opSlotTime').value = slot?.time || '10:00';
    $('opSlotCapacity').value = slot?.capacity || 20;
    $('opSlotOpen').value = slot && slot.blocked ? 'false' : 'true';
    $('opSlotModal').classList.add('show');
  }

  function closeModal() { $('opSlotModal')?.classList.remove('show'); }

  async function saveSlot(e) {
    e.preventDefault();
    const id = $('opSlotId').value;
    const payload = {
      p_session_token: token(),
      p_slot_date: $('opSlotDate').value,
      p_slot_time: $('opSlotTime').value,
      p_capacity: Number($('opSlotCapacity').value || 0),
      p_is_open: $('opSlotOpen').value === 'true'
    };
    try {
      if (id) await rpc('training_admin_update_slot', { ...payload, p_slot_id: id });
      else await rpc('training_admin_create_custom_slot', payload);
      closeModal();
      feedback('success', id ? 'Turma atualizada.' : 'Turma criada.');
      await refresh();
    } catch (err) { feedback('error', err.message); }
  }

  async function toggleSlot(slot) {
    if (!slot) return;
    try {
      if (slot.blocked) await rpc('training_admin_open_slot', { p_session_token: token(), p_slot_id: slot.id });
      else await rpc('training_admin_close_slot', { p_session_token: token(), p_slot_id: slot.id });
      feedback('success', slot.blocked ? 'Inscrições reabertas.' : 'Inscrições fechadas.');
      await refresh();
    } catch (e) { feedback('error', e.message); }
  }

  function sendPresenceOne(bookingId) {
    const found = findBooking(bookingId);
    if (!found) return feedback('error', 'Inscrito não encontrado.');
    const phone = phoneBR(bookingPhone(found.booking));
    if (!phone) return feedback('error', 'Telefone do inscrito não localizado.');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(presenceText(found.booking, found.slot))}`, '_blank', 'noopener');
  }

  function sendPresenceToSlot(slot) {
    if (!slot || !slot.bookings.length) return feedback('error', 'Turma sem inscritos.');
    if (!confirm(`Abrir WhatsApp para ${slot.bookings.length} inscrito(s)?`)) return;
    slot.bookings.forEach((booking, i) => setTimeout(() => {
      const phone = phoneBR(bookingPhone(booking));
      if (phone) window.open(`https://wa.me/${phone}?text=${encodeURIComponent(presenceText(booking, slot))}`, '_blank', 'noopener');
    }, i * 450));
  }

  async function markAttendance(bookingId, status) {
    try {
      await rpc('training_admin_mark_attendance', { p_session_token: token(), p_booking_id: bookingId, p_attendance_status: status });
      feedback('success', status === 'present' ? 'Presença marcada.' : 'Falta marcada.');
      await refresh();
    } catch (e) { feedback('error', e.message); }
  }

  async function cancelBooking(bookingId) {
    const found = findBooking(bookingId);
    const label = found ? bookingName(found.booking) : 'este inscrito';
    if (!confirm(`Cancelar inscrição de ${label}?`)) return;
    try {
      await rpc('training_admin_cancel_booking', { p_session_token: token(), p_booking_id: bookingId });
      feedback('success', 'Inscrição cancelada.');
      await refresh();
    } catch (e) { feedback('error', e.message); }
  }

  async function ensureXLSX() {
    if (window.XLSX) return window.XLSX;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return window.XLSX;
  }

  async function exportExcel() {
    try {
      const XLSX = await ensureXLSX();
      const start = $('xlsxStart')?.value || '0000-01-01';
      const end = $('xlsxEnd')?.value || '9999-12-31';
      const store = $('xlsxStore')?.value || '';
      const rows = [];
      state.slots.forEach(slot => {
        if (slot.date < start || slot.date > end) return;
        (slot.bookings || []).forEach(b => {
          if (store && bookingStore(b) !== store) return;
          rows.push({
            Data: fmtDateBR(slot.date), Horario: slot.time, StatusTurma: slot.blocked ? 'Fechada' : 'Aberta',
            Participante: bookingName(b), Cargo: bookingRole(b), Telefone: bookingPhone(b), Email: bookingEmail(b), Loja: bookingStore(b), Cidade: bookingCity(b),
            Gerente: managerName(b), TelefoneGerente: managerPhone(b), Presenca: statusLabel(attendanceStatus(b))
          });
        });
      });
      const resumo = [
        { Indicador: 'Participantes no filtro', Valor: rows.length },
        { Indicador: 'Presentes/confirmados', Valor: rows.filter(r => ['Confirmou','Presente'].includes(r.Presenca)).length },
        { Indicador: 'Faltas', Valor: rows.filter(r => r.Presenca === 'Faltou').length },
        { Indicador: 'Lojas', Valor: new Set(rows.map(r => r.Loja).filter(Boolean)).size }
      ];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(resumo), 'Dashboard');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Participantes');
      XLSX.writeFile(wb, `relatorio_treinamento_${todayISO()}.xlsx`);
    } catch (e) { feedback('error', 'Não foi possível gerar Excel: ' + e.message); }
  }

  async function start() {
    const root = ensureRoot();
    if (!root || !token() || !client()) return;
    injectStyles();
    root.innerHTML = '<section class="op-card"><div class="op-empty">Carregando agenda operacional...</div></section>';
    try { await load(); render(); }
    catch (e) { root.innerHTML = `<section class="op-card"><div class="op-feedback show error">${esc(e.message)}</div></section>`; }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(start, 700));
  else setTimeout(start, 700);
  setTimeout(start, 1800);
})();
