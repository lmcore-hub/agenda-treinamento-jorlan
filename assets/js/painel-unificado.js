(function () {
  const cfg = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const tokenKey = 'jorlan_admin_session_token';
  const profileKey = 'jorlan_admin_profile';
  const supabaseLib = window.supabase;
  if (!supabaseLib || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    alert('Configuração do Supabase não encontrada. Verifique assets/js/config.js.');
    return;
  }
  const sb = supabaseLib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const state = { sessionToken: localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey) || '', currentAdmin: null, users: [], filteredUsers: [], agenda: null, slots: [] };
  const $ = (id) => document.getElementById(id);
  const els = {
    badge: $('current-admin-badge'), logout: $('logout-button'),
    agendaGrid: $('agenda-grid'), agendaFeedback: $('agenda-feedback'), agendaWarning: $('agenda-warning'), agendaHorizon: $('agenda-horizon'),
    agendaOpen: $('agenda-open'), agendaBlocked: $('agenda-blocked'), agendaBooked: $('agenda-booked'), agendaAvailable: $('agenda-available'),
    refreshAgenda: $('refresh-agenda'), extendWeek: $('extend-week'), exportCsv: $('export-csv'),
    search: $('user-search'), filterStatus: $('user-filter-status'), filterTier: $('user-filter-tier'), tableBody: $('users-table-body'), tableFeedback: $('table-feedback'),
    statTotal: $('stat-total'), statActive: $('stat-active'), statPremium: $('stat-premium'), statInactive: $('stat-inactive'),
    createForm: $('create-user-form'), createFeedback: $('create-feedback'), modal: $('edit-user-modal'), closeModal: $('close-edit-modal'), editForm: $('edit-user-form'), editFeedback: $('edit-feedback'),
    editUserId: $('edit-user-id'), editDisplayName: $('edit-display-name'), editEmail: $('edit-email'), editRole: $('edit-role'), editTier: $('edit-tier'), editActive: $('edit-active')
  };
  function escapeHtml(text) { return String(text ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }
  function feedback(el, type, msg) { if (!el) return; el.className = 'feedback show ' + type; el.textContent = msg; }
  function clearFeedback(el) { if (!el) return; el.className = 'feedback'; el.textContent = ''; }
  function warn(msg) { if (!els.agendaWarning) return; els.agendaWarning.className = msg ? 'notice show' : 'notice'; els.agendaWarning.textContent = msg || ''; }
  async function rpc(name, payload) { const { data, error } = await sb.rpc(name, payload); if (error) throw error; return data; }
  async function rpcTry(names, payload) {
    let last;
    for (const name of names) { try { return await rpc(name, payload); } catch (e) { last = e; if (!String(e.message || '').includes('function')) throw e; } }
    throw last || new Error('Função não encontrada.');
  }
  function parseData(data) { if (typeof data === 'string') { try { return JSON.parse(data); } catch (_) { return data; } } return data; }
  function normDate(d) { if (!d) return ''; return String(d).slice(0,10); }
  function fmtDate(d) { if (!d) return '-'; const [y,m,day]=normDate(d).split('-'); return day && m && y ? `${day}/${m}/${y}` : String(d); }
  function normTime(t) { if (!t) return ''; return String(t).slice(0,5); }
  function bookingsOf(slot) { return slot.bookings || slot.participants || slot.inscritos || slot.registrations || []; }
  function bookingName(b) { return b.name || b.participant_name || b.nome || b.full_name || b.nome_completo || '-'; }
  function bookingRole(b) { return b.role || b.participant_role || b.cargo || '-'; }
  function bookingStore(b) { return b.store || b.loja || b.participant_store || '-'; }
  function bookingCity(b) { return b.city || b.praca || b.cidade || '-'; }
  function bookingEmail(b) { return b.email || b.participant_email || ''; }
  function bookingPhone(b) { return b.phone || b.telefone || b.cellphone || b.participant_phone || ''; }
  function normalizeSlot(s) {
    const bookings = bookingsOf(s);
    const capacity = Number(s.capacity ?? s.max_capacity ?? s.vagas ?? s.total_vagas ?? 8);
    const booked = Number(s.booked ?? s.booked_count ?? s.inscritos ?? bookings.length ?? 0);
    const available = Number(s.available ?? s.available_count ?? s.vagas_disponiveis ?? Math.max(0, capacity - booked));
    return { raw:s, id:s.id || s.slot_id, date:normDate(s.date || s.slot_date || s.slotDate), time:normTime(s.time || s.slot_time || s.slotTime), blocked:Boolean(s.blocked ?? s.is_blocked ?? s.locked ?? false), capacity, booked, available, bookings };
  }
  async function bootstrap() {
    const params = new URLSearchParams(location.search);
    if (!state.sessionToken && params.get('username') && params.get('password')) {
      const data = await rpc('training_admin_login', { p_username: params.get('username'), p_password: params.get('password') });
      const payload = Array.isArray(data) ? data[0] : data;
      if (payload && payload.session_token) {
        state.sessionToken = payload.session_token;
        localStorage.setItem(tokenKey, state.sessionToken);
        localStorage.setItem(profileKey, JSON.stringify(payload));
        history.replaceState({}, document.title, location.pathname);
      }
    }
    if (!state.sessionToken) { location.href = 'index.html'; return; }
    bindEvents();
    await loadProfile();
    await Promise.allSettled([loadAgenda(), loadUsers()]);
  }
  async function loadProfile() {
    try {
      const data = await rpc('training_admin_session_profile', { p_session_token: state.sessionToken });
      state.currentAdmin = Array.isArray(data) ? data[0] : data;
    } catch (_) { try { state.currentAdmin = JSON.parse(localStorage.getItem(profileKey)||'null'); } catch(e){} }
    const name = state.currentAdmin?.display_name || state.currentAdmin?.admin_display_name || state.currentAdmin?.username || 'Administrador';
    const role = state.currentAdmin?.role || state.currentAdmin?.admin_role || 'Administrador';
    els.badge.textContent = name + ' • ' + role;
  }
  async function loadAgenda() {
    clearFeedback(els.agendaFeedback); warn('');
    els.agendaGrid.innerHTML = '<div class="card empty">Carregando agenda...</div>';
    try {
      const data = parseData(await rpc('training_admin_get_state', { p_session_token: state.sessionToken }));
      state.agenda = data || {};
      state.slots = (data.slots || data.agenda || data.turmas || []).map(normalizeSlot).sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
      renderAgenda();
    } catch (e) {
      console.error(e);
      feedback(els.agendaFeedback, 'error', e.message || 'Não foi possível carregar a agenda.');
      warn('Se a mensagem mencionar sessão ou função inexistente, rode o SQL de compatibilidade do pacote.');
      els.agendaGrid.innerHTML = '<div class="card empty">Agenda não carregada. Verifique se as funções antigas da agenda ainda existem no Supabase.</div>';
    }
  }
  function renderAgenda() {
    const slots = state.slots;
    const open = slots.filter(s => !s.blocked).length;
    const blocked = slots.filter(s => s.blocked).length;
    const booked = slots.reduce((sum,s)=>sum+s.booked,0);
    const available = slots.reduce((sum,s)=>sum+s.available,0);
    els.agendaOpen.textContent = open; els.agendaBlocked.textContent = blocked; els.agendaBooked.textContent = booked; els.agendaAvailable.textContent = available;
    const horizon = state.agenda?.horizonDate || state.agenda?.horizon_date || state.agenda?.horizon || '';
    els.agendaHorizon.textContent = horizon ? 'Agenda até ' + fmtDate(horizon) : 'Agenda carregada';
    if (!slots.length) { els.agendaGrid.innerHTML = '<div class="card empty">Nenhuma turma encontrada.</div>'; return; }
    els.agendaGrid.innerHTML = slots.map(s => `
      <article class="card slot-card">
        <div class="slot-top"><div><div class="slot-title">${fmtDate(s.date)} • ${escapeHtml(s.time)}</div><div class="slot-sub">${s.booked}/${s.capacity} inscritos • ${s.available} vagas</div></div><span class="pill-status ${s.blocked?'inactive':'active'}">${s.blocked?'Bloqueada':'Aberta'}</span></div>
        <div class="slot-metrics"><div class="mini"><strong>${s.capacity}</strong><span>capacidade</span></div><div class="mini"><strong>${s.booked}</strong><span>inscritos</span></div><div class="mini"><strong>${s.available}</strong><span>vagas</span></div></div>
        <button class="btn small ${s.blocked?'success':'danger'}" type="button" data-slot-toggle="${escapeHtml(s.id)}" data-blocked="${s.blocked?'true':'false'}">${s.blocked?'Habilitar turma':'Desabilitar turma'}</button>
        <div class="participant-list">${s.bookings.length ? s.bookings.map(b=>`<div class="participant"><div><strong>${escapeHtml(bookingName(b))}</strong><small>${escapeHtml(bookingRole(b))} • ${escapeHtml(bookingStore(b))} • ${escapeHtml(bookingCity(b))}</small></div><small>${escapeHtml([bookingEmail(b),bookingPhone(b)].filter(Boolean).join(' • '))}</small></div>`).join('') : '<div class="empty" style="padding:10px 0">Sem inscritos nesta turma.</div>'}</div>
      </article>`).join('');
  }
  async function toggleSlot(id, currentBlocked) {
    const next = !currentBlocked;
    try {
      await rpcTry(['training_admin_set_slot_blocked','training_admin_toggle_slot','training_admin_block_slot'], { p_session_token: state.sessionToken, p_slot_id: id, p_blocked: next });
      feedback(els.agendaFeedback, 'success', next ? 'Turma desabilitada.' : 'Turma habilitada.');
      await loadAgenda();
    } catch (e) { feedback(els.agendaFeedback, 'error', e.message || 'Não foi possível alterar a turma.'); }
  }
  async function extendWeek() {
    try { await rpc('training_admin_extend_week', { p_session_token: state.sessionToken }); feedback(els.agendaFeedback, 'success', 'Agenda ampliada.'); await loadAgenda(); }
    catch(e){ feedback(els.agendaFeedback, 'error', e.message || 'Não foi possível ampliar a agenda.'); }
  }
  function exportCsv() {
    const rows = [['Data','Hora','Status','Capacidade','Inscritos','Vagas','Nome','Cargo','Loja','Praça','Email','Telefone']];
    state.slots.forEach(s => {
      if (!s.bookings.length) rows.push([fmtDate(s.date),s.time,s.blocked?'Bloqueada':'Aberta',s.capacity,s.booked,s.available,'','','','','','']);
      s.bookings.forEach(b => rows.push([fmtDate(s.date),s.time,s.blocked?'Bloqueada':'Aberta',s.capacity,s.booked,s.available,bookingName(b),bookingRole(b),bookingStore(b),bookingCity(b),bookingEmail(b),bookingPhone(b)]));
    });
    const csv = rows.map(r => r.map(v => '"'+String(v??'').replace(/"/g,'""')+'"').join(';')).join('\n');
    const blob = new Blob(['\ufeff'+csv], { type:'text/csv;charset=utf-8;' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'agenda_treinamento.csv'; a.click(); URL.revokeObjectURL(a.href);
  }
  async function loadUsers() {
    clearFeedback(els.tableFeedback);
    try { state.users = parseData(await rpc('training_admin_list_users', { p_session_token: state.sessionToken })) || []; applyUserFilters(); updateUserStats(); }
    catch(e){ feedback(els.tableFeedback,'error',e.message||'Não foi possível carregar usuários.'); els.tableBody.innerHTML='<tr><td colspan="6" class="empty">Não foi possível carregar usuários.</td></tr>'; }
  }
  function updateUserStats(){ const t=state.users.length,a=state.users.filter(u=>!!u.is_active).length,p=state.users.filter(u=>String(u.account_tier||'standard').toLowerCase()==='premium').length; els.statTotal.textContent=t; els.statActive.textContent=a; els.statPremium.textContent=p; els.statInactive.textContent=t-a; }
  function applyUserFilters(){ const term=(els.search.value||'').toLowerCase(), st=els.filterStatus.value, tier=els.filterTier.value; state.filteredUsers=state.users.filter(u=>{ const h=[u.username,u.display_name,u.email,u.role].join(' ').toLowerCase(); if(term&&!h.includes(term))return false; if(st==='active'&&!u.is_active)return false; if(st==='inactive'&&u.is_active)return false; if(tier!=='all'&&String(u.account_tier||'standard').toLowerCase()!==tier)return false; return true; }); renderUsers(); }
  function renderUsers(){ if(!state.filteredUsers.length){els.tableBody.innerHTML='<tr><td colspan="6" class="empty">Nenhum usuário encontrado.</td></tr>';return;} els.tableBody.innerHTML=state.filteredUsers.map(u=>{const prem=String(u.account_tier||'standard').toLowerCase()==='premium';return `<tr><td><strong>${escapeHtml(u.display_name||u.username)}</strong><br><span style="color:#6e727a">@${escapeHtml(u.username)}</span></td><td>${escapeHtml(u.email||'-')}</td><td>${escapeHtml(u.role||'Administrador')}</td><td><span class="pill-status ${u.is_active?'active':'inactive'}">${u.is_active?'Ativo':'Desativado'}</span></td><td><span class="pill-status ${prem?'premium':'active'}">${prem?'Premium':'Padrão'}</span></td><td><div class="user-actions"><button class="btn small" data-user-action="edit" data-id="${escapeHtml(u.id)}">Editar</button><button class="btn small premium" data-user-action="premium" data-id="${escapeHtml(u.id)}">${prem?'Tirar premium':'Premium'}</button><button class="btn small" data-user-action="toggle" data-id="${escapeHtml(u.id)}">${u.is_active?'Desativar':'Ativar'}</button><button class="btn small danger" data-user-action="delete" data-id="${escapeHtml(u.id)}">Excluir</button></div></td></tr>`}).join(''); }
  function findUser(id){ return state.users.find(u=>String(u.id)===String(id)); }
  async function updateUser(id,payload,msg){ try{ await rpc('training_admin_update_user',{p_session_token:state.sessionToken,p_user_id:id,...payload}); feedback(els.tableFeedback,'success',msg); await loadUsers(); } catch(e){ feedback(els.tableFeedback,'error',e.message||'Erro ao atualizar usuário.'); } }
  function openEdit(u){ els.editUserId.value=u.id; els.editDisplayName.value=u.display_name||''; els.editEmail.value=u.email||''; els.editRole.value=u.role||'Administrador'; els.editTier.value=String(u.account_tier||'standard').toLowerCase(); els.editActive.value=u.is_active?'true':'false'; clearFeedback(els.editFeedback); els.modal.classList.add('show'); }
  function closeEdit(){ els.modal.classList.remove('show'); }
  async function createUser(e){ e.preventDefault(); const payload={p_session_token:state.sessionToken,p_username:$('create-username').value.trim(),p_display_name:$('create-display-name').value.trim(),p_email:$('create-email').value.trim(),p_role:$('create-role').value,p_account_tier:$('create-tier').value,p_password:$('create-password').value.trim()}; try{ await rpc('training_admin_create_user',payload); feedback(els.createFeedback,'success','Usuário criado.'); els.createForm.reset(); await loadUsers(); }catch(err){ feedback(els.createFeedback,'error',err.message||'Erro ao criar usuário.'); } }
  async function saveEdit(e){ e.preventDefault(); try{ await rpc('training_admin_update_user',{p_session_token:state.sessionToken,p_user_id:els.editUserId.value,p_display_name:els.editDisplayName.value.trim(),p_email:els.editEmail.value.trim(),p_role:els.editRole.value,p_account_tier:els.editTier.value,p_is_active:els.editActive.value==='true'}); feedback(els.editFeedback,'success','Usuário salvo.'); await loadUsers(); setTimeout(closeEdit,600); }catch(err){ feedback(els.editFeedback,'error',err.message||'Erro ao salvar.'); } }
  async function deleteUser(id){ try{ await rpc('training_admin_delete_user',{p_session_token:state.sessionToken,p_user_id:id}); feedback(els.tableFeedback,'success','Usuário excluído.'); await loadUsers(); }catch(e){ feedback(els.tableFeedback,'error',e.message||'Erro ao excluir usuário.'); } }
  function bindEvents(){
    document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(b=>b.classList.remove('active'));document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));btn.classList.add('active');$('panel-'+btn.dataset.tab).classList.add('active');}));
    els.logout.addEventListener('click',()=>{localStorage.removeItem(tokenKey);sessionStorage.removeItem(tokenKey);localStorage.removeItem(profileKey);location.href='index.html';});
    els.refreshAgenda.addEventListener('click',loadAgenda); els.extendWeek.addEventListener('click',extendWeek); els.exportCsv.addEventListener('click',exportCsv);
    els.agendaGrid.addEventListener('click',e=>{const b=e.target.closest('button[data-slot-toggle]'); if(b) toggleSlot(b.dataset.slotToggle,b.dataset.blocked==='true');});
    els.search.addEventListener('input',applyUserFilters); els.filterStatus.addEventListener('change',applyUserFilters); els.filterTier.addEventListener('change',applyUserFilters);
    els.createForm.addEventListener('submit',createUser); els.closeModal.addEventListener('click',closeEdit); els.modal.addEventListener('click',e=>{if(e.target===els.modal)closeEdit();}); els.editForm.addEventListener('submit',saveEdit);
    els.tableBody.addEventListener('click',async e=>{const b=e.target.closest('button[data-user-action]'); if(!b)return; const u=findUser(b.dataset.id); if(!u)return; if(b.dataset.userAction==='edit')return openEdit(u); if(b.dataset.userAction==='premium')return updateUser(u.id,{p_account_tier:String(u.account_tier||'standard').toLowerCase()==='premium'?'standard':'premium'},'Plano atualizado.'); if(b.dataset.userAction==='toggle')return updateUser(u.id,{p_is_active:!u.is_active},'Status atualizado.'); if(b.dataset.userAction==='delete'){if(confirm('Excluir este usuário?')) await deleteUser(u.id);}});
  }
  bootstrap().catch(e=>{console.error(e); alert('Sessão inválida. Faça login novamente.'); location.href='index.html';});
})();
