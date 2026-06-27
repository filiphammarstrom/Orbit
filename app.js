import { configured, session, signIn, signUp, signOut, loadCloudState, createCloudTask, updateCloudTask, subscribeToChanges, addComment, addTaskLink, startGoogleCalendarOAuth, startSlackOAuth, slackEventSummary, createTaskFromSlackEvent, syncCalendarLinkNow, queueCalendarSync, saveDailyBrief, saveAgentRun, markNotificationRead, decideApproval, createTeam, createInvitation, shareAreaWithTeam, updateAreaDetails } from './cloud.js';

let state, view = 'today', projectView='list', liveChannel;
const $ = s => document.querySelector(s);
const bucketViews = ['inbox','today','later','someday'];
const navItems = [['inbox','⌄','Inbox'],['today','☀','Gör idag'],['later','◷','Gör sen'],['someday','◇','Gör nån gång']];
const mobileItems = [['inbox','⌄','Inbox'],['today','☀','Idag'],['later','◷','Sen'],['someday','◇','Nån gång'],['areas','▦','Områden']];
let pendingCapture = readCaptureIntent();

async function api(path, options={}) {
  if(path==='/state') return loadCloudState();
  if(path==='/tasks'&&options.method==='POST') return createCloudTask(JSON.parse(options.body));
  const match=path.match(/^\/tasks\/([^/]+)$/); if(match&&options.method==='PATCH') return updateCloudTask(match[1],JSON.parse(options.body));
  throw new Error(`Okänd molnoperation: ${path}`);
}
async function load(){ try{const userId=state?.currentUserId;state=await api('/state');if(userId)state.currentUserId=userId;render()}catch(e){toast(e.message)} }
const visible=()=>state.tasks.filter(t=>t.visible&&!t.completed);
const topLevel=tasks=>tasks.filter(t=>!t.parentTaskId);
const childrenOf=id=>state.tasks.filter(t=>t.parentTaskId===id);
const person=id=>state.people.find(p=>p.id===id)||{id,name:'Okänd',initials:'?',color:'#999'};
const project=id=>state.projects.find(p=>p.id===id);
const area=id=>state.areas.find(a=>a.id===id);
const team=id=>state.teams.find(t=>t.id===id);
const areaForProject=id=>area(project(id)?.areaId);
const membersForArea=a=>a?.teamId?(team(a.teamId)?.memberIds||[]).map(person).filter(Boolean):[person(a?.ownerId||state?.currentUserId||'me')];
const areaCategory=a=>(a?.category||'Privat').trim()||'Privat';
const areaName=a=>{const name=(a?.name||'').trim();return name&&name.toLocaleLowerCase('sv-SE')===areaCategory(a).toLocaleLowerCase('sv-SE')?'Allmänt':name||'Område'};
const categorySort=(a,b)=>a.localeCompare(b,'sv-SE',{sensitivity:'base'});
const areaGroups=()=>[...new Set((state.areas||[]).map(areaCategory))].sort(categorySort).map(category=>({category,areas:state.areas.filter(a=>areaCategory(a)===category)}));
const projectsForArea=a=>state.projects.filter(p=>p.areaId===a.id);
const taskCountForProjects=projects=>visible().filter(t=>projects.some(p=>p.id===t.projectId)).length;
const categoryViewId=category=>`category:${encodeURIComponent(category)}`;
const categoryFromView=()=>decodeURIComponent(view.slice('category:'.length));
const escapeHtml=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const toast=text=>{$('#toast').textContent=text;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),2200)};
const avatarHtml=p=>`<span class="mini-avatar" title="${p.name}" style="background:${p.color}">${p.initials}</span>`;
const linksForTask=id=>(state.taskLinks||[]).filter(l=>l.taskId===id);
const calendarLinksForTask=id=>(state.calendarLinks||[]).filter(l=>l.taskId===id);
const googleCalendarIntegrations=()=>(state.integrations||[]).filter(i=>i.provider==='google_calendar');
const slackIntegrations=()=>(state.integrations||[]).filter(i=>i.provider==='slack');
const slackEvents=()=>(state.integrationEvents||[]).filter(e=>e.provider==='slack');
const slackInboxEvents=()=>slackEvents().filter(e=>!e.processedAt&&!e.payload?.orbit?.taskId).slice(0,12);
const localDateISO=(date=new Date())=>new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,10);
const startOfLocalDay=(date=new Date())=>{const d=new Date(date);d.setHours(0,0,0,0);return d};
const toDateTimeLocalValue=iso=>{if(!iso)return'';const d=new Date(iso);return Number.isNaN(d.getTime())?'':new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
const fromDateTimeLocalValue=value=>{if(!value)return null;const d=new Date(value);return Number.isNaN(d.getTime())?null:d.toISOString()};
const sameLocalDate=(iso,date=new Date())=>Boolean(iso)&&localDateISO(new Date(iso))===localDateISO(date);
const isDueToday=t=>sameLocalDate(t.dueAt);
const isOverdue=t=>Boolean(t.dueAt)&&!t.completed&&new Date(t.dueAt).getTime()<startOfLocalDay().getTime();
const isReminderDue=t=>Boolean(t.reminderAt)&&!t.completed&&new Date(t.reminderAt).getTime()<=Date.now();
const formatDateTime=iso=>{if(!iso)return'';const d=new Date(iso);if(Number.isNaN(d.getTime()))return'';const same=sameLocalDate(iso);return new Intl.DateTimeFormat('sv-SE',same?{hour:'2-digit',minute:'2-digit'}:{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d)};
const formatTime=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('sv-SE',{hour:'2-digit',minute:'2-digit'}).format(d)};
const addMinutes=(iso,minutes)=>{const d=new Date(iso||Date.now());d.setMinutes(d.getMinutes()+minutes);return d.toISOString()};
const googleDate=iso=>new Date(iso).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const googleCalendarTemplateUrl=t=>{if(!t.dueAt)return'';const details=[t.notes||'',`Orbit task: ${t.id}`].filter(Boolean).join('\n\n');const params=new URLSearchParams({action:'TEMPLATE',text:t.title,details,dates:`${googleDate(t.dueAt)}/${googleDate(addMinutes(t.dueAt,30))}`});return `https://calendar.google.com/calendar/render?${params.toString()}`};
const scheduleLabel=t=>t.dueAt?formatDateTime(t.dueAt):(t.due||'');
const reminderLabel=t=>t.reminderAt?formatDateTime(t.reminderAt):'';
const tasksForBucketView=id=>id==='today'?visible().filter(t=>t.bucket==='today'||isDueToday(t)||isOverdue(t)||isReminderDue(t)):visible().filter(t=>t.bucket===id);
const reminderAlerts=()=>visible().filter(isReminderDue).sort((a,b)=>new Date(a.reminderAt)-new Date(b.reminderAt)).slice(0,20);
const parseClock=text=>{let m=text.match(/\b(?:kl\.?\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)\b/);if(m)return{h:Number(m[1]),m:Number(m[2])};m=text.match(/\bkl\.?\s*([01]?\d|2[0-3])\b/);return m?{h:Number(m[1]),m:0}:null};
const weekdayIndex={söndag:0,sondag:0,sön:0,son:0,måndag:1,mandag:1,mån:1,man:1,tisdag:2,tis:2,onsdag:3,ons:3,torsdag:4,tor:4,fredag:5,fre:5,lördag:6,lordag:6,lör:6,lor:6};
function parseNaturalDateTime(text,now=new Date()){
  const raw=(text||'').trim(),s=raw.toLowerCase();if(!s)return{dueAt:null,reminderAt:null};
  const clock=parseClock(s);let date=null,defaultTime={h:9,m:0};
  if(/\b(i dag|idag)\b/.test(s))date=startOfLocalDay(now);
  else if(/\b(i morgon|imorgon)\b/.test(s)){date=startOfLocalDay(now);date.setDate(date.getDate()+1)}
  else if(/\b(övermorgon|overmorgon|i övermorgon|i overmorgon)\b/.test(s)){date=startOfLocalDay(now);date.setDate(date.getDate()+2)}
  else if(/\bikväll\b/.test(s)){date=startOfLocalDay(now);defaultTime={h:18,m:0}}
  const iso=s.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if(!date&&iso)date=new Date(Number(iso[1]),Number(iso[2])-1,Number(iso[3]));
  const slash=s.match(/\b([0-3]?\d)[/-]([01]?\d)(?:[/-](\d{2,4}))?\b/);
  if(!date&&slash){let year=slash[3]?Number(slash[3]):now.getFullYear();if(year<100)year+=2000;date=new Date(year,Number(slash[2])-1,Number(slash[1]))}
  if(!date){const word=Object.keys(weekdayIndex).find(w=>new RegExp(`\\b${w}\\b`).test(s));if(word){date=startOfLocalDay(now);let diff=(weekdayIndex[word]-date.getDay()+7)%7;if(diff===0)diff=7;date.setDate(date.getDate()+diff)}}
  if(!date&&clock){date=startOfLocalDay(now);date.setHours(clock.h,clock.m,0,0);if(date.getTime()<now.getTime())date.setDate(date.getDate()+1);return{dueAt:date.toISOString(),reminderAt:null}}
  if(!date)return{dueAt:null,reminderAt:null};
  const time=clock||defaultTime;date.setHours(time.h,time.m,0,0);
  let reminderAt=null;
  if(/\b(påminn|paminn|reminder)\b/.test(s)){
    let minutes=30;
    const min=s.match(/(\d+)\s*(min|minuter)/),hour=s.match(/(\d+)\s*(h|tim|timme|timmar)/);
    if(min)minutes=Number(min[1]);else if(hour)minutes=Number(hour[1])*60;else if(/dag(en)? innan/.test(s))minutes=24*60;
    const reminder=new Date(date);reminder.setMinutes(reminder.getMinutes()-minutes);reminderAt=reminder.toISOString();
  }
  return{dueAt:date.toISOString(),reminderAt};
}
const scheduleFromForm=data=>{const parsed=parseNaturalDateTime(data.due),dueAt=fromDateTimeLocalValue(data.dueAt)||parsed.dueAt,reminderAt=fromDateTimeLocalValue(data.reminderAt)||parsed.reminderAt;return{due:(data.due||'').trim()||(dueAt?formatDateTime(dueAt):''),dueAt,reminderAt}};
function bindScheduleAssist(form){const due=form?.elements?.due,dueAt=form?.elements?.dueAt,reminder=form?.elements?.reminderAt;if(!due||!dueAt||!reminder)return;const fill=()=>{const parsed=parseNaturalDateTime(due.value);if(parsed.dueAt&&!dueAt.value)dueAt.value=toDateTimeLocalValue(parsed.dueAt);if(parsed.reminderAt&&!reminder.value)reminder.value=toDateTimeLocalValue(parsed.reminderAt)};due.onblur=fill;due.onchange=fill}
const safeHref=url=>{const value=(url||'').trim();return !value||/^(javascript|data|vbscript):/i.test(value)?'#':value};
const linkKindLabel=kind=>({email:'Mail',calendar:'Kalender',document:'Dokument',chat:'Chatt',web:'Webb',file:'Fil',mcp:'MCP',other:'Länk'})[kind]||'Länk';
const linkKindIcon=kind=>({email:'✉',calendar:'◷',document:'▤',chat:'☵',web:'↗',file:'▣',mcp:'✦',other:'↗'})[kind]||'↗';
const calendarStatusLabel=status=>({pending:'Köad',synced:'Synkad',failed:'Misslyckad',deleted:'Borttagen'})[status]||status;
const navCount=id=>bucketViews.includes(id)?tasksForBucketView(id).length:0;
const option=(value,label,selected)=>`<option value="${escapeHtml(value)}" ${String(value)===String(selected||'')?'selected':''}>${escapeHtml(label)}</option>`;
const projectOptionsHtml=selected=>'<option value="">Inbox / inget projekt</option>'+areaGroups().map(group=>`<optgroup label="${escapeHtml(group.category)}">${group.areas.flatMap(a=>projectsForArea(a).map(p=>option(p.id,`${areaName(a)} · ${p.name}`,selected))).join('')}</optgroup>`).join('');
const assigneesForProject=projectId=>{const p=project(projectId);return p?membersForArea(area(p.areaId)):[person(state.currentUserId)]};
const assigneeOptionsHtml=(projectId,selected)=>{const list=assigneesForProject(projectId);if(selected&&!list.some(p=>p.id===selected))list.push(person(selected));return list.map(p=>option(p.id,p.name,selected||list[0]?.id)).join('')};
const defaultAssigneeForProject=projectId=>assigneesForProject(projectId)[0]?.id||state.currentUserId;
const firstParam=(params,names)=>names.map(name=>params.get(name)).find(Boolean)||'';
const firstUrl=text=>String(text||'').match(/\b(?:https?:\/\/|mailto:|message:|slack:\/\/|googlegmail:\/\/|ms-outlook:\/\/)[^\s<>"']+/i)?.[0]||'';
const withoutUrl=(text,url)=>url?String(text||'').replace(url,'').trim():String(text||'').trim();
function linkMeta(url='',fallbackProvider=''){
  const value=url.trim(),lower=value.toLowerCase();
  if(!value)return{kind:'other',provider:fallbackProvider};
  if(lower.startsWith('mailto:')||lower.includes('mail.google.com')||lower.includes('gmail.google')||lower.startsWith('googlegmail://'))return{kind:'email',provider:lower.includes('outlook')?'Outlook':'Gmail'};
  if(lower.includes('outlook.')||lower.startsWith('ms-outlook://')||lower.includes('office.com/mail'))return{kind:'email',provider:'Outlook'};
  if(lower.includes('calendar.google.com'))return{kind:'calendar',provider:'Google Calendar'};
  if(lower.includes('docs.google.com'))return{kind:'document',provider:'Google Docs'};
  if(lower.startsWith('slack://')||lower.includes('slack.com/archives/'))return{kind:'chat',provider:'Slack'};
  if(/^https?:\/\//i.test(value)){
    let host=fallbackProvider;
    try{host=new URL(value).hostname.replace(/^www\./,'')}catch{host=fallbackProvider}
    return{kind:'web',provider:host};
  }
  return{kind:'other',provider:fallbackProvider};
}
function readCaptureIntent(){
  const params=new URLSearchParams(window.location.search);
  const hasCapture=params.has('capture')||params.has('quick')||params.has('url')||params.has('text')||params.has('captureUrl');
  if(!hasCapture)return null;
  const sharedUrl=firstParam(params,['url','captureUrl','link','u']);
  const sharedText=firstParam(params,['text','captureText','body','note']);
  const titleParam=firstParam(params,['title','captureTitle','name']);
  const url=sharedUrl||firstUrl(sharedText);
  const text=withoutUrl(sharedText,url);
  const meta=linkMeta(url,firstParam(params,['provider','app']));
  const title=(titleParam||text||url||'Ny uppgift från annan app').trim();
  return {
    title:title.length>100?`${title.slice(0,97)}…`:title,
    notes:text&&text!==title?`Delad text:\n${text}`:'',
    link:url?{...meta,title:titleParam||text||url,url}:null
  };
}
function clearCaptureUrl(){
  if(!window.location.search)return;
  window.history.replaceState({},'',`${window.location.origin}${window.location.pathname}${window.location.hash}`);
}
function registerServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
}

function renderNav(){
  $('#mainNav').innerHTML=navItems.map(([id,ico,label])=>`<button class="nav-item ${view===id?'active':''}" data-view="${id}"><span class="ico">${ico}</span><span>${label}</span><span class="count">${navCount(id)||''}</span></button>`).join('');
  $('#projectNav').innerHTML=areaGroups().map(group=>{const categoryProjects=group.areas.flatMap(projectsForArea),categoryView=categoryViewId(group.category),categoryCount=taskCountForProjects(categoryProjects);return `<div class="category-group"><button class="category-label category-nav ${view===categoryView?'active':''}" data-view="${escapeHtml(categoryView)}"><span>${escapeHtml(group.category)}</span><span class="count">${categoryCount||''}</span></button>${group.areas.map(a=>{const projects=projectsForArea(a),count=taskCountForProjects(projects);return `<div class="area-group"><button class="nav-item area-nav ${view==='area:'+a.id?'active':''}" data-view="area:${a.id}"><span class="area-icon" style="background:${a.color}">${a.icon}</span><span>${escapeHtml(areaName(a))}</span><span class="count">${count||''}</span><span class="chevron">⌄</span></button>${projects.map(p=>`<button class="nav-item project-child ${view==='project:'+p.id?'active':''}" data-view="project:${p.id}"><span class="project-dot" style="background:${p.color}"></span><span>${escapeHtml(p.name)}</span><span class="count">${visible().filter(t=>t.projectId===p.id).length||''}</span></button>`).join('')}</div>`}).join('')}</div>`}).join('');
  $('#mobileNav').innerHTML=mobileItems.map(([id,ico,label])=>`<button class="mobile-nav-item ${view===id||(id==='areas'&&(view.startsWith('category:')||view.startsWith('area:')||view.startsWith('project:')))?'active':''}" data-view="${id}"><span>${ico}</span><small>${label.replace('Gör ','')}</small>${id!=='areas'&&navCount(id)?`<i>${navCount(id)}</i>`:''}</button>`).join('');
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});
}

