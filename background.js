/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
var background=(function(){
function wxt(m){return m==null||typeof m==`function`?{main:m}:m}
var api=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome;

var PAGES=[`summary`,`actions`,`action_usages`,`pages`,`filter_items`,`sv_filter_items`,`sv_views`,`sv_line_items`,`sv_screens`,`sv_actions`,`workspace`,`workspace_all`,`process_steps`,`modules`,`line_items`,`lists`,`revisions`,`lock_monitor`,`page_line_items`,`delete_line_items`],
    MAX_AGE=216e5,        // 6h - cached results older than this are re-gathered automatically
    RETRY_TICKS=200,      // ~2s of 10ms retries while the side panel registers its listener
    FIRST_SIGN=15e3,      // a triggered run has this long to show its first sign of life
    QUIET_SIGN=5e3,       // ...or this long for Summary, which the panel retries itself
    STALL=24e4,           // ...and this long between progress ticks once it is under way
    UNSURE_TRIES=8,       // re-asks before a tab that cannot name its model is shown as none
    UNSURE_EVERY=15e2,    // ...this far apart
    DELIVER_TRIES=6,      // re-sends to the panel's own tab before its script is called missing
    DELIVER_EVERY=1e3,    // ...this far apart
    // Reports switched off: opening every saved view makes Anaplan evaluate its
    // filters, which takes tens of minutes on a large model. Keep in step with
    // `off` in VIEWS (sidepanel.js) and REPORTS (chunks/summary.js).
    OFF=new Set([`sv_filter_items`,`sv_line_items`]),
    // Runs that go on until stopped (the Lock Monitor): Stop is how they end,
    // so their result after an ia_cancel is the report, not a late leftover.
    // Delete Line Items too: Stop ends a delete between batches, and what it
    // did delete must still be reported.
    LIVE=new Set([`lock_monitor`,`delete_line_items`]),
    // Reports a delete makes out of date, dropped from the cache once it has
    // deleted anything (they are read off the model's structure).
    DL_STALE=[`line_items`,`modules`,`page_line_items`,`filter_items`];

// Page Line Items' picker requests waiting for their page list (ia_pg_list).
// Delete Line Items: when each run's report was last kept mid-run (ia_live).
var dlKept=new Map();
var pgWaits=new Map(),pgSeq=0,
    PG_START=8e3,         // the tab has this long to say a report engine took the request
    PG_MAX=15e4;          // ...and this long to send the list (model context wait + one /pages call)

// Results are cached per page *and* per model, so switching model never shows stale data.
// storage.session survives service-worker restarts and is dropped when the browser closes.
var store=api.storage?.session||api.storage?.local,
    mem=new Map(),        // cacheId -> {data, ts}
    keyByTab=new Map(),   // tabId -> model key, learned from the content script
    busy=new Set(),       // runs (rid: tab|page) currently gathering
    pushes=new Map(),     // tag -> interval id of an in-flight push
    route=null,           // {tabId, windowId} the panel is bound to
    lastKey=null,         // most recent model key, so the cache stays readable with no tab open
    prog=new Map(),       // rid -> [{step,detail,i,n,done}] for the run in flight
    waits=new Map(),      // rid -> watchdog for a run that never reports back
    seqN=0,               // monotonic, so the panel can drop an out-of-order push
    pendingSelect=null,   // {tab,page}: view to select when that tab's panel finishes loading
    stopped=new Set(),    // rids whose run was stopped - late results/progress are dropped
    sawShell=!1,          // the shell has talked to us, so a failed open() is harmless
    shownKey=null,        // model key last announced for the tab in front
    shownTab=null,        // ...and that tab
    ctxSeq=0;             // latest context check wins

// Item count of a cached report: an array's length, or for an object of
// arrays (the Actions view) the length of each.
function sizeOf(d){
  if(Array.isArray(d))return d.length;
  if(!d||typeof d!=`object`)return null;
  let o={};
  for(let k of Object.keys(d))Array.isArray(d[k])&&(o[k]=d[k].length);
  return o
}

function cacheId(page,key){return `ia:${page}:${key||`-`}`}
async function cacheGet(page,key){
  let id=cacheId(page,key),hit=mem.get(id);
  if(!hit&&store){try{hit=await unpack((await store.get(id))?.[id])}catch(e){hit=null}}
  if(!hit)return null;
  if(Date.now()-hit.ts>MAX_AGE){cacheDrop(page,key);return null}
  return mem.set(id,hit),hit
}
async function cacheSet(page,key,data){
  let hit={data,ts:Date.now()},id=cacheId(page,key);
  mem.set(id,hit);
  if(store){
    let rec;
    try{rec={...await pack(data),ts:hit.ts}}catch(e){rec=hit}
    try{await store.set({[id]:rec})}
    catch(e){if(await evict(id,rec)){try{await store.set({[id]:rec})}catch(e2){}}}   // still over quota: memory only
  }
  return hit
}

// storage.session holds 10 MB in all. Line Items on a large model (every
// formula) is more than that on its own: the write failed silently, the report
// lived only in memory, and the worker idling out (~30s) took it with it - the
// view had shown it, but Summary called it "Not loaded" minutes later and the
// next visit had to gather again. Anything over ZIP_AT is stored gzipped as
// base64 (formulas shrink several times over); mem keeps the plain object.
var ZIP_AT=32e3;
function b64(u){let s=``;for(let i=0;i<u.length;i+=32768)s+=String.fromCharCode.apply(null,u.subarray(i,i+32768));return btoa(s)}
async function pack(data){
  let s=JSON.stringify(data);
  if(s.length<ZIP_AT||typeof CompressionStream!=`function`)return{data};
  let b=await new Response(new Blob([s]).stream().pipeThrough(new CompressionStream(`gzip`))).arrayBuffer();
  return{z:b64(new Uint8Array(b))}
}
async function unpack(rec){
  if(!rec||rec.z==null)return rec||null;
  let bin=atob(rec.z),u=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
  let s=await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream(`gzip`))).text();
  return{data:JSON.parse(s),ts:rec.ts}
}
// Still over quota: make room by dropping cached reports - other models' first,
// then this model's, oldest first - until there is about enough. Each can be
// gathered again; the alternative was losing the newest one outright.
async function evict(keepId,rec){
  try{
    let all=await store.get(null),need=JSON.stringify(rec).length,ts=rec.ts,
        model=keepId.slice(keepId.indexOf(`:`,3)+1),
        ids=Object.keys(all).filter(k=>k.startsWith(`ia:`)&&k!==`ia:key`&&k!==keepId&&all[k]&&all[k].ts<=ts)
          .sort((a,b)=>(a.endsWith(`:`+model)-b.endsWith(`:`+model))||all[a].ts-all[b].ts),
        drop=[],freed=0;
    // This model's reports leave storage only: memory still serves them while
    // the worker lives. Deleting them from memory too used to leave the panel
    // calling a report loaded that nothing could serve any more.
    for(let k of ids){drop.push(k);k.endsWith(`:`+model)||mem.delete(k);freed+=JSON.stringify(all[k]).length;if(freed>need+1e6)break}
    return drop.length?(await store.remove(drop),!0):!1
  }catch(e){return!1}
}
function cacheDrop(page,key){
  let id=cacheId(page,key);
  mem.delete(id),store&&store.remove(id).catch(()=>{})
}

