'use strict';
(function () {

function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/* ══════════════════════════════════════
   1. 保存まわり
   ══════════════════════════════════════ */
var KEY = 'nippou.v1';
var CORRUPT_KEY = 'nippou.v1.corrupt';
var memoryOnly = false;
var memory = null;
var movedCorrupt = false;

try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); }
catch (e) { memoryOnly = true; }

/* 読めない保存データは、起動時の save() が空のデータで上書きする前に CORRUPT_KEY へ移す。
   移す空きが無いときは消してよいか聞き、断られたら保存せずに動いて壊れたデータを残す。 */
function loadDB() {
  if (memoryOnly) return memory;
  var raw;
  try { raw = localStorage.getItem(KEY); } catch (e) { return null; }
  if (!raw) return null;
  try {
    var db = JSON.parse(raw);
    if (db && typeof db === 'object' && !Array.isArray(db)) return db;
  } catch (e) {}
  try { localStorage.setItem(CORRUPT_KEY, raw); movedCorrupt = true; }
  catch (e) {
    if (!confirm('保存されていた記録が壊れていて読み込めません。端末の空き容量が足りず、壊れたデータを別の場所へ移すこともできませんでした。\n\n' +
                 'OK：壊れたデータを消して新しく始める\nキャンセル：壊れたデータを残す（今回入れた記録は保存されません）')) {
      memoryOnly = true;
    }
  }
  return null;
}
function save() {
  memory = DB;
  if (memoryOnly) return;
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch (e) { toast('保存できませんでした。端末の空き容量を確認してください'); }
}

function freshDB() {
  return {
    v: 6,
    categories: [{ id: 'c-base', name: '未分類' }],
    destinations: [],
    courses: [],
    reports: {},
    settings: {
      header: '', dateStyle: 'slash', transferStyle: 'src',
      pageName: 'inline', number: false, footer: '',
      lastExport: '', lastRemind: ''
    }
  };
}

/* 壊れた項目の補修と旧版からの移行。
   起動時とバックアップ読み込み時の両方から呼ぶ。 */
function migrate(db) {
  var base = freshDB();
  if (!db || typeof db !== 'object') db = base;
  if (!Array.isArray(db.categories) || !db.categories.length) db.categories = base.categories;
  if (!Array.isArray(db.destinations)) db.destinations = [];
  if (!Array.isArray(db.courses)) db.courses = [];
  if (!db.reports || typeof db.reports !== 'object') db.reports = {};
  if (!db.settings) db.settings = base.settings;
  for (var k in base.settings) if (!(k in db.settings)) db.settings[k] = base.settings[k];

  // 配送先データの補修（住所プロパティの補完）
  db.destinations.forEach(function (d) {
    if (typeof d.address !== 'string') d.address = '';
  });

  // カテゴリが消えた配送先は先頭カテゴリへ寄せる
  var ids = db.categories.map(function (c) { return c.id; });
  db.destinations.forEach(function (d) {
    if (ids.indexOf(d.catId) < 0) d.catId = db.categories[0].id;
  });

  // 存在しない配送先を指すコース項目を除く
  var dids = db.destinations.map(function (d) { return d.id; });
  db.courses.forEach(function (c) {
    if (typeof c.mapUrl !== 'string') c.mapUrl = '';
    if (!Array.isArray(c.items)) { c.items = []; return; }
    c.items = c.items.filter(function (id) { return dids.indexOf(id) >= 0; });
  });

  if (!db.v || db.v < 2) {
    // v1では from に「転送元の配送先ID」を持っていた。v2以降は「引き取った行のID」を持つ
    Object.keys(db.reports).forEach(function (key) {
      var stops = db.reports[key].stops || [];
      stops.forEach(function (st, i) {
        if (!st.from) return;
        var oldDest = st.from;
        st.from = null;
        for (var j = i - 1; j >= 0; j--) {
          if (stops[j].destId === oldDest) { st.from = stops[j].id; break; }
        }
      });
    });
    delete db.settings.group;
    if (['src', 'srcArrow', 'dest', 'none'].indexOf(db.settings.transferStyle) < 0) {
      db.settings.transferStyle = 'src';
    }
    db.v = 2;
  }

  if (db.v < 3) {
    // v2では1日1本のstops配列。v3では1日を複数ページに分ける。
    // v2の区切り行はページの境目だったので、そこで分割してラベルをページ名にする。
    Object.keys(db.reports).forEach(function (key) {
      var stops = db.reports[key].stops || [];
      var ps = [], cur = { id: uid('g-'), name: '', stops: [] };
      stops.forEach(function (st) {
        if (st.sep) {
          if (cur.stops.length) { ps.push(cur); cur = { id: uid('g-'), name: '', stops: [] }; }
          cur.name = st.label || '';
          return;
        }
        cur.stops.push(st);
      });
      ps.push(cur);
      db.reports[key] = { pages: ps };
    });
    if (['inline', 'line', 'none'].indexOf(db.settings.pageName) < 0) db.settings.pageName = 'inline';
    db.v = 3;
  }

  if (db.v < 4) {
    // v4 で destinations に address が加わった。値の補完は上の無条件の補修が兼ねるので、ここは版数の更新だけ
    db.v = 4;
  }

  if (db.v < 5) {
    // v5 で courses に mapUrl（ルートのURL）が加わった。補完は上の無条件の補修が兼ねる
    db.v = 5;
  }

  if (db.v < 6) {
    // v6 で settings に lastExport / lastRemind が加わった。
    // settings の欠損キーは上の for-in が base から補うので、ここは版数の更新だけ
    db.v = 6;
  }

  // ページ構造の補修
  Object.keys(db.reports).forEach(function (key) {
    var r = db.reports[key];
    if (!r || !Array.isArray(r.pages) || !r.pages.length) { delete db.reports[key]; return; }
    r.pages.forEach(function (g) {
      if (!g.id) g.id = uid('g-');
      if (typeof g.name !== 'string') g.name = '';
      if (!Array.isArray(g.stops)) g.stops = [];
      g.stops = g.stops.filter(function (x) { return x && !x.sep; });
    });
  });

  // 日付を前後に送っただけで作られた空の記録を捨てる（report() が get-or-create のため溜まる）。
  // 行が1つも無く、ページ名も付いていない日付だけが対象。情報を持つものは消さない。
  Object.keys(db.reports).forEach(function (key) {
    var empty = db.reports[key].pages.every(function (g) { return !g.stops.length && !g.name; });
    if (empty) delete db.reports[key];
  });
  return db;
}

var DB = migrate(loadDB() || freshDB());
save();   // 移行結果を書き戻す（次回起動で再移行しないように）

/* ══════════════════════════════════════
   2. 小道具
   ══════════════════════════════════════ */
