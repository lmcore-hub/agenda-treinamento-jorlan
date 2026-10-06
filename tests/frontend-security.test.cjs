const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const tokenKey = 'jorlan_admin_session_token';
const legacyKey = 'jorlanTrainingAdminToken';
const pendingKey = 'jorlan_admin_logout_pending';
const profileKey = 'jorlan_admin_profile';
const fakeToken = 'synthetic-session-only';
const attack = '<img src=x onerror="window.injected=true"><svg onload="window.injected=true">';
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function environment(file, url, handler = async () => ({ data: true, error: null })) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error.message));
  const dom = new JSDOM(file ? read(file) : '<main><p>Private information</p></main><div class="modal">Private modal</div><button id="logout-button">Sair</button>', { url: url || 'https://training.test/painel-administrador.html', runScripts: 'outside-only', virtualConsole });
  const window = dom.window;
  const calls = [];
  const client = { rpc(name, params) { calls.push({ name, params }); return handler(name, params); } };
  window.JORLAN_TRAINING_CONFIG = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'public-test-key' };
  window.supabase = { createClient: () => client };
  window.confirm = () => true;
  window.alert = () => {};
  return { dom, window, client, calls, errors, evaluate: file => window.eval(read(file)), close: () => window.close() };
}
async function cancellation(data, cancelHandler) {
  const env = environment('cancelar-inscricao.html', 'https://training.test/cancelar-inscricao.html?token=synthetic-cancel-only', async name => name === 'training_get_booking_for_cancel' ? { data, error: null } : cancelHandler());
  env.evaluate('cancelar-inscricao.js');
  await tick();
  return env;
}
const booking = overrides => ({ success: true, name: 'Participante', store: 'Loja', email: 'teste@example.test', slot_date: '2026-11-20', slot_time: '10:00', can_cancel: true, ...overrides });
function seed(env) {
  env.window.localStorage.setItem(tokenKey, fakeToken);
  env.window.sessionStorage.setItem(tokenKey, fakeToken);
  env.window.localStorage.setItem(profileKey, '{"username":"test"}');
  env.window.sessionStorage.setItem(profileKey, '{"username":"test"}');
}
function session(env) { env.evaluate('assets/js/admin-session.js'); return env.window.JorlanAdminSession; }
function assertBlocked(env) {
  assert.equal(env.window.JorlanAdminSession.isLocked(), true);
  assert.equal(env.window.document.querySelector('main').textContent, '');
  assert.equal(env.window.document.querySelector('.modal'), null);
  assert.equal(env.window.document.getElementById('admin-logout-retry').disabled, false);
  assert.equal(env.window.document.body.textContent.includes(fakeToken), false);
}