// The side panel and the pages it hosts are extension pages, so they are reached
// with runtime.sendMessage rather than tabs.sendMessage. Retry until one listens.
//
// runtime.sendMessage reaches every extension page, and on Chrome each tab has
// its own panel (panelFor), alive while hidden. Pushes used to reach them all:
// a failed run in one tab put its error page over another tab's report, and
// one tab's data could render in another's views. So every push names the
// Anaplan tab it is for in `to`, and each panel and view (chunks/view_tab.js)
// drops what is not for its own tab. A panel says which tab it is in with
// `forTab` on its requests; Firefox's per-window sidebar sends none and hears all.
function push(msg,tag){
  let k=msg.type+(tag||``)+`@`+(msg.to??``),prev=pushes.get(k);
  prev&&clearInterval(prev);
  let n=0,id=0;
  id=setInterval(()=>{
    n++;
    api.runtime.sendMessage(msg).then(()=>{clearInterval(id),pushes.get(k)===id&&pushes.delete(k)}).catch(err=>{
      if(err?.message?.includes(`Receiving end does not exist`)&&n<=RETRY_TICKS)return;
      clearInterval(id),pushes.get(k)===id&&pushes.delete(k)
    })
  },10);
  pushes.set(k,id)
}

// api.tabs.get() resolves for *any* surviving tab, so a remembered id that has
// since navigated elsewhere - or was captured from the wrong tab - would be
// trusted forever, wedging every view. Confirm the URL, not just that the tab
// is still there. onRemoved only covers the tab being closed.
var ANAPLAN_URL=/^https:\/\/[^\/]*\.anaplan\.com\//i;
async function anaplanTab(skipId){
  if(route?.tabId===skipId)route=null;
  // The tab in front wins over the remembered one. With several Anaplan tabs
  // open, the route used to stay on whichever tab was found first, so switching
  // to another model's tab and pressing refresh still re-read the old model.
  try{
    let [t]=await api.tabs.query({active:!0,lastFocusedWindow:!0});
    if(t&&t.id!==skipId&&ANAPLAN_URL.test(t.url||``))return route={tabId:t.id,windowId:t.windowId,front:!0},t.id
  }catch(e){}
  if(route?.tabId!=null){
    try{let t=await api.tabs.get(route.tabId);if(ANAPLAN_URL.test(t?.url||``))return route.tabId}catch(e){}
    route=null
  }
  try{
    let tabs=(await api.tabs.query({url:`https://*.anaplan.com/*`})).filter(t=>t.id!==skipId),
        tab=tabs.find(t=>t.active)||tabs[0];
    if(tab)return route={tabId:tab.id,windowId:tab.windowId},tab.id
  }catch(e){}
  return null
}

// Only a tab with no content script in it is a failure. The channel closing
// unanswered is not - the gather outlives it by design - so react to the
// "no receiving end" error alone and let the watchdog cover a silent run.
function deliver(tabId,trigger){
  return api.tabs.sendMessage(tabId,trigger)
    .then(()=>!1,e=>/Receiving end does not exist|Could not establish connection/i.test(e?.message||``))
}

// Which model the cache is keyed on. The content script tells us on every run;
// after a worker restart we have to ask it.
async function modelKey(tabId){
  if(tabId!=null){
    let known=keyByTab.get(tabId);
    if(known!=null)return known;
    try{
      let key=await api.tabs.sendMessage(tabId,{type:`model_key`});
      if(typeof key==`string`&&key)return keyByTab.set(tabId,key),rememberKey(key),key
    }catch(e){}
    /* The page couldn't name its model in time - its answer is "" after 3s,
       which is what a busy model gives. That "" used to be cached and used:
       stopping the Lock Monitor during a busy spell (after Anaplan had changed
       the tab's URL, which drops keyByTab) looked the saved run up under no
       model and called it "no longer cached". The new UX URL names the model
       (customers/<c>/…/models/<m>), so use that, the same key the page gives,
       and don't cache it - the page's own answer wins once it can give one. */
    try{let ids=lkIds((await api.tabs.get(tabId))?.url);if(ids&&ids.c)return `${ids.c}:${ids.m}`}catch(e){}
  }
  // A tab that cannot name its model yet is still loading one - possibly not the
  // last model we saw, so falling back to lastKey there showed the previous
  // model's reports for the new one. Only with no Anaplan tab at all is the
  // last model the right answer, so results stay readable after it is closed.
  if(tabId!=null)return ``;
  if(lastKey==null&&store){try{lastKey=(await store.get(`ia:key`))?.[`ia:key`]??null}catch(e){}}
  return lastKey??``
}
function rememberKey(key){
  lastKey=key,store&&store.set({[`ia:key`]:key}).catch(()=>{})
}

// Tell the panel when the model in front changes - a tab switch, a window
// switch, a navigation to another model, or a loading tab finally naming its
// model. The panel then re-syncs from ia_status, so every view shows the new
// model's cached reports (or Get data) instead of the previous model's.
//
// A tab that cannot name its model yet (an Anaplan page switch reloads the
// model frame, so for a moment nothing answers) used to be announced as the
// empty model, and announced again once the frame came back - every view was
// dropped and rebuilt twice for a page switch that never changed the model.
// Keep showing what is on screen and re-ask a few times; only a model that
// stays unnamed is announced as such.
var unsure=0;         // timer re-asking a tab that cannot name its model yet
async function announce(tries){
  if(!sawShell)return;
  clearTimeout(unsure),unsure=0;
  let n=++ctxSeq,tab=await anaplanTab(),key=await modelKey(tab);
  if(n!==ctxSeq)return;
  tries=tries|0;
  if(key===``&&tab!=null&&tries<UNSURE_TRIES){unsure=setTimeout(()=>announce(tries+1),UNSURE_EVERY);return}
  if(tab===shownTab&&key===shownKey)return;
  shownTab=tab,shownKey=key,push({type:`ia_context`,key,to:tab})
}
// The content script names a tab's model on every run.
function learnKey(tabId,key){
  tabId!=null&&keyByTab.set(tabId,key),rememberKey(key);
  tabId===shownTab&&key!==shownKey&&announce()
}

