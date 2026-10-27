// The YAML step list and checker, shared with the server: the same files the pack loader uses,
// so the editor's hints, problems and Steps view can't drift from what runs. These modules import
// nothing from Node or Playwright.
export { STEPS, STEP_BY_NAME, EXPECT_CHECKS, TEST_META, summarize, type StepDef, type StepGroup, type StepArgs } from "../../watchwright/src/plugins/packs/yaml/steps.js";
export { BASE_KINDS, TARGET_MAP, describeTarget, type BaseKind, type Target, type TargetMap, type TextMatch } from "../../watchwright/src/plugins/packs/yaml/targets.js";
export { parseTestFile, type Problem } from "../../watchwright/src/plugins/packs/yaml/parse.js";
export { closest, type Prop, type Shape } from "../../watchwright/src/plugins/packs/yaml/shape.js";
export { stepsCode } from "../../watchwright/src/plugins/packs/yaml/to-code.js";
