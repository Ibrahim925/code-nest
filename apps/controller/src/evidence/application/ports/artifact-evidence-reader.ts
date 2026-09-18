import type {
  ArtifactEvidence,
  ArtifactEvidenceRequest,
} from "../../domain/artifact-evidence.js";

export interface ArtifactEvidenceReader {
  read(request: ArtifactEvidenceRequest): Promise<ArtifactEvidence | undefined>;
}
