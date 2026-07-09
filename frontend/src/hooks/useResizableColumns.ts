import { useCallback, useRef, useState } from 'react';

export interface ResizableColumnsState {
  leftWidth: number;
  rightWidth: number;
  inputHeight: number;
  bottomTerminalHeight: number;
  setLeftWidth: (n: number) => void;
  setRightWidth: (n: number) => void;
  setInputHeight: (n: number) => void;
  setBottomTerminalHeight: (n: number) => void;
  /** Mouse-down handler for left/right/input column splitters. */
  startColumnResize: (which: 'left' | 'right' | 'input') => (e: React.MouseEvent) => void;
  /** Pointer-down handler for the bottom terminal drag strip. */
  startBottomTerminalResize: (e: React.MouseEvent) => void;
}

const MIN_LEFT_WIDTH = 96;
const MIN_RIGHT_WIDTH = 96;
const MIN_INPUT_HEIGHT = 48;

/**
 * Encapsulates drag-to-resize state for the three-column layout + the
 * bottom-docked terminal. Returns a stable contract that panel components
 * can wire directly to their splitter divs.
 */
export function useResizableColumns(
  initial: Partial<{
    leftWidth: number;
    rightWidth: number;
    inputHeight: number;
    bottomTerminalHeight: number;
  }> = {},
): ResizableColumnsState {
  const [leftWidth, setLeftWidth] = useState(initial.leftWidth ?? 240);
  const [rightWidth, setRightWidth] = useState(initial.rightWidth ?? 340);
  const [inputHeight, setInputHeight] = useState(initial.inputHeight ?? 120);
  const [bottomTerminalHeight, setBottomTerminalHeight] = useState(
    initial.bottomTerminalHeight ?? 240,
  );

  // Mirror state in refs so the drag handlers always see the latest values
  // without re-creating on every render.
  const dims = useRef({ leftWidth, rightWidth, inputHeight, bottomTerminalHeight });
  dims.current = { leftWidth, rightWidth, inputHeight, bottomTerminalHeight };

  const startColumnResize = useCallback(
    (which: 'left' | 'right' | 'input') => (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const { leftWidth: sl, rightWidth: sr, inputHeight: si } = dims.current;

      const onMove = (ev: MouseEvent) => {
        if (which === 'left') {
          setLeftWidth(Math.max(MIN_LEFT_WIDTH, sl + ev.clientX - startX));
        } else if (which === 'right') {
          setRightWidth(Math.max(MIN_RIGHT_WIDTH, sr - (ev.clientX - startX)));
        } else if (which === 'input') {
          setInputHeight(Math.max(MIN_INPUT_HEIGHT, si - (ev.clientY - startY)));
        }
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.cursor = which === 'input' ? 'ns-resize' : 'ew-resize';
      document.body.style.userSelect = 'none';
    },
    [],
  );

  const startBottomTerminalResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = dims.current.bottomTerminalHeight;

    const onMove = (ev: MouseEvent) => {
      setBottomTerminalHeight(Math.max(120, startHeight - (ev.clientY - startY)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
  }, []);

  return {
    leftWidth,
    rightWidth,
    inputHeight,
    bottomTerminalHeight,
    setLeftWidth,
    setRightWidth,
    setInputHeight,
    setBottomTerminalHeight,
    startColumnResize,
    startBottomTerminalResize,
  };
}