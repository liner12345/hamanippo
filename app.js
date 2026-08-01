'use strict';
(function () {

/* ══════════════════════════════════════
   1. 保存まわり
   ══════════════════════════════════════ */
var KEY = 'nippou.v1';
var memoryOnly = false;
var memory = null;

try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); }
catch (e) { memoryOnly = true; }

function loadDB() {
  if (memoryOnly) return memory;
  try { var raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { return null; }
}
function save() {
  memory = DB;
  if (memoryOnly) return;
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch (e) { toast('保存できませんでした。端末の空き容量を確認してください'); }
}

function freshDB() {
  return {
    v: 2,
    categories: [{ id: 'c-base', name: '未分類' }],
    destinations: [],
    courses: [],
    reports: {},
    settings: {
      header: '', dateStyle: 'slash', transferStyle: 'src',
      number: false, footer: ''
    }
  };
}

var DB = loadDB() || freshDB();
(function repair() {
  var base = freshDB();
  if (!Array.isArray(DB.categories) || !DB.categories.length) DB.categories = base.categories;
  if (!Array.isArray(DB.destinations)) DB.destinations = [];
  if (!Array.isArray(DB.courses)) DB.courses = [];
  if (!DB.reports || typeof DB.reports !== 'object') DB.reports = {};
  if (!DB.settings) DB.settings = base.settings;
  for (var k in base.settings) if (!(k in DB.settings)) DB.settings[k] = base.settings[k];
  // カテゴリが消えた配送先は先頭カテゴリへ寄せる
  var ids = DB.categories.map(function (c) { return c.id; });
  DB.destinations.forEach(function (d) {
    if (ids.indexOf(d.catId) < 0) d.catId = DB.categories[0].id;
  });

  if (DB.v !== 2) {
    // v1では from に「転送元の配送先ID」を持っていた。v2では「引き取った行のID」を持つ
    Object.keys(DB.reports).forEach(function (k) {
      var stops = DB.reports[k].stops || [];
      stops.forEach(function (st, i) {
        if (!st.from) return;
        var oldDest = st.from;
        st.from = null;
        for (var j = i - 1; j >= 0; j--) {
          if (stops[j].destId === oldDest) { st.from = stops[j].id; break; }
        }
      });
    });
    delete DB.settings.group;
    if (['src', 'srcArrow', 'dest', 'none'].indexOf(DB.settings.transferStyle) < 0) {
      DB.settings.transferStyle = 'src';
    }
    DB.v = 2;
  }
})();

/* ══════════════════════════════════════
   2. 小道具
   ══════════════════════════════════════ */
function $(s) { return document.querySelector(s); }
function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }
function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
var WD = ['日', '月', '火', '水', '木', '金', '土'];
function keyOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function parseKey(k) { var a = k.split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
function shiftDate(k, n) { var d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); }

function fmtDate(k, style) {
  var d = parseKey(k), y = d.getFullYear(), m = d.getMonth() + 1, da = d.getDate(), w = WD[d.getDay()];
  if (style === 'slash0') return y + '/' + pad(m) + '/' + pad(da) + '(' + w + ')';
  if (style === 'dot') return y + '.' + pad(m) + '.' + pad(da) + '(' + w + ')';
  if (style === 'jp') return y + '年' + m + '月' + da + '日(' + w + ')';
  if (style === 'md') return m + '/' + da + '(' + w + ')';
  return y + '/' + m + '/' + da + '(' + w + ')';
}

function destOf(id) { for (var i = 0; i < DB.destinations.length; i++) if (DB.destinations[i].id === id) return DB.destinations[i]; return null; }
function destName(id) { var d = destOf(id); return d ? d.name : '（削除された配送先）'; }
function catOf(id) { for (var i = 0; i < DB.categories.length; i++) if (DB.categories[i].id === id) return DB.categories[i]; return null; }
function catName(id) { var c = catOf(id); return c ? c.name : '未分類'; }
function report(k) { if (!DB.reports[k]) DB.reports[k] = { stops: [] }; return DB.reports[k]; }

