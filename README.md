# task-manage-app-example

Template Express 5 + TypeScript chạy độc lập trên Node.js 24, dùng npm.
Chưa triển khai nghiệp vụ, OAuth Rita ID hoặc database. RabbitMQ helper mặc định tắt.

## Cài đặt và chạy

Chạy các lệnh trong thư mục ứng dụng:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Chỉ sao chép nếu chưa có `.env`. Trên POSIX dùng `cp .env.example .env`.
Ứng dụng vẫn chạy với mặc định khi không có `.env`; biến môi trường của tiến trình được ưu tiên.

```sh
curl http://localhost:4102/health
npm run build
npm start
```

Health trả `{"status":"ok","service":"task-manage-app-example"}`. Endpoint chỉ xác nhận HTTP process hoạt động.
Dừng bằng Ctrl+C; SIGINT/SIGTERM chờ HTTP tối đa 10 giây; quá hạn đóng HTTP connections và đặt exit code 1, tiếp tục chờ messaging handlers hoàn tất.

## Cấu hình

| Biến      | Mặc định    | Giá trị                                        |
| --------- | ----------- | ---------------------------------------------- |
| NODE_ENV  | development | development, test, production                  |
| PORT      | 4102        | Số nguyên 1–65535                              |
| LOG_LEVEL | info        | fatal, error, warn, info, debug, trace, silent |

Cấu hình không hợp lệ làm ứng dụng dừng trước khi mở cổng. Không commit `.env`.

## Cấu trúc và thêm module

- `src/app.ts`: tạo Express app, không mở cổng; `src/server.ts`: startup và shutdown.
- `src/config/env.ts`: nơi duy nhất đọc môi trường, kiểm tra bằng Zod.
- `src/modules/health`: route và controller mẫu.
- `src/routes/index.ts`: lắp router nghiệp vụ dưới `/api/v1`.
- `src/middlewares`: xử lý 404 và lỗi tập trung.
- `src/shared`: logger và AppError.
- `tests`: kiểm tra HTTP và cấu hình.

Thêm feature trong `src/modules/<feature>` với routes, controller, service, schema và type khi cần.
Controller nhận HTTP input và gọi service; schema kiểm tra input ở runtime.
Chỉ thêm repository khi có persistence. Mount feature router trong `createApiRouter()`.
Import nội bộ dùng đuôi `.js` để bản ESM đã build chạy bằng Node.
Express 5 tự chuyển lỗi từ async handlers đến error middleware.
AppError chỉ được chứa thông báo công khai bằng tiếng Anh.

Body JSON giới hạn 1 MiB. Lỗi có dạng `{ "error": { "code": "...", "message": "..." } }`:
404 NOT_FOUND, 400 INVALID_JSON, 413 PAYLOAD_TOO_LARGE, 500 INTERNAL_SERVER_ERROR.
Lỗi 500 không trả chi tiết hoặc stack. Log chỉ ghi method, path (không query), status và durationMs;
không ghi body, cookie, authorization hoặc nội dung lỗi tùy ý.
Không đặt secret trong URL path.

## Lệnh kiểm tra

| Lệnh                 | Tác dụng                                 |
| -------------------- | ---------------------------------------- |
| npm run dev          | Chạy tsx watch                           |
| npm run build        | Xóa dist bằng Node API và compile source |
| npm start            | Chạy dist/server.js                      |
| npm run typecheck    | Kiểm tra type source và test             |
| npm run lint         | ESLint không sửa file                    |
| npm run format:check | Kiểm tra Prettier                        |
| npm run format       | Định dạng bằng Prettier                  |
| npm test             | Vitest một lần                           |

Mỗi app có package và lockfile riêng. Khi RabbitMQ tắt, không cần dịch vụ ngoài.
Build thành công không chứng minh bất kỳ tích hợp nghiệp vụ hay Rita ID nào.

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

## RabbitMQ foundation

Each app owns its independent [RabbitMQ helper](src/helper/rabbitmq/index.ts).
AMQP 0.9.1 uses pinned amqplib 2.2.0 and amqp-connection-manager 5.0.1.
No NestJS, cross-repository runtime imports, database or outbox/inbox are introduced. Notification example HTTP endpoints are described below. `/health` remains HTTP liveness only.

### Configuration

Runtime RABBITMQ_URL has been removed. Before enabling messaging, remove that old
variable and configure the split fields documented here. An enabled process with a nonempty
legacy URL fails validation without logging its value; a disabled process ignores it.
Missing credentials are allowed only when disabled; explicitly blank credentials
are invalid. Existing tuning variable names and limits are unchanged.

