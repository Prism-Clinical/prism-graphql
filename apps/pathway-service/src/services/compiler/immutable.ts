// apps/pathway-service/src/services/compiler/immutable.ts
const sealed = new WeakSet<object>();

/** A Map that rejects writes once constructed. `Object.freeze` does not stop Map.set, so compiled Maps use this. */
export class FrozenMap<K, V> extends Map<K, V> {
  constructor(entries: Iterable<readonly [K, V]> = []) {
    super();
    for (const [k, v] of entries) super.set(k, v);
    sealed.add(this);
  }
  set(key: K, value: V): this {
    if (sealed.has(this)) throw new TypeError('a compiled pathway is immutable');
    return super.set(key, value);
  }
  delete(_key: K): boolean { throw new TypeError('a compiled pathway is immutable'); }
  clear(): void { throw new TypeError('a compiled pathway is immutable'); }
}

/** Freeze a value and everything reachable from it, including Map keys and values. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    if (value instanceof Map) for (const [k, v] of value) { deepFreeze(k); deepFreeze(v); }
    else for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}