test('Cancellation renders all participant fields as text, including malicious markup', async () => {
  const env = await cancellation(booking({ name: attack, store: attack, email: attack, slot_time: attack }), () => ({ data: { success: true } }));
  try {
    const details = env.window.document.getElementById('bookingDetails');
    assert.equal(details.querySelectorAll('.detail').length, 4);
    assert.equal(details.querySelectorAll('img,svg,script').length, 0);
    assert.equal(details.querySelector('strong').textContent, attack);
    assert.equal(env.window.injected, undefined);
    assert.equal(env.window.document.getElementById('cancelButton').disabled, false);
  } finally { env.close(); }
});
for (const source of ['result', 'rpc']) test(`Cancellation ${source} error is plain text`, async () => {
  const env = environment('cancelar-inscricao.html', 'https://training.test/cancelar-inscricao.html?token=synthetic-cancel-only', async () => source === 'result' ? { data: { success: false, message: attack } } : { error: { message: attack } });
  try {
    env.evaluate('cancelar-inscricao.js'); await tick();
    const alert = env.window.document.getElementById('cancelAlert');
    assert.equal(alert.textContent, attack);
    assert.equal(alert.querySelector('img'), null);
    assert.equal(env.window.document.getElementById('cancelButton').style.display, 'none');
  } finally { env.close(); }
});
test('Cancellation requires a valid link and a completed lookup', async () => {
  const wait = deferred();
  const env = environment('cancelar-inscricao.html', 'https://training.test/cancelar-inscricao.html?token=synthetic-cancel-only', () => wait.promise);
  const missing = environment('cancelar-inscricao.html', 'https://training.test/cancelar-inscricao.html');
  try {
    env.evaluate('cancelar-inscricao.js'); missing.evaluate('cancelar-inscricao.js'); await tick();
    assert.equal(env.window.document.getElementById('cancelButton').disabled, true);
    assert.equal(missing.calls.length, 0);
    assert.equal(missing.window.document.getElementById('cancelButton').style.display, 'none');
  } finally { env.close(); missing.close(); }
});
for (const data of [booking({ cancelled_at: '2026-10-01' }), booking({ can_cancel: false })]) test('Cancelled or overdue booking has no cancellation action', async () => {
  const env = await cancellation(data, () => { throw Error('Must not call'); });
  try {
    const button = env.window.document.getElementById('cancelButton');
    assert.equal(button.onclick, null); assert.equal(button.style.display, 'none');
    assert.equal(env.calls.length, 1);
  } finally { env.close(); }
});
test('Repeated cancellation clicks produce one request and remain disabled on success', async () => {
  const wait = deferred(); const env = await cancellation(booking(), () => wait.promise);
  try {
    const button = env.window.document.getElementById('cancelButton');
    const a = button.onclick(), b = button.onclick();
    assert.equal(env.calls.filter(call => call.name === 'training_cancel_booking').length, 1);
    wait.resolve({ data: { success: true } }); await Promise.all([a, b]);
    await button.onclick();
    assert.equal(button.disabled, true); assert.equal(button.style.display, 'none');
    assert.equal(env.calls.length, 2);
  } finally { env.close(); }
});
for (const failure of [{ error: { message: attack } }, { data: { success: false, message: attack } }]) test('Cancellation failure restores a usable retry action without interpreting markup', async () => {
  let attempts = 0; const env = await cancellation(booking(), () => ++attempts === 1 ? failure : { data: { success: true } });
  try {
    const button = env.window.document.getElementById('cancelButton');
    await button.onclick();
    assert.equal(button.disabled, false); assert.equal(button.textContent, 'Confirmar cancelamento');
    assert.equal(env.window.document.getElementById('cancelAlert').textContent, attack);
    assert.equal(env.window.document.getElementById('cancelAlert').querySelector('img'), null);
    await button.onclick(); assert.equal(attempts, 2); assert.equal(button.style.display, 'none');
  } finally { env.close(); }
});
test('Declining cancellation does not mutate any booking', async () => {
  const env = await cancellation(booking(), () => { throw Error('Must not call'); });
  try { env.window.confirm = () => false; await env.window.document.getElementById('cancelButton').onclick(); assert.equal(env.calls.length, 1); } finally { env.close(); }
});