// Chrome: the panel belongs to the tab it was opened on - it hides when
// another tab comes to the front and is back when this one does. The global
// panel is disabled in main(); each tab gets its own enabled before open().
// setOptions() is not awaited: open() must run inside the user gesture.
// Firefox has no per-tab sidebar visibility (sidebarAction is per window).
function panelFor(tabId){
  api.sidePanel.setOptions({tabId,path:`sidepanel.html`,enabled:!0}).catch(()=>{});
  return api.sidePanel.open({tabId})
}
async function openPanel(sender){
  if(api.sidePanel){
    let tabId=sender?.tab?.id;
    try{await panelFor(tabId)}
    catch(e){if(!sawShell)throw Error(`Could not open the side panel - click the extension icon.`)}
    return
  }
  if(api.sidebarAction){
    try{await api.sidebarAction.open()}
    catch(e){if(!sawShell)throw Error(`Could not open the sidebar - click the extension icon.`)}
    return
  }
  throw Error(`The side panel is not available in this browser.`)
}

// A run is one page gathered in one tab: two tabs' panels can each run the
// same report at once, and neither should see the other's spinner or result.
function rid(tab,page){return `${tab??``}|${page}`}
// The runs under way for a tab - or for every tab when none is named (Firefox).
function runsOf(tab){
  let out=[];
  for(let r of busy){
    let i=r.indexOf(`|`),t=r.slice(0,i)===``?null:+r.slice(0,i);
    (tab==null||t===tab)&&out.push({tab:t,page:r.slice(i+1)})
  }
  return out
}
// Where a request's answers go: the panel's own tab when it named one.
async function tabFor(msg){
  let t=msg?.forTab;
  if(t==null)return anaplanTab();
  try{let x=await api.tabs.get(t);if(ANAPLAN_URL.test(x?.url||``))return t}catch(e){}
  return null
}

function setBusy(tab,page,on){
  let r=rid(tab,page);
  on?(busy.add(r),prog.delete(r)):(busy.delete(r),clearWait(r)),
  push({type:`ia_busy`,page,busy:on,seq:++seqN,to:tab},page)
}

// A tab can carry a content script that never picks the trigger up - the model
// frame is still loading, or the script is orphaned by an extension reload.
// Nothing would ever clear the spinner, so give each run a window to prove it
// started; the first progress tick or result cancels it.
function armWait(tab,page,ms,why){
  let r=rid(tab,page);
  clearWait(r);
  waits.set(r,setTimeout(()=>{
    waits.delete(r);
    if(!busy.has(r))return;
    failPage(tab,page,why)
  },ms))
}

// Summary runs unattended (on panel open, retried while the model loads), so
// its failures go to the panel alone as ia_page_error. A plain `error` is
// broadcast to every view, and a report already on screen would swap its
// results for an error page each time a retry missed.
var QUIET=new Set([`summary`]);
function failPage(tab,page,message){
  setBusy(tab,page,!1),
  push(QUIET.has(page)?{type:`ia_page_error`,page,message,to:tab}:{type:`error`,message,to:tab},page)
}
function clearWait(r){let id=waits.get(r);id&&clearTimeout(id),waits.delete(r)}

// Re-arm on every tick rather than disarming for good: a run that dies partway
// through - a stalled request, a frame torn down mid-gather - used to leave the
// spinner up with nothing able to clear it. STALL sits above the content
// script's own request ceiling (90s, one retry) so only a dead run trips it.
function progAdd(tab,page,m){
  let r=rid(tab,page);
  if(!busy.has(r))return;   // a stopped run still ticking until its request aborts
  armWait(tab,page,STALL,`The gather stopped responding. Reload the Anaplan model tab, then try again.`);
  let ls=prog.get(r)||[],cur=ls[ls.length-1];
  cur&&cur.step===m.step
    ?(cur.detail=m.detail,cur.i=m.i,cur.n=m.n)
    :(cur&&(cur.done=!0),ls.push({step:m.step,detail:m.detail,i:m.i,n:m.n,done:!1}));
  prog.set(r,ls),
  push({type:`ia_progress`,page,steps:ls,seq:++seqN,to:tab},page)
}

// --- Lock Monitor ------------------------------------------------------------
//
// Asks Anaplan's Integration API for the model's status once a second:
// POST api.anaplan.com/2/0/workspaces/{w}/models/{m}/status, whose
// requestStatus.currentStep is "Open" when the model is idle and names the
// running task otherwise ("Processing ..."), with progress, tooltip and taskId.
// That is the state behind the UI's "Model is busy" banner.
//
// It runs here, not in the page: a busy model is exactly when the model page
// may never finish loading. The IDs come from the tab's URL, and nothing on
// the page is needed. Two earlier attempts read the page - the workspace
// summary call (said Unlocked, in under a second, while the model was busy)
// and the banner itself (only drawn once the page is up, and it went back to
// Available after 30s with the banner still showing).
//
// Login: only the browser's own Anaplan session is used - the session
// status call first, then the API with the page's cookies. There is no token
// or password login; if neither answers, the run stops and says so.
// Checks never overlap: a slow reply delays the next one.
var LK_API=`https://api.anaplan.com/2/0`,
    LK_EVERY=1e3,         // one check a second by default...
    LK_EVERIES=[1e3,5e3,15e3,3e4,6e4],   // ...or any of these, picked in the panel
    LK_HOURS=[.25,1,4,8,12],             // run length choices, in hours
    LK_TMO=3e4,           // ...each given this long
    LK_MAX=36e5,          // a run ends on its own after an hour unless the panel picks longer
    LK_NOTE_BUSY=3e4,     // with notifications on: say so once the model has been busy this long...
    LK_NOTE_FREE=1e4,     // ...and when it is free again after being busy at least this long
    LK_ERRS=60,           // ...or after this many failed checks in a row
    LK_SLOW=3e3,          // an "Open" reply this slow is still worth flagging
    lkRuns=new Map();     // rid -> {ac} for the run in flight (Stop aborts its request)

