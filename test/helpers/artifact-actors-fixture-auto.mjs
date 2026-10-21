/**
 * Side-effect fixture for tests that import artifact-profiles statically.
 * Import this module before artifact-profiles so the pack actor maps are
 * present when the profile registry freezes.
 */

import { installArtifactActorsPackFixture } from './artifact-actors-pack-fixture.mjs';

const fixture = installArtifactActorsPackFixture();
process.on('exit', () => fixture.cleanup());