function $(s) { return document.querySelector(s); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
/* 検索で比べる前に、全角／半角・大文字／小文字・ひらがな／カタカナの違いを畳む。
   問い合わせと探される側の両方に同じものを通すこと */
function foldText(s) {
  s = String(s);
  if (s.normalize) s = s.normalize('NFKC');
  return s.toLowerCase().replace(/[\u3041-\u3096]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) + 0x60);
  });
}
var WD = ['日', '月', '火', '水', '木', '金', '土'];
function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseKey(k) { var a = k.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
function shiftDate(k, n) { var d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }
function monthKeyOf(k) { return k.slice(0, 7); }
function fmtMonth(ym) { var a = ym.split('-'); return (+a[0]) + '年' + (+a[1]) + '月'; }

function fmtDate(k, style) {
  var d = parseKey(k), y = d.getFullYear(), m = d.getMonth() + 1, da = d.getDate(), w = WD[d.getDay()];
  if (style === 'slash0') return y + '/' + pad(m) + '/' + pad(da) + '(' + w + ')';
  if (style === 'dot') return y + '.' + pad(m) + '.' + pad(da) + '(' + w + ')';
  if (style === 'jp') return y + '年' + m + '月' + da + '日(' + w + ')';
  if (style === 'md') return m + '/' + da + '(' + w + ')';
  return y + '/' + m + '/' + da + '(' + w + ')';
}

/* 利用者が入力した URL は https: のものだけ通す。javascript: を保存されても開かないための門。
   保存時と開く直前の両方でこれを通すこと。 */
function safeUrl(u) {
  u = String(u == null ? '' : u).trim();
  return /^https:\/\//i.test(u) ? u : '';
}

/* 一覧に出すための短縮表示。開くときは必ず元の URL を safeUrl() に通すこと */
function shortUrl(u) {
  var s = String(u).replace(/^https:\/\//i, '');
  return s.length > 42 ? s.slice(0, 41) + '…' : s;
}

function destOf(id) { for (var i = 0; i < DB.destinations.length; i++) if (DB.destinations[i].id === id) return DB.destinations[i]; return null; }
function destName(id) { var d = destOf(id); return d ? d.name : '（削除された配送先）'; }
function catOf(id) { for (var i = 0; i < DB.categories.length; i++) if (DB.categories[i].id === id) return DB.categories[i]; return null; }
function catName(id) { var c = catOf(id); return c ? c.name : '未分類'; }
function newPage(name) { return { id: uid('g-'), name: name || '', stops: [] }; }
function report(k) {
  var r = DB.reports[k];
  if (!r || !Array.isArray(r.pages) || !r.pages.length) { r = DB.reports[k] = { pages: [newPage()] }; }
  return r;
}
function pagesOf(k) { return report(k).pages; }
function pageIdx(k) {
  var n = pagesOf(k).length, i = S.page;
  return (i == null || i < 0 || i >= n) ? 0 : i;
}
function curPage() { return pagesOf(S.date)[pageIdx(S.date)]; }
function curStops() { return curPage().stops; }
function pageLabel(g, i) { return g.name || ('ページ' + (i + 1)); }
/* 日付を開くときは最後のページを選ぶ。ページ1へ戻すと、2便目の行が1便目に入るため（SM-3c）。
   空でも最後にするのは、「＋ ページ」で次の便を始めた直後に開き直すことがあるため */
function lastPage(k) { return pagesOf(k).length - 1; }

var S = {
  tab: 'today',
  date: keyOf(new Date()),
  page: 0,
  pickFrom: null,
  pickChain: false,   // 選択画面の「転送」から届け先を選んでいる。選んだら選択画面に戻る
  pickMode: 'day',
  pickCat: '',
  course: null,
  editDest: null,
  stopId: null,
  monthKey: null,
  monthMode: 'full'
};

/* ══════════════════════════════════════
   3. 日報テキストの組み立て
   ══════════════════════════════════════ */
function dropsOf(st, stops) {
  return stops.filter(function (x) { return x.from === st.id; });
}
function pickupOf(st, stops) {
  if (!st.from) return null;
  return stops.filter(function (x) { return x.id === st.from; })[0] || null;
}

function lineFor(st, i, stops) {
  var s = DB.settings, line = destName(st.destId);

  if (s.transferStyle === 'src' || s.transferStyle === 'srcArrow') {
    var drops = dropsOf(st, stops);
    if (drops.length) {
      var names = [];
      drops.forEach(function (x) {
        var n = destName(x.destId);
        if (names.indexOf(n) < 0) names.push(n);
      });
      line += '（' + (s.transferStyle === 'srcArrow' ? '→' : '') + names.join('・') + '）';
    }
  } else if (s.transferStyle === 'dest') {
    var up = pickupOf(st, stops);
    if (up) line += ' ※' + destName(up.destId) + 'より転送';
  }

  if (s.number) line = (i + 1) + '. ' + line;
  if (st.note) line += ' ※' + st.note;
  return line;
}

// ヘッダー/フッターの差し込みタグを展開する。
// 「元は文字があったのに、展開したら空になった行」だけを落とす。
function fillTags(text, ctx) {
  if (!text) return '';
  var map = {
    'カテゴリ': ctx.cats,
    'ページ': ctx.page,
    '日付': ctx.date,
    '件数': ctx.count
  };
  return text.split('\n').map(function (line) {
    if (!line.trim()) return line;            // もともと空行はそのまま残す
    var had = /\{[^}]*\}/.test(line);
    var outLine = line.replace(/\{([^}]*)\}/g, function (m, key) {
      var v = map[key.trim()];
      return v == null ? m : v;
    });
    if (had && !outLine.trim()) return null;  // タグが空になって消えた行は落とす
    return outLine.replace(/[ \u3000]+$/, '');
  }).filter(function (x) { return x !== null; }).join('\n');
}

function pageCategories(stops) {
  var names = [];
  stops.forEach(function (st) {
    var d = destOf(st.destId); if (!d) return;
    var n = catName(d.catId);
    if (names.indexOf(n) < 0) names.push(n);
  });
  return names;
}

function buildText(k, idx) {
  var s = DB.settings, ps = pagesOf(k);
  var i = (idx == null) ? pageIdx(k) : idx;
  var g = ps[i]; if (!g) return '';
  var out = [];

  var ctx = {
    cats: pageCategories(g.stops).join('・'),
    page: pageLabel(g, i),
    date: fmtDate(k, s.dateStyle),
    count: String(g.stops.length)
  };
  var head = fillTags(String(s.header || ''), ctx).replace(/[\s\uFEFF]+$/, '');
  var foot = fillTags(String(s.footer || ''), ctx).replace(/^\n+|[\s\uFEFF]+$/g, '');
  var name = (s.pageName === 'none') ? '' : String(g.name || '').trim();

  if (head) out.push(head);
  out.push(fmtDate(k, s.dateStyle) + (name && s.pageName === 'inline' ? ' ' + name : ''));
  if (name && s.pageName === 'line') out.push(name);

  if (g.stops.length) {
    out.push('');
    g.stops.forEach(function (st, n) { out.push(lineFor(st, n, g.stops)); });
  }
  if (foot) { out.push(''); out.push(foot); }
  return out.join('\n').replace(/\s+$/, '');
}


/* 月のまとめ。日報1通の出力（buildText）とは別物として組み立てる。
   lineFor に渡す stops は必ずそのページの配列で、ページを跨いで連結しない。 */
var MRULE = '━━━━━━━━━━━━';

function monthStats(ym) {
  var days = [], count = 0;
  var destCnt = Object.create(null), courseCnt = Object.create(null);
  Object.keys(DB.reports).filter(function (k) { return monthKeyOf(k) === ym; }).sort()
    .forEach(function (k) {
      var pages = [], n = 0;
      pagesOf(k).forEach(function (g, i) {
        if (!g.stops.length) return;
        pages.push({ g: g, i: i });
        n += g.stops.length;
        var seen = Object.create(null);
        g.stops.forEach(function (x) {
          var nm = destName(x.destId);
          destCnt[nm] = (destCnt[nm] || 0) + 1;
          // コースは「ページ×コース」で1回。同じページで2回押しても2回にしない
          if (x.src && !seen[x.src]) { seen[x.src] = 1; courseCnt[x.src] = (courseCnt[x.src] || 0) + 1; }
        });
      });
      if (!pages.length) return;
      count += n;
      days.push({ k: k, pages: pages, n: n });
    });

  var byDest = Object.keys(destCnt).map(function (nm) { return { name: nm, n: destCnt[nm] }; })
    .sort(function (a, b) { return b.n - a.n || (a.name < b.name ? -1 : 1); });
  var byCourse = Object.keys(courseCnt).map(function (id) {
    var c = courseOf(id);
    return { name: c ? c.name : '（削除されたコース）', n: courseCnt[id] };
  }).sort(function (a, b) { return b.n - a.n; });

  return { days: days, count: count, byDest: byDest, byCourse: byCourse };
}

function buildMonthText(ym, mode) {
  var s = DB.settings, st = monthStats(ym), out = [], brief = (mode === 'brief');
  if (!st.days.length) return fmtMonth(ym) + ' の記録はありません。';

  var head = '【' + fmtMonth(ym) + 'の配送記録】';
  if (brief) {
    out.push(head + '稼働' + st.days.length + '日 / ' + st.count + '件');
    out.push('');
  } else {
    var first = st.days[0].k, last = st.days[st.days.length - 1].k;
    out.push(head);
    out.push(fmtDate(first, s.dateStyle) + '〜' + fmtDate(last, 'md') +
      ' 稼働' + st.days.length + '日 / ' + st.count + '件');
  }

  // 行番号は日報1通のための設定。月のまとめで使うと日ごとに 1. からやり直しになるので伏せる
  var keepNum = s.number;
  s.number = false;
  try {
    st.days.forEach(function (d) {
      if (brief) {
        var line = fmtDate(d.k, 'md') + ' ' + d.n + '件';
        if (d.pages.length > 1) {
          line += '（' + d.pages.map(function (p) {
            return pageLabel(p.g, p.i) + p.g.stops.length;
          }).join('・') + '）';
        }
        out.push(line);
        return;
      }
      out.push(MRULE);
      out.push(fmtDate(d.k, 'md') + ' ' + d.n + '件');
      d.pages.forEach(function (p) {
        if (d.pages.length > 1) out.push(' ' + pageLabel(p.g, p.i) + ' ' + p.g.stops.length + '件');
        p.g.stops.forEach(function (x, n) { out.push('  ・' + lineFor(x, n, p.g.stops)); });
      });
    });
    if (!brief) out.push(MRULE);
  } finally {
    s.number = keepNum;
  }

  if (st.byDest.length) {
    out.push('');
    if (brief) {
      out.push('よく行った先: ' + st.byDest.slice(0, 5).map(function (x) { return x.name + x.n; }).join(' / '));
    } else {
      out.push('■ よく行った先');
      st.byDest.slice(0, 10).forEach(function (x) { out.push('  ' + x.name + ' ' + x.n + '回'); });
    }
  }
  if (st.byCourse.length) {
    if (brief) {
      out.push('コース別: ' + st.byCourse.map(function (x) { return x.name + x.n + '回'; }).join(' / '));
    } else {
      out.push('');
      out.push('■ コース別');
      st.byCourse.forEach(function (x) { out.push('  ' + x.name + ' ' + x.n + '回'); });
    }
  }
  return out.join('\n').replace(/\s+$/, '');
}

/* ══════════════════════════════════════
   4. 描画
   ══════════════════════════════════════ */
var DOTS = '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/></svg>';
var PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
var BRANCH = '<svg viewBox="0 0 24 24"><path d="M8 4v9a4 4 0 0 0 4 4h5"/><path d="M14 13.5 17.5 17 14 20.5"/></svg>';
var UPIC   = '<svg viewBox="0 0 24 24"><path d="m6 14 6-6 6 6"/></svg>';
var DNIC   = '<svg viewBox="0 0 24 24"><path d="m6 10 6 6 6-6"/></svg>';
var XIC    = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
var MAP_PIN = '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>';

function openMap(addr) {
  if (!addr) return;
  var url = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
  window.open(url, '_blank', 'noopener,noreferrer');
}

