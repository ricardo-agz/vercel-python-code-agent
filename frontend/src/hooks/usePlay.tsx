import { useCallback, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../constants';
import { useAuth } from '../context/AuthContext';

export type PlayStatus = 'idle' | 'starting' | 'running' | 'error' | 'done';

type PlayEvent = {
  event_type: string;
  data?: unknown;
  error?: string;
};

type StartArgs = {
  userId: string;
  project: Record<string, string>;
  entryPath: string;
  runtime?: string | null;
  env?: Record<string, string>;
};

export function usePlay() {
  const { isAuthenticated, openModal } = useAuth();
  const [status, setStatus] = useState<PlayStatus>('idle');
  const [logs, setLogs] = useState<string>('');
  const sourceRef = useRef<EventSource | null>(null);
  const [playId, setPlayId] = useState<string | null>(null);
  const [streamToken, setStreamToken] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(null);

  const apiOrigin = useMemo(() => {
    try {
      const url = new URL(API_BASE);
      const trimmed = API_BASE.replace(/\/?$/,'');
      return trimmed.endsWith('/api') ? trimmed.slice(0, -4) : url.origin;
    } catch {
      return API_BASE.replace(/\/?$/,'').replace(/\/api$/, '');
    }
  }, []);

  const clear = useCallback(() => setLogs(''), []);

  const start = useCallback(async (args: StartArgs) => {
    if (!isAuthenticated) {
      openModal();
      return;
    }
    // Cooldown: if we just stopped a session, wait a bit to avoid race with sandbox teardown
    if (status === 'done' || status === 'error') {
      await new Promise((r) => setTimeout(r, 150));
    }
    if (sourceRef.current) {
      try { sourceRef.current.close(); } catch { /* noop */ }
      sourceRef.current = null;
    }
    setLogs('');
    setStatus('starting');
    setPreviewUrl(null);
    setSandboxId(null);

    const res = await fetch(`${API_BASE}/play`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: args.userId,
        project: args.project,
        entry_path: args.entryPath,
        runtime: args.runtime ?? null,
        env: args.env ?? {},
      }),
    });

    if (!res.ok) {
      setStatus('error');
      setLogs((prev) => prev + `\nFailed to start play run.`);
      return;
    }

    const { task_id, stream_token } = await res.json();
    setPlayId(task_id);
    setStreamToken(stream_token);
    const url = `${apiOrigin}/api/play/${encodeURIComponent(task_id)}/events?token=${encodeURIComponent(stream_token)}`;
    const es = new EventSource(url);
    sourceRef.current = es;

    es.onmessage = (evt) => {
      try {
        const ev = JSON.parse(evt.data) as PlayEvent;
        switch (ev.event_type) {
          case 'play_started': {
            const runtime = (ev.data as { runtime?: string } | undefined)?.runtime ?? 'auto';
            setLogs((prev) => prev + `Started (runtime: ${runtime})\n`);
            setStatus('running');
            break;
          }
          case 'play_sandbox': {
            const sid = (ev.data as { sandbox_id?: string } | undefined)?.sandbox_id ?? null;
            if (sid) setSandboxId(sid);
            break;
          }
          case 'play_preview': {
            const p = (ev.data as { url?: string } | undefined)?.url;
            if (p) setPreviewUrl(p);
            setLogs((prev) => prev + (p ? `Preview available at: ${p}\n` : ''));
            break;
          }
          case 'play_log': {
            const d = ev.data;
            const text = typeof d === 'string' ? d : (d != null ? String(d) : '');
            setLogs((prev) => prev + text);
            break;
          }
          case 'play_complete': {
            const exitCode = (ev.data as { exit_code?: number } | undefined)?.exit_code;
            setLogs((prev) => prev + `\n[completed] exit=${exitCode}\n`);
            setStatus('done');
            try { es.close(); } catch { /* noop */ }
            sourceRef.current = null;
            setPlayId(null);
            setStreamToken(null);
            setSandboxId(null);
            break;
          }
          case 'play_failed': {
            setLogs((prev) => prev + `\n[error] ${ev.error ?? 'failed'}\n`);
            setStatus('error');
            try { es.close(); } catch { /* noop */ }
            sourceRef.current = null;
            setPlayId(null);
            setStreamToken(null);
            setSandboxId(null);
            break;
          }
          default:
            break;
        }
      } catch {
        // non-JSON messages; ignore
      }
    };
    es.onerror = () => {
      setStatus('error');
      try { es.close(); } catch { /* noop */ }
      sourceRef.current = null;
      setPlayId(null);
      setStreamToken(null);
      setSandboxId(null);
    };
  }, [apiOrigin, status, isAuthenticated, openModal]);

  const stop = useCallback(async () => {
    const es = sourceRef.current;
    if (es) {
      try { es.close(); } catch { /* noop */ }
      sourceRef.current = null;
    }
    // Best-effort stop on backend if we have id/token
    if (playId && streamToken && sandboxId) {
      try {
        const params = new URLSearchParams({ token: streamToken, sandbox_id: sandboxId });
        const resp = await fetch(`${apiOrigin}/api/play/${encodeURIComponent(playId)}?${params.toString()}`, { method: 'DELETE' });
        if (resp.ok) {
          setLogs((prev) => prev + `\n[stopped] sandbox stopped\n`);
        } else {
          setLogs((prev) => prev + `\n[stop] failed to stop (status ${resp.status})\n`);
        }
      } catch {
        // ignore network errors on stop
      }
    }
    setStatus('done');
    setPlayId(null);
    setStreamToken(null);
    setSandboxId(null);
  }, [apiOrigin, playId, streamToken, sandboxId]);

  const openPreview = useCallback(() => {
    if (previewUrl) {
      try { window.open(previewUrl, '_blank', 'noopener,noreferrer'); } catch { /* noop */ }
    }
  }, [previewUrl]);

  return { status, logs, start, stop, clear, previewUrl, openPreview, playId, sandboxId } as const;
}


