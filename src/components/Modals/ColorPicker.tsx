import type { BlockColor } from '../../types';
import { BLOCK_COLORS, ALL_COLORS } from '../../lib/colors';
import styles from './ColorPicker.module.css';

interface ColorPickerProps {
  value: BlockColor;
  onChange: (color: BlockColor) => void;
}

export function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className={styles.picker}>
      {ALL_COLORS.map(color => (
        <button
          key={color}
          type="button"
          className={`${styles.swatch} ${color === value ? styles.selected : ''}`}
          style={{
            backgroundColor: BLOCK_COLORS[color].bg,
            borderColor: BLOCK_COLORS[color].border,
          }}
          onClick={() => onChange(color)}
          title={color}
        />
      ))}
    </div>
  );
}
