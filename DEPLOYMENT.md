# 部署指南(草稿)

本文件記錄這個專案如何部署到 Vercel,以及 CI/CD 的設定。
**只記錄名稱與步驟,不要寫入任何金鑰、密碼或連線字串。**

## 架構

```
開發者 → GitHub (feature 分支 → PR)
            │
            ├─ GitHub Actions (CI):lint → typecheck → test → build
            │
            └─ Vercel (Git 整合)
                 ├─ PR     → Preview 部署
                 └─ main   → Production 部署
                        │
        外部服務:Neon (PostgreSQL + pgvector)、Clerk (登入)、OpenAI (聊天與嵌入)
```

## 日常開發流程

1. 從 `main` 開新分支:`git switch -c feature/xxx`
2. 修改、commit、`git push`
3. 在 GitHub 開 Pull Request
4. 等 CI(`CI / check`)綠燈,CI 是 merge 的必要條件
5. Merge 到 `main`,Vercel 自動部署到 Production

## 本機指令

| 指令 | 用途 |
|---|---|
| `npm run dev` | 開發伺服器 |
| `npm run lint` | Biome 檢查 |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm test` | Vitest 單元測試 |
| `npm run test:coverage` | 測試覆蓋率報告 |
| `npm run build` | Production build |

## CI(GitHub Actions)

設定檔:`.github/workflows/ci.yml`

- 觸發:對任何分支開 PR,以及 push 到 `main`
- 環境:Ubuntu、Node 24
- 步驟(失敗即停止):`npm ci` → lint → typecheck → test → build
- Build 使用**假的環境變數**(格式正確但無效),CI 不需要任何真實金鑰,
  因此 GitHub Secrets 不需要填寫
- 分支保護:`main` 的 ruleset `protect-main` 要求 `CI / check` 通過才能 merge

### CI 踩過的坑

| 現象 | 原因 | 解法 |
|---|---|---|
| `Cannot find name 'LayoutProps'` | `LayoutProps` 由 Next.js 自動產生在 `.next/types`,乾淨環境沒有 | typecheck 前先執行 `next typegen` |
| `Missing script: "Lint"` | npm script 名稱區分大小寫(Linux) | 一律小寫 |
| workflow 沒有執行時間就失敗 | YAML 欄位拼錯(`run-on`) | 應為 `runs-on` |

## 環境變數

| 變數 | Production | Preview | 值的來源 |
|---|---|---|---|
| `OPENAI_API_KEY` | 專用 key `aisdk-rag-chatbot-vercel` | 同左 | OpenAI Platform → API keys |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk 的 publishable key | 同左 | Clerk Dashboard → API keys |
| `CLERK_SECRET_KEY` | Clerk 的 secret key | 同左 | Clerk Dashboard → API keys |
| `NEON_DATABASE_URL` | **production** 資料庫 | **開發**資料庫 | Neon → Connect |

規則:
- `NEXT_PUBLIC_` 開頭的值會在 build 時寫進前端,修改後必須重新部署。
- `OPENAI_API_KEY`、`CLERK_SECRET_KEY`、`NEON_DATABASE_URL` 在 Vercel 勾選 Sensitive。
- Preview 使用開發資料庫,避免測試資料污染 production。
- GitHub Secrets 與 Vercel 環境變數是兩套獨立的系統。
- `.env.local` 不可提交,`.env.example` 只保留變數名稱。

## Neon(資料庫)

- Production:獨立專案 `aisdk-rag-chatbot-prod`,區域 AWS US East (N. Virginia),
  預設 branch 名為 `production`,Role `neondb_owner`
- 使用 `@neondatabase/serverless` 的 HTTP driver,**不開 Connection pooling**
- `vector` extension 由 `migrations/0000_*.sql` 建立

### 對 Production 執行 migration

不要修改 `.env.local`,改用臨時環境變數(`read -s` 輸入不會留在歷史紀錄):

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

## Clerk(登入與權限)

目前沿用 **Development instance**(`pk_test_` / `sk_test_`)。
之後綁定自訂網域時,再升級為 Production instance。

管理員判斷(`src/middleware.ts` 讀 `sessionClaims.metadata.role`)依賴兩項 Clerk 設定,
**Development 與 Production 是獨立的 instance,升級時必須在新 instance 重做:**

1. Dashboard → Sessions → Customize session token,Claims 加入:
   ```json
   { "metadata": "{{user.public_metadata}}" }
   ```
2. 管理員使用者的 Public metadata 設為:
   ```json
   { "role": "admin" }
   ```

## OpenAI

- 部署專用 key:`aisdk-rag-chatbot-vercel`(與開發用 key 分開,外洩時可單獨撤銷)
- Key 建立後只顯示一次,請自行妥善保存
- Key 有設定有效期限,**到期前要輪替**,否則聊天功能會回 401
- 成本防護:
  - **預付額度制**,餘額用完 API 即停止,這是真正的硬上限
  - **Auto-reload 保持關閉**
  - Project 的 spend limit 只是警示(`Limit not enforced`),會寄信但不會擋請求
  - `/api/chat` 需登入,陌生人無法直接消耗額度

---

## 待完成

- [ ] Vercel:Import repo、設定環境變數、首次部署(階段 6)
- [ ] 驗證 Production 與 Preview
- [ ] 回滾與查看 Logs
- [ ] 綁定自訂網域,並將 Clerk 升級為 Production
- [ ] Playwright E2E 煙霧測試(對 Preview URL)
- [ ] 安全與金鑰輪替流程
- [ ] 日後 `middleware.ts` → `proxy.ts` 遷移
