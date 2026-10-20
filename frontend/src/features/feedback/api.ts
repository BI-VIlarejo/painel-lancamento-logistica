import { apiRequest, isDemoMode } from "../../shared/api/apiClient";
import { demoFeedbackApi } from "./demoApi";
import type { FeedbackCreateInput, FeedbackItem, FeedbackPageResponse } from "./types";

export const feedbackApi = {
  list(): Promise<FeedbackPageResponse> {
    return isDemoMode
      ? demoFeedbackApi.list()
      : apiRequest<FeedbackPageResponse>("/feedbacks?limit=500");
  },
  create(payload: FeedbackCreateInput): Promise<FeedbackItem> {
    return isDemoMode
      ? demoFeedbackApi.create(payload)
      : apiRequest<FeedbackItem>("/feedbacks", { method: "POST", body: payload });
  },
};