// The tab's URL names the model in the new UX (/workspaces/<w>/models/<m>)
// and in classic framework.jsp (?selectedWorkspaceId=…&selectedModelId=…).
function lkIds(url){
  let m=/\/workspaces\/([0-9a-f]{32})\/models\/([0-9a-f]{32})/i.exec(url||``);
  if(m)return{w:m[1],m:m[2],c:(/\/customers\/([0-9a-f]{32})/i.exec(url)||[])[1]||``};
  try{
    let q=new URL(url).searchParams,w=q.get(`selectedWorkspaceId`),mm=q.get(`selectedModelId`);
    if(w&&mm)return{w,m:mm,c:``}
  }catch(e){}
  return null
}

function lkDur(ms){let s=Math.floor(ms/1e3),h=Math.floor(s/3600),m=Math.floor(s%3600/60),p=n=>String(n).padStart(2,`0`);return(h?h+`:`+p(m):m)+`:`+p(s%60)}

// Anaplan's own words from an error reply, whichever shape it came in.
function lkSaid(j){
  let m=j&&(j.status?.message||j.statusMessage||j.message||j.error_description||j.error);
  return typeof m==`string`?m.replace(/\s+/g,` `).trim().slice(0,160):``
}

/* api.anaplan.com answers any request from an extension origin with an empty
   403 (checked with a valid token: Origin chrome-extension:// -> 403, Origin
   https://us1a.app.anaplan.com -> 200, and its preflight allows GET with an
   Authorization header from every Anaplan page). So each API call is made by
   content-scripts/api.js in the tab's top frame and goes out as the page's.
   Resolves to {status, ok, j}; a timeout or Stop rejects as AbortError. */
var lkSeq=0;
function lkFetch(tab,url,run){return lkRelay(tab,{type:`ia_lk_fetch`,url},run)}
function lkRelay(tab,m,run){
  let id=++lkSeq,
      call=api.tabs.sendMessage(tab,{...m,id,ms:LK_TMO},{frameId:0}).then(r=>{
        if(!r)throw Error(`the Anaplan tab didn't answer`);
        if(r.error){let e=Error(r.error);r.error===`timeout`&&(e.name=`AbortError`);throw e}
        let j=null;try{j=JSON.parse(r.text)}catch(e){}
        return{status:r.status,ok:r.status>=200&&r.status<300,j,base:r.base||``}
      },e=>{throw Error(/Receiving end does not exist|Could not establish/i.test(e?.message||``)
        ?`the Toolkit isn't running in that Anaplan tab yet - reload the Anaplan tab`:e?.message||String(e))});
  if(!run)return call;
  call.catch(()=>{});   // a Stop below wins the race; this one may still fail later
  run.abort=()=>api.tabs.sendMessage(tab,{type:`ia_lk_abort`,id},{frameId:0}).catch(()=>{});
  return Promise.race([call,new Promise((z,no)=>{run.kill=()=>{let e=Error(`Stopped`);e.name=`AbortError`;no(e)}})])
}

/* Session first (no token, no API). Anaplan's own client learns why the
   model is busy from jsonrpc requestType REQUEST_STATUS on its core - read
   off a HAR of a live session: {requestSerialNumber:"<client GUID>-<n>",
   requestStatusRequestCount, requestType:"REQUEST_STATUS", workspaceId,
   modelId} -> {requestStatus:{currentStep:"Open" | "Updating" |
   "Processing ...", progress, tooltip:"The system is currently processing
   change(s) by user … Submitted at 08:10 (UTC)", taskId, ...}}, the same
   fields as the Integration API. The client only asks about its own pending
   request; whether the server answers for a serial of our own (run.serial,
   a fresh GUID) with the model's real state is NOT confirmed - if the first
   answer isn't a requestStatus, the run switches to the API (run.mode). It
   goes through content-scripts/api.js, whose top frame is same-origin with
   the core, so it carries the session cookie. */
function lkSerial(){let a=new Uint8Array(16);crypto.getRandomValues(a);return [...a].map(b=>b.toString(16).padStart(2,`0`)).join(``).toUpperCase()}
async function lkRpc(tab,ids,run){
  run.serial=run.serial||lkSerial(),run.n=(run.n||0)+1;
  let r=await lkRelay(tab,{type:`ia_lk_rpc`,base:run.base||``,body:{requestSerialNumber:`${run.serial}-${run.n}`,
        requestStatusRequestCount:0,requestType:`REQUEST_STATUS`,workspaceId:ids.w,modelId:ids.m}},run);
  r.base&&(run.base=r.base);
  return r
}

// One check. `auth` is set when the API refused the login (401/403, or a
// login page instead of JSON) - the run stops and the panel says so.
async function lkProbe(tab,ids,run){
  let s={t:Date.now(),ms:0,http:0,step:``,progress:null,tooltip:``,taskId:``,type:``,err:``,status:``},keys=null,auth=!1;
  try{
    let r=null;
    if(run.mode!==`api`){
      // Session path (lkRpc). Kept once it has answered properly; on a first
      // check that doesn't, the run moves to the API for good.
      let x=null;try{x=await lkRpc(tab,ids,run)}catch(e){if(e?.name===`AbortError`||run.mode===`rpc`)throw e}
      if(x&&x.ok&&x.j&&x.j.requestStatus)run.mode=`rpc`,r=x;
      else if(run.mode===`rpc`)r=x||{status:0,ok:!1,j:null};
      else run.mode=`api`,run.rpcWhy=x?`HTTP ${x.status}${lkSaid(x.j)?` - ${lkSaid(x.j)}`:x.j&&!x.j.requestStatus?` - no requestStatus`:``}`:`no answer`
    }
    s.via=run.mode;
    if(!r){
      /* GET - checked live: POST answers 415 without a Content-Type and 405
         with one; GET gives {requestStatus:{currentStep, progress, tooltip,
         taskId, creationTime, exportTaskType, ...}}. */
      r=await lkFetch(tab,`${LK_API}/workspaces/${ids.w}/models/${ids.m}/status`,run)
    }
    s.http=r.status;
    let j=r.j;
    let said=lkSaid(j);
    /* 401 is a missing or bad login; 403 is a login Anaplan accepted that may
       not do this. */
    if(run.mode===`api`&&(r.status===401||r.status===403||(r.ok&&!j)))auth=!0,s.err=r.status===401?`Login refused (HTTP 401${said?` - ${said}`:``})`
      :r.status===403?`Forbidden (HTTP 403${said?` - ${said}`:``})`:`Anaplan's API sent a login page`;
    else if(!r.ok)s.err=`HTTP ${r.status}`+(j?.status?.message?` - ${String(j.status.message).slice(0,150)}`:``);
    else{
      let q=j.requestStatus||j.status&&typeof j.status==`object`&&j.status.requestStatus||{};
      s.step=String(q.currentStep??``).trim(),s.progress=typeof q.progress==`number`?q.progress:null,
      s.tooltip=String(q.tooltip??``).replace(/\s*\n\s*/g,` `).trim().slice(0,400),s.taskId=String(q.taskId??``),s.type=String(q.exportTaskType??``),
      run.mode===`rpc`&&run.serial&&s.taskId.startsWith(run.serial)&&(s.taskId=``),   // our own serial, not a task
      keys=[...Object.keys(j).filter(k=>k!==`requestStatus`),...Object.keys(q).map(k=>`requestStatus.`+k)]
    }
  }catch(e){
    // "Failed to fetch" alone says nothing: name the call so the report shows what was refused.
    s.err=e?.name===`AbortError`?(run.stop?`Stopped`:`no reply in ${LK_TMO/1e3}s`)
      :`Request failed (${(e?.message||String(e)).slice(0,160)}) - ${run.mode===`api`?`API model status`:`session status check`}`
  }finally{run.kill=run.abort=null}
  s.ms=Date.now()-s.t;
  // 423 / 424 are the API's "model locked" / "model offline".
  s.status=s.http===423?`Locked`:s.http===424?`Offline`:s.err?(auth?`Login refused`:`No reply`)
    :!s.step?`Unknown`   // a reply without currentStep: the view lists the fields it did hold
    :/^open\b/i.test(s.step)?(s.ms>=LK_SLOW?`Slow reply`:`Available`)   // REQUEST_STATUS echoes our serial as taskId even when open
    :/^updating\b/i.test(s.step)?`Updating`   // a change being saved - short, unlike Processing
    :/clos|unload/i.test(s.step)?`Not loaded`:`Busy`;
  return{s,keys,auth}
}

