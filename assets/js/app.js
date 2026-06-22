(function () {
  "use strict";

  const CONFIG = window.JORLAN_TRAINING_CONFIG || {};
  const ADMIN_TOKEN_KEY = "jorlanTrainingAdminToken";
  let supabaseClient = null;
  let adminState = null;

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function $all(selector, root = document) {
    return Array.from(root.querySelectorAll(selector));
  }

  function isConfigReady() {
    return CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY &&
      !CONFIG.SUPABASE_URL.includes("COLE_AQUI") &&
      !CONFIG.SUPABASE_ANON_KEY.includes("COLE_AQUI");
  }

  function getClient() {
    if (!isConfigReady()) return null;
    if (!supabaseClient) {
      supabaseClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    }
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
    return parseLocalDate(dateStr).toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
  }

  function dateParts(dateStr) {
    const d = parseLocalDate(dateStr);
    return {
      weekday: d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
      day: d.toLocaleDateString("pt-BR", { day: "2-digit" }),
      month: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "")
    };
  }

  function getAdminToken() {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  }

  function setAdminToken(token) {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  }

  function clearAdminToken() {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  }

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
      input.addEventListener("input", () => {
        input.value = normalizePhone(input.value);
      });
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
    if (!container) return;
    if (!isConfigReady()) return;

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
      container.innerHTML = '<div class="empty"><strong>Nenhuma turma aberta no momento.</strong><br>O instrutor precisa liberar novas datas no painel administrativo.</div>';
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
        </a>
      `;
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
      summary.innerHTML = `
        <span class="kicker">Turma selecionada</span>
        <strong>${escapeHtml(slotTime)}</strong>
        <p class="muted">${escapeHtml(formatFullDate(slotDate))}</p>
      `;
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
          if (response && response.nearest_date && response.nearest_time) {
            msg += `<br>Próxima turma com vaga: <strong>${escapeHtml(formatFullDate(response.nearest_date))} às ${escapeHtml(response.nearest_time)}</strong>.`;
          }
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
          window.location.href = "painel-instrutor.html";
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

  async function setupAdminPanel() {
    showConfigError("adminStatus");
    if (!isConfigReady()) return;
    const token = getAdminToken();
    if (!token) {
      window.location.href = "index.html";
      return;
    }
    await loadAdminState();
    setupAdminButtons();
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
  }

  async function loadAdminState() {
    const container = document.getElementById("adminCalendar");
    if (container) container.innerHTML = '<div class="loading">Carregando calendário administrativo...</div>';
    try {
      adminState = await rpc("training_admin_get_state", { p_session_token: getAdminToken() });
      renderAdminState(adminState);
    } catch (error) {
      clearAdminToken();
      if (container) container.innerHTML = `<div class="empty">Sessão expirada ou inválida. Volte para a tela inicial e faça login novamente.</div>`;
      alertBox("adminAlert", "danger", escapeHtml(error.message));
    }
  }

  function renderAdminState(state) {
    renderSummary(state);
    renderAdminCalendar(state);
  }

  function renderSummary(state) {
    const box = document.getElementById("adminSummary");
    if (!box) return;
    const slots = state && state.slots ? state.slots : [];
    const active = slots.filter((s) => !s.blocked).length;
    const blocked = slots.filter((s) => s.blocked).length;
    const occupied = slots.reduce((sum, s) => sum + Number(s.occupied || 0), 0);
    const remaining = slots.reduce((sum, s) => sum + Number(s.blocked ? 0 : s.remaining || 0), 0);
    box.innerHTML = `
      <div class="summary-card"><strong>${active}</strong><span>turmas abertas</span></div>
      <div class="summary-card"><strong>${blocked}</strong><span>turmas bloqueadas</span></div>
      <div class="summary-card"><strong>${occupied}</strong><span>participantes inscritos</span></div>
      <div class="summary-card"><strong>${remaining}</strong><span>vagas disponíveis</span></div>
    `;
  }

  function groupByDate(slots) {
    return slots.reduce((acc, slot) => {
      acc[slot.date] = acc[slot.date] || [];
      acc[slot.date].push(slot);
      return acc;
    }, {});
  }

  function renderAdminCalendar(state) {
    const container = document.getElementById("adminCalendar");
    if (!container) return;
    const slots = state && state.slots ? state.slots : [];
    if (!slots.length) {
      container.innerHTML = '<div class="empty">Nenhuma turma na janela de agenda. Clique em “Abrir +1 semana”.</div>';
      return;
    }

    const grouped = groupByDate(slots);
    container.innerHTML = Object.keys(grouped).map((date) => {
      const dateSlots = grouped[date];
      return `
        <section class="admin-day-card">
          <div class="admin-day-head">
            <div>
              <h3>${escapeHtml(formatFullDate(date))}</h3>
              <p>Terça ou quinta com duas turmas: 10h e 15h.</p>
            </div>
            <span class="pill neutral">${dateSlots.reduce((sum, s) => sum + Number(s.occupied || 0), 0)} inscritos</span>
          </div>
          ${dateSlots.map(renderAdminSlot).join("")}
        </section>
      `;
    }).join("");

    $all("[data-toggle-slot]").forEach((btn) => {
      btn.addEventListener("click", async () => toggleSlot(btn.dataset.date, btn.dataset.time));
    });
    $all("[data-delete-booking]").forEach((btn) => {
      btn.addEventListener("click", async () => deleteBooking(btn.dataset.id));
    });
  }

  function renderAdminSlot(slot) {
    const bookings = slot.bookings || [];
    const actionLabel = slot.blocked ? "Liberar" : "Bloquear";
    const actionClass = slot.blocked ? "success" : "warning";
    return `
      <div class="slot-row">
        <div class="slot-time">${escapeHtml(slot.time)}</div>
        <div class="slot-detail">
          <div>${slotStatus({ blocked: slot.blocked, remaining: slot.remaining })}</div>
          <small>${slot.occupied} de ${slot.capacity} vagas preenchidas.</small>
          <div class="participants">
            ${bookings.length ? bookings.map(renderParticipant).join("") : '<div class="empty">Sem participantes inscritos neste horário.</div>'}
          </div>
        </div>
        <div class="toolbar">
          <button class="btn small ${actionClass}" data-toggle-slot data-date="${escapeHtml(slot.date)}" data-time="${escapeHtml(slot.time)}">${actionLabel}</button>
        </div>
      </div>
    `;
  }

  function renderParticipant(person) {
    return `
      <div class="person">
        <div>
          <strong>${escapeHtml(person.name)}</strong>
          <span>${escapeHtml(person.role)} · ${escapeHtml(person.store)} · ${escapeHtml(person.city)}</span>
          <span>${escapeHtml(person.email)} · ${escapeHtml(person.phone)}</span>
        </div>
        <button class="btn small danger" data-delete-booking data-id="${escapeHtml(person.id)}">Excluir</button>
      </div>
    `;
  }

  async function toggleSlot(date, time) {
    try {
      await rpc("training_admin_toggle_block", {
        p_session_token: getAdminToken(),
        p_slot_date: date,
        p_slot_time: time
      });
      await loadAdminState();
      alertBox("adminAlert", "success", "Status da turma atualizado.");
    } catch (error) {
      alertBox("adminAlert", "danger", escapeHtml(error.message));
    }
  }

  async function deleteBooking(id) {
    const confirmed = window.confirm("Excluir este participante da turma?");
    if (!confirmed) return;
    try {
      await rpc("training_admin_delete_booking", {
        p_session_token: getAdminToken(),
        p_booking_id: id
      });
      await loadAdminState();
      alertBox("adminAlert", "success", "Participante excluído.");
    } catch (error) {
      alertBox("adminAlert", "danger", escapeHtml(error.message));
    }
  }

  async function extendWeek() {
    try {
      const newDate = await rpc("training_admin_extend_week", { p_session_token: getAdminToken() });
      await loadAdminState();
      alertBox("adminAlert", "success", `Agenda ampliada até <strong>${escapeHtml(formatFullDate(newDate))}</strong>.`);
    } catch (error) {
      alertBox("adminAlert", "danger", escapeHtml(error.message));
    }
  }

  async function logoutAdmin() {
    const token = getAdminToken();
    try {
      if (token && isConfigReady()) await rpc("training_admin_logout", { p_session_token: token });
    } catch (_) {
      // Logout local mesmo se a sessão remota já tiver expirado.
    }
    clearAdminToken();
    window.location.href = "index.html";
  }

  function exportAdminCsv() {
    if (!adminState || !adminState.slots) return;
    const rows = [["Data", "Horario", "Nome", "Email", "Celular", "Cargo", "Loja", "Cidade", "Criado em"]];
    adminState.slots.forEach((slot) => {
      (slot.bookings || []).forEach((person) => {
        rows.push([
          slot.date,
          slot.time,
          person.name,
          person.email,
          person.phone,
          person.role,
          person.store,
          person.city,
          person.createdAt || ""
        ]);
      });
    });
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
    if (page === "painel") setupAdminPanel();
  });
})();
