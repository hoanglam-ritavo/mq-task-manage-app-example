import type {
  NotificationExampleRequest,
  templates,
} from '../notification-example/index.js';

type Example = {
  summary: string;
  description: string;
  value: NotificationExampleRequest;
};
// Documentation choices only: never used as runtime defaults.
export const notificationExamples = {
  'task-assigned': {
    full: {
      summary: 'Đầy đủ theo nghiệp vụ',
      description:
        'Dữ liệu hư cấu: thay actor/recipient bằng UUID Rita ID hợp lệ. Sự kiện mới dùng messageId mới; retry giữ identity và nội dung. Đổi nội dung với messageId đã accepted có thể trả 409. Giá trị này là minh họa, không phải default theo route.',
      value: {
        messageId: 'b0000000-0000-4000-8000-000000000001',
        occurredAt: '2026-11-09T03:00:00Z',
        correlationId: 'task-demo-task-assigned',
        data: {
          actor: '11111111-1111-4111-8111-111111111111',
          recipientUserIds: ['22222222-2222-4222-8222-222222222222'],
          title: 'Công việc mới (minh họa)',
          summary: 'Công việc mới: dữ liệu hư cấu để thử tích hợp.',
          type: 'UPDATED',
          priority: 'MEDIUM',
          custom_badge: {
            label: 'Công việc mới',
            status: 'DEFAULT',
          },
        },
      },
    },
    minimal: {
      summary: 'Dùng giá trị mặc định',
      description:
        'Dữ liệu hư cấu: thay actor/recipient bằng UUID Rita ID hợp lệ. Sự kiện mới dùng messageId mới; retry giữ identity và nội dung. Đổi nội dung với messageId đã accepted có thể trả 409. Giá trị này là minh họa, không phải default theo route. Bỏ summary để dùng template của route; type/priority được Rita ID chuẩn hóa thành SYSTEM/MEDIUM. Badge null không hiển thị.',
      value: {
        messageId: 'b0000000-0000-4000-8000-000000000002',
        occurredAt: '2026-11-09T03:00:00Z',
        data: {
          actor: null,
          recipientUserIds: ['22222222-2222-4222-8222-222222222222'],
          title: 'Công việc mới (minh họa)',
          custom_badge: null,
        },
      },
    },
    message: {
      summary: 'Có ngữ cảnh hội thoại',
      description:
        'Dữ liệu hư cấu: thay actor/recipient bằng UUID Rita ID hợp lệ. Sự kiện mới dùng messageId mới; retry giữ identity và nội dung. Đổi nội dung với messageId đã accepted có thể trả 409. Giá trị này là minh họa, không phải default theo route. Minh họa MESSAGE; scenario vẫn là task.task-assigned.',
      value: {
        messageId: 'b0000000-0000-4000-8000-000000000003',
        occurredAt: '2026-11-09T03:00:00Z',
        correlationId: 'task-demo-task-assigned-conversation',
        data: {
          actor: '11111111-1111-4111-8111-111111111111',
          recipientUserIds: ['22222222-2222-4222-8222-222222222222'],
          title: 'Công việc mới (minh họa)',
          summary: 'Công việc mới: dữ liệu hư cấu để thử tích hợp.',
          type: 'MESSAGE',
          priority: 'MEDIUM',
          custom_badge: {
            label: 'Công việc mới',
            status: 'DEFAULT',
          },
          group: {
            key: 'demo-task-assigned',
            type: 'MULTIPLE',
            name: 'Trao đổi công việc mới',
          },
          message: {
            id: 'demo-task-assigned-message-1',
            text: 'Trao đổi minh họa về công việc mới.',
            sentAt: '2026-11-09T03:00:00Z',
          },
        },
      },
    },
  },
  'task-commented': {
    full: {
      summary: 'Đầy đủ theo nghiệp vụ',
      description:
        'Dữ liệu hư cấu: thay actor/recipient bằng UUID Rita ID hợp lệ. Sự kiện mới dùng messageId mới; retry giữ identity và nội dung. Đổi nội dung với messageId đã accepted có thể trả 409. Giá trị này là minh họa, không phải default theo route.',
      value: {
        messageId: 'b0000000-0000-4000-8000-000000000004',
        occurredAt: '2026-11-09T03:00:00Z',
        correlationId: 'task-demo-task-commented',
        data: {
          actor: '11111111-1111-4111-8111-111111111111',
          recipientUserIds: ['22222222-2222-4222-8222-222222222222'],
          title: 'Bình luận mới (minh họa)',
          summary: 'Bình luận mới: dữ liệu hư cấu để thử tích hợp.',
          type: 'UPDATED',
          priority: 'LOW',
          custom_badge: {
            label: 'Bình luận mới',
            status: 'DEFAULT',
          },
        },
      },
    },
    minimal: {
      summary: 'Dùng giá trị mặc định',
      description:
        'Dữ liệu hư cấu: thay actor/recipient bằng UUID Rita ID hợp lệ. Sự kiện mới dùng messageId mới; retry giữ identity và nội dung. Đổi nội dung với messageId đã accepted có thể trả 409. Giá trị này là minh họa, không phải default theo route. Bỏ summary để dùng template của route; type/priority được Rita ID chuẩn hóa thành SYSTEM/MEDIUM. Badge null không hiển thị.',
      value: {
        messageId: 'b0000000-0000-4000-8000-000000000005',
        occurredAt: '2026-11-09T03:00:00Z',
        data: {
          actor: null,
          recipientUserIds: ['22222222-2222-4222-8222-222222222222'],
          title: 'Bình luận mới (minh họa)',
          custom_badge: null,
        },
      },
    },
    message: {
      summary: 'Có ngữ cảnh hội thoại',
      description:
        'Dữ liệu hư cấu: thay actor/recipient bằng UUID Rita ID hợp lệ. Sự kiện mới dùng messageId mới; retry giữ identity và nội dung. Đổi nội dung với messageId đã accepted có thể trả 409. Giá trị này là minh họa, không phải default theo route. Minh họa MESSAGE; scenario vẫn là task.task-commented.',
      value: {
        messageId: 'b0000000-0000-4000-8000-000000000006',
        occurredAt: '2026-11-09T03:00:00Z',
        correlationId: 'task-demo-task-commented-conversation',
        data: {
          actor: '11111111-1111-4111-8111-111111111111',
          recipientUserIds: ['22222222-2222-4222-8222-222222222222'],
          title: 'Bình luận mới (minh họa)',
          summary: 'Bình luận mới: dữ liệu hư cấu để thử tích hợp.',
          type: 'MESSAGE',
          priority: 'MEDIUM',
          custom_badge: {
            label: 'Bình luận mới',
            status: 'DEFAULT',
          },
          group: {
            key: 'demo-task-commented',
            type: 'MULTIPLE',
            name: 'Trao đổi bình luận mới',
          },
          message: {
            id: 'demo-task-commented-message-1',
            text: 'Trao đổi minh họa về bình luận mới.',
            sentAt: '2026-11-09T03:00:00Z',
          },
        },
      },
    },
  },
} satisfies Record<
  keyof typeof templates,
  Record<'full' | 'minimal' | 'message', Example>
>;
