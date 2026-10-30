<#
.SYNOPSIS
  Build and (optionally) publish a PieDesk release that installed copies pick up as an update.

.DESCRIPTION
  1. sets the version in package.json, src-tauri/Cargo.toml and src-tauri/tauri.conf.json
  2. builds the signed NSIS installer (npm run tauri build, key from ~/.tauri/piedesk.key)
  3. writes release/<version>/ with
       PieDesk_<version>_x64-setup.exe       the installer
       PieDesk_<version>_x64-setup.exe.sig   minisign signature
       latest.json                           updater manifest read by PieDesk
       SHA256SUMS.txt                        hashes of the files above
  4. -Publish: commits everything (git add -A, "Release v<version>"), pushes the current branch,
     then creates GitHub release v<version> on that commit with those files (needs git + gh).
     Every installed PieDesk then finds it through plugins.updater.endpoints in tauri.conf.json.

  Keep ~/.tauri/piedesk.key safe: losing it means installed copies can no longer be updated.

.EXAMPLE
  ./scripts/release.ps1 -Version 0.2.0 -Notes "Agents widget, party mode"
  ./scripts/release.ps1 -Version 0.2.0 -Publish
#>
param(
    [string]$Version,
    [string]$Notes = "",
    [string]$KeyPath = (Join-Path $HOME ".tauri\piedesk.key"),
    [switch]$Publish
)

$ErrorActionPreference = "Stop"
$utf8 = New-Object System.Text.UTF8Encoding($false)  # no BOM: the updater parses latest.json strictly
function Set-FileText($path, $text) { [IO.File]::WriteAllText($path, $text, $utf8) }

$root = Split-Path $PSScriptRoot -Parent
$pkgPath = Join-Path $root "package.json"
$cargoPath = Join-Path $root "src-tauri\Cargo.toml"
$confPath = Join-Path $root "src-tauri\tauri.conf.json"

$conf = Get-Content $confPath -Raw | ConvertFrom-Json
$endpoint = @($conf.plugins.updater.endpoints)[0]
if ($endpoint -notmatch '^https://github\.com/([^/]+/[^/]+)/releases/latest/download/latest\.json$') {
    throw "plugins.updater.endpoints[0] must be https://github.com/<owner>/<repo>/releases/latest/download/latest.json (is: $endpoint)"
}
$repo = $Matches[1]

# ---------------------------------------------------------------- version
if ($Version) {
    if ($Version -notmatch '^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$') { throw "Not a semver version: $Version" }
    $pkg = [IO.File]::ReadAllText($pkgPath)
    Set-FileText $pkgPath ([regex]::new('"version":\s*"[^"]+"').Replace($pkg, "`"version`": `"$Version`"", 1))
    $c = [IO.File]::ReadAllText($confPath)
    Set-FileText $confPath ([regex]::new('"version":\s*"[^"]+"').Replace($c, "`"version`": `"$Version`"", 1))
    $cargo = [IO.File]::ReadAllText($cargoPath)
    Set-FileText $cargoPath ([regex]::new('(?m)^version = "[^"]+"').Replace($cargo, "version = `"$Version`"", 1))
    Write-Host "Version set to $Version"
}
$Version = (Get-Content $pkgPath -Raw | ConvertFrom-Json).version

# ---------------------------------------------------------------- signing key
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
    if (-not (Test-Path $KeyPath)) { throw "Signing key not found: $KeyPath" }
    $env:TAURI_SIGNING_PRIVATE_KEY = [IO.File]::ReadAllText($KeyPath).Trim()
}
if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "" }

# ---------------------------------------------------------------- build
Push-Location $root
# Windows PowerShell turns the CLI's stderr progress lines into errors under "Stop"; judge by exit code.
$ErrorActionPreference = "Continue"
try {
    npm run tauri build
    if ($LASTEXITCODE -ne 0) { throw "tauri build failed ($LASTEXITCODE)" }
} finally {
    Pop-Location
    $ErrorActionPreference = "Stop"
}

# ---------------------------------------------------------------- collect
$nsis = Join-Path $root "src-tauri\target\release\bundle\nsis"
$setup = Get-ChildItem $nsis -Filter "*_${Version}_x64-setup.exe" | Select-Object -First 1
if (-not $setup) { throw "No installer for $Version in $nsis" }
$sigPath = "$($setup.FullName).sig"
if (-not (Test-Path $sigPath)) { throw "Missing signature $sigPath" }

$outDir = Join-Path $root "release\$Version"
New-Item -ItemType Directory -Force $outDir | Out-Null
$assetName = "PieDesk_${Version}_x64-setup.exe"
Copy-Item $setup.FullName (Join-Path $outDir $assetName) -Force
Copy-Item $sigPath (Join-Path $outDir "$assetName.sig") -Force

$manifest = [ordered]@{
    version   = $Version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = [IO.File]::ReadAllText($sigPath).Trim()
            url       = "https://github.com/$repo/releases/download/v$Version/$assetName"
        }
    }
}
Set-FileText (Join-Path $outDir "latest.json") ($manifest | ConvertTo-Json -Depth 5)

$sums = Get-ChildItem $outDir -File | Where-Object Name -ne "SHA256SUMS.txt" | Sort-Object Name | ForEach-Object {
    "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)"
}
Set-FileText (Join-Path $outDir "SHA256SUMS.txt") (($sums -join "`n") + "`n")

Write-Host ""
Write-Host "Release files in $outDir" -ForegroundColor Green
Get-ChildItem $outDir | ForEach-Object { Write-Host "  $($_.Name)  ($([math]::Round($_.Length / 1MB, 2)) MB)" }

# ---------------------------------------------------------------- publish
if ($Publish) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { throw "gh (GitHub CLI) is not installed; upload the files by hand" }
    $notesArg = if ($Notes) { $Notes } else { "PieDesk v$Version" }

    # Source first, so the release tag points at the code that was built.
    Push-Location $root
    $ErrorActionPreference = "Continue"
    try {
        git add -A
        git diff --cached --quiet
        if ($LASTEXITCODE -ne 0) {
            git commit -q -m "Release v$Version" -m $notesArg
            if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
        }
        # Borrow gh's login for this push only; the machine's git config is left alone.
        git -c credential.helper= -c "credential.helper=!gh auth git-credential" push -q origin HEAD
        if ($LASTEXITCODE -ne 0) { throw "git push failed" }
        $commit = (git rev-parse HEAD).Trim()
    } finally {
        Pop-Location
        $ErrorActionPreference = "Stop"
    }
    Write-Host "Pushed $commit"

    $files = Get-ChildItem $outDir | ForEach-Object { $_.FullName }
    gh release create "v$Version" @files --repo $repo --target $commit --title "PieDesk v$Version" --notes $notesArg --latest
    if ($LASTEXITCODE -ne 0) { throw "gh release create failed" }
    Write-Host "Published https://github.com/$repo/releases/tag/v$Version" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "Next: create release v$Version on https://github.com/$repo/releases/new with these files, or rerun with -Publish."
}
