/**
 * Small hand-rolled validation primitives for the content files.
 *
 * Deliberately not a schema library: the project ships no validation
 * dependency, and content is validated once at load. The whole point of this
 * module is the error text — a broken JSON file must say *which field*, *why*,
 * and *what it got*, because the alternative is a unit that silently fights
 * with `NaN` attack speed.
 */

/** Thrown for a single bad field. Caught and batched by {@link validateEach}. */
export class FieldError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`${path}: ${reason}`);
    this.name = 'FieldError';
  }
}

/** Thrown once per load with every problem found, not just the first. */
export class DataValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(
      `content validation failed with ${issues.length} issue(s):\n` +
        issues.map((issue) => `  - ${issue}`).join('\n'),
    );
    this.name = 'DataValidationError';
  }
}

/** Renders a received value compactly for error messages. */
export function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array of length ${value.length}`;
  const type = typeof value;
  if (type === 'string') return `string ${JSON.stringify(value)}`;
  if (type === 'number' || type === 'boolean') return `${type} ${String(value)}`;
  if (type === 'undefined') return 'undefined (missing)';
  return type;
}

function fail(path: string, reason: string): never {
  throw new FieldError(path, reason);
}

export function asObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, `expected an object, got ${describe(value)}`);
  }
  return value as Record<string, unknown>;
}

export function asArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(path, `expected an array, got ${describe(value)}`);
  }
  return value;
}

export function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') {
    fail(path, `expected a string, got ${describe(value)}`);
  }
  if (value.length === 0) {
    fail(path, 'expected a non-empty string, got ""');
  }
  return value;
}

export function asBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    fail(path, `expected a boolean, got ${describe(value)}`);
  }
  return value;
}

export interface NumberBounds {
  readonly min?: number;
  readonly max?: number;
  readonly integer?: boolean;
  /** Rejects the `min` value itself. Use for stats that must be > 0. */
  readonly exclusiveMin?: boolean;
}

export function asNumber(
  value: unknown,
  path: string,
  bounds: NumberBounds = {},
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, `expected a finite number, got ${describe(value)}`);
  }
  if (bounds.integer === true && !Number.isInteger(value)) {
    fail(path, `expected an integer, got ${value}`);
  }
  if (bounds.min !== undefined) {
    if (bounds.exclusiveMin === true && value <= bounds.min) {
      fail(path, `expected a number greater than ${bounds.min}, got ${value}`);
    }
    if (bounds.exclusiveMin !== true && value < bounds.min) {
      fail(path, `expected a number >= ${bounds.min}, got ${value}`);
    }
  }
  if (bounds.max !== undefined && value > bounds.max) {
    fail(path, `expected a number <= ${bounds.max}, got ${value}`);
  }
  return value;
}

export function asEnum<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(
      path,
      `expected one of ${allowed.map((a) => JSON.stringify(a)).join(', ')}, got ${describe(value)}`,
    );
  }
  return value as T;
}

/** Accepts an explicit `null`, otherwise delegates. Content uses `null` rather
 *  than omitted keys, so a missing key is still an error. */
export function asNullOr<T>(
  value: unknown,
  path: string,
  inner: (value: unknown, path: string) => T,
): T | null {
  return value === null ? null : inner(value, path);
}

/**
 * Enforces that an object has exactly the expected keys.
 *
 * Unknown keys are errors, not noise: a typo like `atkspeed` would otherwise
 * leave the real stat undefined and be caught much later, if at all.
 */
export function exactKeys(
  object: Record<string, unknown>,
  path: string,
  keys: readonly string[],
): void {
  const missing = keys.filter((key) => !(key in object));
  if (missing.length > 0) {
    fail(path, `missing required field(s): ${missing.join(', ')}`);
  }
  const unexpected = Object.keys(object).filter((key) => !keys.includes(key));
  if (unexpected.length > 0) {
    fail(
      path,
      `unexpected field(s): ${unexpected.join(', ')} (allowed: ${keys.join(', ')})`,
    );
  }
}

/**
 * Validates every element, collecting one issue per failing element instead of
 * stopping at the first. Fixing a content file goes much faster when the error
 * lists all twelve broken units at once.
 */
export function validateEach<T>(
  items: readonly unknown[],
  basePath: string,
  validate: (raw: unknown, path: string) => T,
): T[] {
  const results: T[] = [];
  const issues: string[] = [];
  items.forEach((raw, index) => {
    try {
      results.push(validate(raw, `${basePath}[${index}]`));
    } catch (error) {
      if (error instanceof FieldError) {
        issues.push(error.message);
        return;
      }
      throw error;
    }
  });
  if (issues.length > 0) {
    throw new DataValidationError(issues);
  }
  return results;
}

/** Accumulates cross-reference problems found after per-item validation. */
export class IssueCollector {
  private readonly issues: string[] = [];

  add(path: string, reason: string): void {
    this.issues.push(`${path}: ${reason}`);
  }

  /** Records an issue when `condition` does not hold. */
  check(condition: boolean, path: string, reason: string): void {
    if (!condition) this.add(path, reason);
  }

  throwIfAny(): void {
    if (this.issues.length > 0) {
      throw new DataValidationError(this.issues);
    }
  }
}

/** Indexes definitions by id, reporting duplicates rather than overwriting. */
export function indexById<T extends { readonly id: string }>(
  items: readonly T[],
  basePath: string,
): Map<string, T> {
  const byId = new Map<string, T>();
  const issues: string[] = [];
  items.forEach((item, index) => {
    if (byId.has(item.id)) {
      issues.push(`${basePath}[${index}].id: duplicate id ${JSON.stringify(item.id)}`);
      return;
    }
    byId.set(item.id, item);
  });
  if (issues.length > 0) {
    throw new DataValidationError(issues);
  }
  return byId;
}
