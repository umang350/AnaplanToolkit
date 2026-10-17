/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 *
 * Formula editor helpers. MAIN world, on the modeling-ui frame - the frame that holds Anaplan's
 * formula editor, which is a Monaco instance exposed as window.monaco (confirmed on a live model).
 * The model's structure lives in the framework.jsp frame beside it (anaplan.data.ModelContentCache,
 * same origin), so both are reachable from here without any message passing.
 *
 *   - Cmd/Ctrl + click on a reference opens it: the module, or the line item (selected in the grid).
 *     Cmd/Ctrl + Shift/Alt + click opens a module in a new tab.
 *   - Hover on a reference shows its type, dimensions and formula.
 *   - Markers for what can be known for certain: unbalanced brackets, unterminated quotes, and
 *     Module.'Line item' where the module has no such line item.
 *
 * Nothing here calls Anaplan or any server; it reads the page's own cache and edits nothing.
 * The scanner (IA_fxScan) is pure so it can be tested without a browser.
 */
(function () {
  var IA_FX_WORD = /[\p{L}\p{N}_]/u;
  function IA_fxIsWord(c) { return c !== undefined && c !== '' && IA_FX_WORD.test(c); }

  /* ---------- the model index ---------- */

  function IA_fxFlat(v) {
    /* Label pages hold [[...]] except Lists', which are flat. */
    return Array.isArray(v) ? (Array.isArray(v[0]) ? v[0] : v) : [];
  }

  function IA_fxByFirst(items) {
    /* Names by first letter, longest first, so an unquoted match can take the longest name. */
    var m = new Map();
    items.forEach(function (it) {
      if (!it.lower) return;
      var k = it.lower[0], a = m.get(k);
      a ? a.push(it) : m.set(k, [it]);
    });
    m.forEach(function (a) { a.sort(function (x, y) { return y.lower.length - x.lower.length; }); });
    return m;
  }

  /* A subset's parent list: whichever field of its info holds the id of a list. Which field that is
     isn't known, so every value is tried (a few levels in). */
  function IA_fxFindList(o, listById, depth) {
    if (o == null || depth > 2) return null;
    if (typeof o === 'number' || typeof o === 'string') return listById.get(String(o).replace(/_/g, '')) || null;
    if (typeof o !== 'object') return null;
    var ks = Object.keys(o);
    for (var i = 0; i < ks.length && i < 60; i++) {
      var r = IA_fxFindList(o[ks[i]], listById, depth + 1);
      if (r) return r;
    }
    return null;
  }

  function IA_fxBuild(info) {
    var ids = IA_fxFlat(info.modulesLabelPage && info.modulesLabelPage.entityLongIds);
    var lbs = IA_fxFlat(info.modulesLabelPage && info.modulesLabelPage.labels);
    var infos = Array.isArray(info.moduleInfos) ? info.moduleInfos : [];
    var mods = [], byId = new Map(), byLower = new Map();
    for (var z = 0; z < ids.length; z++) {
      var mi = infos[z] || {}, lp = mi.lineItemsLabelPage || {};
      var lids = IA_fxFlat(lp.entityLongIds), llb = IA_fxFlat(lp.labels);
      var lis = [], liByLower = new Map();
      for (var q = 0; q < lids.length; q++) {
        var nm = llb[q] == null ? '' : String(llb[q]);
        var li = { id: String(lids[q]), name: nm, lower: nm.toLowerCase(), info: (mi.lineItemInfos || [])[q] || {} };
        li.index = lis.length;
        lis.push(li);
        liByLower.has(li.lower) || liByLower.set(li.lower, li);
      }
      var name = lbs[z] == null ? '' : String(lbs[z]);
      var mod = { id: String(ids[z]), name: name, lower: name.toLowerCase(), info: mi, lis: lis, liByLower: liByLower, liByFirst: IA_fxByFirst(lis) };
      mods.push(mod);
      byId.set(mod.id, mod);
      byLower.has(mod.lower) || byLower.set(mod.lower, mod);
    }
    /* Names of every entity with a label page (lists, subsets, ...), to show Applies To. */
    var names = {}, seen = new Set(), lists = [], listByLower = new Map();
    (function walk(o, d) {
      if (!o || typeof o !== 'object' || Array.isArray(o) || d > 3 || seen.has(o)) return;
      seen.add(o);
      Object.keys(o).forEach(function (k) {
        var v = o[k];
        if (/LabelPage$/.test(k) && v && typeof v === 'object') {
          var a = IA_fxFlat(v.entityLongIds), b = IA_fxFlat(v.labels);
          var infos = null;
          Object.keys(o).forEach(function (kk) {
            var x = o[kk];
            if (infos || kk === k || !x || typeof x !== 'object' || !a.length) return;
            if (Array.isArray(x)) { if (x.length === a.length && x[0] && typeof x[0] === 'object') infos = x; }
            else if (x[String(a[0])] && typeof x[String(a[0])] === 'object') infos = a.map(function (id) { return x[String(id)]; });
          });
          var base = k.replace(/LabelPage$/, ''), kind = /lineItem/i.test(base) ? '' : /subset/i.test(base) ? 'List subset' : /^(hierarch|lists?$)/i.test(base) ? 'List' : '';
          for (var i = 0; i < a.length; i++) {
            if (b[i] == null) continue;
            if (!names[String(a[i])]) names[String(a[i])] = String(b[i]);
            if (kind) {
              var L = { id: String(a[i]), name: String(b[i]), lower: String(b[i]).toLowerCase(), kind: kind, info: infos && infos[i], parent: null };
              lists.push(L);
              listByLower.has(L.lower) || listByLower.set(L.lower, L);
            }
          }
          return;
        }
        walk(v, d + 1);
      });
    })(info, 0);
    var listById = new Map();
    lists.forEach(function (L) { if (L.kind === 'List') listById.set(L.id, L); });
    lists.forEach(function (L) { if (L.kind === 'List subset') L.parent = IA_fxFindList(L.info, listById, 0); });
    return { mods: mods, byId: byId, byLower: byLower, byFirst: IA_fxByFirst(mods), names: names, lists: lists, listByLower: listByLower, listByFirst: IA_fxByFirst(lists), src: info };
  }

  /* ---------- the scanner ---------- */

  function IA_fxQuoted(text, i) {
    /* 'Name' with '' for an apostrophe. Returns null when it never closes. */
    var n = text.length, j = i + 1, out = '';
    while (j < n) {
      if (text[j] === "'") {
        if (text[j + 1] === "'") { out += "'"; j += 2; continue; }
        return { start: i, end: j + 1, name: out };
      }
      out += text[j++];
    }
    return null;
  }

  function IA_fxLongest(text, i, byFirst, needDot) {
    /* The longest known name written unquoted at i. */
    var c = text[i], list = c ? byFirst.get(c.toLowerCase()) : null;
    if (!list) return null;
    for (var k = 0; k < list.length; k++) {
      var it = list[k], L = it.lower.length;
      if (text.substr(i, L).toLowerCase() !== it.lower) continue;
      var nx = text[i + L];
      if (needDot ? nx !== '.' : (IA_fxIsWord(it.lower[L - 1]) && IA_fxIsWord(nx))) continue;
      return { item: it, start: i, end: i + L };
    }
    return null;
  }

  function IA_fxWordEnd(text, i) {
    var j = i;
    while (j < text.length && IA_fxIsWord(text[j])) j++;
    return Math.max(j, i + 1);
  }

  /* One piece after a dot: quoted, or an unquoted name of module `mod`. */
  function IA_fxPiece(text, i, mod) {
    if (text[i] === "'") {
      var q = IA_fxQuoted(text, i);
      if (!q) return null;
      var li = mod && mod.liByLower.get(q.name.toLowerCase());
      return { start: q.start, end: q.end, name: q.name, li: li || null };
    }
    if (mod) {
      var m = IA_fxLongest(text, i, mod.liByFirst, false);
      if (m) return { start: m.start, end: m.end, name: m.item.name, li: m.item };
    }
    if (!IA_fxIsWord(text[i])) return null;
    var e = IA_fxWordEnd(text, i);
    return { start: i, end: e, name: text.slice(i, e), li: null };
  }

  /* Finds every reference to a module or line item, and what is plainly wrong. `cur` is the module
     the formula is in (its line items may be written without a qualifier). */
  function IA_fxScan(text, ix, cur) {
    var refs = [], diags = [], stack = [], n = text.length, i = 0;
    function ref(s, e, mod, li) { refs.push({ s: s, e: e, mod: mod, li: li || null, list: null }); }
    function listRef(s, e, list) { refs.push({ s: s, e: e, mod: null, li: null, list: list }); }
    function bad(s, e, msg, sev) { diags.push({ s: s, e: e, msg: msg, sev: sev || 'error' }); }
    function tail(from) {
      /* A property or list item after a dot: nothing to resolve; skip it. */
      var j = from;
      while (text[j] === '.') {
        j++;
        if (text[j] === "'") { var q = IA_fxQuoted(text, j); if (!q) break; j = q.end; }
        else if (IA_fxIsWord(text[j])) j = IA_fxWordEnd(text, j);
        else break;
      }
      return j;
    }
    while (i < n) {
      var c = text[i];
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      if (c === '/' && text[i + 1] === '*') {
        var ce = text.indexOf('*/', i + 2);
        if (ce < 0) { bad(i, n, 'Unterminated comment'); break; }
        i = ce + 2; continue;
      }
      if (c === '"') {
        var j = i + 1;
        while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
        if (j >= n) { bad(i, n, 'Unterminated text: missing closing "'); break; }
        i = j + 1; continue;
      }
      if (c === '(' || c === '[') { stack.push({ c: c, at: i }); i++; continue; }
      if (c === ')' || c === ']') {
        var want = c === ')' ? '(' : '[', top = stack.pop();
        if (!top) bad(i, i + 1, 'Unmatched ' + c);
        else if (top.c !== want) { bad(top.at, top.at + 1, 'Unmatched ' + top.c); bad(i, i + 1, 'Unmatched ' + c); }
        i++; continue;
      }
      var prev = i - 1;
      while (prev >= 0 && text[prev] === ' ') prev--;
      if (c !== "'" && !IA_fxIsWord(c)) { i++; continue; }
      if (IA_fxIsWord(text[i - 1]) && c !== "'") { i = IA_fxWordEnd(text, i); continue; }
      if (prev >= 0 && text[prev] === '.') {
        /* already a tail of something we skipped */
        if (c === "'") { var qq = IA_fxQuoted(text, i); i = qq ? qq.end : n; } else i = IA_fxWordEnd(text, i);
        continue;
      }

      /* Module.line item - the module quoted, or written out unquoted (its name may hold spaces). */
      var mod = null, mS = i, mE = 0, q0 = null;
      if (c === "'") {
        q0 = IA_fxQuoted(text, i);
        if (!q0) { bad(i, n, "Unterminated name: missing closing '"); break; }
        if (text[q0.end] === '.') { mod = ix.byLower.get(q0.name.toLowerCase()) || null; mE = q0.end; }
      } else {
        var um = IA_fxLongest(text, i, ix.byFirst, true);
        if (um) { mod = um.item; mE = um.end; }
      }
      if (mod) {
        ref(mS, mE, mod, null);
        var p = IA_fxPiece(text, mE + 1, mod);
        if (p) {
          if (p.li) ref(p.start, p.end, mod, p.li);
          else bad(p.start, p.end, "'" + mod.name + "' has no line item '" + p.name + "'", 'warning');
          i = tail(p.end);
        } else i = mE + 1;
        continue;
      }
      if (c === "'") {
        var ql = ix.listByLower.get(q0.name.toLowerCase());
        if (text[q0.end] === '.') { ql && listRef(q0.start, q0.end, ql); i = tail(q0.end); continue; } /* a list qualifier */
        var li = cur && cur.liByLower.get(q0.name.toLowerCase());
        if (li) ref(q0.start, q0.end, cur, li);
        else if (ql) listRef(q0.start, q0.end, ql);
        i = tail(q0.end);
        continue;
      }
      var lm = cur && IA_fxLongest(text, i, cur.liByFirst, false);
      if (lm) { ref(lm.start, lm.end, cur, lm.item); i = tail(lm.end); continue; }
      var lst = IA_fxLongest(text, i, ix.listByFirst, false);
      if (lst) { listRef(lst.start, lst.end, lst.item); i = tail(lst.end); continue; }
      var we = IA_fxWordEnd(text, i);
      i = text[we] === '.' ? tail(we) : we;
    }
    stack.forEach(function (o) { bad(o.at, o.at + 1, 'Unmatched ' + o.c); });
    return { refs: refs, diags: diags };
  }

  function IA_fxRefAt(refs, off) {
    /* The narrowest reference covering the offset (a module and its line item abut at the dot). */
    var best = null;
    refs.forEach(function (r) {
      if (off >= r.s && off < r.e && (!best || r.e - r.s < best.e - best.s)) best = r;
    });
    return best;
  }

  /* ---------- showing a formula ---------- */

  /* A one-line formula laid out for a narrow card: THEN / ELSE start a line, indented one step per
     nested IF, and a long OR chain breaks before each OR. Display only; a formula that already has
     line breaks (or comments) is shown as stored. */
  function IA_fxPretty(text) {
    if (/\n|\/\/|\/\*/.test(text)) return text;
    var out = '', n = text.length, i = 0, depth = 0, stack = [];
    function brk(extra) {
      out = out.replace(/ +$/, '') + '\n' + new Array(Math.max(0, stack.length - 1) + extra + 1).join('  ');
    }
    while (i < n) {
      var c = text[i];
      if (c === "'" || c === '"') {
        var j = text.indexOf(c, i + 1);
        j = j < 0 ? n : j + 1;
        out += text.slice(i, j); i = j; continue;
      }
      if (c === '(' || c === '[') { depth++; out += c; i++; continue; }
      if (c === ')' || c === ']') {
        depth--;
        while (stack.length && stack[stack.length - 1].depth > depth) stack.pop();
        out += c; i++; continue;
      }
      if (/[A-Za-z]/.test(c) && !IA_fxIsWord(text[i - 1])) {
        var e = i;
        while (e < n && /[A-Za-z]/.test(text[e])) e++;
        if (IA_fxIsWord(text[e])) { while (e < n && IA_fxIsWord(text[e])) e++; out += text.slice(i, e); i = e; continue; }
        var w = text.slice(i, e), up = w.toUpperCase(), top = stack[stack.length - 1];
        if (up === 'IF') { stack.push({ depth: depth, elseSeen: false }); out += w; }
        else if (up === 'THEN' && top && top.depth === depth) { brk(0); out += w; }
        else if (up === 'ELSE') {
          while (stack.length && stack[stack.length - 1].depth === depth && stack[stack.length - 1].elseSeen) stack.pop();
          top = stack[stack.length - 1];
          if (top && top.depth === depth) { top.elseSeen = true; brk(0); }
          out += w;
        }
        else if (up === 'OR' && depth === (top ? top.depth : 0) && n > 80) { brk(1); out += w; }
        else out += w;
        i = e; continue;
      }
      out += c; i++;
    }
    return out;
  }

  /* ---------- functions ---------- */

  function IA_fxInQuote(text, off) {
    /* True inside 'a name', "a text" or a comment, where a function name is just letters. */
    var q = '';
    for (var i = 0; i < off; i++) {
      var c = text[i];
      if (q) { if (c === q) q = ''; else if (q === '"' && c === '\\') i++; continue; }
      if (c === "'" || c === '"') q = c;
      else if (c === '/' && text[i + 1] === '/') { var nl = text.indexOf('\n', i); if (nl < 0 || nl >= off) return true; i = nl; }
      else if (c === '/' && text[i + 1] === '*') { var ce = text.indexOf('*/', i + 2); if (ce < 0 || ce >= off) return true; i = ce + 1; }
    }
    return !!q;
  }

  /* The Anaplan function written at the offset: NAME( ... ), or the [LOOKUP: / [SUM: of a mapping
     (the aggregation form), or IF / THEN / ELSE. Returns the entry and the word's range. */
  function IA_fxFuncAt(text, off, funcs) {
    var s = off, e = off;
    while (s > 0 && /[A-Za-z]/.test(text[s - 1])) s--;
    while (e < text.length && /[A-Za-z]/.test(text[e])) e++;
    if (s === e || IA_fxIsWord(text[s - 1]) || /[\p{L}\p{N}_]/u.test(text[e] || '') || IA_fxInQuote(text, s)) return null;
    var word = text.slice(s, e).toUpperCase();
    if (word === 'THEN' || word === 'ELSE') word = 'IF';
    var list = funcs[word];
    if (!list) return null;
    var a = e, b = s - 1;
    while (text[a] === ' ') a++;
    while (b >= 0 && text[b] === ' ') b--;
    var call = text[a] === '(', agg = text[b] === '[' && text[a] === ':', kw = word === 'IF';
    if (!call && !agg && !kw) return null;
    var pick = list.filter(function (f) { return f.agg === agg; })[0] || list[0];
    return { f: pick, s: s, e: e };
  }

  function IA_fxFuncHover(f) {
    var syn = globalThis.IA_FX_SYNTAX && globalThis.IA_FX_SYNTAX[f.name];
    return ['**' + f.name + '** - ' + f.category + (f.agg ? ' (aggregation)' : ' function'),
      syn ? '```\n' + syn + '\n```' : '', f.desc, '[Anaplan documentation](' + f.url + ')']
      .filter(Boolean).join('\n\n');
  }

  /* ---------- reading the page ---------- */

  function IA_fxFrameInfo(win, depth) {
    try {
      var info = win.anaplan && win.anaplan.data && win.anaplan.data.ModelContentCache && win.anaplan.data.ModelContentCache._modelInfo;
      if (info && info.modulesLabelPage) return info;
      if (depth > 3) return null;
      for (var i = 0; i < win.frames.length; i++) {
        var r = IA_fxFrameInfo(win.frames[i], depth + 1);
        if (r) return r;
      }
    } catch (e) { /* cross-origin or torn down */ }
    return null;
  }

  var IA_fxCache = { src: null, ix: null, at: 0 };
  function IA_fxIndex() {
    var info = IA_fxFrameInfo(window, 0) || IA_fxFrameInfo(window.top, 0);
    if (!info) return null;
    /* Anaplan swaps the object when the model reloads; renames edit it in place, hence the age. */
    if (IA_fxCache.src !== info || Date.now() - IA_fxCache.at > 15000) {
      IA_fxCache = { src: info, ix: IA_fxBuild(info), at: Date.now() };
    }
    return IA_fxCache.ix;
  }

  function IA_fxHref() {
    try { return window.top.location.href; } catch (e) { return location.href; } /* cross-origin: this frame's */
  }

  function IA_fxCurrent(ix) {
    /* The module whose tab is open: the id in the URL (/tabs/<module id>). */
    var m = /\/tabs\/(\d+)/.exec(IA_fxHref());
    return (m && ix.byId.get(m[1])) || null;
  }

  function IA_fxUrl(modId) {
    var u = location.href.replace('/a/modeling-ui/', '/a/modeling/').replace(/\/tabs\/\d+/, '/tabs/' + modId);
    return u.replace(/[?#].*$/, '');
  }

  var IA_FX_DT = { NUMBER: 'Number', BOOLEAN: 'Boolean', TEXT: 'Text', DATE: 'Date', NONE: 'No Data', TIME_ENTITY: 'Time period', ENTITY: 'List', LIST: 'List' };

  function IA_fxAppliesTo(info, ix) {
    var ids = info.fullAppliesTo || info.appliesTo || [], out = [];
    (Array.isArray(ids) ? ids : []).forEach(function (id) {
      var s = String(id).replace(/_/g, '');
      /* Time and Versions have columns of their own; lists and subsets have 12-digit ids. */
      if (s.length >= 12 && ix.names[s]) out.push(ix.names[s]);
    });
    return out;
  }

  function IA_fxLabel(v) {
    if (v == null) return '';
    if (typeof v !== 'object') return String(v);
    return String(v.entityLabel || v.label || v.name || '');
  }

  function IA_fxHover(r, ix) {
    var md = [];
    if (r.list) {
      md.push('**' + r.list.name + '** - ' + r.list.kind.toLowerCase() + (r.list.parent ? ' of ' + r.list.parent.name : ''));
    } else if (!r.li) {
      var info = r.mod.info, ap = IA_fxAppliesTo(info, ix), ts = IA_fxLabel(info.leafPeriodType);
      md.push('**' + r.mod.name + '** - module, ' + r.mod.lis.length + ' line items');
      if (ap.length) md.push('Applies to: ' + ap.join(', '));
      if (ts && !/^not applicable$/i.test(ts)) md.push('Time scale: ' + ts);
    } else {
      var li = r.li.info, f = li.format || {}, dt = String(f.dataType || '').toUpperCase();
      var ty = IA_FX_DT[dt] || dt || '?';
      if ((dt === 'ENTITY' || dt === 'LIST') && f.hierarchyEntityLongId != null) {
        var ln = ix.names[String(f.hierarchyEntityLongId).replace(/_/g, '')];
        if (ln) ty += ': ' + ln;
      }
      var ap2 = IA_fxAppliesTo(li, ix), ts2 = IA_fxLabel(li.leafPeriodType);
      md.push('**' + r.mod.name + '.' + r.li.name + '**');
      md.push('Format: ' + ty);
      if (ap2.length) md.push('Applies to: ' + ap2.join(', '));
      if (ts2 && !/^not applicable$/i.test(ts2)) md.push('Time scale: ' + ts2);
      if (li.formula) {
        var lines = IA_fxPretty(String(li.formula)).split('\n'), more = lines.length > 14;
        md.push('```\n' + lines.slice(0, 14).join('\n') + (more ? '\n... (' + (lines.length - 14) + ' more lines)' : '') + '\n```');
      }
    }
    md.push('*Cmd/Ctrl + click to open*');
    return md.join('\n\n');
  }

  /* ---------- opening a reference ---------- */

  function IA_fxToast(msg) {
    var d = document.createElement('div');
    d.className = 'ia-fx-toast';
    d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(function () { d.remove(); }, 3500);
  }

  function IA_fxFrameworkWin(win, depth) {
    try {
      if (win.anaplan && win.anaplan.data && win.anaplan.data.ModelContentCache) return win;
      if (depth > 3) return null;
      for (var i = 0; i < win.frames.length; i++) {
        var r = IA_fxFrameworkWin(win.frames[i], depth + 1);
        if (r) return r;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  /* Best effort: the Modules grid is Anaplan's own Dojo UI, whose markup is not documented, so the
     row is found by its label text, leftmost match (the row-label column). */
  function IA_fxSelectRow(name) {
    var w = IA_fxFrameworkWin(window, 0);
    if (!w) return false;
    var squash = function (t) { return t.replace(/[\s\u00a0]+/g, ' ').trim(); };
    var want = squash(name), doc = w.document, tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT), best = null, bestX = 1e9, nd;
    while ((nd = tw.nextNode())) {
      if (squash(nd.nodeValue) !== want) continue;
      var el = nd.parentElement;
      if (!el || !el.offsetParent || el.closest('.formulaBar, .moduleFormulae, textarea')) continue;
      var rc = el.getBoundingClientRect();
      if (rc.width && rc.left < bestX) { best = el; bestX = rc.left; }
    }
    if (!best) return false;
    best.scrollIntoView({ block: 'center' });
    ['mousedown', 'mouseup', 'click'].forEach(function (t) {
      best.dispatchEvent(new w.MouseEvent(t, { bubbles: true, cancelable: true, view: w, button: 0 }));
    });
    return true;
  }

  /* Blueprint view is the grid with Format / Formula / Applies To columns; the regular view has none
     of those headers, so that is what tells them apart (no guessing at the toggle's state class). */
  function IA_fxIsBlueprint(doc) {
    var seen = {}, tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT), nd;
    while ((nd = tw.nextNode())) {
      var t = nd.nodeValue.trim();
      if ((t === 'Applies To' || t === 'Formula') && nd.parentElement && nd.parentElement.offsetParent) seen[t] = 1;
    }
    return !!(seen['Applies To'] && seen['Formula']);
  }

  /* Anaplan's toolbar toggle ("Toggle from regular view to Blueprint view"). Its markup is not
     confirmed, so it is looked for by anything naming blueprint; when none is found the toolbar's
     buttons are logged (IA_fxDumpButtons) to see what to look for. */
  function IA_fxBlueprintButton(doc) {
    var sels = ['[title*="lueprint" i]', '[aria-label*="lueprint" i]', '[class*="lueprint" i]'];
    for (var i = 0; i < sels.length; i++) {
      var els = doc.querySelectorAll(sels[i]);
      for (var j = 0; j < els.length; j++) {
        var el = els[j].closest('.dijitButton, .dijitToggleButton, [role=button], button') || els[j];
        if (el.offsetParent) return el;
      }
    }
    return null;
  }

  function IA_fxDumpButtons(doc) {
    var out = [];
    doc.querySelectorAll('.dijitButton, .dijitToggleButton, [role=button], [role=toolbar] *').forEach(function (e) {
      if (out.length < 60 && e.offsetParent) {
        out.push(e.tagName + '.' + String(e.className).slice(0, 90) + ' | title=' + (e.getAttribute('title') || '') +
          ' | aria-label=' + (e.getAttribute('aria-label') || '') + ' | aria-pressed=' + (e.getAttribute('aria-pressed') || ''));
      }
    });
    IA_fxLog('blueprint toggle not found; visible buttons:\n' + out.join('\n'));
  }

  /* After moving to another module: switch it to Blueprint view, then select the line item's row. */
  function IA_fxAfterNav(name, tries, st) {
    if (IA_fxCancel) return;
    if (tries <= 0) { if (st.noBtn) { var w0 = IA_fxFrameworkWin(window, 0); w0 && IA_fxDumpButtons(w0.document); } return; }
    var w = IA_fxFrameworkWin(window, 0), doc = w && w.document;
    if (doc && doc.body) {
      if (!IA_fxIsBlueprint(doc)) {
        if (!st.clicked) {
          var b = IA_fxBlueprintButton(doc);
          if (b) { b.click(); st.clicked = true; st.noBtn = false; } else st.noBtn = true;
        }
      } else if (!name || IA_fxSelectRow(name)) return;
    }
    setTimeout(function () { IA_fxAfterNav(name, tries - 1, st); }, 400);
  }

  /* After moving to a list for one of its subsets: open the list's Subsets tab and select the row. */
  function IA_fxAfterSubset(name, tries, st) {
    if (IA_fxCancel || tries <= 0) return;
    var w = IA_fxFrameworkWin(window, 0), doc = w && w.document;
    if (doc && doc.body) {
      if (!st.clicked) {
        var tw = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT), nd, tab = null;
        while ((nd = tw.nextNode())) {
          if (nd.nodeValue.trim() !== 'Subsets' || !nd.parentElement || !nd.parentElement.offsetParent) continue;
          var t = nd.parentElement.closest('.dijitTab, [role=tab]');
          if (t) { tab = t; break; }
        }
        if (tab) {
          st.clicked = true;
          if (tab.getAttribute('aria-selected') !== 'true') tab.click();
          st.at = Date.now();
        }
      } else if (Date.now() - st.at > 300 && IA_fxSelectRow(name)) return;
    }
    setTimeout(function () { IA_fxAfterSubset(name, tries - 1, st); }, 400);
  }

  function IA_fxRun(mode, name) {
    if (mode === 'bp') IA_fxAfterNav(name, 40, {});
    else if (mode === 'subset') IA_fxAfterSubset(name, 40, {});
  }

  var IA_fxCancel = false;
  function IA_fxSelectSoon(name, tries) {
    if (IA_fxCancel || IA_fxSelectRow(name) || tries <= 0) return;
    setTimeout(function () { IA_fxSelectSoon(name, tries - 1); }, 400);
  }

  function IA_fxOpen(r, ix, newTab) {
    var cur = IA_fxCurrent(ix);
    if (r.list) {
      /* A list opens as a tab whose id is taken to be the list's own, like a module's. */
      /* A subset has no tab of its own (opening its id gives "Sorry, an error occurred"): its list's does. */
      var target = r.list.kind === 'List subset' ? r.list.parent : r.list;
      IA_fxLog('opening', r.list.kind, r.list.name, '->', target && target.name, target && target.id);
      if (!target) {
        IA_fxLog('subset info (to find its list):', r.list.info ? JSON.stringify(r.list.info).slice(0, 600) : 'none found');
        IA_fxToast("Can't tell which list '" + r.list.name + "' belongs to");
        return;
      }
      var sub = r.list.kind === 'List subset', here = new RegExp('/tabs/' + target.id + '(\\D|$)').test(IA_fxHref());
      IA_fxCancel = false;
      if (here && !newTab) { if (sub) IA_fxRun('subset', r.list.name); return; }
      IA_fxNavigate(IA_fxUrl(target.id), target.id, sub ? r.list.name : '', newTab, sub ? 'subset' : '');
      return;
    }
    if (cur && r.mod === cur) {
      if (r.li) IA_fxSelectRow(r.li.name) || IA_fxToast("Couldn't find '" + r.li.name + "' in the grid");
      return;
    }
    IA_fxNavigate(IA_fxUrl(r.mod.id), r.mod.id, r.li ? r.li.name : '', newTab, 'bp');
  }

  function IA_fxNavigate(url, tab, liName, newTab, mode) {
    IA_fxCancel = false;
    if (newTab) { window.open(url, '_blank', 'noopener'); return; }
    try { sessionStorage.setItem('IA_fx_pending', JSON.stringify({ tab: tab, li: liName, mode: mode, at: Date.now() })); } catch (e) { /* private mode */ }
    /* The shell is a single-page app: move its URL and tell its router. If this frame is still here
       afterwards, the router did not take it - go back and open a tab instead. */
    var before = location.href;
    try {
      window.top.history.pushState({}, '', url);
      if (mode) setTimeout(function () { IA_fxRun(mode, liName); }, 800);
      window.top.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    } catch (e) { window.open(url, '_blank', 'noopener'); return; }
    setTimeout(function () {
      if (location.href !== before) return;
      IA_fxCancel = true;
      try { window.top.history.back(); } catch (e) { /* ignore */ }
      try { sessionStorage.removeItem('IA_fx_pending'); } catch (e) { /* ignore */ }
      window.open(url, '_blank', 'noopener');
    }, 2000);
  }

  function IA_fxResumePending() {
    try {
      var p = JSON.parse(sessionStorage.getItem('IA_fx_pending') || 'null');
      sessionStorage.removeItem('IA_fx_pending');
      if (p && p.mode && Date.now() - p.at < 30000 && new RegExp('/tabs/' + p.tab + '(\\D|$)').test(location.href)) IA_fxRun(p.mode, p.li);
    } catch (e) { /* ignore */ }
  }

  /* ---------- Monaco ---------- */

  function IA_fxLog() {
    try { console.debug.apply(console, ['[Anaplan Toolkit formula]'].concat([].slice.call(arguments))); } catch (e) { /* ignore */ }
  }

  function IA_fxOffsetAt(model, pos) { return model.getOffsetAt(pos); }

  var IA_fxEds = [];

  function IA_fxIsFormula(editor) {
    var n = editor.getContainerDomNode && editor.getContainerDomNode();
    return !!(n && n.closest && n.closest('.formula-editor'));
  }

  function IA_fxAttach(monaco, editor) {
    var deco = [];
    function clear() { deco = editor.deltaDecorations(deco, []); }
    function hit(e) {
      var model = editor.getModel(), ix = IA_fxIndex();
      if (!model || !ix || !e.target || e.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT || !e.target.position) return null;
      var cur = IA_fxCurrent(ix), res = IA_fxScan(model.getValue(), ix, cur);
      var r = IA_fxRefAt(res.refs, IA_fxOffsetAt(model, e.target.position));
      return r ? { r: r, ix: ix, model: model } : null;
    }
    editor.onMouseMove(function (e) {
      var ev = e.event;
      if (!(ev.metaKey || ev.ctrlKey)) { deco.length && clear(); return; }
      var h = hit(e);
      if (!h) { deco.length && clear(); return; }
      deco = editor.deltaDecorations(deco, [{
        range: monaco.Range.fromPositions(h.model.getPositionAt(h.r.s), h.model.getPositionAt(h.r.e)),
        options: { inlineClassName: 'ia-fx-link' },
      }]);
    });
    editor.onKeyUp(function () { deco.length && clear(); });
    editor.onMouseLeave && editor.onMouseLeave(function () { deco.length && clear(); });
    editor.onMouseDown(function (e) {
      var ev = e.event;
      if (!(ev.metaKey || ev.ctrlKey)) return;
      IA_fxLog('modifier-click', { left: ev.leftButton, target: e.target && e.target.type, pos: !!(e.target && e.target.position) });
      var h = hit(e);
      if (!IA_fxIndex()) { IA_fxToast('Anaplan Toolkit: model data not found in this page'); return; }
      if (!h) return;
      ev.preventDefault();
      ev.stopPropagation();
      clear();
      IA_fxOpen(h.r, h.ix, ev.shiftKey || ev.altKey);
    });

    /* markers */
    var timer = 0;
    function mark() {
      var model = editor.getModel(), ix = IA_fxIndex();
      if (!model) return;
      var out = [];
      if (ix) {
        IA_fxScan(model.getValue(), ix, IA_fxCurrent(ix)).diags.forEach(function (d) {
          var a = model.getPositionAt(d.s), b = model.getPositionAt(d.e);
          out.push({
            severity: d.sev === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
            message: d.msg, source: 'Anaplan Toolkit',
            startLineNumber: a.lineNumber, startColumn: a.column, endLineNumber: b.lineNumber, endColumn: b.column,
          });
        });
      }
      monaco.editor.setModelMarkers(model, 'anaplan-toolkit', out);
    }
    function soon() { clearTimeout(timer); timer = setTimeout(mark, 400); }
    editor.onDidChangeModelContent(soon);
    editor.onDidChangeModel && editor.onDidChangeModel(soon);
    soon();
  }

  function IA_fxProvider(monaco) {
    /* One hover provider for every language: it answers only for formula editors' models. */
    monaco.languages.registerHoverProvider('*', {
      provideHover: function (model, pos) {
        var owned = IA_fxEds.some(function (ed) { return ed.getModel() === model; });
        if (!owned) return null;
        var text = model.getValue(), off = model.getOffsetAt(pos), ix = IA_fxIndex();
        var r = ix && IA_fxRefAt(IA_fxScan(text, ix, IA_fxCurrent(ix)).refs, off);
        if (!r) {
          var fn = IA_fxFuncAt(text, off, globalThis.IA_FX_FUNCS || {});
          return fn && {
            range: monaco.Range.fromPositions(model.getPositionAt(fn.s), model.getPositionAt(fn.e)),
            contents: [{ value: IA_fxFuncHover(fn.f) }],
          };
        }
        return {
          range: monaco.Range.fromPositions(model.getPositionAt(r.s), model.getPositionAt(r.e)),
          contents: [{ value: IA_fxHover(r, ix) }],
        };
      },
    });
  }

  function IA_fxInit() {
    var doc = document, seen = new WeakSet(), provided = false;
    if (!doc.getElementById('ia-fx-style')) {
      var st = doc.createElement('style');
      st.id = 'ia-fx-style';
      st.textContent = '.ia-fx-link{text-decoration:underline!important;cursor:pointer!important;color:#0b57d0!important}' +
        '.ia-fx-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);background:#323232;color:#fff;padding:8px 14px;border-radius:6px;font:13px sans-serif;z-index:2147483647}';
      (doc.head || doc.documentElement).appendChild(st);
    }
    function IA_fxTake(monaco, ed) {
      if (seen.has(ed) || !IA_fxIsFormula(ed)) return;
      seen.add(ed);
      IA_fxEds.push(ed);
      IA_fxLog('attached to a formula editor; model data:', !!IA_fxIndex(), 'current module:', (function () { var x = IA_fxIndex(); var c = x && IA_fxCurrent(x); return c && c.name; })());
      try { IA_fxAttach(monaco, ed); } catch (e) { IA_fxLog('attach failed', e); }
    }
    function scan() {
      var monaco = window.monaco;
      if (!monaco || !monaco.editor) return;
      if (!provided) {
        provided = true;
        IA_fxLog('monaco found; getEditors:', typeof monaco.editor.getEditors, 'onDidCreateEditor:', typeof monaco.editor.onDidCreateEditor);
        try { IA_fxProvider(monaco); } catch (e) { IA_fxLog('hover provider failed', e); }
        IA_fxResumePending();
        if (monaco.editor.onDidCreateEditor) monaco.editor.onDidCreateEditor(function (ed) { [0, 300, 1500].forEach(function (t) { setTimeout(function () { IA_fxTake(monaco, ed); }, t); }); });
      }
      if (monaco.editor.getEditors) monaco.editor.getEditors().forEach(function (ed) { IA_fxTake(monaco, ed); });
    }
    /* Editors come and go as line items are picked; a light poll beats depending on one version's
       onDidCreateEditor. */
    setInterval(scan, 1000);
    scan();
    IA_fxLog('loaded in', location.href.slice(0, 80));
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { IA_fxPretty: IA_fxPretty, IA_fxFuncAt: IA_fxFuncAt, IA_fxBuild: IA_fxBuild, IA_fxScan: IA_fxScan, IA_fxRefAt: IA_fxRefAt, IA_fxUrl: IA_fxUrl };
  } else if (typeof window !== 'undefined' && window.document) {
    IA_fxInit();
  }
})();
