// Plugins share long-lived objects (the pack registry, the run engine, the frame hub) through typed
// service keys, so one plugin can use another's service without importing its internals.

export interface ServiceKey<T> {
  readonly name: string;
  /** Never set; only carries the service's type. */
  readonly __type?: T;
}

export function serviceKey<T>(name: string): ServiceKey<T> {
  return { name };
}

export class Services {
  private readonly map = new Map<string, unknown>();

  provide<T>(key: ServiceKey<T>, value: T): void {
    if (this.map.has(key.name)) throw new Error(`The service "${key.name}" is provided twice.`);
    this.map.set(key.name, value);
  }

  get<T>(key: ServiceKey<T>): T {
    if (!this.map.has(key.name)) throw new Error(`No plugin provides the service "${key.name}". Check the plugin order.`);
    return this.map.get(key.name) as T;
  }

  has(key: ServiceKey<unknown>): boolean {
    return this.map.has(key.name);
  }
}
