import React from 'react';
import { Loader, Send, X } from 'lucide-react';

interface ChatInputProps {
  value: string;
  onChange: (next: string) => void;
  onSend: () => void | Promise<void>;
  sendDisabled: boolean;
  showCancel: boolean;
  onCancel: () => void;
  cancelling: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  value,
  onChange,
  onSend,
  sendDisabled,
  showCancel,
  onCancel,
  cancelling,
}) => {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  const adjustTextareaHeight = React.useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
  }, []);

  React.useEffect(() => {
    adjustTextareaHeight();
  }, [value, adjustTextareaHeight]);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="p-4" style={{ borderTop: '1px solid var(--vscode-panel-border)', background: 'var(--vscode-sidebar)' }}>
      <div className="flex gap-2 items-end">
        <textarea
          ref={textareaRef}
          rows={2}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            adjustTextareaHeight();
          }}
          onKeyDown={handleKeyPress}
          placeholder="Plan, search, build anything"
          disabled={sendDisabled}
          className="flex-1 resize-none rounded-sm px-3 py-2 placeholder-gray-400 focus:outline-none disabled:opacity-50"
          style={{
            backgroundColor: 'var(--vscode-contrast)',
            border: '1px solid var(--vscode-panel-border)',
            color: 'var(--vscode-text)',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontSize: '14px',
            overflow: 'hidden',
          }}
        />
        {!sendDisabled && (
          <button
            onClick={() => onSend()}
            disabled={!value.trim()}
            className="w-8 h-8 rounded-sm disabled:opacity-50 flex-shrink-0 flex items-center justify-center cursor-pointer"
            style={{ background: 'var(--vscode-accent)', color: '#ffffff' }}
            title="Send message"
          >
            <Send className="w-4 h-4" />
          </button>
        )}
        {sendDisabled && showCancel && (
          <button
            onClick={onCancel}
            disabled={cancelling}
            className="w-8 h-8 flex items-center justify-center rounded-sm disabled:opacity-50 flex-shrink-0 cursor-pointer disabled:cursor-not-allowed"
            style={{ background: 'var(--vscode-danger)', color: '#ffffff' }}
            title="Cancel current task"
          >
            {cancelling ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <X className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );
};


