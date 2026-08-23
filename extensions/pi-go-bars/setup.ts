/**
 * /gobars-setup — Setup guide for configuring Opencode Go usage bars.
 *
 * Pure guide only: explains how to find credentials, offers config choices.
 * Does NOT fetch or verify credentials.
 */

import * as os from "node:os";
import { Container, Spacer, Text } from "@earendil-works/pi-tui";

export function renderSetupGuide(tui: any, theme: any, done: () => void) {
  const c = new Container();
  c.handleInput = () => { done(); };
  c.addChild(new Text("", 0, 0));
  c.addChild(new Spacer(1));
  renderGuidePage(c, theme);
  c.addChild(new Spacer(1));
  c.addChild(new Text(theme.fg("dim", "Press any key to close"), 0, 0));
  return c;
}

function renderGuidePage(c: Container, t: any) {
  c.addChild(new Text(t.fg("accent", "Step 1: Find your opencode-go API key"), 0, 0));
  c.addChild(new Text(t.fg("dim", "1. opencode stores it in:"), 0, 0));
  c.addChild(new Text(t.fg("success", "   ~/.local/share/opencode/auth.json"), 0, 0));
  c.addChild(new Text(t.fg("dim", "2. Look for the "), 0, 0));
  c.addChild(new Text(t.fg("success", "   \"opencode-go\""), 0, 0));
  c.addChild(new Text(t.fg("dim", "   entry — the extension reads the key automatically,"), 0, 0));
  c.addChild(new Text(t.fg("dim", "   no manual setup needed if you use opencode with Go."), 0, 0));
  c.addChild(new Spacer(1));

  c.addChild(new Text(t.fg("accent", "Step 2: Configure (choose one)"), 0, 0));
  c.addChild(new Spacer(1));

  // Option A: .env file (auto-detected, easiest)
  c.addChild(new Text(t.fg("success", "  [Easy] .env file in your project root"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  Create or edit a .env file with:"), 0, 0));
  c.addChild(new Text(
    t.fg("muted", "  OPENCODE_GO_API_KEY=") + t.fg("success", "sk-..."), 0, 0));
  c.addChild(new Text(t.fg("dim", "  (Optional override. The key is auto-discovered from"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  opencode's auth.json, so usually nothing is needed here.)"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  The extension auto-detects .env in the working directory."), 0, 0));
  c.addChild(new Text(t.fg("dim", "  No restart needed."), 0, 0));
  c.addChild(new Spacer(1));

  // Option B: persistent config file
  const home = os.homedir();
  c.addChild(new Text(t.fg("success", "  [Persistent] ~/.pi/agent/pi-go-bars.json"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  Survives across all projects and terminal sessions:"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  mkdir -p ~/.pi/agent"), 0, 0));
  c.addChild(new Text(
    t.fg("dim", "  cat > ~/.pi/agent/pi-go-bars.json << 'EOF'"), 0, 0));
  c.addChild(new Text(
    t.fg("muted", "  {\n    \"apiKey\": \"") + t.fg("success", "sk-...") + t.fg("muted", "\"\n  }"),
    0, 0));
  c.addChild(new Text(t.fg("dim", "  EOF"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  chmod 600 ~/.pi/agent/pi-go-bars.json"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  Then restart pi."), 0, 0));
  c.addChild(new Spacer(1));

  // Fallback: legacy cookie scrape (only when no API key is available)
  c.addChild(new Text(t.fg("accent", "Fallback: workspace cookie scrape (legacy)"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  Only needed when no API key is available. The extension"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  falls back automatically. Set:"), 0, 0));
  c.addChild(new Text(
    t.fg("muted", "  OPENCODE_GO_WORKSPACE_ID=") + t.fg("success", "wrk_YOUR_ID"), 0, 0));
  c.addChild(new Text(
    t.fg("muted", "  OPENCODE_GO_AUTH_COOKIE=") + t.fg("success", "Fe26.2**..."), 0, 0));
  c.addChild(new Text(t.fg("dim", "  To find them: open https://opencode.ai, go to your Go"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  workspace, copy the wrk_... ID from the URL; get the auth"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  cookie via Dev Tools (F12) -> Application -> Cookies."), 0, 0));
  c.addChild(new Spacer(1));
}