For the existing local Compose broker use RABBITMQ_HOST=127.0.0.1,
RABBITMQ_PORT=5673, RABBITMQ_USERNAME=rita_local,
RABBITMQ_PASSWORD=LocalRabbitOnly123, RABBITMQ_VHOST=rita_test and
RABBITMQ_TLS_ENABLED=false. The .env.example port is explicit: change it or omit
it when enabling TLS (omitted TLS port defaults to 5671). Do not overwrite personal
.env files. Production uses actual provisioned credentials and TLS; custom CA/mTLS
configuration is outside this change. No MAIL_QUEUE_NAME is introduced.

Connection options are passed as an object, not a reconstructed secret URL.
Credentials retain their bytes. The raw vhost is encoded once at the amqplib 2.2.0
boundary because the driver decodes object-form vhost. Status/logs never expose
credentials or connection options. RABBITMQ_TEST_URL remains test-only; disposable
broker fixtures decode that URL into split options without loading .env.

| Variable                    | Default     | Validation                                                             |
| --------------------------- | ----------- | ---------------------------------------------------------------------- |
| RABBITMQ_ENABLED            | false       | Literal true/false                                                     |
| RABBITMQ_HOST               | localhost   | DNS hostname, IPv4 or unbracketed IPv6; no whitespace/scheme/port/path |
| RABBITMQ_PORT               | 5672 / 5671 | Default follows TLS when omitted; explicit integer 1-65535 wins        |
| RABBITMQ_USERNAME           | unset       | Required when enabled, nonblank; bytes preserved                       |
| RABBITMQ_PASSWORD           | unset       | Required when enabled, nonblank; bytes preserved                       |
| RABBITMQ_VHOST              | /           | Raw nonblank name, not URL-encoded                                     |
| RABBITMQ_TLS_ENABLED        | false       | Literal true/false; normal Node certificate verification               |
| RABBITMQ_PREFETCH           | 10          | Integer 1–65535                                                        |
| RABBITMQ_PUBLISH_TIMEOUT_MS | 10000       | Integer 1–2147483647                                                   |
| RABBITMQ_MAX_IN_FLIGHT      | 100         | Integer 1–10000                                                        |
| RABBITMQ_HEARTBEAT_SECONDS  | 30          | Integer 1–65535                                                        |
| RABBITMQ_RECONNECT_SECONDS  | 5           | Integer 1–86400                                                        |

Only loadConfig reads application environment. Process variables take precedence.
Invalid configuration fails startup with sanitized errors; unavailable brokers do
not block HTTP startup. Disabled transport opens no sockets/channels/timers.
Do not overwrite personal .env files. Transport does not auto-publish at startup.

### API example

```ts
import { createRabbitMq } from './helper/rabbitmq/index.js';

const messaging = createRabbitMq(config.rabbitmq, logger);
messaging.register({
  queue: 'example.notifications',
  bindings: [
    { exchange: 'example.events', type: 'topic', routingKey: 'note.created' },
  ],
  validate: (data, envelope) => {
    if (
      envelope.type !== 'note.created' ||
      envelope.schemaVersion !== 1 ||
      typeof data !== 'string'
    )
      throw new Error('Invalid notification');
    return data;
  },
  handle: async (message) => {
    await saveNotification(message.data);
  },
});
messaging.start();
await messaging.publish({
  exchange: 'example.events',
  routingKey: 'note.created',
  message: {
    messageId: savedId,
    type: 'note.created',
    schemaVersion: 1,
    source: 'example-service',
    occurredAt: savedTimestamp,
    data: 'fictional',
  },
});
await messaging.stop();
```

This is documentation only: saveNotification/savedId/savedTimestamp belong to
future business code. Caller creates ID and UTC ISO timestamp before publishing
and retains ID on retries. Envelope supports optional correlationId and requires
defined data (null allowed). Subscription validators check type/version/data.
Metadata source is not proof of producer identity.

createRabbitMq does not connect. start is idempotent, closes registration and
connects in the background. getStatus exposes aggregate and per-subscription
states: disabled/connecting/ready/degraded/stopping. stop is idempotent.
createApp remains free of external connections; server bootstrap owns transport.

### Reliability and lifecycle

- One queue per receiving system; multiple workers sharing a queue compete for work.
  Durable direct/topic/fanout exchanges and quorum queues are supported. Publishers
  do not create recipient queues. Provision bindings before publishing.
- Persistent mandatory publishing resolves after broker confirm and no return,
  not after recipient business completion. Disabled/unavailable/blocked/backpressure/
  stopping/in-flight limits reject. Timeout or disconnect can mean delivery already
  happened: DELIVERY_UNCERTAIN. There is no automatic resend or unlimited offline buffer.
