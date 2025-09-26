import React from 'react';

interface ThreePaneProps {
  left: React.ReactNode;
  center: React.ReactNode;
  right: React.ReactNode;
  initialLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
  initialRightWidth?: number;
  minRightWidth?: number;
  maxRightWidth?: number;
}

export const ThreePane: React.FC<ThreePaneProps> = ({
  left,
  center,
  right,
  initialLeftWidth = 260,
  minLeftWidth = 200,
  maxLeftWidth = 420,
  initialRightWidth = 420,
  minRightWidth = 320,
  maxRightWidth = 720,
}) => {
  const [leftWidth, setLeftWidth] = React.useState(initialLeftWidth);
  const [rightWidth, setRightWidth] = React.useState(initialRightWidth);
  const [resizing, setResizing] = React.useState<'left' | 'right' | null>(null);

  const onMouseDownLeft = React.useCallback((e: React.MouseEvent) => {
    setResizing('left');
    e.preventDefault();
  }, []);
  const onMouseDownRight = React.useCallback((e: React.MouseEvent) => {
    setResizing('right');
    e.preventDefault();
  }, []);

  const onMouseMove = React.useCallback((e: MouseEvent) => {
    if (resizing === 'left') {
      const newWidth = Math.min(Math.max(e.clientX, minLeftWidth), maxLeftWidth);
      setLeftWidth(newWidth);
    } else if (resizing === 'right') {
      const newWidth = Math.min(
        Math.max(window.innerWidth - e.clientX, minRightWidth),
        maxRightWidth,
      );
      setRightWidth(newWidth);
    }
  }, [resizing, minLeftWidth, maxLeftWidth, minRightWidth, maxRightWidth]);

  const onMouseUp = React.useCallback(() => {
    setResizing(null);
  }, []);

  React.useEffect(() => {
    if (resizing) {
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizing, onMouseMove, onMouseUp]);

  return (
    <div className="h-screen w-screen flex" style={{ backgroundColor: 'var(--vscode-bg)' }}>
      <div className="flex flex-col" style={{ width: `${leftWidth}px`, backgroundColor: 'var(--vscode-sidebar)', borderRight: '1px solid var(--vscode-panel-border)' }}>
        {left}
      </div>
      <div onMouseDown={onMouseDownLeft} className={`w-1 cursor-col-resize transition-colors ${resizing === 'left' ? '' : 'hover:bg-blue-500'}`} style={{ backgroundColor: resizing === 'left' ? 'var(--vscode-accent)' : 'var(--vscode-panel-border)' }} />
      <div className="flex-1 flex flex-col" style={{ minWidth: 0, minHeight: 0 }}>
        {center}
      </div>
      <div onMouseDown={onMouseDownRight} className={`w-1 cursor-col-resize transition-colors ${resizing === 'right' ? '' : 'hover:bg-blue-500'}`} style={{ backgroundColor: resizing === 'right' ? 'var(--vscode-accent)' : 'var(--vscode-panel-border)' }} />
      <div className="flex flex-col" style={{ width: `${rightWidth}px`, backgroundColor: 'var(--vscode-sidebar)', borderLeft: '1px solid var(--vscode-panel-border)' }}>
        {right}
      </div>
    </div>
  );
};

export default ThreePane;


