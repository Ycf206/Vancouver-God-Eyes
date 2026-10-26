# 溫哥華天眼 (Vancouver God's Eye) - 數據管線排程與 API 更新程序清單

本文件為全平台所有 API 數據源、地理空間圖層 (GeoJSON)、排程週期、自動化管線與更新機制的權威登錄表。

---

## 一、 架構本質：GitHub Actions 與 後端排程的職責分工

平台中的數據依照**時效性需求**與**伺服器資源消耗**分為兩大不同管線架構：

```
                    ┌────────────────────────────┐
                    │  Vancouver God's Eye 架構  │
                    └──────────────┬─────────────┘
                                   │
         ┌─────────────────────────┴─────────────────────────┐
         ▼                                                   ▼
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│     類別 A: 靜態/半靜態 GeoJSON │       │     類別 B: 超高頻即時動態 API  │
│  (每小時 / 每週 / 每月 / 每季)  │       │      (每 30 秒 / 2 分鐘 / 5 分鐘) │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│ 執行載體: GitHub Actions        │       │ 執行載體: OCI 後端 (FastAPI)    │
│ 產出物: .geojson 實體檔案       │       │ 產出物: 記憶體快取 (Memory Cache)│
│ 同步方式: Git commit & push     │       │ 同步方式: 前端短輪詢 / REST API │
│ 代表項目: 自來水、污水、學校等  │       │ 代表項目: 交通塞車、巴士、航班  │
└─────────────────────────────────┘       └─────────────────────────────────┘
```

### 1. 為什麼不能全交給 GitHub Actions？
* GitHub Actions 最小的排程間隔為 **5 分鐘**，且每月免費執行分鐘數有限（2,000 分鐘/月）。像 TomTom 塞車色帶（每 2 分鐘）、TransLink 公車即時動態（每 30 秒）、船舶 AIS（每 1 分鐘）這種每分鐘都在變化的實時資料，若用 GitHub Actions 跑會瞬間耗盡額度且延遲過高，必須由 OCI 後端伺服器在記憶體中即時輪詢與快取。

### 2. 為什麼不能全交給 OCI 後端定時跑？
* 溫哥華自來水管（24MB）、污水管（15MB）、路燈電網（33MB）等大型空間檔案，如果全塞給後端伺服器定時下載、解析、生成並存放，會嚴重消耗伺服器 CPU、記憶體與磁碟頻寬。利用 GitHub 雲端免費 Runner 下載與轉換，並透過 GitHub 倉庫自動版本化託管，既能省下主機負載，又能確保檔案隨時由 CDN 進行高併發靜態分發。

---

## 二、 全平台數據源排程與數據管線全覽表

### 1. 即時動態數據 (Real-time Dynamic APIs) — 由 OCI 後端主導

