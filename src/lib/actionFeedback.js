// User-facing feedback for UAT reads and writes. A timed-out write may already be committed.
export function actionableErrorMessage(error, operation = "save") {
  const loading = operation === "load";
  if (error?.code === "API_CONTRACT_MISMATCH") {
    return "Frontend and backend versions do not match. Contact the UAT operator before retrying.";
  }
  if (error?.status === 401) {
    return "Your session has expired. Sign in again to continue without discarding your draft.";
  }
  if (error?.code === "STALE_PIPELINE_REVISION") {
    return "This Pipeline was updated by someone else. Copy any unsaved notes and refresh to review the latest version before saving.";
  }
  if (error?.status === 428) {
    return "The Pipeline revision is missing. Copy your draft notes and refresh before saving.";
  }
  if (error?.status === 503 || error?.status === 0 ||
      error?.name === "TypeError" || error?.code === "NETWORK_ERROR") {
    return loading
      ? "Unable to load data. Check your connection, then select Retry. If it persists, contact the UAT operator."
      : "Connection lost or the backend did not respond. Copy any unsaved notes and refresh to check whether the change was saved before trying again.";
  }
  if (typeof error?.message === "string" && error.message.trim()) return error.message;
  return loading ? "Unable to load Pipeline data. Select Retry." : "Unable to save. Review your entries and try again.";
}
