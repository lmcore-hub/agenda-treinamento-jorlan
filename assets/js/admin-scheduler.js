(function () {
  'use strict';

  const CONFIG = window.JORLAN_TRAINING_CONFIG || window.APP_CONFIG || {};
  const TOKEN_KEYS = ['jorlan_admin_session_token', 'jorlanTrainingAdminToken'];
  let sb = null;
  const state = { view: 'future', slots: [], courses: [], expanded: new Set(), courseFilter: 'all' };

  function $(id) { return document.getElementById(id); }
  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
  function token() { for (const k of TOKEN_KEYS) { const v = localStorage.getItem(k) || sessionStorage.getItem(k); if (v) return v; } return ''; }
  function client() { if (!window.supabase || !CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_ANON_KEY) return null; if (!sb) sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY); return sb; }
  async function rpc(name, params) { const c = client(); if (!c) throw new Error('Supabase não configurado.'); const { data, error } = await c.rpc(name, params || {}); if (error) throw new Error(error.message || 'Erro na comunicação com o banco.'); return data; }
  function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
  function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function fmtDateBR(date){const [y,m,d]=String(date||'').slice(0,10).split('-');return d&&m&&y?`${d}/${m}/${y}`:String(date||'')}
  function normDate(d){return String(d||'').slice(0,10)}
  function normTime(t){return String(t||'').slice(0,5)}
  function isFutureOrToday(slot){return normDate(slot.date) >= today()}
  function bookingName(b){return b.name||b.participant_name||''}
  function bookingRole(b){return b.role||b.participant_role||''}
  function bookingStore(b){return b.store||b.participant_store||''}
  function bookingCity(b){return b.city||b.participant_city||''}
  function bookingPhone(b){return b.phone||b.participant_phone||''}
  function bookingEmail(b){return b.email||b.participant_email||''}
  function managerName(b){return b.managerName||b.manager_name||''}
  function managerPhone(b){return b.managerPhone||b.manager_phone||''}
  function managerDigits(b){return b.managerPhoneDigits||b.manager_phone_digits||digitsOnly(managerPhone(b))}
  function attendanceStatus(b){return b.attendanceStatus||b.attendance_status||'pending'}
  function attendanceToken(b){return b.attendanceToken||b.attendance_token||''}
  function digitsOnly(v){return String(v||'').replace(/\D/g,'')}
  function brPhone(v){let d=digitsOnly(v);if(!d)return'';if(d.startsWith('55')&&d.length>=12)return d;if(d.length>=10&&d.length<=11)return'55'+d;return d}
  function presenceUrl(b){const t=attendanceToken(b);if(!t)return'';return `${location.origin}${location.pathname.replace(/painel-administrador\.html$/,'presenca.html')}?token=${encodeURIComponent(t)}`}
  function presenceMessage(b, slot){return `Olá, ${bookingName(b)}! Tudo bem?\n\nConfirme sua presença no treinamento ${slot.courseName || 'Grupo Jorlan'} de ${fmtDateBR(slot.date)} às ${slot.time}.\n\nClique aqui para confirmar:\n${presenceUrl(b)}\n\nObrigado.`}
  function statusLabel(s){return ({pending:'Pendente',confirmed:'Confirmou',present:'Presente',absent:'Faltou'})[String(s||'pending')]||s}
  function chipClass(s){s=String(s||'pending'); if(s==='present'||s==='confirmed')return'ok'; if(s==='absent')return'bad'; return'wait'}
  function normalizeSlot(s){const bookings=s.bookings||[];const capacity=Number(s.capacity||8);const occupied=Number(s.occupied??s.booked??bookings.length??0);return{raw:s,id:s.id||s.slot_id,course_id:s.course_id||s.courseId,courseName:s.courseName||s.course_name||'Do Laudo ao Lucro',courseSlug:s.courseSlug||s.course_slug||'',date:normDate(s.date||s.slot_date),time:normTime(s.time||s.slot_time),capacity,occupied,remaining:Number(s.remaining??s.available??Math.max(0,capacity-occupied)),blocked:Boolean(s.blocked??!s.is_open),bookings};}
  function activeCourses(){return state.courses.filter(c=>c.is_active!==false)}
  function defaultCourseId(){return activeCourses()[0]?.id || state.courses[0]?.id || ''}

  function injectStyles(){
    if($('schedulerOperationalStyles'))return;
    const style=document.createElement('style'); style.id='schedulerOperationalStyles'; style.textContent=`
      #panel-agenda .stats,#panel-agenda .toolbar,#panel-agenda #agenda-grid,#panel-agenda #agenda-warning{display:none!important}
      .op-card{background:#fff;border-radius:22px;box-shadow:0 10px 32px rgba(0,0,0,.06);padding:16px;margin-bottom:14px}
      .op-top{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}.op-top h2{margin:0;font-size:25px;line-height:1;font-weight:950;letter-spacing:-.04em}.op-top p{margin:4px 0 0;color:#6e727a;font-size:13px;font-weight:650}
      .op-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.op-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line,#d9d4cc);background:#fff;color:var(--ink,#121314);border-radius:12px;padding:7px 10px;font-size:12px;font-weight:850;cursor:pointer;text-decoration:none;min-height:34px;white-space:nowrap}.op-btn.dark{background:#0a0a0b;color:#fff;border-color:#0a0a0b}.op-btn.danger{background:#fff7f6;color:#b33a2d;border-color:#ebcdc8}.op-btn.success{background:#f0fbf4;color:#256947;border-color:#cae7d7}.op-btn.active{background:#0a0a0b;color:#fff;border-color:#0a0a0b}
      .op-field{display:flex;flex-direction:column;gap:4px}.op-field label{font-size:10px;font-weight:900;color:#565960;text-transform:uppercase;letter-spacing:.05em}.op-field input,.op-field select,.op-field textarea{border:1px solid var(--line,#d9d4cc);border-radius:12px;padding:7px 10px;min-height:34px;background:#fff;font-size:12px}.op-field textarea{min-height:74px;resize:vertical}
      .op-table-wrap{overflow:auto;border:1px solid #ece7e0;border-radius:18px;background:#fff}.op-table{width:100%;border-collapse:collapse;min-width:1260px;background:#fff}.op-table th{text-align:left;padding:10px 9px;background:#f7f4f0;color:#565960;font-size:10px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}.op-table td{padding:9px;border-top:1px solid #efebe5;vertical-align:middle;font-size:12px;line-height:1.25}.op-slot-row td{background:#fff}.op-slot-row strong{font-size:14px}.op-booking-row td{background:#fcfbfa}
      .op-booking-line{display:grid;grid-template-columns:minmax(180px,1.15fr) 90px minmax(150px,1fr) minmax(170px,1.1fr) minmax(150px,.9fr) 96px minmax(360px,1.6fr);gap:10px;align-items:center;width:100%}.op-booking-line b{display:block;font-size:13px}.op-booking-line span{display:block;color:#6e727a;font-size:11px;margin-top:1px}.op-phone{font-weight:850;color:#121314!important}
      .op-chip{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:5px 8px;font-size:11px;font-weight:900;white-space:nowrap}.op-chip.ok{background:#e7f5ee;color:#256947}.op-chip.bad{background:#f8e8e6;color:#b33a2d}.op-chip.wait{background:#fff8dd;color:#7c5c14}.op-chip.closed{background:#f8e8e6;color:#b33a2d}.op-chip.open{background:#e7f5ee;color:#256947}
      .op-empty{padding:18px;color:#6e727a;font-weight:750}.op-feedback{display:none;margin-bottom:12px;border-radius:14px;padding:11px 13px;font-size:13px;font-weight:800}.op-feedback.show{display:block}.op-feedback.success{background:#e7f5ee;color:#256947}.op-feedback.error{background:#f8e8e6;color:#b33a2d}
      .op-courses{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px}.op-course{border:1px solid #eee8df;border-radius:16px;padding:12px;background:#fcfbfa}.op-course h3{margin:0 0 5px;font-size:15px}.op-course p{margin:0;color:#6e727a;font-size:12px}.op-course small{display:block;margin-top:7px;color:#565960;font-weight:850}
      .op-modal{position:fixed;inset:0;background:rgba(0,0,0,.38);display:none;align-items:center;justify-content:center;padding:18px;z-index:999}.op-modal.show{display:flex}.op-modal-card{width:min(100%,680px);background:#fff;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,.18);padding:22px;max-height:92vh;overflow:auto}.op-modal-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:14px}.op-modal-head h3{margin:0;font-size:28px;line-height:1;font-weight:950;letter-spacing:-.04em}.op-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
      @media(max-width:760px){.op-table{min-width:1080px}.op-booking-line{grid-template-columns:1fr}.op-grid{grid-template-columns:1fr}.op-top{align-items:flex-start}}
    `; document.head.appendChild(style);
  }

  async function load(){
    const data=await rpc('training_admin_get_state',{p_session_token:token()});
    const parsed=typeof data==='string'?JSON.parse(data):data;
    state.courses=(parsed.courses||[]).map(c=>({id:c.id,name:c.name,slug:c.slug,description:c.description||'',default_duration_minutes:Number(c.default_duration_minutes||120),exam_duration_minutes:Number(c.exam_duration_minutes||15),is_active:c.is_active!==false}));
    state.slots=(parsed.slots||[]).map(normalizeSlot).sort((a,b)=>(a.date+a.time+a.courseName).localeCompare(b.date+b.time+b.courseName));
  }

  function filteredSlots(){
    let rows=state.slots.filter(s=>{
      if(state.courseFilter!=='all' && String(s.course_id)!==String(state.courseFilter)) return false;
      if(state.view==='future') return isFutureOrToday(s);
      return !isFutureOrToday(s) && Number(s.occupied)>0;
    });
    if(state.view==='future') rows.sort((a,b)=>(a.date+a.time+a.courseName).localeCompare(b.date+b.time+b.courseName));
    else rows.sort((a,b)=>(b.date+b.time+b.courseName).localeCompare(a.date+a.time+a.courseName));
    return rows;
  }

  function ensureRoot(){
    const panel=$('panel-agenda'); if(!panel)return null;
    let root=$('opAgenda'); if(!root){root=document.createElement('div'); root.id='opAgenda'; panel.prepend(root);} return root;
  }

  function render(){
    const root=ensureRoot(); if(!root)return;
    const rows=filteredSlots();
    root.innerHTML=`<div id="opFeedback" class="op-feedback"></div>${renderCourses()}${renderAgenda(rows)}${renderModal()}`;
    bindRendered();
  }

  function renderCourses(){
    return `<section class="op-card"><div class="op-top"><div><h2>Cursos</h2><p>O curso atual fica preservado. Novas agendas podem ser criadas por curso.</p></div><div class="op-actions"><button class="op-btn dark" id="opNewCourse">+ Novo curso</button></div></div><div class="op-courses">${state.courses.map(c=>`<article class="op-course"><div class="op-actions" style="justify-content:space-between"><h3>${esc(c.name)}</h3><span class="op-chip ${c.is_active?'ok':'bad'}">${c.is_active?'Ativo':'Inativo'}</span></div><p>${esc(c.description||'Sem descrição.')}</p><small>Curso: ${c.default_duration_minutes} min • Prova: ${c.exam_duration_minutes} min</small><div class="op-actions" style="margin-top:10px"><button class="op-btn" data-edit-course="${esc(c.id)}">Editar curso</button></div></article>`).join('')||'<div class="op-empty">Nenhum curso cadastrado.</div>'}</div></section>`;
  }

  function renderAgenda(rows){
    return `<section class="op-card"><div class="op-top"><div><h2>Agenda de turmas</h2><p>${state.view==='future'?'Turmas futuras, começando de hoje.':'Turmas finalizadas com inscritos. Turma vazia no passado não aparece.'}</p></div><div class="op-actions"><button class="op-btn dark" id="opNewSlot">+ Nova turma</button><button class="op-btn ${state.view==='future'?'active':''}" data-view="future">Futuras</button><button class="op-btn ${state.view==='past'?'active':''}" data-view="past">Finalizadas</button><div class="op-field"><label>Curso</label><select id="opCourseFilter"><option value="all">Todos</option>${state.courses.map(c=>`<option value="${esc(c.id)}" ${state.courseFilter===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><button class="op-btn" id="opRefresh">Atualizar</button><button class="op-btn" id="opExport">Exportar Excel</button></div></div><div class="op-table-wrap"><table class="op-table"><thead><tr><th>Curso</th><th>Data</th><th>Hora</th><th>Status</th><th>Capacidade</th><th>Inscritos</th><th>Vagas</th><th>Ações</th></tr></thead><tbody>${rows.length?rows.map(renderSlotRow).join(''):'<tr><td colspan="8"><div class="op-empty">Nenhuma turma nesta visão.</div></td></tr>'}</tbody></table></div></section>`;
  }

  function renderSlotRow(slot){
    const expanded=state.expanded.has(slot.id);
    const rows=[`<tr class="op-slot-row"><td><strong>${esc(slot.courseName)}</strong></td><td><strong>${esc(fmtDateBR(slot.date))}</strong></td><td>${esc(slot.time)}</td><td><span class="op-chip ${slot.blocked?'closed':'open'}">${slot.blocked?'Fechada':'Aberta'}</span></td><td>${slot.capacity}</td><td>${slot.occupied}</td><td>${slot.remaining}</td><td><div class="op-actions"><button class="op-btn" data-toggle-expand="${esc(slot.id)}">${expanded?'Ocultar':'Inscritos'}</button><button class="op-btn" data-edit-slot="${esc(slot.id)}">Editar</button><button class="op-btn ${slot.blocked?'success':'danger'}" data-toggle-slot="${esc(slot.id)}">${slot.blocked?'Reabrir':'Fechar'}</button><button class="op-btn" data-send-presence-all="${esc(slot.id)}">Enviar confirmação</button></div></td></tr>`];
    if(expanded){
      if(slot.bookings.length){rows.push(`<tr class="op-booking-row"><td colspan="8">${slot.bookings.map(b=>renderBookingLine(b,slot)).join('')}</td></tr>`)}
      else rows.push('<tr class="op-booking-row"><td colspan="8"><div class="op-empty">Sem inscritos nesta turma.</div></td></tr>');
    }
    return rows.join('');
  }

  function renderBookingLine(b,slot){
    const p=brPhone(bookingPhone(b)); const m=brPhone(managerDigits(b)); const status=attendanceStatus(b);
    return `<div class="op-booking-line"><div><b>${esc(bookingName(b))}</b><span>${esc(bookingRole(b)||'-')}</span></div><div><span class="op-phone">${esc(bookingPhone(b)||'-')}</span>${p?`<span><a href="tel:+${p}">Ligar</a></span>`:''}</div><div><b>${esc(bookingEmail(b)||'-')}</b></div><div><b>${esc(bookingStore(b)||'-')}</b><span>${esc(bookingCity(b)||'')}</span></div><div><b>${esc(managerName(b)||'Gerente não localizado')}</b><span>${esc(managerPhone(b)||'')}</span></div><div><span class="op-chip ${chipClass(status)}">${esc(statusLabel(status))}</span></div><div class="op-actions"><button class="op-btn" data-wa-presence="${esc(b.id)}">WhatsApp presença</button><button class="op-btn success" data-attendance="${esc(b.id)}" data-status="present">Presente</button><button class="op-btn" data-attendance="${esc(b.id)}" data-status="pending">Pendente</button><button class="op-btn danger" data-attendance="${esc(b.id)}" data-status="absent">Faltou</button>${m?`<a class="op-btn" href="https://wa.me/${m}" target="_blank" rel="noopener">WhatsApp gerente</a>`:''}</div></div>`;
  }

  function renderModal(){return `<div class="op-modal" id="opModal"><div class="op-modal-card"><div class="op-modal-head"><h3 id="opModalTitle">Editar</h3><button class="op-btn" id="opCloseModal">Fechar</button></div><div id="opModalBody"></div></div></div>`}
  function openModal(title, body){$('opModalTitle').textContent=title;$('opModalBody').innerHTML=body;$('opModal').classList.add('show');}
  function closeModal(){const m=$('opModal'); if(m)m.classList.remove('show');}
  function show(type,msg){const box=$('opFeedback'); if(!box){alert(msg);return} box.className='op-feedback show '+(type==='success'?'success':'error'); box.textContent=msg; box.scrollIntoView({behavior:'smooth',block:'nearest'});}

  function slotForm(slot){
    const courseId=slot?.course_id||defaultCourseId();
    return `<form id="opSlotForm"><input type="hidden" name="id" value="${esc(slot?.id||'')}"><div class="op-grid"><div class="op-field"><label>Curso</label><select name="course_id" required>${activeCourses().map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(courseId)?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div><div class="op-field"><label>Data</label><input name="date" type="date" value="${esc(slot?.date||today())}" required></div><div class="op-field"><label>Horário</label><input name="time" type="time" value="${esc(slot?.time||'10:00')}" required></div><div class="op-field"><label>Participantes/vagas</label><input name="capacity" type="number" min="1" max="99" value="${esc(slot?.capacity||20)}" required></div><div class="op-field"><label>Status</label><select name="is_open"><option value="true" ${!slot?.blocked?'selected':''}>Aberta</option><option value="false" ${slot?.blocked?'selected':''}>Fechada</option></select></div></div><div class="op-actions" style="margin-top:14px"><button class="op-btn dark" type="submit">Salvar turma</button><button class="op-btn" type="button" id="opCancelModal">Cancelar</button></div></form>`;
  }
  function courseForm(course){return `<form id="opCourseForm"><input type="hidden" name="id" value="${esc(course?.id||'')}"><div class="op-grid"><div class="op-field"><label>Nome do curso</label><input name="name" value="${esc(course?.name||'')}" placeholder="Ex.: Do Laudo ao Lucro" required></div><div class="op-field"><label>Status</label><select name="is_active"><option value="true" ${course?.is_active!==false?'selected':''}>Ativo</option><option value="false" ${course?.is_active===false?'selected':''}>Inativo</option></select></div><div class="op-field"><label>Duração do curso em minutos</label><input name="default_duration_minutes" type="number" min="15" max="600" value="${esc(course?.default_duration_minutes||120)}"></div><div class="op-field"><label>Duração da prova em minutos</label><input name="exam_duration_minutes" type="number" min="5" max="120" value="${esc(course?.exam_duration_minutes||15)}"></div><div class="op-field" style="grid-column:1/-1"><label>Descrição</label><textarea name="description" placeholder="Resumo do objetivo do curso">${esc(course?.description||'')}</textarea></div></div><div class="op-actions" style="margin-top:14px"><button class="op-btn dark" type="submit">Salvar curso</button><button class="op-btn" type="button" id="opCancelModal">Cancelar</button></div></form>`}

  async function saveSlot(ev){ev.preventDefault();const f=ev.currentTarget;const id=f.elements.id.value;const payload={p_session_token:token(),p_slot_date:f.elements.date.value,p_slot_time:f.elements.time.value,p_capacity:Number(f.elements.capacity.value),p_is_open:f.elements.is_open.value==='true',p_course_id:f.elements.course_id.value};try{if(id)await rpc('training_admin_update_slot',{...payload,p_slot_id:id});else await rpc('training_admin_create_custom_slot',payload);show('success','Turma salva.');closeModal();await reload();}catch(e){show('error',e.message||'Não foi possível salvar a turma.')}}
  async function saveCourse(ev){ev.preventDefault();const f=ev.currentTarget;try{await rpc('training_admin_save_course',{p_session_token:token(),p_course_id:f.elements.id.value||null,p_name:f.elements.name.value,p_description:f.elements.description.value,p_default_duration_minutes:Number(f.elements.default_duration_minutes.value||120),p_exam_duration_minutes:Number(f.elements.exam_duration_minutes.value||15),p_is_active:f.elements.is_active.value==='true'});show('success','Curso salvo.');closeModal();await reload();}catch(e){show('error',e.message||'Não foi possível salvar o curso.')}}
  async function reload(){await load();render();}
  async function markAttendance(bookingId,status){try{await rpc('training_admin_mark_attendance',{p_session_token:token(),p_booking_id:bookingId,p_attendance_status:status});show('success','Presença atualizada.');await reload();}catch(e){show('error',e.message||'Não foi possível atualizar presença.')}}
  async function toggleSlot(slot){try{if(slot.blocked)await rpc('training_admin_open_slot',{p_session_token:token(),p_slot_id:slot.id});else await rpc('training_admin_close_slot',{p_session_token:token(),p_slot_id:slot.id});show('success',slot.blocked?'Inscrições reabertas.':'Inscrições fechadas.');await reload();}catch(e){show('error',e.message||'Não foi possível alterar a turma.')}}
  function sendPresence(booking,slot){const phone=brPhone(bookingPhone(booking)); if(!phone){show('error','Telefone do candidato não localizado.');return} window.open(`https://wa.me/${phone}?text=${encodeURIComponent(presenceMessage(booking,slot))}`,'_blank','noopener');}
  function sendPresenceAll(slot){const list=slot.bookings.filter(b=>brPhone(bookingPhone(b))); if(!list.length){show('error','Nenhum telefone válido nesta turma.');return} if(!confirm(`Abrir WhatsApp para ${list.length} inscrito(s)?`))return; list.forEach((b,i)=>setTimeout(()=>sendPresence(b,slot),i*450));}
  function exportExcel(){const rows=[['Curso','Data','Hora','Status turma','Capacidade','Inscritos','Vagas','Participante','Cargo','Telefone','Email','Loja','Cidade','Gerente','Telefone gerente','Presença']];filteredSlots().forEach(s=>{if(!s.bookings.length)rows.push([s.courseName,fmtDateBR(s.date),s.time,s.blocked?'Fechada':'Aberta',s.capacity,s.occupied,s.remaining,'','','','','','','','','']);s.bookings.forEach(b=>rows.push([s.courseName,fmtDateBR(s.date),s.time,s.blocked?'Fechada':'Aberta',s.capacity,s.occupied,s.remaining,bookingName(b),bookingRole(b),bookingPhone(b),bookingEmail(b),bookingStore(b),bookingCity(b),managerName(b),managerPhone(b),statusLabel(attendanceStatus(b))]));});const html='<html><head><meta charset="utf-8"></head><body><table>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+esc(c)+'</td>').join('')+'</tr>').join('')+'</table></body></html>';const blob=new Blob([html],{type:'application/vnd.ms-excel;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='agenda_multicursos.xls';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

  function bindRendered(){
    $('opNewCourse')?.addEventListener('click',()=>{openModal('Novo curso',courseForm(null));$('opCourseForm').addEventListener('submit',saveCourse);$('opCancelModal').addEventListener('click',closeModal);});
    qsa('[data-edit-course]').forEach(btn=>btn.addEventListener('click',()=>{const c=state.courses.find(x=>String(x.id)===String(btn.dataset.editCourse));openModal('Editar curso',courseForm(c));$('opCourseForm').addEventListener('submit',saveCourse);$('opCancelModal').addEventListener('click',closeModal);}));
    $('opNewSlot')?.addEventListener('click',()=>{openModal('Nova turma',slotForm(null));$('opSlotForm').addEventListener('submit',saveSlot);$('opCancelModal').addEventListener('click',closeModal);});
    qsa('[data-edit-slot]').forEach(btn=>btn.addEventListener('click',()=>{const s=state.slots.find(x=>String(x.id)===String(btn.dataset.editSlot));openModal('Editar turma',slotForm(s));$('opSlotForm').addEventListener('submit',saveSlot);$('opCancelModal').addEventListener('click',closeModal);}));
    qsa('[data-toggle-expand]').forEach(btn=>btn.addEventListener('click',()=>{const id=btn.dataset.toggleExpand;state.expanded.has(id)?state.expanded.delete(id):state.expanded.add(id);render();}));
    qsa('[data-view]').forEach(btn=>btn.addEventListener('click',()=>{state.view=btn.dataset.view;render();}));
    $('opCourseFilter')?.addEventListener('change',ev=>{state.courseFilter=ev.target.value;render();});
    $('opRefresh')?.addEventListener('click',reload); $('opExport')?.addEventListener('click',exportExcel);
    qsa('[data-toggle-slot]').forEach(btn=>btn.addEventListener('click',()=>{const s=state.slots.find(x=>String(x.id)===String(btn.dataset.toggleSlot)); if(s)toggleSlot(s);}));
    qsa('[data-send-presence-all]').forEach(btn=>btn.addEventListener('click',()=>{const s=state.slots.find(x=>String(x.id)===String(btn.dataset.sendPresenceAll)); if(s)sendPresenceAll(s);}));
    qsa('[data-wa-presence]').forEach(btn=>btn.addEventListener('click',()=>{for(const s of state.slots){const b=s.bookings.find(x=>String(x.id)===String(btn.dataset.waPresence)); if(b){sendPresence(b,s);break;}}}));
    qsa('[data-attendance]').forEach(btn=>btn.addEventListener('click',()=>markAttendance(btn.dataset.attendance,btn.dataset.status)));
    $('opCloseModal')?.addEventListener('click',closeModal); $('opModal')?.addEventListener('click',ev=>{if(ev.target.id==='opModal')closeModal();});
  }

  async function start(){const panel=$('panel-agenda'); if(!panel||!token()||!client())return;injectStyles();try{await load();render();}catch(e){const root=ensureRoot();if(root)root.innerHTML=`<div class="op-card"><div class="op-feedback show error">${esc(e.message||'Erro ao carregar agenda multicursos.')}</div></div>`;}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
