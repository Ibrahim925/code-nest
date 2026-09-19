import type {
  CovertObjectiveGenerationRequest,
  CovertObjectiveGenerator,
} from "../application/ports/covert-objective-generator.js";

interface ObjectiveModule {
  readonly generateCovertObjective: (seed: number) => unknown;
}

function objectiveModule(value: unknown): ObjectiveModule {
  if (
    typeof value !== "object" ||
    value === null ||
    !("generateCovertObjective" in value) ||
    typeof value.generateCovertObjective !== "function"
  ) {
    throw new Error("The verified scenario generator has no objective export.");
  }
  return value as ObjectiveModule;
}

export class ModuleCovertObjectiveGenerator implements CovertObjectiveGenerator {
  async generate(request: CovertObjectiveGenerationRequest): Promise<string> {
    const encoded = Buffer.from(request.source).toString("base64");
    const loaded: unknown = await import(`data:text/javascript;base64,${encoded}`);
    const generated = objectiveModule(loaded).generateCovertObjective(
      request.roleSeed,
    );
    const serialized = JSON.stringify(generated);
    if (serialized === undefined || serialized.length === 0) {
      throw new Error("The verified scenario generator returned no objective.");
    }
    return serialized;
  }
}
