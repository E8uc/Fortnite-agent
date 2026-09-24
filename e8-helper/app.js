const API="https://e8helper.a39328122.workers.dev";
const REQUIRED_WORKER_BUILD="2026-09-24-oauth-panel-v1";
const SK="e8helper.session",GK="e8helper.guild",DK="e8helper.draft.";
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const page=document.body.dataset.page||"landing";
const st={token:"",me:null,guildId:"",resources:null,config:null,openrouter:false,saveTimer:null,saving:false,queued:false,queuedFinish:false,revision:0,dirty:false,draftRestored:false};

function esc(v){return String(v??"").replace(/[&<>'"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]))}
function clone(v){return JSON.parse(JSON.stringify(v))}
function toast(message,type="info"){const el=$("#toast");if(!el)return;el.textContent=message;el.dataset.type=type;el.classList.add("show");clearTimeout(el._timer);el._timer=setTimeout(()=>el.classList.remove("show"),2800)}
function saveState(message,kind=""){const el=$("#saveState");if(!el)return;el.textContent=message;el.dataset.kind=kind}
async function api(path,options={}){const headers=new Headers(options.headers||{});if(st.token)headers.set("Authorization","Bearer "+st.token);if(options.body)headers.set("Content-Type","application/json");const response=await fetch(API+path,{...options,headers});const raw=await response.text();let body={};try{body=raw?JSON.parse(raw):{}}catch{body={message:raw}}if(!response.ok){const e=new Error(body.message||body.error||("Request failed ("+response.status+")"));e.status=response.status;e.body=body;throw e}return body}
function openWeb(url){const a=document.createElement("a");a.href=url;a.target="_blank";a.rel="noopener noreferrer";document.body.appendChild(a);a.click();a.remove()}
function login(){location.href=API+"/dashboard/auth/discord/start?install=1"}
function drawer(open){$("#drawer")?.classList.toggle("open",open);$("#backdrop")?.classList.toggle("hidden",!open);$("#drawer")?.setAttribute("aria-hidden",String(!open));$("#menuButton")?.setAttribute("aria-expanded",String(open))}
function guildQuery(){return st.guildId?"?guild="+encodeURIComponent(st.guildId):""}
function icon(g,size=96){return g?.icon?"https://cdn.discordapp.com/icons/"+g.id+"/"+g.icon+".png?size="+size:""}
function avatar(g,cls="guild-avatar"){const u=icon(g);return u?'<img class="'+cls+'" src="'+u+'" alt="">':'<span class="'+cls+'">'+esc(String(g?.name||"E8").slice(0,2).toUpperCase())+"</span>"}
function draftKey(){return DK+st.guildId}
function localSave(){if(st.guildId&&st.config)localStorage.setItem(draftKey(),JSON.stringify({savedAt:Date.now(),config:st.config}))}
function restoreDraft(serverConfig){try{const local=JSON.parse(localStorage.getItem(draftKey())||"null");if(local?.config&&Number(local.savedAt)>Number(serverConfig?.updatedAt||0)){st.dirty=true;st.draftRestored=true;setTimeout(()=>toast("Your saved draft was restored."),180);return local.config}}catch{}return serverConfig}
function ensureShape(){const c=st.config||(st.config={});c.features=c.features||{};c.ai=c.ai||{enabled:false,channelId:"",timezone:"America/New_York",wakeMinute:840,sleepMinute:1380,conversationMemory:true};c.pathFinder=c.pathFinder||{enabled:false,channelId:"",access:"everyone",roleIds:[]};c.support=c.support||{channelId:"",roleId:"",ticketUrl:""};c.managers=c.managers||{roleIds:[],userIds:[]};c.customEmojis=Array.isArray(c.customEmojis)?c.customEmojis:[]}

function injectShell(){
  if(page==="landing")return;
  const currentName={
    overview:"Overview",ai:"𝑬𝟖𝐴𝑖",path:"𝑬𝟖 Path Finder",emojis:"Custom Emojis",
    support:"Support",permissions:"Permissions",schedule:"Schedule",memory:"Memory & Privacy"
  }[page]||"Overview";
  document.body.insertAdjacentHTML("afterbegin",
    '<header class="topbar"><a class="brand" href="./"><span class="brand-mark">E8</span><span class="brand-name">E8 Helper</span></a><div class="top-actions"><button id="serverSwitcher" class="server-switch hidden"></button><button id="menuButton" class="hamburger" aria-label="Open menu" aria-expanded="false"><i></i><i></i><i></i></button></div></header>'+
    '<div id="backdrop" class="backdrop hidden"></div>'+
    '<aside id="drawer" class="drawer" aria-hidden="true"><div class="drawer-title"><div><small>E8 Helper</small><strong>'+esc(currentName)+'</strong></div><button id="closeMenu" class="close">×</button></div>'+
    '<nav class="nav-list">'+
      '<a class="js-guild-link" data-href="overview.html" href="overview.html">Overview</a>'+
      '<a class="js-guild-link" data-href="ai.html" href="ai.html">𝑬𝟖𝐴𝑖</a>'+
      '<a class="js-guild-link" data-href="path.html" href="path.html">𝑬𝟖 Path Finder</a>'+
      '<a class="js-guild-link" data-href="emojis.html" href="emojis.html">Custom Emojis</a>'+
      '<a class="js-guild-link" data-href="support.html" href="support.html">Support</a>'+
      '<a class="js-guild-link" data-href="permissions.html" href="permissions.html">Permissions</a>'+
      '<a class="js-guild-link" data-href="schedule.html" href="schedule.html">Schedule</a>'+
      '<a class="js-guild-link" data-href="memory.html" href="memory.html">Memory & Privacy</a>'+
      '<a href="author.html">Author</a>'+
    '</nav><div class="drawer-foot"><a href="author.html">Created & developed by e8uc.</a><button id="logoutButton" class="link-button">Sign out</button></div></aside>'
  );
  document.querySelector('.nav-list a[data-href="'+page+'.html"]')?.setAttribute("aria-current","page");
}
function setNavGuild(){$$(".js-guild-link").forEach(link=>{const base=link.dataset.href||link.getAttribute("href").split("?")[0];link.href=base+guildQuery()})}
function updateHeader(){const guild=st.resources?.guild||(st.me?.guilds||[]).find(g=>String(g.id)===String(st.guildId))||{};const sw=$("#serverSwitcher");if(sw&&st.guildId){sw.classList.remove("hidden");sw.innerHTML=avatar(guild,"server-mini")+'<span>'+esc(guild.name||"Server")+"</span>";sw.onclick=()=>location.href="overview.html?choose=1"}setNavGuild()}

async function loadMe(){st.me=await api("/dashboard/api/me");return st.me}
async function botInstalled(guildId){
  try{
    const r=await api("/dashboard/api/guild/"+encodeURIComponent(guildId)+"/resources");
    return !!r.botInstalled;
  }catch{return false}
}
function stopInstallWatcher(){
  const w=stopInstallWatcher.current;
  if(!w)return;
  clearInterval(w.timer);
  window.removeEventListener("focus",w.check);
  document.removeEventListener("visibilitychange",w.onVisibility);
  stopInstallWatcher.current=null;
}
function armInstallWatcher(guildId){
  stopInstallWatcher();
  let busy=false;
  const check=async()=>{
    if(busy)return;
    busy=true;
    try{
      if(await botInstalled(guildId)){
        stopInstallWatcher();
        location.replace("overview.html?guild="+encodeURIComponent(guildId)+"&installed=1");
      }
    }finally{
      busy=false;
    }
  };
  const onVisibility=()=>{if(document.visibilityState==="visible")check()};
  const timer=setInterval(()=>{if(document.visibilityState==="visible")check()},2000);
  stopInstallWatcher.current={timer,check,onVisibility};
  window.addEventListener("focus",check);
  document.addEventListener("visibilitychange",onVisibility);
  setTimeout(check,0);
}
function showInstallForGuild(guildId){
  const guild=(st.me?.guilds||[]).find(g=>String(g.id)===String(guildId));
  $("#loading")?.classList.add("hidden");
  $("#guildPicker")?.classList.add("hidden");
  $("#overviewContent")?.classList.add("hidden");
  $("#installWait")?.classList.remove("hidden");
  if($("#installGuildName"))$("#installGuildName").textContent=guild?.name||"this server";
  if($("#installButton"))$("#installButton").textContent="Add E8 Helper to "+(guild?.name||"this server");
  armInstallWatcher(String(guildId));
}
async function startInstall(guildId=""){
  const id=String(guildId||"");
  const guild=(st.me?.guilds||[]).find(g=>String(g.id)===id);
  if(!id||!guild){
    location.href="overview.html?choose=1";
    return;
  }

  // Open synchronously from the user's tap so iOS keeps the E8 tab alive
  // while Discord opens in a separate browser/app context.
  let installWindow=null;
  try{installWindow=window.open("about:blank","_blank")}catch{}

  const button=$("#installButton");
  if(button){button.disabled=true;button.textContent="Checking E8 backend…";}
  try{
    const versionResponse=await fetch(API+"/dashboard/api/version",{cache:"no-store"});
    const versionBody=await versionResponse.json().catch(()=>({}));
    if(!versionResponse.ok||versionBody.build!==REQUIRED_WORKER_BUILD){
      throw new Error("E8 backend update is not live yet. Deploy the latest E8-Helper Worker first.");
    }

    if(button)button.textContent="Opening Discord…";
    const result=await api("/dashboard/api/install/start",{
      method:"POST",
      body:JSON.stringify({guildId:id})
    });
    if(!result.authorizeUrl)throw new Error("Discord install link is unavailable.");

    armInstallWatcher(id);
    if(installWindow&&!installWindow.closed){
      installWindow.location.href=result.authorizeUrl;
    }else{
      location.assign(result.authorizeUrl);
    }
  }catch(e){
    console.error(e);
    try{installWindow?.close()}catch{}
    if(button){button.disabled=false;button.textContent="Add E8 Helper to "+(guild.name||"this server");}
    toast(e.message||"Couldn't start the Discord install.","error");
  }
}
async function loadGuild(id){
  st.guildId=String(id);localStorage.setItem(GK,st.guildId);
  const [resources,configResponse]=await Promise.all([
    api("/dashboard/api/guild/"+st.guildId+"/resources"),
    api("/dashboard/api/guild/"+st.guildId+"/config")
  ]);
  if(!resources.botInstalled){showInstallForGuild(st.guildId);return false}
  st.resources=resources;st.openrouter=!!configResponse.openrouterConnected;
  st.config=restoreDraft(clone(configResponse.config));ensureShape();updateHeader();return true;
}
function renderGuildPicker(){
  $("#overviewContent")?.classList.add("hidden");$("#guildPicker")?.classList.remove("hidden");$("#serverSwitcher")?.classList.add("hidden");
  const grid=$("#guildGrid");if(!grid)return;grid.innerHTML="";
  for(const g of st.me?.guilds||[]){
    const b=document.createElement("button");b.className="guild-card";
    b.innerHTML=avatar(g)+'<span><strong>'+esc(g.name)+'</strong><small>'+(g.owner?"Server owner":"Can manage server")+"</small></span>";
    b.onclick=()=>{localStorage.setItem(GK,String(g.id));location.href="overview.html?guild="+encodeURIComponent(g.id)};
    grid.appendChild(b);
  }
  if(!grid.children.length)grid.innerHTML='<div class="panel empty"><strong>No manageable servers found.</strong><p>You need Manage Server permission.</p></div>';
}

function channelOptions(el,value,placeholder){if(!el)return;el.innerHTML='<option value="">'+esc(placeholder)+"</option>";for(const c of st.resources?.channels||[]){const o=document.createElement("option");o.value=c.id;o.textContent="# "+c.name;o.selected=String(c.id)===String(value||"");el.appendChild(o)}}
function roleOptions(el,value,placeholder){if(!el)return;el.innerHTML='<option value="">'+esc(placeholder)+"</option>";for(const r of st.resources?.roles||[]){if(r.managed)continue;const o=document.createElement("option");o.value=r.id;o.textContent="@"+r.name;o.selected=String(r.id)===String(value||"");el.appendChild(o)}}
function roleChip(role,on,onChange){const l=document.createElement("label");l.className="role-chip";l.innerHTML='<input type="checkbox" '+(on?"checked":"")+"><span>@"+esc(role.name)+"</span>";$("input",l).onchange=e=>onChange(e.target.checked);return l}
function minToTime(n){n=Math.max(0,Math.min(1439,Number(n)||0));return String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0")}
function timeToMin(v,f){const m=/^(\d{2}):(\d{2})$/.exec(v||"");if(!m)return f;const h=+m[1],x=+m[2];return h<24&&x<60?h*60+x:f}

function collectPage(){
  if(!st.config)return;ensureShape();
  if(page==="overview"){st.config.ai.enabled=!!$("#aiEnabled")?.checked;st.config.pathFinder.enabled=!!$("#pathEnabled")?.checked;st.config.features.aiChat=st.config.ai.enabled;st.config.features.pathFinder=st.config.pathFinder.enabled}
  if(page==="ai"&&$("#aiChannel"))st.config.ai.channelId=$("#aiChannel").value;
  if(page==="path"&&$("#pathChannel"))st.config.pathFinder.channelId=$("#pathChannel").value;
  if(page==="support"){st.config.support.channelId=$("#supportChannel")?.value||"";st.config.support.roleId=$("#supportRole")?.value||"";st.config.support.ticketUrl=$("#ticketUrl")?.value.trim()||""}
  if(page==="schedule"){st.config.ai.wakeMinute=timeToMin($("#wakeTime")?.value,840);st.config.ai.sleepMinute=timeToMin($("#sleepTime")?.value,1380);st.config.ai.timezone=$("#timeZone")?.value.trim()||"America/New_York"}
  if(page==="memory"){st.config.ai.conversationMemory=$("#conversationMemory")?.checked!==false}
}
function validation(c,strict){
  if(!c)return"Settings are not ready yet.";
  if(c.ai?.enabled&&c.pathFinder?.enabled&&c.ai.channelId&&String(c.ai.channelId)===String(c.pathFinder.channelId))return"AI Chat and Path Finder need different channels.";
  if(!strict)return"";
  if(!c.ai?.enabled&&!c.pathFinder?.enabled)return"Choose AI Chat, Path Finder, or both.";
  if(c.ai?.enabled&&!c.ai.channelId)return"Choose an AI Chat channel.";
  if(c.ai?.enabled&&c.ai.provider==="openrouter"&&!st.openrouter)return"Connect OpenRouter before finishing AI Chat setup.";
  if(c.pathFinder?.enabled&&!c.pathFinder.channelId)return"Choose a Path Finder channel.";
  if((c.customEmojis||[]).some(e=>String(e.description||"").trim().length<4))return"Each custom emoji description needs at least 4 characters.";
  return"";
}
function markChanged(){collectPage();st.revision+=1;st.dirty=true;localSave();const issue=validation(st.config,!!st.config.setupComplete);if(issue){saveState(issue,"attention");return}scheduleSave()}
function scheduleSave(delay=500){clearTimeout(st.saveTimer);saveState("Saving…","");st.saveTimer=setTimeout(()=>flushSave(false),delay)}
async function flushSave(finish=false){
  if(!st.config||!st.guildId)return;collectPage();
  if(st.saving){st.queued=true;st.queuedFinish=st.queuedFinish||finish;return}
  const wasComplete=!!st.config.setupComplete;
  if(finish){st.config.setupComplete=true;st.revision+=1;localSave()}
  const issue=validation(st.config,!!st.config.setupComplete);
  if(issue){if(finish)st.config.setupComplete=wasComplete;localSave();saveState(issue,"attention");if(finish)toast(issue,"error");return}
  const revision=st.revision,payload=clone(st.config);st.saving=true;saveState("Saving…","");
  try{
    const result=await api("/dashboard/api/guild/"+st.guildId+"/config",{method:"PUT",body:JSON.stringify(payload)});
    st.openrouter=!!result.openrouterConnected;
    if(revision===st.revision){st.config=clone(result.config);ensureShape();st.dirty=false;st.draftRestored=false;localStorage.removeItem(draftKey());saveState("Saved","saved");if(finish)toast("E8 Helper is ready for this server.","success")}
    else{st.queued=true;saveState("Saving newer changes…","")}
  }catch(e){
    console.error(e);localSave();
    if(e.body?.error==="bot_not_installed"){await startInstall(st.guildId);return}
    saveState("Not saved","error");toast(e.message||"Couldn't save your changes.","error");
  }finally{
    st.saving=false;
    if(st.queued){const nextFinish=st.queuedFinish;st.queued=false;st.queuedFinish=false;setTimeout(()=>flushSave(nextFinish),0)}
  }
}

function renderOverview(){
  $("#guildPicker")?.classList.add("hidden");$("#overviewContent")?.classList.remove("hidden");
  const g=st.resources?.guild||{};$("#guildTitle").textContent=g.name||"E8 Helper";
  $("#guildSubtitle").textContent=st.config.setupComplete?"Everything is ready. Change anything whenever you want.":"Choose at least one feature, then finish setup.";
  $("#aiEnabled").checked=!!st.config.ai.enabled;$("#pathEnabled").checked=!!st.config.pathFinder.enabled;
  $("#finishSetup").textContent=st.config.setupComplete?"Save setup":"Finish setup";saveState(st.config.setupComplete?"Saved":"Draft saved","saved");
}
function renderAI(){
  channelOptions($("#aiChannel"),st.config.ai.channelId,"Choose an AI Chat channel");
  $("#openrouterStatus").textContent=st.openrouter?"Connected":"Not connected";$("#openrouterStatus").classList.toggle("good",st.openrouter);
  $("#connectOpenRouter").textContent=st.openrouter?"Reconnect OpenRouter":"Continue with OpenRouter";saveState("Saved","saved");
}
function renderPathRoles(){
  const roleMode=st.config.pathFinder.access==="roles";
  $("#pathEveryone")?.classList.toggle("active",!roleMode);$("#pathRoles")?.classList.toggle("active",roleMode);
  const box=$("#pathRoleList");if(!box)return;box.classList.toggle("hidden",!roleMode);box.innerHTML="";if(!roleMode)return;
  const selected=new Set(st.config.pathFinder.roleIds||[]);
  for(const role of st.resources?.roles||[]){if(role.managed)continue;box.appendChild(roleChip(role,selected.has(role.id),on=>{const s=new Set(st.config.pathFinder.roleIds||[]);on?s.add(role.id):s.delete(role.id);st.config.pathFinder.roleIds=[...s];markChanged()}))}
}
function renderPath(){channelOptions($("#pathChannel"),st.config.pathFinder.channelId,"Choose a Path Finder channel");renderPathRoles();saveState("Saved","saved")}
function emojiMarkup(e){return"<"+(e.animated?"a":"")+":"+e.name+":"+e.id+">"}
function renderEmojis(){
  const box=$("#emojiList");if(!box)return;box.innerHTML="";const list=st.config.customEmojis||[];
  $("#addEmoji").textContent=list.length?"Add another custom emoji":"Add custom emoji";
  if(!list.length){box.innerHTML='<div class="panel empty"><strong>No custom emojis yet.</strong><p>Add one from this server and describe when E8 should use it.</p></div>';saveState("Saved","saved");return}
  for(const entry of list){
    const source=(st.resources?.emojis||[]).find(e=>String(e.id)===String(entry.id));if(!source)continue;
    const card=document.createElement("article");card.className="emoji-item panel";
    const len=String(entry.description||"").trim().length;
    card.innerHTML='<div class="emoji-identity"><img src="'+source.imageUrl+'" alt=""><div><strong>:'+esc(source.name)+':</strong><small>'+esc(emojiMarkup(source))+'</small></div></div>'+
      '<div><label class="field-label">When should E8 use this emoji?</label><textarea minlength="4" maxlength="180" rows="3" placeholder="At least 4 characters">'+esc(entry.description||"")+'</textarea>'+
      '<div class="emoji-meta"><span class="helper">Minimum 4 characters.</span><span class="char-count">'+len+'/180</span></div></div><div><button class="danger-button" type="button">Remove</button></div>';
    const ta=$("textarea",card),count=$(".char-count",card);
    ta.oninput=()=>{entry.description=ta.value.slice(0,180);count.textContent=String(entry.description.trim().length)+"/180";markChanged()};
    $(".danger-button",card).onclick=()=>{st.config.customEmojis=st.config.customEmojis.filter(x=>String(x.id)!==String(entry.id));st.revision+=1;localSave();renderEmojis();scheduleSave(100)};
    box.appendChild(card);
  }
  const issue=validation(st.config,!!st.config.setupComplete);saveState(issue||"Saved",issue?"attention":"saved");
}
function openEmojiDialog(){
  const dialog=$("#emojiDialog"),grid=$("#emojiGrid");if(!dialog||!grid)return;
  const used=new Set((st.config.customEmojis||[]).map(e=>String(e.id)));grid.innerHTML="";
  for(const e of (st.resources?.emojis||[]).filter(e=>e.available&&!used.has(String(e.id)))){
    const b=document.createElement("button");b.className="emoji-pick";b.innerHTML='<img src="'+e.imageUrl+'" alt=""><span>:'+esc(e.name)+":</span>";
    b.onclick=()=>{st.config.customEmojis.push({id:e.id,name:e.name,animated:e.animated,description:""});st.revision+=1;localSave();dialog.close();renderEmojis();saveState("Write at least 4 characters","attention")};grid.appendChild(b);
  }
  if(!grid.children.length)grid.innerHTML='<p class="empty-text">No more server emojis are available.</p>';dialog.showModal();
}
function renderSupport(){channelOptions($("#supportChannel"),st.config.support.channelId,"No support channel");roleOptions($("#supportRole"),st.config.support.roleId,"No support role");$("#ticketUrl").value=st.config.support.ticketUrl||"";saveState("Saved","saved")}
function renderPermissions(){
  const box=$("#managerRoleList");if(!box)return;box.innerHTML="";const selected=new Set(st.config.managers.roleIds||[]);
  for(const role of st.resources?.roles||[]){if(role.managed)continue;box.appendChild(roleChip(role,selected.has(role.id),on=>{const s=new Set(st.config.managers.roleIds||[]);on?s.add(role.id):s.delete(role.id);st.config.managers.roleIds=[...s];markChanged()}))}
  saveState("Saved","saved");
}
function renderSchedule(){
  if(!st.config.setupComplete&&st.config.ai.timezone==="America/New_York"){const z=Intl.DateTimeFormat().resolvedOptions().timeZone;if(z)st.config.ai.timezone=z}
  $("#wakeTime").value=minToTime(st.config.ai.wakeMinute??840);$("#sleepTime").value=minToTime(st.config.ai.sleepMinute??1380);$("#timeZone").value=st.config.ai.timezone||"America/New_York";saveState("Saved","saved");
}
function renderMemory(){$("#conversationMemory").checked=st.config.ai.conversationMemory!==false;saveState(st.dirty?"Draft saved on this device":"Saved",st.dirty?"attention":"saved")}
function renderCurrent(){
  if(page==="overview")renderOverview();
  if(page==="ai")renderAI();
  if(page==="path")renderPath();
  if(page==="emojis")renderEmojis();
  if(page==="support")renderSupport();
  if(page==="permissions")renderPermissions();
  if(page==="schedule")renderSchedule();
  if(page==="memory")renderMemory();
}
async function connectOpenRouter(){
  localSave();
  try{const r=await api("/dashboard/api/guild/"+st.guildId+"/openrouter/start",{method:"POST"});if(r.connected){st.openrouter=true;renderAI();return}openWeb(r.authorizeUrl)}catch(e){toast(e.message||"Couldn't connect OpenRouter.","error")}
}
async function logout(){try{if(st.token)await api("/dashboard/api/logout",{method:"POST"})}catch{}localStorage.removeItem(SK);localStorage.removeItem(GK);location.href="./"}

function bindLanding(){
  $$(".js-start").forEach(b=>b.addEventListener("click",login));
  $("#menuButton")?.addEventListener("click",()=>drawer(true));$("#closeMenu")?.addEventListener("click",()=>drawer(false));$("#backdrop")?.addEventListener("click",()=>drawer(false));
}
function reveal(){const items=$$(".reveal");if(!("IntersectionObserver"in window)){items.forEach(x=>x.classList.add("visible"));return}const o=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("visible");o.unobserve(e.target)}}),{threshold:.12});items.forEach(x=>o.observe(x))}
function bindDashboard(){
  $("#menuButton")?.addEventListener("click",()=>drawer(true));$("#closeMenu")?.addEventListener("click",()=>drawer(false));$("#backdrop")?.addEventListener("click",()=>drawer(false));$("#logoutButton")?.addEventListener("click",logout);$("#installButton")?.addEventListener("click",()=>startInstall(st.guildId||""));$("#changeInstallServer")?.addEventListener("click",()=>location.href="overview.html?choose=1");
  $("#aiEnabled")?.addEventListener("change",markChanged);$("#pathEnabled")?.addEventListener("change",markChanged);$("#finishSetup")?.addEventListener("click",()=>flushSave(true));
  $("#connectOpenRouter")?.addEventListener("click",connectOpenRouter);$("#aiChannel")?.addEventListener("change",()=>{if($("#aiChannel").value&&$("#aiChannel").value===$("#pathChannel")?.value){$("#aiChannel").value="";toast("AI Chat and Path Finder need different rooms.","error")}markChanged()});
  $("#pathChannel")?.addEventListener("change",()=>{if($("#pathChannel").value&&$("#pathChannel").value===$("#aiChannel")?.value){$("#pathChannel").value="";toast("AI Chat and Path Finder need different rooms.","error")}markChanged()});
  $("#pathEveryone")?.addEventListener("click",()=>{st.config.pathFinder.access="everyone";st.config.pathFinder.roleIds=[];renderPathRoles();markChanged()});
  $("#pathRoles")?.addEventListener("click",()=>{st.config.pathFinder.access="roles";renderPathRoles();markChanged()});
  $("#addEmoji")?.addEventListener("click",openEmojiDialog);$("#closeEmoji")?.addEventListener("click",()=>$("#emojiDialog")?.close());
  ["supportChannel","supportRole","conversationMemory"].forEach(id=>$("#"+id)?.addEventListener("change",markChanged));
  ["ticketUrl","wakeTime","sleepTime","timeZone"].forEach(id=>{const e=$("#"+id);e?.addEventListener("change",markChanged);e?.addEventListener("input",markChanged)});
  $(".js-guild-link").forEach(link=>link.addEventListener("click",async e=>{if(!st.dirty&&!st.saving)return;e.preventDefault();const href=link.href;clearTimeout(st.saveTimer);try{await flushSave(false)}catch{}location.href=href}));
  document.addEventListener("keydown",e=>{if(e.key==="Escape")drawer(false)});
}
async function bootLanding(){
  bindLanding();reveal();
  const hash=new URLSearchParams(location.hash.slice(1)),session=hash.get("session");
  if(session){localStorage.setItem(SK,session);history.replaceState(null,"",location.pathname+location.search);st.token=session;try{await loadMe()}catch(e){console.error(e);toast("Discord sign in could not be completed.","error")}}
  const q=new URLSearchParams(location.search);if(q.get("login")==="cancelled")toast("Discord sign in cancelled.");
}
async function bootDashboard(){
  injectShell();bindDashboard();
  const hash=new URLSearchParams(location.hash.slice(1)),session=hash.get("session");
  if(session){
    localStorage.setItem(SK,session);
    history.replaceState(null,"",location.pathname+location.search);
  }
  st.token=session||localStorage.getItem(SK)||"";
  if(!st.token){$("#loading")?.classList.add("hidden");$("#authRequired")?.classList.remove("hidden");$("#signInAgain")?.addEventListener("click",login);return}
  try{await loadMe()}catch{localStorage.removeItem(SK);$("#loading")?.classList.add("hidden");$("#authRequired")?.classList.remove("hidden");$("#signInAgain")?.addEventListener("click",login);return}
  const q=new URLSearchParams(location.search);
  if(page==="overview"&&q.get("install")==="1"){
    localStorage.removeItem(GK);
  }
  if(page==="overview"&&(q.get("install")==="1"||q.get("choose")==="1"||(!q.get("guild")&&!localStorage.getItem(GK)))){$("#loading")?.classList.add("hidden");renderGuildPicker();return}
  const guild=q.get("guild")||localStorage.getItem(GK);
  if(!guild){location.replace("overview.html?choose=1");return}
  try{
    const ok=await loadGuild(guild);if(!ok)return;
    $("#loading")?.classList.add("hidden");$("#pageContent")?.classList.remove("hidden");
    renderCurrent();
    if(st.draftRestored){saveState("Draft restored","attention");const issue=validation(st.config,!!st.config.setupComplete);if(!issue)scheduleSave(50)}
    if(q.get("installed")==="1")toast("E8 Helper added. Finish the setup.","success");
    if(q.get("openrouter")==="connected")toast("OpenRouter connected.","success");
    if(q.get("install")==="cancelled")toast("Bot install cancelled.");
  }catch(e){console.error(e);$("#loading")?.classList.add("hidden");toast(e.message||"Couldn't open this server.","error")}
}
if(page==="landing")bootLanding();else bootDashboard();
