import { configured, session, signIn, signUp, signOut, loadCloudState, createCloudTask, updateCloudTask, respondToAssignment, subscribeToChanges, addComment, addTaskLink, startGoogleCalendarOAuth, startSlackOAuth, slackEventSummary, createTaskFromSlackEvent, syncCalendarLinkNow, queueCalendarSync, saveDailyBrief, saveAgentRun, markNotificationRead, decideApproval, createTeam, createArea, createProject, updateProject, renameCategory, upsertCategorySetting, createInvitation, updateTeamMember, removeTeamMember, deleteInvitation, shareAreaWithTeam, updateAreaDetails } from './cloud.js';

let state, view = 'today', projectView='list', liveChannel, deferredInstallPrompt=null, reminderTimer=null;
const $ = s => document.querySelector(s);
const appShellSelectors = ['.sidebar','main','#inspector','#notificationPanel','#commandDialog','#taskDialog','#structureDialog','#mobileAdd','#mobileNav'];
function setAppLocked(locked){
  appShellSelectors.forEach(selector=>{
    const el=$(selector);
    if(!el)return;
    el.inert=locked;
    el.setAttribute('aria-hidden',locked?'true':'false');
  });
}
const bucketViews = ['inbox','today','later','someday'];
const navItems = [['inbox','⌄','Inbox'],['today','☀','Gör idag'],['later','◷','Gör sen'],['someday','◇','Gör nån gång'],['review','◎','Review'],['settings','⚙','Inställningar']];
const mobileItems = [['inbox','⌄','Inbox'],['today','☀','Idag'],['later','◷','Sen'],['review','◎','Review'],['areas','▦','Områden'],['settings','⚙','Mer']];
let pendingCapture = readCaptureIntent();
const collapsedCategories = new Set();
const collapsedAreas = new Set();
let dailyCapacity = Number(localStorage.getItem('orbitDailyCapacity') || 3);
if(![1,3,5].includes(dailyCapacity))dailyCapacity=3;
let taskScope=localStorage.getItem('orbitTaskScope')||'all';
if(!['all','mine'].includes(taskScope))taskScope='all';
let taskSort=localStorage.getItem('orbitTaskSort')||'smart';
if(!['smart','priority','due','name'].includes(taskSort))taskSort='smart';
let notifiedReminderKeys=new Set(JSON.parse(localStorage.getItem('orbitNotifiedReminders')||'[]'));
let pendingTaskOpen = new URLSearchParams(window.location.search).get('task') || '';

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
const categorySetting=name=>(state.categorySettings||[]).find(c=>c.name===name);
const categoryVisual=name=>{const setting=categorySetting(name),firstArea=(state.areas||[]).find(a=>areaCategory(a)===name);return{icon:setting?.icon||firstArea?.icon||'▣',color:setting?.color||firstArea?.color||'#7659ef'}};
const categoryIconHtml=name=>{const visual=categoryVisual(name);return`<span class="category-icon" style="background:${escapeHtml(visual.color)}">${escapeHtml(visual.icon)}</span>`};
const projectIconHtml=p=>`<span class="project-icon" style="background:${escapeHtml(p?.color||'#8b70ff')}">${escapeHtml(p?.icon||'▣')}</span>`;
const taskCountForProjects=projects=>visible().filter(t=>projects.some(p=>p.id===t.projectId)).length;
const categoryViewId=category=>`category:${encodeURIComponent(category)}`;
const categoryFromView=()=>decodeURIComponent(view.slice('category:'.length));
const areaHasActiveProject=a=>view.startsWith('project:')&&projectsForArea(a).some(p=>view==='project:'+p.id);
const areaIsActive=a=>view==='area:'+a.id||areaHasActiveProject(a);
const categoryIsActive=group=>view===categoryViewId(group.category)||group.areas.some(areaIsActive);
const categoryIsOpen=group=>categoryIsActive(group)||!collapsedCategories.has(group.category);
const areaIsOpen=a=>areaIsActive(a)||!collapsedAreas.has(a.id);
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
const dayAt=(offset=0,h=9,m=0)=>{const d=startOfLocalDay();d.setDate(d.getDate()+offset);d.setHours(h,m,0,0);return d};
const todayPlanTime=()=>{const d=dayAt(0,18);if(d.getTime()<Date.now()+30*60000)d.setTime(Date.now()+60*60000);return d.toISOString()};
const formatDateTime=iso=>{if(!iso)return'';const d=new Date(iso);if(Number.isNaN(d.getTime()))return'';const same=sameLocalDate(iso);return new Intl.DateTimeFormat('sv-SE',same?{hour:'2-digit',minute:'2-digit'}:{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(d)};
const formatTime=iso=>{const d=new Date(iso);return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('sv-SE',{hour:'2-digit',minute:'2-digit'}).format(d)};
const addMinutes=(iso,minutes)=>{const d=new Date(iso||Date.now());d.setMinutes(d.getMinutes()+minutes);return d.toISOString()};
const googleDate=iso=>new Date(iso).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
const googleCalendarTemplateUrl=t=>{if(!t.dueAt)return'';const details=[t.notes||'',`Orbit task: ${t.id}`].filter(Boolean).join('\n\n');const params=new URLSearchParams({action:'TEMPLATE',text:t.title,details,dates:`${googleDate(t.dueAt)}/${googleDate(addMinutes(t.dueAt,30))}`});return `https://calendar.google.com/calendar/render?${params.toString()}`};
const scheduleLabel=t=>t.dueAt?formatDateTime(t.dueAt):(t.due||'');
const reminderLabel=t=>t.reminderAt?formatDateTime(t.reminderAt):'';
const isPendingAssignmentForMe=t=>t.assigneeId===state.currentUserId&&t.createdBy&&t.createdBy!==state.currentUserId&&t.assignmentStatus==='pending';
const tasksForBucketView=id=>id==='today'?visible().filter(t=>t.bucket==='today'||isDueToday(t)||isOverdue(t)||isReminderDue(t)):id==='inbox'?visible().filter(t=>t.bucket==='inbox'||isPendingAssignmentForMe(t)):visible().filter(t=>t.bucket===id);
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
const reviewGroups=()=>{const active=topLevel(visible());return{
  overdue:active.filter(isOverdue),
  waiting:active.filter(t=>t.status==='waiting'),
  unplanned:active.filter(t=>!t.dueAt&&['later','someday'].includes(t.bucket)),
  inbox:active.filter(t=>t.bucket==='inbox'&&!t.projectId),
  someday:active.filter(t=>t.bucket==='someday')
}};
const reviewCount=()=>Object.values(reviewGroups()).reduce((sum,items)=>sum+items.length,0);
const navCount=id=>bucketViews.includes(id)?tasksForBucketView(id).length:id==='review'?reviewCount():0;
const option=(value,label,selected)=>`<option value="${escapeHtml(value)}" ${String(value)===String(selected||'')?'selected':''}>${escapeHtml(label)}</option>`;
const projectOptionsHtml=selected=>'<option value="">Inbox / inget projekt</option>'+areaGroups().map(group=>`<optgroup label="${escapeHtml(group.category)}">${group.areas.flatMap(a=>projectsForArea(a).map(p=>option(p.id,`${areaName(a)} · ${p.name}`,selected))).join('')}</optgroup>`).join('');
const assigneesForProject=projectId=>{const p=project(projectId);return p?membersForArea(area(p.areaId)):[person(state.currentUserId)]};
const assigneeOptionsHtml=(projectId,selected)=>{const list=assigneesForProject(projectId);if(selected&&!list.some(p=>p.id===selected))list.push(person(selected));return list.map(p=>option(p.id,p.name,selected||list[0]?.id)).join('')};
const defaultAssigneeForProject=projectId=>assigneesForProject(projectId)[0]?.id||state.currentUserId;
function taskContextHtml(projectId='',assigneeId=''){
  const p=project(projectId),a=p?area(p.areaId):null,tm=a?.teamId?team(a.teamId):null,assignee=person(assigneeId||defaultAssigneeForProject(projectId));
  if(!p||!a)return `<div class="task-context-path"><span class="context-node inbox">Inbox</span></div><p>Uppgiften saknar projekt och blir privat för dig tills du placerar den i ett projekt.</p>`;
  return `<div class="task-context-path">
    <span class="context-node">${categoryIconHtml(areaCategory(a))}${escapeHtml(areaCategory(a))}</span>
    <span class="context-arrow">›</span>
    <span class="context-node"><span class="area-icon" style="background:${escapeHtml(a.color)}">${escapeHtml(a.icon)}</span>${escapeHtml(areaName(a))}</span>
    <span class="context-arrow">›</span>
    <span class="context-node">${projectIconHtml(p)}${escapeHtml(p.name)}</span>
  </div><p>${tm?`Delas med teamet ${escapeHtml(tm.name)}.`:'Privat område.'} Tilldelas: ${escapeHtml(assignee.name)}.</p>`;
}
function updateTaskContext(selectId='projectSelect',assigneeId='assigneeSelect',cardId='taskContextCard'){
  const projectValue=$('#'+selectId)?.value||'',assigneeValue=$('#'+assigneeId)?.value||defaultAssigneeForProject(projectValue),card=$('#'+cardId);
  if(card)card.innerHTML=taskContextHtml(projectValue,assigneeValue);
}
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
function clearQueryUrl(){
  if(!window.location.search)return;
  window.history.replaceState({},'',`${window.location.origin}${window.location.pathname}${window.location.hash}`);
}
function isStandaloneApp(){
  return window.matchMedia?.('(display-mode: standalone)')?.matches||window.navigator.standalone===true;
}
function notificationStatusLabel(){
  if(!('Notification' in window))return'Stöds inte';
  return ({default:'Inte frågat',granted:'Tillåtet',denied:'Blockerat'})[Notification.permission]||Notification.permission;
}
function saveNotifiedReminderKeys(){
  const keys=[...notifiedReminderKeys].slice(-80);
  notifiedReminderKeys=new Set(keys);
  localStorage.setItem('orbitNotifiedReminders',JSON.stringify(keys));
}
async function showLocalNotification(title,options={}){
  if(!('Notification' in window)||Notification.permission!=='granted')return false;
  if(navigator.serviceWorker?.ready){
    const registration=await navigator.serviceWorker.ready;
    await registration.showNotification(title,{badge:'/orbit-icon.svg',icon:'/orbit-icon.svg',...options});
    return true;
  }
  new Notification(title,{icon:'/orbit-icon.svg',...options});
  return true;
}
async function requestLocalNotifications(){
  if(!('Notification' in window)){toast('Den här webbläsaren stödjer inte notiser.');return}
  const permission=await Notification.requestPermission();
  if(permission==='granted'){
    toast('Notiser är aktiverade.');
    await showLocalNotification('Orbit-notiser är på', { body:'Du får lokala påminnelser när appen är öppen.', tag:'orbit-notification-test' });
  }else toast(permission==='denied'?'Notiser är blockerade i webbläsaren.':'Notiser aktiverades inte.');
  if(view==='settings')render();
}
async function notifyDueReminders(){
  if(!state||!('Notification' in window)||Notification.permission!=='granted')return;
  const due=reminderAlerts().slice(0,5);
  for(const task of due){
    const key=`${task.id}:${task.reminderAt||task.dueAt||''}`;
    if(notifiedReminderKeys.has(key))continue;
    notifiedReminderKeys.add(key);
    await showLocalNotification(`Orbit: ${task.title}`, {
      body: scheduleLabel(task)?`Deadline ${scheduleLabel(task)}`:'Dags att titta på uppgiften.',
      data: { taskId: task.id },
      tag: `orbit-reminder-${task.id}`
    });
  }
  if(due.length)saveNotifiedReminderKeys();
}
function startReminderLoop(){
  if(reminderTimer)return;
  notifyDueReminders();
  reminderTimer=setInterval(notifyDueReminders,60_000);
}
async function installOrbitApp(){
  if(isStandaloneApp()){toast('Orbit är redan installerad som app.');return}
  if(!deferredInstallPrompt){toast('Installera via webbläsarens dela/meny: “Lägg till på hemskärmen”.');return}
  deferredInstallPrompt.prompt();
  const choice=await deferredInstallPrompt.userChoice.catch(()=>null);
  deferredInstallPrompt=null;
  toast(choice?.outcome==='accepted'?'Installationen startade.':'Installationen avbröts.');
  if(view==='settings')render();
}
function registerServiceWorker(){
  if(!('serviceWorker' in navigator))return;
  window.addEventListener('load',()=>navigator.serviceWorker.register('/service-worker.js').catch(()=>{}));
}
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstallPrompt=event;if(view==='settings')render()});

function bindStructureActions(root=document){
  root.querySelectorAll('[data-toggle-category]').forEach(b=>b.onclick=()=>{const category=b.dataset.toggleCategory;collapsedCategories.has(category)?collapsedCategories.delete(category):collapsedCategories.add(category);render()});
  root.querySelectorAll('[data-toggle-area]').forEach(b=>b.onclick=()=>{const id=b.dataset.toggleArea;collapsedAreas.has(id)?collapsedAreas.delete(id):collapsedAreas.add(id);render()});
  root.querySelectorAll('[data-create-structure]').forEach(b=>b.onclick=()=>openStructureDialog(b.dataset.createStructure));
  root.querySelectorAll('[data-create-area]').forEach(b=>b.onclick=()=>openStructureDialog('area',{category:b.dataset.createArea}));
  root.querySelectorAll('[data-create-project]').forEach(b=>b.onclick=()=>openStructureDialog('project',{areaId:b.dataset.createProject}));
  root.querySelectorAll('[data-create-task-project]').forEach(b=>b.onclick=()=>openDialog({projectId:b.dataset.createTaskProject}));
  root.querySelectorAll('[data-edit-category]').forEach(b=>b.onclick=()=>openStructureDialog('edit-category',{category:b.dataset.editCategory}));
  root.querySelectorAll('[data-edit-area]').forEach(b=>b.onclick=()=>openStructureDialog('edit-area',{areaId:b.dataset.editArea}));
  root.querySelectorAll('[data-edit-project]').forEach(b=>b.onclick=()=>openStructureDialog('edit-project',{projectId:b.dataset.editProject}));
}

