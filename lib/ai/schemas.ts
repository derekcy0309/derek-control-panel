import { z } from "zod";

export const workWindowSchema = z.object({
  start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
});

export const dailyPlanRequestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workWindows: z.array(workWindowSchema).min(1).max(8),
  energyLevel: z.enum(["low", "medium", "high"]),
  mode: z.enum(["normal", "gentle", "minimum_step", "shift"]).default("normal"),
  familyLoad: z.enum(["low", "medium", "high"]).default("medium"),
  recoveryNeed: z.enum(["low", "medium", "high"]).default("medium"),
  bufferMinutes: z.number().int().min(0).max(720).default(30),
  preference: z.enum(["balanced", "easier"]).default("balanced")
});

export const aiDailySelectionSchema = z.object({
  summary: z.string().min(1).max(240),
  selections: z.array(z.object({
    taskId: z.string().uuid(),
    suggestedMinutes: z.number().int().min(5).max(240),
    reason: z.string().min(1).max(180),
    firstStep: z.string().min(1).max(240),
    effortTip: z.string().max(180).nullable()
  })).min(1).max(6)
});

export const taskAnalysisRequestSchema = z.object({
  taskId: z.string().uuid()
});

export const taskAnalysisSchema = z.object({
  clarifiedOutcome: z.string().min(1).max(240),
  fastestPath: z.array(z.object({
    action: z.string().min(1).max(240),
    minutes: z.number().int().min(2).max(120),
    energy: z.enum(["low", "medium", "high"])
  })).min(1).max(5),
  firstTenMinutes: z.string().min(1).max(240),
  stopCondition: z.string().min(1).max(240),
  estimatedMinutes: z.number().int().min(5).max(480),
  canDelegate: z.boolean(),
  missingInformation: z.array(z.string().max(180)).max(4),
  effortReductionTips: z.array(z.string().max(180)).max(4),
  warnings: z.array(z.string().max(220)).max(3)
});

export type AIDailySelection = z.infer<typeof aiDailySelectionSchema>;
export type TaskAnalysis = z.infer<typeof taskAnalysisSchema>;
