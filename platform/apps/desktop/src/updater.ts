/**
 * In-place updates, so a new build does not mean downloading an installer again.
 *
 * The flow is deliberately quiet: check on launch, download in the background, and only
 * interrupt once — when a verified update is already on disk and all that remains is a
 * restart. A financial application should never restart itself under someone who is
 * mid-edit, so the restart is always the user's click.
 */

import { app, autoUpdater as _electronAutoUpdater, dialog, BrowserWindow } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

/**
 * How long after launch to look.
 *
 * Not immediately: the first seconds after launch are spent opening the database, running
 * migrations and painting the first window, and an update check competing for that is
 * visible as a slow start.
 */
const FIRST_CHECK_DELAY_MS = 20_000;

/** Once a day is enough for an application someone leaves open for weeks. */
const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdaterOptions {
  /** Used for the "restart now" prompt; nothing is shown if there is no window. */
  getWindow: () => BrowserWindow | null;
  log: (message: string) => void;
}

export function startUpdater({ getWindow, log }: UpdaterOptions): void {
  /**
   * A development run has no update feed and no code signature, and pointing it at the
   * release channel would either fail noisily on every launch or — worse — replace the
   * checkout you are working on with the last published build.
   */
  if (!app.isPackaged) {
    log("updates disabled: not a packaged build");
    return;
  }

  /**
   * macOS refuses to apply an update to an unsigned application: Squirrel.Mac verifies
   * the new bundle's signature against the running one, and an ad-hoc signature fails
   * that check. Rather than download 150 MB on every launch and fail at the last step,
   * say so once and stop.
   *
   * Windows has no such requirement, so NSIS updates work on an unsigned build.
   */
  if (process.platform === "darwin" && !isSigned()) {
    log("updates disabled: unsigned macOS build cannot be updated in place");
    return;
  }

  autoUpdater.autoDownload = true;
  // Never restart without asking — see the note at the top of this file.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => log("checking for updates"));
  autoUpdater.on("update-not-available", () => log("no update available"));
  autoUpdater.on("update-available", (info) => log(`update available: ${info.version}`));
  autoUpdater.on("error", (error) => {
    // An update that cannot be fetched is not a reason to interrupt anyone. The user has
    // a working application; the next launch will try again.
    log(`update check failed: ${error.message}`);
  });

  autoUpdater.on("update-downloaded", async (info) => {
    log(`update downloaded: ${info.version}`);
    const window = getWindow();
    if (!window) return;

    const { response } = await dialog.showMessageBox(window, {
      type: "info",
      buttons: ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
      title: "Update ready",
      message: `Avilo Advisory ${info.version} is ready to install.`,
      detail:
        "The update will be applied when you restart. Your clients, uploads and edits are unaffected — they live in your Documents folder, not inside the application.",
    });

    if (response === 0) {
      // `isSilent`, then `isForceRunAfter`: install without a second wizard, and come
      // back up on the same client the user was looking at.
      autoUpdater.quitAndInstall(true, true);
    }
    // "Later" leaves autoInstallOnAppQuit to apply it on the next ordinary quit.
  });

  const check = () => {
    void autoUpdater.checkForUpdates().catch(() => {
      // Already reported through the error handler above.
    });
  };

  setTimeout(check, FIRST_CHECK_DELAY_MS).unref?.();
  setInterval(check, RECHECK_INTERVAL_MS).unref?.();
}

/**
 * Whether this build carries a real code signature.
 *
 * Electron's own `autoUpdater` throws rather than returning false when the bundle is
 * unsigned, which is exactly the question being asked — so the throw is the answer.
 */
function isSigned(): boolean {
  try {
    // Reading the feed URL forces Squirrel to initialise, which is where the signature
    // requirement is enforced.
    _electronAutoUpdater.getFeedURL();
    return true;
  } catch {
    return false;
  }
}
