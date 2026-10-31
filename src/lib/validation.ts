/**
 * Schémas de validation des entrées, partagés entre l'API (validation serveur,
 * qui fait foi) et les formulaires (retour immédiat à l'utilisateur).
 */
import { z } from "zod";

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const machineIdSchema = z.number().int().min(1).max(7);

export const loginSchema = z.object({
  schoolId: trimmed(64),
  password: z.string().min(1).max(256),
});

export const PASSWORD_MIN_LENGTH = 8;
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(128),
});

export const reserveSchema = z.object({
  /** `null` = « première machine disponible ». */
  targetMachineId: machineIdSchema.nullable(),
});

export const startCycleSchema = z.object({
  machineId: machineIdSchema,
  durationMin: z.number().int().min(1).max(300),
  /** Admin seulement : lancement direct sur une machine libre. */
  studentId: z.uuid().optional(),
});

export const extendCycleSchema = z.object({ minutes: z.number().int().min(1).max(120) });
export const stopCycleSchema = z.object({ mode: z.enum(["ended_early", "cancelled"]) });

export const updateMachineSchema = z
  .object({
    name: trimmed(40).optional(),
    defaultDurationMin: z.number().int().min(1).max(300).optional(),
  })
  .refine((v) => v.name !== undefined || v.defaultDurationMin !== undefined, "Aucune modification");

export const enqueueSchema = z.object({ studentId: z.uuid(), targetMachineId: machineIdSchema.nullable() });
export const moveSchema = z.object({ beforeId: z.uuid().nullable() });

export const userFieldsSchema = z.object({
  schoolId: trimmed(64).regex(
    /^[\p{L}\p{N}._-]+$/u,
    "Lettres, chiffres, point, tiret ou souligné uniquement",
  ),
  firstName: trimmed(80),
  lastName: trimmed(80),
  room: z.string().trim().max(20).nullable().optional(),
});

export const createUserSchema = userFieldsSchema.extend({
  role: z.enum(["student", "admin"]).default("student"),
});

export const updateUserSchema = z
  .object({
    firstName: trimmed(80).optional(),
    lastName: trimmed(80).optional(),
    room: z.string().trim().max(20).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Aucune modification");

export const importCsvSchema = z.object({ csv: z.string().min(1).max(500_000) });

const minuteOfDay = z.number().int().min(0).max(1440);

export const dayHoursSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    isOpen: z.boolean(),
    openMinute: minuteOfDay,
    closeMinute: minuteOfDay,
  })
  .refine((d) => d.openMinute < d.closeMinute, {
    message: "L'ouverture doit précéder la fermeture",
    path: ["closeMinute"],
  });

export const settingsSchema = z.object({
  callDelayMin: z.number().int().min(1).max(60),
  confirmDelayMin: z.number().int().min(1).max(60),
  cycleDurationsMin: z
    .array(z.number().int().min(5).max(300))
    .min(1)
    .max(10)
    .refine((a) => new Set(a).size === a.length, "Durées en double"),
  maxActiveReservations: z.number().int().min(1).max(5),
  studentCanStartCycle: z.boolean(),
  noShowWarningThreshold: z.number().int().min(1).max(50),
  noShowWindowDays: z.number().int().min(1).max(365),
});

export const updateSettingsSchema = z.object({
  settings: settingsSchema.optional(),
  hours: z
    .array(dayHoursSchema)
    .length(7)
    .refine((a) => new Set(a.map((d) => d.weekday)).size === 7, "Un horaire par jour")
    .optional(),
});

export const markReadSchema = z.object({ upToId: z.number().int().positive() });

export const testClockSchema = z.union([
  z.object({ offsetMs: z.number().int() }),
  z.object({ advanceMs: z.number().int() }),
]);
