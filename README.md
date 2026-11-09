# task-manage-app-example

Example độc lập Express 5, TypeScript ESM, Node.js 24 và npm. App nhận profile qua webhook có chữ ký và gửi notification tới API Expose của Rita ID. Không có database, OAuth login, UI, pipeline 3 hoặc nghiệp vụ Task thật.

Đọc [kiến trúc](ARCHITECTURE.md) và [hướng dẫn bảo trì](AGENTS.md). Backend là đối tác HTTP, không phải dependency source hoặc shared package. Contract được đối chiếu với backend trong workspace ngày 2026-11-09.

## Cài đặt và chạy

Chạy trong repository này:

```powershell
npm ci
if (-not (Test-Path -LiteralPath .env)) { Copy-Item -LiteralPath .env.example -Destination .env }
npm run dev
```

Giữ nguyên cấu hình cá nhân đang có. Health mặc định tại http://localhost:4102/health, Swagger UI tại http://localhost:4102/docs/ và spec tại http://localhost:4102/openapi.json. App không tự gọi backend khi createApp hoặc startup. Thiếu credential vẫn cho startup; endpoint liên quan trả sanitized503.

## Cấu hình

Chỉ loadConfig đọc environment/dotenv; biến process đã có được ưu tiên. Không sửa .env để chạy tests.

| Biến                        | Mặc định / yêu cầu                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| NODE_ENV                    | development; development/test/production                                                            |
| PORT                        | 4102; số nguyên1–65535                                                                              |
| LOG_LEVEL                   | info; mức Pino hợp lệ                                                                               |
| RITA_API_BASE_URL           | Tùy chọn, ví dụ https://id.example.test/api/; URL cố định phía server, không credentials/query/hash |
| RITA_INTEGRATION_API_KEY    | Tùy chọn; rik_UUIDv4.64-hex-secret do Rita ID cấp; gửi chỉ bằng X-API-Key                           |
| RITA_WEBHOOK_SIGNING_SECRET | Tùy chọn; whsec_ + base64 canonical32 byte; chỉ xác minh webhook                                    |
| DEMO_API_TOKEN              | Tùy chọn;32–256 ký tự A–Z/a–z/0–9/_/-; Bearer token riêng cho API demo                              |

Giá trị đã khai báo phải hợp lệ, kể cả chuỗi rỗng. Backend URL chỉ cho HTTPS; HTTP chỉ cho localhost/127.0.0.1/[::1] trong development/test. Base path được giữ: https://id.example.test/api/ trở thành https://id.example.test/api/api-expose/notifications.

Ba credential có trách nhiệm khác nhau và phải riêng theo từng app/môi trường. Không đưa API key Rita ID vào Swagger Authorize hoặc browser. Có thể tạo token demo bằng Node crypto rồi tự lưu an toàn; không commit giá trị thật. Các setting transport cũ không còn được đọc.

## Routes

| Method | Route                                           | Quyền / kết quả                               |
| ------ | ----------------------------------------------- | --------------------------------------------- |
| GET    | `/health`                                       | Liveness; không xác nhận integration sẵn sàng |
| GET    | `/docs`                                         | Swagger, public; có thể redirect tới /docs/   |
| GET    | `/openapi.json`                                 | OpenAPI3.1, public                            |
| GET    | `/api/v1/employee-profiles`                     | Bearer demo; list RAM phân trang              |
| GET    | `/api/v1/employee-profiles/:userId`             | Bearer demo; detail RAM                       |
| POST   | `/api/v1/webhooks/rita-id/employee-profile`     | Chữ ký webhook; áp dụng vào RAM               |
| POST   | `/api/v1/examples/notifications/task-assigned`  | Bearer token demo; gọi Rita ID                |
| POST   | `/api/v1/examples/notifications/task-commented` | Bearer token demo; gọi Rita ID                |

## Xem profile trong RAM

