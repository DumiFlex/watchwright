export interface ErrorBody {
  error: { code: string; message: string; detail?: unknown };
}

export function errorBody(code: string, message: string, detail?: unknown): ErrorBody {
  return { error: detail === undefined ? { code, message } : { code, message, detail } };
}
