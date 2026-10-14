global.window = {
  addEventListener() {},
  removeEventListener() {}
};
global.document = {
  createElement() { return {}; }
};
global.URL = {
  createObjectURL() { return 'blob:mock'; },
  revokeObjectURL() {}
};
global.self = global.window;

const THREE = require('three');
const { FBXLoader } = require('three/examples/jsm/loaders/FBXLoader.js');
const fs = require('fs');

async function inspect(filePath) {
  const buf = fs.readFileSync(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new FBXLoader();
  const fbx = loader.parse(arrayBuffer, '');
  console.log(`\n=== Loaded ${filePath} ===`);
  const meshes = [];
  fbx.traverse(c => {
    if (c.isMesh) {
      meshes.push({ name: c.name, type: c.type, isSkinnedMesh: !!c.isSkinnedMesh });
    }
  });
  console.log('Meshes:', meshes);
  console.log('Animations:', fbx.animations.map(a => ({ name: a.name, duration: a.duration, tracks: a.tracks.length })));
}

async function run() {
  try {
    await inspect('public/animations/player1/Running (2).fbx');
    await inspect('public/animations/player2/Running.fbx');
  } catch (err) {
    console.error('Error loading FBX in node:', err.message, err.stack);
  }
}

run();
