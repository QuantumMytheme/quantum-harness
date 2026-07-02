#!/usr/bin/env python3
"""
qasm_import.py — OpenQASM3 -> proof-bundle `circuit` importer (authoring convenience).

This is an AUTHORING-SIDE adapter, not a new judge and not a new judged task.
It converts a minimal, EXPLICIT subset of OpenQASM3 text into the exact
`{"n_qubits": int, "ops": [{"gate": str, "q": [int...], "params": [float...]?}]}`
circuit IR that `sim.py` / `judge_verify.py` already grade unchanged. A circuit
that imports clean is guaranteed to reproduce under the judge, because it is
run through the SAME `sim.py` any other authoring path uses (`capture.py`).

Supported subset (matches sim.py's KNOWN_GATES exactly for this list):
  1-qubit, no params : x y z h s sdg t tdg sx sxdg
  1-qubit, 1 param    : rx ry rz p
  2-qubit, no params  : cx cz cy swap
  2-qubit, 1 param    : crz cp rzz
  3-qubit, no params  : ccx
Declarations: `OPENQASM 3;`, `include "stdgates.inc";`, `qubit[n] <name>;`
(one or more registers; qubits are referenced as `<name>[<index>]` and flattened
into a single 0-based index space in declaration order).

Anything outside this subset — `barrier`, `measure`, `reset`, `if`/`for`/`while`,
`gate`/`def` bodies, `bit`/`creg` declarations, un-listed gates (`u`, `u1`, `u2`,
`u3`, `ch`, `crx`, `cry`, `rxx`, `ryy`, `cswap`, `id`, `gphase`, ...) — is an
EXPLICIT, clearly-worded failure (`QasmImportError`), never a silent drop. This
is deliberate: a dropped op would make the imported circuit compute something
different from what the QASM text says, and the whole point of this converter
is that it NEVER changes what gets verified.

This is a disciplined statement-level parser over the supported subset, not a
general QASM3 parser (no macros, no classical control flow, no custom gate
definitions) — matching this project's "hermetic, no heavy deps" ethos:
stdlib only, no `qiskit`/`openqasm3` package. See sim.py's KNOWN_GATES / ONE_Q /
TWO_Q / THREE_Q for the authoritative gate table this mirrors.

Usage:
  # emit the circuit IR only (feed it to capture.py yourself)
  python3 qasm_import.py in.qasm -o circuit.json

  # or go straight to a full proof bundle by chaining into capture.py
  # (reuses capture.py unchanged — this file never re-implements bundle-building)
  python3 qasm_import.py in.qasm --problem_id ghz3 --task state_prep -o bundle.json
"""

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CAPTURE = os.path.join(HERE, "capture.py")

# --- the gate table this importer supports, mirroring sim.py's KNOWN_GATES ---
# QASM name -> sim.py op "gate" name. Verified against sim.py's ONE_Q/TWO_Q/
# THREE_Q sets: every name in this supported subset is IDENTICAL between
# OpenQASM3's stdgates.inc and sim.py's internal gate table (no renaming was
# needed — sim.py already speaks these names). This is a verified finding, not
# an assumption: see the arity dicts below, taken directly from sim.py.
ONE_Q_NOPARAM = {"x", "y", "z", "h", "s", "sdg", "t", "tdg", "sx", "sxdg"}
ONE_Q_PARAM = {"rx", "ry", "rz", "p"}
TWO_Q_NOPARAM = {"cx", "cz", "cy", "swap"}
TWO_Q_PARAM = {"crz", "cp", "rzz"}
THREE_Q_NOPARAM = {"ccx"}

SUPPORTED_GATES = ONE_Q_NOPARAM | ONE_Q_PARAM | TWO_Q_NOPARAM | TWO_Q_PARAM | THREE_Q_NOPARAM

_ARITY = {}
for _g in ONE_Q_NOPARAM | ONE_Q_PARAM:
    _ARITY[_g] = 1
for _g in TWO_Q_NOPARAM | TWO_Q_PARAM:
    _ARITY[_g] = 2
for _g in THREE_Q_NOPARAM:
    _ARITY[_g] = 3
_NPARAMS = {g: 0 for g in ONE_Q_NOPARAM | TWO_Q_NOPARAM | THREE_Q_NOPARAM}
_NPARAMS.update({g: 1 for g in ONE_Q_PARAM | TWO_Q_PARAM})

