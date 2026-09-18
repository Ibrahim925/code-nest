import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ComparisonImportControl } from "./ComparisonImportControl.js";
import { ConstitutionLab } from "./ConstitutionLab.js";
import { comparisonFixture } from "./comparison.test-fixture.js";
import { parseLabComparison } from "./domain/comparison.js";

describe("Constitution Lab comparison", () => {
  it("leads with distributions and uncertainty before matched anecdotes", () => {
    const markup = renderToStaticMarkup(
      <ConstitutionLab comparison={comparisonFixture()} onClose={() => undefined} synthetic />,
    );
    expect(markup).toContain("Synthetic demonstration data");
    expect(markup).toContain("5 per condition");
    expect(markup).toContain("Security–productivity frontier");
    expect(markup).toContain("95% interval");
    expect(markup).toContain("n=4 · 1 missing");
    expect(markup.indexOf("Outcome distributions")).toBeLessThan(markup.indexOf("Matched run divergence"));
  });

  it("keeps runtime modes, observability tiers, failures, and missing values visible", () => {
    const markup = renderToStaticMarkup(
      <ConstitutionLab comparison={comparisonFixture()} onClose={() => undefined} />,
    );
    expect(markup).toContain("split");
    expect(markup).toContain("contained");
    expect(markup).toContain("tier-2");
    expect(markup).toContain("tier-1");
    expect(markup).toContain("never pooled into a runtime estimate");
    expect(markup).toContain("1 failed trial retained as missing");
    expect(markup).not.toContain("chain-of-thought");
  });

  it("aligns a matched seed by phase and exposes inspectable run records", () => {
    const markup = renderToStaticMarkup(
      <ConstitutionLab comparison={comparisonFixture()} onClose={() => undefined} />,
    );
    expect(markup).toContain("1 · seed 101");
    expect(markup).toContain("Round 1 · work");
    expect(markup).toContain("Round 1 · evidence");
    expect(markup).toContain("Round 1 · governance");
    expect(markup).toContain("evidence · ");
    expect(markup.match(/Inspect run record/g)).toHaveLength(3);
  });

  it("provides an accessible labelled chart plus exact tabular values", () => {
    const markup = renderToStaticMarkup(
      <ConstitutionLab comparison={comparisonFixture()} onClose={() => undefined} />,
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain("Release quality against successful sabotage rate");
    expect(markup).toContain("Point size encodes mean governance credits spent");
    expect(markup).toContain("Exact values remain in the ledger below");
  });

  it("validates local comparison imports and explains the offline path", () => {
    const comparison = comparisonFixture();
    expect(parseLabComparison(JSON.parse(JSON.stringify(comparison)))).toEqual(comparison);
    expect(() => parseLabComparison({ ...comparison, conditions: comparison.conditions.slice(1) }))
      .toThrow(/inconsistent|incomplete/);
    expect(() => parseLabComparison({ ...comparison, roster: [] })).toThrow(/incomplete/);
    const markup = renderToStaticMarkup(<ComparisonImportControl onLoad={() => undefined} />);
    expect(markup).toContain("Open Constitution Lab");
    expect(markup).toContain("The file stays in this browser");
    expect(markup).toContain("application/vnd.code-nest.experiment+json");
  });
});
