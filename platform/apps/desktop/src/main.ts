/**
 * The desktop shell.
 *
 * It starts the module host in this process on an ephemeral loopback port and points a
 * window at it. There is no separate server to install, no port to remember, and nothing
 * listening that the rest of the machine can reach.
 *
 * The shell knows about *modules*, not about Avilo. Every string a user reads that names
 * a module comes from the registry; the only Avilo-specific line in this file is the
 * import of that registry.
 */

import { app, BrowserWindow, Menu, dialog, shell, ipcMain, nativeTheme } from "electron";
import { writeFile } from "node:fs/promises";
import { get as httpGet } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { serveHost, type RunningHost } from "@bridge/module-host";
import { buildHost, MODULES } from "@avilo/api/src/host.js";
import { configurePaths } from "@avilo/api/src/paths.js";
import { startUpdater } from "./updater.js";
import { runMcpStdio } from "../../mcp/src/stdio-entry.js";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * `--mcp-stdio`: run the MCP server on stdio and exit when stdin closes.
 *
 * The Electron binary is the right host for the MCP server: it already has better-sqlite3
 * (the native addon that cannot be bundled), all @avilo/api modules, and knows exactly
 * where the database and migrations live regardless of install path. A client with the
 * installed app can therefore point their MCP config at the exe with this flag and get
 * the full configuration surface without needing the source repo, tsx, or Node.
 *
 * This runs before the single-instance lock so the MCP process and the GUI can coexist —
 * they open the same SQLite file in WAL mode, which is designed for exactly this.
 */
if (process.argv.includes("--mcp-stdio")) {
  app.whenReady().then(async () => {
    const documents = app.getPath("documents");
    const filesRoot = join(documents, "Bridge", "Avilo Advisory");
    const migrationsDir = app.isPackaged
      ? join(process.resourcesPath, "modules", "avilo", "migrations")
      : join(here, "modules", "avilo", "migrations");
    configurePaths({
      filesRoot,
      dbPath: join(filesRoot, ".data", "avilo.sqlite"),
      migrationsDir,
    });
    await runMcpStdio();
    app.quit();
  }).catch((cause: unknown) => {
    process.stderr.write(`avilo-mcp: ${(cause as Error).message}\n`);
    process.exit(1);
  });
} else {
  /**
   * A single instance, always.
   *
   * Two windows would be cosmetic; two *processes* would be two SQLite writers and two
   * migration runs against one file. Electron's lock is the only thing standing between a
   * double-click on the dock icon and that.
   */
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
  }
}

/** The first module in the registry names the window. */
const PRIMARY = Object.values(MODULES)[0]!;

let running: RunningHost | null = null;
let mainWindow: BrowserWindow | null = null;

/**
 * Packaged builds read their assets out of `process.resourcesPath`; a development run
 * reads them from the build directory beside this file. Everything under here is
 * read-only and ships with the application.
 */
function resourcesRoot(): string {
  return app.isPackaged ? join(process.resourcesPath, "modules") : join(here, "modules");
}

function webDist(): string {
  return app.isPackaged ? join(process.resourcesPath, "web") : join(here, "web");
}

async function startHost(): Promise<RunningHost> {
  const documents = app.getPath("documents");

  const host = buildHost({
    paths: {
      // User-visible, and deliberately not inside the application's private storage:
      // uploads are the user's files. They stay put when the app is uninstalled and can
      // be found in Finder or Explorer without it.
      filesRoot: join(documents, "Bridge"),
      // Private derived state, in the per-user location each OS designates for it.
      dataRoot: join(app.getPath("userData"), "modules"),
      resourcesRoot: resourcesRoot(),
    },
    surface: "desktop",
    log: (message) => console.log(message),
  });

  return serveHost(host, {
    // Port 0: the OS picks a free one. A fixed port would collide with whatever else the
    // user happens to be running, and there is nothing here for anyone to bookmark.
    port: 0,
    host: "127.0.0.1",
    webDist: webDist(),
    logLevel: "warn",
    // No guard. The listener is loopback-only, in-process, on a port nothing else knows,
    // and the only client is the window above it — a password prompt here would protect
    // the user from themselves and nobody else.
  });
}

