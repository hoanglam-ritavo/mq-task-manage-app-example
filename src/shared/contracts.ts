import { z } from 'zod';
export const uuid = z.uuid();
export const utcTimestamp = z
  .string()
  .refine((value) => {
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
      !Number.isFinite(Date.parse(value))
    )
      return false;
    return (
      new Date(value).toISOString().replace(/\.000Z$/, 'Z') ===
      value
        .replace(
          /\.(\d{1,2})Z$/,
          (_, digits: string) => '.' + digits.padEnd(3, '0') + 'Z',
        )
        .replace(/\.000Z$/, 'Z')
    );
  }, 'Canonical UTC timestamp required')
  .meta({ format: 'date-time' });
export const nonblank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((v) => !!v.trim(), 'Nonblank string required');