| 資料源 ID | 資料源名稱 | 預設頻率 | 排程 Cron | 執行載體 | 數據提供者 / API 端點 | 快取與儲存位置 | 數據管線更新程序備註 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `traffic_conditions` | **TomTom 即時交通路況** | 每 2 分鐘 | `*/2 * * * *` | OCI 後端 | TomTom Traffic Flow API (實時探針) | 後端記憶體快取 `traffic_conditions` | 呼叫 TomTom 流量 API 抓取 65 條主要幹道時速與延誤時間，向量路網座標比對並計算各向壅塞等級 (綠/黃/紅/深紅)，推送前端即時路網。 |
| `translink_realtime` | **TransLink 大眾運輸即時動態** | 每 30 秒 | `*/30 * * * * *` | OCI 後端 | TransLink Open API (RTTI & GTFS-RT) | 後端記憶體快取 `translink_vehicles` | 透過 GTFS Realtime Protocol 抓取全大溫 1,400+ 輛行駛中公車、天車即時 GPS 座標、車號與延誤秒數，前端透過插值動畫平滑移動。 |
| `flight_schedules` | **YVR 國際機場航班** | 每 2 分鐘 | `*/2 * * * *` | OCI 後端 | YVR Airport Flight Schedule API | 後端記憶體快取 `yvr_flights` | 抓取全日客貨運航班起降動態、準點/延誤狀態、登機門與行李轉盤，支援 Explore 航班看板搜尋。 |
| `maritime_shipping` | **AIS 港口船舶動態** | 每 1 分鐘 | `*/1 * * * *` | OCI 後端 | AISStream WebSocket / 溫哥華港務局 | 後端記憶體快取 `ais_ships` | 監控布勒內灣、英吉利灣、菲沙河各類貨輪、郵輪、拖船與渡輪，即時計算船舶航速、航向角與吃水資訊。 |
| `weather_monitoring` | **加拿大環境部 SWOB 氣象站** | 每 10 分鐘 | `*/10 * * * *` | OCI 後端 | ECCC MSC GeoMet API & RainViewer | 後端記憶體快取 `eccc_weather` | 抓取氣溫、濕度、風向風速、氣壓實測數值，並疊加北美多普勒雷達降水回波瓦片與氣象衛星雲圖。 |
| `traffic_cameras` | **交通即時攝影機** | 每 5 分鐘 | `*/5 * * * *` | OCI 後端 | DriveBC Open511 & 溫哥華市府監控網 | `/public/vancouver_traffic_cameras.geojson` | 抓取大溫主要幹道與橋樑即時快照與視訊流，校正坐標後生成即時影像預覽。 |
| `border_wait_times` | **美加邊境通關等候時間** | 每 5 分鐘 | `*/5 * * * *` | OCI 後端 | CBSA BWT & 美國 CBP 即時 API | 後端記憶體快取 `border_wait` | 追蹤和平拱門 (Peace Arch)、太平洋公路等口岸之標準車道與 NEXUS 車道預估排隊分鐘數。 |
| `tides_hydrometric` | **CHS 海洋潮汐與水文站** | 每 15 分鐘 | `*/15 * * * *` | OCI 後端 | 加拿大漁業及海洋部 (DFO CHS API) | 後端記憶體快取 `tides_data` | 讀取 Point Atkinson、Vancouver Harbour 等潮位水深數值，計算高低潮潮時與菲沙河流量。 |
| `ski_resorts` | **三大滑雪場即時雪況** | 每 15 分鐘 | `*/15 * * * *` | OCI 後端 | Cypress, Grouse, Seymour 官方 API | 後端記憶體快取 `ski_status` | 爬取 24 小時新雪量、積雪厚度、纜車開放比例與夜滑狀態，供 Explore 面板展示。 |
| `fuel_prices` | **大溫地區即時油價** | 每 1 小時 | `0 */1 * * *` | OCI 後端 | 加拿大能源情報 / GasBuddy 聚合 | 後端記憶體快取 `fuel_prices` | 聚合溫哥華各品牌 (Chevron, Shell, Petro-Canada 等) 87/91/柴油即時單價，計算比價排名。 |
| `aurora_forecast` | **NOAA 極光觀測指數** | 每 2 小時 | `0 */2 * * *` | OCI 後端 | 美國 NOAA SWPC 預報中心 | 後端記憶體快取 `aurora_data` | 讀取 3 小時地磁 Kp 指數與 G-Scale 風暴預警，計算溫哥華觀測機率與 Viewline 雲圖。 |

---

### 2. 空間圖層數據 (Spatial GeoJSON Layers) — 由 GitHub Actions 主導

