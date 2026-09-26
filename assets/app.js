/* 抽取灵感 · 灵感卡池
   纯静态站：卡池内容（抽取灵感.json）和设置（pool.config.json）都在运行时读取，
   改完 JSON 提交即可生效，不需要重新构建。 */
(function () {
  'use strict';

  /* pool.config.json 缺失或字段不全时用这里的兜底值 */
  var DEFAULT_CONFIG = {
    title: '抽取灵感',
    subtitle: '单抽或十连抽，看看这一发能抽到什么。',
    poolUrl: '抽取灵感.json',
    configUrl: 'pool.config.json',
    rarities: [
      { stars: 1, name: '杂念', weight: 46, color: '#8b93a7' },
      { stars: 2, name: '日常', weight: 24, color: '#3fd0a8' },
      { stars: 3, name: '灵光', weight: 16, color: '#5b8cff' },
      { stars: 4, name: '奇想', weight: 9, color: '#c06cff' },
      { stars: 5, name: '天启', weight: 5, color: '#ffb340' }
    ],
    categoryRarity: {
      '负面情感': 1,
      '正面情感': 1,
      '普通灵感': 2,
      '走神': 2,
      '平静': 3,
      '遗忘': 3,
      '绝妙的灵感': 3,
      'ph灵感': 3,
      '故事灵感': 4,
      '游戏灵感': 5,
      '高度抽象': 5,
      '梦中线': 5
    },
    defaultRarity: 3,
    specialCategories: ['高度抽象', '梦中线'],
    tenPullGuarantee: 3
  };

  var LS_KEY = 'inspiration-gacha:v1';

  var state = {
    config: DEFAULT_CONFIG,
    cards: [],
    groups: {},      /* stars -> card[] */
    table: [],       /* 抽卡权重表 */
    collected: [],   /* 已收集的卡片 id（数组，便于 localStorage） */
    collectedSet: {},
    draws: 0,
    busy: false
  };

  var $ = function (id) { return document.getElementById(id); };
  var ui;
  var flashEl;

  /* ============ 小工具 ============ */

  function hashId(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36);
  }

  function stars(n) {
    var s = '';
    for (var i = 0; i < n; i++) s += '★';
    return s;
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* ============ 读取 JSON ============ */

  function fetchJson(url) {
    return fetch(encodeURI(url), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' · ' + url);
      return res.json();
    });
  }

  function loadConfig() {
    var url = DEFAULT_CONFIG.configUrl;
    return fetchJson(url).then(function (data) {
      return mergeConfig(data);
    }).catch(function () {
      return DEFAULT_CONFIG;
    });
  }

  function mergeConfig(data) {
    var cfg = {};
    Object.keys(DEFAULT_CONFIG).forEach(function (k) { cfg[k] = DEFAULT_CONFIG[k]; });
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(function (k) {
        if (k.charAt(0) === '_') return;          /* 下划线开头的是备注 */
        if (data[k] !== undefined && data[k] !== null) cfg[k] = data[k];
      });
    }
    return cfg;
  }

  /* ============ 解析卡池 ============ */

  function parseEntry(raw) {
    var text = String(raw).replace(/\r\n/g, '\n').trim();
    if (!text) return null;
    var category, body;
    var m = text.match(/^([^：:\n]{1,10})[：:]([\s\S]*)$/);
    if (m) {
      category = m[1].trim();
      body = m[2].trim();
    } else if (text.indexOf('你本来是想探索') === 0) {
      category = '走神';
      body = text;
    } else if (text.indexOf('绝妙的灵感！') === 0) {
      category = '遗忘';
      body = text;
    } else {
      category = '未分类';
      body = text;
    }
    return { category: category, body: body, key: category + '\u0000' + body };
  }

  function buildCards(list) {
    if (!Array.isArray(list)) list = [];
    var seen = {};
    var out = [];
    list.forEach(function (raw) {
      var card = null;
      if (raw && typeof raw === 'object') {
        var text = String(raw.text || raw.body || raw['内容'] || '').replace(/\r\n/g, '\n').trim();
        if (!text) return;
        var category = String(raw.category || raw['类别'] || '未分类').trim();
        card = { category: category, body: text, key: category + '\u0000' + text };
        var forced = raw.rarity || raw['星级'];
        if (forced) card.forcedRarity = Number(forced);
      } else {
        card = parseEntry(raw);
      }
      if (!card || seen[card.key]) return;
      seen[card.key] = true;

      var id = hashId(card.key);
      var n = 1;
      while (out.some(function (c) { return c.id === id; })) id = hashId(card.key + '#' + (n++));
      card.id = id;
      out.push(card);
    });
    return out;
  }

  function rarityOf(card) {
    if (card.forcedRarity) return card.forcedRarity;
    var map = state.config.categoryRarity || {};
    if (Object.prototype.hasOwnProperty.call(map, card.category)) {
      return Number(map[card.category]);
    }
    return Number(state.config.defaultRarity) || 3;
  }

  function buildGroups() {
    state.groups = {};
    state.cards.forEach(function (card) {
      var r = rarityOf(card);
      card.stars = r;
      card.special = (state.config.specialCategories || []).indexOf(card.category) >= 0;
      if (!state.groups[r]) state.groups[r] = [];
      state.groups[r].push(card);
    });
  }

  function buildTable() {
    var defs = {};
    (state.config.rarities || []).forEach(function (d) { defs[Number(d.stars)] = d; });

    var list = Object.keys(state.groups).map(Number).sort(function (a, b) { return a - b; });
    var entries = list.map(function (r) {
      var d = defs[r] || {};
      var w = d.weight === undefined ? 1 : Number(d.weight);
      return {
        stars: r,
        name: d.name || (r + '★'),
        color: d.color || '#5b8cff',
        weight: Math.max(0, isFinite(w) ? w : 1),
        count: state.groups[r].length,
        chance: 0
      };
    });

    var total = entries.reduce(function (s, e) { return s + e.weight; }, 0);
    entries.forEach(function (e) {
      e.chance = total > 0 ? e.weight / total : 1 / entries.length;
    });
    state.table = entries;
  }

  /* ============ 抽卡 ============ */

  function pickTier() {
    var total = state.table.reduce(function (s, e) { return s + e.weight; }, 0);
    if (total <= 0) return state.table[Math.floor(Math.random() * state.table.length)];
    var x = Math.random() * total;
    for (var i = 0; i < state.table.length; i++) {
      x -= state.table[i].weight;
      if (x < 0) return state.table[i];
    }
    return state.table[state.table.length - 1];
  }

  function drawOne() {
    var tier = pickTier();
    var pool = state.groups[tier.stars];
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function drawMany(n) {
    var result = [];
    for (var i = 0; i < n; i++) result.push(drawOne());

    var guarantee = Number(state.config.tenPullGuarantee) || 0;
    if (n >= 10 && guarantee > 0 && !result.some(function (c) { return c.stars >= guarantee; })) {
      var pool = state.cards.filter(function (c) { return c.stars >= guarantee; });
      if (pool.length) result[result.length - 1] = pool[Math.floor(Math.random() * pool.length)];
    }
    return result;
  }

  function tierOf(stars) {
    for (var i = 0; i < state.table.length; i++) {
      if (state.table[i].stars === stars) return state.table[i];
    }
    return { stars: stars, name: stars + '★', color: '#5b8cff' };
  }

  /* ============ 渲染 ============ */

  function makeCard(card, options) {
    var opts = options || {};
    var tier = tierOf(card.stars);

    var root = document.createElement('article');
    root.className = 'card r' + card.stars + (card.special ? ' special' : '');
    root.style.setProperty('--c', tier.color);
    root.dataset.id = card.id;

    var inner = document.createElement('div');
    inner.className = 'card-inner';

    var back = document.createElement('div');
    back.className = 'face back';

    var front = document.createElement('div');
    front.className = 'face front';

    var head = document.createElement('div');
    head.className = 'card-head';
    var starEl = document.createElement('span');
    starEl.className = 'stars';
    starEl.textContent = stars(card.stars);
    var badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = card.category;
    head.appendChild(starEl);
    head.appendChild(badge);

    var body = document.createElement('p');
    body.className = 'body';
    body.textContent = card.body;

    var foot = document.createElement('div');
    foot.className = 'card-foot';
    var tierName = document.createElement('span');
    tierName.textContent = tier.name;
    var hint = document.createElement('span');
    hint.textContent = opts.hint || '';
    foot.appendChild(tierName);
    foot.appendChild(hint);

    front.appendChild(head);
    front.appendChild(body);
    front.appendChild(foot);
    inner.appendChild(back);
    inner.appendChild(front);
    root.appendChild(inner);

    if (opts.clickable) {
      root.classList.add('clickable');
      root.addEventListener('click', function () {
        if (!root.classList.contains('flipped')) return;
        openDetail(card);
      });
    }
    return root;
  }

  function revealAll(nodes, cardsList) {
    var instant = reducedMotion();
    var step = instant ? 0 : 95;

    nodes.forEach(function (node, i) {
      if (instant) node.classList.add('instant');
      setTimeout(function () {
        node.classList.add('flipped');
        var card = cardsList[i];
        if (card.stars >= 4) {
          node.classList.add('hit');
          if (card.stars >= 5 && !instant) playFlash();
        }
      }, instant ? 0 : 140 + i * step);
    });

    var total = instant ? 120 : 140 + (nodes.length - 1) * step + 560;
    setTimeout(function () {
      state.busy = false;
      updateButtons();
      collect(cardsList);
    }, total);
  }

  function playFlash() {
    flashEl.classList.remove('on');
    void flashEl.offsetWidth;
    flashEl.classList.add('on');
  }

  function renderDraw(cardsList) {
    ui.cards.innerHTML = '';
    ui.empty.hidden = true;
    ui.cards.hidden = false;

    var single = cardsList.length === 1;
    ui.cards.className = 'cards ' + (single ? 'single' : 'ten');

    var nodes = cardsList.map(function (card) {
      var node = makeCard(card, { clickable: !single, hint: single ? '' : '点开' });
      ui.cards.appendChild(node);
      return node;
    });

    ui.stage.scrollTop = 0;
    revealAll(nodes, cardsList);
  }

  function renderDrawCount(n) {
    state.draws += n;
    ui.draws.textContent = String(state.draws);
    save();
  }

  /* ============ 收集记录 ============ */

  function collect(cardsList) {
    var changed = false;
    cardsList.forEach(function (card) {
      if (!state.collectedSet[card.id]) {
        state.collectedSet[card.id] = true;
        state.collected.push(card.id);
        changed = true;
      }
    });
    if (changed) save();
    updateStats();
  }

  function ownedCount() {
    return state.cards.filter(function (c) { return state.collectedSet[c.id]; }).length;
  }

  function updateStats() {
    ui.owned.textContent = String(ownedCount());
    ui.total.textContent = String(state.cards.length);
    ui.draws.textContent = String(state.draws);
  }

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (Array.isArray(data.collected)) {
        state.collected = data.collected;
        data.collected.forEach(function (id) { state.collectedSet[id] = true; });
      }
      if (typeof data.draws === 'number') state.draws = data.draws;
    } catch (e) { /* 忽略损坏的记录 */ }
  }

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        collected: state.collected,
        draws: state.draws
      }));
    } catch (e) { /* 隐私模式等场景下静默失败 */ }
  }

  /* ============ 交互 ============ */

  function updateButtons() {
    var disabled = state.busy;
    ui.btnOne.disabled = disabled;
    ui.btnTen.disabled = disabled;
  }

  function doDraw(n) {
    if (state.busy || !state.cards.length) return;
    state.busy = true;
    updateButtons();
    renderDrawCount(n);
    renderDraw(drawMany(n));
  }

  function openModal(title, content) {
    ui.modalTitle.textContent = title;
    ui.modalBody.innerHTML = '';
    ui.modalBody.appendChild(content);
    ui.modal.hidden = false;
  }

  function closeModal() {
    ui.modal.hidden = true;
    ui.modalBody.innerHTML = '';
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function showProbabilities() {
    var wrap = document.createDocumentFragment();
    var table = document.createElement('table');
    table.className = 'prob-table';

    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', null, '稀有度'));
    hr.appendChild(el('th', null, '档位'));
    hr.appendChild(el('th', null, '该档概率'));
    hr.appendChild(el('th', null, '单张概率'));
    hr.appendChild(el('th', null, '卡数'));
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    state.table.slice().reverse().forEach(function (t) {
      var tr = el('tr');
      var tdStar = el('td', 'star', stars(t.stars));
      tdStar.style.setProperty('--c', t.color);
      tr.appendChild(tdStar);
      tr.appendChild(el('td', null, t.name));
      tr.appendChild(el('td', null, (t.chance * 100).toFixed(1) + '%'));
      tr.appendChild(el('td', null, ((t.chance / t.count) * 100).toFixed(2) + '%'));
      tr.appendChild(el('td', null, String(t.count)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    var tfoot = el('tfoot');
    var fr = el('tr');
    var fd = el('td', null, '十连必得 ★' + (state.config.tenPullGuarantee || 3) + ' 以上 · 共 ' + state.cards.length + ' 张卡');
    fd.colSpan = 5;
    fr.appendChild(fd);
    tfoot.appendChild(fr);
    table.appendChild(tfoot);

    wrap.appendChild(table);
    openModal('出现概率', wrap);
  }

  function showBook() {
    var wrap = document.createDocumentFragment();

    state.table.slice().reverse().forEach(function (t) {
      var group = el('div', 'book-group');
      group.style.setProperty('--c', t.color);

      var list = state.groups[t.stars] || [];
      var owned = list.filter(function (c) { return state.collectedSet[c.id]; }).length;

      var head = el('h3');
      head.appendChild(el('span', null, stars(t.stars) + ' ' + t.name));
      head.appendChild(el('span', null, owned + ' / ' + list.length));
      group.appendChild(head);

      var box = el('div', 'book-list');
      list.forEach(function (card) {
        var got = !!state.collectedSet[card.id];
        var item = el('div', 'book-item' + (got ? '' : ' locked'));
        item.appendChild(el('span', 'cat', card.category));
        item.appendChild(el('span', null, got ? card.body : '？？？'));
        if (got) {
          item.style.cursor = 'pointer';
          item.addEventListener('click', function () { openDetail(card); });
        }
        box.appendChild(item);
      });
      group.appendChild(box);
      wrap.appendChild(group);
    });

    var bar = el('div', 'row-between');
    bar.appendChild(el('span', null, '已收集 ' + ownedCount() + ' / ' + state.cards.length + ' 张'));
    var reset = el('button', 'danger', '清空收集记录');
    reset.type = 'button';
    reset.addEventListener('click', function () {
      if (!window.confirm('清空已收集的图鉴和抽卡次数？此操作不可撤销。')) return;
      state.collected = [];
      state.collectedSet = {};
      state.draws = 0;
      save();
      updateStats();
      closeModal();
    });
    bar.appendChild(reset);
    wrap.appendChild(bar);

    openModal('灵感图鉴', wrap);
  }

  function openDetail(card) {
    var tier = tierOf(card.stars);
    var box = el('div', 'detail-card');
    box.style.setProperty('--c', tier.color);

    var head = el('div', 'card-head');
    head.appendChild(el('span', 'stars', stars(card.stars)));
    head.appendChild(el('span', 'badge', card.category));
    box.appendChild(head);
    box.appendChild(el('div', 'body', card.body));
    box.appendChild(el('div', 'card-foot', tier.name));

    openModal('灵感详情', box);
  }

  function showError(message) {
    ui.empty.hidden = true;
    ui.cards.hidden = true;
    var box = el('div', 'error-box');
    box.appendChild(el('p', null, '卡池没加载出来：' + message));
    var p = el('p');
    p.innerHTML = '如果是本地直接双击打开的 <code>index.html</code>，浏览器会拦住读取 JSON。' +
      '请在这个文件夹里运行 <code>node serve.js</code>（或双击 <code>start.bat</code>），' +
      '再从 <code>http://localhost:8080/</code> 打开。';
    box.appendChild(p);
    ui.stage.innerHTML = '';
    ui.stage.appendChild(box);
  }

  /* ============ 启动 ============ */

  function bind() {
    ui.btnOne.addEventListener('click', function () { doDraw(1); });
    ui.btnTen.addEventListener('click', function () { doDraw(10); });
    ui.btnProb.addEventListener('click', showProbabilities);
    ui.btnBook.addEventListener('click', showBook);
    ui.modalClose.addEventListener('click', closeModal);
    ui.modal.addEventListener('click', function (e) {
      if (e.target === ui.modal) closeModal();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !ui.modal.hidden) closeModal();
    });
  }

  function boot() {
    ui = {
      stage: $('stage'),
      empty: $('empty'),
      cards: $('cards'),
      title: $('pool-title'),
      sub: $('pool-sub'),
      owned: $('stat-owned'),
      total: $('stat-total'),
      draws: $('stat-draws'),
      btnOne: $('btn-one'),
      btnTen: $('btn-ten'),
      btnProb: $('btn-prob'),
      btnBook: $('btn-book'),
      modal: $('modal'),
      modalTitle: $('modal-title'),
      modalBody: $('modal-body'),
      modalClose: $('modal-close'),
      emptyNote: $('empty-note')
    };

    flashEl = document.createElement('div');
    flashEl.className = 'flash';
    document.body.appendChild(flashEl);

    load();
    bind();

    loadConfig().then(function (cfg) {
      state.config = cfg;
      document.title = (cfg.title || DEFAULT_CONFIG.title) + ' · 灵感卡池';
      ui.title.textContent = cfg.title || DEFAULT_CONFIG.title;
      ui.sub.textContent = cfg.subtitle || DEFAULT_CONFIG.subtitle;
      ui.emptyNote.textContent = '十连必得 ★' + (cfg.tenPullGuarantee || 3) + ' 以上';
      return fetchJson(cfg.poolUrl || DEFAULT_CONFIG.poolUrl);
    }).then(function (data) {
      var raw = data && (data['_灵感全集'] || data.cards || data.pool || data['卡池']);
      state.cards = buildCards(raw);
      if (!state.cards.length) throw new Error('卡池是空的，检查一下 _灵感全集');
      buildGroups();
      buildTable();
      updateStats();
      updateButtons();
    }).catch(function (err) {
      showError(err && err.message ? err.message : String(err));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