function renderNav(){
  $('#mainNav').innerHTML=navItems.map(([id,ico,label])=>`<button class="nav-item ${view===id?'active':''}" data-view="${id}"><span class="ico">${ico}</span><span>${label}</span><span class="count">${navCount(id)||''}</span></button>`).join('');
  $('#projectNav').innerHTML=`${areaGroups().map(group=>{
    const categoryProjects=group.areas.flatMap(projectsForArea),categoryView=categoryViewId(group.category),categoryCount=taskCountForProjects(categoryProjects),open=categoryIsOpen(group);
    return `<div class="tree-category ${open?'open':'closed'}">
      <div class="tree-row category-row ${categoryIsActive(group)?'active':''}">
        <button class="tree-toggle" data-toggle-category="${escapeHtml(group.category)}">${open?'▾':'▸'}</button>
        <button class="tree-main" data-view="${escapeHtml(categoryView)}">${categoryIconHtml(group.category)}<span>${escapeHtml(group.category)}</span><small>${group.areas.length} område${group.areas.length===1?'':'n'}</small><i>${categoryCount||''}</i></button>
        <button class="tree-action" title="Nytt område i ${escapeHtml(group.category)}" data-create-area="${escapeHtml(group.category)}">＋</button>
      </div>
      ${open?`<div class="tree-children">${group.areas.map(a=>{
        const projects=projectsForArea(a),areaOpen=areaIsOpen(a),count=taskCountForProjects(projects);
        return `<div class="tree-area ${areaOpen?'open':'closed'}">
          <div class="tree-row area-row ${areaIsActive(a)?'active':''}">
            <button class="tree-toggle" data-toggle-area="${a.id}">${areaOpen?'▾':'▸'}</button>
            <button class="tree-main" data-view="area:${a.id}"><span class="area-icon" style="background:${a.color}">${a.icon}</span><span>${escapeHtml(areaName(a))}</span><small>${projects.length?`${projects.length} projekt`:'Inga projekt'}</small><i>${count||''}</i></button>
            <button class="tree-action" title="Nytt projekt i ${escapeHtml(areaName(a))}" data-create-project="${a.id}">＋</button>
          </div>
          ${areaOpen?`<div class="tree-projects">${projects.map(p=>`<div class="tree-project-line"><span class="tree-project-spacer"></span><button class="tree-project ${view==='project:'+p.id?'active':''}" data-view="project:${p.id}">${projectIconHtml(p)}<span>${escapeHtml(p.name)}</span><i>${visible().filter(t=>t.projectId===p.id).length||''}</i></button><button class="tree-action project-add" title="Ny uppgift i ${escapeHtml(p.name)}" data-create-task-project="${p.id}">＋</button></div>`).join('')}${projects.length?'':`<span class="tree-empty-note">Inga projekt ännu</span>`}</div>`:''}
        </div>`;
      }).join('')}</div>`:''}
    </div>`;
  }).join('')}`;
  $('#mobileNav').innerHTML=mobileItems.map(([id,ico,label])=>`<button class="mobile-nav-item ${view===id||(id==='areas'&&(view.startsWith('category:')||view.startsWith('area:')||view.startsWith('project:')))?'active':''}" data-view="${id}"><span>${ico}</span><small>${label.replace('Gör ','')}</small>${id!=='areas'&&navCount(id)?`<i>${navCount(id)}</i>`:''}</button>`).join('');
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});
  bindStructureActions();
}

