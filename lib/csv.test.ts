import { escapeCsvCell, toCsv } from "./csv";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) {
    passed += 1;
    console.log(`PASS: ${name}`);
  } else {
    failed += 1;
    console.log(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

check("quotes a plain value", escapeCsvCell("Alex"), '"Alex"');
check("doubles embedded quotes", escapeCsvCell('A "B" C'), '"A ""B"" C"');
check("allows commas inside a quoted cell", escapeCsvCell("Doe, John"), '"Doe, John"');
check("neutralizes leading equals", escapeCsvCell("=1+2"), "\"'=1+2\"");
check("neutralizes leading plus", escapeCsvCell("+SUM(A1)"), "\"'+SUM(A1)\"");
check("neutralizes leading minus", escapeCsvCell("-1"), "\"'-1\"");
check("neutralizes leading at-sign", escapeCsvCell("@cmd"), "\"'@cmd\"");
check("neutralizes leading tab", escapeCsvCell("\t=cmd"), "\"'\t=cmd\"");
check("null becomes empty cell", escapeCsvCell(null), '""');
check("undefined becomes empty cell", escapeCsvCell(undefined), '""');
check("numbers are stringified", escapeCsvCell(1200.5), '"1200.5"');
check(
  "serializes header and rows with CRLF",
  toCsv(["A", "B"], [["1", "2"], ["3", "4"]]),
  "\"A\",\"B\"\r\n\"1\",\"2\"\r\n\"3\",\"4\"",
);

console.log(`\ncsv: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
