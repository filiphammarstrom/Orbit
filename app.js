import { configured, session, signIn, signUp, signOut, loadCloudState, createCloudTask, updateCloudTask, subscribeToChanges, addComment, addTaskLink, saveDailyBrief, markNotificationRead, decideApproval, createTeam, createInvitation, shareAreaWithTeam } from './cloud.js';

let state, view = 'today', projectView='list', liveChannel;
const $ = s => document.querySelector(s);
const bucketViews = ['inbox','today','later','someday'];
const navItems = [['inbox','⌄','Inbox'],['today','☀','Gör idag'],['assigned','◎','Tilldelat'],['later','◷','Gör sen'],['someday','◇','Gör nån gång'],['team','⚭','Team']];
const mobileItems = [['inbox','⌄','Inbox'],['today','☀','Idag'],['assigned','◎','Tilldelat'],['later','◷','Sen'],['someday','◇','Nån gång'],['areas','▦','Områden']];

async function api(path, options={}) {
  if(path==='/state') return loadCloudState();
  if(path==='/tasks'&&options.method==='POST') return createCloudTask(JSON.parse(options.body));
  const match=path.match(/^\/tasks\/([^/]+)$/); if(match&&options.method==='PATCH') return updateCloudTask(match[1],JSON.parse(options.body));
  throw new Error(`Okänd molnoperation: ${path}`);
}
async function load(){ try{const userId=state?.currentUserId;state=await api('/state');if(userId)state.currentUserId=userId;render()}catch(e){toast(e.message)} }
const visible=()=>state.tasks.filter(t=>t.visible&&!t.completed);
const topLevel=tasks=>tasks.filter(t=>!t.parentTaskId);
const assignedToMe=()=>visible().filter(t=>t.assigneeId===state.currentUserId);
const assignedRoots=tasks=>tasks.filter(t=>!t.parentTaskId||!tasks.some(p=>p.id===t.parentTaskId));
const childrenOf=id=>state.tasks.filter(t=>t.parentTaskId===id);
const person=id=>state.people.find(p=>p.id===id)||{id,name:'Okänd',initials:'?',color:'#999'};
const project=id=>state.projects.find(p=>p.id===id);
const area=id=>state.areas.find(a=>a.id===id);
const team=id=>state.teams.find(t=>t.id===id);
const areaForProject=id=>area(project(id)?.areaId);
const membersForArea=a=>a?.teamId?team(a.teamId)?.memberIds.map(person).filter(Boolean):[person(a?.ownerId||'me')];
const escapeHtml=(s='')=>s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const toast=text=>{$('#toast').textContent=text;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),2200)};
const avatarHtml=p=>`<span class="mini-avatar" title="${p.name}" style="background:${p.color}">${p.initials}</span>`;
const linksForTask=id=>(state.taskLinks||[]).filter(l=>l.taskId===id);
const localDateISO=(date=new Date())=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
const safeHref=url=>{const value=(url||'').trim();return !value||/^(javascript|data|vbscript):/i.test(value)?'#':value};
const linkKindLabel=kind=>({email:'Mail',calendar:'Kalender',document:'Dokument',chat:'Chatt',web:'Webb',file:'Fil',mcp:'MCP',other:'Länk'})[kind]||'Länk';
const linkKindIcon=kind=>({email:'✉',calendar:'◷',document:'▤',chat:'☵',web:'↗',file:'▣',mcp:'✦',other:'↗'})[kind]||'↗';
const navCount=id=>id==='assigned'?assignedToMe().length:id==='team'?(state.invitations||[]).filter(i=>!i.acceptedAt).length:bucketViews.includes(id)?visible().filter(t=>t.bucket===id).length:0;