function render(){
  if(view==='assigned')view='today';
  if(view==='team')view='settings';
  renderNav();let tasks=[],title,eye='MIN DAG',showAreas=false,currentProject=null,currentCategory=null;
  const labels={inbox:'Inbox',today:'Gör idag',later:'Gör sen',someday:'Gör nån gång',review:'Review'};
  if(view==='settings'){title='Inställningar';eye='ADMIN';showAreas=true}
  else if(view==='areas'){title='Kategorier & områden';eye='STRUKTUR';showAreas=true}
  else if(view.startsWith('category:')){const category=categoryFromView(),group=areaGroups().find(g=>g.category===category);if(!group){view='areas';return render()}const projects=group.areas.flatMap(projectsForArea),ids=projects.map(p=>p.id);tasks=topLevel(visible().filter(t=>ids.includes(t.projectId)));title=category;eye='KATEGORI';currentCategory=group}
  else if(view.startsWith('area:')){const a=area(view.split(':')[1]);if(!a){view='areas';return render()}const projects=projectsForArea(a),ids=projects.map(p=>p.id);tasks=topLevel(visible().filter(t=>ids.includes(t.projectId)));title=areaName(a);eye=areaCategory(a).toUpperCase()}
  else if(view.startsWith('project:')){const p=project(view.split(':')[1]);if(!p){view='areas';return render()}currentProject=p;const canPlan=p.ownerId===state.currentUserId||(!p.ownerId&&area(p.areaId)?.ownerId===state.currentUserId);tasks=topLevel(state.tasks.filter(t=>t.projectId===p.id&&!t.completed&&(t.visible||canPlan)));title=p.name;eye=areaName(area(p.areaId)).toUpperCase()||'PROJEKT'}
  else if(view==='review'){tasks=[];title='Review';eye='BESLUT'}
  else{tasks=topLevel(tasksForBucketView(view));title=labels[view]}
  if(!showAreas)tasks=applyTaskViewControls(tasks);
  $('#pageTitle').textContent=title;$('#eyebrow').textContent=eye;
  $('#subtitle').textContent=view==='today'?new Intl.DateTimeFormat('sv-SE',{weekday:'long',day:'numeric',month:'long'}).format(new Date()):view==='review'?'Samla lösa trådar och bestäm vad som ska hända med dem.':view==='settings'?'Konto, team, integrationer, MCP och appstatus.':showAreas?'Kategori → område → projekt → uppgift → underuppgift. Team styr bara åtkomst.':currentCategory?'Grupperat efter område och projekt.':`${tasks.length} aktiva uppgifter`;
  $('#sectionTitle').textContent=view==='settings'?'App och åtkomst':view==='review'?'Saker som behöver beslut':showAreas?'Kategori, område, projekt och åtkomst':currentCategory?'Områden och projekt':view==='inbox'?'Okategoriserat':'Att göra';
  $('#projectToolbar').classList.toggle('open',Boolean(currentProject));
  if(currentProject){const colors={on_track:'#42a68b',at_risk:'#e2a33d',off_track:'#d96761'},labels={on_track:'På rätt väg',at_risk:'Risk',off_track:'Försenat'};$('#projectHealth').innerHTML=`<span class="health-pill"><i style="background:${colors[currentProject.health]}"></i>${labels[currentProject.health]}</span>`}
  $('.section-head>div').style.display=showAreas||view==='review'?'none':'';$('#addRow').style.display=showAreas||view==='review'?'none':'';$('#focusCard').style.display=view==='today'?'flex':'none';
  updateTaskViewButtons();
  const todayAll=state.tasks.filter(t=>t.visible&&(t.bucket==='today'||isDueToday(t)||(!t.completed&&(isOverdue(t)||isReminderDue(t))))),done=todayAll.filter(t=>t.completed).length,pct=todayAll.length?Math.round(done/todayAll.length*100):0;
  $('#todayCount').textContent=todayAll.filter(t=>!t.completed).length;$('#progressText').textContent=pct+'%';$('.done-ring').style.strokeDashoffset=100-pct;
  $('#taskList').innerHTML=view==='settings'?settingsContent():view==='review'?reviewContent():showAreas?areaCards():currentCategory?categoryContent(currentCategory,tasks):currentProject?projectContent(tasks):view==='today'?todayContent(tasks):view==='inbox'?inboxContent(tasks):view==='later'?laterContent(tasks):view==='someday'?somedayContent(tasks):tasks.length?tasks.map(taskGroupHtml).join(''):'<div class="empty">Här är lugnt och fint.</div>';
  document.querySelectorAll('.task').forEach(el=>el.onclick=e=>{if(!e.target.classList.contains('check'))openInspector(el.dataset.id)});
  document.querySelectorAll('.check').forEach(b=>b.onclick=e=>{e.stopPropagation();complete(b.dataset.id)});
  document.querySelectorAll('[data-area-open]').forEach(c=>c.onclick=()=>{view='area:'+c.dataset.areaOpen;render()});
  document.querySelectorAll('#taskList [data-view]').forEach(b=>b.onclick=()=>{view=b.dataset.view;render()});
  bindTaskViewButtons();
  bindStructureActions($('#taskList'));
  document.querySelectorAll('[data-overdue-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.overdueOpen));
  document.querySelectorAll('[data-overdue-done]').forEach(b=>b.onclick=()=>complete(b.dataset.overdueDone));
  document.querySelectorAll('[data-overdue-bulk]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await bulkRescheduleOverdue(b.dataset.overdueBulk)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-weekly-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.weeklyOpen));
  document.querySelectorAll('[data-weekly-move]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await rescheduleTask(b.dataset.task,b.dataset.weeklyMove)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-review-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.reviewOpen));
  document.querySelectorAll('[data-review-move]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await rescheduleTask(b.dataset.task,b.dataset.reviewMove)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-focus-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.focusOpen));
  document.querySelectorAll('[data-focus-start]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await startFocusTask(b.dataset.focusStart)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-focus-pause]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await pauseFocusTask(b.dataset.focusPause)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-focus-done]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await complete(b.dataset.focusDone)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-approval-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.approvalOpen));
  document.querySelectorAll('[data-approval-decision]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await handleApprovalDecision(b.dataset.approvalDecision,b.dataset.approvalStatus)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-plan-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.planOpen));
  document.querySelectorAll('[data-plan-start]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await startFocusTask(b.dataset.planStart)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-next-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.nextOpen));
  document.querySelectorAll('[data-next-start]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await startFocusTask(b.dataset.nextStart)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-project-template]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await applyProjectStarter(b.dataset.projectTemplate)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-plan-trim]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await trimTodayPlan()}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-capacity]').forEach(b=>b.onclick=()=>{dailyCapacity=Number(b.dataset.capacity);localStorage.setItem('orbitDailyCapacity',String(dailyCapacity));render()});
  document.querySelectorAll('[data-reschedule]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await rescheduleTask(b.dataset.task,b.dataset.reschedule)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-inbox-move]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await triageInboxTask(b.dataset.task,b.dataset.inboxMove)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-inbox-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.inboxOpen));
  document.querySelectorAll('[data-assignment-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.assignmentOpen));
  document.querySelectorAll('[data-assignment-response]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await handleAssignmentResponse(b.dataset.task,b.dataset.assignmentResponse)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-later-move]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await rescheduleTask(b.dataset.task,b.dataset.laterMove)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-later-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.laterOpen));
  document.querySelectorAll('[data-later-bulk-unscheduled]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await bulkMoveLaterUnscheduled(b.dataset.laterBulkUnscheduled)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-someday-move]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await reviewSomedayTask(b.dataset.task,b.dataset.somedayMove)}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-someday-bulk-priority]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await bulkPlanSomedayPriority(Number(b.dataset.somedayBulkPriority))}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-someday-priority]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await setTaskPriority(b.dataset.task,Number(b.dataset.somedayPriority))}catch(error){toast(error.message);b.disabled=false}});
  document.querySelectorAll('[data-someday-open]').forEach(b=>b.onclick=()=>openInspector(b.dataset.somedayOpen));
  document.querySelectorAll('.board-card,.calendar-task,.flow-node').forEach(c=>c.onclick=()=>openInspector(c.dataset.id));
  if(view==='settings')bindSettings();
  else if(showAreas)bindAreaOverview();
  renderNotifications();
  renderDailyBrief();
  renderAgentPanel();
}

function applyTaskViewControls(tasks){
  const scoped=taskScope==='mine'?tasks.filter(t=>t.assigneeId===state.currentUserId):tasks;
  const score=t=>{
    if(taskSort==='priority')return[Number(t.priority||4),t.dueAt?new Date(t.dueAt).getTime():Number.MAX_SAFE_INTEGER,String(t.title)];
    if(taskSort==='due')return[t.dueAt?new Date(t.dueAt).getTime():Number.MAX_SAFE_INTEGER,Number(t.priority||4),String(t.title)];
    if(taskSort==='name')return[String(t.title).toLocaleLowerCase('sv-SE')];
    return [t.status==='doing'?0:1,isOverdue(t)?0:1,isReminderDue(t)?0:1,Number(t.priority||4),t.dueAt?new Date(t.dueAt).getTime():Number.MAX_SAFE_INTEGER,String(t.title)];
  };
  return [...scoped].sort((a,b)=>{const as=score(a),bs=score(b);for(let i=0;i<as.length;i++){if(as[i]!==bs[i])return typeof as[i]==='string'?String(as[i]).localeCompare(String(bs[i]),'sv-SE'):as[i]-bs[i]}return 0});
}

function updateTaskViewButtons(){
  const buttons=document.querySelectorAll('.section-head .filter');
  if(buttons[0])buttons[0].textContent=taskScope==='mine'?'◎ Mina':'☷ Alla';
  if(buttons[1])buttons[1].textContent=({smart:'↕ Smart',priority:'↕ Prio',due:'↕ Datum',name:'↕ Namn'})[taskSort]||'↕ Sortera';
}

function bindTaskViewButtons(){
  const buttons=document.querySelectorAll('.section-head .filter');
  if(buttons[0])buttons[0].onclick=()=>{taskScope=taskScope==='all'?'mine':'all';localStorage.setItem('orbitTaskScope',taskScope);render()};
  if(buttons[1])buttons[1].onclick=()=>{const order=['smart','priority','due','name'];taskSort=order[(order.indexOf(taskSort)+1)%order.length];localStorage.setItem('orbitTaskSort',taskSort);render()};
}

function commandItems(){
  const taskItems=state.tasks.filter(t=>!t.completed&&t.visible).map(t=>({type:'task',id:t.id,title:t.title,meta:taskContextLabel(t)}));
  const projectItems=state.projects.map(p=>({type:'project',id:p.id,title:p.name,meta:areaName(area(p.areaId))}));
  const areaItems=state.areas.map(a=>({type:'area',id:a.id,title:areaName(a),meta:areaCategory(a)}));
  return [...taskItems,...projectItems,...areaItems];
}

function renderCommandResults(query=''){
  const q=query.trim().toLocaleLowerCase('sv-SE'),items=commandItems().filter(item=>!q||`${item.title} ${item.meta}`.toLocaleLowerCase('sv-SE').includes(q)).slice(0,12);
  $('#commandResults').innerHTML=items.length?items.map(item=>`<button type="button" data-command-type="${item.type}" data-command-id="${item.id}"><span>${item.type==='task'?'□':item.type==='project'?'▣':'◫'}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.meta)}</small></div></button>`).join(''):'<p class="hint">Inga träffar.</p>';
  document.querySelectorAll('[data-command-id]').forEach(b=>b.onclick=()=>{const type=b.dataset.commandType,id=b.dataset.commandId;$('#commandDialog').close();if(type==='task')openInspector(id);else{view=`${type}:${id}`;render()}});
}

function openFirstCommandResult(){
  const first=$('#commandResults [data-command-id]');
  if(first)first.click();
}

function openCommandPalette(){
  if(!state)return;
  renderCommandResults('');
  $('#commandDialog').showModal();
  $('#commandSearch').value='';
  $('#commandSearch').focus();
}

function todayContent(tasks){
  const overdue=tasks.filter(isOverdue),ready=tasks.filter(t=>!isOverdue(t));
  const empty=overdue.length?'När du planerat om det som släpar är dagen ren.':'Dagen är ren. Lägg in ett litet steg när du vill.';
  return `${focusModeHtml(ready)}${weeklyReviewHtml()}${approvalQueueHtml()}${overdue.length?overdueReviewHtml(overdue):''}${dailyPlanHtml(ready)}${ready.length?ready.map(taskGroupHtml).join(''):`<div class="empty">${empty}</div>`}`;
}

function focusCandidate(tasks){
  const plan=dailyPlan(tasks,1);
  return tasks.find(t=>t.status==='doing')||plan.focus[0]||null;
}

function focusModeHtml(tasks){
  const task=focusCandidate(tasks);
  if(!task)return'';
  const p=project(task.projectId),a=areaForProject(task.projectId),subtasks=childrenOf(task.id).filter(t=>!t.completed),nextSubtask=subtasks.find(t=>t.visible)||null;
  const active=task.status==='doing';
  return `<section class="focus-mode-card ${active?'active':''}">
    <div class="focus-mode-orb">${active?'▶':'●'}</div>
    <div class="focus-mode-main">
      <p class="eyebrow">${active?'NUVARANDE FOKUS':'FÖRESLAGET FOKUS'}</p>
      <h3>${escapeHtml(task.title)}</h3>
      <p>${escapeHtml([p?.name,a?areaName(a):'',scheduleLabel(task)].filter(Boolean).join(' · ')||'Inbox')}</p>
      ${nextSubtask?`<small>Nästa delsteg: ${escapeHtml(nextSubtask.title)}</small>`:subtasks.length?`<small>${subtasks.length} delsteg kvar.</small>`:'<small>Gör klart eller pausa innan du byter fokus.</small>'}
    </div>
    <div class="focus-mode-actions">
      <button class="primary" data-focus-start="${task.id}">${active?'Fortsätt':'Starta fokus'}</button>
      <button class="secondary" data-focus-open="${task.id}">Öppna</button>
      ${active?`<button class="secondary" data-focus-pause="${task.id}">Pausa</button>`:''}
      <button class="secondary" data-focus-done="${task.id}">Klar</button>
    </div>
  </section>`;
}

function weeklyReviewHtml(){
  const now=new Date(),day=(now.getDay()+6)%7,weekStart=startOfLocalDay(now);weekStart.setDate(weekStart.getDate()-day);
  const completedThisWeek=state.tasks.filter(t=>t.completed&&t.updatedAt&&new Date(t.updatedAt)>=weekStart);
  const active=topLevel(visible()),staleDoing=active.filter(t=>['doing','review'].includes(t.status)&&!isDueToday(t)&&!isOverdue(t)),unplanned=active.filter(t=>['later','someday'].includes(t.bucket)&&!t.dueAt),waiting=active.filter(t=>t.status==='waiting');
  const total=staleDoing.length+unplanned.length+waiting.length;
  if(!total&&completedThisWeek.length<3)return'';
  const pick=[...staleDoing,...waiting,...unplanned][0];
  return `<section class="weekly-review-card">
    <div class="weekly-review-head"><div><p class="eyebrow">VECKOREVIEW</p><h3>${total?`${total} saker att städa upp`:'Veckan ser ren ut'}</h3><p>Fånga lösa trådar innan de blir brus: pågående, väntande och oplanerat.</p></div><span>${completedThisWeek.length} klara</span></div>
    <div class="weekly-review-stats"><span>${staleDoing.length} pågående/review</span><span>${waiting.length} väntar</span><span>${unplanned.length} utan datum</span></div>
    ${pick?`<article class="weekly-review-pick"><button data-weekly-open="${pick.id}"><strong>${escapeHtml(pick.title)}</strong><small>${escapeHtml(taskContextLabel(pick))}</small></button><div><button data-task="${pick.id}" data-weekly-move="today">Idag</button><button data-task="${pick.id}" data-weekly-move="nextweek">Nästa vecka</button><button data-task="${pick.id}" data-weekly-move="someday">Någon gång</button></div></article>`:''}
  </section>`;
}

function reviewContent(){
  const groups=reviewGroups(),total=reviewCount();
  if(!total)return'<div class="empty">Review är ren. Inga lösa trådar just nu.</div>';
  const sections=[
    ['overdue','Försenat',groups.overdue,'Välj nytt datum eller markera klart.'],
    ['waiting','Väntar',groups.waiting,'Följ upp blockeringar eller öppna tasken och lägg mer kontext.'],
    ['inbox','Inbox utan projekt',groups.inbox,'Placera i projekt eller bestäm när den ska göras.'],
    ['unplanned','Oplanerat',groups.unplanned,'Sätt datum eller låt den ligga som någon gång.'],
    ['someday','Gör nån gång',groups.someday,'Lyft bara sådant som faktiskt ska bli gjort snart.']
  ].filter(([, ,items])=>items.length);
  return `<section class="review-dashboard">
    <div class="review-dashboard-head"><div><p class="eyebrow">REVIEW</p><h3>${total} saker behöver beslut</h3><p>Det här är städytan. Målet är inte att göra allt, utan att minska brus och välja nästa rätta plats.</p></div><span>${total}</span></div>
    <div class="review-stats">${sections.map(([key,label,items])=>`<span class="${key}"><strong>${items.length}</strong>${label}</span>`).join('')}</div>
  </section>
  <div class="review-section-list">${sections.map(([key,label,items,help])=>reviewSectionHtml(key,label,items,help)).join('')}</div>`;
}

function reviewSectionHtml(key,label,items,help){
  return `<section class="review-section ${key}">
    <div class="review-section-head"><div><h3>${label}</h3><p>${help}</p></div><span>${items.length}</span></div>
    <div class="review-items">${items.slice(0,8).map(t=>reviewItemHtml(t,key)).join('')}</div>
    ${items.length>8?`<p class="review-more">${items.length-8} till i samma grupp.</p>`:''}
  </section>`;
}

function reviewItemHtml(t,key){
  const primary=key==='overdue'?'today':key==='someday'?'today':key==='waiting'?'nextweek':'tomorrow';
  const secondary=key==='overdue'?'tomorrow':key==='someday'?'nextweek':'someday';
  const secondaryLabel=secondary==='nextweek'?'Nästa vecka':secondary==='tomorrow'?'Imorgon':'Någon gång';
  return `<article class="review-item">
    <button class="review-item-main" data-review-open="${t.id}"><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(taskContextLabel(t)||'Inbox')}</small></button>
    <div>
      <button data-task="${t.id}" data-review-move="${primary}">${primary==='today'?'Idag':primary==='nextweek'?'Nästa vecka':'Imorgon'}</button>
      <button data-task="${t.id}" data-review-move="${secondary}">${secondaryLabel}</button>
      <button data-review-open="${t.id}">Öppna</button>
    </div>
  </article>`;
}

function approvalQueueHtml(){
  const pending=(state.approvals||[]).filter(a=>a.status==='pending');
  const mine=pending.filter(a=>a.requestedFrom===state.currentUserId).map(a=>({approval:a,task:state.tasks.find(t=>t.id===a.taskId)})).filter(x=>x.task&&!x.task.completed);
  const sent=pending.filter(a=>a.requestedBy===state.currentUserId&&a.requestedFrom!==state.currentUserId).map(a=>({approval:a,task:state.tasks.find(t=>t.id===a.taskId)})).filter(x=>x.task&&!x.task.completed);
  if(!mine.length&&!sent.length)return'';
  return `<section class="approval-queue-card">
    <div class="approval-queue-head"><div><p class="eyebrow">GODKÄNNANDEN</p><h3>${mine.length?`${mine.length} väntar på ditt beslut`:'Väntar på andra'}</h3><p>${mine.length?'Godkänn eller avvisa direkt.':'Du har skickat saker för godkännande och kan följa läget här.'}</p></div><span>${mine.length+sent.length}</span></div>
    ${mine.length?`<div class="approval-list">${mine.map(approvalCardHtml).join('')}</div>`:''}
    ${sent.length?`<div class="approval-sent"><strong>Skickat för godkännande</strong>${sent.slice(0,4).map(({approval,task})=>`<button data-approval-open="${task.id}"><span>${escapeHtml(task.title)}</span><small>${escapeHtml(person(approval.requestedFrom).name)}</small></button>`).join('')}</div>`:''}
  </section>`;
}

function approvalCardHtml({approval,task}){
  return `<article class="approval-card">
    <button data-approval-open="${task.id}"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml([taskContextLabel(task),`Från ${person(approval.requestedBy).name}`].join(' · '))}</small></button>
    <div><button class="primary" data-approval-decision="${approval.id}" data-approval-status="approved">Godkänn</button><button class="secondary" data-approval-decision="${approval.id}" data-approval-status="rejected">Avvisa</button></div>
  </article>`;
}

function inboxContent(tasks){
  if(!tasks.length)return'<div class="empty">Inbox är tom. Bra.</div>';
  const assignmentDecisions=tasks.filter(isPendingAssignmentForMe),normalTasks=tasks.filter(t=>!isPendingAssignmentForMe(t)),uncategorized=normalTasks.filter(t=>!t.projectId),withProject=normalTasks.filter(t=>t.projectId);
  return `${assignmentDecisions.length?assignmentDecisionInboxHtml(assignmentDecisions):''}<section class="inbox-triage-card">
    <div class="inbox-triage-head"><div><p class="eyebrow">INBOX TRIAGE</p><h3>Bestäm vad varje sak betyder</h3><p>Inbox är bara en fångstplats. Ta ett snabbt beslut: gör idag, parkera, eller öppna och placera i projekt.</p></div><span>${tasks.length}</span></div>
    <div class="inbox-triage-list">${normalTasks.slice(0,8).map(t=>`<article class="inbox-triage-item ${t.projectId?'has-project':''}">
      <button class="inbox-triage-title" data-inbox-open="${t.id}"><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(taskContextLabel(t))}</small></button>
      <div class="inbox-triage-actions">
        <button data-task="${t.id}" data-inbox-move="today">Idag</button>
        <button data-task="${t.id}" data-inbox-move="later">Senare</button>
        <button data-task="${t.id}" data-inbox-move="someday">Någon gång</button>
        <button data-inbox-open="${t.id}">${t.projectId?'Öppna':'Placera'}</button>
      </div>
    </article>`).join('')}</div>
    ${normalTasks.length>8?`<p class="inbox-triage-more">${normalTasks.length-8} till visas i listan nedanför.</p>`:''}
    <div class="inbox-triage-summary"><span>${uncategorized.length} utan projekt</span><span>${withProject.length} redan placerade</span></div>
  </section>${normalTasks.map(taskGroupHtml).join('')}`;
}

function assignmentDecisionInboxHtml(tasks){
  return `<section class="assignment-decision-card">
    <div class="assignment-decision-head"><div><p class="eyebrow">TILLDELAT TILL DIG</p><h3>${tasks.length} uppgift${tasks.length===1?'':'er'} väntar på svar</h3><p>Acceptera, neka eller öppna och ändra tid/projekt innan du svarar. De ligger kvar här tills du bestämmer.</p></div><span>${tasks.length}</span></div>
    <div class="assignment-decision-list">${tasks.map(t=>`<article class="assignment-decision-item">
      <button data-assignment-open="${t.id}"><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml([`Från ${person(t.createdBy).name}`,taskContextLabel(t)].filter(Boolean).join(' · '))}</small></button>
      <div><button class="primary" data-assignment-response="accepted" data-task="${t.id}">Acceptera</button><button class="secondary" data-assignment-response="declined" data-task="${t.id}">Neka</button><button class="secondary" data-assignment-open="${t.id}">Ändra</button></div>
    </article>`).join('')}</div>
  </section>`;
}

function laterContent(tasks){
  if(!tasks.length)return'<div class="empty">Gör sen är tom. Bra.</div>';
  const now=startOfLocalDay(),weekEnd=dayAt(7,23,59);
  const sorted=[...tasks].sort((a,b)=>{
    const ad=a.dueAt?new Date(a.dueAt).getTime():Number.MAX_SAFE_INTEGER,bd=b.dueAt?new Date(b.dueAt).getTime():Number.MAX_SAFE_INTEGER;
    if(ad!==bd)return ad-bd;
    if(Number(a.priority||4)!==Number(b.priority||4))return Number(a.priority||4)-Number(b.priority||4);
    return String(a.title).localeCompare(String(b.title),'sv-SE');
  });
  const groups=[
    ['overdue','Släpar efter',sorted.filter(isOverdue),'Bestäm nytt datum eller flytta bort.'],
    ['week','Kommande vecka',sorted.filter(t=>t.dueAt&&!isOverdue(t)&&new Date(t.dueAt)<=weekEnd),'Det här är nära nog att vara planering.'],
    ['future','Senare',sorted.filter(t=>t.dueAt&&!isOverdue(t)&&new Date(t.dueAt)>weekEnd),'Ligger längre fram.'],
    ['unscheduled','Utan datum',sorted.filter(t=>!t.dueAt),'Behöver ett beslut för att inte försvinna.']
  ].filter(([, ,items])=>items.length);
  const next=groups[0]?.[2]?.[0];
  const unscheduled=sorted.filter(t=>!t.dueAt);
  return `<section class="later-planner-card">
    <div class="later-planner-head"><div><p class="eyebrow">GÖR SEN</p><h3>Planera framåt utan att fylla idag</h3><p>Här ska saker ha ett ungefärligt nästa datum. Om något är viktigt nog: lyft till idag.</p></div><span>${tasks.length}</span></div>
    ${next?`<article class="later-next-card"><button data-later-open="${next.id}"><small>Närmast beslut</small><strong>${escapeHtml(next.title)}</strong><span>${escapeHtml(taskContextLabel(next))}</span></button><div><button class="primary" data-task="${next.id}" data-later-move="today">Idag</button><button class="secondary" data-task="${next.id}" data-later-move="someday">Någon gång</button></div></article>`:''}
    ${unscheduled.length>=3?laterNudgeHtml(unscheduled):''}
  </section>
  <div class="later-timeline">${groups.map(([key,label,items,help])=>`<section class="later-group ${key}">
    <h3>${label}<span>${items.length}</span></h3>
    <p>${help}</p>
    <div>${items.map(laterCardHtml).join('')}</div>
  </section>`).join('')}</div>`;
}

function laterNudgeHtml(tasks){
  return `<article class="parking-nudge later"><div><small>UTAN DATUM</small><strong>${tasks.length} saker riskerar att försvinna</strong><p>Ge dem ett ungefärligt nästa datum eller parkera dem ärligt i Someday.</p></div><div><button data-later-bulk-unscheduled="nextweek">Planera nästa vecka</button><button data-later-bulk-unscheduled="someday">Parkera i Someday</button></div></article>`;
}

function laterCardHtml(t){
  return `<article class="later-card ${isOverdue(t)?'late':''}">
    <button class="later-card-main" data-later-open="${t.id}"><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(taskContextLabel(t))}</small></button>
    <div class="later-card-actions">
      <button data-task="${t.id}" data-later-move="today">Idag</button>
      <button data-task="${t.id}" data-later-move="tomorrow">Imorgon</button>
      <button data-task="${t.id}" data-later-move="nextweek">Nästa vecka</button>
      <button data-task="${t.id}" data-later-move="someday">Någon gång</button>
    </div>
  </article>`;
}

function somedayContent(tasks){
  if(!tasks.length)return'<div class="empty">Gör nån gång är tom. Bra.</div>';
  const sorted=[...tasks].sort((a,b)=>Number(a.priority||4)-Number(b.priority||4)||String(a.title).localeCompare(String(b.title),'sv-SE'));
  const pick=sorted[0],groups=[[1,'P1 · Viktigt'],[2,'P2 · Bra att göra'],[3,'P3 · Låg energi'],[4,'P4 · Parkering']];
  const highParked=sorted.filter(t=>Number(t.priority||4)<=2);
  return `<section class="someday-review-card">
    <div class="someday-review-head">
      <div><p class="eyebrow">SOMEDAY REVIEW</p><h3>Plocka upp en sak eller låt den vila</h3><p>Den här listan ska vara en parkering, inte ett svart hål. Välj en sak om något faktiskt ska framåt.</p></div>
      <span>${tasks.length}</span>
    </div>
    <article class="someday-pick">
      <button data-someday-open="${pick.id}"><small>Föreslagen att lyfta</small><strong>${escapeHtml(pick.title)}</strong><span>${escapeHtml(taskContextLabel(pick))}</span></button>
      <div><button class="primary" data-task="${pick.id}" data-someday-move="today">Gör idag</button><button class="secondary" data-task="${pick.id}" data-someday-move="later">Gör senare</button></div>
    </article>
    ${highParked.length>=3?`<article class="parking-nudge someday"><div><small>VIKTIGT MEN PARKERAT</small><strong>${highParked.length} P1/P2 ligger i Someday</strong><p>Om det är viktigt ska det få ett nästa datum, annars sänk prioriteten.</p></div><div><button data-someday-bulk-priority="1">Planera P1 nästa vecka</button><button data-someday-bulk-priority="2">Planera P2 nästa vecka</button></div></article>`:''}
  </section>
  <div class="someday-priority-board">${groups.map(([priority,label])=>{
    const cards=sorted.filter(t=>Number(t.priority||4)===priority);
    return `<section class="someday-priority-column"><h3>${label}<span>${cards.length}</span></h3>${cards.length?cards.map(somedayCardHtml).join(''):'<p class="hint">Tomt.</p>'}</section>`;
  }).join('')}</div>`;
}

async function bulkMoveLaterUnscheduled(target){
  const items=topLevel(tasksForBucketView('later').filter(t=>!t.dueAt));
  if(!items.length){toast('Inga odaterade Gör sen-uppgifter hittades.');return}
  for(const [index,t] of items.entries()){
    if(target==='nextweek'){
      const dueAt=dayAt(7+Math.min(index,4),9).toISOString();
      await api('/tasks/'+t.id,{method:'PATCH',body:JSON.stringify({bucket:'later',dueAt,due:formatDateTime(dueAt),reminderAt:null,status:t.status==='doing'?'planned':t.status})});
    } else if(target==='someday'){
      await api('/tasks/'+t.id,{method:'PATCH',body:JSON.stringify({bucket:'someday',dueAt:null,due:'',reminderAt:null})});
    } else throw new Error('Okänt val.');
  }
  await load();
  toast(`${items.length} uppgift${items.length===1?'':'er'} fick ett tydligare hem.`);
}

async function bulkPlanSomedayPriority(priority){
  const items=topLevel(tasksForBucketView('someday').filter(t=>Number(t.priority||4)===priority));
  if(!items.length){toast(`Inga P${priority} i Someday.`);return}
  for(const [index,t] of items.entries()){
    const dueAt=dayAt(7+Math.min(index,4),9).toISOString();
    await api('/tasks/'+t.id,{method:'PATCH',body:JSON.stringify({bucket:'later',dueAt,due:formatDateTime(dueAt),reminderAt:null,status:'planned'})});
  }
  await load();
  toast(`${items.length} P${priority}-uppgift${items.length===1?'':'er'} planerades till nästa vecka.`);
}

function somedayCardHtml(t){
  return `<article class="someday-card">
    <button class="someday-card-main" data-someday-open="${t.id}"><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(taskContextLabel(t))}</small></button>
    <div class="someday-card-actions">
      <button data-task="${t.id}" data-someday-move="today">Idag</button>
      <button data-task="${t.id}" data-someday-move="later">Senare</button>
      <span>${[1,2,3].map(p=>`<button class="${Number(t.priority||4)===p?'active':''}" data-task="${t.id}" data-someday-priority="${p}">P${p}</button>`).join('')}</span>
    </div>
  </article>`;
}

function todayNudgeHtml(tasks){
  if(!tasks.length)return'';
  const doing=tasks.find(t=>t.status==='doing'),p1=tasks.find(t=>t.priority===1),candidate=doing||p1||tasks[0];
  return `<section class="execution-nudge"><div><p class="eyebrow">${doing?'PÅBÖRJAT':p1?'PRIO':'LITET STEG'}</p><h3>${doing?'Fortsätt där du redan börjat':'Välj ett tydligt nästa steg'}</h3><p>${doing?'Du har redan startat den här. Det är ofta lättare att avsluta än att starta om.':'Håll dagen liten: en konkret sak först, sedan nästa.'}</p></div><button class="secondary" data-overdue-open="${candidate.id}">${escapeHtml(candidate.title)}</button></section>`;
}

function dailyPlan(tasks,limit=dailyCapacity){
  const score=t=>[
    t.status==='doing'?0:1,
    isReminderDue(t)?0:1,
    isDueToday(t)?0:1,
    Number(t.priority||4),
    t.dueAt?new Date(t.dueAt).getTime():Number.MAX_SAFE_INTEGER,
    t.createdAt?new Date(t.createdAt).getTime():0
  ];
  const sorted=[...tasks].sort((a,b)=>{const as=score(a),bs=score(b);for(let i=0;i<as.length;i++){if(as[i]!==bs[i])return as[i]-bs[i]}return String(a.title).localeCompare(String(b.title),'sv-SE')});
  const doing=sorted.filter(t=>t.status==='doing');
  const focus=[...doing,...sorted.filter(t=>t.status!=='doing')].filter((t,i,self)=>self.findIndex(x=>x.id===t.id)===i).slice(0,limit);
  const overflow=sorted.filter(t=>!focus.some(f=>f.id===t.id));
  return{focus,overflow,total:sorted.length,limit,tooMuch:sorted.length>limit||overflow.length>0};
}

function dailyPlanReason(t){
  if(t.status==='doing')return'Påbörjad';
  if(isReminderDue(t))return'Påminnelse';
  if(t.priority===1)return'Prio 1';
  if(isDueToday(t))return'Planerad idag';
  return'Litet nästa steg';
}

function projectActionPlan(tasks,limit=3){
  const candidates=[],waiting=[];
  tasks.forEach(parent=>{
    const openChildren=childrenOf(parent.id).filter(c=>!c.completed);
    const visibleChildren=openChildren.filter(c=>c.visible);
    const hiddenChildren=openChildren.filter(c=>!c.visible);
    if(visibleChildren.length){
      visibleChildren.forEach(child=>candidates.push({...child,parentTitle:parent.title,parentId:parent.id}));
    }else if(hiddenChildren.length){
      waiting.push(parent);
    }else if(parent.visible){
      candidates.push(parent);
    }
  });
  const scored=[...candidates].sort((a,b)=>{
    const as=[a.status==='doing'?0:1,isReminderDue(a)?0:1,Number(a.priority||4),a.dueAt?new Date(a.dueAt).getTime():Number.MAX_SAFE_INTEGER,a.createdAt?new Date(a.createdAt).getTime():0];
    const bs=[b.status==='doing'?0:1,isReminderDue(b)?0:1,Number(b.priority||4),b.dueAt?new Date(b.dueAt).getTime():Number.MAX_SAFE_INTEGER,b.createdAt?new Date(b.createdAt).getTime():0];
    for(let i=0;i<as.length;i++){if(as[i]!==bs[i])return as[i]-bs[i]}
    return String(a.title).localeCompare(String(b.title),'sv-SE');
  });
  return {steps:scored.slice(0,limit),total:scored.length,waiting:waiting.length};
}

function nextStepReason(t){
  if(t.status==='doing')return'Påbörjad';
  if(t.parentTitle)return`Delsteg i ${t.parentTitle}`;
  if(t.priority===1)return'Prio 1';
  if(isReminderDue(t))return'Påminnelse';
  if(isDueToday(t))return'Planerad';
  return'Nästa steg';
}

function projectNextStepsHtml(tasks,compact=false){
  const plan=projectActionPlan(tasks,compact?1:3);
  if(!plan.total&&!plan.waiting)return'';
  if(compact){
    const t=plan.steps[0];
    return t?`<button class="project-next-mini" data-next-open="${t.id}"><span>Nästa</span><strong>${escapeHtml(t.title)}</strong></button>`:`<div class="project-next-mini waiting"><span>Väntar</span><strong>${plan.waiting} låsta steg</strong></div>`;
  }
  return `<section class="project-next-card">
    <div class="project-next-head"><div><p class="eyebrow">NÄSTA STEG</p><h3>${plan.steps.length?`${plan.steps.length} konkreta steg att göra nu`:'Projektet väntar på villkor'}</h3><p>${plan.steps.length?'Börja här i stället för att läsa hela projektlistan.':'Det finns steg, men de är låsta av andra uppgifter eller triggers.'}</p></div><span>${plan.total}${plan.waiting?` +${plan.waiting}`:''}</span></div>
    ${plan.steps.length?`<div class="project-next-list">${plan.steps.map(t=>`<article class="project-next-item ${t.status==='doing'?'active':''}">
      <button data-next-open="${t.id}"><small>${escapeHtml(nextStepReason(t))}</small><strong>${escapeHtml(t.title)}</strong><span>${escapeHtml([t.parentTitle,scheduleLabel(t)].filter(Boolean).join(' · ')||taskContextLabel(t))}</span></button>
      <button class="primary" data-next-start="${t.id}">${t.status==='doing'?'Fortsätt':'Starta'}</button>
    </article>`).join('')}</div>`:''}
    ${plan.waiting?`<p class="project-next-waiting">⚡ ${plan.waiting} större uppgift${plan.waiting===1?'':'er'} har bara låsta delsteg just nu.</p>`:''}
  </section>`;
}

function taskContextLabel(t){
  const p=project(t.projectId),a=areaForProject(t.projectId);
  return [p?.name,a?areaName(a):'',scheduleLabel(t)].filter(Boolean).join(' · ')||'Inbox';
}

function dailyPlanHtml(tasks){
  const plan=dailyPlan(tasks);
  if(!plan.total)return'';
  const title=plan.focus.length===1?'Dagens lilla steg':`Dagens ${plan.focus.length} små steg`;
  const capacityLabels={1:'Låg',3:'Normal',5:'Hög'};
  return `<section class="daily-plan-card ${plan.tooMuch?'too-much':''}">
    <div class="daily-plan-head">
      <div><p class="eyebrow">DAGLIG PLANERING</p><h3>${title}</h3><p>${plan.tooMuch?`Dagen är för tung för ${capacityLabels[plan.limit].toLowerCase()} kapacitet. Flytta resten.`:'Lagom nivå. Gör en sak, checka av, ta nästa.'}</p></div>
      <span>${plan.focus.length}/${plan.total}</span>
    </div>
    <div class="daily-capacity"><span>Min kapacitet idag</span><div>${[[1,'Låg'],[3,'Normal'],[5,'Hög']].map(([value,label])=>`<button class="${dailyCapacity===value?'active':''}" data-capacity="${value}">${label}</button>`).join('')}</div></div>
    <div class="daily-focus-list">${plan.focus.map((t,i)=>`<article class="daily-focus-card ${t.status==='doing'?'active':''}">
      <button class="daily-focus-main" data-plan-open="${t.id}"><small>${i+1}. ${dailyPlanReason(t)}</small><strong>${escapeHtml(t.title)}</strong><span>${escapeHtml(taskContextLabel(t))}</span></button>
      <button class="daily-focus-action" data-plan-start="${t.id}">${t.status==='doing'?'Fortsätt':'Starta'}</button>
    </article>`).join('')}</div>
    ${plan.overflow.length?`<div class="daily-plan-overflow">
      <div><strong>${plan.overflow.length} utanför fokus</strong><small>Flytta bort överskottet så “Idag” inte blir en vägg.</small></div>
      <button class="secondary" data-plan-trim="1">Lätta dagen</button>
    </div>
    <div class="daily-overflow-list">${plan.overflow.slice(0,4).map(t=>`<article><button data-plan-open="${t.id}">${escapeHtml(t.title)}</button><div><button data-task="${t.id}" data-reschedule="tomorrow">Imorgon</button><button data-task="${t.id}" data-reschedule="someday">Någon gång</button></div></article>`).join('')}</div>`:''}
  </section>`;
}

function overdueReviewHtml(tasks){
  return `<section class="overdue-review"><div class="overdue-review-head"><div><p class="eyebrow">PLANERA OM FÖRST</p><h3>${tasks.length} försenad${tasks.length===1?' uppgift':'e uppgifter'}</h3><p>Bestäm ett nytt datum eller flytta bort den. Annars växer overdue-listan och blir brus.</p></div><span>${tasks.length}</span></div>
    <div class="overdue-bulk-actions"><strong>Snabbt beslut för alla</strong><div><button data-overdue-bulk="tomorrow">Alla imorgon</button><button data-overdue-bulk="week">Alla senare i veckan</button><button data-overdue-bulk="someday">Alla någon gång</button></div></div>
    <div class="overdue-reschedule-list">${tasks.map(t=>`<article class="overdue-reschedule-card"><button class="overdue-title" data-overdue-open="${t.id}"><strong>${escapeHtml(t.title)}</strong><small>${escapeHtml(scheduleLabel(t))}</small></button><div class="reschedule-actions"><button data-task="${t.id}" data-reschedule="today">Idag</button><button data-task="${t.id}" data-reschedule="tomorrow">Imorgon</button><button data-task="${t.id}" data-reschedule="week">Senare i veckan</button><button data-task="${t.id}" data-reschedule="someday">Någon gång</button><button data-overdue-done="${t.id}">Klar</button></div></article>`).join('')}</div></section>`;
}

async function rescheduleTask(id,preset){
  let dueAt=null,bucket='later',due='',reminderAt=null;
  if(preset==='today'){dueAt=todayPlanTime();bucket='today';due=formatDateTime(dueAt)}
  else if(preset==='tomorrow'){dueAt=dayAt(1,9).toISOString();bucket='later';due=formatDateTime(dueAt)}
  else if(preset==='week'){dueAt=dayAt(3,9).toISOString();bucket='later';due=formatDateTime(dueAt)}
  else if(preset==='nextweek'){dueAt=dayAt(7,9).toISOString();bucket='later';due=formatDateTime(dueAt)}
  else if(preset==='someday'){bucket='someday';dueAt=null;due='';reminderAt=null}
  else throw new Error('Okänt planeringsval.');
  const patch={bucket,due,dueAt,reminderAt};
  await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify(patch)});
  await load();
  toast(preset==='someday'?'Flyttad till Gör nån gång.':'Uppgiften har fått nytt datum.');
}

async function bulkRescheduleOverdue(preset){
  const ids=topLevel(tasksForBucketView('today').filter(isOverdue)).map(t=>t.id);
  if(!ids.length){toast('Inga försenade uppgifter att planera om.');return}
  for(const id of ids){
    let dueAt=null,bucket='later',due='',reminderAt=null;
    if(preset==='tomorrow'){dueAt=dayAt(1,9).toISOString();bucket='later';due=formatDateTime(dueAt)}
    else if(preset==='week'){dueAt=dayAt(3,9).toISOString();bucket='later';due=formatDateTime(dueAt)}
    else if(preset==='someday'){bucket='someday';dueAt=null;due='';reminderAt=null}
    else throw new Error('Okänt planeringsval.');
    await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify({bucket,due,dueAt,reminderAt})});
  }
  await load();
  toast(`${ids.length} försenad${ids.length===1?' uppgift':'e uppgifter'} planerades om.`);
}

async function triageInboxTask(id,target){
  const patch={};
  if(target==='today'){patch.bucket='today';patch.dueAt=todayPlanTime();patch.due=formatDateTime(patch.dueAt)}
  else if(target==='later'){patch.bucket='later';patch.dueAt=null;patch.due='';patch.reminderAt=null}
  else if(target==='someday'){patch.bucket='someday';patch.dueAt=null;patch.due='';patch.reminderAt=null}
  else throw new Error('Okänt inbox-val.');
  await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify(patch)});
  await load();
  toast(target==='today'?'Flyttad till Gör idag.':target==='later'?'Flyttad till Gör sen.':'Flyttad till Gör nån gång.');
}

async function reviewSomedayTask(id,target){
  const patch={};
  if(target==='today'){patch.bucket='today';patch.dueAt=todayPlanTime();patch.due=formatDateTime(patch.dueAt);patch.status='planned'}
  else if(target==='later'){const dueAt=dayAt(7,9).toISOString();patch.bucket='later';patch.dueAt=dueAt;patch.due=formatDateTime(dueAt);patch.status='planned';patch.reminderAt=null}
  else throw new Error('Okänt review-val.');
  await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify(patch)});
  await load();
  toast(target==='today'?'Flyttad till Gör idag.':'Flyttad till Gör sen.');
}

async function setTaskPriority(id,priority){
  if(![1,2,3].includes(priority))throw new Error('Okänd prioritet.');
  await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify({priority})});
  await load();
  toast(`Prioritet ändrad till P${priority}.`);
}

