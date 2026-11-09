# Hướng dẫn bảo trì task-manage-app-example

Áp dụng riêng repository này. Đọc [README](README.md), [ARCHITECTURE](ARCHITECTURE.md) rồi source; giữ thay đổi người dùng. Không sửa backend/sibling/portal/mobile ngoài phạm vi được giao.

## Navigation và conventions

- [server](src/server.ts) sở hữu bootstrap/lifecycle; [app](src/app.ts) compose HTTP với client/store inject, không I/O khi createApp.
- [config](src/config/env.ts) là nơi duy nhất đọc environment; giữ dotenv process precedence. Không sửa/in .env cá nhân hoặc secrets.
- [profile](src/modules/employee-profile/webhook.ts) sở hữu HMAC/raw parser/RAM state; [notification](src/modules/notification-example/index.ts) sở hữu templates/request schema; [HTTP client](src/helper/rita-http/notification-client.ts) sở hữu transport, error mapping và draining.
- Express5, Node24, TypeScript ESM, imports .js, npm/lockfile. Không thêm NestJS/shared runtime package, DB, OAuth login hay pipeline3 như thao tác dọn code.

## Contracts và bảo mật

- Profile dùng raw256 KiB trước JSON; xác thực3 headers, window5 phút, signing key decoded từ whsec_, không re-serialize body trước verify. Giữ exact one-employee envelope, bigint revision, atomic synchronous store update và capacity rejection không mutation.
- RAM không bền vững; restart/nhiều process làm mất bảo đảm dedup/ordering. Không hứa HTTP200 tương đương DB commit hoặc downstream business completion.
- API demo dùng Bearer token riêng trước parser. Rita API key/signing secret chỉ phía server; không thay lẫn hoặc log credentials, payload/profile, raw upstream errors/headers.
- Notification giữ caller messageId/occurredAt khi retry. Scenario thuộc route, Project/source thuộc Rita integration. Không thêm project_id hoặc event-routing input, tự resend hoặc caller-chosen destination URL.
- Dùng fixtures hư cấu, không đọc/copy employee JSON cá nhân/backend .env. Không runtime/test import source sibling; backend golden signature là constant hư cấu đã đối chiếu, không dependency.
- Giữ client timeout10s/no redirect/no retry; kiểm tra response identity. Shutdown phải chờ work thực tế; không dùng deadline đóng socket để giả định side effect đã dừng.

## Kiểm chứng và báo cáo

Sửa logic chạy suite sở hữu trước, mở rộng theo tác động. Thay đổi diện rộng chạy typecheck, read-only lint/format check, build, toàn bộ Vitest và docs:check. Lệnh format sửa file; lint và format:check không sửa. Bảo toàn assertions nghiệp vụ khi chuyển transport, không skip/todo để làm xanh.

Docs-only chạy docs:check, format:check và diff; không startup app/backend/DB chỉ để kiểm Markdown. [Checker](scripts/check-docs.mjs) kiểm links/anchors, route inventory, npm script references và JSON syntax; tests kiểm schema/runtime. Ghi ngày/revision/working-tree/pass-fail-skip thực tế trong [Current verification status](README.md#current-verification-status), giữ lịch sử hỗn hợp có nhãn retired.

HTTPS/backend smoke chỉ dùng môi trường isolated, URL/credentials explicit và fixture hư cấu; không dùng dịch vụ chia sẻ, ứng dụng .env hoặc nới backend SSRF/TLS cho test. Mocks/build không chứng minh public TLS, DB rollback/constraints, delivery thật hoặc restart durability.
