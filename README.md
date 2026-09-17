# 任務時間軸

把競賽、研究、課業等不同專案的階段與截止日期，放在同一條互動式時間軸上。

**直接使用：<https://task-timeline-seven.vercel.app>**

不用註冊、不用安裝。打開後按「建立新的」就能開始，資料存在你自己的電腦上（見下方[資料存在哪裡](#資料存在哪裡)）。

- 分類 → 專案 → 階段三層，階段有「區間／整天／時間點」三種
- 拖曳移動、拖右緣調整長度、雙擊空白處新增、點一下編輯
- 左欄倒數最近一個未完成階段，逾期標紅
- 重疊階段自動分道，階段之間的空檔標示「等待 N 天」
- 週／月／季縮放，跟隨系統淺色／深色

## 資料存在哪裡

build 時用環境變數選擇儲存模式：

| 模式 | 設定 | 資料位置 | 適合 |
|---|---|---|---|
| 本機檔案 | `NEXT_PUBLIC_STORAGE=file` | 使用者自己電腦上的 `.json` 檔 | 公開架站給多人用 |
| 伺服器（預設） | 不設定 | 伺服器上的 `data/timeline.json`（可用 `DATA_DIR` 改位置） | 自己架在自己的電腦或家用伺服器 |

**本機檔案模式**打開網站後，可以「匯入存檔」或「建立新的」：

- **Chrome、Edge**：修改後自動寫回原本的檔案。
- **Safari、Firefox**：瀏覽器不支援直接寫檔，修改後請按右上角「下載存檔」，下次開網站再匯入。

資料不會上傳到伺服器。這個模式下 `/api/timeline` 會停用。

> ⚠️ 伺服器模式沒有登入保護，連得到的人都能讀寫，不要直接開放到公開網路。

## 開發

需要 Node.js 20 以上。

```bash
npm install
npm run dev                                 # 伺服器模式，http://localhost:3000
NEXT_PUBLIC_STORAGE=file npm run dev        # 本機檔案模式
node --test lib/timeline.test.mjs           # 測試
```

## 部署

**Vercel**（本機檔案模式）：匯入這個 repo，在 Environment Variables 加上 `NEXT_PUBLIC_STORAGE` = `file`，然後按 Deploy。

**自己架**（伺服器模式）：

```bash
npm run build
DATA_DIR=/path/to/data PORT=3000 npm start
```

File System Access API 需要 HTTPS（或 `localhost`）才能用。

## 資料格式

```ts
{
  categories: string[];
  projects: {
    id: string; title: string; category: string;
    phases: { id: string; name: string; kind: 'range' | 'day' | 'event'; startAt: string; endAt?: string; isCompleted: boolean }[];
  }[];
}
```

時間一律存成 ISO 8601（UTC）。

## 授權

[MIT](LICENSE)