function renderNav(){
  $('#mainNav').innerHTML=navItems.map(([id,ico,label])=>`<button class="nav-item ${view===id?'active':''}" data-view="${id}"><span class="ico">${ico}</span><span>${label}</span><span class="count">${navCount(id)||''}</span></button>`).join('');
  $('#projectNav').innerHTML=state.areas.map(a=>{const projects=state.projects.filter(p=>p.areaId===a.id);return `<div class="area-group"><button class="nav-item area-nav ${view==='area:'+a.id?'active':''}" data-view="area:${a.id}"><span class="area-icon" style="background:${a.color}">${a.icon}</span><span>${a.name}</span><span class="count">${visible().filter(t=>projects.some(p=>p.id===t.projectId)).length||''}</span><span class="chevron">⌄</span></button>${projects.map(p=>`<button class="nav-item project-child ${view==='project:'+p.id?'active':''}" data-view="project:${p.id}"><span class="project-dot" style="background:${p.color}"></span><span>${p.name}</span><span class="count">${visible().filter(t=>t.projectId===p.id).length||''}</span></button>`).join('')}</div>`}).join('');
  $('#mobileNav').innerHTML=mobileItems.map(([id,ico,label])=>`<button class="mobile-nav-item ${view===id||(id==='areas'&&(view.startsWith('area:')||view.startsWith('project:')))?'active':''}" data-view="${id}"><span>${ico}</span><small>${label.replace('Gör ','')}</small>${id!=='areas'&&navCount(id)?`<i>${navCount(id)}</i>`:''}</button>`).join('');
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});
}

function render(){
  renderNav();let tasks=[],title,eye='MIN DAG',showAreas=false,showTeam=false,currentProject=null;
  const labels={inbox:'Inbox',today:'Gör idag',later:'Gör sen',someday:'Gör nån gång'};
  if(view==='areas'){title='Områden';eye='DITT LIV';showAreas=true}
  else if(view==='team'){title='Team & delning';eye='SAMARBETE';showTeam=true}
  else if(view==='assigned'){tasks=assignedRoots(assignedToMe());title='Tilldelat till mig';eye='SAMARBETE'}
  else if(view.startsWith('area:')){const a=area(view.split(':')[1]),ids=state.projects.filter(p=>p.areaId===a.id).map(p=>p.id);tasks=topLevel(visible().filter(t=>ids.includes(t.projectId)));title=a.name;eye='OMRÅDE'}
  else if(view.startsWith('project:')){const p=project(view.split(':')[1]);currentProject=p;const canPlan=p.ownerId===state.currentUserId||(!p.ownerId&&area(p.areaId)?.ownerId===state.currentUserId);tasks=topLevel(state.tasks.filter(t=>t.projectId===p.id&&!t.completed&&(t.visible||canPlan)));title=p.name;eye=area(p.areaId)?.name.toUpperCase()||'PROJEKT'}
  else{tasks=topLevel(visible().filter(t=>t.bucket===view));title=labels[view]}
  $('#pageTitle').textContent=title;$('#eyebrow').textContent=eye;
  $('#subtitle').textContent=view==='today'?new Intl.DateTimeFormat('sv-SE',{weekday:'long',day:'numeric',month:'long'}).format(new Date()):showAreas?'Separata platser för privatliv, jobb och allt däremellan':showTeam?'Skapa team, bjud in personer och bestäm vilka områden teamet får se.':view==='assigned'?'Allt som ligger på dig, oavsett projekt eller område.':`${tasks.length} aktiva uppgifter`;
  $('#sectionTitle').textContent=showAreas?'Dina områden':showTeam?'Team, inbjudningar och åtkomst':view==='assigned'?'Uppgifter tilldelade till dig':view==='inbox'?'Okategoriserat':'Att göra';
  $('#projectToolbar').classList.toggle('open',Boolean(currentProject));
  if(currentProject){const colors={on_track:'#42a68b',at_risk:'#e2a33d',off_track:'#d96761'},labels={on_track:'På rätt väg',at_risk:'Risk',off_track:'Försenat'};$('#projectHealth').innerHTML=`<span class="health-pill"><i style="background:${colors[currentProject.health]}"></i>${labels[currentProject.health]}</span>`}
  $('.section-head>div').style.display=showAreas||showTeam?'none':'';$('#addRow').style.display=showAreas||showTeam?'none':'';$('#focusCard').style.display=view==='today'?'flex':'none';
  const todayAll=state.tasks.filter(t=>t.visible&&t.bucket==='today'),done=todayAll.filter(t=>t.completed).length,pct=todayAll.length?Math.round(done/todayAll.length*100):0;
  $('#todayCount').textContent=todayAll.filter(t=>!t.completed).length;$('#progressText').textContent=pct+'%';$('.done-ring').style.strokeDashoffset=100-pct;
  $('#taskList').innerHTML=showAreas?areaCards():showTeam?teamSharingContent():view==='assigned'?assignedContent():currentProject?projectContent(tasks):tasks.length?tasks.map(taskGroupHtml).join(''):'<div class="empty">Här är lugnt och fint.</div>';
  document.querySelectorAll('.task').forEach(el=>el.onclick=e=>{if(!e.target.classList.contains('check'))openInspector(el.dataset.id)});
  document.querySelectorAll('.check').forEach(b=>b.onclick=e=>{e.stopPropagation();complete(b.dataset.id)});
  document.querySelectorAll('.area-card').forEach(c=>c.onclick=()=>{view='area:'+c.dataset.area;render()});
  document.querySelectorAll('.board-card,.calendar-task,.flow-node').forEach(c=>c.onclick=()=>openInspector(c.dataset.id));
  if(showTeam)bindTeamSharing();
  renderNotifications();
  renderDailyBrief();
}

