import { useCallback, useRef, useState } from 'react';

export interface ResizableColumnsState {
  leftWidth: number;
  rightWidth: number;
  resultRightWidth: number;
  inputHeight: number;
  bottomTerminalHeight: number;
  setLeftWidth: (n: number) => void;
  setRightWidth: (n: number) => void;
  setResultRightWidth: (n: number) => void;
  setInputHeight: (n: number) => void;
  setBottomTerminalHeight: (n: number) => void;
  /** Mouse-down handler for left/right/input column splitters. */
  startColumnResize: (
    which: 'left' | 'right' | 'resultRight' | 'input',
    clamp?: { min?: number; max?: number },
  ) => (e: React.MouseEvent) => void;
  /** Pointer-down handler for the bottom terminal drag strip.
   * Optional `clamp` lets callers cap the height (e.g. workspace
   * caps at 520px so the terminal never eats the whole viewport). */
  startBottomTerminalResize: (
    e: React.MouseEvent,
    clamp?: { min?: number; max?: number }
  ) => void;
}

const LS_KEY = 'biof3-pw-cols';

interface StoredDims {
  leftWidth?: number;
  rightWidth?: number;
  resultRightWidth?: number;
  inputHeight?: number;
  bottomTerminalHeight?: number;
}

const DEFAULTS = {
  leftWidth: 240,
  rightWidth: 340,
  resultRightWidth: 720,
  inputHeight: 120,
  bottomTerminalHeight: 240,
};

function loadDims(initial: Partial<{
  leftWidth: number; rightWidth: number; resultRightWidth: number; inputHeight: number; bottomTerminalHeight: number;
}> = {}): StoredDims {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw), ...initial };
  } catch {}
  return { ...DEFAULTS, ...initial };
}

function saveDims(dims: StoredDims): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(dims)); } catch {}
}

const MIN_LEFT_WIDTH = 96;
const MIN_RIGHT_WIDTH = 96;
const MIN_RESULT_RIGHT_WIDTH = 360;
const MIN_INPUT_HEIGHT = 48;
const RESIZING_CLASS = 'biof3-resizing-columns';

function setResizingClass(active: boolean): void {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle(RESIZING_CLASS, active);
}

/**
 * Encapsulates drag-to-resize state for the three-column layout + the
 * bottom-docked terminal. Dimensions persist to localStorage automatically.
 */
