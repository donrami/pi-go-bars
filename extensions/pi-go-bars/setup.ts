/**
 * /gobars-setup — Setup guide for configuring Opencode Go usage bars.
 *
 * Pure guide only: explains how to find credentials, offers config choices.
 * Does NOT fetch or verify credentials.
 */

import * as os from "node:os";
import { Container, Spacer, Text } from "@mariozechner/pi-tui";

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
  c.addChild(new Text(t.bold("Go Bars Setup — Getting Your Credentials"), 0, 0));
  c.addChild(new Spacer(1));

  c.addChild(new Text(t.fg("accent", "Step 1: Find your Workspace ID"), 0, 0));
  c.addChild(new Text(t.fg("dim", "1. Open https://opencode.ai in your browser"), 0, 0));
  c.addChild(new Text(t.fg("dim", "2. Go to your Go workspace"), 0, 0));
  c.addChild(new Text(t.fg("dim", "3. Copy the ID from the URL:"), 0, 0));
  c.addChild(new Text(t.fg("dim", "   https://opencode.ai/workspace/"), 0, 0));
  c.addChild(new Text(t.fg("success", "   wrk_XXXXXXXXXXXXXXXX"), 0, 0));
  c.addChild(new Text(t.fg("dim", "   /go"), 0, 0));
  c.addChild(new Spacer(1));

  c.addChild(new Text(t.fg("accent", "Step 2: Find your Auth Cookie"), 0, 0));
  c.addChild(new Text(t.fg("dim", "1. Open browser Dev Tools (F12)"), 0, 0));
  c.addChild(new Text(t.fg("dim", "2. Go to Application -> Storage -> Cookies -> opencode.ai"), 0, 0));
  c.addChild(new Text(t.fg("dim", "3. Find the cookie named"), 0, 0));
  c.addChild(new Text(t.fg("success", "   auth"), 0, 0));
  c.addChild(new Text(t.fg("dim", "4. Copy its value (starts with Fe26.2**)"), 0, 0));
  c.addChild(new Spacer(1));

  c.addChild(new Text(t.fg("accent", "Step 3: Configure (choose one)"), 0, 0));
  c.addChild(new Spacer(1));

  // Option A: .env file (auto-detected, easiest)
  c.addChild(new Text(t.fg("success", "  [Easy] .env file in your project root"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  Create or edit a .env file with:"), 0, 0));
  c.addChild(new Text(
    t.fg("muted", "  OPENCODE_GO_WORKSPACE_ID=") + t.fg("success", "wrk_YOUR_ID"), 0, 0));
  c.addChild(new Text(
    t.fg("muted", "  OPENCODE_GO_AUTH_COOKIE=") + t.fg("success", "Fe26.2**..."), 0, 0));
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
    t.fg("muted", "  {\n    \"workspaceId\": \"") + t.fg("success", "wrk_YOUR_ID") + t.fg("muted", "\",\n    \"authCookie\": \"") + t.fg("success", "Fe26.2**...") + t.fg("muted", "\"\n  }"),
    0, 0));
  c.addChild(new Text(t.fg("dim", "  EOF"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  chmod 600 ~/.pi/agent/pi-go-bars.json"), 0, 0));
  c.addChild(new Text(t.fg("dim", "  Then restart pi."), 0, 0));
}