- Each subscription has its own channel; publisher and consumer connections are
  separate. Library reconnect owns connection recovery; setup callbacks restore
  channels and topology. Mismatches remain degraded, never auto-delete queues.
- Handler completion precedes ack on the original delivery channel. Bad JSON,
  invalid envelope/data and NonRetryableMessageError go directly to DLQ. Other
  errors retry after 10/60/300 seconds, then DLQ, without automatic replay.
- Queue Q reserves Q.delivery (direct exchange), Q.retry.1/2/3 and Q.dead.
  Retry TTL routes back only to Q, never to a broadcast exchange. Retry quorum
  queues use at-least-once dead lettering and reject-publish. Native delivery limit
  is disabled; application retries use bounded x-rita-retry. Monitor stuck deliveries.
- Retry/DLQ copies retain bytes and ID and must be confirmed before original ack.
  Failed forwarding pauses/drains consumption and recovers with backoff, avoiding
  hot requeue loops. Raw forwarding is transport-internal, not the business API.
- SIGINT/SIGTERM stop HTTP acceptance and new messaging work, cancel consumers,
  await accepted handlers/internal forwarding and pending publishes, then close
  broker connections. HTTP deadline remains 10 seconds: close HTTP connections and
  set exit code 1, but do not force process exit while messaging work is running.
  A hanging handler may delay shutdown indefinitely. HTTP listen errors close messaging.
- Logs include operational metadata only, never URL, credentials, payload or raw
  driver errors. Production requires TLS, scoped broker permissions and monitoring
  of degraded subscriptions, retry/DLQ depth, disk/memory and publish uncertainty.
- No exactly-once or strict ordering guarantees. Database writes and publish are
  not atomic. Add outbox/inbox and business authorization before real integration.

### Disposable broker tests

Each app includes compose.rabbitmq.yml with RabbitMQ 4.3.6-management, loopback
ports 5673/15673, a development user/vhost, named volume and healthcheck. The two
Compose files are alternatives: start only one; both apps may use that broker.
One local node is not HA. Compose does not start applications or databases.

```powershell
docker compose -f compose.rabbitmq.yml up -d --wait
$env:RABBITMQ_TEST_URL = 'amqp://rita_local:LocalRabbitOnly123@127.0.0.1:5673/rita_test'
npm run test:rabbitmq
docker compose -f compose.rabbitmq.yml down
```

Only supply an explicitly disposable broker/vhost. Tests never load .env, use UUID
resource prefixes and cleanup their own resources in finally. They close only
connections they own and never restart an external broker. Missing URL means skipped.

Fixture coverage models profile broadcast to Sale/Task, commands to a selected
system and notifications to Rita ID. Rita ID is a fixture, not a running backend:
these tests do not establish actual business integration. Real broker tests additionally
cover redelivery, unroutable messages, isolated retry, DLQ and reconnect.

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

## Employee profile pipeline example (2026-10-29)

The server registers the consumer in [employee-profile](src/modules/employee-profile/index.ts)
before messaging.start() when RABBITMQ_ENABLED=true. No additional example flag is required.
The durable topic exchange is rita.employee-profile.events; routing key/type is
employee.profiles.changed, schemaVersion=1, source=rita-id. This app owns queue
task-manage-app-example.employee-profile. Sale and Task use different queues bound to the same key.
Private retry/DLQ topology remains owned by each subscription.

Data is { syncRunId, employees }, with UUID run/user identities and 1-200 employees.
Each item has exactly _id, name, email, employee_id, phone_number, active,
is_developer, groups (EMPLOYEE), avatar and position { text, parser }. Nullable
fields are explicit; parser contains group/company/department/board/region/store/
warehouse/factory/workshop/showroom/center/cafe strings and others string[].
Unknown fields or invalid metadata/data are rejected into the helper DLQ.
The handler calls console.log(message.data) only after validation, then returns
for ack. Use suitable fictional demo data: profile console output is not a
production logging policy. A source string is not broker authorization.

Enable messaging on both examples and Rita ID using the existing split connection
env, same broker/vhost. Start both consumers and wait for ready subscriptions
before allowing Rita ID cron with HRM_SYNC_ENABLED=true to run. The backend
publishes only committed changes in active, employee_id or departmentName;
login/OAuth, snapshot refresh and profile API reads never publish. Payload is an
allowlisted committed internal profile, not a fresh HTTP response.

