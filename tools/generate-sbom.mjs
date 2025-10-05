import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

const root = path.join(process.cwd(), 'package.json');
const pkg = JSON.parse(fs.readFileSync(root, 'utf8'));

const components = [];
const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };

for (const [name, range] of Object.entries(dependencies)) {
  const version = typeof range === 'string' ? range.replace(/^[^0-9]*/, '') : '0.0.0';
  const purlName = name.startsWith('@') ? name.replace('/', '%2F') : name;
  components.push({
    bomRef: `pkg:npm/${purlName}`,
    type: 'library',
    name,
    version,
    purl: `pkg:npm/${purlName}@${version}`,
  });
}

const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.4',
  serialNumber: `urn:uuid:${crypto.randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    tools: [
      {
        vendor: 'APGMS',
        name: 'custom-sbom-generator',
        version: '0.1.0',
      },
    ],
    component: {
      type: 'application',
      name: pkg.name,
      version: pkg.version,
    },
  },
  components,
};

fs.writeFileSync(path.join(process.cwd(), 'sbom.json'), JSON.stringify(sbom, null, 2));
console.log('SBOM written to sbom.json with', components.length, 'components.');
