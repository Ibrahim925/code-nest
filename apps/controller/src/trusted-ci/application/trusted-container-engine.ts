import type {
  NormalizedTrustedTestRequest,
  TrustedContainerObservation,
  TrustedMaterialObservation,
} from "../domain/trusted-test.js";

export interface TrustedContainerHandle {
  readonly containerId: string;
  readonly material: TrustedMaterialObservation;
}

export interface TrustedContainerExecution {
  readonly exitCode: number;
  readonly stdout: Uint8Array;
  readonly stderr: Uint8Array;
}

export interface TrustedContainerEngine {
  create(request: NormalizedTrustedTestRequest): Promise<TrustedContainerHandle>;
  start(containerId: string): Promise<void>;
  inspect(containerId: string): Promise<TrustedContainerObservation>;
  execute(containerId: string, request: NormalizedTrustedTestRequest): Promise<TrustedContainerExecution>;
  stop(containerId: string, graceSeconds: number): Promise<void>;
  remove(containerId: string): Promise<void>;
}
