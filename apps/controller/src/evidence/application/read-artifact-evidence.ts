import type { ArtifactEvidenceReader } from "./ports/artifact-evidence-reader.js";
import type {
  ArtifactEvidence,
  ArtifactEvidenceRequest,
} from "../domain/artifact-evidence.js";

export interface ArtifactEvidenceUseCases {
  read(request: ArtifactEvidenceRequest): Promise<ArtifactEvidence | undefined>;
}

export class ReadArtifactEvidenceService implements ArtifactEvidenceUseCases {
  constructor(private readonly reader: ArtifactEvidenceReader) {}

  read(request: ArtifactEvidenceRequest): Promise<ArtifactEvidence | undefined> {
    return this.reader.read(request);
  }
}
