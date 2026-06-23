
(function () {
  const cfg = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const tokenKey = 'jorlan_admin_session_token';
  const profileKey = 'jorlan_admin_profile';
  const supabaseLib = window.supabase;
  if (!supabaseLib || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    console.error('Supabase não configurado.');
    return;
  }
  const sb = supabaseLib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const state = {
    sessionToken: localStorage.getItem(tokenKey) || '',
    users: [],
    filtered: [],
    currentAdmin: null,
  };

  const els = {
    badge: document.getElementById('current-admin-badge'),
    logout: document.getElementById('logout-button'),
    search: document.getElementById('user-search'),
    filterStatus: document.getElementById('user-filter-status'),
    filterTier: document.getElementById('user-filter-tier'),
    tableBody: document.getElementById('users-table-body'),
    tableFeedback: document.getElementById('table-feedback'),
    statTotal: document.getElementById('stat-total'),
    statActive: document.getElementById('stat-active'),
    statPremium: document.getElementById('stat-premium'),
    statInactive: document.getElementById('stat-inactive'),
    createForm: document.getElementById('create-user-form'),
    createFeedback: document.getElementById('create-feedback'),
    modal: document.getElementById('edit-user-modal'),
    closeModal: document.getElementById('close-edit-modal'),
    editForm: document.getElementById('edit-user-form'),
    editFeedback: document.getElementById('edit-feedback'),
    editUserId: document.getElementById('edit-user-id'),
    editDisplayName: document.getElementById('edit-display-name'),
    editEmail: document.getElementById('edit-email'),
    editRole: document.getElementById('edit-role'),
    editTier: document.getElementById('edit-tier'),
    editActive: document.getElementById('edit-active'),
  };

  function showFeedback(target, type, message) {
    if (!target) return;
    target.className = 'feedback show ' + type;
    target.textContent = message;
  }
  function clearFeedback(target) {
    if (!target) return;
    target.className = 'feedback';
    target.textContent = '';
  }
  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function rpc(name, payload) {
    const { data, error } = await sb.rpc(name, payload);
    if (error) throw error;
    return data;
  }

  async function bootstrap() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (!state.sessionToken && params.get('username') && params.get('password')) {
        await login(params.get('username'), params.get('password'));
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      if (!state.sessionToken) {
        window.location.href = 'index.html';
        return;
      }
      await loadCurrentAdmin();
      await loadUsers();
      bindEvents();
    } catch (error) {
      console.error(error);
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(profileKey);
      alert('Sessão administrativa inválida. Faça login novamente.');
      window.location.href = 'index.html';
    }
  }

  async function login(username, password) {
    const data = await rpc('training_admin_login', { p_username: username, p_password: password });
    const payload = Array.isArray(data) ? data[0] : data;
    if (!payload || !payload.session_token) throw new Error('Login inválido.');
    state.sessionToken = payload.session_token;
    localStorage.setItem(tokenKey, state.sessionToken);
    localStorage.setItem(profileKey, JSON.stringify(payload));
    state.currentAdmin = payload;
  }

  async function loadCurrentAdmin() {
    try {
      const data = await rpc('training_admin_session_profile', { p_session_token: state.sessionToken });
      const payload = Array.isArray(data) ? data[0] : data;
      state.currentAdmin = payload || JSON.parse(localStorage.getItem(profileKey) || 'null');
    } catch (_) {
      state.currentAdmin = JSON.parse(localStorage.getItem(profileKey) || 'null');
    }
    const adminName = state.currentAdmin?.display_name || state.currentAdmin?.admin_display_name || state.currentAdmin?.username || 'Administrador';
    const role = state.currentAdmin?.role || state.currentAdmin?.admin_role || 'Administrador';
    els.badge.textContent = adminName + ' • ' + role;
  }

  async function loadUsers() {
    clearFeedback(els.tableFeedback);
    try {
      const data = await rpc('training_admin_list_users', { p_session_token: state.sessionToken });
      state.users = Array.isArray(data) ? data : [];
      applyFilters();
      updateStats();
    } catch (error) {
      console.error(error);
      showFeedback(els.tableFeedback, 'error', error.message || 'Não foi possível carregar os usuários.');
      els.tableBody.innerHTML = '<tr><td colspan="6" class="empty">Não foi possível carregar os usuários.</td></tr>';
    }
  }

  function updateStats() {
    const total = state.users.length;
    const active = state.users.filter(u => !!u.is_active).length;
    const premium = state.users.filter(u => String(u.account_tier || 'standard').toLowerCase() === 'premium').length;
    const inactive = total - active;
    els.statTotal.textContent = String(total);
    els.statActive.textContent = String(active);
    els.statPremium.textContent = String(premium);
    els.statInactive.textContent = String(inactive);
  }

  function applyFilters() {
    const term = (els.search.value || '').trim().toLowerCase();
    const status = els.filterStatus.value;
    const tier = els.filterTier.value;
    state.filtered = state.users.filter(user => {
      const haystack = [user.username, user.display_name, user.email, user.role].join(' ').toLowerCase();
      if (term && !haystack.includes(term)) return false;
      if (status === 'active' && !user.is_active) return false;
      if (status === 'inactive' && user.is_active) return false;
      if (tier !== 'all' && String(user.account_tier || 'standard').toLowerCase() !== tier) return false;
      return true;
    });
    renderUsers();
  }

  function renderUsers() {
    if (!state.filtered.length) {
      els.tableBody.innerHTML = '<tr><td colspan="6" class="empty">Nenhum usuário encontrado.</td></tr>';
      return;
    }
    els.tableBody.innerHTML = state.filtered.map(user => {
      const isPremium = String(user.account_tier || 'standard').toLowerCase() === 'premium';
      return `
        <tr>
          <td>
            <strong>${escapeHtml(user.display_name || user.username || '')}</strong><br>
            <span style="color:#6e727a">@${escapeHtml(user.username || '')}</span>
          </td>
          <td>
            <div>${escapeHtml(user.email || '-')}</div>
            <div style="color:#6e727a;margin-top:4px;">ID: ${escapeHtml(user.id || '-')}</div>
          </td>
          <td>${escapeHtml(user.role || 'Administrador')}</td>
          <td><span class="pill-status ${user.is_active ? 'active' : 'inactive'}">${user.is_active ? 'Ativo' : 'Desativado'}</span></td>
          <td><span class="pill-status ${isPremium ? 'premium' : 'active'}">${isPremium ? 'Premium' : 'Padrão'}</span></td>
          <td>
            <div class="user-actions">
              <button class="btn small" type="button" data-action="edit" data-id="${escapeHtml(user.id)}">Editar</button>
              <button class="btn small premium" type="button" data-action="premium" data-id="${escapeHtml(user.id)}">${isPremium ? 'Tirar premium' : 'Premium'}</button>
              <button class="btn small" type="button" data-action="toggle" data-id="${escapeHtml(user.id)}">${user.is_active ? 'Desativar' : 'Ativar'}</button>
              <button class="btn small danger" type="button" data-action="delete" data-id="${escapeHtml(user.id)}">Excluir</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  function findUser(userId) {
    return state.users.find(user => String(user.id) === String(userId));
  }

  async function updateUser(userId, payload, successMessage) {
    try {
      clearFeedback(els.tableFeedback);
      await rpc('training_admin_update_user', { p_session_token: state.sessionToken, p_user_id: userId, ...payload });
      showFeedback(els.tableFeedback, 'success', successMessage);
      await loadUsers();
    } catch (error) {
      console.error(error);
      showFeedback(els.tableFeedback, 'error', error.message || 'Não foi possível atualizar o usuário.');
    }
  }

  async function deleteUser(userId) {
    try {
      clearFeedback(els.tableFeedback);
      await rpc('training_admin_delete_user', { p_session_token: state.sessionToken, p_user_id: userId });
      showFeedback(els.tableFeedback, 'success', 'Usuário excluído com sucesso.');
      await loadUsers();
    } catch (error) {
      console.error(error);
      showFeedback(els.tableFeedback, 'error', error.message || 'Não foi possível excluir o usuário.');
    }
  }

  function openEditModal(user) {
    els.editUserId.value = user.id || '';
    els.editDisplayName.value = user.display_name || '';
    els.editEmail.value = user.email || '';
    els.editRole.value = user.role || 'Administrador';
    els.editTier.value = String(user.account_tier || 'standard').toLowerCase();
    els.editActive.value = user.is_active ? 'true' : 'false';
    clearFeedback(els.editFeedback);
    els.modal.classList.add('show');
  }
  function closeEditModal() {
    els.modal.classList.remove('show');
  }

  async function createUser(event) {
    event.preventDefault();
    clearFeedback(els.createFeedback);
    const payload = {
      p_session_token: state.sessionToken,
      p_username: document.getElementById('create-username').value.trim(),
      p_display_name: document.getElementById('create-display-name').value.trim(),
      p_email: document.getElementById('create-email').value.trim(),
      p_role: document.getElementById('create-role').value,
      p_account_tier: document.getElementById('create-tier').value,
      p_password: document.getElementById('create-password').value.trim(),
    };
    if (!payload.p_username || !payload.p_display_name || !payload.p_password) {
      showFeedback(els.createFeedback, 'error', 'Preencha usuário, nome e senha.');
      return;
    }
    try {
      await rpc('training_admin_create_user', payload);
      showFeedback(els.createFeedback, 'success', 'Usuário criado com sucesso.');
      els.createForm.reset();
      await loadUsers();
    } catch (error) {
      console.error(error);
      showFeedback(els.createFeedback, 'error', error.message || 'Não foi possível criar o usuário.');
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    clearFeedback(els.editFeedback);
    const userId = els.editUserId.value;
    try {
      await rpc('training_admin_update_user', {
        p_session_token: state.sessionToken,
        p_user_id: userId,
        p_display_name: els.editDisplayName.value.trim(),
        p_email: els.editEmail.value.trim(),
        p_role: els.editRole.value,
        p_account_tier: els.editTier.value,
        p_is_active: els.editActive.value === 'true'
      });
      showFeedback(els.editFeedback, 'success', 'Usuário atualizado com sucesso.');
      await loadUsers();
      setTimeout(closeEditModal, 700);
    } catch (error) {
      console.error(error);
      showFeedback(els.editFeedback, 'error', error.message || 'Não foi possível salvar as alterações.');
    }
  }

  function bindEvents() {
    els.search.addEventListener('input', applyFilters);
    els.filterStatus.addEventListener('change', applyFilters);
    els.filterTier.addEventListener('change', applyFilters);
    els.logout.addEventListener('click', function () {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(profileKey);
      window.location.href = 'index.html';
    });
    els.createForm.addEventListener('submit', createUser);
    els.closeModal.addEventListener('click', closeEditModal);
    els.modal.addEventListener('click', function (event) {
      if (event.target === els.modal) closeEditModal();
    });
    els.editForm.addEventListener('submit', saveEdit);

    els.tableBody.addEventListener('click', async function (event) {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const action = button.dataset.action;
      const userId = button.dataset.id;
      const user = findUser(userId);
      if (!user) return;
      if (action === 'edit') {
        openEditModal(user);
        return;
      }
      if (action === 'premium') {
        const nextTier = String(user.account_tier || 'standard').toLowerCase() === 'premium' ? 'standard' : 'premium';
        await updateUser(userId, { p_account_tier: nextTier }, nextTier === 'premium' ? 'Usuário promovido para premium.' : 'Usuário voltou para o plano padrão.');
        return;
      }
      if (action === 'toggle') {
        await updateUser(userId, { p_is_active: !user.is_active }, !user.is_active ? 'Usuário ativado com sucesso.' : 'Usuário desativado com sucesso.');
        return;
      }
      if (action === 'delete') {
        if (!confirm(`Excluir o usuário ${user.display_name || user.username}? Essa ação não pode ser desfeita.`)) return;
        await deleteUser(userId);
      }
    });
  }

  bootstrap();
})();
