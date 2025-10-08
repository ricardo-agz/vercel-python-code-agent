const env = import.meta.env;

export const API_BASE = env.VITE_API_BASE_URL || 'http://localhost:8081/api';
