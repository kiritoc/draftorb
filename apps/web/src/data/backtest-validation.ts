export function backtestPassedValidation(report: unknown): boolean {
  if (typeof report !== 'object' || report === null) {
    return false;
  }
  const record = report as Record<string, unknown>;
  return (
    record['validationStatus'] === 'validated' &&
    typeof record['logLoss'] === 'number' &&
    Number.isFinite(record['logLoss']) &&
    typeof record['baselineLogLoss'] === 'number' &&
    Number.isFinite(record['baselineLogLoss']) &&
    record['logLoss'] < record['baselineLogLoss']
  );
}
