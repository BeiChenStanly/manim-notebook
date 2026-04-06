import { before, describe, it } from "mocha";
import { commands, env, window } from "vscode";
import { goToLine } from "./utils/editor";
import { onAnyTerminalOutput } from "./utils/terminal";
import { uriInWorkspace } from "./utils/testRunner";
let expect: Chai.ExpectStatic;

async function waitForClipboardEquals(expected: string, timeoutMs = 7000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await env.clipboard.readText() === expected) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Timed out waiting for clipboard restore");
}

before(async () => {
  // why this weird import syntax?
  // -> see https://github.com/microsoft/vscode/issues/130367
  const chai = await import("chai");
  expect = chai.expect;
});

describe("Previewing", function () {
  it("Can preview the current Manim Cell", async () => {
    const editor = await window.showTextDocument(uriInWorkspace("basic.py"));
    goToLine(editor, 11);
    await commands.executeCommand("manim-notebook.previewManimCell");

    return new Promise((resolve) => {
      onAnyTerminalOutput(async (data, stopListening) => {
        if (data.includes("ReplacementTransformCircle")) {
          stopListening();
          await commands.executeCommand("manim-notebook.exitScene");
          setTimeout(resolve, 1500);
        }
      });
    });
  });

  it("Can preview laggy scene", async () => {
    const editor = await window.showTextDocument(uriInWorkspace("laggy.py"));
    const queue: { line: number; waitForStrings: string[]; resolve: () => void }[] = [];
    let wantToStopListening = false;

    onAnyTerminalOutput(async (data, stopListening) => {
      if (wantToStopListening) {
        stopListening();
        return;
      }
      if (queue.length === 0) {
        throw new Error("Listening to terminal output, but nothing in queue to check against");
      }

      const { waitForStrings } = queue[0];
      for (const str of waitForStrings) {
        if (data.includes(str)) {
          waitForStrings.removeByValue(str);
        }
      }
      if (waitForStrings.length === 0) {
        queue.shift()?.resolve();
      }
    });

    async function testPreviewAtLine(line: number, waitForStrings: string[]) {
      goToLine(editor, line);
      await commands.executeCommand("manim-notebook.previewManimCell");
      await new Promise<void>((resolve) => {
        queue.push({ line, waitForStrings, resolve });
      });
    }

    await testPreviewAtLine(8, ["ShowCreationVGroup", "In [2]:"]);
    await testPreviewAtLine(14, ["_MethodAnimationValueTracker", "In [3]:"]);
    await testPreviewAtLine(21, ["_MethodAnimationValueTracker", "In [4]:"]);
    await testPreviewAtLine(14, ["_MethodAnimationValueTracker", "In [5]:"]);

    wantToStopListening = true; // cleanup for subsequent tests
    expect(queue.length).to.equal(0);

    await commands.executeCommand("manim-notebook.exitScene");
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  it("Restores clipboard correctly across consecutive previews", async function () {
    this.timeout(120000);

    const editor = await window.showTextDocument(uriInWorkspace("laggy.py"));
    const clipboardBeforeTest = await env.clipboard.readText();
    const originalClipboard = `mn-original-${Date.now()}-${Math.random()}`;

    try {
      await env.clipboard.writeText(originalClipboard);

      goToLine(editor, 8);
      await commands.executeCommand("manim-notebook.previewManimCell");

      // Immediately trigger another preview to simulate clipboard restore races.
      goToLine(editor, 14);
      await commands.executeCommand("manim-notebook.previewManimCell");

      await waitForClipboardEquals(originalClipboard);
      expect(await env.clipboard.readText()).to.equal(originalClipboard);

      await commands.executeCommand("manim-notebook.exitScene");
      await new Promise(resolve => setTimeout(resolve, 1000));
    } finally {
      await env.clipboard.writeText(clipboardBeforeTest);
    }
  });
});