GET /api/v1/employee-profiles?page=1&pageSize=10 dùng Bearer DEMO_API_TOKEN và trả {items:[{revision,employee}],total,page,pageSize}. Page mặc định1, là số nguyên dương an toàn; pageSize chỉ10/20/50, mặc định10. Query lạ/trùng/array/object, số sai hoặc offset không an toàn trả400. Sort UUID lowercase tăng dần; total là số profiles, gồm active=false. Store rỗng/page vượt dữ liệu trả items rỗng.

GET /api/v1/employee-profiles/:userId trả {revision,employee}; UUID không phân biệt casing. UUID sai400, chưa có404 PROFILE_NOT_FOUND. Cả hai trả Cache-Control: no-store, toàn bộ employee projection và revision chuỗi; không trả hash/receipt/credential. Token thiếu/sai401, chưa cấu hình503; auth chạy trước validation. Token có quyền đọc toàn bộ store của app.

Đọc cùng store webhook, không gọi Rita ID hoặc gửi notification. Danh sách chỉ gồm profiles đã áp dụng từ khi process chạy; restart mất state. GET không bootstrap/backfill hoặc xác nhận đồng bộ đầy đủ. Có thể dùng Swagger Authorize với token demo rồi gọi hai GET.

## Nhận profile

Receiver đọc raw body tối đa256 KiB trước JSON parser chung. Cần webhook-id, webhook-timestamp và webhook-signature; header thiếu/trùng/sai hoặc chữ ký sai trả401 trước parse JSON. Timestamp Unix seconds phải nằm trong5 phút của server; đồng bộ clock. Không dùng occurredAt để đánh giá chữ ký vì event cũ có thể được retry.

Chữ ký là v1,<base64 HMAC-SHA256> trên id.timestamp.rawBody, dùng bytes base64 sau whsec_. webhook-id phải khớp messageId. Event phải có type outbound.sync.profile, schemaVersion1, source rita-id, revision bigint string và đúng một employee. Xem [payload hư cấu](examples/profile-event.json); không dùng contract batch/profile-read API cũ.

200 trả {messageId,status:applied|duplicate|stale}. Duplicate cùng ID/body không áp dụng lại; cùng ID khác body409. Revision thấp hơn bị bỏ qua, bằng nhau khác nội dung409, cao hơn cập nhật profile. Dùng BigInt, không Number. Invalid JSON/schema400, body quá lớn413; chưa cấu hình hoặc hết capacity503.

Mỗi app instance có tối đa1.000 profiles/10.000 receipts trong RAM; không eviction. Kiểm tra trước thay đổi state. Duplicate đã biết vẫn được nhận khi đầy. Restart làm mất toàn bộ profile/revision/dedup; có thể nhận lại event cũ như mới. HTTP200 không bảo đảm lưu bền và không phù hợp dùng làm production receiver. Restart để dọn demo phải đi kèm hiểu biết về mất state, không phải recovery production. Hai GET đọc RAM yêu cầu Bearer token demo; không công khai profile.

## Gửi notification

Các API demo yêu cầu Authorization: Bearer <DEMO_API_TOKEN> trước JSON validation. Thiếu/sai token401, chưa cấu hình token503. Route quyết định scenario task.<route>; summary thiếu dùng template. Request mẫu:

```json
{
  "messageId": "b0000000-0000-4000-8000-000000000001",
  "occurredAt": "2026-11-09T03:00:00Z",
  "correlationId": "task-demo-task-assigned",
  "data": {
    "actor": "11111111-1111-4111-8111-111111111111",
    "recipientUserIds": [
      "22222222-2222-4222-8222-222222222222"
    ],
    "title": "Công việc mới (minh họa)",
    "summary": "Công việc mới: dữ liệu hư cấu để thử tích hợp.",
    "type": "UPDATED",
    "priority": "MEDIUM",
    "custom_badge": {
      "label": "Công việc mới",
      "status": "DEFAULT"
    }
  }
}
```


