# 部署紀錄

任務時間軸有兩個部署，資料互不相通：

| | 網址 | 模式 | 資料在哪 |
|---|---|---|---|
| 公開版 | <https://tasks.storiesbang.com> | 本機檔案模式（純靜態） | 每個使用者自己電腦上的 `.json` |
| 私人版 | `http://<m1>:3100`（只有 Tailscale 連得到） | 伺服器模式 | M1 `~/task_manager/data/timeline.json` |

舊的 Vercel 版（<https://task-timeline-seven.vercel.app>）已由公開版取代。

## 公開版：Cloudflare Workers（2026-10-04 設定）

### 為什麼不用 Vercel、不用 tunnel

- 本機檔案模式的資料只存在使用者電腦，伺服器只負責送出靜態檔，放哪都可以。網域本來就在 Cloudflare，所以 DNS、SSL、網站都放 Cloudflare 一起管。
- 沒有放伺服器資料，所以不需要 Cloudflare Access 之類的登入保護。
- 用子網域不用子路徑：`storiesbang.com` 本身是 GitHub Pages 的站。如果改成 `storiesbang.com/task-manager`，程式要加 basePath，主網域要改成經過 Cloudflare 代理，還要多寫一個 Worker 分流。子網域什麼都不用動。
- 子網域、Workers 靜態網站在這個用量下都免費。

### 程式端的改動

- `next.config.ts`：`NEXT_PUBLIC_STORAGE=file` 時改成 `output: "export"`，輸出純靜態檔到 `out/`；否則照舊用 `standalone`，給 M1 用。
- API 改名為 `app/api/timeline/route.server.ts`，靠 `pageExtensions` 控制：靜態輸出時它不算 route，不會被包進去，因為靜態輸出不支援 PUT。
- `wrangler.jsonc`：告訴 Cloudflare 要上傳 `out/`。

### Cloudflare 後台設定

1. Workers & Pages → Create → 匯入 GitHub repo `storiesbang/task-timeline`。新版介面預設走 Workers 流程，沒有 Pages 的 output directory 欄位，所以設定寫在 `wrangler.jsonc`。
2. 填入以下設定：
   - Build command：`NEXT_PUBLIC_STORAGE=file npm run build`
     - 介面上找不到 Build variables 欄位，所以變數直接寫在指令裡。如果另外設了變數，範圍選 Production and preview。
   - Deploy command：`npx wrangler deploy`
   - Protect with Cloudflare Access：不勾
   - API token：讓它自動建立
3. Worker → Settings → Domains & Routes → Add → Custom domain → `tasks.storiesbang.com`。DNS 紀錄會自動建立。

push 到 `main` 就會自動重新部署。

> ⚠️ build 時如果沒帶到 `NEXT_PUBLIC_STORAGE=file`，會 build 出伺服器模式的版本，打開只顯示「載入中…」。

### 存檔

公開版沒有雲端存檔：

- 第一次用時選「建立新的」，挑一個位置存 `timeline.json`。之後打開網頁都是「開啟」同一個檔。
- Chrome 和 Edge 會自動寫回檔案；Safari 和 Firefox 要手動下載。
- 網頁不會記住檔案位置。檔案放在 iCloud Drive 或 Dropbox，就能跨電腦使用。

把 M1 的私人資料複製一份出來用（複製後兩份各自獨立，不會同步）：

```bash
scp m1:task_manager/data/timeline.json ~/Desktop/timeline.json
```

## 私人版：M1

- 更新：`./deploy.sh`。流程是在 M4 build standalone、rsync 到 M1、重啟 launchd、做 health check。
- launchd label `com.storiesbang.task-manager`，port 3100，用自帶的 Node 22。
- 資料在 `~/task_manager/data/`，部署流程不會碰它。log 在 `~/task_manager/logs/server.log`。
