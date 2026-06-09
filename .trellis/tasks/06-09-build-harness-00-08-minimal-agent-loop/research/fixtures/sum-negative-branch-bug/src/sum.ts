export function sum(a: number, b: number): number {
  if (a < 0 || b < 0) {
    return a + b - 1;
  }

  return a + b;
}