function render(){
  if(view==='assigned')view='today';
  if(view==='team')view='areas';
  renderNav();let tasks=[],title,eye='MIN DAG',showAreas=false,currentProject=null,currentCategory=null;
  const labels={inbox:'Inbox',today:'Gör idag',later:'Gör sen',someday:'Gör nån gång'};
  if(view==='areas'){title='Kategorier & områden';eye='STRUKTUR';showAreas=true}
  else if(view.startsWith('category:')){const category=categoryFromView(),group=areaGroups().find(g=>g.category===category);if(!group){view='areas';return render()}const projects=group.areas.flatMap(projectsForArea),ids=projects.map(p=>p.id);tasks=topLevel(visible().filter(t=>ids.includes(t.projectId)));title=category;eye='KATEGORI';currentCategory=group}
  else if(view.startsWith('area:')){const a=area(view.split(':')[1]);if(!a){view='areas';return render()}const projects=projectsForArea(a),ids=projects.map(p=>p.id);tasks=topLevel(visible().filter(t=>ids.includes(t.projectId)));title=areaName(a);eye=areaCategory(a).toUpperCase()}
  else if(view.startsWith('project:')){const p=project(view.split(':')[1]);if(!p){view='areas';return render()}currentProject=p;const canPlan=p.ownerId===state.currentUserId||(!p.ownerId&&area(p.areaId)?.ownerId===state.currentUserId);tasks=topLevel(state.tasks.filter(t=>t.projectId===p.id&&!t.completed&&(t.visible||canPlan)));title=p.name;eye=areaName(area(p.areaId)).toUpperCase()||'PROJEKT'}
  else{tasks=topLevel(tasksForBucketView(view));title=labels[view]}
  $('#pageTitle').textContent=title;$('#eyebrow').textContent=eye;
  $('#subtitle').textContent=view==='today'?new Intl.DateTimeFormat('sv-SE',{weekday:'long',day:'numeric',month:'long'}).format(new Date()):showAreas?'Kategori → område → projekt → uppgift → underuppgift. Team styr bara åtkomst.':currentCategory?'Grupperat efter område och projekt.':`${tasks.length} aktiva uppgifter`;
  $('#sectionTitle').textContent=showAreas?'Kategori, område, projekt och åtkomst':currentCategory?'Områden och projekt':view==='inbox'?'Okategoriserat':'Att göra';
  $('#projectToolbar').classList.toggle('open',Boolean(currentProject));
  if(currentProject){const colors={on_track:'#42a68b',at_risk:'#e2a33d',off_track:'#d96761'},labels={on_track:'På rätt väg',at_risk:'Risk',off_track:'Försenat'};$('#projectHealth').innerHTML=`<span class="health-pill"><i style="background:${colors[currentProject.health]}"></i>${labels[currentProject.health]}</span>`}
  $('.section-head>div').style.display=showAreas?'none':'';$('#addRow').style.display=showAreas?'none':'';$('#focusCard').style.display=view==='today'?'flex':'none';
  const todayAll=state.tasks.filter(t=>t.visible&&(t.bucket==='today'||isDueToday(t)||(!t.completed&&(isOverdue(t)||isReminderDue(t))))),done=todayAll.filter(t=>t.completed).length,pct=todayAll.length?Math.round(done/todayAll.length*100):0;
  $('#todayCount').textContent=todayAll.filter(t=>!t.completed).length;$('#progressText').textContent=pct+'%';$('.done-ring').style.strokeDashoffset=100-pct;
  $('#taskList').innerHTML=showAreas?areaCards():currentCategory?categoryContent(currentCategory,tasks):currentProject?projectContent(tasks):tasks.length?tasks.map(taskGroupHtml).join(''):'<div class="empty">Här är lugnt och fint.</div>';
  document.querySelectorAll('.task').forEach(el=>el.onclick=e=>{if(!e.target.classList.contains('check'))openInspector(el.dataset.id)});
  document.querySelectorAll('.check').forEach(b=>b.onclick=e=>{e.stopPropagation();complete(b.dataset.id)});
  document.querySelectorAll('[data-area-open]').forEach(c=>c.onclick=()=>{view='area:'+c.dataset.areaOpen;render()});
  document.querySelectorAll('#taskList [data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});
  document.querySelectorAll('.board-card,.calendar-task,.flow-node').forEach(c=>c.onclick=()=>openInspector(c.dataset.id));
  if(showAreas)bindAreaOverview();
  renderNotifications();
  renderDailyBrief();
  renderAgentPanel();
}

function categoryContent(group,tasks){
  return `<div class="category-task-view">
    ${group.areas.map(a=>{
      const projects=projectsForArea(a),areaTaskCount=tasks.filter(t=>projects.some(p=>p.id===t.projectId)).length;
      return `<section class="category-area-block">
        <div class="category-area-head"><button data-view="area:${a.id}"><span class="area-card-icon small" style="background:${a.color}">${a.icon}</span><strong>${escapeHtml(areaName(a))}</strong></button><span>${areaTaskCount} uppgift${areaTaskCount===1?'':'er'}</span></div>
        <div class="category-project-list">${projects.length?projects.map(p=>{const projectTasks=tasks.filter(t=>t.projectId===p.id);return `<section class="category-project-block"><button class="category-project-head" data-view="project:${p.id}"><span class="project-dot" style="background:${p.color}"></span><strong>${escapeHtml(p.name)}</strong><span>${projectTasks.length}</span></button>${projectTasks.length?projectTasks.map(taskGroupHtml).join(''):'<p class="hint">Inga aktiva uppgifter i projektet.</p>'}</section>`}).join(''):'<p class="hint">Området har inga projekt ännu.</p>'}</div>
      </section>`;
    }).join('')}
    ${tasks.length?'':'<div class="empty">Inga aktiva uppgifter i den här kategorin.</div>'}
  </div>`;
}

function projectContent(tasks){if(!tasks.length)return'<div class="empty">Projektet väntar på sin första uppgift.</div>';if(projectView==='board')return boardHtml(tasks);if(projectView==='calendar')return calendarHtml(tasks);if(projectView==='flow')return flowHtml(tasks);return tasks.map(taskGroupHtml).join('')}
function boardHtml(tasks){const columns=[[['idea','planned','todo'],'ATT GÖRA'],[['doing'],'PÅGÅR'],[['waiting'],'VÄNTAR'],[['review'],'GRANSKNING']];return `<div class="board">${columns.map(([statuses,label])=>{const cards=tasks.filter(t=>statuses.includes(t.status||'todo'));return `<div class="board-column"><h3>${label} · ${cards.length}</h3>${cards.map(t=>`<button class="board-card" data-id="${t.id}"><strong>${escapeHtml(t.title)}</strong><span class="mini-avatar" style="background:${person(t.assigneeId).color}">${person(t.assigneeId).initials}</span></button>`).join('')}</div>`}).join('')}</div>`}
function calendarHtml(tasks){const start=startOfLocalDay();start.setDate(start.getDate()-((start.getDay()+6)%7));const days=Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return d});const undated=tasks.filter(t=>!t.dueAt&&t.due);return `<div class="calendar-view">${days.map(d=>{const iso=localDateISO(d),cards=tasks.filter(t=>t.dueAt&&sameLocalDate(t.dueAt,d));return `<div class="calendar-day"><h3>${new Intl.DateTimeFormat('sv-SE',{weekday:'short'}).format(d).toUpperCase()}<small>${new Intl.DateTimeFormat('sv-SE',{day:'numeric',month:'short'}).format(d)}</small></h3>${cards.map(t=>`<div class="calendar-task" data-id="${t.id}"><strong>${escapeHtml(formatTime(t.dueAt))}</strong>${escapeHtml(t.title)}</div>`).join('')}${!cards.length?`<p>${iso===localDateISO()?'Inget planerat idag':'—'}</p>`:''}</div>`}).join('')}</div>${undated.length?`<p class="hint">${undated.length} uppgift${undated.length===1?'':'er'} har bara datumtext. Öppna uppgiften och spara en deadline för att lägga den i kalendern.</p>`:''}`}
function flowHtml(tasks){const sorted=[...tasks].sort((a,b)=>state.dependencies.some(d=>d.taskId===b.id&&d.dependsOnTaskId===a.id)?-1:0);return `<div class="flow-view">${sorted.map(t=>`<button class="flow-node ${t.visible?'':'waiting'}" data-id="${t.id}"><strong>${escapeHtml(t.title)}</strong><small>${t.visible?'Redo att göra':`Väntar på ${state.dependencies.filter(d=>d.taskId===t.id).length} steg`}</small></button>`).join('')}</div>`}

