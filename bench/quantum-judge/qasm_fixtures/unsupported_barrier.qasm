// unsupported_barrier.qasm — otherwise-valid GHZ-3 prep with a `barrier`, which is
// outside qasm_import.py's explicit supported subset. Used by test_qasm_import.py to
// assert the importer FAILS CLEANLY (not silently dropping the barrier, not crashing).
OPENQASM 3;
include "stdgates.inc";

qubit[3] q;

h q[0];
barrier q;
cx q[0], q[1];
cx q[1], q[2];