async function handleApprovalDecision(id,status){
  const approval=(state.approvals||[]).find(a=>a.id===id);
  if(!approval)throw new Error('Godkännandet finns inte längre.');
  await decideApproval(id,status);
  if(status==='rejected')await api('/tasks/'+approval.taskId,{method:'PATCH',body:JSON.stringify({status:'review',bucket:'today'})});
  await load();
  toast(status==='approved'?'Godkänt.':'Avvisat och flyttat till granskning.');
}

async function handleAssignmentResponse(id,status){
  const task=state.tasks.find(t=>t.id===id);
  if(!task)throw new Error('Uppgiften finns inte längre.');
  const note=status==='accepted'?'Accepterad från Inbox.':'Nekad från Inbox.';
  await respondToAssignment(id,status,note);
  await load();
  toast(status==='accepted'?'Uppgiften är accepterad.':'Uppgiften är nekad och avsändaren får besked.');
}

async function startFocusTask(id){
  const t=state.tasks.find(task=>task.id===id);
  if(!t)throw new Error('Uppgiften finns inte längre.');
  const patch={bucket:'today',status:'doing'};
  if(!t.dueAt||isOverdue(t)){patch.dueAt=todayPlanTime();patch.due=formatDateTime(patch.dueAt)}
  await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify(patch)});
  await load();
  toast('Markerad som påbörjad.');
}

