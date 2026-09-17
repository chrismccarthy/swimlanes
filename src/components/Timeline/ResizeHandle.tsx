import styles from './ResizeHandle.module.css';

interface ResizeHandleProps {
  side: 'left' | 'right';
  /** Hit-area width in px — narrowed at zoomed-out levels so it cannot eat the block */
  width?: number;
  onPointerDown: (e: React.PointerEvent) => void;
}

export function ResizeHandle({ side, width, onPointerDown }: ResizeHandleProps) {
  return (
    <div
      className={`${styles.handle} ${styles[side]}`}
      data-testid={`resize-${side}`}
      style={width === undefined ? undefined : { width }}
      onPointerDown={onPointerDown}
    />
  );
}
