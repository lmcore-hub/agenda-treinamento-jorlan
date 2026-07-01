(function(){
  const cfg = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const page = document.body.dataset.page;
  const alertBox = document.getElementById('password-alert');

  function show(type, msg){
    if(!alertBox) return;
    alertBox.className = 'alert show ' + type;
    alertBox.textContent = msg;
  }

  async function requestReset(email){
    if(!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY){
      throw new Error('Configuração do Supabase não encontrada.');
    }
    const endpoint = cfg.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/send-password-reset';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': cfg.SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ email })
    });
    let payload = null;
    try { payload = await res.json(); } catch (_) {}
    if(!res.ok){
      throw new Error(payload?.error || 'Não foi possível solicitar recuperação.');
    }
    return payload;
  }

  async function resetPassword(token, newPassword){
    if(!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY){
      throw new Error('Configuração do Supabase não encontrada.');
    }
    const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    const { data, error } = await sb.rpc('training_admin_reset_password', {
      p_token: token,
      p_new_password: newPassword
    });
    if(error) throw error;
    return data;
  }

  if(page === 'password-request'){
    const form = document.getElementById('password-request-form');
    const emailInput = document.getElementById('reset-email');
    form.addEventListener('submit', async function(event){
      event.preventDefault();
      const email = emailInput.value.trim().toLowerCase();
      if(!email){ show('error', 'Informe o e-mail.'); return; }
      try{
        await requestReset(email);
        show('success', 'Se o e-mail estiver cadastrado, enviaremos um link temporário para redefinir a senha. Verifique a caixa de entrada e o spam.');
        form.reset();
      }catch(err){
        show('error', err.message || 'Erro ao solicitar recuperação.');
      }
    });
  }

  if(page === 'password-reset'){
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token') || '';
    const form = document.getElementById('password-reset-form');
    const pass = document.getElementById('new-password');
    const confirm = document.getElementById('confirm-password');
    if(!token){
      show('error', 'Link inválido: token ausente. Solicite um novo link de recuperação.');
      form.style.display = 'none';
      return;
    }
    form.addEventListener('submit', async function(event){
      event.preventDefault();
      const p1 = pass.value;
      const p2 = confirm.value;
      if(p1.length < 6){ show('error', 'A senha precisa ter pelo menos 6 caracteres.'); return; }
      if(p1 !== p2){ show('error', 'As senhas não conferem.'); return; }
      try{
        await resetPassword(token, p1);
        show('success', 'Senha alterada com sucesso. Você já pode voltar ao login administrativo.');
        form.reset();
      }catch(err){
        show('error', err.message || 'Não foi possível redefinir a senha.');
      }
    });
  }
})();