This is best-effort: a login can update first and hide the change from cron;
failed publishing after commit is not resent next run. Backend messages are bounded
to 200 items and 256 KiB UTF-8 per envelope; oversized individual profiles are
skipped. No consumer database, inbox, revision, backfill or absolute ordering is
provided; duplicates can be logged. Start consumers first: confirms do not prove
both queues exist. Keep the single-backend-process restriction. Existing HTTP
liveness, offline startup and shutdown draining remain in place.

Cross-app opt-in test runs from the sibling backend:

```sh
npm test -- --runInBand src/module/odoo-hrm/service/employee-profile-broker.spec.ts
```

It requires dependencies in all three sibling checkouts and an explicit disposable
RABBITMQ_TEST_URL, never application .env. The backend business publisher uses
fictional committed profiles with real consumer modules in child processes;
resources are UUID-prefixed and cleaned in finally. It does not start HRM or a DB.
Backend Compose is absent; do not use it as a runnable fixture. Existing example
Compose options are alternatives: run only one local broker.

Verification 2026-10-29, employee-profile working tree: typecheck, lint,
format:check, build passed; Vitest **98 passed, 5 broker tests skipped** per app.
The cross-app broker case is skipped without RABBITMQ_TEST_URL. Consumer-module
import/clean-exit smoke passed without external connections. No actual broker,
TLS, PostgreSQL locking/rollback or real HRM integration was verified.

## Notification pipeline example v2 (2026-10-29)

The [notification router](src/modules/notification-example/index.ts) simulates actions and publishes through the same messaging instance as pipeline 1. No order/task or notification is saved. These endpoints have no authentication/role checks; use only a controlled demo environment. createApp opens no external connection. Enable with the existing RABBITMQ_ENABLED settings, and start Rita ID's notification subscription before calling APIs.

Only schemaVersion=2 is emitted/accepted. Source is task-manage-app-example, exchange rita.notification.events (topic), routing key/envelope type notification.requested, Rita queue rita-id.notifications. Endpoint sets scenario, message UUID and timestamp; clients cannot override them. Existing confirm, retry/DLQ and shutdown behavior is retained. Pipeline 1 is unchanged.

All requests below use the app's configured HTTP port and Content-Type: application/json. UUIDs shown are fictional; project existence and actor permissions are not verified.

```http
POST /api/v1/examples/notifications/task-assigned
Content-Type: application/json

{
  "actor": null,
  "recipientUserIds": [
    "a0e42d5d-33ec-4a72-8d71-7637c9559011"
  ],
  "title": "Demo notification",
  "project_id": "710f5c04-08ba-4ee0-817c-7656121ca003",
  "custom_badge": null
}
```

```http
POST /api/v1/examples/notifications/task-commented
Content-Type: application/json

{
  "actor": null,
  "recipientUserIds": [
    "a0e42d5d-33ec-4a72-8d71-7637c9559011"
  ],
  "title": "Demo notification",
  "project_id": "710f5c04-08ba-4ee0-817c-7656121ca003",
  "custom_badge": null
}
```

Required fields: actor (local User UUID or explicit null), project_id (local Project UUID), recipientUserIds (1-100 distinct UUIDs), nonblank title (max 200), custom_badge (null or object). Actor may also be a recipient; duplicate recipients are rejected case-insensitively. Null actor represents a system action, not an invalid UUID fallback.

Summary is optional at HTTP, nonblank/max 2000 when supplied; otherwise the endpoint fills its scenario template. Wire messages always include summary. Badge object has exactly label (nonblank string, max 100) and required status (string max 100 or null). Missing badge/label/status, unknown fields or the old flat custom_badge_status are invalid. Text is not trimmed or uppercased. Optional type/priority accept string max 100 or null.

Rita defaults missing/null/unknown type to SYSTEM and priority to MEDIUM. Badge null stays null; object status null/unknown defaults to DEFAULT. Valid enums remain unchanged, wrong types fail validation. Source/scenario/version/identity are never defaulted. Rita logs the normalized data and acknowledges afterward; it does not query/update users, projects or notifications. Logging can repeat; there is no inbox/outbox or guaranteed ordering.

Invalid HTTP input returns 400 without publishing. 202 {messageId,status:"broker-confirmed",simulation:true} waits for broker confirmation, not consumer completion. Transport unavailable/rejected returns 503; DELIVERY_UNCERTAIN returns 504 and delivery may already have occurred. Errors keep {error:{code,message},messageId} once created. No automatic resend; a missing injected publisher yields UNAVAILABLE.

### Generate local request bodies

Run the standalone script from the sibling backend root (replace placeholders explicitly; repeat recipient-user-id for more recipients):