test('Logout waits for server acknowledgement, coalesces clicks, and clears both storage formats', async () => {
  const wait = deferred(); const env = environment(null, null, () => wait.promise); seed(env);
  const lifecycle = session(env);
  try {
    const a = lifecycle.logout(env.client), b = lifecycle.logout(env.client);
    assert.equal(a, b); await tick();
    assert.equal(env.window.localStorage.getItem(tokenKey), fakeToken);
    assert.equal(env.window.localStorage.getItem(pendingKey), 'true');
    assert.equal(env.window.document.getElementById('admin-logout-retry').disabled, true);
    assert.equal(env.calls.length, 1); assert.equal(env.calls[0].name, 'training_admin_logout');
    assert.deepEqual(Object.keys(env.calls[0].params), ['p_session_token']);
    wait.resolve({ data: true }); assert.equal(await a, true);
    for (const storage of [env.window.localStorage, env.window.sessionStorage]) {
      for (const key of [tokenKey, legacyKey, profileKey]) assert.equal(storage.getItem(key), null);
    }
    assert.equal(env.window.localStorage.getItem(pendingKey), null);
    assert.equal(env.errors.filter(message => message.includes('navigation')).length, 1);
  } finally { env.close(); }
});
for (const failure of [
  { error: { code: 'PGRST203', message: fakeToken + attack } },
  { error: { code: '500', message: 'Server failed' } },
  { data: false }, { data: null }, { data: { success: true } }
]) test('Logout rejects errors and non-boolean acknowledgements, retaining a blocked retry', async () => {
  let attempts = 0; const env = environment(null, null, () => ++attempts === 1 ? failure : { data: true }); seed(env);
  const lifecycle = session(env);
  try {
    assert.equal(await lifecycle.logout(env.client), false); assertBlocked(env);
    assert.equal(env.window.localStorage.getItem(tokenKey), fakeToken);
    assert.equal(env.window.localStorage.getItem(pendingKey), 'true');
    assert.equal(env.errors.length, 0);
    assert.equal(await lifecycle.logout(env.client), true); assert.equal(attempts, 2);
  } finally { env.close(); }
});
test('Network rejection during logout retains the session for retry', async () => {
  const env = environment(null, null, () => Promise.reject(Error(fakeToken))); seed(env);
  try { const lifecycle = session(env); assert.equal(await lifecycle.logout(env.client), false); assertBlocked(env); assert.equal(env.window.localStorage.getItem(tokenKey), fakeToken); } finally { env.close(); }
});
test('Logout with missing client stays blocked instead of claiming success', async () => {
  const env = environment(); seed(env); env.window.supabase = null;
  try { const lifecycle = session(env); assert.equal(await lifecycle.logout(), false); assertBlocked(env); assert.equal(env.calls.length, 0); } finally { env.close(); }
});
test('Logout revokes distinct local sessions before removing credentials', async () => {
  const env = environment(); seed(env); env.window.sessionStorage.setItem(legacyKey, 'another-synthetic-session');
  try { assert.equal(await session(env).logout(env.client), true); assert.equal(env.calls.length, 2); assert.equal(new Set(env.calls.map(c => c.params.p_session_token)).size, 2); } finally { env.close(); }
});
test('Timeout aborts the request, enables retry, and ignores a late success', async () => {
  const wait = deferred(); let signal, fire;
  const env = environment(null, null, () => ({ abortSignal(value) { signal = value; return wait.promise; } })); seed(env);
  const realSetTimeout = env.window.setTimeout;
  env.window.setTimeout = (fn, ms) => { assert.equal(ms, 10000); fire = fn; return 10; };
  try {
    const lifecycle = session(env), result = lifecycle.logout(env.client); await tick();
    fire(); assert.equal(await result, false); assert.equal(signal.aborted, true); assertBlocked(env);
    wait.resolve({ data: true }); await tick();
    assert.equal(env.window.localStorage.getItem(tokenKey), fakeToken); assert.equal(env.errors.length, 0);
  } finally { env.window.setTimeout = realSetTimeout; env.close(); }
});
test('Reload resumes an interrupted logout and does not load any panel data', async () => {
  const env = environment('painel-administrador.html', null, () => ({ error: { message: 'offline' } })); seed(env); env.window.localStorage.setItem(pendingKey, 'true');
  try {
    session(env);
    for (const file of ['painel-unificado','admin-bookings','admin-scheduler','usuarios-admin']) env.evaluate(`assets/js/${file}.js`);
    await tick(); await tick();
    assert.ok(env.calls.length >= 1); assert.ok(env.calls.every(call => call.name === 'training_admin_logout'));
    assertBlocked(env); assert.equal(env.window.localStorage.getItem(pendingKey), 'true');
  } finally { env.close(); }
});
test('Reload after a lost success response retries the idempotent logout', async () => {
  const env = environment(); seed(env); env.window.localStorage.setItem(pendingKey, 'true');
  try { session(env); await tick(); await tick(); assert.equal(env.calls[0].name, 'training_admin_logout'); assert.equal(env.window.localStorage.getItem(tokenKey), null); } finally { env.close(); }
});
test('In-flight administrative reads are discarded and cached-token writes are blocked during logout', async () => {
  const readWait = deferred(), logoutWait = deferred();
  const env = environment(null, null, name => name === 'training_admin_logout' ? logoutWait.promise : readWait.promise); seed(env);
  try {
    const lifecycle = session(env);
    const readRequest = lifecycle.rpc(env.client, 'training_admin_get_state', { p_session_token: fakeToken });
    const readRejected = assert.rejects(readRequest, /Sessão encerrando/);
    const exit = lifecycle.logout(env.client); await tick();
    await assert.rejects(lifecycle.rpc(env.client, 'training_admin_update_user', { p_session_token: fakeToken }), /Saída pendente/);
    readWait.resolve({ data: { private: 'must not render' } }); await readRejected;
    logoutWait.resolve({ error: { message: 'offline' } }); await exit;
    assert.equal(env.calls.length, 2);
  } finally { env.close(); }
});
test('Storage failure cannot leave private panel data visible or claim logout success', async () => {
  const env = environment(); seed(env); const lifecycle = session(env);
  env.window.Storage.prototype.setItem = () => { throw Error('Storage unavailable'); };
  try { assert.equal(await lifecycle.logout(env.client), false); assertBlocked(env); assert.equal(env.errors.length, 0); assert.equal(env.calls.length, 0); } finally { env.close(); }
});
test('Local cleanup failure stays locked after server confirmation and can be retried', async () => {
  const env = environment(); seed(env); const lifecycle = session(env);
  const original = env.window.Storage.prototype.removeItem;
  env.window.Storage.prototype.removeItem = () => { throw Error('Storage unavailable'); };
  try {
    assert.equal(await lifecycle.logout(env.client), false); assertBlocked(env);
    assert.equal(env.window.localStorage.getItem(pendingKey), 'true'); assert.equal(env.errors.length, 0);
    env.window.Storage.prototype.removeItem = original;
    assert.equal(await lifecycle.logout(env.client), true); assert.equal(env.calls.length, 2);
  } finally { env.close(); }
});
test('Other-tab logout intent blocks cached sessions and completion clears this tab storage', async () => {
  const env = environment(); seed(env);
  try {
    const lifecycle = session(env); await tick();
    env.window.dispatchEvent(new env.window.StorageEvent('storage', { key: pendingKey, newValue: 'true' })); assertBlocked(env);
    await assert.rejects(lifecycle.rpc(env.client, 'training_admin_get_state', {}), /Saída pendente/);
    env.window.dispatchEvent(new env.window.StorageEvent('storage', { key: pendingKey, newValue: null }));
    assert.equal(env.window.sessionStorage.getItem(tokenKey), null); assert.equal(env.errors.length, 1); await tick();
  } finally { env.close(); }
});
test('No-session logout performs local cleanup without a null-token RPC', async () => {
  const env = environment();
  try { assert.equal(await session(env).logout(env.client), true); assert.equal(env.calls.length, 0); } finally { env.close(); }
});
test('Administrative pages load the lifecycle before consumers', () => {
  for (const file of ['index.html','painel-administrador.html','agendamento.html','inscricao.html','prova.html']) {
    const html = read(file);
    assert.ok(html.indexOf('assets/js/admin-session.js') > html.indexOf('assets/js/config.js'));
    for (const consumer of ['painel-unificado','admin-bookings','admin-scheduler','usuarios-admin','app']) {
      const position = html.indexOf(`assets/js/${consumer}.js`);
      if (position !== -1) assert.ok(html.indexOf('assets/js/admin-session.js') < position);
    }
  }
});