function openRoute(cid) {
  var c = courseOf(cid), u = c ? safeUrl(c.mapUrl) : '';
  if (!u) { toast('このコースにはルートのURLが登録されていません'); return; }
  window.open(u, '_blank', 'noopener,noreferrer');
}

function renderToday() {
  var d = parseKey(S.date);
  $('#d-main').textContent = d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  $('#d-wd').textContent = WD[d.getDay()];
  $('#d-input').value = S.date;
  var isToday = S.date === keyOf(new Date());
  $('#d-today').classList.toggle('is-on', isToday);
  $('.datebar').classList.toggle('is-other', !isToday);

  renderPageBar();

  var stops = curStops();
  $('#stop-count').textContent = stops.length + '件';
  $('#route-empty').hidden = stops.length > 0;
  $('#btn-clear-today').hidden = stops.length === 0;

  $('#route').innerHTML = stops.map(function (st, i) {
    var dd = destOf(st.destId), tags = [];
    var up = pickupOf(st, stops);
    if (up) tags.push('<span class="tag tag-transfer">' + esc(destName(up.destId)) + 'から引き取り</span>');
    dropsOf(st, stops).forEach(function (x) {
      tags.push('<span class="tag tag-drop">→ ' + esc(destName(x.destId)) + ' へ</span>');
    });
    if (st.note) tags.push('<span class="tag tag-note">' + esc(st.note) + '</span>');
    if (dd) tags.push('<span class="tag">' + esc(catName(dd.catId)) + '</span>');
    return '<li class="stop' + (up ? ' is-transfer' : '') + '" data-menu="' + st.id + '">' +
      '<div class="stop-gutter"><span class="stop-grip" data-drag="route"><span class="stop-no">' + pad(i + 1) + '</span></span></div>' +
      '<div class="stop-body"><div class="stop-name">' + esc(destName(st.destId)) + '</div>' +
      (tags.length ? '<div class="stop-meta">' + tags.join('') + '</div>' : '') + '</div>' +
      '<button class="stop-menu" data-menu="' + st.id + '" aria-label="' + esc(destName(st.destId)) + 'の操作">' + DOTS + '</button>' +
      '</li>';
  }).join('');
}

function renderPageBar() {
  var ps = pagesOf(S.date), cur = pageIdx(S.date);
  var html = ps.map(function (g, i) {
    var on = i === cur, label = pageLabel(g, i);
    return '<span class="page-pill' + (on ? ' is-on' : '') + '">' +
      '<button class="page-tab" data-page="' + i + '"' + (on ? ' aria-current="page"' : '') + '>' +
        esc(label) + '<span class="chip-n">' + g.stops.length + '</span>' +
      '</button>' +
      (on ? '<button class="page-more" data-pagemenu="1" aria-label="' + esc(label) + 'の名前変更・削除">' + DOTS + '</button>' : '') +
      '</span>';
  }).join('');
  html += '<button class="chip chip-ghost" data-pagenew="1" aria-label="ページを追加">＋ ページ</button>';
  $('#pagerow').innerHTML = html;
}

function renderCourseRow() {
  var html = DB.courses.map(function (c) {
    var chip = '<button class="chip course-chip" data-course="' + c.id + '">' +
      esc(c.name) + '<span class="chip-n">' + c.items.length + '</span></button>';
    if (!safeUrl(c.mapUrl)) return chip;
    // ルートのURLがあるコースだけ、地図ボタンを並べた1つの丸にする
    return '<span class="course-pill">' + chip +
      '<button class="course-map" data-cmap="' + c.id + '" aria-label="' + esc(c.name) + 'を地図で開く">' +
      MAP_PIN + '</button></span>';
  }).join('');
  html += '<button class="chip chip-ghost" data-clist="1">' +
    (DB.courses.length ? 'コースを編集' : '＋ コースを作る') + '</button>';
  $('#courserow').innerHTML = html;
}

function courseOf(id) { return DB.courses.filter(function (x) { return x.id === id; })[0] || null; }

function applyCourse(cid) {
  var c = courseOf(cid);
  if (!c || !c.items.length) { toast('このコースには配送先が入っていません'); return false; }
  var g = curPage();
  undoSnapshot = snapPage(g);

  // 空で名前の無いページに入れるときは、コース名をページ名にする
  if (!g.stops.length && !g.name) g.name = c.name;

  c.items.forEach(function (destId) {
    if (!destOf(destId)) return;
    g.stops.push({ id: uid('s-'), destId: destId, from: null, note: '', src: cid });
    var d = destOf(destId); d.uses = (d.uses || 0) + 1;
  });
  save(); renderToday();
  toast(c.name + ' の' + c.items.length + '件を追加', '取り消す', undoApply);
  return true;
}

var undoSnapshot = null;
/* 取り消し用に、ページの行をその時点の中身ごと写す。
   行のオブジェクトを共有すると、取り消す前に書き換えた from や note までは戻らない */
function snapPage(g) {
  return { date: S.date, pageId: g.id, name: g.name, stops: JSON.parse(JSON.stringify(g.stops)) };
}
function undoApply() {
  if (!undoSnapshot) return;
  var u = undoSnapshot; undoSnapshot = null;
  var ps = pagesOf(u.date);
  for (var i = 0; i < ps.length; i++) {
    if (ps[i].id === u.pageId) {
      ps[i].stops = u.stops;
      if ('name' in u) ps[i].name = u.name;
      S.date = u.date; S.page = i;
      break;
    }
  }
  save(); renderToday(); toast('元に戻しました');
  if (openId === 'sh-pick') paintPickCounts();
}

/* 中身が空状態の案内文だけなら、器に is-empty を付ける。
   styles.css がそれを見て、余った縦をもらって案内を中央に置く。
   付けないと案内が画面の上に貼り付き、下に数百pxの空白が残る。
   中身があるときは何も足さないので、行の並びは変わらない。
   innerHTML を入れ替えたあとに必ず呼ぶこと。 */
function markEmpty(sel) {
  var el = $(sel);
  var only = el.children.length === 1 && el.firstElementChild.className === 'empty';
  el.classList.toggle('is-empty', only);
}

function renderCourseList() {
  if (!DB.courses.length) {
    $('#course-list').innerHTML = '<div class="empty"><p class="empty-title">コースがまだありません</p>' +
      '<p class="empty-sub">いつも同じ順番で回る先をまとめて登録しておくと、ボタン1つで日報に並びます。' +
      'Googleマップで組んだルートのURLも一緒に登録できます。</p></div>';
    markEmpty('#course-list');
    return;
  }
  // 見た目は配送先タブの行をそのまま流用する（.dest-row / .dest-main / .dest-actions）
  $('#course-list').innerHTML = '<div class="cat-block">' + DB.courses.map(function (c) {
    var maxShow = 2;
    var showNames = c.items.slice(0, maxShow).map(function (id) { return destName(id); }).join('、');
    var moreCount = c.items.length > maxShow ? c.items.length - maxShow : 0;
    var url = safeUrl(c.mapUrl);
    var routeLine = url
      ? '<div class="dest-addr">' + MAP_PIN + '<span>' + esc(shortUrl(url)) + '</span></div>'
      : '<div class="dest-addr is-none">' + MAP_PIN + '<span>ルート未登録 — タップして追加</span></div>';
    return '<div class="dest-row">' +
      '<button class="dest-main" data-cedit="' + c.id + '">' +
        '<div class="dest-name">' + esc(c.name) +
          '<span class="hist-n"> ' + c.items.length + '件</span></div>' +
        '<div class="dest-memo">' + esc(showNames) +
          (moreCount ? '（他' + moreCount + '）' : '') + '</div>' +
        routeLine +
      '</button>' +
      '<div class="dest-actions">' +
        (url ? '<button class="dest-map-btn" data-cmap="' + c.id + '" aria-label="' +
          esc(c.name) + 'を地図で開く">' + MAP_PIN + '</button>' : '') +
        '<button class="dest-add" data-course="' + c.id + '" aria-label="' +
          esc(c.name) + 'を日報に追加">' + PLUS + '<span>追加</span></button>' +
      '</div>' +
      '</div>';
  }).join('') + '</div>';
  markEmpty('#course-list');
}

function openCourseEditor(cid) {
  var c = cid ? DB.courses.filter(function (x) { return x.id === cid; })[0] : null;
  S.course = c
    ? { id: c.id, name: c.name, items: c.items.slice(), mapUrl: c.mapUrl || '' }
    : { id: null, name: '', items: [], mapUrl: '' };
  $('#sh-cedit-t').textContent = c ? 'コースを編集' : 'コースを作る';
  $('#c-name').value = S.course.name;
  $('#c-map').value = S.course.mapUrl;
  $('#c-del').hidden = !c;
  renderCourseItems();
  markClean('sh-cedit');
  openSheet('sh-cedit');
}

function renderCourseItems() {
  var it = S.course.items;
  $('#c-count').textContent = it.length + '件';
  if (!it.length) {
    $('#c-items').innerHTML = '<p class="pick-none">下のボタンから、回る順に配送先を足していきます。</p>';
    return;
  }
  $('#c-items').innerHTML = it.map(function (id, i) {
    return '<div class="citem">' +
      '<span class="cno" data-drag="course">' + pad(i + 1) + '</span>' +
      '<span class="cname">' + esc(destName(id)) + '</span>' +
      '<button data-cup="' + i + '" aria-label="上へ"' + (i === 0 ? ' disabled' : '') + '>' + UPIC + '</button>' +
      '<button data-cdn="' + i + '" aria-label="下へ"' + (i === it.length - 1 ? ' disabled' : '') + '>' + DNIC + '</button>' +
      '<button class="del" data-crm="' + i + '" aria-label="外す">' + XIC + '</button>' +
      '</div>';
  }).join('');
}