Swagger cung cấp ba mẫu cho mỗi endpoint: **Đầy đủ theo nghiệp vụ** (mặc định trong bộ chọn), **Dùng giá trị mặc định**, **Có ngữ cảnh hội thoại**. Mẫu đầy đủ ở trên dành cho task-assigned; giá trị type/priority/badge chỉ minh họa, không thay đổi default của route. Mẫu tối thiểu bỏ summary/type/priority/correlationId, actor và custom_badge là null: route thêm summary, Rita ID chuẩn hóa type=SYSTEM và priority=MEDIUM. MESSAGE cần cả group/message, scenario vẫn thuộc route.

Type phân loại notification; priority biểu thị mức ưu tiên trình bày, không cam kết thứ tự giao nhận. Badge là nhãn nghiệp vụ: custom_badge.label lưu vào cột custom_badge, custom_badge.status lưu vào custom_badge_status; null không hiển thị badge. Enum so khớp chính xác, không trim/uppercase. Thiếu/null/chuỗi không hỗ trợ của type/priority thành SYSTEM/MEDIUM; badge.status null/chuỗi không hỗ trợ thành DEFAULT (field status vẫn bắt buộc khi badge là object).

Thay actor/recipient bằng UUID Rita ID hợp lệ. Sự kiện mới cần messageId mới; retry cùng sự kiện giữ identity/nội dung/integration. Chuyển mẫu với messageId đã accepted có thể gây409. Swagger Authorize dùng DEMO_API_TOKEN, không phải Rita API key; simulation:true vẫn có thể tạo notification thật, không phải dry-run.

Xem [file request hư cấu](examples/notification.json). Caller bắt buộc cấp messageId/occurredAt ổn định; tạo UUID mới cho sự kiện mới, giữ nguyên mọi nội dung khi retry cùng sự kiện. Giới hạn1–100 recipient UUID không trùng; giữ actor UUID/null, title, summary, badge và enum normalization tương ứng backend. MESSAGE bắt buộc group/message; loại khác cấm context. birthdayOccurrence bị cấm. Không gửi project_id, source, scenario, envelope type/schemaVersion; Project được Rita ID suy ra từ API key riêng của app.

App gửi đúng wrapper qua POST /api-expose/notifications với X-API-Key phía server. Timeout10 giây, không redirect/retry tự động, không queue hoặc buffer retry. Chỉ backend200 với đúng messageId và status accepted mới trả200 {messageId,status:accepted,simulation:true}. Accepted là transaction Rita ID đã commit, có thể bị preferences ngăn tạo inbox; không phải người nhận đã đọc hay hoàn tất nghiệp vụ.

Backend400/409/413/503 được ánh xạ bằng mã lỗi kiểm soát. Upstream401 thành502 RITA_CREDENTIAL_REJECTED để phân biệt Bearer token demo sai. Timeout504; network, redirect hoặc success response sai thành502 RITA_OUTCOME_UNKNOWN. Khi chưa chắc chắn, retry thủ công cùng identity/nội dung. Không có outbox bền vững ở example; caller chịu trách nhiệm lưu request cần retry. Không tự gửi lại hoặc đổi key/integration để né collision vì dedup ở Rita ID có namespace theo integration.

## Setup hai chiều với Rita ID

1. Provision backend schema tương thích, cấu hình backend WEBHOOK_ENABLED và chạy đúng một backend process theo runbook backend. Không chạy provisioning từ example.
2. Tạo Project và API integration riêng cho app, lưu key một lần rồi enable. Đặt API URL/key phía server example.
3. Tạo webhook thuộc Project tương ứng, URL HTTPS public trỏ đúng route receiver, subscription outbound.sync.profile; lưu signing secret vào example trước khi active webhook.
4. Localhost/private IP không được backend webhook transport chấp nhận. Dùng reverse proxy/tunnel HTTPS có TLS hợp lệ, DNS public và forward nguyên bytes/body/headers; không nới SSRF/TLS policy backend. Tránh proxy parse/re-serialize body hoặc biến đổi encoding.
5. Bảo vệ Bearer token demo kể cả khi tunnel public toàn bộ app. Không công khai môi trường demo cho người không được phép; Swagger không cung cấp API key/signing secret. Xoay key/secret/token bằng quy trình riêng, khởi động lại example để nạp cấu hình.
6. WEBHOOK_ENABLED mặc định false ở backend; bật có chủ ý. Enable webhook không tự bootstrap/backfill profile lịch sử. Backfill/đối soát thuộc công cụ backend, không tự replay từ example.

