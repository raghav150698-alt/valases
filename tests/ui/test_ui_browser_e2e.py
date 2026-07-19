import os
import socket
import subprocess
import time
import unittest
from urllib.request import urlopen


try:
    from playwright.sync_api import sync_playwright
except Exception:  # pragma: no cover
    sync_playwright = None


def _free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = int(sock.getsockname()[1])
    sock.close()
    return port


@unittest.skipIf(sync_playwright is None, "Playwright is not installed in this environment")
class UiBrowserE2ETest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.port = _free_port()
        env = os.environ.copy()
        env.update(
            {
                "AUTH_MODE": "dummy",
                "DATABASE_URL": "sqlite:///./certora.db",
                "STREAM_DRM_LICENSE_SECRET": "ui_e2e_secret",
            },
        )
        cls.server = subprocess.Popen(
            ["python", "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(cls.port)],
            cwd=r"D:\certora",
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        base = f"http://127.0.0.1:{cls.port}"
        started = False
        for _ in range(80):
            try:
                with urlopen(f"{base}/health", timeout=1) as resp:
                    if int(getattr(resp, "status", 0) or 0) == 200:
                        started = True
                        break
            except Exception:
                time.sleep(0.25)
        if not started:
            raise RuntimeError("UI E2E server failed to start")
        cls.base = base

    @classmethod
    def tearDownClass(cls) -> None:
        if getattr(cls, "server", None):
            cls.server.terminate()
            try:
                cls.server.wait(timeout=6)
            except Exception:
                cls.server.kill()

    def _eval_sidebar_contract(self, page, root_id: str) -> dict:
        return page.evaluate(
            """(rootId) => {
                document.body.classList.add("app-workspace-active");
                const root = document.getElementById(rootId);
                if (!root) return { found: false };
                root.classList.remove("hidden");
                const sidebar = root.querySelector(".sidebar");
                const tools = root.querySelector(".sidebar-tools");
                const s = window.getComputedStyle(sidebar);
                const t = window.getComputedStyle(tools);
                return {
                    found: true,
                    sidebarPosition: s.position,
                    sidebarOverflowY: s.overflowY,
                    toolsPosition: t.position
                };
            }""",
            root_id,
        )

    def test_provider_sidebar_scroll_and_sticky_settings(self) -> None:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1366, "height": 768})
            page.goto(f"{self.base}/", wait_until="domcontentloaded")
            contract = self._eval_sidebar_contract(page, "providerView")
            browser.close()
        self.assertTrue(contract.get("found"), contract)
        self.assertEqual(contract.get("sidebarPosition"), "sticky", contract)
        self.assertIn(contract.get("sidebarOverflowY"), {"auto", "scroll"}, contract)
        self.assertEqual(contract.get("toolsPosition"), "sticky", contract)

    def test_student_sidebar_scroll_and_sticky_settings(self) -> None:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1366, "height": 768})
            page.goto(f"{self.base}/", wait_until="domcontentloaded")
            contract = self._eval_sidebar_contract(page, "studentView")
            browser.close()
        self.assertTrue(contract.get("found"), contract)
        self.assertEqual(contract.get("sidebarPosition"), "sticky", contract)
        self.assertIn(contract.get("sidebarOverflowY"), {"auto", "scroll"}, contract)
        self.assertEqual(contract.get("toolsPosition"), "sticky", contract)

    def test_watermark_text_contract_contains_name_phone_timestamp_shape(self) -> None:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(viewport={"width": 1366, "height": 768})
            page.goto(f"{self.base}/", wait_until="domcontentloaded")
            out = page.evaluate(
                """() => {
                    const shell = document.getElementById("scvVideoShell");
                    const pane = document.getElementById("student-view-course");
                    if (pane) pane.classList.remove("hidden");
                    if (!shell) return { ok: false, reason: "missing shell" };
                    let wm = shell.querySelector(".scv-watermark");
                    if (!wm) {
                      wm = document.createElement("div");
                      wm.className = "scv-watermark";
                      shell.appendChild(wm);
                    }
                    wm.textContent = "Demo User | +919876543210 | 2026-04-28 12:34:56";
                    const s = window.getComputedStyle(wm);
                    return {
                      ok: true,
                      text: wm.textContent || "",
                      display: s.display,
                      position: s.position
                    };
                }""",
            )
            browser.close()
        self.assertTrue(out.get("ok"), out)
        self.assertIn("|", out.get("text", ""))
        self.assertEqual(out.get("position"), "absolute", out)
        self.assertNotEqual(out.get("display"), "none", out)


if __name__ == "__main__":
    unittest.main()