function renderNotifications(){
  const items=state.notifications||[],reminders=reminderAlerts(),unread=items.filter(n=>!n.readAt).length+reminders.length;
  $('#notificationCount').textContent=unread;$('#notificationCount').style.display=unread?'grid':'none';$('#notificationDot').style.display='none';
  const reminderHtml=reminders.map(t=>`<button class="notification-item unread reminder-alert" data-notification="reminder:${t.id}" data-task="${t.id}"><span><strong>Påminnelse: ${escapeHtml(t.title)}</strong><p>${scheduleLabel(t)?`Deadline ${escapeHtml(scheduleLabel(t))}`:'Dags att titta på den här uppgiften.'}</p><time>${escapeHtml(reminderLabel(t))}</time></span></button>`).join('');
  const itemHtml=items.map(n=>`<button class="notification-item ${n.readAt?'':'unread'}" data-notification="${n.id}" data-task="${n.taskId||''}"><span><strong>${escapeHtml(n.title)}</strong><p>${escapeHtml(n.body)}</p><time>${new Date(n.createdAt).toLocaleString('sv-SE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></span></button>`).join('');
  $('#notificationList').innerHTML=reminderHtml||itemHtml?reminderHtml+itemHtml:'<div class="empty">Inga notiser ännu.</div>';
  document.querySelectorAll('[data-notification]').forEach(n=>n.onclick=async()=>{if(n.dataset.notification.startsWith('reminder:')){openInspector(n.dataset.task);return}await markNotificationRead(n.dataset.notification);if(n.dataset.task)openInspector(n.dataset.task);await load()})
}