_QARG_RE = re.compile(r"^([A-Za-z_]\w*)\[(\d+)\]$")
_GATE_CALL_RE = re.compile(
    r"^([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?\s+(.+)$"
)
_QUBIT_DECL_RE = re.compile(r"^qubit\s*\[\s*(\d+)\s*\]\s+([A-Za-z_]\w*)$")
_OPENQASM_RE = re.compile(r"^OPENQASM\s+[\d.]+$")
_INCLUDE_RE = re.compile(r'^include\s+"[^"]*"$')

# instructions with recognizably different, unsupported syntax — called out by
# name in the error instead of falling through to the generic "unsupported
# gate" message, so the failure reason is unambiguous.
_KNOWN_UNSUPPORTED_KEYWORDS = {
    "barrier", "measure", "reset", "if", "for", "while", "gate", "def",
    "let", "const", "bit", "creg", "qreg", "output", "input", "gphase",
    "delay", "box", "cal", "defcal", "extern", "pragma",
}


class QasmImportError(Exception):
    """Raised for any OpenQASM3 construct outside the supported subset, or any
    malformed statement. Always carries a clear, specific message — this
    converter fails loudly rather than silently dropping an instruction."""


def _strip_comments(text):
    """Blank out comments in place, preserving newline positions (and hence
    line numbers) for error messages, and preserving all other character
    offsets so `\n`-counting on the stripped text still matches the original."""
    out = []
    i, n = 0, len(text)
    while i < n:
        if text[i:i + 2] == "//":
            j = text.find("\n", i)
            j = n if j == -1 else j
            out.append(" " * (j - i))
            i = j
        elif text[i:i + 2] == "/*":
            j = text.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append("".join("\n" if c == "\n" else " " for c in text[i:j]))
            i = j
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


def _line_of(text, offset):
    return text.count("\n", 0, offset) + 1


class _ExprParser:
    """Minimal, safe arithmetic-expression evaluator for gate params — NOT
    Python `eval()` (this project avoids running arbitrary code to parse
    authoring input). Supports + - * / unary minus, parentheses, float
    literals, and the identifier `pi`."""

    def __init__(self, s):
        self.s = s
        self.i = 0
        self.n = len(s)

    def _peek(self):
        while self.i < self.n and self.s[self.i].isspace():
            self.i += 1
        return self.s[self.i] if self.i < self.n else ""

    def parse(self):
        val = self._expr()
        if self._peek():
            raise QasmImportError(f"trailing garbage in parameter expression: {self.s!r}")
        return val

    def _expr(self):
        val = self._term()
        while self._peek() in ("+", "-"):
            op = self.s[self.i]
            self.i += 1
            rhs = self._term()
            val = val + rhs if op == "+" else val - rhs
        return val

    def _term(self):
        val = self._unary()
        while self._peek() in ("*", "/"):
            op = self.s[self.i]
            self.i += 1
            rhs = self._unary()
            val = val * rhs if op == "*" else val / rhs
        return val

    def _unary(self):
        if self._peek() == "-":
            self.i += 1
            return -self._unary()
        if self._peek() == "+":
            self.i += 1
            return self._unary()
        return self._atom()

    def _atom(self):
        c = self._peek()
        if c == "(":
            self.i += 1
            val = self._expr()
            if self._peek() != ")":
                raise QasmImportError(f"unbalanced parens in expression: {self.s!r}")
            self.i += 1
            return val
        m = re.match(r"[0-9]+\.?[0-9]*(?:[eE][+-]?[0-9]+)?", self.s[self.i:])
        if m and m.group(0):
            self.i += len(m.group(0))
            return float(m.group(0))
        m = re.match(r"[A-Za-z_]\w*", self.s[self.i:])
        if m:
            name = m.group(0)
            self.i += len(name)
            if name == "pi":
                import math
                return math.pi
            raise QasmImportError(f"unsupported identifier {name!r} in parameter expression: {self.s!r}")
        raise QasmImportError(f"could not parse parameter expression: {self.s!r}")


def _eval_expr(s):
    return _ExprParser(s.strip()).parse()


