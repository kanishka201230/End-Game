const fs = require('fs');

function parseFBXObjects(filePath) {
  const buf = fs.readFileSync(filePath);
  const text = buf.toString('latin1');
  const objectsIdx = text.indexOf('Objects');
  if (objectsIdx === -1) return { meshes: [], characters: [] };
  
  // Look for Model definitions
  const models = [];
  const modelRegex = /Model::([^\x00\x01]+)/g;
  let m;
  while ((m = modelRegex.exec(text)) !== null) {
    const name = m[1].replace(/[\x00-\x1f].*$/, '').trim();
    if (name && !name.startsWith('mixamorig') && !models.includes(name)) {
      models.push(name);
    }
  }
  return models;
}

console.log('Player 1 Models:', parseFBXObjects('assets/animations/player1/Running (2).fbx'));
console.log('Player 2 Models:', parseFBXObjects('assets/animations/player2/Running.fbx'));