var S = {
  tab: 'today',
  date: keyOf(new Date()),
  pickFrom: null,
  pickMode: 'day',
  pickCat: '',
  course: null,
  editDest: null,
  stopId: null
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

function buildText(k) {
  var s = DB.settings, r = report(k), out = [];
  if (s.header) out.push(s.header);
  out.push(fmtDate(k, s.dateStyle));
  out.push('');
  r.stops.forEach(function (st, i) { out.push(lineFor(st, i, r.stops)); });
  if (s.footer) { out.push(''); out.push(s.footer); }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
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

function renderToday() {
  var d = parseKey(S.date);
  $('#d-main').textContent = d.getFullYear() + '.' + pad(d.getMonth() + 1) + '.' + pad(d.getDate());
  $('#d-wd').textContent = WD[d.getDay()];
  $('#d-input').value = S.date;
  $('#d-today').classList.toggle('is-on', S.date === keyOf(new Date()));

  var r = report(S.date);
  $('#stop-count').textContent = r.stops.length + '件';
  $('#route-empty').hidden = r.stops.length > 0;
  $('#btn-clear-today').hidden = r.stops.length === 0;

  $('#route').innerHTML = r.stops.map(function (st, i) {
    var dd = destOf(st.destId), tags = [];
    var up = pickupOf(st, r.stops);
    if (up) tags.push('<span class="tag tag-transfer">' + esc(destName(up.destId)) + 'から引き取り</span>');
    dropsOf(st, r.stops).forEach(function (x) {
      tags.push('<span class="tag tag-drop">→ ' + esc(destName(x.destId)) + ' へ</span>');
    });
    if (st.note) tags.push('<span class="tag tag-note">' + esc(st.note) + '</span>');
    if (dd) tags.push('<span class="tag">' + esc(catName(dd.catId)) + '</span>');
    return '<li class="stop' + (up ? ' is-transfer' : '') + '">' +
      '<div class="stop-gutter"><span class="stop-no">' + pad(i + 1) + '</span></div>' +
      '<div class="stop-body"><div class="stop-name">' + esc(destName(st.destId)) + '</div>' +
      (tags.length ? '<div class="stop-meta">' + tags.join('') + '</div>' : '') + '</div>' +
      '<button class="stop-menu" data-menu="' + st.id + '" aria-label="' + esc(destName(st.destId)) + 'の操作">' + DOTS + '</button>' +
      '</li>';
  }).join('');
}

function renderCourseRow() {
  var html = DB.courses.map(function (c) {
    return '<button class="chip course-chip" data-course="' + c.id + '">' +
      esc(c.name) + '<span class="chip-n">' + c.items.length + '</span></button>';
  }).join('');
  html += '<button class="chip chip-ghost" data-clist="1">' +
    (DB.courses.length ? 'コースを編集' : '＋ コースを作る') + '</button>';
  $('#courserow').innerHTML = html;
}

function applyCourse(cid) {
  var c = DB.courses.filter(function (x) { return x.id === cid; })[0];
  if (!c || !c.items.length) { toast('このコースには配送先が入っていません'); return; }
  var r = report(S.date);
  undoSnapshot = { date: S.date, stops: r.stops.slice() };
  c.items.forEach(function (destId) {
    if (!destOf(destId)) return;
    r.stops.push({ id: uid('s-'), destId: destId, from: null, note: '' });
    var d = destOf(destId); d.uses = (d.uses || 0) + 1;
  });
  save(); renderToday();
  toast(c.name + ' の' + c.items.length + '件を追加', '取り消す', undoApply);
}

var undoSnapshot = null;
function undoApply() {
  if (!undoSnapshot) return;
  report(undoSnapshot.date).stops = undoSnapshot.stops;
  undoSnapshot = null;
  save(); renderToday(); toast('元に戻しました');
}

function renderCourseList() {
  if (!DB.courses.length) {
    $('#clist').innerHTML = '<div class="empty"><p class="empty-title">コースがまだありません</p>' +
      '<p class="empty-sub">よく回る順番を1つ登録しておくと、ボタン1つでその日の日報に並びます。</p></div>';
    return;
  }
  $('#clist').innerHTML = DB.courses.map(function (c) {
    var names = c.items.map(function (id) { return destName(id); }).slice(0, 3).join('、');
    if (c.items.length > 3) names += ' ほか';
    return '<button class="hist-row" data-cedit="' + c.id + '">' +
      '<span><span class="dest-name">' + esc(c.name) + '</span>' +
      '<span class="hist-sub">' + esc(names) + '</span></span>' +
      '<span class="hist-n">' + c.items.length + '件</span></button>';
  }).join('');
}

function openCourseList() { renderCourseList(); openSheet('sh-clist'); }

function openCourseEditor(cid) {
  var c = cid ? DB.courses.filter(function (x) { return x.id === cid; })[0] : null;
  S.course = c
    ? { id: c.id, name: c.name, items: c.items.slice() }
    : { id: null, name: '', items: [] };
  $('#sh-cedit-t').textContent = c ? 'コースを編集' : 'コースを作る';
  $('#c-name').value = S.course.name;
  $('#c-del').hidden = !c;
  renderCourseItems();
  openSheet('sh-cedit', 'sh-clist');
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
      '<span class="cno">' + pad(i + 1) + '</span>' +
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
      html += '<div class="dest-row">' +
        '<button class="dest-main" data-edit="' + d.id + '">' +
        '<div class="dest-name">' + esc(d.name) + '</div>' +
        (d.memo ? '<div class="dest-memo">' + esc(d.memo) + '</div>' : '') +
        '</button>' +
        '<button class="dest-add" data-quick="' + d.id + '" aria-label="' + esc(d.name) + 'を' + fmtDate(S.date, 'md') + 'に追加">' + PLUS + '</button>' +
        '</div>';
    });
    html += '</div>';
  });
  if (!html) {
    html = '<div class="empty"><p class="empty-title">配送先がまだ登録されていません</p>' +
      '<p class="empty-sub">下のボタンから登録します。一度入れておけば、次からは選ぶだけで日報に載ります。</p></div>';
  }
  $('#dest-list').innerHTML = html;

  var arch = DB.destinations.filter(function (d) { return d.archived; });
  $('#archive-box').hidden = arch.length === 0;
  $('#archive-list').innerHTML = arch.map(function (d) {
    return '<div class="arch-row"><span>' + esc(d.name) + '</span>' +
      '<button class="chip" data-restore="' + d.id + '">戻す</button></div>';
  }).join('');
}