function panelResponse(name) {
  if (name === 'training_admin_session_profile') return { data: { display_name: 'Test admin', role: 'Administrador' } };
  if (name === 'training_admin_get_state') return { data: { slots: [], courses: [] } };
  if (name === 'training_admin_list_users' || name === 'training_admin_get_pending_slot_changes') return { data: [] };
  if (name === 'training_admin_logout') return { data: true };
  throw new Error('Unexpected RPC in integration test');
}
test('Current panel scripts load normally and the actual Sair button invokes server logout', async () => {
  const env = environment('painel-administrador.html', null, panelResponse); seed(env);
  try {
    session(env);
    for (const file of ['painel-unificado','admin-bookings','admin-scheduler','usuarios-admin']) env.evaluate(`assets/js/${file}.js`);
    await tick(); await tick();
    assert.equal(env.window.document.getElementById('current-admin-badge').textContent, 'Test admin • Administrador');
    assert.ok(env.window.document.getElementById('opAgenda'));
    assert.equal(env.errors.length, 0);
    env.window.document.getElementById('logout-button').click();
    await tick(); await tick();
    assert.equal(env.calls.filter(call => call.name === 'training_admin_logout').length, 1);
    assert.equal(env.window.localStorage.getItem(tokenKey), null);
    assert.equal(env.window.document.querySelector('iframe'), null);
    assert.equal(env.window.document.getElementById('adminBookingModal'), null);
    assert.ok(env.errors.every(message => message.includes('navigation')));
  } finally { env.close(); }
});
test('URL credentials are removed before panel work and never trigger automatic login', async () => {
  const env = environment('painel-administrador.html', 'https://training.test/painel-administrador.html?username=synthetic-user&password=synthetic-password&tab=agenda#section', panelResponse);
  try {
    session(env); env.evaluate('assets/js/painel-unificado.js'); await tick();
    assert.equal(env.window.location.search, '?tab=agenda'); assert.equal(env.window.location.hash, '#section');
    assert.equal(env.calls.length, 0);
  } finally { env.close(); }
});
for (const code of ['PGRST203', '42501']) test(`Slot toggle does not fall back to another function after ${code}`, async () => {
  const env = environment('painel-administrador.html', null, name => name === 'training_admin_set_slot_blocked' ? { error: { code, message: 'function failed' } } : panelResponse(name)); seed(env);
  try {
    session(env); env.evaluate('assets/js/painel-unificado.js'); await tick();
    const button = env.window.document.createElement('button');
    button.dataset.slotToggle = 'synthetic-slot'; button.dataset.blocked = 'false';
    env.window.document.getElementById('agenda-grid').append(button); button.click(); await tick();
    assert.equal(env.calls.filter(call => call.name === 'training_admin_set_slot_blocked').length, 1);
    assert.equal(env.calls.some(call => call.name === 'training_admin_toggle_slot' || call.name === 'training_admin_block_slot'), false);
  } finally { env.close(); }
});
test('Slot compatibility fallback is limited to a missing RPC and retains the exact payload', async () => {
  const env = environment('painel-administrador.html', null, name => name === 'training_admin_set_slot_blocked' ? { error: { code: 'PGRST202', message: 'missing' } } : name === 'training_admin_toggle_slot' ? { data: true } : panelResponse(name)); seed(env);
  try {
    session(env); env.evaluate('assets/js/painel-unificado.js'); await tick();
    const button = env.window.document.createElement('button'); button.dataset.slotToggle = 'synthetic-slot'; button.dataset.blocked = 'false';
    env.window.document.getElementById('agenda-grid').append(button); button.click(); await tick();
    const toggles = env.calls.filter(call => call.name.includes('toggle_slot') || call.name.includes('set_slot_blocked'));
    assert.equal(toggles.length, 2); assert.deepEqual(toggles[0].params, toggles[1].params);
    assert.deepEqual(Object.keys(toggles[0].params), ['p_session_token', 'p_slot_id', 'p_blocked']);
    assert.equal(toggles[0].params.p_blocked, true);
  } finally { env.close(); }
});
for (const file of ['assets/js/app.js','app.js','js/app.js']) test(`${file} escapes a booking failure message before adding trusted markup`, async () => {
  const env = environment('inscricao.html', 'https://training.test/inscricao.html?date=2026-11-20&time=10%3A00', () => ({ data: { success: false, message: attack, nearest_date: '2026-11-21', nearest_time: '10:00' } }));
  try {
    env.evaluate(file); await tick();
    const form = env.window.document.getElementById('bookingForm');
    form.dispatchEvent(new env.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    const alert = env.window.document.getElementById('bookingAlert');
    assert.equal(alert.querySelector('img'), null); assert.ok(alert.textContent.startsWith(attack)); assert.ok(alert.querySelector('strong'));
  } finally { env.close(); }
});
test('Pending admin logout does not block or erase an individual participant exam', async () => {
  const env = environment('prova.html', 'https://training.test/prova.html?token=synthetic-exam-only'); env.window.localStorage.setItem(pendingKey, 'true');
  try { session(env); await tick(); assert.equal(env.window.JorlanAdminSession, undefined); assert.ok(env.window.document.getElementById('app')); assert.equal(env.calls.length, 0); } finally { env.close(); }
});
test('Exam admin API cannot use a cached session while logout is pending', async () => {
  const env = environment('prova.html', 'https://training.test/prova.html?admin=1', () => ({ error: { message: 'offline' } })); seed(env); env.window.localStorage.setItem(pendingKey, 'true');
  let requests = 0; env.window.fetch = async () => { requests++; throw Error('Must not fetch'); };
  try {
    session(env);
    const inline = [...env.window.document.querySelectorAll('script')].find(script => !script.src).textContent;
    env.window.eval(inline); await tick();
    await assert.rejects(env.window.adminApi('admin_home'), /Saída pendente/);
    assert.equal(requests, 0); assert.ok(env.calls.every(call => call.name === 'training_admin_logout'));
  } finally { env.close(); }
});
for (const page of ['agendamento.html','inscricao.html']) test(`Pending admin logout preserves the public ${page} page`, async () => {
  const env = environment(page, `https://training.test/${page}`); env.window.localStorage.setItem(pendingKey, 'true');
  try { session(env); await tick(); assert.ok(env.window.document.querySelector('main').textContent.length > 0); assert.equal(env.window.document.getElementById('admin-logout-status'), null); assert.equal(env.calls.length, 0); } finally { env.close(); }
});
test('Login saves the token once and excludes it from the cached admin profile', async () => {
  const env = environment('index.html', 'https://training.test/index.html', () => ({ data: { success: true, session_token: fakeToken, username: 'test' } }));
  try {
    session(env);
    const inline = [...env.window.document.querySelectorAll('script')].find(script => !script.src).textContent;
    env.window.eval(inline);
    env.window.document.getElementById('admin-username').value = 'test'; env.window.document.getElementById('admin-password').value = 'synthetic-password';
    env.window.document.getElementById('admin-login-form').dispatchEvent(new env.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
    assert.equal(env.window.localStorage.getItem(tokenKey), fakeToken);
    assert.equal(JSON.parse(env.window.localStorage.getItem(profileKey)).session_token, undefined);
    assert.equal(env.calls[0].name, 'training_admin_login');
  } finally { env.close(); }
});
test('Logout blocks another administrative handler in the same event turn', async () => {
  const env = environment(null, null, () => ({ error: { message: 'offline' } })); seed(env);
  try { const lifecycle = session(env); const exit = lifecycle.logout(env.client); assert.equal(lifecycle.isLocked(), true); await assert.rejects(lifecycle.rpc(env.client, 'training_admin_update_user', {}), /Saída pendente/); await exit; assert.equal(env.calls.length, 1); } finally { env.close(); }
});
