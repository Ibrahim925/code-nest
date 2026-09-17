# Policy engine

Own `src/policy.js` and the policy-facing parts of the public tests. Fill in the
ordinary role-to-zone rules, with particular attention to engineering and research
work. Keep the result deterministic and return a useful reason with every allow or
deny decision.

Coordinate if another patch needs a new policy input. Don't absorb delegation or
emergency behavior into the base table; those modules need to remain independently
reviewable.