async function lkStart(msg){
  let page=`lock_monitor`,tab=await tabFor(msg);
  if(tab==null)throw Error(`Open an Anaplan model tab, then try again.`);
  let url=``,title=``;try{let x=await api.tabs.get(tab);url=x?.url||``,title=x?.title||``}catch(e){}
  let ids=lkIds(url);
  if(!ids)throw Error(`This tab's address doesn't name a model. Open the model in Anaplan, then try again.`);
  // The cache key is the content script's when it can give one (the page may
  // be stuck loading), else built from the URL the same way.
  let known=keyByTab.get(tab),key=known||(ids.c?`${ids.c}:${ids.m}`:await modelKey(tab));
  let r=rid(tab,page);
  if(lkRuns.has(r))return{ok:!0};
  stopped.delete(r),setBusy(tab,page,!0);
  // Interval and length come from the panel; anything off the lists is ignored.
  let every=LK_EVERIES.includes(+msg.every)?+msg.every:LK_EVERY,
      max=LK_HOURS.includes(+msg.hours)?+msg.hours*36e5:LK_MAX,
      run={stop:!1,every,max,notify:!!msg.notify&&!!api.notifications};
  lkRuns.set(r,run);
  ids.name=title.split(` | `)[0].trim();   // "UQJP_20260621 | Anaplan"
  // Refresh ("Continue monitoring") picks up the saved run for this model and
  // adds to it; Start (ia_load, from the empty screen) begins a new one.
  let prev=null;
  if(msg.type===`ia_refresh`){try{let h=await cacheGet(page,key);h&&Array.isArray(h.data?.samples)&&h.data.samples.length&&(prev=h.data)}catch(e){}}
  lkLoop(tab,ids,key,run,prev).catch(()=>{}).finally(()=>lkRuns.delete(r));
  return{ok:!0}
}

// Opt-in (the panel's "Notify me" asks for the permission): once a model has
// been busy LK_NOTE_BUSY, and when it is free again after LK_NOTE_FREE.
var LK_UNAVAILABLE=new Set([`Busy`,`Updating`,`Locked`,`Offline`]);
// Anaplan's "… at 08:17 (UTC)" in local time, as the view shows it.
function lkLocal(tip,at){
  return String(tip||``).replace(/\b(\d{1,2}):(\d{2})\s*\(UTC\)/g,(m,h,mi)=>{
    let d=new Date(at),u=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate(),+h,+mi);
    u>at+36e5&&(u-=864e5);
    let x=new Date(u);return String(x.getHours()).padStart(2,`0`)+`:`+String(x.getMinutes()).padStart(2,`0`)
  })
}
function lkNotify(tab,title,message){
  try{api.notifications.create(`ia-lk-${tab}`,{type:`basic`,iconUrl:`icon-128.png`,title,message:String(message||``).slice(0,250)})?.catch?.(()=>{})}catch(e){}
}

