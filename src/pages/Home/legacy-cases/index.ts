/*
 * Raw legacy case-study HTML, lifted verbatim from Protfo/index.html
 * (#project1-content … #project5-content). Imported as plain text via
 * Vite's `?raw` query so each modal can render the full content
 * unchanged through dangerouslySetInnerHTML.
 *
 * Mapping is by *modal slot* (1..5), which corresponds to the legacy
 * openModal(N) calls. Strategy projects map onto these slots as:
 *   04 → P5 (M&A — global automaker)
 *   05 → P1 (Cross-border Commerce)
 *   06 → P2 (Hyper-local P2P Delivery)
 *   07 → P4 (Drive-to-Earn)
 *   08 → P3 (Digital Asset Trading)
 */

import p1 from './p1.html?raw';
import p2 from './p2.html?raw';
import p3 from './p3.html?raw';
import p4 from './p4.html?raw';
import p5 from './p5.html?raw';

const SLOTS: Record<string, string> = { p1, p2, p3, p4, p5 };

/** Map a card number ('04'..'08') to its legacy modal HTML. */
export function getLegacyCaseHtml(cardNumber: string): string | undefined {
  const map: Record<string, string> = {
    '04': 'p5',
    '05': 'p1',
    '06': 'p2',
    '07': 'p4',
    '08': 'p3',
  };
  const slot = map[cardNumber];
  return slot ? SLOTS[slot] : undefined;
}