export function useResizableColumns(
  initial: Partial<{
    leftWidth: number;
    rightWidth: number;
    resultRightWidth: number;
    inputHeight: number;
    bottomTerminalHeight: number;
  }> = {},
): ResizableColumnsState {
  const init = loadDims(initial);

  const [leftWidth, _setLeftWidth] = useState(init.leftWidth ?? DEFAULTS.leftWidth);
  const [rightWidth, _setRightWidth] = useState(init.rightWidth ?? DEFAULTS.rightWidth);
  const [resultRightWidth, _setResultRightWidth] = useState(
    init.resultRightWidth ?? DEFAULTS.resultRightWidth,
  );
  const [inputHeight, _setInputHeight] = useState(init.inputHeight ?? DEFAULTS.inputHeight);
  const [bottomTerminalHeight, _setBottomTerminalHeight] = useState(
    init.bottomTerminalHeight ?? DEFAULTS.bottomTerminalHeight,
  );

  // Keep a mutable ref so drag handlers always see the latest values without
  // needing to recreate the closures on every render.
  const dims = useRef({ leftWidth, rightWidth, resultRightWidth, inputHeight, bottomTerminalHeight });
  dims.current = { leftWidth, rightWidth, resultRightWidth, inputHeight, bottomTerminalHeight };
  const dragState = useRef<{ active: boolean; cleanup: null | (() => void) }>({
    active: false,
    cleanup: null,
  });

  // Wrap every setter to persist the new value into localStorage atomically.
  const setLeftWidth = useCallback((n: number) => {
    _setLeftWidth(n);
    dims.current.leftWidth = n;
    const d = dims.current;
    saveDims({ leftWidth: d.leftWidth, rightWidth: d.rightWidth, resultRightWidth: d.resultRightWidth, inputHeight: d.inputHeight, bottomTerminalHeight: d.bottomTerminalHeight });
  }, []);

  const setRightWidth = useCallback((n: number) => {
    _setRightWidth(n);
    dims.current.rightWidth = n;
    const d = dims.current;
    saveDims({ leftWidth: d.leftWidth, rightWidth: d.rightWidth, resultRightWidth: d.resultRightWidth, inputHeight: d.inputHeight, bottomTerminalHeight: d.bottomTerminalHeight });
  }, []);

  const setResultRightWidth = useCallback((n: number) => {
    _setResultRightWidth(n);
    dims.current.resultRightWidth = n;
    const d = dims.current;
    saveDims({ leftWidth: d.leftWidth, rightWidth: d.rightWidth, resultRightWidth: d.resultRightWidth, inputHeight: d.inputHeight, bottomTerminalHeight: d.bottomTerminalHeight });
  }, []);

  const setInputHeight = useCallback((n: number) => {
    _setInputHeight(n);
    dims.current.inputHeight = n;
    const d = dims.current;
    saveDims({ leftWidth: d.leftWidth, rightWidth: d.rightWidth, resultRightWidth: d.resultRightWidth, inputHeight: d.inputHeight, bottomTerminalHeight: d.bottomTerminalHeight });
  }, []);

  const setBottomTerminalHeight = useCallback((n: number) => {
    _setBottomTerminalHeight(n);
    dims.current.bottomTerminalHeight = n;
    const d = dims.current;
    saveDims({ leftWidth: d.leftWidth, rightWidth: d.rightWidth, resultRightWidth: d.resultRightWidth, inputHeight: d.inputHeight, bottomTerminalHeight: d.bottomTerminalHeight });
  }, []);

  const startColumnResize = useCallback(
    (
      which: 'left' | 'right' | 'resultRight' | 'input',
      clamp: { min?: number; max?: number } = {},
    ) => (e: React.MouseEvent) => {
      e.preventDefault();
      setResizingClass(true);
      dragState.current.active = true;
      const startX = e.clientX;
      const startY = e.clientY;
      const { leftWidth: sl, rightWidth: sr, resultRightWidth: srr, inputHeight: si } = dims.current;
      let pendingResultRightWidth = srr;
      let resultResizeFrame: number | null = null;

      const cleanup = () => {
        if (which === 'resultRight') {
          if (resultResizeFrame !== null) {
            window.cancelAnimationFrame(resultResizeFrame);
            resultResizeFrame = null;
          }
          setResultRightWidth(pendingResultRightWidth);
          window.requestAnimationFrame(() => {
            document.documentElement.style.removeProperty('--biof3-live-result-right-width');
          });
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setResizingClass(false);
        dragState.current.active = false;
        dragState.current.cleanup = null;
      };

      const onMove = (ev: MouseEvent) => {
        if (dragState.current.active && (ev.buttons & 1) === 0) {
          cleanup();
          return;
        }
        if (which === 'left') {
          setLeftWidth(Math.max(MIN_LEFT_WIDTH, sl + ev.clientX - startX));
        } else if (which === 'right') {
          setRightWidth(Math.max(MIN_RIGHT_WIDTH, sr - (ev.clientX - startX)));
        } else if (which === 'resultRight') {
          pendingResultRightWidth = Math.min(
            clamp.max ?? Number.POSITIVE_INFINITY,
            Math.max(
              clamp.min ?? MIN_RESULT_RIGHT_WIDTH,
              srr - (ev.clientX - startX),
            ),
          );
          if (resultResizeFrame === null) {
            resultResizeFrame = window.requestAnimationFrame(() => {
              resultResizeFrame = null;
              document.documentElement.style.setProperty(
                '--biof3-live-result-right-width',
                `${pendingResultRightWidth}px`,
              );
            });
          }
        } else if (which === 'input') {
          setInputHeight(Math.max(MIN_INPUT_HEIGHT, si - (ev.clientY - startY)));
        }
      };
      const onUp = () => {
        cleanup();
      };
      dragState.current.cleanup = cleanup;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      window.addEventListener('blur', onUp);
      document.body.style.cursor = which === 'input' ? 'ns-resize' : 'ew-resize';
      document.body.style.userSelect = 'none';
    },
    [setInputHeight, setLeftWidth, setResultRightWidth, setRightWidth],
  );

  const startBottomTerminalResize = useCallback(
    (e: React.MouseEvent, clamp: { min?: number; max?: number } = {}) => {
      e.preventDefault();
      setResizingClass(true);
      dragState.current.active = true;
      const startY = e.clientY;
      const startHeight = dims.current.bottomTerminalHeight;
      const minHeight = clamp.min ?? 120;
      const maxHeight = clamp.max ?? 1_000_000;

      const cleanup = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        window.removeEventListener('blur', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setResizingClass(false);
        dragState.current.active = false;
        dragState.current.cleanup = null;
      };

      const onMove = (ev: MouseEvent) => {
        if (dragState.current.active && (ev.buttons & 1) === 0) {
          cleanup();
          return;
        }
        const next = Math.min(
          maxHeight,
          Math.max(minHeight, startHeight - (ev.clientY - startY)),
        );
        setBottomTerminalHeight(next);
      };
      const onUp = () => {
        cleanup();
      };
      dragState.current.cleanup = cleanup;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      window.addEventListener('blur', onUp);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    },
    [setBottomTerminalHeight],
  );

  return {
    leftWidth,
    rightWidth,
    resultRightWidth,
    inputHeight,
    bottomTerminalHeight,
    setLeftWidth,
    setRightWidth,
    setResultRightWidth,
    setInputHeight,
    setBottomTerminalHeight,
    startColumnResize,
    startBottomTerminalResize,
  };
}