function renderDest() {
  var html = '';
  DB.categories.forEach(function (c) {
    var items = DB.destinations.filter(function (d) { return d.catId === c.id && !d.archived; });
    if (!items.length) return;
    html += '<div class="cat-block"><div class="cat-title">' + esc(c.name) +
      '<span class="hist-n">' + items.length + '</span></div>';
    items.forEach(function (d) {
      var mapBtn = d.address
        ? '<button class="dest-map-btn" data-map="' + esc(d.address) + '" aria-label="' + esc(d.name) + 'の地図を開く">' + MAP_PIN + '</button>'
        : '';
      html += '<div class="dest-row">' +
        '<button class="dest-main" data-edit="' + d.id + '">' +
        '<div class="dest-name">' + esc(d.name) + '</div>' +
        (d.address ? '<div class="dest-addr">' + MAP_PIN + '<span>' + esc(d.address) + '</span></div>' : '') +
        (d.memo ? '<div class="dest-memo">' + esc(d.memo) + '</div>' : '') +
        '</button>' +
        '<div class="dest-actions">' +
          mapBtn +
          '<button class="dest-add" data-quick="' + d.id + '" aria-label="' + esc(d.name) + 'を' + fmtDate(S.date, 'md') + 'の日報に追加">' +
            PLUS + '<span>追加</span></button>' +
        '</div>' +
        '</div>';
    });
    html += '</div>';
  });
  if (!html) {
    html = '<div class="empty"><p class="empty-title">配送先がまだ登録されていません</p>' +
      '<p class="empty-sub">下のボタンから登録します。一度入れておけば、次からは選ぶだけで日報に載ります。</p></div>';
  }
  $('#dest-list').innerHTML = html;
  markEmpty('#dest-list');

  var arch = DB.destinations.filter(function (d) { return d.archived; });
  $('#archive-box').hidden = arch.length === 0;
  $('#archive-list').innerHTML = arch.map(function (d) {
    return '<div class="arch-row"><span>' + esc(d.name) + '</span>' +
      '<button class="chip" data-restore="' + d.id + '">戻す</button></div>';
  }).join('');
}

function renderHist() {
  var rows = [];
  Object.keys(DB.reports).sort().reverse().forEach(function (k) {
    var ps = DB.reports[k].pages || [];
    var many = ps.filter(function (g) { return g.stops.length; }).length > 1;
    ps.forEach(function (g, i) {
      if (!g.stops.length) return;
      rows.push({ k: k, i: i, g: g, many: many });
    });
  });

  if (!rows.length) {
    $('#hist-list').innerHTML = '<div class="empty"><p class="empty-title">履歴はまだありません</p>' +
      '<p class="empty-sub">日報を1件でも記録すると、ここに日付が並びます。</p></div>';
    markEmpty('#hist-list');
    return;
  }

  // 月ごとにまとめる（並びは日付の降順のまま）
  var months = [];
  rows.forEach(function (r) {
    var ym = monthKeyOf(r.k), cur = months[months.length - 1];
    if (!cur || cur.ym !== ym) { cur = { ym: ym, rows: [] }; months.push(cur); }
    cur.rows.push(r);
  });

  $('#hist-list').innerHTML = months.map(function (m) {
    var ms = monthStats(m.ym);
    var head = '<div class="hist-month">' +
      '<span class="hist-month-t">' + esc(fmtMonth(m.ym)) + '</span>' +
      '<span class="hist-n">' + ms.days.length + '日 / ' + ms.count + '件</span>' +
      '<button class="chip" data-month="' + m.ym + '">まとめて出力</button>' +
      '</div>';
    return head + m.rows.map(function (r, n) {
      var stp = r.g.stops, maxShow = 2;
      var showNames = stp.slice(0, maxShow).map(function (x) { return destName(x.destId); }).join('、');
      var more = stp.length > maxShow ? '<span class="hist-sub-more">（他' + (stp.length - maxShow) + '）</span>' : '';
      var badge = r.many ? '<span class="hist-page">' + esc(pageLabel(r.g, r.i)) + '</span>' : '';
      return '<button class="hist-row' + (n === m.rows.length - 1 ? ' is-last' : '') + '"' +
        ' data-date="' + r.k + '" data-hpage="' + r.i + '">' +
        '<span class="hist-main">' +
          '<span class="hist-date">' + esc(fmtDate(r.k, 'slash0')) + badge + '</span>' +
          '<span class="hist-sub"><span class="hist-sub-name">' + esc(showNames) + '</span>' + more + '</span>' +
        '</span>' +
        '<span class="hist-n">' + stp.length + '件</span></button>';
    }).join('');
  }).join('');
  markEmpty('#hist-list');
}

function render() {
  if (S.tab === 'today') { renderToday(); renderCourseRow(); }
  if (S.tab === 'dest') renderDest();
  if (S.tab === 'course') renderCourseList();
  if (S.tab === 'hist') renderHist();
}

/* ══════════════════════════════════════
   5. タブ / シート
   ══════════════════════════════════════ */
