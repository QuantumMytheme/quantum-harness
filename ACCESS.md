# Getting a quantum chip — you don't need to own one

You can validate a design on **real hardware** without owning a quantum computer. The
judge stays free and offline; a chip is an *optional* overlay, and it's the participant's
cost — never the project's. Here's how to get access, cheapest first.

## Free / near-free real devices

| Provider | What you get | How |
|---|---|---|
| **IBM Quantum** | Free **Open Plan** — real superconducting devices, minutes/month | sign in at quantum.ibm.com → save your token → `pip install qiskit qiskit-ibm-runtime` |
| **AWS Braket** | Pay-per-task; **simulators free**, hardware is per-shot (often cents–dollars per job); new-account credits | enable Braket in AWS → `pip install amazon-braket-sdk` |
| **Azure Quantum** | Free credits for IonQ / Quantinuum / Rigetti on sign-up | portal.azure.com → Quantum workspace |
| **IonQ** | Via AWS Braket or Azure (per-shot) | through the above |

For most problems here (2–4 qubits, a few thousand shots), a single hardware run costs
**well under a dollar** on the pay-per-shot providers, and is **free** on the IBM Open Plan.

## Run a sim-verified design on it — one command

`run_on_hardware.py` takes a design you've already verified in simulation and runs the
**same circuit** on your backend, then emits a `hardware-report@1` JSON.

```sh
# IBM (your saved qiskit-ibm-runtime credentials):
python3 bench/quantum-judge/run_on_hardware.py your-bundle.json --backend ibm:ibm_torino --shots 4096 > hw.json

# AWS Braket (your AWS creds):
python3 bench/quantum-judge/run_on_hardware.py your-bundle.json --backend braket:arn:aws:braket:::device/qpu/ionq/Aria-1 --shots 1000 > hw.json

# No chip yet? The built-in emulator runs the whole path with zero setup:
python3 bench/quantum-judge/run_on_hardware.py your-bundle.json --backend local-noisy --shots 4096 > hw.json
```

Then verify and overlay it:

```sh
python3 bench/quantum-judge/hardware_report.py hw.json   # recomputes the metric from your counts; ACCEPT/exit 0
```

The report's metric is **recomputed from your raw counts** (re-verifiable by anyone), and
the provenance — which backend, job id, calibration — is recorded and labeled. A hardware
overlay never outranks the sim score; it shows *"validated on `ibm_torino`, ⟨H⟩ = −2.90."*
Full details: **[HARDWARE.md](HARDWARE.md)**.

## Report back

Commit `hw.json` to your run repo next to the proof bundle, and add a `hardware_reports`
entry to your `scoreboard-entry.json`:

```json
"hardware_reports": [
  { "backend": "ibm_torino", "metric": "energy", "value": -2.90, "shots": 4096,
    "report_url": "https://github.com/<you>/<run-repo>/blob/main/hw.json" }
]
```

It shows on the board as a **⚛ hardware overlay**. That's the loop closed:
**design → sim-verify → run on silicon → report back**, free to host, cheap to participate.

---
**Researchers & orgs with a chip:** point `--backend` at your device and report back the
same way — your verified hardware result joins the open corpus. **No chip?** Rent one above,
or use the emulator to develop the whole flow first.
