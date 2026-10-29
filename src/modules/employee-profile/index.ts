import { z } from 'zod';
import type {
  createRabbitMq,
  MessageEnvelope,
} from '../../helper/rabbitmq/index.js';

export const EMPLOYEE_PROFILE_EXCHANGE = 'rita.employee-profile.events';
export const EMPLOYEE_PROFILE_TYPE = 'employee.profiles.changed';
export const EMPLOYEE_PROFILE_QUEUE =
  'task-manage-app-example.employee-profile';
const parser = z.strictObject({
  group: z.string(),
  company: z.string(),
  department: z.string(),
  board: z.string(),
  region: z.string(),
  store: z.string(),
  warehouse: z.string(),
  factory: z.string(),
  workshop: z.string(),
  showroom: z.string(),
  center: z.string(),
  cafe: z.string(),
  others: z.array(z.string()),
});
export const employeeProfilesData = z.strictObject({
  syncRunId: z.uuid(),
  employees: z
    .array(
      z.strictObject({
        _id: z.uuid(),
        name: z.string(),
        email: z.string(),
        employee_id: z.string().nullable(),
        phone_number: z.string().nullable(),
        active: z.boolean(),
        is_developer: z.boolean(),
        groups: z.literal('EMPLOYEE'),
        avatar: z.string().nullable(),
        position: z.strictObject({ text: z.string().nullable(), parser }),
      }),
    )
    .min(1)
    .max(200),
});
export function validateEmployeeProfiles(
  data: unknown,
  envelope: MessageEnvelope,
) {
  if (
    envelope.type !== EMPLOYEE_PROFILE_TYPE ||
    envelope.schemaVersion !== 1 ||
    envelope.source !== 'rita-id' ||
    !z.uuid().safeParse(envelope.messageId).success
  ) {
    throw new Error('Invalid employee profile contract');
  }
  return employeeProfilesData.parse(data);
}
/** Topology overrides are for isolated broker fixtures, never environment routing. */
export function registerEmployeeProfileConsumer(
  messaging: Pick<ReturnType<typeof createRabbitMq>, 'register'>,
  topology = {
    exchange: EMPLOYEE_PROFILE_EXCHANGE,
    queue: EMPLOYEE_PROFILE_QUEUE,
  },
) {
  messaging.register({
    queue: topology.queue,
    bindings: [
      {
        exchange: topology.exchange,
        type: 'topic',
        routingKey: EMPLOYEE_PROFILE_TYPE,
      },
    ],
    validate: validateEmployeeProfiles,
    handle: async (message) => {
      console.log(message.data);
    },
  });
}