function renderHist() {
  var keys = Object.keys(DB.reports).filter(function (k) { return DB.reports[k].stops.length; }).sort().reverse();
  if (!keys.length) {
    $('#hist-list').innerHTML = '<div class="empty"><p class="empty-title">履歴はまだありません</p>' +
      '<p class="empty-sub">日報を1件でも記録すると、ここに日付が並びます。</p></div>';
    return;
  }
  $('#hist-list').innerHTML = keys.map(function (k) {
    var st = DB.reports[k].stops;
    var names = st.slice(0, 4).map(function (x) { return destName(x.destId); }).join('、');
    if (st.length > 4) names += ' ほか';
    return '<button class="hist-row" data-date="' + k + '">' +
      '<span><span class="hist-date">' + esc(fmtDate(k, 'slash0')) + '</span>' +
      '<span class="hist-sub">' + esc(names) + '</span></span>' +
      '<span class="hist-n">' + st.length + '件</span></button>';
  }).join('');
}

function render() {
  if (S.tab === 'today') { renderToday(); renderCourseRow(); }
  if (S.tab === 'dest') renderDest();
  if (S.tab === 'hist') renderHist();
}

/* ══════════════════════════════════════
   5. タブ / シート
   ══════════════════════════════════════ */
function setTab(name) {
  S.tab = name;
  $('#tab-today').hidden = name !== 'today';
  $('#tab-dest').hidden = name !== 'dest';
  $('#tab-hist').hidden = name !== 'hist';
  Array.prototype.forEach.call(document.querySelectorAll('.tabbtn'), function (b) {
    var on = b.dataset.tab === name;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  $('#actionbar').hidden = name === 'hist';
  $('#btn-output').hidden = name !== 'today';
  $('#btn-add').innerHTML = name === 'dest'
    ? '<span class="plus" aria-hidden="true">＋</span> 新しい配送先を登録'
    : '<span class="plus" aria-hidden="true">＋</span> 配送先を追加';
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

var toastTimer = null, toastFn = null;
function toast(msg, actLabel, fn) {
  var t = $('#toast'), a = $('#toast-act');
  $('#toast-msg').textContent = msg;
  toastFn = fn || null;
  if (actLabel) { a.textContent = actLabel; a.hidden = false; } else { a.hidden = true; }
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.hidden = true; toastFn = null; }, actLabel ? 6000 : 2000);
}

/* ══════════════════════════════════════
   6. 配送先ピッカー
   ══════════════════════════════════════ */
function openPicker(fromStopId, mode) {
  S.pickMode = mode || 'day';
  S.pickFrom = fromStopId || null;
  S.pickCat = '';
  $('#pick-search').value = '';
  var hint = $('#pick-hint');
  if (fromStopId) {
    var src = report(S.date).stops.filter(function (x) { return x.id === fromStopId; })[0];
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
  toast(destName(destId) + ' を追加（計' + S.course.items.length + '件）');
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
  var q = $('#pick-search').value.trim().toLowerCase();
  var pool = DB.destinations.filter(function (d) {
    if (d.archived) return false;
    if (S.pickCat && d.catId !== S.pickCat) return false;
    if (q && (d.name + ' ' + (d.memo || '')).toLowerCase().indexOf(q) < 0) return false;
    return true;
  });

  if (!pool.length) {
    $('#pick-list').innerHTML = '<p class="pick-none">' +
      (DB.destinations.length ? '見つかりませんでした' : 'まだ配送先がありません。下から登録してください。') + '</p>';
    return;
  }

  function row(d) {
    return '<div class="pick-item' + (S.pickMode === 'course' ? ' solo' : '') + '">' +
      '<button class="pick-row" data-pick="' + d.id + '">' +
        '<div class="pick-name">' + esc(d.name) + '</div>' +
        '<div class="pick-sub">' + esc(catName(d.catId)) + (d.memo ? ' ・ ' + esc(d.memo) : '') + '</div>' +
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
}

function addStop(destId, thenTransfer) {
  var r = report(S.date);
  var st = { id: uid('s-'), destId: destId, from: S.pickFrom || null, note: '' };
  r.stops.push(st);
  var d = destOf(destId); if (d) d.uses = (d.uses || 0) + 1;
  var wasDrop = !!S.pickFrom;
  S.pickFrom = null;
  save();

  if (thenTransfer) {
    if (S.tab !== 'today') setTab('today'); else renderToday();
    openPicker(st.id);
    return;
  }
  closeSheet();
  if (S.tab !== 'today') setTab('today'); else renderToday();
  toast(destName(destId) + (wasDrop ? ' を届け先として追加' : ' を追加'));
}

/* ══════════════════════════════════════
   7. 配送先の登録・編集
   ══════════════════════════════════════ */
function fillCatSelect(selected) {
  $('#dest-cat').innerHTML = DB.categories.map(function (c) {
    return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
  }).join('') + '<option value="__new">＋ 新しいカテゴリを作る…</option>';
  $('#dest-cat').value = selected || DB.categories[0].id;
}

function openDestEditor(id) {
  S.editDest = id || null;
  var d = id ? destOf(id) : null;
  $('#sh-dest-t').textContent = d ? '配送先を編集' : '配送先を登録';
  $('#dest-name').value = d ? d.name : '';
  $('#dest-memo').value = d ? (d.memo || '') : '';
  fillCatSelect(d ? d.catId : DB.categories[0].id);
  $('#dest-del').hidden = !d;
  openSheet('sh-dest');
  if (!d) setTimeout(function () { $('#dest-name').focus(); }, 120);
}

function saveDest() {
  var name = $('#dest-name').value.trim();
  if (!name) { toast('配送先名を入力してください'); $('#dest-name').focus(); return; }
  var catId = $('#dest-cat').value;
  if (catId === '__new') { toast('カテゴリを選び直してください'); return; }
  var memo = $('#dest-memo').value.trim();

  if (S.editDest) {
    var d = destOf(S.editDest);
    d.name = name; d.catId = catId; d.memo = memo;
    save(); closeSheet(); render(); toast('保存しました');
  } else {
    var nd = { id: uid('d-'), name: name, catId: catId, memo: memo, uses: 0 };
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
  $('#set-number').checked = !!s.number;
  $('#storage-note').textContent = memoryOnly
    ? 'この環境ではブラウザ保存が使えないため、タブを閉じると内容が消えます。GitHub Pages などで開くと保存されます。'
    : 'データは端末のブラウザ内にだけ保存されます。ホーム画面に追加して使うと消えにくくなります。機種変更の前にはバックアップを書き出してください。';
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
  on('#set-number', 'number', true);
}

function exportJSON() {
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
  $('#out-text').textContent = buildText(S.date);
  openSheet('sh-out');
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
  var t = ev.target.closest ? ev.target.closest('[data-tab],[data-menu],[data-pick],[data-picktf],[data-pcat],[data-edit],[data-quick],[data-date],[data-catdel],[data-restore],[data-close],[data-course],[data-clist],[data-cedit],[data-cup],[data-cdn],[data-crm],[data-clear]') : null;
  if (!t) return;

  if (t.dataset.clear === 'today') {
    var r = report(S.date);
    if (!r.stops.length) return;
    if (!confirm(fmtDate(S.date, 'md') + ' の記録（' + r.stops.length + '件）をすべて消去しますか？')) return;
    undoSnapshot = { date: S.date, stops: r.stops.slice() };
    r.stops = [];
    save(); renderToday();
    toast('すべての記録をクリアしました', '取り消す', undoApply);
    return;
  }

  if (t.hasAttribute('data-close')) { closeSheet(); return; }
  if (t.dataset.tab) { setTab(t.dataset.tab); return; }

  if (t.dataset.menu) {
    S.stopId = t.dataset.menu;
    var st = report(S.date).stops.filter(function (x) { return x.id === S.stopId; })[0];
    if (!st) return;
    var upStop = pickupOf(st, report(S.date).stops);
    $('#stop-target').textContent = destName(st.destId) + (upStop ? '（' + destName(upStop.destId) + 'から引き取り）' : '');
    $('#stop-note').value = st.note || '';
    $('#stop-transfer').hidden = false;
    openSheet('sh-stop');
    return;
  }

  if (t.dataset.pick) {
    if (S.pickMode === 'course') { addToCourse(t.dataset.pick); return; }
    addStop(t.dataset.pick, false); return;
  }
  if (t.dataset.picktf) { addStop(t.dataset.picktf, true); return; }

  if (t.dataset.course) { applyCourse(t.dataset.course); return; }
  if (t.dataset.clist) { openCourseList(); return; }
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
    var r = report(S.date);
    r.stops.push({ id: uid('s-'), destId: d0.id, from: null, note: '' });
    d0.uses = (d0.uses || 0) + 1;
    save(); toast(d0.name + ' を ' + fmtDate(S.date, 'md') + ' に追加');
    return;
  }

  if (t.dataset.date) { S.date = t.dataset.date; setTab('today'); return; }

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

$('#scrim').addEventListener('click', closeSheet);
document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && openId) closeSheet(); });

/* 日付 */
$('#d-prev').addEventListener('click', function () { S.date = shiftDate(S.date, -1); renderToday(); });
$('#d-next').addEventListener('click', function () { S.date = shiftDate(S.date, 1); renderToday(); });
$('#d-today').addEventListener('click', function () { S.date = keyOf(new Date()); renderToday(); });
$('#d-input').addEventListener('change', function () { if (this.value) { S.date = this.value; renderToday(); } });

/* 主要ボタン */
$('#btn-add').addEventListener('click', function () {
  if (S.tab === 'dest') { S.pickReturn = false; openDestEditor(null); }
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
$('#dest-cat').addEventListener('change', function () {
  if (this.value !== '__new') return;
  var name = prompt('新しいカテゴリ名');
  if (name && name.trim()) {
    var c = { id: uid('c-'), name: name.trim() };
    DB.categories.push(c); save();
    fillCatSelect(c.id);
    if (S.tab === 'dest') renderDest();
  } else {
    fillCatSelect(DB.categories[0].id);
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
  return report(S.date).stops.filter(function (x) { return x.id === S.stopId; })[0];
}
function moveStop(dir) {
  var r = report(S.date), i = r.stops.findIndex(function (x) { return x.id === S.stopId; });
  var j = i + dir;
  if (i < 0 || j < 0 || j >= r.stops.length) { toast('これ以上動かせません'); return; }
  var tmp = r.stops[i]; r.stops[i] = r.stops[j]; r.stops[j] = tmp;
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
$('#stop-del').addEventListener('click', function () {
  var r = report(S.date);
  var st = currentStop(); if (!st) return;
  var kids = dropsOf(st, r.stops);
  var msg = kids.length
    ? 'この行を削除します。ここから転送した' + kids.length + '件は、通常の配送として残ります。'
    : 'この行を削除します。';
  if (!confirm(msg)) return;
  kids.forEach(function (x) { x.from = null; });
  r.stops = r.stops.filter(function (x) { return x.id !== S.stopId; });
  save(); closeSheet(); renderToday(); toast('削除しました');
});

/* コース */
$('#c-new').addEventListener('click', function () { openCourseEditor(null); });
$('#cedit-back').addEventListener('click', closeSheet);
$('#c-add').addEventListener('click', function () { openPicker(null, 'course'); });
$('#c-name').addEventListener('input', function () { S.course.name = this.value; });
$('#c-save').addEventListener('click', function () {
  var name = $('#c-name').value.trim();
  if (!name) { toast('コース名を入力してください'); $('#c-name').focus(); return; }
  if (!S.course.items.length) { toast('配送先を1件以上追加してください'); return; }
  if (S.course.id) {
    var c = DB.courses.filter(function (x) { return x.id === S.course.id; })[0];
    c.name = name; c.items = S.course.items.slice();
  } else {
    DB.courses.push({ id: uid('k-'), name: name, items: S.course.items.slice() });
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
      DB = obj; save(); closeSheet(); setTab('today'); toast('読み込みました');
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
setTab('today');

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () {});
  });
}

})();
