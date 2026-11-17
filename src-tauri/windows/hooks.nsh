; PieDesk installer hooks (bundle > windows > nsis > installerHooks).
;
; Admin rights are granted once, here: PieDesk registers its admin helper task (one UAC prompt)
; so Clean up / Uninstaller / Optimize never ask again. Skipped when it is already there, or when
; the user revoked it in PieDesk → Utilities (an update must not ask again).

!macro NSIS_HOOK_POSTINSTALL
  ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --piedesk-setup-admin'
!macroend

; Real uninstall only (an update runs the old uninstaller with /UPDATE): remove the helper task.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ExecWait '"$INSTDIR\${MAINBINARYNAME}.exe" --piedesk-remove-admin'
  ${EndIf}
!macroend
