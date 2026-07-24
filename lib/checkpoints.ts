import type { TaskCheckpoint, TaskCheckpointResource } from "@/lib/types";

export type CheckpointForm = {
  completedSummary: string;
  currentPosition: string;
  nextMinimumStep: string;
  resourceLinksText: string;
  blockedReason: string;
};

export function emptyCheckpointForm(): CheckpointForm {
  return {
    completedSummary: "",
    currentPosition: "",
    nextMinimumStep: "",
    resourceLinksText: "",
    blockedReason: ""
  };
}

export function checkpointFormFromRecord(checkpoint: TaskCheckpoint): CheckpointForm {
  return {
    completedSummary: checkpoint.completed_summary ?? "",
    currentPosition: checkpoint.current_position ?? "",
    nextMinimumStep: checkpoint.next_minimum_step ?? "",
    resourceLinksText: checkpoint.resource_links.map((resource) => (
      resource.label && resource.label !== hostname(resource.url)
        ? `${resource.label} | ${resource.url}`
        : resource.url
    )).join("\n"),
    blockedReason: checkpoint.blocked_reason ?? ""
  };
}

export function hasCheckpointContent(form: CheckpointForm) {
  return Boolean(
    form.completedSummary.trim()
    || form.currentPosition.trim()
    || form.nextMinimumStep.trim()
    || form.blockedReason.trim()
  );
}

export function parseCheckpointResources(input: string): {
  resources: TaskCheckpointResource[];
  error: string | null;
} {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length > 10) return { resources: [], error: "最多可加入 10 個相關連結。" };

  const resources: TaskCheckpointResource[] = [];
  for (const line of lines) {
    const separator = line.indexOf("|");
    const suppliedLabel = separator >= 0 ? line.slice(0, separator).trim() : "";
    const rawUrl = (separator >= 0 ? line.slice(separator + 1) : line).trim();
    try {
      const url = new URL(rawUrl);
      if (url.protocol !== "https:" || /\s/.test(rawUrl)) throw new Error("HTTPS_REQUIRED");
      const label = suppliedLabel || url.hostname;
      if (label.length > 200 || rawUrl.length > 2000) throw new Error("RESOURCE_TOO_LONG");
      resources.push({ label, url: rawUrl });
    } catch {
      return {
        resources: [],
        error: `「${line.slice(0, 80)}」不是有效的 HTTPS 網址。`
      };
    }
  }
  return { resources, error: null };
}

export function checkpointPayload(form: CheckpointForm) {
  const parsed = parseCheckpointResources(form.resourceLinksText);
  return {
    parsed,
    payload: {
      completedSummary: form.completedSummary,
      currentPosition: form.currentPosition,
      nextMinimumStep: form.nextMinimumStep,
      resourceLinks: parsed.resources,
      blockedReason: form.blockedReason
    }
  };
}

export function checkpointFormKey(form: CheckpointForm) {
  return JSON.stringify(form);
}

function hostname(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
