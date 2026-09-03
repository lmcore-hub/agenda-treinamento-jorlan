(function () {
  'use strict';

  const CONFIG = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const TOKEN_KEYS = ['jorlan_admin_session_token', 'jorlanTrainingAdminToken'];
  let supabaseClient = null;

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

  function $(id) { return document.getElementById(id); }

  function showMessage(type, text) {
    const box = $('customSlotFeedback');
    if (!box) return;
    box.className = 'feedback show ' + (type === 'success' ? 'success' : 'error');
    box.textContent = text;
  }

  function isWeekday(dateValue) {
    if (!dateValue) return false;
    const [y, m, d] = dateValue.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const day = date.getDay();
    return day >= 1 && day <= 5;
  }

  function injectSchedulerForm() {
    const panel = $('panel-agenda') || document.querySelector('.panel.active') || document.querySelector('main');
    if (!panel || $('customSlotForm')) return;

    const today = new Date().toISOString().slice(0, 10);
    const card = document.createElement('section');
    card.className = 'card';
    card.style.padding = '22px';
    card.style.marginBottom = '18px';
    card.innerHTML = `
      <div class="section-head" style="margin-bottom:14px">
        <div>
          <h2 style="margin:0;font-size:30px;line-height:1;font-weight:950;letter-spacing:-.04em">Programar nova turma</h2>
          <p style="margin:8px 0 0;color:var(--muted,#6e727a)">Crie treinamentos em qualquer dia de segunda a sexta, com horário e quantidade de participantes definidos.</p>
        </div>
      </div>
      <div id="customSlotFeedback" class="feedback"></div>
      <form id="customSlotForm" style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:end">
        <div class="field" style="margin:0"><label for="customSlotDate">Data</label><input id="customSlotDate" type="date" value="${today}" required></div>
        <div class="field" style="margin:0"><label for="customSlotTime">Horário</label><input id="customSlotTime" type="time" value="10:00" required></div>
        <div class="field" style="margin:0"><label for="customSlotCapacity">Participantes/vagas</label><input id="customSlotCapacity" type="number" min="1" max="99" value="8" required></div>
        <div class="field" style="margin:0"><label for="customSlotOpen">Status</label><select id="customSlotOpen"><option value="true">Aberta para inscrição</option><option value="false">Bloqueada</option></select></div>
        <div style="grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap;align-items:center">
          <button class="btn dark" type="submit">Salvar turma</button>
          <span style="color:var(--muted,#6e727a);font-size:13px;font-weight:750">Sábado e domingo são bloqueados automaticamente.</span>
        </div>
      </form>
    `;

    const grid = $('agenda-grid') || $('adminCalendar');
    if (grid && grid.parentNode) grid.parentNode.insertBefore(card, grid);
    else panel.prepend(card);

    $('customSlotForm').addEventListener('submit', saveCustomSlot);
  }

  async function saveCustomSlot(event) {
    event.preventDefault();
    const date = $('customSlotDate').value;
    const time = $('customSlotTime').value;
    const capacity = Number($('customSlotCapacity').value || 0);
    const open = $('customSlotOpen').value === 'true';

    if (!isWeekday(date)) {
      showMessage('error', 'Escolha uma data de segunda a sexta-feira.');
      return;
    }
    if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
      showMessage('error', 'Informe um horário válido.');
      return;
    }
    if (!capacity || capacity < 1 || capacity > 99) {
      showMessage('error', 'Informe a quantidade de participantes entre 1 e 99.');
      return;
    }

    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Salvando...';
    try {
      await rpc('training_admin_create_custom_slot', {
        p_session_token: getToken(),
        p_slot_date: date,
        p_slot_time: time,
        p_capacity: capacity,
        p_is_open: open
      });
      showMessage('success', 'Turma programada com sucesso. Atualizando agenda...');
      const refresh = $('refresh-agenda') || $('refreshAdmin');
      if (refresh) refresh.click();
      else setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      showMessage('error', error.message || 'Não foi possível salvar a turma.');
    } finally {
      button.disabled = false;
      button.textContent = 'Salvar turma';
    }
  }

  function waitAndInject() {
    injectSchedulerForm();
    setTimeout(injectSchedulerForm, 500);
    setTimeout(injectSchedulerForm, 1500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndInject);
  } else {
    waitAndInject();
  }
})();
