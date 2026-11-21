export function unixNanoToDate(value: string): Date {
  return new Date(Number(BigInt(value) / 1_000_000n));
}

export function durationMilliseconds(
  startTimeUnixNano: string,
  endTimeUnixNano: string,
): number {
  return Number(
    (BigInt(endTimeUnixNano) - BigInt(startTimeUnixNano)) / 1_000_000n,
  );
}

