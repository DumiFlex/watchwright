// What the Steps view's lists can do, given to every nested StepsList by StepsPanel.
import type { InjectionKey, Ref } from "vue";
import type { NodePath, StepNode } from "./stepsdoc";
import type { StepArgs } from "./yamlsteps";

export interface StepsOps {
  /** The selected step's path key. */
  selected: Ref<string | null>;
  select(step: StepNode): void;
  /** The first problem on the step's lines, if any. */
  problemAt(step: StepNode): string | null;
  update(path: NodePath, args: StepArgs): void;
  replace(path: NodePath, name: string): void;
  remove(path: NodePath): void;
  duplicate(path: NodePath): void;
  move(listPath: NodePath, from: number, to: number): void;
  /** Asks which step to add at `index` of the list. */
  add(listPath: NodePath, index: number): void;
}

export const STEPS_OPS: InjectionKey<StepsOps> = Symbol("steps-ops");

export const pathKey = (p: NodePath): string => p.join("/");
