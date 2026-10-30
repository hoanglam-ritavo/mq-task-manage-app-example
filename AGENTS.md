# Hướng dẫn bảo trì task-manage-app-example

Áp dụng cho repository này và descendants, không áp dụng backend hoặc sibling app.
Đọc [README](README.md) → [ARCHITECTURE](ARCHITECTURE.md) → source trước khi sửa.
Tài liệu là quan sát tại thời điểm ghi; source hiện tại là căn cứ, yêu cầu người dùng quyết định phạm vi.

## Navigation và conventions

- [server.ts](src/server.ts): bootstrap; [app.ts](src/app.ts): HTTP composition không connection ngoài.
- [config](src/config/env.ts): chỉ loadConfig đọc môi trường; giữ process-variable precedence.
- [helper](src/helper/rabbitmq/index.ts): transport; module employee-profile/notification-example sở hữu nghiệp vụ.
- [documentation](src/modules/documentation/index.ts): Swagger từ Zod input schema; luôn bật.
- Dùng Express 5, Node 24, TypeScript ESM, import nội bộ đuôi .js; dùng npm và lockfile.
- Không thêm NestJS/DI framework, shared package hoặc cross-repository runtime imports mặc định.
- Không sửa backend/sibling nếu chưa thuộc yêu cầu. Không tự triển khai pipeline 3.
- Không chỉnh dist/node_modules hoặc .env cá nhân. Giữ thay đổi người dùng chưa commit.

## Bảo toàn hợp đồng và lifecycle

- Registration trước start; một helper instance mỗi process; createApp không mở broker.
- Không đọc .env/process.env trong nghiệp vụ. Broker offline không ngăn HTTP listen; health là liveness.
- Giữ publisher confirms, mandatory, bounded in-flight, DELIVERY_UNCERTAIN; không tự resend hoặc buffer vô hạn.
- Handler phải await công việc; helper sở hữu ack/retry/DLQ, confirm-before-ack và channel nhận delivery.
- Shutdown drain handlers/forwarding/publish; deadline HTTP không cho phép giả định handler đã dừng.
- Không đưa logic user/notification vào helper transport.
- Khi đổi contract, cập nhật Zod/schema, Swagger/examples, HTTP/consumer tests, README/ARCHITECTURE cùng lúc.
- TypeScript interface không thay runtime validation. Producer không tự fallback enum; BIRTHDAY do Rita ID chuẩn hóa.
- Không đổi queue/source/version hoặc imports sibling như thao tác dọn code; cần phạm vi liên hệ thống rõ ràng.
- Không log credentials/payload cá nhân/raw exception. console.log profile là ngoại lệ demo hiện có, không phải chuẩn production.
- Dùng fixture hư cấu. Không đọc/copy employee JSON cá nhân backend vào tests, docs hoặc build.
- Lỗi công khai giữ tiếng Anh và response shape/mã lỗi hiện có.

## Chọn kiểm chứng theo rủi ro

| Trách nhiệm         | Suite hiện hữu                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| HTTP/config         | [app](tests/app.test.ts), [env](tests/env.test.ts), [RabbitMQ config](tests/rabbitmq-config.test.ts)                             |
| Transport/lifecycle | [helper](tests/rabbitmq.test.ts), [connection](tests/rabbitmq-connection.test.ts), [lifecycle](tests/rabbitmq-lifecycle.test.ts) |
| Pipeline 1          | [employee profile](tests/employee-profile.test.ts)                                                                               |
| Pipeline 2          | [notification HTTP](tests/notification-example.test.ts)                                                                          |
| Swagger/contracts   | [documentation](tests/documentation.test.ts)                                                                                     |
| Broker disposable   | [broker](tests/rabbitmq-broker.test.ts)                                                                                          |

Sửa logic chạy suite liên quan trước; mở rộng khi tác động/failures yêu cầu.
Typecheck, lint, format check, build và full Vitest phù hợp merge/release hoặc thay đổi rộng, không bắt buộc cho mỗi sửa tài liệu.
Docs-only: kiểm tra links/anchors, JSON, command targets, Prettier read-only và diff; không mở server/broker/DB.
Lệnh npm run lint và npm run format:check là read-only; npm run format sửa file.
Không thêm test chỉ lặp implementation; giữ assertions phát hiện lỗi, không skip để làm xanh.

Broker suite chỉ đọc RABBITMQ_TEST_URL tường minh từ process, không dotenv; storage phải disposable.
Dùng UUID-prefixed resources, cleanup đúng tài nguyên trong finally; không restart broker ngoài suite.
Thiếu URL phải báo skip thực tế; suite thiếu không phải skip. Không chạy trên vhost/storage dùng chung.
Các Compose của hai examples là lựa chọn thay thế, không bật đồng thời cùng ports.

## Báo cáo và tài liệu

README sở hữu env/routes/commands/runbook; ARCHITECTURE sở hữu wiring/interfaces/guarantees; AGENTS sở hữu workflow.
Giữ anchor và lịch sử verification khi tổ chức lại; đánh dấu hướng dẫn cũ là lịch sử, không dùng lịch sử để giấu lỗi hiện hành.
Cập nhật Current verification status với ngày, revision/working tree, checks pass/fail/skip và giới hạn.
Mocks không chứng minh broker/DB, build không chứng minh nghiệp vụ; không claim check chưa chạy.
Không sửa runtime ngoài phạm vi để làm documentation gate xanh; ghi rõ lỗi baseline.
