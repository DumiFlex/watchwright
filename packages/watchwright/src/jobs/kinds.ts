import type { JobKind } from "./kind.js";

const NAME = /^[a-z][a-z0-9-]{0,39}$/;

/** The job kinds plugins registered, by name. The runs plugin provides it as `JOB_KINDS`. */
export class JobKinds {
  private readonly map = new Map<string, JobKind>();

  register<H>(kind: JobKind<H>): void {
    if (!NAME.test(kind.name)) throw new Error(`Job kind name "${kind.name}" must be lowercase letters, digits and dashes, starting with a letter.`);
    if (this.map.has(kind.name)) throw new Error(`Two plugins register the job kind "${kind.name}".`);
    this.map.set(kind.name, kind);
  }

  get(name: string): JobKind | undefined {
    return this.map.get(name);
  }

  list(): JobKind[] {
    return [...this.map.values()];
  }
}
