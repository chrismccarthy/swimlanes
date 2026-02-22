import styles from './ResizeHandle.module.css';

interface ResizeHandleProps {
  side: 'left' | 'right';
  onPointerDown: (e: React.PointerEvent) => void;
}

export function ResizeHandle({ side, onPointerDown }: ResizeHandleProps) {
  return (
    <div
      className={`${styles.handle} ${styles[side]}`}
      onPointerDown={onPointerDown}
    />
  );
}