function teamSharingContent(){
  const pending=(state.invitations||[]).filter(i=>!i.acceptedAt),accepted=(state.invitations||[]).filter(i=>i.acceptedAt);
  return `<div class="team-page">
    <section class="team-create-card">
      <div><p class="eyebrow">NYTT TEAM</p><h3>Skapa en grupp för jobb, privat eller båt</h3><p>Team styr vilka personer som får se områden och projekt.</p></div>
      <form id="createTeamForm" class="inline-form"><input name="name" placeholder="T.ex. Jobbteamet" required><button class="primary">Skapa team</button></form>
    </section>
    <section class="integration-card">
      <div><p class="eyebrow">INTEGRATIONER</p><h3>Slack</h3><p>${slackIntegrations().length?`${slackIntegrations().length} Slack-workspace är ansluten.`:'Koppla Slack för att Orbit ska kunna ta emot meddelandehändelser och länka Slack-trådar till uppgifter.'}</p></div>
      <button class="secondary" id="slackOAuthButton">${slackIntegrations().length?'Anslut igen':'Anslut Slack'}</button>
    </section>
    ${slackInboxContent()}
    <section class="team-grid">${state.teams.length?state.teams.map(teamCard).join(''):'<div class="empty card-empty">Inga team ännu. Skapa ditt första ovan.</div>'}</section>
    <section class="share-areas-card">
      <div class="share-head"><div><p class="eyebrow">OMRÅDESÅTKOMST</p><h3>Dela områden med rätt team</h3></div><span>${state.areas.length} områden</span></div>
      <div class="area-share-list">${state.areas.map(areaShareRow).join('')}</div>
    </section>
    <section class="invite-summary"><strong>${pending.length}</strong> väntande inbjudningar · <strong>${accepted.length}</strong> accepterade</section>
  </div>`;
}

function slackInboxContent(){
  const inbox=slackInboxEvents(),handled=slackEvents().filter(e=>e.processedAt||e.payload?.orbit?.taskId).length;
  return `<section class="slack-inbox-card">
    <div class="share-head"><div><p class="eyebrow">SLACK-INBOX</p><h3>Gör Slack-händelser till uppgifter</h3></div><span>${inbox.length} nya · ${handled} hanterade</span></div>
    ${inbox.length?`<div class="slack-event-list">${inbox.map(slackEventCard).join('')}</div>`:'<p class="muted-line">Inga nya Slack-händelser väntar. När Slack skickar events till Orbit dyker de upp här.</p>'}
  </section>`;
}

