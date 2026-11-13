import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions } from './upstream-release.mjs';

/* ------------------------------------------------------- version ordering */

test('compareVersions orders numeric components, not strings', () => {
  // The whole reason this helper exists: '9.0.0' > '10.0.0' as a string.
  assert.ok(compareVersions('10.0.0', '9.0.0') > 0);
  assert.ok(compareVersions('9.0.0', '10.0.0') < 0);
  assert.ok(compareVersions('17.0.0', '17.0.0') === 0);
});

test('compareVersions handles differing component counts', () => {
  assert.ok(compareVersions('18.0.0', '18.0') === 0, 'missing patch == 0');
  assert.ok(compareVersions('18.1.0', '18.0.0') > 0);
  assert.ok(compareVersions('18.0.1', '18.0.0') > 0);
  assert.ok(compareVersions('19.0.0', '18.9.9') > 0);
});

test('compareVersions orders the real release sequence correctly', () => {
  const released = ['1.1.0', '2.0.0', '3.0.0', '3.1.0', '4.0.0', '5.0.0', '5.1.0', '5.2.0',
                   '6.0.0', '6.1.0', '6.2.0', '6.3.0', '7.0.0', '8.0.0', '9.0.0',
                   '10.0.0', '11.0.0', '12.0.0', '12.1.0', '13.0.0', '14.0.0',
                   '15.0.0', '15.1.0', '16.0.0', '17.0.0', '18.0.0'];
  for (let i = 1; i < released.length; i++) {
    assert.ok(
      compareVersions(released[i], released[i - 1]) > 0,
      `${released[i]} must sort after ${released[i - 1]}`,
    );
  }
});

/* --------------------------------------------- directory naming for a bump */

test('the dataset directory name is derived from the version without the patch', () => {
  // This mirrors the mapping src/bump-version.mjs relies on: UCD 18.0.0 -> Unicode-18.0-...
  const datasetVersion = (ucd) => ucd.replace(/\.0$/, '');
  assert.equal(datasetVersion('18.0.0'), '18.0');
  assert.equal(datasetVersion('17.0.0'), '17.0');
  assert.equal(datasetVersion('15.1.0'), '15.1');
  // A future x.y.z release must not lose a meaningful patch component.
  assert.equal(datasetVersion('19.1.2'), '19.1.2');
});
