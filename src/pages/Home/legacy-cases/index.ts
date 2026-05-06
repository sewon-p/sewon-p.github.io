/*
 * Raw legacy case-study HTML, lifted verbatim from Protfo/index.html
 * (#project1-content … #project5-content). Imported as plain text via
 * Vite's `?raw` query so each modal can render the full content
 * unchanged through dangerouslySetInnerHTML.
 *
 * Mapping is by chapter-local strategy ordinal (01..05). Strategy
 * projects map onto the legacy modal slots as:
 *   01 → P5 (M&A — global automaker)
 *   02 → P1 (Cross-border Commerce)
 *   03 → P2 (Hyper-local P2P Delivery)
 *   04 → P4 (Drive-to-Earn)
 *   05 → P3 (Digital Asset Trading)
 */

import p1 from './p1.html?raw';
import p2 from './p2.html?raw';
import p3 from './p3.html?raw';
import p4 from './p4.html?raw';
import p5 from './p5.html?raw';

const SLOTS: Record<string, string> = { p1, p2, p3, p4, p5 };

/** Map a strategy card number ('01'..'05') to its legacy modal HTML. */
export function getLegacyCaseHtml(cardNumber: string): string | undefined {
  const map: Record<string, string> = {
    '01': 'p5',
    '02': 'p1',
    '03': 'p2',
    '04': 'p4',
    '05': 'p3',
  };
  const slot = map[cardNumber];
  return slot ? SLOTS[slot] : undefined;
}
