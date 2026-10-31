# Kiến trúc task-manage-app-example

Đối chiếu source ngày 30/10/2026, revision `9e5e04a` cùng working tree tài liệu.
Đây là quan sát implementation, không phải bằng chứng vận hành broker/DB thật.
Xem [hướng dẫn chạy](README.md), [quy tắc bảo trì](AGENTS.md).

## Runtime và trách nhiệm

Express 5, TypeScript ESM trên Node.js 24; helper AMQP 0.9.1 dùng amqplib và amqp-connection-manager.
Không NestJS, không shared package hoặc runtime import từ backend/app khác; chưa có database/OAuth hay nghiệp vụ Task Manage thật.

```text
loadConfig → createRabbitMq → register pipeline 1 (khi enabled) → start
                                                                  ↓
                                      createApp(config, logger, cùng messaging)
                                                                  ↓
                                           HTTP pipeline 2 → publish → confirm
```

| Thành phần                                                         | Trách nhiệm                                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [server.ts](src/server.ts)                                         | Tạo một helper mỗi process, đăng ký trước start, listen và xử lý lỗi startup |
| [app.ts](src/app.ts), [routes](src/routes/index.ts)                | Compose HTTP với publisher được inject; createApp không mở connection ngoài  |
| [env.ts](src/config/env.ts)                                        | loadConfig nạp dotenv, giữ process precedence; parseEnv kiểm tra config      |
| [helper](src/helper/rabbitmq/index.ts)                             | createRabbitMq/register/start/publish/getStatus/stop, không chứa nghiệp vụ   |
| [profile consumer](src/modules/employee-profile/index.ts)          | Validation và console.log dữ liệu pipeline 1                                 |
| [notification producer](src/modules/notification-example/index.ts) | HTTP request, template, envelope và response pipeline 2                      |
| [Swagger](src/modules/documentation/index.ts)                      | OpenAPI từ input schema Zod, examples và UI luôn bật                         |
| [shutdown](src/shutdown.ts)                                        | SIGINT/SIGTERM idempotent, drain HTTP và messaging                           |

Helper có hai connection publisher/consumer; mỗi subscription có channel riêng.
Thư viện sở hữu reconnect, setup callback dựng lại topology. Disabled không mở connection/channel/timer.
Broker offline không chặn HTTP listen; config sai chặn startup. /health chỉ là HTTP liveness.
Module nghiệp vụ đăng ký object subscription (queue, bindings, validate, handle); helper sở hữu ack/nack.
Topology override dành cho fixtures cô lập, không phải routing tùy ý từ HTTP/env.

Shutdown ngừng nhận HTTP, stop messaging, chờ handlers/forwarding/publish đang xử lý.
Deadline HTTP 10 giây đóng connections còn lại và đặt exit code lỗi, không cắt ngang handler messaging.
Handler treo có thể giữ process sống; không dùng timeout để giả định transaction đã dừng.
HTTP listen thất bại cũng gọi messaging.stop để dọn reconnect timers.

## Envelope chung

Interface sau mô tả shape; runtime validation nằm trong [rabbitmq.types.ts](src/helper/rabbitmq/rabbitmq.types.ts).

```ts
interface MessageEnvelope<T> {
  messageId: string;
  type: string;
  schemaVersion: number;
  source: string;
  occurredAt: string;
  correlationId?: string;
  data: T;
}
```

| Field         | Contract helper                                                            |
| ------------- | -------------------------------------------------------------------------- |
| messageId     | Chuỗi không trắng, caller tạo trước publish; giữ khi retry                 |
| type          | Chuỗi không trắng; validator nghiệp vụ giới hạn loại nhận                  |
| schemaVersion | Số nguyên dương an toàn; nghiệp vụ giới hạn version                        |
| source        | Chuỗi không trắng; không chứng thực producer                               |
| occurredAt    | ISO UTC hợp lệ kết thúc Z; không phải revision                             |
| correlationId | Optional, nếu có phải là chuỗi không trắng                                 |
| data          | Có mặt và không undefined; helper cho phép null, nghiệp vụ quy định cụ thể |

Pipeline 1 còn kiểm tra messageId là UUID. Producer pipeline 2 tự tạo UUID và timestamp.
Không nhầm envelope.type với data.type của notification.

## Pipeline 1 — contract dữ liệu nhận

Backend Rita ID cron chỉ phát profile có thay đổi đã commit trong active, employee_id hoặc departmentName.
Login/OAuth và API đọc không phát. Login cập nhật trước có thể khiến cron không còn phát hiện thay đổi.
Đây là best-effort: commit rồi publish lỗi có thể mất event; không tự gửi bù.

| Thành phần                   | Giá trị                                  |
| ---------------------------- | ---------------------------------------- |
| Exchange durable topic       | rita.employee-profile.events             |
| Routing key và envelope.type | employee.profiles.changed                |
| schemaVersion / source       | 1 / rita-id                              |
| Queue app này                | task-manage-app-example.employee-profile |
| Queue Sale                   | sale-app-example.employee-profile        |
| Queue Task                   | task-manage-app-example.employee-profile |