async function lkLoop(tab,ids,key,run,prev){
  /* A continued run starts from the saved one's checks; its first new check
     is marked `gap` so the view shows the time in between as not monitored.
     The run's own length (run.max) and first-check rules count from now. */
  let page=`lock_monitor`,r=rid(tab,page),S=prev?prev.samples.slice():[],keys=prev?.keys?.length?prev.keys:null,
      t0=prev?.started||Date.now(),runAt=Date.now(),fresh=0,bad=0,why=`stopped`,cur=``,
      errs=Math.max(5,Math.ceil(12e4/run.every)),   // about two minutes of failed checks in a row
      label=`Asking Anaplan for the model's status`,
      tick=d=>progAdd(tab,page,{step:label,detail:d}),
      tail=()=>`${S.length} ${S.length===1?`check`:`checks`} · ${lkDur(Date.now()-runAt)}${prev?` (continued)`:``}`,
      snap=(w,live)=>({modelName:ids.name||``,workspaceId:ids.w,modelId:ids.m,started:t0,ended:Date.now(),every:run.every,
        max:run.max,slow:LK_SLOW,why:w,live,samples:S,keys:keys||[],
        login:run.mode===`rpc`?`session`:`browser`,rpcWhy:run.rpcWhy||``}),
      lastLive=0,lastSave=Date.now(),downSince=0,toldBusy=!1;
  tick(`with your Anaplan session`);
  while(busy.has(r)&&!run.stop){
    if(Date.now()-runAt>=run.max){why=`limit`;break}
    let a=Date.now(),p=await lkProbe(tab,ids,run);
    if(run.stop||!busy.has(r))break;
    if(p.auth&&!fresh){
      // Refused on the very first check: nothing to save.
      setBusy(tab,page,!1);
      return push({type:`ia_page_error`,page,to:tab,message:
        `Anaplan didn't give this model's status to your session: its session status check didn't answer (${run.rpcWhy||`unknown`}), and its API didn't accept your browser login (${p.s.err}). Reload the Anaplan tab and try again.`},page)
    }
    prev&&!fresh&&(p.s.gap=!0);
    fresh++,S.push(p.s),keys=keys||p.keys;
    p.s.status!==cur&&(cur=p.s.status,label=`${cur} since ${new Date(p.s.t).toLocaleTimeString()}`);
    tick([p.s.step,p.s.progress>=0&&p.s.progress!=null?Math.round(p.s.progress*(p.s.progress<=1?100:1))+`%`:``,p.s.tooltip,p.s.err||`${p.s.ms} ms`,tail()].filter(Boolean).join(` · `));
    // Notifications (opt-in). A failed check neither starts nor ends a busy spell.
    if(run.notify&&!p.s.err){
      let down=LK_UNAVAILABLE.has(p.s.status),nm=ids.name||`The model`;
      if(down){
        downSince||(downSince=p.s.t,toldBusy=!1);
        !toldBusy&&p.s.t-downSince>=LK_NOTE_BUSY&&(toldBusy=!0,lkNotify(tab,`${nm} is busy`,
          `${lkDur(p.s.t-downSince)} so far. ${lkLocal(p.s.tooltip,p.s.t)||p.s.step}`))
      }else if(downSince){
        p.s.t-downSince>=LK_NOTE_FREE&&lkNotify(tab,`${nm} is available again`,`It was busy for ${lkDur(p.s.t-downSince)}.`);
        downSince=0,toldBusy=!1
      }
    }
    /* The view updates while the run goes on: a snapshot pushed straight at
       it (it is open - the panel draws its iframe while the run is busy; a
       lost push is replaced by the next). Spaced out as the run grows, since
       each carries every check. */
    if(Date.now()-lastLive>=Math.max(5e3,S.length*20))lastLive=Date.now(),push({type:`${page}_data`,data:snap(`running`,!0),to:tab},`live`);
    /* Saved as it goes: a worker the browser restarts mid-run takes the loop
       with it, but what was gathered stays cached (why "running", live false
       - the view calls it interrupted). */
    if(Date.now()-lastSave>=Math.max(1e4,S.length*10))lastSave=Date.now(),await cacheSet(page,key,snap(`running`,!1));
    bad=p.s.err?bad+1:0;
    if(p.auth){why=`auth`;break}
    if(bad>=errs){why=`errors`;break}
    let w=run.every-(Date.now()-a);
    w>0&&await new Promise(z=>{let t=setTimeout(z,w);run.kill=()=>{clearTimeout(t),z()}})
  }
  // Stopped before any check came back: nothing to save, and the panel (which
  // keeps a live view up on Stop, waiting for the saved copy) must hear so.
  if(!fresh)return busy.has(r)&&setBusy(tab,page,!1),void(prev
    ?push({type:`ia_state`,page,ts:(await cacheGet(page,key))?.ts||Date.now(),key,to:tab},page)   // the saved run stands as it was
    :push({type:`ia_page_error`,page,to:tab,message:`Stopped before the first check came back - nothing to save.`},page));
  let hit=await cacheSet(page,key,snap(why,!1));
  setBusy(tab,page,!1);
  push({type:`ia_state`,page,ts:hit.ts,key,to:tab},page)
}

