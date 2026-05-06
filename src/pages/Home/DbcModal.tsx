import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type ReactElement,
} from 'react';
import { motion } from 'motion/react';
import { Card } from '../../primitives/Card/Card';
import { Button } from '../../primitives/Button/Button';
import { useModalA11y } from './useModalA11y';
import styles from './DbcModal.module.css';

/*
 * DbcModal — interactive flow lifted from Protfo/index.html
 * (#dbcModal). Four steps:
 *   1. Pick theme & install (two icloud shortcut links)
 *   2. Drop / pick an image
 *   3. Copy the resulting base64 data URL
 *   4. Paste into the Shortcut
 *
 * Visual layout: mono index column (01/02/03/04) on the left, content
 * column on the right. No accent color, no arrow glyphs — hierarchy
 * comes from type-size jumps, vertical rhythm, and a single hairline
 * between groups. See project_personal_brand.md §"readability without
 * color" for the rationale.
 */

interface DbcModalProps {
  onClose: () => void;
}

const SHORTCUT_DARK = 'https://www.icloud.com/shortcuts/a9389cdd28624595848a3b978c6f049e';
const SHORTCUT_LIGHT = 'https://www.icloud.com/shortcuts/8ef8349704fa49ecb0b293131a7e0265';

export function DbcModal({ onClose }: DbcModalProps): ReactElement {
  const [base64, setBase64] = useState<string | null>(null);
  const [statusText, setStatusText] = useState('Waiting for image…');
  const [copied, setCopied] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const shellRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useModalA11y(shellRef, onClose);

  const handleFile = (file: File | undefined): void => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      setStatusText('Only PNG or JPG supported');
      setBase64(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = typeof e.target?.result === 'string' ? e.target.result : null;
      if (!result) return;
      setBase64(result);
      const sizeKb = Math.round(file.size / 1024);
      const sizeText = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb} KB`;
      setStatusText(`Converted · ${sizeText}`);
      setCopied(false);
    };
    reader.readAsDataURL(file);
  };

  const onInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    handleFile(e.target.files?.[0]);
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>): void => {
    e.preventDefault();
    setIsDragging(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const onCopy = async (): Promise<void> => {
    if (!base64) return;
    try {
      await navigator.clipboard.writeText(base64);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setStatusText('Clipboard not available');
    }
  };

  return (
    <motion.div
      className={styles.overlay}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
    >
      <motion.div
        ref={shellRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.cardWrap}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 4 }}
        transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      >
        <Card variant="l2" className={styles.card}>
          <Card.Head>
            <span id={titleId} className={styles.title}>Make Your Card</span>
            <span className={styles.privacy}>runs locally · your image never leaves your device</span>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label="Close"
            >
              esc
            </button>
          </Card.Head>

          <Step number={1} label="Pick a theme & install">
            <div className={styles.themeRow}>
              <Button
                variant="primary"
                onClick={() => window.open(SHORTCUT_DARK, '_blank', 'noopener,noreferrer')}
              >
                Dark Theme
              </Button>
              <Button
                variant="ghost"
                onClick={() => window.open(SHORTCUT_LIGHT, '_blank', 'noopener,noreferrer')}
              >
                Light Theme
              </Button>
            </div>
          </Step>

          <Step number={2} label="Drop a background or logo image">
            <label
              className={`${styles.dropzone} ${isDragging ? styles.dropzoneActive : ''}`}
              htmlFor="dbcFileInput"
              tabIndex={0}
              onDragEnter={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
            >
              <input
                id="dbcFileInput"
                type="file"
                accept="image/png,image/jpeg"
                onChange={onInputChange}
                hidden
              />
              <span className={styles.dropzoneText}>
                Drag image here or click to select
              </span>
              <span className={styles.dropzoneHint}>
                Background 1290 × 2590 · Logo square · PNG / JPG
              </span>
            </label>
          </Step>

          <Step number={3} label="Copy the Base64" disabled={!base64}>
            <div className={styles.result}>
              <span
                className={`${styles.resultStatus} ${base64 ? styles.resultStatusReady : ''}`}
              >
                {statusText}
              </span>
              <Button
                variant="primary"
                disabled={!base64}
                onClick={onCopy}
              >
                {copied ? 'Copied' : 'Copy Base64'}
              </Button>
            </div>
            <p className={styles.resultHint}>
              auto-prepends the correct <code>data:image/...</code> prefix
            </p>
          </Step>

          <Step number={4} label="Paste into the Shortcut">
            <p className={styles.stepText}>
              Open the Shortcut → tap <b>Edit</b> → find the comment for{' '}
              <b>Logo</b> or <b>Background</b>, then paste into the text box
              right below it.
            </p>
          </Step>

          <Card.Meta>
            need fonts, layout, or full design spec?{' '}
            <a
              className={styles.footerLink}
              href="https://github.com/sewon-p/digital-business-card"
              target="_blank"
              rel="noopener noreferrer"
            >
              view detailed guide on github
            </a>
          </Card.Meta>
        </Card>
      </motion.div>
    </motion.div>
  );
}

interface StepProps {
  number: number;
  label: string;
  disabled?: boolean;
  children: ReactElement | ReactElement[];
}

function Step({ number, label, disabled = false, children }: StepProps): ReactElement {
  // zero-padded mono prefix sits in its own column at full type
  // hierarchy weight. children rendered in the body column at the
  // same indent. one hairline between groups, set on the wrapper.
  const padded = String(number).padStart(2, '0');
  return (
    <div className={`${styles.step} ${disabled ? styles.stepDisabled : ''}`}>
      <span className={styles.stepNum} aria-hidden="true">{padded}</span>
      <div className={styles.stepBody}>
        <p className={styles.stepLede}>{label}</p>
        <div className={styles.stepContent}>{children}</div>
      </div>
    </div>
  );
}
