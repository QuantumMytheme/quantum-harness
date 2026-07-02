// ghz3.qasm — minimal OpenQASM3 GHZ-3 state prep, for qasm_import.py's round-trip test.
// Same circuit as the worked example quantum-proof-poc.json: h(0), cx(0,1), cx(1,2).
OPENQASM 3;
include "stdgates.inc";

qubit[3] q;

h q[0];
cx q[0], q[1];
cx q[1], q[2];
