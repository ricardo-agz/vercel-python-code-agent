declare const process: { env: Record<string, string | undefined> }
const env = process.env;

export const API_BASE = env.NEXT_PUBLIC_API_URL || env.NEXT_PUBLIC_API_BASE_URL || '/api';