function slackEventCard(eventRow){
  const summary=slackEventSummary(eventRow),integration=state.integrations.find(i=>i.id===eventRow.integrationAccountId),title=`Slack: ${summary.title}`;
  const text=summary.text||`${summary.eventType}${eventRow.externalId?` · ${eventRow.externalId}`:''}`;
  const slackLink=summary.url?`<a class="slack-event-link" href="${escapeHtml(safeHref(summary.url))}" target="_blank" rel="noreferrer">Öppna i Slack</a>`:'';
  return `<article class="slack-event-card">
    <div class="slack-event-main"><div><strong>${escapeHtml(summary.title)}</strong><p>${escapeHtml(text)}</p><small>${escapeHtml([integration?.displayName||'Slack',summary.channelId,formatDateTime(eventRow.createdAt)].filter(Boolean).join(' · '))}</small></div><div class="slack-event-actions"><span>${escapeHtml(summary.eventType)}</span>${slackLink}</div></div>
    <form class="slack-event-form" data-slack-event="${eventRow.id}">
      <input name="title" value="${escapeHtml(title)}" required>
      <select name="projectId" class="slack-project-select">${projectOptionsHtml('')}</select>
      <select name="assigneeId" class="slack-assignee-select">${assigneeOptionsHtml('',state.currentUserId)}</select>
      <select name="priority">${[[1,'P1'],[2,'P2'],[3,'P3']].map(([id,label])=>option(id,label,3)).join('')}</select>
      <button class="primary" type="submit">Skapa uppgift</button>
    </form>
  </article>`;
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
  return `<div class="area-share-row"><div><span class="area-card-icon small" style="background:${a.color}">${a.icon}</span><div><strong>${escapeHtml(areaName(a))}</strong><small>${current?`Delas med ${current.name}`:'Privat område'}</small></div></div><select data-area-share="${a.id}" ${owner?'':'disabled'}><option value="">Endast privat</option>${state.teams.map(t=>`<option value="${t.id}" ${a.teamId===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select></div>`;
}

function bindTeamSharing(){
  $('#createTeamForm')?.addEventListener('submit',async e=>{e.preventDefault();const name=new FormData(e.target).get('name').trim();if(!name)return;await createTeam(name);await load();toast('Teamet är skapat.')});
  $('#slackOAuthButton')?.addEventListener('click',async e=>{try{e.currentTarget.disabled=true;const url=await startSlackOAuth();window.location.href=url}catch(error){e.currentTarget.disabled=false;toast(error.message)}});
  document.querySelectorAll('.slack-project-select').forEach(s=>s.onchange=()=>{const form=s.closest('form'),assignee=form.querySelector('.slack-assignee-select');assignee.innerHTML=assigneeOptionsHtml(s.value,defaultAssigneeForProject(s.value))});
  document.querySelectorAll('.slack-event-form').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(f));try{const task=await createTaskFromSlackEvent(f.dataset.slackEvent,{title:data.title,projectId:data.projectId||null,assigneeId:data.assigneeId,priority:Number(data.priority||3)});await load();toast('Slack-händelsen blev en uppgift.');openInspector(task.id)}catch(error){toast(error.message)}});
  document.querySelectorAll('.invite-form').forEach(f=>f.onsubmit=async e=>{e.preventDefault();const data=new FormData(e.target),email=data.get('email').trim().toLowerCase();if(!email)return;const invite=await createInvitation(e.target.dataset.team,email,data.get('role'));await load();toast(invite.acceptedAt?'Personen är redan medlem nu.':'Inbjudan är skapad.')});
  document.querySelectorAll('[data-area-share]').forEach(s=>s.onchange=async()=>{await shareAreaWithTeam(s.dataset.areaShare,s.value||null);await load();toast(s.value?'Området är delat med teamet.':'Området är privat igen.')});
}

function bindAreaOverview(){
  bindTeamSharing();
  document.querySelectorAll('[data-area-category]').forEach(input=>{
    const save=async()=>{
      const value=input.value.trim()||'Privat';
      if(value===input.dataset.originalCategory)return;
      input.dataset.originalCategory=value;
      input.disabled=true;
      try{await updateAreaDetails(input.dataset.areaCategory,{category:value});await load();toast(`Området flyttades till ${value}.`)}
      catch(error){input.disabled=false;toast(error.message)}
    };
    input.onblur=save;
    input.onchange=save;
  });
}

function areaAccessContent(){
  const pending=(state.invitations||[]).filter(i=>!i.acceptedAt),accepted=(state.invitations||[]).filter(i=>i.acceptedAt);
  return `<section class="area-access-card">
    <div class="share-head"><div><p class="eyebrow">TEAM & ÅTKOMST</p><h3>Team är delningsgrupper, inte en task-lista</h3><p>Skapa ett team här och koppla sedan rätt team till ett område. Projekt och uppgifter under området följer samma åtkomst.</p></div><span>${state.teams.length} team</span></div>
    <section class="team-create-card compact-access-card">
      <div><p class="eyebrow">NYTT TEAM</p><h3>Skapa åtkomstgrupp</h3><p>Exempel: Sambo, Jobbteamet eller Båtgruppen.</p></div>
      <form id="createTeamForm" class="inline-form"><input name="name" placeholder="T.ex. Jobbteamet" required><button class="primary">Skapa team</button></form>
    </section>
    <section class="team-grid">${state.teams.length?state.teams.map(teamCard).join(''):'<div class="empty card-empty">Inga team ännu. Skapa ett team när ett område ska delas.</div>'}</section>
    <section class="invite-summary"><strong>${pending.length}</strong> väntande inbjudningar · <strong>${accepted.length}</strong> accepterade</section>
  </section>`;
}

function areaHierarchyCard(a){
  const projects=projectsForArea(a),members=membersForArea(a),current=team(a.teamId),owner=a.ownerId===state.currentUserId,category=areaCategory(a),taskCount=taskCountForProjects(projects);
  return `<article class="area-card hierarchy-area-card">
    <div class="area-card-head"><span class="area-card-icon" style="background:${a.color}">${a.icon}</span><div><h3>${escapeHtml(areaName(a))}</h3><p>${projects.length} projekt · ${taskCount} uppgifter</p></div></div>
    <div class="area-card-projects">${projects.map(p=>`<span>${escapeHtml(p.name)}</span>`).join('')||'<span>Inga projekt ännu</span>'}</div>
    <div class="area-settings">
      <label>Kategori<input data-area-category="${a.id}" data-original-category="${escapeHtml(category)}" value="${escapeHtml(category)}" ${owner?'':'disabled'}></label>
      <label>Delas med<select data-area-share="${a.id}" ${owner?'':'disabled'}><option value="">Endast privat</option>${state.teams.map(t=>`<option value="${t.id}" ${a.teamId===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select></label>
    </div>
    <div class="access-note">${a.teamId?'Delas med':'Privat för dig'}<span class="team-stack">${members.map(avatarHtml).join('')}</span>${a.teamId?escapeHtml(current?.name||'Okänt team'):'Endast du'}</div>
    <button class="secondary area-open" type="button" data-area-open="${a.id}">Öppna område</button>
  </article>`;
}

function areaCards(){
  const groups=areaGroups();
  return `<div class="hierarchy-page">
    <section class="hierarchy-intro"><div><p class="eyebrow">MODELLEN</p><h3>Kategori → Område → Projekt → Task → Subtask</h3><p>Kategorier är översta nivån, t.ex. Privat, Bolag eller Jobb. Team kopplas till områden för åtkomst och är därför inte en egen uppgiftslista.</p></div></section>
    ${groups.length?groups.map(group=>`<section class="category-card"><div class="category-head"><div><p class="eyebrow">KATEGORI</p><h3>${escapeHtml(group.category)}</h3><p>${group.areas.length} område${group.areas.length===1?'':'n'}</p></div></div><div class="area-grid">${group.areas.map(areaHierarchyCard).join('')}</div></section>`).join(''):'<div class="empty">Inga områden ännu.</div>'}
    ${areaAccessContent()}
  </div>`;
}
function taskGroupHtml(t){const all=childrenOf(t.id),shown=all.filter(c=>c.visible&&!c.completed),done=all.filter(c=>c.completed).length;return `<div class="task-group">${taskHtml(t,all.length?`${done}/${all.length}`:'')}${shown.length?`<div class="subtasks">${shown.map(c=>taskHtml(c)).join('')}</div>`:''}${all.some(c=>!c.visible&&!c.completed)?`<div class="subtask-waiting">⚡ ${all.filter(c=>!c.visible&&!c.completed).length} nästa steg väntar på ett villkor</div>`:''}</div>`}
function assignmentBadge(t){return t.assigneeId===state.currentUserId&&t.createdBy&&t.createdBy!==state.currentUserId?'<span class="assignment-badge mine">◎ Tilldelat till dig</span>':''}
function taskHtml(t,progress=''){
  const p=project(t.projectId),a=person(t.assigneeId),ar=areaForProject(t.projectId),linkCount=linksForTask(t.id).length,when=scheduleLabel(t),remind=reminderLabel(t);
  return `<article class="task ${progress?'has-children':''}" data-id="${t.id}"><button class="check p${t.priority}" data-id="${t.id}" aria-label="${t.taskType==='approval'?'Godkänn':'Markera klar'}"></button><div><div class="task-title">${t.taskType==='milestone'?'◆ ':t.taskType==='approval'?'✓ ':''}${escapeHtml(t.title)}</div><div class="task-meta">${assignmentBadge(t)}${progress?`<span class="subtask-progress">☷ ${progress} delsteg</span>`:''}${linkCount?`<span class="context-count">↗ ${linkCount}</span>`:''}${when?`<span class="due ${isOverdue(t)?'overdue':''}">◷ ${escapeHtml(when)}</span>`:''}${remind?`<span class="reminder ${isReminderDue(t)?'due-now':''}">⏰ ${isReminderDue(t)?'Nu':escapeHtml(remind)}</span>`:''}${p?`<span class="project-tag"><i class="project-dot" style="background:${p.color}"></i>${p.name}</span>`:''}${ar&&!t.parentTaskId?`<span class="area-badge"><i style="background:${ar.color}"></i>${areaName(ar)}</span>`:''}</div></div>${avatarHtml(a)}</article>`
}
async function complete(id){const openChildren=childrenOf(id).filter(t=>!t.completed);if(openChildren.length){toast(`${openChildren.length} underuppgift${openChildren.length>1?'er':''} återstår.`);return}const task=state.tasks.find(t=>t.id===id),approval=(state.approvals||[]).find(a=>a.taskId===id&&a.status==='pending');if(task?.taskType==='approval'&&approval){if(approval.requestedFrom!==state.currentUserId){toast('Inväntar godkännande från rätt person.');return}await decideApproval(approval.id,'approved')}else await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify({completed:true})});await load();toast(task?.taskType==='approval'?'Godkänt.':`Klart!${state.tasks.some(t=>t.visible&&!t.completed&&t.trigger?.taskId===id)?' Nästa steg är nu synligt.':''}`)}
function renderTaskLinks(t){
  const links=linksForTask(t.id);
  return `<div class="link-section"><h3>Länkar från andra appar · ${links.length}</h3>${links.length?`<div class="task-links">${links.map(l=>`<a class="task-link-card" href="${escapeHtml(safeHref(l.url))}" target="_blank" rel="noreferrer"><span>${linkKindIcon(l.kind)}</span><div><strong>${escapeHtml(l.title||l.url||linkKindLabel(l.kind))}</strong><small>${escapeHtml([l.provider,linkKindLabel(l.kind)].filter(Boolean).join(' · '))}</small></div></a>`).join('')}</div>`:'<p class="hint">Inga länkar ännu. Lägg till mail, dokument, chatt eller annat som hör till uppgiften.</p>'}<form class="link-form" id="taskLinkForm"><select name="kind"><option value="email">Mail</option><option value="calendar">Kalender</option><option value="document">Dokument</option><option value="chat">Chatt</option><option value="web">Webb</option><option value="other">Annat</option></select><input name="title" placeholder="Titel"><input name="url" placeholder="Länk / deep link" required><button>＋</button></form></div>`
}

function renderTriggerBox(t){
  if(!t.trigger)return'';
  if(t.trigger.type==='external_event'){
    return `<div class="trigger-box"><strong>⚡ Väntar på extern trigger</strong><p>Triggernamn: <code>${escapeHtml(t.trigger.event||'')}</code></p><small>Kan låsas upp via <code>/api/external-event</code> eller Gmail-vägen <code>/api/gmail-trigger</code>.</small></div>`;
  }
  return `<div class="trigger-box"><strong>⚡ Aktiverad av villkor</strong>${escapeHtml(t.trigger.label||'Ett externt villkor')}</div>`;
}

function renderCalendarSync(t){
  const links=calendarLinksForTask(t.id),integrations=googleCalendarIntegrations(),manualUrl=googleCalendarTemplateUrl(t);
  const activeIntegrations=integrations.filter(i=>i.status==='active'),defaultIntegration=activeIntegrations[0],defaultCalendar=defaultIntegration?.settings?.calendarId||'primary';
  const start=t.dueAt||new Date().toISOString(),end=t.dueAt?addMinutes(t.dueAt,30):addMinutes(new Date().toISOString(),30);
  return `<div class="calendar-sync-section">
    <div class="calendar-sync-head"><div><h3>Google Calendar</h3><p>Planera uppgiften som kalenderblock.</p></div><div class="calendar-actions">${manualUrl?`<a class="secondary small-link" href="${escapeHtml(manualUrl)}" target="_blank" rel="noreferrer">Öppna manuellt</a>`:''}<button class="secondary small-link" id="googleOAuthButton" type="button">${activeIntegrations.length?'Anslut igen':'Anslut Google'}</button></div></div>
    ${!t.dueAt?'<p class="hint">Sätt en deadline på uppgiften för att förifylla kalenderstart.</p>':''}
    ${integrations.some(i=>i.status!=='active')?'<p class="hint">En kalenderkoppling väntar på OAuth. Klicka “Anslut Google”.</p>':''}
    ${links.length?`<div class="calendar-sync-list">${links.map(l=>`<div class="calendar-sync-row"><span class="calendar-status ${l.status}">${calendarStatusLabel(l.status)}</span><div><strong>${escapeHtml(formatDateTime(l.startAt)||'Kalenderblock')}</strong><small>${escapeHtml(l.calendarId)} · ${escapeHtml(l.timeZone)}</small>${l.payload?.syncError?`<small class="calendar-error">${escapeHtml(l.payload.syncError)}</small>`:''}</div>${l.eventUrl?`<a href="${escapeHtml(safeHref(l.eventUrl))}" target="_blank" rel="noreferrer">Visa</a>`:['pending','failed'].includes(l.status)?`<button class="secondary small-link" data-calendar-sync="${l.id}" type="button">${l.status==='failed'?'Försök igen':'Synca nu'}</button>`:''}</div>`).join('')}</div>`:'<p class="hint">Ingen kalender-sync köad ännu.</p>'}
    ${activeIntegrations.length?`<form id="calendarSyncForm" class="calendar-sync-form">
      <label>Koppling<select name="integrationAccountId">${activeIntegrations.map(i=>option(i.id,`${i.displayName||'Google Calendar'} · aktiv`,defaultIntegration?.id)).join('')}</select></label>
      <label>Kalender-ID<input name="calendarId" value="${escapeHtml(defaultCalendar)}" placeholder="primary"></label>
      <label>Start<input name="startAt" type="datetime-local" value="${toDateTimeLocalValue(start)}" required></label>
      <label>Slut<input name="endAt" type="datetime-local" value="${toDateTimeLocalValue(end)}" required></label>
      <label>Tidszon<input name="timeZone" value="Europe/Stockholm"></label>
      <button class="primary" type="submit">Köa kalender-sync</button>
    </form>`:'<p class="hint oauth-required">Automatisk sync kräver att Google OAuth är ansluten. Manuell länk fungerar redan om uppgiften har deadline.</p>'}
  </div>`;
}

function bindCalendarSync(id){
  const task=state.tasks.find(t=>t.id===id);if(!task)return;
  const oauthButton=$('#googleOAuthButton');
  if(oauthButton)oauthButton.onclick=async()=>{try{oauthButton.disabled=true;const url=await startGoogleCalendarOAuth();window.location.href=url}catch(error){oauthButton.disabled=false;toast(error.message)}};
  const syncForm=$('#calendarSyncForm');
  document.querySelectorAll('[data-calendar-sync]').forEach(b=>b.onclick=async()=>{try{b.disabled=true;await syncCalendarLinkNow(b.dataset.calendarSync);await load();openInspector(id);toast('Kalendern är synkad.')}catch(error){await load();openInspector(id);toast(error.message)}});
  if(syncForm)syncForm.onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(syncForm)),startAt=fromDateTimeLocalValue(data.startAt),endAt=fromDateTimeLocalValue(data.endAt);if(!startAt||!endAt||new Date(endAt)<=new Date(startAt)){toast('Sluttiden måste vara efter starttiden.');return}const link=await queueCalendarSync(id,{...data,startAt,endAt,title:task.title,description:task.notes||''});try{await syncCalendarLinkNow(link.id);await load();openInspector(id);toast('Kalendern är synkad.')}catch(error){await load();openInspector(id);toast(`Köad, men direkt sync misslyckades: ${error.message}`)}};
}

