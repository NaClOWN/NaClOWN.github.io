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
      { stars: 1, name: '杂念', probability: 46, color: '#8b93a7' },
      { stars: 2, name: '日常', probability: 24, color: '#3fd0a8' },
      { stars: 3, name: '灵光', probability: 16, color: '#5b8cff' },
      { stars: 4, name: '奇想', probability: 9, color: '#c06cff' },
      { stars: 5, name: '天启', probability: 5, color: '#ffb340' }
    ],
    /* 可选兜底：条目自己没写稀有度时，才按类别找星级 */
    categoryRarity: {},
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

  var TEXT_KEYS = ['灵感', 'text', 'body', '内容', '正文'];
  var CAT_KEYS = ['类别', 'category', '分类'];
  var RARITY_KEYS = ['稀有度', 'rarity', '星级', 'stars', '星'];

  function firstKey(obj, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = obj[keys[i]];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
  }

  function splitPrefix(text) {
  /* 条目的「标签：正文」写法里，标签会被识别出来，用于判断特殊卡外观；
       但正文照原样显示（标签也一起显示）。
       判断条件：标签不超过 20 字、不带句读符号、括号必须闭合，
       这样「（灵感来源：xxx）」这种正文里的冒号就不会被误判成标签。 */
    var m = text.match(/^([^：:\n]{1,20})[：:]([\s\S]*)$/);
    if (m) {
      var head = m[1];
      var opens = (head.match(/[（(]/g) || []).length;
      var closes = (head.match(/[）)]/g) || []).length;
      if (!/[。，、！？；…]/.test(head) && opens === closes) {
        return { category: head.trim(), body: m[2].trim() };
      }
    }
    if (text.indexOf('你本来是想探索') === 0) return { category: '走神', body: text };
    if (text.indexOf('绝妙的灵感！') === 0) return { category: '遗忘', body: text };
    return { category: '未分类', body: text };
  }

  /* 支持两种写法：
     1) "故事灵感：一个只有心脏处是不透明的人。"            ← 没写稀有度，用 defaultRarity
     2) { "稀有度": 5, "灵感": "游戏灵感：切水果，但你控制水果" }  ← 条目自带稀有度 */
  function parseEntry(raw) {
    var text, explicitCat, forced;
    if (raw && typeof raw === 'object') {
      text = firstKey(raw, TEXT_KEYS);
      explicitCat = firstKey(raw, CAT_KEYS);
      forced = firstKey(raw, RARITY_KEYS);
      if (text === undefined) return null;
      text = String(text);
    } else {
      text = String(raw);
    }
    text = text.replace(/\r\n/g, '\n').trim();
    if (!text) return null;

    var parts = splitPrefix(text);
    var category = parts.category;
    if (explicitCat !== undefined) category = String(explicitCat).trim();

    /* body 用完整原文（含「标签：」）；key 仍然按「标签 + 去掉标签的正文」算，
       这样改显示不会让已有的图鉴收集记录失效。 */
    var card = { category: category, body: text, key: category + '\u0000' + parts.body };
    if (forced !== undefined) card.forcedRarity = forced;
    return card;
  }

  function buildCards(list) {
    if (!Array.isArray(list)) list = [];
    var seen = {};
    var out = [];
    list.forEach(function (raw) {
      var card = parseEntry(raw);
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

  /* 条目自带稀有度优先（可写数字，也可以写档位名），其次是类别映射，最后是 defaultRarity */
  function rarityOf(card) {
    if (card.forcedRarity !== undefined) {
      var n = Number(card.forcedRarity);
      if (isFinite(n)) return n;
      var want = String(card.forcedRarity).trim();
      var defs = state.config.rarities || [];
      for (var i = 0; i < defs.length; i++) {
        if (String(defs[i].name).trim() === want) return Number(defs[i].stars);
      }
      var digits = want.match(/\d+/);
      if (digits) return Number(digits[0]);
    }
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

  /* pool.config.json 里每个稀有度的概率，字段名随便挑一个写都认 */
  function readProbability(def) {
    var keys = ['probability', '概率', 'chance', 'weight'];
    for (var i = 0; i < keys.length; i++) {
      var v = def[keys[i]];
      if (v === undefined || v === null || v === '') continue;
      var n = parseFloat(v);
      if (isFinite(n)) return Math.max(0, n);
    }
    return 1;
  }

  function buildTable() {
    var defs = {};
    (state.config.rarities || []).forEach(function (d) { defs[Number(d.stars)] = d; });

    var list = Object.keys(state.groups).map(Number).sort(function (a, b) { return a - b; });
    var entries = list.map(function (r) {
      var d = defs[r] || {};
      if (!defs[r]) {
        console.warn('稀有度 ' + r + ' 没有在 pool.config.json 的 rarities 里配置概率，暂时按权重 1 参与抽卡。');
      }
      return {
        stars: r,
        name: d.name || (r + '★'),
        color: d.color || '#5b8cff',
        weight: readProbability(d),
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
    var rarity = document.createElement('span');
    rarity.className = 'rarity';
    rarity.textContent = stars(card.stars) + ' ' + tier.name;
    head.appendChild(rarity);

    var body = document.createElement('p');
    body.className = 'body';
    body.textContent = card.body;

    front.appendChild(head);
    front.appendChild(body);
    if (opts.hint) {
      var foot = document.createElement('div');
      foot.className = 'card-foot';
      var hint = document.createElement('span');
      hint.textContent = opts.hint;
      foot.appendChild(hint);
      front.appendChild(foot);
    }
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
      var node = makeCard(card, { clickable: !single, hint: single ? '' : '点卡片看全文' });
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
    head.appendChild(el('span', 'rarity', stars(card.stars) + ' ' + tier.name));
    box.appendChild(head);
    box.appendChild(el('div', 'body', card.body));

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