function projectContent(tasks){if(!tasks.length)return'<div class="empty">Projektet väntar på sin första uppgift.</div>';if(projectView==='board')return boardHtml(tasks);if(projectView==='calendar')return calendarHtml(tasks);if(projectView==='flow')return flowHtml(tasks);return tasks.map(taskGroupHtml).join('')}
function boardHtml(tasks){const columns=[[['idea','planned','todo'],'ATT GÖRA'],[['doing'],'PÅGÅR'],[['waiting'],'VÄNTAR'],[['review'],'GRANSKNING']];return `<div class="board">${columns.map(([statuses,label])=>{const cards=tasks.filter(t=>statuses.includes(t.status||'todo'));return `<div class="board-column"><h3>${label} · ${cards.length}</h3>${cards.map(t=>`<button class="board-card" data-id="${t.id}"><strong>${escapeHtml(t.title)}</strong><span class="mini-avatar" style="background:${person(t.assigneeId).color}">${person(t.assigneeId).initials}</span></button>`).join('')}</div>`}).join('')}</div>`}
function calendarHtml(tasks){const days=[['MÅN','mån'],['TIS','tis'],['ONS','ons'],['TOR','tor'],['FRE','fre'],['LÖR','lör'],['SÖN','sön']];return `<div class="calendar-view">${days.map(([label,key])=>`<div class="calendar-day"><h3>${label}</h3>${tasks.filter(t=>(t.due||'').toLowerCase().includes(key)).map(t=>`<div class="calendar-task" data-id="${t.id}">${escapeHtml(t.title)}</div>`).join('')}</div>`).join('')}</div>${tasks.some(t=>t.due&&!days.some(([,key])=>t.due.toLowerCase().includes(key)))?'<p class="hint">Uppgifter med exakta datum visas när kalenderdatum har sparats strukturerat.</p>':''}`}
function flowHtml(tasks){const sorted=[...tasks].sort((a,b)=>state.dependencies.some(d=>d.taskId===b.id&&d.dependsOnTaskId===a.id)?-1:0);return `<div class="flow-view">${sorted.map(t=>`<button class="flow-node ${t.visible?'':'waiting'}" data-id="${t.id}"><strong>${escapeHtml(t.title)}</strong><small>${t.visible?'Redo att göra':`Väntar på ${state.dependencies.filter(d=>d.taskId===t.id).length} steg`}</small></button>`).join('')}</div>`}

function renderNotifications(){const items=state.notifications||[],unread=items.filter(n=>!n.readAt).length;$('#notificationCount').textContent=unread;$('#notificationCount').style.display=unread?'grid':'none';$('#notificationDot').style.display='none';$('#notificationList').innerHTML=items.length?items.map(n=>`<button class="notification-item ${n.readAt?'':'unread'}" data-notification="${n.id}" data-task="${n.taskId||''}"><span><strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.body)}</p><time>${new Date(n.createdAt).toLocaleString('sv-SE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></span></button>`).join(''):'<div class="empty">Inga notiser ännu.</div>';document.querySelectorAll('[data-notification]').forEach(n=>n.onclick=async()=>{await markNotificationRead(n.dataset.notification);if(n.dataset.task)openInspector(n.dataset.task);await load()})}

