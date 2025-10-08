import React from 'react';
import { useAuth } from '../context/AuthContext';

type StatusBarProps = {
  line: number;
  column: number;
  language: string;
};

export const StatusBar: React.FC<StatusBarProps> = ({ line, column, language }) => {
  const { openModal, isAuthenticated, user, openAccountMenu } = useAuth();

  const prettyLanguage = React.useMemo(() => {
    if (!language) return 'Plain Text';
    const map: Record<string, string> = {
      plaintext: 'Plain Text',
      typescript: 'TypeScript',
      javascript: 'JavaScript',
      json: 'JSON',
      css: 'CSS',
      html: 'HTML',
      markdown: 'Markdown',
      python: 'Python',
      go: 'Go',
      rust: 'Rust',
      java: 'Java',
      ruby: 'Ruby',
      php: 'PHP',
      shell: 'Shell',
      yaml: 'YAML',
      toml: 'TOML',
      c: 'C',
      cpp: 'C++',
      csharp: 'C#',
      kotlin: 'Kotlin',
      swift: 'Swift',
      sql: 'SQL',
    };
    return map[language] || (language[0]?.toUpperCase() + language.slice(1));
  }, [language]);

  const handleClick = React.useCallback(() => {
    if (isAuthenticated) openAccountMenu(); else openModal();
  }, [isAuthenticated, openAccountMenu, openModal]);

  const buttonBg = isAuthenticated ? '#3b82f6' /* blue-500 */ : '#f59e0b' /* amber-500 */;

  return (
    <div
      className="fixed inset-x-0 flex items-center justify-between text-xs"
      style={{
        bottom: 0,
        height: 'var(--statusbar-height)',
        backgroundColor: 'var(--vscode-panel)',
        borderTop: '1px solid var(--vscode-panel-border)',
        color: 'var(--vscode-text)',
        zIndex: 100000,
        overflow: 'hidden',
      }}
      role="status"
      aria-label="Editor status bar"
    >
      <div className="flex items-center">
        <button
          type="button"
          id="vercel-status-button"
          onClick={handleClick}
          className="inline-flex items-center justify-center cursor-pointer relative"
          title={isAuthenticated ? (user?.username ? `Signed in as @${user.username}` : 'Signed in') : 'Sign in with Vercel'}
          aria-label={isAuthenticated ? 'Account' : 'Sign in with Vercel'}
          style={{
            background: buttonBg,
            color: '#ffffff',
            height: 'var(--statusbar-height)',
            padding: '0 16px',
            border: 'none',
            borderRadius: 0,
            appearance: 'none',
            WebkitAppearance: 'none',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 76 65" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="block">
            <path d="M37.59 0L75.18 65H0z" fill="#ffffff" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-4 mr-4">
        <div title="Language" aria-label="Language">
          {prettyLanguage}
        </div>
        <div title={`Line ${line}, Column ${column}`} aria-label="Cursor position">
          Ln {line}, Col {column}
        </div>
      </div>
    </div>
  );
};

export default StatusBar;


