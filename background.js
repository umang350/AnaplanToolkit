/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
var background=(function(){
function wxt(m){return m==null||typeof m==`function`?{main:m}:m}
var api=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome;

var PAGES=[`summary`,`actions`,`action_usages`,`pages`,`filter_items`,`sv_filter_items`,`sv_views`,`sv_line_items`,`sv_screens`,`sv_actions`,`workspace`,`workspace_all`,`process_steps`,`modules`,`line_items`,`lists`,`revisions`],
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
    OFF=new Set([`sv_filter_items`,`sv_line_items`]);

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
      if(typeof key==`string`)return keyByTab.set(tabId,key),rememberKey(key),key
    }catch(e){}
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

  // Stop button: end every gather under way. The worker clears the busy state
  // itself rather than waiting on the content script, so the panel frees up
  // even if the tab never answers; whatever the stopped runs send later is dropped.
  if(msg.type===`ia_cancel`){
    sawShell=!0;
    let was=runsOf(msg.forTab),tabs=new Set(was.map(w=>w.tab));
    for(let w of was)stopped.add(rid(w.tab,w.page)),setBusy(w.tab,w.page,!1);
    if(!tabs.size){let t=await tabFor(msg);t!=null&&tabs.add(t)}
    for(let t of tabs)t!=null&&await api.tabs.sendMessage(t,{type:`ia_cancel`}).catch(()=>{});
    return{stopped:was.map(w=>w.page)}
  }

  // "Get data" / refresh icon. ia_load uses the cache, ia_refresh bypasses it.
  if(msg.type===`ia_load`||msg.type===`ia_refresh`){
    sawShell=!0;
    if(OFF.has(msg.page))return{error:`This report is disabled - it is too slow to run on large models.`};
    let page=msg.page,
        quiet=QUIET.has(page),
        tab=await tabFor(msg),
        front=msg.forTab!=null||!!route?.front;
    if(tab==null){let m=`Open an Anaplan model tab, then try again.`;if(quiet)return{error:m};throw Error(m)}
    stopped.delete(rid(tab,page));
    setBusy(tab,page,!0);
    let trigger={type:`trigger_${page}`,force:msg.type===`ia_refresh`},
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
    return void push({type:`ia_state`,page,ts:hit.ts,key:msg.key||``,to:tabId},page)
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