Hai queue riêng cùng binding nhận bản sao; nhiều workers cùng queue chia việc.
Consumer provision queue khi enabled; producer không provision queue của app.
Không có endpoint HTTP để kích hoạt pipeline 1.

Các interface minh họa tương ứng [schema runtime](src/modules/employee-profile/index.ts):

```ts
interface ParsedDepartmentName {
  group: string;
  company: string;
  department: string;
  board: string;
  region: string;
  store: string;
  warehouse: string;
  factory: string;
  workshop: string;
  showroom: string;
  center: string;
  cafe: string;
  others: string[];
}
interface EmployeeProfile {
  _id: string;
  name: string;
  email: string;
  employee_id: string | null;
  phone_number: string | null;
  active: boolean;
  is_developer: boolean;
  groups: 'EMPLOYEE';
  avatar: string | null;
  position: { text: string | null; parser: ParsedDepartmentName };
}
interface EmployeeProfilesChangedData {
  syncRunId: string;
  employees: EmployeeProfile[];
}
```

| Dữ liệu                                       | Validation/ý nghĩa                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------- |
| syncRunId, employee._id                       | UUID; _id là Rita ID user identity, không phải employee code/odooId       |
| employees                                     | 1–200 items; mọi field trong interface đều bắt buộc                       |
| name/email                                    | String; không kiểm tra email-format hoặc bắt chuỗi không rỗng             |
| employee_id/phone_number/avatar/position.text | String hoặc null; không tự suy luận format URL/phone/code                 |
| active/is_developer                           | Boolean                                                                   |
| groups                                        | Literal EMPLOYEE                                                          |
| position.parser                               | Đủ 12 string và others string[]; không suy luận cấp tổ chức               |
| Objects                                       | Strict: từ chối field ngoài contract ở data, employee, position và parser |

256 KiB UTF-8 toàn envelope là giới hạn batching publisher backend, không phải byte-size validator consumer.
Consumer kiểm tra envelope type/version/source, parse data, rồi handle gọi console.log(message.data);
helper chỉ ack sau handler thành công. Không lưu profile, không mapping user hoặc gọi API Rita ID.
Department bị xóa thể hiện position.text=null. Missing employee hợp lệ có thể tạo active=false với profile cũ.
Không có revision, inbox hoặc ordering tuyệt đối; log có thể trùng; queue mới không nhận lịch sử.

## Pipeline 2 — contract dữ liệu gửi

App này là producer với source cố định `task-manage-app-example`.
Exchange topic `rita.notification.events`, routing key/envelope.type `notification.requested`,
schemaVersion=3. Queue `rita-id.notifications` do subscription backend quản lý; app này không đăng ký consumer notification.

### HTTP request

```ts
interface NotificationExampleRequest {
  actor: string | null;
  recipientUserIds: string[];
  title: string;
  summary?: string;
  project_id: string;
  type?: string | null;
  priority?: string | null;
  custom_badge: { label: string; status: string | null } | null;
  group?: { key: string; type: 'COUPLE' | 'MULTIPLE'; name: string | null };
  message?: { id: string; text: string; sentAt: string };
}
```

| Field            | Quy tắc                                                                               |
| ---------------- | ------------------------------------------------------------------------------------- |
| actor            | Bắt buộc UUID Rita ID user hoặc null; null là hành động hệ thống, không thay UUID sai |
| recipientUserIds | 1–100 UUID khác nhau kể cả casing; actor có thể là recipient                          |
| project_id       | Bắt buộc UUID Project Rita ID, không phải task project/order ID ngoài                 |
| title            | Bắt buộc, không trắng, tối đa 200 ký tự                                               |
| summary          | Optional; nếu truyền không trắng, tối đa 2.000 ký tự; thiếu thì template endpoint     |
| custom_badge     | Bắt buộc có mặt, null hoặc object strict                                              |
| badge.label      | Bắt buộc khi có object, không trắng, tối đa 100 ký tự                                 |
| badge.status     | Bắt buộc khi có object, string tối đa 100 hoặc null                                   |
| type/priority    | Optional string tối đa 100 hoặc null, không giới hạn thành enum tại producer          |

MESSAGE bắt buộc có group/message; type khác cấm cả hai. Group/message objects strict: key/id không trắng ≤200; name bắt buộc null hoặc không trắng ≤200; text không trắng ≤2.000, plain text; sentAt ISO UTC thật, tối đa millisecond. Schema JSON có điều kiện if/then/else, validator runtime kiểm tra thêm nonblank/timestamp.

Root/badge từ chối field thừa; không trim hoặc uppercase. Không nhận source/scenario/messageId/version từ caller.
UUID chỉ kiểm tra cấu trúc, chưa có auth hoặc xác minh tồn tại/quyền tại producer.