function setTab(name) {
  S.tab = name;
  $('#tab-today').hidden = name !== 'today';
  $('#tab-dest').hidden = name !== 'dest';
  $('#tab-course').hidden = name !== 'course';
  $('#tab-hist').hidden = name !== 'hist';
  Array.prototype.forEach.call(document.querySelectorAll('.tabbtn'), function (b) {
    var on = b.dataset.tab === name;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('#actionbar').hidden = name === 'hist';
  document.body.classList.toggle('no-actions', name === 'hist');
  $('#btn-output').hidden = name !== 'today';
  $('#btn-add').innerHTML =
    name === 'dest' ? '<span class="plus" aria-hidden="true">＋</span> 新しい配送先を登録' :
    name === 'course' ? '<span class="plus" aria-hidden="true">＋</span> 新しいコースを作る' :
    '<span class="plus" aria-hidden="true">＋</span> 配送先を追加';
  window.scrollTo(0, 0);
  render();
}

var openId = null, backTo = null;
function openSheet(id, back) {
  if (openId) $('#' + openId).hidden = true;
  openId = id; backTo = back || null;
  $('#scrim').hidden = false;
  $('#' + id).hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeSheet() {
  var back = backTo;
  if (openId) $('#' + openId).hidden = true;
  openId = null; backTo = null;
  if (back) { openSheet(back); return; }
  $('#scrim').hidden = true;
  document.body.style.overflow = '';
}

/* 入力途中のシートは、閉じる前に確かめる（SM-3b）。開いたときの値の組と比べる。
   基準は各エディタを開く関数で取る。openSheet で取ると、コース編集が選択画面から戻ったときに取り直してしまう */
var FORM_SIG = {
  'sh-dest': function () { return [$('#dest-name').value, $('#dest-cat').value, $('#dest-addr').value, $('#dest-memo').value].join('\n'); },
  'sh-cedit': function () { return [$('#c-name').value, $('#c-map').value, S.course.items.join(',')].join('\n'); },
  'sh-page': function () { return $('#page-name').value; }
};
var formBase = {};
function markClean(id) { formBase[id] = FORM_SIG[id](); }
function requestClose() {
  var sig = FORM_SIG[openId];
  if (sig && sig() !== formBase[openId] && !confirm('入力した内容は保存されていません。閉じますか？')) return;
  closeSheet();
}

var toastTimer = null, toastFn = null;
function toast(msg, actLabel, fn) {
  var t = $('#toast'), a = $('#toast-act');
  $('#toast-msg').textContent = msg;
  toastFn = fn || null;
  if (actLabel) { a.textContent = actLabel; a.hidden = false; } else { a.hidden = true; }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; toastFn = null; }, actLabel ? 6000 : 1500);
}

/* ══════════════════════════════════════
   6. 配送先ピッカー
   ══════════════════════════════════════ */
function openPicker(fromStopId, mode) {
  S.pickMode = mode || 'day';
  S.pickFrom = fromStopId || null;
  S.pickChain = false;
  S.pickCat = '';
  $('#pick-search').value = '';
  var hint = $('#pick-hint');
  if (fromStopId) {
    var src = curStops().filter(function (x) { return x.id === fromStopId; })[0];
    hint.hidden = false;
    hint.textContent = (src ? destName(src.destId) : '') + ' で引き取った品物の届け先は？';
  } else hint.hidden = true;
  if (S.pickMode === 'course') {
    hint.hidden = false;
    hint.textContent = '回る順にタップしてください。続けて選べます。';
    $('#sh-pick-t').textContent = 'コースに追加';
  } else {
    $('#sh-pick-t').textContent = fromStopId ? '届け先を選ぶ' : '配送先を選ぶ';
  }
  renderPickCats();
  renderPickList();
  openSheet('sh-pick', S.pickMode === 'course' ? 'sh-cedit' : null);
}

function addToCourse(destId) {
  S.course.items.push(destId);
  renderCourseItems();
  paintPickCounts();
  toast(destName(destId) + ' を追加（計' + S.course.items.length + '件）');
}

/* 選択画面の各行に、いまのページ（コースなら編集中のコース）に入っている回数を出す。
   足すたびに一覧を作り直すと「よく使う」の並びが入れ替わるので、印だけを書き換える */
function paintPickCounts() {
  var ids = S.pickMode === 'course' ? S.course.items : curStops().map(function (x) { return x.destId; });
  var n = {};
  ids.forEach(function (id) { n[id] = (n[id] || 0) + 1; });
  Array.prototype.forEach.call(document.querySelectorAll('#pick-list [data-pick]'), function (b) {
    var c = n[b.dataset.pick] || 0, m = b.querySelector('.pick-n');
    m.hidden = !c;
    m.textContent = '✓ ' + c;
    b.parentNode.classList.toggle('is-in', c > 0);
  });
}

function renderPickCats() {
  var used = DB.categories.filter(function (c) {
    return DB.destinations.some(function (d) { return d.catId === c.id && !d.archived; });
  });
  if (used.length < 2) { $('#pick-cats').innerHTML = ''; return; }
  $('#pick-cats').innerHTML =
    '<button class="chip' + (S.pickCat === '' ? ' is-on' : '') + '" data-pcat="">すべて</button>' +
    used.map(function (c) {
      return '<button class="chip' + (S.pickCat === c.id ? ' is-on' : '') + '" data-pcat="' + c.id + '">' + esc(c.name) + '</button>';
    }).join('');
}

function renderPickList() {
  var q = foldText($('#pick-search').value).trim();
  var pool = DB.destinations.filter(function (d) {
    if (d.archived) return false;
    if (S.pickCat && d.catId !== S.pickCat) return false;
    if (q && foldText(d.name + ' ' + (d.memo || '') + ' ' + (d.address || '')).indexOf(q) < 0) return false;
    return true;
  });

  if (!pool.length) {
    $('#pick-list').innerHTML = '<p class="pick-none">' +
      (DB.destinations.length ? '見つかりませんでした' : 'まだ配送先がありません。下から登録してください。') + '</p>';
    return;
  }

  function row(d) {
    var subItems = [esc(catName(d.catId))];
    if (d.address) subItems.push(esc(d.address));
    if (d.memo) subItems.push(esc(d.memo));
    return '<div class="pick-item' + (S.pickMode === 'course' ? ' solo' : '') + '">' +
      '<button class="pick-row" data-pick="' + d.id + '">' +
        '<div class="pick-text">' +
          '<div class="pick-name">' + esc(d.name) + '</div>' +
          '<div class="pick-sub">' + subItems.join(' ・ ') + '</div>' +
        '</div>' +
        '<span class="pick-n" hidden></span>' +
      '</button>' +
      (S.pickMode === 'course' ? '' :
        '<button class="pick-tf" data-picktf="' + d.id + '" aria-label="' + esc(d.name) + 'で転送を引き取った">' +
        BRANCH + '<span>転送</span></button>') +
      '</div>';
  }

  var html = '';
  if (!q && !S.pickCat) {
    var recent = pool.slice().sort(function (a, b) { return (b.uses || 0) - (a.uses || 0); })
      .filter(function (d) { return d.uses; }).slice(0, 5);
    if (recent.length) {
      html += '<div class="pick-group"><div class="pick-label">よく使う</div>' + recent.map(row).join('') + '</div>';
    }
    DB.categories.forEach(function (c) {
      var items = pool.filter(function (d) { return d.catId === c.id; });
      if (!items.length) return;
      html += '<div class="pick-group"><div class="pick-label">' + esc(c.name) + '</div>' + items.map(row).join('') + '</div>';
    });
  } else {
    html = '<div class="pick-group">' + pool.map(row).join('') + '</div>';
  }
  $('#pick-list').innerHTML = html;
  paintPickCounts();
}

/* 足しても選択画面は閉じない（SM-3b）。続けて足せる。
   転送の届け先を選んだときは、来た所へ戻る。行のメニューからなら閉じ、選択画面の「転送」からなら選択画面へ */
function addStop(destId, thenTransfer) {
  var st = { id: uid('s-'), destId: destId, from: S.pickFrom || null, note: '' };
  undoSnapshot = snapPage(curPage());
  curStops().push(st);
  var d = destOf(destId); if (d) d.uses = (d.uses || 0) + 1;
  var wasDrop = !!S.pickFrom, chain = S.pickChain;
  S.pickFrom = null;
  save();
  if (S.tab !== 'today') setTab('today'); else renderToday();

  if (thenTransfer) {
    openPicker(st.id);
    S.pickChain = true;
    return;
  }
  if (wasDrop && !chain) closeSheet();
  else if (wasDrop) openPicker(null);
  else if (openId !== 'sh-pick') { openSheet('sh-pick'); renderPickCats(); renderPickList(); }
  else paintPickCounts();
  toast(destName(destId) + (wasDrop ? ' を届け先として追加' : ' を追加（計' + curStops().length + '件）'), '取り消す', undoApply);
}

/* ══════════════════════════════════════
   7. 配送先の登録・編集
   ══════════════════════════════════════ */
var catPrev = '';   // 「＋ 新しいカテゴリを作る…」を取り消したときに戻す先
function fillCatSelect(selected) {
  $('#dest-cat').innerHTML = DB.categories.map(function (c) {
    return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
  }).join('') + '<option value="__new">＋ 新しいカテゴリを作る…</option>';
  $('#dest-cat').value = selected || DB.categories[0].id;
  catPrev = $('#dest-cat').value;
}

/* 新しい配送先のカテゴリの初期値。先頭の「未分類」にすると、選び忘れた配送先が
   キットで取引先への請求から外れるので、いま使っているカテゴリを選んでおく。
   ピッカーで絞り込んでいればそのカテゴリ、無ければ最後に登録した配送先のカテゴリ。 */
function newDestCat() {
  if (S.pickReturn && catOf(S.pickCat)) return S.pickCat;
  var last = DB.destinations[DB.destinations.length - 1];
  return last ? last.catId : DB.categories[0].id;
}

function openDestEditor(id) {
  S.editDest = id || null;
  var d = id ? destOf(id) : null;
  $('#sh-dest-t').textContent = d ? '配送先を編集' : '配送先を登録';
  $('#dest-name').value = d ? d.name : '';
  $('#dest-addr').value = d ? (d.address || '') : '';
  $('#dest-memo').value = d ? (d.memo || '') : '';
  fillCatSelect(d ? d.catId : newDestCat());
  $('#dest-del').hidden = !d;
  markClean('sh-dest');
  openSheet('sh-dest');
  if (!d) setTimeout(function () { $('#dest-name').focus(); }, 120);
}

function saveDest() {
  var name = $('#dest-name').value.trim();
  if (!name) { toast('配送先名を入力してください'); $('#dest-name').focus(); return; }
  var catId = $('#dest-cat').value;
  if (catId === '__new') { toast('カテゴリを選び直してください'); return; }
  var address = $('#dest-addr').value.trim();
  var memo = $('#dest-memo').value.trim();

  if (S.editDest) {
    var d = destOf(S.editDest);
    d.name = name; d.catId = catId; d.address = address; d.memo = memo;
    save(); closeSheet(); render(); toast('保存しました');
  } else {
    var nd = { id: uid('d-'), name: name, catId: catId, address: address, memo: memo, uses: 0 };
    DB.destinations.push(nd);
    save();
    // ピッカー経由で登録したときは、そのまま今日の日報に入れる
    if (S.pickReturn) {
      S.pickReturn = false;
      if (S.pickMode === 'course') { addToCourse(nd.id); closeSheet(); openSheet('sh-cedit'); return; }
      addStop(nd.id); return;
    }
    closeSheet(); render(); toast('「' + name + '」を登録しました');
  }
}

/* ══════════════════════════════════════
   8. カテゴリ
   ══════════════════════════════════════ */
function renderCats() {
  $('#cat-list').innerHTML = DB.categories.map(function (c, i) {
    var n = DB.destinations.filter(function (d) { return d.catId === c.id && !d.archived; }).length;
    return '<div class="cat-item">' +
      '<input type="text" value="' + esc(c.name) + '" data-cat="' + c.id + '" aria-label="カテゴリ名">' +
      '<span class="hist-n">' + n + '</span>' +
      (DB.categories.length > 1
        ? '<button class="del" data-catdel="' + c.id + '" aria-label="' + esc(c.name) + 'を削除"><svg viewBox="0 0 24 24"><path d="M6 7h12M10 7V5h4v2M9 7v12M15 7v12M5 7l1 13h12l1-13"/></svg></button>'
        : '<span></span>') +
      '</div>';
  }).join('');
}

/* ══════════════════════════════════════
   9. 設定
   ══════════════════════════════════════ */
function loadSettingsForm() {
  var s = DB.settings;
  $('#set-header').value = s.header;
  $('#set-footer').value = s.footer;
  $('#set-datestyle').value = s.dateStyle;
  $('#set-transfer').value = s.transferStyle;
  $('#set-pagename').value = s.pageName;
  $('#set-number').checked = !!s.number;
  if (memoryOnly) {
    $('#storage-note').textContent = 'この環境ではブラウザ保存が使えないため、タブを閉じると内容が消えます。GitHub Pages などで開くと保存されます。';
  } else {
    $('#storage-note').textContent =
      'データは端末のブラウザ内にだけ保存されます。ホーム画面に追加して使うと消えにくくなります。機種変更の前にはバックアップを書き出してください。\n' +
      (s.lastExport
        ? '最後に書き出したのは ' + fmtDate(s.lastExport, 'slash0') + ' です。'
        : 'まだ一度も書き出していません。');
  }
}
function bindSettings() {
  function on(id, prop, isCheck) {
    $(id).addEventListener('change', function () {
      DB.settings[prop] = isCheck ? this.checked : this.value;
      save();
    });
  }
  on('#set-header', 'header'); on('#set-footer', 'footer');
  on('#set-datestyle', 'dateStyle'); on('#set-transfer', 'transferStyle');
  on('#set-pagename', 'pageName');
  on('#set-number', 'number', true);
}

function stopCount() {
  var n = 0;
  Object.keys(DB.reports).forEach(function (k) {
    pagesOf(k).forEach(function (g) { n += g.stops.length; });
  });
  return n;
}

function daysBetween(a, b) {
  return Math.round((parseKey(b) - parseKey(a)) / 86400000);
}

/* 起動時に一度だけ、バックアップを促す。
   localStorage は Safari のデータ削除や iOS の破棄で消えるので、これが唯一の予防線。 */
function backupReminder() {
  if (memoryOnly) return;
  var s = DB.settings, today = keyOf(new Date());
  if (stopCount() < 20) return;                                   // 使い始めの人には出さない
  if (s.lastExport && daysBetween(s.lastExport, today) < 30) return;
  if (s.lastRemind && daysBetween(s.lastRemind, today) < 7) return;  // 促すのは7日に1回まで
  s.lastRemind = today;
  save();
  toast(s.lastExport
    ? 'バックアップを書き出してから30日以上たっています'
    : '記録がたまっています。バックアップを書き出しておくと安心です',
    '書き出す', exportJSON);
}

function exportJSON() {
  DB.settings.lastExport = keyOf(new Date());
  save();
  var blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'nippou-backup-' + keyOf(new Date()) + '.json';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  toast('バックアップを書き出しました');
}

/* ══════════════════════════════════════
   10. 出力
   ══════════════════════════════════════ */
function openOutput() {
  var ps = pagesOf(S.date), i = pageIdx(S.date);
  $('#sh-out-t').textContent = ps.length > 1
    ? '日報テキスト — ' + pageLabel(ps[i], i)
    : '日報テキスト';
  $('#out-text').textContent = buildText(S.date, i);
  openSheet('sh-out');
}

function openMonthOutput(ym) {
  S.monthKey = ym;
  S.monthMode = 'full';
  $('#sh-mout-t').textContent = fmtMonth(ym) + 'のまとめ';
  renderMonthOut();
  openSheet('sh-mout');
}
function renderMonthOut() {
  var t = buildMonthText(S.monthKey, S.monthMode);
  $('#mout-text').textContent = t;
  $('#mout-note').textContent = '約' + t.length + '字' +
    (S.monthMode === 'full' ? '（LINEへ直接送るときは「要約」を使ってください）' : '');
  Array.prototype.forEach.call(document.querySelectorAll('[data-mmode]'), function (b) {
    b.classList.toggle('is-on', b.dataset.mmode === S.monthMode);
  });
}
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).then(function () { toast('コピーしました'); }, fallback);
  } else fallback();
  function fallback() {
    var ta = document.createElement('textarea');
    ta.value = t; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0, t.length);
    try { document.execCommand('copy'); toast('コピーしました'); }
    catch (e) { toast('コピーできませんでした。長押しで選択してください'); }
    ta.remove();
  }
}

