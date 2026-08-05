; Custom NSIS hooks for the Windows installer.
;
; The default installer asks the user to close a running copy and gives up if it cannot.
; That is the wrong trade for this app: a hung process with no window is exactly the state
; v1.4.x left behind (the server's close() drained open connections forever, so the
; process outlived its last window), and the person hitting it has no window to close and
; no reason to know Task Manager is the answer. Both install and uninstall now end the
; process themselves.
;
; taskkill is used rather than NSIS process plugins so nothing extra has to be bundled.
; Failures are ignored on purpose — "not running" is the normal case and reports an error.

!macro customInit
  nsExec::Exec 'taskkill /F /IM "Avilo Advisory.exe" /T'
  Pop $0
  Sleep 500
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM "Avilo Advisory.exe" /T'
  Pop $0
  Sleep 500
!macroend

; Leave ~/Documents/Bridge alone — the SQLite database, the imported QuickBooks files and
; the exported PDFs are the user's own work, not ours to delete. Only the per-user cache
; the app writes under AppData goes.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    RMDir /r "$LOCALAPPDATA\avilo-advisory-updater"
  ${endif}
!macroend