| 圖層 ID | 圖層名稱 | 預設週期 | GitHub Actions 工作流 | 執行腳本路徑 | 產出檔案路徑 | 數據管線更新程序備註 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `shared_bikes` | **Mobi 共享單車** | 每小時整點 (`0 * * * *`) / 每月 1 號 (`0 4 1 * *`) | `update-shared-bikes-hourly.yml`<br>`update-shared-bikes-monthly.yml` | `backend/scripts/layers/update_shared_bikes.py` | `frontend/public/vancouver_shared_bikes.geojson` | 呼叫 Mobi Entities API 取得站點位置，並配合 `/entities/stations/{id}` 即時同步車輛與還車槽數量。 |
| `escooter` | **Lime 共享滑板車** | 每小時整點 (`0 * * * *`) / 每月 1 號 (`30 4 1 * *`) | `update-escooter-hourly.yml`<br>`update-escooter-monthly.yml` | `backend/scripts/layers/update_escooter.py` | `frontend/public/vancouver_escooter.geojson` | 呼叫 Lime GBFS station_information 與 station_status，每小時更新可借滑板車與還車位，自動 commit push。 |
| `schools` | **學校與教育機構** | 每週日 04:00 (`0 4 * * 0`) | `update-schools.yml` | `scripts/update_schools.mjs` | `frontend/public/vancouver_schools.geojson` | 呼叫溫哥華學校局 (VSB) 開放資料集，比對校名、教育層級與經緯度座標。 |
| `libraries` | **公共圖書館與分館** | 每週日 04:00 (`0 4 * * 0`) | `update-libraries.yml` | `scripts/update_libraries_closures.mjs` | `frontend/public/vancouver_libraries.geojson` | 讀取 VPL (Vancouver Public Library) 開放圖資，更新館舍地址、設施與營運資訊。 |
| `food_vendors` | **街頭流動美食餐車** | 每週日 04:00 (`0 4 * * 0`) | `update-food-vendors.yml` | `scripts/update_food_vendors.mjs` | `frontend/public/vancouver_street_food_vendors.geojson` | 抓取溫哥華市府 Street Food Vendors 圖資，更新餐車經營許可與營運點位。 |
| `snow_removal_routes` | **冬季除雪路線等級** | 每週一 04:00 (`0 4 * * 1`) | `update-snow-routes.yml` | `backend/scripts/update_snow_routes.py` | `frontend/public/vancouver_snow_removal_routes.geojson` | 擷取市府道路局冬季道路清雪優先級（一級幹線、二級客運道、人行道）。 |
| `garbage_collection` | **垃圾廢物回收排程** | 每週一 03:00 (`0 3 * * 1`) | `weekly-datasets.yml` | `backend/scripts/update_weekly_datasets.py` | `frontend/public/vancouver_garbage_collection.geojson` | 讀取各社區綠色垃圾箱、黑桶廢物與庭院廢棄物清運輪流日程多邊形。 |
| `beach_water_quality` | **海灘水質檢測** | 每週一 03:00 (`0 3 * * 1`) | `weekly-datasets.yml` | `backend/scripts/update_weekly_datasets.py` | `frontend/public/vancouver_beach_water.geojson` | 擷取溫哥華海岸衛生局海灘大腸桿菌採樣數值與游泳安全指標。 |
| `water_distribution_mains` | **自來水主供水管網** | 每 3 個月 (`0 3 1 1,4,7,10 *`) | `update-utilities.yml` | `backend/scripts/update_utilities.py` | `frontend/public/vancouver_water_distribution_mains.geojson` | 溫哥華市府 Open Data (24MB)，下載最新自來水管管徑、材質、年份並幾何簡化。 |
| `sewer_mains` | **污水下水道排水管網** | 每 3 個月 (`0 3 1 1,4,7,10 *`) | `update-utilities.yml` | `backend/scripts/update_utilities.py` | `frontend/public/vancouver_sewer_mains.geojson` | 溫哥華市府 Open Data (15MB)，更新雨水/污水/合流幹管走向與規格。 |
| `street_lighting_conduits` | **路燈地下配電管線** | 每月 1 號 03:00 (`0 3 1 * *`) | `update-datasets.yml` | `backend/scripts/update_open_data.py` | `frontend/public/vancouver_street_lighting_conduits.geojson` | 溫哥華公共工程局 (33MB)，更新地下電氣管線與 wireset 導管路徑。 |
| `street_lighting` | **市政路燈燈桿** | 每月 1 號 03:00 (`0 3 1 * *`) | `update-datasets.yml` | `backend/scripts/update_open_data.py` | `frontend/public/vancouver_street_lighting_poles.geojson` | 溫哥華市區 21.9MB 路燈燈桿座標、燈具種類與色溫資料集。 |
| `parks` | **都會與社區公園** | 每月 1 號 03:00 (`0 3 1 * *`) | `update-datasets.yml` | `backend/scripts/update_open_data.py` | `frontend/public/vancouver_parks.geojson` | 公園局轄區多邊形邊界、綠地面積、運動場與公共休閒腹地。 |
| `community_centres` | **社區活動中心** | 每月 1 號 03:00 (`0 3 1 * *`) | `update-datasets.yml` | `backend/scripts/update_open_data.py` | `frontend/public/vancouver_community_centres.geojson` | 記錄社區活動中心地址、泳池、溜冰場與無障礙服務。 |
| `public_art` | **戶外公共藝術雕塑** | 每月 1 號 03:00 (`0 3 1 * *`) | `update-datasets.yml` | `backend/scripts/update_open_data.py` | `frontend/public/vancouver_public_art.geojson` | 登記戶外壁畫、雕塑作品、創作者生平與文化理念。 |
| `museums` | **博物館與歷史場館** | 每月 1 號 03:00 (`0 3 1 * *`) | `update-datasets.yml` | `backend/scripts/update_open_data.py` | `frontend/public/vancouver_museums.geojson` | 標示溫哥華各文博館門票、營業時間與展覽主題。 |
| `impark` | **ImPark 商業停車場** | 每月 1 號 03:00 (`0 3 1 * *`) | `update-datasets.yml` | `backend/scripts/fetch_impark.py` | `frontend/public/vancouver_impark.geojson` | 抓取商業停車場收費費率、車位總數與營業時間。 |

