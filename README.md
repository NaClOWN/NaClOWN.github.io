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

卡池就是 `抽取灵感.json` 里的 `_灵感全集` 数组，一个字符串一条灵感。增、删、改条目都可以。

1. **改内容**：编辑 `抽取灵感.json` 的 `_灵感全集`。
2. **改掉率 / 稀有度**：编辑 `pool.config.json`。
3. 提交并推送，网页刷新就是新卡池（GitHub Pages 有缓存，最多约 10 分钟完全生效）。

也可以完全不开本地环境：在 GitHub 仓库页面点开 `抽取灵感.json`，点铅笔图标改完 `Commit changes`，稍等片刻线上就更新了。

### 条目的写法

普通字符串就行，程序按「类别：正文」自动拆：

```json
"故事灵感：一个只有心脏处是不透明的人。"
```

- 冒号前面（≤10 字）当作卡片上的类别标签，后面是正文。
- 重复的条目会自动去重。
- 没写过冒号的条目会归到「未分类」，照样能抽到（稀有度用 `defaultRarity`）。
- 想给某条单独指定稀有度，可以把条目换成对象：`{ "category": "游戏灵感", "text": "……", "rarity": 5 }`。

### 掉率怎么调

`pool.config.json` 里的 `rarities[].weight` 是**相对权重**，不用凑够 100，程序会自己归一化。想在网页上看到 5★ 更常见，把它的 `weight` 从 `5` 调到 `15` 就行；把某个档位的 `weight` 设成 `0` 就等于关掉这一档。

默认档位：

| 星级 | 档位 | 权重 | 包含的类别 |
| --- | --- | --- | --- |
| ★ | 杂念 | 46 | 负面情感、正面情感 |
| ★★ | 日常 | 24 | 普通灵感、走神 |
| ★★★ | 灵光 | 16 | 平静、遗忘、ph灵感 |
| ★★★★ | 奇想 | 9 | 故事灵感 |
| ★★★★★ | 天启 | 5 | 游戏灵感、高度抽象、梦中线 |

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