function createWindow(url: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 860,
    minHeight: 600,
    title: PRIMARY.title,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#111318" : "#f7f8fa",
    // Keep the traffic lights, lose the empty title bar: the app has its own header.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    show: false,
    webPreferences: {
      preload: join(here, "preload.cjs"),
      // The renderer is a web app. It gets no Node, no module registry, and no shared
      // context with this process — everything it needs arrives over the loopback API or
      // through the narrow bridge in the preload.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: true,
    },
  });

  // Render nothing rather than a white flash while the bundle parses.
  window.once("ready-to-show", () => window.show());

  /**
   * Nothing navigates away from the local origin.
   *
   * A financial report is exactly the kind of document that ends up containing a
   * customer-supplied string, and a renderer that can be talked into navigating is a
   * renderer that can be talked into loading someone else's page inside the app frame.
   */
  const origin = new URL(url).origin;
  window.webContents.on("will-navigate", (event, target) => {
    if (new URL(target).origin !== origin) {
      event.preventDefault();
      void shell.openExternal(target);
    }
  });
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    // External links open in the user's browser; nothing opens a second app window.
    if (/^https?:/.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  // No permission this application needs is one the web platform has to grant.
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, grant) =>
    grant(false),
  );

  void window.loadURL(url);
  return window;
}

/**
 * Export the current view as a PDF.
 *
 * The report already has print stylesheets — empty sections drop out, cards avoid page
 * breaks — and `printToPDF` runs the same print path the stylesheets were written for.
 * Going through a save dialog instead of the browser's print sheet is the difference
 * between a desktop app and a web page in a frame.
 */
async function exportPdf(window: BrowserWindow): Promise<void> {
  const suggested = `${window.getTitle().replace(/[\/\\:*?"<>|]/g, "-")}.pdf`;
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: "Export PDF",
    defaultPath: suggested,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (canceled || !filePath) return;

  const data = await window.webContents.printToPDF({
    printBackground: true,
    pageSize: "A4",
    /**
     * Explicit margins, in inches, on every side.
     *
     * `marginType: "default"` leaves the decision to Chromium, which applies its own
     * header/footer allowance to the first page and a much tighter box to the rest — so
     * page two onwards began hard against the top edge. Naming the margins makes every
     * page identical, and matches the @page rule the browser print path uses.
     */
    margins: { marginType: "custom", top: 0.55, bottom: 0.55, left: 0.5, right: 0.5 },
    // The report is a sequence of sections, not a paginated document; letting Chromium
    // reflow to the paper width is what makes sections flow onto the previous page
    // instead of each starting a new one.
    preferCSSPageSize: false,
  });

  await writeFile(filePath, data);
  // Show them the file. An export that silently succeeds is indistinguishable from one
  // that silently failed.
  shell.showItemInFolder(filePath);
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const focused = () => BrowserWindow.getFocusedWindow() ?? mainWindow;

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: "appMenu" as const, label: PRIMARY.title }]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Export PDF…",
          accelerator: "CmdOrCtrl+E",
          click: () => {
            const window = focused();
            if (window) void exportPdf(window);
          },
        },
        {
          label: "Print…",
          accelerator: "CmdOrCtrl+P",
          click: () => focused()?.webContents.print(),
        },
        { type: "separator" },
        {
          label: "Open Files Folder",
          click: () => {
            void shell.openPath(join(app.getPath("documents"), "Bridge"));
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * `--smoke`: start the host, prove it answers, exit.
 *
 * This exists because the two things most likely to be broken on a platform are the two
 * things a type-checker cannot see — whether the native SQLite addon loads against this
 * Electron's Node-API version, and whether the migrations shipped in `resources` were
 * actually found. Both are platform-specific, and the Windows installer is built on a
 * machine that cannot run it. A CI runner that boots the real application and reads its
 * own `/health` is the difference between "the installer was produced" and "the
 * application works".
 */
async function smokeTest(): Promise<never> {
  // A hung smoke test is worse than a failing one: it burns a CI job's whole timeout and
  // reports nothing. Nothing here should take a second.
  const deadline = setTimeout(() => {
    console.error("smoke failed: timed out after 60s");
    process.exit(1);
  }, 60_000);
  deadline.unref?.();

  const started = await startHost();
  try {
    // `node:http`, not the global `fetch`. In the main process `fetch` is Chromium's,
    // routed through the network service — which in a windowless run has nothing driving
    // it, and the request simply never settles.
    const body = await new Promise<string>((resolve, reject) => {
      const request = httpGet(`${started.url}/health`, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`/health returned ${response.statusCode}`));
          response.resume();
          return;
        }
        let text = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (text += chunk));
        response.on("end", () => resolve(text));
      });
      request.on("error", reject);
    });

    const parsed = JSON.parse(body) as { ok?: boolean; modules?: unknown };
    if (parsed.ok !== true) throw new Error(`/health said ${body}`);

    console.log(`smoke ok ${JSON.stringify(parsed.modules)}`);
    await started.close();
    process.exit(0);
  } catch (error) {
    console.error(`smoke failed: ${(error as Error).message}`);
    await started.close().catch(() => {});
    process.exit(1);
  }
}