/* ══════════════════════════════════════
   11. イベント配線
   ══════════════════════════════════════ */
document.addEventListener('click', function (ev) {
  var t = ev.target.closest ? ev.target.closest('[data-tab],[data-menu],[data-pick],[data-picktf],[data-pcat],[data-edit],[data-quick],[data-date],[data-catdel],[data-restore],[data-close],[data-course],[data-clist],[data-cedit],[data-cup],[data-cdn],[data-crm],[data-clear],[data-page],[data-pagenew],[data-pagemenu],[data-hpage],[data-map],[data-month],[data-mmode],[data-cmap]') : null;
  if (!t) return;

  if (t.dataset.map) { openMap(t.dataset.map); return; }

  if (t.dataset.clear === 'today') {
    var gc = curPage();
    if (!gc.stops.length) return;
    var ps = pagesOf(S.date);
    var who = ps.length > 1 ? fmtDate(S.date, 'md') + ' の' + pageLabel(gc, pageIdx(S.date)) : fmtDate(S.date, 'md');
    if (!confirm(who + ' の記録（' + gc.stops.length + '件）をすべて消去しますか？')) return;
    undoSnapshot = snapPage(gc);
    gc.stops = [];
    save(); renderToday();
    toast('すべての記録をクリアしました', '取り消す', undoApply);
    return;
  }

  if (t.hasAttribute('data-close')) { requestClose(); return; }
  if (t.dataset.tab) { setTab(t.dataset.tab); return; }

  if (t.dataset.menu) {
    S.stopId = t.dataset.menu;
    var stops = curStops();
    var st = stops.filter(function (x) { return x.id === S.stopId; })[0];
    if (!st) return;
    var u = pickupOf(st, stops);
    $('#stop-target').textContent = destName(st.destId) + (u ? '（' + destName(u.destId) + 'から引き取り）' : '');
    $('#stop-note').value = st.note || '';
    var dd = destOf(st.destId);
    if (dd && dd.address) {
      $('#stop-map').hidden = false;
      $('#stop-map-addr').textContent = dd.address;
      $('#stop-map').dataset.map = dd.address;
    } else {
      $('#stop-map').hidden = true;
      delete $('#stop-map').dataset.map;
    }
    openSheet('sh-stop');
    return;
  }

  if (t.dataset.pick) {
    if (S.pickMode === 'course') { addToCourse(t.dataset.pick); return; }
    addStop(t.dataset.pick, false); return;
  }
  if (t.dataset.picktf) { addStop(t.dataset.picktf, true); return; }

  if (t.dataset.pagenew) { addPage(); return; }
  if (t.dataset.pagemenu) { openPageSheet(); return; }
  if (t.dataset.page != null) {
    var pi = +t.dataset.page;
    if (pi === pageIdx(S.date)) { openPageSheet(); return; }
    S.page = pi; renderToday(); return;
  }

  if (t.dataset.cmap) { openRoute(t.dataset.cmap); return; }
  if (t.dataset.course) {
    // コースタブから足したときは、結果が見える日報タブへ移る
    if (applyCourse(t.dataset.course) && S.tab === 'course') setTab('today');
    return;
  }
  if (t.dataset.clist) { setTab('course'); return; }
  if (t.dataset.cedit) { openCourseEditor(t.dataset.cedit); return; }
  if (t.dataset.cup || t.dataset.cdn) {
    var up = 'cup' in t.dataset;
    var i = +(up ? t.dataset.cup : t.dataset.cdn), j = i + (up ? -1 : 1);
    var arr = S.course.items;
    if (j < 0 || j >= arr.length) return;
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    renderCourseItems(); return;
  }
  if (t.dataset.crm) {
    S.course.items.splice(+t.dataset.crm, 1);
    renderCourseItems(); return;
  }
  if (t.hasAttribute('data-pcat')) { S.pickCat = t.dataset.pcat; renderPickCats(); renderPickList(); return; }
  if (t.dataset.edit) { openDestEditor(t.dataset.edit); return; }

  if (t.dataset.quick) {
    S.pickFrom = null;
    var d0 = destOf(t.dataset.quick);
    var g0 = curPage();
    undoSnapshot = snapPage(g0);
    g0.stops.push({ id: uid('s-'), destId: d0.id, from: null, note: '' });
    d0.uses = (d0.uses || 0) + 1;
    save();
    var ps0 = pagesOf(S.date);
    toast(d0.name + ' を ' + fmtDate(S.date, 'md') +
      (ps0.length > 1 ? ' の' + pageLabel(g0, pageIdx(S.date)) : '') + ' に追加', '取り消す', undoApply);
    return;
  }

  if (t.dataset.month) { openMonthOutput(t.dataset.month); return; }
  if (t.dataset.mmode) { S.monthMode = t.dataset.mmode; renderMonthOut(); return; }

  if (t.dataset.date) {
    S.date = t.dataset.date;
    S.page = t.dataset.hpage ? +t.dataset.hpage : 0;
    setTab('today'); return;
  }

  if (t.dataset.catdel) {
    var cid = t.dataset.catdel;
    var moved = DB.destinations.filter(function (d) { return d.catId === cid; });
    var other = DB.categories.filter(function (c) { return c.id !== cid; })[0];
    if (!other) return;
    if (moved.length && !confirm('「' + catName(cid) + '」を削除します。中の' + moved.length + '件は「' + other.name + '」へ移動します。')) return;
    moved.forEach(function (d) { d.catId = other.id; });
    DB.categories = DB.categories.filter(function (c) { return c.id !== cid; });
    save(); renderCats(); render();
    return;
  }

  if (t.dataset.restore) {
    var dr = destOf(t.dataset.restore);
    if (dr) { dr.archived = false; save(); renderDest(); toast('戻しました'); }
    return;
  }
});

$('#cat-list').addEventListener('change', function (ev) {
  var el = ev.target;
  if (!el.dataset.cat) return;
  var c = catOf(el.dataset.cat);
  var v = el.value.trim();
  if (!v) { el.value = c.name; return; }
  c.name = v; save(); render();
});

$('#scrim').addEventListener('click', requestClose);
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (drag) { dragEnd(false); return; }
  if (openId) requestClose();
});

