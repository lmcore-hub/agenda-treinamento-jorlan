(function () {
  "use strict";

  const cfg = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  let supabaseClient = null;

  function $(id) { return document.getElementById(id); }

  function getClient() {
    if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return null;
    if (!supabaseClient) supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return supabaseClient;
  }

  function formatDate(dateStr) {
    const [y, m, d] = String(dateStr).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  }

  function show(type, html) {
    const box = $("cancelAlert");
    if (!box) return;
    box.className = "alert show " + type;
    box.innerHTML = html;
  }

  async function rpc(name, params) {
    const client = getClient();
    if (!client) throw new Error("Configuração do Supabase não encontrada.");
    const { data, error } = await client.rpc(name, params || {});
    if (error) throw new Error(error.message || "Erro na comunicação com o banco.");
    return data;
  }

  async function load() {
    const token = new URLSearchParams(window.location.search).get("token") || "";
    const details = $("bookingDetails");
    const button = $("cancelButton");

    if (!token) {
      show("error", "Link inválido. Solicite orientação ao responsável pelo treinamento.");
      if (button) button.style.display = "none";
      return;
    }

    try {
      const data = await rpc("training_get_booking_for_cancel", { p_cancel_token: token });
      if (!data || !data.success) {
        show("error", data && data.message ? data.message : "Inscrição não encontrada.");
        if (button) button.style.display = "none";
        return;
      }

      if (details) {
        details.innerHTML = `
          <div class="detail"><span>Participante</span><strong>${data.name}</strong></div>
          <div class="detail"><span>Turma</span><strong>${formatDate(data.slot_date)} às ${data.slot_time}</strong></div>
          <div class="detail"><span>Loja</span><strong>${data.store || "-"}</strong></div>
          <div class="detail"><span>E-mail</span><strong>${data.email}</strong></div>
        `;
      }

      if (data.cancelled_at) {
        show("success", "Esta inscrição já foi cancelada.");
        if (button) button.style.display = "none";
        return;
      }

      if (!data.can_cancel) {
        show("error", "O cancelamento pelo site só é permitido até 24 horas antes do treinamento.<br><br>Para tratar este caso, envie e-mail para <strong>luis.marques@grupojorlan.com</strong> ou <strong>guilherme.mendes@grupojorlan.com</strong>.");
        if (button) button.style.display = "none";
        return;
      }

      if (button) {
        button.onclick = async function () {
          if (!window.confirm("Confirma o cancelamento desta inscrição?")) return;
          button.disabled = true;
          button.textContent = "Cancelando...";
          try {
            const result = await rpc("training_cancel_booking", { p_cancel_token: token });
            if (result && result.success) {
              show("success", "Inscrição cancelada com sucesso.");
              button.style.display = "none";
            } else {
              show("error", result && result.message ? result.message : "Não foi possível cancelar.");
              button.disabled = false;
              button.textContent = "Confirmar cancelamento";
            }
          } catch (error) {
            show("error", error.message || "Erro ao cancelar inscrição.");
            button.disabled = false;
            button.textContent = "Confirmar cancelamento";
          }
        };
      }
    } catch (error) {
      show("error", error.message || "Erro ao carregar inscrição.");
      if (button) button.style.display = "none";
    }
  }

  document.addEventListener("DOMContentLoaded", load);
})();
