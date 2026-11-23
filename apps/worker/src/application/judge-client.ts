export interface JudgeRequest {
  model: string;
  temperature?: number;
  system: string;
  user: string;
}

export interface JudgeCallResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface JudgeClient {
  evaluate(input: JudgeRequest): Promise<JudgeCallResult>;
}