async function pauseFocusTask(id){
  const t=state.tasks.find(task=>task.id===id);
  if(!t)throw new Error('Uppgiften finns inte längre.');
  await api('/tasks/'+id,{method:'PATCH',body:JSON.stringify({status:'planned'})});
  await load();
  toast('Fokus pausat. Uppgiften ligger kvar i dagens plan.');
}

async function trimTodayPlan(){
  const ready=topLevel(tasksForBucketView('today')).filter(t=>!isOverdue(t));
  const move=dailyPlan(ready).overflow;
  if(!move.length){toast('Dagen är redan lagom.');return}
  for(const [index,t] of move.entries()){
    const offset=index<3?1:3+Math.floor((index-3)/3),hour=9+(index%3);
    const dueAt=dayAt(offset,hour).toISOString();
    await api('/tasks/'+t.id,{method:'PATCH',body:JSON.stringify({bucket:'later',dueAt,due:formatDateTime(dueAt),reminderAt:null,status:t.status==='doing'?'planned':t.status})});
  }
  await load();
  toast(`${move.length} uppgift${move.length===1?'':'er'} flyttad${move.length===1?'':'e'} från idag.`);
}

function categoryContent(group,tasks){
  return `<div class="category-task-view">
    ${group.areas.map(a=>{
      const projects=projectsForArea(a),areaTaskCount=tasks.filter(t=>projects.some(p=>p.id===t.projectId)).length;
      return `<section class="category-area-block">
        <div class="category-area-head"><button data-view="area:${a.id}"><span class="area-card-icon small" style="background:${a.color}">${a.icon}</span><strong>${escapeHtml(areaName(a))}</strong></button><span>${areaTaskCount} uppgift${areaTaskCount===1?'':'er'}</span></div>
        <div class="category-project-list">${projects.length?projects.map(p=>categoryProjectBlock(p,tasks.filter(t=>t.projectId===p.id))).join(''):'<p class="hint">Området har inga projekt ännu.</p>'}</div>
      </section>`;
    }).join('')}
    ${tasks.length?'':'<div class="empty">Inga aktiva uppgifter i den här kategorin.</div>'}
  </div>`;
}

function categoryProjectBlock(p,projectTasks){
  return `<section class="category-project-block"><button class="category-project-head" data-view="project:${p.id}">${projectIconHtml(p)}<strong>${escapeHtml(p.name)}</strong><span>${projectTasks.length}</span></button>${projectNextStepsHtml(projectTasks,true)}${projectTasks.length?projectTasks.map(taskGroupHtml).join(''):'<p class="hint">Inga aktiva uppgifter i projektet.</p>'}</section>`;
}

const projectStarterTemplates={
  simple:['Definiera målet','Lista första konkreta stegen','Bestäm vem som äger nästa steg','Sätt första datumet'],
  launch:['Skriv kort målbild','Skapa första versionen','Testa med en person','Samla feedback','Planera lansering'],
  home:['Mät och dokumentera nuläge','Välj lösning eller material','Köp eller boka det som behövs','Gör första praktiska momentet','Följ upp och avsluta']
};

function projectStarterHtml(){
  return `<section class="project-starter-card">
    <div><p class="eyebrow">NYTT PROJEKT</p><h3>Starta med färdiga första steg</h3><p>Välj en lätt mall. Du kan ändra allt efteråt.</p></div>
    <div class="project-starter-options">
      <button data-project-template="simple"><strong>Enkel plan</strong><small>Mål, steg, ägare, datum</small></button>
      <button data-project-template="launch"><strong>Lansering</strong><small>Bygga, testa, feedback</small></button>
      <button data-project-template="home"><strong>Praktiskt projekt</strong><small>Mäta, välja, köpa, göra</small></button>
    </div>
  </section>`;
}

async function applyProjectStarter(templateName){
  const p=view.startsWith('project:')?project(view.split(':')[1]):null;
  if(!p)throw new Error('Öppna ett projekt först.');
  const titles=projectStarterTemplates[templateName]||projectStarterTemplates.simple;
  for(const [index,title] of titles.entries()){
    const dueAt=index===0?todayPlanTime():null;
    await createCloudTask({
      title,
      notes:'',
      projectId:p.id,
      assigneeId:defaultAssigneeForProject(p.id),
      bucket:index===0?'today':'later',
      priority:index===0?2:3,
      due:dueAt?formatDateTime(dueAt):'',
      dueAt,
      status:'todo'
    });
  }
  await load();
  toast(`${titles.length} startsteg skapade.`);
}

