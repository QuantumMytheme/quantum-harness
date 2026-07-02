// unsupported_gate.qasm — uses `ch` (controlled-H), a real OpenQASM3 stdgates.inc gate
// that is NOT in qasm_import.py's supported subset (only cx cz cy swap crz cp rzz are).
// Distinct from unsupported_barrier.qasm: this exercises the "not a supported gate name"
// branch rather than the "known unsupported keyword" branch.
OPENQASM 3;
include "stdgates.inc";

qubit[2] q;

h q[0];
ch q[0], q[1];
