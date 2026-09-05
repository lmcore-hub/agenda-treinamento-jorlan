(function () {
  'use strict';

  const CONFIG = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const TOKEN_KEYS = ['jorlan_admin_session_token', 'jorlanTrainingAdminToken'];
  let supabaseClient = null;
  let injectionAttempts = 0;
  let editingSlot = null;
  let observerStarted = false;

  function $(id) { return document.getElementById(id); }
  function qs(selector, root = document) { return root.querySelector(selector); }
  function qsa(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

  function getToken() {
    for (const key of TOKEN_KEYS) {
      const value = localStorage.getItem(key) || sessionStorage.getItem(key);
      if (value) return value;
    }
    return '';
  }

  function getClient() {
    if (!window.supabase || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return null;
    if (!supabaseClient) supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return supabaseClient;
  }

  async function rpc(name, params) {
    const client = getClient();
    if (!client) throw new Error('Supabase não configurado.');
    const { data, error } = await client.rpc(name, params || {});
    if (error) throw new Error(error.message || 'Erro na comunicação com o banco.');
    return data;
  }

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function isWeekday(dateValue) {
    if (!dateValue) return false;
    const [y, m, d] = dateValue.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const day = date.getDay();
    return day >= 1 && day <= 5;
  }

  function weekOffsetFromToday(dateValue) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const nowMonday = new Date(now);
    nowMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const [y, m, d] = dateValue.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    target.setHours(0, 0, 0, 0);
    const targetMonday = new Date(target);
    targetMonday.setDate(target.getDate() - ((target.getDay() + 6) % 7));
    return Math.round((targetMonday - nowMonday) / (7 * 24 * 60 * 60 * 1000));
  }

  function parseBRDate(value) {
    const match = String(value || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return '';
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  function parseTime(value) {
    const match = String(value || '').match(/([01]\d|2[0-3]):[0-5]\d/);
    return match ? match[0] : '';
  }

  function showFeedback(type, text) {
    const box = $('schedulerFeedback');
    if (!box) return;
    if (!text) {
      box.className = 'scheduler-feedback';
      box.textContent = '';
      return;
    }
    box.className = 'scheduler-feedback show ' + (type === 'success' ? 'success' : 'error');
    box.textContent = text;
  }

  function showAgendaFeedback(type, text) {
    const box = $('agenda-feedback');
    if (!box) return;
    box.className = 'feedback show ' + (type === 'success' ? 'success' : 'error');
    box.textContent = text;
  }

  function closeModal() {
    const modal = $('schedulerModal');
    if (modal) modal.classList.remove('show');
    editingSlot = null;
  }

  function setModalMode(mode, slot) {
    editingSlot = mode === 'edit' ? slot : null;
    const title = $('schedulerTitle');
    const subtitle = $('schedulerSubtitle');
    const submit = $('schedulerSubmit');
    const danger = $('schedulerModalCloseSlot');
    const status = $('schedulerStatus');
    const date = $('schedulerDate');
    const time = $('schedulerTime');
    const capacity = $('schedulerCapacity');

    if (mode === 'edit' && slot) {
      title.textContent = 'Editar turma';
      subtitle.textContent = 'Altere data, horário, vagas ou o status de inscrição desta turma.';
      submit.textContent = 'Salvar alterações';
      date.value = slot.date || todayISO();
      time.value = slot.time || '10:00';
      capacity.value = String(slot.capacity || Math.max(slot.booked || 0, 8));
      capacity.min = String(Math.max(slot.booked || 0, 1));
      status.value = slot.blocked ? 'false' : 'true';
      danger.style.display = slot.blocked ? 'none' : 'inline-flex';
    } else {
      title.textContent = 'Nova turma';
      subtitle.textContent = 'Crie treinamentos somente nos dias úteis, com horário e quantidade de vagas definidos por você.';
      submit.textContent = 'Salvar turma';
      date.value = todayISO();
      time.value = '10:00';
      capacity.value = '8';
      capacity.min = '1';
      status.value = 'true';
      danger.style.display = 'none';
    }
    showFeedback('', '');
  }

  function openCreateModal() {
    setModalMode('create');
    const modal = $('schedulerModal');
    if (modal) modal.classList.add('show');
  }

  function openEditModal(slot) {
    setModalMode('edit', slot);
    const modal = $('schedulerModal');
    if (modal) modal.classList.add('show');
  }

  function injectStyles() {
    if ($('schedulerStyles')) return;
    const style = document.createElement('style');
    style.id = 'schedulerStyles';
    style.textContent = `
      .scheduler-create-btn { background:#0a0a0b!important; color:#fff!important; border-color:#0a0a0b!important; }
      .scheduler-modal { position:fixed; inset:0; z-index:80; display:none; align-items:center; justify-content:center; padding:18px; background:rgba(0,0,0,.38); }
      .scheduler-modal.show { display:flex; }
      .scheduler-card { width:min(100%,660px); background:#fff; border-radius:28px; box-shadow:0 20px 60px rgba(0,0,0,.18); padding:26px; }
      .scheduler-head { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
      .scheduler-head h3 { margin:0 0 6px; font-size:34px; line-height:.96; font-weight:950; letter-spacing:-.05em; }
      .scheduler-head p { margin:0; color:#6e727a; font-weight:650; }
      .scheduler-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
      .scheduler-field { display:flex; flex-direction:column; gap:7px; }
      .scheduler-field label { font-size:13px; font-weight:850; color:#565960; }
      .scheduler-field input, .scheduler-field select { border:1px solid #d9d4cc; border-radius:14px; padding:12px 13px; min-height:46px; background:#fff; }
      .scheduler-actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:18px; }
      .scheduler-feedback { display:none; margin:0 0 14px; border-radius:14px; padding:12px 14px; font-size:14px; font-weight:800; }
      .scheduler-feedback.show { display:block; }
      .scheduler-feedback.success { background:#e7f5ee; color:#256947; }
      .scheduler-feedback.error { background:#f8e8e6; color:#b33a2d; }
      .scheduler-slot-actions { display:flex; gap:8px; flex-wrap:wrap; margin:12px 0 4px; }
      .scheduler-slot-actions .btn { min-height:36px; }
      .scheduler-hide-old-toggle { display:none!important; }
      @media(max-width:720px){ .scheduler-grid{grid-template-columns:1fr}.scheduler-head h3{font-size:28px} }
    `;
    document.head.appendChild(style);
  }

  function injectModal() {
    if ($('schedulerModal')) return;
    const modal = document.createElement('div');
    modal.id = 'schedulerModal';
    modal.className = 'scheduler-modal';
    modal.innerHTML = `
      <div class="scheduler-card" role="dialog" aria-modal="true" aria-labelledby="schedulerTitle">
        <div class="scheduler-head">
          <div>
            <h3 id="schedulerTitle">Nova turma</h3>
            <p id="schedulerSubtitle">Crie treinamentos somente nos dias úteis, com horário e quantidade de vagas definidos por você.</p>
          </div>
          <button class="btn small" id="schedulerClose" type="button">Fechar</button>
        </div>
        <div id="schedulerFeedback" class="scheduler-feedback"></div>
        <form id="schedulerForm">
          <div class="scheduler-grid">
            <div class="scheduler-field"><label for="schedulerDate">Data</label><input id="schedulerDate" type="date" required></div>
            <div class="scheduler-field"><label for="schedulerTime">Horário</label><input id="schedulerTime" type="time" value="10:00" required></div>
            <div class="scheduler-field"><label for="schedulerCapacity">Participantes/vagas</label><input id="schedulerCapacity" type="number" min="1" max="99" value="8" required></div>
            <div class="scheduler-field"><label for="schedulerStatus">Status</label><select id="schedulerStatus"><option value="true">Aberta para inscrição</option><option value="false">Inscrições fechadas</option></select></div>
          </div>
          <div class="scheduler-actions">
            <button class="btn dark" id="schedulerSubmit" type="submit">Salvar turma</button>
            <button class="btn danger" id="schedulerModalCloseSlot" type="button" style="display:none">Fechar inscrições</button>
            <button class="btn" type="button" id="schedulerCancel">Cancelar</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    $('schedulerClose').addEventListener('click', closeModal);
    $('schedulerCancel').addEventListener('click', closeModal);
    $('schedulerModalCloseSlot').addEventListener('click', () => editingSlot && closeSlot(editingSlot));
    modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
    $('schedulerForm').addEventListener('submit', saveSlot);
  }

  function injectPlusButton() {
    const agendaPanel = $('panel-agenda');
    if (!agendaPanel || $('schedulerOpen')) return false;
    const toolbarRight = qs('#panel-agenda .toolbar-right') || qs('#panel-agenda .toolbar-left') || qs('#panel-agenda .toolbar');
    if (!toolbarRight) return false;
    const button = document.createElement('button');
    button.id = 'schedulerOpen';
    button.type = 'button';
    button.className = 'btn dark scheduler-create-btn';
    button.innerHTML = '<span style="font-size:20px;line-height:0">+</span> Nova turma';
    button.addEventListener('click', openCreateModal);
    toolbarRight.prepend(button);
    const warning = $('agenda-warning');
    if (warning) {
      warning.className = 'notice show';
      warning.textContent = 'Agenda manual: use “+ Nova turma” para criar os treinamentos. O sistema não gera datas automaticamente.';
    }
    return true;
  }

  function slotFromCard(card) {
    const toggle = qs('[data-slot-toggle]', card);
    if (!toggle) return null;
    const title = qs('.slot-title', card)?.textContent || '';
    const minis = qsa('.mini strong', card).map(el => Number(String(el.textContent || '').replace(/\D/g, '')) || 0);
    const status = qs('.pill-status', card)?.textContent || '';
    const blocked = toggle.dataset.blocked === 'true' || /bloqueada|fechada/i.test(status);
    return {
      id: toggle.dataset.slotToggle,
      date: parseBRDate(title),
      time: parseTime(title),
      capacity: minis[0] || 8,
      booked: minis[1] || 0,
      available: minis[2] || 0,
      blocked
    };
  }

  function enhanceSlotCards() {
    qsa('#agenda-grid .slot-card').forEach(card => {
      if (card.dataset.schedulerEnhanced === 'true') return;
      const slot = slotFromCard(card);
      if (!slot || !slot.id) return;
      card.dataset.schedulerEnhanced = 'true';
      const oldToggle = qs('[data-slot-toggle]', card);
      if (oldToggle) oldToggle.classList.add('scheduler-hide-old-toggle');

      const actions = document.createElement('div');
      actions.className = 'scheduler-slot-actions';
      actions.innerHTML = `
        <button class="btn small" type="button" data-scheduler-edit>Editar turma</button>
        <button class="btn small ${slot.blocked ? 'success' : 'danger'}" type="button" data-scheduler-close>${slot.blocked ? 'Reabrir inscrições' : 'Fechar inscrições'}</button>
      `;
      const metrics = qs('.slot-metrics', card);
      if (metrics && metrics.parentNode) metrics.parentNode.insertBefore(actions, metrics.nextSibling);
      else card.appendChild(actions);

      qs('[data-scheduler-edit]', actions).addEventListener('click', () => openEditModal(slotFromCard(card) || slot));
      qs('[data-scheduler-close]', actions).addEventListener('click', () => toggleRegistration(slotFromCard(card) || slot));
    });
  }

  async function saveSlot(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = qs('button[type="submit"]', form);
    const date = $('schedulerDate').value;
    const time = $('schedulerTime').value;
    const capacity = Number($('schedulerCapacity').value || 0);
    const open = $('schedulerStatus').value === 'true';

    if (!isWeekday(date)) {
      showFeedback('error', 'Escolha uma data de segunda a sexta-feira.');
      return;
    }
    if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      showFeedback('error', 'Informe um horário válido.');
      return;
    }
    if (!capacity || capacity < 1 || capacity > 99) {
      showFeedback('error', 'Informe a quantidade de participantes entre 1 e 99.');
      return;
    }
    if (editingSlot && capacity < editingSlot.booked) {
      showFeedback('error', `Não é possível reduzir para ${capacity}. Esta turma já possui ${editingSlot.booked} inscritos ativos.`);
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Salvando...';
    try {
      if (editingSlot) {
        await rpc('training_admin_update_slot', {
          p_session_token: getToken(),
          p_slot_id: editingSlot.id,
          p_slot_date: date,
          p_slot_time: time,
          p_capacity: capacity,
          p_is_open: open
        });
        showFeedback('success', 'Turma atualizada com sucesso. Atualizando agenda...');
      } else {
        await rpc('training_admin_create_custom_slot', {
          p_session_token: getToken(),
          p_slot_date: date,
          p_slot_time: time,
          p_capacity: capacity,
          p_is_open: open
        });
        showFeedback('success', 'Turma programada com sucesso. Atualizando agenda...');
      }
      await navigateToSlotWeek(date);
      setTimeout(closeModal, 600);
    } catch (error) {
      showFeedback('error', error.message || 'Não foi possível salvar a turma.');
    } finally {
      submit.disabled = false;
      submit.textContent = editingSlot ? 'Salvar alterações' : 'Salvar turma';
    }
  }

  async function toggleRegistration(slot) {
    if (!slot || !slot.id) return;
    if (slot.blocked) {
      if (!confirm('Reabrir inscrições desta turma? Ela voltará a aparecer para cadastro na página pública.')) return;
      await openSlot(slot);
    } else {
      if (!confirm('Fechar inscrições desta turma? Ela deixará de aparecer para novos cadastros. Os inscritos atuais serão preservados.')) return;
      await closeSlot(slot);
    }
  }

  async function closeSlot(slot) {
    try {
      await rpc('training_admin_close_slot', { p_session_token: getToken(), p_slot_id: slot.id });
      showAgendaFeedback('success', 'Inscrições fechadas. A turma não aparece mais para novos cadastros.');
      await refreshAgenda();
      closeModal();
    } catch (error) {
      showFeedback('error', error.message || 'Não foi possível fechar inscrições.');
      showAgendaFeedback('error', error.message || 'Não foi possível fechar inscrições.');
    }
  }

  async function openSlot(slot) {
    try {
      await rpc('training_admin_open_slot', { p_session_token: getToken(), p_slot_id: slot.id });
      showAgendaFeedback('success', 'Inscrições reabertas. A turma voltou a aparecer para cadastro.');
      await refreshAgenda();
    } catch (error) {
      showAgendaFeedback('error', error.message || 'Não foi possível reabrir inscrições.');
    }
  }

  async function refreshAgenda() {
    const refresh = $('refresh-agenda') || $('refreshAdmin');
    if (refresh) refresh.click();
    await new Promise(resolve => setTimeout(resolve, 750));
    enhanceSlotCards();
  }

  async function navigateToSlotWeek(dateValue) {
    const refresh = $('refresh-agenda') || $('refreshAdmin');
    if (refresh) refresh.click();
    const targetOffset = weekOffsetFromToday(dateValue);
    const maxClicks = Math.min(Math.abs(targetOffset), 32);
    const btn = targetOffset >= 0 ? $('extend-week') : $('prev-week');
    if (!btn || maxClicks === 0) {
      await new Promise(resolve => setTimeout(resolve, 750));
      enhanceSlotCards();
      return;
    }
    for (let i = 0; i < maxClicks; i++) {
      await new Promise(resolve => setTimeout(resolve, 180));
      btn.click();
    }
    await new Promise(resolve => setTimeout(resolve, 750));
    enhanceSlotCards();
  }

  function startObserver() {
    if (observerStarted) return;
    const grid = $('agenda-grid');
    if (!grid) return;
    observerStarted = true;
    const observer = new MutationObserver(() => setTimeout(enhanceSlotCards, 50));
    observer.observe(grid, { childList: true, subtree: true });
  }

  function start() {
    injectStyles();
    injectModal();
    injectPlusButton();
    enhanceSlotCards();
    startObserver();
    if ((!$('schedulerOpen') || !$('agenda-grid')) && injectionAttempts < 12) {
      injectionAttempts += 1;
      setTimeout(start, 500);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