function projectHealthCardHtml(tasks){
  const projectId=view.startsWith('project:')?view.split(':')[1]:tasks[0]?.projectId,all=state.tasks.filter(t=>t.projectId===projectId),active=all.filter(t=>!t.completed),done=all.filter(t=>t.completed),overdue=active.filter(isOverdue),waiting=active.filter(t=>t.status==='waiting'||(!t.visible&&!t.completed)),unplanned=active.filter(t=>t.visible&&!t.dueAt&&t.bucket!=='someday'),p1=active.filter(t=>t.priority===1),people=[...new Set(active.map(t=>t.assigneeId).filter(Boolean))].map(person),pct=all.length?Math.round(done.length/all.length*100):0;
  const risk=overdue.length?'risk':waiting.length||unplanned.length>3?'warn':'ok';
  const riskText=risk==='risk'?'Risk':risk==='warn'?'Behöver planering':'På rätt väg';
  return `<section class="project-health-card ${risk}">
    <div class="project-health-main">
      <div><p class="eyebrow">PROJEKTSTATUS</p><h3>${riskText}</h3><p>${overdue.length?`${overdue.length} försenad${overdue.length===1?' uppgift':'e uppgifter'} behöver nytt beslut.`:waiting.length?`${waiting.length} uppgift${waiting.length===1?'':'er'} väntar på någon eller något.`:'Projektet har tydliga nästa steg.'}</p></div>
      <div class="project-health-progress"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="16"></circle><circle style="stroke-dashoffset:${100-pct}" cx="21" cy="21" r="16"></circle></svg><span>${pct}%</span></div>
    </div>
    <div class="project-health-stats">
      <span><strong>${active.length}</strong> aktiva</span>
      <span><strong>${done.length}</strong> klara</span>
      <span class="${overdue.length?'bad':''}"><strong>${overdue.length}</strong> sena</span>
      <span class="${waiting.length?'warn':''}"><strong>${waiting.length}</strong> väntar</span>
      <span><strong>${unplanned.length}</strong> utan datum</span>
      <span><strong>${p1.length}</strong> P1</span>
    </div>
    ${people.length?`<div class="project-health-people"><small>Aktiva personer</small><div>${people.slice(0,6).map(avatarHtml).join('')}</div></div>`:''}
  </section>`;
}

function projectContent(tasks){if(!tasks.length)return projectStarterHtml();if(projectView==='board')return boardHtml(tasks);if(projectView==='calendar')return calendarHtml(tasks);if(projectView==='flow')return flowHtml(tasks);return `${projectHealthCardHtml(tasks)}${projectNextStepsHtml(tasks)}${tasks.map(taskGroupHtml).join('')}`}
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

function settingsContent(){
  const me=person(state.currentUserId),google=googleCalendarIntegrations(),slack=slackIntegrations(),mcpReady=Boolean(state.currentUserId),installed=isStandaloneApp();
  return `<div class="settings-page">
    <section class="settings-card account">
      <div><p class="eyebrow">KONTO</p><h3>${escapeHtml(me.name)}</h3><p>Det här är din Orbit-identitet för tilldelning, team och MCP-åtgärder.</p></div>
      <div class="settings-avatar">${avatarHtml(me)}<span>${escapeHtml(me.id)}</span></div>
    </section>
    <section class="settings-grid">
      <article class="settings-card"><p class="eyebrow">GOOGLE CALENDAR</p><h3>${google.length?'Ansluten':'Inte ansluten'}</h3><p>${google.length?`${google.length} kalenderkoppling${google.length===1?'':'ar'} finns.`:'Anslut Google för kalenderblock och sync.'}</p><button class="secondary" id="settingsGoogleOAuth">${google.length?'Anslut igen':'Anslut Google'}</button></article>
      <article class="settings-card"><p class="eyebrow">SLACK</p><h3>${slack.length?'Ansluten':'Inte ansluten'}</h3><p>${slack.length?`${slack.length} Slack-koppling${slack.length===1?'':'ar'} finns.`:'Anslut Slack för händelser och länkar från chattar.'}</p><button class="secondary" id="settingsSlackOAuth">${slack.length?'Anslut igen':'Anslut Slack'}</button></article>
      <article class="settings-card"><p class="eyebrow">MCP</p><h3>${mcpReady?'Redo för AI-styrning':'Saknar användare'}</h3><p>Starta MCP-servern lokalt med rätt secrets och ORBIT_USER_ID.</p><code>npm run mcp</code></article>
      <article class="settings-card"><p class="eyebrow">MOBIL/PWA</p><h3>${installed?'Installerad':'Kan installeras'}</h3><p>Installera Orbit som app på mobil/desktop. Share Sheet-stöd finns för länkar från andra appar.</p><button class="secondary" id="installOrbitButton">${installed?'Installerad':'Installera app'}</button></article>
      <article class="settings-card"><p class="eyebrow">NOTISER</p><h3>${notificationStatusLabel()}</h3><p>Lokala påminnelser visas när appen är öppen. Riktig push kan byggas senare med servernycklar.</p><button class="secondary" id="enableNotificationsButton">${'Notification' in window&&Notification.permission==='granted'?'Skicka testnotis':'Aktivera notiser'}</button></article>
    </section>
    ${teamSharingContent()}
  </div>`;
}

function bindSettings(){
  bindTeamSharing();
  $('#settingsGoogleOAuth')?.addEventListener('click',async e=>{try{e.currentTarget.disabled=true;const url=await startGoogleCalendarOAuth();window.location.href=url}catch(error){e.currentTarget.disabled=false;toast(error.message)}});
  $('#settingsSlackOAuth')?.addEventListener('click',async e=>{try{e.currentTarget.disabled=true;const url=await startSlackOAuth();window.location.href=url}catch(error){e.currentTarget.disabled=false;toast(error.message)}});
  $('#installOrbitButton')?.addEventListener('click',installOrbitApp);
  $('#enableNotificationsButton')?.addEventListener('click',async()=>{if('Notification' in window&&Notification.permission==='granted')await showLocalNotification('Orbit testnotis',{body:'Notiser fungerar.',tag:'orbit-test'});else await requestLocalNotifications()});
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
    <div class="member-list">${members.map(m=>memberRow(tm,m,isAdmin)).join('')||'<p class="muted-line">Inga aktiva medlemmar ännu.</p>'}</div>
    ${isAdmin?`<form class="invite-form" data-team="${tm.id}"><input name="email" type="email" placeholder="kollega@example.com" required><select name="role"><option value="member">Medlem</option><option value="admin">Admin</option></select><button>+ Bjud in</button></form>`:''}
    <div class="pending-list">${invites.length?invites.map(i=>inviteRow(i,isAdmin)).join(''):'<p class="muted-line">Inga inbjudningar ännu.</p>'}</div>
  </article>`;
}

function memberRow(tm,m,isAdmin){
  const p=person(m.userId),canEdit=isAdmin&&m.userId!==state.currentUserId&&m.role!=='owner';
  return `<div class="member-row">${avatarHtml(p)}<span>${escapeHtml(p.name)}</span>${canEdit?`<select data-member-role="${tm.id}:${m.userId}">${['member','admin'].map(role=>option(role,role==='admin'?'Admin':'Medlem',m.role)).join('')}</select><button class="danger-lite" data-member-remove="${tm.id}:${m.userId}">Ta bort</button>`:`<small>${m.role}</small>`}</div>`;
}

function inviteRow(invite,isAdmin){
  return `<div class="invite-row"><span>${escapeHtml(invite.email)}</span><small>${invite.acceptedAt?'Accepterad':'Väntar'} · ${invite.role}</small>${isAdmin&&!invite.acceptedAt?`<button class="danger-lite" data-invite-delete="${invite.id}">Dra tillbaka</button>`:''}</div>`;
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
  document.querySelectorAll('[data-member-role]').forEach(s=>s.onchange=async()=>{const[teamId,userId]=s.dataset.memberRole.split(':');await updateTeamMember(teamId,userId,s.value);await load();toast('Medlemsrollen är uppdaterad.')});
  document.querySelectorAll('[data-member-remove]').forEach(b=>b.onclick=async()=>{const[teamId,userId]=b.dataset.memberRemove.split(':');b.disabled=true;try{await removeTeamMember(teamId,userId);await load();toast('Medlemmen är borttagen från teamet.')}catch(error){b.disabled=false;toast(error.message)}});
  document.querySelectorAll('[data-invite-delete]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{await deleteInvitation(b.dataset.inviteDelete);await load();toast('Inbjudan är tillbakadragen.')}catch(error){b.disabled=false;toast(error.message)}});
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
    <div class="area-card-projects">${projects.map(p=>`<span class="project-chip"><button data-view="project:${p.id}">${projectIconHtml(p)}${escapeHtml(p.name)}</button><button class="chip-edit" data-edit-project="${p.id}" title="Redigera projekt">✎</button></span>`).join('')||'<span>Inga projekt ännu</span>'}</div>
    <div class="area-settings">
      <label>Kategori<input data-area-category="${a.id}" data-original-category="${escapeHtml(category)}" value="${escapeHtml(category)}" ${owner?'':'disabled'}></label>
      <label>Delas med<select data-area-share="${a.id}" ${owner?'':'disabled'}><option value="">Endast privat</option>${state.teams.map(t=>`<option value="${t.id}" ${a.teamId===t.id?'selected':''}>${escapeHtml(t.name)}</option>`).join('')}</select></label>
    </div>
    <div class="access-note">${a.teamId?'Delas med':'Privat för dig'}<span class="team-stack">${members.map(avatarHtml).join('')}</span>${a.teamId?escapeHtml(current?.name||'Okänt team'):'Endast du'}</div>
    <div class="area-card-actions"><button class="secondary" type="button" data-area-open="${a.id}">Öppna område</button><button class="secondary" type="button" data-edit-area="${a.id}">✎ Redigera</button><button class="secondary" type="button" data-create-project="${a.id}">＋ Nytt projekt</button></div>
  </article>`;
}