async function handle(msg,sender){
  let tabId=sender?.tab?.id;

  // --- from the side panel shell ---

  if(msg.type===`ia_status`){
    sawShell=!0;
    let tab=await tabFor(msg),key=await modelKey(tab),pages={};
    for(let p of PAGES){
      let hit=await cacheGet(p,key);
      pages[p]={ts:hit?hit.ts:0,busy:busy.has(rid(tab,p)),steps:prog.get(rid(tab,p))||[]}
    }
    let select=null;
    if(pendingSelect&&(tab==null||pendingSelect.tab==null||pendingSelect.tab===tab))select=pendingSelect.page,pendingSelect=null;
    return shownTab=tab,shownKey=key,{pages,select,tab:tab!=null,key}
  }

  // Summary view: which reports are cached for this model, how big each is,
  // and whether one is gathering right now. Sizes only - never the payloads.
  if(msg.type===`ia_overview`){
    let tab=await tabFor(msg),key=await modelKey(tab),pages={};
    for(let p of PAGES){
      if(p===`summary`)continue;
      let hit=await cacheGet(p,key);
      pages[p]={ts:hit?hit.ts:0,busy:busy.has(rid(tab,p)),size:hit?sizeOf(hit.data):null}
    }
    return{pages}
  }

  // Summary's "Download all": every cached payload for this model at once.
  if(msg.type===`ia_dump`){
    let tab=await tabFor(msg),key=await modelKey(tab),pages={};
    for(let p of PAGES){
      if(p===`summary`)continue;
      let hit=await cacheGet(p,key);
      hit&&(pages[p]={data:hit.data,ts:hit.ts});
    }
    return{pages}
  }

  // The iframe for this view is up: hand it the cached payload.
  if(msg.type===`ia_serve`){
    sawShell=!0;
    let tab=await tabFor(msg),hit=await cacheGet(msg.page,await modelKey(tab));
    if(!hit)return{hit:!1};
    return push({type:`${msg.page}_data`,data:hit.data,ts:hit.ts,cached:!0,to:msg.forTab??tab},msg.page),{hit:!0,ts:hit.ts}
  }

  // Page Line Items' picker: the model's App pages (name, app, category) from
  // the report engine in the tab - one quick /pages call. The answer comes
  // back as ia_pg_list_result messages (see IA_pgList in inner.js for why not
  // sendResponse): `started` within PG_START says a report engine is there,
  // then the list itself.
  if(msg.type===`ia_pg_list`){
    let tab=await tabFor(msg);
    if(tab==null)return{error:`Open an Anaplan model tab, then try again.`};
    let id=`${Date.now()}-${++pgSeq}`,w={tab,started:!1};
    let got=new Promise(ok=>{w.done=ok}),wait=(ms,why)=>new Promise(ok=>setTimeout(()=>ok({error:why}),ms));
    pgWaits.set(id,w);
    try{
      let gone=await deliver(tab,{type:`ia_pg_list`,id});
      if(gone)return{error:`The extension is not running in that Anaplan tab yet - reload the Anaplan page, then try again.`};
      let r=await Promise.race([got,wait(PG_START,``)]);
      if(r&&r.error===``&&!w.started)return{error:`This tab has no model open for the report engine. Open the model in Anaplan (the modelling view, not only an App page), or reload the Anaplan page, then try again.`};
      if(r&&r.error===``)r=await Promise.race([got,wait(PG_MAX,`Anaplan took too long to list the pages. Try again.`)]);
      return r||{error:`The page list could not be loaded.`}
    }finally{pgWaits.delete(id)}
  }
  if(msg.type===`ia_pg_list_result`){
    let w=pgWaits.get(msg.id);
    if(!w||(tabId!=null&&tabId!==w.tab))return;
    msg.started&&(w.started=!0);
    msg.result&&w.done(msg.result);
    return
  }

  // Lock Monitor's Clear button (in its view): forget the saved run so the
  // next start is a new one. Not while it runs - Stop first.
  if(msg.type===`ia_clear`&&msg.page===`lock_monitor`){
    let tab=await tabFor(msg),key=await modelKey(tab);
    if(busy.has(rid(tab,msg.page)))return{error:`Stop the monitor first.`};
    cacheDrop(msg.page,key);
    return push({type:`ia_state`,page:msg.page,ts:0,key,to:msg.forTab??tab},msg.page),{ok:!0}
  }

  // Delete Line Items' Pause / Resume (from its report, through the panel):
  // the run waits between requests while paused. Every frame hears it; only
  // the one running the delete acts on it.
  if(msg.type===`ia_dl_pause`){
    let tab=await tabFor(msg);
    if(tab==null)return{error:`Open the Anaplan model tab, then try again.`};
    await api.tabs.sendMessage(tab,{type:`ia_dl_pause`,paused:!!msg.paused}).catch(()=>{});
    return{ok:!0}
  }

  // Stop button: end every gather under way. The worker clears the busy state
  // itself rather than waiting on the content script, so the panel frees up
  // even if the tab never answers; whatever the stopped runs send later is dropped.
  // A LIVE run (the Lock Monitor, which runs in this worker) is the
  // exception: Stop is how it ends, and what it gathered is cached as usual.
  if(msg.type===`ia_cancel`){
    sawShell=!0;
    let was=runsOf(msg.forTab),tabs=new Set(was.map(w=>w.tab));
    for(let w of was){
      let r=rid(w.tab,w.page),lk=lkRuns.get(r);
      lk&&(lk.stop=!0,lk.kill?.(),lk.abort?.());
      LIVE.has(w.page)||stopped.add(r),setBusy(w.tab,w.page,!1)
    }
    if(!tabs.size){let t=await tabFor(msg);t!=null&&tabs.add(t)}
    for(let t of tabs)t!=null&&await api.tabs.sendMessage(t,{type:`ia_cancel`}).catch(()=>{});
    return{stopped:was.map(w=>w.page)}
  }

  // "Get data" / refresh icon. ia_load uses the cache, ia_refresh bypasses it.
  if(msg.type===`ia_load`||msg.type===`ia_refresh`){
    sawShell=!0;
    if(OFF.has(msg.page))return{error:`This report is disabled - it is too slow to run on large models.`};
    if(msg.page===`lock_monitor`)return lkStart(msg);   // runs here, not in the page
    let page=msg.page,
        quiet=QUIET.has(page),
        tab=await tabFor(msg),
        front=msg.forTab!=null||!!route?.front;
    if(tab==null){let m=`Open an Anaplan model tab, then try again.`;if(quiet)return{error:m};throw Error(m)}
    stopped.delete(rid(tab,page));
    setBusy(tab,page,!0);
    let trigger={type:`trigger_${page}`,force:msg.type===`ia_refresh`},gone;
    // Page Line Items scans only the pages picked in the panel.
    if(page===`page_line_items`)trigger.pages=(Array.isArray(msg.pages)?msg.pages:[]).slice(0,1e4).map(String),trigger.sv=!!msg.sv;
    // Delete Line Items: the CSV's rows, and whether this run checks them or deletes them.
    if(page===`delete_line_items`)trigger.mode=msg.mode===`delete`?`delete`:`check`,trigger.modelId=String(msg.modelId??``),trigger.tryInUse=!!msg.tryInUse,trigger.autosave=+msg.autosave||0,trigger.rows=(Array.isArray(msg.rows)?msg.rows:[]).slice(0,2e4)
      .map(r=>({line:+r?.line||0,module:String(r?.module??``).slice(0,500),name:String(r?.name??``).slice(0,500),id:String(r?.id??``).slice(0,40)}));
    gone=await deliver(tab,trigger);
    // A tab opened moments ago has no report engine until its model frame has
    // loaded. Give it a few seconds before calling the script missing - the
    // first click in a fresh tab used to fail with "reload the page". (Summary
    // is retried by the panel itself.)
    for(let i=0;gone&&front&&!quiet&&i<DELIVER_TRIES&&busy.has(rid(tab,page));i++)
      await new Promise(r=>setTimeout(r,DELIVER_EVERY)),gone=await deliver(tab,trigger);
    if(!busy.has(rid(tab,page)))return{ok:!0};   // stopped while waiting
    // Nothing was triggered, so the tab we picked may simply have been the
    // wrong one. Drop it, resolve a different Anaplan tab and try once more
    // before giving up - a single click should heal a bad route.
    // Not when the tab is the one in front, though: that is the model being
    // looked at, and a tab whose script was orphaned by an extension reload
    // used to hand the run to some other Anaplan tab - the panel then showed
    // that other model's report as if it were this one's.
    if(gone&&!front){
      route=null;
      let alt=await anaplanTab(tab);
      if(alt!=null&&!(gone=await deliver(alt,trigger))){
        busy.delete(rid(tab,page)),busy.add(rid(alt,page)),tab=alt
      }
    }
    // The tab is right but the report engine is not in it: an extension reload
    // orphans the script in frames that were already open, and only a page
    // reload re-injects it. Say that, rather than sending them tab-hunting.
    if(gone){let m=`The extension is not running in that Anaplan tab yet - reload the Anaplan page, then try again.`;if(quiet)return setBusy(tab,page,!1),{error:m};throw setBusy(tab,page,!1),Error(m)}
    // Summary is retried by the panel, so a miss should come back fast.
    return armWait(tab,page,quiet?QUIET_SIGN:FIRST_SIGN,`The Anaplan tab did not respond. Reload the Anaplan model tab, then try again.`),{ok:!0}
  }

  // --- from the content script ---

  // Live step/loop reporting from whichever gather is running.
  if(msg.type===`ia_progress`)return void(msg.page&&progAdd(tabId,msg.page,msg));

  // A keyboard shortcut started a run: show the panel on that view right away.
  if(PAGES.includes(msg.type)){
    // Summary's runs are started by the panel itself (and retried while the
    // model loads) - selecting it each time would yank the user back to it.
    if(QUIET.has(msg.type))return void(busy.has(rid(tabId,msg.type))||setBusy(tabId,msg.type,!0));
    route={tabId:tabId??route?.tabId,windowId:sender?.tab?.windowId??route?.windowId};
    pendingSelect={tab:tabId,page:msg.type};
    stopped.delete(rid(tabId,msg.type));
    setBusy(tabId,msg.type,!0);
    await openPanel(sender);
    return void push({type:`ia_select`,page:msg.type,to:tabId})
  }

  // Cache probe. On a hit the content script skips the (expensive) Anaplan calls.
  if(msg.type===`cache_get`){
    learnKey(tabId,msg.key||``);
    let hit=await cacheGet(msg.page,msg.key);
    if(!hit)return{hit:!1};
    setBusy(tabId,msg.page,!1);
    // The panel checks `key` against the model it shows: a late hit for the
    // model this tab held before must not mark the current one's view loaded.
    push({type:`ia_state`,page:msg.page,ts:hit.ts,key:msg.key||``,to:tabId},msg.page);
    return{hit:!0,ts:hit.ts}
  }

  // Freshly gathered results. These used to be sent as <page>_data, which
  // runtime.sendMessage also delivered straight to every view iframe - so a
  // run in another tab, or a late one for the previous model, rendered over
  // the model in front. As ia_result only the worker hears them, and the
  // panel fetches the payload with ia_serve once it knows the model matches.
  if(msg.type===`ia_result`&&PAGES.includes(msg.page)){
    let page=msg.page;
    if(stopped.has(rid(tabId,page)))return;
    learnKey(tabId,msg.key||``);
    let hit=await cacheSet(page,msg.key,msg.data);
    // Cached under its own model's key. The panel drops the ia_state if that is
    // not the model it shows - it would mark the current model's view as loaded.
    setBusy(tabId,page,!1);
    // A delete changed the model: reports read off its structure no longer hold.
    if(page===`delete_line_items`&&msg.data?.deleted>0)for(let p of DL_STALE)cacheDrop(p,msg.key),push({type:`ia_state`,page:p,ts:0,key:msg.key||``,to:tabId},p);
    return void push({type:`ia_state`,page,ts:hit.ts,key:msg.key||``,to:tabId},page)
  }

  // Delete Line Items' running state, after each request it makes: shown on
  // the report straight away rather than only when the run ends. Dropped once
  // the run is no longer busy (finished or stopped) - its ia_result follows.
  if(msg.type===`ia_live`&&msg.page===`delete_line_items`){
    let r=rid(tabId,msg.page);
    if(stopped.has(r)||!busy.has(r))return;
    learnKey(tabId,msg.key||``);
    // Saved as it goes (at most once a minute), so closing the panel or losing
    // the worker mid-run keeps the report so far; the run's own result replaces it.
    if(Date.now()-(dlKept.get(r)||0)>=6e4)dlKept.set(r,Date.now()),cacheSet(msg.page,msg.key,{...msg.data,running:!1,partial:!0}).catch(()=>{});
    return void push({type:`${msg.page}_data`,data:{...msg.data,live:!0},to:tabId},`live`)
  }

  // A quiet page's own failure, reported by the content script.
  if(msg.type===`ia_page_error`){
    if(msg.page&&!stopped.has(rid(tabId,msg.page))&&busy.has(rid(tabId,msg.page)))failPage(tabId,msg.page,msg.message);
    return
  }

  // From a content script, or from a view (which names its tab in forTab).
  if(msg.type===`error`){
    let t=tabId??msg.forTab;
    for(let w of runsOf(t))setBusy(w.tab,w.page,!1);
    push({type:`error`,message:msg.message,to:t});
    return void(tabId!=null&&api.tabs.sendMessage(tabId,msg).catch(()=>{}))
  }

  // Anything else is the outer.js -> inner.js relay within one tab.
  if(tabId!=null)await api.tabs.sendMessage(tabId,msg)
}

