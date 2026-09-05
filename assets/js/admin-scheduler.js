(function () {
  'use strict';

  const CONFIG = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const TOKEN_KEYS = ['jorlan_admin_session_token', 'jorlanTrainingAdminToken'];
  let sb = null;
  const state = { view: 'future', slots: [], courses: [], expanded: new Set(), courseFilter: 'all', editingSlot: null, editingCourse: null };

  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function token() { for (const k of TOKEN_KEYS) { const v = localStorage.getItem(k) || sessionStorage.getItem(k); if (v) return v; } return ''; }
  function client() { if (!window.supabase || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return null; if (!sb) sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY); return sb; }
  async function rpc(name, params) { const c = client(); if (!c) throw new Error('Supabase não configurado.'); const { data, error } = await c.rpc(name, params || {}); if (error) throw new Error(error.message || 'Erro na comunicação com o banco.'); return typeof data === 'string' ? JSON.parse(data) : data; }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  function fmtDateBR(date){const [y,m,d]=String(date||'').slice(0,10).split('-');return d&&m&&y?`${d}/${m}/${y}`:String(date||'');}
  const normDate = d => String(d || '').slice(0,10);
  const normTime = t => String(t || '').slice(0,5);
  const isFutureOrToday = s => normDate(s.date) >= today();
  const digitsOnly = v => String(v || '').replace(/\D/g,'');
  function brPhone(v){let d=digitsOnly(v);if(!d)return'';if(d.startsWith('55')&&d.length>=12)return d;if(d.length>=10&&d.length<=11)return'55'+d;return d;}
  function bookingName(b){return b.name||b.participant_name||'';}
  function bookingRole(b){return b.role||b.participant_role||'';}
  function bookingStore(b){return b.store||b.participant_store||'';}
  function bookingCity(b){return b.city||b.participant_city||'';}
  function bookingPhone(b){return b.phone||b.participant_phone||'';}
  function bookingEmail(b){return b.email||b.participant_email||'';}
  function managerName(b){return b.managerName||b.manager_name||'';}
  function managerPhone(b){return b.managerPhone||b.manager_phone||'';}
  function managerDigits(b){return b.managerPhoneDigits||b.manager_phone_digits||digitsOnly(managerPhone(b));}
  function attendanceStatus(b){return b.attendanceStatus||b.attendance_status||'pending';}
  function attendanceToken(b){return b.attendanceToken||b.attendance_token||'';}
  function statusLabel(s){return ({pending:'Pendente',confirmed:'Confirmou',present:'Presente',absent:'Faltou'})[String(s||'pending')]||s;}
  function chipClass(s){s=String(s||'pending'); if(s==='present'||s==='confirmed')return'ok'; if(s==='absent')return'bad'; return'wait';}
  function presenceUrl(b){const t=attendanceToken(b);if(!t)return'';return `${location.origin}${location.pathname.replace(/painel-administrador\.html$/,'presenca.html')}?token=${encodeURIComponent(t)}`;}
  function presenceMessage(b, slot){return `Olá, ${bookingName(b)}! Tudo bem?\n\nConfirme sua presença no treinamento ${slot.courseName || 'Grupo Jorlan'} de ${fmtDateBR(slot.date)} às ${slot.time}.\n\nClique aqui para confirmar:\n${presenceUrl(b)}\n\nObrigado.`;}
  function normalizeSlot(s){
    const bookings=s.bookings||s.participants||[];
    const capacity=Number(s.capacity||s.max_capacity||8);
    const occupied=Number(s.occupied??s.booked??bookings.length??0);
    return {raw:s,id:s.id||s.slot_id,course_id:s.course_id||s.courseId,courseName:s.courseName||s.course_name||'Do Laudo ao Lucro',courseSlug:s.courseSlug||s.course_slug||'',date:normDate(s.date||s.slot_date),time:normTime(s.time||s.slot_time),capacity,occupied,remaining:Number(s.remaining??s.available??Math.max(0,capacity-occupied)),blocked:Boolean(s.blocked??!s.is_open),bookings};
  }
  const activeCourses = () => state.courses.filter(c => c.is_active !== false);
  const defaultCourseId = () => activeCourses()[0]?.id || state.courses[0]?.id || '';

  function injectStyles(){
    if($('schedulerOperationalStyles')) return;
    const style=document.createElement('style'); style.id='schedulerOperationalStyles'; style.textContent=`
      #panel-agenda .stats,#panel-agenda .toolbar,#panel-agenda #agenda-grid,#panel-agenda #agenda-warning{display:none!important}
      .op-card{background:#fff;border-radius:22px;box-shadow:0 10px 32px rgba(0,0,0,.06);padding:16px;margin-bottom:14px}.op-top{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.op-top h2{margin:0;font-size:25px;line-height:1;font-weight:950;letter-spacing:-.04em}.op-top p{margin:4px 0 0;color:#6e727a;font-size:13px;font-weight:650}
      .op-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.op-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line,#d9d4cc);background:#fff;color:var(--ink,#121314);border-radius:12px;padding:7px 10px;font-size:12px;font-weight:850;cursor:pointer;text-decoration:none;min-height:34px;white-space:nowrap}.op-btn.dark{background:#0a0a0b;color:#fff;border-color:#0a0a0b}.op-btn.danger{background:#fff7f6;color:#b33a2d;border-color:#ebcdc8}.op-btn.success{background:#f0fbf4;color:#256947;border-color:#cae7d7}.op-btn.active{background:#0a0a0b;color:#fff;border-color:#0a0a0b}
      .op-field{display:flex;flex-direction:column;gap:4px}.op-field label{font-size:10px;font-weight:900;color:#565960;text-transform:uppercase;letter-spacing:.05em}.op-field input,.op-field select,.op-field textarea{border:1px solid var(--line,#d9d4cc);border-radius:12px;padding:7px 10px;min-height:34px;background:#fff;font-size:12px}.op-field textarea{min-height:74px;resize:vertical}
      .op-table-wrap{overflow:auto;border:1px solid #ece7e0;border-radius:18px;background:#fff}.op-table{width:100%;border-collapse:collapse;min-width:1180px;background:#fff}.op-table th{text-align:left;padding:10px 9px;background:#f7f4f0;color:#565960;font-size:10px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}.op-table td{padding:9px;border-top:1px solid #efebe5;vertical-align:middle;font-size:12px;line-height:1.25}.op-slot-row td{background:#fff}.op-slot-row strong{font-size:14px}
      .op-participants-cell{background:#fbfaf8!important;padding:0!important}.op-participants-box{padding:10px 12px 12px;border-top:1px solid #eee8df}.op-participants-title{font-size:11px;font-weight:950;text-transform:uppercase;letter-spacing:.05em;color:#565960;margin:0 0 8px}.op-participant-grid{display:grid;grid-template-columns:1.25fr .95fr 1.25fr 1.15fr 90px 310px;gap:10px;align-items:center}.op-participant-head{background:#f7f4f0;border:1px solid #eee8df;border-radius:12px;padding:8px 10px;color:#565960;font-size:10px;font-weight:950;text-transform:uppercase;letter-spacing:.05em}.op-participant-row{background:#fff;border:1px solid #eee8df;border-radius:14px;padding:9px 10px;margin-top:7px}.op-participant-row b{display:block;font-size:13px}.op-participant-row span,.op-participant-row small{display:block;color:#6e727a;font-size:11px;margin-top:1px}.op-participant-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}.op-phone{font-weight:850;color:#121314!important}.op-manager b{font-size:12px}.op-chip{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:5px 8px;font-size:11px;font-weight:900;white-space:nowrap}.op-chip.ok{background:#e7f5ee;color:#256947}.op-chip.bad{background:#f8e8e6;color:#b33a2d}.op-chip.wait{background:#fff8dd;color:#7c5c14}.op-chip.closed{background:#f8e8e6;color:#b33a2d}.op-chip.open{background:#e7f5ee;color:#256947}
      .op-empty{padding:18px;color:#6e727a;font-weight:750}.op-feedback{display:none;margin-bottom:12px;border-radius:14px;padding:11px 13px;font-size:13px;font-weight:800}.op-feedback.show{display:block}.op-feedback.success{background:#e7f5ee;color:#256947}.op-feedback.error{background:#f8e8e6;color:#b33a2d}.op-courses{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.op-course{border:1px solid #eee8df;border-radius:16px;padding:12px;background:#fcfbfa}.op-course h3{margin:0 0 5px;font-size:15px}.op-course p{margin:0;color:#6e727a;font-size:12px}.op-course small{display:block;margin-top:7px;color:#565960;font-weight:850}
      .op-modal{position:fixed;inset:0;background:rgba(0,0,0,.38);display:none;align-items:center;justify-content:center;padding:18px;z-index:999}.op-modal.show{display:flex}.op-modal-card{width:min(100%,680px);background:#fff;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,.18);padding:22px;max-height:92vh;overflow:auto}.op-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.op-modal-head h3{margin:0;font-size:28px;line-height:1;font-weight:950;letter-spacing:-.04em}.op-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      @media(max-width:900px){.op-table{min-width:980px}.op-participant-grid{grid-template-columns:1fr}.op-participant-head{display:none}.op-participant-actions{justify-content:flex-start}.op-grid{grid-template-columns:1fr}.op-top{align-items:flex-start}}
    `; document.head.appendChild(style);
  }

  async function load(){
    const data = await rpc('training_admin_get_state',{p_session_token:token()});
    state.courses = (data.courses || []).map(c=>({id:c.id,name:c.name,slug:c.slug,description:c.description||'',default_duration_minutes:Number(c.default_duration_minutes||120),exam_duration_minutes:Number(c.exam_duration_minutes||15),is_active:c.is_active!==false}));
    if(!state.courses.length){ try { state.courses = await rpc('training_admin_list_courses',{p_session_token:token()}); } catch(_) {} }
    state.slots = (data.slots || []).map(normalizeSlot).sort((a,b)=>(a.date+a.time+a.courseName).localeCompare(b.date+b.time+b.courseName));
  }

  function filteredSlots(){
    let rows=state.slots.filter(s=>{
      if(state.courseFilter!=='all' && String(s.course_id)!==String(state.courseFilter)) return false;
      return state.view==='future' ? isFutureOrToday(s) : (!isFutureOrToday(s) && Number(s.occupied)>0);
    });
    rows.sort((a,b)=> state.view==='future' ? (a.date+a.time+a.courseName).localeCompare(b.date+b.time+b.courseName) : (b.date+b.time+b.courseName).localeCompare(a.date+a.time+a.courseName));
    return rows;
  }
  function ensureRoot(){const panel=$('panel-agenda'); if(!panel)return null; let root=$('opAgenda'); if(!root){root=document.createElement('div');root.id='opAgenda';panel.prepend(root);} return root;}
  function feedback(type,msg){const box=$('opFeedback'); if(!box){alert(msg);return;} box.className='op-feedback show '+(type==='success'?'success':'error'); box.textContent=msg; box.scrollIntoView({behavior:'smooth',block:'nearest'});}

  function render(){
    const root=ensureRoot(); if(!root)return;
    const rows=filteredSlots();
    root.innerHTML=`<div id="opFeedback" class="op-feedback"></div>${renderCourses()}${renderAgenda(rows)}${renderModals()}`;
    bindRendered();
  }
  function renderCourses(){return `<section class="op-card"><div class="op-top"><div><h2>Cursos</h2><p>O curso atual fica preservado. Novas agendas podem ser criadas por curso.</p></div><div class="op-actions"><button class="op-btn dark" id="opNewCourse">+ Novo curso</button></div></div><div class="op-courses">${state.courses.map(c=>`<article class="op-course"><div class="op-actions" style="justify-content:space-between"><h3>${esc(c.name)}</h3><span class="op-chip ${c.is_active?'ok':'bad'}">${c.is_active?'Ativo':'Inativo'}</span></div><p>${esc(c.description||'Sem descrição.')}</p><small>Curso: ${c.default_duration_minutes} min • Prova: ${c.exam_duration_minutes} min</small><div class="op-actions" style="margin-top:10px"><button class="op-btn" data-edit-course="${esc(c.id)}">Editar curso</button></div></article>`).join('')||'<div class="op-empty">Nenhum curso cadastrado.</div>'}</div></section>`;}
  function renderAgenda(rows){return `<section class="op-card"><div class="op-top"><div><h2>Agenda de turmas</h2><p>${state.view==='future'?'Turmas futuras, começando de hoje.':'Turmas finalizadas com inscritos. Turma vazia no passado não aparece.'}</p></div><div class="op-actions"><button class="op-btn dark" id="opNewSlot">+ Nova turma</button><button class="op-btn ${state.view==='future'?'active':''}" data-view="future">Futuras</button><button class="op-btn ${state.view==='past'?'active':''}" data-view="past">Finalizadas</button><div class="op-field"><label>Curso</label><select id="opCourseFilter"><option value="all">Todos</option>${state.courses.map(c=>`<option value="${esc(c.id)}" ${state.courseFilter===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><button class="op-btn" id="opRefresh">Atualizar</button><button class="op-btn" id="opExport">Exportar Excel</button></div></div><div class="op-table-wrap"><table class="op-table"><thead><tr><th>Curso</th><th>Data</th><th>Hora</th><th>Status</th><th>Capacidade</th><th>Inscritos</th><th>Vagas</th><th>Ações</th></tr></thead><tbody>${rows.length?rows.map(renderSlotRow).join(''):'<tr><td colspan="8"><div class="op-empty">Nenhuma turma nesta visão.</div></td></tr>'}</tbody></table></div></section>`;}
  function renderSlotRow(slot){
    const expanded=state.expanded.has(slot.id);
    let html=`<tr class="op-slot-row"><td><strong>${esc(slot.courseName)}</strong></td><td><strong>${esc(fmtDateBR(slot.date))}</strong></td><td>${esc(slot.time)}</td><td><span class="op-chip ${slot.blocked?'closed':'open'}">${slot.blocked?'Fechada':'Aberta'}</span></td><td>${slot.capacity}</td><td>${slot.occupied}</td><td>${slot.remaining}</td><td><div class="op-actions"><button class="op-btn" data-toggle-expand="${esc(slot.id)}">${expanded?'Ocultar':'Inscritos'}</button><button class="op-btn" data-edit-slot="${esc(slot.id)}">Editar</button><button class="op-btn ${slot.blocked?'success':'danger'}" data-toggle-slot="${esc(slot.id)}">${slot.blocked?'Reabrir':'Fechar'}</button><button class="op-btn" data-send-slot="${esc(slot.id)}">Enviar confirmação</button></div></td></tr>`;
    if(expanded) html += `<tr><td colspan="8" class="op-participants-cell">${renderParticipants(slot)}</td></tr>`;
    return html;
  }
  function renderParticipants(slot){
    const rows=slot.bookings||[];
    if(!rows.length) return '<div class="op-participants-box"><div class="op-empty">Sem inscritos nesta turma.</div></div>';
    return `<div class="op-participants-box"><div class="op-participants-title">Inscritos da turma</div><div class="op-participant-grid op-participant-head"><div>Participante</div><div>Telefone</div><div>E-mail</div><div>Loja</div><div>Presença</div><div>Ações</div></div>${rows.map(b=>renderParticipant(slot,b)).join('')}</div>`;
  }
  function renderParticipant(slot,b){
    const phone=bookingPhone(b), mgr=managerName(b), mgrPhone=managerPhone(b), status=attendanceStatus(b);
    return `<div class="op-participant-grid op-participant-row"><div><b>${esc(bookingName(b)||'-')}</b><span>${esc(bookingRole(b)||'-')}</span></div><div><span class="op-phone">${esc(phone||'-')}</span>${phone?`<a href="tel:+${brPhone(phone)}">Ligar</a>`:''}</div><div><b>${esc(bookingEmail(b)||'-')}</b></div><div><b>${esc(bookingStore(b)||'-')}</b><span>${esc(bookingCity(b)||'')}</span>${mgr?`<small class="op-manager">Gerente: <b>${esc(mgr)}</b>${mgrPhone?' • '+esc(mgrPhone):''}</small>`:''}</div><div><span class="op-chip ${chipClass(status)}">${esc(statusLabel(status))}</span></div><div class="op-participant-actions"><button class="op-btn" data-wa-presence="${esc(b.id)}" data-slot-id="${esc(slot.id)}">WhatsApp presença</button><button class="op-btn success" data-attendance="${esc(b.id)}" data-status="present">Presente</button><button class="op-btn" data-attendance="${esc(b.id)}" data-status="pending">Pendente</button><button class="op-btn danger" data-attendance="${esc(b.id)}" data-status="absent">Faltou</button>${managerDigits(b)?`<button class="op-btn" data-wa-manager="${esc(managerDigits(b))}">WhatsApp gerente</button>`:''}</div></div>`;
  }

  function renderModals(){return `<div class="op-modal" id="opSlotModal"><div class="op-modal-card"><div class="op-modal-head"><h3 id="opSlotTitle">Nova turma</h3><button class="op-btn" data-close-modal>Fechar</button></div><div class="op-grid"><div class="op-field"><label>Curso</label><select id="opSlotCourse">${state.courses.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div><div class="op-field"><label>Data</label><input id="opSlotDate" type="date"></div><div class="op-field"><label>Horário</label><input id="opSlotTime" type="time" value="10:00"></div><div class="op-field"><label>Participantes/vagas</label><input id="opSlotCapacity" type="number" min="1" max="99" value="20"></div><div class="op-field"><label>Status</label><select id="opSlotOpen"><option value="true">Aberta</option><option value="false">Fechada</option></select></div></div><div class="op-actions" style="margin-top:16px"><button class="op-btn dark" id="opSaveSlot">Salvar turma</button><button class="op-btn" data-close-modal>Cancelar</button></div></div></div><div class="op-modal" id="opCourseModal"><div class="op-modal-card"><div class="op-modal-head"><h3 id="opCourseTitle">Novo curso</h3><button class="op-btn" data-close-modal>Fechar</button></div><div class="op-grid"><div class="op-field"><label>Nome</label><input id="opCourseName"></div><div class="op-field"><label>Ativo</label><select id="opCourseActive"><option value="true">Ativo</option><option value="false">Inativo</option></select></div><div class="op-field"><label>Duração do curso</label><input id="opCourseDuration" type="number" min="15" value="120"></div><div class="op-field"><label>Duração da prova</label><input id="opExamDuration" type="number" min="5" value="15"></div><div class="op-field" style="grid-column:1/-1"><label>Descrição</label><textarea id="opCourseDescription"></textarea></div></div><div class="op-actions" style="margin-top:16px"><button class="op-btn dark" id="opSaveCourse">Salvar curso</button><button class="op-btn" data-close-modal>Cancelar</button></div></div></div>`;}

  function bindRendered(){
    $('opNewSlot')?.addEventListener('click',()=>openSlotModal(null));
    $('opNewCourse')?.addEventListener('click',()=>openCourseModal(null));
    $('opRefresh')?.addEventListener('click',reload);
    $('opExport')?.addEventListener('click',exportExcel);
    $('opCourseFilter')?.addEventListener('change',e=>{state.courseFilter=e.target.value;render();});
    qsa('[data-view]').forEach(b=>b.addEventListener('click',()=>{state.view=b.dataset.view;render();}));
    qsa('[data-toggle-expand]').forEach(b=>b.addEventListener('click',()=>{const id=b.dataset.toggleExpand;state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id);render();}));
    qsa('[data-edit-slot]').forEach(b=>b.addEventListener('click',()=>openSlotModal(findSlot(b.dataset.editSlot))));
    qsa('[data-toggle-slot]').forEach(b=>b.addEventListener('click',()=>toggleSlot(findSlot(b.dataset.toggleSlot))));
    qsa('[data-send-slot]').forEach(b=>b.addEventListener('click',()=>sendSlot(findSlot(b.dataset.sendSlot))));
    qsa('[data-attendance]').forEach(b=>b.addEventListener('click',()=>markAttendance(b.dataset.attendance,b.dataset.status)));
    qsa('[data-wa-presence]').forEach(b=>b.addEventListener('click',()=>sendPresence(findBooking(b.dataset.waPresence),findSlot(b.dataset.slotId))));
    qsa('[data-wa-manager]').forEach(b=>b.addEventListener('click',()=>window.open(`https://wa.me/${brPhone(b.dataset.waManager)}`,'_blank','noopener')));
    qsa('[data-edit-course]').forEach(b=>b.addEventListener('click',()=>openCourseModal(state.courses.find(c=>String(c.id)===String(b.dataset.editCourse)))));
    qsa('[data-close-modal]').forEach(b=>b.addEventListener('click',closeModals));
    $('opSaveSlot')?.addEventListener('click',saveSlot);
    $('opSaveCourse')?.addEventListener('click',saveCourse);
  }
  function findSlot(id){return state.slots.find(s=>String(s.id)===String(id));}
  function findBooking(id){for(const s of state.slots){const b=(s.bookings||[]).find(x=>String(x.id)===String(id)); if(b)return b;} return null;}
  function closeModals(){qsa('.op-modal').forEach(m=>m.classList.remove('show')); state.editingSlot=null; state.editingCourse=null;}
  function openSlotModal(slot){state.editingSlot=slot; $('opSlotTitle').textContent=slot?'Editar turma':'Nova turma'; $('opSlotCourse').value=slot?.course_id||defaultCourseId(); $('opSlotDate').value=slot?.date||today(); $('opSlotTime').value=slot?.time||'10:00'; $('opSlotCapacity').value=slot?.capacity||20; $('opSlotOpen').value=slot?.blocked?'false':'true'; $('opSlotModal').classList.add('show');}
  function openCourseModal(course){state.editingCourse=course; $('opCourseTitle').textContent=course?'Editar curso':'Novo curso'; $('opCourseName').value=course?.name||''; $('opCourseDescription').value=course?.description||''; $('opCourseDuration').value=course?.default_duration_minutes||120; $('opExamDuration').value=course?.exam_duration_minutes||15; $('opCourseActive').value=course?.is_active===false?'false':'true'; $('opCourseModal').classList.add('show');}
  async function saveSlot(){
    try{const payload={p_session_token:token(),p_slot_date:$('opSlotDate').value,p_slot_time:$('opSlotTime').value,p_capacity:Number($('opSlotCapacity').value),p_is_open:$('opSlotOpen').value==='true',p_course_id:$('opSlotCourse').value}; if(state.editingSlot){payload.p_slot_id=state.editingSlot.id; await rpc('training_admin_update_slot',payload); feedback('success','Turma atualizada.');} else {await rpc('training_admin_create_custom_slot',payload); feedback('success','Turma criada.');} closeModals(); await reload();}
    catch(e){feedback('error',e.message||'Não foi possível salvar turma.');}
  }
  async function saveCourse(){try{await rpc('training_admin_save_course',{p_session_token:token(),p_course_id:state.editingCourse?.id||null,p_name:$('opCourseName').value.trim(),p_description:$('opCourseDescription').value.trim(),p_default_duration_minutes:Number($('opCourseDuration').value||120),p_exam_duration_minutes:Number($('opExamDuration').value||15),p_is_active:$('opCourseActive').value==='true'}); feedback('success','Curso salvo.'); closeModals(); await reload();}catch(e){feedback('error',e.message||'Não foi possível salvar curso.');}}
  async function toggleSlot(slot){if(!slot)return; try{await rpc(slot.blocked?'training_admin_open_slot':'training_admin_close_slot',{p_session_token:token(),p_slot_id:slot.id}); feedback('success',slot.blocked?'Inscrições reabertas.':'Inscrições fechadas.'); await reload();}catch(e){feedback('error',e.message||'Não foi possível alterar status.');}}
  async function markAttendance(bookingId,status){try{await rpc('training_admin_mark_attendance',{p_session_token:token(),p_booking_id:bookingId,p_attendance_status:status}); feedback('success','Presença atualizada.'); await reload();}catch(e){feedback('error',e.message||'Não foi possível atualizar presença.');}}
  function sendPresence(b,slot){if(!b||!slot)return; const phone=brPhone(bookingPhone(b)); if(!phone)return alert('Telefone do candidato não localizado.'); window.open(`https://wa.me/${phone}?text=${encodeURIComponent(presenceMessage(b,slot))}`,'_blank','noopener');}
  function sendSlot(slot){if(!slot)return; const list=(slot.bookings||[]).filter(b=>brPhone(bookingPhone(b))); if(!list.length)return alert('Nenhum telefone encontrado nesta turma.'); if(!confirm(`Abrir WhatsApp para ${list.length} inscrito(s)?`))return; list.forEach((b,i)=>setTimeout(()=>sendPresence(b,slot),i*350));}
  async function reload(){try{await load();render();}catch(e){feedback('error',e.message||'Não foi possível carregar agenda.');}}
  async function ensureXlsx(){if(window.XLSX)return; await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s);});}
  async function exportExcel(){try{await ensureXlsx(); const rows=[]; filteredSlots().forEach(s=>{(s.bookings||[]).forEach(b=>rows.push({'Curso':s.courseName,'Data':fmtDateBR(s.date),'Hora':s.time,'Status turma':s.blocked?'Fechada':'Aberta','Participante':bookingName(b),'Cargo':bookingRole(b),'Telefone':bookingPhone(b),'Email':bookingEmail(b),'Loja':bookingStore(b),'Cidade':bookingCity(b),'Gerente':managerName(b),'Telefone gerente':managerPhone(b),'Presença':statusLabel(attendanceStatus(b))}));}); const wb=XLSX.utils.book_new(); const ws=XLSX.utils.json_to_sheet(rows); XLSX.utils.book_append_sheet(wb,ws,'Participantes'); XLSX.writeFile(wb,'agenda_treinamentos.xlsx');}catch(e){feedback('error','Não foi possível exportar Excel.');}}
  async function start(){if(!token()||!client()||!$('panel-agenda'))return; injectStyles(); const root=ensureRoot(); if(root)root.innerHTML='<section class="op-card"><div class="op-empty">Carregando agenda...</div></section>'; await reload();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start); else start();
})();
