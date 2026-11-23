# 部署指南

這份文件記錄 `aisdk-rag-chatbot` 如何部署到 Vercel、CI/CD 如何運作,以及上線後的維運方式。
**只記錄名稱與步驟,不要寫入任何金鑰、密碼或連線字串。**(Repo 是 public)

## 目錄

1. [概覽](#概覽)
2. [日常開發流程](#日常開發流程)
3. [本機指令](#本機指令)
4. [CI(GitHub Actions)](#cigithub-actions)
5. [環境變數](#環境變數)
6. [從零部署的步驟](#從零部署的步驟)
7. [各服務設定](#各服務設定)
8. [自訂網域](#自訂網域)
9. [維運](#維運)
10. [安全](#安全)
11. [踩過的坑](#踩過的坑)
12. [已知待辦](#已知待辦)

---

## 概覽

```
開發者 → GitHub (feature 分支 → PR)
            │
            ├─ GitHub Actions (CI):lint → typecheck → test → build
            │
            └─ Vercel (Git 整合,與 CI 各自獨立、同時觸發)
                 ├─ PR / 非 main 分支 → Preview 部署
                 └─ main              → Production 部署
                        │
        外部服務:Neon (PostgreSQL + pgvector)、Clerk (登入)、OpenAI (聊天與嵌入)
```

- Production 網址:`https://ragchatbot.lantaq.com`(自訂子網域,DNS 在 GoDaddy)
- 技術:Next.js 16(App Router、Cache Components)、Vercel AI SDK、Clerk、Drizzle + Neon、pdf-parse
- **品質閘門在 merge 之前**:`main` 的 ruleset `protect-main` 要求 `CI / check` 通過才能 merge,
  且不能直接 push。Vercel 不會等 CI,但能進 `main` 的程式碼都已通過 CI。

## 日常開發流程

1. 從 `main` 開新分支:`git switch -c feature/xxx`
2. 修改、commit、`git push`(每次 push 都會產生一個 Preview 部署,盡量累積後再 push)
3. 在 GitHub 開 Pull Request
4. 等 `CI / check` 綠燈(必要條件);可在 PR 的 Vercel 檢查點 Details 開 Preview 測試
5. 若有 schema 變更,先對 production 跑 migration(見 [Migration 策略](#migration-策略手動執行))
6. Merge 到 `main` → Vercel 自動部署 Production
7. 開 Production 網站做簡單驗證(登入、聊天)

## 本機指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm run lint` | Biome 檢查 |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm test` | Vitest 單元測試 |
| `npm run test:coverage` | 測試覆蓋率報告 |
| `npm run build` | Production build |

測試策略:外部服務(OpenAI、Neon、Clerk、pdf-parse)全部 mock,CI 不連任何真實服務。
後端邏輯(`middleware.ts`、`api/chat`、`upload/actions`、`lib/*`)覆蓋率 100%;前端頁面尚無測試。

## CI(GitHub Actions)

設定檔:`.github/workflows/ci.yml`

- 觸發:對任何分支開 PR,以及 push 到 `main`
- 環境:Ubuntu、Node 24(Vitest 5 需要 Node >= 22.12)
- 步驟(失敗即停止):`npm ci` → lint → typecheck → test → build
- Build 使用**假的環境變數**(格式正確但無效),CI 不需要真實金鑰,GitHub Secrets 不需要填寫。
  Clerk 的 publishable key 會檢查格式(`pk_test_` + base64 的網域),不能亂填
- 分支保護:ruleset `protect-main` 要求 `CI / check` 通過才能 merge

## 環境變數

| 變數 | Production | Preview | 值的來源 |
|---|---|---|---|
| `OPENAI_API_KEY` | 專用 key(`aisdk-rag-chatbot-vercel-*`) | 同左 | OpenAI Platform → API keys |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...`(Production instance) | `pk_test_...`(Development instance) | Clerk Dashboard → API keys |
| `CLERK_SECRET_KEY` | `sk_live_...` | `sk_test_...` | Clerk Dashboard → API keys |
| `NEON_DATABASE_URL` | **production** 資料庫 | **開發**資料庫 | Neon → Connect |

規則:
- 同一個 Key 在 Vercel 可建立多筆,各自指定環境(Production / Preview)。
- `NEXT_PUBLIC_` 開頭的值會在 build 時寫進前端,修改後**必須重新部署**才生效。
  它是公開金鑰,設成一般(Config)即可;其餘三個設為 **Secret(Sensitive)**。
- **Sensitive 變數建立後無法查看或編輯**:要更新就 Remove 後重新 Add,並注意環境範圍。
- Preview 使用 Clerk Development 與開發資料庫,避免測試資料污染 production;
  Production 的 Clerk 只認自訂網域,Preview 的 `*.vercel.app` 無法使用 live 金鑰。
- GitHub Secrets 與 Vercel 環境變數是兩套獨立的系統。
- `.env.local` 不可提交,`.env.example` 只保留變數名稱。

## 從零部署的步驟

如果要重建整個環境,依序做:

1. **Neon**:建立獨立專案(區域選 AWS US East),取得連線字串(不開 Connection pooling)
2. **Migration**:用[臨時環境變數流程](#對-production-執行-migration)對 production 執行
3. **OpenAI**:建立專用 key(設有效期限),帳戶用預付額度並關閉 Auto-reload
4. **Clerk**:建立應用,設定 session token 與管理員(見 [Clerk](#clerk登入與權限))
5. **GitHub**:`main` 的 ruleset(要求 PR 與 `CI / check`);啟用 Secret Protection
6. **Vercel**:Import GitHub repo,**不要加 Marketplace 整合**(Clerk、Neon 已手動設定);
   在按 Deploy 之前填好環境變數
7. 驗證 Production:登入、聊天、上傳 PDF、RAG 搜尋、管理員權限
8. (選配)綁自訂網域並升級 Clerk 為 Production(見[自訂網域](#自訂網域))

## 各服務設定

### Neon(資料庫)

- Production:獨立專案 `aisdk-rag-chatbot-prod`,區域 AWS US East (N. Virginia),
  預設 branch 名為 `production`,Role `neondb_owner`
- 使用 `@neondatabase/serverless` 的 HTTP driver,**不開 Connection pooling**
- `vector` extension 由 `migrations/0000_*.sql` 建立

#### 對 Production 執行 migration

不要修改 `.env.local`,改用臨時環境變數(`read -s` 輸入不會顯示、不留在歷史紀錄):

```bash
read -rs NEON_DATABASE_URL; export NEON_DATABASE_URL   # 貼上 production 連線字串後按 Enter
echo "${NEON_DATABASE_URL#*@}"                         # 確認主機名是 production
npx drizzle-kit migrate
unset NEON_DATABASE_URL                                # 一定要清掉
```

驗證(Neon SQL Editor):

```sql
SELECT extname FROM pg_extension;   -- 應包含 vector
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';  -- 應包含 documents
```

#### Migration 策略:手動執行

不放進 CI 或 Vercel build。原因:schema 很少變動;自動化會把 production 連線字串放進
GitHub 或 build 流程,擴大機密暴露面;PR 的 CI 若連到 production 很危險。

變更 schema 的安全順序:

1. 修改 `src/lib/db-schema.ts`
2. `npx drizzle-kit generate`:在 `migrations/` 產生新的 SQL 檔,**不會動資料庫**。
   檢查 SQL(特別注意 `DROP`、改欄位型別)
3. `npx drizzle-kit migrate`:把 SQL 套用到**開發資料庫**,然後 `npm run dev` 在本機測試
4. 開 PR,內容包含 `db-schema.ts`、`migrations/` 的新 SQL 與 `meta/` 更新、相關程式碼與測試;
   等 CI 綠燈
5. **Merge 之前**,用上面的臨時環境變數流程對 production 執行 migrate,完成後 `unset`
6. Merge 到 `main`,Vercel 自動部署新程式碼

為什麼第 5 步在第 6 步之前:merge 會立刻部署新程式碼,若資料庫還沒有新欄位會報錯;
而舊程式碼遇到「多了欄位」的資料庫通常沒問題。此順序只適用於新增欄位或資料表(向下相容);
刪除或改名需拆成多次發布。

### Clerk(登入與權限)

- **Production instance**(網域 `ragchatbot.lantaq.com`,選 **Secondary application**:
  Clerk 的紀錄收在子網域底下,不佔用根網域)。Preview 使用 Development instance
- 管理員判斷(`src/middleware.ts` 讀 `sessionClaims.metadata.role`)依賴兩項設定,
  **Development 與 Production 是獨立的 instance,各自都要設定:**
  1. Dashboard → Sessions → Customize session token,Claims 為:
     ```json
     { "metadata": "{{user.public_metadata}}" }
     ```
  2. 管理員使用者的 Public metadata 設為:
     ```json
     { "role": "admin" }
     ```
     設定後需登出再登入,新的 session token 才會帶有 role
- Production 使用者不會從 Development 帶過來,要重新建立(Invite 或註冊)
- **Access mode 為 Invite-only**:新增使用者 → Dashboard(Production)→ Users → Invite user
- Google 登入在 Production 已關閉(需要自行申請 Google OAuth 憑證才能啟用)

### OpenAI

- 部署專用 key(與開發用 key 分開,外洩時可單獨撤銷),有設定有效期限,
  **到期前要輪替**,否則聊天功能會回 401(建議在行事曆設提醒)
- Key 建立後只顯示一次,請自行妥善保存
- 成本防護:
  - **預付額度制**,餘額用完 API 即停止,這是真正的硬上限
  - **Auto-reload 保持關閉**
  - Project 的 spend limit 只是警示(`Limit not enforced`),會寄信但不會擋請求
  - `/api/chat` 需登入,且 Clerk 為 Invite-only,陌生人無法消耗額度

## 自訂網域

目前:`ragchatbot.lantaq.com`(GoDaddy 管理 DNS,沒有轉移到 Cloudflare,不需要)。

1. Vercel → Settings → Domains → Add Domain,輸入完整子網域,環境選 Production
2. 在 GoDaddy 新增 `CNAME`:**名稱只填子網域那一段**(`ragchatbot`,不要重複整個網域),
   內容值照 Vercel 顯示的整串貼上
3. 等 Vercel 顯示 Valid Configuration,HTTPS 憑證自動簽發
4. Clerk(Production)→ 輸入完整網域,Clerk 會列出數筆 CNAME
   (`clerk`、`accounts`、`clkmail`、`clk._domainkey`、`clk2._domainkey` 等);
   GoDaddy 的名稱欄要**去掉最後的主網域**(例如 `clerk.ragchatbot`)
5. 在 Clerk 按 Verify,等 SSL Certificates 都變成 Issued **之後**,才把 Vercel 的
   Clerk 金鑰換成 live 並重新部署
6. 換成 live 金鑰後,舊的 `*.vercel.app` Production 網址會因網域不符而無法登入,統一使用自訂網域

## 維運

### 回滾(Instant Rollback)

Vercel 專案 → Deployments → 選之前的 Production 部署 → ⋯ → Instant Rollback。
不重新 build,幾秒完成。

- 回滾後會**暫停自動部署**,修好問題後,要對最新的部署按 **Promote to Production** 才會恢復。
- Rollback 是「逃生」(退回舊的 Production 版本),Promote 是「上線」(把任一部署指向 Production)。
  Hobby 方案通常只能退回上一個版本。
- 只回復程式碼,**不回復資料庫**。所以 schema 變更必須向下相容。
- 不要 Promote Preview 部署上線:它是用 Preview 環境變數 build 的(連開發資料庫與測試金鑰)。

### 查看 Logs

- Build 失敗:Deployments → 該筆部署 → Build Logs
- 執行時錯誤:專案 → Logs(Runtime Logs),可用 Level、時間、路徑(如 `/upload`)篩選,
  也可搜尋瀏覽器看到的錯誤 digest
- Production 錯誤畫面只顯示 digest,細節只在 Runtime Logs
- Hobby 方案的日誌保留時間很短,**出錯要盡快查看**

### 函式逾時

- 目前 Function Max Duration 為 300 秒(Vercel → Settings → Functions),未自訂 `maxDuration`
- 容易逾時的是 `/upload`(解析 PDF → 切塊 → embedding → 寫入)與 `/api/chat`(串流)
- 若大型 PDF 上傳逾時,Server Action 的 `maxDuration` 要匯出在使用它的頁面
  (`src/app/upload/page.tsx`)。實際上限依方案,以 Vercel 設定頁為準

### Preview 部署的成本

每次 push 非 `main` 分支會產生一個 Preview(消耗 build 次數,Hobby 有每日上限)。
累積改動後再 push 可減少;Preview 預設需 Vercel 登入才能查看。

## 安全

### 已啟用的防護

- Clerk Production 的 **Access mode 為 Invite-only**,避免陌生人註冊後消耗 OpenAI 額度
- OpenAI:預付額度、Auto-reload 關閉、專用 key 並設有效期限
- GitHub:Secret Protection(含 Push protection)、Dependency graph、Dependabot alerts
- Vercel:`OPENAI_API_KEY`、`CLERK_SECRET_KEY`、`NEON_DATABASE_URL` 為 Sensitive;
  Preview 部署預設需 Vercel 登入才能查看
- Clerk Protect:偵測可疑註冊、Device Trust、登入失敗鎖定等皆為 Active
- Repo 為 public,**絕不可 commit 任何金鑰**;`.env*` 已被 `.gitignore` 排除

### 金鑰外洩處理(輪替)

原則:**先讓外洩的金鑰失效,再換新的,最後更新 Vercel 並重新部署。**

| 服務 | 值 | 撤銷 / 重新產生 | 之後 |
|---|---|---|---|
| OpenAI | `OPENAI_API_KEY` | Platform → API keys:刪除舊 key,建立新 key | 更新 Vercel → Redeploy |
| Clerk | `CLERK_SECRET_KEY`(`sk_live_`) | Dashboard → API keys:重新產生 secret key | 更新 Vercel Production → Redeploy |
| Clerk | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | 公開金鑰,外洩無需處理 | 無 |
| Neon | `NEON_DATABASE_URL` | Neon Console → Role → Reset password(舊連線字串立即失效) | 先備妥新字串,更新 Vercel → Redeploy |

注意:
- 曾進入 Git 歷史的金鑰,刪檔案無效,**一定要輪替**。
- Neon 重設密碼到 Vercel 重新部署完成之間,網站會暫時連不上資料庫,動作要快。
- **定期輪替(沒有外洩)時順序相反,以避免中斷**:先建新的、更新 Vercel 並確認正常,
  最後才刪舊的。OpenAI 已實際練習過一次。
- 更新 Vercel 時,環境別不要弄反(Production 用 live / production DB,Preview 用 test / 開發 DB)。

## 踩過的坑

### CI

| 現象 | 原因 | 解法 |
|---|---|---|
| `Cannot find name 'LayoutProps'` | `LayoutProps` 由 Next.js 自動產生在 `.next/types`,乾淨環境沒有 | typecheck 前先執行 `next typegen` |
| `Missing script: "Lint"` | npm script 名稱區分大小寫(Linux) | 一律小寫 |
| workflow 沒有執行時間就失敗 | YAML 欄位拼錯(`run-on`) | 應為 `runs-on` |

### Vercel

| 現象 | 原因 | 解法 |
|---|---|---|
| 上傳 PDF 回傳 `{"digest":"..."}`;Runtime Logs 出現 `Failed to load external module pdf-parse: ReferenceError: DOMMatrix is not defined`,以及 `Cannot load "@napi-rs/canvas" package` | `pdf-parse` 靠原生套件 `@napi-rs/canvas` 提供 `DOMMatrix` 等物件;本機 Windows 有對應二進位檔,Vercel 的 Linux 載不到,模組一載入就失敗 | 依 pdf-parse 官方文件,從 `pdf-parse/worker` 匯入 `CanvasFactory` 並傳給 `new PDFParse({ data, CanvasFactory })`(`src/app/upload/actions.ts`)。**只在 `serverExternalPackages` 加 `@napi-rs/canvas` 無效**,已還原 |
| 改了 Sensitive 變數,Edit 頁的 Value 是灰色的 | Sensitive 值只能寫入、不能查看或修改 | Remove 後重新 Add |
| 切換 Clerk 金鑰後舊帳號登入顯示找不到 user | Production instance 與 Development 的使用者彼此獨立 | 在 Production 重新邀請或註冊,並重設管理員 metadata |

除錯習慣:Production 只回傳 digest(隱藏細節),真正的錯誤要看 Vercel → Logs → Runtime Logs。

## 已知待辦

- [ ] Playwright E2E 煙霧測試(對 Preview URL 執行)
- [ ] `middleware.ts` → `proxy.ts` 遷移(Next.js 已棄用 `middleware`,目前只有警告)
- [ ] 中文等不含空白的文字,`chunkContent` 無法切分(產品決策待定)
- [ ] 首頁仍是 create-next-app 預設範本
- [ ] Biome 尚有 4 個 warning(未使用的變數、非空斷言)
- [ ] 評估是否為 `src/lib` 與 `src/app/api` 設定覆蓋率門檻
