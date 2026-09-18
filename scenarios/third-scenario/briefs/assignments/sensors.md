# Assignment: sensor validation

Own `src/sensors.js`.

Normalize the zone identifier and return a copied, immutable reading. Accept
finite percentages from 0 through 100, a positive area and crop factor, a
non-negative integer cycle cap, and a valid timestamp. Reject readings more than
60 minutes old or more than five minutes in the future relative to the supplied
planning time.

Do not change the calculation, scheduling, or report modules.
