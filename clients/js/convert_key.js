const fs = require('fs');
const path = require('path');

// Read the verification key from circuits directory
// Assuming this script is running from clients/js
const vkeyPath = path.join(__dirname, '../../circuits/verification_key.json');
const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));

function g1ToBytes(point) {
  const x = BigInt(point[0]);
  const y = BigInt(point[1]);
  const xBytes = Buffer.from(x.toString(16).padStart(64, '0'), 'hex').reverse();
  const yBytes = Buffer.from(y.toString(16).padStart(64, '0'), 'hex').reverse();
  return Buffer.concat([xBytes, yBytes]);
}

function g2ToBytes(point) {
  const x0 = BigInt(point[0][0]);
  const x1 = BigInt(point[0][1]);
  const y0 = BigInt(point[1][0]);
  const y1 = BigInt(point[1][1]);
  return Buffer.concat([
    Buffer.from(x1.toString(16).padStart(64, '0'), 'hex').reverse(),
    Buffer.from(x0.toString(16).padStart(64, '0'), 'hex').reverse(),
    Buffer.from(y1.toString(16).padStart(64, '0'), 'hex').reverse(),
    Buffer.from(y0.toString(16).padStart(64, '0'), 'hex').reverse()
  ]);
}

const alphaG1 = g1ToBytes(vkey.vk_alpha_1);
const betaG2 = g2ToBytes(vkey.vk_beta_2);
const gammaG2 = g2ToBytes(vkey.vk_gamma_2);
const deltaG2 = g2ToBytes(vkey.vk_delta_2);

let rustCode = `pub const VERIFYING_KEY: Groth16VerifyingKey = Groth16VerifyingKey {
    nr_pubinputs: ${vkey.nPublic},
    
    vk_alpha_g1: [
        ${Array.from(alphaG1).join(', ')}
    ],
    
    vk_beta_g2: [
        ${Array.from(betaG2).join(', ')}
    ],
    
    // Note: Library uses vk_gamme_g2 (typo)
    vk_gamme_g2: [
        ${Array.from(gammaG2).join(', ')}
    ],
    
    vk_delta_g2: [
        ${Array.from(deltaG2).join(', ')}
    ],
    
    vk_ic: &[\n`;

for (let i = 0; i < vkey.IC.length; i++) {
  const ic = g1ToBytes(vkey.IC[i]);
  rustCode += `        [\n            ${Array.from(ic).join(', ')}\n        ],\n`;
}

rustCode += `    ]\n};\n`;

const outputPath = path.join(__dirname, '../../program/src/utils/verifying_key.rs');
fs.writeFileSync(outputPath, rustCode);
console.log('Verifying key exported to:', outputPath);
console.log('⚠️  You must rebuild the program for this change to take effect!');
