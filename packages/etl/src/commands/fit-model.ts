import { parseArgs } from 'node:util';

import { runJointFit } from '../joint-fit';
import { CliError, UsageError, parseStrictPositiveInt } from '../cli-args';
import { log, type Command } from './shared';

async function runFitModel(args: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: false,
      strict: true,
      options: {
        'eval-patch': { type: 'string' },
        iterations: { type: 'string' },
        l2: { type: 'string' },
        limit: { type: 'string' },
        'eval-limit': { type: 'string' },
        out: { type: 'string' },
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(
      `${message}\nUsage: etl fit-model [--eval-patch=16.22] [--iterations=N] [--l2=X] [--limit=N] [--eval-limit=N] [--out=path]`,
    );
  }
  const { values } = parsed;

  const evalPatch = typeof values['eval-patch'] === 'string' ? values['eval-patch'] : undefined;
  const iterations = parseStrictPositiveInt(
    typeof values.iterations === 'string' ? values.iterations : undefined,
    '--iterations',
  );
  const limit = parseStrictPositiveInt(
    typeof values.limit === 'string' ? values.limit : undefined,
    '--limit',
  );
  const evalLimit = parseStrictPositiveInt(
    typeof values['eval-limit'] === 'string' ? values['eval-limit'] : undefined,
    '--eval-limit',
  );
  const l2 = typeof values.l2 === 'string' ? Number.parseFloat(values.l2) : undefined;
  if (l2 !== undefined && (!Number.isFinite(l2) || l2 < 0)) {
    throw new UsageError('--l2 must be a non-negative number');
  }
  const out = typeof values.out === 'string' && values.out.length > 0 ? values.out : undefined;
  if (values.out !== undefined && out === undefined) {
    throw new UsageError('--out requires a non-empty path');
  }

  log.info('Fitting joint draft model...');
  const result = await runJointFit({
    evalPatch,
    iterations,
    l2,
    limit,
    evalLimit,
    outPath: out,
    onProgress: (message) => log.info(message),
  });

  const v = result.validation;
  log.info(
    `Done: ${v.trainMatches} train / ${v.evalMatches} eval matches, ` +
      `${v.evalParticipants} masked picks. Export: ${result.exportPath}`,
  );
  const wp = v.winProb['joint'];
  const ci = v.winProbLogLossDeltaCi95;
  if (wp === undefined || ci[1] >= 0) {
    throw new CliError(
      `Joint model does not beat the trivial win-probability baselines on ` +
        `${v.evalPatch} (ΔlogLoss 95% CI upper bound ${(ci?.[1] ?? 0).toFixed(5)} >= 0). ` +
        `validationStatus stays "unvalidated".`,
    );
  }
}

export const fitModelCommand: Command = {
  name: 'fit-model',
  usage:
    'fit-model [--eval-patch=16.22] [--iterations=N] [--l2=X] [--limit=N] [--eval-limit=N] [--out=path]',
  description:
    'Fits the joint regularized draft model and writes data/public/joint-model.json with rolling-holdout validation',
  run: runFitModel,
};