## Log payload webhook profile

Mỗi webhook đã xác thực chữ ký, validate schema và khớp messageId header/body ghi một structured log info: event=profile_webhook_received, messageId, revision, payload và thông điệp Profile webhook received. Payload là toàn bộ envelope JSON đã validate, gồm đầy đủ employee profile; không che hoặc cắt trường. Đây không phải raw bytes HTTP và không bao gồm request headers, signature hoặc credential cấu hình.

Log này nằm trước store.apply(), nên vẫn xuất hiện nếu bước xử lý RAM sau đó trả conflict409 hoặc capacity503. Request sai chữ ký/timestamp, malformed JSON, sai schema, messageId không khớp hoặc body quá lớn không có payload log. Log Profile webhook processed in RAM và access log hiện có được giữ riêng để phân biệt đã nhận payload hợp lệ với kết quả xử lý.

Không có flag payload riêng. LOG_LEVEL=info/debug/trace hiển thị log; warn/error/fatal/silent lọc log info. Log chứa dữ liệu cá nhân trong profile, không chứng minh cập nhật thành công hoặc lưu bền; RAM vẫn mất state sau restart. Notification payload và các credential không được bổ sung vào log.

## Lifecycle và kiểm chứng

Shutdown idempotent: ngừng nhận HTTP, drain client work. Deadline HTTP10 giây đóng socket và đặt exit code lỗi, nhưng vẫn chờ client thực sự kết thúc. Timeout/disconnect không chứng minh request chưa được backend xử lý. Ngoài log payload profile hợp lệ được mô tả bên dưới, chỉ ghi metadata kiểm soát; không log notification body, credentials, headers, raw upstream response hoặc exception.

```sh
npm run typecheck
npm run lint
npm run format:check
npm run build
npm test -- --maxWorkers=1 --no-file-parallelism
npm run docs:check
```

Tests dùng fixtures hư cấu, Supertest và HTTP client inject; không dotenv, personal JSON hoặc dịch vụ dùng chung. Golden signature có expected value tạo bởi signer backend với key hư cấu; tests không import runtime từ sibling. Không tuyên bố mocks chứng minh HTTPS public/TLS, DB, restart durability hoặc delivery thật.

## Current verification status

### Swagger notification examples — 2026-11-09

Verified against `e91f4f1` plus this documentation/example/test working tree. Every notification endpoint now offers full/minimal/message examples, full selected first. Full payloads explicitly show type/priority/badge; these are illustrative choices, not runtime defaults. The existing generated schema, auth, fallback, templates and error contracts are retained.

- PASS: 60 tests across the focused documentation and notification HTTP suites; 0 failed/skipped. All published payloads validate and pass through the real HTTP router with an injected client double, preserving caller fields and adding only route scenario/summary as appropriate. Initial sandbox Vitest attempts failed with spawn EPERM; permitted subprocess runs passed.
- PASS: typecheck, read-only ESLint, TypeScript build compilation and targeted Prettier checks for changed TypeScript/JSON. README format check still reports differences; the committed HEAD README also fails that check. Unrelated Markdown formatting is preserved.
- PASS: local Chromium Swagger UI for every notification endpoint in this repo, within a five-endpoint Sale/Task check. All three options are available, full is selected initially, and every option matches the request editor payload. POST and external network access were blocked; no Execute request was sent. No application .env or real credentials were used.
- PASS: docs checker covers 3 Markdown files, 28 links, 8 routes and 3 JSON examples. Mock HTTP/browser evidence does not prove live Rita persistence, delivery or database guarantees. No backend/portal/runtime policy change or migration is included.


### Profile RAM read API — 2026-11-09

Revision 390c5a9 cộng working tree: thêm list/detail dùng cùng store webhook, strict pagination, Bearer auth, no-store và Swagger/docs. Giữ các thay đổi payload log đang có; không sửa .env, dependencies hoặc source backend/portal/mobile.

