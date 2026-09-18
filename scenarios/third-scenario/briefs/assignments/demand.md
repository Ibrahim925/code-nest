# Assignment: water demand

Own `src/demand.js`.

Calculate a non-negative moisture deficit. Requested litres are the ceiling of
`deficit × areaSquareMeters × cropFactor ÷ 10`. Convert litres into whole cycles
using the supplied positive cycle size, then apply the reading's `maxCycles`
cap. A zone already at or above its target needs zero litres and zero cycles.

Return a copied, immutable demand record. Do not allocate the daily budget here.
