# task-manage-app-example

Example độc lập Express 5 + TypeScript ESM, Node.js 24, npm và custom RabbitMQ AMQP 0.9.1.
App **nhận profile ở pipeline 1**, **phát notification ở pipeline 2**.
Không có database/OAuth hoặc nghiệp vụ Task Manage thật; messaging mặc định tắt.

Đọc [kiến trúc và payload đầy đủ](ARCHITECTURE.md), [hướng dẫn bảo trì](AGENTS.md).
Tài liệu liên hệ thống tùy chọn: [note backend](../rita-id-backend/docs/rabbitmq-business-pipelines.md);
không cần sibling checkout để chạy HTTP của app này.

## Cài đặt và chạy

Chạy từ thư mục repository:

```powershell
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```

Không ghi đè .env cá nhân. POSIX dùng `test -f .env || cp .env.example .env`.
Có thể chạy không .env với mặc định; process env được ưu tiên hơn dotenv.
Bản compile: `npm run build` rồi `npm start`.

- [Health](http://localhost:4102/health): `{"status":"ok","service":"task-manage-app-example"}`.
- [Swagger UI](http://localhost:4102/docs), [OpenAPI](http://localhost:4102/openapi.json): luôn bật cả production và broker offline.
- Dùng port thực tế nếu đổi PORT. Health chỉ là HTTP liveness, không xác nhận broker ready.
- Ctrl+C/SIGTERM drain HTTP và messaging; deadline HTTP 10 giây không cắt handler messaging.

## Cấu hình

Nguồn chính: [parser](src/config/env.ts), [.env.example](.env.example).
Các biến integer RabbitMQ nhận chữ số, trong giới hạn dưới; boolean chỉ nhận true/false.

| Biến                        | Default        | Quy tắc                                                                 |
| --------------------------- | -------------- | ----------------------------------------------------------------------- |
| NODE_ENV                    | development    | development/test/production                                             |
| PORT                        | 4102           | Integer 1–65535                                                         |
| LOG_LEVEL                   | info           | fatal/error/warn/info/debug/trace/silent                                |
| RABBITMQ_ENABLED            | false          | false không tạo connection/channel/timer                                |
| RABBITMQ_HOST               | localhost      | DNS/IPv4/IPv6 không ngoặc; không scheme, port kèm, path hoặc whitespace |
| RABBITMQ_PORT               | 5672 hoặc 5671 | 1–65535; TLS bật chọn 5671 khi thiếu; explicit port được giữ            |
| RABBITMQ_USERNAME           | không có       | Bắt buộc khi enabled; nếu khai báo phải không trắng                     |
| RABBITMQ_PASSWORD           | không có       | Như username, giữ nguyên bytes                                          |
| RABBITMQ_VHOST              | /              | Tên nguyên bản không URL-encoded, không trắng                           |
| RABBITMQ_TLS_ENABLED        | false          | Kiểm tra certificate mặc định Node; không bypass TLS                    |
| RABBITMQ_PREFETCH           | 10             | 1–65535                                                                 |
| RABBITMQ_PUBLISH_TIMEOUT_MS | 10000          | 1–2147483647                                                            |
| RABBITMQ_MAX_IN_FLIGHT      | 100            | 1–10000                                                                 |
| RABBITMQ_HEARTBEAT_SECONDS  | 30             | 1–65535                                                                 |
| RABBITMQ_RECONNECT_SECONDS  | 5              | 1–86400                                                                 |

Disabled cho phép thiếu credentials nhưng **các biến mới đã khai báo sai vẫn bị từ chối**, không bỏ qua toàn bộ như một số cấu hình backend.
RABBITMQ_URL cũ không dùng runtime; enabled và URL không rỗng bị từ chối; disabled bỏ qua URL cũ.
Credentials không trim/decode; vhost raw được adapter encode đúng một lần khi truyền object vào amqplib.
RABBITMQ_TEST_URL chỉ dành cho suite broker disposable, không phải runtime URL.
Config sai dừng startup; config đúng nhưng broker offline vẫn cho HTTP chạy.

## Broker local

[Compose](compose.rabbitmq.yml) dùng RabbitMQ 4.3.6-management, localhost 5673/15673,
vhost rita_test và named volume. Hai Compose Sale/Task là **hai lựa chọn thay thế**;
chỉ chạy một, cả hai app kết nối broker đó.

```sh
docker compose -f compose.rabbitmq.yml up -d
```

Đây là lệnh vận hành local tùy chọn, không phải bước kiểm chứng tài liệu đã chạy.
Cấu hình demo tương ứng (credential local công khai trong Compose, không dùng production):

```dotenv
RABBITMQ_ENABLED=true
RABBITMQ_HOST=127.0.0.1
RABBITMQ_PORT=5673
RABBITMQ_USERNAME=rita_local
RABBITMQ_PASSWORD=LocalRabbitOnly123
RABBITMQ_VHOST=rita_test
RABBITMQ_TLS_ENABLED=false
```

Một node không phải HA. Không xóa volume/restart broker dùng chung để thử tính năng.
Production cần quyền vhost/exchange/queue và TLS riêng.

## Pipeline 1 — nhận profile

Module [employee-profile](src/modules/employee-profile/index.ts) đăng ký trước start khi enabled.
Queue app này: `task-manage-app-example.employee-profile`; exchange `rita.employee-profile.events`;
routing/type `employee.profiles.changed`, version 1, source rita-id.

Chạy Sale/Task trước, chờ subscription ready (trạng thái helper getStatus, không phải HTTP health).
Sau đó backend cron ở môi trường cô lập với HRM_SYNC_ENABLED=true có thể phát profile đã commit.
Chỉ active/employee_id/departmentName đổi mới phát; login/OAuth không phát.
Không có endpoint kích hoạt pipeline 1 và không hướng dẫn chạy live cron để nghiệm thu tài liệu.

Envelope hư cấu hợp lệ:

```json
{
  "messageId": "11111111-1111-4111-8111-111111111111",
  "type": "employee.profiles.changed",
  "schemaVersion": 1,
  "source": "rita-id",
  "occurredAt": "2026-10-30T00:00:00.000Z",
  "data": {
    "syncRunId": "33333333-3333-4333-8333-333333333333",
    "employees": [
      {
        "_id": "22222222-2222-4222-8222-222222222222",
        "name": "Demo Employee",
        "email": "demo@example.invalid",
        "employee_id": "EMP-DEMO-001",
        "phone_number": null,
        "active": true,
        "is_developer": false,
        "groups": "EMPLOYEE",
        "avatar": null,
        "position": {
          "text": null,
          "parser": {
            "group": "",
            "company": "",
            "department": "",
            "board": "",
            "region": "",
            "store": "",
            "warehouse": "",
            "factory": "",
            "workshop": "",
            "showroom": "",
            "center": "",
            "cafe": "",
            "others": []
          }
        }
      }
    ]
  }
}
```

Consumer validate rồi `console.log(message.data)`: output là syncRunId và employees, không phải toàn envelope.
Không lưu DB/profile, không backfill/resync, không tự gọi backend.
Hai queue riêng giúp cả Sale và Task nhận bản sao; workers cùng queue chia việc.
Không có thay đổi mục tiêu thì không publish; login cập nhật trước có thể làm cron không còn phát.
Commit rồi publish lỗi có thể mất event, không tự gửi bù; log có thể trùng; queue mới không nhận lịch sử.
Xem [interfaces và validation](ARCHITECTURE.md#pipeline-1--contract-dữ-liệu-nhận).

## Pipeline 2 — gửi notification

POST dưới `/api/v1/examples/notifications`; app này có 2 endpoint:

| Endpoint sau prefix | Scenario            | Summary mặc định                               |
| ------------------- | ------------------- | ---------------------------------------------- |
| /task-assigned      | task.task-assigned  | Người quản lý đã tạo và giao task demo cho bạn |
| /task-commented     | task.task-commented | Nguyễn Văn A đã bình luận trong task của bạn   |

Request mẫu cho từng endpoint, dùng UUID hư cấu (không chứng minh bản ghi tồn tại):

POST /api/v1/examples/notifications/task-assigned

```json
{
  "actor": null,
  "recipientUserIds": ["22222222-2222-4222-8222-222222222222"],
  "project_id": "33333333-3333-4333-8333-333333333333",
  "title": "Người quản lý đã tạo và giao task demo cho bạn",
  "custom_badge": null
}
```

POST /api/v1/examples/notifications/task-commented

```json
{
  "actor": null,
  "recipientUserIds": ["22222222-2222-4222-8222-222222222222"],
  "project_id": "33333333-3333-4333-8333-333333333333",
  "title": "Nguyễn Văn A đã bình luận trong task của bạn",
  "custom_badge": null
}
```

Title bắt buộc; summary thiếu dùng template trong bảng. Actor và custom_badge bắt buộc nhưng cho phép null.
Recipient 1–100 UUID không trùng kể cả casing; project_id là Project UUID Rita ID.
Xem [HTTP request và wire contract](ARCHITECTURE.md#pipeline-2--contract-dữ-liệu-gửi) để biết toàn bộ field/giới hạn.
Producer tự thêm scenario/source/version/messageId/occurredAt; không truyền chúng qua HTTP body.

### Thử bằng Swagger

1. Với demo toàn luồng, cấu hình cùng broker/vhost, khởi động Rita ID và chờ queue notification ready.
2. Mở /docs, chọn endpoint và example, bấm **Try it out**, sửa body rồi **Execute**.
3. Có bốn nhóm examples: đầy đủ; actor/badge null và summary mặc định; enum chưa hỗ trợ; BIRTHDAY.
4. Producer gửi nguyên enum string. Rita ID giữ WARNING/MESSAGE/REPORT/REMINDER/UPDATED/SYSTEM;
   BIRTHDAY dành nội bộ hoặc chuỗi ngoài allowlist → SYSTEM. Priority fallback MEDIUM, badge.status fallback DEFAULT.
5. Không trim/uppercase; sai kiểu bị validation từ chối. Không tự resend sau kết quả chưa xác định.

API chưa có auth, không tạo đơn hàng/task thật. Rita ID có persistence đang phát triển,
không còn chỉ log và chưa được coi là lưu recipients hoàn chỉnh. **Dùng dữ liệu và DB/broker cô lập**.
Có thể dán body từ [generator backend](../rita-id-backend/src/mock/README.md) vào Swagger;
runtime không đọc JSON cá nhân/backend. Chi tiết backend trong note liên hệ thống, không phải dependency chạy app.

### Response HTTP

| HTTP | Body/ý nghĩa                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------- |
| 202  | {messageId,status:"broker-confirmed",simulation:true}; chỉ confirm, không chứng minh backend đã lưu |
| 400  | {error:{code,message}}; INVALID_NOTIFICATION_REQUEST hoặc INVALID_JSON; không publish               |
| 413  | {error:{code:"PAYLOAD_TOO_LARGE",message}}; body vượt 1 MiB                                         |
| 503  | {messageId,error:{code,message}}; transport unavailable/rejected                                    |
| 504  | {messageId,error:{code:"DELIVERY_UNCERTAIN",message}}; message có thể đã gửi                        |

503 gồm DISABLED, UNAVAILABLE, BLOCKED, BACKPRESSURE, IN_FLIGHT_LIMIT, STOPPING, UNROUTABLE, NACKED hoặc PUBLISH_FAILED.
Không có publisher inject → UNAVAILABLE. messageId chỉ có sau khi request hợp lệ và envelope được tạo.
202 không xác nhận consumer đã nhận/log/commit; request gọi lại tạo ID mới và có thể trùng nghiệp vụ.
HTTP errors sanitized tiếng Anh; middleware chung còn có 404 NOT_FOUND và 500 INTERNAL_SERVER_ERROR.

## Troubleshooting

| Hiện tượng                    | Kiểm tra                                                                                             |
| ----------------------------- | ---------------------------------------------------------------------------------------------------- |
| HTTP hoạt động nhưng POST 503 | enabled, config, broker, blocked/backpressure và helper status; health không kiểm broker             |
| UNROUTABLE                    | Rita ID queue/binding đã ready, đúng exchange/routing/vhost; confirm không chứng minh mọi subscriber |
| 400                           | Field bắt buộc, strict root/badge, UUID, recipients trùng, title/summary trắng, độ dài               |
| 504                           | Kết quả chưa xác định; không tự kết luận chưa gửi hoặc gọi lại mù quáng                              |
| Không có log profile          | Consumer ready trước cron, queue riêng, có commit đổi ba field, backend cron enabled                 |
| Không thấy notification ở UI  | Producer confirm không chứng minh persistence/UI; xem giới hạn backend                               |

## Cấu trúc và thêm module

[source map và lifecycle](ARCHITECTURE.md#runtime-và-trách-nhiệm) mô tả app/server/config/routes/modules/helper/shutdown.
Nghiệp vụ thuộc src/modules, transport thuộc helper. createApp nhận publisher tối thiểu để tests dùng doubles.
ESM imports dùng .js. Không thêm persistence/auth/command nếu chưa thuộc phạm vi.
Pipeline 3 triển khai sau; fixture transport không phải business runtime.

## Lệnh kiểm tra

| Lệnh                  | Mục đích                           |
| --------------------- | ---------------------------------- |
| npm run dev           | tsx watch                          |
| npm run build         | Xóa dist bằng Node API rồi compile |
| npm start             | Chạy dist/server.js                |
| npm run typecheck     | Kiểm tra source/tests              |
| npm run lint          | ESLint read-only                   |
| npm run format:check  | Prettier read-only                 |
| npm run format        | Sửa định dạng                      |
| npm test              | Vitest                             |
| npm run test:rabbitmq | Suite broker opt-in                |

[Broker suite](tests/rabbitmq-broker.test.ts) chỉ nhận RABBITMQ_TEST_URL từ process, không dotenv,
vhost/storage disposable tường minh, tạo UUID resources và cleanup finally. Thiếu URL báo skipped.
Không coi fixture transport là bằng chứng business pipeline toàn hệ sinh thái.
Xem [chọn tests theo rủi ro](AGENTS.md#chọn-kiểm-chứng-theo-rủi-ro); docs-only không cần build/full Vitest.
Mỗi app có dependencies/lockfile riêng, không cần backend chạy để kiểm HTTP với publisher double.

## Current verification status

Ngày 30/10/2026; revision `9e5e04a` cùng working tree. Scope chỉ README/ARCHITECTURE/AGENTS.
PASS: 46 liên kết tương đối/anchors; JSON examples được kiểm tra với validator thuần hiện có (4 examples); command/test references được đối chiếu source. PASS: Prettier read-only trên ba file và git diff --check.

Chỉ kiểm tra tài liệu và import validator thuần; không chạy build, full Vitest, HTTP server, browser, broker hoặc database. Không suy ra delivery/persistence từ các kiểm tra này. Lịch sử tests phía dưới không phải kết quả chạy lại trong đợt này.

## Lịch sử kiểm chứng

Các snapshot dưới đây giữ nguyên kết quả và anchor lịch sử. Hành vi/hướng dẫn cũ trong snapshot
chỉ mô tả thời điểm ghi, không thay phần hướng dẫn hiện hành phía trên.
Không diễn giải test từng pass là bằng chứng broker/database đang hoạt động.

## Kết quả kiểm chứng — 2026-10-28

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

## RabbitMQ verification — 2026-10-28

Executed against the local RabbitMQ implementation working tree (these example
folders have no Git repository/revision), Windows, Node 24.21.0:

- npm install: lockfile updated independently; 0 vulnerabilities reported.
- npm run typecheck, npm run lint, npm run format:check and npm run build: passed.
- npm test: 6 suites passed, 1 skipped; 58 tests passed, 5 skipped, 0 failed per app.
- Tests cover HTTP availability with an unreachable loopback broker, shutdown beyond
  the HTTP deadline, transport failures and three-system routing using a broker double.
- The 5 real-broker cases were skipped because RABBITMQ_TEST_URL was absent.
  Docker CLI was unavailable. Image pull, Compose startup, real quorum TTL/DLX,
  confirms/redelivery and reconnect remain unverified against a real broker.
- No actual Rita ID integration, database operations or business handlers were executed.
  Mocks are not evidence of broker durability or database transaction safety.

## Split RabbitMQ configuration verification - 2026-10-28

Executed on the local split-env working tree (no Git revision for this example).
Typecheck, read-only ESLint, format check and build passed. Vitest: 6 suites passed,
1 skipped; **87 tests passed, 5 skipped, 0 failed** per app. Regressions cover TLS
port selection, obsolete URL rejection, raw credentials/Unicode vhost, object
connection options, disabled/offline HTTP and existing messaging lifecycle.

RABBITMQ_TEST_URL remains test-only. Docker CLI and test URL were unavailable;
real broker connection, TLS handshake and quorum behavior were not verified.
No .env, Compose credentials, dependencies, business handlers or broker topology
were modified in this change. Previous verification snapshots above remain historical.

### Previous v1 verification

Verification 2026-10-29, notification-example working tree: typecheck, lint, build and format:check passed (initial new-module formatting issue corrected). Vitest: **126 passed, 5 broker cases skipped**. Pipeline 1, HTTP health and lifecycle tests are included. Cross-app harness module import/clean-exit smoke passed without connections; actual RabbitMQ delivery/TLS and database integration remain unverified.

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

### Các mốc kiểm chứng pipeline được giữ lại

Verification 2026-10-29, employee-profile working tree: typecheck, lint,
format:check, build passed; Vitest **98 passed, 5 broker tests skipped** per app.
The cross-app broker case is skipped without RABBITMQ_TEST_URL. Consumer-module
import/clean-exit smoke passed without external connections. No actual broker,
TLS, PostgreSQL locking/rollback or real HRM integration was verified.

Verification 2026-10-29, v2 working tree: typecheck, lint, format check, build passed; Vitest **137 passed, 5 broker cases skipped**. Actual broker/TLS/database behavior remains unverified. No personal payload generation was performed without explicit selected UUIDs.

Verification: typecheck, lint, format check, build và Vitest PASS; 143 tests passed, 5 broker cases skipped vì không có URL disposable. HTTP tests xác nhận cả bốn Swagger examples, bao gồm BIRTHDAY được gửi nguyên bản. Dữ liệu tests hư cấu; không chạy broker/DB hoặc browser thật. Publisher doubles không chứng minh delivery hay persistence. Các kết quả cũ phía trên được giữ như lịch sử.

### Liên kết cũ

Các anchor dưới đây giữ liên kết cũ; xem hướng dẫn hiện hành ở các phần phía trên.

<a id="rabbitmq-foundation"></a>

<a id="configuration"></a>

<a id="api-example"></a>

<a id="reliability-and-lifecycle"></a>

<a id="disposable-broker-tests"></a>

<a id="employee-profile-pipeline-example-2026-10-29"></a>

<a id="notification-pipeline-example-v2-2026-10-29"></a>

<a id="generate-local-request-bodies"></a>

<a id="rollout-and-validation"></a>

<a id="swagger-ui--pipeline-2-v2"></a>

<a id="external-notification-types--2026-10-30"></a>
