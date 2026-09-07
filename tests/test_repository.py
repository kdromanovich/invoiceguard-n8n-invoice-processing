from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class RepositoryTests(unittest.TestCase):
    def run_checked(self, *command: str) -> str:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(
            completed.returncode,
            0,
            msg=f"command failed: {' '.join(command)}\n{completed.stdout}\n{completed.stderr}",
        )
        return completed.stdout

    def test_structural_validation(self) -> None:
        output = self.run_checked(sys.executable, "scripts/validate_workflow.py")
        self.assertIn("PASS: 1 workflow", output)

    def test_every_code_node_compiles(self) -> None:
        output = self.run_checked("node", "scripts/check-code-syntax.mjs")
        self.assertIn("28 Code nodes", output)

    def test_offline_demo_and_guardrails(self) -> None:
        output = self.run_checked("node", "scripts/run-demo-path.mjs")
        self.assertIn("demo_draft_created", output)
        self.assertIn("critical bank-change block", output)

    def test_manifest_matches_export(self) -> None:
        manifest = json.loads((ROOT / "workflow-manifest.json").read_text(encoding="utf-8"))
        workflow = json.loads(
            (ROOT / "workflows" / "invoiceguard-ai-invoice-processing.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest["workflow_count"], 1)
        entry = manifest["workflows"][0]
        self.assertEqual(entry["nodes_total"], len(workflow["nodes"]))


if __name__ == "__main__":
    unittest.main()