function assignedContent(){
  const mine=assignedRoots(assignedToMe()),fromOthers=mine.filter(t=>t.createdBy&&t.createdBy!==state.currentUserId),own=mine.filter(t=>!t.createdBy||t.createdBy===state.currentUserId);
  if(!mine.length)return'<div class="empty">Inga aktiva uppgifter ligger på dig just nu.</div>';
  const section=(title,items,empty)=>`<section class="assigned-block"><div class="assigned-head"><h3>${title}</h3><span>${items.length}</span></div>${items.length?items.map(taskGroupHtml).join(''):`<p class="muted-line">${empty}</p>`}</section>`;
  return `<div class="assigned-layout">${section('Från andra',fromOthers,'När kollegor tilldelar dig något syns det här.')}${section('Mina egna',own,'Dina egna uppgifter visas här när de är tilldelade dig.')}</div>`;
}

function teamSharingContent(){
  const pending=(state.invitations||[]).filter(i=>!i.acceptedAt),accepted=(state.invitations||[]).filter(i=>i.acceptedAt);
  return `<div class="team-page">
    <section class="team-create-card">
      <div><p class="eyebrow">NYTT TEAM</p><h3>Skapa en grupp för jobb, privat eller båt</h3><p>Team styr vilka personer som får se områden och projekt.</p></div>
      <form id="createTeamForm" class="inline-form"><input name="name" placeholder="T.ex. Jobbteamet" required><button class="primary">Skapa team</button></form>
    </section>
    <section class="team-grid">${state.teams.length?state.teams.map(teamCard).join(''):'<div class="empty card-empty">Inga team ännu. Skapa ditt första ovan.</div>'}</section>
    <section class="share-areas-card">
      <div class="share-head"><div><p class="eyebrow">OMRÅDESÅTKOMST</p><h3>Dela områden med rätt team</h3></div><span>${state.areas.length} områden</span></div>
      <div class="area-share-list">${state.areas.map(areaShareRow).join('')}</div>
    </section>
    <section class="invite-summary"><strong>${pending.length}</strong> väntande inbjudningar · <strong>${accepted.length}</strong> accepterade</section>
  </div>`;
}

function teamCard(tm){
  const members=(state.teamMembers||[]).filter(m=>m.teamId===tm.id&&m.status==='active'),invites=(state.invitations||[]).filter(i=>i.teamId===tm.id),pending=invites.filter(i=>!i.acceptedAt),isAdmin=tm.ownerId===state.currentUserId||members.some(m=>m.userId===state.currentUserId&&['owner','admin'].includes(m.role));
  return `<article class="team-card"><div class="team-card-head"><div><h3>${escapeHtml(tm.name)}</h3><p>${members.length} medlem${members.length===1?'':'mar'} · ${pending.length} väntande</p></div><span>${isAdmin?'Admin':'Medlem'}</span></div>
    <div class="member-list">${members.map(m=>{const p=person(m.userId);return `<span>${avatarHtml(p)}${escapeHtml(p.name)} <small>${m.role}</small></span>`}).join('')||'<p class="muted-line">Inga aktiva medlemmar ännu.</p>'}</div>
    ${isAdmin?`<form class="invite-form" data-team="${tm.id}"><input name="email" type="email" placeholder="kollega@example.com" required><select name="role"><option value="member">Medlem</option><option value="admin">Admin</option></select><button>+ Bjud in</button></form>`:''}
    <div class="pending-list">${invites.length?invites.map(i=>`<div><span>${escapeHtml(i.email)}</span><small>${i.acceptedAt?'Accepterad':'Väntar'} · ${i.role}</small></div>`).join(''):'<p class="muted-line">Inga inbjudningar ännu.</p>'}</div>
  </article>`;
}

