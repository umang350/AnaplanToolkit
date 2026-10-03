/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
var background=(function(){
function wxt(m){return m==null||typeof m==`function`?{main:m}:m}
var api=globalThis.browser?.runtime?.id?globalThis.browser:globalThis.chrome;

var PAGES=[`summary`,`actions`,`action_usages`,`pages`,`filter_items`,`sv_filter_items`,`sv_views`,`sv_line_items`,`sv_screens`,`sv_actions`],
    MAX_AGE=216e5,        // 6h - cached results older than this are re-gathered automatically
    RETRY_TICKS=200,      // ~2s of 10ms retries while the side panel registers its listener
    FIRST_SIGN=15e3,      // a triggered run has this long to show its first sign of life
    QUIET_SIGN=5e3,       // ...or this long for Summary, which the panel retries itself
    STALL=24e4,           // ...and this long between progress ticks once it is under way
    // Reports switched off: opening every saved view makes Anaplan evaluate its
    // filters, which takes tens of minutes on a large model. Keep in step with
    // `off` in VIEWS (sidepanel.js) and REPORTS (chunks/summary.js).
    OFF=new Set([`sv_filter_items`,`sv_line_items`]);

// Results are cached per page *and* per model, so switching model never shows stale data.
// storage.session survives service-worker restarts and is dropped when the browser closes.
var store=api.storage?.session||api.storage?.local,
    mem=new Map(),        // cacheId -> {data, ts}
    keyByTab=new Map(),   // tabId -> model key, learned from the content script
    busy=new Set(),       // pages currently gathering
    pushes=new Map(),     // tag -> interval id of an in-flight push
    route=null,           // {tabId, windowId} the panel is bound to
    lastKey=null,         // most recent model key, so the cache stays readable with no tab open
    prog=new Map(),       // page -> [{step,detail,i,n,done}] for the run in flight
    waits=new Map(),      // page -> watchdog for a run that never reports back
    seqN=0,               // monotonic, so the panel can drop an out-of-order push
    pendingSelect=null,   // view to select when the panel finishes loading
    stopped=new Set(),    // pages whose run was stopped - late results/progress are dropped
    sawShell=!1,          // the shell has talked to us, so a failed open() is harmless
    shownKey=null,        // model key the panel is currently showing
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
  if(!hit&&store){try{hit=(await store.get(id))?.[id]}catch(e){}}
  if(!hit)return null;
  if(Date.now()-hit.ts>MAX_AGE){cacheDrop(page,key);return null}
  return mem.set(id,hit),hit
}
async function cacheSet(page,key,data){
  let hit={data,ts:Date.now()},id=cacheId(page,key);
  mem.set(id,hit);
  if(store){try{await store.set({[id]:hit})}catch(e){}}   // over quota: keep it in memory only
  return hit
}
function cacheDrop(page,key){
  let id=cacheId(page,key);
  mem.delete(id),store&&store.remove(id).catch(()=>{})
}

// The side panel and the pages it hosts are extension pages, so they are reached
// with runtime.sendMessage rather than tabs.sendMessage. Retry until one listens.
function push(msg,tag){
  let k=msg.type+(tag||``),prev=pushes.get(k);
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
async function announce(){
  if(!sawShell)return;
  let n=++ctxSeq,key=await modelKey(await anaplanTab());
  if(n!==ctxSeq||key===shownKey)return;
  shownKey=key,push({type:`ia_context`,key})
}
// The content script names a tab's model on every run.
function learnKey(tabId,key){
  tabId!=null&&keyByTab.set(tabId,key),rememberKey(key);
  route?.tabId===tabId&&key!==shownKey&&announce()
}

// One panel per window, so the same document stays put while tabs change.
// Chrome exposes this as a per-tab/per-window side panel; Firefox has no
// equivalent API and offers sidebarAction (per-window only) instead.
async function openPanel(sender){
  if(api.sidePanel){
    let windowId=sender?.tab?.windowId,tabId=sender?.tab?.id;
    try{await api.sidePanel.open(windowId!=null?{windowId}:{tabId})}
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

function setBusy(page,on){
  on?(busy.add(page),prog.delete(page)):(busy.delete(page),clearWait(page)),
  push({type:`ia_busy`,page,busy:on,seq:++seqN},page)
}

// A tab can carry a content script that never picks the trigger up - the model
// frame is still loading, or the script is orphaned by an extension reload.
// Nothing would ever clear the spinner, so give each run a window to prove it
// started; the first progress tick or result cancels it.
function armWait(page,ms,why){
  clearWait(page);
  waits.set(page,setTimeout(()=>{
    waits.delete(page);
    if(!busy.has(page))return;
    failPage(page,why)
  },ms))
}

// Summary runs unattended (on panel open, retried while the model loads), so
// its failures go to the panel alone as ia_page_error. A plain `error` is
// broadcast to every view, and a report already on screen would swap its
// results for an error page each time a retry missed.
var QUIET=new Set([`summary`]);
function failPage(page,message){
  setBusy(page,!1),
  push(QUIET.has(page)?{type:`ia_page_error`,page,message}:{type:`error`,message},page)
}
function clearWait(page){let id=waits.get(page);id&&clearTimeout(id),waits.delete(page)}

// Re-arm on every tick rather than disarming for good: a run that dies partway
// through - a stalled request, a frame torn down mid-gather - used to leave the
// spinner up with nothing able to clear it. STALL sits above the content
// script's own request ceiling (90s, one retry) so only a dead run trips it.
function progAdd(page,m){
  if(!busy.has(page))return;   // a stopped run still ticking until its request aborts
  armWait(page,STALL,`The gather stopped responding. Reload the Anaplan model tab, then try again.`);
  let ls=prog.get(page)||[],cur=ls[ls.length-1];
  cur&&cur.step===m.step
    ?(cur.detail=m.detail,cur.i=m.i,cur.n=m.n)
    :(cur&&(cur.done=!0),ls.push({step:m.step,detail:m.detail,i:m.i,n:m.n,done:!1}));
  prog.set(page,ls),
  push({type:`ia_progress`,page,steps:ls,seq:++seqN},page)
}

async function handle(msg,sender){
  let tabId=sender?.tab?.id;

  // --- from the side panel shell ---

  if(msg.type===`ia_status`){
    sawShell=!0;
    let tab=await anaplanTab(),key=await modelKey(tab),pages={};
    for(let p of PAGES){
      let hit=await cacheGet(p,key);
      pages[p]={ts:hit?hit.ts:0,busy:busy.has(p),steps:prog.get(p)||[]}
    }
    let select=pendingSelect;
    return shownKey=key,pendingSelect=null,{pages,select,tab:tab!=null,key}
  }

  // Summary view: which reports are cached for this model, how big each is,
  // and whether one is gathering right now. Sizes only - never the payloads.
  if(msg.type===`ia_overview`){
    let key=await modelKey(await anaplanTab()),pages={};
    for(let p of PAGES){
      if(p===`summary`)continue;
      let hit=await cacheGet(p,key);
      pages[p]={ts:hit?hit.ts:0,busy:busy.has(p),size:hit?sizeOf(hit.data):null}
    }
    return{pages}
  }

  // The iframe for this view is up: hand it the cached payload.
  if(msg.type===`ia_serve`){
    sawShell=!0;
    let hit=await cacheGet(msg.page,await modelKey(await anaplanTab()));
    if(!hit)return{hit:!1};
    return push({type:`${msg.page}_data`,data:hit.data,ts:hit.ts,cached:!0},msg.page),{hit:!0,ts:hit.ts}
  }

  // Stop button: end every gather under way. The worker clears the busy state
  // itself rather than waiting on the content script, so the panel frees up
  // even if the tab never answers; whatever the stopped runs send later is dropped.
  if(msg.type===`ia_cancel`){
    sawShell=!0;
    let was=[...busy];
    for(let p of was)stopped.add(p),setBusy(p,!1);
    let tab=await anaplanTab();
    tab!=null&&await api.tabs.sendMessage(tab,{type:`ia_cancel`}).catch(()=>{});
    return{stopped:was}
  }

  // "Get data" / refresh icon. ia_load uses the cache, ia_refresh bypasses it.
  if(msg.type===`ia_load`||msg.type===`ia_refresh`){
    sawShell=!0;
    if(OFF.has(msg.page))return{error:`This report is disabled - it is too slow to run on large models.`};
    stopped.delete(msg.page);
    let quiet=QUIET.has(msg.page),
        tab=await anaplanTab(),
        front=!!route?.front;
    if(tab==null){let m=`Open an Anaplan model tab, then try again.`;if(quiet)return{error:m};throw Error(m)}
    setBusy(msg.page,!0);
    let trigger={type:`trigger_${msg.page}`,force:msg.type===`ia_refresh`},
        gone=await deliver(tab,trigger);
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
      if(alt!=null)gone=await deliver(alt,trigger)
    }
    // The tab is right but the report engine is not in it: an extension reload
    // orphans the script in frames that were already open, and only a page
    // reload re-injects it. Say that, rather than sending them tab-hunting.
    if(gone){let m=`The extension is not running in that Anaplan tab yet - reload the Anaplan page, then try again.`;if(quiet)return setBusy(msg.page,!1),{error:m};throw setBusy(msg.page,!1),Error(m)}
    // Summary is retried by the panel, so a miss should come back fast.
    return armWait(msg.page,quiet?QUIET_SIGN:FIRST_SIGN,`The Anaplan tab did not respond. Reload the Anaplan model tab, then try again.`),{ok:!0}
  }

  // --- from the content script ---

  // Live step/loop reporting from whichever gather is running.
  if(msg.type===`ia_progress`)return void(msg.page&&progAdd(msg.page,msg));

  // A keyboard shortcut started a run: show the panel on that view right away.
  if(PAGES.includes(msg.type)){
    // Summary's runs are started by the panel itself (and retried while the
    // model loads) - selecting it each time would yank the user back to it.
    if(QUIET.has(msg.type))return void(busy.has(msg.type)||setBusy(msg.type,!0));
    route={tabId:tabId??route?.tabId,windowId:sender?.tab?.windowId??route?.windowId};
    pendingSelect=msg.type;
    stopped.delete(msg.type);
    setBusy(msg.type,!0);
    await openPanel(sender);
    return void push({type:`ia_select`,page:msg.type})
  }

  // Cache probe. On a hit the content script skips the (expensive) Anaplan calls.
  if(msg.type===`cache_get`){
    learnKey(tabId,msg.key||``);
    let hit=await cacheGet(msg.page,msg.key);
    if(!hit)return{hit:!1};
    setBusy(msg.page,!1);
    (msg.key||``)===shownKey&&push({type:`ia_state`,page:msg.page,ts:hit.ts},msg.page);
    return{hit:!0,ts:hit.ts}
  }

  // Freshly gathered results. These used to be sent as <page>_data, which
  // runtime.sendMessage also delivered straight to every view iframe - so a
  // run in another tab, or a late one for the previous model, rendered over
  // the model in front. As ia_result only the worker hears them, and the
  // panel fetches the payload with ia_serve once it knows the model matches.
  if(msg.type===`ia_result`&&PAGES.includes(msg.page)){
    let page=msg.page;
    if(stopped.has(page))return;
    learnKey(tabId,msg.key||``);
    let hit=await cacheSet(page,msg.key,msg.data);
    // A run for a model no longer in front is cached under its own key, but
    // not announced - the panel would mark the current model's view as loaded.
    setBusy(page,!1);
    return void((msg.key||``)===shownKey&&push({type:`ia_state`,page,ts:hit.ts},page))
  }

  // A quiet page's own failure, reported by the content script.
  if(msg.type===`ia_page_error`){
    if(msg.page&&!stopped.has(msg.page)&&busy.has(msg.page))failPage(msg.page,msg.message);
    return
  }

  if(msg.type===`error`){
    for(let p of[...busy])setBusy(p,!1);
    push(msg);
    return void(tabId!=null&&api.tabs.sendMessage(tabId,msg).catch(()=>{}))
  }

  // Anything else is the outer.js -> inner.js relay within one tab.
  if(tabId!=null)await api.tabs.sendMessage(tabId,msg)
}

function report(e,sender){
  let message=e?.message||String(e);
  for(let p of[...busy])setBusy(p,!1);
  push({type:`error`,message});
  let id=sender?.tab?.id;
  id!=null&&api.tabs.sendMessage(id,{type:`error`,message}).catch(()=>{})
}

function onMessage(msg,sender,respond){
  handle(msg,sender).then(
    r=>{try{respond(r)}catch(e){}},
    e=>{try{respond({error:e?.message})}catch(e2){}report(e,sender)}
  );
  return !0   // keep the channel open for the async respond()
}

var main=wxt(()=>{
  // Clicking the toolbar icon opens the panel directly - there is no popup.
  api.sidePanel?.setPanelBehavior?.({openPanelOnActionClick:!0})?.catch?.(()=>{});
  // Firefox has no openPanelOnActionClick equivalent: wire the toolbar icon
  // to the sidebar directly. (No-op on Chrome, which already opened above.)
  if(!api.sidePanel&&api.sidebarAction)api.action?.onClicked?.addListener(()=>{try{api.sidebarAction.toggle()}catch(e){}});
  api.runtime.onMessage.addListener(onMessage);
  api.tabs.onRemoved.addListener(id=>{keyByTab.delete(id),route?.tabId===id&&(route=null),announce()});
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
