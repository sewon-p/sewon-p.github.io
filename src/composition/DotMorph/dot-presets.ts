/*
 * Authoritative dot positions for the brand labels — exported from
 * the dot editor (/dot-editor.html) after manual placement against
 * the Geist Pixel Circle font. Replaces the runtime canvas-sampling
 * path for these specific strings; sampling stays as the fallback
 * for any text that's not in this map.
 */

import presets from './dot-presets.json';
import type { DotPoint } from './sample';

interface PresetEntry {
  width: number;
  height: number;
  step: number;
  offsetX?: number;
  offsetY?: number;
  diameter?: number;
  font?: string;
  fontSize?: number;
  dots: DotPoint[];
  accents?: DotPoint[];
}

const TYPED = presets as Record<string, PresetEntry>;

/** Returns the preset dot list for `text`, or null if no preset exists. */
export function lookupPreset(text: string): DotPoint[] | null {
  const entry = TYPED[text];
  if (!entry || !Array.isArray(entry.dots) || entry.dots.length === 0) {
    return null;
  }
  return entry.dots;
}

/** Returns the preset's recommended dot diameter, or null if no preset exists. */
export function lookupPresetDiameter(text: string): number | null {
  const entry = TYPED[text];
  return entry?.diameter ?? null;
}
