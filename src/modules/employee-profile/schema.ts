import { z } from 'zod';
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
    .length(1),
});
