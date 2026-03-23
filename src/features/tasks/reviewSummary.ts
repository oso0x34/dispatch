export type AutomatedReviewResult = "PASS" | "FAIL";

export type AutomatedReviewSummary = {
  result: AutomatedReviewResult;
  feedback: string;
};

const AUTOMATED_REVIEW_MARKER = "### Automated Review";

export function parseLatestAutomatedReviewSummary(
  reviewNotesMarkdown: string,
): AutomatedReviewSummary | null {
  const markerIndex = reviewNotesMarkdown.lastIndexOf(AUTOMATED_REVIEW_MARKER);

  if (markerIndex === -1) {
    return null;
  }

  const block = reviewNotesMarkdown
    .slice(markerIndex + AUTOMATED_REVIEW_MARKER.length)
    .trim();

  if (!block) {
    return null;
  }

  let result: AutomatedReviewResult | null = null;
  const feedbackLines: string[] = [];
  let collectingFeedback = false;

  for (const rawLine of block.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      if (collectingFeedback) {
        feedbackLines.push("");
      }

      continue;
    }

    if (!collectingFeedback) {
      if (trimmed.startsWith("RESULT:")) {
        const normalized = trimmed.slice("RESULT:".length).trim().toUpperCase();

        if (normalized !== "PASS" && normalized !== "FAIL") {
          return null;
        }

        result = normalized;
        continue;
      }

      if (trimmed.startsWith("FEEDBACK:")) {
        collectingFeedback = true;
        feedbackLines.push(trimmed.slice("FEEDBACK:".length).trimStart());
        continue;
      }

      return null;
    }

    feedbackLines.push(line);
  }

  if (!result) {
    return null;
  }

  const feedback = feedbackLines.join("\n").trim() || "No feedback provided.";

  return {
    result,
    feedback,
  };
}

export function formatAutomatedReviewResult(result: AutomatedReviewResult) {
  return result === "PASS" ? "Passed" : "Needs changes";
}
