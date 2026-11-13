import assert from "node:assert/strict";
import { parseAmountInputToPaise, toPaise } from "./money";

const cases: Array<[string, string, number | null]> = [
  ["whole rupees", "125", 12_500],
  ["one decimal place", "12.5", 1_250],
  ["two decimal places", "12.05", 1_205],
  ["leading decimal point", ".50", 50],
  ["trailing decimal point", "7.", 700],
  ["leading zeroes", "0007.03", 703],
  ["zero", "0", 0],
  ["empty", "", null],
  ["sub-paise precision", "1.001", null],
  ["negative value", "-1.00", null],
  ["scientific notation", "1e2", null],
  ["group separators", "1,000.00", null],
  ["non-numeric", "one", null],
  ["above numeric(12,2)", "10000000000.00", null],
];

for (const [name, input, expected] of cases) {
  assert.equal(parseAmountInputToPaise(input), expected, name);
}

const coreCases: Array<[string, () => void]> = [
  ["accepts ordinary binary floating-point noise", () => assert.equal(toPaise(0.29), 29)],
  ["accepts exact decimal fractions", () => assert.equal(toPaise(10.05), 1_005)],
  ["rejects sub-paise core amounts", () => assert.throws(() => toPaise(1.001), /fractions of a paise/i)],
  ["rejects sub-paise thirds", () => assert.throws(() => toPaise(0.333), /fractions of a paise/i)],
];

for (const [name, run] of coreCases) {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) error.message = `${name}: ${error.message}`;
    throw error;
  }
}

console.log(`Money input and core precision validation: ${cases.length + coreCases.length}/${cases.length + coreCases.length} passed`);