function report(e,sender,msg){
  let message=e?.message||String(e),id=sender?.tab?.id,t=id??msg?.forTab;
  for(let w of runsOf(t))setBusy(w.tab,w.page,!1);
  push({type:`error`,message,to:t});
  id!=null&&api.tabs.sendMessage(id,{type:`error`,message}).catch(()=>{})
}

function onMessage(msg,sender,respond){
  handle(msg,sender).then(
    r=>{try{respond(r)}catch(e){}},
    e=>{try{respond({error:e?.message})}catch(e2){}report(e,sender,msg)}
  );
  return !0   // keep the channel open for the async respond()
}

var main=wxt(()=>{
  // Clicking the toolbar icon opens the panel directly - there is no popup.
  // On Chrome it opens for that tab only (see panelFor), so the browser's own
  // openPanelOnActionClick - which opens the global panel - is turned off.
  if(api.sidePanel){
    api.sidePanel.setPanelBehavior?.({openPanelOnActionClick:!1})?.catch?.(()=>{});
    api.sidePanel.setOptions({enabled:!1}).catch(()=>{});
    api.action?.onClicked?.addListener(t=>{t?.id!=null&&panelFor(t.id).catch(()=>{})})
  }
  // Firefox has no openPanelOnActionClick equivalent: wire the toolbar icon
  // to the sidebar directly. (No-op on Chrome, which already opened above.)
  if(!api.sidePanel&&api.sidebarAction)api.action?.onClicked?.addListener(()=>{try{api.sidebarAction.toggle()}catch(e){}});
  api.runtime.onMessage.addListener(onMessage);
  api.tabs.onRemoved.addListener(id=>{
    keyByTab.delete(id),route?.tabId===id&&(route=null);
    // Its panel went with it: forget its runs without telling anyone.
    for(let w of runsOf(id)){let r=rid(id,w.page);busy.delete(r),clearWait(r),prog.delete(r),stopped.delete(r)}
    announce()
  });
  // A tab that navigates may now hold a different model: forget what it held.
  api.tabs.onUpdated.addListener((id,ch)=>{
    if(ch.url)keyByTab.delete(id);
    (ch.url||ch.status===`complete`)&&announce()
  });
  api.tabs.onActivated.addListener(()=>announce());
  api.windows?.onFocusChanged?.addListener(w=>{w!==api.windows.WINDOW_ID_NONE&&announce()})
});

var log={debug:(...e)=>([...e],void 0),log:(...e)=>([...e],void 0),warn:(...e)=>([...e],void 0),error:(...e)=>([...e],void 0)},res;
try{res=main.main(),res instanceof Promise&&console.warn(`The background's main() function return a promise, but it must be synchronous`)}catch(e){throw log.error(`The background crashed on startup!`),e}
return res})();
