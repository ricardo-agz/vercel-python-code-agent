import React from 'react';
import { Loader, X, Check } from 'lucide-react';

interface ExecRequestPromptProps {
  visible: boolean;
  executing: boolean;
  executionAction: 'accept' | 'reject' | null;
  onAccept: () => void;
  onReject: () => void;
}

export const ExecRequestPrompt: React.FC<ExecRequestPromptProps> = ({
  visible,
  executing,
  executionAction,
  onAccept,
  onReject,
}) => {
  if (!visible) return null;

  return (
    <div className="p-4 border-t border-gray-700 flex flex-col gap-2">
      <p className="text-sm text-gray-200">The agent requests to execute the code.</p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onReject}
          disabled={executing}
          className="px-3 py-2 rounded bg-red-600 hover:bg-red-700 disabled:opacity-50 flex items-center justify-center"
        >
          {executing && executionAction === 'reject' ? (
            <Loader className="w-4 h-4 animate-spin" />
          ) : (
            <X className="w-4 h-4" />
          )}
        </button>
        <button
          onClick={onAccept}
          disabled={executing}
          className="px-3 py-2 rounded bg-green-600 hover:bg-green-700 disabled:opacity-50 flex items-center justify-center"
        >
          {executing && executionAction === 'accept' ? (
            <Loader className="w-4 h-4 animate-spin" />
          ) : (
            <Check className="w-4 h-4" />
          )}
        </button>
      </div>
    </div>
  );
};


