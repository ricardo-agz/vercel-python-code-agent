const env = import.meta.env;

// Prefer explicit VITE_API_URL, fall back to VITE_API_BASE_URL, then default to '/api' for dev proxy
export const API_BASE = env.VITE_API_URL || env.VITE_API_BASE_URL || '/api';
// Endpoints:
// - POST `${API_BASE}/runs` → { task_id, stream_token }
// - GET `${origin}/api/runs/{task_id}/events?token=...` (SSE)
// - GET `${origin}/api/runs/{task_id}/resume?token=...&result=...` (SSE)