import { z } from 'zod';
import { employeeProfilesData } from './schema.js';

export const profileViewSchema = z.strictObject({
  revision: z.string().regex(/^[1-9]\d{0,18}$/),
  employee: employeeProfilesData.shape.employees.element,
});
export const profilePageSchema = z.strictObject({
  items: z.array(profileViewSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  pageSize: z.union([z.literal(10), z.literal(20), z.literal(50)]),
});
export type ProfileView = z.infer<typeof profileViewSchema>;

const pageNumber = z
  .string()
  .regex(/^\d+$/)
  .transform(Number)
  .refine((v) => Number.isSafeInteger(v) && v > 0);
export const profileQuerySchema = z
  .strictObject({
    page: pageNumber.optional().transform((v) => v ?? 1),
    pageSize: z
      .enum(['10', '20', '50'])
      .optional()
      .transform((v) => Number(v ?? '10')),
  })
  .refine((v) => Number.isSafeInteger((v.page - 1) * v.pageSize));
