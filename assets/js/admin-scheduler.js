(function () {
  'use strict';

  const CONFIG = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const TOKEN_KEYS = ['jorlan_admin_session_token', 'jorlanTrainingAdminToken'];
  let supabaseClient = null;
  let editingSlot = null;
  let observerStarted = false;
  let attempts = 0;

  const $ = (id) => document.getElementById(id);
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function isoToBR(iso) {
    const [y,m,d] = String(iso || '').slice(0,10).split('-');
    return d && m && y ? `${d}/${m}/${y}` : '';
  }
  function brToIso(text) {
    const m = String(text || '').match(/(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  }
  function parseTime(text) {
    const m = String(text || '').match(/([01]\d|2[0-3]):[0-5]\d/);
    return m ? m[0] : '';
  }
  function localDate(iso) {
    const [y,m,d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d);
  }
  function isWeekday(iso) {
    const d = localDate(iso);
    if (!d) return false;
    const day = d.getDay();
    return day >= 1 && day <= 5;
  }
  function parseWeekRange() {
    const text = $('agenda-horizon')?.textContent || '';
    const dates = text.match(/\d{2}\/\d{2}\/\d{4}/g) || [];
    if (dates.length < 2) return null;
    const start = localDate(brToIso(dates[0]));
    const end = localDate(brToIso(dates[1]));
    return start && end ? { start, end } : null;
  }
  function slotDateFromCard(card) {
    return brToIso(qs('.slot-title', card)?.textContent || '');
  }
  function slotFromCard(card) {
    const toggle = qs('[data-slot-toggle]', card);
    const title = qs('.slot-title', card)?.textContent || '';
    const minis = qsa('.mini strong', card).map(el => Number(String(el.textContent || '').replace(/\D/g,'')) || 0);
    const status = qs('.pill-status', card)?.textContent || '';
    if (!toggle) return null;
    return { id: toggle.dataset.slotToggle, date: brToIso(title), time: parseTime(title), capacity: minis[0] || 8, booked: minis[1] || 0, available: minis[2] || 0, blocked: toggle.dataset.blocked === 'true' || /bloqueada|fechada/i.test(status) };
  }
  function showAgendaFeedback(type, message) {
    const box = $('agenda-feedback');
    if (!box) { alert(message); return; }
    box.className = 'feedback show ' + (type === 'success' ? 'success' : 'error');
    box.textContent = message;
  }
  function showModalFeedback(type, text) {
    const box = $('schedulerFeedback');
    if (!box) return;
    if (!text) { box.className = 'scheduler-feedback'; box.textContent = ''; return; }
    box.className = 'scheduler-feedback show ' + (type === 'success' ? 'success' : 'error');
    box.textContent = text;
  }

  function injectStyles() {
    if ($('schedulerStyles')) return;
    const style = document.createElement('style');
    style.id = 'schedulerStyles';
    style.textContent = `
      #panel-agenda .stats{display:none!important}
      #panel-agenda .agenda-grid{display:block!important}
      #panel-agenda .slot-card{border:1px solid #eee8df!important;border-radius:18px!important;padding:13px 14px!important;margin:0 0 10px!important;box-shadow:0 6px 18px rgba(0,0,0,.04)!important}
      #panel-agenda .slot-top{display:grid!important;grid-template-columns:minmax(0,1fr) auto!important;gap:10px!important;margin-bottom:8px!important}
      #panel-agenda .slot-title{font-size:18px!important;letter-spacing:-.025em!important}
      #panel-agenda .slot-sub{font-size:13px!important;margin-top:2px!important}
      #panel-agenda .pill-status{min-width:auto!important;padding:5px 9px!important;font-size:11px!important}
      #panel-agenda .slot-metrics{display:flex!important;grid-template-columns:none!important;gap:7px!important;margin:8px 0!important}
      #panel-agenda .mini{padding:7px 9px!important;border-radius:12px!important;min-width:86px!important}
      #panel-agenda .mini strong{font-size:17px!important}
      #panel-agenda .participant-list{margin-top:8px!important;padding-top:8px!important}
      #panel-agenda .participant{grid-template-columns:minmax(0,1fr)!important;padding:8px 0!important;gap:6px!important}
      #panel-agenda .participant strong{font-size:14px!important}
      #panel-agenda .participant small{font-size:12px!important}
      #prev-week,#extend-week{display:none!important}
      .scheduler-create-btn{background:#0a0a0b!important;color:#fff!important;border-color:#0a0a0b!important}
      .scheduler-day-filter{display:flex;align-items:end;gap:8px;flex-wrap:wrap;background:#fff;border:1px solid #e7e2db;border-radius:16px;padding:8px 10px}
      .scheduler-day-filter label{display:block;font-size:11px;font-weight:900;color:#565960;margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em}
      .scheduler-day-filter input{border:1px solid #d9d4cc;border-radius:12px;padding:8px 10px;min-height:36px}
      .scheduler-slot-actions,.booking-admin-actions{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 4px!important}
      .scheduler-slot-actions .btn,.booking-admin-actions .btn,#panel-agenda .btn{padding:7px 10px!important;border-radius:12px!important;font-size:12px!important;min-height:34px!important}
      .scheduler-hide-old-toggle{display:none!important}
      .scheduler-date-empty{padding:18px;color:#6e727a;font-weight:750;border:1px dashed #d9d4cc;border-radius:18px;background:#fff;margin-top:10px}
      .scheduler-modal{position:fixed;inset:0;z-index:80;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.38)}.scheduler-modal.show{display:flex}.scheduler-card{width:min(100%,660px);background:#fff;border-radius:28px;box-shadow:0 20px 60px rgba(0,0,0,.18);padding:26px}.scheduler-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}.scheduler-head h3{margin:0 0 6px;font-size:34px;line-height:.96;font-weight:950;letter-spacing:-.05em}.scheduler-head p{margin:0;color:#6e727a;font-weight:650}.scheduler-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.scheduler-field{display:flex;flex-direction:column;gap:7px}.scheduler-field label{font-size:13px;font-weight:850;color:#565960}.scheduler-field input,.scheduler-field select{border:1px solid #d9d4cc;border-radius:14px;padding:12px 13px;min-height:46px;background:#fff}.scheduler-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.scheduler-feedback{display:none;margin:0 0 14px;border-radius:14px;padding:12px 14px;font-size:14px;font-weight:800}.scheduler-feedback.show{display:block}.scheduler-feedback.success{background:#e7f5ee;color:#256947}.scheduler-feedback.error{background:#f8e8e6;color:#b33a2d}
      @media(max-width:720px){.scheduler-grid{grid-template-columns:1fr}.scheduler-head h3{font-size:28px}}
    `;
    document.head.appendChild(style);
  }

  function injectDateFilter() {
    if ($('schedulerDayFilter')) return;
    const toolbar = qs('#panel-agenda .toolbar-left') || qs('#panel-agenda .toolbar');
    if (!toolbar) return;
    const box = document.createElement('div');
    box.id = 'schedulerDayFilter';
    box.className = 'scheduler-day-filter';
    box.innerHTML = `<div><label for="schedulerDayInput">Data</label><input id="schedulerDayInput" type="date" value="${todayISO()}"></div><button class="btn" id="schedulerDayGo" type="button">Ver dia</button>`;
    toolbar.prepend(box);
    $('schedulerDayGo').addEventListener('click', () => navigateToDate($('schedulerDayInput').value));
    $('schedulerDayInput').addEventListener('change', () => navigateToDate($('schedulerDayInput').value));
  }

  function injectPlusButton() {
    if ($('schedulerOpen')) return;
    const toolbarRight = qs('#panel-agenda .toolbar-right') || qs('#panel-agenda .toolbar-left') || qs('#panel-agenda .toolbar');
    if (!toolbarRight) return;
    const button = document.createElement('button');
    button.id = 'schedulerOpen';
    button.type = 'button';
    button.className = 'btn dark scheduler-create-btn';
    button.innerHTML = '<span style="font-size:18px;line-height:0">+</span> Nova turma';
    button.addEventListener('click', openCreateModal);
    toolbarRight.prepend(button);
    const warning = $('agenda-warning');
    if (warning) { warning.className = 'notice show'; warning.textContent = 'Agenda manual: escolha o dia no filtro e use “+ Nova turma” para criar treinamentos.'; }
  }

  function injectModal() {
    if ($('schedulerModal')) return;
    const modal = document.createElement('div');
    modal.id = 'schedulerModal';
    modal.className = 'scheduler-modal';
    modal.innerHTML = `<div class="scheduler-card" role="dialog" aria-modal="true"><div class="scheduler-head"><div><h3 id="schedulerTitle">Nova turma</h3><p id="schedulerSubtitle">Data, horário, vagas e status da turma.</p></div><button class="btn small" id="schedulerClose" type="button">Fechar</button></div><div id="schedulerFeedback" class="scheduler-feedback"></div><form id="schedulerForm"><div class="scheduler-grid"><div class="scheduler-field"><label>Data</label><input id="schedulerDate" type="date" required></div><div class="scheduler-field"><label>Horário</label><input id="schedulerTime" type="time" value="10:00" required></div><div class="scheduler-field"><label>Participantes/vagas</label><input id="schedulerCapacity" type="number" min="1" max="99" value="20" required></div><div class="scheduler-field"><label>Status</label><select id="schedulerStatus"><option value="true">Aberta para inscrição</option><option value="false">Inscrições fechadas</option></select></div></div><div class="scheduler-actions"><button class="btn dark" id="schedulerSubmit" type="submit">Salvar turma</button><button class="btn danger" id="schedulerModalCloseSlot" type="button" style="display:none">Fechar inscrições</button><button class="btn" type="button" id="schedulerCancel">Cancelar</button></div></form></div>`;
    document.body.appendChild(modal);
    $('schedulerClose').onclick = closeModal; $('schedulerCancel').onclick = closeModal;
    $('schedulerModalCloseSlot').onclick = () => editingSlot && closeSlot(editingSlot);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    $('schedulerForm').addEventListener('submit', saveSlot);
  }
  function openCreateModal() {
    editingSlot = null;
    $('schedulerTitle').textContent = 'Nova turma';
    $('schedulerSubtitle').textContent = 'Crie a turma no dia filtrado ou em outro dia útil.';
    $('schedulerDate').value = $('schedulerDayInput')?.value || todayISO();
    $('schedulerTime').value = '10:00'; $('schedulerCapacity').value = '20'; $('schedulerStatus').value = 'true';
    $('schedulerSubmit').textContent = 'Salvar turma'; $('schedulerModalCloseSlot').style.display = 'none'; showModalFeedback('', ''); $('schedulerModal').classList.add('show');
  }
  function openEditModal(slot) {
    editingSlot = slot;
    $('schedulerTitle').textContent = 'Editar turma';
    $('schedulerSubtitle').textContent = `${isoToBR(slot.date)} • ${slot.time} — ${slot.booked}/${slot.capacity} inscritos`;
    $('schedulerDate').value = slot.date; $('schedulerTime').value = slot.time; $('schedulerCapacity').value = slot.capacity; $('schedulerStatus').value = slot.blocked ? 'false' : 'true';
    $('schedulerSubmit').textContent = 'Salvar alterações'; $('schedulerModalCloseSlot').style.display = slot.blocked ? 'none' : 'inline-flex'; showModalFeedback('', ''); $('schedulerModal').classList.add('show');
  }
  function closeModal() { $('schedulerModal')?.classList.remove('show'); }

  async function saveSlot(event) {
    event.preventDefault();
    const date = $('schedulerDate').value, time = $('schedulerTime').value, capacity = Number($('schedulerCapacity').value || 0), open = $('schedulerStatus').value === 'true';
    if (!isWeekday(date)) return showModalFeedback('error','Escolha uma data de segunda a sexta-feira.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return showModalFeedback('error','Informe um horário válido.');
    if (!capacity || capacity < 1 || capacity > 99) return showModalFeedback('error','Informe vagas entre 1 e 99.');
    if (editingSlot && capacity < editingSlot.booked) return showModalFeedback('error',`Não é possível reduzir para ${capacity}. Já existem ${editingSlot.booked} inscritos ativos.`);
    const submit = $('schedulerSubmit'); submit.disabled = true; submit.textContent = 'Salvando...';
    try {
      if (editingSlot) await rpc('training_admin_update_slot', { p_session_token:getToken(), p_slot_id:editingSlot.id, p_slot_date:date, p_slot_time:time, p_capacity:capacity, p_is_open:open });
      else await rpc('training_admin_create_custom_slot', { p_session_token:getToken(), p_slot_date:date, p_slot_time:time, p_capacity:capacity, p_is_open:open });
      if ($('schedulerDayInput')) $('schedulerDayInput').value = date;
      showModalFeedback('success','Turma salva. Atualizando...');
      await navigateToDate(date); setTimeout(closeModal, 500);
    } catch(e) { showModalFeedback('error', e.message || 'Não foi possível salvar.'); }
    finally { submit.disabled = false; submit.textContent = editingSlot ? 'Salvar alterações' : 'Salvar turma'; }
  }

  async function closeSlot(slot) { try { await rpc('training_admin_close_slot', { p_session_token:getToken(), p_slot_id:slot.id }); showAgendaFeedback('success','Inscrições fechadas.'); await refreshAndFilter(); closeModal(); } catch(e){ showAgendaFeedback('error',e.message||'Não foi possível fechar.'); } }
  async function openSlot(slot) { try { await rpc('training_admin_open_slot', { p_session_token:getToken(), p_slot_id:slot.id }); showAgendaFeedback('success','Inscrições reabertas.'); await refreshAndFilter(); } catch(e){ showAgendaFeedback('error',e.message||'Não foi possível reabrir.'); } }
  async function toggleRegistration(slot) { if (slot.blocked) { if (confirm('Reabrir inscrições desta turma?')) await openSlot(slot); } else { if (confirm('Fechar inscrições desta turma? Ela deixará de aparecer para novos cadastros.')) await closeSlot(slot); } }

  function enhanceSlotCards() {
    qsa('#agenda-grid .slot-card').forEach(card => {
      if (card.dataset.schedulerEnhanced === 'true') return;
      const slot = slotFromCard(card);
      if (!slot?.id) return;
      card.dataset.schedulerEnhanced = 'true';
      const oldToggle = qs('[data-slot-toggle]', card); if (oldToggle) oldToggle.classList.add('scheduler-hide-old-toggle');
      const actions = document.createElement('div'); actions.className = 'scheduler-slot-actions';
      actions.innerHTML = `<button class="btn small" type="button" data-scheduler-edit>Editar</button><button class="btn small ${slot.blocked?'success':'danger'}" type="button" data-scheduler-close>${slot.blocked?'Reabrir':'Fechar inscrições'}</button>`;
      const metrics = qs('.slot-metrics', card); if (metrics?.parentNode) metrics.parentNode.insertBefore(actions, metrics.nextSibling); else card.appendChild(actions);
      qs('[data-scheduler-edit]', actions).onclick = () => openEditModal(slotFromCard(card) || slot);
      qs('[data-scheduler-close]', actions).onclick = () => toggleRegistration(slotFromCard(card) || slot);
    });
  }

  function applyDateFilter() {
    const selected = $('schedulerDayInput')?.value || todayISO();
    let visible = 0;
    qsa('#agenda-grid .slot-card').forEach(card => { const same = slotDateFromCard(card) === selected; card.style.display = same ? '' : 'none'; if (same) visible++; });
    $('agenda-horizon') && ($('agenda-horizon').textContent = 'Turmas de ' + isoToBR(selected));
    let empty = $('schedulerDateEmpty');
    if (!empty) { empty = document.createElement('div'); empty.id = 'schedulerDateEmpty'; empty.className = 'scheduler-date-empty'; $('agenda-grid')?.after(empty); }
    empty.style.display = visible ? 'none' : 'block';
    empty.textContent = `Nenhuma turma em ${isoToBR(selected)}. Use “+ Nova turma” para criar.`;
  }

  async function navigateToDate(iso) {
    if (!iso) return;
    const target = localDate(iso);
    if (!target) return;
    for (let i=0; i<70; i++) {
      const range = parseWeekRange();
      if (!range) break;
      if (target < range.start) $('prev-week')?.click();
      else if (target > range.end) $('extend-week')?.click();
      else break;
      await sleep(220);
    }
    await sleep(400); enhanceSlotCards(); applyDateFilter();
  }
  async function refreshAndFilter() { $('refresh-agenda')?.click(); await sleep(650); enhanceSlotCards(); applyDateFilter(); }
  function startObserver() { if (observerStarted) return; const grid = $('agenda-grid'); if (!grid) return; observerStarted = true; new MutationObserver(() => setTimeout(() => { enhanceSlotCards(); applyDateFilter(); }, 80)).observe(grid,{childList:true,subtree:true}); }

  function start() {
    injectStyles(); injectModal(); injectDateFilter(); injectPlusButton(); enhanceSlotCards(); startObserver(); setTimeout(() => navigateToDate($('schedulerDayInput')?.value || todayISO()), 700);
    if ((!$('agenda-grid') || !$('schedulerDayInput')) && attempts < 12) { attempts++; setTimeout(start, 500); }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
