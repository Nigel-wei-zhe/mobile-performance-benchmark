# Mobile Performance Benchmark

這個專案用來量測一個或多個網站目標在 mobile 場景下的實際效能，並產出可互動的 HTML 報告。比較網址集中設定在根目錄 `target.json`。

## 快速開始

```bash
nvm use
pnpm install
cp target.example.json target.json
pnpm run doctor
pnpm run benchmark:fast
pnpm run report
```

`pnpm run report` 會根據最新一次 benchmark 產生報告。若要分別查看 Fast 4G 和 Slow 4G，請每跑完一組 benchmark 就產生一次報告：

```bash
pnpm run benchmark:fast
pnpm run report

pnpm run benchmark:slow
pnpm run report
```

報告輸出位置：

- `results/latest-report.html`
- `results/latest-raw.json`
- `results/latest-report.md`，執行 `pnpm run report:md` 後產生
- `results/latest-summary.csv`，執行 `pnpm run report:md` 後產生

## 預設測試條件

- Browser: Google Chrome
- Device: iPhone 12 viewport
- Network: Fast 4G 或 Slow 4G
- CPU: 4x slowdown
- Cache: cold cache
- Runs: `benchmark:fast` 為 5 次，`benchmark:slow` 為 10 次

## 設定比較網址

先複製範例設定，再編輯根目錄 `target.json`：

```bash
cp target.example.json target.json
```

```json
{
  "project": "Website Performance Benchmark",
  "targets": [
    {
      "id": "new",
      "label": "新版",
      "url": "https://www.example.com/new"
    },
    {
      "id": "old",
      "label": "舊版",
      "url": "https://www.example.com/old"
    }
  ]
}
```

`targets` 可以只有一個，也可以有多個：

- 只有一個 target：報告只顯示該網站的 median 與 p75，不計算改善幅度。
- 多個 target：報告會用 `id: "old"` 作為 baseline；如果沒有 `old`，就用第一個 target 作為 baseline。
- 每個 target 的 `id` 必須唯一。

`target.json` 可能包含內部網址、query string 或 token，預設由 `.gitignore` 排除；`results/` 是本機產物，也預設不提交。

## 常用指令

```bash
# 切換 Node 版本
nvm use

# 環境檢查
pnpm run doctor

# Fast 4G，cold cache，5 次
pnpm run benchmark:fast

# Slow 4G，cold cache，10 次
pnpm run benchmark:slow

# 自訂次數與條件
pnpm run benchmark -- --runs 10 --network fast4g --cache cold --cpu 4
pnpm run benchmark -- --runs 10 --network slow4g --cache cold --cpu 4

# 重新產生並開啟 HTML 報告
pnpm run report

# 產生 Markdown 與 CSV 報告
pnpm run report:md
```

## HTML 報告功能

`results/latest-report.html` 會提供：

- 樣本品質：列出每個 target 的 valid / invalid runs；若有 invalid runs，會條列原因。
- Target 量測結果：可切換 target，查看 median / p75 / min / max。
- 綜合分數：以各指標 median 換算為 0-100 分，再依權重加總。
- 權重表：顯示各指標權重、子分數、median；滑過 `?` 可查看給分門檻。
- 指標比較：可選 baseline target 與 compare target，查看差異與改善幅度。
- Prompt 匯出：可複製單一 target 分析 prompt，或 baseline / compare 比較 prompt。
- PNG 匯出：可匯出 `Target 量測結果` 或 `指標比較` 區塊圖片。
- 測試方法：說明每個指標的資料來源、測試方式與注意事項。

## 綜合分數權重

分數以 valid runs 的 median 計算。每個指標會先依 good / poor 門檻線性換算成 0-100 分，再套用以下權重：

| 指標 | 權重 |
| --- | ---: |
| LCP | 30% |
| TBT | 25% |
| FCP | 15% |
| CLS | 10% |
| Transfer Size | 8% |
| Request Count | 6% |
| DOMContentLoaded | 4% |
| Load Event | 2% |

## 改善幅度

```text
改善幅度 = (baseline 數值 - target 數值) / baseline 數值 * 100%
```

例如 baseline LCP 5200ms，target LCP 3400ms：

```text
(5200 - 3400) / 5200 * 100% = 34.6%
```

## 檔案結構

```text
target.example.json   比較目標網址範例
target.json           本機比較目標網址，預設不提交
config/
  profiles.json       測試裝置、網路、CPU、Chrome path
docs/
  test-plan.md        測試計劃與驗收標準
scripts/
  doctor.mjs          環境檢查
  run-benchmark.mjs   CDP 批次量測
  generate-html-report.mjs HTML 報告產生器
  generate-report.mjs Markdown / CSV 報告產生器
  report/
    styles.css        HTML 報告樣式
    client.js         HTML 報告互動邏輯
results/
  latest-report.html  最新 HTML 報告，預設不提交
  latest-raw.json     最新原始資料，預設不提交
  latest-report.md    最新 Markdown 報告，預設不提交
  latest-summary.csv  最新 CSV 摘要，預設不提交
```