if (!process.argv.includes("--mcp-stdio")) app.whenReady().then(async () => {
  if (process.argv.includes("--smoke")) {
    await smokeTest();
  }

  try {
    running = await startHost();
  } catch (error) {
    // A host that cannot start has usually failed a migration or cannot open its
    // database. Neither is something the user can act on from an empty window, so say
    // what happened and stop.
    dialog.showErrorBox(
      `${PRIMARY.title} could not start`,
      (error as Error).message ?? String(error),
    );
    app.quit();
    return;
  }

  buildMenu();
  mainWindow = createWindow(running.url);

  // Background, quiet, and never restarts on its own — see updater.ts.
  startUpdater({
    getWindow: () => BrowserWindow.getFocusedWindow() ?? mainWindow,
    log: (message) => console.log(`[updater] ${message}`),
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && running) {
      mainWindow = createWindow(running.url);
    }
  });
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

// macOS keeps the app running with no windows; everywhere else, closing the last window
// means the user is done.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

/**
 * Close the database before the process exits.
 *
 * `before-quit` rather than `will-quit` so there is still an event loop to await on, and
 * the quit is deferred exactly once — SQLite's WAL wants a clean close, and a desktop app
 * quits far more often than a server restarts.
 */
let closing = false;
app.on("before-quit", (event) => {
  if (closing || !running) return;
  event.preventDefault();
  closing = true;

  /*
    A clean close, but never an unbounded one.

    Deferring the quit until the server has closed is right, and it was also the reason
    the Windows installer could not upgrade in place: Fastify's `close()` waits for open
    connections to drain, and a websocket or a request that never completes leaves it
    pending forever. The process stayed alive with no window, NSIS reported "Avilo
    Advisory cannot be closed", and the only way out was Task Manager.

    Two and a half seconds is far longer than a loopback server with a local SQLite file
    needs, and short enough that a user never waits on it. Whichever finishes first, the
    process exits.
  */
  const graceMs = 2500;
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    app.exit(0);
  };

  const timer = setTimeout(finish, graceMs);
  // `unref` so a pending timer is never itself the thing holding the process open.
  timer.unref?.();

  void running
    .close()
    .catch(() => {})
    .finally(() => {
      clearTimeout(timer);
      finish();
    });
});

/** The renderer asks for its own export path when the report page owns the button. */
ipcMain.handle("desktop:export-pdf", async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) await exportPdf(window);
});
