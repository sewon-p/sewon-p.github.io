import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

type Variant = 'primary' | 'ghost' | 'pill';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({
  variant = 'ghost',
  size = 'md',
  children,
  className = '',
  ...rest
}: ButtonProps) {
  const sizeClass = size === 'md' ? '' : styles[size];
  return (
    <button
      type="button"
      className={`${styles.button} ${styles[variant]} ${sizeClass} ${className}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}
