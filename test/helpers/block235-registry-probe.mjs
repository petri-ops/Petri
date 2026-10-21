import { installDataModelExtensionsPackFixture } from './data-model-extensions-pack-fixture.mjs';

const fixture = installDataModelExtensionsPackFixture();
try {
  const registry = await import('../../core/shared-backend/artifact-profiles.js');
  const profile = registry.getProfile('petri.custom-table.v1');
  process.stdout.write(JSON.stringify({
    profiles: registry.listProfiles().sort(),
    valid: profile ? registry.validateProfileDefinition(profile).valid : false,
    frozen: profile ? Object.isFrozen(profile) : false,
    producer: registry.isProducer('petri.custom-table.v1', 'fixture-producer'),
    consumer: registry.isConsumer('petri.custom-table.v1', 'fixture-consumer'),
    warnings: registry.ARTIFACT_PROFILE_EXTENSION_WARNINGS,
  }));
} finally {
  fixture.cleanup();
}
