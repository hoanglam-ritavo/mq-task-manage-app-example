import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  registerEmployeeProfileConsumer,
  validateEmployeeProfiles,
  EMPLOYEE_PROFILE_QUEUE,
} from '../src/modules/employee-profile/index.js';
import type {
  RabbitMqSubscription,
  MessageEnvelope,
} from '../src/helper/rabbitmq/index.js';
const data = {
  syncRunId: randomUUID(),
  employees: [
    {
      _id: randomUUID(),
      name: 'Demo',
      email: '',
      employee_id: null,
      phone_number: null,
      active: true,
      is_developer: false,
      groups: 'EMPLOYEE',
      avatar: null,
      position: {
        text: null,
        parser: {
          group: '',
          company: '',
          department: '',
          board: '',
          region: '',
          store: '',
          warehouse: '',
          factory: '',
          workshop: '',
          showroom: '',
          center: '',
          cafe: '',
          others: [],
        },
      },
    },
  ],
};
const message: MessageEnvelope = {
  messageId: randomUUID(),
  type: 'employee.profiles.changed',
  schemaVersion: 1,
  source: 'rita-id',
  occurredAt: new Date().toISOString(),
  data,
};
describe('Employee profile consumer', () => {
  it('registers its own queue and logs precisely validated data', async () => {
    let subscription: RabbitMqSubscription<unknown> | undefined;
    registerEmployeeProfileConsumer({
      register: (value) => {
        subscription = value as RabbitMqSubscription<unknown>;
      },
    });
    expect(subscription?.queue).toBe(EMPLOYEE_PROFILE_QUEUE);
    expect(subscription?.bindings).toEqual([
      {
        exchange: 'rita.employee-profile.events',
        type: 'topic',
        routingKey: 'employee.profiles.changed',
      },
    ]);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const validated = subscription!.validate(data, message);
      await subscription!.handle({ ...message, data: validated });
      expect(log).toHaveBeenCalledExactlyOnceWith(data);
    } finally {
      log.mockRestore();
    }
  });
  it.each([
    { type: 'wrong' },
    { source: 'wrong' },
    { schemaVersion: 2 },
    { messageId: 'bad' },
  ])('rejects invalid metadata %j', (patch) => {
    expect(() =>
      validateEmployeeProfiles(data, { ...message, ...patch }),
    ).toThrow();
  });
  it.each([
    { ...data, employees: [] },
    { ...data, secret: 'extra' },
    { ...data, employees: [{ ...data.employees[0], secret: 'extra' }] },
    { ...data, employees: [{ ...data.employees[0], active: 'true' }] },
    {
      ...data,
      employees: [
        { ...data.employees[0], position: { text: null, parser: {} } },
      ],
    },
    {
      ...data,
      employees: Array.from({ length: 201 }, () => data.employees[0]),
    },
  ])('rejects invalid data without logging', (invalid) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      expect(() => validateEmployeeProfiles(invalid, message)).toThrow();
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });
});
