const env = import.meta.env;

export const API_BASE = env.VITE_API_BASE_URL || 'http://localhost:8081/api';
// Endpoints:
// - POST `${API_BASE}/runs` → { task_id, stream_token }
// - GET `${origin}/api/runs/{task_id}/events?token=...` (SSE)
// - GET `${origin}/api/runs/{task_id}/resume?token=...&result=...` (SSE)