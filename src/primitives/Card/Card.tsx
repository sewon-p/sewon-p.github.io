import type { CSSProperties, ReactNode } from 'react';
import styles from './Card.module.css';

/*
 * Card primitive.
 *
 * Two patterns supported:
 *
 * 1. Composable. Children-only:
 *      <Card variant="l2"><Card.Title>...</Card.Title>...</Card>
 *    Children compose freely with the dotted slots below.
 *
 * 2. Shorthand: pass title/body/meta props for simple three-line cards.
 */

type Variant = 'l1' | 'l2';

interface CardProps {
  variant?: Variant;
  /** title prop — renders <Card.Title> */
  title?: string;
  /** body prop — renders <Card.Body> */
  body?: string;
  /** meta prop — renders <Card.Meta> */
  meta?: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Card({
  variant = 'l2',
  title,
  body,
  meta,
  children,
  className = '',
  style,
}: CardProps) {
  const classes = `${styles.card} ${styles[variant]} ${className}`.trim();
  return (
    <article className={classes} style={style}>
      {title ? <h3 className={styles.title}>{title}</h3> : null}
      {body ? <p className={styles.body}>{body}</p> : null}
      {children}
      {meta ? <p className={styles.meta}>{meta}</p> : null}
    </article>
  );
}

/* ── slots: composable building blocks ─────────────────────── */

interface SlotProps {
  children: ReactNode;
  className?: string;
}

/** mono uppercase label — small kicker above a title */
Card.Kicker = function CardKicker({ children, className = '' }: SlotProps) {
  return <span className={`${styles.kicker} ${className}`.trim()}>{children}</span>;
};

/** primary heading inside a card */
Card.Title = function CardTitle({ children, className = '' }: SlotProps) {
  return <h3 className={`${styles.title} ${className}`.trim()}>{children}</h3>;
};

/** body paragraph */
Card.Body = function CardBody({ children, className = '' }: SlotProps) {
  return <p className={`${styles.body} ${className}`.trim()}>{children}</p>;
};

/** mono caption / metadata */
Card.Meta = function CardMeta({ children, className = '' }: SlotProps) {
  return <p className={`${styles.meta} ${className}`.trim()}>{children}</p>;
};

/** unordered list with → tint bullet markers */
Card.Points = function CardPoints({
  children,
  className = '',
}: SlotProps) {
  return <ul className={`${styles.points} ${className}`.trim()}>{children}</ul>;
};

/** mono tag chips row */
Card.Tags = function CardTags({ children, className = '' }: SlotProps) {
  return <div className={`${styles.tags} ${className}`.trim()}>{children}</div>;
};

/** action-row at the bottom of the card */
Card.Actions = function CardActions({
  children,
  className = '',
}: SlotProps) {
  return <div className={`${styles.actions} ${className}`.trim()}>{children}</div>;
};

/** number + year head row */
Card.Head = function CardHead({ children, className = '' }: SlotProps) {
  return <div className={`${styles.head} ${className}`.trim()}>{children}</div>;
};