def parse_qasm(text):
    """Parse OpenQASM3 text (the supported subset only) into a circuit IR:
    {"n_qubits": int, "ops": [{"gate": str, "q": [int...], "params": [float...]}]}.
    Raises QasmImportError on any unsupported instruction."""
    stripped = _strip_comments(text)
    registers = {}  # name -> (offset, size)
    n_qubits = 0
    ops = []

    pos = 0
    for raw_stmt in stripped.split(";"):
        stmt_start = pos
        pos += len(raw_stmt) + 1  # +1 for the ';' consumed by split
        stmt = raw_stmt.strip()
        if not stmt:
            continue
        line = _line_of(stripped, stmt_start + (len(raw_stmt) - len(raw_stmt.lstrip())))

        if _OPENQASM_RE.match(stmt) or _INCLUDE_RE.match(stmt):
            continue

        m = _QUBIT_DECL_RE.match(stmt)
        if m:
            size, name = int(m.group(1)), m.group(2)
            if name in registers:
                raise QasmImportError(f"line {line}: duplicate qubit register {name!r}")
            registers[name] = (n_qubits, size)
            n_qubits += size
            continue

        m = _GATE_CALL_RE.match(stmt)
        if not m:
            raise QasmImportError(f"line {line}: could not parse statement: {stmt!r}")
        name, param_str, arg_str = m.group(1), m.group(2), m.group(3)
        lname = name.lower()

        if lname in _KNOWN_UNSUPPORTED_KEYWORDS:
            raise QasmImportError(
                f"line {line}: unsupported instruction {name!r} — qasm_import.py only "
                f"supports the fixed gate subset {sorted(SUPPORTED_GATES)} plus "
                f"'qubit[n] name;' declarations; this is an authoring-side converter, "
                f"not a general QASM3 parser"
            )
        if lname not in SUPPORTED_GATES:
            raise QasmImportError(
                f"line {line}: gate {name!r} is not in the supported subset "
                f"{sorted(SUPPORTED_GATES)} (matches sim.py's KNOWN_GATES for this list); "
                f"statement was: {stmt!r}"
            )

        # qubit args: comma-separated `reg[idx]` tokens.
        qargs = [a.strip() for a in arg_str.split(",")]
        qs = []
        for qa in qargs:
            qm = _QARG_RE.match(qa)
            if not qm:
                raise QasmImportError(
                    f"line {line}: gate {name!r} argument {qa!r} is not of the supported "
                    f"form 'reg[index]' (whole-register broadcast is not supported)"
                )
            reg, idx = qm.group(1), int(qm.group(2))
            if reg not in registers:
                raise QasmImportError(f"line {line}: reference to undeclared register {reg!r}")
            offset, size = registers[reg]
            if idx >= size:
                raise QasmImportError(
                    f"line {line}: index {idx} out of range for register {reg!r} (size {size})"
                )
            qs.append(offset + idx)

        want_arity = _ARITY[lname]
        if len(qs) != want_arity:
            raise QasmImportError(
                f"line {line}: gate {name!r} expects {want_arity} qubit arg(s), got {len(qs)}: {stmt!r}"
            )

        params = []
        want_params = _NPARAMS[lname]
        if param_str is not None and param_str.strip():
            for p in param_str.split(","):
                params.append(_eval_expr(p))
        if len(params) != want_params:
            raise QasmImportError(
                f"line {line}: gate {name!r} expects {want_params} parameter(s), got {len(params)}: {stmt!r}"
            )

        op = {"gate": lname, "q": qs}
        if params:
            op["params"] = params
        ops.append(op)

    if n_qubits == 0:
        raise QasmImportError("no 'qubit[n] <name>;' declaration found")

    return {"n_qubits": n_qubits, "ops": ops}


def main(argv):
    ap = argparse.ArgumentParser(
        prog="qasm_import.py",
        description="Convert an OpenQASM3 file (supported subset) into a proof-bundle circuit IR, "
                    "optionally chaining into capture.py for a full bundle.",
    )
    ap.add_argument("qasm_file")
    ap.add_argument("--problem_id", default=None, help="if given (with --task), chain into capture.py for a full bundle")
    ap.add_argument("--task", default="state_prep")
    ap.add_argument("-o", "--out", default=None, help="output path (default: stdout)")
    args = ap.parse_args(argv[1:])

    with open(args.qasm_file) as f:
        text = f.read()

    try:
        circuit = parse_qasm(text)
    except QasmImportError as e:
        print(f"qasm_import.py: {e}", file=sys.stderr)
        return 2

    if args.problem_id is None:
        out_text = json.dumps(circuit, indent=2)
    else:
        # Reuse capture.py UNCHANGED to build the bundle — this converter never
        # re-implements bundle-building or touches the judge's trust boundary.
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as tf:
            json.dump(circuit, tf)
            circuit_path = tf.name
        try:
            p = subprocess.run(
                [sys.executable, CAPTURE, circuit_path, args.problem_id, "--task", args.task],
                capture_output=True, text=True,
            )
        finally:
            os.unlink(circuit_path)
        if p.returncode != 0:
            print(p.stderr, file=sys.stderr, end="")
            return p.returncode
        out_text = p.stdout

    if args.out:
        with open(args.out, "w") as f:
            f.write(out_text if out_text.endswith("\n") else out_text + "\n")
    else:
        print(out_text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