function areaCards(){
  const groups=areaGroups();
  return `<div class="hierarchy-page">
    <section class="hierarchy-intro"><div><p class="eyebrow">MODELLEN</p><h3>Kategori → Område → Projekt → Task → Subtask</h3><p>Kategorier är översta nivån, t.ex. Privat, Bolag eller Jobb. Team kopplas till områden för åtkomst och är därför inte en egen uppgiftslista.</p></div><button class="primary" data-create-structure="category">＋ Ny kategori</button></section>
    <section class="structure-builder">
      <div><p class="eyebrow">BYGG STRUKTUR</p><h3>Skapa på rätt nivå</h3><p>Välj först om du vill skapa en helt ny kategori, ett område under en kategori eller ett projekt under ett område.</p></div>
      <div class="structure-builder-grid">
        <button type="button" data-create-structure="category"><strong>1</strong><span>Ny kategori</span><small>Ex. Privat, Jobb, Bolag. Skapar också första området.</small></button>
        <button type="button" data-create-structure="area"><strong>2</strong><span>Nytt område</span><small>Ex. Huset, Båten, Foreshadow under vald kategori.</small></button>
        <button type="button" data-create-structure="project" ${state.areas.length?'':'disabled'}><strong>3</strong><span>Nytt projekt</span><small>Ex. Bygga v1, Ny landing page under valt område.</small></button>
      </div>
    </section>
    ${groups.length?groups.map(group=>`<section class="category-card"><div class="category-head"><div class="category-title">${categoryIconHtml(group.category)}<div><p class="eyebrow">KATEGORI</p><h3>${escapeHtml(group.category)}</h3><p>${group.areas.length} område${group.areas.length===1?'':'n'}</p></div></div><div class="category-head-actions"><button class="secondary" data-edit-category="${escapeHtml(group.category)}">✎ Redigera kategori</button><button class="secondary" data-create-area="${escapeHtml(group.category)}">＋ Nytt område</button></div></div><div class="area-grid">${group.areas.map(areaHierarchyCard).join('')}</div></section>`).join(''):'<div class="empty">Inga områden ännu. Skapa första kategorin ovan.</div>'}
    ${areaAccessContent()}
  </div>`;
}
function taskGroupHtml(t){const all=childrenOf(t.id),shown=all.filter(c=>c.visible&&!c.completed),done=all.filter(c=>c.completed).length;return `<div class="task-group">${taskHtml(t,all.length?`${done}/${all.length}`:'')}${shown.length?`<div class="subtasks">${shown.map(c=>taskHtml(c)).join('')}</div>`:''}${all.some(c=>!c.visible&&!c.completed)?`<div class="subtask-waiting">⚡ ${all.filter(c=>!c.visible&&!c.completed).length} nästa steg väntar på ett villkor</div>`:''}</div>`}
function assignmentBadge(t){
  if(t.assigneeId!==state.currentUserId||!t.createdBy||t.createdBy===state.currentUserId)return'';
  if(t.assignmentStatus==='pending')return'<span class="assignment-badge pending">◎ Väntar på ditt svar</span>';
  if(t.assignmentStatus==='declined')return'<span class="assignment-badge declined">◎ Nekad</span>';
  return'<span class="assignment-badge mine">◎ Tilldelat till dig</span>';
}
function taskHtml(t,progress=''){
  const p=project(t.projectId),a=person(t.assigneeId),ar=areaForProject(t.projectId),linkCount=linksForTask(t.id).length,when=scheduleLabel(t),remind=reminderLabel(t);
  return `<article class="task ${progress?'has-children':''}" data-id="${t.id}"><button class="check p${t.priority}" data-id="${t.id}" aria-label="${t.taskType==='approval'?'Godkänn':'Markera klar'}"></button><div><div class="task-title">${t.taskType==='milestone'?'◆ ':t.taskType==='approval'?'✓ ':''}${escapeHtml(t.title)}</div><div class="task-meta">${assignmentBadge(t)}${progress?`<span class="subtask-progress">☷ ${progress} delsteg</span>`:''}${t.recurrenceRule?`<span class="context-count">↻ ${recurrenceLabel(t.recurrenceRule)}</span>`:''}${linkCount?`<span class="context-count">↗ ${linkCount}</span>`:''}${when?`<span class="due ${isOverdue(t)?'overdue':''}">◷ ${escapeHtml(when)}</span>`:''}${remind?`<span class="reminder ${isReminderDue(t)?'due-now':''}">⏰ ${isReminderDue(t)?'Nu':escapeHtml(remind)}</span>`:''}${p?`<span class="project-tag"><i class="project-dot" style="background:${p.color}"></i>${p.name}</span>`:''}${ar&&!t.parentTaskId?`<span class="area-badge"><i style="background:${ar.color}"></i>${areaName(ar)}</span>`:''}</div></div>${avatarHtml(a)}</article>`
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
        <label>Återkommer<select name="recurrenceRule">${[['','Nej'],['daily','Dagligen'],['weekly','Varje vecka'],['monthly','Varje månad']].map(([id,label])=>option(id,label,t.recurrenceRule||'')).join('')}</select></label>
        <label>Snabbtext<input name="due" value="${escapeHtml(t.due||'')}" placeholder="T.ex. imorgon 09:00"></label>
        <label>Deadline<input name="dueAt" type="datetime-local" value="${toDateTimeLocalValue(t.dueAt)}"></label>
        <label>Påminnelse<input name="reminderAt" type="datetime-local" value="${toDateTimeLocalValue(t.reminderAt)}"></label>
      </div>
      <div class="task-context-card" id="editTaskContextCard">${taskContextHtml(t.projectId||'',t.assigneeId)}</div>
      <button class="primary" type="submit">Spara ändringar</button>
    </form>
  </details>`;
}

function renderBreakdownForm(t){
  const existing=childrenOf(t.id).length;
  return `<details class="breakdown-card" ${existing?'':'open'}>
    <summary>☷ Bryt ner i små steg</summary>
    <form id="breakdownForm" class="breakdown-form">
      <p>Skriv ett konkret nästa steg per rad. Använd små verb: “Maila…”, “Välj…”, “Boka…”, “Testa…”.</p>
      <textarea name="steps" placeholder="Exempel:
Skriv första utkastet
Skicka till Pelle
Följ upp svaret"></textarea>
      <div class="breakdown-options">
        <label><input type="checkbox" name="sequential" checked> Lås upp ett steg i taget</label>
        <label><input type="checkbox" name="today" checked> Lägg första steget i Gör idag</label>
      </div>
      <button class="primary" type="submit">Skapa underuppgifter</button>
    </form>
  </details>`;
}

function bindTaskEditForm(id){
  const form=$('#taskEditForm');if(!form)return;
  const projectSelect=$('#editProjectSelect'),assigneeSelect=$('#editAssigneeSelect');
  bindScheduleAssist(form);
  projectSelect.onchange=()=>{assigneeSelect.innerHTML=assigneeOptionsHtml(projectSelect.value,defaultAssigneeForProject(projectSelect.value));updateTaskContext('editProjectSelect','editAssigneeSelect','editTaskContextCard')};
  assigneeSelect.onchange=()=>updateTaskContext('editProjectSelect','editAssigneeSelect','editTaskContextCard');
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
      recurrenceRule:data.recurrenceRule||null,
      due:schedule.due,
      dueAt:schedule.dueAt,
      reminderAt:schedule.reminderAt
    })});
    await load();
    openInspector(id);
    toast('Uppgiften är uppdaterad.');
  };
}

function bindBreakdownForm(id){
  const form=$('#breakdownForm'),parent=state.tasks.find(t=>t.id===id);if(!form||!parent)return;
  form.onsubmit=async e=>{
    e.preventDefault();
    const data=Object.fromEntries(new FormData(form));
    const lines=String(data.steps||'').split('\n').map(s=>s.trim()).filter(Boolean).slice(0,12);
    if(!lines.length){toast('Skriv minst ett steg.');return}
    const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
    try{
      let previousId=null;
      for(const [index,title] of lines.entries()){
        const bucket=data.today&&index===0?'today':parent.bucket||'inbox';
        const child=await createCloudTask({
          title,
          notes:'',
          projectId:parent.projectId||null,
          assigneeId:parent.assigneeId||state.currentUserId,
          parentTaskId:parent.id,
          bucket,
          priority:parent.priority||3,
          due:bucket==='today'?formatDateTime(todayPlanTime()):'',
          dueAt:bucket==='today'?todayPlanTime():null,
          status:'todo',
          dependencyTaskIds:data.sequential&&previousId?[previousId]:[]
        });
        previousId=child.id;
      }
      await load();
      openInspector(id);
      toast(lines.length===1?'Underuppgiften är skapad.':`${lines.length} underuppgifter är skapade.`);
    }catch(error){toast(error.message);submit.disabled=false}
  };
}

function openInspector(id){
  const t=state.tasks.find(x=>x.id===id);if(!t)return;
  const p=project(t.projectId),a=person(t.assigneeId),ar=areaForProject(t.projectId),tm=team(ar?.teamId),subs=childrenOf(t.id),comments=(state.comments||[]).filter(c=>c.taskId===id);
  const when=scheduleLabel(t),remind=reminderLabel(t);
  $('#inspectorContent').innerHTML=`<p class="eyebrow">${ar?escapeHtml(areaName(ar)).toUpperCase():'UPPGIFT'}</p><button class="check big-check p${t.priority}" id="detailCheck"></button><h2>${escapeHtml(t.title)}</h2>${subs.length?`<div class="parent-lock">Huvuduppgiften blir klar automatiskt när alla ${subs.length} delsteg är klara.</div>`:''}${t.activationReason?`<div class="activation-explain"><strong>✦ Varför ser jag detta nu?</strong>${escapeHtml(t.activationReason)}${t.activatedAt?` · ${new Date(t.activatedAt).toLocaleString('sv-SE')}`:''}</div>`:''}${t.notes?`<p style="color:#777;font-size:13px;line-height:1.6">${escapeHtml(t.notes)}</p>`:''}<div class="detail-row"><span>Status</span><strong class="status-chip">${statusLabel(t.status)}</strong></div><div class="detail-row"><span>Område</span><strong>${ar?ar.icon+' '+areaName(ar):'Inbox'}</strong></div><div class="detail-row"><span>Projekt</span><strong>${p?p.name:'Inbox'}</strong></div><div class="detail-row"><span>Tilldelad</span><strong>${a.name}</strong></div><div class="detail-row"><span>Svar</span><strong>${assignmentStatusLabel(t)}</strong></div><div class="detail-row"><span>Åtkomst</span><strong>${tm?tm.name:'Endast du'}</strong></div><div class="detail-row"><span>Deadline</span><strong>${when?escapeHtml(when):'Inget datum'}</strong></div><div class="detail-row"><span>Påminnelse</span><strong>${remind?`${isReminderDue(t)?'Nu · ':''}${escapeHtml(remind)}`:'Ingen'}</strong></div><div class="detail-row"><span>Återkommer</span><strong>${recurrenceLabel(t.recurrenceRule)}</strong></div>${renderTaskEditForm(t)}${renderBreakdownForm(t)}${subs.length?`<div class="inspector-subtasks"><h3>Underuppgifter · ${subs.filter(s=>s.completed).length}/${subs.length}</h3>${subs.map(s=>`<div class="inspector-subtask ${s.completed?'done':''} ${!s.visible?'waiting':''}">${s.completed?'✓':s.visible?`<button class="check p${s.priority}" data-id="${s.id}"></button>`:'⚡'}<span>${escapeHtml(s.title)}</span><small>${!s.visible?'Väntar':person(s.assigneeId).initials}</small></div>`).join('')}</div>`:''}${renderTriggerBox(t)}${renderCalendarSync(t)}${renderTaskLinks(t)}${renderActivityLog(t.id)}<div class="comment-section"><h3>Kommentarer · ${comments.length}</h3>${comments.map(c=>`<div class="comment">${avatarHtml(person(c.authorId))}<div><p>${escapeHtml(c.body)}</p><time>${new Date(c.createdAt).toLocaleString('sv-SE')}</time></div></div>`).join('')}<form class="comment-form" id="commentForm"><input name="comment" placeholder="Skriv en kommentar eller @nämn någon…" required><button>Skicka</button></form></div>`;
  $('#detailCheck').onclick=()=>{complete(id);if(!subs.length)$('#inspector').classList.remove('open')};
  document.querySelectorAll('.inspector-subtask .check').forEach(b=>b.onclick=async()=>{await complete(b.dataset.id);openInspector(id)});
  bindTaskEditForm(id);
  bindBreakdownForm(id);
  bindCalendarSync(id);
  $('#taskLinkForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);await addTaskLink(id,{kind:f.get('kind'),title:f.get('title'),url:f.get('url')});await load();openInspector(id);toast('Länken är tillagd.')};
  $('#commentForm').onsubmit=async e=>{e.preventDefault();const body=new FormData(e.target).get('comment');await addComment(id,body);await load();openInspector(id)};
  $('#inspector').classList.add('open')
}
function statusLabel(s){return({idea:'Idé',planned:'Planerad',todo:'Att göra',doing:'Pågår',waiting:'Väntar',review:'Granskning',done:'Klar'})[s]||'Att göra'}
function assignmentStatusLabel(t){
  if(!t.createdBy||t.createdBy===t.assigneeId)return'Inte extern tilldelning';
  return ({pending:'Väntar på svar',accepted:'Accepterad',declined:'Nekad'})[t.assignmentStatus||'accepted']||'Accepterad';
}
function recurrenceLabel(rule){return({daily:'Dagligen',weekly:'Varje vecka',monthly:'Varje månad'})[rule]||'Nej'}
function activityLabel(a){
  return ({created:'Skapad',completed:'Klar',assigned:'Tilldelad',assignment_accepted:'Tilldelning accepterad',assignment_declined:'Tilldelning nekad',status_changed:'Status ändrad',updated:'Uppdaterad',commented:'Kommentar'})[a.action]||a.action||'Händelse';
}
function renderActivityLog(taskId){
  const rows=(state.activity||[]).filter(a=>a.taskId===taskId).slice(0,8);
  if(!rows.length)return'<div class="activity-section"><h3>Aktivitet</h3><p class="hint">Ingen aktivitet loggad ännu.</p></div>';
  return `<div class="activity-section"><h3>Aktivitet · ${rows.length}</h3>${rows.map(a=>`<div class="activity-row"><span>${escapeHtml(activityLabel(a))}</span><small>${escapeHtml(person(a.actorId).name)} · ${new Date(a.createdAt).toLocaleString('sv-SE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</small></div>`).join('')}</div>`;
}
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
  $('#agentActions').innerHTML=`${waitingInsightHtml()}${actions.length?actions.slice(0,5).map(a=>`<button class="agent-action" ${a.taskId?`data-agent-task="${a.taskId}"`:''}><span>${escapeHtml((a.type||'next').toUpperCase())}</span><strong>${escapeHtml(a.text||'Föreslagen åtgärd')}</strong>${a.taskTitle?`<small>${escapeHtml(a.taskTitle)}</small>`:''}</button>`).join(''):'<p class="hint">Inga agentförslag sparade ännu.</p>'}`;
  $('#agentActions').querySelectorAll('[data-agent-task]').forEach(b=>b.onclick=()=>openInspector(b.dataset.agentTask));
  $('#agentActions').querySelectorAll('[data-waiting-task]').forEach(b=>b.onclick=()=>openInspector(b.dataset.waitingTask));
  $('#runAgent').onclick=async()=>{const plan=buildAgentPlan();await saveAgentRun(plan);await load();toast('Agenten har föreslagit nästa steg.')};
}

function waitingInsightHtml(){
  const visibleWaiting=topLevel(visible().filter(t=>t.status==='waiting'));
  const hiddenWaiting=state.tasks.filter(t=>!t.visible&&!t.completed);
  const parentWaiting=topLevel(visible().filter(t=>hiddenWaiting.some(h=>h.parentTaskId===t.id)));
  const items=[...visibleWaiting.map(t=>({task:t,label:t.activationReason||t.trigger?.label||'Markerad som väntar'})),...parentWaiting.map(t=>({task:t,label:`${hiddenWaiting.filter(h=>h.parentTaskId===t.id).length} dolt nästa steg väntar på villkor`}))].filter((item,index,self)=>self.findIndex(x=>x.task.id===item.task.id)===index).slice(0,4);
  if(!items.length&&!hiddenWaiting.length)return'';
  return `<section class="waiting-insight">
    <div class="waiting-insight-head"><div><span>VÄNTAR</span><strong>${items.length||hiddenWaiting.length} blockerad${(items.length||hiddenWaiting.length)===1?'':'e'} sak${(items.length||hiddenWaiting.length)===1?'':'er'}</strong></div><small>${hiddenWaiting.length} dold${hiddenWaiting.length===1?'':'a'} trigger-task${hiddenWaiting.length===1?'':'s'}</small></div>
    <div class="waiting-insight-list">${items.length?items.map(({task,label})=>`<button data-waiting-task="${task.id}"><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(label)}</small></button>`).join(''):`<p class="hint">${hiddenWaiting.length} dolda uppgifter väntar på externa triggers eller kedjor.</p>`}</div>
  </section>`;
}

function currentCategory(){
  if(view.startsWith('category:'))return categoryFromView();
  if(view.startsWith('area:'))return areaCategory(area(view.split(':')[1]));
  if(view.startsWith('project:'))return areaCategory(areaForProject(view.split(':')[1]));
  return 'Privat';
}

function currentAreaId(){
  if(view.startsWith('area:'))return view.split(':')[1];
  if(view.startsWith('project:'))return project(view.split(':')[1])?.areaId||'';
  return '';
}

function fillStructureOptions(selectedAreaId='',selectedTeamId=''){
  $('#structureCategoryOptions').innerHTML=areaGroups().map(group=>`<option value="${escapeHtml(group.category)}"></option>`).join('');
  $('#structureAreaSelect').innerHTML=areaGroups().map(group=>`<optgroup label="${escapeHtml(group.category)}">${group.areas.map(a=>option(a.id,areaName(a),selectedAreaId)).join('')}</optgroup>`).join('');
  $('#structureTeamSelect').innerHTML='<option value="">Endast privat</option>'+state.teams.map(t=>option(t.id,t.name,selectedTeamId)).join('');
}

function showStructureField(id,show){
  const el=$(id);
  if(el)el.style.display=show?'block':'none';
}

function setStructureIcon(icon='◫'){
  const value=String(icon||'◫').trim().slice(0,2)||'◫';
  const input=$('#structureForm')?.elements?.icon;
  if(input)input.value=value;
  document.querySelectorAll('[data-icon-choice]').forEach(b=>b.classList.toggle('active',b.dataset.iconChoice===value));
}

function structureLevel(mode='category'){
  if(mode.includes('project'))return'project';
  if(mode.includes('area'))return'area';
  return'category';
}

function updateStructureStepper(mode='category'){
  const level=structureLevel(mode),editing=mode.startsWith('edit-');
  const stepper=$('#structureStepper'),hint=$('#structureNextHint');
  if(stepper)stepper.classList.toggle('editing',editing);
  document.querySelectorAll('[data-structure-step]').forEach(b=>{
    const step=b.dataset.structureStep;
    b.classList.toggle('active',step===level);
    b.disabled=editing||(step==='project'&&!state.areas.length);
  });
  if(!hint)return;
  const copy={
    category:'Du skapar översta nivån. För att kategorin ska synas skapas också ett första område i den.',
    area:'Du skapar ett område under vald kategori. Området kan delas med ett team och innehålla flera projekt.',
    project:state.areas.length?'Du skapar ett projekt under valt område. Uppgifter i projektet följer områdets åtkomst.':'Skapa minst ett område först, sedan kan projekt läggas under det.',
    'edit-category':'Ändringen påverkar kategorin som gruppering. Områdena ligger kvar under det nya namnet.',
    'edit-area':'Om du byter kategori flyttas området i vänsterspalten. Teamdelning gäller allt under området.',
    'edit-project':'Om du flyttar projektet till annat område följer projektets uppgifter det nya områdets åtkomst.'
  };
  hint.textContent=copy[mode]||copy[level]||'';
}

function openStructureDialog(mode='category',context={}){
  const dialog=$('#structureDialog'),form=$('#structureForm');
  if(!dialog||!form)return;
  if(mode==='project'&&!state.areas.length){
    toast('Skapa ett område först. Projekt måste ligga under ett område.');
    mode='category';
  }
  form.reset();
  const editingCategory=mode==='edit-category',editingArea=mode==='edit-area',editingProject=mode==='edit-project',editing=editingCategory||editingArea||editingProject;
  const currentArea=editingArea?area(context.areaId):null,currentProject=editingProject?project(context.projectId):null,projectArea=currentProject?area(currentProject.areaId):null;
  const areaId=context.areaId||currentProject?.areaId||currentAreaId()||state.areas[0]?.id||'',category=context.category||areaCategory(currentArea)||areaCategory(projectArea)||currentCategory();
  const visual=editingCategory||mode==='category'?categoryVisual(category):null;
  fillStructureOptions(areaId,currentArea?.teamId||'');
  form.elements.mode.value=mode;
  form.elements.entityId.value=context.areaId||context.projectId||'';
  form.elements.originalCategory.value=category||'';
  form.elements.color.value=currentProject?.color||currentArea?.color||visual?.color||(mode.includes('project')?'#8b70ff':'#7659ef');
  setStructureIcon(currentProject?.icon||currentArea?.icon||visual?.icon||(mode.includes('project')?'▣':'◫'));
  form.elements.category.value=editingCategory?category:(category==='Privat'&&mode==='category'?'':category);
  form.elements.areaId.value=areaId;
  form.elements.name.value=editingCategory?category:currentArea?areaName(currentArea):currentProject?.name||'';
  form.elements.areaId.disabled=mode==='project'||editingProject?!state.areas.length:false;
  showStructureField('#structureCategoryField',mode!=='project'&&!editingCategory&&mode!=='edit-project');
  showStructureField('#structureAreaField',mode==='project'||editingProject);
  showStructureField('#structureIconField',true);
  showStructureField('#structureColorField',true);
  showStructureField('#structureTeamField',mode!=='project'&&!editingCategory&&mode!=='edit-project');
  const title={category:'Ny kategori',area:'Nytt område',project:'Nytt projekt','edit-category':'Redigera kategori','edit-area':'Redigera område','edit-project':'Redigera projekt'}[mode]||'Ny struktur';
  const help={
    category:'En kategori syns i vänsterspalten när den har minst ett område. Skapa därför kategorin och första området samtidigt.',
    area:`Området hamnar under kategorin “${category||'Privat'}” och kan senare delas med ett team.`,
    project:'Projektet hamnar under valt område. Uppgifter under projektet följer områdets åtkomst.',
    'edit-category':'Byter namn, ikon och färg på kategorin för dina egna områden i den kategorin.',
    'edit-area':'Ändra namn, kategori, ikon, färg eller vilket team området delas med.',
    'edit-project':'Ändra projektets namn, färg eller flytta projektet till ett annat område.'
  }[mode];
  $('#structureEyebrow').textContent=mode.includes('project')?'PROJEKT':mode.includes('area')?'OMRÅDE':'KATEGORI';
  $('#structureTitle').textContent=title;
  $('#structureHelp').textContent=help;
  $('#structureNameLabel').textContent=editingCategory?'Kategorins namn':mode.includes('project')?'Projektets namn':mode.includes('area')?'Områdets namn':'Första området i kategorin';
  $('#structureNameInput').placeholder=editingCategory?'T.ex. Privat, Jobb eller Bolag':mode.includes('project')?'T.ex. Bygga v1':mode.includes('area')?'T.ex. Huset, Barnen eller Båten':'T.ex. Allmänt, Huset eller Foreshadow';
  $('#saveStructure').textContent=editing?'Spara ändringar':mode==='project'?'Skapa projekt':mode==='area'?'Skapa område':'Skapa kategori';
  updateStructureStepper(mode);
  if(!dialog.open)dialog.showModal();
  setTimeout(()=>editing||mode==='project'?$('#structureNameInput').focus():form.elements.category.focus(),50);
}

$('#structureForm').onsubmit=async e=>{
  e.preventDefault();
  const form=e.target,save=$('#saveStructure'),data=Object.fromEntries(new FormData(form)),mode=data.mode;
  save.disabled=true;
  try{
    if(mode==='edit-category'){
      const nextName=(data.name||'').trim();
      if(!nextName)throw new Error('Kategorin behöver ett namn.');
      await renameCategory(data.originalCategory,nextName,{icon:data.icon,color:data.color});
      collapsedCategories.delete(data.originalCategory);
      collapsedCategories.delete(nextName);
      if(view===categoryViewId(data.originalCategory))view=categoryViewId(nextName);
      $('#structureDialog').close();
      await load();
      toast('Kategorin är uppdaterad.');
      return;
    }
    if(mode==='edit-area'){
      await updateAreaDetails(data.entityId,{name:data.name,category:data.category,icon:data.icon,color:data.color,teamId:data.teamId||null});
      const previousCategory=data.originalCategory||'Privat',nextCategory=(data.category||'').trim()||'Privat';
      if(!categorySetting(nextCategory))await upsertCategorySetting({name:nextCategory,icon:data.icon,color:data.color});
      collapsedCategories.delete(previousCategory);
      collapsedCategories.delete(nextCategory);
      collapsedAreas.delete(data.entityId);
      view='area:'+data.entityId;
      $('#structureDialog').close();
      await load();
      toast('Området är uppdaterat.');
      return;
    }
    if(mode==='edit-project'){
      await updateProject(data.entityId,{name:data.name,areaId:data.areaId,icon:data.icon,color:data.color});
      collapsedAreas.delete(data.areaId);
      const a=area(data.areaId);if(a)collapsedCategories.delete(areaCategory(a));
      view='project:'+data.entityId;
      $('#structureDialog').close();
      await load();
      toast('Projektet är uppdaterat.');
      return;
    }
    if(mode==='project'){
      const created=await createProject({areaId:data.areaId,name:data.name,icon:data.icon,color:data.color});
      collapsedAreas.delete(data.areaId);
      const a=area(data.areaId);if(a)collapsedCategories.delete(areaCategory(a));
      view='project:'+created.id;
      $('#structureDialog').close();
      await load();
      toast('Projektet är skapat.');
      return;
    }
    const category=(data.category||'').trim()||'Privat';
    if(mode==='category'&&!data.category.trim())throw new Error('Skriv namnet på kategorin.');
    if(mode==='category'||!categorySetting(category))await upsertCategorySetting({name:category,icon:data.icon,color:data.color});
    const created=await createArea({name:data.name,category,icon:data.icon,color:data.color,teamId:data.teamId||null});
    collapsedCategories.delete(category);
    collapsedAreas.delete(created.id);
    view='area:'+created.id;
    $('#structureDialog').close();
    await load();
    toast(mode==='category'?'Kategorin och första området är skapade.':'Området är skapat.');
  }catch(error){toast(error.message)}
  finally{save.disabled=false}
};

function refreshAssignees(){
  const projectId=$('#projectSelect').value;
  $('#assigneeSelect').innerHTML=assigneeOptionsHtml(projectId,defaultAssigneeForProject(projectId));
  updateTaskContext();
}
function openDialog(prefill={}){
  if($('#authScreen')?.classList.contains('open'))return;
  $('#taskForm').reset();
  $('#linkDetails').open=false;
  $('#projectSelect').innerHTML=projectOptionsHtml('');
  if(prefill.projectId)$('#projectSelect').value=prefill.projectId;
  else if(view.startsWith('project:'))$('#projectSelect').value=view.split(':')[1];
  else if(bucketViews.includes(view))$('#taskForm').elements.bucket.value=view;
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
$('#assigneeSelect').onchange=()=>updateTaskContext();
$('#quickAdd').onclick=$('#addRow').onclick=$('#mobileAdd').onclick=openDialog;$('#closeInspector').onclick=()=>$('#inspector').classList.remove('open');
document.querySelectorAll('[data-close-task-dialog]').forEach(b=>b.onclick=()=>$('#taskDialog').close());
document.querySelectorAll('[data-close-structure-dialog]').forEach(b=>b.onclick=()=>$('#structureDialog').close());
$('#commandButton').onclick=openCommandPalette;
$('#commandSearch').oninput=e=>renderCommandResults(e.target.value);
$('#commandForm').onsubmit=e=>{e.preventDefault();openFirstCommandResult()};
$('#closeCommand').onclick=()=>$('#commandDialog').close();
document.querySelectorAll('[data-icon-choice]').forEach(b=>b.onclick=()=>setStructureIcon(b.dataset.iconChoice));
document.querySelectorAll('[data-structure-step]').forEach(b=>b.onclick=()=>{
  const form=$('#structureForm'),current=form?.elements?.mode?.value||'category';
  if(current.startsWith('edit-'))return;
  openStructureDialog(b.dataset.structureStep,{category:form?.elements?.category?.value||currentCategory(),areaId:form?.elements?.areaId?.value||currentAreaId()});
});
$('#structureForm')?.elements?.icon?.addEventListener('input',e=>setStructureIcon(e.target.value));
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
document.addEventListener('keydown',e=>{
  const tag=document.activeElement.tagName;
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openCommandPalette();return}
  if(e.key.toLowerCase()==='n'&&!['INPUT','TEXTAREA','SELECT'].includes(tag)){e.preventDefault();openDialog()}
});

let authMode='signin';
function showAuth(){ $('#authScreen').classList.add('open');setAppLocked(true);$('#configHelp').classList.toggle('show',!configured);$('#authSubmit').disabled=!configured }
function hideAuth(){ $('#authScreen').classList.remove('open');setAppLocked(false) }
$('#authSwitch').onclick=()=>{authMode=authMode==='signin'?'signup':'signin';const signup=authMode==='signup';$('#nameLabel').classList.toggle('show',signup);$('#authTitle').textContent=signup?'Skapa ditt konto':'Välkommen tillbaka';$('#authSubmit').textContent=signup?'Skapa konto':'Logga in';$('#authSwitch').textContent=signup?'Har du redan ett konto? Logga in':'Inget konto? Skapa ett';$('#authError').textContent=''};
$('#authForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);$('#authError').textContent='';$('#authSubmit').disabled=true;try{if(authMode==='signup')await signUp(f.get('name'),f.get('email'),f.get('password'));else await signIn(f.get('email'),f.get('password'));await boot()}catch(err){$('#authError').textContent=err.message}finally{$('#authSubmit').disabled=false}};
$('#logoutButton').onclick=async()=>{if(liveChannel)await liveChannel.unsubscribe();await signOut();showAuth()};
async function boot(){if(!configured){showAuth();return}const current=await session();if(!current){showAuth();return}hideAuth();$('#currentUserName').textContent=current.user.user_metadata?.name||current.user.email.split('@')[0];await load();state.currentUserId=current.user.id;render();startReminderLoop();if(pendingTaskOpen){const id=pendingTaskOpen;pendingTaskOpen='';openInspector(id);clearQueryUrl()}if(pendingCapture){const capture=pendingCapture;pendingCapture=null;openDialog(capture);clearCaptureUrl();toast('Länken är fångad. Spara för att skapa uppgiften.')}if(liveChannel)await liveChannel.unsubscribe();liveChannel=subscribeToChanges(()=>load())}
registerServiceWorker();
boot();
