const fs = require('fs');

const buf = fs.readFileSync('assets/animations/Running (1).fbx');
// Search for strings in binary
const str = buf.toString('binary');
const matches = [];
let re = /Beta_Surface|Beta_Joints|mixamorig:[A-Za-z0-9_]+|Model::[A-Za-z0-9_]+/g;
let m;
while ((m = re.exec(str)) !== null) {
  if (!matches.includes(m[0])) matches.push(m[0]);
}
console.log('Found strings in Running (1).fbx:', matches);
