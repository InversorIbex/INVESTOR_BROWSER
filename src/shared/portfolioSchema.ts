import { z } from 'zod';

/** One buy or sell, validated identically in the UI bridge and in the repository. */
export const OpInputSchema = z
  .object({
    companyId: z.number().int().positive(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    side: z.enum(['buy', 'sell']),
    qty: z.number().positive().max(1e12),
    price: z.number().min(0).max(1e9),
    currency: z.string().regex(/^[A-Z]{3}$/),
    feeEur: z.number().min(0).max(1e9).default(0),
    fxPerEur: z.number().positive().max(1e6),
  })
  .strict();
export type OpInput = z.infer<typeof OpInputSchema>;
