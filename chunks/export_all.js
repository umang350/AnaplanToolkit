/*
 * Anaplan Toolkit
 * Author: Umang Chauhan
 */
import { csvText } from './sv_shared.js';

/*
 * Summary's "Download all": every report cached for the model in front, as
 * one .zip of CSV files - the same files each view's Export to CSV writes,
 * one per tab for the views that have tabs.
 *
 * The hand-written views keep their CSV columns in their renderPage options,
 * so rather than copy them here they are imported in "collect" mode
 * (IA_COLLECT, see renderPage in sv_shared.js): each module hands its options
 * over instead of drawing. The four compiled views can't be imported that
 * way, so COMPILED mirrors the columns their own Export buttons write
 * (read off chunks/<page>-<hash>.js) - keep them in step if those change.
 *
 * Nothing leaves the browser: the payloads come from the worker's cache
 * (ia_dump) and the zip is built here.
 */

/* One literal import() per view: AMO's validator rejects import() with a
   computed path ("Unsafe call to import"). */
var HAND = [
  function () { return import('./filter_items.js'); },
  function () { return import('./page_line_items.js'); },
  function () { return import('./sv_views.js'); },
  function () { return import('./sv_line_items.js'); },
  function () { return import('./sv_screens.js'); },
  function () { return import('./sv_actions.js'); },
  function () { return import('./process_steps.js'); },
  function () { return import('./modules.js'); },
  function () { return import('./line_items.js'); },
  function () { return import('./lists.js'); },
  function () { return import('./revisions.js'); },
  function () { return import('./lock_monitor.js'); },
  function () { return import('./workspace.js'); },
  function () { return import('./workspace_all.js'); }
];

function nameId(x) { return { Name: x.label, Id: x.entityLongId }; }

var COMPILED = {
  actions: function (d) {
    d = d || {};
    return [
      ['processes.csv', (d.processes || []).map(nameId)],
      ['imports.csv', (d.imports || []).map(function (x) {
        var s = x.importDefinition && x.importDefinition.source;
        return { Name: x.label, Id: x.entityLongId, SourceID: s == null ? '' : String(s).replaceAll('_', '') };
      })],
      ['exports.csv', (d.exports || []).map(nameId)],
      ['actions.csv', (d.actions || []).map(nameId)],
      ['files.csv', (d.files || []).map(nameId)]
    ];
  },
  action_usages: function (d) {
    return [['action_usages.csv', (d || []).flatMap(function (w) {
      var rest = Object.assign({}, w);
      delete rest.actions;
      return (w.actions || []).map(function (a) { return Object.assign({}, rest, a); });
    })]];
  },
  pages: function (d) {
    return [['page_sources.csv', (d || []).flatMap(function (m) {
      return (m.pages || []).map(function (p) { return { Module: m.module, Page: p.name, Url: p.url }; });
    })]];
  },
  sv_filter_items: function (d) {
    return [['saved_view_filter_items.csv', (d || []).map(function (z) {
      return { Module: z.moduleName, 'Saved View': z.savedViewName, 'Item Type': z.itemType, Item: z.itemName };
    })]];
  }
};

var collected = null;
async function viewDefs() {
  if (collected) return collected;
  globalThis.IA_COLLECT = {};
  try {
    for (var i = 0; i < HAND.length; i++) {
      try { await HAND[i](); } catch (e) { /* that view is skipped */ }
    }
    collected = globalThis.IA_COLLECT;
  } finally {
    delete globalThis.IA_COLLECT;
  }
  return collected;
}

// [filename, rows] per tab of one hand-written view, as its Export button writes them.
function handFiles(opts, data) {
  return (opts.tabs || [opts]).map(function (t) {
    var rows = t.rows ? t.rows(data) : data;
    rows = Array.isArray(rows) ? rows : [];
    return [t.filename || opts.filename || opts.page + '.csv', t.csv ? t.csv(rows) : rows.map(t.csvRow),
            t.label || ''];
  });
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/* Files for every cached report: [{name, text}]. A report whose tabs share a
   file name (Workspace's Active / Archived / Deleted) gets the tab added to
   each, and empty tabs are left out - Export to CSV writes nothing for them
   either. `order` is the panel's report order. */
export async function buildFiles(pages, order, extra) {
  var defs = await viewDefs(), out = [], used = {};
  order.forEach(function (page) {
    var hit = pages[page];
    if (!hit) return;
    var files;
    try {
      files = COMPILED[page] ? COMPILED[page](hit.data) : defs[page] ? handFiles(defs[page], hit.data) : [];
    } catch (e) { files = []; }
    var dup = files.length > 1 && files.some(function (f, i) {
      return files.findIndex(function (g) { return g[0] === f[0]; }) !== i;
    });
    files.forEach(function (f) {
      if (!f[1] || !f[1].length) return;
      var name = dup && f[2] ? f[0].replace(/\.csv$/, '') + '-' + slug(f[2]) + '.csv' : f[0];
      while (used[name]) name = name.replace(/(?:-(\d+))?\.csv$/, function (_, n) { return '-' + ((+n || 1) + 1) + '.csv'; });
      used[name] = 1;
      out.push({ name: name, text: csvText(f[1]) });
    });
  });
  (extra || []).forEach(function (f) { if (f.rows && f.rows.length) out.push({ name: f.name, text: csvText(f.rows) }); });
  return out;
}

/* --- zip ------------------------------------------------------------------
   A minimal writer: one deflated entry per file (raw DEFLATE through the
   browser's CompressionStream; stored uncompressed where that is missing),
   UTF-8 names (flag bit 11), no zip64 - fine for the tens of MB at most a
   model's reports come to. */

var CRC = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(u) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

async function deflate(u) {
  if (typeof CompressionStream !== 'function') return null;
  try {
    var b = await new Response(new Blob([u]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
    return new Uint8Array(b);
  } catch (e) { return null; }
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  };
}

export async function zip(files) {
  var enc = new TextEncoder(), parts = [], central = [], offset = 0, when = dosTime(new Date());
  for (var i = 0; i < files.length; i++) {
    var name = enc.encode(files[i].name), raw = enc.encode(files[i].text),
        packed = await deflate(raw), method = packed && packed.length < raw.length ? 8 : 0,
        body = method ? packed : raw, crc = crc32(raw),
        head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true);
    head.setUint16(4, 20, true);
    head.setUint16(6, 0x0800, true);
    head.setUint16(8, method, true);
    head.setUint16(10, when.time, true);
    head.setUint16(12, when.date, true);
    head.setUint32(14, crc, true);
    head.setUint32(18, body.length, true);
    head.setUint32(22, raw.length, true);
    head.setUint16(26, name.length, true);
    parts.push(head, name, body);

    var cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, method, true);
    cd.setUint16(12, when.time, true);
    cd.setUint16(14, when.date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, raw.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, name);
    offset += 30 + name.length + body.length;
  }
  var size = central.reduce(function (n, p) { return n + p.byteLength; }, 0),
      end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob(parts.concat(central, [end]), { type: 'application/zip' });
}

export function save(blob, filename) {
  var url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
}
