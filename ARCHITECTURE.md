# Kiến trúc task-manage-app-example

Đối chiếu HTTP contract backend ngày2026-11-09. Xem [README](README.md) cho env/routes/runbook và [AGENTS](AGENTS.md) cho workflow.

## Composition

Express5 + TypeScript ESM, import nội bộ đuôi .js. Không NestJS, database, OAuth hoặc source import từ sibling. [server](src/server.ts) load typed config/logger, tạo notification client không I/O, listen và đăng ký shutdown. [createApp](src/app.ts) nhận client/store inject; mỗi instance mặc định có store/client riêng.

[Config](src/config/env.ts) là nơi duy nhất đọc environment/dotenv. API URL cố định, không credentials/query/hash; giữ path prefix. HTTP loopback chỉ development/test. Credential thiếu cho phép startup nhưng endpoint tương ứng503; giá trị sai chặn startup với field names, không values.

## Profile webhook

[Receiver/store](src/modules/employee-profile/webhook.ts) gắn raw parser256 KiB trước global JSON parser. HMAC kiểm tra raw bytes và timestamp trước JSON/schema. Không chấp nhận header trùng; timing-safe comparison. Message ID header/body phải khớp. [Schema](src/modules/employee-profile/schema.ts) giữ projection backend với đúng một EMPLOYEE; envelope thêm revision signed-bigint dạng string, syncRunId và outbound.sync.profile v1.

Store có receipt message UUID → SHA256(raw body), profile employee UUID → revision/content hash/current projection. Hash profile chuẩn hóa thứ tự object keys; raw receipt hash vẫn phân biệt byte khác. Dùng BigInt. So sánh/capacity/update không await: duplicate200, stale200, revision/identity conflict409, vượt capacity503 trước mọi mutation. Copy profile trước khi giữ/trả snapshot để không làm lộ mutable state. Limits1.000 profiles và10.000 receipts, không TTL/eviction.

RAM chỉ sống trong một process. Không giao dịch DB, không chống trùng qua restart hoặc nhiều replica. Public receiver200 được backend coi là DELIVERED, dù dữ liệu ở example có thể mất sau restart; cần store bền vững và atomic dedup/revision update trước khi dùng production. Không có worker/callback complete hoặc pipeline3.

## Notification outbound

[API demo](src/modules/notification-example/index.ts) dùng Bearer token riêng trước parser/validation. Request có stable messageId, occurredAt, correlationId tùy chọn và data; scenario cố định theo route, summary default từ template. Reject unknown/server-owned fields. Client không điều khiển Project/source/envelope type/schemaVersion. MESSAGE và enum giữ đúng ranh giới backend; không tạo normalization khác.

[Client](src/helper/rita-http/notification-client.ts) dùng Node fetch inject; POST duy nhất tới backend, X-API-Key phía server, redirect manual, timeout10s, response tối đa16 KiB. Kiểm tra status200 và identity/status body trước khi công bố accepted. Mapping lỗi được kiểm soát, không trả upstream body. Không automatic retry/outbox. Caller giữ request gốc để resend thủ công với cùng key/integration/identity/content khi kết quả unknown.

## Lifecycle, bảo mật và tài liệu

[Shutdown](src/shutdown.ts) đóng HTTP, đặt exit code lỗi nếu vượt deadline và chờ client stop. Client từ chối việc mới và drain operations thực tế; abort/deadline không biến công việc chưa kết thúc thành đã dừng.

API key Rita ID, signing secret và demo Bearer token độc lập. Access log giữ metadata/path nhãn cố định. Riêng webhook receiver ghi logger.info với event profile_webhook_received và toàn bộ envelope/profile đã xác thực, validate và khớp header/body ID, trước store.apply; conflict409/capacity503 vẫn có received log. Các request bị từ chối trước bước đó không log payload. Log processed in RAM giữ kết quả riêng. Không thêm raw body, headers, signature, API key, signing secret hoặc Bearer token cấu hình vào logs. Không có flag mới; LOG_LEVEL hiện tại lọc info. Payload log chứa dữ liệu cá nhân và không phải bằng chứng xử lý thành công/lưu bền. [Swagger](src/modules/documentation/index.ts) dùng Zod schemas, conditional MESSAGE metadata và examples hư cấu. Health/docs public, demo routes có Bearer, webhook có signature. HTTP integration tests không chứng minh public DNS/TLS/receiver production hoặc DB transaction; xem [Current verification status](README.md#current-verification-status).

## Đọc profile trong RAM

[Read router](src/modules/employee-profile/read.routes.ts) nhận cùng ProfileStore với receiver qua createApp/createApiRouter. Demo Bearer middleware chạy trước query/UUID validation; cả hai GET có Cache-Control: no-store. Store list lấy keys/sort/slice/projection đồng bộ, chỉ clone items trong page; detail trả clone và bigint revision thành string. snapshot nội bộ vẫn giữ hash/bigint cho regressions, không serialize ra HTTP. GET không tạo receipts, đổi revision hoặc gọi transport.

Danh sách gồm cả inactive, sort theo UUID lowercase, chỉ phản ánh process hiện tại. Token đọc toàn bộ RAM app; không bootstrap/backfill hay xác nhận đầy đủ nhân viên Rita ID. Access log chỉ nhãn list/detail cố định, không query/UUID/response profile; ngoại lệ payload webhook vẫn giữ nguyên.
