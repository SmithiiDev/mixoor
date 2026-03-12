pragma circom 2.1.0;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

// Merkle tree verification
template MerkleTreeChecker(levels) {
    signal input leaf;
    signal input root;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component hashers[levels];
    component indexBits[levels];

    signal hashes[levels + 1];

    // Declare all signals as arrays outside the loop
    signal leftSelector[levels];
    signal rightSelector[levels];
    signal leftTerm1[levels];
    signal leftTerm2[levels];
    signal rightTerm1[levels];
    signal rightTerm2[levels];
    signal left[levels];
    signal right[levels];

    hashes[0] <== leaf;

    for (var i = 0; i < levels; i++) {
        indexBits[i] = Num2Bits(1);
        indexBits[i].in <== pathIndices[i];

        hashers[i] = Poseidon(2);

        leftSelector[i] <== 1 - indexBits[i].out[0];
        rightSelector[i] <== indexBits[i].out[0];

        // Break into individual multiplications
        leftTerm1[i] <== hashes[i] * leftSelector[i];
        leftTerm2[i] <== pathElements[i] * rightSelector[i];
        left[i] <== leftTerm1[i] + leftTerm2[i];

        rightTerm1[i] <== pathElements[i] * leftSelector[i];
        rightTerm2[i] <== hashes[i] * rightSelector[i];
        right[i] <== rightTerm1[i] + rightTerm2[i];

        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];

        hashes[i + 1] <== hashers[i].out;
    }

    root === hashes[levels];
}

// Main transaction circuit
template Transaction(levels) {
    // Public inputs
    signal input root;
    signal input nullifierHash;
    signal input recipient;
    signal input relayer;
    signal input fee;
    signal input refund;
    signal input poolId;

    // Private inputs
    signal input secret;
    signal input nullifier;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal input amount;

    // Compute commitment = Poseidon(secret, nullifier, amount, poolId)
    component commitmentHasher = Poseidon(4);
    commitmentHasher.inputs[0] <== secret;
    commitmentHasher.inputs[1] <== nullifier;
    commitmentHasher.inputs[2] <== amount;
    commitmentHasher.inputs[3] <== poolId;

    // Verify merkle tree membership
    component tree = MerkleTreeChecker(levels);
    tree.leaf <== commitmentHasher.out;
    tree.root <== root;
    for (var i = 0; i < levels; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }

    // Compute nullifier hash = Poseidon(nullifier, poolId)
    component nullifierHasher = Poseidon(2);
    nullifierHasher.inputs[0] <== nullifier;
    nullifierHasher.inputs[1] <== poolId;
    nullifierHash === nullifierHasher.out;

    // Verify amount covers fee + refund
    // Constrain inputs to 64 bits to prevent field overflow
    component amountBits = Num2Bits(64);
    amountBits.in <== amount;

    component feeBits = Num2Bits(64);
    feeBits.in <== fee;

    component refundBits = Num2Bits(64);
    refundBits.in <== refund;

    // Now safe to use GreaterEqThan
    component amountCheck = GreaterEqThan(64);
    amountCheck.in[0] <== amount;
    amountCheck.in[1] <== fee + refund;
    amountCheck.out === 1;

    // Square signals to prevent tampering
    signal recipientSquare <== recipient * recipient;
    signal relayerSquare <== relayer * relayer;
    signal poolIdSquare <== poolId * poolId;
}

component main {public [root, nullifierHash, recipient, relayer, fee, refund, poolId]} = Transaction(20);