- PASS: focused read/webhook/app/Swagger Vitest **85 tests /4 files**; final full Vitest **172 tests /8 files,0 failed,0 skipped**. Kiểm tra auth trước validation, query/UUID400, missing404, sort/pagination, full nullable/inactive profile, bigint string, isolation/copy và webhook duplicate/stale/conflict/new revision. GET không gọi notification client, không lộ internals/credentials và access logs chỉ dùng nhãn cố định.
- PASS: typecheck, ESLint read-only, format:check và build; Swagger examples hư cấu hợp lệ với schema dùng chung. docs:check:3 Markdown files,28 links,8 routes,3 JSON examples. Diff whitespace đã kiểm tra; phần kết quả này nhận lượt docs/format/diff follow-up riêng.
- Giới hạn: HTTP tests qua Express/Supertest, RAM fixtures và client doubles; không gọi backend/HTTPS/DB hoặc browser thật. Không chứng minh lưu bền hoặc đồng bộ đầy đủ; restart mất state. Các snapshot dưới là bằng chứng lịch sử, không phải kết quả chạy lại.

### Full validated profile payload logging — 2026-11-09

Source 390c5a9 cộng working tree của thay đổi log payload. Receiver luôn gọi logger.info với event profile_webhook_received, messageId, revision và toàn bộ envelope/profile đã xác thực, validate và khớp header/body ID, trước store.apply. Không có flag mới; LOG_LEVEL vẫn lọc info. Giữ log processed/access và toàn bộ HTTP/business behavior.

- PASS: focused webhook/app Vitest **46 tests /2 files,0 failed,0 skipped** ở mỗi example. Kiểm tra payload đầy đủ đúng một record cho applied/duplicate/stale và store409/503; received log có trước store. Các request sai signature/timestamp/header/JSON/schema/ID, quá lớn hoặc chưa cấu hình receiver không có payload log. Pino info hiển thị payload và warn lọc payload; headers, signing secret, API key và Bearer token hư cấu không lộ trong logs.
- PASS: typecheck, read-only ESLint, format:check và docs:check;3 Markdown files,26 links,6 routes,3 JSON examples. Lỗi vị trí tham số store trong fixture test mới đã được sửa trước lượt kiểm chứng cuối.
- README/ARCHITECTURE/AGENTS cập nhật ngoại lệ logging chỉ cho profile webhook hợp lệ. Payload log có dữ liệu cá nhân trong profile, không phải raw request bytes và không chứng minh xử lý thành công/lưu bền.
- Không đổi .env, dependencies, global logger, notification client, backend/portal/mobile hoặc API response. Tests dùng fixtures hư cấu, Supertest và stream/spies; không gọi backend/HTTPS thật. Không chạy build/full suite vì thay đổi giới hạn ở logging receiver. Final results prose được kiểm checker/format và diff riêng.

### HTTP migration — 2026-11-09

Source tại 6f82f99 cộng working tree hoàn thiện migration HTTP, tài liệu và formatting ngày2026-11-09.

- PASS: typecheck, read-only ESLint, format:check và build. Các phát hiện formatting/import test trong vòng triển khai đã được sửa; gate cuối không còn lỗi.
- PASS: full Vitest **122 tests /7 files,0 failed,0 skipped**, chạy với maxWorkers=1 và no-file-parallelism để giới hạn tài nguyên; không thay runner config hoặc hạ assertions. Bao phủ webhook raw-body signature/timestamp/header duplicates, exact256 KiB, revision bigint/dedup/conflicts/capacity/concurrency, notification scenarios/validation/authentication, HTTP serialization/outcome/timeout/no retry, shutdown và Swagger/JSON examples.
- PASS: docs:check kiểm3 Markdown files,26 links,6 routes và3 JSON examples. Final verification prose nhận một lượt checker/format follow-up riêng. Diff whitespace được kiểm tra trước khi kết thúc.
- Tests dùng Supertest, fixtures hư cấu và injected fetch; golden signature đối chiếu signer backend với key hư cấu, không import source sibling khi chạy tests. Không startup app với backend/public HTTPS/DB thật, không chứng minh public DNS/TLS, persistence/restart durability hoặc OS-level production shutdown.
- Không sửa .env cá nhân, backend, portal hoặc mobile. Không thêm database, OAuth, pipeline3, dependencies/runtime package chung hoặc automatic retries. RAM được reset khi process restart; profile/dedup/revision không bền vững. Trước khi dùng production cần receiver storage bền vững và kiểm chứng isolated HTTPS/backend riêng.

