"""Issue #10: disposable actual-Edge MV3 probe, not extension implementation.

Requires Microsoft Edge, Python 3, and websocket-client. Run:
  python3 edge_probe.py > edge-results.json
Uses fresh temporary profiles; never touches the user's browser profile.
"""
import json
import pathlib
import shutil
import subprocess
import tempfile
import time
import urllib.request

import websocket


class CDP:
    def __init__(self, url, port):
        self.ws = websocket.create_connection(
            url, origin=f"http://localhost:{port}", timeout=60
        )
        self.sequence = 0

    def call(self, method, **params):
        self.sequence += 1
        self.ws.send(json.dumps(dict(id=self.sequence, method=method, params=params)))
        while True:
            result = json.loads(self.ws.recv())
            if result.get("id") == self.sequence:
                if "error" in result:
                    raise RuntimeError(result["error"])
                return result["result"]

    def evaluate(self, expression):
        result = self.call("Runtime.evaluate", expression=expression,
                           awaitPromise=True, returnByValue=True)
        if "exceptionDetails" in result:
            raise RuntimeError(result["exceptionDetails"])
        return result["result"].get("value")


HOSTS = ["https://morph.alpheios.net/*", "https://repos1.alpheios.net/*"]
URLS = [
    "https://morph.alpheios.net/api/v1/analysis/word?word=puellae&engine=whitakerLat&lang=lat&clientId=tensho-research",
    "https://repos1.alpheios.net/lexdata/ls/dat/lat-ls-ids.dat",
    "https://repos1.alpheios.net/exist/rest/db/xq/lexi-get.xq?lx=ls&lg=lat&out=html&n=n39421",
]


def fetch_expression(guard):
    return """(async()=>{
      const results=[]; let fetches=0;
      for (const url of URLS) {
        const origin=new URL(url).origin+'/*';
        const granted=await chrome.permissions.contains({origins:[origin]});
        if (GUARD && !granted) { results.push({url,granted,state:'access-not-granted'}); continue; }
        fetches++;
        try {
          const r=await fetch(url,{credentials:'omit',headers:{Accept:url.includes('morph.')?'application/json':'*/*'},signal:AbortSignal.timeout(15000)});
          const body=await r.text();
          results.push({url,granted,status:r.status,type:r.headers.get('content-type'),characters:body.length,sample:body.slice(0,300)});
        } catch(e) {results.push({url,granted,error:String(e)});}
      }
      return {permissions:await chrome.permissions.getAll(),fetches,results};
    })()""".replace("URLS", json.dumps(URLS)).replace("GUARD", json.dumps(guard))


def run_variant(binary, root, optional, port):
    extension = root / "extension"
    extension.mkdir(parents=True)
    manifest = {"manifest_version": 3, "name": "Tensho issue 10 research probe",
                "version": "0.0.1", "background": {"service_worker": "worker.js"},
                "permissions": ["storage"],
                "optional_host_permissions" if optional else "host_permissions": HOSTS}
    (extension / "manifest.json").write_text(json.dumps(manifest))
    (extension / "worker.js").write_text(
        "chrome.runtime.onInstalled.addListener(()=>chrome.storage.local.set({probe:true}));"
    )
    log = (root / "browser.log").open("w")
    process = subprocess.Popen([
        binary, "--headless=new", f"--user-data-dir={root / 'profile'}",
        "--no-first-run", "--no-default-browser-check",
        f"--disable-extensions-except={extension}", f"--load-extension={extension}",
        f"--remote-debugging-port={port}", f"--remote-allow-origins=http://localhost:{port}",
        "about:blank"], stdout=log, stderr=log)
    base = f"http://localhost:{port}"

    def targets():
        with urllib.request.urlopen(base + "/json/list", timeout=2) as response:
            return json.load(response)

    try:
        for _ in range(100):
            try:
                target = next(t for t in targets() if t["url"].endswith("/worker.js"))
                break
            except (OSError, StopIteration):
                if process.poll() is not None:
                    raise RuntimeError((root / "browser.log").read_text())
                time.sleep(0.1)
        else:
            raise RuntimeError("Extension worker did not load")
        worker = CDP(target["webSocketDebuggerUrl"], port)
        result = {"manifest": manifest, "userAgent": worker.evaluate("navigator.userAgent")}
        result["initial_guarded"] = worker.evaluate(fetch_expression(True))
        if optional:
            result["missing_raw"] = worker.evaluate(fetch_expression(False))
        else:
            # Exercise actual browser-managed revocation, not a mocked permission API.
            request = urllib.request.Request(base + "/json/new?edge://extensions/", method="PUT")
            with urllib.request.urlopen(request) as response:
                page = json.load(response)
            manager = CDP(page["webSocketDebuggerUrl"], port)
            extension_id = target["url"].split("/")[2]
            manager.evaluate("chrome.developerPrivate.updateExtensionConfiguration(" +
                             json.dumps({"extensionId": extension_id, "hostAccess": "ON_CLICK"}) + ")")
            result["revoked_guarded"] = worker.evaluate(fetch_expression(True))
            result["revoked_raw"] = worker.evaluate(fetch_expression(False))
            manager.ws.close()
        worker.ws.close()
        return result
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
        log.close()


if __name__ == "__main__":
    binary = shutil.which("microsoft-edge") or shutil.which("microsoft-edge-stable")
    if not binary:
        raise SystemExit("Microsoft Edge is required; Chromium is not an equivalent observation.")
    with tempfile.TemporaryDirectory(prefix="tensho-issue10-edge-") as directory:
        root = pathlib.Path(directory)
        result = {"observed_at_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                  "browser_version": subprocess.check_output([binary, "--version"], text=True).strip(),
                  "granted_then_revoked": run_variant(binary, root / "required", False, 9231),
                  "optional_never_granted": run_variant(binary, root / "optional", True, 9232)}
        print(json.dumps(result, ensure_ascii=False, indent=2))