---

## 三、 前端後台與 GitHub Actions 完整對接方案

### 核心問題
> 「在前端後台改了排程週期，但沒改 GitHub Actions 的 yml，那 GitHub Actions 依舊按照舊的 Cron 執行，改後台排程有何意義？」

為了解決這個脫節問題，實務上有兩種標準對接方法：

### 方法一：GitHub Workflow Dispatch API（立即手動觸發）
* **適用情境**：在後台點擊某資料源的「立即手動同步」按鈕。
* **技術原理**：
  1. 在後端（OCI VM）環境變數設定 `GITHUB_TOKEN`（具備 Actions 權限的 GitHub Personal Access Token）。
  2. 後端 FastAPI 提供端點 `/api/admin/sources/trigger-github-workflow`。
  3. 當管理員點擊「立即同步」，後端發送 HTTP 請求：
     ```bash
     POST https://api.github.com/repos/Ycf206/Vancouver-God-Eyes/actions/workflows/{workflow_file}/dispatches
     Header: Authorization: Bearer {GITHUB_TOKEN}
     Body: { "ref": "main" }
     ```
  4. GitHub Actions 收到請求後立即被喚起並開始執行 Python/Node 更新腳本，完成後自動 push 回儲存庫。

### 方法二：GitHub Contents API 動態提交（修改排程週期）
* **適用情境**：在後台修改了某項目的 Cron 表達式（例如自來水管由每 3 個月改成每個月）並儲存。
* **技術原理**：
  1. 後端讀取儲存在 GitHub 上的對應 `.github/workflows/{workflow}.yml` 檔案。
  2. 將檔案中的 `cron: '...'` 行替換為管理員輸入的新 Cron 表達式。
  3. 透過 GitHub REST API 的 `PUT /repos/:owner/:repo/contents/.github/workflows/{workflow}.yml` 自動建立一個 Commit 推送到 `main` 分支。
  4. 一旦 Commit 進入 GitHub，GitHub Actions 的原生定時排程引擎會立即識別並自動以新的週期排程執行，無須人工手動操作 Git！

---

## 四、 本地測試與 Production 部署標準流程 (SOP)

所有資料管線腳本與前端介面修改必須嚴格遵守以下流程：

1. **本地執行腳本測試**：
   ```bash
   # 測試 Python 數據更新腳本
   python backend/scripts/update_utilities.py
   # 測試 Node.js 數據更新腳本
   node scripts/fetch_shared_micromobility.mjs all
   ```
2. **本地編譯與靜態檢查**：
   ```bash
   cd frontend
   npx tsc --noEmit     # 確保 TypeScript 零語法錯誤
   npm run build        # 確保 Next.js 生產環境 Build 成功 (Exit Code 0)
   ```
3. **推送到 GitHub 自動化部署**：
   ```bash
   git add -A
   git commit -m "feat/fix: 更新說明"
   git push origin main
   ```
4. **OCI 雲端伺服器自動同步**：
   * GitHub Actions 會透過 SSH 觸發 OCI 伺服器執行 `git pull`，完成 Production 無縫熱更新。
