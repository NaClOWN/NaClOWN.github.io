/* 改完卡池先跑一下这个，能提前发现 JSON 写错、稀有度没配对之类的问题：
       node tools/check-pool.js
   返回码 0 = 没问题，1 = 有问题。 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const poolPath = path.join(root, '抽取灵感.json');
const configPath = path.join(root, 'pool.config.json');

let problems = 0;
const warn = (msg) => { console.log('  [!!] ' + msg); problems++; };

function readJson(p) {
  /* 这两个文件可能带 UTF-8 BOM，浏览器会自动忽略，node 不会 */
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
}

let pool;
try {
  pool = readJson(poolPath);
} catch (e) {
  console.log('抽取灵感.json 解析失败：' + e.message);
  process.exit(1);
}

const list = pool['_灵感全集'];
if (!Array.isArray(list)) {
  console.log('抽取灵感.json 里的 _灵感全集 不是数组');
  process.exit(1);
}

const counts = {};
const seen = new Set();
let noRarity = 0;
let empty = 0;
let dup = 0;

list.forEach((item) => {
  const isObj = item && typeof item === 'object';
  const text = String(isObj ? (item['灵感'] || item.text || '') : item).trim();
  const rarity = isObj ? (item['稀有度'] || item.rarity) : undefined;

  if (!text) { empty++; return; }
  if (seen.has(text)) dup++;
  seen.add(text);

  if (rarity === undefined || rarity === null || rarity === '') noRarity++;
  else counts[String(rarity)] = (counts[String(rarity)] || 0) + 1;
});

console.log('卡池：' + list.length + ' 条');
Object.keys(counts).sort((a, b) => Number(a) - Number(b)).forEach((r) => {
  console.log('  ★' + r + ' → ' + counts[r] + ' 条');
});
if (noRarity) warn(noRarity + ' 条没写稀有度，会按 pool.config.json 的 defaultRarity 处理');
if (dup) warn(dup + ' 条内容重复，网页会去重，只算一张');
if (empty) warn(empty + ' 条内容为空，会被忽略');

let cfg;
try {
  cfg = readJson(configPath);
} catch (e) {
  console.log('pool.config.json 解析失败：' + e.message);
  process.exit(1);
}

const defs = {};
(cfg.rarities || []).forEach((d) => { defs[String(d.stars)] = d; });

const total = (cfg.rarities || []).reduce((s, d) => s + (parseFloat(d.probability) || 0), 0);
console.log('概率（pool.config.json）：');
(cfg.rarities || []).forEach((d) => {
  const p = parseFloat(d.probability) || 0;
  const pct = total > 0 ? ((p / total) * 100).toFixed(1) + '%' : '—';
  console.log('  ' + '★'.repeat(Number(d.stars) || 0) + ' ' + (d.name || '') + '：' + pct);
});

Object.keys(counts).forEach((r) => {
  const d = defs[r];
  if (!d) {
    warn('稀有度 ★' + r + ' 在 rarities 里没配置，会按权重 1 参与抽卡');
  } else if ((parseFloat(d.probability) || 0) <= 0) {
    warn('稀有度 ★' + r + ' 的概率是 0，但卡池里有 ' + counts[r] + ' 条，这些卡永远抽不到');
  }
});

console.log(problems ? '\n有 ' + problems + ' 处需要确认（不影响能不能跑，但建议看一眼）' : '\n检查通过');
process.exit(problems ? 1 : 0);
