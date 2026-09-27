# 抽取灵感 · 灵感卡池

一个纯前端的抽卡小游戏：从灵感卡池里单抽或十连抽，抽到的灵感会记进图鉴。
卡池内容直接从 JSON 读取，**改 JSON 就等于改卡池**，不需要重新构建。

## 目录结构

```
抽取灵感小游戏/
├─ index.html            页面
├─ assets/
│  ├─ style.css          样式
│  └─ app.js             抽卡逻辑
├─ 抽取灵感.json          ★ 卡池内容（改这里就能更新卡池）
├─ pool.config.json       ★ 掉率、稀有度归属、标题
├─ serve.js              本地预览用的小服务器（零依赖）
├─ start.bat             Windows 双击即可本地预览
└─ README.md
```

## 本地预览

直接双击 `index.html` 会因为浏览器的安全限制而读不到 JSON，所以用下面任意一种方式：

- Windows：双击 `start.bat`
- 命令行：`node serve.js`，然后打开 http://localhost:8080/

只依赖 Node.js，没有 `npm install`，没有构建步骤。

## 怎么更新卡池

卡池就是 `抽取灵感.json` 里的 `_灵感全集` 数组，一条灵感一个对象，**稀有度直接写在条目里**。

1. **改内容**：编辑 `抽取灵感.json` 的 `_灵感全集`。
2. **改概率**：编辑 `pool.config.json`。
3. 提交并推送，网页刷新就是新卡池（GitHub Pages 有缓存，最多约 10 分钟完全生效）。

也可以完全不开本地环境：在 GitHub 仓库页面点开 `抽取灵感.json`，点铅笔图标改完 `Commit changes`，稍等片刻线上就更新了。

### 条目的写法

一条一个对象，两个字段：

```json
"_灵感全集": [
    { "稀有度": 1, "灵感": "纯粹的负面情感。除了让你烦躁，没有任何作用。" },
    { "稀有度": 4, "灵感": "高度抽象：你看见了一个精彩的、从未被发现的结构……" },
    { "稀有度": 5, "灵感": "切水果，但你控制水果" }
]
```

- **稀有度**：写星级数字（`1`–`5`）就行，写档位名（比如 `"天启"`）也认。
- **灵感**：卡片正文。想给卡片加个角标就写成「标签：正文」（标签不超过 20 字），冒号后半段会当正文；不写标签就只显示所属档位名。
- 重复的条目会自动去重。
- 条目没写 `稀有度` 时会用 `pool.config.json` 里的 `defaultRarity`。
- 想少打点字，字段名也认 `星级` / `rarity` 和 `text` / `body` / `内容`。

### 掉率怎么调

`pool.config.json` 里只写每个稀有度抽到的概率：

```json
"rarities": [
  { "stars": 5, "name": "天启", "probability": 5, "color": "#ffb340" }
]
```

- `probability` 是**相对权重**，不用凑够 100，程序会自己归一化；直接写百分比数字最直观。设成 `0` 等于关掉这一档。
- 卡片属于哪一档，**只看条目里的 `稀有度`**，卡面上的标签不参与概率计算。
- 想加 ★6：往 `rarities` 里加一项（`"stars": 6` + 一个 `probability`），条目里写 `"稀有度": 6` 就行。
- 同一档里每张卡等概率，所以某档的「单张概率」= 该档概率 ÷ 该档卡数。往一个档里加卡，档位概率不变，单张概率被摊薄。

另外还有一条保底：**十连必得 ★3 以上**（可在 `tenPullGuarantee` 里改，设成 `0` 关闭）。

## 部署到 GitHub Pages

1. 在 GitHub 上新建一个 **Public** 仓库，例如 `inspiration-gacha`。
2. 把本项目所有文件推上去：

   ```bash
   git init
   git add .
   git commit -m "抽取灵感小游戏"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/inspiration-gacha.git
   git push -u origin main
   ```

3. 打开仓库 Settings → Pages，Source 选 **Deploy from a branch**，Branch 选 **main** + **/ (root)**，Save。
4. 等 1～2 分钟，访问 `https://<你的用户名>.github.io/inspiration-gacha/`。

因为没有构建步骤，之后每次改完 JSON 推送一下，站点就会自动重新发布。

## 已知限制

- 图鉴和抽卡次数存在浏览器 `localStorage` 里，换设备或清缓存会丢；这是有意为之（不需要后端）。
- 收藏记录按**卡片文本内容**记录，所以增删卡池不会让已有记录错位；但如果把某条文本改掉，那条会被当成新卡重新收集。
- 全部是静态文件，任何静态托管（GitHub Pages / Cloudflare Pages / Vercel）都能直接放。