```sh
node scripts/generate-notification-examples.mjs --employees-file src/mock/employee_sso_store.json --users-file src/mock/res_users.json --actor-user-id "<USER_UUID>" --recipient-user-id "<RECIPIENT_UUID>" --sale-project-id "<SALE_PROJECT_UUID>" --task-project-id "<TASK_PROJECT_UUID>"
```

It joins res_users.odooId to HRM user_id for explicitly chosen active non-deleted EMPLOYEE users, requires a unique active HRM link, preserves internal UUIDs and uses HRM employee_name. It never guesses roles, users or project IDs. Project UUIDs are syntax-checked only; manager/customer/order/task details are fictional. Actor names in generated title/summary come from local data, not the static API fallback summary.

Five body files and an endpoint README are written into backend .tmp/notification-examples/<run-uuid>/, outside Git. Each run is new; no source files are changed or messages sent. Do not copy personal payloads into tracked source/tests/build artifacts. This app never reads backend JSON at runtime. Use an HTTP client or curl --data-binary @file.json to send a chosen body after reviewing it; console output at Rita contains local identity/name data.

### Rollout and validation

Stop demo API calls, replace the single backend process with the v2 consumer and wait for ready, then update Sale/Task and send v2 bodies. Version 1 messages go to DLQ, without automatic conversion/replay or queue deletion. Start all subscriptions before demonstrating both pipelines. The backend Compose fixture remains absent.

From the backend root, with an explicit disposable RABBITMQ_TEST_URL and dependencies in all three sibling checkouts:

```sh
npm test -- --runInBand src/module/notifications/notification-example-broker.spec.ts
```

The harness uses real example HTTP modules and Rita's subscription, UUID resource prefixes and finally cleanup. It tests five v2 scenarios, enum fallback, invalid data and v1 into DLQ; it does not load .env or start HRM/database. Missing URL means skipped.

Verification 2026-10-29, v2 working tree: typecheck, lint, format check, build passed; Vitest **137 passed, 5 broker cases skipped**. Actual broker/TLS/database behavior remains unverified. No personal payload generation was performed without explicit selected UUIDs.

### Previous v1 verification

Verification 2026-10-29, notification-example working tree: typecheck, lint, build and format:check passed (initial new-module formatting issue corrected). Vitest: **126 passed, 5 broker cases skipped**. Pipeline 1, HTTP health and lifecycle tests are included. Cross-app harness module import/clean-exit smoke passed without connections; actual RabbitMQ delivery/TLS and database integration remain unverified.

## Swagger UI — pipeline 2 v2

Swagger luôn bật, kể cả production và RabbitMQ disabled/offline:

- UI: http://localhost:4102/docs
- OpenAPI 3.1: http://localhost:4102/openapi.json
- Nhóm Notification examples chứa 2 POST APIs; Health chứa HTTP liveness.

Chạy app bằng `npm run dev` hoặc `npm run build` rồi `npm start`.
UI dùng assets local, gọi cùng origin, không gửi spec tới online validator.
Không thêm cờ env; docs không mở kết nối broker.

Để demo end-to-end: cấu hình cùng broker/vhost, khởi động Rita ID và chờ
consumer notification ready; sau đó mở Swagger của app này, mở endpoint,
chọn example, bấm **Try it out**, sửa JSON và **Execute**. Với messaging
disabled/offline, docs vẫn hoạt động nhưng POST trả 503.

Mỗi endpoint có ba examples: đầy đủ, actor/badge null với summary mặc định,
và chuỗi enum chưa hỗ trợ. UUID/tên mẫu là hư cấu, không chứng minh user/project
tồn tại. Có thể dán body JSON do generator local
`generate-notification-examples.mjs` trong backend tạo vào ô request;
không đưa payload cá nhân vào source/specification.

Actor, project_id, recipientUserIds, title và custom_badge là bắt buộc.
Actor/badge cho phép null; summary thiếu dùng template endpoint.
Type/priority/status nhận chuỗi chưa hỗ trợ để Rita ID fallback về
SYSTEM/MEDIUM/DEFAULT; badge null giữ null. So khớp chính xác, không trim/uppercase.
Recipient không được trùng kể cả khác casing; schema JSON không thay thế
toàn bộ validation runtime.

202 chỉ xác nhận broker, không chứng minh Rita ID đã log. 400 là request sai;
413 là body quá lớn; 503 là transport unavailable/rejected; 504 là
DELIVERY_UNCERTAIN, message có thể đã được gửi. UI không tự retry.
Endpoint chưa có auth, không tạo đơn hàng/task thật, không xác minh quyền hoặc
sự tồn tại của các UUID; chỉ dùng trong môi trường demo có kiểm soát.
Nội dung gửi có thể xuất hiện trong console Rita ID.

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