function areaShareRow(a){
  const owner=a.ownerId===state.currentUserId,current=team(a.teamId);
  return `<div class="area-share-row"><div><span class="area-card-icon small" style="background:${a.color}">${a.icon}</span><div><strong>${escapeHtml(a.name)}</strong><small>${current?`Delas med ${current.name}`:'Privat område'}</small></div></div><select data-area-share="${a.id}" ${owner?'':'disabled'}><option value="">Endast privat</option>${state.teams.map(t=>`<option value="${t.id}" ${a.teamId===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select></div>`;
}

function bindTeamSharing(){
  $('#createTeamForm')?.addEventListener('submit',async e=>{e.preventDefault();const name=new FormData(e.target).get('name').trim();if(!name)return;await createTeam(name);await load();toast('Teamet är skapat.')});
  document.querySelectorAll('.invite-form').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const data=new FormData(e.target),email=data.get('email').trim().toLowerCase();if(!email)return;const invite=await createInvitation(e.target.dataset.team,email,data.get('role'));await load();toast(invite.acceptedAt?'Personen är redan medlem nu.':'Inbjudan är skapad.')});
  document.querySelectorAll('[data-area-share]').forEach(s=>s.onchange=async()=>{await shareAreaWithTeam(s.dataset.areaShare,s.value||null);await load();toast(s.value?'Området är delat med teamet.':'Området är privat igen.')});
}

function areaCards(){return `<div class="area-grid">${state.areas.map(a=>{const projects=state.projects.filter(p=>p.areaId===a.id),members=membersForArea(a);return `<button class="area-card" data-area="${a.id}"><div class="area-card-head"><span class="area-card-icon" style="background:${a.color}">${a.icon}</span><div><h3>${a.name}</h3><p>${projects.length} projekt · ${visible().filter(t=>projects.some(p=>p.id===t.projectId)).length} uppgifter</p></div></div><div class="area-card-projects">${projects.map(p=>`<span>${p.name}</span>`).join('')||'<span>Inga projekt ännu</span>'}</div><div class="access-note">${a.teamId?'Delas med':'Privat för dig'}<span class="team-stack">${members.map(avatarHtml).join('')}</span>${a.teamId?team(a.teamId).name:'Endast du'}</div></button>`}).join('')}</div>`}
function taskGroupHtml(t){const all=childrenOf(t.id),shown=all.filter(c=>c.visible&&!c.completed),done=all.filter(c=>c.completed).length;return `<div class="task-group">${taskHtml(t,all.length?`${done}/${all.length}`:'')}${shown.length?`<div class="subtasks">${shown.map(c=>taskHtml(c)).join('')}</div>`:''}${all.some(c=>!c.visible&&!c.completed)?`<div class="subtask-waiting">⚡ ${all.filter(c=>!c.visible&&!c.completed).length} nästa steg väntar på ett villkor</div>`:''}</div>`}
function taskHtml(t,progress=''){
  const p=project(t.projectId),a=person(t.assigneeId),ar=areaForProject(t.projectId),linkCount=linksForTask(t.id).length;
  return `<article class="task ${progress?'has-children':''}" data-id="${t.id}"><button class="check p${t.priority}" data-id="${t.id}" aria-label="${t.taskType==='approval'?'Godkänn':'Markera klar'}"></button><div><div class="task-title">${t.taskType==='milestone'?'◆ ':t.taskType==='approval'?'✓ ':''}${escapeHtml(t.title)}</div><div class="task-meta">${progress?`<span class="subtask-progress">☷ ${progress} delsteg</span>`:''}${linkCount?`<span class="context-count">↗ ${linkCount}</span>`:''}${t.due?`<span class="due">◷ ${escapeHtml(t.due)}</span>`:''}${p?`<span class="project-tag"><i class="project-dot" style="background:${p.color}"></i>${p.name}</span>`:''}${ar&&!t.parentTaskId?`<span class="area-badge"><i style="background:${ar.color}"></i>${ar.name}</span>`:''}</div></div>${avatarHtml(a)}</article>`
}
async function complete(id){const openChildren=childrenOf(id).filter(t=>!t.completed);if(openChildren.length){toast(`${openChildren.length} underuppgift${openChildren.length>1?'er':''} återstår.`);return}const task=state.tasks.find(t=>t.id===id),approval=(state.approvals||[]).find(a=>a.taskId===id&&a.status==='pending');if(task?.taskType==='approval'&&approval){if(approval.requestedFrom!==state.currentUserId){toast('Inväntar godkännande från rätt person.');return}await decideApproval(approval.id,'approved')}else await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify({completed:true})});await load();toast(task?.taskType==='approval'?'Godkänt.':`Klart!${state.tasks.some(t=>t.visible&&!t.completed&&t.trigger?.taskId===id)?' Nästa steg är nu synligt.':''}`)}
function renderTaskLinks(t){
  const links=linksForTask(t.id);
  return `<div class="link-section"><h3>Länkar från andra appar · ${links.length}</h3>${links.length?`<div class="task-links">${links.map(l=>`<a class="task-link-card" href="${escapeHtml(safeHref(l.url))}" target="_blank" rel="noreferrer"><span>${linkKindIcon(l.kind)}</span><div><strong>${escapeHtml(l.title||l.url||linkKindLabel(l.kind))}</strong><small>${escapeHtml([l.provider,linkKindLabel(l.kind)].filter(Boolean).join(' · '))}</small></div></a>`).join('')}</div>`:'<p class="hint">Inga länkar ännu. Lägg till mail, dokument, chatt eller annat som hör till uppgiften.</p>'}<form class="link-form" id="taskLinkForm"><select name="kind"><option value="email">Mail</option><option value="calendar">Kalender</option><option value="document">Dokument</option><option value="chat">Chatt</option><option value="web">Webb</option><option value="other">Annat</option></select><input name="title" placeholder="Titel"><input name="url" placeholder="Länk / deep link" required><button>＋</button></form></div>`
}

function openInspector(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;
  const p=project(t.projectId),a=person(t.assigneeId),ar=areaForProject(t.projectId),tm=team(ar?.teamId),subs=childrenOf(t.id),comments=(state.comments||[]).filter(c=>c.taskId===id);
  $('#inspectorContent').innerHTML=`<p class="eyebrow">${ar?escapeHtml(ar.name).toUpperCase():'UPPGIFT'}</p><button class="check big-check p${t.priority}" id="detailCheck"></button><h2>${escapeHtml(t.title)}</h2>${subs.length?`<div class="parent-lock">Huvuduppgiften blir klar automatiskt när alla ${subs.length} delsteg är klara.</div>`:''}${t.activationReason?`<div class="activation-explain"><strong>✦ Varför ser jag detta nu?</strong>${escapeHtml(t.activationReason)}${t.activatedAt?` · ${new Date(t.activatedAt).toLocaleString('sv-SE')}`:''}</div>`:''}${t.notes?`<p style="color:#777;font-size:13px;line-height:1.6">${escapeHtml(t.notes)}</p>`:''}<div class="detail-row"><span>Status</span><strong class="status-chip">${statusLabel(t.status)}</strong></div><div class="detail-row"><span>Område</span><strong>${ar?ar.icon+' '+ar.name:'Personligt'}</strong></div><div class="detail-row"><span>Projekt</span><strong>${p?p.name:'Inbox'}</strong></div><div class="detail-row"><span>Tilldelad</span><strong>${a.name}</strong></div><div class="detail-row"><span>Åtkomst</span><strong>${tm?tm.name:'Endast du'}</strong></div><div class="detail-row"><span>När</span><strong>${t.due||'Inget datum'}</strong></div>${subs.length?`<div class="inspector-subtasks"><h3>Underuppgifter · ${subs.filter(s=>s.completed).length}/${subs.length}</h3>${subs.map(s=>`<div class="inspector-subtask ${s.completed?'done':''} ${!s.visible?'waiting':''}">${s.completed?'✓':s.visible?`<button class="check p${s.priority}" data-id="${s.id}"></button>`:'⚡'}<span>${escapeHtml(s.title)}</span><small>${!s.visible?'Väntar':person(s.assigneeId).initials}</small></div>`).join('')}</div>`:''}${t.trigger?`<div class="trigger-box"><strong>⚡ Aktiverad av villkor</strong>${escapeHtml(t.trigger.label||'Ett externt villkor')}</div>`:''}${renderTaskLinks(t)}<div class="comment-section"><h3>Kommentarer · ${comments.length}</h3>${comments.map(c=>`<div class="comment">${avatarHtml(person(c.authorId))}<div><p>${escapeHtml(c.body)}</p><time>${new Date(c.createdAt).toLocaleString('sv-SE')}</time></div></div>`).join('')}<form class="comment-form" id="commentForm"><input name="comment" placeholder="Skriv en kommentar eller @nämn någon…" required><button>Skicka</button></form></div>`;
  $('#detailCheck').onclick=()=>{complete(id);if(!subs.length)$('#inspector').classList.remove('open')};
  document.querySelectorAll('.inspector-subtask .check').forEach(b=>b.onclick=async()=>{await complete(b.dataset.id);openInspector(id)});
  $('#taskLinkForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);await addTaskLink(id,{kind:f.get('kind'),title:f.get('title'),url:f.get('url')});await load();openInspector(id);toast('Länken är tillagd.')};
  $('#commentForm').onsubmit=async e=>{e.preventDefault();const body=new FormData(e.target).get('comment');await addComment(id,body);await load();openInspector(id)};
  $('#inspector').classList.add('open')
}
function statusLabel(s){return({idea:'Idé',planned:'Planerad',todo:'Att göra',doing:'Pågår',waiting:'Väntar',review:'Granskning',done:'Klar'})[s]||'Att göra'}
function buildDailyBrief(){
  const active=state.tasks.filter(t=>t.visible&&!t.completed),today=topLevel(active.filter(t=>t.bucket==='today')),p1=topLevel(active.filter(t=>t.priority===1)),doing=topLevel(active.filter(t=>t.status==='doing')),waiting=topLevel(active.filter(t=>t.status==='waiting')),inbox=topLevel(active.filter(t=>t.bucket==='inbox')),linked=active.filter(t=>linksForTask(t.id).length);
  const focus=[...new Map([...p1,...doing,...today,...inbox].map(t=>[t.id,t])).values()].slice(0,5);
  const suggestions=[];
  if(p1.length)suggestions.push({type:'priority',text:`Börja med ${p1.length} P1-uppgift${p1.length>1?'er':''}.`});
  if(inbox.length>=3)suggestions.push({type:'inbox',text:`Rensa inboxen: ${inbox.length} okategoriserade uppgifter väntar.`});
  if(waiting.length)suggestions.push({type:'waiting',text:`${waiting.length} uppgift${waiting.length>1?'er':''} står i vänteläge. Följ upp blockeringen eller låt MCP bevaka händelsen.`});
  if(linked.length)suggestions.push({type:'context',text:`${linked.length} uppgift${linked.length>1?'er har':' har'} länkar till mail, dokument eller andra appar.`});
  if(!suggestions.length)suggestions.push({type:'calm',text:'Läget är rent. Välj en tydlig nästa uppgift och håll flödet enkelt.'});
  return {briefDate:localDateISO(),title:'Dagens Orbit-brief',summary:`Du har ${today.length} uppgift${today.length===1?'':'er'} i “Gör idag”, ${p1.length} P1 och ${waiting.length} väntande. ${focus.length?`Föreslaget fokus: ${focus.map(t=>t.title).join(', ')}.`:'Ingen akut fokusuppgift hittades.'}`,focusTaskIds:focus.map(t=>t.id),blockers:waiting.slice(0,5).map(t=>({taskId:t.id,title:t.title,reason:t.activationReason||t.trigger?.label||'Markerad som väntar'})),suggestions,generatedBy:'orbit-client-agent'};
}
function renderDailyBrief(){
  const card=$('#briefCard');if(!card||!state)return;
  card.style.display=view==='today'?'flex':'none';
  const today=localDateISO(),brief=(state.dailyBriefs||[]).filter(b=>b.briefDate===today).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
  const focus=brief?(brief.focusTaskIds||[]).map(id=>state.tasks.find(t=>t.id===id)).filter(Boolean):[];
  $('#briefSummary').textContent=brief?brief.summary:'Skapa en kort MCP/AI-brief av dagens uppgifter, väntelägen och app-länkar.';
  $('#briefFocusTasks').innerHTML=brief?`<div class="brief-tags">${focus.map(t=>`<button data-id="${t.id}">${escapeHtml(t.title)}</button>`).join('')}${(brief.suggestions||[]).slice(0,2).map(s=>`<span>${escapeHtml(s.text)}</span>`).join('')}</div>`:'';
  $('#briefFocusTasks').querySelectorAll('button').forEach(b=>b.onclick=()=>openInspector(b.dataset.id));
  $('#generateBrief').onclick=async()=>{const generated=buildDailyBrief();await saveDailyBrief(generated);await load();toast('Dagens brief är uppdaterad.')};
}
function refreshAssignees(){const p=project($('#projectSelect').value),members=p?membersForArea(area(p.areaId)):[person(state.currentUserId)];$('#assigneeSelect').innerHTML=members.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}
function openDialog(){
  $('#projectSelect').innerHTML='<option value="">Personligt / Inbox</option>'+state.areas.map(a=>`<optgroup label="${a.name}">${state.projects.filter(p=>p.areaId===a.id).map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</optgroup>`).join('');
  if(view.startsWith('project:'))$('#projectSelect').value=view.split(':')[1]; else if(bucketViews.includes(view))$('#taskForm').elements.bucket.value=view;
  const candidates=state.tasks.filter(t=>!t.completed&&t.visible);
  $('#parentTaskSelect').innerHTML='<option value="">Ingen — fristående uppgift</option>'+candidates.map(t=>`<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  $('#dependencyTaskSelect').innerHTML=candidates.map(t=>`<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  refreshAssignees();$('#taskDialog').showModal();setTimeout(()=>$('#newTitle').focus(),50)
}
$('#projectSelect').onchange=refreshAssignees;
$('#quickAdd').onclick=$('#addRow').onclick=$('#mobileAdd').onclick=openDialog;$('#closeInspector').onclick=()=>$('#inspector').classList.remove('open');
document.querySelectorAll('[data-project-view]').forEach(b=>b.onclick=()=>{projectView=b.dataset.projectView;document.querySelectorAll('[data-project-view]').forEach(x=>x.classList.toggle('active',x===b));render()});
$('#notificationButton').onclick=()=>$('#notificationPanel').classList.add('open');$('#closeNotifications').onclick=()=>$('#notificationPanel').classList.remove('open');
$('#taskForm').onsubmit=async e=>{
  e.preventDefault();
  const f=new FormData(e.target),data=Object.fromEntries(f),dependencies=f.getAll('dependencyTaskIds').filter(Boolean);
  if(!data.title.trim())return;
  const link={kind:data.linkKind||'other',provider:data.linkProvider||'',title:data.linkTitle||data.title,url:data.linkUrl||''};
  const type=data.triggerType,val=type==='task_completed'?dependencies[0]:data.triggerValue;
  delete data.triggerType;delete data.triggerValue;delete data.dependencyTaskIds;delete data.linkKind;delete data.linkProvider;delete data.linkTitle;delete data.linkUrl;
  data.dependencyTaskIds=dependencies;
  data.links=link.url.trim()?[link]:[];
  if(type&&val)data.trigger=type==='task_completed'?{type,taskId:val,label:`Väntar på ${dependencies.length} föregående steg`}:{type,event:val,label:`Väntar på händelsen “${val}”`};
  await api('/tasks',{method:'POST',body:JSON.stringify(data)});
  $('#taskDialog').close();e.target.reset();await load();
  toast(data.trigger?'Uppgiften väntar dolt på sitt villkor.':data.parentTaskId?'Underuppgiften är skapad.':'Uppgiften är skapad.')
};
document.addEventListener('keydown',e=>{if(e.key.toLowerCase()==='n'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();openDialog()}});

let authMode='signin';
function showAuth(){ $('#authScreen').classList.add('open');$('#configHelp').classList.toggle('show',!configured);$('#authSubmit').disabled=!configured }
function hideAuth(){ $('#authScreen').classList.remove('open') }
$('#authSwitch').onclick=()=>{authMode=authMode==='signin'?'signup':'signin';const signup=authMode==='signup';$('#nameLabel').classList.toggle('show',signup);$('#authTitle').textContent=signup?'Skapa ditt konto':'Välkommen tillbaka';$('#authSubmit').textContent=signup?'Skapa konto':'Logga in';$('#authSwitch').textContent=signup?'Har du redan ett konto? Logga in':'Inget konto? Skapa ett';$('#authError').textContent=''};
$('#authForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);$('#authError').textContent='';$('#authSubmit').disabled=true;try{if(authMode==='signup')await signUp(f.get('name'),f.get('email'),f.get('password'));else await signIn(f.get('email'),f.get('password'));await boot()}catch(err){$('#authError').textContent=err.message}finally{$('#authSubmit').disabled=false}};
$('#logoutButton').onclick=async()=>{if(liveChannel)await liveChannel.unsubscribe();await signOut();showAuth()};
async function boot(){if(!configured){showAuth();return}const current=await session();if(!current){showAuth();return}hideAuth();$('#currentUserName').textContent=current.user.user_metadata?.name||current.user.email.split('@')[0];await load();state.currentUserId=current.user.id;render();if(liveChannel)await liveChannel.unsubscribe();liveChannel=subscribeToChanges(()=>load())}
boot();