/* 日付 */
function goDate(k) { S.date = k; S.page = lastPage(k); renderToday(); }
$('#d-prev').addEventListener('click', function () { goDate(shiftDate(S.date, -1)); });
$('#d-next').addEventListener('click', function () { goDate(shiftDate(S.date, 1)); });
$('#d-today').addEventListener('click', function () { goDate(keyOf(new Date())); });
$('#d-input').addEventListener('change', function () { if (this.value) goDate(this.value); });

/* 開いたまま日付が変わったら、画面に戻ったときに今日へ移す（SM-3c）。
   過去の日を見ていたときは、利用者が選んだ日なので動かさない。
   開いていたシートは前の日を指しているので閉じる。出力シートのまま送ると、今日の空の日報が出てしまう。 */
var seenToday = S.date;
function followToday() {
  var today = keyOf(new Date());
  if (today === seenToday) return;
  var wasToday = S.date === seenToday;
  seenToday = today;
  if (!wasToday) return;
  backTo = null;
  if (openId) closeSheet();
  S.date = today;
  S.page = lastPage(today);
  render();
}
document.addEventListener('visibilitychange', function () { if (!document.hidden) followToday(); });
window.addEventListener('pageshow', followToday);

/* 主要ボタン */
$('#btn-add').addEventListener('click', function () {
  if (S.tab === 'dest') { S.pickReturn = false; openDestEditor(null); }
  else if (S.tab === 'course') openCourseEditor(null);
  else openPicker(null);
});
$('#btn-output').addEventListener('click', openOutput);
$('#btn-settings').addEventListener('click', function () { loadSettingsForm(); openSheet('sh-set'); });
$('#btn-cat-manage').addEventListener('click', function () { renderCats(); openSheet('sh-cat'); });

/* ピッカー */
$('#pick-search').addEventListener('input', renderPickList);
$('#pick-new').addEventListener('click', function () { S.pickReturn = true; openDestEditor(null); });

/* 配送先エディタ */
$('#dest-save').addEventListener('click', saveDest);
$('#dest-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveDest(); });
$('#dest-addr').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveDest(); });
$('#dest-memo').addEventListener('keydown', function (e) { if (e.key === 'Enter') saveDest(); });
$('#dest-cat').addEventListener('change', function () {
  if (this.value !== '__new') { catPrev = this.value; return; }
  var name = prompt('新しいカテゴリ名');
  if (name && name.trim()) {
    var c = { id: uid('c-'), name: name.trim() };
    DB.categories.push(c); save();
    fillCatSelect(c.id);
    if (S.tab === 'dest') renderDest();
  } else {
    this.value = catPrev;
  }
});
$('#dest-del').addEventListener('click', function () {
  var d = destOf(S.editDest);
  if (!d) return;
  if (!confirm('「' + d.name + '」を一覧から外します。過去の日報の記録はそのまま残ります。')) return;
  d.archived = true; save(); closeSheet(); render(); toast('削除しました');
});

/* 行メニュー */
function currentStop() {
  return curStops().filter(function (x) { return x.id === S.stopId; })[0];
}
function moveStop(dir) {
  var stops = curStops(), i = stops.findIndex(function (x) { return x.id === S.stopId; });
  var j = i + dir;
  if (i < 0 || j < 0 || j >= stops.length) { toast('これ以上動かせません'); return; }
  var tmp = stops[i]; stops[i] = stops[j]; stops[j] = tmp;
  save(); renderToday();
}
$('#stop-note').addEventListener('change', function () {
  var st = currentStop(); if (!st) return;
  st.note = this.value.trim(); save(); renderToday();
});
$('#stop-transfer').addEventListener('click', function () {
  var st = currentStop(); if (!st) return;
  $('#stop-note').blur();
  openPicker(st.id);
});
$('#stop-up').addEventListener('click', function () { moveStop(-1); });
$('#stop-down').addEventListener('click', function () { moveStop(1); });
/* 確かめずに消し、トーストの「取り消す」で戻せるようにする。
   ここから転送した行は、通常の配送として残す（from を外す） */
$('#stop-del').addEventListener('click', function () {
  var g = curPage();
  var st = currentStop(); if (!st) return;
  var kids = dropsOf(st, g.stops);
  undoSnapshot = snapPage(g);
  kids.forEach(function (x) { x.from = null; });
  g.stops = g.stops.filter(function (x) { return x.id !== S.stopId; });
  save(); closeSheet(); renderToday();
  toast(destName(st.destId) + ' を削除しました' +
    (kids.length ? '。転送した' + kids.length + '件は通常の配送として残ります' : ''), '取り消す', undoApply);
});

/* 行の並べ替え（ドラッグ・SM-3d）。drag が null なら待機、値があればドラッグ中。
   ドラッグ中は再描画せず transform で見せ、指を離したときに一度だけ配列を並べ替える。
   コース編集は保存するまで下書きなので、並べ替えても save() しない（↑↓ と同じ） */
var SORT = {
  route: {
    box: function () { return $('#route'); },
    scroller: function () { return document.scrollingElement || document.documentElement; },
    view: function () {
      return { top: $('.datebar').getBoundingClientRect().bottom, bottom: $('#actionbar').getBoundingClientRect().top };
    },
    drop: function (from, to) {
      var g = curPage();
      undoSnapshot = snapPage(g);
      g.stops.splice(to, 0, g.stops.splice(from, 1)[0]);
      save(); renderToday();
      toast(destName(g.stops[to].destId) + ' を' + (to + 1) + '番目へ移動', '取り消す', undoApply);
    }
  },
  course: {
    box: function () { return $('#c-items'); },
    scroller: function () { return $('#sh-cedit .sheet-body'); },
    view: function () { return this.scroller().getBoundingClientRect(); },
    drop: function (from, to) {
      var it = S.course.items;
      it.splice(to, 0, it.splice(from, 1)[0]);
      renderCourseItems();
    }
  }
};
var drag = null;

function dragStart(e, handle) {
  var cfg = SORT[handle.dataset.drag];
  var rows = Array.prototype.slice.call(cfg.box().children);
  var row = rows.filter(function (r) { return r.contains(handle); })[0];
  if (!row) return;
  var rects = rows.map(function (r) { return r.getBoundingClientRect(); });
  var sc = cfg.scroller();
  drag = {
    cfg: cfg, rows: rows, row: row, from: rows.indexOf(row), to: rows.indexOf(row),
    id: e.pointerId, y0: e.clientY, y: e.clientY, sc: sc, s0: sc.scrollTop,
    tops: rects.map(function (r) { return r.top; }),
    hs: rects.map(function (r) { return r.height; }),
    gap: rects.length > 1 ? rects[1].top - rects[0].bottom : 0,
    moved: false, raf: 0
  };
  try { handle.setPointerCapture(e.pointerId); } catch (err) {}
  row.classList.add('is-lifted');
  document.body.classList.add('is-dragging');
  drag.raf = requestAnimationFrame(dragTick);
}

/* 位置は押した時点の画面座標で比べる。自動スクロールした分は持ち上げた行の移動量に足す。
   上の行とは持ち上げた行の上端、下の行とは下端がその行の中央を越えたら入れ替える */
function dragPaint(d) {
  var f = d.from, last = d.rows.length - 1;
  var dy = d.y - d.y0 + (d.sc.scrollTop - d.s0);
  dy = Math.max(d.tops[0] - d.tops[f], Math.min(d.tops[last] + d.hs[last] - d.tops[f] - d.hs[f], dy));
  var top = d.tops[f] + dy, bottom = top + d.hs[f], to = 0;
  for (var i = 0; i <= last; i++) {
    var mid = d.tops[i] + d.hs[i] / 2;
    if (i < f ? mid < top : i > f && mid < bottom) to++;
  }
  d.to = to;
  var slot = d.hs[f] + d.gap;
  d.rows.forEach(function (r, i) {
    var y = i === f ? dy : (f < i && i <= to) ? -slot : (to <= i && i < f) ? slot : 0;
    r.style.transform = y ? 'translateY(' + y + 'px)' : '';
  });
}

function dragTick() {
  if (!drag) return;
  var v = drag.cfg.view(), edge = 60, sp = 0;
  if (drag.moved && drag.y < v.top + edge) sp = drag.y - (v.top + edge);
  else if (drag.moved && drag.y > v.bottom - edge) sp = drag.y - (v.bottom - edge);
  if (sp) drag.sc.scrollTop += Math.max(-16, Math.min(16, Math.round(sp / 4)));
  dragPaint(drag);
  drag.raf = requestAnimationFrame(dragTick);
}

function dragEnd(commit) {
  var d = drag;
  if (!d) return;
  dragPaint(d);
  drag = null;
  cancelAnimationFrame(d.raf);
  document.body.classList.remove('is-dragging');
  if (d.moved) dragClickUntil = Date.now() + 1000;
  if (commit && d.to !== d.from) { d.cfg.drop(d.from, d.to); return; }
  d.row.classList.remove('is-lifted');
  d.rows.forEach(function (r) { r.style.transform = ''; });
}

/* 行はどこを押してもメニューが開くので、ドラッグを離した直後の click は捨てる。
   iOS はドラッグのあとに click を出さないので、次に押したときか1秒で解く */
var dragClickUntil = 0;
document.addEventListener('click', function (e) {
  if (Date.now() >= dragClickUntil) return;
  dragClickUntil = 0;
  e.preventDefault();
  e.stopPropagation();
}, true);

