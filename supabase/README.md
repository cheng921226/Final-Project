# Supabase 資料庫重建

此目錄是資料庫結構的唯一重建來源。`migrations/` 依檔名順序建立 25 張應用程式資料表、函式、trigger、索引、RLS policy、權限及兩個私有 Storage bucket。`seed.sql` 刻意不包含正式資料。

## 建立新的雲端 Supabase 專案

1. 在 Supabase Dashboard 建立空白專案。
2. 在專案根目錄登入並連結新專案：

   ```bash
   npx --yes supabase@2.122.0 login
   npx --yes supabase@2.122.0 link --project-ref <新專案 ID>
   ```

3. 先預覽，再套用 migration：

   ```bash
   npx --yes supabase@2.122.0 db push --dry-run
   npx --yes supabase@2.122.0 db push
   ```

4. 從 Dashboard 的 Project Settings / API 取得新專案的 URL、publishable key（或舊版 anon key）與 service-role secret，複製 `backend/.env.example` 為 `backend/.env` 後填入。

`service-role` secret 只能留在後端，不可放入 React、Git 或傳給瀏覽器。

這套流程重建的是資料庫結構和 bucket 設定，不會複製正式資料、Auth 使用者、Storage 內的檔案、OAuth/SMTP 設定或任何 secret。這些內容需要另外備份或在新專案中設定。

## 本機重建驗證

需要 Docker Desktop 或其他相容的 Docker runtime：

```bash
npx --yes supabase@2.122.0 start
npx --yes supabase@2.122.0 db reset --local
```

`db reset` 成功代表 migration 可以從零重建。完成開發後可執行：

```bash
npx --yes supabase@2.122.0 stop
```

## 原本線上專案的第一次銜接

原本的線上專案已經有 migration 歷史和完整結構，不能直接重跑 baseline。連結原專案後，先確認 `migration list`，再把 baseline 標記為已套用：

```bash
npx --yes supabase@2.122.0 migration list --linked
npx --yes supabase@2.122.0 migration repair --linked --status applied 20261024082924
npx --yes supabase@2.122.0 db push --dry-run
```

預覽結果應只包含尚未套用的 migration，例如 `20261024083300_secure_student_data_rls.sql`。該 migration 會收緊 Data API 權限並啟用 RLS；確認後端測試通過再執行正式 `db push`。不要對正式專案執行 `db reset --linked`，它會刪除資料。

## 日後修改資料庫

不要再把零散 SQL 當作部署順序。建立 migration、填入 SQL、重建測試後一起提交：

```bash
npx --yes supabase@2.122.0 migration new <變更名稱>
npx --yes supabase@2.122.0 db reset --local
```

`backend/sql/` 保留舊腳本與查閱用途；新的資料庫變更以 `supabase/migrations/` 為準。