### Wire data và metadata server tạo

```ts
type NotificationScenario = 'task.task-assigned' | 'task.task-commented';
type NotificationExampleData = Omit<NotificationExampleRequest, 'summary'> & {
  scenario: NotificationScenario;
  summary: string;
};
// MessageEnvelope<NotificationExampleData>:
// type='notification.requested', schemaVersion=3,
// source='task-manage-app-example', messageId=UUID, occurredAt=ISO UTC
```

Producer bổ sung scenario từ endpoint, điền summary nếu thiếu, giữ nguyên actor/project/badge/type/priority.
Không có actor/project entity hoặc readAt trên wire. Type optional vẫn có thể vắng mặt.
Envelope version 3 độc lập với API URL /api/v1. Backend v3 từ chối v2 vào DLQ.

Ví dụ envelope phát đi (dữ liệu hư cấu):

```json
{
  "messageId": "11111111-1111-4111-8111-111111111111",
  "type": "notification.requested",
  "schemaVersion": 3,
  "source": "task-manage-app-example",
  "occurredAt": "2026-10-30T00:00:00.000Z",
  "data": {
    "actor": null,
    "recipientUserIds": ["22222222-2222-4222-8222-222222222222"],
    "project_id": "33333333-3333-4333-8333-333333333333",
    "title": "Demo notification",
    "custom_badge": null,
    "scenario": "task.task-assigned",
    "summary": "Người quản lý đã tạo và giao task demo cho bạn",
    "type": "BIRTHDAY"
  }
}
```

### Fallback tại backend và response HTTP

Rita ID nhận sáu data.type công khai: WARNING, MESSAGE, REPORT, REMINDER, UPDATED, SYSTEM.
Thiếu/null/rỗng/chuỗi ngoài allowlist (kể cả BIRTHDAY nội bộ) → SYSTEM.
Priority LOW/MEDIUM/HIGH/URGENT; thiếu/null/chuỗi lạ → MEDIUM.
Badge status DEFAULT/SUCCESS/WARNING/DANGEROUS; null/chuỗi lạ → DEFAULT; badge null giữ null.
So khớp chính xác, sai kiểu không fallback. Producer gửi nguyên chuỗi và không thực hiện chuẩn hóa này.
Envelope.type vẫn phải notification.requested; source/scenario/version sai không được fallback.

Publisher chờ confirm rồi trả 202. Không tự retry HTTP hoặc resend message; request mới tạo messageId mới.
Chi tiết response và lỗi trong [README](README.md#response-http).
Backend v3 có persistence transaction cùng receipt dedup; tra identity/project và dùng project preferences. 202 không chứng minh transaction đã commit. Mỗi notification giữ immutable snapshot group/message; source/project tự khai chưa là authorization.
Xem [note backend tùy chọn](../rita-id-backend/docs/rabbitmq-business-pipelines.md) để biết hiện trạng;
đường dẫn này cần sibling checkout, không phải dependency runtime.

## Transport và giới hạn bảo đảm

- Publish persistent, mandatory và broker confirms; correlate return/confirm theo attempt.
- Disabled/chưa ready/blocked/backpressure/stopping hoặc vượt in-flight reject; không buffer offline vô hạn.
- Timeout/mất kết nối sau gửi có thể DELIVERY_UNCERTAIN; giữ message ID nếu thiết kế retry ở tầng gọi.
- Consumer manual ack trên channel nhận delivery; handler thành công mới ack.
- [Topology](src/helper/rabbitmq/rabbitmq-topology.service.ts): queue Q có Q.delivery direct, Q.retry.1/2/3 và Q.dead.
- Retry hữu hạn 10/60/300 giây, quay lại đúng queue, không broadcast lại; giữ ID và bytes.
- Invalid JSON/envelope/payload hoặc NonRetryableMessageError vào DLQ; lỗi handler khác retry rồi DLQ.
- Forward retry/DLQ phải confirm trước ack gốc; forward thất bại thì pause/drain/recover có backoff.
- Durable quorum queues; retry TTL dùng at-least-once dead-lettering và reject-publish. Một node local không phải HA.
- Không exactly-once, ordering tuyệt đối hoặc atomicity DB–broker. App không có outbox/inbox hoặc tự replay DLQ; backend có receipt dedup riêng pipeline 2.
- Header/source/user/project khai báo không thay authorization. Profile log chỉ dành cho demo phù hợp.

## Pipeline 3 và giới hạn ứng dụng

Pipeline 3 triển khai sau; chưa có business command endpoints/handlers hoặc contract được chốt.
Fixture routing trong tests chỉ là kiểm chứng transport, không đồng nghĩa đã có pipeline 3 runtime.
Không suy ra login, phân quyền, persistence hoặc UI Sale/Task từ các endpoint mô phỏng.
