import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HyperFormula } from 'hyperformula';

const banks = JSON.parse(await readFile(new URL('../../content/practical_assessment_banks.json', import.meta.url), 'utf8'));
for (const task of banks.banks['working-capital-model'].cases) {
  const cells = { ...task.metadata.initial_spreadsheet_data, ...task.expected_output.expected_formulas };
  const data = Array.from({length:60}, () => Array(20).fill(null));
  for (const [address, value] of Object.entries(cells)) {
    const [, letters, number] = address.match(/^([A-Z]+)(\d+)$/);
    const col = [...letters].reduce((current,letter) => current*26+letter.charCodeAt(0)-64, 0)-1;
    data[Number(number)-1][col] = value;
  }
  const engine = HyperFormula.buildFromSheets({Assessment:data}, {licenseKey:'internal-use-in-handsontable'});
  for (const check of task.grading_config.checkpoints) {
    const address = check.source.split(':')[1].replace('Assessment!', '');
    const actual = engine.getCellValue(engine.simpleCellAddressFromString(address, 0));
    assert.equal(typeof actual, 'number', `${task.metadata.case_id} ${address} formula error ${JSON.stringify(actual)}`);
    assert.ok(Math.abs(actual-check.expected) <= (check.tolerance || .000001), `${task.metadata.case_id} ${address}: ${actual} != ${check.expected}`);
  }
  engine.destroy();
}
console.log('All 30 Excel datasets: 720 independently evaluated formula outputs match scoring keys.');
