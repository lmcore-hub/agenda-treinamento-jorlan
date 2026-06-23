(function () {
  "use strict";

  const CONFIG = window.JORLAN_TRAINING_CONFIG || {};
  const ADMIN_TOKEN_KEY = "jorlanTrainingAdminToken";
  let supabaseClient = null;
  let adminState = null;

  function $(selector, root = document) { return root.querySelector(selector); }
  function $all(selector, root = document) { return Array.from(root.querySelectorAll(selector)); }

  function isConfigReady() {
    return CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY &&
      !CONFIG.SUPABASE_URL.includes("COLE_AQUI") &&
      !CONFIG.SUPABASE_ANON_KEY.includes("COLE_AQUI") &&
      CONFIG.SUPABASE_URL.includes(".supabase.co");
  }

  function getClient() {
    if (!isConfigReady()) return null;
    if (!supabaseClient) supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    return supabaseClient;
  }

  function showConfigError(targetId) {
    const target = document.getElementById(targetId || "appStatus");
    if (!target || isConfigReady()) return;
    target.innerHTML = '<div class="config-error"><strong>Configuração pendente.</strong><br>Abra <code>assets/js/config.js</code> e informe a Project URL e a chave pública anon/publishable do Supabase.</div>';
  }

  async function rpc(name, params) {
    const client = getClient();
    if (!client) throw new Error("Supabase não configurado.");
    const { data, error } = await client.rpc(name, params || {});
    if (error) throw new Error(error.message || "Erro na comunicação com o banco.");
    return data;
  }

  function parseLocalDate(dateStr) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function formatFullDate(dateStr) {
    return parseLocalDate(dateStr).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }

  function dateParts(dateStr) {
    const d = parseLocalDate(dateStr);
    return {
      weekday: d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
      day: d.toLocaleDateString("pt-BR", { day: "2-digit" }),
      month: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")
    };
  }

  function getAdminToken() { return sessionStorage.getItem(ADMIN_TOKEN_KEY); }
  function setAdminToken(token) { sessionStorage.setItem(ADMIN_TOKEN_KEY, token); }
  function clearAdminToken() { sessionStorage.removeItem(ADMIN_TOKEN_KEY); }

  function alertBox(id, type, message) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = `alert show ${type}`;
    el.innerHTML = message;
  }

  function clearAlert(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.className = "alert";
    el.innerHTML = "";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizePhone(value) {
    const digits = String(value || "").replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }

  function setupPhoneMasks() {
    $all('input[type="tel"]').forEach((input) => {
      input.addEventListener("input", () => { input.value = normalizePhone(input.value); });
    });
  }

  function slotStatus(slot) {
    if (slot.blocked) return '<span class="pill blocked">Bloqueada</span>';
    if (Number(slot.remaining) <= 0) return '<span class="pill full">Lotada</span>';
    return `<span class="pill ok">${slot.remaining} vaga${Number(slot.remaining) === 1 ? "" : "s"}</span>`;
  }

  async function loadPublicSlots() {
    showConfigError("appStatus");
    const container = document.getElementById("publicSlots");
    if (!container || !isConfigReady()) return;
    container.innerHTML = '<div class="loading">Carregando turmas abertas...</div>';
    try {
      const slots = await rpc("training_get_open_slots", {});
      renderPublicSlots(slots || []);
    } catch (error) {
      container.innerHTML = `<div class="empty">Não foi possível carregar a agenda. ${escapeHtml(error.message)}</div>`;
    }
  }

  function renderPublicSlots(slots) {
    const container = document.getElementById("publicSlots");
    if (!container) return;
    const available = slots.filter((slot) => !slot.blocked && Number(slot.remaining) > 0);
    if (!available.length) {
      container.innerHTML = '<div class="empty"><strong>Nenhuma turma aberta no momento.</strong><br>O administrador precisa liberar novas datas no painel administrativo.</div>';
      return;
    }
    container.innerHTML = available.map((slot) => {
      const p = dateParts(slot.slot_date);
      const href = `inscricao.html?date=${encodeURIComponent(slot.slot_date)}&time=${encodeURIComponent(slot.slot_time)}`;
      return `
        <a class="calendar-card is-clickable" href="${href}" aria-label="Selecionar turma em ${escapeHtml(formatFullDate(slot.slot_date))} às ${escapeHtml(slot.slot_time)}">
          <div class="calendar-day">
            <span class="weekday">${escapeHtml(p.weekday)}</span>
            <strong>${escapeHtml(p.day)}</strong>
            <span class="month">${escapeHtml(p.month)}</span>
          </div>
          <div class="calendar-info">
            <h3>${escapeHtml(formatFullDate(slot.slot_date))}</h3>
            <p>Treinamento ativo às <strong>${escapeHtml(slot.slot_time)}</strong><br>${slot.occupied} de ${slot.capacity} vagas preenchidas.</p>
          </div>
          ${slotStatus(slot)}
        </a>`;
    }).join("");
  }

  async function setupBookingPage() {
    showConfigError("bookingStatus");
    setupPhoneMasks();
    const params = new URLSearchParams(window.location.search);
    const slotDate = params.get("date");
    const slotTime = params.get("time");
    const form = document.getElementById("bookingForm");
    const summary = document.getElementById("selectedSlot");

    if (!slotDate || !slotTime) {
      if (summary) summary.innerHTML = '<div class="empty">Nenhuma turma foi selecionada. Volte para a agenda e escolha um horário disponível.</div>';
      if (form) form.style.display = "none";
      return;
    }

    if (summary) {
      summary.innerHTML = `<span class="kicker">Turma selecionada</span><strong>${escapeHtml(slotTime)}</strong><p class="muted">${escapeHtml(formatFullDate(slotDate))}</p>`;
    }

    if (!isConfigReady() || !form) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearAlert("bookingAlert");
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Confirmando...";
      const formData = new FormData(form);
      try {
        const result = await rpc("training_create_booking", {
          p_slot_date: slotDate,
          p_slot_time: slotTime,
          p_name: String(formData.get("name") || "").trim(),
          p_email: String(formData.get("email") || "").trim(),
          p_phone: String(formData.get("phone") || "").trim(),
          p_role: String(formData.get("role") || "").trim(),
          p_store: String(formData.get("store") || "").trim(),
          p_city: String(formData.get("city") || "").trim()
        });
        const response = Array.isArray(result) ? result[0] : result;
        if (response && response.success) {
          alertBox("bookingAlert", "success", "<strong>Inscrição confirmada.</strong><br>O participante foi incluído na turma selecionada.");
          form.reset();
        } else {
          let msg = response && response.message ? response.message : "Não foi possível confirmar a inscrição.";
          if (response && response.nearest_date && response.nearest_time) msg += `<br>Próxima turma com vaga: <strong>${escapeHtml(formatFullDate(response.nearest_date))} às ${escapeHtml(response.nearest_time)}</strong>.`;
          alertBox("bookingAlert", "warning", msg);
        }
      } catch (error) {
        alertBox("bookingAlert", "danger", `Erro ao salvar inscrição: ${escapeHtml(error.message)}`);
      } finally {
        submit.disabled = false;
        submit.textContent = "Confirmar inscrição";
      }
    });
  }

  function setupHomeLogin() {
    showConfigError("loginStatus");
    const form = document.getElementById("adminLoginForm");
    if (!form || !isConfigReady()) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearAlert("loginAlert");
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Validando...";
      const formData = new FormData(form);
      try {
        const result = await rpc("training_admin_login", {
          p_username: String(formData.get("username") || "").trim(),
          p_password: String(formData.get("password") || "")
        });
        const response = Array.isArray(result) ? result[0] : result;
        if (response && response.success && response.session_token) {
          setAdminToken(response.session_token);
          window.location.href = "painel-administrador.html";
        } else {
          alertBox("loginAlert", "danger", response && response.message ? escapeHtml(response.message) : "Usuário ou senha inválidos.");
        }
      } catch (error) {
        alertBox("loginAlert", "danger", `Erro no login: ${escapeHtml(error.message)}`);
      } finally {
        submit.disabled = false;
        submit.textContent = "Entrar no painel";
      }
    });
  }

  function setupRecoveryPage() {
    showConfigError("recoveryStatus");
    const form = document.getElementById("recoveryForm");
    if (!form || !isConfigReady()) return;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearAlert("recoveryAlert");
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      submit.textContent = "Enviando solicitação...";
      const formData = new FormData(form);
      try {
        await rpc("training_admin_request_password_reset", {
          p_username: String(formData.get("username") || "").trim(),
          p_email: String(formData.get("email") || "").trim()
        });
        alertBox("recoveryAlert", "success", "<strong>Solicitação registrada.</strong><br>Um administrador ativo deve aprovar a redefinição no painel administrativo. Se todos perderam a senha, redefina pelo SQL no Supabase.");
        form.reset();
      } catch (error) {
        alertBox("recoveryAlert", "danger", `Erro ao solicitar recuperação: ${escapeHtml(error.message)}`);
      } finally {
        submit.disabled = false;
        submit.textContent = "Solicitar recuperação";
      }
    });
  }

  async function setupAdminPanel() {
    showConfigError("adminStatus");
    if (!isConfigReady()) return;
    const token = getAdminToken();
    if (!token) { window.location.href = "index.html#administrador"; return; }
    setupAdminButtons();
    await loadAdminState();
  }

  function setupAdminButtons() {
    const refreshBtn = document.getElementById("refreshAdmin");
    if (refreshBtn) refreshBtn.addEventListener("click", loadAdminState);
    const exportBtn = document.getElementById("exportCsv");
    if (exportBtn) exportBtn.addEventListener("click", exportAdminCsv);
    const extendBtn = document.getElementById("extendWeek");
    if (extendBtn) extendBtn.addEventListener("click", extendWeek);
    const logoutBtn = document.getElementById("logoutAdmin");
    if (logoutBtn) logoutBtn.addEventListener("click", logoutAdmin);

    const createUserForm = document.getElementById("createAdminUserForm");
    if (createUserForm) createUserForm.addEventListener("submit", createAdminUser);
    const changePasswordForm = document.getElementById("changeOwnPasswordForm");
    if (changePasswordForm) changePasswordForm.addEventListener("submit", changeOwnPassword);
  }

  async function loadAdminState() {
    const container = document.getElementById("adminCalendar");
    if (container) container.innerHTML = '<div class="loading">Carregando calendário administrativo...</div>';
    try {
      adminState = await rpc("training_admin_get_state", { p_session_token: getAdminToken() });
      renderAdminState(adminState);
    } catch (error) {
      clearAdminToken();
      if (container) container.innerHTML = '<div class="empty">Sessão expirada ou inválida. Volte para a tela inicial e faça login novamente.</div>';
      alertBox("adminAlert", "danger", escapeHtml(error.message));
    }
  }

  function renderAdminState(state) {
    renderSummary(state);
    renderAdminCalendar(state);
    renderAdminUsers(state);
    renderPasswordResetRequests(state);
    renderAdminIdentity(state);
  }

  function renderAdminIdentity(state) {
    const box = document.getElementById("adminIdentity");
    if (!box || !state || !state.admin) return;
    box.innerHTML = `<span class="pill neutral">Usuário: ${escapeHtml(state.admin.username)}</span>${state.admin.isSuperAdmin ? '<span class="pill super">Super administrador</span>' : '<span class="pill neutral">Administrador</span>'}`;
  }

  function renderSummary(state) {
    const box = document.getElementById("adminSummary");
    if (!box) return;
    const slots = state && state.slots ? state.slots : [];
    const active = slots.filter((s) => !s.blocked).length;
    const blocked = slots.filter((s) => s.blocked).length;
    const occupied = slots.reduce((sum, s) => sum + Number(s.occupied || 0), 0);
    const remaining = slots.reduce((sum, s) => sum + Number(s.blocked ? 0 : s.remaining || 0), 0);
    box.innerHTML = `<div class="summary-card"><strong>${active}</strong><span>turmas abertas</span></div><div class="summary-card"><strong>${blocked}</strong><span>turmas bloqueadas</span></div><div class="summary-card"><strong>${occupied}</strong><span>participantes inscritos</span></div><div class="summary-card"><strong>${remaining}</strong><span>vagas disponíveis</span></div>`;
  }

  function groupByDate(slots) {
    return slots.reduce((acc, slot) => { acc[slot.date] = acc[slot.date] || []; acc[slot.date].push(slot); return acc; }, {});
  }

  function renderAdminCalendar(state) {
    const container = document.getElementById("adminCalendar");
    if (!container) return;
    const slots = state && state.slots ? state.slots : [];
    if (!slots.length) { container.innerHTML = '<div class="empty">Nenhuma turma na janela de agenda. Clique em “Mostrar +1 semana”.</div>'; return; }
    const grouped = groupByDate(slots);
    container.innerHTML = Object.keys(grouped).map((date) => {
      const dateSlots = grouped[date];
      const dayOpen = dateSlots.some((s) => !s.blocked);
      const dayClosed = dateSlots.every((s) => s.blocked);
      const occupied = dateSlots.reduce((sum, s) => sum + Number(s.occupied || 0), 0);
      const available = dateSlots.reduce((sum, s) => sum + Number(s.blocked ? 0 : s.remaining || 0), 0);
      const dayStatus = dayOpen ? `${available} vaga${available === 1 ? "" : "s"} liberada${available === 1 ? "" : "s"}` : "Dia bloqueado";
      return `<section class="admin-day-card ${dayClosed ? "is-closed" : "is-open"}"><div class="admin-day-head"><div><h3>${escapeHtml(formatFullDate(date))}</h3><p>Liberação manual: a data só aparece para inscrição quando estiver liberada pelo administrador.</p></div><div class="day-actions"><span class="pill ${dayOpen ? "ok" : "blocked"}">${escapeHtml(dayStatus)}</span><span class="pill neutral">${occupied} inscritos</span><button class="btn small success" data-open-day data-date="${escapeHtml(date)}">Liberar dia</button><button class="btn small warning" data-block-day data-date="${escapeHtml(date)}">Bloquear dia</button></div></div>${dateSlots.map(renderAdminSlot).join("")}</section>`;
    }).join("");
    $all("[data-toggle-slot]").forEach((btn) => btn.addEventListener("click", async () => toggleSlot(btn.dataset.date, btn.dataset.time)));
    $all("[data-open-day]").forEach((btn) => btn.addEventListener("click", async () => setDayOpen(btn.dataset.date, true)));
    $all("[data-block-day]").forEach((btn) => btn.addEventListener("click", async () => setDayOpen(btn.dataset.date, false)));
    $all("[data-delete-booking]").forEach((btn) => btn.addEventListener("click", async () => deleteBooking(btn.dataset.id)));
  }

  function renderAdminSlot(slot) {
    const bookings = slot.bookings || [];
    const actionLabel = slot.blocked ? "Liberar" : "Bloquear";
    const actionClass = slot.blocked ? "success" : "warning";
    return `<div class="slot-row"><div class="slot-time">${escapeHtml(slot.time)}</div><div class="slot-detail"><div>${slotStatus({ blocked: slot.blocked, remaining: slot.remaining })}</div><small>${slot.occupied} de ${slot.capacity} vagas preenchidas.</small><div class="participants">${bookings.length ? bookings.map(renderParticipant).join("") : '<div class="empty">Sem participantes inscritos neste horário.</div>'}</div></div><div class="toolbar"><button class="btn small ${actionClass}" data-toggle-slot data-date="${escapeHtml(slot.date)}" data-time="${escapeHtml(slot.time)}">${actionLabel}</button></div></div>`;
  }

  function renderParticipant(person) {
    return `<div class="person"><div><strong>${escapeHtml(person.name)}</strong><span>${escapeHtml(person.role)} · ${escapeHtml(person.store)} · ${escapeHtml(person.city)}</span><span>${escapeHtml(person.email)} · ${escapeHtml(person.phone)}</span></div><button class="btn small danger" data-delete-booking data-id="${escapeHtml(person.id)}">Excluir</button></div>`;
  }

  function renderAdminUsers(state) {
    const box = document.getElementById("adminUsers");
    const form = document.getElementById("createAdminUserForm");
    if (!box) return;
    const isSuper = !!(state && state.admin && state.admin.isSuperAdmin);
    if (form) form.style.display = isSuper ? "grid" : "none";
    if (!isSuper) { box.innerHTML = '<div class="empty">Gestão de usuários disponível apenas para super administradores.</div>'; return; }
    const users = state.users || [];
    if (!users.length) { box.innerHTML = '<div class="empty">Nenhum usuário administrativo encontrado.</div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Usuário</th><th>Nome/e-mail</th><th>Status</th><th>Ações</th></tr></thead><tbody>${users.map(renderAdminUserRow).join("")}</tbody></table></div>`;
    $all("[data-reset-user]").forEach((btn) => btn.addEventListener("click", async () => resetAdminUserPassword(btn.dataset.userId, btn.dataset.username)));
    $all("[data-toggle-user]").forEach((btn) => btn.addEventListener("click", async () => toggleAdminUser(btn.dataset.userId, btn.dataset.active === "true")));
  }

  function renderAdminUserRow(user) {
    const status = user.isActive ? '<span class="pill ok">Ativo</span>' : '<span class="pill inactive">Inativo</span>';
    const superTag = user.isSuperAdmin ? '<span class="pill super">Super</span>' : '<span class="pill neutral">Admin</span>';
    return `<tr><td><strong>${escapeHtml(user.username)}</strong><div class="admin-meta">${superTag}</div></td><td>${escapeHtml(user.displayName)}<br><span class="muted">${escapeHtml(user.email)}</span></td><td>${status}</td><td><div class="inline-actions"><button class="btn small ghost" data-reset-user data-user-id="${escapeHtml(user.id)}" data-username="${escapeHtml(user.username)}">Trocar senha</button><button class="btn small ${user.isActive ? "danger" : "success"}" data-toggle-user data-user-id="${escapeHtml(user.id)}" data-active="${user.isActive}">${user.isActive ? "Desativar" : "Ativar"}</button></div></td></tr>`;
  }

  function renderPasswordResetRequests(state) {
    const box = document.getElementById("passwordResetRequests");
    if (!box) return;
    const isSuper = !!(state && state.admin && state.admin.isSuperAdmin);
    if (!isSuper) { box.innerHTML = '<div class="empty">Solicitações de recuperação aparecem apenas para super administradores.</div>'; return; }
    const requests = state.passwordResetRequests || [];
    if (!requests.length) { box.innerHTML = '<div class="empty">Nenhuma solicitação pendente de recuperação de senha.</div>'; return; }
    box.innerHTML = `<div class="table-wrap"><table class="data-table"><thead><tr><th>Solicitante</th><th>E-mail</th><th>Data</th><th>Ações</th></tr></thead><tbody>${requests.map((r) => `<tr><td><strong>${escapeHtml(r.username)}</strong></td><td>${escapeHtml(r.email)}</td><td>${escapeHtml(new Date(r.requestedAt).toLocaleString("pt-BR"))}</td><td><div class="inline-actions"><button class="btn small primary" data-complete-reset data-request-id="${escapeHtml(r.id)}" data-username="${escapeHtml(r.username)}">Definir nova senha</button><button class="btn small danger" data-reject-reset data-request-id="${escapeHtml(r.id)}">Rejeitar</button></div></td></tr>`).join("")}</tbody></table></div>`;
    $all("[data-complete-reset]").forEach((btn) => btn.addEventListener("click", async () => completeResetRequest(btn.dataset.requestId, btn.dataset.username)));
    $all("[data-reject-reset]").forEach((btn) => btn.addEventListener("click", async () => rejectResetRequest(btn.dataset.requestId)));
  }

  async function toggleSlot(date, time) {
    try {
      await rpc("training_admin_toggle_block", { p_session_token: getAdminToken(), p_slot_date: date, p_slot_time: time });
      await loadAdminState();
      alertBox("adminAlert", "success", "Status da turma atualizado.");
    } catch (error) { alertBox("adminAlert", "danger", escapeHtml(error.message)); }
  }

  async function setDayOpen(date, open) {
    const action = open ? "liberar" : "bloquear";
    if (!window.confirm(`Deseja ${action} os dois horários deste dia?`)) return;
    try {
      await rpc("training_admin_set_day_open", { p_session_token: getAdminToken(), p_slot_date: date, p_open: open });
      await loadAdminState();
      alertBox("adminAlert", "success", open ? "Dia liberado para inscrição." : "Dia bloqueado para inscrição.");
    } catch (error) { alertBox("adminAlert", "danger", escapeHtml(error.message)); }
  }

  async function deleteBooking(id) {
    if (!window.confirm("Excluir este participante da turma?")) return;
    try {
      await rpc("training_admin_delete_booking", { p_session_token: getAdminToken(), p_booking_id: id });
      await loadAdminState();
      alertBox("adminAlert", "success", "Participante excluído.");
    } catch (error) { alertBox("adminAlert", "danger", escapeHtml(error.message)); }
  }

  async function extendWeek() {
    try {
      const newDate = await rpc("training_admin_extend_week", { p_session_token: getAdminToken() });
      await loadAdminState();
      alertBox("adminAlert", "success", `Agenda ampliada até <strong>${escapeHtml(formatFullDate(newDate))}</strong>.`);
    } catch (error) { alertBox("adminAlert", "danger", escapeHtml(error.message)); }
  }

  async function createAdminUser(event) {
    event.preventDefault();
    clearAlert("userAlert");
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Criando...";
    const formData = new FormData(form);
    try {
      await rpc("training_admin_create_user", {
        p_session_token: getAdminToken(),
        p_username: String(formData.get("username") || "").trim(),
        p_display_name: String(formData.get("displayName") || "").trim(),
        p_email: String(formData.get("email") || "").trim(),
        p_password: String(formData.get("password") || ""),
        p_is_super_admin: formData.get("isSuperAdmin") === "on"
      });
      form.reset();
      await loadAdminState();
      alertBox("userAlert", "success", "Administrador criado.");
    } catch (error) { alertBox("userAlert", "danger", escapeHtml(error.message)); }
    finally { submit.disabled = false; submit.textContent = "Cadastrar administrador"; }
  }

  async function changeOwnPassword(event) {
    event.preventDefault();
    clearAlert("passwordAlert");
    const form = event.currentTarget;
    const data = new FormData(form);
    const next = String(data.get("newPassword") || "");
    const confirm = String(data.get("confirmPassword") || "");
    if (next !== confirm) { alertBox("passwordAlert", "warning", "A nova senha e a confirmação não conferem."); return; }
    try {
      await rpc("training_admin_change_own_password", { p_session_token: getAdminToken(), p_current_password: String(data.get("currentPassword") || ""), p_new_password: next });
      form.reset();
      alertBox("passwordAlert", "success", "Senha alterada.");
    } catch (error) { alertBox("passwordAlert", "danger", escapeHtml(error.message)); }
  }

  async function resetAdminUserPassword(userId, username) {
    const password = window.prompt(`Nova senha para ${username}:`);
    if (!password) return;
    if (password.length < 8) { alertBox("userAlert", "warning", "A senha precisa ter pelo menos 8 caracteres."); return; }
    try {
      await rpc("training_admin_update_user_password", { p_session_token: getAdminToken(), p_user_id: userId, p_new_password: password });
      alertBox("userAlert", "success", "Senha do administrador atualizada.");
    } catch (error) { alertBox("userAlert", "danger", escapeHtml(error.message)); }
  }

  async function toggleAdminUser(userId, isActive) {
    const ok = window.confirm(isActive ? "Desativar este administrador?" : "Ativar este administrador?");
    if (!ok) return;
    try {
      await rpc("training_admin_set_user_active", { p_session_token: getAdminToken(), p_user_id: userId, p_is_active: !isActive });
      await loadAdminState();
      alertBox("userAlert", "success", "Status do administrador atualizado.");
    } catch (error) { alertBox("userAlert", "danger", escapeHtml(error.message)); }
  }

  async function completeResetRequest(requestId, username) {
    const password = window.prompt(`Nova senha para ${username}:`);
    if (!password) return;
    if (password.length < 8) { alertBox("resetAlert", "warning", "A senha precisa ter pelo menos 8 caracteres."); return; }
    try {
      await rpc("training_admin_complete_password_reset", { p_session_token: getAdminToken(), p_request_id: requestId, p_new_password: password });
      await loadAdminState();
      alertBox("resetAlert", "success", "Senha redefinida e solicitação concluída.");
    } catch (error) { alertBox("resetAlert", "danger", escapeHtml(error.message)); }
  }

  async function rejectResetRequest(requestId) {
    if (!window.confirm("Rejeitar esta solicitação de recuperação?")) return;
    try {
      await rpc("training_admin_reject_password_reset", { p_session_token: getAdminToken(), p_request_id: requestId });
      await loadAdminState();
      alertBox("resetAlert", "success", "Solicitação rejeitada.");
    } catch (error) { alertBox("resetAlert", "danger", escapeHtml(error.message)); }
  }

  async function logoutAdmin() {
    const token = getAdminToken();
    try { if (token && isConfigReady()) await rpc("training_admin_logout", { p_session_token: token }); } catch (_) {}
    clearAdminToken();
    window.location.href = "index.html#administrador";
  }

  function exportAdminCsv() {
    if (!adminState || !adminState.slots) return;
    const rows = [["Data", "Horario", "Nome", "Email", "Celular", "Cargo", "Loja", "Cidade", "Criado em"]];
    adminState.slots.forEach((slot) => (slot.bookings || []).forEach((person) => rows.push([slot.date, slot.time, person.name, person.email, person.phone, person.role, person.store, person.city, person.createdAt || ""])));
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agenda-treinamento-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page;
    setupPhoneMasks();
    if (page === "home") setupHomeLogin();
    if (page === "agendamento") loadPublicSlots();
    if (page === "inscricao") setupBookingPage();
    if (page === "recuperar") setupRecoveryPage();
    if (page === "painel") setupAdminPanel();
  });
})();
