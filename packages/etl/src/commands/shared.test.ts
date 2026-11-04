import { describe, expect, it } from 'vitest';

import { formatHelp, PLANNED_COMMANDS, type Command } from './shared';
import { aggregateCommand } from './aggregate';
import { deriveRolesCommand } from './derive-roles';
import { exportCommand } from './export';
import { statusCommand } from './status';

const COMMANDS: readonly Command[] = [
  aggregateCommand,
  deriveRolesCommand,
  exportCommand,
  statusCommand,
];

describe('formatHelp (B-045)', () => {
  it('lists backtest as the only planned command (export is implemented)', () => {
    const help = formatHelp(COMMANDS);
    const planned = help.slice(help.indexOf('Target state commands'));
    expect(planned).toContain('backtest');
    expect(planned).not.toContain('export');
    expect(PLANNED_COMMANDS.map((c) => c.name)).toEqual(['backtest']);
  });

  it('lists every implemented command name', () => {
    const help = formatHelp(COMMANDS);
    for (const command of COMMANDS) {
      expect(help).toContain(command.name);
    }
  });

  it('puts each description on its own indented line below the usage', () => {
    const help = formatHelp(COMMANDS);
    const lines = help.split('\n');
    for (const command of COMMANDS) {
      const usageIndex = lines.findIndex((line) => line.trimStart().startsWith(command.usage));
      expect(usageIndex).toBeGreaterThanOrEqual(0);
      expect(lines[usageIndex + 1]).toBe(`      ${command.description}`);
    }
  });
});