function renderTaskEditForm(t){
  return `<details class="task-edit-card" open>
    <summary>✎ Redigera uppgift</summary>
    <form id="taskEditForm" class="task-edit-form">
      <label>Titel<input name="title" value="${escapeHtml(t.title)}" required></label>
      <label>Anteckningar<textarea name="notes" placeholder="Lägg till mer kontext…">${escapeHtml(t.notes||'')}</textarea></label>
      <div class="form-grid compact-grid">
        <label>Var<select name="bucket">${[['inbox','Inbox'],['today','Gör idag'],['later','Gör sen'],['someday','Gör nån gång']].map(([id,label])=>option(id,label,t.bucket)).join('')}</select></label>
        <label>Status<select name="status">${[['todo','Att göra'],['planned','Planerad'],['doing','Pågår'],['waiting','Väntar'],['review','Granskning']].map(([id,label])=>option(id,label,t.status)).join('')}</select></label>
        <label>Projekt<select name="projectId" id="editProjectSelect">${projectOptionsHtml(t.projectId||'')}</select></label>
        <label>Tilldelad<select name="assigneeId" id="editAssigneeSelect">${assigneeOptionsHtml(t.projectId,t.assigneeId)}</select></label>
        <label>Prioritet<select name="priority">${[[1,'P1 — Hög'],[2,'P2 — Medium'],[3,'P3 — Låg']].map(([id,label])=>option(id,label,t.priority)).join('')}</select></label>
        <label>Snabbtext<input name="due" value="${escapeHtml(t.due||'')}" placeholder="T.ex. imorgon 09:00"></label>
        <label>Deadline<input name="dueAt" type="datetime-local" value="${toDateTimeLocalValue(t.dueAt)}"></label>
        <label>Påminnelse<input name="reminderAt" type="datetime-local" value="${toDateTimeLocalValue(t.reminderAt)}"></label>
      </div>
      <button class="primary" type="submit">Spara ändringar</button>
    </form>
  </details>`;
}