document.addEventListener('pointerdown', function (e) {
  dragClickUntil = 0;
  var h = (!drag && e.isPrimary && e.button === 0 && e.target.closest) ? e.target.closest('[data-drag]') : null;
  if (!h) return;
  e.preventDefault();   // マウスで押したときに文字が選択されないように
  dragStart(e, h);
});
document.addEventListener('pointermove', function (e) {
  if (!drag || e.pointerId !== drag.id) return;
  drag.y = e.clientY;
  if (Math.abs(drag.y - drag.y0) > 4) drag.moved = true;
  dragPaint(drag);
});
document.addEventListener('pointerup', function (e) { if (drag && e.pointerId === drag.id) dragEnd(true); });
document.addEventListener('pointercancel', function (e) { if (drag && e.pointerId === drag.id) dragEnd(false); });
document.addEventListener('lostpointercapture', function (e) { if (drag && e.pointerId === drag.id) dragEnd(false); });
document.addEventListener('contextmenu', function (e) {
  if (e.target.closest && e.target.closest('[data-drag]')) e.preventDefault();
});

/* ページ */
function openPageSheet() {
  var ps = pagesOf(S.date), i = pageIdx(S.date);
  $('#sh-page-t').textContent = pageLabel(ps[i], i) + ' の操作';
  $('#page-name').value = ps[i].name || '';
  $('#page-name').placeholder = '例：午前（空欄なら「ページ' + (i + 1) + '」）';
  $('#page-dup').disabled = !ps[i].stops.length || ps.length >= 12;
  $('#page-left').disabled = i === 0;
  $('#page-right').disabled = i === ps.length - 1;
  $('#page-del').hidden = ps.length < 2;
  markClean('sh-page');
  openSheet('sh-page');
}

function addPage() {
  var ps = pagesOf(S.date);
  if (ps.length >= 12) { toast('1日に作れるページは12までです'); return; }
  ps.push(newPage());
  S.page = ps.length - 1;
  save(); renderToday();
  toast('ページ' + ps.length + ' を追加');
}

function duplicatePage() {
  var ps = pagesOf(S.date), i = pageIdx(S.date), cur = ps[i];
  if (ps.length >= 12) { toast('1日に作れるページは12までです'); return; }
  if (!cur.stops.length) { toast('空のページは複製できません'); return; }

  // stops[].from は「引き取った行のID」。複製した行を指すように張り替える。
  // 張り替えないと、複製先の転送が元のページの行を指してページ独立性が壊れる。
  var map = {};
  var stops = cur.stops.map(function (st) {
    var nid = uid('s-');
    map[st.id] = nid;
    return { id: nid, destId: st.destId, from: st.from, note: st.note, src: st.src };
  });
  stops.forEach(function (st) {
    st.from = (st.from && map[st.from]) ? map[st.from] : null;
    var d = destOf(st.destId); if (d) d.uses = (d.uses || 0) + 1;
  });

  var g = { id: uid('g-'), name: cur.name ? cur.name + ' のコピー' : '', stops: stops };
  ps.splice(i + 1, 0, g);
  S.page = i + 1;
  save(); closeSheet(); renderToday();
  toast(pageLabel(g, i + 1) + ' に複製しました（' + stops.length + '件）');
}

function movePage(dir) {
  var ps = pagesOf(S.date), i = pageIdx(S.date), j = i + dir;
  if (j < 0 || j >= ps.length) return;
  var t = ps[i]; ps[i] = ps[j]; ps[j] = t;
  S.page = j;
  save(); closeSheet(); renderToday(); toast('並び順を変えました');
}

$('#page-save').addEventListener('click', function () {
  var ps = pagesOf(S.date), i = pageIdx(S.date);
  ps[i].name = $('#page-name').value.trim();
  save(); closeSheet(); renderToday(); toast('保存しました');
});
$('#page-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#page-save').click(); });
$('#page-dup').addEventListener('click', duplicatePage);
$('#page-left').addEventListener('click', function () { movePage(-1); });
$('#page-right').addEventListener('click', function () { movePage(1); });
$('#page-del').addEventListener('click', function () {
  var ps = pagesOf(S.date), i = pageIdx(S.date);
  if (ps.length < 2) return;
  if (ps[i].stops.length && !confirm(pageLabel(ps[i], i) + ' を削除します。中の' + ps[i].stops.length + '件も消えます。')) return;
  ps.splice(i, 1);
  S.page = Math.max(0, i - 1);
  save(); closeSheet(); renderToday(); toast('ページを削除しました');
});

/* コース */
$('#c-add').addEventListener('click', function () { openPicker(null, 'course'); });
$('#c-name').addEventListener('input', function () { S.course.name = this.value; });
$('#c-save').addEventListener('click', function () {
  var name = $('#c-name').value.trim();
  if (!name) { toast('コース名を入力してください'); $('#c-name').focus(); return; }
  if (!S.course.items.length) { toast('配送先を1件以上追加してください'); return; }
  var raw = $('#c-map').value.trim();
  if (raw && !safeUrl(raw)) {
    toast('ルートのURLは https:// で始まるものだけ登録できます');
    $('#c-map').focus();
    return;
  }
  var mapUrl = safeUrl(raw);
  S.course.mapUrl = mapUrl;
  if (S.course.id) {
    var c = DB.courses.filter(function (x) { return x.id === S.course.id; })[0];
    c.name = name; c.items = S.course.items.slice(); c.mapUrl = mapUrl;
  } else {
    DB.courses.push({ id: uid('k-'), name: name, items: S.course.items.slice(), mapUrl: mapUrl });
  }
  save(); closeSheet(); renderCourseList(); renderCourseRow();
  toast('「' + name + '」を保存しました');
});
$('#c-del').addEventListener('click', function () {
  if (!S.course.id) return;
  if (!confirm('コース「' + S.course.name + '」を削除します。配送先そのものは消えません。')) return;
  DB.courses = DB.courses.filter(function (x) { return x.id !== S.course.id; });
  save(); closeSheet(); renderCourseList(); renderCourseRow(); toast('削除しました');
});

/* 出力 */
$('#out-copy').addEventListener('click', function () { copyText(buildText(S.date)); });
$('#out-line').addEventListener('click', function () {
  var t = buildText(S.date);
  window.location.href = 'https://line.me/R/share?text=' + encodeURIComponent(t);
});
if (navigator.share) {
  $('#out-share').addEventListener('click', function () {
    navigator.share({ text: buildText(S.date) }).catch(function () {});
  });
} else {
  $('#out-share').hidden = true;
}
/* 月のまとめ出力 */
$('#mout-copy').addEventListener('click', function () { copyText(buildMonthText(S.monthKey, S.monthMode)); });
$('#mout-line').addEventListener('click', function () {
  var t = buildMonthText(S.monthKey, S.monthMode);
  window.location.href = 'https://line.me/R/share?text=' + encodeURIComponent(t);
});
if (navigator.share) {
  $('#mout-share').addEventListener('click', function () {
    navigator.share({ text: buildMonthText(S.monthKey, S.monthMode) }).catch(function () {});
  });
} else {
  $('#mout-share').hidden = true;
}

$('#toast-act').addEventListener('click', function () {
  var f = toastFn; toastFn = null; $('#toast').hidden = true; if (f) f();
});

/* 設定 */
bindSettings();
$('#set-export').addEventListener('click', exportJSON);
$('#set-import').addEventListener('click', function () { $('#import-file').click(); });
$('#import-file').addEventListener('change', function () {
  var f = this.files && this.files[0]; if (!f) return;
  var fr = new FileReader();
  fr.onload = function () {
    try {
      var obj = JSON.parse(fr.result);
      if (!obj || !obj.destinations) throw 0;
      if (!confirm('いまのデータを読み込んだ内容で置き換えます。よろしいですか？')) return;
      DB = migrate(obj); save(); closeSheet(); setTab('today'); toast('読み込みました');
    } catch (e) { toast('このファイルは読み込めませんでした'); }
  };
  fr.readAsText(f);
  this.value = '';
});
$('#set-clear').addEventListener('click', function () {
  if (!confirm('登録した配送先と日報の履歴をすべて消します。元に戻せません。')) return;
  if (!confirm('本当に消してよろしいですか？')) return;
  DB = freshDB(); save(); closeSheet(); setTab('today'); toast('消去しました');
});

/* カテゴリ追加 */
function addCat() {
  var v = $('#cat-new').value.trim();
  if (!v) return;
  DB.categories.push({ id: uid('c-'), name: v });
  $('#cat-new').value = '';
  save(); renderCats(); render(); toast('「' + v + '」を追加しました');
}
$('#cat-add').addEventListener('click', addCat);
$('#cat-new').addEventListener('keydown', function (e) { if (e.key === 'Enter') addCat(); });

/* ══════════════════════════════════════
   12. 起動
   ══════════════════════════════════════ */
S.page = lastPage(S.date);
setTab('today');
backupReminder();
if (movedCorrupt) {
  alert('保存されていた記録が壊れていて読み込めませんでした。\n' +
        '壊れたデータは消さずに端末内の別の場所へ移し、新しく始めます。\n' +
        'バックアップを書き出していれば、設定の「バックアップを読み込む」から戻せます。');
}

/* ピンチズームやダブルタップ拡大などのジェスチャを抑止 */
document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
document.addEventListener('gesturechange', function (e) { e.preventDefault(); });
document.addEventListener('gestureend', function (e) { e.preventDefault(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  });
}

})();
