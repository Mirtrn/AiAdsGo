import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  resetWorkspaceTemplateDirCache,
  resolveWorkspaceTemplateDir,
} from "./workspace-templates.js";

async function makeTempRoot(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-templates-"));
}

describe("resolveWorkspaceTemplateDir", () => {
  it("resolves templates from package root when module url is dist-rooted", async () => {
    resetWorkspaceTemplateDirCache();
    const root = await makeTempRoot();
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "openclaw" }));

    const templatesDir = path.join(root, "workspace-templates");
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.writeFile(path.join(templatesDir, "AGENTS.md"), "# ok\n");

    const distDir = path.join(root, "dist");
    await fs.mkdir(distDir, { recursive: true });
    const moduleUrl = pathToFileURL(path.join(distDir, "model-selection.mjs")).toString();

    const resolved = await resolveWorkspaceTemplateDir({ cwd: distDir, moduleUrl });
    expect(resolved).toBe(templatesDir);
  });

  it("prefers workspace-templates over docs templates", async () => {
    resetWorkspaceTemplateDirCache();
    const root = await makeTempRoot();
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "openclaw" }));

    const workspaceTemplatesDir = path.join(root, "workspace-templates");
    await fs.mkdir(workspaceTemplatesDir, { recursive: true });
    await fs.writeFile(path.join(workspaceTemplatesDir, "AGENTS.md"), "# workspace\n");

    const docsTemplatesDir = path.join(root, "docs", "reference", "templates");
    await fs.mkdir(docsTemplatesDir, { recursive: true });
    await fs.writeFile(path.join(docsTemplatesDir, "AGENTS.md"), "# docs\n");

    const distDir = path.join(root, "dist");
    await fs.mkdir(distDir, { recursive: true });
    const moduleUrl = pathToFileURL(path.join(distDir, "workspace.mjs")).toString();

    const resolved = await resolveWorkspaceTemplateDir({ cwd: distDir, moduleUrl });
    expect(resolved).toBe(workspaceTemplatesDir);
  });
});
