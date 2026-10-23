import { describe, expect, it } from 'vitest';
import { commandForInput, matchesAccelerator, tabIndexForInput, COMMANDS, COMMAND_IDS } from '../../src/shared/commands';
import { fuzzyScore, rankBy } from '../../src/shared/fuzzy';

const key = (k: string, mods: Partial<{ control: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key: k,
  control: false,
  meta: false,
  shift: false,
  alt: false,
  ...mods,
});

describe('keyboard shortcuts', () => {
  it('maps Mod to Ctrl on Windows/Linux and Cmd on macOS', () => {
    expect(commandForInput(key('k', { control: true }), false)).toBe('ui.palette');
    expect(commandForInput(key('k', { meta: true }), true)).toBe('ui.palette');
    expect(commandForInput(key('k', { meta: true }), false)).toBeNull();
  });

  it('respects Shift for letters', () => {
    expect(commandForInput(key('t', { control: true }), false)).toBe('tab.new');
    expect(commandForInput(key('T', { control: true, shift: true }), false)).toBe('tab.reopen');
  });

  it('handles zoom keys on US and Spanish layouts', () => {
    expect(commandForInput(key('=', { control: true }), false)).toBe('page.zoomIn');
    expect(commandForInput(key('+', { control: true }), false)).toBe('page.zoomIn'); // ES layout
    expect(commandForInput(key('+', { control: true, shift: true }), false)).toBe('page.zoomIn'); // US Shift+=
    expect(commandForInput(key('-', { control: true }), false)).toBe('page.zoomOut');
  });

  it('does not steal plain typing or clipboard shortcuts', () => {
    expect(commandForInput(key('k'), false)).toBeNull();
    expect(commandForInput(key('c', { control: true }), false)).toBeNull();
    expect(commandForInput(key('v', { control: true }), false)).toBeNull();
    expect(commandForInput(key('a', { control: true }), false)).toBeNull();
  });

  it('Ctrl+1..9 selects tabs', () => {
    expect(tabIndexForInput(key('3', { control: true }), false)).toBe(3);
    expect(tabIndexForInput(key('3'), false)).toBeNull();
    expect(tabIndexForInput(key('0', { control: true }), false)).toBeNull();
  });

  it('has no duplicate accelerators', () => {
    const seen = new Map<string, string>();
    for (const id of COMMAND_IDS)
      for (const k of COMMANDS[id].keys) {
        expect(seen.get(k), `${k} used by ${seen.get(k)} and ${id}`).toBeUndefined();
        seen.set(k, id);
      }
  });

  it('matchesAccelerator handles function keys', () => {
    expect(matchesAccelerator('F5', key('F5'), false)).toBe(true);
    expect(matchesAccelerator('Alt+ArrowLeft', key('ArrowLeft', { alt: true }), false)).toBe(true);
  });
});

describe('fuzzy', () => {
  it('ranks exact > prefix > word start > substring > subsequence', () => {
    const a = fuzzyScore('hist', 'hist');
    const b = fuzzyScore('hist', 'historial');
    const c = fuzzyScore('hist', 'ver historial');
    const d = fuzzyScore('hist', 'prehistoria');
    const e = fuzzyScore('hst', 'historial');
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    expect(c).toBeGreaterThan(d);
    expect(d).toBeGreaterThan(e);
    expect(e).toBeGreaterThan(0);
    expect(fuzzyScore('xyz', 'historial')).toBe(0);
  });

  it('ignores accents and case', () => {
    expect(fuzzyScore('pestana', 'Nueva Pestaña')).toBeGreaterThan(0);
  });

  it('rankBy filters and orders', () => {
    expect(rankBy(['Ajustes', 'Historial', 'Favoritos'], 'fav', (s) => s)).toEqual(['Favoritos']);
  });
});