## Lịch sử kiểm chứng

Các snapshot hỗn hợp sau giữ số liệu gốc. Transport/contracts trong đó đã retired, không phải hướng dẫn hiện hành hay bằng chứng kiểm chứng lại. Các ghi chú/config/Compose/tests chỉ dành cho transport cũ đã được gỡ.

### 31/10/2026 — notification v3 working tree

Typecheck, lint read-only, build và format check: **pass**. Vitest: **151 passed, 5 broker tests skipped** vì thiếu RABBITMQ_TEST_URL. Tests dùng HTTP/publisher doubles, bao gồm MESSAGE conditional context và năm Swagger examples mỗi route. Chưa xác minh broker/DB/TLS/ACL thật; không chạy browser smoke trong đợt này. Các kết quả trước giữ bên dưới.

Ngày 30/10/2026; revision `9e5e04a` cùng working tree. Scope chỉ README/ARCHITECTURE/AGENTS.
PASS: 46 liên kết tương đối/anchors; JSON examples được kiểm tra với validator thuần hiện có (4 examples); command/test references được đối chiếu source. PASS: Prettier read-only trên ba file và git diff --check.

Chỉ kiểm tra tài liệu và import validator thuần; không chạy build, full Vitest, HTTP server, browser, broker hoặc database. Không suy ra delivery/persistence từ các kiểm tra này. Lịch sử tests phía dưới không phải kết quả chạy lại trong đợt này.

### Kết quả kiểm chứng — 2026-10-28

Kiểm chứng trên working tree khởi tạo template, Windows, Node 24.21.0 / npm 11.19.0:

- Cài dependencies và tạo lockfile riêng thành công.
- Typecheck, ESLint, Prettier check và build thành công.
- Vitest: 2 files, 16 tests passed, 0 failed, 0 skipped.
- Hai bản build chạy đồng thời tại cổng 4101/4102 và trả health đúng tên.
- Ctrl+C kích hoạt SIGINT handler và dừng ứng dụng. PowerShell PTY báo mã 1
  khi bị ngắt; harness riêng kích hoạt SIGTERM handler qua IPC xác nhận Node thoát mã 0.
- Chưa kiểm chứng SIGTERM từ hệ điều hành POSIX hoặc shutdown với request đang chạy
  đến deadline 10 giây. Không có kiểm chứng database, RabbitMQ hay OAuth.

Trong sandbox Windows, npm install cần truy cập registry và Vitest cần quyền tạo
tiến trình con; các lần chạy được cấp quyền đã hoàn tất.

### Swagger verification — 2026-10-29

Working tree trên revision 8ae62c3; giữ nguyên các snapshot kiểm chứng trước đó.
Scope: module docs, metadata schema, wiring Express, dependencies và tests.

- PASS: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`.
- PASS: `npm test` — 143 passed, 5 skipped; 9 suites passed, 1 skipped.
- HTTP tests kiểm tra UI/assets/spec khi messaging disabled trong test/production,
  danh sách route, examples qua validator thật, envelope v2 và response 202/400/413/503/504.
- 5 broker tests skipped vì không cung cấp RABBITMQ_TEST_URL disposable.
  Publisher doubles không chứng minh broker delivery.
- Chưa kiểm chứng tương tác Try it out trên trình duyệt: môi trường không có
  browser automation được cấu hình. HTTP/assets tests không thay thế browser smoke test.
- Không chạy broker/DB thật, không sửa backend hoặc .env cá nhân.
