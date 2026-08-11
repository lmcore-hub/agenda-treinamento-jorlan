(function () {
  "use strict";

  const cfg = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const originalCreateClient = window.supabase && window.supabase.createClient;

  if (!window.supabase || !originalCreateClient || window.__jorlanBookingEmailHookInstalled) return;
  window.__jorlanBookingEmailHookInstalled = true;

  function getEdgeUrl() {
    if (!cfg.SUPABASE_URL) return null;
    return cfg.SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/send-booking-confirmation";
  }

  async function sendConfirmation(bookingId) {
    const endpoint = getEdgeUrl();
    if (!endpoint || !cfg.SUPABASE_ANON_KEY || !bookingId) return;
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": cfg.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + cfg.SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ booking_id: bookingId })
      });
    } catch (error) {
      console.warn("Falha ao solicitar e-mail de confirmação:", error);
    }
  }

  window.supabase.createClient = function () {
    const client = originalCreateClient.apply(this, arguments);
    if (!client || !client.rpc || client.__jorlanBookingEmailWrapped) return client;

    const originalRpc = client.rpc.bind(client);
    client.rpc = async function (name, params, options) {
      const result = await originalRpc(name, params, options);
      try {
        if (name === "training_create_booking" && result && !result.error) {
          const payload = Array.isArray(result.data) ? result.data[0] : result.data;
          if (payload && payload.success && payload.booking_id) {
            sendConfirmation(payload.booking_id);
          }
        }
      } catch (error) {
        console.warn("Falha no hook de e-mail da inscrição:", error);
      }
      return result;
    };

    client.__jorlanBookingEmailWrapped = true;
    return client;
  };
})();
