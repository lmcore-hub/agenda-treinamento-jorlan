(function () {
  "use strict";

  const params = new URLSearchParams(location.search);
  if (params.has("username") || params.has("password")) {
    params.delete("username"); params.delete("password");
    history.replaceState({}, document.title, location.pathname + (params.size ? "?" + params : "") + location.hash);
  }

  // A participant's individual exam remains independent of admin logout.
  if (location.pathname.endsWith("/prova.html") && new URLSearchParams(location.search).get("token")) return;

  const adminSurface = document.body.dataset.page === "painel" ||
    /\/(painel-administrador|prova|index)\.html$/.test(location.pathname) || location.pathname.endsWith("/");

  const tokenKeys = ["jorlan_admin_session_token", "jorlanTrainingAdminToken"];
  const profileKey = "jorlan_admin_profile";
  const pendingKey = "jorlan_admin_logout_pending";
  const timeoutMs = 10000;
  let locked = localStorage.getItem(pendingKey) === "true";
  let generation = 0;
  let inFlight = null;
  let client = null;

  function getClient() {
    const cfg = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
    if (!client && window.supabase && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY) {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    }
    return client;
  }

  function tokens() {
    return [...new Set(tokenKeys.flatMap(key => [localStorage.getItem(key), sessionStorage.getItem(key)]).filter(Boolean))];
  }

  function lock() {
    if (!locked) generation += 1;
    locked = true;
    // Persist intent before sending the request: a reload must resume logout,
    // including when the server completed it but its response was lost.
    if (!adminSurface) { localStorage.setItem(pendingKey, "true"); return; }
    const main = document.querySelector("main");
    if (main) main.replaceChildren();
    document.querySelectorAll(".modal, .op-modal, #adminBookingModal").forEach(el => el.remove());
    document.getElementById("app")?.replaceChildren();
    document.getElementById("admin-login-form")?.reset();
    localStorage.setItem(pendingKey, "true");
  }

  function show(message, busy) {
    if (!adminSurface) return;
    let box = document.getElementById("admin-logout-status");
    if (!box) {
      box = document.createElement("section");
      box.id = "admin-logout-status";
      box.className = "card page";
      box.setAttribute("role", "status");
      box.setAttribute("aria-live", "polite");
      const text = document.createElement("p");
      text.id = "admin-logout-message";
      const retry = document.createElement("button");
      retry.id = "admin-logout-retry";
      retry.type = "button";
      retry.className = "btn danger";
      retry.textContent = "Tentar encerrar novamente";
      retry.addEventListener("click", () => logout());
      box.append(text, retry);
      document.body.appendChild(box);
    }
    document.getElementById("admin-logout-message").textContent = message;
    document.getElementById("admin-logout-retry").disabled = busy;
    const button = document.getElementById("logout-button");
    if (button) { button.disabled = busy; button.textContent = busy ? "Encerrando..." : "Tentar sair novamente"; }
  }

  async function revoke(sb, token) {
    const controller = new AbortController();
    let timer;
    try {
      let request = sb.rpc("training_admin_logout", { p_session_token: token });
      if (typeof request.abortSignal === "function") request = request.abortSignal(controller.signal);
      const { data, error } = await Promise.race([
        request,
        new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("Logout timed out")); }, timeoutMs);
        })
      ]);
      // The text RPC returns true even if a preceding attempt already deleted
      // this session. Only that explicit acknowledgement permits local cleanup.
      if (error || data !== true) throw new Error("Logout not acknowledged");
    } finally {
      clearTimeout(timer);
    }
  }

  function clearCredentials() {
    for (const storage of [localStorage, sessionStorage]) {
      for (const key of [...tokenKeys, profileKey]) storage.removeItem(key);
    }
    localStorage.removeItem(pendingKey);
  }

  function logout(sb = getClient()) {
    if (inFlight) return inFlight;
    let setupError = null;
    try {
      // Block access synchronously, before another handler can use a cached token.
      lock();
      show("Encerrando a sessão no servidor...", true);
    } catch (error) { setupError = error; }
    // Schedule work in a promise so repeated calls always share one attempt.
    inFlight = Promise.resolve().then(async () => {
      try {
        if (setupError) throw setupError;
        const knownTokens = tokens();
        if (knownTokens.length && !sb) throw new Error("Client unavailable");
        for (const token of knownTokens) await revoke(sb, token);
        clearCredentials();
        window.location.replace("index.html#administrador");
        return true;
      } catch (_) {
        // Never display the RPC error: it may contain credentials or data.
        show("Não foi possível confirmar a saída. O painel está bloqueado. Verifique a conexão e tente encerrar novamente.", false);
        return false;
      } finally {
        inFlight = null;
      }
    });
    return inFlight;
  }

  async function rpc(sb, name, params) {
    const administrative = name.startsWith("training_admin_");
    const version = generation;
    if (administrative && locked) throw new Error("Saída pendente. Encerre a sessão antes de continuar.");
    const result = await sb.rpc(name, params || {});
    // Discard a response that began before logout. Cached tokens and delayed
    // responses in other panel scripts must not revive administrative access.
    if (administrative && (locked || version !== generation)) throw new Error("Sessão encerrando.");
    if (result.error) throw result.error;
    return result.data;
  }

  window.JorlanAdminSession = Object.freeze({ isLocked: () => locked, logout, rpc });
  window.addEventListener("storage", event => {
    if (event.key !== pendingKey) return;
    if (event.newValue === "true") {
      lock();
      show("Saída solicitada em outra aba. O painel está bloqueado até a confirmação do servidor.", false);
    } else if (locked && event.newValue === null) {
      // Clear this tab's sessionStorage too; it is not shared across tabs.
      for (const key of [...tokenKeys, profileKey]) sessionStorage.removeItem(key);
      if (adminSurface) window.location.replace("index.html#administrador");
    }
  });
  window.addEventListener("pageshow", () => {
    if (!adminSurface) return;
    if (localStorage.getItem(pendingKey) === "true") logout();
    else if (locked) window.location.replace("index.html#administrador");
  });
  function resume() { if (adminSurface && locked) logout(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", resume);
  else resume();
})();