function bindTaskEditForm(id){
  const form=$('#taskEditForm');if(!form)return;
  const projectSelect=$('#editProjectSelect'),assigneeSelect=$('#editAssigneeSelect');
  bindScheduleAssist(form);
  projectSelect.onchange=()=>{assigneeSelect.innerHTML=assigneeOptionsHtml(projectSelect.value,defaultAssigneeForProject(projectSelect.value))};
  form.onsubmit=async e=>{
    e.preventDefault();
    const data=Object.fromEntries(new FormData(form));
    if(!data.title.trim()){toast('Titel saknas.');return}
    const projectId=data.projectId||null;
    const assigneeId=projectId?data.assigneeId:state.currentUserId;
    const schedule=scheduleFromForm(data);
    await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify({
      title:data.title.trim(),
      notes:data.notes||'',
      bucket:data.bucket,
      status:data.status,
      projectId,
      assigneeId,
      priority:Number(data.priority||3),
      due:schedule.due,
      dueAt:schedule.dueAt,
      reminderAt:schedule.reminderAt
    })});
    await load();
    openInspector(id);
    toast('Uppgiften är uppdaterad.');
  };
}

function openInspector(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;
  const p=project(t.projectId),a=person(t.assigneeId),ar=areaForProject(t.projectId),tm=team(ar?.teamId),subs=childrenOf(t.id),comments=(state.comments||[]).filter(c=>c.taskId===id);
  const when=scheduleLabel(t),remind=reminderLabel(t);
  $('#inspectorContent').innerHTML=`<p class="eyebrow">${ar?escapeHtml(areaName(ar)).toUpperCase():'UPPGIFT'}</p><button class="check big-check p${t.priority}" id="detailCheck"></button><h2>${escapeHtml(t.title)}</h2>${subs.length?`<div class="parent-lock">Huvuduppgiften blir klar automatiskt när alla ${subs.length} delsteg är klara.</div>`:''}${t.activationReason?`<div class="activation-explain"><strong>✦ Varför ser jag detta nu?</strong>${escapeHtml(t.activationReason)}${t.activatedAt?` · ${new Date(t.activatedAt).toLocaleString('sv-SE')}`:''}</div>`:''}${t.notes?`<p style="color:#777;font-size:13px;line-height:1.6">${escapeHtml(t.notes)}</p>`:''}<div class="detail-row"><span>Status</span><strong class="status-chip">${statusLabel(t.status)}</strong></div><div class="detail-row"><span>Område</span><strong>${ar?ar.icon+' '+areaName(ar):'Inbox'}</strong></div><div class="detail-row"><span>Projekt</span><strong>${p?p.name:'Inbox'}</strong></div><div class="detail-row"><span>Tilldelad</span><strong>${a.name}</strong></div><div class="detail-row"><span>Åtkomst</span><strong>${tm?tm.name:'Endast du'}</strong></div><div class="detail-row"><span>Deadline</span><strong>${when?escapeHtml(when):'Inget datum'}</strong></div><div class="detail-row"><span>Påminnelse</span><strong>${remind?`${isReminderDue(t)?'Nu · ':''}${escapeHtml(remind)}`:'Ingen'}</strong></div>${renderTaskEditForm(t)}${subs.length?`<div class="inspector-subtasks"><h3>Underuppgifter · ${subs.filter(s=>s.completed).length}/${subs.length}</h3>${subs.map(s=>`<div class="inspector-subtask ${s.completed?'done':''} ${!s.visible?'waiting':''}">${s.completed?'✓':s.visible?`<button class="check p${s.priority}" data-id="${s.id}"></button>`:'⚡'}<span>${escapeHtml(s.title)}</span><small>${!s.visible?'Väntar':person(s.assigneeId).initials}</small></div>`).join('')}</div>`:''}${renderTriggerBox(t)}${renderCalendarSync(t)}${renderTaskLinks(t)}<div class="comment-section"><h3>Kommentarer · ${comments.length}</h3>${comments.map(c=>`<div class="comment">${avatarHtml(person(c.authorId))}<div><p>${escapeHtml(c.body)}</p><time>${new Date(c.createdAt).toLocaleString('sv-SE')}</time></div></div>`).join('')}<form class="comment-form" id="commentForm"><input name="comment" placeholder="Skriv en kommentar eller @nämn någon…" required><button>Skicka</button></form></div>`;
  $('#detailCheck').onclick=()=>{complete(id);if(!subs.length)$('#inspector').classList.remove('open')};
  document.querySelectorAll('.inspector-subtask .check').forEach(b=>b.onclick=async()=>{await complete(b.dataset.id);openInspector(id)});
  bindTaskEditForm(id);
  bindCalendarSync(id);
  $('#taskLinkForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);await addTaskLink(id,{kind:f.get('kind'),title:f.get('title'),url:f.get('url')});await load();openInspector(id);toast('Länken är tillagd.')};
  $('#commentForm').onsubmit=async e=>{e.preventDefault();const body=new FormData(e.target).get('comment');await addComment(id,body);await load();openInspector(id)};
  $('#inspector').classList.add('open')
}
function statusLabel(s){return({idea:'Idé',planned:'Planerad',todo:'Att göra',doing:'Pågår',waiting:'Väntar',review:'Granskning',done:'Klar'})[s]||'Att göra'}
function buildDailyBrief(){
  const active=state.tasks.filter(t=>t.visible&&!t.completed),today=topLevel(active.filter(t=>t.bucket==='today'||isDueToday(t)||isOverdue(t)||isReminderDue(t))),overdue=topLevel(active.filter(isOverdue)),p1=topLevel(active.filter(t=>t.priority===1)),doing=topLevel(active.filter(t=>t.status==='doing')),waiting=topLevel(active.filter(t=>t.status==='waiting')),inbox=topLevel(active.filter(t=>t.bucket==='inbox')),linked=active.filter(t=>linksForTask(t.id).length);
  const focus=[...new Map([...p1,...doing,...today,...inbox].map(t=>[t.id,t])).values()].slice(0,5);
  const suggestions=[];
  if(overdue.length)suggestions.push({type:'overdue',text:`${overdue.length} uppgift${overdue.length>1?'er är':' är'} försenad${overdue.length>1?'e':''}.`});
  if(p1.length)suggestions.push({type:'priority',text:`Börja med ${p1.length} P1-uppgift${p1.length>1?'er':''}.`});
  if(inbox.length>=3)suggestions.push({type:'inbox',text:`Rensa inboxen: ${inbox.length} okategoriserade uppgifter väntar.`});
  if(waiting.length)suggestions.push({type:'waiting',text:`${waiting.length} uppgift${waiting.length>1?'er':''} står i vänteläge. Följ upp blockeringen eller låt MCP bevaka händelsen.`});
  if(linked.length)suggestions.push({type:'context',text:`${linked.length} uppgift${linked.length>1?'er har':' har'} länkar till mail, dokument eller andra appar.`});
  if(!suggestions.length)suggestions.push({type:'calm',text:'Läget är rent. Välj en tydlig nästa uppgift och håll flödet enkelt.'});
  return {briefDate:localDateISO(),title:'Dagens Orbit-brief',summary:`Du har ${today.length} uppgift${today.length===1?'':'er'} i dagens vy, ${p1.length} P1${overdue.length?`, ${overdue.length} försenad${overdue.length>1?'e':''}`:''} och ${waiting.length} väntande. ${focus.length?`Föreslaget fokus: ${focus.map(t=>t.title).join(', ')}.`:'Ingen akut fokusuppgift hittades.'}`,focusTaskIds:focus.map(t=>t.id),blockers:waiting.slice(0,5).map(t=>({taskId:t.id,title:t.title,reason:t.activationReason||t.trigger?.label||'Markerad som väntar'})),suggestions,generatedBy:'orbit-client-agent'};
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

function buildAgentPlan(){
  const active=state.tasks.filter(t=>t.visible&&!t.completed),hidden=state.tasks.filter(t=>!t.visible&&!t.completed),overdue=topLevel(active.filter(isOverdue)),p1=topLevel(active.filter(t=>t.priority===1)),doing=topLevel(active.filter(t=>t.status==='doing')),inbox=topLevel(active.filter(t=>t.bucket==='inbox')),waiting=topLevel(active.filter(t=>t.status==='waiting'||hidden.some(h=>h.parentTaskId===t.id))),dueWithoutCalendar=topLevel(active.filter(t=>t.dueAt&&!calendarLinksForTask(t.id).some(l=>['pending','synced'].includes(l.status)))),linked=topLevel(active.filter(t=>linksForTask(t.id).length));
  const actions=[];
  const push=(type,text,task)=>actions.push({type,text,taskId:task?.id||null,taskTitle:task?.title||''});
  if(overdue[0])push('overdue',`Ta hand om försenad uppgift: ${overdue[0].title}.`,overdue[0]);
  if(p1[0])push('priority',`Starta nästa P1: ${p1[0].title}.`,p1[0]);
  if(doing[0])push('progress',`Fortsätt pågående arbete: ${doing[0].title}.`,doing[0]);
  if(dueWithoutCalendar[0])push('calendar',`Schemalägg ${dueWithoutCalendar[0].title} i Google Calendar.`,dueWithoutCalendar[0]);
  if(inbox.length)push('inbox',`Rensa inboxen: ${inbox.length} osorterad${inbox.length>1?'e':''} uppgift${inbox.length>1?'er':''}.`,inbox[0]);
  if(waiting.length)push('waiting',`Följ upp vänteläge: ${waiting[0].title}.`,waiting[0]);
  if(hidden.length)actions.push({type:'trigger',text:`${hidden.length} dold${hidden.length>1?'a':''} uppgift${hidden.length>1?'er':''} väntar på kedja eller extern trigger.`,taskId:null,taskTitle:''});
  if(linked[0])push('context',`Använd app-länken på ${linked[0].title} för snabb kontext.`,linked[0]);
  if(!actions.length)actions.push({type:'calm',text:'Inget akut hittades. Välj en tydlig uppgift och håll dagen enkel.',taskId:null,taskTitle:''});
  return {
    goal:'Föreslå nästa praktiska steg',
    result:{
      summary:`Agenten hittade ${actions.length} rekommenderad${actions.length===1?'':'e'} åtgärd${actions.length===1?'':'er'} utifrån prioritet, datum, inbox, väntelägen och länkar.`,
      proposedActions:actions.slice(0,6),
      stats:{active:active.length,hidden:hidden.length,overdue:overdue.length,p1:p1.length,inbox:inbox.length,waiting:waiting.length,dueWithoutCalendar:dueWithoutCalendar.length},
      generatedBy:'orbit-client-agent',
      generatedAt:new Date().toISOString()
    }
  };
}

function renderAgentPanel(){
  const card=$('#agentCard');if(!card||!state)return;
  card.style.display=view==='today'?'block':'none';
  const latest=[...(state.agentRuns||[])].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0],actions=latest?.result?.proposedActions||[];
  $('#agentSummary').textContent=latest?.result?.summary||'Kör agenten för att få konkreta nästa steg baserat på prioritet, inbox, kalenderläge, väntelägen och app-länkar.';
  $('#agentActions').innerHTML=actions.length?actions.slice(0,5).map(a=>`<button class="agent-action" ${a.taskId?`data-agent-task="${a.taskId}"`:''}><span>${escapeHtml((a.type||'next').toUpperCase())}</span><strong>${escapeHtml(a.text||'Föreslagen åtgärd')}</strong>${a.taskTitle?`<small>${escapeHtml(a.taskTitle)}</small>`:''}</button>`).join(''):'<p class="hint">Inga agentförslag sparade ännu.</p>';
  $('#agentActions').querySelectorAll('[data-agent-task]').forEach(b=>b.onclick=()=>openInspector(b.dataset.agentTask));
  $('#runAgent').onclick=async()=>{const plan=buildAgentPlan();await saveAgentRun(plan);await load();toast('Agenten har föreslagit nästa steg.')};
}
function refreshAssignees(){const projectId=$('#projectSelect').value;$('#assigneeSelect').innerHTML=assigneeOptionsHtml(projectId,defaultAssigneeForProject(projectId))}
function openDialog(prefill={}){
  $('#taskForm').reset();
  $('#linkDetails').open=false;
  $('#projectSelect').innerHTML=projectOptionsHtml('');
  if(view.startsWith('project:'))$('#projectSelect').value=view.split(':')[1]; else if(bucketViews.includes(view))$('#taskForm').elements.bucket.value=view;
  const candidates=state.tasks.filter(t=>!t.completed&&t.visible);
  $('#parentTaskSelect').innerHTML='<option value="">Ingen — fristående uppgift</option>'+candidates.map(t=>`<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  $('#dependencyTaskSelect').innerHTML=candidates.map(t=>`<option value="${t.id}">${escapeHtml(t.title)}</option>`).join('');
  bindScheduleAssist($('#taskForm'));
  refreshAssignees();
  if(prefill.title)$('#taskForm').elements.title.value=prefill.title;
  if(prefill.notes)$('#taskForm').elements.notes.value=prefill.notes;
  if(prefill.bucket)$('#taskForm').elements.bucket.value=prefill.bucket;
  if(prefill.link){
    $('#linkDetails').open=true;
    $('#taskForm').elements.linkKind.value=prefill.link.kind||'other';
    $('#taskForm').elements.linkProvider.value=prefill.link.provider||'';
    $('#taskForm').elements.linkTitle.value=prefill.link.title||prefill.title||'';
    $('#taskForm').elements.linkUrl.value=prefill.link.url||'';
  }
  $('#taskDialog').showModal();setTimeout(()=>$('#newTitle').focus(),50)
}
$('#projectSelect').onchange=refreshAssignees;
$('#quickAdd').onclick=$('#addRow').onclick=$('#mobileAdd').onclick=openDialog;$('#closeInspector').onclick=()=>$('#inspector').classList.remove('open');
document.querySelectorAll('[data-close-task-dialog]').forEach(b=>b.onclick=()=>$('#taskDialog').close());
document.querySelectorAll('[data-project-view]').forEach(b=>b.onclick=()=>{projectView=b.dataset.projectView;document.querySelectorAll('[data-project-view]').forEach(x=>x.classList.toggle('active',x===b));render()});
$('#notificationButton').onclick=()=>$('#notificationPanel').classList.add('open');$('#closeNotifications').onclick=()=>$('#notificationPanel').classList.remove('open');
$('#taskForm').onsubmit=async e=>{
  e.preventDefault();
  const f=new FormData(e.target),data=Object.fromEntries(f),dependencies=f.getAll('dependencyTaskIds').filter(Boolean);
  if(!data.title.trim())return;
  const link={kind:data.linkKind||'other',provider:data.linkProvider||'',title:data.linkTitle||data.title,url:data.linkUrl||''};
  const type=data.triggerType,val=type==='task_completed'?dependencies[0]:data.triggerValue;
  const schedule=scheduleFromForm(data);data.due=schedule.due;data.dueAt=schedule.dueAt;data.reminderAt=schedule.reminderAt;
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
async function boot(){if(!configured){showAuth();return}const current=await session();if(!current){showAuth();return}hideAuth();$('#currentUserName').textContent=current.user.user_metadata?.name||current.user.email.split('@')[0];await load();state.currentUserId=current.user.id;render();if(pendingCapture){const capture=pendingCapture;pendingCapture=null;openDialog(capture);clearCaptureUrl();toast('Länken är fångad. Spara för att skapa uppgiften.')}if(liveChannel)await liveChannel.unsubscribe();liveChannel=subscribeToChanges(()=>load())}
registerServiceWorker();
boot();
