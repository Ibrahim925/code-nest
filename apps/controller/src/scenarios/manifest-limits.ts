import type { ScenarioLimits } from "./manifest-contract.js";
import { exactObject, invalid } from "./manifest-fields.js";

const MAX_ROUNDS = 3;
const MAX_PHASE_SECONDS = 3_600;
const MAX_CPU_CORES = 2;
const MAX_MEMORY_MIB = 4_096;
const MAX_PROCESSES = 256;
const MAX_WORKSPACE_MIB = 10_240;
const MAX_TEMPORARY_STORAGE_MIB = 512;

function positiveNumber(
  value: unknown,
  field: string,
  maximum: number,
  requireInteger: boolean,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > maximum ||
    (requireInteger && !Number.isSafeInteger(value))
  ) {
    return invalid(
      field,
      `Scenario manifest field ${field} must be a positive${requireInteger ? " safe integer" : " number"} no greater than ${maximum}.`,
    );
  }
  return value;
}

export function parseScenarioLimits(value: unknown): ScenarioLimits {
  const field = "/limits";
  const record = exactObject(value, field, [
    "cpuCores",
    "maximumFileMiB",
    "memoryMiB",
    "processLimit",
    "roundDurationSeconds",
    "rounds",
    "temporaryStorageMiB",
    "trustedTestWallTimeSeconds",
    "workspaceMiB",
  ]);
  const parsed: ScenarioLimits = {
    rounds: positiveNumber(record.rounds, `${field}/rounds`, MAX_ROUNDS, true),
    roundDurationSeconds: positiveNumber(
      record.roundDurationSeconds,
      `${field}/roundDurationSeconds`,
      MAX_PHASE_SECONDS,
      true,
    ),
    trustedTestWallTimeSeconds: positiveNumber(
      record.trustedTestWallTimeSeconds,
      `${field}/trustedTestWallTimeSeconds`,
      MAX_PHASE_SECONDS,
      true,
    ),
    cpuCores: positiveNumber(
      record.cpuCores,
      `${field}/cpuCores`,
      MAX_CPU_CORES,
      false,
    ),
    memoryMiB: positiveNumber(
      record.memoryMiB,
      `${field}/memoryMiB`,
      MAX_MEMORY_MIB,
      true,
    ),
    processLimit: positiveNumber(
      record.processLimit,
      `${field}/processLimit`,
      MAX_PROCESSES,
      true,
    ),
    workspaceMiB: positiveNumber(
      record.workspaceMiB,
      `${field}/workspaceMiB`,
      MAX_WORKSPACE_MIB,
      true,
    ),
    temporaryStorageMiB: positiveNumber(
      record.temporaryStorageMiB,
      `${field}/temporaryStorageMiB`,
      MAX_TEMPORARY_STORAGE_MIB,
      true,
    ),
    maximumFileMiB: positiveNumber(
      record.maximumFileMiB,
      `${field}/maximumFileMiB`,
      MAX_WORKSPACE_MIB,
      true,
    ),
  };
  if (parsed.maximumFileMiB > parsed.workspaceMiB) {
    return invalid(
      `${field}/maximumFileMiB`,
      "The maximum scenario file size cannot exceed the participant workspace size.",
    );
  }
  return parsed;
}
