# 網站效能比較測試計劃

## 目標

量化兩個網站目標在 Mobile Web 場景的效能差異，輸出可重複驗證的數據報告。

## 測試網址

比較目標集中設定於根目錄 `target.json`。第一次使用可從 `target.example.json` 複製；`target.json` 可能包含內部網址或 query string，預設不提交。可以設定一個或多個 target；多個 target 時會優先以 `id: "old"` 作為 baseline，沒有 `old` 時使用第一個 target。

## 量測指標

| 指標 | 用途 | 改善方向 |
| --- | --- | --- |
| FCP | 第一個內容出現時間 | 越低越好 |
| LCP | 首屏主要內容完成時間 | 越低越好 |
| TBT | 主執行緒阻塞時間 | 越低越好 |
| CLS | 版面穩定性 | 越低越好 |
| DOMContentLoaded | DOM 解析完成時間 | 越低越好 |
| Load Event | 頁面 load 完成時間 | 越低越好 |
| Transfer Size | 網路傳輸量 | 越低越好 |
| Request Count | HTTP 請求數 | 越低越好 |

改善幅度公式：

```text
改善幅度 = (舊版數值 - 新版數值) / 舊版數值 * 100%
```

## 固定測試條件

| 項目 | 設定 |
| --- | --- |
| 裝置 | iPhone 12 viewport, 390x844, DPR 3 |
| CPU | 4x slowdown |
| 網路 | Fast 4G / Slow 4G |
| Cache | cold cache 為主，必要時補 warm cache |
| 次數 | 每組至少 10 次，報告以 median 與 p75 為主 |

## 建議驗收門檻

| 指標 | 目標 |
| --- | --- |
| LCP | 新版至少改善 20% |
| FCP | 新版至少改善 15% |
| TBT | 新版至少改善 30% |
| Transfer Size | 新版至少減少 20% |
| Request Count | 新版至少減少 15% |
| CLS | 不得比舊版變差 |

## 執行流程

1. 複製 `target.example.json` 為 `target.json`，並設定比較網址。
2. 執行 `pnpm run doctor` 確認 Node 與 Chrome 環境。
3. 執行 `pnpm run benchmark:fast` 取得 Fast 4G cold cache 數據。
4. 執行 `pnpm run benchmark:slow` 取得 Slow 4G cold cache 數據。
5. 執行 `pnpm run report` 產出並開啟最新 HTML 報告。
6. 檢查 `results/latest-report.html`，確認新版是否達到驗收門檻。
